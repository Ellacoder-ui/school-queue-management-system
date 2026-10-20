"""Fixed preparation-only inspection; loopback PostgreSQL transactions are READ ONLY.

No factor ID, secret, token, private row or connection credential is emitted.
The factor's immutable ID is bound inside PostgreSQL and reported by hash/suffix.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'supabase/tests'))
import retained_migration_006 as db
sys.path.insert(0, str(ROOT / 'scripts'))
from auth_mfa_capability import auth_totp_enabled

TARGET = '5c96debb-697f-4cad-805f-92b518e28343'
EMAIL = 'ellasharmaineabeso2004@gmail.com'
DIRECTORY = ROOT / '.local-browser/mfa-cleanup-plan'
PHASE = 'initial'


def need(value, code):
    if not value:
        raise RuntimeError(code)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def inspect():
    global PHASE
    need(Path.cwd().resolve() == ROOT and str(ROOT).lower() == r'c:\users\hp\school-queue-management-system', 'WRONG_WORKSPACE')
    need(not any(os.environ.get(k) for k in ('DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH')), 'DOCKER_OVERRIDE')
    need(subprocess.check_output(['git', 'branch', '--show-current'], cwd=ROOT, text=True).strip() == 'backend', 'WRONG_BRANCH')
    # Existing target() validates config, CLI endpoints, published ports, network,
    # retained volume and original migration hashes. Credentials stay in memory.
    PHASE = 'loopback-target'
    local, env, identity = db.target()
    need(env['PGHOST'] == env['PGHOSTADDR'] == '127.0.0.1' and env['PGPORT'] == '54322' and
         env['PGDATABASE'] == 'postgres' and 'default_transaction_read_only=on' in env['PGOPTIONS'], 'ENDPOINT')
    PHASE = 'container-identity'
    rows = json.loads(db.call(['docker', 'inspect', 'supabase_db_school-queue-local', 'supabase_auth_school-queue-local'], label='Private identity read').stdout)
    need(all(x['State']['Running'] and x['State'].get('Health', {}).get('Status') == 'healthy' for x in rows), 'HEALTH')
    auth = rows[1]
    need(auth['Id'] == '5c57bce94c516ec320f259e94ebaf2d348598b6c26e7e2d979c719a8381992ae' and
         auth['Image'] == 'sha256:1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b' and
         list(auth['NetworkSettings']['Networks']) == ['supabase_network_school-queue-local'] and
         all(auth['Config']['Labels'].get(k) == 'school-queue-local' for k in ('com.supabase.cli.project', 'com.docker.compose.project')), 'AUTH_IDENTITY')
    settings = dict(v.split('=', 1) for v in auth['Config']['Env'])
    need(settings.get('GOTRUE_EXTERNAL_GOOGLE_ENABLED') == 'true' and auth_totp_enabled(), 'AUTH_FLAGS')
    with db.Snapshot(env) as s:
        PHASE = 'snapshot-endpoint'
        endpoint = s.query("select jsonb_build_object('database',current_database(),'cluster',(select system_identifier::text from pg_control_system()),'version',current_setting('server_version'),'readOnly',current_setting('transaction_read_only')='on','serverPort',inet_server_port())")
        need(endpoint == {'database': 'postgres', 'cluster': '7696959712798593061', 'version': '17.11', 'readOnly': True, 'serverPort': 5432}, 'CLUSTER')
        PHASE = 'account-binding'
        account = s.query(f"""select jsonb_build_object('id',u.id,'applicationId',a.id,'email',lower(u.email),
          'confirmed',u.email_confirmed_at is not null,'nonanonymous',not coalesce(u.is_anonymous,false),
          'role',a.role,'enabled',a.enabled,'googleIdentities',(select count(*) from auth.identities i where i.user_id=u.id and i.provider='google'),
          'googleVerified',(select bool_and(i.provider_id=i.identity_data->>'sub' and lower(i.identity_data->>'email')=lower(u.email) and i.identity_data->>'email_verified'='true') from auth.identities i where i.user_id=u.id and i.provider='google'),
          'binding',(select encode(sha256(convert_to(jsonb_build_object('user_id',u.id,'identity_id',i.id,'provider',i.provider,'provider_id',i.provider_id,'subject',i.identity_data->>'sub','email',lower(u.email),'identity_email',lower(i.identity_data->>'email'),'email_verified',i.identity_data->>'email_verified')::text,'UTF8')),'hex') from auth.identities i where i.user_id=u.id and i.provider='google'),
          'assignments',(select count(*) from queue_private.staff_counter_assignments x where x.account_id=u.id),
          'activeTickets',(select count(*) from queue_private.tickets t where t.owner_id=u.id and t.status in ('WAITING','CALLED')))
          from auth.users u join queue_private.accounts a on a.id=u.id where u.id='{TARGET}'""")
        need(account['id'] == account['applicationId'] == TARGET and account['email'] == EMAIL and
             account['role'] == 'ADMIN' and account['enabled'] and account['confirmed'] and account['nonanonymous'] and
             account['googleIdentities'] == 1 and account['googleVerified'] and
             account['binding'] == '0fa3fe400dbd117642d5cb7eb89bfed7471e6ef447e59bfc8ac8426001e39701' and
             account['assignments'] == account['activeTickets'] == 0, 'ACCOUNT_BINDING')
        PHASE = 'factor-binding'
        factors = s.query(f"""select jsonb_build_object('total',count(*),'verified',count(*) filter(where status='verified'),
          'unfinishedTotp',count(*) filter(where factor_type='totp' and status='unverified'),
          'inventory',coalesce(jsonb_agg(jsonb_build_object('suffix',right(id::text,8),'type',factor_type,'status',status,
            'createdAt',created_at,'updatedAt',updated_at,'ownerMatches',user_id='{TARGET}'::uuid,
            'bindingSha256',encode(sha256(convert_to(jsonb_build_object('user_id',user_id,'factor_id',id,'type',factor_type,'status',status,'created_at',created_at,'updated_at',updated_at)::text,'UTF8')),'hex'),
            'challenges',(select count(*) from auth.mfa_challenges c where c.factor_id=f.id),
            'associatedSessions',(select count(*) from auth.sessions z where z.factor_id=f.id)) order by id),'[]'))
          from auth.mfa_factors f where user_id='{TARGET}'""")
        need(factors['total'] == factors['unfinishedTotp'] == 1 and factors['verified'] == 0 and
             factors['inventory'][0]['ownerMatches'] and factors['inventory'][0]['associatedSessions'] == 0, 'FACTOR_SELECTION')
        PHASE = 'preservation-fingerprints'
        tables = s.query("select jsonb_agg(format('%I.%I',schemaname,tablename) order by schemaname,tablename) from pg_tables where schemaname in ('queue_private','queue_display')")
        tables += ['auth.users', 'auth.identities', 'auth.mfa_factors', 'auth.mfa_challenges', 'auth.sessions',
                   'auth.refresh_tokens', 'auth.mfa_amr_claims', 'auth.audit_log_entries', 'auth.schema_migrations', 'supabase_migrations.schema_migrations']
        # Only irreversibly reduced table fingerprints leave PostgreSQL.
        hashes = s.query('select jsonb_build_object(' + ','.join(
            f"'{t}',(select md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' order by md5(to_jsonb(x)::text)),'')) from {t} x)" for t in tables) + ')')
        functions = s.query("select to_jsonb(md5(string_agg(row(pg_get_functiondef(p.oid),p.proacl,p.proconfig,p.proowner)::text,'' order by p.oid))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('queue_api','queue_private','queue_display')")
        state = db.state(env, s.query)
        security = digest(db.legacy_security(env))
        unchanged_proposals = s.query("select jsonb_build_object('007Absent',to_regclass('queue_private.staff_access_approvals') is null,'012Absent',to_regprocedure('queue_api.add_verified_staff(uuid,text,text,text,uuid,uuid)') is null,'schoolStudent',(select role='STUDENT' and enabled from queue_private.accounts where id='b7d9aee8-c54d-455f-9913-a4c4dea0d097'),'challengeCascade',exists(select 1 from pg_constraint where conrelid='auth.mfa_challenges'::regclass and confrelid='auth.mfa_factors'::regclass and contype='f' and confdeltype='c'))")
        need(all(unchanged_proposals.values()) and state['routes'] == db.CANONICAL, 'SECURITY')
    PHASE = 'gateway-health'
    headers = {'apikey': local.get('PUBLISHABLE_KEY') or local['ANON_KEY']}
    health = {}
    for name, path in [('auth', '/auth/v1/health'), ('settings', '/auth/v1/settings'), ('api', '/rest/v1/counter_state?select=counter_label')]:
        request = Request('http://127.0.0.1:54321' + path, headers={**headers, **({'Accept-Profile': 'queue_display'} if name == 'api' else {})})
        with urlopen(request, timeout=10) as response:
            health[name] = response.status
            if name == 'settings':
                health['googleEnabled'] = json.load(response)['external']['google']
    need(all(health[k] == 200 for k in ('auth', 'settings', 'api')) and health['googleEnabled'], 'API_HEALTH')
    return {'observedAt': datetime.now(timezone.utc).isoformat(), 'result': 'PASS', 'readOnly': True,
            'endpoint': {'host': '127.0.0.1', 'port': 54322, 'project': 'school-queue-local', **endpoint},
            'databaseContainer': rows[0]['Id'], 'authContainer': auth['Id'], 'network': 'supabase_network_school-queue-local',
            'account': account, 'factors': factors, 'health': {**health, 'totpEnabled': True},
            'protectionState': unchanged_proposals, 'state': state, 'tableFingerprints': hashes,
            'functionsFingerprint': functions, 'securitySha256': security, 'realFactorOperation': False}


if __name__ == '__main__':
    try:
        need(sys.argv[1:] in ([], ['--closeout']), 'ARGUMENTS')
        close = bool(sys.argv[1:])
        report = inspect()
        if close:
            before = json.loads((DIRECTORY / 'baseline.json').read_text())
            report['preservedTables'] = report['tableFingerprints'] == before['tableFingerprints']
            report['preservedSecurityAndFunctions'] = all(report[k] == before[k] for k in ('functionsFingerprint', 'securitySha256', 'state', 'account', 'factors', 'endpoint', 'authContainer', 'databaseContainer', 'network'))
            need(report['preservedTables'] and report['preservedSecurityAndFunctions'], 'PRESERVATION')
        DIRECTORY.mkdir(parents=True, exist_ok=True)
        with (DIRECTORY / ('closeout.json' if close else 'baseline.json')).open('x') as output:
            json.dump(report, output, indent=2)
        with (ROOT / 'tests/integration/results' / ('unverified_mfa_closeout.json' if close else 'unverified_mfa_baseline.json')).open('x') as output:
            json.dump(report, output, indent=2)
        print(json.dumps(report))
    except Exception:
        print(json.dumps({'result': 'FAIL_STOPPED', 'phase': PHASE, 'detail': 'Fixed read-only MFA inspection rejected; private diagnostics suppressed.'}))
        sys.exit(1)
