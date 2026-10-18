"""Independent six-migration backup/restore proof; never applies source SQL writes.

Historical five-version orchestration/evidence is not reused as a current-state
baseline. Only validated stateless components and fenced Destination methods are reused.
All secrets, archives and generated SQL stay in a new protected Git-ignored directory.
"""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid

import retained_migration_006 as backup
import restore_local_backup_internal as internal
import schema_privilege_recovery as privileges
import apply_retained_migration_006 as cutover
import validate_retained_migration_006 as validation

ROOT = backup.ROOT
POSTVALIDATION_SHA256 = '5940878a90c15b91eafeed1ec83f536a9ea8f424a723d92b773783b2420804c2'
ARCHIVE = 'retained_postgres_after_006.dump'
MANIFEST = 'source_snapshot_manifest.json'
ROLES = 'roles_without_passwords.sql'
ENVIRONMENT = 'database_environment_source.json'
SCHEMA_SQL = 'schema_privileges_recovery.sql'
ENVIRONMENT_SQL = 'database_environment_recovery.sql'
BUNDLE = 'recovery_bundle_manifest.json'


def require(condition,message):
    if not condition: raise RuntimeError(message)


def stable_source(snapshot):
    result = deepcopy(snapshot)
    result.pop('clock',None)
    # Calendar-derived only: row fingerprints still require every queue day unchanged.
    result['state'].pop('current_day_closed',None)
    return result


def old_bundle():
    result = validation.artifact_check()  # Checks artifacts only, never five-version source equality.
    files = [internal.DIRECTORY/name for name in internal.PINNED]
    files += [privileges.SQL_FILE,privileges.BUNDLE_FILE,privileges.ENV_FILE,
              privileges.PROPOSAL_FILE,privileges.PRIVILEGE_BASELINE_FILE]
    result['artifact_sha256'] = {path.name:backup.file_sha256(path) for path in files}
    return result


def routing_metadata(query):
    return query("""select jsonb_build_object(
      'constraints',(select jsonb_object_agg(n.nspname::text||'.'||c.relname::text||':'||k.conname::text,
        jsonb_build_object('schema',n.nspname,'relation',c.relname,'name',k.conname,'type',k.contype::text,
          'definition',pg_get_constraintdef(k.oid,true),'validated',k.convalidated,'deferrable',k.condeferrable,'deferred',k.condeferred))
        from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='queue_private' and k.conname in ('counter_services_one_service','counter_services_one_counter',
          'fixed_routing_complete','fixed_counters_complete','fixed_services_complete')),
      'triggers',(select jsonb_object_agg(n.nspname::text||'.'||c.relname::text||':'||t.tgname::text,
        jsonb_build_object('function',pn.nspname::text||'.'||p.proname::text,'type',t.tgtype,
          'deferrable',t.tgdeferrable,'deferred',t.tginitdeferred,'enabled',t.tgenabled::text,'definition',pg_get_triggerdef(t.oid,true),
          'constraint',case when k.oid is not null then kn.nspname::text||'.'||kc.relname::text||':'||k.conname::text end))
        from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
        join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace
        left join pg_constraint k on k.oid=t.tgconstraint left join pg_class kc on kc.oid=k.conrelid
        left join pg_namespace kn on kn.oid=kc.relnamespace
        where n.nspname='queue_private' and t.tgname like 'fixed_%'))""")


def validate_routing(metadata):
    constraints = set(cutover.NEW_CONSTRAINTS)|set(cutover.NEW_CONSTRAINT_TRIGGERS)
    require(metadata['constraints'] == {key:cutover.expected_constraint(key) for key in constraints},'Exact routing constraint catalog differs')
    expected = {key:{**cutover.expected_trigger(key),'enabled':'O','definition':cutover.expected_trigger_definition(key)}
                for key in cutover.NEW_TRIGGERS}
    require(metadata['triggers'] == expected,'Routing trigger definitions/links/events differ')


