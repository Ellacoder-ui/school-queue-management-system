"""Exact manifest-derived schema ACL recovery in a fresh fenced disposable cluster.

This is recovery automation, not an application migration. Source access is read-only.
"""
import argparse
from copy import deepcopy
import json
from pathlib import Path
import re
import sys

import restore_local_backup_internal as internal
import retained_migration_006 as backup

EVIDENCE = backup.ROOT/'supabase/tests/results/schema_privilege_recovery.json'
PREVIOUS = internal.EVIDENCE
SQL_FILE = internal.DIRECTORY/'schema_privileges_recovery_v1.sql'
BUNDLE_FILE = internal.DIRECTORY/'schema_privileges_recovery_v1.json'
ENV_FILE = internal.DIRECTORY/'database_environment_recovery_v1.sql'
PROPOSAL_FILE = internal.DIRECTORY/'database_environment_proposal_v1.json'
PRIVILEGE_BASELINE_FILE = internal.DIRECTORY/'additional_privileges_baseline_v1.json'
SCHEMAS = ('graphql','graphql_public')
GRANTOR = 'supabase_admin'
GRANTEES = {'anon':False,'authenticated':False,'postgres':True,'service_role':False}
APPROVED_PROPOSAL_SHA256 = '8b8785cc42412f1760cda4542dd21f26e6c10e4645d2ad053636da7464af355e'
DATABASE_GRANTS = {'dashboard_user':{'CONNECT','CREATE','TEMPORARY'},'supabase_etl_admin':{'CREATE'},'supabase_storage_admin':{'CREATE'}}
DATABASE_SETTINGS = {'app.settings.jwt_secret','app.settings.jwt_exp'}


def entry(grantee,privilege='USAGE',grantable=False):
    return {'grantor':GRANTOR,'grantee':grantee,'privilege':privilege,'grantable':grantable}


def expected_schema(complete=True):
    acl=[entry(GRANTOR,'CREATE'),entry(GRANTOR)]
    if complete: acl += [entry(role,grantable=option) for role,option in GRANTEES.items()]
    return {'owner':GRANTOR,'acl':sorted(acl,key=lambda a:(a['grantor'],a['grantee'],a['privilege']))}


def authorized_grants(manifest):
    grants=[]
    for name in SCHEMAS:
        if manifest['schema']['schemas'].get(name)!=expected_schema():
            raise RuntimeError('Manifest schema ACL differs from the eight approved privileges')
        for acl in manifest['schema']['schemas'][name]['acl']:
            if acl['grantee'] != GRANTOR:
                if (acl['grantor'] != GRANTOR or acl['privilege'] != 'USAGE' or acl['grantee'] not in GRANTEES
                    or acl['grantable'] is not GRANTEES[acl['grantee']]):
                    raise RuntimeError('Unexpected schema privilege/grantor/grantee/grant option')
                grants.append({'schema':name,**acl})
    if len(grants)!=8: raise RuntimeError('Exactly eight schema privilege entries required')
    return grants


def validate_known_gap(manifest,observed_schema):
    authorized_grants(manifest)
    expected=deepcopy(manifest['schema'])
    for name in SCHEMAS: expected['schemas'][name]=expected_schema(False)
    if observed_schema!=expected:
        raise RuntimeError('Restored metadata differs beyond the exact eight approved schema privileges')
    return 8


def projection():
    # Fully qualified, fixed catalog-only projection; compare exact ACL entries.
    return """select pg_catalog.jsonb_object_agg(n.nspname::text,
      pg_catalog.jsonb_build_object('owner',pg_catalog.pg_get_userbyid(n.nspowner),'acl',
       (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
         'grantor',pg_catalog.pg_get_userbyid(a.grantor),
         'grantee',case when a.grantee=0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end,
         'privilege',a.privilege_type,'grantable',a.is_grantable)
         order by pg_catalog.pg_get_userbyid(a.grantor),case when a.grantee=0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(a.grantee) end,a.privilege_type),'[]'::pg_catalog.jsonb)
        from pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n'::pg_catalog."char",n.nspowner))) a)))
      from pg_catalog.pg_namespace n where n.nspname::text in ('graphql','graphql_public')"""


def artifact_bindings(source_artifacts=None, archive_filename='retained_postgres_before_006.dump'):
    """Explicit new-run inputs; historical defaults and generated SQL stay unchanged."""
    if archive_filename not in ('retained_postgres_before_006.dump','retained_postgres_after_006.dump'):
        raise RuntimeError('Unexpected recovery archive filename')
    bindings = {name:meta[0] for name,meta in internal.PINNED.items()} if source_artifacts is None else dict(source_artifacts)
    if set(bindings) != {archive_filename,'source_snapshot_manifest.json','roles_without_passwords.sql'} or any(
            not isinstance(value,str) or not re.fullmatch(r'[0-9a-f]{64}',value) for value in bindings.values()):
        raise RuntimeError('Complete checksummed source artifact bindings required')
    return bindings


