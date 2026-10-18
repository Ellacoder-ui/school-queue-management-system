"""One-shot, explicitly authorized retained-local migration 006 cutover.

Never resets, links, pushes, creates persistent test fixtures, or restores a backup.
The backup verifiers remain immutable pre-cutover tools, not post-cutover baselines.
Credentials/raw diagnostics stay in memory; evidence contains hashes and aggregates.
"""
import argparse
from collections import Counter
from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
from urllib.error import HTTPError
from urllib.request import Request, build_opener, HTTPRedirectHandler

import retained_migration_006 as backup
import restore_local_backup_internal as recovery_internal
import schema_privilege_recovery as recovery

ROOT = backup.ROOT
EVIDENCE = ROOT / 'supabase/tests/results/retained_migration_006_cutover.json'
SOURCE_IDENTIFIER = '7696959712798593061'
NETWORK = 'supabase_network_school-queue-local'
TEST_FILES = ['fixed_routing_test.sql', 'read_context_test.sql']
NEW_FUNCTIONS = {
    'queue_private.fixed_service_code(p_number smallint)': ('sql', False, 'i', 'text'),
    'queue_private.assert_fixed_routing()': ('plpgsql', True, 'v', 'void'),
    'queue_private.lock_fixed_routing_statement()': ('plpgsql', True, 'v', 'trigger'),
    'queue_private.check_fixed_routing_trigger()': ('plpgsql', True, 'v', 'trigger'),
}
CONFIGURE = 'queue_api.configure_counter(p_counter uuid, p_open boolean, p_services text[], p_cashiers uuid[], p_request_key uuid)'
NEW_CONSTRAINTS = {
    'queue_private.counter_services:counter_services_one_service': 'UNIQUE (counter_id)',
    'queue_private.counter_services:counter_services_one_counter': 'UNIQUE (service_id)',
}
NEW_CONSTRAINT_TRIGGERS = {
    'queue_private.counter_services:fixed_routing_complete': 'TRIGGER DEFERRABLE INITIALLY DEFERRED',
    'queue_private.counters:fixed_counters_complete': 'TRIGGER DEFERRABLE INITIALLY DEFERRED',
    'queue_private.services:fixed_services_complete': 'TRIGGER DEFERRABLE INITIALLY DEFERRED',
}
NEW_INDEXES = {
    'queue_private.counter_services_one_service': 'CREATE UNIQUE INDEX counter_services_one_service ON queue_private.counter_services USING btree (counter_id)',
    'queue_private.counter_services_one_counter': 'CREATE UNIQUE INDEX counter_services_one_counter ON queue_private.counter_services USING btree (service_id)',
}
NEW_TRIGGERS = {
    'queue_private.counter_services:fixed_routing_lock': ('queue_private.lock_fixed_routing_statement', 62, False),
    'queue_private.counters:fixed_counter_lock': ('queue_private.lock_fixed_routing_statement', 62, False),
    'queue_private.services:fixed_service_lock': ('queue_private.lock_fixed_routing_statement', 62, False),
    'queue_private.counter_services:fixed_routing_complete': ('queue_private.check_fixed_routing_trigger', 29, True),
    'queue_private.counters:fixed_counters_complete': ('queue_private.check_fixed_routing_trigger', 29, True),
    'queue_private.services:fixed_services_complete': ('queue_private.check_fixed_routing_trigger', 29, True),
}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def save(record):
    backup.write_json(EVIDENCE, record)


def invocation(command, *, env=None, timeout=180):
    """Do not print subprocess SQL, credentials, or unfiltered diagnostics."""
    return subprocess.run(command, cwd=ROOT, env=env or backup.clean_env(),
                          capture_output=True, text=True, encoding='utf-8', timeout=timeout)


def sqlstates(output):
    return sorted(set(re.findall(r'(?:SQLSTATE\s+|(?:ERROR|FATAL):\s+)([A-Z0-9]{5})\b', output)))


