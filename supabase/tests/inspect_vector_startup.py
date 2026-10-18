"""Read-only refinement: classify startup/configuration without emitting raw content."""
from datetime import datetime, timezone
import hashlib
import importlib.util
import io
import json
from pathlib import PurePosixPath
import re
import shlex
import sys
import tarfile
from urllib.parse import urlsplit
import uuid

import diagnose_vector_health as base

KNOWN_HOSTS = {'localhost', '127.0.0.1', '0.0.0.0', 'host.docker.internal', 'gateway.docker.internal',
               'supabase_analytics_school-queue-local', 'supabase_vector_school-queue-local'}


def endpoints(text):
    values = set()
    for match in re.finditer(r'(?:https?|tcp|unix)://[^\s\x00\x1b<>"\')]+', text):
        try:
            u = urlsplit(match[0].rstrip(',;'))
            if u.scheme == 'unix' and u.path in ('/var/run/docker.sock', '/run/docker.sock'):
                values.add('unix://' + u.path)
            elif u.scheme in ('http', 'https', 'tcp') and u.hostname in KNOWN_HOSTS:
                values.add(u.scheme + '://' + u.hostname + (':' + str(u.port) if u.port is not None else ''))
        except ValueError: pass
    return sorted(values)


def log_refinement(line):
    result = base.sanitize_log(line)
    lower = line.lower()
    for phrase, category in [('all sources have finished', 'all-sources-finished'),
                             ('all sources finished', 'all-sources-finished'),
                             ('vector has stopped', 'vector-stopped'),
                             ('vector has started', 'vector-started'),
                             ('api is disabled', 'vector-api-disabled'),
                             ('api server running', 'vector-api-running'),
                             ('loading configs', 'loading-configs'),
                             ('shutting down', 'shutdown'),
                             ('capturing logs', 'capturing-container-logs')]:
        if phrase in lower: result['category'] = category; break
    if 'connection refused' in lower:
        result['endpoint_origins'] = endpoints(line)
    return result


def config_summary(document):
    """Allowlist facts only. Sinks' headers/auth/query parameters are never returned."""
    if not isinstance(document, dict): return None
    output = {'sections': [k for k in ('api', 'sources', 'sinks', 'transforms', 'data_dir') if k in document]}
    if isinstance(document.get('api'), dict):
        api = document['api']
        output['api'] = {'enabled': api.get('enabled') if isinstance(api.get('enabled'), bool) else None}
        address = api.get('address')
        if isinstance(address, str) and re.fullmatch(r'(?:127\.0\.0\.1|0\.0\.0\.0):\d{2,5}', address):
            output['api']['address'] = address
    output['sources'] = []
    for value in document.get('sources', {}).values():
        if not isinstance(value, dict): continue
        source = {'type': value.get('type') if value.get('type') in ('docker_logs', 'internal_logs', 'internal_metrics', 'file') else 'other'}
        for key in ('docker_host', 'host', 'endpoint'):
            if isinstance(value.get(key), str): source[key + '_origins'] = endpoints(value[key])
        source['explicit_docker_host_present'] = 'docker_host' in value
        for key in ('include_containers', 'exclude_containers'):
            if isinstance(value.get(key), list):
                source[key] = [v for v in value[key] if isinstance(v, str) and re.fullmatch(r'supabase_[a-z0-9_]+_school-queue-local', v)]
        output['sources'].append(source)
    output['sinks'] = []
    for value in document.get('sinks', {}).values():
        if not isinstance(value, dict): continue
        output['sinks'].append({'type': value.get('type') if value.get('type') in ('http', 'console', 'blackhole') else 'other',
                                'uri_origins': endpoints(value.get('uri', '')) if isinstance(value.get('uri', ''), str) else [],
                                'auth_or_headers_present': any(k in value for k in ('auth', 'headers'))})
    return output


