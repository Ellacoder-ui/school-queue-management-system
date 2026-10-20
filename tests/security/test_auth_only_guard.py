"""Offline identity and preservation checks for the final read-only guard."""
from copy import deepcopy
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
import auth_only_guard as g


class GuardTests(unittest.TestCase):
    def baseline(self):
        def item(kind):
            return {'Id': kind, 'Name': '/supabase_' + kind + '_school-queue-local', 'Config': {'Image': 'pinned', 'Env': ['JWT=preserved']},
                    'HostConfig': {}, 'Mounts': [], 'Image': 'pinned', 'NetworkSettings': {'Networks': {'project': 'fixed'}}, 'RestartCount': 0,
                    'State': {'Running': True, 'Restarting': False, 'Status': 'running', 'ExitCode': 0, 'OOMKilled': False, 'StartedAt': 'fixed', 'FinishedAt': '', 'Health': {'Status': 'healthy'}}}
        return {'items': [item('auth'), item('db')], 'resources': {'containers': ['auth', 'db'], 'networks': ['fixed'], 'volumes': ['fixed']},
                'credential': ['100', '1792345678901234567'], 'dbVolume': ['creation-bound'], 'backupTree': {'sha256': 'bound'},
                'sourceSnapshot': g.encode_source({'ancillary': {'strict': True}})}

    def test_discovery_uses_label_filters_and_includes_unlabeled_canonical_extra(self):
        calls = []
        def run(args):
            calls.append(args)
            if '--filter' in args:
                self.assertTrue(args[args.index('--filter') + 1].startswith('label='))
                return 0, 'one\n', ''
            return 0, 'one supabase_auth_school-queue-local\ntwo supabase_unknown_school-queue-local\nthree unrelated\n', ''
        with patch.object(g.m.base, 'run', side_effect=run), patch.object(g.m.base, 'read_json', side_effect=lambda x: x[2:]):
            self.assertEqual(g.discovery(), ['one', 'two'])
        self.assertEqual(len(calls), 3)

    def test_nanosecond_binding_survives_javascript_compatible_json(self):
        with patch.object(g.m.base, 'credential_metadata', return_value=(100, 1792345678901234567)):
            value = g.credential_fence()
        self.assertEqual(json.loads(json.dumps(value)), ['100', '1792345678901234567'])

    def test_int64_metadata_roundtrip_is_lossless_and_trailing_or_oversized_data_fails(self):
        import base64
        import zlib
        source = {'sequence_max': 9223372036854775807, 'negative': -9223372036854775808, 'text': 'exact\r\nUTF8 é'}
        encoded = json.loads(json.dumps({'sourceSnapshot': g.encode_source(source)}))['sourceSnapshot']
        self.assertEqual(g.decode_source(encoded), source)
        for blob in (zlib.compress(b' ' * (4 * 1024 * 1024 + 1)), zlib.compress(b'{}') + b'trailing'):
            with self.assertRaisesRegex(RuntimeError, 'AGO_SOURCE_BOUND'):
                g.decode_source(base64.b64encode(blob).decode())

    def test_unknown_project_or_global_resource_delta_fails(self):
        for mutate in (lambda x: x['items'].append({'Id': 'extra'}), lambda x: x['resources']['containers'].append('extra'),
                       lambda x: x['resources']['volumes'].append('extra'), lambda x: x['resources']['networks'].append('extra')):
            before = self.baseline(); now = deepcopy(before); mutate(now)
            with self.assertRaisesRegex(RuntimeError, 'AGO_.*DELTA'), patch.object(g.m.recovery, 'compare_source'):
                g.compare(before, now, 'before', None)

    def test_unrelated_environment_and_private_artifacts_stay_strict(self):
        for mutate in (lambda x: x['items'][1]['Config']['Env'].append('JWT=changed'), lambda x: x['credential'].append('changed'),
                       lambda x: x['backupTree'].update(sha256='changed'), lambda x: x['dbVolume'].append('changed')):
            before = self.baseline(); now = deepcopy(before); mutate(now)
            with self.assertRaises(RuntimeError), patch.object(g.m.recovery, 'compare_source'):
                g.compare(before, now, 'before', None)

    def test_actual_source_comparator_failure_cannot_be_ignored(self):
        value = self.baseline()
        with patch.object(g.m.base, 'state', return_value={}), patch.object(g.m.recovery, 'compare_source', side_effect=RuntimeError('STRICT_SOURCE_FAIL')):
            with self.assertRaisesRegex(RuntimeError, 'STRICT_SOURCE_FAIL'):
                g.compare(value, deepcopy(value), 'before', None)


if __name__ == '__main__':
    unittest.main()
