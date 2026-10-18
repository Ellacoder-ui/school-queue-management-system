"""Offline preservation/ownership regressions; no daemon or credentials accessed."""
from copy import deepcopy
import unittest

import validate_vector_socket as target


def services():
    return [{'Name': '/' + (target.base.VECTOR if i == 0 else 'other_' + str(i)), 'Id': str(i),
             'Config': {'Env': ['synthetic'], 'Image': 'synthetic'}, 'HostConfig': {'Privileged': False},
             'Mounts': [], 'Image': 'synthetic', 'NetworkSettings': {'Networks': {'private': {'ID': 'same'}}},
             'State': {'Running': True, 'Restarting': False, 'Status': 'running', 'ExitCode': 0,
                       'OOMKilled': False, 'StartedAt': 'same', 'FinishedAt': '', 'Health': {'Status': 'healthy'}},
             'RestartCount': 0} for i in range(12)]


class SocketSafety(unittest.TestCase):
    def test_owned_names_cannot_target_retained(self):
        values = target.owned_names('a123bcde')
        self.assertEqual(len(set(values.values())), 4)
        self.assertTrue(all(v.startswith('sq-vector-socket-a123bcde-') for v in values.values()))
        for value in ['school-queue-local', '../a123bcde', 'a123bcde\n', '', 'A123BCDE']:
            with self.assertRaises(RuntimeError): target.owned_names(value)

    def test_vector_background_lifecycle_is_scoped(self):
        before = services(); after = deepcopy(before)
        after[0]['RestartCount'] = 1
        after[0]['State']['StartedAt'] = 'background'
        target.unchanged_retained(before, after)
        after[1]['RestartCount'] = 1
        with self.assertRaisesRegex(RuntimeError, 'LIFECYCLE'): target.unchanged_retained(before, after)

    def test_every_retained_definition_and_id_remains_strict(self):
        before = services()
        for index in [0, 1, 11]:
            for field in ['Id', 'Config', 'HostConfig', 'Mounts', 'Image']:
                with self.subTest(index=index, field=field):
                    after = deepcopy(before); after[index][field] = 'changed'
                    with self.assertRaisesRegex(RuntimeError, 'DEFINITION'): target.unchanged_retained(before, after)

    def test_network_and_service_inventory_cannot_be_exempted(self):
        before = services(); after = deepcopy(before)
        after[0]['NetworkSettings']['Networks']['retained-extra'] = {}
        with self.assertRaisesRegex(RuntimeError, 'NETWORK'): target.unchanged_retained(before, after)
        with self.assertRaisesRegex(RuntimeError, 'COUNT'): target.unchanged_retained(before, after[:-1])

    def test_only_owned_resource_delta_is_accepted(self):
        before = {'containers': ['retained'], 'volumes': ['db'], 'networks': ['retained-network']}
        after = {'containers': ['retained', 'owned'], 'volumes': ['db', 'owned-volume'], 'networks': ['retained-network']}
        target.validate_resource_delta(before, after, ['owned'], 'owned-volume')
        for key in before:
            changed = deepcopy(after); changed[key].append('unexpected')
            with self.assertRaises(RuntimeError): target.validate_resource_delta(before, changed, ['owned'], 'owned-volume')
        changed = deepcopy(after); changed['volumes'].remove('db')
        with self.assertRaises(RuntimeError): target.validate_resource_delta(before, changed, ['owned'], 'owned-volume')

    def test_missing_image_and_implicit_anonymous_volumes_fail(self):
        target.image_guard({'Id': 'pinned', 'Config': {'Volumes': None}}, 'pinned')
        for image in [{'Id': 'changed', 'Config': {}}, {'Id': 'pinned', 'Config': {'Volumes': {'/db': {}}}}]:
            with self.assertRaises(RuntimeError): target.image_guard(image, 'pinned')

    def test_activation_locks_remain_in_force(self):
        target.assert_locks()

    def test_unversioned_requests_require_complete_scope_evidence(self):
        summary = {'client_versions': [], 'unversioned_requests': 4,
                   'counts': dict(ping=0, version=0, list=1, inspect=1, events=1, logs=1)}
        self.assertFalse(target.client_api_evidence(summary)['api_negotiation_tested'])
        summary['unversioned_requests'] = 3
        with self.assertRaises(RuntimeError): target.client_api_evidence(summary)

    def test_unknown_or_incompatible_numbered_api_versions_fail(self):
        summary = {'client_versions': ['1.49'], 'unversioned_requests': 0,
                   'counts': dict(ping=0, version=0, list=1, inspect=1, events=1, logs=1)}
        target.client_api_evidence(summary)
        for value in ['1.39', '1.57', '1.100', '1.49\n', 'unknown']:
            summary['client_versions'] = [value]
            with self.assertRaises(RuntimeError): target.client_api_evidence(summary)

    def test_real_probe_has_only_two_fixed_read_paths(self):
        source = (target.ROOT / 'supabase/tests/vector_socket_fixture.mjs').read_text(encoding='utf-8')
        probe = source.split('async function probe()', 1)[1].split('function fixture()', 1)[0]
        self.assertIn("realGet('/_ping')", probe)
        self.assertIn("realGet('/version')", probe)
        self.assertNotIn('/containers/', probe)
        self.assertNotIn('Env', probe)


if __name__ == '__main__': unittest.main()