def restricted_yaml_summary(content):
    """Inspect only plain top-level/indent-2/indent-4 fields, without a YAML dependency.

    This is not a general YAML parser or configuration validator. Vector's actual
    successful startup supplies separate evidence that its configuration parsed.
    """
    document = {}; section = None; component = None
    for line in content.decode('utf-8', 'strict').splitlines():
        top = re.fullmatch(r'([a-z_]+):\s*(?:#.*)?', line)
        if top:
            section = top[1]; component = None
            if section in ('api', 'sources', 'sinks'): document[section] = {}
            continue
        if section not in ('api', 'sources', 'sinks'): continue
        if section in ('sources', 'sinks'):
            sub = re.fullmatch(r'  ([a-zA-Z0-9_-]+):\s*(?:#.*)?', line)
            if sub:
                component = sub[1]; document[section][component] = {}; continue
            field = re.fullmatch(r'    (type|docker_host|host|endpoint|uri):\s*(.*?)\s*', line)
            if field and component is not None:
                document[section][component][field[1]] = field[2].strip('"\'')
        else:
            field = re.fullmatch(r'  (enabled|address):\s*(.*?)\s*', line)
            if field:
                value = field[2].strip('"\'')
                document['api'][field[1]] = (value == 'true') if field[1] == 'enabled' and value in ('true', 'false') else value
    summary = config_summary(document)
    for sink in summary['sinks']:
        # Nested auth/request headers were deliberately not parsed. Do not
        # misrepresent an omitted field as evidence that headers are absent.
        sink.pop('auth_or_headers_present', None)
    return {'inspection': 'restricted-plain-field-summary-not-full-YAML-parse',
            'auth_and_headers': 'not-inspected-values-omitted', 'summary': summary}


