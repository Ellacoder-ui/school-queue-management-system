"""Read-only diagnosis of the stopped migration 006 catalog expectation.

Never reapplies a migration, runs regressions, or changes the cutover failure to PASS.
Only sanitized diagnosis/evidence is written to the workspace.
"""
import json
from datetime import datetime, timezone

import apply_retained_migration_006 as cutover


def main():
    record = json.loads(cutover.EVIDENCE.read_text(encoding='utf-8'))
    cutover.require(record.get('result') == 'FAIL' and record.get('failure') == 'Unexpected constraints additions/removals',
                    'Only the documented stopped catalog check may be diagnosed')
    before = record['before']
    _, env, after = cutover.capture()
    details = cutover.post_details(env)
    checks = {}
    checks['identity_unchanged'] = before['identity'] == after['identity'] and before['system_identifier'] == after['system_identifier']
    expected_state = json.loads(json.dumps(before['state']))
    expected_state['versions'].append(cutover.backup.VERSION)
    expected_state['routes'] = cutover.backup.CANONICAL
    expected_state['counts']['audits'] += 1
    checks['exact_reviewed_final_queue_state'] = expected_state == after['state']
    for name in ('roles','sequences','catalog','additional_privileges','display_without_timestamps'):
        checks[name+'_unchanged'] = before[name] == after[name]
    exceptions = {cutover.backup.table_key(schema,table) for schema,table in
                  [('queue_private','counter_services'),('queue_private','admin_audit_events'),
                   ('queue_display','counter_state'),('supabase_migrations','schema_migrations')]}
    checks['same_69_table_inventory'] = set(before['rows']) == set(after['rows']) and len(after['rows']) == 69
    checks['65_other_tables_identical'] = all(before['rows'][key] == after['rows'][key] for key in set(before['rows'])-exceptions)
    checks['exact_five_relationship_rows'] = details['routes']['count'] == 5 and details['routes'] == after['rows'][cutover.backup.table_key('queue_private','counter_services')]
    cutover.compare_append_only(before['rows'][cutover.backup.table_key('queue_private','admin_audit_events')],
                                after['rows'][cutover.backup.table_key('queue_private','admin_audit_events')],details['audit']['hash'],'Audit diagnosis')
    checks['all_31_old_audits_plus_one_cutover'] = True
    matrix = lambda routes: [dict(counter=int(number),service=code) for number,codes in sorted(routes.items()) for code in codes]
    checks['exact_cutover_audit'] = details['audit']['actor_is_null'] and details['audit']['parameters'] == dict(
        migration=cutover.backup.VERSION,before=matrix(cutover.backup.LEGACY),after=matrix(cutover.backup.CANONICAL))
    cutover.compare_append_only(before['rows'][cutover.backup.table_key('supabase_migrations','schema_migrations')],
                                after['rows'][cutover.backup.table_key('supabase_migrations','schema_migrations')],details['history']['hash'],'History diagnosis')
    checks['old_five_history_rows_plus_006'] = details['history']['name'] == 'fixed_counter_routing' and details['history']['version'] == cutover.backup.VERSION
    parse = datetime.fromisoformat
    checks['refresh_and_audit_timestamps'] = (parse(before['clock']) <= parse(details['audit']['occurred_at']) <= parse(after['clock']) and
        parse(before['clock']) <= parse(details['display_times']['minimum']) <= parse(details['display_times']['maximum']) <= parse(after['clock']))
    old_schema,new_schema = before['schema'],after['schema']
    checks['11_other_schema_sections_identical'] = all(old_schema[s] == new_schema[s] for s in set(old_schema)-{'functions','constraints','indexes','triggers'})
    checks['23_application_bodies_match_migrations'] = len(details['function_bodies_match']) == 23 and all(details['function_bodies_match'].values())
    checks['existing_functions_and_acls_preserved'] = all(
        new_schema['functions'][key] == value if key != cutover.CONFIGURE else
        {k:v for k,v in new_schema['functions'][key].items() if k!='definition'} == {k:v for k,v in value.items() if k!='definition'}
        for key,value in old_schema['functions'].items())
    checks['only_four_new_private_functions'] = set(new_schema['functions']) == set(old_schema['functions']) | set(cutover.NEW_FUNCTIONS)
    owner_acl = [dict(grantor='postgres',grantee='postgres',privilege='EXECUTE',grantable=False)]
    checks['new_helper_contracts_and_owner_only_acl'] = all(
        new_schema['functions'][key]['owner'] == 'postgres' and new_schema['functions'][key]['acl'] == owner_acl and
        details['functions'][key] == dict(language=language,definer=definer,volatility=volatility,result=result,config=['search_path=""'])
        for key,(language,definer,volatility,result) in cutover.NEW_FUNCTIONS.items())
    expected_constraints = dict(old_schema['constraints'])
    for key,definition in cutover.NEW_CONSTRAINTS.items():
        expected_constraints[key] = dict(definition=definition,validated=True,deferrable=False,deferred=False)
    constraint_trigger_keys = {
        'queue_private.counter_services:fixed_routing_complete',
        'queue_private.counters:fixed_counters_complete',
        'queue_private.services:fixed_services_complete',
    }
    for key in constraint_trigger_keys:
        expected_constraints[key] = dict(definition='TRIGGER DEFERRABLE INITIALLY DEFERRED',validated=True,deferrable=True,deferred=True)
    checks['constraints_are_exactly_two_uniques_and_three_constraint_triggers'] = expected_constraints == new_schema['constraints']
    trigger_types = cutover.backup.read_json(env,"""select jsonb_object_agg(n.nspname::text||'.'||c.relname::text||':'||k.conname::text,k.contype::text)
        from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='queue_private' and k.conname in ('fixed_routing_complete','fixed_counters_complete','fixed_services_complete')""")
    checks['three_catalog_entries_are_type_t'] = trigger_types == {key:'t' for key in constraint_trigger_keys}
    expected_indexes = dict(old_schema['indexes'])
    for key,definition in cutover.NEW_INDEXES.items():
        expected_indexes[key] = dict(definition=definition,valid=True,ready=True)
    checks['only_two_expected_unique_indexes'] = expected_indexes == new_schema['indexes']
    checks['only_six_reviewed_triggers'] = (set(new_schema['triggers']) == set(old_schema['triggers']) | set(cutover.NEW_TRIGGERS) and
        all(new_schema['triggers'][key] == value for key,value in old_schema['triggers'].items()) and
        all(new_schema['triggers'][key]['enabled'] == 'O' and details['triggers'][key] == dict(function=function,type=kind,deferrable=deferred,deferred=deferred)
            for key,(function,kind,deferred) in cutover.NEW_TRIGGERS.items()))
    cutover.recovery.verify_bundle()
    cutover.recovery_internal.verify_acl([cutover.recovery.SQL_FILE,cutover.recovery.BUNDLE_FILE,cutover.recovery.ENV_FILE,
                                         cutover.recovery.PROPOSAL_FILE,cutover.recovery.PRIVILEGE_BASELINE_FILE])
    checks['recovery_artifacts_unchanged'] = True
    record.update(migration_applied=True,after=after,details=details)
    record['diagnosis'] = dict(at=datetime.now(timezone.utc).isoformat(),read_only=True,checks=checks,
        root_cause='Cutover comparator omitted the three pg_constraint entries generated by the reviewed constraint triggers',
        sqlstate=None,regressions_resumed=False,overall_failure_retained=True)
    record['skipped'] = ['Database lint','Fixed-routing rollback-only pgTAP','Read-context rollback-only pgTAP',
        'Structural migration checks','Read-only HTTP checks','Frontend unit tests','Production build/private-key scan',
        'Legacy bootstrap and fixture-generating suites']
    cutover.save(record)
    cutover.require(all(checks.values()),'Additional read-only diagnostic integrity mismatch; stop')
    print('Read-only diagnosis: committed migration and only reviewed changes confirmed; comparator omitted three constraint-trigger catalog entries.',flush=True)
    print('Original FAIL/stop retained. No regression tests, migration retry, database fix or restore executed.',flush=True)


if __name__=='__main__':
    try:
        main()
    except Exception as error:
        print('STOP: '+(str(error) if isinstance(error,RuntimeError) else 'Read-only diagnosis failed; raw diagnostics suppressed'),flush=True)
        raise SystemExit(1) from None
