"""Read-only diagnosis of Step 22.8 preparation; no preparation retry or service operation."""
import json
from pathlib import Path
import re
import sys
from datetime import datetime, timezone
import uuid

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'supabase/tests'))
import google_activation_workflow as flow
from run_google_credential_helpers import docker_state

checks = []
for name, action in [
    ('candidate-parser', lambda: flow.candidate(flow.CONFIG.read_bytes())),
    ('service-inventory', flow.services),
    ('volume-inventory', lambda: flow.volumes(flow.services())),
    ('code-and-dotenv-inventory', flow.inputs),
]:
    try:
        action()
        checks.append({'check': name, 'result': 'PASS'})
    except Exception as error:
        message = str(error)
        checks.append({'check': name, 'result': 'FAIL', 'code': message if re.fullmatch(r'LGA_[A-Z_]+', message) else 'LGA_DIAGNOSTIC_REJECTED',
                       'type': type(error).__name__})
        break
record = {'mode': 'READ_ONLY_DIAGNOSIS', 'result': 'FAIL_HEALTH_GATE', 'checks': checks,
          'activation_executed': False, 'service_repair_requested': False,
          'captured_at': datetime.now(timezone.utc).isoformat()}
try:
    names = flow.backup.call(['docker', 'ps', '-a', '--filter', 'label=com.supabase.cli.project=' + flow.PROJECT,
                             '--format', '{{.Names}}']).stdout.splitlines()
    items = json.loads(flow.backup.call(['docker', 'inspect', *names], label='Read-only sanitized service-health diagnosis').stdout)
    record['service_health'] = [{
        'name': item['Name'][1:], 'image': item['Config']['Image'], 'image_id': item['Image'],
        'running': item['State']['Running'], 'restarting': item['State']['Restarting'],
        'health': item['State'].get('Health', {}).get('Status', 'not-configured'),
        'restart_count': item['RestartCount'], 'started_at': item['State']['StartedAt']
    } for item in items]
    record['source_preservation'] = flow.gate.check()
    initial = json.loads((ROOT / 'supabase/tests/results/google_activation_preflight_5933aa1f.json').read_text())
    record['four_core_containers_unchanged'] = docker_state() == initial['docker']
    record['backups'] = flow.gate.recovery.tree_summary(flow.gate.recovery.historical_files(flow.backup.BACKUPS / '__none__'))
    record['all_backup_files_unchanged'] = record['backups'] == initial['backup_tree']
    record['credential_ciphertext_unchanged'] = flow.backup.file_sha256(ROOT / '.local-secrets/google-local.dpapi') == initial['credential_ciphertext_sha256']
    record['all_historical_inputs_unchanged'] = all(flow.backup.file_sha256(ROOT / p) == h for p, h in initial['immutable_inputs'].items())
except Exception:
    record['final_preservation_unavailable'] = True
path = ROOT / f'supabase/tests/results/google_activation_stopped_diagnosis_{uuid.uuid4().hex[:8]}.json'
with path.open('x', encoding='utf-8') as handle:
    json.dump(record, handle, indent=2); handle.write('\n')
print(json.dumps({'result': record['result'], 'checks': checks,
                  'evidence': str(path.relative_to(ROOT)),
                  'final_preservation_available': not record.get('final_preservation_unavailable', False)}, indent=2))