def capture():
    local, env, identity = backup.target()
    with backup.Snapshot(env) as snapshot:
        identifier = snapshot.query('select to_jsonb(system_identifier::text) from pg_control_system()')
        require(identifier == SOURCE_IDENTIFIER, 'Retained PostgreSQL cluster identifier differs')
        result = {
            'identity': identity, 'system_identifier': identifier,
            'rows': backup.all_rows(snapshot.query), 'schema': backup.schema_metadata(snapshot.query),
            'roles': backup.role_metadata(snapshot.query), 'sequences': backup.sequence_values(snapshot.query),
            'catalog': backup.table_catalog(snapshot.query), 'state': backup.state(None, snapshot.query),
            'additional_privileges': recovery.additional_privileges(snapshot.query),
            'display_without_timestamps': snapshot.query("""select jsonb_build_object(
                'counter',(select coalesce(jsonb_agg(to_jsonb(c)-'updated_at' order by counter_id),'[]') from queue_display.counter_state c),
                'service',(select coalesce(jsonb_agg(to_jsonb(s)-'updated_at' order by business_date,service_code),'[]') from queue_display.service_state s))"""),
            'clock': snapshot.query('select to_jsonb(clock_timestamp())'),
        }
    return local, env, result


def preflight(before):
    manifest = recovery_internal.pinned_artifacts()
    require(before['identity']['migration_sha256'] == manifest['source']['migration_sha256'], 'Validated migration hashes differ')
    for name in ('rows', 'schema', 'roles', 'sequences', 'catalog', 'state'):
        require(before[name] == manifest[name], 'Source no longer matches backed-up ' + name)
    baseline = json.loads(recovery.PRIVILEGE_BASELINE_FILE.read_text(encoding='utf-8'))['privileges']
    require(before['additional_privileges'] == baseline, 'Source privileges/settings differ from verified recovery baseline')
    state = before['state']
    files, _ = backup.verify_files()
    versions = [path.name.split('_')[0] for path in files]
    require(state['versions'] == versions[:5], 'Exactly five original applied migrations required')
    pending = [path.name for path in files if path.name.split('_')[0] not in state['versions']]
    require(pending == [backup.MIGRATION.name], 'Only reviewed migration 006 may be pending')
    require(state['routes'] == backup.LEGACY, 'Reviewed legacy route matrix changed')
    require(state['counts'] == dict(accounts=39, tickets=20, events=57, requests=69, audits=31, days=7, services=5, counters=5), 'Business record counts changed')
    require(not state['active'] and not state['open_days'] and state['current_day_closed'], 'Unexpected active work or business-day state')
    require(state['rls_count'] == 15 and not state['private_usage'], 'RLS/private schema boundary differs')
    require(state['publication'] == ['queue_display.counter_state', 'queue_display.service_state'], 'Realtime publication differs')
    require(len(before['rows']) == 69, 'Expected complete 69-table inventory')
    require(before['display_without_timestamps']['service'] == [], 'Unexpected public service projection')
    require(len(before['display_without_timestamps']['counter']) == 5, 'Expected five public counter projections')
    return {'pending': pending, 'all_69_tables_match_backup': True, 'all_security_roles_sequences_match_backup': True,
            'current_day_closed': True, 'zero_active_tickets': True}


def compare_append_only(before, after, extra, label):
    require(after['count'] == before['count'] + 1, label + ': expected exactly one addition')
    require(Counter(after['rows']) == Counter(before['rows']) + Counter([extra]), label + ': historical rows changed')


def expected_constraint(key):
    relation, name = key.split(':')
    schema, table = relation.split('.')
    deferred = key in NEW_CONSTRAINT_TRIGGERS
    definition = (NEW_CONSTRAINT_TRIGGERS if deferred else NEW_CONSTRAINTS)[key]
    return dict(schema=schema, relation=table, name=name, type='t' if deferred else 'u',
                definition=definition, validated=True, deferrable=deferred, deferred=deferred)


def expected_trigger(key):
    function, trigger_type, deferred = NEW_TRIGGERS[key]
    return dict(function=function, type=trigger_type, deferrable=deferred, deferred=deferred,
                constraint=key if deferred else None)


def expected_trigger_definition(key):
    relation, name = key.split(':')
    function, _, deferred = NEW_TRIGGERS[key]
    if deferred:
        return (f'CREATE CONSTRAINT TRIGGER {name} AFTER INSERT OR DELETE OR UPDATE ON {relation} '
                f'DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION {function}()')
    return (f'CREATE TRIGGER {name} BEFORE INSERT OR DELETE OR UPDATE OR TRUNCATE ON {relation} '
            f'FOR EACH STATEMENT EXECUTE FUNCTION {function}()')


