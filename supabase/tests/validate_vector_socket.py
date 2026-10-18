"""Step 22.8B: owned disposable containers only; no retained mutation entry point.

The real socket probe is fixed to GET /_ping and GET /version. Vector only sees a
separate synthetic Unix socket, never the real daemon. Raw retained definitions,
YAML, environment and logs remain in memory. No Google credential content access.
"""
from datetime import datetime, timezone
import argparse
import hashlib
import io
import json
import re
import shlex
import subprocess
import sys
import tarfile
import time
import uuid

import diagnose_vector_health as base

ROOT = base.ROOT
VECTOR_ID = 'b6d521af4f244e0ab8ede06130d31bf067e9483ed1dd920544759b607cc9bc59'
YAML_SHA = 'ce74949a121530bdc91c43ec327b6e0bf746d2acf76b1548385ece2da3a2e1e8'
NODE_IMAGE = 'sha256:145325b7e39f8ef4931d6e8cfd3f6f4d655de09d72a2ccc96d9513542c2202bd'
LABEL = 'school-queue.vector-socket-experiment'


def require(value, code):
    if not value:
        raise RuntimeError(code)


def owned_names(run_id):
    require(re.fullmatch('[0-9a-f]{8}', run_id), 'VST_RUN_ID')
    prefix = 'sq-vector-socket-' + run_id
    return {k: prefix + '-' + k for k in ('probe', 'fixture', 'vector', 'socket')}


def image_guard(item, expected):
    require(item['Id'] == expected and not item['Config'].get('Volumes'), 'VST_CACHED_IMAGE')


def client_api_evidence(summary):
    versions = summary['client_versions']
    unversioned = summary['unversioned_requests']
    total = sum(summary['counts'][key] for key in ('ping', 'version', 'list', 'inspect', 'events', 'logs'))
    require(isinstance(unversioned, int) and 0 <= unversioned <= total and total >= 4, 'VST_CLIENT_API_VERSION')
    require(all(re.fullmatch(r'1\.\d+', value) and 40 <= int(value.split('.')[1]) <= 56 for value in versions), 'VST_CLIENT_API_VERSION')
    # Unversioned requests use the daemon's current API. Never invent evidence
    # that this image negotiated a numbered version when it sent no prefix.
    require(bool(versions) or unversioned == total, 'VST_CLIENT_API_VERSION')
    return {'numbered_versions': versions, 'unversioned_requests': unversioned,
            'api_negotiation_tested': False}


def vector_config_hash():
    result = base.run(['docker', 'cp', base.VECTOR + ':/etc/vector/vector.yaml', '-'], binary=True)
    require(result.returncode == 0, 'VST_VECTOR_CONFIG_READ')
    with tarfile.open(fileobj=io.BytesIO(result.stdout)) as archive:
        members = archive.getmembers()
        require(len(members) == 1 and members[0].isfile() and members[0].size == 7631, 'VST_VECTOR_CONFIG_FILE')
        value = hashlib.sha256(archive.extractfile(members[0]).read()).hexdigest()
    require(value == YAML_SHA, 'VST_VECTOR_CONFIG_HASH')
    return value


def unchanged_retained(before, after):
    require(len(before) == len(after) == 12, 'VST_SERVICE_COUNT')
    a = {x['Name']: x for x in before}; b = {x['Name']: x for x in after}
    require(a.keys() == b.keys(), 'VST_SERVICE_SET')
    for name, old in a.items():
        new = b[name]
        # Full definitions and identities, not only hashes selected for a report.
        for field in ('Id', 'Config', 'HostConfig', 'Mounts', 'Image'):
            require(old[field] == new[field], 'VST_RETAINED_DEFINITION_CHANGED')
        require(old['NetworkSettings']['Networks'] == new['NetworkSettings']['Networks'], 'VST_RETAINED_NETWORK_CHANGED')
        if name != '/' + base.VECTOR:
            require(base.state(old) == base.state(new), 'VST_OTHER_SERVICE_LIFECYCLE_CHANGED')


