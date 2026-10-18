"""Credential preflight negatives with recorded nonsecret fixtures; never contacts a target."""
from copy import deepcopy
import json
import unittest
from unittest.mock import patch

import google_credential_preflight as gate


class GoogleCredentialPreflightTests(unittest.TestCase):
    def setUp(self):
        self.ref = gate.recovery.reference()
        self.source = deepcopy(self.ref['source'])
        self.manifest = {**deepcopy(self.source), 'source': deepcopy(self.source['identity']),
                         'source_system_identifier': self.source['system_identifier'],
                         'auth_nonsecret_settings': deepcopy(self.ref['inspection_checks']['auth_nonsecret_settings'])}
        self.checks = {'google_provider_enabled': False, 'auth_nonsecret_settings': deepcopy(self.manifest['auth_nonsecret_settings'])}

    def test_reviewed_source_receipt(self):
        self.assertEqual(gate.validate_bound_source(self.manifest, self.source, self.checks)['result'], 'PASS')

    def test_wrong_project_rejected(self):
        self.source['identity']['project'] = 'other-project'
        with self.assertRaises(RuntimeError): gate.validate_bound_source(self.manifest, self.source, self.checks)

    def test_hosted_and_wrong_loopback_origins_rejected_before_any_io(self):
        for url in ('https://example.supabase.co', 'http://localhost:54321', 'http://127.0.0.1:9999'):
            source = deepcopy(self.source); source['identity']['api'] = url
            with self.subTest(url=url), self.assertRaises(RuntimeError): gate.validate_bound_source(self.manifest, source, self.checks)

    def test_wrong_database_endpoint_rejected(self):
        self.source['identity']['database_endpoint'] = '192.0.2.1:5432'
        with self.assertRaises(RuntimeError): gate.validate_bound_source(self.manifest, self.source, self.checks)

    def test_wrong_cluster_rejected(self):
        self.source['system_identifier'] = '123'
        with self.assertRaises(RuntimeError): gate.validate_bound_source(self.manifest, self.source, self.checks)

    def test_wrong_volume_or_network_rejected(self):
        for key, value in [('volumes', ['other-volume']), ('networks', ['other-network'])]:
            source = deepcopy(self.source); source['identity']['docker'][0][key] = value
            with self.subTest(key=key), self.assertRaises(RuntimeError): gate.validate_bound_source(self.manifest, source, self.checks)

    def test_enabled_provider_or_changed_auth_settings_rejected(self):
        self.checks['google_provider_enabled'] = True
        with self.assertRaises(RuntimeError): gate.validate_bound_source(self.manifest, self.source, self.checks)
        self.checks['google_provider_enabled'] = False
        self.checks['auth_nonsecret_settings']['GOTRUE_SITE_URL'] = 'http://127.0.0.1:5173'
        with self.assertRaises(RuntimeError): gate.validate_bound_source(self.manifest, self.source, self.checks)

    def test_security_and_business_data_changes_rejected(self):
        for mutate in (lambda s: s['state'].update(active=1), lambda s: s['state'].update(rls_count=14),
                       lambda s: s['rows']['"auth"."users"']['rows'].append('PRIVATE-CANARY')):
            source = deepcopy(self.source); mutate(source)
            with self.assertRaises(RuntimeError) as caught: gate.validate_bound_source(self.manifest, source, self.checks)
            self.assertNotIn('PRIVATE-CANARY', str(caught.exception))

    def test_wrong_configuration_fails_before_live_source_read(self):
        def digest(path):
            return gate.EVIDENCE_SHA256 if path == gate.EVIDENCE else '0' * 64
        with patch.object(gate.recovery.backup, 'file_sha256', side_effect=digest), patch.object(gate.recovery, 'inspect_source') as inspect:
            with self.assertRaises(RuntimeError): gate.check()
            inspect.assert_not_called()

    def test_missing_recovery_artifact_fails_before_live_source_read(self):
        with patch.object(gate.recovery.Run, 'verify_bundle', side_effect=FileNotFoundError), patch.object(gate.recovery, 'inspect_source') as inspect:
            with self.assertRaises(FileNotFoundError): gate.check()
            inspect.assert_not_called()

    def test_wrong_recovery_evidence_rejected(self):
        with patch.object(gate.recovery.backup, 'file_sha256', return_value='0' * 64), patch.object(gate.recovery, 'inspect_source') as inspect:
            with self.assertRaises(RuntimeError): gate.check()
            inspect.assert_not_called()

    def test_public_helpers_default_to_preview_and_require_explicit_activation_confirmation(self):
        root = gate.ROOT
        start = (root / 'scripts/Start-LocalGoogleAuth.ps1').read_text()
        module = (root / 'scripts/LocalGoogleCredential.psm1').read_text()
        self.assertIn("DefaultParameterSetName='Preview'", start)
        self.assertIn('$ApprovedPlanSha256', start)
        self.assertIn('if (-not $ConfirmRetainedLocalServiceRestart)', start)
        self.assertNotIn('SetEnvironmentVariable', module)
        self.assertNotIn('Start-Process', module)
        preview = module.split('function Invoke-LocalGoogleAuthPreview', 1)[1]
        self.assertNotIn('.Start()', preview)
        self.assertNotIn('VITE_GOOGLE', module)
        self.assertIn('Assert-LCGReadArguments $Kind $Arguments $Target', module)
        self.assertIn('[IO.FileMode]::CreateNew', module)


if __name__ == '__main__':
    unittest.main()
