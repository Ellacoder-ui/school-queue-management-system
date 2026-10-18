"""Read-only platform investigation. Never emits subscription claims or raw rows."""
import json
from pathlib import Path
import retained_migration_006 as backup
import apply_retained_migration_006 as cutover

ROOT = backup.ROOT

def inspect():
    _, env, source = cutover.capture()
    old = json.loads((ROOT/'supabase/tests/results/retained_migration_006_postvalidation.json').read_text())['current']
    differences = {}
    for section, values in source['schema'].items():
        previous = old['schema'][section]
        if values != previous:
            differences[section] = {
                'added': {k:v for k,v in values.items() if k not in previous},
                'removed': sorted(set(previous)-set(values)),
                'changed': {k:v for k,v in values.items() if k in previous and v != previous[k]},
            }
    with backup.Snapshot(env) as snapshot:
        details = snapshot.query("""select jsonb_build_object(
          'partition_access',(select jsonb_agg(jsonb_build_object('table',c.relname,'role',r.rolname,
             'schema_usage',has_schema_privilege(r.oid,n.oid,'USAGE'),
             'select',has_table_privilege(r.oid,c.oid,'SELECT'),
             'insert',has_table_privilege(r.oid,c.oid,'INSERT'),
             'update',has_table_privilege(r.oid,c.oid,'UPDATE'),
             'delete',has_table_privilege(r.oid,c.oid,'DELETE'),
             'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity) order by c.relname,r.rolname)
            from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join pg_roles r
            where n.nspname='realtime' and c.relname like 'messages%' and c.relkind in ('r','p')
              and r.rolname in ('anon','authenticated','service_role')),
          'maintenance_functions',(select jsonb_object_agg(p.proname,pg_get_functiondef(p.oid))
            from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='realtime' and p.proname ~ '(partition|subscription)'),
          'subscription_summary',(select jsonb_build_object('count',count(*),'entities',coalesce(jsonb_agg(distinct entity::regclass::text),'[]'),
             'anonymous_public_unfiltered',coalesce(bool_and(claims->>'role'='anon' and claims_role::text='anon' and not claims ? 'sub'
               and filters='{}'::realtime.user_defined_filter[] and action_filter='*' and selected_columns is null),true)) from realtime.subscription),
          'rt_migrations',(select jsonb_agg(version order by version) from _realtime.schema_migrations))""")
    containers = json.loads(backup.call(['docker','ps','--format','json'],label='Read-only container identity').stdout.replace('\n',',').rstrip(',').join(['[',']']))
    rt = []
    for c in containers:
        if 'realtime' in c['Names']:
            item=json.loads(backup.call(['docker','inspect',c['Names']],label='Read-only Realtime image').stdout)[0]
            rt.append({'name':item['Name'],'image':item['Config']['Image'],'image_id':item['Image']})
    return source, {'identity':source['identity'],'system_identifier':source['system_identifier'],
        'state':source['state'],'logical_tables':len(source['rows']),
        'original_changed_tables':[k for k in old['rows'] if source['rows'].get(k)!=old['rows'][k]],
        'new_tables':{k:v for k,v in source['rows'].items() if k not in old['rows']},
        'schema_differences':differences,'roles_equal':source['roles']==old['roles'],
        'additional_privileges_equal':source['additional_privileges']==old['additional_privileges'],
        'sequences':source['sequences'],'realtime_containers':rt, **details}

if __name__=='__main__':
    source, result = inspect()
    path=ROOT/'supabase/tests/results/realtime_preservation_security_inspection.json'
    with path.open('x',encoding='utf-8') as handle: json.dump(result,handle,indent=2);handle.write('\n')
    print(json.dumps(result,indent=2))
