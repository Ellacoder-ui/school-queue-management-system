"""Step 22.8A read-only Vector diagnosis. No restart/repair/credential access path.

Raw container environments and logs stay in process memory. Evidence consists of
fixed categories, numeric observations and allowlisted local infrastructure fields.
"""
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import uuid

import google_credential_preflight as gate

ROOT = gate.ROOT
backup = gate.recovery.backup
PROJECT = 'school-queue-local'
VECTOR = 'supabase_vector_' + PROJECT
ANALYTICS = 'supabase_analytics_' + PROJECT
NETWORK = 'supabase_network_' + PROJECT
IMAGE = 'public.ecr.aws/supabase/vector:0.58.0-alpine'
IMAGE_ID = 'sha256:5dcf67db0ee378caa87f3395cb9484ebe3e97bb0334d119f2ac33116e00c5773'


def require(condition, code):
    if not condition: raise RuntimeError(code)


def run(args, *, timeout=30, binary=False):
    require(args[0] == 'docker' and args[1] in ('inspect', 'logs', 'version', 'info', 'stats', 'events', 'network', 'volume', 'ps', 'cp'), 'VECTOR_READ_ONLY_COMMAND')
    if args[1] in ('network', 'volume'): require(args[2] in ('inspect', 'ls'), 'VECTOR_READ_ONLY_COMMAND')
    if args[1] == 'cp': require(len(args) == 4 and args[2].startswith(VECTOR + ':/') and args[3] == '-', 'VECTOR_COPY_DIRECTION')
    result = subprocess.run(args, cwd=ROOT, env=backup.clean_env(), capture_output=True, timeout=timeout)
    require(len(result.stdout) + len(result.stderr) <= 3 * 1024 * 1024, 'VECTOR_OUTPUT_LIMIT')
    return result if binary else (result.returncode, result.stdout.decode('utf-8', 'replace'), result.stderr.decode('utf-8', 'replace'))


def read_json(args):
    code, stdout, _ = run(args)
    require(code == 0, 'VECTOR_READ_ONLY_QUERY_FAILED')
    return json.loads(stdout)


def sanitize_log(line):
    """Never return arbitrary log text, URLs, identifiers, bodies or quoted values."""
    event = {}
    stamp = re.match(r'^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z)', line)
    if stamp: event['timestamp'] = stamp[1]
    lower = line.lower()
    old = re.search(r'client version\s+(\d+\.\d+).*?too old.*?minimum supported api version is\s+(\d+\.\d+)', line, re.I)
    if old:
        event.update(category='docker-api-client-too-old', client_api=old[1], minimum_api=old[2])
    elif 'permission denied' in lower: event['category'] = 'permission-denied'
    elif 'connection refused' in lower: event['category'] = 'connection-refused'
    elif 'no such file or directory' in lower: event['category'] = 'file-missing'
    elif 'out of memory' in lower or 'cannot allocate memory' in lower: event['category'] = 'allocation-failed'
    elif 'configuration error' in lower or 'configuration errors' in lower: event['category'] = 'configuration-error'
    elif 'unknown field' in lower: event['category'] = 'unknown-configuration-field'
    elif 'missing field' in lower: event['category'] = 'missing-configuration-field'
    elif 'failed to parse' in lower or 'parse error' in lower: event['category'] = 'parse-error'
    elif 'healthcheck' in lower and ('fail' in lower or 'error' in lower): event['category'] = 'component-healthcheck-failed'
    elif 'healthcheck' in lower and 'pass' in lower: event['category'] = 'component-healthcheck-passed'
    elif 'docker' in lower and ('error' in lower or 'fail' in lower): event['category'] = 'docker-source-error'
    elif 'error' in lower: event['category'] = 'unclassified-error-text-suppressed'
    elif 'warn' in lower: event['category'] = 'unclassified-warning-text-suppressed'
    else: event['category'] = 'other-text-suppressed'
    # Fixed Vector diagnostics only; never copy a user-controlled component ID.
    for component in ('docker_logs', 'logflare', 'supabase_logs'):
        if re.search(r'\b' + component + r'\b', lower): event['component_category'] = component
    return event