def generate_sql(manifest,source_identifier,*,source_artifacts=None):
    grants=authorized_grants(manifest)
    if not re.fullmatch(r'[0-9]{1,20}',source_identifier): raise RuntimeError('Invalid source cluster identifier')
    original={name:manifest['schema']['schemas'][name] for name in SCHEMAS}
    before={name:expected_schema(False) for name in SCHEMAS}
    archive_filename=manifest.get('archive_filename','retained_postgres_before_006.dump')
    bindings=artifact_bindings(source_artifacts,archive_filename)
    archive_hash=bindings[archive_filename]
    manifest_hash=bindings['source_snapshot_manifest.json']
    comments='-- Recovery supplement v1; no application migration.\n-- Archive SHA-256: '+archive_hash+'\n-- Manifest SHA-256: '+manifest_hash+'\n'
    header="""\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = '';
SET LOCAL lock_timeout = '10s';
SELECT pg_catalog.set_config('queue_recovery.expected_cluster', :'recovery_target_identifier', true),
       pg_catalog.set_config('queue_recovery.archive_hash', :'recovery_archive_sha256', true),
       pg_catalog.set_config('queue_recovery.manifest_hash', :'recovery_manifest_sha256', true);
"""
    guard="""DO $recovery_guard$
DECLARE actual pg_catalog.jsonb; cluster_id pg_catalog.text;
BEGIN
  SELECT system_identifier::pg_catalog.text INTO cluster_id FROM pg_catalog.pg_control_system();
  IF pg_catalog.current_database() <> 'queue_restore_verify'
     OR session_user <> 'supabase_admin' OR current_user <> 'supabase_admin'
     OR pg_catalog.inet_client_addr() IS NOT NULL OR pg_catalog.inet_server_addr() IS NOT NULL
     OR pg_catalog.current_setting('listen_addresses') <> ''
     OR cluster_id = SOURCE_IDENTIFIER
     OR cluster_id <> pg_catalog.current_setting('queue_recovery.expected_cluster')
     OR pg_catalog.current_setting('queue_recovery.archive_hash') <> ARCHIVE_HASH
     OR pg_catalog.current_setting('queue_recovery.manifest_hash') <> MANIFEST_HASH THEN
    RAISE EXCEPTION 'Recovery target or artifact binding rejected' USING ERRCODE='42501';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_roles WHERE rolname::pg_catalog.text IN
       ('supabase_admin','anon','authenticated','postgres','service_role')) <> 5 THEN
    RAISE EXCEPTION 'Required recovery roles missing' USING ERRCODE='42501';
  END IF;
  PROJECTION INTO_PLACEHOLDER;
  IF actual IS DISTINCT FROM BEFORE_ACL::pg_catalog.jsonb THEN
    RAISE EXCEPTION 'Unexpected pre-recovery schema identities or ACLs' USING ERRCODE='42501';
  END IF;
END
$recovery_guard$;
SET LOCAL ROLE "supabase_admin";
"""
    # SELECT INTO goes before FROM in PL/pgSQL. Wrap the scalar projection instead.
    guard=guard.replace('PROJECTION INTO_PLACEHOLDER','SELECT ('+projection()+') INTO actual')
    for token,value in [('SOURCE_IDENTIFIER',source_identifier),('ARCHIVE_HASH',archive_hash),('MANIFEST_HASH',manifest_hash),('BEFORE_ACL',json.dumps(before,sort_keys=True))]:
        guard=guard.replace(token,backup.literal(value))
    statements=[]
    for grant in grants:
        statements.append('GRANT USAGE ON SCHEMA '+backup.quote_identifier(grant['schema'])+' TO '+backup.quote_identifier(grant['grantee'])+(' WITH GRANT OPTION' if grant['grantable'] else '')+';')
    post="DO $recovery_check$\nDECLARE actual pg_catalog.jsonb;\nBEGIN\n  SELECT ("+projection()+") INTO actual;\n  IF actual IS DISTINCT FROM "+backup.literal(json.dumps(original,sort_keys=True))+"::pg_catalog.jsonb THEN\n    RAISE EXCEPTION 'Recovery ACLs differ from source manifest' USING ERRCODE='42501';\n  END IF;\nEND\n$recovery_check$;\nRESET ROLE;\nCOMMIT;\n"
    return comments+header+guard+'\n'.join(statements)+'\n'+post


