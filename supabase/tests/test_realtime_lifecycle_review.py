"""Offline synthetic security and byte-transport regressions. No I/O adapters."""
from copy import deepcopy
import hashlib
import random
import unittest
from unittest.mock import patch

import dual_database_recovery as recovery
import realtime_lifecycle_review as m


def fixture():
    return {'schema': 'realtime', 'name': 'messages_2026_10_14', 'parent': 'realtime.messages',
            'start': '2026-10-14', 'end': '2026-10-15', 'owner': 'supabase_realtime_admin',
            'count': 0, 'row_hashes': [], 'acl': ['synthetic exact grantor/options'],
            'columns': ['synthetic exact column/type/default'], 'constraints': ['synthetic pk/check'],
            'indexes': ['synthetic exact index ancestry'], 'security': {'rls': False, 'browser_access': False}}


class LifecycleReviewTests(unittest.TestCase):
    def review(self, leaf=None, clock='2026-10-18T05:30:00+00:00', pin=m.PIN):
        return m.pruning_review(leaf or fixture(), fixture(), clock, pin)

    def test_old_empty_snapshot_never_proves_safe_deletion(self):
        result = self.review()
        self.assertEqual(result['decision'], 'RETENTION_CANDIDATE_ONLY_SAFETY_UNPROVEN')
        self.assertFalse(result['production_preservation_pass'])
        self.assertFalse(result['deletion_authorized'])

    def test_cutoff_is_utc_date_not_local_day(self):
        result = self.review(clock='2026-10-18T00:30:00+08:00')
        self.assertEqual(result['decision'], 'REJECT_WITHIN_RETENTION_WINDOW')

    def test_cutoff_day_is_retained_until_following_utc_day(self):
        self.assertEqual(self.review(clock='2026-10-17T23:59:59+00:00')['decision'], 'REJECT_WITHIN_RETENTION_WINDOW')

    def test_application_table_cannot_be_retention_candidate(self):
        x = fixture(); x.update(schema='queue_private', name='tickets')
        self.assertFalse(m.pruning_review(x, x, '2026-10-18T00:00:00+00:00', m.PIN)['deletion_authorized'])
        self.assertTrue(m.pruning_review(x, x, '2026-10-18T00:00:00+00:00', m.PIN)['decision'].startswith('REJECT'))

    def test_nonempty_historical_leaf_is_rejected_even_with_matching_template(self):
        x = fixture(); x.update(count=1, row_hashes=['synthetic'])
        self.assertEqual(m.pruning_review(x, x, '2026-10-18T00:00:00+00:00', m.PIN)['decision'], 'REJECT_RETAINED_ROWS_OR_MISSING_EVIDENCE')

    def test_null_or_boolean_count_is_not_empty_proof(self):
        for count in (None, False):
            x = fixture(); x['count'] = count
            self.assertTrue(m.pruning_review(x, x, '2026-10-18T00:00:00+00:00', m.PIN)['decision'].startswith('REJECT'))

    def test_unknown_owner_parent_and_bounds_fail(self):
        for key, value in [('owner', 'postgres'), ('parent', 'other.messages'), ('end', '2026-10-16')]:
            x = fixture(); x[key] = value
            self.assertTrue(m.pruning_review(x, x, '2026-10-18T00:00:00+00:00', m.PIN)['decision'].startswith('REJECT'))

    def test_acl_columns_indexes_and_constraints_cannot_disappear(self):
        for field in ('acl', 'columns', 'constraints', 'indexes', 'security'):
            x = fixture(); x.pop(field)
            self.assertEqual(self.review(x)['decision'], 'REJECT_IDENTITY_OR_EXACT_TEMPLATE')

    def test_unknown_image_or_release_fails(self):
        for i in range(3):
            pin = list(m.PIN); pin[i] = 'unreviewed'
            self.assertEqual(self.review(pin=tuple(pin))['decision'], 'REJECT_IDENTITY_OR_EXACT_TEMPLATE')

    def test_unzoned_clock_and_invalid_date_fail(self):
        self.assertEqual(self.review(clock='2026-10-18T05:30:00')['decision'], 'REJECT_NAME_OR_CLOCK')
        x = fixture(); x['name'] = 'messages_2026_02_30'
        self.assertEqual(m.pruning_review(x, x, '2026-10-18T00:00:00+00:00', m.PIN)['decision'], 'REJECT_NAME_OR_CLOCK')

    def test_historical_71_table_review_has_no_live_inventory_dependency(self):
        result = m.historical_review({'source_database': 'postgres', 'captured': {'catalog': [fixture()] * 71}}, 'a' * 64, 'a' * 64)
        self.assertEqual(result['historical_tables'], 71)
        self.assertTrue(result['eligible_for_separately_authorized_isolated_verification'])
        self.assertFalse(result['recoverability_verified'])
        self.assertFalse(result['current_inventory_recovery_prerequisite_satisfied'])

    def test_archive_checksum_or_database_change_rejects_review(self):
        for db, actual in [('postgres', 'b' * 64), ('_supabase', 'a' * 64)]:
            with self.assertRaisesRegex(ValueError, 'HISTORICAL_BINDING'):
                m.historical_review({'source_database': db, 'captured': {'catalog': [fixture()]}}, actual, 'a' * 64)

    def test_native_text_inverse_preserves_mixed_sql_and_copy_escapes(self):
        original = "CREATE FUNCTION unicode_body() AS $$\nα\r\nβ\rγ\n$$ LANGUAGE sql;\nCOPY synthetic FROM stdin;\na\\r\\n\\t\\\\\t☃\n\\.\n".encode('utf-8')
        expanded = original.replace(b'\n', b'\r\n')
        self.assertEqual(recovery.decoded_text(expanded).encode('utf-8'), original)

    def test_text_inverse_property_for_random_unicode_and_newlines(self):
        rng = random.Random(2208)
        for _ in range(128):
            original = ''.join(rng.choice(['a', '\r', '\n', '\t', 'ñ', '字', '\\n']) for _ in range(200)).encode()
            self.assertEqual(recovery.decoded_text(original.replace(b'\n', b'\r\n')).encode(), original)

    def test_text_decoder_requires_valid_utf8_and_is_not_binary_archive_decoder(self):
        with self.assertRaises(UnicodeDecodeError):
            recovery.decoded_text(b'PGDMP\xff\x00')

    def test_unexpanded_original_crlf_would_be_changed_so_mode_must_be_proven(self):
        original = b'embedded original\r\n'
        self.assertNotEqual(recovery.decoded_text(original).encode(), original)

    def test_binary_store_get_is_identity_and_never_calls_text_decoder(self):
        import base64
        payload = b'PGDMP\x00\xff\r\n\x00\r\r\n'
        meta = {'database': 'postgres', 'plain_bytes': len(payload), 'plain_sha256': hashlib.sha256(payload).hexdigest(), 'cipher_sha256': 'f' * 64}
        store = recovery.EncryptedStore(recovery.ROOT / 'synthetic-never-created')
        store.artifacts = {'pg_archive.dpapi': meta}
        with patch.object(store, 'crypto', return_value={'data': base64.b64encode(payload).decode()}), patch.object(recovery.backup, 'file_sha256', return_value='f' * 64), patch.object(recovery, 'decoded_text', side_effect=AssertionError('binary transformed')):
            self.assertEqual(store.get('pg_archive.dpapi', 'postgres'), payload)


if __name__ == '__main__':
    unittest.main()