def resources():
    result = {}
    for kind, args in [('containers', ['docker', 'ps', '-aq', '--no-trunc']),
                       ('volumes', ['docker', 'volume', 'ls', '-q']), ('networks', ['docker', 'network', 'ls', '--no-trunc', '-q'])]:
        code, out, _ = base.run(args)
        require(code == 0, 'VST_RESOURCE_LIST')
        result[kind] = sorted(out.splitlines())
    return result


def validate_resource_delta(before, after, ids, volume):
    require(set(after['containers']) == set(before['containers']) | set(ids), 'VST_UNEXPECTED_CONTAINER_DELTA')
    require(set(after['volumes']) == set(before['volumes']) | ({volume} if volume else set()), 'VST_UNEXPECTED_VOLUME_DELTA')
    require(before['networks'] == after['networks'], 'VST_UNEXPECTED_NETWORK_DELTA')


def assert_locks():
    import google_activation_workflow as activation
    require(activation.ACTIVATION_IMPLEMENTATION_CERTIFIED is False, 'VST_ACTIVATION_LOCK')
    text = (ROOT / 'scripts/LocalGoogleActivation.ps1').read_text(encoding='utf-8')
    function = text.split('function Invoke-LocalGoogleAuthActivation(', 1)[1]
    require(function.index("Stop-LCG 'LGA_REHEARSAL_NOT_CERTIFIED'") < function.index('Assert-LGAProtection'), 'VST_POWERSHELL_LOCK')