def compare_schema(before, after, details):
    """Strictly include the three constraint-trigger pg_constraint entries as well as pg_trigger."""
    require(set(before) == set(after), 'Schema section inventory changed')
    exceptional = {'functions', 'constraints', 'indexes', 'triggers'}
    for section in set(before) - exceptional:
        require(before[section] == after[section], 'Unapproved schema/security difference: ' + section)
    require(set(after['functions']) == set(before['functions']) | set(NEW_FUNCTIONS), 'Unexpected function additions/removals')
    for key, value in before['functions'].items():
        if key == CONFIGURE:
            require({k: v for k, v in after['functions'][key].items() if k != 'definition'} ==
                    {k: v for k, v in value.items() if k != 'definition'}, 'configure_counter owner/ACL changed')
            require(after['functions'][key]['definition'] != value['definition'], 'configure_counter was not replaced')
        else:
            require(after['functions'][key] == value, 'Existing function changed: ' + key)
    require(CONFIGURE in before['functions'], 'Missing original configuration RPC')
    owner_acl = [dict(grantor='postgres', grantee='postgres', privilege='EXECUTE', grantable=False)]
    for key, (language, definer, volatility, result_type) in NEW_FUNCTIONS.items():
        require(after['functions'][key]['owner'] == 'postgres' and after['functions'][key]['acl'] == owner_acl,
                'New private function privilege/owner differs')
        require(details['functions'][key] == dict(language=language, definer=definer, volatility=volatility,
                                                result=result_type, config=['search_path=""']), 'Helper function contract differs')
    constraints = {**NEW_CONSTRAINTS, **NEW_CONSTRAINT_TRIGGERS}
    for section, additions in [('constraints', constraints), ('indexes', NEW_INDEXES), ('triggers', NEW_TRIGGERS)]:
        require(set(after[section]) == set(before[section]) | set(additions), 'Unexpected ' + section + ' additions/removals')
        for key, value in before[section].items():
            require(after[section][key] == value, 'Existing ' + section + ' changed')
    require(set(details['constraints']) == set(constraints), 'Routing constraint catalog inventory differs')
    for key in constraints:
        expected = expected_constraint(key)
        require(details['constraints'][key] == expected, 'Routing constraint identity/type/definition/attributes differ')
        require(after['constraints'][key] == {k: expected[k] for k in ('definition','validated','deferrable','deferred')},
                'Routing constraint definition or deferrability differs')
    for key, definition in NEW_INDEXES.items():
        require(after['indexes'][key] == dict(definition=definition, valid=True, ready=True), 'Routing unique index differs')
    require(set(details['triggers']) == set(NEW_TRIGGERS), 'Routing trigger catalog inventory differs')
    for key in NEW_TRIGGERS:
        require(after['triggers'][key] == dict(enabled='O',definition=expected_trigger_definition(key)),
                'Routing trigger disabled or definition altered')
        require(details['triggers'][key] == expected_trigger(key), 'Routing trigger events/function/constraint link differ')