def root_cause(manifest):
    prior=json.loads(PREVIOUS.read_text(encoding='utf-8'))
    if prior.get('phase')!='stopped-at-schema-acl-comparison' or prior.get('recoverability_verified'):
        raise RuntimeError('Expected original stopped ACL failure evidence required')
    authorized_grants(manifest)
    reconstructed=deepcopy(manifest['schema'])
    differences=prior['schema_metadata_differences']
    if set(differences)!=set(SCHEMAS): raise RuntimeError('Previous mismatch contains unexpected schemas')
    for name in SCHEMAS:
        if differences[name]!={'expected':manifest['schema']['schemas'][name],'restored':expected_schema(False)}:
            raise RuntimeError('Previous restored ACLs differ from approved mismatch')
        reconstructed['schemas'][name]=differences[name]['restored']
    validate_known_gap(manifest,reconstructed)
    if not all(value for key,value in prior['readonly_integrity_diagnosis']['schema_sections_match'].items() if key!='schemas'):
        raise RuntimeError('Previous restore has additional metadata differences')
    for key in ('roles_match','sequences_match','partition_catalog_match','queue_state_match','row_counts_match'):
        if not prior['readonly_integrity_diagnosis'][key]: raise RuntimeError('Previous restore has another integrity failure')
    _,env,_=backup.target()
    facts=backup.canonical_query(env,"""select pg_catalog.jsonb_object_agg(n.nspname,pg_catalog.jsonb_build_object(
      'initial_matches_current',coalesce((select pg_catalog.bool_and(i.initprivs=n.nspacl) from pg_catalog.pg_init_privs i where i.classoid='pg_catalog.pg_namespace'::pg_catalog.regclass and i.objoid=n.oid),false),
      'initial_types',(select pg_catalog.jsonb_agg(i.privtype::pg_catalog.text) from pg_catalog.pg_init_privs i where i.classoid='pg_catalog.pg_namespace'::pg_catalog.regclass and i.objoid=n.oid),
      'extension_member',exists(select 1 from pg_catalog.pg_depend d where d.classid='pg_catalog.pg_namespace'::pg_catalog.regclass and d.objid=n.oid and d.deptype='e')))
      from pg_catalog.pg_namespace n where n.nspname::pg_catalog.text in ('graphql','graphql_public')""")
    expected={name:{'initial_matches_current':True,'initial_types':['e'],'extension_member':False} for name in SCHEMAS}
    if facts!=expected: raise RuntimeError('Platform initial-privilege diagnosis changed')
    toc=backup.call([backup.pgtool('pg_restore'),'--list',str(internal.DIRECTORY/'retained_postgres_before_006.dump')],label='Archive ACL reinspection').stdout
    if any(re.search(r'ACL - SCHEMA '+name+r' ',toc) for name in SCHEMAS):
        raise RuntimeError('Original archive unexpectedly includes the missing schema ACLs')
    return {'missing_entries':8,'schemas':list(SCHEMAS),'initial_privileges':facts,'other_privileges_match':True,
            'original_failure_evidence_sha256':backup.file_sha256(PREVIOUS)}


def additional_privileges(query):
    # The original pg_sequences projection omitted sequence ACLs. Verify them
    # explicitly, together with column/type/database privileges, without changing
    # the original immutable snapshot manifest.
    scope="n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp_%'"
    sections={
      'sequence_acls':"select format('%I.%I',n.nspname,c.relname) key,"+backup.acl_sql('c.relacl','c.relowner','S')+" value from pg_class c join pg_namespace n on n.oid=c.relnamespace where "+scope+" and c.relkind='S'",
      'column_acls':"select format('%I.%I',n.nspname,c.relname)||':'||a.attname key,"+backup.acl_sql('a.attacl','c.relowner','c')+" value from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where "+scope+" and a.attnum>0 and not a.attisdropped and a.attacl is not null",
      'type_acls':"select format('%I.%I',n.nspname,t.typname) key,"+backup.acl_sql('t.typacl','t.typowner','T')+" value from pg_type t join pg_namespace n on n.oid=t.typnamespace where "+scope+" and t.typtype in ('e','d')",
    }
    result={name:query("select coalesce(jsonb_object_agg(key,value),'{}') from ("+sql+") q") for name,sql in sections.items()}
    result['database']=query("select jsonb_build_object('owner',pg_get_userbyid(d.datdba),'acl',"+backup.acl_sql('d.datacl','d.datdba','d')+",'connection_limit',d.datconnlimit,'allow_connections',d.datallowconn,'tablespace',(select spcname from pg_tablespace where oid=d.dattablespace)) from pg_database d where datname=current_database()")
    result['database_settings']=query("select coalesce(jsonb_agg(jsonb_build_object('role',case when s.setrole=0 then '<all>' else pg_get_userbyid(s.setrole) end,'settings_hash',encode(sha256(convert_to(s.setconfig::text,'UTF8')),'hex')) order by s.setrole=0,pg_get_userbyid(s.setrole)),'[]') from pg_db_role_setting s where s.setdatabase=(select oid from pg_database where datname=current_database())")
    return result


def capture_additional():
    record=json.loads(EVIDENCE.read_text(encoding='utf-8'))
    if record['phase']!='revalidated': raise RuntimeError('Prepared recovery required before additional privilege capture')
    _,env,_=backup.target()
    with backup.Snapshot(env) as snapshot: extra=additional_privileges(snapshot.query)
    record['additional_privilege_baseline']=extra
    backup.write_json(EVIDENCE,record)
    print(json.dumps({'sequence_acl_objects':len(extra['sequence_acls']),'column_acl_objects':len(extra['column_acls']),
                     'type_acl_objects':len(extra['type_acls']),'database':extra['database'],'database_setting_rows':len(extra['database_settings'])},indent=2),flush=True)


