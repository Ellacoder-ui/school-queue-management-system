import copy
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from auth_mfa_capability import auth_totp_enabled

class CapabilityTests(unittest.TestCase):
    def inspect(self, flags=('true','true')):
        return {'Name':'/supabase_auth_school-queue-local','Image':'sha256:1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b',
                'Config':{'Labels':{'com.supabase.cli.project':'school-queue-local','com.docker.compose.project':'school-queue-local'},'Env':['GOTRUE_MFA_TOTP_ENROLL_ENABLED='+flags[0],'GOTRUE_MFA_TOTP_VERIFY_ENABLED='+flags[1],'GOTRUE_JWT_SECRET=PRIVATE_DUMMY']},
                'State':{'Running':True,'Health':{'Status':'healthy'}},'NetworkSettings':{'Networks':{'supabase_network_school-queue-local':{}}}}
    def run_probe(self, item, endpoint='npipe:////./pipe/dockerDesktopLinuxEngine'):
        outputs=[[{'Endpoints':{'docker':{'Host':endpoint}}}],[item]]
        def read(*args,**kwargs):
            return type('Result',(),{'returncode':0,'stdout':json.dumps(outputs.pop(0))})()
        with patch('auth_mfa_capability.subprocess.run',side_effect=read):
            return auth_totp_enabled({})
    def test_both_flags_are_required(self):
        self.assertTrue(self.run_probe(self.inspect()))
        for flags in [('false','true'),('true','false'),('false','false')]:
            self.assertFalse(self.run_probe(self.inspect(flags)))
    def test_wrong_identity_health_or_endpoint_refuses(self):
        for key in ['Name','Image']:
            item=self.inspect();item[key]='other'
            with self.assertRaises(RuntimeError):self.run_probe(item)
        item=self.inspect();item['State']['Health']['Status']='unhealthy'
        with self.assertRaises(RuntimeError):self.run_probe(item)
        with self.assertRaises(RuntimeError):self.run_probe(self.inspect(),'tcp://elsewhere:2375')
    def test_overrides_and_ambiguous_environment_refuse(self):
        with self.assertRaises(RuntimeError):auth_totp_enabled({'DOCKER_HOST':'tcp://elsewhere:2375'})
        item=self.inspect();item['Config']['Env'].append('GOTRUE_MFA_TOTP_ENROLL_ENABLED=true')
        with self.assertRaises(RuntimeError):self.run_probe(item)

if __name__=='__main__':unittest.main()
