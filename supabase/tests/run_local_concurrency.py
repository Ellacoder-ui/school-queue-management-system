"""Fetch only local CLI status, check a pristine database, then run concurrency.py.

No third-party Python packages. Credentials remain in subprocess memory and are
never printed or saved. --preflight performs read-only SQL and does not run tests.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from urllib.parse import unquote, urlparse


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--preflight', action='store_true')
    mode.add_argument('--postflight', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    cli = root / 'node_modules' / 'supabase' / 'dist' / 'supabase.js'
    if not cli.is_file() or not shutil.which('node'):
        raise SystemExit('Project-local Supabase CLI and Node.js required.')
    env = {k: v for k, v in os.environ.items()
           if not k.upper().startswith(('PG', 'SUPABASE_', 'QUEUE_TEST_'))}
    psql_executable = shutil.which('psql')
    if not psql_executable:
        local_psql = Path(r'C:\Program Files\PostgreSQL\18\bin')
        if (local_psql / 'psql.exe').is_file():
            env['PATH'] = str(local_psql) + os.pathsep + env.get('PATH', '')
            psql_executable = str(local_psql / 'psql.exe')
        else:
            raise SystemExit('psql required; no packages or system tools installed.')
    status = subprocess.run(['node', str(cli), 'status', '--output', 'json'],
                            cwd=root, env=env, capture_output=True, text=True, timeout=60)
    if status.returncode:
        raise SystemExit('Local CLI status failed; raw output suppressed to protect credentials.')
    try:
        url = json.loads(status.stdout)['DB_URL']
        parsed = urlparse(url)
        if (parsed.scheme not in ('postgres', 'postgresql') or parsed.hostname != '127.0.0.1'
                or parsed.port != 54322 or parsed.query or parsed.fragment
                or parsed.username != 'postgres' or parsed.path != '/postgres' or not parsed.password):
            raise ValueError('unexpected local target')
    except (ValueError, KeyError, TypeError):
        raise SystemExit('CLI did not provide the required 127.0.0.1:54322 local database URL.') from None
    env.update(PGDATABASE='postgres', PGHOST='127.0.0.1', PGPORT='54322',
               PGUSER='postgres', PGPASSWORD=unquote(parsed.password),
               PGHOSTADDR='127.0.0.1', PGPASSFILE=os.devnull,
               PGCONNECT_TIMEOUT='5', PGOPTIONS='-c statement_timeout=15000 -c lock_timeout=10000')
    query = """begin read only;
    select json_build_object(
      'postgres_version',current_setting('server_version'),
      'migrations',(select count(*) from supabase_migrations.schema_migrations),
      'accounts',(select count(*) from queue_private.accounts),
      'tickets',(select count(*) from queue_private.tickets),
      'days',(select count(*) from queue_private.queue_days),
      'services',(select count(*) from queue_private.services),
      'counters',(select count(*) from queue_private.counters));
    commit;"""
    checked = subprocess.run([psql_executable, '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1'], input=query,
                             cwd=root, env=env, capture_output=True, text=True, timeout=30)
    if checked.returncode:
        raise SystemExit('Read-only local database preflight failed; raw output suppressed.')
    state = json.loads(checked.stdout.strip())
    print('Verified target: 127.0.0.1:54322; credentials obtained from local CLI status only.', flush=True)
    print('Read-only preflight: ' + json.dumps(state, sort_keys=True), flush=True)
    if args.postflight:
        audit = """begin read only;
        select json_build_object(
          'active_tickets',(select count(*) from queue_private.tickets where status in ('WAITING','CALLED')),
          'served_tickets',(select count(*) from queue_private.tickets where status='SERVED'),
          'forfeited_tickets',(select count(*) from queue_private.tickets where status='FORFEITED'),
          'skip_events',(select count(*) from queue_private.ticket_events where event_type='SKIPPED'),
          'duplicate_numbers',(select count(*) from
            (select 1 from queue_private.tickets group by queue_day_id,service_id,sequence_number having count(*)>1) x),
          'quota_violations',(select count(*) from
            (select 1 from queue_private.tickets where status='SERVED' group by owner_id,queue_day_id,service_id having count(*)>2) x),
          'duplicate_serve_events',(select count(*) from
            (select 1 from queue_private.ticket_events where event_type='SERVED' group by ticket_id having count(*)>1) x),
          'numbering_gaps',(select count(*) from
            (select 1 from queue_private.tickets group by queue_day_id,service_id having min(sequence_number)<>1 or max(sequence_number)<>count(*)) x),
          'open_days',(select count(*) from queue_private.queue_days where closed_at is null),
          'public_current_tickets',(select count(*) from queue_display.counter_state where ticket_label is not null));
        commit;"""
        result = subprocess.run([psql_executable, '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1'], input=audit,
                                cwd=root, env=env, capture_output=True, text=True, timeout=30)
        if result.returncode:
            raise SystemExit('Local postflight failed; raw output suppressed.')
        counts = json.loads(result.stdout.strip())
        print('Read-only postflight: ' + json.dumps(counts, sort_keys=True), flush=True)
        expected = {'active_tickets': 0, 'served_tickets': 4, 'forfeited_tickets': 8, 'skip_events': 1,
                    'duplicate_numbers': 0, 'quota_violations': 0, 'duplicate_serve_events': 0,
                    'numbering_gaps': 0, 'open_days': 0, 'public_current_tickets': 0}
        if counts != expected or state['accounts'] != 14 or state['tickets'] != 12 or state['days'] != 1:
            raise SystemExit('Unexpected postflight state; stop and investigate without resetting.')
        return
    if any(state[key] for key in ('accounts', 'tickets', 'days')):
        raise SystemExit('Existing accounts/tickets/days found. No tests run; data preserved.')
    if state['migrations'] != 6 or state['services'] != 5 or state['counters'] != 5:
        raise SystemExit('Unexpected migration/seed state. No tests run.')
    if args.preflight:
        return
    env = {k: v for k, v in env.items() if not k.upper().startswith('PG')}
    env['QUEUE_TEST_DATABASE_URL'] = url
    result = subprocess.run([sys.executable, str(root / 'supabase' / 'tests' / 'concurrency.py')],
                            cwd=root, env=env, timeout=180)
    raise SystemExit(result.returncode)


if __name__ == '__main__':
    main()
