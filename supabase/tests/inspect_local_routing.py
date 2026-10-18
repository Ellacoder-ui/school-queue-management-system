"""Read-only local routing inspection. No mutation RPCs, dotenv or account IDs.

Captures local CLI credentials only in memory. The database transaction and libpq
default are both read-only. Evidence contains routing/configuration aggregates.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
from urllib.parse import unquote, urlparse


def main():
    root = Path(__file__).resolve().parents[2]
    env = {k: v for k, v in os.environ.items()
           if not k.upper().startswith(('PG', 'SUPABASE_', 'QUEUE_', 'VITE_'))}
    status = subprocess.run(['node', str(root / 'node_modules/supabase/dist/supabase.js'),
                             'status', '--output', 'json'], cwd=root, env=env,
                            capture_output=True, text=True, timeout=60)
    if status.returncode:
        raise SystemExit('Local status unavailable; raw output suppressed.')
    try:
        local = json.loads(status.stdout)
        db, api = urlparse(local['DB_URL']), urlparse(local['API_URL'])
        if (db.scheme not in ('postgres', 'postgresql') or db.hostname != '127.0.0.1'
                or db.port != 54322 or db.username != 'postgres' or not db.password
                or db.path != '/postgres' or db.query or db.fragment
                or api.scheme != 'http' or api.hostname != '127.0.0.1' or api.port != 54321
                or api.path not in ('', '/') or api.query or api.fragment or api.username or api.password):
            raise ValueError('Local endpoints required')
    except (ValueError, KeyError, TypeError):
        raise SystemExit('Exact local endpoints required; stopped.') from None
    psql = shutil.which('psql') or r'C:\Program Files\PostgreSQL\18\bin\psql.exe'
    if not Path(psql).is_file():
        raise SystemExit('psql unavailable; stopped.')
    env.update(PGHOST='127.0.0.1', PGHOSTADDR='127.0.0.1', PGPORT='54322', PGDATABASE='postgres',
               PGUSER='postgres', PGPASSWORD=unquote(db.password), PGPASSFILE=os.devnull,
               PGCONNECT_TIMEOUT='5', PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=15000')
    query = """begin isolation level repeatable read read only;
    select jsonb_build_object(
      'target','127.0.0.1:54322',
      'inspected_at',clock_timestamp(),
      'read_only',current_setting('transaction_read_only'),
      'postgres_version',current_setting('server_version'),
      'local_today',(clock_timestamp() at time zone 'Asia/Manila')::date,
      'migrations',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations),
      'counters',(select jsonb_agg(jsonb_build_object(
        'number',c.number,'label',c.label,'is_open',c.is_open,
        'service_codes',(select coalesce(jsonb_agg(s.code order by s.code),'[]')
          from queue_private.counter_services cs join queue_private.services s on s.id=cs.service_id where cs.counter_id=c.id),
        'cashier_assignments',(select count(*) from queue_private.staff_counter_assignments a where a.counter_id=c.id),
        'eligible_cashier_assignments',(select count(*) from queue_private.staff_counter_assignments x
          join queue_private.accounts a on a.id=x.account_id join auth.users u on u.id=a.id
          where x.counter_id=c.id and a.role='CASHIER' and a.enabled and u.is_anonymous is not true),
        'ineligible_assignment_roles',(select coalesce(jsonb_agg(jsonb_build_object('role',role,'enabled',enabled,'count',n)),'[]')
          from (select a.role,a.enabled,count(*) n from queue_private.staff_counter_assignments x
            join queue_private.accounts a on a.id=x.account_id where x.counter_id=c.id
            and (a.role<>'CASHIER' or not a.enabled) group by a.role,a.enabled) z)
      ) order by c.number) from queue_private.counters c),
      'services',(select jsonb_agg(jsonb_build_object('code',s.code,'name',s.name,'enabled',s.enabled,
        'counters',(select coalesce(jsonb_agg(c.number order by c.number),'[]') from queue_private.counter_services cs
          join queue_private.counters c on c.id=cs.counter_id where cs.service_id=s.id)) order by s.code) from queue_private.services s),
      'queue_days',(select jsonb_agg(jsonb_build_object('date',business_date,'closed',closed_at is not null) order by business_date) from queue_private.queue_days),
      'ticket_status_counts',(select jsonb_object_agg(status,n) from (select status,count(*) n from queue_private.tickets group by status) z),
      'historical_routing',(select jsonb_agg(jsonb_build_object('counter',counter,'service',service,'event',event,'count',n) order by counter,service,event)
        from (select c.number counter,s.code service,e.event_type event,count(*) n from queue_private.ticket_events e
          join queue_private.counters c on c.id=e.counter_id join queue_private.tickets t on t.id=e.ticket_id
          join queue_private.services s on s.id=t.service_id group by c.number,s.code,e.event_type) z),
      'row_counts',(select jsonb_build_object('accounts',(select count(*) from queue_private.accounts),
        'tickets',(select count(*) from queue_private.tickets),'events',(select count(*) from queue_private.ticket_events),
        'requests',(select count(*) from queue_private.operation_requests),'admin_audits',(select count(*) from queue_private.admin_audit_events))),
      'counter_service_constraints',(select jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)))
        from pg_constraint where conrelid='queue_private.counter_services'::regclass),
      'counter_service_triggers',(select coalesce(jsonb_agg(tgname),'[]') from pg_trigger
        where tgrelid='queue_private.counter_services'::regclass and not tgisinternal),
      'private_schema_anon',has_schema_privilege('anon','queue_private','USAGE'),
      'private_schema_authenticated',has_schema_privilege('authenticated','queue_private','USAGE'),
      'rls_tables',(select count(*) from pg_tables where schemaname in ('queue_private','queue_display') and rowsecurity),
      'publication',(select jsonb_agg(schemaname||'.'||tablename order by tablename) from pg_publication_tables where pubname='supabase_realtime'),
      '_function_sources',(select jsonb_object_agg(n.nspname||'.'||p.proname,p.prosrc) from pg_proc p
        join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('queue_api','queue_private','queue_display'))
    ); commit;"""
    result = subprocess.run([psql, '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1'],
                            cwd=root, env=env, input=query, text=True, capture_output=True, timeout=30)
    if result.returncode:
        raise SystemExit('Read-only inspection failed; raw diagnostics suppressed.')
    evidence = json.loads(result.stdout.strip())
    sources = evidence.pop('_function_sources')
    files = sorted((root / 'supabase/migrations').glob('*.sql'))
    evidence['migration_files'] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    evidence['function_bodies_match_migrations'] = {}
    for path in files:
        for match in re.finditer(r'create function (queue_\w+\.\w+)\(.*?\bas\s+\$\$(.*?)\$\$;',
                                 path.read_text(encoding='utf-8'), re.S):
            name, expected = match.groups()
            observed = sources.get(name)
            evidence['function_bodies_match_migrations'][name] = (
                observed is not None and observed.replace('\r\n', '\n').strip() == expected.strip())
    output = root / 'supabase/tests/results/fixed_routing_inspection.json'
    output.write_text(json.dumps(evidence, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(evidence, indent=2))


if __name__ == '__main__':
    main()