def main():
    run_id = uuid.uuid4().hex[:8]
    path = base.ROOT / f'supabase/tests/results/vector_startup_inspection_{run_id}.json'
    record = {'mode': 'READ_ONLY_STARTUP_INSPECTION', 'captured_at': datetime.now(timezone.utc).isoformat(),
              'raw_config_or_logs_saved': False, 'google_credentials_accessed': False, 'mutations_executed': False}
    try:
        frozen = base.immutable_inputs()
        credential_before = base.credential_metadata()
        resource_before = base.resource_inventory()
        backup_before = base.gate.recovery.tree_summary(base.gate.recovery.historical_files(base.backup.BACKUPS / '__none__'))
        vector = base.read_json(['docker', 'inspect', base.VECTOR])[0]
        base.validate_vector(vector)
        record['vector'] = base.state(vector)
        entrypoint = vector['Config'].get('Entrypoint') or []
        command = vector['Config'].get('Cmd') or []
        command_text = '\n'.join(command)
        env = dict(e.split('=', 1) for e in vector['Config']['Env'])
        record['docker_transport_environment'] = {
            'docker_host_present': bool(env.get('DOCKER_HOST')),
            'docker_host_origins': endpoints(env.get('DOCKER_HOST', '')),
            'tls_verify_present': bool(env.get('DOCKER_TLS_VERIFY')),
            'certificate_path_present': bool(env.get('DOCKER_CERT_PATH')),
            'api_version_present': bool(env.get('DOCKER_API_VERSION')),
        }
        known_tokens = {'-c', '-lc', 'sh', '/bin/sh', 'vector', '/usr/local/bin/vector', '--config', '--config-yaml', '--config-json',
                        '/dev/stdin', 'echo', 'printf', '%s', '|', 'base64', '-d', 'exec', '-q'}
        try: tokens = shlex.split(command_text)
        except ValueError: tokens = []
        record['command_structure'] = {
            'entrypoint': [v if v in known_tokens else 'other-token-suppressed' for v in entrypoint],
            'argument_count': len(command), 'shell_token_count': len(tokens),
            'known_tokens': [v for v in tokens if v in known_tokens],
            'contains_inline_base64': 'base64' in tokens, 'endpoint_origins': endpoints(command_text),
            'config_paths': sorted(set(re.findall(r'(?:/etc/vector|/tmp)/[a-zA-Z0-9_.-]+\.(?:ya?ml|toml|json)', command_text))),
        }
        code, stdout, stderr = base.run(['docker', 'logs', '--timestamps', '--since', '10m', '--tail', '100', base.VECTOR])
        base.require(code == 0, 'VECTOR_LOG_REFINEMENT')
        record['recent_events'] = [log_refinement(line) for line in (stdout + '\n' + stderr).splitlines() if line.strip()]
        docs = []
        for token in tokens:
            if token.lstrip().startswith('{'):
                try:
                    value = json.loads(token)
                    if isinstance(value, dict) and ('sources' in value or 'sinks' in value): docs.append(('inline-json', value))
                except (ValueError, TypeError): pass
        record['yaml_parser_available'] = importlib.util.find_spec('yaml') is not None
        if record['yaml_parser_available']:
            import yaml
            for token in tokens:
                if 'sources:' in token and ('sinks:' in token or 'transforms:' in token):
                    try:
                        value = yaml.safe_load(token)
                        if isinstance(value, dict) and 'sources' in value: docs.append(('inline-yaml', value))
                    except Exception: pass
        record['inline_documents'] = [{'kind': kind, 'summary': config_summary(value)} for kind, value in docs]
        record['config_file_inspections'] = []
        for file in record['command_structure']['config_paths'][:3]:
            result = base.run(['docker', 'cp', base.VECTOR + ':' + file, '-'], binary=True)
            observation = {'path': file, 'copy_exit_code': result.returncode}
            if result.returncode == 0:
                with tarfile.open(fileobj=io.BytesIO(result.stdout), mode='r:*') as archive:
                    members = [m for m in archive if m.isfile() and m.size <= 1024 * 1024]
                    base.require(len(members) == 1, 'VECTOR_CONFIG_ARCHIVE')
                    content = archive.extractfile(members[0]).read()
                    observation.update(bytes=len(content), sha256=hashlib.sha256(content).hexdigest(),
                                       mode=oct(members[0].mode), uid=members[0].uid, gid=members[0].gid,
                                       endpoint_origins=endpoints(content.decode('utf-8', 'replace')))
                    if file.endswith('.json'):
                        try: observation['summary'] = config_summary(json.loads(content))
                        except ValueError: observation['parse'] = 'invalid-json'
                    elif file.endswith(('.yml', '.yaml')) and record['yaml_parser_available']:
                        try: observation['summary'] = config_summary(yaml.safe_load(content))
                        except Exception: observation['parse'] = 'invalid-yaml'
                    elif file.endswith(('.yml', '.yaml')):
                        observation['plain_field_inspection'] = restricted_yaml_summary(content)
            record['config_file_inspections'].append(observation)
        record['source_final'] = base.gate.check()
        vector_after = base.read_json(['docker', 'inspect', base.VECTOR])[0]
        base.validate_vector(vector_after)
        base.require(vector_after['Id'] == vector['Id'] and vector_after['Config'] == vector['Config'] and
                     vector_after['HostConfig'] == vector['HostConfig'] and vector_after['Mounts'] == vector['Mounts'], 'VECTOR_DEFINITION_CHANGED')
        base.require(base.credential_metadata() == credential_before, 'VECTOR_CREDENTIAL_METADATA_CHANGED')
        base.require(base.resource_inventory() == resource_before, 'VECTOR_RESOURCE_INVENTORY_CHANGED')
        base.require(base.gate.recovery.tree_summary(base.gate.recovery.historical_files(base.backup.BACKUPS / '__none__')) == backup_before,
                     'VECTOR_BACKUPS_CHANGED')
        base.require(all(base.backup.file_sha256(base.ROOT / p) == h for p, h in frozen.items()), 'VECTOR_HISTORICAL_INPUT_CHANGED')
        initial = json.loads((base.ROOT / 'supabase/tests/results/vector_health_diagnosis_cf7c44d1.json').read_text())
        stable_before = {s['container']: s for s in initial['containers_before'] if s['container'] != base.VECTOR}
        stable_after = {s['container']: s for s in map(base.state, base.project_items()) if s['container'] != base.VECTOR}
        base.require(stable_before == stable_after, 'VECTOR_OTHER_SERVICE_CHANGED')
        record.update(vector_final=base.state(vector_after), credential_metadata_unchanged=True,
                      resources_unchanged=True, backups_unchanged=backup_before, historical_inputs_unchanged=len(frozen),
                      other_eleven_containers_unchanged=True)
        record['result'] = 'READ_ONLY_INSPECTION_COMPLETE'
    except Exception as error:
        message = str(error)
        record.update(result='FAIL_STOPPED', code=message if re.fullmatch(r'VECTOR_[A-Z_]+', message) else 'VECTOR_STARTUP_INSPECTION_STOPPED')
    with path.open('x', encoding='utf-8') as handle:
        json.dump(record, handle, indent=2); handle.write('\n')
    print(json.dumps({'result': record['result'], 'evidence': str(path.relative_to(base.ROOT)),
                      'command_structure': record.get('command_structure'), 'yaml_parser_available': record.get('yaml_parser_available'),
                      'inline_documents': record.get('inline_documents'), 'config_files': record.get('config_file_inspections')}, indent=2))
    return 0 if record['result'] == 'READ_ONLY_INSPECTION_COMPLETE' else 1


if __name__ == '__main__': sys.exit(main())