def safe_health_definition(health):
    test = health.get('Test', [])
    # Validate the whole command before allowing this known local health probe.
    joined = ' '.join(test)
    allowed = re.fullmatch(r'CMD(?:-SHELL)? (?:wget (?:(?:--no-verbose|--tries=1|--spider|-q|-O -) )*|curl (?:(?:-f|-s|-S|--fail|--silent) )*)'
                           r'http://(?:127\.0\.0\.1|localhost|0\.0\.0\.0):\d{2,5}/health', joined)
    return {'test': test if allowed else 'unrecognized-test-suppressed',
            **{k: health.get(k) for k in ('Interval', 'Timeout', 'StartPeriod', 'Retries')}}


def state(item):
    s = item['State']
    return {'container': item['Name'][1:], 'id': item['Id'], 'image': item['Config']['Image'], 'image_id': item['Image'],
            'running': s['Running'], 'restarting': s['Restarting'], 'status': s['Status'],
            'exit_code': s['ExitCode'], 'oom_killed': s['OOMKilled'], 'restart_count': item['RestartCount'],
            'started_at': s['StartedAt'], 'finished_at': s['FinishedAt'],
            'health': s.get('Health', {}).get('Status', 'not-configured')}


def project_items():
    code, stdout, _ = run(['docker', 'ps', '-a', '--filter', 'label=com.supabase.cli.project=' + PROJECT, '--format', '{{.Names}}'])
    require(code == 0, 'VECTOR_PROJECT_LIST')
    names = sorted(stdout.splitlines())
    require(names and VECTOR in names and ANALYTICS in names and all(re.fullmatch(r'supabase_[a-z0-9_]+_' + PROJECT, n) for n in names), 'VECTOR_PROJECT_NAMES')
    return read_json(['docker', 'inspect', *names])


def validate_vector(item):
    require(item['Name'] == '/' + VECTOR and item['Config']['Image'] == IMAGE and item['Image'] == IMAGE_ID, 'VECTOR_IDENTITY_MISMATCH')
    labels = item['Config']['Labels']
    require(labels.get('com.supabase.cli.project') == PROJECT and sorted(item['NetworkSettings']['Networks']) == [NETWORK], 'VECTOR_LABEL_NETWORK_MISMATCH')
    for m in item['Mounts']:
        require(m.get('Name') != 'supabase_db_' + PROJECT and '.local-secrets' not in m.get('Source', '').lower(), 'VECTOR_UNEXPECTED_SENSITIVE_MOUNT')
    require(not item['HostConfig']['Privileged'], 'VECTOR_PRIVILEGED_MISMATCH')


def credential_metadata():
    # Metadata only. Never open, hash, decrypt or import the protected credential.
    p = ROOT / '.local-secrets/google-local.dpapi'
    s = p.stat()
    return (s.st_size, s.st_mtime_ns, s.st_ctime_ns, getattr(s, 'st_file_attributes', 0))


def immutable_inputs():
    files = list((ROOT / 'supabase').glob('*.md')) + list((ROOT / 'supabase/tests/results').glob('*.json'))
    files += list((ROOT / 'scripts').glob('*LocalGoogle*'))
    files += [ROOT / 'supabase/tests/google_activation_workflow.py', ROOT / 'supabase/config.toml', ROOT / '.gitignore']
    files += list((ROOT / 'supabase/migrations').glob('*.sql'))
    files += [p for p in (ROOT / 'src').rglob('*') if p.is_file()]
    return {str(p.relative_to(ROOT)): backup.file_sha256(p) for p in files if p.is_file()}


def resource_inventory():
    result = {}
    for kind, args in [('containers', ['docker', 'ps', '-aq']), ('volumes', ['docker', 'volume', 'ls', '-q']),
                       ('networks', ['docker', 'network', 'ls', '-q'])]:
        code, stdout, _ = run(args); require(code == 0, 'VECTOR_RESOURCE_INVENTORY')
        result[kind] = sorted(stdout.splitlines())
    return hashlib.sha256(json.dumps(result, sort_keys=True).encode()).hexdigest()


