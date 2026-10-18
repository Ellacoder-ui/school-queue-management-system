"""Step 22.8C: read-only retained fences around synthetic-only Windows rehearsal."""
from datetime import datetime, timezone
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'supabase/tests'))
import diagnose_vector_health as base
import validate_vector_socket as fences


def require(value, code):
    if not value: raise RuntimeError(code)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rehearse-disposable', required=True, action='store_true')
    parser.parse_args()
    rid = uuid.uuid4().hex[:8]
    path = ROOT / f'supabase/tests/results/vector_persistent_rehearsal_{rid}.json'
    require(not path.exists(), 'VPR_EVIDENCE_EXISTS')
    record = {'run_id': rid, 'result': 'IN_PROGRESS', 'phase': 'read-only-preflight',
              'started_at': datetime.now(timezone.utc).isoformat(),
              'retained_mutation_executed': False, 'google_credential_contents_accessed': False}
    frozen = base.immutable_inputs()
    code = [*list((ROOT / 'scripts').glob('*Vector*')), ROOT / 'scripts/vectorRepairCore.mjs',
            *list((ROOT / 'tests/security').glob('*vector*')), ROOT / 'tests/security/run_vector_repair.py',
            ROOT / 'supabase/tests/vector_socket_fixture.mjs']
    for p in code:
        if p.is_file(): frozen[p.relative_to(ROOT).as_posix()] = base.backup.file_sha256(p)
    save = lambda: base.backup.write_json(path, record)
    save()
    before = None
    try:
        record['source_before'] = base.gate.check()
        before = base.project_items()
        vector = next(x for x in before if x['Name'] == '/' + base.VECTOR)
        base.validate_vector(vector)
        require(vector['Id'] == fences.VECTOR_ID and fences.vector_config_hash() == fences.YAML_SHA, 'VPR_VECTOR_IDENTITY')
        reference = json.loads((ROOT / 'supabase/tests/results/vector_socket_validation_e6696074.json').read_text())
        require([base.state(x) for x in before if x['Name'] != '/' + base.VECTOR] ==
                [x for x in reference['retained_after'] if x['container'] != base.VECTOR], 'VPR_PRIOR_SERVICE_CHANGED')
        fences.assert_locks()
        credential = base.credential_metadata()
        backup_tree = base.gate.recovery.tree_summary(base.gate.recovery.historical_files(base.backup.BACKUPS / '__none__'))
        inventory = fences.resources()
        env = base.backup.clean_env()
        require(not any(env.get(k) for k in ('DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH')), 'VPR_CONTEXT_OVERRIDE')
        context = subprocess.check_output(['docker', 'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], env=env, timeout=15).decode().strip()
        require(context == 'npipe:////./pipe/dockerDesktopLinuxEngine', 'VPR_CONTEXT_CHANGED')
        record['retained_before'] = [base.state(x) for x in before]
        record['phase'] = 'offline-methods'; save()
        test = subprocess.run(['node', '--test', 'tests/security/vectorRepair.unit.mjs'], cwd=ROOT, env=env, capture_output=True, timeout=30)
        output = test.stdout.decode('utf-8', 'replace')
        match = re.search(r'(?:# |\u2139 )?pass (\d+)', output)
        require(test.returncode == 0 and match and int(match[1]) == 11, 'VPR_OFFLINE_METHODS')
        record['offline_methods'] = {'passed': 11, 'failed': 0}
        record['phase'] = 'synthetic-windows-docker-rehearsal'; save()
        # Capture all child output privately and forward fixed test receipts only.
        child = subprocess.Popen(['node', 'tests/security/rehearse_vector_repair.mjs', rid], cwd=ROOT, env=env,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8')
        for line in child.stdout:
            receipt = json.loads(line)
            require(set(receipt).issubset({'check', 'result', 'failure', 'run_id', 'checks'}), 'VPR_CHILD_OUTPUT')
            require(receipt.get('result') in ('PASS', 'FAIL_STOPPED'), 'VPR_CHILD_OUTPUT')
            print(json.dumps(receipt), flush=True)
        child.wait(timeout=10)
        # Raw stderr is discarded; exceptions cannot disclose embedded definitions.
        child.stderr.read()
        inner_path = ROOT / f'supabase/tests/results/vector_repair_disposable_{rid}.json'
        inner = json.loads(inner_path.read_text())
        record['disposable_evidence'] = str(inner_path.relative_to(ROOT))
        record['disposable_evidence_sha256'] = base.backup.file_sha256(inner_path)
        record['synthetic_checks'] = {'passed': len(inner['checks']), 'failed': int(inner['result'] != 'PASS')}
        require(child.returncode == 0 and inner['result'] == 'PASS', 'VPR_REHEARSAL_STOPPED')
        record['result'] = 'PASS'
    except Exception as error:
        value = str(error)
        record.update(result='FAIL_STOPPED', failure=value if re.fullmatch('VPR_[A-Z_]+', value) else 'VPR_SANITIZED_STOP')
    finally:
        if before is not None:
            try:
                record['source_after'] = base.gate.check()
                after = base.project_items()
                fences.unchanged_retained(before, after)
                require(fences.vector_config_hash() == fences.YAML_SHA, 'VPR_RETAINED_YAML_CHANGED')
                require(base.credential_metadata() == credential, 'VPR_GOOGLE_METADATA_CHANGED')
                require(base.gate.recovery.tree_summary(base.gate.recovery.historical_files(base.backup.BACKUPS / '__none__')) == backup_tree, 'VPR_BACKUP_CHANGED')
                require(all(base.backup.file_sha256(ROOT / p) == h for p, h in frozen.items()), 'VPR_INPUT_CHANGED')
                fences.assert_locks()
                inner_path = ROOT / f'supabase/tests/results/vector_repair_disposable_{rid}.json'
                inner = json.loads(inner_path.read_text()) if inner_path.exists() else {'containers': [], 'network_id': None, 'volume': None}
                now = fences.resources()
                expected = {'containers': set(inventory['containers']) | set(inner['containers']),
                            'networks': set(inventory['networks']) | ({inner['network_id']} if inner['network_id'] else set()),
                            'volumes': set(inventory['volumes']) | ({inner['volume']} if inner['network_id'] else set())}
                require(all(set(now[k]) == expected[k] for k in expected), 'VPR_UNEXPECTED_RESOURCE_DELTA')
                for identifier in inner['containers']:
                    item = base.read_json(['docker', 'inspect', identifier])[0]
                    require(not item['State']['Running'] and item['Config']['Labels'].get('school-queue.vector-repair-rehearsal') == rid, 'VPR_DISPOSABLE_STILL_RUNNING')
                record['retained_after'] = [base.state(x) for x in after]
                record['preservation'] = {'result': 'PASS', 'other_eleven_lifecycles_unchanged': True,
                    'retained_definitions_networks_yaml_unchanged': True, 'google_metadata_unchanged': True,
                    'activation_locks_unchanged': True, 'all_backup_files': backup_tree,
                    'immutable_inputs': len(frozen), 'code_hashes': {p: h for p, h in frozen.items() if p.startswith(('scripts/', 'tests/security/'))},
                    'only_owned_docker_resources_added': True, 'all_owned_containers_inactive': True}
            except Exception:
                record['preservation'] = {'result': 'FAIL_REQUIRES_REVIEW'}
                record['result'] = 'FAIL_STOPPED'
        record['completed_at'] = datetime.now(timezone.utc).isoformat()
        if record['result'] == 'PASS': record['phase'] = 'complete'
        save()
    print(json.dumps({'result': record['result'], 'phase': record['phase'], 'evidence': str(path.relative_to(ROOT))}), flush=True)
    return 0 if record['result'] == 'PASS' else 1


if __name__ == '__main__': sys.exit(main())
