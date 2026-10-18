"""Synthetic-only negative tests for the fixed historical recovery entry point."""
from copy import deepcopy
import unittest

import restore_historical_postgres_71 as h


def origin():
    artifacts = {name: {'database': 'postgres', 'plain_sha256': 'a' * 64} for name in h.INPUTS}
    artifacts['pg_manifest.dpapi']['plain_sha256'] = h.MANIFEST_SHA
    artifacts['pg_archive.dpapi']['plain_sha256'] = h.ARCHIVE_SHA
    return {'run_id': h.ORIGIN_ID, 'directory': str(h.ORIGIN_DIRECTORY), 'result': 'FAIL_STOPPED',
        'failure': 'DAR_TOOL_DIAGNOSTICS_STOP', 'phase': 'backup-complete-postgres', 'artifacts': artifacts,
        'databases': {'postgres': {'result': 'BACKUP_CREATED_RESTORE_PENDING', 'non_mvcc_fence': 'PASS_STRICT',
            'manifest_saved_before_dump': True, 'pg_dump_exit': 0, 'pg_dumpall_exit': 0}}}


def manifest():
    catalog = []
    for i in range(71):
        catalog.append({'schema': 'synthetic', 'table': 't' + str(i), 'kind': 'p' if i == 0 else 'r',
            'is_partition': 1 <= i <= 8, 'partition_key': 'RANGE (id)' if i == 0 else None,
            'bound': 'synthetic one-day bound' if 1 <= i <= 8 else None,
            'parents': [{'schema': 'synthetic', 'table': 't0'}] if 1 <= i <= 8 else []})
    migrations = {f'{i:014d}_synthetic.sql': str(i) for i in range(1, 7)}
    return {'format': 3, 'run_id': h.SNAPSHOT_ID, 'parent_run_id': h.ORIGIN_ID, 'source_database': 'postgres',
        'project': h.m.base.PROJECT, 'workdir': str(h.m.ROOT), 'source_system_identifier': h.m.analytics.CLUSTER,
        'client_endpoint': '127.0.0.1:54322/postgres', 'archive_filename': 'retained_postgres_after_006.dump',
        'migration_file_sha256': migrations, 'captured': {'catalog': catalog,
            'rows': {h.m.backup.table_key(t['schema'], t['table']): {'count': 824 if i == 0 else 0, 'rows': []} for i, t in enumerate(catalog)},
            'state': {'versions': [str(i).zfill(14) for i in range(1, 7)], 'routes': h.m.backup.CANONICAL, 'active': 0, 'open_days': 0}}}


def live():
    failure = {'result': 'FAIL', 'unexpected_changes': ['synthetic known missing leaf path']}
    return {'strict_classifier': failure, 'removed_tables': ['"realtime"."messages_2026_10_14"'],
            'unequal_shared_non_subscription_tables': [], 'roles_equal': True, 'additional_acl_settings_equal': True,
            'routing_equal': True, 'ancillary_equal': True}


