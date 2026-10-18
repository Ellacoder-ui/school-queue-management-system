"""Step 22.8 initial read-only gate; no credential values or service operations."""
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'supabase/tests'))
import google_credential_preflight as gate
from run_google_credential_helpers import docker_state


def main():
    run_id = uuid.uuid4().hex[:8]
    path = ROOT / f'supabase/tests/results/google_activation_preflight_{run_id}.json'
    record = dict(result='RUNNING', run_id=run_id, started_at=datetime.now(timezone.utc).isoformat())
    try:
        record['source'] = gate.check()
        result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                                 '-File', 'scripts/Start-LocalGoogleAuth.ps1', '-Preview'],
                                cwd=ROOT, env=gate.recovery.backup.clean_env(), capture_output=True,
                                text=True, encoding='utf-8', timeout=90)
        gate.require(result.returncode == 0, 'LCG_CREDENTIAL_PREVIEW')
        receipt = json.loads(result.stdout)
        gate.require(receipt['Result'] == 'PASS' and receipt['SyntheticCredentials'] is False and
                     receipt['CredentialValid'] and not receipt['CredentialChildExecuted'] and
                     not receipt['ConfigWritten'] and not receipt['ProviderEnabled'] and
                     not receipt['ServiceRestarted'], 'LCG_CREDENTIAL_RECEIPT')
        record['credential_preview'] = receipt
        record['credential_ciphertext_sha256'] = gate.recovery.backup.file_sha256(ROOT / '.local-secrets/google-local.dpapi')
        record['docker'] = docker_state()
        record['backup_tree'] = gate.recovery.tree_summary(gate.recovery.historical_files(gate.recovery.backup.BACKUPS / '__none__'))
        files = list((ROOT / 'supabase').glob('*.md')) + list((ROOT / 'supabase/tests/results').glob('*.json'))
        files += list((ROOT / 'supabase/migrations').glob('*.sql'))
        files += [p for p in (ROOT / 'src').rglob('*') if p.is_file()]
        files += [ROOT / p for p in ('supabase/config.toml', 'package.json', 'package-lock.json')]
        record['immutable_inputs'] = {str(p.relative_to(ROOT)): gate.recovery.backup.file_sha256(p) for p in files}
        record.update(result='PASS', completed_at=datetime.now(timezone.utc).isoformat(),
                      retained_mutations=False, credentials_exposed=False)
    except Exception:
        record.update(result='FAIL', code='LCG_INITIAL_ACTIVATION_GATE_STOPPED')
    with path.open('x', encoding='utf-8') as handle:
        json.dump(record, handle, indent=2); handle.write('\n')
    print(json.dumps(dict(result=record['result'], run_id=run_id, evidence=str(path.relative_to(ROOT)))))
    return 0 if record['result'] == 'PASS' else 1


if __name__ == '__main__':
    sys.exit(main())
