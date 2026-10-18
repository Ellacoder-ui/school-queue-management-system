"""Local-only Data API / Realtime test launcher; stdlib only, no dotenv reads.

Retrieves credentials from local CLI status into subprocess memory. --inspect
performs read-only catalog/fixture checks; default runs the isolated E2E suite.
"""
import argparse
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
from urllib.parse import unquote, urlparse


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--inspect', action='store_true')
    parser.add_argument('--resume-run', help='Resume only an incomplete fixture run by its nonsecret eight-character ID.')
    parser.add_argument('--diagnose-realtime', action='store_true', help='Read-only Realtime catalog diagnostics.')
    parser.add_argument('--remaining', action='store_true', help='Run remaining-gap validation with new isolated fixtures.')
    parser.add_argument('--frontend', action='store_true', help='Validate the actual frontend public API/controller against local Supabase.')
    parser.add_argument('--frontend-auth', action='store_true', help='Validate Phase 2 Auth/controllers and headless Chrome using new local identities.')
    args = parser.parse_args()
    if args.resume_run and not re.fullmatch(r'[0-9a-f]{8}', args.resume_run):
        raise SystemExit('Invalid fixture run ID.')
    if args.remaining and args.resume_run:
        raise SystemExit('Remaining-gap validation creates separate fixtures; resume mode is not supported.')
    if args.frontend and (args.remaining or args.resume_run):
        raise SystemExit('Choose only one integration test suite.')
    if args.frontend_auth and (args.frontend or args.remaining or args.resume_run):
        raise SystemExit('Choose only one integration test suite.')
    root = Path(__file__).resolve().parents[2]
    cli = root / 'node_modules' / 'supabase' / 'dist' / 'supabase.js'
    env = {k: v for k, v in os.environ.items()
           if not k.upper().startswith(('PG', 'SUPABASE_', 'QUEUE_', 'VITE_'))}
    status = subprocess.run(['node', str(cli), 'status', '--output', 'json'],
                            cwd=root, env=env, capture_output=True, text=True, timeout=60)
    if status.returncode:
        raise SystemExit('Local CLI status failed; raw output suppressed.')
    try:
        local = json.loads(status.stdout)
        db = urlparse(local['DB_URL'])
        api = urlparse(local['API_URL'])
        if (db.scheme not in ('postgres', 'postgresql') or db.hostname != '127.0.0.1'
                or db.port != 54322 or db.query or db.fragment or db.username != 'postgres'
                or db.path != '/postgres' or not db.password
                or api.scheme != 'http' or api.hostname != '127.0.0.1'
                or api.port != 54321 or api.path not in ('', '/') or api.query or api.fragment
                or api.username or api.password):
            raise ValueError('Non-local target')
        anon_key = local['ANON_KEY']
        service_key = local['SERVICE_ROLE_KEY']
    except (ValueError, TypeError, KeyError):
        raise SystemExit('Expected local endpoint/credential fields unavailable; no tests run.') from None
    psql = shutil.which('psql') or r'C:\Program Files\PostgreSQL\18\bin\psql.exe'
    if not Path(psql).is_file():
        raise SystemExit('psql required; no system software installed.')
    env.update(PGHOST='127.0.0.1', PGHOSTADDR='127.0.0.1', PGPORT='54322',
               PGDATABASE='postgres', PGUSER='postgres', PGPASSWORD=unquote(db.password),
               PGPASSFILE=os.devnull, PGCONNECT_TIMEOUT='5',
               PGOPTIONS='-c statement_timeout=15000 -c lock_timeout=10000')
    query = """begin read only;
    select json_build_object(
      'postgres_version',current_setting('server_version'),
      'role_counts',(select json_object_agg(role,n) from
        (select role,count(*) n from queue_private.accounts group by role) x),
      'ticket_states',(select json_object_agg(status,n) from
        (select status,count(*) n from queue_private.tickets group by status) x),
      'days',(select json_agg(json_build_object('date',business_date,'closed',closed_at is not null)) from queue_private.queue_days),
      'local_today',(clock_timestamp() at time zone 'Asia/Manila')::date,
      'publication',(select json_agg(schemaname||'.'||tablename order by schemaname,tablename)
        from pg_publication_tables where pubname='supabase_realtime'),
      'rls_tables',(select count(*) from pg_tables where schemaname in ('queue_private','queue_display') and rowsecurity),
      'private_usage_anon',has_schema_privilege('anon','queue_private','USAGE'),
      'private_usage_authenticated',has_schema_privilege('authenticated','queue_private','USAGE'));
    commit;"""
    inspection = subprocess.run([psql, '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1'],
                                input=query, env=env, cwd=root, text=True, capture_output=True, timeout=30)
    if inspection.returncode:
        raise SystemExit('Local catalog inspection failed; raw output suppressed.')
    print('Verified endpoints: PostgreSQL 127.0.0.1:54322; API http://127.0.0.1:54321.', flush=True)
    print('Read-only inspection: ' + json.dumps(json.loads(inspection.stdout.strip()), sort_keys=True), flush=True)
    if args.diagnose_realtime:
        diagnostic = """begin read only;
        select json_build_object(
          'realtime_subscriptions',(select count(*) from realtime.subscription),
          'realtime_subscription_roles',(select json_object_agg(role,n) from
            (select claims->>'role' role,count(*) n from realtime.subscription group by claims->>'role') x),
          'replication_slots',(select json_agg(json_build_object('plugin',plugin,'active',active,'wal_status',wal_status)) from pg_replication_slots),
          'publication_options',(select json_build_object('insert',pubinsert,'update',pubupdate,'delete',pubdelete) from pg_publication where pubname='supabase_realtime'),
          'display_select_anon',has_table_privilege('anon','queue_display.counter_state','SELECT'),
          'display_schema_anon',has_schema_privilege('anon','queue_display','USAGE'));
        commit;"""
        checked = subprocess.run([psql, '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1'], input=diagnostic,
                                 env=env, cwd=root, text=True, capture_output=True, timeout=30)
        if checked.returncode:
            raise SystemExit('Read-only Realtime diagnostics failed; raw output suppressed.')
        print('Realtime catalog diagnostics: '+json.dumps(json.loads(checked.stdout.strip()),sort_keys=True),flush=True)
        return
    if args.inspect:
        return
    env.update(QUEUE_E2E_API='http://127.0.0.1:54321', QUEUE_E2E_ANON_KEY=anon_key,
               QUEUE_E2E_SERVICE_KEY=service_key, QUEUE_E2E_PSQL=psql)
    if args.frontend or args.frontend_auth:
        # Match scripts/local_frontend.py exactly, including modern public keys.
        env['QUEUE_E2E_ANON_KEY'] = local.get('PUBLISHABLE_KEY') or anon_key
    if args.resume_run:
        env['QUEUE_E2E_RESUME_RUN'] = args.resume_run
    script = 'frontend_auth_validation.mjs' if args.frontend_auth else ('frontend_public_display.mjs' if args.frontend else ('remaining_api_validation.mjs' if args.remaining else 'api_realtime_security.mjs'))
    result = subprocess.run(['node', str(root / 'supabase' / 'tests' / script)],
                            cwd=root, env=env, timeout=300)
    raise SystemExit(result.returncode)


if __name__ == '__main__':
    main()