def propose_environment():
    """Prepare a concrete protected proposal only; never applies database grants."""
    record=json.loads(EVIDENCE.read_text(encoding='utf-8'))
    _,env,_=backup.target()
    config=backup.canonical_query(env,"""select coalesce(jsonb_agg(jsonb_build_object(
      'role',case when s.setrole=0 then null else pg_get_userbyid(s.setrole) end,'settings',to_jsonb(s.setconfig))
      order by s.setrole=0,pg_get_userbyid(s.setrole)),'[]') from pg_db_role_setting s
      where s.setdatabase=(select oid from pg_database where datname=current_database())""")
    path=internal.DIRECTORY/'database_environment_proposal_v1.json'
    if path.exists(): raise RuntimeError('Database prerequisite proposal already exists; no overwrite')
    extra=record['additional_privilege_baseline']
    proposal={'status':'PROPOSED_NOT_AUTHORIZED_FOR_APPLICATION','source_artifacts':{n:v[0] for n,v in internal.PINNED.items()},
              'source_system_identifier':record['source_before']['system_identifier'],
              'database':extra['database'],'database_settings':config}
    backup.write_json(path,proposal)
    internal.verify_acl([SQL_FILE,BUNDLE_FILE,path])
    names=[item.split('=',1)[0] for row in config for item in row['settings']]
    record['database_environment_proposal']={'path':str(path),'sha256':backup.file_sha256(path),'setting_names':names,'applied':False}
    backup.write_json(EVIDENCE,record)
    print(json.dumps({'protected_proposal':str(path),'sha256':backup.file_sha256(path),'setting_names':names,'applied':False}),flush=True)


def database_before(proposal):
    database=deepcopy(proposal['database'])
    database['acl']=[a for a in database['acl'] if a['grantee'] in ('postgres','PUBLIC')]
    return database


def database_projection():
    return "select pg_catalog.jsonb_build_object('owner',pg_catalog.pg_get_userbyid(d.datdba),'acl',"+backup.acl_sql('d.datacl','d.datdba','d')+",'connection_limit',d.datconnlimit,'allow_connections',d.datallowconn,'tablespace',(select spcname from pg_catalog.pg_tablespace where oid=d.dattablespace)) from pg_catalog.pg_database d where datname=pg_catalog.current_database()"


