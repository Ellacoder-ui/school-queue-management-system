"""Offline tests: no PostgreSQL/Docker access and no environment credentials."""
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock
import retained_migration_006 as backup


class BackupAutomation(unittest.TestCase):
    def test_arbitrary_catalog_size_is_bounded(self):
        tables=[{'schema':'public','table':'table_'+str(i),'columns':['value']} for i in range(1025)]
        calls=[]
        def query(sql):
            calls.append(sql)
            if len(calls)==1: return tables
            offset=(len(calls)-2)*16
            return {backup.table_key(t['schema'],t['table']):{'count':0,'rows':[]} for t in tables[offset:offset+16]}
        result=backup.all_rows(query)
        self.assertEqual(len(result),1025)
        self.assertEqual(len(calls),66)
        self.assertTrue(all(sql.count(' union all ')<16 for sql in calls[1:]))
        self.assertTrue(all(sql.startswith('select jsonb_object_agg(') for sql in calls[1:]))

    def test_identifiers_and_literals_are_escaped_separately(self):
        self.assertEqual(backup.table_key('odd.schema','a"b\'c;--'),'"odd.schema"."a""b\'c;--"')
        self.assertEqual(backup.literal("a'b"),"'a''b'")
        for fn in [backup.quote_identifier,backup.literal]:
            with self.assertRaises(RuntimeError): fn('bad\0name')

    def test_row_representation_keeps_sql_null_bitmap(self):
        sql=backup.row_digest('x',['value','odd"column'])
        self.assertIn('"x"."value" is null',sql)
        self.assertIn('"odd""column" is null',sql)
        self.assertIn('sha256(convert_to(jsonb_build_array(',sql)
        self.assertIn("'UTF8'",sql)

    def test_empty_catalog_needs_no_constructor(self):
        self.assertEqual(backup.all_rows(lambda sql:[]),{})

    def fixture(self):
        snapshot=backup.Snapshot.__new__(backup.Snapshot)
        snapshot.closed=False;snapshot.cleanup_issues=[];snapshot.sqlstates=['54023']
        snapshot.readers=[Mock(),Mock()]
        snapshot.p=Mock();snapshot.p.poll.return_value=3;snapshot.p.returncode=3
        snapshot.p.stdin.close.side_effect=OSError(22,'closed pipe')
        return snapshot

    def test_cleanup_cannot_mask_primary_error(self):
        snapshot=self.fixture()
        with self.assertRaisesRegex(RuntimeError,'SQLSTATE 54023'):
            with snapshot: raise RuntimeError('Primary PostgreSQL error [SQLSTATE 54023]')
        self.assertTrue(snapshot.closed)
        self.assertIn('closed pipe during stream cleanup',snapshot.cleanup_issues)

    def test_unexpected_cleanup_failure_remains_failure(self):
        snapshot=self.fixture()
        with self.assertRaisesRegex(RuntimeError,'SQLSTATE 54023'): snapshot.close()

    def test_acl_comparison_resolves_role_names(self):
        sql=backup.acl_sql('acl','owner','r')
        self.assertIn('pg_get_userbyid(a.grantor)',sql)
        self.assertIn('pg_get_userbyid(a.grantee)',sql)
        self.assertIn("then 'PUBLIC'",sql)

    def test_internal_char_cast_is_explicit_in_catalog_sql(self):
        sql=[]
        backup.schema_metadata(lambda statement:sql.append(statement) or {})
        defaults=next(s for s in sql if 'pg_default_acl' in s)
        self.assertIn('d.defaclobjtype::text',defaults)
        self.assertIn('pg_get_userbyid(d.defaclrole)::text',defaults)
        self.assertIn("'r'::\"char\"",defaults)
        self.assertNotIn('to_jsonb(d)',defaults)

    def test_archive_and_catalog_use_identical_schema_qualified_keys(self):
        catalog=[{'schema':s,'table':'users','owner':'postgres'} for s in ['auth','public']]
        keys=backup.toc_table_inventory('1; 0 1 TABLE DATA auth users postgres\n2; 0 2 TABLE DATA public users postgres\n',catalog)
        self.assertEqual(keys,['"auth"."users"','"public"."users"'])

    def test_unknown_and_ambiguous_archive_entries_fail(self):
        with self.assertRaises(RuntimeError): backup.toc_table_inventory('1; 0 1 TABLE DATA unknown users postgres',[])
        catalog=[{'schema':'a b','table':'c','owner':'postgres'},{'schema':'a','table':'b c','owner':'postgres'}]
        with self.assertRaises(RuntimeError): backup.toc_table_inventory('1; 0 1 TABLE DATA a b c postgres',catalog)

    def test_two_missing_fingerprints_cannot_match(self):
        with self.assertRaises(RuntimeError): backup.compare_rows({},{},required={'"auth"."users"'})

    def test_missing_restored_table_and_extra_table_fail(self):
        row={'count':0,'rows':[]}
        with self.assertRaises(RuntimeError): backup.compare_rows({'table':row},{})
        with self.assertRaises(RuntimeError): backup.compare_rows({'table':row},{'table':row,'extra':row})

    def test_empty_tables_and_duplicate_multiplicity_are_compared(self):
        self.assertEqual(backup.compare_rows({'table':{'count':0,'rows':[]}},{'table':{'count':0,'rows':[]}}),1)
        with self.assertRaises(RuntimeError): backup.compare_rows({'table':{'count':2,'rows':['a','a']}},{'table':{'count':1,'rows':['a']}})

    def table(self,name,kind='r',parent=None,extension=None,config=False):
        return {'schema':'test','table':name,'owner':'postgres','kind':kind,'columns':['id'],
                'is_partition':bool(parent),'parents':([{'schema':'test','table':parent,'sequence':1}] if parent else []),
                'bound':'FOR VALUES FROM (0) TO (10)' if parent else None,
                'partition_key':'RANGE (id)' if kind=='p' else None,'extension':extension,
                'extension_config':config,'extension_condition':None}

    def toc(self,tables,missing_data=(),missing_definition=(),missing_attach=()):
        entries=[]
        for t in tables:
            payload=f"{t['schema']} {t['table']} {t['owner']}"
            if t['table'] not in missing_definition and not t['extension']: entries.append('TABLE '+payload)
            if t['kind']=='r' and t['table'] not in missing_data: entries.append('TABLE DATA '+payload)
            if t['is_partition'] and t['table'] not in missing_attach: entries.append('TABLE ATTACH '+payload)
        return '\n'.join(f'{i}; 0 {i} {entry}' for i,entry in enumerate(entries,1))

    def complete(self,tables,toc=None,extensions=None):
        rows={backup.table_key(t['schema'],t['table']):{'count':0,'rows':[]} for t in tables}
        return backup.archive_completeness(self.toc(tables) if toc is None else toc,tables,rows,extensions or {})

    def test_ordinary_and_empty_physical_tables_require_data(self):
        tables=[self.table('ordinary'),self.table('empty')]
        self.assertEqual(self.complete(tables)['physical_tables'],2)
        for name in ['ordinary','empty']:
            with self.assertRaisesRegex(RuntimeError,'physical-table data'):
                self.complete(tables,self.toc(tables,missing_data=[name]))

    def test_storage_free_parent_with_physical_leaf(self):
        tables=[self.table('root','p'),self.table('leaf',parent='root')]
        result=self.complete(tables)
        self.assertEqual(result['partitioned_parents'],['"test"."root"'])
        self.assertEqual(result['table_data_entries'],1)
        self.assertEqual(result['partition_attachments'],1)

    def test_missing_leaf_data_fails_even_when_empty(self):
        tables=[self.table('root','p'),self.table('leaf',parent='root')]
        with self.assertRaisesRegex(RuntimeError,'physical-table data'):
            self.complete(tables,self.toc(tables,missing_data=['leaf']))

    def test_parent_requires_definition(self):
        tables=[self.table('root','p')]
        with self.assertRaisesRegex(RuntimeError,'table definition'):
            self.complete(tables,self.toc(tables,missing_definition=['root']))

    def test_nested_partition_topology(self):
        tables=[self.table('root','p'),self.table('middle','p',parent='root'),self.table('leaf',parent='middle')]
        result=self.complete(tables)
        self.assertEqual(len(result['partitioned_parents']),2)
        self.assertEqual(result['partition_attachments'],2)
        with self.assertRaisesRegex(RuntimeError,'attachments'):
            self.complete(tables,self.toc(tables,missing_attach=['middle']))

    def test_parent_data_and_unknown_parent_are_rejected(self):
        tables=[self.table('root','p')]
        with self.assertRaisesRegex(RuntimeError,'no independent TABLE DATA'):
            self.complete(tables,self.toc(tables)+'\n2; 0 2 TABLE DATA test root postgres')
        with self.assertRaisesRegex(RuntimeError,'parent missing'):
            self.complete([self.table('leaf',parent='unknown')])

    def test_duplicate_and_extra_archive_entries_fail(self):
        tables=[self.table('one')];toc=self.toc(tables)
        for extra in ['3; 0 3 TABLE DATA test one postgres','3; 0 3 TABLE test one postgres',
                      '3; 0 3 TABLE DATA test extra postgres','3; 0 3 TABLE test extra postgres']:
            with self.assertRaises(RuntimeError): self.complete(tables,toc+'\n'+extra)

    def test_extension_omission_requires_verified_empty_nonconfig_table(self):
        tables=[self.table('managed',extension='example')]
        toc='1; 0 1 EXTENSION - example '
        self.assertEqual(self.complete(tables,toc,{'example':{'version':'1'}})['extension_recreated_empty_tables'],['"test"."managed"'])
        tables[0]['extension_config']=True
        with self.assertRaisesRegex(RuntimeError,'physical-table data'): self.complete(tables,toc,{'example':{'version':'1'}})
        tables[0]['extension_config']=False;tables[0]['extension_condition']='WHERE id > 1'
        with self.assertRaisesRegex(RuntimeError,'Filtered extension data'): self.complete(tables,toc,{'example':{'version':'1'}})

    def test_foreign_data_is_not_implicitly_claimed_as_backed_up(self):
        with self.assertRaisesRegex(RuntimeError,'Foreign tables'): self.complete([self.table('remote','f')])
        with self.assertRaisesRegex(RuntimeError,'no foreign data queried'):
            backup.all_rows(lambda sql:[self.table('remote','f')])

    def test_only_known_initdb_extension_can_be_supplied_by_template(self):
        extension={'plpgsql':{'schema':'pg_catalog','version':'1.0','owner':'supabase_admin'}}
        self.assertEqual(self.complete([],extensions=extension)['template_extensions_to_verify'],['plpgsql'])
        with self.assertRaisesRegex(RuntimeError,'prerequisites incomplete'):
            self.complete([],extensions={'missing':{'version':'1'}})

    def test_incomplete_fingerprint_batch_fails(self):
        tables=[self.table('one')];calls=0
        def query(sql):
            nonlocal calls
            calls+=1
            return tables if calls==1 else {}
        with self.assertRaisesRegex(RuntimeError,'batch inventory'): backup.all_rows(query)

    def test_manifest_integrity_identity_and_required_entries(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);archive=root/'database.dump';archive.write_bytes(b'archive')
            roles=root/'roles.sql';roles.write_text('CREATE ROLE sample;',encoding='utf-8')
            path=root/'manifest.json'
            manifest={'format':1,'source':{'project':backup.PROJECT,'database_endpoint':'127.0.0.1:54322',
                      'server':{'database':'postgres'},'migration_sha256':{f'{i}_migration.sql':'hash' for i in range(1,7)}},
                      'archive_filename':archive.name,'exported_snapshot':'1-1-1','rows':{'"test"."one"':{'count':0,'rows':[]}},
                      'catalog':[self.table('one')],'schema':{'schemas':{}},'roles':{'roles':{}},'sequences':{},
                      'state':{'versions':[str(i) for i in range(1,6)]},'prerequisites':{}}
            backup.write_json(path,manifest)
            info={'manifest':str(path),'manifest_sha256':backup.file_sha256(path),'archive':str(archive),
                  'sha256':backup.file_sha256(archive),'roles_file':str(roles),'roles_sha256':backup.file_sha256(roles)}
            self.assertEqual(backup.verified_manifest(info),manifest)
            path.write_text('{}',encoding='utf-8')
            with self.assertRaisesRegex(RuntimeError,'manifest checksum'): backup.verified_manifest(info)
            for mutate in [lambda m:m.pop('rows'),lambda m:m['rows'].clear(),lambda m:m['source'].update(project='other')]:
                edited=json.loads(json.dumps(manifest));mutate(edited);backup.write_json(path,edited)
                info['manifest_sha256']=backup.file_sha256(path)
                with self.assertRaises(RuntimeError): backup.verified_manifest(info)

    def test_restore_initialization_uses_fresh_volume_not_platform_migrations(self):
        script=backup.isolated_init_script()
        self.assertIn('test ! -e "$PGDATA/PG_VERSION"',script)
        self.assertIn('--auth-host=scram-sha-256',script)
        self.assertIn('exec gosu postgres',script)
        self.assertNotIn('/docker-entrypoint-initdb.d',script)
        self.assertNotIn('set -x',script)


if __name__=='__main__': unittest.main(verbosity=2)
