"""Step 22.8: prepare/rehearse only. Never invokes the public activation switch."""
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'supabase/tests'))
import google_credential_preflight as gate
import google_activation_workflow as flow
from run_google_credential_helpers import docker_state

INITIAL = ROOT / 'supabase/tests/results/google_activation_preflight_5933aa1f.json'


def ps(script, *args, timeout=150):
    result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, *args],
                            cwd=ROOT, env=gate.recovery.backup.clean_env(), capture_output=True,
                            encoding='utf-8', text=True, timeout=timeout)
    if result.returncode:
        safe = {'Result': 'FAIL', 'Code': 'LGA_POWERSHELL_CHECK_STOPPED'}
        try:
            raw = json.loads(result.stderr.strip())
            safe.update({k: raw.get(k) for k in ('Code', 'LastPassed', 'ExceptionType')})
        except Exception: pass
        raise RehearsalFailure(safe)
    return json.loads(result.stdout)


class RehearsalFailure(RuntimeError):
    def __init__(self, safe): self.safe = safe


def main():
    run_id = uuid.uuid4().hex[:8]
    evidence = ROOT / f'supabase/tests/results/google_activation_readiness_{run_id}.json'
    record = {'result': 'RUNNING', 'phase': 'preflight', 'run_id': run_id,
              'started_at': datetime.now(timezone.utc).isoformat(), 'activation_executed': False,
              'retained_services_restarted': False, 'real_login_executed': False}
    def save():
        gate.recovery.backup.write_json(evidence, record)
    save()
    try:
        initial = json.loads(INITIAL.read_text())
        gate.require(initial['result'] == 'PASS', 'LGA_INITIAL_PREFLIGHT')
        record['before'] = gate.check()
        frozen = initial['immutable_inputs']
        gate.require(all(gate.recovery.backup.file_sha256(ROOT / p) == h for p, h in frozen.items()), 'LGA_HISTORICAL_INPUT_CHANGED')
        record['historical_inputs_count'] = len(frozen)
        old_docker = docker_state()
        gate.require(old_docker == initial['docker'], 'LGA_RETAINED_DOCKER_CHANGED')
        tree = gate.recovery.tree_summary(gate.recovery.historical_files(gate.recovery.backup.BACKUPS / '__none__'))
        gate.require(tree == initial['backup_tree'], 'LGA_BACKUP_TREE_CHANGED')
        old_cipher = gate.recovery.backup.file_sha256(ROOT / '.local-secrets/google-local.dpapi')
        gate.require(old_cipher == initial['credential_ciphertext_sha256'], 'LGA_CREDENTIAL_STORE_CHANGED')
        code = flow.inputs()
        record['tested_input_hashes'] = code
        record['phase'] = 'offline-tests'; save()
        result = gate.recovery.backup.call([sys.executable, '-B', '-m', 'unittest', 'discover', '-s', 'supabase/tests', '-p', 'test_google_*.py'],
                                          label='Offline Google activation/security methods')
        match = re.search(r'Ran (\d+) tests', result.stderr)
        gate.require(match is not None and 'OK' in result.stderr, 'LGA_OFFLINE_SUMMARY')
        record['offline_tests'] = {'passed': int(match[1]), 'failed': 0, 'skipped': 0}
        record['phase'] = 'prepare-protected-proposal'; save()
        prepared = ps('scripts/Start-LocalGoogleAuth.ps1', '-Prepare')
        gate.require(prepared['result'] == 'PASS' and prepared['mode'] == 'PREPARED_ONLY' and
                     not prepared['retained_services_changed'], 'LGA_PREPARATION_RECEIPT')
        record['proposal'] = prepared
        record['phase'] = 'dummy-disposable-process-rehearsal'; save()
        tests = ps('tests/security/Test-LocalGoogleActivation.ps1', '-RunId', prepared['run_id'])
        gate.require(tests['Result'] == 'PASS' and tests['Failed'] == 0 and
                     not tests['RetainedServiceRestarted'] and not tests['RetainedConfigChanged'] and
                     not tests['RealCredentialUsedInRehearsal'], 'LGA_REHEARSAL_RECEIPT')
        record['rehearsal'] = tests
        record['phase'] = 'final-preservation'; save()
        record['after'] = gate.check()
        gate.require(docker_state() == old_docker, 'LGA_DOCKER_CHANGED')
        gate.require(gate.recovery.tree_summary(gate.recovery.historical_files(gate.recovery.backup.BACKUPS / '__none__')) == tree, 'LGA_BACKUP_TREE_CHANGED')
        gate.require(all(gate.recovery.backup.file_sha256(ROOT / p) == h for p, h in frozen.items()), 'LGA_HISTORICAL_INPUT_CHANGED')
        gate.require(flow.inputs() == code, 'LGA_TESTED_CODE_CHANGED')
        gate.require(gate.recovery.backup.file_sha256(ROOT / '.local-secrets/google-local.dpapi') == old_cipher, 'LGA_CREDENTIAL_CHANGED')
        record.update(result='PASS', phase='complete', completed_at=datetime.now(timezone.utc).isoformat(),
                      credential_store_unchanged=True, backups_unchanged=tree, docker_unchanged=True,
                      historical_inputs_unchanged=True, tested_inputs_unchanged=True, config_unchanged=True)
        save()
        print(json.dumps({'result': 'PASS', 'run_id': run_id, 'offline_methods': record['offline_tests']['passed'],
                          'powershell_checks': tests['Passed'], 'proposal': prepared,
                          'evidence': str(evidence.relative_to(ROOT))}, indent=2))
        return 0
    except Exception as error:
        record.update(result='FAIL', failure=getattr(error, 'safe', {'code': 'LGA_REHEARSAL_STOPPED'}))
        try:
            record['after_failure'] = gate.check()
            record['docker_unchanged_after_failure'] = docker_state() == old_docker
        except Exception: record['failure_preservation_unavailable'] = True
        save()
        print(json.dumps({'result': 'FAIL', 'phase': record['phase'], 'failure': record['failure'], 'evidence': str(evidence.relative_to(ROOT))}))
        return 1


if __name__ == '__main__': sys.exit(main())
