"""Step 22.9: read-only retained fences, encrypted original capture, disposable Auth.

No retained service/SQL/configuration/credential write or production-credential read.
"""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'supabase/tests'))
import dual_database_recovery as m
import inspect_google_activation_minimum as health
import inspect_realtime_lifecycle_recovery as inspection


def need(value, code):
    if not value:
        raise RuntimeError(code)


def read_health(items):
    local, env, identity = m.backup.target()
    need(identity['project'] == 'school-queue-local', 'AGO_PROJECT')
    need(m.backup.file_sha256(ROOT / 'supabase/config.toml') == m.base.gate.CONFIG_SHA256, 'AGO_CONFIG_CHANGED')
    for kind in ('db', 'auth', 'kong', 'rest'):
        item = next(x for x in items if x['Name'] == '/supabase_' + kind + '_school-queue-local')
        need(item['State']['Running'] and item['State'].get('Health', {}).get('Status', 'not-configured') in ('healthy', 'not-configured'), 'AGO_CORE_HEALTH')
    key = local.get('ANON_KEY') or local.get('PUBLISHABLE_KEY')
    need(isinstance(key, str), 'AGO_PUBLIC_KEY')
    health.request('/auth/v1/health', key)
    settings = health.request('/auth/v1/settings', key)
    need(settings.get('external', {}).get('google') is False, 'AGO_RETAINED_GOOGLE_CHANGED')
    health.request('/rest/v1/counter_state?select=counter_label&limit=1', key, projection=True)
    return {'auth_health': 200, 'settings': 200, 'google': False, 'anonymous_api': 200,
            'source_cluster': m.analytics.CLUSTER, 'project': identity['project'], 'migration_hashes': identity['migration_sha256']}


