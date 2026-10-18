"""Six-version artifact rebinding and complete recovery comparison, entirely offline."""
from copy import deepcopy
import unittest

import post_migration_006_backup as recovery


class PostMigrationBackupTests(unittest.TestCase):
    def bindings(self):
        return {recovery.ARCHIVE:'a'*64,recovery.MANIFEST:'b'*64,recovery.ROLES:'c'*64}

    def manifest(self):
        return {'archive_filename':recovery.ARCHIVE,'schema':{'schemas':{
            name:recovery.privileges.expected_schema() for name in recovery.privileges.SCHEMAS}}}

    def proposal(self):
        acl=[dict(grantor='postgres',grantee=role,privilege=privilege,grantable=False)
             for role,privileges in recovery.privileges.DATABASE_GRANTS.items() for privilege in sorted(privileges)]
        acl += [dict(grantor='postgres',grantee=role,privilege=privilege,grantable=False)
                for role,privileges in [('PUBLIC',('CONNECT','TEMPORARY')),('postgres',('CONNECT','CREATE','TEMPORARY'))] for privilege in privileges]
        return {'archive_filename':recovery.ARCHIVE,'source_artifacts':self.bindings(),'source_system_identifier':'123456789',
            'database':dict(owner='postgres',acl=acl,connection_limit=-1,allow_connections=True,tablespace='pg_default'),
            'database_settings':[{'role':None,'settings':['app.settings.jwt_secret=offline-canary','app.settings.jwt_exp=3600']}]}

    def test_schema_sql_is_bound_only_to_new_artifacts(self):
        sql=recovery.privileges.generate_sql(self.manifest(),'123456789',source_artifacts=self.bindings())
        self.assertIn('a'*64,sql);self.assertIn('b'*64,sql)
        self.assertNotIn(recovery.internal.PINNED['source_snapshot_manifest.json'][0],sql)
        self.assertEqual(sum(line.startswith('GRANT ') for line in sql.splitlines()),8)
        self.assertIn("cluster_id = '123456789'",sql)

    def test_environment_sql_is_bound_to_its_own_capture(self):
        sql=recovery.privileges.generate_environment_sql(self.proposal(),[],source_artifacts=self.bindings(),proposal_sha256='d'*64)
        for value in ('a'*64,'b'*64,'d'*64): self.assertIn(value,sql)
        self.assertNotIn(recovery.privileges.APPROVED_PROPOSAL_SHA256,sql)
        self.assertEqual(sum(line.startswith('GRANT ') for line in sql.splitlines()),5)
        self.assertEqual(sum(line.startswith('ALTER DATABASE ') for line in sql.splitlines()),2)
        self.assertNotIn('queue_private',sql)

    def test_missing_wrong_extra_or_malformed_bindings_fail(self):
        for bindings in ({}, {**self.bindings(),'extra':'e'*64}, {**self.bindings(),recovery.ARCHIVE:'bad'},
                         {recovery.MANIFEST:'b'*64,recovery.ROLES:'c'*64,'retained_postgres_before_006.dump':'a'*64}):
            with self.subTest(bindings=bindings),self.assertRaises(RuntimeError):
                recovery.privileges.generate_sql(self.manifest(),'123',source_artifacts=bindings)
        with self.assertRaises(RuntimeError):
            recovery.privileges.generate_environment_sql(self.proposal(),[],source_artifacts=self.bindings())

    def test_different_environment_source_binding_is_rejected(self):
        proposal=self.proposal();proposal['source_artifacts'][recovery.ARCHIVE]='e'*64
        with self.assertRaises(RuntimeError):
            recovery.privileges.generate_environment_sql(proposal,[],source_artifacts=self.bindings(),proposal_sha256='d'*64)

    def test_rebinding_does_not_expand_privileges_or_settings(self):
        for change in [lambda p:p['database']['acl'].append(dict(grantor='postgres',grantee='PUBLIC',privilege='CREATE',grantable=False)),
                       lambda p:p['database_settings'][0]['settings'].append('unreviewed.setting=value'),
                       lambda p:p['database'].update(owner='supabase_admin')]:
            proposal=self.proposal();change(proposal)
            with self.assertRaises(RuntimeError):
                recovery.privileges.generate_environment_sql(proposal,[],source_artifacts=self.bindings(),proposal_sha256='d'*64)

    def test_old_default_generation_still_uses_original_bindings(self):
        manifest=self.manifest();manifest.pop('archive_filename')
        sql=recovery.privileges.generate_sql(manifest,'123')
        self.assertIn(recovery.internal.PINNED['source_snapshot_manifest.json'][0],sql)
        self.assertNotIn('a'*64,sql)

    def test_new_generation_preserves_inputs_and_is_deterministic(self):
        manifest=self.manifest();original=deepcopy(manifest);bindings=self.bindings()
        a=recovery.privileges.generate_sql(manifest,'123',source_artifacts=bindings)
        self.assertEqual(a,recovery.privileges.generate_sql(manifest,'123',source_artifacts=bindings))
        self.assertEqual(manifest,original);self.assertEqual(bindings,self.bindings())

    def comparison(self):
        return {'rows':{str(n):dict(count=0,rows=[]) for n in range(69)},'catalog':[],
            'schema':{'schemas':{}},'roles':{'roles':{}},'sequences':{},
            'state':dict(versions=[str(n) for n in range(6)],routes=recovery.backup.CANONICAL,active=0),
            'additional_privileges':{},'routing':{}}

    def test_complete_recovery_comparison_rejects_any_missing_section_or_row(self):
        manifest=self.comparison();recovery.compare_manifest(manifest,deepcopy(manifest))
        for section in manifest:
            observed=deepcopy(manifest);observed.pop(section)
            with self.subTest(section=section),self.assertRaises(RuntimeError): recovery.compare_manifest(manifest,observed)
        observed=deepcopy(manifest);observed['rows'].pop('1')
        with self.assertRaises(RuntimeError): recovery.compare_manifest(manifest,observed)
        observed=deepcopy(manifest);observed['rows']['1']={'count':1,'rows':['changed']}
        with self.assertRaises(RuntimeError): recovery.compare_manifest(manifest,observed)

    def test_privilege_and_routing_differences_are_not_normalized(self):
        manifest=self.comparison()
        for section in ('schema','roles','additional_privileges','routing','sequences'):
            observed=deepcopy(manifest);observed[section]['unexpected']='changed'
            with self.subTest(section=section),self.assertRaises(RuntimeError): recovery.compare_manifest(manifest,observed)

    def test_only_clock_projection_is_normalized_for_historical_comparison(self):
        a={'clock':'old','state':{'current_day_closed':True,'routes':recovery.backup.CANONICAL},'rows':{'preserved':'hash'}}
        b=deepcopy(a);b['clock']='new';b['state']['current_day_closed']=False
        self.assertEqual(recovery.stable_source(a),recovery.stable_source(b))
        b['rows']['preserved']='changed'
        self.assertNotEqual(recovery.stable_source(a),recovery.stable_source(b))

    def test_fixed_routing_metadata_rejects_disabled_or_unlinked_trigger(self):
        metadata={'constraints':{key:recovery.cutover.expected_constraint(key) for key in
            set(recovery.cutover.NEW_CONSTRAINTS)|set(recovery.cutover.NEW_CONSTRAINT_TRIGGERS)},
            'triggers':{key:{**recovery.cutover.expected_trigger(key),'enabled':'O','definition':recovery.cutover.expected_trigger_definition(key)}
                        for key in recovery.cutover.NEW_TRIGGERS}}
        recovery.validate_routing(metadata)
        key='queue_private.counters:fixed_counters_complete'
        changed=deepcopy(metadata);changed['triggers'][key]['constraint']=None
        with self.assertRaises(RuntimeError): recovery.validate_routing(changed)
        changed=deepcopy(metadata);changed['triggers'][key]['enabled']='D'
        with self.assertRaises(RuntimeError): recovery.validate_routing(changed)


if __name__=='__main__': unittest.main()