def post_details(env):
    with backup.Snapshot(env) as snapshot:
        details = snapshot.query("""select jsonb_build_object(
          'audit',(select jsonb_build_object('hash',""" + backup.row_digest('a', ['id', 'actor_id', 'action', 'parameters', 'occurred_at']) + """,
            'actor_is_null',actor_id is null,'parameters',parameters,'occurred_at',occurred_at)
            from queue_private.admin_audit_events a where action='FIXED_ROUTING_CUTOVER'),
          'history',(select jsonb_build_object('hash',""" + backup.row_digest('m', ['version', 'statements', 'name']) + """,
            'name',name,'version',version,'statement_count',cardinality(statements))
            from supabase_migrations.schema_migrations m where version='20261016000600'),
          'routes',(select jsonb_build_object('count',count(*),'rows',jsonb_agg(h order by h collate "C")) from
            (select """ + backup.row_digest('x', ['counter_id', 'service_id']) + """ h from queue_private.counter_services x
             join queue_private.counters c on c.id=x.counter_id join queue_private.services s on s.id=x.service_id
             where s.code=case c.number when 1 then 'TP' when 2 then 'SOA' when 3 then 'PNEP' when 4 then 'REF' when 5 then 'ADJ' end) r),
          'functions',(select jsonb_object_agg(n.nspname::text||'.'||p.proname::text||'('||pg_get_function_identity_arguments(p.oid)||')',
            jsonb_build_object('language',l.lanname,'definer',p.prosecdef,'volatility',p.provolatile::text,'result',pg_get_function_result(p.oid),'config',p.proconfig))
            from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
            where n.nspname='queue_private' and p.proname in ('fixed_service_code','assert_fixed_routing','lock_fixed_routing_statement','check_fixed_routing_trigger')),
          'constraints',(select jsonb_object_agg(n.nspname::text||'.'||c.relname::text||':'||k.conname::text,
            jsonb_build_object('schema',n.nspname,'relation',c.relname,'name',k.conname,'type',k.contype::text,
              'definition',pg_get_constraintdef(k.oid,true),'validated',k.convalidated,'deferrable',k.condeferrable,'deferred',k.condeferred))
            from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
            where n.nspname='queue_private' and k.conname in ('counter_services_one_service','counter_services_one_counter',
              'fixed_routing_complete','fixed_counters_complete','fixed_services_complete')),
          'triggers',(select jsonb_object_agg(n.nspname::text||'.'||c.relname::text||':'||t.tgname::text,
            jsonb_build_object('function',pn.nspname::text||'.'||p.proname::text,'type',t.tgtype,'deferrable',t.tgdeferrable,'deferred',t.tginitdeferred,
              'constraint',case when k.oid is not null then kn.nspname::text||'.'||kc.relname::text||':'||k.conname::text end))
            from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
            join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace
            left join pg_constraint k on k.oid=t.tgconstraint left join pg_class kc on kc.oid=k.conrelid
            left join pg_namespace kn on kn.oid=kc.relnamespace
            where n.nspname='queue_private' and t.tgname like 'fixed_%'),
          'display_times',(select jsonb_build_object('minimum',min(updated_at),'maximum',max(updated_at)) from queue_display.counter_state),
          'sources',(select jsonb_object_agg(n.nspname::text||'.'||p.proname::text,p.prosrc)
            from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('queue_private','queue_api','queue_display')))
        """)
        expected = {}
        for path in sorted((ROOT/'supabase/migrations').glob('*.sql')):
            for name, body in re.findall(r'create (?:or replace )?function (queue_\w+\.\w+)\(.*?\bas\s+\$\$(.*?)\$\$;', path.read_text(encoding='utf-8'), re.S):
                expected[name] = body.strip()
        sources = details.pop('sources')
        require(set(sources) == set(expected), 'Application function inventory differs from migrations')
        require(all(sources[name].replace('\r\n', '\n').strip() == body for name, body in expected.items()), 'Application function body differs from validated SQL')
        details['function_bodies_match'] = {name: True for name in expected}
    return details


def postflight(before, after, details):
    require(before['identity'] == after['identity'] and before['system_identifier'] == after['system_identifier'], 'Retained target changed during cutover')
    expected_state = deepcopy(before['state'])
    expected_state['versions'].append(backup.VERSION)
    expected_state['routes'] = backup.CANONICAL
    expected_state['counts']['audits'] += 1
    require(after['state'] == expected_state, 'Unexpected queue, staffing, security or migration state change')
    for name in ('roles', 'sequences', 'catalog', 'additional_privileges', 'display_without_timestamps'):
        require(before[name] == after[name], 'Unexpected cutover difference: ' + name)
    require(set(before['rows']) == set(after['rows']), 'Table inventory changed')
    changed = {backup.table_key('queue_private', 'counter_services'), backup.table_key('queue_private', 'admin_audit_events'),
               backup.table_key('supabase_migrations', 'schema_migrations'), backup.table_key('queue_display', 'counter_state')}
    for table in set(before['rows']) - changed:
        require(before['rows'][table] == after['rows'][table], 'Unapproved table-row change')
    require(details['routes']['count'] == 5 and after['rows'][backup.table_key('queue_private','counter_services')] == details['routes'], 'Routing relationship rows differ from exact canonical matrix')
    audit = details['audit']
    require(audit is not None and audit['actor_is_null'], 'Missing/operator identity cutover audit differs')
    matrix = lambda routes: [dict(counter=int(number), service=code) for number, codes in sorted(routes.items()) for code in codes]
    require(audit['parameters'] == dict(migration=backup.VERSION, before=matrix(backup.LEGACY), after=matrix(backup.CANONICAL)), 'Unexpected cutover audit parameters')
    compare_append_only(before['rows'][backup.table_key('queue_private','admin_audit_events')], after['rows'][backup.table_key('queue_private','admin_audit_events')], audit['hash'], 'Administrative audit')
    history = details['history']
    require(history is not None and history['name'] == 'fixed_counter_routing' and history['version'] == backup.VERSION and history['statement_count'] > 0, 'Unexpected sixth migration receipt')
    compare_append_only(before['rows'][backup.table_key('supabase_migrations','schema_migrations')], after['rows'][backup.table_key('supabase_migrations','schema_migrations')], history['hash'], 'Migration history')
    parse = lambda value: datetime.fromisoformat(value)
    require(parse(before['clock']) <= parse(audit['occurred_at']) <= parse(after['clock']), 'Audit timestamp outside cutover')
    require(parse(before['clock']) <= parse(details['display_times']['minimum']) <= parse(details['display_times']['maximum']) <= parse(after['clock']), 'Display refresh timestamp outside cutover')
    compare_schema(before['schema'], after['schema'], details)
    return {'unchanged_tables': 65, 'logical_tables_checked': 69, 'only_reviewed_differences': True,
            'original_audits_preserved': 31, 'new_cutover_audits': 1, 'replays_unchanged': 69,
            'functions_match_validated_sql': len(details['function_bodies_match']), 'migration_006_present_once': True,
            'security_boundaries_preserved': True, 'expected_display_timestamp_refresh_only': True}


