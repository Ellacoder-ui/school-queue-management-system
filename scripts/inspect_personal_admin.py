"""Fixed read-only personal/school account review. Private baseline arrives on stdin."""
import json
import re
import sys
from datetime import datetime, timezone
import auth_only_guard as g
import auth_mfa_guard as mf

EMAILS = ('ellasharmaineabeso2004@gmail.com', 'eabeso63122@liceo.edu.ph')
SQL = """select coalesce(jsonb_agg(result order by result->>'email'),'[]') from (
 select jsonb_build_object('email',lower(u.email),'auth_id',u.id,'account_id',a.id,
  'role',a.role,'enabled',a.enabled,'email_confirmed',u.email_confirmed_at is not null,
  'not_anonymous',u.is_anonymous is not true,
  'google_count',(select count(*) from auth.identities i where i.user_id=u.id and i.provider='google'),
  'binding',(select encode(sha256(convert_to(jsonb_build_object('user_id',u.id,'identity_id',i.id,
    'provider',i.provider,'provider_id',i.provider_id,'subject',i.identity_data->>'sub',
    'email',lower(u.email),'identity_email',lower(i.identity_data->>'email'),
    'email_verified',i.identity_data->>'email_verified')::text,'UTF8')),'hex')
    from auth.identities i where i.user_id=u.id and i.provider='google'
    and lower(i.identity_data->>'email')=lower(u.email) and i.identity_data->>'email_verified'='true'
    and nullif(i.identity_data->>'sub','')=i.provider_id),
  'factor_count',(select count(*) from auth.mfa_factors f where f.user_id=u.id),
  'verified_factors',(select count(*) from auth.mfa_factors f where f.user_id=u.id and f.status='verified'),
  'assignments',(select count(*) from queue_private.staff_counter_assignments x where x.account_id=u.id),
  'active_tickets',(select count(*) from queue_private.tickets t where t.owner_id=u.id and t.status in ('WAITING','CALLED')),
  'all_tickets',(select count(*) from queue_private.tickets t where t.owner_id=u.id)) as result
 from auth.users u join queue_private.accounts a on a.id=u.id
 where lower(u.email) in ('ellasharmaineabeso2004@gmail.com','eabeso63122@liceo.edu.ph')) x"""


def main():
    g.need(not sys.stdin.isatty() and not sys.stdout.isatty(), 'PGA_PRIVATE_IPC')
    raw = sys.stdin.buffer.read(4194305)
    g.need(len(raw) <= 4194304, 'PGA_INPUT_BOUND')
    baseline = json.loads(raw)['baseline']
    now = g.capture(baseline['connection'])
    mf.initial_inventory(now)
    mf.flags(now, False)
    g.health_check(now, True)
    previous, current = g.decode_source(baseline['sourceSnapshot']), g.decode_source(now['sourceSnapshot'])
    report = {'observed_at': datetime.now(timezone.utc).isoformat(), 'retained_writes': False}
    try:
        g.compare(baseline, now, 'before', None)
        report['old_plan_source'] = 'PASS'
    except Exception as error:
        message = str(error)
        report['old_plan_source'] = 'FAIL'
        report['source_failure'] = message if re.fullmatch(r'[A-Z][A-Z0-9_]{1,100}', message) else 'PRESERVATION_DIFFERENCE'
    report['changed_source_sections'] = [k for k in previous if k not in ('clock', 'platform') and previous[k] != current.get(k)]
    report['removed_tables'] = sorted(set(previous['rows']) - set(current['rows']))
    report['added_tables'] = sorted(set(current['rows']) - set(previous['rows']))
    report['changed_table_fingerprints'] = [name for name in previous['rows'] if name in current['rows'] and previous['rows'][name] != current['rows'][name]]
    report['changed_table_counts'] = {name: {'before': previous['rows'][name]['count'], 'after': current['rows'][name]['count']}
        for name in report['changed_table_fingerprints']}
    report['state_changed_fields'] = [name for name in previous['state'] if previous['state'][name] != current['state'].get(name)]
    report['changed_sequence_names'] = [name for name in previous['sequences'] if previous['sequences'][name] != current['sequences'].get(name)]
    report['all_other_shared_table_fingerprints_equal'] = all(previous['rows'][name] == current['rows'][name]
        for name in set(previous['rows']) & set(current['rows']) if name not in report['changed_table_fingerprints'])
    report['migration_versions'] = current['state']['versions']
    report['fixed_routes'] = current['state']['routes']
    report['active_work'] = current['state']['active']
    report['open_days'] = current['state']['open_days']
    report['protected_inputs_equal'] = {key: baseline[key] == now[key] for key in ('credential', 'dbVolume', 'backupTree')}
    report['docker_resource_inventory_equal'] = baseline['resources'] == now['resources']
    old_items = {x['Id']: x for x in baseline['items']}
    report['service_definition_changes'] = [x['Name'] for x in now['items'] if x['Id'] not in old_items or any(
        x[k] != old_items[x['Id']][k] for k in ('Name', 'Image', 'Config', 'HostConfig', 'Mounts', 'NetworkSettings'))]
    report['non_vector_lifecycle_changes'] = [x['Name'] for x in now['items'] if x['Id'] in old_items and
        x['Name'] != '/supabase_vector_school-queue-local' and g.m.base.state(x) != g.m.base.state(old_items[x['Id']])]
    env = {**g.m.backup.clean_env(), **now['connection']['env']}
    with g.m.backup.Snapshot(env) as snapshot:
        report['accounts'] = snapshot.query(SQL)
        report['security_migration_unapplied'] = snapshot.query("select to_jsonb(to_regclass('queue_private.staff_access_approvals') is null)")
        report['session_aal_column_available'] = snapshot.query("select to_jsonb(exists(select 1 from information_schema.columns where table_schema='auth' and table_name='sessions' and column_name='aal'))")
    g.need(len(report['accounts']) == 2 and {x['email'] for x in report['accounts']} == set(EMAILS), 'PGA_UNIQUE_ACCOUNTS')
    for account in report['accounts']:
        g.need(account['auth_id'] == account['account_id'] and account['role'] == 'STUDENT' and account['enabled'] and
               account['email_confirmed'] and account['not_anonymous'] and account['google_count'] == 1 and
               re.fullmatch(r'[0-9a-f]{64}', account['binding'] or '') and account['assignments'] == account['active_tickets'] == 0,
               'PGA_IDENTITY_OR_WORK')
    school = next(x for x in report['accounts'] if x['email'] == EMAILS[1])
    g.need(school['auth_id'] == 'b7d9aee8-c54d-455f-9913-a4c4dea0d097' and
           school['binding'] == '7b236769634b0910b034c035cc1422021f2281be9d6fd77d5c882ffd9ed86bbd', 'PGA_SCHOOL_CHANGED')
    after = g.capture(now['connection'])
    g.compare(now, after, 'before', None)
    mf.flags(after, False)
    g.health_check(after, True)
    report.update(result='PASS_READ_ONLY_IDENTITY_AND_WITHIN_RUN_PRESERVATION', google=True, totp_enroll=False,
                  totp_verify=False, http={'auth': 200, 'settings': 200, 'anonymous_api': 200}, backups=now['backupTree'])
    print(json.dumps(report))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('PGA_READ_ONLY_INSPECTION_STOPPED', file=sys.stderr)
        sys.exit(1)