def generate_environment_sql(proposal,expected_settings,*,source_artifacts=None,proposal_sha256=None):
    archive_filename=proposal.get('archive_filename','retained_postgres_before_006.dump')
    bindings=artifact_bindings(source_artifacts,archive_filename)
    proposal_hash=APPROVED_PROPOSAL_SHA256 if proposal_sha256 is None else proposal_sha256
    if not isinstance(proposal_hash,str) or not re.fullmatch(r'[0-9a-f]{64}',proposal_hash):
        raise RuntimeError('Checksummed source-derived environment artifact required')
    if source_artifacts is not None and proposal_sha256 is None:
        raise RuntimeError('New recovery bindings require their own environment artifact checksum')
    if proposal['source_artifacts']!=bindings or not re.fullmatch(r'[0-9]{1,20}',proposal['source_system_identifier']):
        raise RuntimeError('Unapproved database prerequisite artifact binding')
    source=proposal['database']
    if source['owner']!='postgres': raise RuntimeError('Unapproved database grantor/owner')
    actual=[a for a in source['acl'] if a['grantee'] not in ('postgres','PUBLIC')]
    approved=[{'grantor':'postgres','grantee':role,'privilege':privilege,'grantable':False} for role,privileges in DATABASE_GRANTS.items() for privilege in privileges]
    baseline=[{'grantor':'postgres','grantee':role,'privilege':privilege,'grantable':False}
              for role,privileges in [('PUBLIC',('CONNECT','TEMPORARY')),('postgres',('CONNECT','CREATE','TEMPORARY'))] for privilege in privileges]
    key=lambda a:(a['grantor'],a['grantee'],a['privilege'],a['grantable'])
    if sorted(source['acl'],key=key)!=sorted(approved+baseline,key=key): raise RuntimeError('Database grants differ from explicit approval')
    settings=proposal['database_settings']
    if len(settings)!=1 or settings[0]['role'] is not None: raise RuntimeError('Unapproved role-specific database setting')
    parsed=[item.split('=',1) for item in settings[0]['settings']]
    if any(len(item)!=2 for item in parsed) or {item[0] for item in parsed}!=DATABASE_SETTINGS or len(parsed)!=2:
        raise RuntimeError('Database setting names differ from explicit approval')
    sql="""\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = '';
SET LOCAL standard_conforming_strings = on;
SELECT pg_catalog.set_config('queue_recovery.expected_cluster', :'recovery_target_identifier', true),
       pg_catalog.set_config('queue_recovery.archive_hash', :'recovery_archive_sha256', true),
       pg_catalog.set_config('queue_recovery.manifest_hash', :'recovery_manifest_sha256', true);
DO $environment_guard$
DECLARE cluster_id pg_catalog.text; actual pg_catalog.jsonb;
BEGIN
  SELECT system_identifier::pg_catalog.text INTO cluster_id FROM pg_catalog.pg_control_system();
  IF pg_catalog.current_database()<>'queue_restore_verify' OR session_user<>'supabase_admin'
     OR current_user<>'supabase_admin' OR pg_catalog.inet_client_addr() IS NOT NULL
     OR pg_catalog.inet_server_addr() IS NOT NULL OR pg_catalog.current_setting('listen_addresses')<>''
     OR cluster_id=SOURCE_ID OR cluster_id<>pg_catalog.current_setting('queue_recovery.expected_cluster')
     OR pg_catalog.current_setting('queue_recovery.archive_hash')<>ARCHIVE_HASH
     OR pg_catalog.current_setting('queue_recovery.manifest_hash')<>MANIFEST_HASH THEN
    RAISE EXCEPTION 'Database prerequisite target/artifacts rejected' USING ERRCODE='42501';
  END IF;
  SELECT (DB_PROJECTION) INTO actual;
  IF actual IS DISTINCT FROM BEFORE_DATABASE::pg_catalog.jsonb
     OR EXISTS(select 1 from pg_catalog.pg_db_role_setting where setdatabase=(select oid from pg_catalog.pg_database where datname=pg_catalog.current_database())) THEN
    RAISE EXCEPTION 'Unexpected initial verification database privileges/settings' USING ERRCODE='42501';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname::text IN
       ('postgres','dashboard_user','supabase_etl_admin','supabase_storage_admin'))<>4 THEN
    RAISE EXCEPTION 'Database prerequisite roles missing' USING ERRCODE='42501';
  END IF;
END
$environment_guard$;
SET LOCAL ROLE "postgres";
"""
    for token,value in [('SOURCE_ID',proposal['source_system_identifier']),('ARCHIVE_HASH',bindings[archive_filename]),
                        ('MANIFEST_HASH',bindings['source_snapshot_manifest.json']),('BEFORE_DATABASE',json.dumps(database_before(proposal),sort_keys=True))]:
        sql=sql.replace(token,backup.literal(value))
    sql=sql.replace('DB_PROJECTION',database_projection())
    sql='-- Explicitly approved isolated database prerequisites; protected configuration.\n-- Proposal SHA-256: '+proposal_hash+'\n'+sql
    for acl in sorted(actual,key=key):
        sql+='GRANT '+acl['privilege']+' ON DATABASE "queue_restore_verify" TO '+backup.quote_identifier(acl['grantee'])+';\n'
    sql+='RESET ROLE;\n'
    for name,value in parsed:
        sql+='ALTER DATABASE "queue_restore_verify" SET '+backup.quote_identifier(name)+' TO '+backup.literal(value)+';\n'
    # No secret values in diagnostics; compare settings through their hashes.
    settings_projection="select coalesce(jsonb_agg(jsonb_build_object('role',case when s.setrole=0 then '<all>' else pg_get_userbyid(s.setrole) end,'settings_hash',encode(sha256(convert_to(s.setconfig::text,'UTF8')),'hex')) order by s.setrole=0,pg_get_userbyid(s.setrole)),'[]') from pg_catalog.pg_db_role_setting s where s.setdatabase=(select oid from pg_catalog.pg_database where datname=current_database())"
    sql+="DO $environment_check$\nDECLARE actual pg_catalog.jsonb; settings pg_catalog.jsonb;\nBEGIN\nSELECT ("+database_projection()+") INTO actual;\nSELECT ("+settings_projection+") INTO settings;\nIF actual IS DISTINCT FROM "+backup.literal(json.dumps(source,sort_keys=True))+"::pg_catalog.jsonb OR settings IS DISTINCT FROM "+backup.literal(json.dumps(expected_settings,sort_keys=True))+"::pg_catalog.jsonb THEN\nRAISE EXCEPTION 'Database prerequisites differ from approved source' USING ERRCODE='42501';\nEND IF;\nEND\n$environment_check$;\nCOMMIT;\n"
    return sql


