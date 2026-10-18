"""Integration tests: disposable local Supabase only; requires psql on PATH.

Uses committed, uniquely named fixtures; never deletes records or resets a database.
Run once on a fresh isolated local database after migrations and before opening a day.
"""
import concurrent.futures
import json
import os
import re
import shutil
import subprocess
import unittest
import uuid
from urllib.parse import unquote, urlparse

URL = os.environ.get('QUEUE_TEST_DATABASE_URL', '')
parsed = urlparse(URL)
isolated_project = os.environ.get('QUEUE_ISOLATED_PROJECT_ID', '')
isolated_match = re.fullmatch(r'sq-routing-(fresh|upgrade)-[0-9a-f]{8}', isolated_project)
expected_port = {'fresh': 56322, 'upgrade': 55322}.get(isolated_match.group(1)) if isolated_match else 54322
if isolated_project and not isolated_match:
    raise SystemExit('Unrecognized isolated project identity.')
if (parsed.scheme not in ('postgres', 'postgresql') or parsed.query or parsed.fragment
        or parsed.hostname != '127.0.0.1' or parsed.port != expected_port
        or parsed.username != 'postgres' or parsed.path != '/postgres' or not parsed.password):
    raise SystemExit('Use a local postgres database URL at 127.0.0.1:54322, with explicit local credentials.')
if not shutil.which('psql'):
    raise SystemExit('psql is required; no tests executed.')


class DatabaseRejected(RuntimeError):
    def __init__(self, sqlstate, message):
        self.sqlstate = sqlstate
        self.message = message
        super().__init__('Database rejected operation [%s]: %s' % (sqlstate, message))


def sql(statement, actor=None):
    prefix = 'begin; '
    if actor:
        prefix += "select set_config('request.jwt.claim.sub','%s',true); set local role authenticated; " % actor
    # Inherited libpq settings (especially PGHOSTADDR/PGSERVICE) must not redirect
    # a validated URL or read an unrelated credential file.
    env = {k: v for k, v in os.environ.items() if not k.upper().startswith('PG')}
    # Keep connection credentials out of command-line arguments and error output.
    env['PGDATABASE'] = 'postgres'
    env['PGHOST'] = '127.0.0.1'
    env['PGPORT'] = str(expected_port)
    env['PGUSER'] = 'postgres'
    env['PGPASSWORD'] = unquote(parsed.password)
    env['PGHOSTADDR'] = '127.0.0.1'
    env['PGPASSFILE'] = os.devnull
    env['PGCONNECT_TIMEOUT'] = '5'
    env['PGOPTIONS'] = '-c statement_timeout=15000 -c lock_timeout=10000'
    result = subprocess.run(['psql', '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'],
                            input=prefix + statement + '; commit;', text=True,
                            capture_output=True, env=env, timeout=30)
    if result.returncode:
        # Extract only the server error line; never print connection diagnostics,
        # connection URLs, SQL context, environment contents, or CLI credentials.
        match = re.search(r'ERROR:\s+([0-9A-Z]{5}):\s*([^\r\n]*)', result.stderr)
        if match:
            raise DatabaseRejected(match[1], match[2])
        raise RuntimeError('Local psql operation failed before a PostgreSQL error was available')
    return result.stdout.strip().splitlines()[-1] if result.stdout.strip() else ''