def cli_step(arguments, label, env=None, expected_tests=None):
    backup.target()
    result = invocation(backup.CLI + arguments + ['--workdir', str(ROOT), '--network-id', NETWORK], env=env)
    output = result.stdout + '\n' + result.stderr
    record = {'label': label, 'exit_code': result.returncode, 'sqlstates': sqlstates(output)}
    record['evidence'] = [line for line in output.splitlines() if
                          line.startswith(('All tests successful', 'Files=', 'Result:', 'No schema errors', 'not ok ', '1..'))]
    if expected_tests is not None:
        match = re.search(r'Files=\d+, Tests=(\d+)', output)
        record.update(passed=int(match.group(1)) if match and result.returncode == 0 else 0, failed=0 if result.returncode == 0 else 1)
        require(result.returncode == 0 and match and int(match.group(1)) == expected_tests and 'Result: PASS' in output and not re.search(r'^not ok ', output, re.M), label + ' failed; raw diagnostics suppressed')
    else:
        require(result.returncode == 0, label + ' failed; SQLSTATE=' + ','.join(record['sqlstates']) + '; raw diagnostics suppressed')
        if label == 'Database lint':
            require('No schema errors found' in output, 'Database lint did not report a clean schema')
    print('PASS: ' + label, flush=True)
    return record


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def read_http(local, env):
    """No Auth user/session creation and no operational RPC; public key only."""
    public_key = local.get('PUBLISHABLE_KEY') or local.get('ANON_KEY')
    require(bool(public_key) and not public_key.startswith('sb_secret_'), 'Public API credential unavailable')
    opener = build_opener(NoRedirect)
    checks = []

    def request(method, path, schema):
        require(method in ('GET', 'POST') and path in ('/', '/counter_state', '/service_state', '/rpc/public_queue_context', '/rpc/my_context', '/tickets'), 'Read-only HTTP allowlist violation')
        headers = {'apikey': public_key, 'Accept-Profile' if method == 'GET' else 'Content-Profile': schema}
        data = b'{}' if method == 'POST' else None
        if data is not None: headers['Content-Type'] = 'application/json'
        req = Request('http://127.0.0.1:54321/rest/v1' + path, headers=headers, method=method, data=data)
        try:
            with opener.open(req, timeout=15) as response: return response.status, json.loads(response.read())
        except HTTPError as error:
            require(error.code < 300 or error.code >= 400, 'HTTP redirect refused')
            return error.code, json.loads(error.read())

    for path, columns, count in [('/counter_state', {'counter_id','counter_label','is_open','ticket_label','service_code','business_date','updated_at'}, 5),
                                 ('/service_state', {'service_code','business_date','waiting_count','updated_at'}, 0)]:
        status, rows = request('GET', path, 'queue_display')
        require(status == 200 and isinstance(rows,list) and len(rows) == count and all(set(row) == columns for row in rows), 'Anonymous public table contract failed')
        if path == '/counter_state': require(all(row['ticket_label'] is None and row['service_code'] is None and row['business_date'] is None for row in rows), 'Stale public ticket labels')
        checks.append({'check': 'anonymous sanitized ' + path, 'result': 'PASS'})
    status, context = request('POST', '/rpc/public_queue_context', 'queue_display')
    require(status == 200 and set(context) == {'timezone','business_date','queue_day_open','services'} and context['timezone'] == 'Asia/Manila' and context['queue_day_open'] is False, 'Public business-day contract failed')
    require(all(set(item) == {'code','name'} for item in context['services']) and {item['code'] for item in context['services']} == {'TP','SOA','PNEP','REF','ADJ'}, 'Public service catalog differs')
    expected_context = backup.read_json(env,"""select jsonb_build_object('timezone','Asia/Manila',
      'business_date',(clock_timestamp() at time zone 'Asia/Manila')::date,'queue_day_open',false,
      'services',(select jsonb_agg(jsonb_build_object('code',code,'name',name) order by code) from queue_private.services where enabled))""")
    require(context == expected_context, 'HTTP public context differs from authoritative database projection')
    checks.append({'check': 'anonymous sanitized current closed-day context', 'result': 'PASS'})
    for method, path, schema, code in [('POST','/rpc/my_context','queue_api','42501'),
                                       ('GET','/counter_state','queue_private','PGRST106'),
                                       ('GET','/tickets','public','PGRST205')]:
        status, body = request(method,path,schema)
        require(status in (401,403,404,406) and body.get('code') == code, 'Private HTTP boundary failed')
        checks.append({'check': 'anonymous denial ' + schema + path, 'result':'PASS'})
    status, spec = request('GET', '/', 'queue_api')
    require(status == 200 and isinstance(spec,dict), 'Queue API schema inspection failed')
    paths = set(spec.get('paths',{}))
    # OpenAPI may omit every business RPC for anon because it follows current ACLs.
    permitted = {'/'} | {'/rpc/'+name for name in ('my_context','my_tickets','my_ticket_events','issue_ticket','call_next','finish_ticket','staff_queue','admin_configuration','set_account','configure_counter','configure_service','manage_day')}
    require(paths <= permitted, 'Private API exposure detected')
    checks.append({'check': 'API schema exposure remains restricted', 'result':'PASS'})
    return {'passed':len(checks),'failed':0,'skipped':0,'checks':checks,'credentials':'public key only; no Auth sessions created'}