def private_process(args, data=None, timeout=45):
    child = subprocess.run(args, cwd=ROOT, env=m.backup.clean_env(), input=data, capture_output=True, timeout=timeout)
    need(child.returncode == 0, 'AGO_PRIVATE_PROCESS_FAILED')
    return child.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rehearse-disposable', required=True, action='store_true')
    parser.parse_args()
    rid = uuid.uuid4().hex[:8]
    path = ROOT / f'supabase/tests/results/auth_only_readiness_{rid}.json'
    need(not path.exists(), 'AGO_EVIDENCE_EXISTS')
    record = {'run_id': rid, 'result': 'IN_PROGRESS', 'phase': 'read-only-preflight',
              'started_at': datetime.now(timezone.utc).isoformat(), 'retained_mutation': False,
              'production_google_credential_contents_accessed': False, 'retained_activation_approval_required': True}
    save = lambda: m.backup.write_json(path, record)
    before = None
    baseline_ready = False
    save()
    try:
        frozen = m.recovery.immutable_inputs(path)
        frozen.update({str(p.relative_to(ROOT)): m.backup.file_sha256(p) for p in (ROOT / 'scripts').glob('*') if p.is_file()})
        frozen.update({str(p.relative_to(ROOT)): m.backup.file_sha256(p) for p in (ROOT / 'tests/security').glob('*auth*') if p.is_file()})
        need(not any(m.backup.clean_env().get(k) for k in ('DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH')), 'AGO_DOCKER_OVERRIDE')
        context = private_process(['docker', 'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']).decode().strip()
        need(context == 'npipe:////./pipe/dockerDesktopLinuxEngine', 'AGO_CONTEXT_CHANGED')
        before = m.analytics.project_items()
        record['health_before'] = read_health(before)
        source_before, _, _ = inspection.collect_source(before)
        need(source_before['state']['active'] == source_before['state']['open_days'] == 0, 'AGO_ACTIVE_WORK')
        resources = m.fences.resources()
        credential = m.base.credential_metadata()
        tree = m.recovery.tree_summary(m.recovery.historical_files(m.backup.BACKUPS / '__none__'))
        m.fences.assert_locks()
        baseline_ready = True
        record['retained_before'] = [m.base.state(x) for x in before]
        record['known_historical_pruning_failure'] = {'unchanged_policy': True, 'not_a_current_inventory_recovery_approval': True,
            'historical_report': 'supabase/HISTORICAL_POSTGRES_71_TABLE_RESTORE_REPORT.md'}
        record['phase'] = 'offline-methods'; save()
        output = private_process(['node', '--test', 'tests/security/authOnly.unit.mjs', 'tests/security/authOnlyWorkflow.unit.mjs']).decode('utf-8', 'replace')
        match = re.search(r'(?:# |\u2139 )?pass (\d+)', output)
        need(match and int(match[1]) == 24, 'AGO_OFFLINE_COUNT')
        private_process(['python', '-B', 'tests/security/test_auth_only_guard.py'])
        record['offline_methods'] = {'passed': 30, 'failed': 0, 'node': 24, 'python': 6}
        record['phase'] = 'encrypted-read-only-original-capture'; save()
        auth = next(x for x in before if x['Name'] == '/supabase_auth_school-queue-local')
        receipt = json.loads(private_process(['node', 'tests/security/capture_auth_original.mjs'], json.dumps({
            'runId': rid, 'item': auth, 'config_base64': base64.b64encode((ROOT / 'supabase/config.toml').read_bytes()).decode(),
            'sourceHash': hashlib.sha256(json.dumps(source_before, sort_keys=True).encode()).hexdigest()}).encode()))
        need(receipt.get('result') == 'PASS' and receipt.get('activationAuthorized') is False, 'AGO_CAPTURE_RECEIPT')
        record['protected_retained_original_capture'] = receipt
        record['phase'] = 'disposable-auth-replacement-rollback'; save()
        child = subprocess.Popen(['node', 'tests/security/rehearse_auth_only.mjs', rid], cwd=ROOT, env=m.backup.clean_env(),
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8')
        for line in child.stdout:
            receipt = json.loads(line)
            need(set(receipt).issubset({'check', 'result', 'failure', 'run_id', 'checks'}), 'AGO_CHILD_OUTPUT')
            need(receipt.get('result') in ('PASS', 'FAIL_STOPPED'), 'AGO_CHILD_OUTPUT')
            print(json.dumps(receipt), flush=True)
        child.wait(timeout=10)
        child.stderr.read()  # Private diagnostics are never forwarded.
        inner_path = ROOT / f'supabase/tests/results/auth_only_disposable_{rid}.json'
        inner = json.loads(inner_path.read_text())
        record['disposable_evidence'] = str(inner_path.relative_to(ROOT))
        record['disposable_evidence_sha256'] = m.backup.file_sha256(inner_path)
        record['synthetic_checks'] = {'passed': len(inner['checks']), 'failed': int(inner['result'] != 'PASS')}
        need(child.returncode == 0 and inner['result'] == 'PASS', 'AGO_REHEARSAL_FAILED')
        record['result'] = 'PASS'
    except Exception as error:
        code = str(error)
        record.update(result='FAIL_STOPPED', failure=code if re.fullmatch(r'AGO_[A-Z_]+', code) else 'AGO_SANITIZED_STOP')
    finally:
        if baseline_ready:
            try:
                after = m.analytics.project_items()
                m.fences.unchanged_retained(before, after)
                record['health_after'] = read_health(after)
                source_after, _, _ = inspection.collect_source(after)
                classification = m.recovery.compare_source(source_before, source_after)
                need(source_before['ancillary'] == source_after['ancillary'], 'AGO_ANCILLARY_CHANGED')
                need(m.base.credential_metadata() == credential, 'AGO_REAL_CREDENTIAL_METADATA_CHANGED')
                need(m.recovery.tree_summary(m.recovery.historical_files(m.backup.BACKUPS / '__none__')) == tree, 'AGO_BACKUPS_CHANGED')
                need(all(m.backup.file_sha256(ROOT / p) == h for p, h in frozen.items()), 'AGO_EXISTING_INPUT_CHANGED')
                m.fences.assert_locks()
                inner_path = ROOT / f'supabase/tests/results/auth_only_disposable_{rid}.json'
                inner = json.loads(inner_path.read_text()) if inner_path.exists() else {'containers': [], 'network_id': None}
                now = m.fences.resources()
                expected = {'containers': set(resources['containers']) | set(inner['containers']),
                            'networks': set(resources['networks']) | ({inner['network_id']} if inner['network_id'] else set()),
                            'volumes': set(resources['volumes'])}
                need(all(set(now[k]) == expected[k] for k in expected), 'AGO_UNEXPECTED_RESOURCE_DELTA')
                for identifier in inner['containers']:
                    item = m.base.read_json(['docker', 'inspect', identifier])[0]
                    need(not item['State']['Running'] and item['Config']['Labels'].get('school-queue.auth-only-rehearsal') == rid, 'AGO_FIXTURE_RUNNING')
                record['retained_after'] = [m.base.state(x) for x in after]
                record['preservation'] = {'result': 'PASS', 'source_within_run_classifier': classification,
                    'all_retained_definitions_unchanged': True, 'eleven_non_vector_lifecycles_unchanged': True,
                    'google_credential_metadata_only_unchanged': True, 'all_backups': tree, 'frozen_inputs': len(frozen),
                    'all_added_containers_inactive': True, 'no_volume_created_or_deleted': True,
                    'exact_added_containers': len(inner['containers']), 'exact_added_networks': int(bool(inner['network_id'])),
                    'source_table_count': len(source_after['rows']), 'state': source_after['state'], 'locks_unchanged': True}
            except Exception:
                record['preservation'] = {'result': 'FAIL_REQUIRES_REVIEW'}
                record['result'] = 'FAIL_STOPPED'
        record['finished_at'] = datetime.now(timezone.utc).isoformat()
        if record['result'] == 'PASS':
            record['phase'] = 'complete'
        save()
    print(json.dumps({'result': record['result'], 'phase': record['phase'], 'evidence': str(path.relative_to(ROOT))}), flush=True)
    return 0 if record['result'] == 'PASS' else 1


if __name__ == '__main__':
    sys.exit(main())