def main():
    run_id = uuid.uuid4().hex[:8]
    path = ROOT / f'supabase/tests/results/vector_health_diagnosis_{run_id}.json'
    record = {'result': 'IN_PROGRESS', 'phase': 'target-preflight', 'run_id': run_id,
              'started_at': datetime.now(timezone.utc).isoformat(), 'read_only': True,
              'restart_repair_activation_executed': False, 'google_credential_contents_accessed': False}
    frozen = immutable_inputs()
    require(not path.exists(), 'VECTOR_EVIDENCE_EXISTS')
    def save(): backup.write_json(path, record)
    save()
    try:
        record['source_before'] = gate.check()
        credential_before = credential_metadata()
        tree_before = gate.recovery.tree_summary(gate.recovery.historical_files(backup.BACKUPS / '__none__'))
        resources_before = resource_inventory()
        items = project_items()
        vector = next(x for x in items if x['Name'] == '/' + VECTOR)
        validate_vector(vector)
        record['containers_before'] = [state(x) for x in items]
        record['vector_identity'] = {'labels': {k: v for k, v in vector['Config']['Labels'].items()
                                                if k in ('com.supabase.cli.project', 'com.supabase.cli.workdir', 'com.docker.compose.project')},
                                     'network_names': sorted(vector['NetworkSettings']['Networks']),
                                     'mounts': [{k: m.get(k) for k in ('Type', 'Name', 'Source', 'Destination', 'RW')} for m in vector['Mounts']],
                                     'restart_policy': vector['HostConfig']['RestartPolicy'],
                                     'entrypoint_program': (vector['Config'].get('Entrypoint') or [None])[0],
                                     'command_sha256': hashlib.sha256(json.dumps(vector['Config'].get('Cmd')).encode()).hexdigest()}
        record['health_definition'] = safe_health_definition(vector['Config'].get('Healthcheck', {}))
        record['health_results'] = [{'start': r['Start'], 'end': r['End'], 'exit_code': r['ExitCode'],
                                     'output': sanitize_log(r.get('Output', ''))} for r in vector['State'].get('Health', {}).get('Log', [])]
        env = dict(e.split('=', 1) for e in vector['Config']['Env'])
        record['docker_environment'] = {k: v for k, v in env.items() if
            (k == 'DOCKER_API_VERSION' and re.fullmatch(r'\d+\.\d+', v)) or
            (k == 'DOCKER_HOST' and v == 'unix:///var/run/docker.sock') or
            (k == 'VECTOR_LOG' and v in ('info', 'warn', 'error', 'debug', 'trace')) or
            (k == 'VECTOR_CONFIG' and re.fullmatch(r'/etc/vector/[a-z0-9_.-]+', v))}
        record['phase'] = 'bounded-sanitized-diagnostics'; save()
        code, stdout, stderr = run(['docker', 'logs', '--timestamps', '--since', '20m', '--tail', '120', VECTOR])
        require(code == 0, 'VECTOR_BOUNDED_LOGS')
        lines = (stdout + '\n' + stderr).splitlines()
        record['recent_logs'] = {'requested_tail': 120, 'requested_since': '20m', 'lines': len(lines),
                                 'events': [sanitize_log(line) for line in lines if line.strip()]}
        server = read_json(['docker', 'version', '--format', '{{json .Server}}'])
        record['docker_server'] = {k: server.get(k) for k in ('Version', 'ApiVersion', 'MinAPIVersion', 'Os', 'Arch')}
        info = read_json(['docker', 'info', '--format', '{{json .}}'])
        record['docker_resources'] = {k: info.get(k) for k in ('NCPU', 'MemTotal', 'OSType', 'OperatingSystem')}
        record['vector_limits'] = {k: vector['HostConfig'].get(k) for k in ('Memory', 'MemorySwap', 'NanoCpus', 'CpuPeriod', 'CpuQuota', 'PidsLimit', 'OomKillDisable')}
        until = datetime.now(timezone.utc); since = until - timedelta(minutes=20)
        code, stdout, _ = run(['docker', 'events', '--since', since.isoformat(), '--until', until.isoformat(),
                              '--filter', 'container=' + vector['Id'], '--format', '{{json .}}'])
        events = []
        if code == 0:
            for line in stdout.splitlines():
                e = json.loads(line); action = e.get('Action', '')
                if action in ('start', 'die', 'restart', 'oom', 'health_status: unhealthy', 'health_status: healthy'):
                    raw_exit = e.get('Actor', {}).get('Attributes', {}).get('exitCode')
                    events.append({'action': action, 'time': e.get('time'),
                                   'exit_code': int(raw_exit) if raw_exit is not None and str(raw_exit).isdigit() else None})
        record['recent_docker_events'] = {'window_minutes': 20, 'query_exit_code': code, 'events': events[-200:],
                                          'complete_lifetime_history': False}
        code, stdout, _ = run(['docker', 'stats', '--no-stream', '--format', '{{json .}}', VECTOR, ANALYTICS], timeout=20)
        stats = []
        if code == 0:
            for line in stdout.splitlines():
                s = json.loads(line)
                stats.append({k: v for k, v in s.items() if k in ('Name', 'CPUPerc', 'MemUsage', 'MemPerc', 'PIDs')})
        record['stats'] = {'exit_code': code, 'samples': stats}
        record['phase'] = 'final-preservation'; save()
        record['source_after'] = gate.check()
        after = project_items()
        after_vector = next(x for x in after if x['Name'] == '/' + VECTOR)
        validate_vector(after_vector)
        require(after_vector['Id'] == vector['Id'] and after_vector['Mounts'] == vector['Mounts'] and
                after_vector['HostConfig'] == vector['HostConfig'] and after_vector['Config'] == vector['Config'], 'VECTOR_CONFIGURATION_CHANGED')
        before_stable = [state(x) for x in items if x['Name'] != '/' + VECTOR]
        after_stable = [state(x) for x in after if x['Name'] != '/' + VECTOR]
        require(before_stable == after_stable, 'VECTOR_OTHER_SERVICE_CHANGED')
        require(resource_inventory() == resources_before, 'VECTOR_DOCKER_RESOURCES_CHANGED')
        require(credential_metadata() == credential_before, 'VECTOR_CREDENTIAL_METADATA_CHANGED')
        require(gate.recovery.tree_summary(gate.recovery.historical_files(backup.BACKUPS / '__none__')) == tree_before, 'VECTOR_BACKUP_CHANGED')
        require(all(backup.file_sha256(ROOT / p) == h for p, h in frozen.items()), 'VECTOR_HISTORICAL_INPUT_CHANGED')
        record.update(result='READ_ONLY_DIAGNOSIS_COMPLETE', phase='complete', completed_at=datetime.now(timezone.utc).isoformat(),
                      vector_after=state(after_vector), vector_configuration_unchanged=True, other_containers_unchanged=True,
                      docker_resource_inventory_unchanged=True, google_credential_metadata_unchanged=True,
                      historical_inputs_unchanged=len(frozen), all_backup_files_unchanged=tree_before)
        save()
        print(json.dumps({'result': record['result'], 'run_id': run_id, 'evidence': str(path.relative_to(ROOT)),
                          'log_categories': sorted(set(e['category'] for e in record['recent_logs']['events'])),
                          'vector_exit_code': record['vector_after']['exit_code']}, indent=2))
        return 0
    except Exception as error:
        code = str(error)
        record.update(result='FAIL_STOPPED', failure=code if re.fullmatch(r'VECTOR_[A-Z_]+', code) else 'VECTOR_DIAGNOSIS_STOPPED')
        save(); print(json.dumps({'result': record['result'], 'phase': record['phase'], 'failure': record['failure'],
                                 'evidence': str(path.relative_to(ROOT))})); return 1


if __name__ == '__main__': sys.exit(main())
