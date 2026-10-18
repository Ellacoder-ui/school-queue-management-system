"""Fail-closed frontend fence for the reviewed Realtime v2.143.4 lifecycle.

Historical snapshots are immutable. Only empty daily leaf additions and anonymous
public-display subscriptions are classified; pruning and message writes fail.
"""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'supabase/tests'))
import retained_migration_006 as backup
import apply_retained_migration_006 as cutover
import schema_privilege_recovery as recovery

BASELINE = ROOT/'supabase/tests/results/retained_migration_006_postvalidation.json'
BASELINE_SHA = '5940878a90c15b91eafeed1ec83f536a9ea8f424a723d92b773783b2420804c2'
IMAGE = 'public.ecr.aws/supabase/realtime:v2.143.4'
IMAGE_ID = 'sha256:35e99d3f1cbba5aa5585e8ac3cf70ecc54909ee4aee0626effed93c60fb41439'
SUBSCRIPTION = '"realtime"."subscription"'
REALTIME_SEQUENCE = '"realtime"."subscription_id_seq"'
TEMPLATE = 'messages_2026_10_19'
PUBLIC_TABLES = ['queue_display.counter_state', 'queue_display.service_state']

class PreservationError(RuntimeError):
    def __init__(self, issues):
        self.evidence = {'result':'FAIL', 'unexpected_changes':issues}
        super().__init__('Retained preservation failed: '+', '.join(issues))

def baseline():
    if hashlib.sha256(BASELINE.read_bytes()).hexdigest() != BASELINE_SHA:
        raise PreservationError(['historical_baseline_checksum'])
    return json.loads(BASELINE.read_text(encoding='utf-8'))['current']

def normalized(source):
    result = deepcopy(source)
    result.pop('clock', None)
    result.pop('platform', None)
    if 'state' in result: result['state'].pop('current_day_closed', None)
    return result

def differences(expected, actual, prefix=''):
    """Names only: never leak row contents, claims or sensitive setting values."""
    if isinstance(expected, dict) and isinstance(actual, dict):
        result=[]
        for key in sorted(set(expected)|set(actual)):
            path=prefix+'.'+key if prefix else key
            if key not in expected: result.append(path+' [added]')
            elif key not in actual: result.append(path+' [missing]')
            else: result.extend(differences(expected[key],actual[key],path))
        return result
    return [] if expected==actual else [prefix+' [changed]']

def rename(value, old, new):
    if isinstance(value, str): return value.replace(old,new)
    if isinstance(value, list): return [rename(v,old,new) for v in value]
    if isinstance(value, dict): return {rename(k,old,new):rename(v,old,new) for k,v in value.items()}
    return value

def catalog_by_key(source):
    values={backup.table_key(t['schema'],t['table']):t for t in source['catalog']}
    if len(values)!=len(source['catalog']): raise PreservationError(['catalog.duplicate_identity'])
    return values

def add_expected_leaf(expected, name, day, template_source):
    """Expand only exact template objects; arbitrary realtime names are not ignored."""
    template_key=backup.table_key('realtime',TEMPLATE)
    template=catalog_by_key(template_source)[template_key]
    item=rename(template,TEMPLATE,name)
    item['bound']=f"FOR VALUES FROM ('{day.isoformat()} 00:00:00') TO ('{(day+timedelta(days=1)).isoformat()} 00:00:00')"
    expected['catalog'].append(item)
    expected['rows'][backup.table_key('realtime',name)]={'count':0,'rows':[]}
    for section, values in template_source['schema'].items():
        for key,value in values.items():
            # A delimited exact leaf identity or its two index names only.
            if key=='realtime.'+TEMPLATE or key.startswith('realtime.'+TEMPLATE+':') or key in (
                'realtime.'+TEMPLATE+'_pkey','realtime.'+TEMPLATE+'_inserted_at_topic_idx',
                'supabase_realtime_messages_publication:realtime.'+TEMPLATE):
                new_key=rename(key,TEMPLATE,name)
                expected['schema'][section][new_key]=rename(value,TEMPLATE,name)
    expected['schema']['partitions']['realtime.'+name]['bound']=item['bound']

