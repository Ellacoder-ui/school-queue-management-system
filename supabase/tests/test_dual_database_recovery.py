"""Synthetic-only tests; no source connection, crypto store or Docker mutation."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import dual_database_recovery as m


def table(name='one', kind='r', parent=None):
    return {'schema': 'synthetic', 'table': name, 'kind': kind, 'is_partition': parent is not None,
            'partition_key': 'RANGE (id)' if kind == 'p' else None, 'bound': 'synthetic bound' if parent else None,
            'parents': [{'schema': 'synthetic', 'table': parent}] if parent else []}


def captured(tables=None):
    tables = tables or [table()]
    return {'catalog': tables, 'rows': {m.backup.table_key(t['schema'], t['table']): {'count': 0, 'rows': []} for t in tables},
            'schema': {'schemas': {}}, 'roles': {}, 'sequences': {}, 'additional_privileges': {}}


class DualRecoveryTests(unittest.TestCase):
    def test_text_transport_inverse_preserves_original_lf_crlf_and_lone_cr(self):
        original = b'function body\noriginal embedded CRLF\r\noriginal CR\rdata\n'
        windows_stdout = original.replace(b'\n', b'\r\n')
        self.assertEqual(m.decoded_text(windows_stdout).encode(), original)

    def completed_capsule(self):
        return {'result': 'FAIL_STOPPED', 'failure': 'DAR_TOOL_DIAGNOSTICS_STOP', 'phase': 'backup-complete-postgres',
            'databases': {'postgres': {'result': 'BACKUP_CREATED_RESTORE_PENDING', 'non_mvcc_fence': 'PASS_STRICT',
                                     'manifest_saved_before_dump': True, 'pg_dump_exit': 0, 'pg_dumpall_exit': 0}}}

    def test_completed_capsule_import_rejects_failed_or_incomplete_dump_fences(self):
        origin = self.completed_capsule(); m.eligible_completed_capsule(origin)
        for key, value in [('non_mvcc_fence', 'FAIL'), ('manifest_saved_before_dump', False), ('pg_dump_exit', 1)]:
            changed = deepcopy(origin); changed['databases']['postgres'][key] = value
            with self.assertRaisesRegex(RuntimeError, 'DUMP_FENCE'): m.eligible_completed_capsule(changed)

    def test_only_known_preexecution_failure_can_have_separate_capsule_verification(self):
        for key, value in [('failure', 'DAR_NON_MVCC_SEQUENCES'), ('phase', 'snapshot-postgres')]:
            changed = self.completed_capsule(); changed[key] = value
            with self.assertRaisesRegex(RuntimeError, 'FAILURE_SCOPE'): m.eligible_completed_capsule(changed)

    def test_windows_toc_text_decoding_preserves_strict_identity_comparison(self):
        catalog = [{'schema': 'synthetic', 'table': 'one', 'owner': 'synthetic_owner'}]
        raw = b'1; 0 0 TABLE DATA synthetic one synthetic_owner\r\n'
        self.assertEqual(m.backup.toc_table_inventory(m.decoded_text(raw), catalog), ['"synthetic"."one"'])
        with self.assertRaisesRegex(RuntimeError, 'Unmatched'):
            m.backup.toc_table_inventory(m.decoded_text(raw.replace(b'one', b'unknown')), catalog)

    def test_windows_role_text_omits_only_existing_create_and_keeps_alter_grant(self):
        raw = b'CREATE ROLE supabase_admin;\r\nALTER ROLE supabase_admin WITH SUPERUSER;\r\nCREATE ROLE synthetic;\r\nGRANT synthetic TO supabase_admin;\r\n'
        prepared = m.internal.prepare_roles(m.decoded_text(raw), ['supabase_admin'])
        self.assertNotIn('CREATE ROLE supabase_admin;', prepared)
        for text in ['ALTER ROLE supabase_admin WITH SUPERUSER;', 'CREATE ROLE synthetic;', 'GRANT synthetic TO supabase_admin;']:
            self.assertIn(text, prepared)

    def test_actual_catalog_drives_count_without_hardcoded_71(self):
        for number in (1, 2, 72): m.validate_catalog(captured([table('t' + str(i)) for i in range(number)]))

    def test_missing_extra_and_duplicate_catalog_rows_fail(self):
        value = captured(); value['rows'] = {}
        with self.assertRaisesRegex(RuntimeError, 'COVERAGE'): m.validate_catalog(value)
        value = captured(); value['catalog'].append(value['catalog'][0])
        with self.assertRaisesRegex(RuntimeError, 'COVERAGE'): m.validate_catalog(value)

    def test_foreign_table_is_not_silently_treated_as_recovered(self):
        with self.assertRaisesRegex(RuntimeError, 'EXTERNAL'): m.validate_catalog(captured([table(kind='f')]))

    def test_partitions_need_bound_and_existing_parent(self):
        m.validate_catalog(captured([table('parent', 'p'), table('leaf', parent='parent')]))
        with self.assertRaisesRegex(RuntimeError, 'PARTITION'): m.validate_catalog(captured([table('leaf', parent='absent')]))

    def test_cloned_operational_rows_are_exact_without_exemption(self):
        for name in ('oban_jobs', 'oban_peers', 'subscription'):
            original = captured([table(name)]); changed = deepcopy(original)
            next(iter(changed['rows'].values()))['count'] = 1
            with self.assertRaisesRegex(RuntimeError, 'CLONE_ROWS'): m.exact_restore({'captured': original}, changed)

    def test_clone_sequences_roles_and_security_are_exact(self):
        original = captured()
        for section in ('schema', 'roles', 'sequences', 'additional_privileges'):
            changed = deepcopy(original); changed[section] = {'different': True}
            with self.assertRaisesRegex(RuntimeError, 'CLONE_'): m.exact_restore({'captured': original}, changed)

    def test_non_mvcc_drift_stops_for_each_required_category(self):
        original = {k: {} for k in ('roles', 'sequences', 'additional_privileges')}
        m.assert_fence(original, deepcopy(original))
        for section in original:
            changed = deepcopy(original); changed[section] = {'changed': 1}
            with self.assertRaisesRegex(RuntimeError, 'NON_MVCC_' + section.upper()): m.assert_fence(original, changed)

    def test_source_identity_requires_primary_read_only_exact_cluster(self):
        source = {'database': '_supabase', 'cluster': m.analytics.CLUSTER, 'version': '17.11', 'readonly': 'on', 'recovery': False}
        m.validate_source_identity(source, '_supabase')
        for key in source:
            changed = {**source, key: 'other'}
            with self.assertRaisesRegex(RuntimeError, 'SOURCE_IDENTITY'): m.validate_source_identity(changed, '_supabase')

    def test_nonloopback_target_is_refused(self):
        with patch.object(m.backup, 'target', return_value=({}, {'PGHOST': 'remote.invalid', 'PGPORT': '54322'}, {})):
            with self.assertRaisesRegex(RuntimeError, 'LOOPBACK'): m.source_env('_supabase')

    def test_crypto_names_cannot_select_google_or_parent_paths(self):
        store = m.EncryptedStore(Path('synthetic'))
        for name in ('../google-local.dpapi', 'C:/secrets.dpapi', 'safe.dpapi\n', ''):
            with self.assertRaisesRegex(RuntimeError, 'ARTIFACT_NAME'): store.crypto('open', name, 'synthetic')

    def test_store_refuses_overwrite_before_running_crypto(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); (root / 'existing.dpapi').write_bytes(b'synthetic')
            with self.assertRaisesRegex(RuntimeError, 'EXISTS'): m.EncryptedStore(root).put('existing.dpapi', 'synthetic', b'new')
            self.assertEqual((root / 'existing.dpapi').read_bytes(), b'synthetic')

    def test_oversized_plaintext_stops_before_private_child_execution(self):
        with patch.object(m, 'command') as command:
            with self.assertRaisesRegex(RuntimeError, 'PLAINTEXT_BOUND'):
                m.EncryptedStore(Path('synthetic')).crypto('protect', 'dummy.dpapi', 'synthetic', bytes(m.LIMIT + 1))
            command.assert_not_called()

    def test_destination_cannot_select_retained_container(self):
        dest = m.PrivateDestination({'container': 'supabase_db_school-queue-local', 'volume': 'supabase_db_school-queue-local'}, m.EncryptedStore(Path('synthetic')), 'pg', m.analytics.CLUSTER)
        with self.assertRaisesRegex(RuntimeError, 'new internal restore'): dest.guard()

    def test_destination_has_no_plaintext_file_or_implicit_database_channel(self):
        dest = m.PrivateDestination({}, m.EncryptedStore(Path('synthetic')), 'pg', m.analytics.CLUSTER)
        with self.assertRaisesRegex(RuntimeError, 'CHANNEL'): dest.psql('other', sql='select 1')
        with self.assertRaisesRegex(RuntimeError, 'CHANNEL'): dest.psql('postgres', file='/tmp/plain.sql')

    def analytics_fixture(self):
        value = captured([table('config'), table('oban_jobs'), table('oban_peers')])
        value['sequences'] = {'"_analytics"."oban_jobs_id_seq"': {'last_value': 1, 'is_called': True}}
        baseline = {'table_count': len(value['catalog']), 'catalog_sha256': m.analytics.digest(value['catalog']),
                    'metadata': {k: {'count': len(v), 'sha256': m.analytics.digest(v)} for k, v in value['schema'].items()},
                    'roles': {'sha256': m.analytics.digest(value['roles'])},
                    'additional': {k: {'count': len(v), 'sha256': m.analytics.digest(v)} for k, v in value['additional_privileges'].items()},
                    'sequences': deepcopy(value['sequences']), 'tables': [
                        {'identity_sha256': m.analytics.digest(key), 'table': t['table'], 'count': 0, 'sha256': m.analytics.digest([])}
                        for key, t in zip(value['rows'], value['catalog'])]}
        return value, baseline

    def test_live_job_and_peer_observation_cannot_hide_configuration_change(self):
        value, baseline = self.analytics_fixture()
        value['rows']['"synthetic"."oban_jobs"'] = {'count': 1, 'rows': ['synthetic-hash']}
        self.assertEqual(len(m.analytics_preservation(value, baseline)['narrow_operational_row_changes']), 1)
        value['rows']['"synthetic"."config"']['count'] = 1
        with self.assertRaisesRegex(RuntimeError, 'UNREVIEWED_ROW'): m.analytics_preservation(value, baseline)

    def test_live_analytics_security_change_is_never_operational(self):
        value, baseline = self.analytics_fixture(); value['schema']['schemas']['extra-grant'] = True
        with self.assertRaisesRegex(RuntimeError, 'SECURITY_CHANGED'): m.analytics_preservation(value, baseline)

    def test_live_job_sequence_regression_is_rejected(self):
        value, baseline = self.analytics_fixture(); value['sequences']['"_analytics"."oban_jobs_id_seq"']['last_value'] = 0
        with self.assertRaisesRegex(RuntimeError, 'REGRESSION'): m.analytics_preservation(value, baseline)


if __name__ == '__main__':
    unittest.main()