class Experiment:
    def __init__(self):
        self.id = uuid.uuid4().hex[:8]
        self.names = owned_names(self.id)
        self.ids = {}
        self.volume_created = False
        self.path = ROOT / f'supabase/tests/results/vector_socket_validation_{self.id}.json'
        require(not self.path.exists(), 'VST_EVIDENCE_EXISTS')
        self.record = {'result': 'IN_PROGRESS', 'phase': 'read-only-preflight', 'run_id': self.id,
                       'started_at': datetime.now(timezone.utc).isoformat(),
                       'retained_mutation_executed': False, 'google_credential_contents_accessed': False}
        self.frozen = base.immutable_inputs()
        for name in ('validate_vector_socket.py', 'vector_socket_fixture.mjs', 'vector_socket_fixture.test.mjs', 'test_vector_socket.py'):
            path = ROOT / 'supabase/tests' / name
            self.frozen[str(path.relative_to(ROOT))] = base.backup.file_sha256(path)
        self.save()

    def save(self):
        base.backup.write_json(self.path, self.record)

    def command(self, args, data=None, timeout=30, include_stderr=False):
        # Private executor. All mutations below use fixed recipes and identity-
        # checked IDs; there is no arbitrary command argument on the public CLI.
        env = base.backup.clean_env()
        require(not any(env.get(k) for k in ('DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH')), 'VST_AMBIENT_DOCKER_OVERRIDE')
        result = subprocess.run(['docker', *args], input=data, capture_output=True, timeout=timeout, cwd=ROOT, env=env)
        require(len(result.stdout) + len(result.stderr) < 3 * 1024 * 1024, 'VST_OUTPUT_LIMIT')
        if result.returncode != 0:
            self.record['failed_owned_operation'] = args[0] if args[0] in ('create', 'cp', 'start', 'wait', 'logs', 'inspect', 'stop', 'volume') else 'other'
            raise RuntimeError('VST_DISPOSABLE_COMMAND_FAILED')
        return result.stdout + (result.stderr if include_stderr else b'')

    def inspect_owned(self, kind):
        require(kind in self.ids, 'VST_NOT_OWNED')
        item = json.loads(self.command(['inspect', self.ids[kind]]))[0]
        require(item['Id'] == self.ids[kind] and item['Name'] == '/' + self.names[kind], 'VST_OWNED_ID')
        require(item['Config']['Labels'].get(LABEL) == self.id, 'VST_OWNED_LABEL')
        require(not item['HostConfig']['Privileged'] and item['HostConfig']['NetworkMode'] == 'none', 'VST_OWNED_ISOLATION')
        require(item['HostConfig']['ReadonlyRootfs'] and item['HostConfig']['CapDrop'] == ['ALL'] and
                'no-new-privileges' in item['HostConfig']['SecurityOpt'], 'VST_OWNED_HARDENING')
        require(not item['HostConfig'].get('PortBindings') and not item['HostConfig'].get('VolumesFrom'), 'VST_OWNED_PORTS')
        expected = NODE_IMAGE if kind in ('probe', 'fixture') else base.IMAGE_ID
        require(item['Image'] == expected, 'VST_OWNED_IMAGE')
        mounts = item['Mounts']
        require(len(mounts) == 1, 'VST_OWNED_MOUNTS')
        mount = mounts[0]
        if kind == 'probe':
            require(mount['Type'] == 'bind' and mount['Source'] == mount['Destination'] == '/var/run/docker.sock' and not mount['RW'], 'VST_PROBE_MOUNT')
        else:
            require(mount['Type'] == 'volume' and mount['Name'] == self.names['socket'] and mount['Destination'] == '/experiment', 'VST_FIXTURE_MOUNT')
            require(mount['RW'] == (kind == 'fixture'), 'VST_SOCKET_VOLUME_MODE')
        return item

    def create(self, kind):
        require(kind in ('probe', 'fixture', 'vector') and kind not in self.ids, 'VST_CREATE_KIND')
        # Missing images fail; daemon is never asked to pull.
        image = NODE_IMAGE if kind in ('probe', 'fixture') else base.IMAGE_ID
        args = ['create', '--pull=never', '--name', self.names[kind], '--label', LABEL + '=' + self.id,
                '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
                '--restart', 'no', '--pids-limit', '64', '--memory', '256m', '--cpus', '1',
                '--tmpfs', '/tmp:rw,noexec,nosuid,size=16777216']
        if kind == 'probe':
            args += ['--mount', 'type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock,readonly']
        else:
            require(self.volume_created, 'VST_SOCKET_VOLUME_MISSING')
            args += ['--mount', 'type=volume,src=' + self.names['socket'] + ',dst=/experiment' + (',readonly' if kind == 'vector' else '')]
        if kind == 'vector':
            config = {'data_dir': '/tmp/vector', 'api': {'enabled': True, 'address': '127.0.0.1:9001'},
                      'sources': {'synthetic': {'type': 'docker_logs', 'include_containers': ['disposable-synthetic-vector-source']}},
                      'sinks': {'synthetic_output': {'type': 'console', 'inputs': ['synthetic'], 'encoding': {'codec': 'json'}}}}
            startup = 'printf %s ' + shlex.quote(json.dumps(config)) + ' > /tmp/experiment-vector.json; exec /usr/local/bin/vector --config /tmp/experiment-vector.json'
            args += ['--env', 'DOCKER_HOST=unix:///experiment/docker.sock',
                     '--health-cmd', 'wget --no-verbose --tries=1 --spider http://127.0.0.1:9001/health',
                     '--health-interval', '10s', '--health-timeout', '2s', '--health-retries', '3',
                     '--entrypoint', '/bin/sh', image, '-ec', startup]
        else:
            # Public synthetic code only. No retained YAML/environment/credentials
            # are inserted into arguments. Root filesystem stays read-only.
            script = (ROOT / 'supabase/tests/vector_socket_fixture.mjs').read_text(encoding='utf-8')
            args += ['--entrypoint', '/usr/local/bin/node', image, '--input-type=module', '--eval', script, kind]
        identifier = self.command(args).decode().strip()
        require(re.fullmatch('[0-9a-f]{64}', identifier), 'VST_CREATED_ID')
        self.ids[kind] = identifier
        self.inspect_owned(kind)
        self.record['owned_containers'] = dict(self.ids)
        self.save()

    def start(self, kind):
        self.inspect_owned(kind)
        self.command(['start', self.ids[kind]])

    def stop(self, kind):
        item = self.inspect_owned(kind)
        if item['State']['Running']:
            self.command(['stop', '--timeout', '5', self.ids[kind]], timeout=15)

    def logs(self, kind):
        self.inspect_owned(kind)
        return self.command(['logs', '--tail', '100', self.ids[kind]], include_stderr=True).decode('utf-8', 'replace')

    def run(self):
        self.record['source_before'] = base.gate.check()
        self.credential_before = base.credential_metadata()
        self.backups_before = base.gate.recovery.tree_summary(base.gate.recovery.historical_files(base.backup.BACKUPS / '__none__'))
        self.before = base.project_items()
        vector = next(x for x in self.before if x['Name'] == '/' + base.VECTOR)
        base.validate_vector(vector)
        require(vector['Id'] == VECTOR_ID and not vector['Config'].get('User') and vector['Mounts'] == [], 'VST_RETAINED_VECTOR_ID')
        require('DOCKER_HOST=http://host.docker.internal:2375' in vector['Config']['Env'], 'VST_ORIGINAL_TRANSPORT')
        self.record['retained_before'] = [base.state(x) for x in self.before]
        self.record['retained_yaml_sha256'] = vector_config_hash()
        self.resources_before = resources()
        assert_locks()
        for image in (NODE_IMAGE, base.IMAGE_ID):
            image_guard(json.loads(self.command(['image', 'inspect', image]))[0], image)
        require(not any(name in self.resources_before['volumes'] for name in self.names.values()), 'VST_NAME_EXISTS')
        names = self.command(['ps', '-a', '--format', '{{.Names}}']).decode().splitlines()
        require(not set(self.names.values()) & set(names), 'VST_NAME_EXISTS')
        self.record['phase'] = 'fixed-real-socket-probe'; self.save()
        self.create('probe'); self.start('probe')
        self.command(['wait', self.ids['probe']], timeout=15)
        item = self.inspect_owned('probe')
        require(item['State']['ExitCode'] == 0, 'VST_REAL_SOCKET_PROBE_FAILED')
        probe = json.loads(self.logs('probe'))
        require(probe['result'] == 'PASS' and probe['socket'] and probe['uid'] == 0 and probe['requests'] == ['GET /_ping', 'GET /version'], 'VST_PROBE_RECEIPT')
        self.record['real_socket_probe'] = probe
        self.record['phase'] = 'isolated-synthetic-vector'; self.save()
        self.command(['volume', 'create', '--label', LABEL + '=' + self.id, self.names['socket']])
        self.volume_created = True
        self.create('fixture'); self.start('fixture')
        deadline = time.monotonic() + 10
        while '"fixture_ready":true' not in self.logs('fixture'):
            require(time.monotonic() < deadline, 'VST_FIXTURE_NOT_READY'); time.sleep(.5)
        self.create('vector'); self.start('vector')
        samples = []
        start = time.monotonic()
        while time.monotonic() - start < 45:
            current = self.inspect_owned('vector')
            require(current['State']['Running'] and current['RestartCount'] == 0, 'VST_VECTOR_STOPPED')
            samples.append({'elapsed_seconds': round(time.monotonic() - start, 1),
                            'health': current['State'].get('Health', {}).get('Status', 'starting')})
            print(json.dumps({'phase': 'synthetic-observation', 'elapsed_seconds': samples[-1]['elapsed_seconds'], 'health': samples[-1]['health']}), flush=True)
            time.sleep(5)
        require(samples[-1]['health'] == 'healthy', 'VST_HEALTH_NOT_READY')
        synthetic_count = 0
        vector_lines = self.logs('vector').splitlines()
        require(not any(re.search(r'\b(?:ERROR|WARN)\b', line) for line in vector_lines), 'VST_VECTOR_RUNTIME_DIAGNOSTIC')
        for line in vector_lines:
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if event.get('message') == 'VECTOR_SYNTHETIC_SOCKET_TEST':
                require(event.get('container_name') == 'disposable-synthetic-vector-source', 'VST_UNEXPECTED_LOG_EVENT')
                synthetic_count += 1
        require(synthetic_count >= 3, 'VST_SYNTHETIC_DELIVERY_MISSING')
        entries = [json.loads(x) for x in self.logs('fixture').splitlines()]
        summary = [x for x in entries if x.get('fixture_summary')][-1]
        require(summary['counts']['denied'] == 0 and all(summary['counts'][k] >= 1 for k in ('list', 'inspect', 'events', 'logs')), 'VST_FIXTURE_SCOPE')
        api_evidence = client_api_evidence(summary)
        self.record['synthetic_transport'] = {'result': 'PASS', 'duration_seconds': round(time.monotonic() - start, 1),
             'health_samples': samples, 'restart_count': 0, 'synthetic_events_received': synthetic_count,
             'fixture': summary, 'client_api': api_evidence, 'real_daemon_available_to_vector': False, 'retained_logs_collected': False,
             'runtime_uid': 0, 'fixture_socket_mode': '660', 'fixture_socket_owner_uid': 0}
        self.stop('vector'); self.stop('fixture')
        self.record['phase'] = 'final-preservation'; self.save()
        self.preservation()
        self.record.update(result='PASS', phase='complete', completed_at=datetime.now(timezone.utc).isoformat(),
                           retained_repair_executed=False, cli_recreation_persistence='BLOCKED_UNDER_CURRENT_WINDOWS_RECIPE')
        self.save()

    def preservation(self):
        self.record['source_after'] = base.gate.check()
        after = base.project_items()
        unchanged_retained(self.before, after)
        require(vector_config_hash() == YAML_SHA, 'VST_RETAINED_YAML_CHANGED')
        require(self.credential_before == base.credential_metadata(), 'VST_CREDENTIAL_METADATA_CHANGED')
        require(self.backups_before == base.gate.recovery.tree_summary(base.gate.recovery.historical_files(base.backup.BACKUPS / '__none__')), 'VST_BACKUPS_CHANGED')
        require(all(base.backup.file_sha256(ROOT / p) == digest for p, digest in self.frozen.items()), 'VST_INPUT_CHANGED')
        assert_locks()
        for kind in self.ids:
            require(not self.inspect_owned(kind)['State']['Running'], 'VST_OWNED_LEFT_RUNNING')
        validate_resource_delta(self.resources_before, resources(), list(self.ids.values()), self.names['socket'] if self.volume_created else None)
        self.record['retained_after'] = [base.state(x) for x in after]
        self.record['preservation'] = {'result': 'PASS', 'all_retained_definitions_unchanged': True,
              'other_eleven_lifecycles_unchanged': True, 'google_store_metadata_unchanged': True,
              'google_store_contents_accessed': False, 'historical_inputs_unchanged': len(self.frozen),
              'activation_locks_intact': True, 'all_backup_files': self.backups_before,
              'only_resource_delta': {'stopped_containers': dict(self.ids), 'retained_disposable_volume': self.names['socket'] if self.volume_created else None, 'new_networks': 0}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-disposable', required=True, action='store_true')
    parser.parse_args()
    experiment = Experiment()
    try:
        experiment.run()
    except Exception as error:
        code = str(error)
        experiment.record.update(result='FAIL_STOPPED', failure=code if re.fullmatch('VST_[A-Z_]+', code) else 'VST_SANITIZED_STOP')
        for kind in reversed(experiment.ids):
            try: experiment.stop(kind)
            except Exception: experiment.record['owned_cleanup_requires_review'] = True
        if 'fixture' in experiment.ids:
            try:
                lines = [json.loads(line) for line in experiment.logs('fixture').splitlines()]
                experiment.record['fixture_at_stop'] = [x for x in lines if x.get('fixture_summary')][-1]
            except Exception:
                experiment.record['fixture_diagnostics_unavailable'] = True
        # Always attempt final read-only preservation, including after test failure.
        if hasattr(experiment, 'before'):
            try:
                experiment.preservation()
            except Exception:
                experiment.record['final_preservation'] = 'FAIL_REQUIRES_REVIEW'
        experiment.save()
    print(json.dumps({'result': experiment.record['result'], 'run_id': experiment.id,
                      'phase': experiment.record['phase'], 'failure': experiment.record.get('failure'),
                      'evidence': str(experiment.path.relative_to(ROOT))}), flush=True)
    return 0 if experiment.record['result'] == 'PASS' else 1


if __name__ == '__main__':
    sys.exit(main())
