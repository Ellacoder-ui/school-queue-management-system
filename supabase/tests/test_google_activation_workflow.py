"""Offline activation policy/configuration tests; no Docker or retained write calls."""
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import google_activation_workflow as flow


class ActivationWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.original = (flow.ROOT / 'supabase/config.toml').read_bytes()
        self.proposed = flow.candidate(self.original)
        service = {'image': 'reviewed-image', 'image_id': 'sha256:reviewed', 'id': 'old',
                   'started_at': 'before', 'restart_count': 0, 'ports': {'5432/tcp': []},
                   'active_ports': {'5432/tcp': []}, 'networks': [flow.NETWORK],
                   'mounts': [{'Type': 'volume', 'Name': 'supabase_db_school-queue-local'}],
                   'environment': {'UNCHANGED_SECRET': flow.digest(b'PRIVATE-CANARY')}}
        self.before = {'supabase_auth_school-queue-local': deepcopy(service), 'supabase_db_school-queue-local': deepcopy(service)}
        self.after = deepcopy(self.before)
        auth = self.after['supabase_auth_school-queue-local']['environment']
        auth.update({k: flow.digest(v.encode()) for k, v in flow.AUTH_CHANGES.items()})
        auth.update({k: flow.digest(b'dummy-only') for k in flow.PROVIDER_KEYS})

    def test_exact_config_and_unchanged_unrelated_sections(self):
        flow.validate_config(self.original, self.proposed)
        self.assertTrue(self.proposed.startswith(self.original.rstrip()))
        self.assertEqual(self.proposed.count(b'[auth]\n'), 1)
        self.assertEqual(self.proposed.count(b'[auth.external.google]'), 1)

    def test_changed_original_config_rejected(self):
        with self.assertRaises(RuntimeError): flow.candidate(self.original + b'\n')

    def test_duplicate_sections_rejected(self):
        with self.assertRaises(RuntimeError): flow.validate_config(self.original, self.proposed + b'\n[auth]\n')

    def test_existing_auth_section_requires_separate_review(self):
        with self.assertRaises(RuntimeError): flow.validate_config(self.proposed, self.proposed)

    def test_unrelated_api_database_seed_settings_rejected(self):
        for old, new in [(b'54322', b'54323'), (b'queue_display', b'queue_private'), (b'[db.seed]\nenabled = false', b'[db.seed]\nenabled = true')]:
            with self.subTest(old=old), self.assertRaises(RuntimeError):
                flow.validate_config(self.original, self.proposed.replace(old, new))

    def test_hosted_wildcard_and_wrong_callback_rejected(self):
        for value in [b'https://example.supabase.co', b'http://localhost:5173', b'http://127.0.0.1:5173/*']:
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                flow.validate_config(self.original, self.proposed.replace(b'http://127.0.0.1:5173', value))

    def test_literal_or_different_secret_reference_rejected(self):
        for value in [b'PRIVATE-CANARY', b'env(VITE_GOOGLE_SECRET)', b'env(OTHER_SECRET)']:
            with self.assertRaises(RuntimeError) as error:
                flow.validate_config(self.original, self.proposed.replace(b'env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET)', value))
            self.assertNotIn('PRIVATE-CANARY', str(error.exception))

    def test_nonce_email_linking_and_mfa_relaxations_rejected(self):
        for changed in [self.proposed.replace(b'skip_nonce_check = false', b'skip_nonce_check = true'),
                        self.proposed.replace(b'email_optional = false', b'email_optional = true'),
                        self.proposed.replace(b'enable_manual_linking = false', b'enable_manual_linking = true'),
                        self.proposed + b'\n[auth.mfa.totp]\nenroll_enabled = false\n']:
            with self.assertRaises(RuntimeError): flow.validate_config(self.original, changed)

    def test_only_exact_authorized_service_environment_delta_passes(self):
        flow.compare_services(self.before, self.after, True)

    def test_jwt_or_email_environment_change_rejected_without_value_disclosure(self):
        for name in ['UNCHANGED_SECRET', 'GOTRUE_MAILER_AUTOCONFIRM', 'GOTRUE_MFA_TOTP_VERIFY_ENABLED']:
            current = deepcopy(self.after)
            current['supabase_auth_school-queue-local']['environment'][name] = 'PRIVATE-CANARY'
            with self.assertRaises(RuntimeError) as error: flow.compare_services(self.before, current, True)
            self.assertNotIn('PRIVATE-CANARY', str(error.exception))

    def test_non_auth_environment_change_rejected(self):
        self.after['supabase_db_school-queue-local']['environment']['NEW'] = 'hash'
        with self.assertRaises(RuntimeError): flow.compare_services(self.before, self.after, True)

    def test_service_addition_removal_image_mount_network_binding_change_rejected(self):
        for key in ['image', 'image_id', 'ports', 'active_ports', 'mounts', 'networks']:
            current = deepcopy(self.after); current['supabase_db_school-queue-local'][key] = 'unexpected'
            with self.subTest(key=key), self.assertRaises(RuntimeError): flow.compare_services(self.before, current, True)
        for current in [{}, {**self.after, 'unexpected': self.after['supabase_db_school-queue-local']}]:
            with self.assertRaises(RuntimeError): flow.compare_services(self.before, current, True)

    def test_container_ids_may_change_but_not_security_or_data_bindings(self):
        for item in self.after.values(): item.update(id='new', started_at='later', restart_count=0)
        flow.compare_services(self.before, self.after, True)

    def test_missing_provider_credentials_rejected(self):
        for key in flow.PROVIDER_KEYS:
            current = deepcopy(self.after); current['supabase_auth_school-queue-local']['environment'].pop(key)
            with self.assertRaises(RuntimeError): flow.compare_services(self.before, current, True)

    def test_rollback_requires_exact_original_environment(self):
        flow.compare_services(self.before, self.before, False)
        with self.assertRaises(RuntimeError): flow.compare_services(self.before, self.after, False)

    def test_missing_wrong_or_recreated_volume_rejected(self):
        expected = [{'Name': 'supabase_db_school-queue-local', 'CreatedAt': 'old'}]
        flow.validate_volumes(expected, deepcopy(expected))
        for actual in [[], [{'Name': 'other'}], [{'Name': expected[0]['Name'], 'CreatedAt': 'new'}]]:
            with self.assertRaises(RuntimeError): flow.validate_volumes(expected, actual)

    def test_run_identity_rejects_traversal_and_control_characters(self):
        for value in ['../path', 'ABCDEF12', 'abcd1234\n', 'abcd1234/other', '']:
            with self.assertRaises(RuntimeError): flow.directory(value)

    def test_approval_rejected_before_service_or_config_operation(self):
        with patch.object(flow, 'directory', return_value=Path('missing')), patch.object(flow.backup, 'file_sha256', return_value='a' * 64):
            for value in ['', 'a' * 63, 'b' * 64, 'a' * 64 + '\n']:
                with self.assertRaises(RuntimeError): flow.load_plan('abcd1234', value)

    def test_failed_backup_gate_prevents_arming(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            with patch.object(flow.gate, 'check', side_effect=RuntimeError('dummy backup failure')), patch.object(flow, 'services') as services:
                with self.assertRaises(RuntimeError): flow.pre_apply(path, {'config_original_sha256': flow.digest(self.original)}, {})
                self.assertFalse((path / 'activation.json').exists()); services.assert_not_called()

    def test_repeat_activation_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp); (path / 'activation.json').write_text('{}')
            with patch.object(flow.gate, 'check') as gate:
                with self.assertRaises(RuntimeError): flow.pre_apply(path, {}, {})
                gate.assert_not_called()

    def test_atomic_disposable_config_write_and_exact_rollback(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp); config = path / 'live.toml'; config.write_bytes(self.original)
            (path / 'config.proposed.toml').write_bytes(self.proposed); (path / 'config.original.toml').write_bytes(self.original)
            (path / 'activation.json').write_text('{}')
            plan = {'run_id': 'abcd1234', 'config_original_sha256': flow.digest(self.original), 'config_proposed_sha256': flow.digest(self.proposed)}
            with patch.object(flow, 'CONFIG', config):
                flow.config_write(path, plan); self.assertEqual(config.read_bytes(), self.proposed)
                flow.config_write(path, plan, original=True); self.assertEqual(config.read_bytes(), self.original)
                flow.config_write(path, plan, original=True); self.assertEqual(config.read_bytes(), self.original)

    def test_concurrent_or_unarmed_configuration_change_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp); config = path / 'live.toml'; config.write_bytes(self.original)
            plan = {'config_original_sha256': flow.digest(self.original), 'config_proposed_sha256': flow.digest(self.proposed)}
            with patch.object(flow, 'CONFIG', config):
                with self.assertRaises(RuntimeError): flow.config_write(path, plan)
                (path / 'activation.json').write_text('{}'); config.write_bytes(b'unreviewed')
                with self.assertRaises(RuntimeError): flow.config_write(path, plan)
                self.assertEqual(config.read_bytes(), b'unreviewed')

    def test_preparation_requires_empty_new_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp); (path / 'prior').write_text('retained')
            with patch.object(flow, 'directory', return_value=path), patch.object(flow.gate, 'check') as gate:
                with self.assertRaises(RuntimeError): flow.prepare('abcd1234')
                gate.assert_not_called()

    def test_stored_original_config_never_overwritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'original'; flow.write_new(path, self.original)
            with self.assertRaises(FileExistsError): flow.write_new(path, b'changed')
            self.assertEqual(path.read_bytes(), self.original)


if __name__ == '__main__': unittest.main()