def approve_environment():
    """User explicitly approved this exact protected prerequisite proposal in this turn."""
    record=json.loads(EVIDENCE.read_text(encoding='utf-8'))
    if record['phase']!='revalidated' or ENV_FILE.exists() or PRIVILEGE_BASELINE_FILE.exists(): raise RuntimeError('Fresh prepared recovery and absent environment artifacts required')
    if backup.file_sha256(PROPOSAL_FILE)!=APPROVED_PROPOSAL_SHA256: raise RuntimeError('Approved prerequisite proposal changed')
    proposal=json.loads(PROPOSAL_FILE.read_text(encoding='utf-8'))
    source=internal.source_check(internal.pinned_artifacts())
    _,env,_=backup.target()
    with backup.Snapshot(env) as snapshot: current=additional_privileges(snapshot.query)
    if current!=record['additional_privilege_baseline'] or source['system_identifier']!=proposal['source_system_identifier']:
        raise RuntimeError('Approved source privilege/configuration baseline changed')
    sql=generate_environment_sql(proposal,current['database_settings'])
    ENV_FILE.write_text(sql,encoding='utf-8')
    backup.write_json(PRIVILEGE_BASELINE_FILE,{'manifest_sha256':internal.PINNED['source_snapshot_manifest.json'][0],
                                             'source_system_identifier':source['system_identifier'],'privileges':current})
    bundle=json.loads(BUNDLE_FILE.read_text(encoding='utf-8'))
    bundle['approved_database_prerequisites']={'proposal':PROPOSAL_FILE.name,'proposal_sha256':APPROVED_PROPOSAL_SHA256,
      'sql':ENV_FILE.name,'sha256':backup.file_sha256(ENV_FILE),'bytes':ENV_FILE.stat().st_size,
      'authorization':'Explicit user approval: Authorize isolated prerequisite recovery',
      'database_grants':5,'database_settings':2}
    bundle['additional_privilege_baseline']={'file':PRIVILEGE_BASELINE_FILE.name,'sha256':backup.file_sha256(PRIVILEGE_BASELINE_FILE)}
    bundle['restore_order'].insert(-1,'explicitly approved database ACL/configuration prerequisites')
    backup.write_json(BUNDLE_FILE,bundle)
    record['bundle']['sha256']=backup.file_sha256(BUNDLE_FILE)
    record['approved_database_prerequisites']=bundle['approved_database_prerequisites']
    record['acl']=internal.verify_acl([SQL_FILE,BUNDLE_FILE,ENV_FILE,PROPOSAL_FILE,PRIVILEGE_BASELINE_FILE])
    backup.write_json(EVIDENCE,record)
    print('PASS: explicitly authorized database prerequisite SQL saved privately and checksummed; no database modified.',flush=True)


def prepare():
    if EVIDENCE.exists() or SQL_FILE.exists() or BUNDLE_FILE.exists(): raise RuntimeError('Recovery evidence/artifacts already exist; no overwrite')
    manifest=internal.pinned_artifacts()
    internal.verify_acl()
    source=internal.source_check(manifest)
    cause=root_cause(manifest)
    sql=generate_sql(manifest,source['system_identifier'])
    SQL_FILE.write_text(sql,encoding='utf-8')
    bundle={'format':1,'purpose':'exact source schema-privilege recovery','original_artifacts':{name:meta[0] for name,meta in internal.PINNED.items()},
            'source_project':backup.PROJECT,'source_system_identifier':source['system_identifier'],
            'snapshot':manifest['exported_snapshot'],'supplement':{'filename':SQL_FILE.name,'sha256':backup.file_sha256(SQL_FILE),'bytes':SQL_FILE.stat().st_size},
            'authorized_grants':authorized_grants(manifest),'restore_order':['matching PostgreSQL/extension prerequisites','password-free roles','template0 database creation',
             'full archive restoration','exact pre-supplement gap verification','schema privilege supplement','all data/schema/security comparisons']}
    backup.write_json(BUNDLE_FILE,bundle)
    acl=internal.verify_acl([SQL_FILE,BUNDLE_FILE])
    record={'phase':'revalidated','result':'PASS','source_before':source,'root_cause':cause,'acl':acl,
            'supplement':bundle['supplement'],'bundle':{'filename':BUNDLE_FILE.name,'sha256':backup.file_sha256(BUNDLE_FILE)},'migration_006_applied':False}
    backup.write_json(EVIDENCE,record)
    print('PASS: exact eight-entry root cause, pinned source/archive, protected manifest-bound SQL supplement and restore-order bundle.',flush=True)