def exact_snapshot(before, after, label):
    for name in before:
        if name != 'clock': require(before[name] == after[name], label + ': durable state changed')


def run():
    require(not EVIDENCE.exists(), 'One-shot evidence already exists; do not repeat migration automatically')
    record = {'started_at':datetime.now(timezone.utc).isoformat(), 'result':'IN_PROGRESS', 'phase':'recovery-verification',
              'target':'127.0.0.1:54322/postgres','project':backup.PROJECT,'migration':backup.MIGRATION.name,
              'migration_attempted':False,'regressions':[],'hosted_contacted':False}
    save(record)
    try:
        recovery.verify_existing()
        record['recovery'] = {'result':'PASS','evidence':'schema_privilege_recovery.json','full_restore_repeated':False,
                              'bundle_sha256':backup.file_sha256(recovery.BUNDLE_FILE)}
        record['phase'] = 'fresh-preflight'
        local, env, before = capture()
        record['preflight'] = preflight(before)
        record['before'] = before
        save(record)
        print('PASS: fresh full source/backup preflight; five migrations, exact legacy matrix, zero active work.',flush=True)
        # Reverify target, complete source state and exactly one pending migration immediately before CLI.
        local, env, immediate = capture()
        preflight(immediate)
        exact_snapshot(before,immediate,'Immediate pre-apply check')
        record.update(phase='migration-execution', migration_attempted=True)
        save(record)
        result = invocation(backup.CLI + ['migration','up','--local','--workdir',str(ROOT),'--network-id',NETWORK], timeout=180)
        output = result.stdout + '\n' + result.stderr
        record['migration_execution'] = {'exit_code':result.returncode,'sqlstates':sqlstates(output)}
        save(record)
        if result.returncode:
            _, _, failed = capture()
            try:
                exact_snapshot(before,failed,'Failed-migration rollback check')
                record['migration_execution']['complete_rollback_verified'] = True
            except RuntimeError:
                record['migration_execution']['complete_rollback_verified'] = False
            record['after_failure'] = failed
            raise RuntimeError('Migration execution failed; SQLSTATE=' + ','.join(sqlstates(output)) + '; no retry or automatic restore')
        record['phase'] = 'postflight'
        local, env, after = capture()
        details = post_details(env)
        record['postflight'] = postflight(before,after,details)
        record['after'] = after
        record['details'] = details
        record['migration_applied'] = True
        save(record)
        print('PASS: six migrations, exact permanent map, constraints/triggers/functions, all historical data and security preserved.',flush=True)
        for label,args,count in [
            ('Database lint',['db','lint','--local'],None),
            ('Fixed-routing rollback-only pgTAP',['test','db','--local','supabase/tests/database/fixed_routing_test.sql'],44),
            ('Read-context rollback-only pgTAP',['test','db','--local','supabase/tests/database/read_context_test.sql'],44),
        ]:
            check = cli_step(args,label,expected_tests=count)
            record['regressions'].append(check)
            _, env, observed = capture()
            exact_snapshot(after,observed,label)
            save(record)
        record['http'] = read_http(local, env)
        print('PASS: seven read-only HTTP/public authorization and schema checks.',flush=True)
        save(record)
        for label,command in [('Structural migration checks',[sys.executable,'supabase/tests/static_check.py']),
                              ('Frontend unit tests',[shutil.which('npm.cmd') or shutil.which('npm'),'run','test:frontend']),
                              ('Frontend production build and private-key scan',[sys.executable,'scripts/local_frontend.py','--build'])]:
            result = invocation(command)
            output = result.stdout + '\n' + result.stderr
            check = {'label':label,'exit_code':result.returncode}
            if label == 'Structural migration checks':
                match = re.search(r'Ran (\d+) tests?',output)
                require(result.returncode == 0 and match and int(match.group(1)) == 6, 'Structural checks failed')
                check.update(passed=6,failed=0,skipped=0)
            elif label == 'Frontend unit tests':
                counts = {key:int(value) for key,value in re.findall(r'^\s*(?:# |ℹ )?(tests|pass|fail|skipped)\s+(\d+)\s*$',output,re.M)}
                require(result.returncode == 0 and counts.get('pass',0) > 0 and counts.get('fail') == 0, 'Frontend tests failed')
                check.update(passed=counts['pass'],failed=counts['fail'],skipped=counts.get('skipped',0))
            else:
                require(result.returncode == 0 and 'Build credential check: no local service-role/secret key present.' in output, 'Frontend build or credential scan failed')
                check.update(build='PASS',private_key_scan='PASS')
            record['regressions'].append(check)
            save(record)
            print('PASS: '+label,flush=True)
        _, _, final = capture()
        exact_snapshot(after,final,'Final preservation check')
        # The old backup source verifier intentionally cannot match post-cutover state.
        # Recheck artifact integrity only, without rewriting the pre-migration manifest.
        recovery.verify_bundle()
        recovery_internal.verify_acl([recovery.SQL_FILE,recovery.BUNDLE_FILE,recovery.ENV_FILE,recovery.PROPOSAL_FILE,recovery.PRIVILEGE_BASELINE_FILE])
        record.update(result='PASS',phase='complete',completed_at=datetime.now(timezone.utc).isoformat(),
                      final_preservation=True,recovery_artifacts_unchanged=True,final_state=final['state'])
        record['skipped'] = ['Legacy fresh-instance bootstrap suite', 'Fixture-generating concurrency/API/Realtime/browser suites']
        save(record)
        print('STOPPED: authorized local migration 006 and fixture-safe regressions passed; no Google/frontend operations or hosted deployment.',flush=True)
    except BaseException as error:
        message = str(error) if isinstance(error,RuntimeError) else 'Harness failure; raw diagnostics suppressed'
        record.update(result='FAIL',failure=message)
        save(record)
        print('STOP: '+message,flush=True)
        raise SystemExit(1) from None


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply',action='store_true',required=True,help='Execute the specific user-authorized one-shot local cutover')
    parser.parse_args()
    run()