class QueueConcurrency(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        state = json.loads(sql("select json_build_object('accounts',(select count(*) from queue_private.accounts),"
                               "'tickets',(select count(*) from queue_private.tickets),"
                               "'days',(select count(*) from queue_private.queue_days))"))
        if any(state.values()):
            raise RuntimeError('Fresh disposable local database required; existing accounts/tickets/days preserved')
        cls.admin, cls.cashier, cls.student, cls.cashier2 = [str(uuid.uuid4()) for _ in range(4)]
        users = ','.join("('%s','%s@example.invalid',clock_timestamp())" % (x, x)
                         for x in (cls.admin, cls.cashier, cls.student, cls.cashier2))
        sql('insert into auth.users(id,email,email_confirmed_at) values ' + users)
        sql("update queue_private.accounts set role='ADMIN' where id='%s'; " % cls.admin +
            "update queue_private.accounts set role='CASHIER' where id in ('%s','%s')" % (cls.cashier, cls.cashier2))
        cls.counters = json.loads(sql("select json_agg(id order by number) from queue_private.counters"))
        for counter, service in zip(cls.counters[:2], ('TP','SOA')):
            sql("select queue_api.configure_counter('%s',true,array['%s'],array['%s'::uuid,'%s'::uuid],'%s')" %
                (counter, service, cls.cashier, cls.cashier2, uuid.uuid4()), cls.admin)
        sql("select queue_api.manage_day('OPEN',(clock_timestamp() at time zone 'Asia/Manila')::date,'%s')" % uuid.uuid4(), cls.admin)

    def parallel(self, calls, expected_error=None):
        def run(call):
            try:
                return sql(*call)
            except DatabaseRejected as error:
                if expected_error and error.sqlstate == expected_error[0] and expected_error[1] in error.message:
                    return None
                raise
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            return list(pool.map(run, calls))

    def test_01_duplicate_issue_and_quota(self):
        key = uuid.uuid4()
        statement = "select queue_api.issue_ticket('TP','%s')" % key
        outputs = self.parallel([(statement, self.student)] * 8)
        self.assertTrue(all(outputs))
        self.assertEqual(len(set(outputs)), 1, 'same request must return identical result')
        ticket = json.loads(outputs[0])['ticket_id']
        denied = self.parallel([("select queue_api.issue_ticket('SOA','%s')" % uuid.uuid4(), self.student)] * 4,
                               ('P0001', 'Active ticket already exists'))
        self.assertEqual(denied, [None] * 4)
        with self.assertRaises(DatabaseRejected) as mismatch:
            sql("select queue_api.issue_ticket('SOA','%s')" % key, self.student)
        self.assertEqual(mismatch.exception.sqlstate, '22023')
        self.assertIn('Request key reused with different parameters', mismatch.exception.message)
        calls = [("select queue_api.call_next('%s','TP','%s')" % (self.counters[0], uuid.uuid4()), actor)
                 for actor in (self.cashier, self.cashier2)]
        outputs = self.parallel(calls, ('P0001','Counter busy'))
        self.assertEqual(outputs.count(None), 1, 'one competing cashier must encounter the busy counter')
        claimed = [json.loads(x)['ticket_id'] for x in outputs if x is not None]
        self.assertEqual(claimed.count(ticket), 1)
        key = uuid.uuid4()
        served = self.parallel([("select queue_api.finish_ticket('%s','SERVE','%s')" % (ticket, key), self.cashier)] * 8)
        self.assertTrue(all(served))
        self.assertEqual(len(set(served)), 1)
        ticket2 = json.loads(sql("select queue_api.issue_ticket('TP','%s')" % uuid.uuid4(), self.student))['ticket_id']
        sql("select queue_api.call_next('%s','TP','%s')" % (self.counters[0], uuid.uuid4()), self.cashier)
        completions = self.parallel([("select queue_api.finish_ticket('%s','SERVE','%s')" % (ticket2, uuid.uuid4()), self.cashier)
                                     for _ in range(8)], ('42501', 'Ticket not called at an assigned counter'))
        self.assertEqual(sum(x is not None for x in completions), 1, 'distinct requests cannot serve twice')
        results = self.parallel([("select queue_api.issue_ticket('TP','%s')" % uuid.uuid4(), self.student)] * 8,
                                ('P0001', 'Daily served-ticket limit reached'))
        self.assertEqual(results, [None] * 8)
        self.assertEqual(sql("select count(*) from queue_private.tickets where owner_id='%s' and status='SERVED'" % self.student), '2')

    def test_01b_concurrent_skip_and_tail_order(self):
        users = [str(uuid.uuid4()) for _ in range(2)]
        sql('insert into auth.users(id,email,email_confirmed_at) values ' + ','.join(
            "('%s','%s@example.invalid',clock_timestamp())" % (x, x) for x in users))
        tickets = [json.loads(sql("select queue_api.issue_ticket('TP','%s')" % uuid.uuid4(), x)) for x in users]
        first, second = [x['ticket_id'] for x in tickets]
        claimed = json.loads(sql("select queue_api.call_next('%s','TP','%s')" % (self.counters[0], uuid.uuid4()), self.cashier))
        self.assertEqual(claimed['ticket_id'], first)
        key = uuid.uuid4()
        skips = self.parallel([("select queue_api.finish_ticket('%s','SKIP','%s')" % (first, key), self.cashier)] * 8)
        self.assertTrue(all(skips))
        self.assertEqual(len(set(skips)), 1)
        self.assertEqual(sql("select sequence_number from queue_private.tickets where id='%s'" % first), str(tickets[0]['sequence_number']))
        self.assertEqual(sql("select count(*) from queue_private.ticket_events where ticket_id='%s' and event_type='SKIPPED'" % first), '1')
        self.assertEqual(sql("select count(*) from queue_private.tickets where owner_id='%s' and status='SERVED'" % users[0]), '0')
        self.assertEqual(sql("select (a.wait_position > b.wait_position)::text from queue_private.tickets a,queue_private.tickets b where a.id='%s' and b.id='%s'" % (first, second)), 'true')
        next_ticket = json.loads(sql("select queue_api.call_next('%s','TP','%s')" % (self.counters[0], uuid.uuid4()), self.cashier))
        self.assertEqual(next_ticket['ticket_id'], second)
        sql("select queue_api.finish_ticket('%s','SERVE','%s')" % (second, uuid.uuid4()), self.cashier)
        recalled = json.loads(sql("select queue_api.call_next('%s','TP','%s')" % (self.counters[0], uuid.uuid4()), self.cashier))
        self.assertEqual(recalled['ticket_id'], first)
        sql("select queue_api.finish_ticket('%s','SERVE','%s')" % (first, uuid.uuid4()), self.cashier)
        self.assertEqual(sql("select count(*) from queue_private.tickets where owner_id='%s' and status='SERVED'" % users[0]), '1')

    def test_02_parallel_numbering_and_closure(self):
        users = [str(uuid.uuid4()) for _ in range(8)]
        sql('insert into auth.users(id,email,email_confirmed_at) values ' + ','.join(
            "('%s','%s@example.invalid',clock_timestamp())" % (x, x) for x in users))
        results = self.parallel([("select queue_api.issue_ticket('SOA','%s')" % uuid.uuid4(), x) for x in users])
        self.assertTrue(all(results))
        numbers = sorted(json.loads(x)['sequence_number'] for x in results)
        self.assertEqual(numbers, list(range(1, 9)))
        # Competing closure and call: closure must leave no active tickets regardless of order.
        self.parallel([
            ("select queue_api.manage_day('CLOSE',(clock_timestamp() at time zone 'Asia/Manila')::date,'%s')" % uuid.uuid4(), self.admin),
            ("select queue_api.call_next('%s','SOA','%s')" % (self.counters[1], uuid.uuid4()), self.cashier)])
        self.assertEqual(sql("select count(*) from queue_private.tickets where status in ('WAITING','CALLED')"), '0')


if __name__ == '__main__':
    unittest.main(failfast=True, verbosity=2)