def verify_bundle():
    record=json.loads(EVIDENCE.read_text(encoding='utf-8'))
    if backup.file_sha256(BUNDLE_FILE)!=record['bundle']['sha256'] or backup.file_sha256(SQL_FILE)!=record['supplement']['sha256']:
        raise RuntimeError('Recovery supplement or bundle checksum changed')
    bundle=json.loads(BUNDLE_FILE.read_text(encoding='utf-8'))
    manifest=internal.pinned_artifacts()
    if bundle['original_artifacts']!={name:meta[0] for name,meta in internal.PINNED.items()} or bundle['snapshot']!=manifest['exported_snapshot']:
        raise RuntimeError('Supplement belongs to a different archive/manifest')
    if SQL_FILE.read_text(encoding='utf-8')!=generate_sql(manifest,bundle['source_system_identifier']):
        raise RuntimeError('Recovery SQL differs from reviewed source-authorized generation')
    if 'approved_database_prerequisites' in bundle:
        approved=bundle['approved_database_prerequisites']
        if backup.file_sha256(PROPOSAL_FILE)!=approved['proposal_sha256'] or approved['proposal_sha256']!=APPROVED_PROPOSAL_SHA256 or backup.file_sha256(ENV_FILE)!=approved['sha256']:
            raise RuntimeError('Approved database prerequisite checksums changed')
        proposal=json.loads(PROPOSAL_FILE.read_text(encoding='utf-8'))
        if ENV_FILE.read_text(encoding='utf-8')!=generate_environment_sql(proposal,record['additional_privilege_baseline']['database_settings']):
            raise RuntimeError('Database prerequisite SQL differs from approved generation')
        if backup.file_sha256(PRIVILEGE_BASELINE_FILE)!=bundle['additional_privilege_baseline']['sha256']:
            raise RuntimeError('Additional privilege baseline checksum changed')
        baseline=json.loads(PRIVILEGE_BASELINE_FILE.read_text(encoding='utf-8'))
        if baseline['privileges']!=record['additional_privilege_baseline'] or baseline['manifest_sha256']!=internal.PINNED['source_snapshot_manifest.json'][0]:
            raise RuntimeError('Additional privilege baseline differs from bound source')
    return bundle


def post_archive(destination,manifest,record,folder):
    bundle=verify_bundle()
    before=backup.schema_metadata(destination.query)
    validate_known_gap(manifest,before)
    if backup.compare_rows(manifest['rows'],backup.all_rows(destination.query))!=69:
        raise RuntimeError('Full archive data restore incomplete before supplement')
    if backup.role_metadata(destination.query)!=manifest['roles'] or backup.sequence_values(destination.query)!=manifest['sequences']:
        raise RuntimeError('Other role or sequence privileges/state differ before supplement')
    if backup.table_catalog(destination.query)!=manifest['catalog'] or backup.state(None,destination.query)!=manifest['state']:
        raise RuntimeError('Other application/partition/migration state differs before supplement')
    extra=additional_privileges(destination.query)
    expected=record['additional_privilege_baseline']
    if any(extra[key]!=expected[key] for key in ('sequence_acls','column_acls','type_acls')):
        raise RuntimeError('Other sequence/column/type privileges differ before supplement')
    proposal=json.loads(PROPOSAL_FILE.read_text(encoding='utf-8'))
    if extra['database']!=database_before(proposal) or extra['database_settings']!=[]:
        raise RuntimeError('Database prerequisite gap differs from approved restore baseline')
    internal_sql=destination.copy(SQL_FILE,SQL_FILE.name)
    variables={'recovery_target_identifier':destination.entry['system_identifier'],
               'recovery_archive_sha256':internal.PINNED['retained_postgres_before_006.dump'][0],
               'recovery_manifest_sha256':internal.PINNED['source_snapshot_manifest.json'][0]}
    # Passing negative test: source-cluster identifier must reject before any grant.
    wrong={**variables,'recovery_target_identifier':bundle['source_system_identifier']}
    caught=None
    try: destination.psql(internal.DATABASE,file=internal_sql,variables=wrong,label='Expected rejected recovery target')
    except RuntimeError as error: caught=str(error)
    if not caught or 'SQLSTATE 42501' not in caught or backup.schema_metadata(destination.query)!=before:
        raise RuntimeError('Supplement target guard failed or changed privileges on rejection')
    record['pre_supplement']={'exact_missing_entries':8,'all_other_schema_sections_match':True,'all_69_tables_match':True,'wrong_cluster_rejected_without_changes':True}
    internal.save(record)
    destination.identity(internal.DATABASE)
    result=destination.psql(internal.DATABASE,file=internal_sql,variables=variables,label='Exact schema privilege recovery supplement')
    if result.stderr.strip(): raise RuntimeError('Schema recovery emitted diagnostics; stop for review')
    after=backup.schema_metadata(destination.query)
    if after!=manifest['schema']: raise RuntimeError('Complete schema/security metadata differs after supplement')
    record['supplement_applied']={'exit':result.returncode,'entries':8,'grantor_and_grant_options_match':True,'all_15_schema_sections_match':True,
                                 'file_sha256':backup.file_sha256(SQL_FILE),'bundle_sha256':backup.file_sha256(BUNDLE_FILE)}
    internal.save(record)
    print('PASS: exact eight missing grants recovered with source grantor/options; all 15 schema/security sections now match.',flush=True)
    if 'approved_database_prerequisites' not in bundle: raise RuntimeError('Explicit database prerequisite approval required for complete recovery')
    environment_sql=destination.copy(ENV_FILE,ENV_FILE.name)
    result=destination.psql(internal.DATABASE,file=environment_sql,variables=variables,label='Explicitly authorized database prerequisite recovery')
    if result.stderr.strip(): raise RuntimeError('Database prerequisite restoration emitted diagnostics')
    if additional_privileges(destination.query)!=expected: raise RuntimeError('Complete database/sequence/column/type privilege comparison failed')
    if backup.schema_metadata(destination.query)!=manifest['schema']: raise RuntimeError('Database prerequisite restore changed unrelated schema privileges')
    record['database_prerequisites_applied']={'exit':result.returncode,'grants':5,'settings':2,'all_additional_privileges_match':True,'sha256':backup.file_sha256(ENV_FILE)}
    internal.save(record)
    print('PASS: authorized database ACLs/settings and all explicit sequence/column/type ACLs match source; final preservation verification follows.',flush=True)


