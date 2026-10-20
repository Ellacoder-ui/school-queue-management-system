import copy
import sys
import unittest
from unittest.mock import patch
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
import auth_mfa_guard as guard


def inventory():
    items = [{'Name': name, 'Id': 'fixture-' + name} for name in sorted(guard.g.CANONICAL)]
    next(x for x in items if x['Name'] == guard.g.AUTH)['Id'] = guard.CURRENT
    items.append({'Name': guard.g.AUTH + '-e17c030c-activation-original', 'Id': guard.PARKED,
                  'State': {'Running': False}, 'NetworkSettings': {'Networks': {}}})
    return {'items': items}


class MfaGuardTests(unittest.TestCase):
    def test_health_acceptance_requires_auth_gateway_google_and_public_api(self):
        now = {'items': [{'Name': '/supabase_' + kind + '_school-queue-local',
                         'State': {'Running': True, 'Health': {'Status': 'healthy'}}}
                        for kind in ('db', 'auth', 'kong', 'rest')], 'connection': {'publicKey': 'dummy'}}
        with patch.object(guard.g.health, 'request', return_value={'external': {'google': True}}) as request:
            guard.g.health_check(now, True)
            self.assertEqual(request.call_count, 3)
        with patch.object(guard.g.health, 'request', return_value={'external': {'google': False}}):
            with self.assertRaises(RuntimeError):
                guard.g.health_check(now, True)
        now['items'][1]['State']['Health']['Status'] = 'unhealthy'
        with patch.object(guard.g.health, 'request') as request:
            with self.assertRaises(RuntimeError):
                guard.g.health_check(now, True)
            request.assert_not_called()

    def test_exact_current_and_parked_auth_are_required(self):
        now = inventory()
        guard.initial_inventory(now)
        for mutate in (lambda x: x['items'].pop(), lambda x: x['items'].append({'Name': '/extra', 'Id': 'extra'}),
                       lambda x: x['items'][-1]['State'].update(Running=True),
                       lambda x: x['items'][-1].update(Id='substituted'),
                       lambda x: x['items'][-1]['NetworkSettings']['Networks'].update(unexpected={})):
            changed = copy.deepcopy(now)
            mutate(changed)
            with self.assertRaises(RuntimeError):
                guard.initial_inventory(changed)

    def test_google_stays_enabled_and_both_mfa_flags_must_agree(self):
        for enabled in (False, True):
            env = ['GOTRUE_EXTERNAL_GOOGLE_ENABLED=true',
                   'GOTRUE_MFA_TOTP_ENROLL_ENABLED=' + str(enabled).lower(),
                   'GOTRUE_MFA_TOTP_VERIFY_ENABLED=' + str(enabled).lower()]
            now = {'items': [{'Name': guard.g.AUTH, 'Config': {'Env': env}}]}
            guard.flags(now, enabled)
            with self.assertRaises(RuntimeError):
                guard.flags(now, not enabled)
            for changed in ([env[0].replace('true', 'false'), *env[1:]], [*env, env[-1]],
                            [*env[:-1], env[-1].replace(str(enabled).lower(), str(not enabled).lower())]):
                with self.assertRaises(RuntimeError):
                    guard.flags({'items': [{'Name': guard.g.AUTH, 'Config': {'Env': changed}}]}, enabled)


if __name__ == '__main__':
    unittest.main()