def source_preflight():
    require(backup.file_sha256(validation.EVIDENCE) == POSTVALIDATION_SHA256,'Validated six-version evidence changed')
    previous = json.loads(validation.EVIDENCE.read_text(encoding='utf-8'))
    require(previous['result']=='PASS' and previous['phase']=='complete' and previous['final_preservation'], 'Completed six-version postvalidation required')
    _,env,current = cutover.capture()
    require(stable_source(current) == stable_source(previous['current']),'Source rows/security differ from six-version postvalidation')
    details = cutover.post_details(env)
    cutover.compare_schema(validation.historical()['before']['schema'],current['schema'],details)
    require(len(current['rows'])==69 and current['state']['routes']==backup.CANONICAL and not current['state']['active'] and not current['state']['open_days'],
            'Unsafe six-version source table/routing/work state')
    require(current['state']['versions']==[name.split('_')[0] for name in sorted(current['identity']['migration_sha256'])], 'Exactly six reviewed migrations required')
    require(current['identity']['docker'][0]['image']==internal.IMAGE,'Expected compatible Supabase PostgreSQL image')
    return env,current


def collect(query):
    result = {'rows':backup.all_rows(query),'catalog':backup.table_catalog(query),'schema':backup.schema_metadata(query),
              'roles':backup.role_metadata(query),'sequences':backup.sequence_values(query),'state':backup.state(None,query),
              'additional_privileges':privileges.additional_privileges(query),'routing':routing_metadata(query)}
    validate_routing(result['routing'])
    return result


def compare_manifest(manifest,observed):
    require(set(observed)=={'rows','catalog','schema','roles','sequences','state','additional_privileges','routing'}, 'Complete verification sections required')
    backup.compare_rows(manifest['rows'],observed['rows'])
    for section in set(observed)-{'rows'}:
        require(manifest[section]==observed[section],'Restored/source integrity differs: '+section)
    require(len(observed['rows'])==69 and len(observed['state']['versions'])==6 and observed['state']['routes']==backup.CANONICAL and not observed['state']['active'],
            'Six-version recovery history/routing/active-work verification failed')


def restore_prerequisites(query):
    return query("""select jsonb_build_object('database',jsonb_build_object('encoding',pg_encoding_to_char(d.encoding),
      'collate',d.datcollate,'ctype',d.datctype,'provider',d.datlocprovider,'locale',to_jsonb(d)->>'datlocale'),
      'settings',(select jsonb_object_agg(name,setting) from pg_settings where name in ('shared_preload_libraries','wal_level','server_encoding','TimeZone')),
      'large_object_count',(select count(*) from pg_largeobject_metadata)) from pg_database d where datname=current_database()""")


def write_text(path,text):
    with path.open('x',encoding='utf-8',newline='\n') as handle: handle.write(text)


