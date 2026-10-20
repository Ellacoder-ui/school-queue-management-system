"""Fixed read-only personal ADMIN preflight. No factor, role or service write.

Runtime definitions and database settings travel only through protected IPC/storage.
The public receipt contains verified identity facts, counts and hashes, never tokens.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from datetime import datetime, timezone
from uuid import uuid4
import auth_only_guard as g
import auth_mfa_guard as mf
from inspect_personal_admin import SQL

ROOT = Path(__file__).resolve().parents[1]
PERSONAL = '5c96debb-697f-4cad-805f-92b518e28343'
SCHOOL = 'b7d9aee8-c54d-455f-9913-a4c4dea0d097'
EXPECTED = {
    PERSONAL: ('ellasharmaineabeso2004@gmail.com', '0fa3fe400dbd117642d5cb7eb89bfed7471e6ef447e59bfc8ac8426001e39701'),
    SCHOOL: ('eabeso63122@liceo.edu.ph', '7b236769634b0910b034c035cc1422021f2281be9d6fd77d5c882ffd9ed86bbd')}
AUTH = '5c57bce94c516ec320f259e94ebaf2d348598b6c26e7e2d979c719a8381992ae'
PARKED = {
    '565adceacab15cd43c7e00d5cee19345bc34f6ab981b35d5dc2ba4f8cdd4f399': '/supabase_auth_school-queue-local-9169970e-activation-mfa-original',
    '9f7742bf04e680d82988376411720e3500c9c0c069b0e57de5b7f3dc3ebb4ef6': '/supabase_auth_school-queue-local-e17c030c-activation-original'}


def storage(operation, run, payload=None):
    request = dict(operation=operation, runId=run, profile='retained-capture', slot='personal-admin-baseline')
    if payload is not None:
        request['payload'] = json.dumps(payload, separators=(',', ':'))
    result = subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        str(ROOT / 'scripts/AuthOnlyStorage.ps1')], input=json.dumps(request), capture_output=True,
        text=True, timeout=40)
    g.need(result.returncode == 0, 'PAL_PRIVATE_STORAGE')
    answer = json.loads(result.stdout)
    g.need(answer['result'] == 'PASS', 'PAL_PRIVATE_STORAGE')
    return answer


def main():
    g.need(Path.cwd() == ROOT and not sys.stdout.isatty(), 'PAL_WORKSPACE_IPC')
    now = g.capture()
    g.need(len(now['items']) == 14 and len({x['Id'] for x in now['items']}) == 14, 'PAL_PROJECT_INVENTORY')
    auth = next(x for x in now['items'] if x['Name'] == g.AUTH)
    g.need(auth['Id'] == AUTH, 'PAL_AUTH_CHANGED')
    for identifier, name in PARKED.items():
        item = next(x for x in now['items'] if x['Id'] == identifier)
        g.need(item['Name'] == name and not item['State']['Running'] and not item['NetworkSettings']['Networks'], 'PAL_PARKED_CHANGED')
    mf.flags(now, True)
    g.health_check(now, True)
    source = g.decode_source(now['sourceSnapshot'])
    g.need(source['state']['versions'] == ['20261016000' + str(n) + '00' for n in range(1, 7)] and
           source['state']['routes'] == g.m.backup.CANONICAL, 'PAL_ROUTING_MIGRATIONS')
    env = {**g.m.backup.clean_env(), **now['connection']['env']}
    with g.m.backup.Snapshot(env) as s:
        accounts = s.query(SQL)
        staff = s.query("""select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'role',a.role,'enabled',a.enabled,
          'verified_factors',(select count(*) from auth.mfa_factors f where f.user_id=a.id and status='verified'),
          'assignments',(select count(*) from queue_private.staff_counter_assignments x where x.account_id=a.id)) order by a.id),'[]')
          from queue_private.accounts a where role in ('ADMIN','CASHIER')""")
        migration_absent = s.query("select to_jsonb(to_regclass('queue_private.staff_access_approvals') is null)")
        session_columns = s.query("select jsonb_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='auth' and table_name='sessions'")
        amr_columns = s.query("select jsonb_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='auth' and table_name='mfa_amr_claims'")
    g.need(len(accounts) == 2 and migration_absent, 'PAL_ACCOUNTS_OR_MIGRATION_CHANGED')
    for row in accounts:
        g.need(row['auth_id'] in EXPECTED and (row['email'], row['binding']) == EXPECTED[row['auth_id']] and
               row['auth_id'] == row['account_id'] and row['role'] == 'STUDENT' and row['enabled'] and
               row['email_confirmed'] and row['not_anonymous'] and row['google_count'] == 1 and
               row['assignments'] == row['active_tickets'] == 0, 'PAL_IDENTITY_AUTHORIZATION_CHANGED')
    after = g.capture(now['connection'])
    g.compare(now, after, 'before', None)
    run = uuid4().hex[:8]
    storage('seal', run, now)
    reopened = json.loads(storage('open', run)['payload'])
    g.need(reopened == now, 'PAL_CAPTURE_READBACK')
    proposal = ROOT / 'supabase/20261019000700_staff_security.PROPOSED.sql'
    proposal_hash = hashlib.sha256(proposal.read_bytes()).hexdigest()
    g.need(proposal_hash == 'b22d63d24c991b9ebf0d380d27a716d5ea72e418f5e62e177c96dded4481222c', 'PAL_PROPOSAL_CHANGED')
    report = dict(result='PASS_READ_ONLY_PREFLIGHT', run=run, observedAt=datetime.now(timezone.utc).isoformat(),
        authId=AUTH, http=dict(auth=200, settings=200, anonymous_api=200), google=True, totp=True,
        accounts=accounts, existingStaff=staff, securityMigrationUnapplied=migration_absent,
        proposalSha256=proposal_hash, counts={name: row['count'] for name, row in source['rows'].items()},
        withinRunPreservation=True, migrations=source['state']['versions'], routes=source['state']['routes'],
        backups=now['backupTree'], sessionColumns=session_columns, amrColumns=amr_columns,
        protectedCapture=f'.local-auth-only/{run}/personal-admin-baseline/payload.dpapi')
    path = ROOT / f'supabase/tests/results/personal_admin_live_{run}_preflight.json'
    with path.open('x', encoding='utf-8') as f:
        json.dump(report, f, indent=2)
    print(json.dumps(report))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = str(error) if re.fullmatch(r'(PAL|AGO|AMF)_[A-Z_]+', str(error)) else 'PAL_READ_ONLY_STOPPED'
        print(json.dumps(dict(result='FAIL_STOPPED', code=code)))
        sys.exit(1)