def classify(before, after):
    reference=baseline()
    expected=normalized(before)
    actual=normalized(after)
    issues=[]
    # Supplemental live evidence is mandatory, never a replacement for exact ACLs.
    platform=after.get('platform',{})
    if platform.get('image')!=IMAGE or platform.get('image_id')!=IMAGE_ID or platform.get('release')!='16.4.0.4 2.143.4':
        issues.append('platform.pinned_realtime_identity')
    policy=platform.get('subscriptions',{})
    if policy.get('invalid_rows')!=0 or policy.get('count')!=after['rows'].get(SUBSCRIPTION,{}).get('count'):
        issues.append('platform.subscription_scope')
    old_seq=before['sequences'].get(REALTIME_SEQUENCE,{})
    new_seq=after['sequences'].get(REALTIME_SEQUENCE,{})
    if not isinstance(new_seq.get('last_value'),int) or new_seq.get('last_value',-1)<old_seq.get('last_value',0) or new_seq.get('is_called') is not True:
        issues.append('sequences.subscription_allocation_regression')
    if policy.get('max_id',0)>new_seq.get('last_value',-1): issues.append('platform.subscription_identity_range')
    old_catalog=catalog_by_key(before); new_catalog=catalog_by_key(after)
    added=sorted(set(new_catalog)-set(old_catalog))
    day=datetime.fromisoformat(after['clock']).astimezone(timezone.utc).date()
    permitted=[]
    for key in added:
        table=new_catalog[key]
        name=table['table']
        match=re.fullmatch(r'messages_(\d{4}_\d{2}_\d{2})',name)
        try: partition_day=datetime.strptime(match[1],'%Y_%m_%d').date() if match else None
        except ValueError: partition_day=None
        if table['schema']!='realtime' or partition_day is None or not day-timedelta(days=1)<=partition_day<=day+timedelta(days=3):
            issues.append('catalog.'+key+' [unreviewed partition/name/date]'); continue
        add_expected_leaf(expected,name,partition_day,reference)
        permitted.append(key)
    expected['catalog'].sort(key=lambda t:(t['schema'],t['table']))
    actual['catalog'].sort(key=lambda t:(t['schema'],t['table']))
    # These two values are volatile only after scope/schema/ACL validation.
    if SUBSCRIPTION in expected['rows'] and SUBSCRIPTION in actual['rows']:
        expected['rows'][SUBSCRIPTION]=actual['rows'][SUBSCRIPTION]
    if REALTIME_SEQUENCE in expected['sequences'] and REALTIME_SEQUENCE in actual['sequences']:
        expected['sequences'][REALTIME_SEQUENCE]=actual['sequences'][REALTIME_SEQUENCE]
    for key, table in new_catalog.items():
        if table['schema']=='realtime' and table['table'].startswith('messages_'):
            facts=platform.get('leaves',{}).get(table['table'])
            required={'browser_access_denied':True,'column_acl_absent':True,
                'index_parents':{
                    table['table']+'_pkey':'realtime.messages_pkey',
                    table['table']+'_inserted_at_topic_idx':'realtime.messages_inserted_at_topic_index'}}
            if facts!=required: issues.append('platform.leaves.'+table['table']+' [security/ancestry]')
    issues.extend(differences(expected,actual))
    if issues: raise PreservationError(sorted(set(issues)))
    return {'result':'PASS','original_tables_exact_except_scoped_subscription':True,
        'empty_partition_additions':permitted,'logical_tables':len(after['rows']),
        'subscription_rows_before':before['rows'][SUBSCRIPTION]['count'],
        'subscription_rows_after':after['rows'][SUBSCRIPTION]['count'],
        'subscription_sequence_before':old_seq,'subscription_sequence_after':new_seq,
        'all_other_rows_objects_roles_privileges_exact':True,'unexpected_changes':[]}

PLATFORM_SQL="""select jsonb_build_object(
 'subscriptions',(select jsonb_build_object('count',count(*),'max_id',coalesce(max(id),0),
   'invalid_rows',count(*) filter(where not coalesce(
     entity::regclass::text in ('queue_display.counter_state','queue_display.service_state')
     and claims->>'role'='anon' and claims_role::text='anon' and not claims ? 'sub'
     and filters='{}'::realtime.user_defined_filter[] and action_filter='*'
     and selected_columns is null and id>0,false))) from realtime.subscription),
 'leaves',(select jsonb_object_agg(c.relname,jsonb_build_object(
   'browser_access_denied',not exists(select 1 from pg_roles r cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege
     where r.rolname in ('anon','authenticated','service_role') and has_table_privilege(r.oid,c.oid,privilege)),
   'column_acl_absent',not exists(select 1 from pg_attribute where attrelid=c.oid and attacl is not null),
   'index_parents',(select jsonb_object_agg(idx.relname,format('%I.%I',pn.nspname,pidx.relname))
     from pg_index ix join pg_class idx on idx.oid=ix.indexrelid join pg_inherits inh on inh.inhrelid=idx.oid
     join pg_class pidx on pidx.oid=inh.inhparent join pg_namespace pn on pn.oid=pidx.relnamespace where ix.indrelid=c.oid)))
   from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='realtime' and c.relkind='r' and c.relispartition))"""

def capture_current():
    _,env,identity=backup.target()
    container=json.loads(backup.call(['docker','inspect','supabase_realtime_school-queue-local'],label='Read-only pinned Realtime identity').stdout)[0]
    release=backup.call(['docker','exec','supabase_realtime_school-queue-local','cat','/app/releases/start_erl.data'],label='Read-only Realtime release').stdout.strip()
    with backup.Snapshot(env) as snapshot:
        identifier=snapshot.query('select to_jsonb(system_identifier::text) from pg_control_system()')
        if identifier!=cutover.SOURCE_IDENTIFIER: raise PreservationError(['source.cluster_identity'])
        source={'identity':identity,'system_identifier':identifier,
            'rows':backup.all_rows(snapshot.query),'schema':backup.schema_metadata(snapshot.query),
            'roles':backup.role_metadata(snapshot.query),'sequences':backup.sequence_values(snapshot.query),
            'catalog':backup.table_catalog(snapshot.query),'state':backup.state(None,snapshot.query),
            'additional_privileges':recovery.additional_privileges(snapshot.query),
            'display_without_timestamps':snapshot.query("""select jsonb_build_object(
              'counter',(select coalesce(jsonb_agg(to_jsonb(c)-'updated_at' order by counter_id),'[]') from queue_display.counter_state c),
              'service',(select coalesce(jsonb_agg(to_jsonb(s)-'updated_at' order by business_date,service_code),'[]') from queue_display.service_state s))"""),
            'clock':snapshot.query('select to_jsonb(clock_timestamp())')}
        source['platform']=snapshot.query(PLATFORM_SQL)
    source['platform'].update(image=container['Config']['Image'],image_id=container['Image'],release=release)
    classify(baseline(),source)
    return source

def bundle_comparison(manifest, source):
    keys=['rows','schema','catalog','roles','sequences','state','additional_privileges']
    previous={key:manifest[key] for key in keys}
    current={key:source[key] for key in keys+['clock','platform']}
    return classify(previous,current)
