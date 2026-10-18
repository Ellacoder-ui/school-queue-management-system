"""Verified local-only read-contract migration/test runner. Never reads dotenv.

--apply: apply only the expected fifth migration, without resets.
--validate: lint + the retained-fixture-safe pgTAP file (not legacy queue_test.sql).
--http: create new local Auth fixtures and run HTTP authorization tests.
All subprocess credentials stay in memory; database diagnostics are suppressed.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tomllib
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parents[2]
VERSION = '20261016000500'
ORIGINAL = {
    '20261016000100_queue_tables.sql': '274141dbab99dbaad959f2343633ee0bd440b240a29b5664ca304e283934d7d7',
    '20261016000200_queue_operations.sql': '65c943d4fea282c07e06bab6b759882f7fcec678ddf960869dd60a52db911883',
    '20261016000300_queue_administration.sql': '7a4ad627112f0bc3109417bec237b13000e1c06002d536f7c9feab5261eb4883',
    '20261016000400_queue_seed_security.sql': '95bd4918550dddae84672c148c6a616c9d12928b78097a82815a26a35146746e',
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--apply', action='store_true')
    mode.add_argument('--validate', action='store_true')
    mode.add_argument('--http', action='store_true')
    args = parser.parse_args()
    config = tomllib.loads((ROOT / 'supabase/config.toml').read_text(encoding='utf-8'))
    if (config['db']['port'] != 54322 or config['api']['port'] != 54321
            or 'queue_private' in config['api']['schemas']):
        raise SystemExit('Unexpected local configuration; stopped.')
    for name, expected in ORIGINAL.items():
        if hashlib.sha256((ROOT / 'supabase/migrations' / name).read_bytes()).hexdigest() != expected:
            raise SystemExit('An original migration differs; stopped.')
    env = {k: v for k, v in os.environ.items()
           if not k.upper().startswith(('PG', 'SUPABASE_', 'QUEUE_', 'VITE_'))}
    cli = ['node', str(ROOT / 'node_modules/supabase/dist/supabase.js')]
    status = subprocess.run(cli + ['status', '--output', 'json'], cwd=ROOT, env=env,
                            capture_output=True, text=True, timeout=60)
    if status.returncode:
        raise SystemExit('Local status unavailable; raw output suppressed.')
    try:
        local = json.loads(status.stdout)
        db, api = urlparse(local['DB_URL']), urlparse(local['API_URL'])
        assert db.scheme in ('postgres', 'postgresql') and db.hostname == '127.0.0.1'
        assert db.port == 54322 and db.username == 'postgres' and db.password
        assert db.path == '/postgres' and not db.query and not db.fragment
        assert api.scheme == 'http' and api.hostname == '127.0.0.1' and api.port == 54321
        assert api.path in ('', '/') and not api.query and not api.fragment
        assert not api.username and not api.password
    except (ValueError, AssertionError, KeyError, TypeError):
        raise SystemExit('Only exact local endpoints are permitted.') from None
    psql = shutil.which('psql') or r'C:\Program Files\PostgreSQL\18\bin\psql.exe'
    if not Path(psql).is_file():
        raise SystemExit('psql required; no software installed.')
    env.update(PGHOST='127.0.0.1', PGHOSTADDR='127.0.0.1', PGPORT='54322',
               PGDATABASE='postgres', PGUSER='postgres', PGPASSWORD=unquote(db.password),
               PGPASSFILE=os.devnull, PGCONNECT_TIMEOUT='5',
               PGOPTIONS='-c statement_timeout=15000 -c lock_timeout=10000')

    def sql(statement):
        result = subprocess.run([psql, '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1'],
                                input='begin read only; ' + statement + '; commit;',
                                env=env, cwd=ROOT, capture_output=True, text=True, timeout=30)
        if result.returncode:
            raise SystemExit('Read-only local verification failed; raw output suppressed.')
        return json.loads(result.stdout.strip().splitlines()[-1])

    tables = sql("select jsonb_agg(format('%I.%I',schemaname,tablename) order by schemaname,tablename) "
                 "from pg_tables where schemaname in ('queue_private','queue_display')")
    tables += ['auth.users', 'auth.identities']

    def fingerprint():
        # Hash inside PostgreSQL; no personal data, JWTs or password hashes logged.
        return {table: sql(f"select coalesce(jsonb_agg(md5(to_jsonb(t)::text) "
                           f"order by md5(to_jsonb(t)::text)),'[]') from {table} t")
                for table in tables}

    versions = sql('select jsonb_agg(version order by version) from supabase_migrations.schema_migrations')
    expected = [name.split('_')[0] for name in ORIGINAL]
    assert versions in (expected, expected + [VERSION]), 'Unexpected applied migration history'
    print('Verified PostgreSQL 127.0.0.1:54322; API http://127.0.0.1:54321.', flush=True)
    before = fingerprint()
    if args.apply:
        pending = sorted(p.name for p in (ROOT / 'supabase/migrations').glob('*.sql')
                         if p.name.split('_')[0] not in versions)
        if pending != [VERSION + '_queue_read_context.sql']:
            raise SystemExit('Expected exactly the new pending fifth migration; stopped.')
        command = cli + ['migration', 'up', '--local']
        result = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True, timeout=120)
        if result.returncode:
            raise SystemExit('Local migration failed; raw output suppressed. Inspect local state before retrying.')
        assert sql('select jsonb_agg(version order by version) from supabase_migrations.schema_migrations') == expected + [VERSION]
        print('Applied only 20261016000500_queue_read_context.sql to local migration history.', flush=True)
    elif args.validate:
        if versions != expected + [VERSION]:
            raise SystemExit('New migration must be applied locally first.')
        outputs = []
        for label, arguments in [
            ('Database lint', ['db', 'lint', '--local']),
            ('Read-context pgTAP', ['test', 'db', '--local', 'supabase/tests/database/read_context_test.sql']),
        ]:
            result = subprocess.run(cli + arguments, cwd=ROOT, env=env, capture_output=True,
                                    text=True, timeout=120)
            output = result.stdout + '\n' + result.stderr
            # TAP descriptions contain no fixture identities; retain only safe lines.
            safe = [line for line in output.splitlines()
                    if line.startswith(('ok ', 'not ok ', '1..', 'All tests successful', 'Files=', 'Result:', 'No schema errors'))
                    or 'Test Summary Report' in line]
            outputs.append({'check': label, 'exit_code': result.returncode, 'evidence': safe})
            print(label + ': ' + ('PASS' if result.returncode == 0 else 'FAIL'), flush=True)
            for line in safe:
                print(line, flush=True)
            if result.returncode:
                # Save sanitized outcome before stopping; never print SQL diagnostics.
                break
        out = ROOT / 'supabase/tests/results/read_context_database.json'
        out.parent.mkdir(exist_ok=True)
        out.write_text(json.dumps({'target': '127.0.0.1:54322', 'checks': outputs}, indent=2) + '\n', encoding='utf-8')
        if any(item['exit_code'] for item in outputs):
            assert fingerprint() == before, 'Existing fixtures changed during failed validation'
            raise SystemExit('Validation stopped; sanitized evidence saved.')
    else:
        if versions != expected + [VERSION]:
            raise SystemExit('New migration must be applied locally first.')
        env.update(QUEUE_E2E_API='http://127.0.0.1:54321', QUEUE_E2E_ANON_KEY=local['ANON_KEY'],
                   QUEUE_E2E_SERVICE_KEY=local['SERVICE_ROLE_KEY'], QUEUE_E2E_PSQL=psql)
        result = subprocess.run(['node', str(ROOT / 'supabase/tests/read_context_security.mjs')],
                                cwd=ROOT, env=env, timeout=180)
        # HTTP suite creates new rows; every old row must still be present unchanged.
        after = fingerprint()
        assert all(set(rows) <= set(after[t]) for t, rows in before.items()), 'Existing fixture changed'
        if result.returncode:
            raise SystemExit(result.returncode)
        print('All pre-existing private, display and Auth fixture rows preserved.', flush=True)
        return
    assert fingerprint() == before, 'Existing fixtures changed'
    print('All application/display/Auth rows unchanged; original migration hashes verified.', flush=True)


if __name__ == '__main__':
    main()