def run():
    verify_bundle()
    internal.EVIDENCE=EVIDENCE
    record=json.loads(EVIDENCE.read_text(encoding='utf-8'))
    if 'additional_privilege_baseline' not in record: raise RuntimeError('Explicit sequence and database privilege baseline required')
    owner=record['additional_privilege_baseline']['database']['owner']
    internal.restore(post_archive_hook=post_archive,database_owner=owner)
    record=json.loads(EVIDENCE.read_text(encoding='utf-8'))
    if record.get('phase')!='complete' or not record.get('recoverability_verified') or not record.get('supplement_applied') or not record.get('database_prerequisites_applied'):
        raise RuntimeError('Complete supplemented restore certification required')
    verify_bundle()
    _,env,_=backup.target()
    with backup.Snapshot(env) as snapshot: current=additional_privileges(snapshot.query)
    if current!=record['additional_privilege_baseline']: raise RuntimeError('Final source additional privileges/settings changed')
    summary=backup.load()
    summary['backup'].update(recovery_unit='archive + password-free roles + schema ACL supplement + approved database prerequisites + matching platform',
                           archive_alone_certified=False,schema_privilege_supplement=str(SQL_FILE),
                           schema_privilege_supplement_sha256=backup.file_sha256(SQL_FILE),recovery_bundle=str(BUNDLE_FILE),
                           recovery_bundle_sha256=backup.file_sha256(BUNDLE_FILE))
    summary['backup'].update(database_prerequisite_sql=str(ENV_FILE),database_prerequisite_sha256=backup.file_sha256(ENV_FILE),
                            database_prerequisite_proposal=str(PROPOSAL_FILE),database_prerequisite_proposal_sha256=APPROVED_PROPOSAL_SHA256,
                            additional_privilege_baseline=str(PRIVILEGE_BASELINE_FILE),additional_privilege_baseline_sha256=backup.file_sha256(PRIVILEGE_BASELINE_FILE))
    summary['schema_privilege_recovery_evidence']=str(EVIDENCE)
    backup.save(summary)
    print('STOPPED: complete manifested database-level recovery bundle verified; retained source unchanged; migration 006 NOT applied.',flush=True)


def verify_existing():
    """Read-only artifact/source recheck; does not repeat restoration or restart a container."""
    record=json.loads(EVIDENCE.read_text(encoding='utf-8'))
    if record.get('phase')!='complete' or record.get('result')!='PASS' or not record.get('recoverability_verified'):
        raise RuntimeError('Successful completed supplemented restore required')
    verify_bundle()
    internal.verify_acl([SQL_FILE,BUNDLE_FILE,ENV_FILE,PROPOSAL_FILE,PRIVILEGE_BASELINE_FILE])
    internal.source_check(internal.pinned_artifacts())
    _,env,_=backup.target()
    with backup.Snapshot(env) as snapshot: current=additional_privileges(snapshot.query)
    if current!=record['additional_privilege_baseline']: raise RuntimeError('Retained additional privileges/settings changed')
    folder=internal.DIRECTORY/('internal_restore_'+record['destination']['container'][-8:])
    stopped=internal.Destination(record['destination'],folder).guard(running=False)
    if stopped['State']['Running']: raise RuntimeError('Completed recovery container should be stopped')
    print('PASS: all recovery artifact hashes/ACLs, retained source data/security and stopped disposable identity rechecked read-only; no restore repeated.',flush=True)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('phase',choices=['prepare','capture-additional','propose-environment','approve-environment','restore','verify'])
    phase=parser.parse_args().phase
    if phase=='prepare': prepare()
    elif phase=='capture-additional': capture_additional()
    elif phase=='propose-environment': propose_environment()
    elif phase=='approve-environment': approve_environment()
    elif phase=='verify': verify_existing()
    else: run()


if __name__=='__main__':
    try: main()
    except Exception as error:
        message=str(error) if isinstance(error,RuntimeError) else 'Recovery supplement harness failed; raw diagnostics suppressed.'
        if EVIDENCE.exists():
            record=json.loads(EVIDENCE.read_text(encoding='utf-8'))
            record.update(result='FAIL',failure=message,recoverability_verified=False,migration_006_applied=False)
            backup.write_json(EVIDENCE,record)
        print('STOP: '+message,flush=True)
        sys.exit(1)
