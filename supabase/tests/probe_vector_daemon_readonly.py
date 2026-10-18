"""Step 22.8D fixed disposable probe: two GETs, no retained service action.

Reuses the reviewed probe recipe and its exact ownership/isolation checks. The
public interface cannot select another mode, target, image or Docker endpoint.
"""
import argparse
from datetime import datetime, timezone
import json
import re
import sys
import uuid

import diagnose_vector_health as base
import validate_vector_socket as fences


class Probe(fences.Experiment):
    def __init__(self):
        self.id = uuid.uuid4().hex[:8]
        self.names = fences.owned_names(self.id)
        self.ids = {}
        self.volume_created = False
        self.path = base.ROOT / f'supabase/tests/results/vector_daemon_readonly_probe_{self.id}.json'
        fences.require(not self.path.exists(), 'VST_EVIDENCE_EXISTS')
        self.record = {'run_id': self.id, 'result': 'IN_PROGRESS', 'phase': 'read-only-preflight',
                       'started_at': datetime.now(timezone.utc).isoformat(), 'retained_mutation_executed': False,
                       'google_credential_contents_accessed': False, 'new_backup_or_restore': False}
        self.frozen = base.immutable_inputs()
        for name in ['probe_vector_daemon_readonly.py', 'validate_vector_socket.py', 'vector_socket_fixture.mjs']:
            p = base.ROOT / 'supabase/tests' / name
            self.frozen[p.relative_to(base.ROOT).as_posix()] = base.backup.file_sha256(p)
        self.save()

    def run(self):
        self.record['source_before'] = base.gate.check()
        self.credential_before = base.credential_metadata()
        self.backups_before = base.gate.recovery.tree_summary(base.gate.recovery.historical_files(base.backup.BACKUPS / '__none__'))
        self.before = base.project_items()
        vector = next(x for x in self.before if x['Name'] == '/' + base.VECTOR)
        base.validate_vector(vector)
        fences.require(vector['Id'] == fences.VECTOR_ID and not vector['Config'].get('User') and not vector['Mounts'], 'VST_VECTOR_IDENTITY')
        fences.require(fences.vector_config_hash() == fences.YAML_SHA, 'VST_VECTOR_CONFIG_HASH')
        self.record['retained_before'] = [base.state(x) for x in self.before]
        self.resources_before = fences.resources()
        fences.assert_locks()
        fences.image_guard(json.loads(self.command(['image', 'inspect', fences.NODE_IMAGE]))[0], fences.NODE_IMAGE)
        existing = self.command(['ps', '-a', '--format', '{{.Names}}']).decode().splitlines()
        fences.require(self.names['probe'] not in existing, 'VST_NAME_EXISTS')
        self.record['phase'] = 'fixed-probe'; self.save()
        self.create('probe')
        self.start('probe')
        self.command(['wait', self.ids['probe']], timeout=15)
        fences.require(self.inspect_owned('probe')['State']['ExitCode'] == 0, 'VST_REAL_SOCKET_PROBE_FAILED')
        value = json.loads(self.logs('probe'))
        fences.require(set(value) == {'result', 'socket', 'uid', 'mode', 'socket_uid', 'socket_gid', 'requests', 'engine', 'api', 'minimum_api'}, 'VST_PROBE_RECEIPT')
        fences.require(value['result'] == 'PASS' and value['socket'] and value['uid'] == 0 and
                       value['mode'] == '660' and value['socket_uid'] == value['socket_gid'] == 0 and
                       value['requests'] == ['GET /_ping', 'GET /version'], 'VST_PROBE_RECEIPT')
        self.record['real_socket_probe'] = value
        self.preservation()
        self.record.update(result='PASS_FIXED_READ_ONLY_PROBE', phase='complete')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--probe-only', required=True, action='store_true')
    p.parse_args()
    probe = Probe()
    try:
        probe.run()
    except Exception as e:
        message = str(e)
        probe.record.update(result='FAIL_STOPPED', failure=message if re.fullmatch(r'VST_[A-Z_]+', message) else 'VST_SANITIZED_STOP')
        for kind in probe.ids:
            try: probe.stop(kind)
            except Exception: probe.record['owned_cleanup_requires_review'] = True
        if hasattr(probe, 'before'):
            try: probe.preservation()
            except Exception: probe.record['final_preservation'] = 'FAIL_REQUIRES_REVIEW'
    probe.record['finished_at'] = datetime.now(timezone.utc).isoformat()
    probe.save()
    print(json.dumps({'result': probe.record['result'], 'evidence': probe.path.relative_to(base.ROOT).as_posix()}))
    return 0 if probe.record['result'] == 'PASS_FIXED_READ_ONLY_PROBE' else 1


if __name__ == '__main__':
    sys.exit(main())