class Run:
    def __init__(self):
        self.id = uuid.uuid4().hex[:8]
        self.evidence = ROOT/'supabase/tests/results'/('post_migration_006_backup_'+self.id+'.json')
        self.directory = backup.BACKUPS/('post006_'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'_'+self.id)
        require(not self.evidence.exists() and not self.directory.exists(),'New backup identity already exists')
        self.record = dict(run_id=self.id,result='IN_PROGRESS',phase='source-preflight',started_at=datetime.now(timezone.utc).isoformat(),
                           migration_applied=False,source_writes=False,hosted_contacted=False,recoverability_verified=False)
        self.destination = None

    def save(self): backup.write_json(self.evidence,self.record)

    def acl(self,paths):
        return internal.verify_acl(paths,directory=self.directory,base_names=())

    def checkpoint(self,phase):
        self.record['phase']=phase;self.save()

    def source_compare(self,manifest):
        _,env,identity = backup.target()
        require(identity==manifest['source'],'Source Docker/endpoint/file identity changed')
        with backup.Snapshot(env) as snapshot:
            require(snapshot.query('select to_jsonb(system_identifier::text) from pg_control_system()')==manifest['source_system_identifier'], 'Source cluster changed')
            observed=collect(snapshot.query)
            compare_manifest(manifest,observed)
            require(restore_prerequisites(snapshot.query)==manifest['prerequisites'],'Source platform prerequisites changed')
        return observed

    def backup(self,env,before):
        backup.secure_directory(self.directory)
        self.acl([self.directory/'process_access_probe.txt'])
        self.record['directory']=str(self.directory)
        self.checkpoint('snapshot-capture')
        archive=self.directory/ARCHIVE;manifest_path=self.directory/MANIFEST;roles_path=self.directory/ROLES
        with backup.Snapshot(env) as snapshot:
            exported=snapshot.raw('select pg_export_snapshot();')
            require(re.fullmatch(r'[0-9A-Fa-f-]+',exported) is not None,'Invalid exported snapshot identity')
            captured=collect(snapshot.query)
            require(all(captured[key]==before[key] for key in ('rows','catalog','schema','roles','sequences','state','additional_privileges')), 'Source changed before snapshot')
            prerequisites=restore_prerequisites(snapshot.query)
            require(prerequisites['large_object_count']==0,'Nonzero large objects require explicit recovery verification support')
            raw_settings=snapshot.query("""select coalesce(jsonb_agg(jsonb_build_object('role',case when s.setrole=0 then null else pg_get_userbyid(s.setrole) end,
                'settings',to_jsonb(s.setconfig)) order by s.setrole=0,pg_get_userbyid(s.setrole)),'[]') from pg_db_role_setting s
                where s.setdatabase=(select oid from pg_database where datname=current_database())""")
            manifest={'format':2,'run_id':self.id,'captured_at_utc':datetime.now(timezone.utc).isoformat(),
                'source':before['identity'],'source_system_identifier':before['system_identifier'],'archive_filename':ARCHIVE,
                'exported_snapshot':exported,'prerequisites':prerequisites,**captured}
            backup.write_json(manifest_path,manifest)
            self.record['manifest']={'filename':MANIFEST,'sha256':backup.file_sha256(manifest_path),'bytes':manifest_path.stat().st_size}
            self.checkpoint('manifest-saved-before-dump')
            self.non_mvcc_fence(env,manifest)
            result=backup.call([backup.pgtool('pg_dump'),'-w','--format=custom','--file',str(archive),'--snapshot',exported,'--lock-wait-timeout=10s'],env=env,timeout=180,label='Six-version full custom-format backup')
            require(not result.stderr.strip(),'pg_dump returned diagnostics; stop')
            self.record['pg_dump_exit']=result.returncode
            result=backup.call([backup.pgtool('pg_dumpall'),'-w','--roles-only','--no-role-passwords','--file',str(roles_path)],env=env,timeout=60,label='Six-version password-free role backup')
            require(not result.stderr.strip() and not re.search(r'\bPASSWORD\b',roles_path.read_text(encoding='utf-8'),re.I),'Unexpected role dump diagnostics/password clause')
            self.record['pg_dumpall_exit']=result.returncode
            self.non_mvcc_fence(env,manifest)
        require(archive.is_file() and archive.stat().st_size>0,'New archive missing/empty')
        result=backup.call([backup.pgtool('pg_restore'),'--list',str(archive)],label='Six-version archive completeness inspection')
        require(not result.stderr.strip(),'Archive list emitted diagnostics')
        completeness=backup.archive_completeness(result.stdout,manifest['catalog'],manifest['rows'],manifest['schema']['extensions'])
        require(completeness['logical_tables']==69 and completeness['table_data_entries']==68 and completeness['partition_attachments']==6,'Unexpected archive/partition inventory')
        require(not any(re.search(r'ACL - SCHEMA '+name+r' ',result.stdout) for name in privileges.SCHEMAS),'New archive schema-ACL gap differs; stop before supplemental SQL')
        write_text(self.directory/'archive_toc.txt',result.stdout)
        hashes={name:backup.file_sha256(self.directory/name) for name in (ARCHIVE,MANIFEST,ROLES)}
        proposal={'authorization':'Current user request: source-derived six-version isolated recovery prerequisites',
            'archive_filename':ARCHIVE,'source_artifacts':hashes,'source_system_identifier':manifest['source_system_identifier'],
            'database':manifest['additional_privileges']['database'],'database_settings':raw_settings}
        backup.write_json(self.directory/ENVIRONMENT,proposal)
        proposal_hash=backup.file_sha256(self.directory/ENVIRONMENT)
        write_text(self.directory/SCHEMA_SQL,privileges.generate_sql(manifest,manifest['source_system_identifier'],source_artifacts=hashes))
        write_text(self.directory/ENVIRONMENT_SQL,privileges.generate_environment_sql(proposal,manifest['additional_privileges']['database_settings'],
            source_artifacts=hashes,proposal_sha256=proposal_hash))
        files={name:{'sha256':backup.file_sha256(self.directory/name),'bytes':(self.directory/name).stat().st_size}
               for name in (ARCHIVE,MANIFEST,ROLES,ENVIRONMENT,SCHEMA_SQL,ENVIRONMENT_SQL)}
        bundle={'format':2,'run_id':self.id,'source_system_identifier':manifest['source_system_identifier'],
            'source_project':backup.PROJECT,'exported_snapshot':exported,'versions':manifest['state']['versions'],'files':files,
            'restore_order':['Matching PostgreSQL/image/locale/extensions','Password-free global roles','Template0 database creation',
                'Complete transactional archive restoration','Exact gap/data/security verification','Schema ACL supplement',
                'Source-derived database grants/settings supplement','Complete source-versus-restored comparisons'],
            'schema_grants':privileges.authorized_grants(manifest),'database_grants':5,'protected_database_settings':2}
        backup.write_json(self.directory/BUNDLE,bundle)
        self.record['bundle']={'filename':BUNDLE,'sha256':backup.file_sha256(self.directory/BUNDLE),'bytes':(self.directory/BUNDLE).stat().st_size}
        self.record.update(artifacts=files,archive_completeness=completeness,
            tools={name:backup.call([backup.pgtool(name),'--version']).stdout.strip() for name in ('pg_dump','pg_dumpall','pg_restore')})
        self.record['acl']=self.acl([self.directory/name for name in files]+[self.directory/BUNDLE])
        self.verify_bundle()
        self.source_compare(manifest)
        self.checkpoint('backup-complete')
        print('PASS: new six-version exported-snapshot archive/manifest/roles and exact source-derived supplements; 69 logical tables/68 data entries/6 attachments.',flush=True)
        return manifest

    def non_mvcc_fence(self,env,manifest):
        query=lambda sql:backup.canonical_query(env,sql)
        require(backup.role_metadata(query)==manifest['roles'] and backup.sequence_values(query)==manifest['sequences'], 'Roles/sequences changed during snapshot/dump')
        require(privileges.additional_privileges(query)==manifest['additional_privileges'],'Privileges/database settings changed during dump')

    def verify_bundle(self):
        require(backup.file_sha256(self.directory/BUNDLE)==self.record['bundle']['sha256'],'New bundle manifest checksum changed')
        bundle=json.loads((self.directory/BUNDLE).read_text(encoding='utf-8'))
        require(bundle['run_id']==self.id and bundle['files']==self.record['artifacts'],'New bundle association changed')
        require(set(bundle['files'])=={ARCHIVE,MANIFEST,ROLES,ENVIRONMENT,SCHEMA_SQL,ENVIRONMENT_SQL},'Complete six-version recovery artifact inventory required')
        for name,meta in bundle['files'].items():
            require(name in (ARCHIVE,MANIFEST,ROLES,ENVIRONMENT,SCHEMA_SQL,ENVIRONMENT_SQL),'Unexpected bundle artifact')
            path=self.directory/name
            require(path.is_file() and path.stat().st_size==meta['bytes'] and backup.file_sha256(path)==meta['sha256'],'New bundle artifact checksum/size differs')
        manifest=json.loads((self.directory/MANIFEST).read_text(encoding='utf-8'))
        require(manifest['format']==2 and manifest['run_id']==self.id and manifest['archive_filename']==ARCHIVE and
                manifest['exported_snapshot']==bundle['exported_snapshot'] and manifest['source_system_identifier']==bundle['source_system_identifier'], 'New manifest source/archive/snapshot binding differs')
        require(manifest['state']['versions']==bundle['versions'] and len(bundle['versions'])==6,'Six-version manifest history required')
        bindings={name:bundle['files'][name]['sha256'] for name in (ARCHIVE,MANIFEST,ROLES)}
        proposal=json.loads((self.directory/ENVIRONMENT).read_text(encoding='utf-8'))
        require((self.directory/SCHEMA_SQL).read_text(encoding='utf-8')==privileges.generate_sql(manifest,manifest['source_system_identifier'],source_artifacts=bindings), 'Schema supplement differs from reviewed generation')
        require((self.directory/ENVIRONMENT_SQL).read_text(encoding='utf-8')==privileges.generate_environment_sql(proposal,manifest['additional_privileges']['database_settings'],
            source_artifacts=bindings,proposal_sha256=bundle['files'][ENVIRONMENT]['sha256']), 'Environment supplement differs from reviewed generation')
        self.acl([self.directory/name for name in bundle['files']]+[self.directory/BUNDLE])
        return manifest

    def start_destination(self,manifest):
        name='sq-restore-internal-'+self.id
        image=json.loads(backup.call(['docker','image','inspect',internal.IMAGE],label='Matching local PostgreSQL image').stdout)[0]
        entry={'project':name,'container':name,'volume':name+'-data','network_mode':'none','published_ports':[],
            'image':internal.IMAGE,'image_id':image['Id'],'database':internal.DATABASE,'socket':internal.SOCKET}
        for args in (['docker','ps','-a','--filter','name=^/'+name+'$','--format','{{.Names}}'],
                     ['docker','volume','ls','--filter','name=^'+entry['volume']+'$','--format','{{.Name}}']):
            require(not backup.call(args).stdout.strip(),'Disposable restore identity already exists')
        diagnostics=self.directory/'restore_verification';diagnostics.mkdir(exist_ok=False)
        self.record['destination']=entry;self.checkpoint('destination-preparation')
        backup.call(['docker','volume','create','--label','school-queue.restore-id='+name,entry['volume']],label='Fresh six-version verification volume')
        env=backup.clean_env();env.update(POSTGRES_PASSWORD=uuid.uuid4().hex+uuid.uuid4().hex,POSTGRES_USER=internal.OWNER,
            POSTGRES_DB='postgres',RECOVERY_PRELOAD=manifest['prerequisites']['settings']['shared_preload_libraries'])
        backup.call(['docker','create','--name',name,'--label','school-queue.restore-id='+name,'--label','school-queue.recovery-version=006',
            '--network','none','--entrypoint','/bin/bash','--mount','type=volume,source='+entry['volume']+',target=/var/lib/postgresql/data',
            '--env','POSTGRES_PASSWORD','--env','POSTGRES_USER','--env','POSTGRES_DB','--env','RECOVERY_PRELOAD',
            internal.IMAGE,'-c',internal.init_script()],env=env,label='Fresh network-none six-version restore container')
        dest=internal.Destination(entry,diagnostics);self.destination=dest
        dest.guard(running=False)
        backup.call(['docker','start',name],label='Start only fresh recovery container')
        deadline=time.monotonic()+60
        while time.monotonic()<deadline:
            ready=subprocess.run(['docker','exec','--user','postgres',name,'pg_isready','-q','-h',internal.SOCKET,'-p','5432','-U',internal.OWNER,'-d','postgres'],
                env=backup.clean_env(),capture_output=True,timeout=10)
            if ready.returncode==0: break
            time.sleep(1)
        else: raise RuntimeError('Fresh isolated Unix socket did not become ready')
        identity=dest.identity()
        require(identity['system_identifier']!=manifest['source_system_identifier'],'Destination must not be the source cluster')
        entry.update(system_identifier=identity['system_identifier'],sandbox_id=dest.guard()['NetworkSettings']['SandboxID'])
        initial=dest.query("""select jsonb_build_object('roles',(select jsonb_agg(rolname order by rolname) from pg_roles where rolname not like 'pg_%'),
            'databases',(select jsonb_agg(datname order by datname) from pg_database),
            'tables',(select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema')))""",'postgres')
        require(initial=={'roles':[internal.OWNER],'databases':['postgres','template0','template1'],'tables':0},'Destination is not a fresh empty disposable cluster')
        self.record['destination_initial']=identity;self.checkpoint('destination-verified')
        dest.execute(['mkdir','-m','700',internal.ARTIFACTS],label='Private isolated artifact directory')
        print('PASS: fresh independently fenced network-none cluster/volume, distinct system identifier, Unix socket only and zero application tables.',flush=True)
        return dest,diagnostics

    def restore(self,manifest):
        self.verify_bundle();self.source_compare(manifest)
        dest,folder=self.start_destination(manifest)
        dest.copy(self.directory/ARCHIVE,ARCHIVE)
        dest.copy(self.directory/ROLES,ROLES)
        existing=dest.query('select jsonb_agg(rolname order by rolname) from pg_roles','postgres')
        role_path=folder/'roles_prepared.sql'
        write_text(role_path,internal.prepare_roles((self.directory/ROLES).read_text(encoding='utf-8'),existing))
        role_sql=dest.copy(role_path,role_path.name)
        result=dest.psql('postgres',file=role_sql,label='Six-version password-free global role restoration')
        require(not result.stderr.strip(),'Role import emitted diagnostics')
        require(backup.role_metadata(lambda sql:dest.query(sql,'postgres'))==manifest['roles'],'Role/membership restoration differs')
        self.record['roles_restore_exit']=result.returncode
        db=manifest['prerequisites']['database'];owner=manifest['additional_privileges']['database']['owner']
        require(db['provider']=='i' and owner=='postgres' and owner in manifest['roles']['roles'],'Reviewed database locale/owner required')
        dest.identity()
        dest.psql('postgres',sql='create database '+internal.DATABASE+' template template0 owner '+backup.quote_identifier(owner)+
            ' encoding '+backup.literal(db['encoding'])+' locale_provider=icu icu_locale='+backup.literal(db['locale'])+
            ' lc_collate='+backup.literal(db['collate'])+' lc_ctype='+backup.literal(db['ctype'])+';',label='Fresh verification database creation')
        dest.identity(internal.DATABASE)
        template=dest.query("""select jsonb_build_object('tables',(select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema')),
            'extensions',(select jsonb_object_agg(extname,jsonb_build_object('owner',pg_get_userbyid(extowner),'version',extversion)) from pg_extension),
            'available',(select jsonb_object_agg(name,default_version) from pg_available_extensions))""")
        require(template['tables']==0 and template['extensions']=={'plpgsql':{'owner':internal.OWNER,'version':'1.0'}}, 'Verification template objects/extension owner differ')
        require(restore_prerequisites(dest.query)['database']==db,'Destination locale differs')
        require(all(template['available'].get(name)==meta['version'] for name,meta in manifest['schema']['extensions'].items()),'Required extension version unavailable')
        self.checkpoint('archive-restoration')
        sql_path=folder/'complete_restore.sql'
        result=backup.call([backup.pgtool('pg_restore'),'--exit-on-error','--single-transaction','--file',str(sql_path),str(self.directory/ARCHIVE)],label='Complete six-version archive SQL reconstruction')
        require(not result.stderr.strip(),'Archive reconstruction emitted diagnostics')
        self.record['pg_restore_exit']=result.returncode
        sql=dest.copy(sql_path,sql_path.name);dest.identity(internal.DATABASE)
        result=dest.psql(internal.DATABASE,file=sql,label='Complete transactional six-version archive restoration')
        require(not result.stderr.strip(),'Archive restoration emitted diagnostics')
        self.record.update(archive_restore_exit=result.returncode,restore_sql_sha256=backup.file_sha256(sql_path))
        self.checkpoint('archive-restored')
        print('PASS: complete new archive restored transactionally; exact supplement-gap verification follows.',flush=True)
        self.apply_supplements(dest,manifest)
        restored=collect(dest.query)
        compare_manifest(manifest,restored)
        require(restore_prerequisites(dest.query)['database']==db,'Restored database locale differs')
        self.record['restored']={'tables':len(restored['rows']),'logical_rows':sum(row['count'] for row in restored['rows'].values()),
            'counts':{key:row['count'] for key,row in restored['rows'].items()},'schema_object_counts':{key:len(value) for key,value in restored['schema'].items()},
            'schema_sections_match':{key:True for key in restored['schema']},'additional_privileges_match':True,'routing_constraints_and_links_match':True,
            'roles':len(restored['roles']['roles']),'memberships':len(restored['roles']['memberships']),'sequences':len(restored['sequences']),
            'state':restored['state'],'all_rows_and_catalog_match':True}
        self.source_compare(manifest)
        self.verify_bundle()
        self.checkpoint('full-restore-verified')
        print('PASS: all 69 logical tables, six migrations/fixed routing, complete schema/security/roles/sequences/settings match the new source manifest.',flush=True)

    def apply_supplements(self,dest,manifest):
        before=collect(dest.query)
        backup.compare_rows(manifest['rows'],before['rows'])
        privileges.validate_known_gap(manifest,before['schema'])
        for section in ('catalog','roles','sequences','state','routing'):
            require(before[section]==manifest[section],'Unexpected pre-supplement difference: '+section)
        expected=manifest['additional_privileges'];extra=before['additional_privileges']
        require(all(extra[key]==expected[key] for key in ('sequence_acls','column_acls','type_acls')),'Unexpected pre-supplement object ACL difference')
        proposal=json.loads((self.directory/ENVIRONMENT).read_text(encoding='utf-8'))
        require(extra['database']==privileges.database_before(proposal) and extra['database_settings']==[], 'Initial database prerequisite gap differs')
        bindings=self.record['artifacts']
        variables={'recovery_target_identifier':dest.entry['system_identifier'],
            'recovery_archive_sha256':bindings[ARCHIVE]['sha256'],'recovery_manifest_sha256':bindings[MANIFEST]['sha256']}
        schema_sql=dest.copy(self.directory/SCHEMA_SQL,SCHEMA_SQL)
        caught=None
        try: dest.psql(internal.DATABASE,file=schema_sql,variables={**variables,'recovery_target_identifier':manifest['source_system_identifier']},label='Expected rejected source-cluster recovery target')
        except RuntimeError as error: caught=str(error)
        require(caught is not None and 'SQLSTATE 42501' in caught and backup.schema_metadata(dest.query)==before['schema'], 'Recovery target rejection/rollback failed')
        self.record['wrong_target_negative_test']='PASS: 42501; no schema changes'
        result=dest.psql(internal.DATABASE,file=schema_sql,variables=variables,label='Six-version exact schema ACL supplement')
        require(not result.stderr.strip() and backup.schema_metadata(dest.query)==manifest['schema'],'Exact schema ACL supplement comparison failed')
        self.record['schema_supplement']={'exit_code':result.returncode,'grants':8,'grantors_and_options_match':True}
        environment_sql=dest.copy(self.directory/ENVIRONMENT_SQL,ENVIRONMENT_SQL)
        result=dest.psql(internal.DATABASE,file=environment_sql,variables=variables,label='Six-version source-derived database prerequisite supplement')
        require(not result.stderr.strip() and privileges.additional_privileges(dest.query)==expected,'Database prerequisite exact comparison failed')
        require(backup.schema_metadata(dest.query)==manifest['schema'],'Database prerequisite supplement changed unrelated schema metadata')
        self.record['environment_supplement']={'exit_code':result.returncode,'grants':5,'protected_settings':2,'exact_privileges_and_setting_hashes_match':True}
        self.checkpoint('supplements-verified')

    def stop_destination(self):
        if self.destination is None: return
        c=self.destination.guard(running=False)
        if c['State']['Running']:
            backup.call(['docker','stop',self.destination.entry['container']],timeout=60,label='Stop only this new verification container')
        stopped=self.destination.guard(running=False)
        require(not stopped['State']['Running'],'New verification container did not stop')
        self.record['destination'].update(stopped=True,volume_retained=True)

    def run(self):
        self.save()
        try:
            old=old_bundle();env,before=source_preflight()
            self.record.update(old_bundle=old,source_identity=before['identity'],source_system_identifier=before['system_identifier'],
                source_counts=before['state']['counts'],validated_postflight_evidence_sha256=POSTVALIDATION_SHA256)
            self.checkpoint('source-verified')
            print('PASS: source six-version identity/routing/history/security matches validated baseline; old five-version bundle protected and intact.',flush=True)
            manifest=self.backup(env,before)
            self.restore(manifest)
            observed=self.source_compare(manifest)
            require(old_bundle()==old,'Historical five-version recovery bundle changed')
            self.stop_destination()
            self.record.update(result='PASS',phase='complete',recoverability_verified=True,source_preserved=True,old_bundle_unchanged=True,
                completed_at=datetime.now(timezone.utc).isoformat(),final_state=observed['state'])
            self.save()
            print('STOPPED: new six-migration database recovery bundle VERIFIED RECOVERABLE; source and old bundle unchanged; fresh restore volume retained.',flush=True)
            print('Evidence: '+str(self.evidence.relative_to(ROOT)),flush=True)
        except BaseException as error:
            message=str(error) if isinstance(error,RuntimeError) else 'Six-version recovery harness failure; raw diagnostics suppressed'
            self.record.update(result='FAIL',failure=message,recoverability_verified=False)
            try: self.stop_destination()
            except Exception: self.record['destination_stop_failed']=True
            self.save()
            print('STOP: '+message,flush=True)
            print('Evidence: '+str(self.evidence.relative_to(ROOT)),flush=True)
            raise SystemExit(1) from None


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run',action='store_true',required=True)
    parser.parse_args()
    Run().run()
