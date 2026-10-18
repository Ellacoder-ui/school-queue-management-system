"""Offline privacy and comparison regressions; no database connection."""
import copy
import unittest
import inspect_analytics_recovery as review


class AnalyticsReviewTests(unittest.TestCase):
    def test_compose_only_or_unlabeled_canonical_extra_cannot_be_hidden(self):
        items = [{'Id': 'one', 'Name': '/supabase_vector_school-queue-local'}]
        review.validate_discovery(items, ['one'], ['supabase_vector_school-queue-local'])
        for ids, names in [(['one', 'extra'], ['supabase_vector_school-queue-local']),
                           (['one'], ['supabase_vector_school-queue-local', 'supabase_unknown_school-queue-local']),
                           ([], ['supabase_vector_school-queue-local'])]:
            with self.assertRaisesRegex(RuntimeError, 'VAR_PROJECT_DISCOVERY'):
                review.validate_discovery(items, ids, names)

    def test_identity_requires_primary_read_only_exact_database_cluster_and_version(self):
        valid = {'database': '_supabase', 'cluster': review.CLUSTER, 'version_num': 170011,
                 'read_only': 'on', 'recovery': False}
        review.validate_identity(valid)
        for key, value in [('database', 'postgres'), ('cluster', 'wrong'), ('version_num', 180000),
                           ('read_only', 'off'), ('recovery', True)]:
            with self.subTest(key=key), self.assertRaisesRegex(RuntimeError, 'VAR_DATABASE_IDENTITY'):
                review.validate_identity({**valid, key: value})

    def test_public_log_table_alias_does_not_emit_source_identifier(self):
        name = 'log_events_synthetic-private-source-canary'
        label = review.alias(name)
        self.assertNotIn('synthetic-private-source-canary', label)
        self.assertEqual(label, review.alias(name))
        self.assertNotEqual(label, review.alias(name + '-other'))
        self.assertEqual(review.alias('oban_jobs'), 'oban_jobs')

    def fixture(self):
        tables = [{'schema': '_analytics', 'table': name} for name in ['oban_peers', 'sources']]
        return {'rows': {review.base.backup.table_key(t['schema'], t['table']):
                         {'count': 1, 'sha256': review.digest(t)} for t in tables},
                'catalog': tables, 'metadata': {}, 'roles': {}, 'extra': {}, 'sequences': {}}

    def test_peer_churn_is_reported_without_hiding_other_mutations(self):
        before = self.fixture(); after = copy.deepcopy(before)
        for value in after['rows'].values(): value['sha256'] = review.digest('changed')
        result = review.compare(before, after)
        self.assertEqual(len(result['changed_tables']), 2)
        self.assertEqual({x['table'] for x in result['changed_tables']}, {'_analytics.oban_peers', '_analytics.sources'})

    def test_catalog_security_roles_settings_and_sequences_have_no_runtime_exemption(self):
        before = self.fixture()
        for section, flag in [('catalog', 'catalog_equal'), ('metadata', 'schema_security_equal'),
                              ('roles', 'roles_equal'), ('extra', 'additional_privileges_settings_equal'),
                              ('sequences', 'sequences_equal')]:
            after = copy.deepcopy(before)
            if section == 'catalog':
                after[section][0]['owner'] = 'changed-owner'
            else:
                after[section] = {'changed': True}
            self.assertFalse(review.compare(before, after)[flag])

    def test_removed_table_is_a_named_difference(self):
        before = self.fixture(); after = copy.deepcopy(before)
        after['rows'].pop(next(iter(after['rows'])))
        result = review.compare(before, after)
        self.assertEqual(len(result['changed_tables']), 1)
        self.assertIsNone(result['changed_tables'][0]['after'])

    def test_digest_is_canonical_and_does_not_return_plaintext(self):
        value = {'secret': 'synthetic-canary-never-output', 'n': 2}
        self.assertEqual(review.digest(value), review.digest({'n': 2, 'secret': value['secret']}))
        self.assertRegex(review.digest(value), r'^[0-9a-f]{64}$')
        self.assertNotIn(value['secret'], review.digest(value))


if __name__ == '__main__':
    unittest.main()
