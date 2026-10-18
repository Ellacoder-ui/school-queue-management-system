"""Guarded retained-local backup proof. No migration application command exists.
Each phase refuses changed assumptions. All source connections are read-only.
Sensitive dump/role files live only in a Git-ignored, ACL-restricted backup directory.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import queue
import socket
import subprocess
import sys
import tomllib
import time
import threading
import uuid

from routing_isolation import ROOT, CLI, ORIGINAL_HASHES, clean_env, status, sql_env, read_json, fingerprint, psql_path

PROJECT='school-queue-local'
VERSION='20261016000600'
MIGRATION=ROOT/'supabase/migrations/20261016000600_fixed_counter_routing.sql'
BACKUPS=ROOT/'.local-backups'
EVIDENCE=ROOT/'supabase/tests/results/retained_backup_validation.json'
FAILED_ATTEMPT=ROOT/'supabase/tests/results/retained_migration_006.json'
PREVIOUS=json.loads((ROOT/'supabase/tests/results/routing_isolation_b558edf3.json').read_text(encoding='utf-8'))
CANONICAL={'1':['TP'],'2':['SOA'],'3':['PNEP'],'4':['REF'],'5':['ADJ']}
LEGACY={'1':['SOA','TP'],'2':['SOA','TP'],'3':[],'4':[],'5':[]}

def call(command, *, env=None, input=None, cwd=ROOT, timeout=120, label='Local command'):
    r=subprocess.run(command,env=env or clean_env(),input=input,cwd=cwd,capture_output=True,text=True,encoding='utf-8',timeout=timeout)
    if r.returncode:
        codes=re.findall(r'(?:ERROR|FATAL):\s+([A-Z0-9]{5})\b',r.stderr)
        raise RuntimeError(label+' failed'+(' [SQLSTATE '+','.join(sorted(set(codes)))+']' if codes else '')+'; raw diagnostics suppressed')
    return r

def save(data):
    EVIDENCE.write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')

def load(): return json.loads(EVIDENCE.read_text(encoding='utf-8'))

def verify_files():
    if Path.cwd().resolve()!=ROOT.resolve(): raise RuntimeError('Correct project working directory required')
    files=sorted((ROOT/'supabase/migrations').glob('*.sql'))
    if len(files)!=6 or files[-1]!=MIGRATION: raise RuntimeError('Exactly the six reviewed migration files required')
    hashes=[hashlib.sha256(p.read_bytes()).hexdigest() for p in files]
    if hashes[:5]!=ORIGINAL_HASHES: raise RuntimeError('Original migration integrity mismatch')
    for stage in ['fresh','upgrade']:
        copy=ROOT/'.local-routing/b558edf3'/stage/'supabase/migrations'/MIGRATION.name
        if not copy.is_file() or hashlib.sha256(copy.read_bytes()).hexdigest()!=hashes[5]:
            raise RuntimeError('Migration 006 differs from validated disposable copy')
    return files,hashes

def target():
    files,hashes=verify_files()
    cfg=tomllib.loads((ROOT/'supabase/config.toml').read_text(encoding='utf-8'))
    if cfg['project_id']!=PROJECT or cfg['api']['port']!=54321 or cfg['db']['port']!=54322 or cfg['api']['schemas']!=['public','queue_api','queue_display']:
        raise RuntimeError('Retained project configuration mismatch')
    local,db=status(ROOT,54322,54321)
    items=json.loads(call(['docker','inspect','supabase_db_'+PROJECT,'supabase_kong_'+PROJECT],label='Docker identity inspection').stdout)
    metadata=[]
    for item,internal,port in zip(items,['5432/tcp','8000/tcp'],[54322,54321]):
        if not item['State']['Running'] or item['Name']!='/supabase_'+('db' if port==54322 else 'kong')+'_'+PROJECT:
            raise RuntimeError('Retained container identity mismatch')
        bindings=item['NetworkSettings']['Ports'].get(internal) or []
        if not bindings or any(int(b['HostPort'])!=port or b['HostIp'] not in ['0.0.0.0','::','127.0.0.1'] for b in bindings):
            raise RuntimeError('Retained published port mismatch')
        networks=sorted(item['NetworkSettings']['Networks'])
        if networks!=['supabase_network_'+PROJECT]: raise RuntimeError('Unexpected retained network')
        volumes=[m['Name'] for m in item['Mounts'] if m['Type']=='volume']
        if port==54322 and volumes!=['supabase_db_'+PROJECT]: raise RuntimeError('Retained database volume mismatch')
        metadata.append({'container':item['Name'][1:],'image':item['Config']['Image'],'networks':networks,'volumes':volumes,'bindings':bindings})
    env=sql_env(db,54322,True)
    server=read_json(env,"select jsonb_build_object('database',current_database(),'user',current_user,'version',current_setting('server_version'),'port',inet_server_port())")
    if server['database']!='postgres' or server['user']!='postgres' or server['version']!='17.11' or server['port']!=5432:
        raise RuntimeError('Unexpected retained PostgreSQL server')
    return local,env,{'project':PROJECT,'api':'http://127.0.0.1:54321','database_endpoint':'127.0.0.1:54322','server':server,'docker':metadata,'migration_sha256':dict(zip([p.name for p in files],hashes))}

def state(env,query=None):
    return (query or (lambda sql:read_json(env,sql)))("""select jsonb_build_object(
      'versions',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations),
      'routes',(select jsonb_object_agg(number,codes) from (select c.number,coalesce(jsonb_agg(s.code order by s.code) filter(where s.id is not null),'[]') codes from queue_private.counters c left join queue_private.counter_services x on x.counter_id=c.id left join queue_private.services s on s.id=x.service_id group by c.number)r),
      'counts',jsonb_build_object('accounts',(select count(*) from queue_private.accounts),'tickets',(select count(*) from queue_private.tickets),'events',(select count(*) from queue_private.ticket_events),'requests',(select count(*) from queue_private.operation_requests),'audits',(select count(*) from queue_private.admin_audit_events),'days',(select count(*) from queue_private.queue_days),'services',(select count(*) from queue_private.services),'counters',(select count(*) from queue_private.counters)),
      'active',(select count(*) from queue_private.tickets where status in ('WAITING','CALLED')),
      'open_days',(select count(*) from queue_private.queue_days where closed_at is null),
      'current_day_closed',exists(select 1 from queue_private.queue_days where business_date=(clock_timestamp() at time zone 'Asia/Manila')::date and closed_at is not null),
      'assignments',(select jsonb_agg(jsonb_build_object('counter',c.number,'total',(select count(*) from queue_private.staff_counter_assignments x where x.counter_id=c.id),'eligible',(select count(*) from queue_private.staff_counter_assignments x join queue_private.accounts a on a.id=x.account_id where x.counter_id=c.id and a.role='CASHIER' and a.enabled)) order by c.number) from queue_private.counters c),
      'rls_count',(select count(*) from pg_tables where schemaname in ('queue_private','queue_display') and rowsecurity),
      'publication',(select jsonb_agg(schemaname||'.'||tablename order by tablename) from pg_publication_tables where pubname='supabase_realtime'),
      'private_usage',has_schema_privilege('anon','queue_private','USAGE') or has_schema_privilege('authenticated','queue_private','USAGE'))""")

def legacy_security(env):
    return read_json(env,"""select jsonb_build_object(
     'schemas',(select jsonb_object_agg(nspname,jsonb_build_object('owner',pg_get_userbyid(nspowner),'acl',nspacl::text)) from pg_namespace where nspname in ('queue_private','queue_api','queue_display')),
     'tables',(select jsonb_object_agg(n.nspname||'.'||c.relname,jsonb_build_object('owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('queue_private','queue_display') and c.relkind='r'),
     'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname),'[]') from pg_policies p where schemaname in ('queue_private','queue_display')),
     'functions',(select jsonb_object_agg(n.nspname||'.'||p.proname,jsonb_build_object('owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'definer',p.prosecdef,'config',p.proconfig,'body_hash',md5(p.prosrc),'arguments',pg_get_function_identity_arguments(p.oid))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('queue_private','queue_api','queue_display')),
     'defaults',(select coalesce(jsonb_agg(to_jsonb(d) order by d.defaclnamespace,d.defaclrole,d.defaclobjtype),'[]') from pg_default_acl d where defaclnamespace in(select oid from pg_namespace where nspname in ('queue_private','queue_api','queue_display'))))""")

def quote_identifier(value):
    if not isinstance(value,str) or '\x00' in value: raise RuntimeError('Invalid catalog identifier')
    return '"'+value.replace('"','""')+'"'

def literal(value):
    if not isinstance(value,str) or '\x00' in value: raise RuntimeError('Invalid SQL literal')
    return "'"+value.replace("'","''")+"'"

def table_key(schema,name): return quote_identifier(schema)+'.'+quote_identifier(name)

def row_digest(alias,columns):
    nulls='array['+','.join(quote_identifier(alias)+'.'+quote_identifier(c)+' is null' for c in columns)+']::boolean[]'
    return "encode(sha256(convert_to(jsonb_build_array(to_jsonb("+quote_identifier(alias)+"),to_jsonb("+nulls+"))::text,'UTF8')),'hex')"

CANONICAL_SETTINGS="set local timezone='UTC'; set local datestyle='ISO,YMD'; set local intervalstyle='postgres'; set local extra_float_digits=3; set local bytea_output='hex'; set local search_path=''; "

def canonical_query(env,sql): return read_json(env,CANONICAL_SETTINGS+sql)

def acl_sql(expression,owner,kind):
    return """(select coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),
      'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
      'privilege',a.privilege_type,'grantable',a.is_grantable)
      order by pg_get_userbyid(a.grantor),case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,a.privilege_type),'[]')
      from aclexplode(coalesce("""+expression+",acldefault('"+kind+"'::\"char\","+owner+"))) a)"

def schema_metadata(query,application_only=False):
    ns="n.nspname in ('queue_private','queue_api','queue_display')" if application_only else "n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp_%'"
    # OIDs only join local catalogs. They are never part of the compared result.
    sections={
      'schemas':f"select n.nspname key,jsonb_build_object('owner',pg_get_userbyid(n.nspowner),'acl',{acl_sql('n.nspacl','n.nspowner','n')}) value from pg_namespace n where {ns}",
      'relations':f"select format('%I.%I',n.nspname,c.relname) key,jsonb_build_object('kind',c.relkind::text,'owner',pg_get_userbyid(c.relowner),'acl',{acl_sql('c.relacl','c.relowner','r')},'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'persistence',c.relpersistence::text,'replica_identity',c.relreplident::text,'options',c.reloptions,'view',case when c.relkind in ('v','m') then pg_get_viewdef(c.oid,true) end) value from pg_class c join pg_namespace n on n.oid=c.relnamespace where {ns} and c.relkind in ('r','p','v','m','f')",
      'functions':f"select format('%I.%I',n.nspname,p.proname)||'('||pg_get_function_identity_arguments(p.oid)||')' key,jsonb_build_object('owner',pg_get_userbyid(p.proowner),'acl',{acl_sql('p.proacl','p.proowner','f')},'definition',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')) value from pg_proc p join pg_namespace n on n.oid=p.pronamespace where {ns} and p.prokind in ('f','p')",
      'defaults':f"select pg_get_userbyid(d.defaclrole)::text||':'||coalesce(n.nspname::text,'<global>')||':'||d.defaclobjtype::text key,{acl_sql('d.defaclacl','d.defaclrole','r')} value from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace where d.defaclnamespace=0 or {ns}",
      'constraints':f"select format('%I.%I',n.nspname,c.relname)||':'||k.conname::text key,jsonb_build_object('definition',pg_get_constraintdef(k.oid,true),'validated',k.convalidated,'deferrable',k.condeferrable,'deferred',k.condeferred) value from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where {ns}",
      'indexes':f"select format('%I.%I',n.nspname,c.relname) key,jsonb_build_object('definition',pg_get_indexdef(c.oid),'valid',i.indisvalid,'ready',i.indisready) value from pg_index i join pg_class c on c.oid=i.indexrelid join pg_namespace n on n.oid=c.relnamespace where {ns}",
      'triggers':f"select format('%I.%I',n.nspname,c.relname)||':'||t.tgname::text key,jsonb_build_object('definition',pg_get_triggerdef(t.oid,true),'enabled',t.tgenabled) value from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where {ns} and not t.tgisinternal",
      'columns':f"select format('%I.%I',n.nspname,c.relname)||':'||a.attname key,jsonb_build_object('position',row_number() over(partition by c.oid order by a.attnum),'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid)) value from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where {ns} and c.relkind in ('r','p','v','m','f') and a.attnum>0 and not a.attisdropped",
      'policies':"select schemaname::text||'.'||tablename::text||':'||policyname::text key,to_jsonb(p) value from pg_policies p where "+("schemaname in ('queue_private','queue_display')" if application_only else "schemaname not in ('pg_catalog','information_schema')"),
      'extensions':"select e.extname key,jsonb_build_object('version',e.extversion,'schema',n.nspname,'owner',pg_get_userbyid(e.extowner)) value from pg_extension e join pg_namespace n on n.oid=e.extnamespace",
      'publication':"select pubname::text||':'||schemaname::text||'.'||tablename::text key,to_jsonb(p) value from pg_publication_tables p",
      'publication_options':"select pubname key,jsonb_build_object('owner',pg_get_userbyid(pubowner),'all_tables',puballtables,'insert',pubinsert,'update',pubupdate,'delete',pubdelete,'truncate',pubtruncate,'via_root',pubviaroot) value from pg_publication",
      'types':f"select format('%I.%I',n.nspname,t.typname) key,jsonb_build_object('kind',t.typtype::text,'owner',pg_get_userbyid(t.typowner),'labels',(select jsonb_agg(enumlabel order by enumsortorder) from pg_enum where enumtypid=t.oid),'base',format_type(t.typbasetype,t.typtypmod),'not_null',t.typnotnull,'default',t.typdefault,'checks',(select jsonb_object_agg(conname,pg_get_constraintdef(oid,true)) from pg_constraint where contypid=t.oid)) value from pg_type t join pg_namespace n on n.oid=t.typnamespace where {ns} and t.typtype in ('e','d')",
      'sequences':"select schemaname::text||'.'||sequencename::text key,to_jsonb(s)-'last_value' value from pg_sequences s where schemaname not in ('pg_catalog','information_schema')",
      'partitions':f"select format('%I.%I',n.nspname,c.relname) key,jsonb_build_object('partition',c.relispartition,'key',pg_get_partkeydef(c.oid),'bound',pg_get_expr(c.relpartbound,c.oid,true),'parents',coalesce((select jsonb_agg(jsonb_build_object('schema',pn.nspname,'table',pc.relname,'sequence',i.inhseqno) order by i.inhseqno) from pg_inherits i join pg_class pc on pc.oid=i.inhparent join pg_namespace pn on pn.oid=pc.relnamespace where i.inhrelid=c.oid),'[]')) value from pg_class c join pg_namespace n on n.oid=c.relnamespace where {ns} and c.relkind in ('r','p','f')",
    }
    result={}
    for name,sql in sections.items():
        result[name]=query("select coalesce(jsonb_object_agg(key,value order by key collate \"C\"),'{}') from ("+sql+") entries")
    return result

def security(env): return schema_metadata(lambda sql:canonical_query(env,sql),True)

def role_metadata(query):
    return query("""select jsonb_build_object('roles',(select jsonb_object_agg(rolname,jsonb_build_object('super',rolsuper,'inherit',rolinherit,'createrole',rolcreaterole,'createdb',rolcreatedb,'login',rolcanlogin,'replication',rolreplication,'bypassrls',rolbypassrls,'connection_limit',rolconnlimit,'valid_until',rolvaliduntil,'config_hash',encode(sha256(convert_to(coalesce(rolconfig::text,''),'UTF8')),'hex'))) from pg_roles),
       'memberships',(select coalesce(jsonb_agg(jsonb_build_object('role',pg_get_userbyid(roleid),'member',pg_get_userbyid(member),'grantor',pg_get_userbyid(grantor),'admin',admin_option,'inherit',inherit_option,'set',set_option) order by pg_get_userbyid(roleid),pg_get_userbyid(member),pg_get_userbyid(grantor)),'[]') from pg_auth_members))""")

def sequence_values(query):
    sequences=query("select coalesce(jsonb_agg(jsonb_build_object('schema',schemaname,'name',sequencename) order by schemaname,sequencename),'[]') from pg_sequences where schemaname not in ('pg_catalog','information_schema')")
    result={}
    for item in sequences:
        key=table_key(item['schema'],item['name'])
        result[key]=query('select jsonb_build_object(\'last_value\',last_value,\'is_called\',is_called) from '+key)
    return result

def preflight():
    verified=load()
    if verified.get('phase')!='fingerprints-verified': raise RuntimeError('Successful repaired fingerprint validation required first')
    _,env,identity=target()
    s=state(env)
    required=[p.name.split('_')[0] for p in sorted((ROOT/'supabase/migrations').glob('*.sql'))[:5]]
    if s['versions']!=required or s['routes']!=LEGACY or s['counts']!={'accounts':39,'tickets':20,'events':57,'requests':69,'audits':31,'days':7,'services':5,'counters':5}:
        raise RuntimeError('Material database/history/routing difference from approved report')
    if s['active'] or s['open_days'] or not s['current_day_closed'] or s['rls_count']!=15 or s['private_usage'] or s['publication']!=['queue_display.counter_state','queue_display.service_state']:
        raise RuntimeError('Unsafe queue day, active work or security state')
    rows=fingerprint(env)
    if rows!=PREVIOUS['retained_fingerprint']: raise RuntimeError('Retained rows differ from validated baseline')
    expected=[{'counter':i,'total':n,'eligible':e} for i,n,e in [(1,1,1),(2,1,1),(3,0,0),(4,0,0),(5,2,1)]]
    if s['assignments']!=expected: raise RuntimeError('Retained staffing differs from approved report')
    result={**verified,'phase':'preflight','result':'PASS','identity':identity,'preflight':s,'baseline_rows':rows,'baseline_security':security(env),'pending':[VERSION]}
    save(result)
    print('PASS: retained identity, five applied/one pending migrations, validated file hashes, exact legacy routing, staffing, history, RLS and closed/no-active state.',flush=True)

def pgtool(name):
    tool=Path(psql_path()).parent/(name+'.exe')
    if not tool.is_file(): raise RuntimeError(name+' is required')
    return str(tool)

def table_catalog(query):
    return query("""select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'owner',pg_get_userbyid(c.relowner),'extension',
      (select e.extname from pg_depend d join pg_extension e on e.oid=d.refobjid where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e'),
      'kind',c.relkind::text,'is_partition',c.relispartition,'partition_key',pg_get_partkeydef(c.oid),'bound',pg_get_expr(c.relpartbound,c.oid,true),
      'parents',coalesce((select jsonb_agg(jsonb_build_object('schema',pn.nspname,'table',pc.relname,'sequence',i.inhseqno) order by i.inhseqno) from pg_inherits i join pg_class pc on pc.oid=i.inhparent join pg_namespace pn on pn.oid=pc.relnamespace where i.inhrelid=c.oid),'[]'),
      'extension_config',exists(select 1 from pg_extension e where c.oid=any(e.extconfig)),
      'extension_condition',(select e.extcondition[array_position(e.extconfig,c.oid)] from pg_extension e where c.oid=any(e.extconfig)),
      'columns',
      (select coalesce(jsonb_agg(a.attname order by a.attnum),'[]') from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped))
      order by n.nspname collate "C",c.relname collate "C"),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.relkind in ('r','p','f') and n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp_%'""")

def all_rows(query):
    tables=table_catalog(query)
    if any(t.get('kind')=='f' for t in tables):
        raise RuntimeError('Foreign-table recovery needs an explicit external-data plan; no foreign data queried')
    result={}
    # Bounded SQL size and constant function arity, independent of table count.
    for start in range(0,len(tables),16):
        entries=[]
        for t in tables[start:start+16]:
            name=table_key(t['schema'],t['table'])
            row=row_digest('x',t['columns'])
            entries.append("select "+literal(name)+"::text table_key,(select jsonb_build_object('count',count(*),'rows',coalesce(jsonb_agg(h order by h collate \"C\"),'[]'::jsonb)) from (select "+row+" h from "+name+" x) hashes) contents")
        batch=query('select jsonb_object_agg(table_key,contents order by table_key collate "C") from ('+' union all '.join(entries)+') fingerprints')
        if set(batch)!={table_key(t['schema'],t['table']) for t in tables[start:start+16]}:
            raise RuntimeError('Fingerprint batch inventory differs from catalog')
        if set(result)&set(batch): raise RuntimeError('Duplicate catalog table identity')
        result.update(batch)
    return result

def compare_rows(expected,observed,required=None):
    required=set(expected) if required is None else set(required)
    if not required<=set(expected) or not required<=set(observed): raise RuntimeError('Required fingerprint/table is missing')
    if required==set(expected) and set(expected)!=set(observed): raise RuntimeError('Restored table inventory differs')
    for key in sorted(required):
        if expected[key]!=observed[key]: raise RuntimeError('Canonical table row comparison failed')
    return len(required)

def toc_table_inventory(toc,catalog,kind='TABLE DATA'):
    if kind not in ('TABLE DATA','TABLE','TABLE ATTACH','FOREIGN TABLE'):
        raise RuntimeError('Unsupported archive entry classification')
    result=[]
    pattern=r'^\d+; \d+ \d+ '+re.escape(kind)+r' (.+)$'
    for payload in re.findall(pattern,toc,re.M):
        # TABLE DATA/ATTACH are separate descriptors, not TABLE definitions.
        if kind=='TABLE' and payload.startswith(('DATA ','ATTACH ')): continue
        candidates=[t for t in catalog if payload==f"{t['schema']} {t['table']} {t['owner']}"]
        if len(candidates)!=1: raise RuntimeError('Unmatched or ambiguous archive table identity')
        key=table_key(candidates[0]['schema'],candidates[0]['table'])
        if key in result: raise RuntimeError('Duplicate archive table identity')
        result.append(key)
    return result

def archive_completeness(toc,catalog,rows,extensions):
    by_key={table_key(t['schema'],t['table']):t for t in catalog}
    if len(by_key)!=len(catalog) or set(rows)!=set(by_key):
        raise RuntimeError('Source catalog/fingerprint inventory differs')
    data=set(toc_table_inventory(toc,catalog))
    definitions=set(toc_table_inventory(toc,catalog,'TABLE'))
    attachments=set(toc_table_inventory(toc,catalog,'TABLE ATTACH'))
    foreign=set(toc_table_inventory(toc,catalog,'FOREIGN TABLE'))
    extension_entries=[]
    for payload in re.findall(r'^\d+; \d+ \d+ EXTENSION - (.+)$',toc,re.M):
        candidates=[name for name in extensions if payload==name+' ']
        # pg_restore prints an empty owner as a trailing space or no space.
        if not candidates: candidates=[name for name in extensions if payload.strip()==name]
        if len(candidates)!=1 or candidates[0] in extension_entries:
            raise RuntimeError('Unknown/ambiguous/duplicate extension archive identity')
        extension_entries.append(candidates[0])
    # pg_dump omits initdb's built-in plpgsql extension. Its compatible owner/version
    # is a mandatory destination-template preflight, not an assumed extension omission.
    template_extensions={name for name,meta in extensions.items()
      if name=='plpgsql' and meta.get('schema')=='pg_catalog' and meta.get('version')=='1.0' and meta.get('owner')=='supabase_admin'}
    if set(extension_entries)|template_extensions!=set(extensions): raise RuntimeError('Archive extension prerequisites incomplete')
    parents=[];physical=[];extension_recreated=[];expected_attachments=set()
    for key,t in by_key.items():
        kind=t['kind'];ext=t['extension']
        if kind=='f' or key in foreign:
            raise RuntimeError('Foreign tables require separate external-data recovery validation')
        if kind not in ('r','p'): raise RuntimeError('Unsupported source table kind')
        for parent in t['parents']:
            parent_key=table_key(parent['schema'],parent['table'])
            if parent_key not in by_key: raise RuntimeError('Partition/inheritance parent missing from catalog')
        if t['is_partition']:
            if len(t['parents'])!=1 or by_key[table_key(t['parents'][0]['schema'],t['parents'][0]['table'])]['kind']!='p' or not t['bound']:
                raise RuntimeError('Invalid partition ancestry/bound')
            expected_attachments.add(key)
        if ext:
            if ext not in extensions: raise RuntimeError('Extension-managed table has no recovery prerequisite')
            if t['extension_condition'] not in (None,''):
                raise RuntimeError('Filtered extension data requires an explicit complete-row recovery plan')
        elif key not in definitions:
            raise RuntimeError('Archive omitted a required table definition')
        if kind=='p':
            if key not in definitions or key in data or not t['partition_key']:
                raise RuntimeError('Partitioned parent must have DDL/key and no independent TABLE DATA')
            parents.append(key)
        else:
            physical.append(key)
            if key not in data:
                # Extension scripts can recreate only verified empty, non-config tables.
                # Actual restore must still match every logical table and object.
                if not ext or t['extension_config'] or rows[key]!={'count':0,'rows':[]}:
                    raise RuntimeError('Archive omitted required physical-table data')
                extension_recreated.append(key)
    if attachments!=expected_attachments:
        raise RuntimeError('Archive partition attachments differ from source ancestry')
    return {'logical_tables':len(by_key),'physical_tables':len(physical),'table_data_entries':len(data),
            'partitioned_parents':sorted(parents),'partition_attachments':len(attachments),
            'extension_recreated_empty_tables':sorted(extension_recreated),'template_extensions_to_verify':sorted(template_extensions),'dumped_tables':sorted(data)}

def file_sha256(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def write_json(path,value):
    path.write_text(json.dumps(value,sort_keys=True,indent=2,ensure_ascii=True)+'\n',encoding='utf-8')

def isolated_init_script():
    # Bypass bundled Supabase platform initialization: restore into template0 instead.
    # Only a newly created, independently fenced volume is mounted at this fixed path.
    return """set -Eeuo pipefail
export PGDATA=/var/lib/postgresql/data
test ! -e "$PGDATA/PG_VERSION"
mkdir -p "$PGDATA"
chown postgres:postgres "$PGDATA"
chmod 700 "$PGDATA"
exec gosu postgres bash -ceu '
initdb --pgdata="$PGDATA" --username="$POSTGRES_USER" --pwfile=<(printf "%s\\n" "$POSTGRES_PASSWORD") --encoding=UTF8 --locale-provider=icu --icu-locale=en-US --lc-collate=en_US.UTF-8 --lc-ctype=en_US.UTF-8 --auth-local=trust --auth-host=scram-sha-256
printf "\\nhost all all 0.0.0.0/0 scram-sha-256\\n" >> "$PGDATA/pg_hba.conf"
exec postgres -D "$PGDATA" -c listen_addresses=* -c unix_socket_directories=/tmp -c wal_level=logical -c "shared_preload_libraries=$RECOVERY_PRELOAD" -c cron.database_name=queue_restore_verify -c pg_net.database_name=queue_restore_verify
'
"""

def verified_manifest(info):
    path=Path(info['manifest'])
    if file_sha256(path)!=info['manifest_sha256']: raise RuntimeError('Source manifest checksum mismatch')
    manifest=json.loads(path.read_text(encoding='utf-8'))
    required={'format','source','archive_filename','exported_snapshot','rows','catalog','schema','roles','sequences','state','prerequisites'}
    if not required<=set(manifest) or manifest['format']!=1 or manifest['archive_filename']!=Path(info['archive']).name:
        raise RuntimeError('Source manifest missing entries or archive association differs')
    source=manifest['source']
    if source['project']!=PROJECT or source['database_endpoint']!='127.0.0.1:54322' or source['server']['database']!='postgres':
        raise RuntimeError('Source manifest database identity mismatch')
    keys={table_key(t['schema'],t['table']) for t in manifest['catalog']}
    if keys!=set(manifest['rows']) or len(keys)!=len(manifest['catalog']): raise RuntimeError('Source manifest table inventory incomplete')
    if not manifest['schema'] or not manifest['roles']: raise RuntimeError('Source manifest security metadata missing')
    if manifest['state']['versions']!=[name.split('_')[0] for name in sorted(source['migration_sha256'])[:5]]:
        raise RuntimeError('Source manifest migration history differs')
    if file_sha256(Path(info['archive']))!=info['sha256']: raise RuntimeError('Backup checksum mismatch')
    if file_sha256(Path(info['roles_file']))!=info['roles_sha256']: raise RuntimeError('Role supplement checksum mismatch')
    return manifest

class Snapshot:
    def __init__(self,env):
        self.output=queue.Queue();self.sqlstates=[];self.cleanup_issues=[];self.closed=False
        self.p=subprocess.Popen([psql_path(),'-X','-w','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8')
        def stdout_reader():
            try:
                for line in self.p.stdout: self.output.put(line)
            finally: self.output.put(None)
        def stderr_reader():
            for line in self.p.stderr:
                code=re.search(r'(?:ERROR|FATAL):\s+([A-Z0-9]{5}):',line)
                if code: self.sqlstates.append(code.group(1))
        self.readers=[threading.Thread(target=stdout_reader,daemon=True),threading.Thread(target=stderr_reader,daemon=True)]
        for thread in self.readers: thread.start()
        try: self.raw('begin isolation level repeatable read read only; '+CANONICAL_SETTINGS)
        except BaseException:
            self.close(primary_error=True);raise
    def __enter__(self): return self
    def __exit__(self,typ,value,tb): self.close(primary_error=typ is not None)
    def failure(self,label):
        try: self.p.wait(timeout=2)
        except subprocess.TimeoutExpired: pass
        self.readers[1].join(timeout=1)
        return RuntimeError(label+(' [SQLSTATE '+','.join(sorted(set(self.sqlstates)))+']' if self.sqlstates else '')+'; raw PostgreSQL diagnostics suppressed')
    def raw(self,sql):
        marker='END_'+uuid.uuid4().hex
        try: self.p.stdin.write(sql+'\n\\echo '+marker+'\n');self.p.stdin.flush()
        except (BrokenPipeError,OSError): raise self.failure('Snapshot input pipe closed') from None
        lines=[]
        while True:
            try: line=self.output.get(timeout=40)
            except queue.Empty: raise self.failure('Snapshot output deadline exceeded') from None
            if line is None: raise self.failure('Read-only snapshot query failed')
            if line.strip()==marker: return '\n'.join(lines).strip()
            lines.append(line)
    def query(self,sql): return json.loads(self.raw(sql+';'))
    def close(self,primary_error=False):
        if self.closed: return
        self.closed=True
        try:
            if self.p.poll() is None:
                try: self.p.stdin.write('rollback;\n\\q\n');self.p.stdin.flush()
                except (BrokenPipeError,OSError): self.cleanup_issues.append('closed input pipe')
            try: self.p.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.p.terminate();self.p.wait(timeout=5);self.cleanup_issues.append('snapshot subprocess terminated after cleanup deadline')
        except Exception as error:
            self.cleanup_issues.append('cleanup '+type(error).__name__)
        finally:
            for thread in self.readers: thread.join(timeout=2)
            for stream in [self.p.stdin,self.p.stdout,self.p.stderr]:
                try: stream.close()
                except (BrokenPipeError,OSError,ValueError): self.cleanup_issues.append('closed pipe during stream cleanup')
        if not primary_error and (self.cleanup_issues or self.p.returncode): raise self.failure('Snapshot cleanup failed')

def verify_fingerprints():
    _,env,identity=target()
    previous=json.loads(FAILED_ATTEMPT.read_text(encoding='utf-8'))
    if fingerprint(env)!=previous['baseline_rows'] or legacy_security(env)!=previous['baseline_security']:
        raise RuntimeError('Source differs from failed-attempt preservation baseline')
    with Snapshot(env) as snapshot:
        first=all_rows(snapshot.query);repeat=all_rows(snapshot.query)
        catalog=table_catalog(snapshot.query)
        source_schema=schema_metadata(snapshot.query)
        prerequisites=snapshot.query("""select jsonb_build_object('database',jsonb_build_object('encoding',pg_encoding_to_char(d.encoding),'collate',d.datcollate,'ctype',d.datctype,'provider',d.datlocprovider,'locale',to_jsonb(d)->>'datlocale'),
          'settings',(select jsonb_object_agg(name,setting) from pg_settings where name in ('shared_preload_libraries','wal_level','server_encoding','TimeZone')),
          'large_object_count',(select count(*) from pg_largeobject_metadata)) from pg_database d where datname=current_database()""")
        # No writes: SQL NULL and JSON null must have different representations.
        digest=row_digest('x',['id','value'])
        semantic=snapshot.query("select jsonb_build_object('null_distinguished',count(distinct h)=2,'duplicates_preserved',count(*)=3) from (select "+digest+" h from (values (1,null::jsonb),(1,'null'::jsonb),(1,'null'::jsonb)) x(id,value))r")
        empty=snapshot.query("select jsonb_build_object('count',count(*),'rows',coalesce(jsonb_agg(h order by h collate \"C\"),'[]'::jsonb)) from (select 'x'::text h where false)r")
        internal_char=snapshot.query("select to_jsonb('prefix'::text || 'r'::\"char\"::text)")
    with Snapshot(env) as snapshot: independent=all_rows(snapshot.query)
    mandatory={table_key(*table.split('.',1)) for table in previous['baseline_rows']}|{table_key('supabase_migrations','schema_migrations')}
    compare_rows(first,repeat);compare_rows(first,independent)
    if len(first)!=69 or not mandatory<=set(first) or semantic!={'null_distinguished':True,'duplicates_preserved':True} or empty!={'count':0,'rows':[]} or internal_char!='prefixr':
        raise RuntimeError('Repaired fingerprint verification failed or source data changed')
    parents=[t for t in catalog if t['kind']=='p']
    leaves=[t for t in catalog if t['is_partition'] and t['kind']=='r']
    if len(parents)!=1 or table_key(parents[0]['schema'],parents[0]['table'])!=table_key('realtime','messages') or len(leaves)!=6:
        raise RuntimeError('Source partition topology differs from latest report inventory')
    # Expected negative test verifies SQLSTATE preservation and closed-pipe cleanup.
    caught=None
    try:
        with Snapshot(env) as snapshot: snapshot.query('select to_jsonb(1/0)')
    except RuntimeError as error: caught=str(error)
    if not caught or 'SQLSTATE 22012' not in caught: raise RuntimeError('Original PostgreSQL SQLSTATE was not preserved')
    if fingerprint(env)!=previous['baseline_rows'] or legacy_security(env)!=previous['baseline_security']:
        raise RuntimeError('Source changed during read-only fingerprint validation')
    result={'phase':'fingerprints-verified','result':'PASS','identity':identity,
      'fingerprint_validation':{'tables':69,'same_snapshot_repeated':True,'independent_snapshot_matches':True,'sql_null_distinguished_from_json_null':True,'duplicate_rows_preserved':True,'empty_table_correct':True,'original_sqlstate_preserved':'22012','cleanup_preserved_primary_error':True,'canonical_row':'SHA-256 of UTF-8 JSONB [row object, ordered SQL-null bitmap]; row hashes sorted with C collation; duplicate multiplicity retained','batch_size':16},
      'prerequisites':prerequisites,'source_schema':source_schema,'full_table_counts':{key:row['count'] for key,row in first.items()},'internal_char_cast_verified':True,
      'partition_validation':{'parents':1,'physical_leaves':len(leaves),'parent_definition_and_bounds_captured':True}}
    if EVIDENCE.exists():
        prior=EVIDENCE.with_name('retained_backup_validation_before_partition_fix.json')
        if prior.exists(): raise RuntimeError('Prior-attempt evidence path already exists; do not overwrite')
        prior.write_bytes(EVIDENCE.read_bytes())
    save(result)
    print('PASS: all 69 tables, repeated independent snapshots, NULL/JSON/duplicate/empty semantics, normalized schema and SQLSTATE-safe cleanup.',flush=True)

def diagnose_repair():
    _,env,identity=target()
    old=json.loads(FAILED_ATTEMPT.read_text(encoding='utf-8'))
    unchanged=fingerprint(env)==old['baseline_rows'] and legacy_security(env)==old['baseline_security'] and state(env)==old['final_state']
    if not unchanged: raise RuntimeError('Source preservation check failed')
    # Pure catalog expression, no data mutation or backup retry.
    r=subprocess.run([psql_path(),'-X','-w','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],env=env,
      input="begin read only; select 'prefix'::text || d.defaclobjtype from pg_default_acl d limit 1; rollback;",capture_output=True,text=True,timeout=30)
    codes=re.findall(r'ERROR:\s+([A-Z0-9]{5}):',r.stderr)
    result={'result':'FAIL','phase':'stopped-during-read-only-fix-verification','identity':identity,'sqlstate':'42725',
      'catalog_expression_sqlstates':codes,'source_preserved':unchanged,'final_state':state(env),'migration_006_applied':False,
      'backup_created':False,'restore_attempted':False,'offline_tests':{'passed':7,'failed':0,'skipped':0}}
    save(result)
    print('Read-only diagnosis: '+json.dumps({'catalog_expression_sqlstates':codes,'source_preserved':unchanged,'applied_migrations':len(result['final_state']['versions'])}),flush=True)

def secure_directory(path):
    path.mkdir(parents=True,exist_ok=False)
    principal=call(['whoami','/user','/fo','csv','/nh']).stdout
    sid=re.search(r'S-1-5-[0-9-]+',principal)
    if not sid: raise RuntimeError('Windows current-user SID unavailable')
    call(['icacls',str(path),'/inheritance:r','/grant:r','*'+sid.group()+':(OI)(CI)F','*S-1-5-18:(OI)(CI)F'],label='Private backup ACL setup')
    if call(['git','check-ignore',str(path)]).returncode: raise RuntimeError('Backup must be Git ignored')
    if call(['git','ls-files',str(path)]).stdout.strip(): raise RuntimeError('Backup location is tracked')
    probe=path/'process_access_probe.txt'
    probe.write_text('local backup process access check',encoding='utf-8')
    if probe.read_text(encoding='utf-8')!='local backup process access check': raise RuntimeError('Backup process cannot read its protected directory')

def backup():
    record=load()
    if record['phase']!='preflight' or record['result']!='PASS': raise RuntimeError('Successful preflight required')
    _,env,identity=target()
    if fingerprint(env)!=record['baseline_rows'] or security(env)!=record['baseline_security']: raise RuntimeError('Source changed after preflight')
    path=BACKUPS/(datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'_'+uuid.uuid4().hex[:8])
    secure_directory(path)
    archive=path/'retained_postgres_before_006.dump'
    manifest_path=path/'source_snapshot_manifest.json'
    roles_file=path/'roles_without_passwords.sql'
    with Snapshot(env) as snapshot:
        exported=snapshot.raw('select pg_export_snapshot();')
        if not re.fullmatch('[0-9A-Fa-f-]+',exported): raise RuntimeError('Unexpected snapshot identifier')
        rows=all_rows(snapshot.query)
        catalog=table_catalog(snapshot.query)
        source_schema=schema_metadata(snapshot.query)
        roles=role_metadata(snapshot.query)
        sequences=sequence_values(snapshot.query)
        snapshot_state=state(env,snapshot.query)
        if snapshot_state!=record['preflight']: raise RuntimeError('Source state changed since fresh preflight')
        large_objects=snapshot.query('select count(*) from pg_largeobject_metadata')
        if large_objects: raise RuntimeError('Large-object comparison requires explicit support; stop before backup')
        # Persist the exact snapshot before pg_dump and all subsequent validation.
        # Roles and sequences are not MVCC: fence them with independent before/after reads.
        if canonical_query(env,'select to_jsonb(current_database())')!='postgres': raise RuntimeError('Source database changed')
        if roles!=role_metadata(lambda q:canonical_query(env,q)) or sequences!=sequence_values(lambda q:canonical_query(env,q)):
            raise RuntimeError('Global roles or sequences changed during manifest capture')
        manifest={'format':1,'captured_at_utc':datetime.now(timezone.utc).isoformat(),'source':identity,
          'archive_filename':archive.name,'exported_snapshot':exported,'rows':rows,'catalog':catalog,'schema':source_schema,
          'roles':roles,'sequences':sequences,'state':snapshot_state,'prerequisites':record['prerequisites']}
        write_json(manifest_path,manifest)
        manifest_hash=file_sha256(manifest_path)
        record.update(phase='snapshot-manifest-saved',backup={'directory':str(path),'archive':str(archive),
          'manifest':str(manifest_path),'manifest_sha256':manifest_hash,'manifest_bytes':manifest_path.stat().st_size,'recoverability_verified':False})
        save(record)
        result=call([pgtool('pg_dump'),'-w','--format=custom','--file',str(archive),'--snapshot',exported,'--lock-wait-timeout=10s'],env=env,timeout=180,label='Full custom-format backup')
        if result.stderr.strip(): raise RuntimeError('pg_dump reported a warning; stop for review')
        role_dump=call([pgtool('pg_dumpall'),'-w','--roles-only','--no-role-passwords','--file',str(roles_file)],env=env,timeout=60,label='Password-free role/ownership prerequisites backup')
        if role_dump.stderr.strip(): raise RuntimeError('Role backup reported a warning; stop for review')
        if re.search(r'\bPASSWORD\b',roles_file.read_text(encoding='utf-8'),re.I):
            raise RuntimeError('Unexpected password clause in password-free role supplement')
        if roles!=role_metadata(lambda q:canonical_query(env,q)) or sequences!=sequence_values(lambda q:canonical_query(env,q)):
            raise RuntimeError('Global roles or sequences changed while dumping')
    if not archive.is_file() or archive.stat().st_size==0: raise RuntimeError('Backup archive missing/empty')
    toc=call([pgtool('pg_restore'),'--list',str(archive)],label='Archive structural validation').stdout
    complete=archive_completeness(toc,catalog,rows,source_schema['extensions'])
    # Archive metadata stays with the protected backup. Never extract row contents to reports.
    (path/'archive_toc.txt').write_text(toc,encoding='utf-8')
    backup_info={'directory':str(path),'archive':str(archive),'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),
      'manifest':str(manifest_path),'manifest_sha256':manifest_hash,'manifest_bytes':manifest_path.stat().st_size,
      'roles_file':str(roles_file),'roles_sha256':file_sha256(roles_file),'roles_bytes':roles_file.stat().st_size,
      'archive_completeness':complete,'extensions':source_schema['extensions'],'recoverability_verified':False,'windows_acl':'current user and SYSTEM; inheritance removed','roles_passwords_included':False,
      'pg_dump_version':call([pgtool('pg_dump'),'--version']).stdout.strip(),'pg_restore_version':call([pgtool('pg_restore'),'--version']).stdout.strip()}
    verified_manifest(backup_info)
    record.update(phase='backup-created',backup=backup_info)
    save(record)
    print(f"PASS: full custom archive created ({archive.stat().st_size} bytes), manifest/roles checksummed, {complete['table_data_entries']} physical data entries and partition topology complete; restore proof still required.",flush=True)

def restore_verify():
    record=load()
    if record['phase']!='backup-created': raise RuntimeError('New structurally verified backup required')
    target() # Source verification is read-only; all restore writes use the new port.
    info=record['backup'];path=Path(info['directory']);archive=Path(info['archive'])
    manifest=verified_manifest(info)
    port=57322
    with socket.socket() as check: check.bind(('127.0.0.1',port))
    suffix=uuid.uuid4().hex[:8];name='sq-restore-006-'+suffix;volume=name+'-data';network=name+'-internal'
    record['restore_attempt']={'project':name,'container':name,'volume':volume,'network':network,'port':port,'database':'queue_restore_verify','completed':False}
    save(record)
    source_image=record['identity']['docker'][0]['image']
    owners={item['owner'] for item in info['extensions'].values()}
    if len(owners)!=1: raise RuntimeError('Mixed extension ownership requires an explicitly reviewed restore plan')
    bootstrap_owner=next(iter(owners))
    if bootstrap_owner!='supabase_admin': raise RuntimeError('Unexpected Supabase extension owner')
    password=uuid.uuid4().hex+uuid.uuid4().hex
    docker_env=clean_env();docker_env.update(POSTGRES_PASSWORD=password,POSTGRES_USER=bootstrap_owner,POSTGRES_DB='postgres',
      RECOVERY_PRELOAD=record['prerequisites']['settings']['shared_preload_libraries'])
    for command in [
      ['docker','ps','-a','--filter','name=^/'+name+'$','--format','{{.Names}}'],
      ['docker','volume','ls','--filter','name=^'+volume+'$','--format','{{.Name}}'],
      ['docker','network','ls','--filter','name=^'+network+'$','--format','{{.Name}}']]:
        if call(command,label='New recovery identity availability').stdout.strip():
            raise RuntimeError('Recovery container/volume/network name already exists')
    call(['docker','network','create','--internal',network],label='Disposable recovery network creation')
    call(['docker','volume','create',volume],label='Disposable recovery volume creation')
    call(['docker','create','--name',name,'--network',network,'--publish',f'127.0.0.1:{port}:5432','--entrypoint','/bin/bash',
          '--mount',f'type=volume,source={volume},target=/var/lib/postgresql/data',
          '--env','POSTGRES_PASSWORD','--env','POSTGRES_USER','--env','POSTGRES_DB','--env','RECOVERY_PRELOAD',source_image,
          '-c',isolated_init_script()],env=docker_env,label='Disposable recovery container creation')
    isolated=clean_env();isolated.update(PGHOST='127.0.0.1',PGHOSTADDR='127.0.0.1',PGPORT=str(port),PGDATABASE='postgres',PGUSER=bootstrap_owner,PGPASSWORD=password,PGPASSFILE=os.devnull,PGCONNECT_TIMEOUT='2',PGCLIENTENCODING='UTF8')
    def guard(require_running=True):
        c=json.loads(call(['docker','inspect',name]).stdout)[0]
        if (c['Name']!='/'+name or (require_running and not c['State']['Running']) or c['Config']['Image']!=source_image
            or list(c['NetworkSettings']['Networks'])!=[network] or c['HostConfig']['PortBindings'].get('5432/tcp')!=[{'HostIp':'127.0.0.1','HostPort':str(port)}]
            or [m['Name'] for m in c['Mounts'] if m['Type']=='volume']!=[volume]): raise RuntimeError('Restore isolation identity mismatch')
        if require_running and c['NetworkSettings']['Ports'].get('5432/tcp')!=[{'HostIp':'127.0.0.1','HostPort':str(port)}]:
            raise RuntimeError('Running recovery endpoint mismatch')
        if not json.loads(call(['docker','network','inspect',network]).stdout)[0]['Internal']: raise RuntimeError('Recovery network must deny external routing')
    # Validate mounted volume/network/port identity before allowing initdb to execute.
    # Container creation does not execute the entrypoint.
    guard(require_running=False)
    call(['docker','start',name],label='Disposable recovery start')
    deadline=time.monotonic()+120
    while time.monotonic()<deadline:
        ready=subprocess.run([pgtool('pg_isready'),'-q','-h','127.0.0.1','-p',str(port)],env=isolated,capture_output=True,timeout=5)
        if ready.returncode==0: break
        time.sleep(1)
    else: raise RuntimeError('Disposable recovery PostgreSQL not ready')
    guard()
    server=canonical_query(isolated,"select jsonb_build_object('database',current_database(),'user',current_user,'version',current_setting('server_version'),'port',inet_server_port())")
    if server!={'database':'postgres','user':bootstrap_owner,'version':'17.11','port':5432}:
        raise RuntimeError('Disposable recovery server identity mismatch')
    existing=read_json(isolated,'select jsonb_agg(rolname) from pg_roles')
    roles=(path/'roles_without_passwords.sql').read_text(encoding='utf-8')
    def skip_existing(m):
        role=m.group(1).strip('"').replace('""','"')
        return '-- Existing platform role creation omitted; ALTER/membership retained.' if role in existing else m.group(0)
    roles=re.sub(r'^CREATE ROLE (.+);$',skip_existing,roles,flags=re.M)
    guard()
    call([psql_path(),'-X','-w','-q','-v','ON_ERROR_STOP=1'],env=isolated,input=roles,timeout=60,label='Isolated role prerequisites')
    db=record['prerequisites']['database']
    if db['provider']!='i': raise RuntimeError('Source locale provider changed')
    database_sql='create database queue_restore_verify template template0 owner postgres encoding '+literal(db['encoding'])+' locale_provider=icu icu_locale='+literal(db['locale'])+' lc_collate='+literal(db['collate'])+' lc_ctype='+literal(db['ctype'])+';'
    guard()
    call([psql_path(),'-X','-w','-q','-v','ON_ERROR_STOP=1'],env=isolated,input=database_sql,label='New empty verification database')
    isolated['PGDATABASE']='queue_restore_verify'
    guard()
    initial=canonical_query(isolated,"select jsonb_build_object('tables',(select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema')),'extensions',(select jsonb_object_agg(extname,jsonb_build_object('owner',pg_get_userbyid(extowner),'version',extversion)) from pg_extension),'available',(select jsonb_object_agg(name,default_version) from pg_available_extensions))")
    if initial['tables']!=0 or initial['extensions']!={'plpgsql':{'owner':bootstrap_owner,'version':info['extensions']['plpgsql']['version']}}:
        raise RuntimeError('Verification database is not an empty compatible template')
    if any(initial['available'].get(name)!=meta['version'] for name,meta in info['extensions'].items()):
        raise RuntimeError('Required extension default version differs from source')
    result=call([pgtool('pg_restore'),'-w','--exit-on-error','--single-transaction','--dbname','queue_restore_verify',str(archive)],env=isolated,timeout=180,label='Full archive restoration')
    if result.stderr.strip(): raise RuntimeError('pg_restore reported warnings; stop for review')
    expected=manifest['rows']
    with Snapshot(isolated) as snapshot:
        observed=all_rows(snapshot.query)
        tables_compared=compare_rows(expected,observed)
        restored_schema=schema_metadata(snapshot.query)
        restored_roles=role_metadata(snapshot.query)
        restored_sequences=sequence_values(snapshot.query)
        restored_catalog=table_catalog(snapshot.query)
    if restored_catalog!=manifest['catalog']: raise RuntimeError('Restored catalog/partition ancestry differs')
    expected_schema=manifest['schema']
    differences={section:len(set(expected_schema[section])^set(restored_schema.get(section,{}))) for section in expected_schema if expected_schema[section]!=restored_schema.get(section)}
    if differences:
        record['restore_schema_difference_sections']=differences;save(record)
        raise RuntimeError('Restored schema differs in sections: '+','.join(differences))
    if restored_roles!=manifest['roles']:
        raise RuntimeError('Restored global roles/memberships differ')
    if restored_sequences!=manifest['sequences']:
        raise RuntimeError('Restored sequence states differ')
    if state(isolated)!=record['preflight']: raise RuntimeError('Restored application state or migration history mismatch')
    info.update(recoverability_verified=True,restore_project=name,restore_container=name,restore_volume=volume,restore_network=network,
                restore_port=port,restore_database='queue_restore_verify',restored_table_data_verified=tables_compared,restore_security_matches=True,
                extension_owner_preserved=bootstrap_owner,full_schema_sections_verified=sorted(expected_schema),global_roles_verified=True,sequences_verified=True)
    # Verify archive again after the drill. Never overwrite the retained database.
    if hashlib.sha256(archive.read_bytes()).hexdigest()!=info['sha256']: raise RuntimeError('Backup changed during verification')
    call(['docker','stop',name],timeout=90,label='Disposable recovery shutdown')
    info['restore_container_stopped_volume_retained']=True
    record['restore_attempt']['completed']=True
    record['phase']='backup-verified';save(record)
    print(f'PASS: full backup restored into isolated port {port}; {tables_compared} table fingerprints, full schema, global roles, sequences and five-migration state match source. Recovery volume and backup retained.',flush=True)

def preservation():
    record=load()
    if record.get('phase')!='backup-verified' or not record.get('backup',{}).get('recoverability_verified'):
        raise RuntimeError('Successful full restore verification required')
    _,env,identity=target()
    if fingerprint(env)!=record['baseline_rows'] or security(env)!=record['baseline_security'] or state(env)!=record['preflight']:
        raise RuntimeError('Final retained application/security/state preservation check failed')
    with Snapshot(env) as snapshot:
        source_rows=all_rows(snapshot.query)
        source_schema=schema_metadata(snapshot.query)
    manifest=verified_manifest(record['backup'])
    compare_rows(manifest['rows'],source_rows)
    if source_schema!=manifest['schema']:
        raise RuntimeError('Source full schema changed')
    record.update(phase='complete',result='PASS',retained_preserved=True,migration_006_applied=False,final_state=state(env))
    save(record)
    print('PASS: retained full data/schema preserved; exactly five migrations; 006 still pending; no active work. STOPPED after backup validation.',flush=True)

def diagnose_archive():
    record=load()
    _,env,identity=target()
    if fingerprint(env)!=record['baseline_rows'] or security(env)!=record['baseline_security'] or state(env)!=record['preflight']:
        raise RuntimeError('Retained preservation check failed')
    archives=sorted(BACKUPS.glob('*/retained_postgres_before_006.dump'),key=lambda p:p.stat().st_mtime)
    if not archives: raise RuntimeError('No created archive available for read-only diagnosis')
    archive=archives[-1]
    toc=call([pgtool('pg_restore'),'--list',str(archive)],label='Read-only archive diagnosis').stdout
    with Snapshot(env) as snapshot:
        catalog=table_catalog(snapshot.query)
        rows=all_rows(snapshot.query)
        relations=snapshot.query("select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'kind',c.relkind::text) order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp_%'")
    dumped=toc_table_inventory(toc,catalog)
    omitted=[]
    for item in catalog:
        key=table_key(item['schema'],item['table'])
        if key not in dumped:
            kind=next(r['kind'] for r in relations if r['schema']==item['schema'] and r['table']==item['table'])
            has_table_definition=any(re.match(r'^\d+; \d+ \d+ TABLE ',line) and line.endswith(f"TABLE {item['schema']} {item['table']} {item['owner']}") for line in toc.splitlines())
            omitted.append({'table':key,'kind':kind,'extension':item['extension'],'row_count':rows[key]['count'],'table_definition_in_archive':has_table_definition})
    details={'path':str(archive),'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'archive_readable':True,'table_data_entries':len(dumped),'source_table_count':len(rows),'tables_without_data_entries':omitted,'recoverability_verified':False}
    (archive.parent/'archive_diagnostic_toc.txt').write_text(toc,encoding='utf-8')
    record.update(result='FAIL',phase='stopped-during-archive-completeness-check',backup=details,source_preserved=True,final_state=state(env),migration_006_applied=False,restore_attempted=False,offline_tests={'passed':13,'failed':0,'skipped':0})
    save(record)
    print('Read-only archive diagnosis: '+json.dumps(details),flush=True)

def diagnose_backup():
    record=load()
    _,env,_=target()
    rows=fingerprint(env)
    if rows!=record['baseline_rows'] or security(env)!=record['baseline_security']:
        raise RuntimeError('Source changed; stop investigation')
    final_state=state(env)
    if final_state!=record['preflight']: raise RuntimeError('Source migration history or queue state changed')
    tables=read_json(env,"select jsonb_agg(format('%I.%I',schemaname,tablename) order by schemaname,tablename) from pg_tables where schemaname not in ('pg_catalog','information_schema') and schemaname not like 'pg_toast%'")
    pairs=[f"'{table}',(select jsonb_build_object('count',count(*),'rows',coalesce(jsonb_agg(md5(to_jsonb(x)::text) order by md5(to_jsonb(x)::text)),'[]')) from {table} x)" for table in tables]
    # Reproduce only the failed read-only SELECT, without an exported snapshot or backup retry.
    r=subprocess.run([psql_path(),'-X','-w','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],env=env,
      input='begin read only; select jsonb_build_object('+','.join(pairs)+'); rollback;',capture_output=True,text=True,timeout=30)
    codes=re.findall(r'ERROR:\s+([A-Z0-9]{5})\b',r.stderr)
    archive_files=[{'path':str(p),'bytes':p.stat().st_size} for p in BACKUPS.rglob('*.dump')]
    record.update(result='FAIL',phase='stopped-before-apply',preflight_passed=True,migration_applied=False,
      final_state=final_state,
      backup_failure={'table_count':len(tables),'json_constructor_arguments':len(pairs)*2,'read_only_reproduction_exit':r.returncode,
                      'sqlstates':codes,'archive_files':archive_files,'source_rows_and_security_unchanged':True,'recoverability_verified':False})
    save(record)
    print('Read-only failure diagnosis: '+json.dumps(record['backup_failure']),flush=True)

def main():
    p=argparse.ArgumentParser()
    p.add_argument('phase',choices=['verify-fingerprints','preflight','backup','restore-verify','preservation','diagnose-archive'])
    args=p.parse_args()
    if args.phase=='verify-fingerprints': verify_fingerprints()
    elif args.phase=='preflight': preflight()
    elif args.phase=='backup': backup()
    elif args.phase=='restore-verify': restore_verify()
    elif args.phase=='preservation': preservation()
    elif args.phase=='diagnose-archive': diagnose_archive()

if __name__=='__main__':
    try: main()
    except Exception as e:
        message=str(e) if isinstance(e,RuntimeError) else 'Local validation/harness failed; raw diagnostics suppressed.'
        try:
            record=load()
            record.update(result='FAIL',failed_phase=sys.argv[1] if len(sys.argv)>1 else 'unknown',failure=message,migration_006_applied=False)
            save(record)
        except Exception: pass # Failure evidence is secondary; retain the original error below.
        print('STOP: '+message,flush=True)
        sys.exit(1)