class HistoricalPostgresTests(unittest.TestCase):
    def test_only_fixed_capsule_is_accepted(self):
        h.validate_origin(origin())
        for key, value in [('run_id', '8fa0e0c7'), ('directory', str(h.ORIGIN_DIRECTORY.parent / 'other'))]:
            x = origin(); x[key] = value
            with self.assertRaisesRegex(RuntimeError, 'FIXED_ORIGIN'): h.validate_origin(x)

    def test_missing_or_wrong_purpose_artifacts_fail(self):
        for mode in ('missing', 'wrong-database'):
            x = origin()
            if mode == 'missing': x['artifacts'].pop('pg_schema_sql.dpapi')
            else: x['artifacts']['pg_archive.dpapi']['database'] = '_supabase'
            with self.assertRaisesRegex(RuntimeError, 'PURPOSE_OR_MISSING'): h.validate_origin(x)

    def test_corrupt_manifest_or_archive_binding_fails(self):
        for name in ('pg_manifest.dpapi', 'pg_archive.dpapi'):
            x = origin(); x['artifacts'][name]['plain_sha256'] = 'b' * 64
            with self.assertRaisesRegex(RuntimeError, 'PINNED_ARTIFACTS'): h.validate_origin(x)

    def test_failed_original_consistency_fence_is_not_importable(self):
        x = origin(); x['databases']['postgres']['non_mvcc_fence'] = 'FAIL'
        with self.assertRaisesRegex(RuntimeError, 'DUMP_FENCE'): h.validate_origin(x)

    def test_snapshot_identity_purpose_and_source_mismatches_fail(self):
        h.validate_manifest(manifest())
        for key in ('format', 'run_id', 'parent_run_id', 'source_database', 'project', 'workdir', 'source_system_identifier', 'client_endpoint', 'archive_filename'):
            x = manifest(); x[key] = 'wrong'
            with self.assertRaisesRegex(RuntimeError, 'MANIFEST_BINDING'): h.validate_manifest(x)

    def test_historical_inventory_does_not_shrink_to_live_70(self):
        x = manifest(); last = x['captured']['catalog'].pop()
        x['captured']['rows'].pop(h.m.backup.table_key(last['schema'], last['table']))
        with self.assertRaisesRegex(RuntimeError, 'HISTORICAL_INVENTORY'): h.validate_manifest(x)

    def test_exact_captured_row_total_is_required(self):
        x = manifest(); next(iter(x['captured']['rows'].values()))['count'] -= 1
        with self.assertRaisesRegex(RuntimeError, 'HISTORICAL_INVENTORY'): h.validate_manifest(x)

    def test_missing_partition_attachment_evidence_fails(self):
        x = manifest(); x['captured']['catalog'][1]['is_partition'] = False
        with self.assertRaisesRegex(RuntimeError, 'HISTORICAL_INVENTORY'): h.validate_manifest(x)

    def test_original_migrations_routes_and_work_state_are_required(self):
        for key, value in [('versions', []), ('routes', {}), ('active', 1), ('open_days', 1)]:
            x = manifest(); x['captured']['state'][key] = value
            with self.assertRaisesRegex(RuntimeError, 'HISTORICAL_STATE'): h.validate_manifest(x)

    def test_known_live_failure_remains_failure_and_does_not_require_catalog_equality(self):
        x = live(); accepted = deepcopy(x['strict_classifier'])
        x['logical_tables'] = 70
        h.validate_live_comparison(x, accepted)
        self.assertEqual(x['strict_classifier']['result'], 'FAIL')

    def test_extra_live_deletion_or_changed_application_row_stops(self):
        for key, value in [('removed_tables', ['"realtime"."messages_2026_10_14"', '"auth"."users"']),
                           ('unequal_shared_non_subscription_tables', ['"queue_private"."accounts"'])]:
            x = live(); accepted = deepcopy(x['strict_classifier']); x[key] = value
            with self.assertRaisesRegex(RuntimeError, 'UNEXPECTED_LIVE'): h.validate_live_comparison(x, accepted)

    def test_unknown_live_error_or_security_change_stops(self):
        for key in ('roles_equal', 'additional_acl_settings_equal', 'routing_equal', 'ancillary_equal'):
            x = live(); accepted = deepcopy(x['strict_classifier']); x[key] = False
            with self.assertRaisesRegex(RuntimeError, 'UNEXPECTED_LIVE'): h.validate_live_comparison(x, accepted)
        x = live(); accepted = deepcopy(x['strict_classifier']); x['strict_classifier']['unexpected_changes'].append('unreviewed')
        with self.assertRaisesRegex(RuntimeError, 'UNEXPECTED_LIVE'): h.validate_live_comparison(x, accepted)

    def test_no_source_backup_or_combined_runner_interface_is_inherited(self):
        run = h.HistoricalRun()
        for method in ('capture_backup', 'main_source', 'import_complete_postgres'):
            self.assertFalse(hasattr(run, method))
        self.assertFalse(run.record['current_inventory_recovery_prerequisites_satisfied'])
        self.assertFalse(run.record['analytics_recovery_authorized'])

    def test_exact_clone_comparator_retains_no_maintenance_exemption(self):
        value = {'catalog': [{'schema': 'synthetic', 'table': 'subscription', 'kind': 'r', 'is_partition': False}],
                 'rows': {'"synthetic"."subscription"': {'count': 2, 'rows': ['a', 'b']}}}
        h.m.exact_restore({'captured': value}, deepcopy(value))
        changed = deepcopy(value); changed['rows']['"synthetic"."subscription"'] = {'count': 0, 'rows': []}
        with self.assertRaisesRegex(RuntimeError, 'CLONE_ROWS'): h.m.exact_restore({'captured': value}, changed)


if __name__ == '__main__':
    unittest.main()
