"""Step 22.8D: new evidence for locked review and disposable-only regression.

Never runs a dump, restore, retained mutation or Google credential helper. The
existing synthetic-only rehearsal owns and fences its own disposable resources.
"""
import argparse
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
import diagnose_vector_health as base
import inspect_analytics_recovery as analytics


def need(value, code):
    if not value:
        raise RuntimeError(code)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--validate', action='store_true', required=True)
    parser.parse_args()
    rid = uuid.uuid4().hex[:8]
    path = ROOT / f'supabase/tests/results/vector_analytics_review_{rid}.json'
    need(not path.exists(), 'VAR_EVIDENCE_EXISTS')
    record = {'run_id': rid, 'result': 'IN_PROGRESS', 'phase': 'offline',
              'started_at': datetime.now(timezone.utc).isoformat(),
              'new_backup_or_restore': False, 'retained_mutation': False,
              'google_credential_contents_accessed': False}
    frozen = base.immutable_inputs()
    for p in [*list((ROOT / 'scripts').glob('*ector*')), *list((ROOT / 'tests/security').glob('*ector*')),
              ROOT / 'supabase/tests/inspect_analytics_recovery.py', ROOT / 'supabase/tests/test_analytics_recovery_review.py']:
        if p.is_file(): frozen[p.relative_to(ROOT).as_posix()] = base.backup.file_sha256(p)
    save = lambda: base.backup.write_json(path, record)
    save()
    def execute(args, timeout):
        result = subprocess.run(args, cwd=ROOT, env=base.backup.clean_env(), capture_output=True, timeout=timeout,
                                text=True, encoding='utf-8', errors='replace')
        # Child exception text and definitions are never forwarded.
        need(result.returncode == 0, 'VAR_CHILD_STOPPED')
        return result
    def created(prefix, before):
        files = set((ROOT / 'supabase/tests/results').glob(prefix + '*.json')) - before
        need(len(files) == 1, 'VAR_EVIDENCE_ASSOCIATION')
        return files.pop()
    def receipt(p):
        return {'path': p.relative_to(ROOT).as_posix(), 'sha256': base.backup.file_sha256(p)}
    try:
        unit = execute(['node', '--test', 'tests/security/vectorRetainedReview.unit.mjs'], 30)
        need(re.search(r'(?:# |\u2139 )?pass 20\b', unit.stdout), 'VAR_UNIT_COUNT')
        py = execute(['python', '-B', '-m', 'unittest', 'discover', '-s', 'supabase/tests', '-p', 'test_analytics_recovery_review.py'], 30)
        need('Ran 7 tests' in py.stderr, 'VAR_PYTHON_COUNT')
        record['new_offline'] = {'node_passed': 20, 'python_passed': 7, 'failed': 0}
        record['phase'] = 'read-only-before'; save()
        old = set((ROOT / 'supabase/tests/results').glob('vector_analytics_assessment_*.json'))
        execute(['python', '-B', 'supabase/tests/inspect_analytics_recovery.py', '--inspect'], 180)
        before_file = created('vector_analytics_assessment_', old)
        record['assessment_before'] = receipt(before_file)
        before = json.loads(before_file.read_text())
        record['phase'] = 'disposable-only-rehearsal'; save()
        old = set((ROOT / 'supabase/tests/results').glob('vector_persistent_rehearsal_*.json'))
        execute(['python', '-B', 'tests/security/run_vector_repair.py', '--rehearse-disposable'], 300)
        rehearsal_file = created('vector_persistent_rehearsal_', old)
        rehearsal = json.loads(rehearsal_file.read_text())
        need(rehearsal['result'] == 'PASS' and rehearsal['offline_methods']['passed'] == 11 and
             rehearsal['synthetic_checks']['passed'] == 24, 'VAR_REHEARSAL_COUNTS')
        record['disposable_rehearsal'] = receipt(rehearsal_file)
        record['existing_offline'] = {'passed': 11, 'failed': 0}
        record['synthetic_windows_engine'] = {'passed': 24, 'failed': 0}
        record['phase'] = 'read-only-after'; save()
        old = set((ROOT / 'supabase/tests/results').glob('vector_analytics_assessment_*.json'))
        execute(['python', '-B', 'supabase/tests/inspect_analytics_recovery.py', '--inspect'], 180)
        after_file = created('vector_analytics_assessment_', old)
        record['assessment_after'] = receipt(after_file)
        after = json.loads(after_file.read_text())
        a, b = before['analytics_after'], after['analytics_after']
        differences = []
        aa = {t['identity_sha256']: t for t in a['tables']}
        bb = {t['identity_sha256']: t for t in b['tables']}
        for key in sorted(set(aa) | set(bb)):
            first, last = aa.get(key), bb.get(key)
            if first is None or last is None or (first['count'], first['sha256']) != (last['count'], last['sha256']):
                differences.append({'identity_sha256': key, 'table': (first or last)['table'],
                    'before': {k: first[k] for k in ('count', 'sha256')} if first else None,
                    'after': {k: last[k] for k in ('count', 'sha256')} if last else None})
        record['analytics_across_rehearsal'] = {'changed_tables': differences,
            **{k + '_equal': a[k] == b[k] for k in ['catalog_sha256', 'metadata', 'roles', 'additional', 'sequences']},
            'slot_progress_equal': a['replication_slots'] == b['replication_slots']}
        # This assessment reports live row/sequence/slot movement, not an exact
        # backup fence. A future dump must use the stricter non-MVCC design gate.
        need(all(value for k, value in record['analytics_across_rehearsal'].items()
                 if k.endswith('_equal') and k not in ('slot_progress_equal', 'sequences_equal')), 'VAR_ANALYTICS_METADATA_CHANGE')
        need(all(base.backup.file_sha256(ROOT / p) == h for p, h in frozen.items()), 'VAR_IMMUTABLE_INPUT')
        record['frozen_input_count'] = len(frozen)
        record['tested_code_sha256'] = {p: h for p, h in frozen.items() if p.endswith(('.mjs', '.ps1', '.py'))}
        record.update(result='PASS_SCOPE_COMPLETE_RETAINED_LOCKED', phase='complete', retained_repair_locked=True,
                      google_activation_locked=True, analytics_backup_still_required=True)
    except Exception as e:
        text = str(e)
        record.update(result='FAIL_STOPPED', failure=text if re.fullmatch(r'VAR_[A-Z_]+', text) else 'VAR_SANITIZED_STOP')
    finally:
        record['finished_at'] = datetime.now(timezone.utc).isoformat()
        save()
    print(json.dumps({'result': record['result'], 'evidence': path.relative_to(ROOT).as_posix()}))
    return 0 if record['result'] == 'PASS_SCOPE_COMPLETE_RETAINED_LOCKED' else 1


if __name__ == '__main__':
    sys.exit(main())
