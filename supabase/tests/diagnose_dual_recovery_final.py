"""Read-only final preservation after unreviewed Realtime pruning. No retry.

Keeps strict classifier failure. Named comparisons explain unaffected state;
they are not a new policy allowing deletion or a recovery acceptance result.
"""
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import uuid

import dual_database_recovery as m


def main():
    rid = uuid.uuid4().hex[:8]
    path = m.ROOT / f'supabase/tests/results/dual_recovery_final_diagnosis_{rid}.json'
    record = {'run_id': rid, 'result': 'IN_PROGRESS_READ_ONLY_DIAGNOSIS', 'started_at': datetime.now(timezone.utc).isoformat(),
              'new_backup_restore_or_service_operation': False, 'retained_mutation': False,
              'google_credential_contents_accessed': False}
    frozen = m.recovery.immutable_inputs(path)
    before = m.analytics.project_items()
    resources = m.fences.resources()
    credential = m.base.credential_metadata()
    try:
        origin_path = m.ROOT / 'supabase/tests/results/postgres_analytics_recovery_93426091.json'
        origin = json.loads(origin_path.read_text())
        store = m.EncryptedStore(Path(origin['directory'])); store.artifacts = origin['artifacts']
        manifest = json.loads(store.get('pg_manifest.dpapi', 'postgres'))
        with m.backup.Snapshot(m.source_env('postgres')) as snapshot:
            identity = m.source_identity(snapshot.query); m.validate_source_identity(identity, 'postgres')
            current = m.collect(snapshot.query, 'postgres')
            platform = snapshot.query(m.recovery.realtime.PLATFORM_SQL)
            clock = snapshot.query('select to_jsonb(clock_timestamp())')
        rt = next(x for x in before if x['Name'] == '/supabase_realtime_school-queue-local')
        release = m.checked(['docker', 'exec', 'supabase_realtime_school-queue-local', 'cat', '/app/releases/start_erl.data']).decode().strip()
        platform.update(image=rt['Config']['Image'], image_id=rt['Image'], release=release)
        source = {**current, 'clock': clock, 'platform': platform}
        try:
            m.recovery.compare_source(manifest['captured'], source)
            record['strict_classifier'] = {'result': 'PASS_AT_DIAGNOSIS'}
        except m.recovery.realtime.PreservationError as error:
            record['strict_classifier'] = error.evidence
        expected = manifest['captured']; removed = sorted(set(expected['rows']) - set(current['rows']))
        added = sorted(set(current['rows']) - set(expected['rows']))
        shared = set(expected['rows']) & set(current['rows']) - {'"realtime"."subscription"'}
        unequal = sorted(k for k in shared if expected['rows'][k] != current['rows'][k])
        record['postgres'] = {'identity': identity, 'logical_tables': len(current['rows']), 'removed_tables': removed,
            'added_tables': added, 'last_snapshot_counts_of_removed': {k: expected['rows'][k]['count'] for k in removed},
            'shared_non_subscription_tables_compared': len(shared), 'unequal_shared_tables': unequal,
            'full_schema_sections_equal': {k: expected['schema'][k] == v for k, v in current['schema'].items()},
            'roles_equal': expected['roles'] == current['roles'], 'additional_acl_settings_equal': expected['additional_privileges'] == current['additional_privileges'],
            'routing_equal': expected['routing'] == current['routing'], 'ancillary_equal': expected['ancillary'] == current['ancillary'],
            'state': current['state'], 'sequences': current['sequences'],
            'live_subscription_scope': {k: platform['subscriptions'][k] for k in ('count', 'invalid_rows')}}
        # These are explicit diagnostic comparisons while the full gate stays FAIL.
        m.need(not unequal and not added and removed == ['"realtime"."messages_2026_10_14"'] and
               record['postgres']['roles_equal'] and record['postgres']['additional_acl_settings_equal'] and
               record['postgres']['routing_equal'] and record['postgres']['ancillary_equal'], 'DAR_UNEXPECTED_ADDITIONAL_DIAGNOSTIC_CHANGE')
        with m.backup.Snapshot(m.source_env('_supabase')) as snapshot:
            m.validate_source_identity(m.source_identity(snapshot.query), '_supabase')
            analytical = m.collect(snapshot.query, '_supabase')
        record['analytics'] = {'tables': len(analytical['catalog']), 'logical_rows': sum(x['count'] for x in analytical['rows'].values()),
            'preservation': m.analytics_preservation(analytical), 'backup_or_restore_performed': False}
        record['historical_bundles'] = m.Run.__new__(m.Run).historical()[1]
        record['all_backup_files'] = m.recovery.tree_summary(m.recovery.historical_files(m.backup.BACKUPS / '__none__'))
        m.fences.unchanged_retained(before, m.analytics.project_items())
        original = json.loads((m.ROOT / 'supabase/tests/results/postgres_analytics_recovery_8fa0e0c7.json').read_text())
        m.need([m.base.state(x) for x in before if x['Name'] != '/' + m.base.VECTOR] ==
               [x for x in original['retained_after'] if x['container'] != m.base.VECTOR], 'DAR_OTHER_SERVICE_LIFECYCLE_CHANGED')
        m.need(m.fences.resources() == resources and m.base.credential_metadata() == credential and
               m.fences.vector_config_hash() == m.fences.YAML_SHA, 'DAR_FINAL_RESOURCE_OR_METADATA_CHANGE')
        for run in ('93426091', '8fa0e0c7'):
            data = json.loads((m.ROOT / f'supabase/tests/results/postgres_analytics_recovery_{run}.json').read_text())
            capsule = m.EncryptedStore(Path(data['directory'])); capsule.artifacts = data['artifacts']
            entry = data['databases']['postgres']['destination']
            dest = m.PrivateDestination(entry, capsule, 'pg', m.analytics.CLUSTER)
            stopped = dest.guard(running=False)
            m.need(not stopped['State']['Running'] and stopped['State']['ExitCode'] == 0, 'DAR_OWNED_CLONE_NOT_STOPPED')
        m.need(all(m.backup.file_sha256(m.ROOT / p) == h for p, h in frozen.items()), 'DAR_FINAL_EXISTING_INPUT_CHANGED')
        m.fences.assert_locks()
        record.update(result='DIAGNOSIS_COMPLETE_RECOVERY_BLOCKED_UNREVIEWED_PRUNING',
            historical_inputs_unchanged=len(frozen), retained_services_and_volume_inventory_unchanged=True,
            both_owned_partial_clones_stopped=True, google_store_metadata_only_unchanged=True,
            all_repair_activation_locks_intact=True, current_inventory_recovery_prerequisites_satisfied=False)
    except Exception as error:
        code = str(error)
        record.update(result='FAIL_READ_ONLY_DIAGNOSIS', failure=code if code.startswith('DAR_') and len(code) < 100 else 'DAR_FINAL_DIAGNOSIS_STOP')
    record['finished_at'] = datetime.now(timezone.utc).isoformat()
    with path.open('x', encoding='utf-8') as handle: json.dump(record, handle, indent=2)
    print(json.dumps({'result': record['result'], 'evidence': path.relative_to(m.ROOT).as_posix()}))


if __name__ == '__main__':
    main()
