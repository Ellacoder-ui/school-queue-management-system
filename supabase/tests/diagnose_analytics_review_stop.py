"""Read-only diagnosis after the unchanged 70-table prerequisite stopped.

Does not repair/rebase that prerequisite. Applies the existing independent
Realtime classifier for explanation and keeps strict-gate FAIL in new evidence.
No backup, restore, disposable or retained mutation path.
"""
from datetime import datetime, timezone
import json
import sys
import uuid

import inspect_analytics_recovery as assessment
import diagnose_vector_health as base
import validate_vector_socket as fences


def main():
    rid = uuid.uuid4().hex[:8]
    path = base.ROOT / f'supabase/tests/results/vector_analytics_stopped_diagnosis_{rid}.json'
    assessment.need(not path.exists(), 'VAR_EVIDENCE_EXISTS')
    record = {'run_id': rid, 'result': 'IN_PROGRESS_READ_ONLY_DIAGNOSIS',
        'started_at': datetime.now(timezone.utc).isoformat(), 'strict_70_table_prerequisite': 'FAIL_NOT_REPAIRED',
        'retained_mutation': False, 'backup_or_restore': False, 'google_credential_contents_accessed': False}
    before = assessment.project_items()
    resources = fences.resources()
    metadata = base.credential_metadata()
    frozen = base.immutable_inputs()
    try:
        evidence = json.loads(base.gate.EVIDENCE.read_text())
        assessment.need(base.backup.file_sha256(base.gate.EVIDENCE) == base.gate.EVIDENCE_SHA256, 'VAR_RECOVERY_EVIDENCE')
        verifier = base.gate.recovery.Run.__new__(base.gate.recovery.Run)
        verifier.id = evidence['run_id']; verifier.record = evidence
        from pathlib import Path
        verifier.directory = Path(evidence['directory'])
        manifest = verifier.verify_bundle()  # Artifact verification only.
        source, checks = base.gate.recovery.inspect_source()  # Existing strict classifier, no inventory rebase.
        comparison = base.gate.recovery.compare_source(manifest, source)
        added = set(source['rows']) - set(manifest['rows'])
        record['source_diagnosis'] = {'logical_tables': len(source['rows']),
            'added_tables': [{'table': name, 'count': source['rows'][name]['count']} for name in sorted(added)],
            'removed_tables': sorted(set(manifest['rows']) - set(source['rows'])),
            'existing_classifier_result': comparison, 'google_enabled': checks['google_provider_enabled'],
            'migration_count': len(source['state']['versions']), 'state_counts': source['state']['counts'],
            'active': source['state']['active'], 'open_days': source['state']['open_days'],
            'recovery_evidence_hash': base.gate.EVIDENCE_SHA256,
            'existing_bundle_sha256': evidence['bundle']['sha256']}
        record['analytics'], private_before = assessment.capture()
        record['locked_review'] = assessment.review(before, record['analytics'], checks)
        record['analytics_after'], private_after = assessment.capture()
        record['analytics_comparison'] = assessment.compare(private_before, private_after)
        assessment.need(all(v for k, v in record['analytics_comparison'].items()
                            if k not in ('changed_tables', 'sequences_equal')), 'VAR_DIAGNOSIS_METADATA_CHANGE')
        record['historical_bundles'] = base.gate.recovery.historical_bundles()
        record['backup_tree'] = base.gate.recovery.tree_summary(base.gate.recovery.historical_files(base.backup.BACKUPS / '__none__'))
        fences.unchanged_retained(before, assessment.project_items())
        assessment.need(fences.resources() == resources and base.credential_metadata() == metadata, 'VAR_DIAGNOSIS_PRESERVATION')
        assessment.need(all(base.backup.file_sha256(base.ROOT / p) == h for p, h in frozen.items()), 'VAR_DIAGNOSIS_INPUT_CHANGED')
        fences.assert_locks()
        record.update(result='DIAGNOSIS_COMPLETE_STRICT_PREREQUISITE_STILL_BLOCKED',
                      all_eleven_services_and_vector_definition_preserved=True,
                      docker_inventory_unchanged=True, credential_metadata_unchanged=True,
                      historical_inputs_unchanged=len(frozen), all_retained_execution_locked=True)
    except Exception:
        record.update(result='FAIL_DIAGNOSIS_STOPPED', failure='VAR_SANITIZED_DIAGNOSIS_STOP')
    record['finished_at'] = datetime.now(timezone.utc).isoformat()
    base.backup.write_json(path, record)
    print(json.dumps({'result': record['result'], 'evidence': path.relative_to(base.ROOT).as_posix()}))
    return 0 if record['result'] == 'DIAGNOSIS_COMPLETE_STRICT_PREREQUISITE_STILL_BLOCKED' else 1


if __name__ == '__main__':
    sys.exit(main())
