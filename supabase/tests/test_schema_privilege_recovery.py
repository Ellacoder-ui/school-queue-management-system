"""Offline allowlist, exact-ACL and target-binding tests; no live access."""
from copy import deepcopy
import unittest
import schema_privilege_recovery as recovery


class SchemaPrivilegeRecoveryTests(unittest.TestCase):
    def manifest(self):
        return {'schema':{'schemas':{name:recovery.expected_schema() for name in recovery.SCHEMAS},
                         'functions':{'queue_api.example()':{'acl':'unchanged'}},
                         'relations':{'queue_private.accounts':{'acl':'unchanged'}},'sequences':{}}}

    def before(self,manifest):
        result=deepcopy(manifest['schema'])
        for name in recovery.SCHEMAS: result['schemas'][name]=recovery.expected_schema(False)
        return result

    def test_exact_eight_grants_and_only_two_grant_options(self):
        manifest=self.manifest();grants=recovery.authorized_grants(manifest)
        self.assertEqual(len(grants),8)
        self.assertEqual(sum(g['grantable'] for g in grants),2)
        self.assertEqual({g['schema'] for g in grants},{'graphql','graphql_public'})
        self.assertEqual({g['grantor'] for g in grants},{'supabase_admin'})

    def test_unexpected_privilege_grantee_grantor_and_owner_are_rejected(self):
        for field,value in [('privilege','CREATE'),('grantee','PUBLIC'),('grantor','postgres'),('grantable',True)]:
            manifest=self.manifest();manifest['schema']['schemas']['graphql']['acl'][0][field]=value
            with self.assertRaises(RuntimeError): recovery.authorized_grants(manifest)
        manifest=self.manifest();manifest['schema']['schemas']['graphql']['owner']='postgres'
        with self.assertRaises(RuntimeError): recovery.authorized_grants(manifest)

    def test_missing_duplicate_and_injected_entries_are_rejected(self):
        for operation in [lambda acl:acl.pop(),lambda acl:acl.append(acl[0]),
                          lambda acl:acl[0].update(grantee='anon"; GRANT ALL;--')]:
            manifest=self.manifest();operation(manifest['schema']['schemas']['graphql']['acl'])
            with self.assertRaises(RuntimeError): recovery.authorized_grants(manifest)
        manifest=self.manifest();manifest['schema']['schemas']['untrusted']=manifest['schema']['schemas'].pop('graphql')
        with self.assertRaises(RuntimeError): recovery.authorized_grants(manifest)

    def test_only_the_exact_documented_gap_is_accepted(self):
        manifest=self.manifest()
        self.assertEqual(recovery.validate_known_gap(manifest,self.before(manifest)),8)
        with self.assertRaises(RuntimeError): recovery.validate_known_gap(manifest,manifest['schema'])

    def test_other_function_table_sequence_or_schema_difference_fails(self):
        manifest=self.manifest()
        for section in ['functions','relations','sequences','schemas']:
            observed=self.before(manifest);observed[section]['extra']={}
            with self.assertRaises(RuntimeError): recovery.validate_known_gap(manifest,observed)

    def test_safe_grant_sql_has_no_unrelated_writes(self):
        sql=recovery.generate_sql(self.manifest(),'123456789')
        lines=[line for line in sql.splitlines() if line.startswith('GRANT ')]
        self.assertEqual(len(lines),8)
        self.assertEqual(sum('WITH GRANT OPTION' in line for line in lines),2)
        self.assertTrue(all('GRANT USAGE ON SCHEMA "graphql' in line for line in lines))
        for forbidden in ['queue_private','GRANT ALL','TO PUBLIC','ALTER TABLE','DISABLE ROW','UPDATE pg_','INSERT INTO pg_','DELETE FROM pg_']:
            self.assertNotIn(forbidden,sql)

    def test_source_cluster_and_manifest_are_bound(self):
        sql=recovery.generate_sql(self.manifest(),'123456789')
        self.assertIn("cluster_id = '123456789'",sql)
        self.assertIn("current_database() <> 'queue_restore_verify'",sql)
        self.assertIn('recovery_target_identifier',sql)
        self.assertIn(recovery.internal.PINNED['source_snapshot_manifest.json'][0],sql)
        self.assertIn(recovery.internal.PINNED['retained_postgres_before_006.dump'][0],sql)
        self.assertIn('inet_client_addr() IS NOT NULL',sql)

    def test_supported_role_and_transaction_semantics(self):
        sql=recovery.generate_sql(self.manifest(),'123456789')
        self.assertIn('SET LOCAL ROLE "supabase_admin";',sql)
        self.assertIn('RESET ROLE;',sql)
        self.assertIn('BEGIN;',sql)
        self.assertTrue(sql.endswith('COMMIT;\n'))
        self.assertIn('Required recovery roles missing',sql)
        self.assertIn('Unexpected pre-recovery schema identities or ACLs',sql)
        self.assertIn('Recovery ACLs differ from source manifest',sql)

    def test_untrusted_cluster_identifier_is_rejected(self):
        for value in ['','1; COMMIT;','-1','abc','1'*21]:
            with self.assertRaises(RuntimeError): recovery.generate_sql(self.manifest(),value)

    def test_generation_is_deterministic_and_original_manifest_unchanged(self):
        manifest=self.manifest();before=deepcopy(manifest)
        self.assertEqual(recovery.generate_sql(manifest,'1234'),recovery.generate_sql(manifest,'1234'))
        self.assertEqual(before,manifest)

    def proposal(self):
        acl=[{'grantor':'postgres','grantee':g,'privilege':p,'grantable':False} for g,privileges in recovery.DATABASE_GRANTS.items() for p in sorted(privileges)]
        acl += [{'grantor':'postgres','grantee':'postgres','privilege':p,'grantable':False} for p in ['CONNECT','CREATE','TEMPORARY']]
        acl += [{'grantor':'postgres','grantee':'PUBLIC','privilege':p,'grantable':False} for p in ['CONNECT','TEMPORARY']]
        return {'source_artifacts':{n:v[0] for n,v in recovery.internal.PINNED.items()},'source_system_identifier':'123456789',
                'database':{'owner':'postgres','acl':sorted(acl,key=lambda a:(a['grantor'],a['grantee'],a['privilege'])),'connection_limit':-1,'allow_connections':True,'tablespace':'pg_default'},
                'database_settings':[{'role':None,'settings':['app.settings.jwt_secret=local-test-canary','app.settings.jwt_exp=3600']}]}

    def test_environment_recovery_has_only_five_approved_database_grants(self):
        sql=recovery.generate_environment_sql(self.proposal(),[])
        grants=[line for line in sql.splitlines() if line.startswith('GRANT ')]
        self.assertEqual(len(grants),5)
        self.assertTrue(all('ON DATABASE "queue_restore_verify"' in line for line in grants))
        self.assertNotIn('WITH GRANT OPTION',sql)
        self.assertNotIn('TO "PUBLIC"',sql)
        self.assertNotIn('queue_private',sql)
        self.assertIn('SET LOCAL ROLE "postgres";',sql)

    def test_environment_rejects_unapproved_grants_and_configuration(self):
        for change in [lambda p:p['database']['acl'][0].update(grantee='anon'),
                       lambda p:p['database']['acl'][0].update(grantable=True),
                       lambda p:p['database']['acl'][0].update(grantor='supabase_admin'),
                       lambda p:p['database_settings'][0].update(role='anon'),
                       lambda p:p['database_settings'][0]['settings'].append('unapproved.setting=value')]:
            proposal=self.proposal();change(proposal)
            with self.assertRaises(RuntimeError): recovery.generate_environment_sql(proposal,[])

    def test_environment_values_are_quoted_and_inputs_unchanged(self):
        proposal=self.proposal();proposal['database_settings'][0]['settings'][0]="app.settings.jwt_secret=test'quoted"
        before=deepcopy(proposal);sql=recovery.generate_environment_sql(proposal,[])
        self.assertIn("TO 'test''quoted';",sql)
        self.assertIn('standard_conforming_strings = on',sql)
        self.assertEqual(proposal,before)

    def test_environment_binding_and_exact_before_after_checks(self):
        sql=recovery.generate_environment_sql(self.proposal(),[])
        for required in ['source','queue_restore_verify','expected_cluster','Unexpected initial verification database privileges/settings','Database prerequisites differ from approved source']:
            self.assertIn(required,sql)
        self.assertEqual(len(recovery.database_before(self.proposal())['acl']),5)


if __name__=='__main__': unittest.main(verbosity=2)
