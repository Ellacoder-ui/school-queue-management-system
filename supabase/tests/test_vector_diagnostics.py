"""Synthetic privacy/command-policy cases. No Docker or credential calls."""
import json
import unittest
from unittest.mock import patch

import diagnose_vector_health as diagnosis
import inspect_vector_startup as startup


class VectorDiagnosticTests(unittest.TestCase):
    def test_log_values_urls_authorization_and_private_records_are_not_emitted(self):
        for text in ['ERROR Authorization: Bearer PRIVATE-CANARY',
                     'WARN postgres://user:PRIVATE-CANARY@localhost/db',
                     'configuration error secret=PRIVATE-CANARY email=PRIVATE-CANARY',
                     'ordinary record PRIVATE-CANARY']:
            self.assertNotIn('PRIVATE-CANARY', json.dumps(diagnosis.sanitize_log(text)))

    def test_api_incompatibility_extracts_only_version_numbers(self):
        result = diagnosis.sanitize_log('client version 1.24 is too old. Minimum supported API version is 1.44 PRIVATE-CANARY')
        self.assertEqual(result, {'category': 'docker-api-client-too-old', 'client_api': '1.24', 'minimum_api': '1.44'})

    def test_error_categories_have_no_raw_diagnostic_content(self):
        for text, category in [('permission denied PRIVATE-CANARY', 'permission-denied'),
                               ('Connection refused PRIVATE-CANARY', 'connection-refused'),
                               ('unknown field PRIVATE-CANARY', 'unknown-configuration-field'),
                               ('failed to parse PRIVATE-CANARY', 'parse-error')]:
            self.assertEqual(diagnosis.sanitize_log(text)['category'], category)
            self.assertNotIn('PRIVATE-CANARY', json.dumps(diagnosis.sanitize_log(text)))

    def test_only_valid_leading_timestamp_and_fixed_component_are_preserved(self):
        result = diagnosis.sanitize_log('2026-10-17T10:00:00.123Z ERROR docker_logs PRIVATE-CANARY')
        self.assertEqual(result['timestamp'], '2026-10-17T10:00:00.123Z')
        self.assertEqual(result['component_category'], 'docker_logs')
        self.assertNotIn('PRIVATE-CANARY', json.dumps(result))

    def test_known_credential_free_health_probe_can_be_reported(self):
        test = ['CMD', 'wget', '--no-verbose', '--tries=1', '--spider', 'http://127.0.0.1:9001/health']
        self.assertEqual(diagnosis.safe_health_definition({'Test': test})['test'], test)

    def test_health_headers_credential_urls_and_shell_commands_suppressed(self):
        for command in ['curl -H Authorization:Bearer:PRIVATE-CANARY http://127.0.0.1:9001/health',
                        'curl http://user:PRIVATE-CANARY@127.0.0.1:9001/health',
                        'curl http://127.0.0.1:9001/health;echo PRIVATE-CANARY']:
            result = diagnosis.safe_health_definition({'Test': ['CMD-SHELL', command]})
            self.assertEqual(result['test'], 'unrecognized-test-suppressed')
            self.assertNotIn('PRIVATE-CANARY', json.dumps(result))

    def test_service_mutation_and_copy_outside_scope_are_rejected_before_execution(self):
        with patch.object(diagnosis.subprocess, 'run') as run:
            for args in [['docker', 'restart', diagnosis.VECTOR], ['docker', 'run', 'image'],
                         ['docker', 'network', 'create', 'network'], ['docker', 'volume', 'rm', 'volume'],
                         ['docker', 'cp', 'local-file', diagnosis.VECTOR + ':/tmp/path']]:
                with self.assertRaises(RuntimeError): diagnosis.run(args)
            run.assert_not_called()

    def test_wrong_project_image_or_network_fails(self):
        item = {'Name': '/' + diagnosis.VECTOR, 'Image': diagnosis.IMAGE_ID,
                'Config': {'Image': diagnosis.IMAGE, 'Labels': {'com.supabase.cli.project': diagnosis.PROJECT}},
                'NetworkSettings': {'Networks': {diagnosis.NETWORK: {}}}, 'Mounts': [], 'HostConfig': {'Privileged': False}}
        diagnosis.validate_vector(item)
        item['Config']['Labels']['com.supabase.cli.project'] = 'wrong'
        with self.assertRaises(RuntimeError): diagnosis.validate_vector(item)

    def test_endpoint_origins_strip_userinfo_paths_queries_and_unknown_hosts(self):
        values = startup.endpoints('tcp://host.docker.internal:2375 http://user:PRIVATE-CANARY@localhost:4000/private?key=PRIVATE-CANARY https://PRIVATE-CANARY.invalid')
        self.assertEqual(values, ['http://localhost:4000', 'tcp://host.docker.internal:2375'])
        self.assertNotIn('PRIVATE-CANARY', json.dumps(values))

    def test_yaml_field_inspection_omits_headers_keys_transforms_and_unknown_values(self):
        config = b'''api:
  enabled: true
  address: 0.0.0.0:9001
sources:
  logs:
    type: docker_logs
    docker_host: tcp://host.docker.internal:2375
sinks:
  sink:
    type: http
    uri: http://supabase_analytics_school-queue-local:4000/api/logs?key=PRIVATE-CANARY
    headers:
      authorization: PRIVATE-CANARY
'''
        result = startup.restricted_yaml_summary(config)
        self.assertEqual(result['summary']['api'], {'enabled': True, 'address': '0.0.0.0:9001'})
        self.assertEqual(result['summary']['sources'][0]['docker_host_origins'], ['tcp://host.docker.internal:2375'])
        self.assertNotIn('PRIVATE-CANARY', json.dumps(result))
        self.assertNotIn('auth_or_headers_present', result['summary']['sinks'][0])
        self.assertEqual(result['auth_and_headers'], 'not-inspected-values-omitted')

    def test_startup_shutdown_classification_preserves_no_raw_values(self):
        for line, category in [('Vector has started. PRIVATE-CANARY', 'vector-started'),
                               ('All sources have finished. PRIVATE-CANARY', 'all-sources-finished'),
                               ('Vector has stopped. PRIVATE-CANARY', 'vector-stopped')]:
            result = startup.log_refinement(line)
            self.assertEqual(result['category'], category)
            self.assertNotIn('PRIVATE-CANARY', json.dumps(result))


if __name__ == '__main__': unittest.main()
