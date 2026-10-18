"""Offline 70-table recovery comparisons; no database, Docker or credential access."""
from copy import deepcopy
import unittest
from unittest.mock import patch

import pre_google_oauth_recovery as recovery


class PreGoogleRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.source = deepcopy(recovery.reference()['source'])
        self.manifest = {key: self.source[key] for key in recovery.SECTIONS - {'routing'}}
        self.manifest['routing'] = {'constraints': {key: recovery.prior.cutover.expected_constraint(key)
            for key in set(recovery.prior.cutover.NEW_CONSTRAINTS) | set(recovery.prior.cutover.NEW_CONSTRAINT_TRIGGERS)},
            'triggers': {key: {**recovery.prior.cutover.expected_trigger(key), 'enabled': 'O',
                'definition': recovery.prior.cutover.expected_trigger_definition(key)} for key in recovery.prior.cutover.NEW_TRIGGERS}}

    def test_exact_reviewed_seventy_table_catalog(self):
        recovery.validate_inventory(self.manifest)
        self.assertEqual(len(self.manifest['rows']), 70)
        self.assertEqual(sum(t['is_partition'] for t in self.manifest['catalog']), 7)

    def test_old_sixty_nine_table_inventory_rejected(self):
        changed = deepcopy(self.manifest)
        changed['rows'].pop('"realtime"."messages_2026_10_20"')
        changed['catalog'] = [t for t in changed['catalog'] if t['table'] != 'messages_2026_10_20']
        with self.assertRaises(RuntimeError): recovery.validate_inventory(changed)

    def test_same_count_different_table_rejected(self):
        changed = deepcopy(self.manifest)
        changed['rows']['"realtime"."unknown"'] = changed['rows'].pop('"realtime"."messages_2026_10_20"')
        with self.assertRaises(RuntimeError): recovery.validate_inventory(changed)

    def test_partition_owner_bound_and_ancestry_rejected(self):
        for field, value in [('owner', 'postgres'), ('bound', 'DEFAULT'), ('parents', [])]:
            changed = deepcopy(self.manifest)
            leaf = next(t for t in changed['catalog'] if t['table'] == 'messages_2026_10_20')
            leaf[field] = value
            with self.subTest(field=field), self.assertRaises(RuntimeError): recovery.validate_inventory(changed)

    def test_message_data_is_never_exempted(self):
        changed = deepcopy(self.manifest)
        changed['rows']['"realtime"."messages_2026_10_20"'] = {'count': 1, 'rows': ['canary']}
        with self.assertRaises(RuntimeError): recovery.validate_inventory(changed)

    def test_history_routing_rls_and_active_work_guards(self):
        for field, value in [('versions', ['unexpected']), ('routes', {}), ('active', 1), ('open_days', 1),
                             ('rls_count', 14), ('private_usage', True), ('publication', ['queue_private.tickets'])]:
            changed = deepcopy(self.manifest); changed['state'][field] = value
            with self.subTest(field=field), self.assertRaises(RuntimeError): recovery.validate_inventory(changed)

    def test_exact_restore_passes_without_exemptions(self):
        recovery.compare_restored(self.manifest, deepcopy(self.manifest))

    def test_restored_subscriptions_must_match_exactly(self):
        observed = deepcopy(self.manifest)
        observed['rows'][recovery.realtime.SUBSCRIPTION] = {'count': 0, 'rows': []}
        with self.assertRaises(RuntimeError): recovery.compare_restored(self.manifest, observed)

    def test_restored_realtime_sequence_must_match_exactly(self):
        observed = deepcopy(self.manifest)
        observed['sequences'][recovery.realtime.REALTIME_SEQUENCE]['last_value'] += 1
        with self.assertRaises(RuntimeError): recovery.compare_restored(self.manifest, observed)

    def test_missing_restore_sections_or_rows_fail(self):
        for section in recovery.SECTIONS:
            observed = deepcopy(self.manifest); observed.pop(section)
            with self.subTest(section=section), self.assertRaises(RuntimeError): recovery.compare_restored(self.manifest, observed)
        observed = deepcopy(self.manifest); observed['rows'].pop('"auth"."users"')
        with self.assertRaises(RuntimeError): recovery.compare_restored(self.manifest, observed)

    def test_all_security_metadata_is_exact_on_restore(self):
        for section in ('schema', 'roles', 'routing', 'additional_privileges', 'catalog'):
            observed = deepcopy(self.manifest)
            if section == 'catalog': observed[section][0]['owner'] = 'wrong'
            else: observed[section]['unexpected'] = 'canary'
            with self.subTest(section=section), self.assertRaises(RuntimeError): recovery.compare_restored(self.manifest, observed)

    def test_source_allows_only_scoped_subscription_lifecycle(self):
        observed = deepcopy(self.source)
        observed['rows'][recovery.realtime.SUBSCRIPTION] = {'count': 0, 'rows': []}
        observed['platform']['subscriptions'].update(count=0, max_id=0)
        observed['sequences'][recovery.realtime.REALTIME_SEQUENCE]['last_value'] += 1
        result = recovery.compare_source(self.source, observed)
        self.assertEqual(result['result'], 'PASS')
        self.assertEqual(result['subscription_rows_after'], 0)

    def test_subscription_changes_cannot_mask_auth_or_business_mutation(self):
        for table in ('"auth"."users"', '"queue_private"."accounts"', '"queue_private"."tickets"',
                      '"queue_private"."operation_requests"', '"supabase_migrations"."schema_migrations"'):
            observed = deepcopy(self.source)
            observed['rows'][recovery.realtime.SUBSCRIPTION] = {'count': 0, 'rows': []}
            observed['platform']['subscriptions'].update(count=0, max_id=0)
            observed['rows'][table]['rows'].append('PRIVATE-CANARY')
            with self.subTest(table=table), self.assertRaises(recovery.realtime.PreservationError) as caught:
                recovery.compare_source(self.source, observed)
            self.assertNotIn('PRIVATE-CANARY', str(caught.exception))

    def test_source_scope_evidence_and_other_sequences_are_mandatory(self):
        for mutate in (lambda s: s['platform']['subscriptions'].update(invalid_rows=1),
                       lambda s: s.pop('platform'),
                       lambda s: s['sequences']['"auth"."refresh_tokens_id_seq"'].update(last_value=9999999)):
            observed = deepcopy(self.source); mutate(observed)
            with self.assertRaises(recovery.realtime.PreservationError): recovery.compare_source(self.source, observed)

    def test_recovery_identity_is_new_without_creating_resources(self):
        run = recovery.Run()
        self.assertTrue(run.directory.name.startswith('pre_google_'))
        self.assertEqual(run.directory.parent, recovery.backup.BACKUPS)
        self.assertFalse(run.directory.exists())
        self.assertFalse(run.evidence.exists())
        with patch.object(recovery.Path, 'exists', return_value=True):
            with self.assertRaises(RuntimeError): recovery.Run()

    def test_modified_preparation_reference_rejected(self):
        with patch.object(recovery.backup, 'file_sha256', return_value='0' * 64):
            with self.assertRaises(RuntimeError): recovery.reference()


if __name__ == '__main__':
    unittest.main()
