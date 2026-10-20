"""READ ONLY observer for one owner-controlled, explicitly approved unenrollment.

There is deliberately no Auth mutation method. The full reviewed factor UUID is
recovered through PostgreSQL into process memory, never serialized or printed.
Commands on stdin: check, after, cancel. The owner alone operates the app UI.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone

import inspectUnverifiedMfa as inspection

ROOT = inspection.ROOT
TARGET = inspection.TARGET
FACTOR_BINDING = '6d4ce8ad136ebfd9fb70e659691764b77cdffbc8fe9b984e02ad3219e8987bf9'
GOOGLE_BINDING = '0fa3fe400dbd117642d5cb7eb89bfed7471e6ef447e59bfc8ac8426001e39701'
db = inspection.db
need = inspection.need
digest = inspection.digest
CURRENT_AUTH = '5c57bce94c516ec320f259e94ebaf2d348598b6c26e7e2d979c719a8381992ae'


def services():
    result = subprocess.run(['node', '--input-type=module', '-e',
        "import {QueueFixture} from './tests/integration/queueFixture.mjs'; const f=new QueueFixture(); try{console.log(JSON.stringify({services:await f.retained(),inventory:await f.inventory()}))}catch{process.exitCode=1}"],
        cwd=ROOT, capture_output=True, text=True, timeout=30)
    need(result.returncode == 0, 'SERVICE_FENCE')
    return json.loads(result.stdout)


def code_fence():
    expected = json.loads((ROOT / 'tests/integration/results/unverified_mfa_validation.json').read_text())['sourceHashes']
    need(all(hashlib.sha256((ROOT / p).read_bytes()).hexdigest() == h for p, h in expected.items()), 'REVIEWED_SOURCE_CHANGED')


def factor_expression(alias='f'):
    return f"encode(sha256(convert_to(jsonb_build_object('user_id',{alias}.user_id,'factor_id',{alias}.id,'type',{alias}.factor_type,'status',{alias}.status,'created_at',{alias}.created_at,'updated_at',{alias}.updated_at)::text,'UTF8')),'hex')"


def recover_factor():
    # Full UUID returned only to this process; safe receipts use the review hash.
    _, env, _ = db.target()
    with db.Snapshot(env) as s:
        value = s.query(f"select jsonb_build_object('id',id,'bound',{factor_expression()}='{FACTOR_BINDING}') from auth.mfa_factors f where user_id='{TARGET}'")
        need(value and value['bound'], 'FACTOR_REVIEW_BINDING')
        result = str(uuid.UUID(value['id']))
        need(result.endswith('c1fc9a6f'), 'FACTOR_REVIEW_SUFFIX')
        return result


def snapshot(factor_id):
    code_fence()
    local, env, _ = db.target()
    need(env['PGHOST'] == env['PGHOSTADDR'] == '127.0.0.1' and env['PGPORT'] == '54322' and env['PGDATABASE'] == 'postgres', 'ENDPOINT')
    with db.Snapshot(env) as s:
        cluster = s.query("select jsonb_build_object('cluster',(select system_identifier::text from pg_control_system()),'database',current_database(),'readOnly',current_setting('transaction_read_only')='on')")
        need(cluster == {'cluster':'7696959712798593061','database':'postgres','readOnly':True}, 'CLUSTER')
        factors = s.query(f"""select jsonb_build_object(
          'selectedPresent',exists(select 1 from auth.mfa_factors where id='{factor_id}'),
          'selectedStillExact',exists(select 1 from auth.mfa_factors f where f.id='{factor_id}' and f.user_id='{TARGET}' and {factor_expression()}='{FACTOR_BINDING}'),
          'ownerCount',(select count(*) from auth.mfa_factors where user_id='{TARGET}'),
          'ownerVerified',(select count(*) from auth.mfa_factors where user_id='{TARGET}' and status='verified'),
          'selectedChallenges',(select count(*) from auth.mfa_challenges where factor_id='{factor_id}'),
          'selectedSessions',(select count(*) from auth.sessions where factor_id='{factor_id}'),
          'otherFactorsHash',(select md5(coalesce(string_agg(to_jsonb(f)::text,'' order by id),'')) from auth.mfa_factors f where id<>'{factor_id}'),
          'allChallengesHash',(select md5(coalesce(string_agg(to_jsonb(c)::text,'' order by id),'')) from auth.mfa_challenges c))""")
        account = s.query(f"""select jsonb_build_object('userExists',true,'id',u.id,'applicationId',a.id,'email',lower(u.email),'role',a.role,'enabled',a.enabled,
          'nonanonymous',not coalesce(u.is_anonymous,false),'confirmed',u.email_confirmed_at is not null,
          'googleIdentities',(select count(*) from auth.identities where user_id=u.id and provider='google'),
          'googleBinding',(select encode(sha256(convert_to(jsonb_build_object('user_id',u.id,'identity_id',i.id,'provider',i.provider,'provider_id',i.provider_id,'subject',i.identity_data->>'sub','email',lower(u.email),'identity_email',lower(i.identity_data->>'email'),'email_verified',i.identity_data->>'email_verified')::text,'UTF8')),'hex') from auth.identities i where i.user_id=u.id and i.provider='google'),
          'userCount',(select count(*) from auth.users),'identityCount',(select count(*) from auth.identities))
          from auth.users u join queue_private.accounts a on a.id=u.id where u.id='{TARGET}'""")
        need(account and account['id'] == account['applicationId'] == TARGET and account['role'] == 'ADMIN' and account['enabled'] and account['confirmed'] and account['nonanonymous'] and
             account['email'] == inspection.EMAIL and account['googleIdentities'] == 1 and account['googleBinding'] == GOOGLE_BINDING, 'OWNER_IDENTITY')
        tables = s.query("select jsonb_agg(format('%I.%I',schemaname,tablename) order by schemaname,tablename) from pg_tables where schemaname in ('queue_private','queue_display')")
        tables += ['auth.users','auth.identities','auth.sessions','auth.refresh_tokens','auth.mfa_amr_claims','auth.schema_migrations','supabase_migrations.schema_migrations']
        hashes = s.query('select jsonb_build_object(' + ','.join(
            f"'{t}',(select md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' order by md5(to_jsonb(x)::text)),'')) from {t} x)" for t in tables) + ')')
        protected = s.query(f"""select jsonb_build_object(
          'unrelatedUsers',(select md5(coalesce(string_agg(to_jsonb(u)::text,'' order by id),'')) from auth.users u where id<>'{TARGET}'),
          'unrelatedIdentities',(select md5(coalesce(string_agg(to_jsonb(i)::text,'' order by id),'')) from auth.identities i where user_id<>'{TARGET}'),
          'targetUserExceptSignInTimes',(select md5((to_jsonb(u)-'last_sign_in_at'-'updated_at')::text) from auth.users u where id='{TARGET}'),
          'targetIdentitiesExceptSignInTimes',(select md5(string_agg((to_jsonb(i)-'last_sign_in_at'-'updated_at')::text,'' order by id)) from auth.identities i where user_id='{TARGET}'),
          'unrelatedSessions',(select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) from auth.sessions x where user_id<>'{TARGET}'),
          'unrelatedRefresh',(select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) from auth.refresh_tokens x where user_id::text<>'{TARGET}'),
          'unrelatedAmr',(select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by x.id),'')) from auth.mfa_amr_claims x join auth.sessions z on z.id=x.session_id where z.user_id<>'{TARGET}'))""")
        # Audit payload remains in PostgreSQL. Only row hashes/category/target bool
        # are retained in private review memory and reduced before public output.
        audits = s.query(f"""select coalesce(jsonb_object_agg(id::text,jsonb_build_object('hash',md5(to_jsonb(x)::text),
          'target',payload::jsonb->>'actor_id'='{TARGET}','action',payload::jsonb->>'action')),'{{}}') from auth.audit_log_entries x""")
        security = digest(db.legacy_security(env))
        state = db.state(env, s.query)
        need(s.query("select to_jsonb(to_regclass('queue_private.staff_access_approvals') is null and to_regprocedure('queue_api.add_verified_staff(uuid,text,text,text,uuid,uuid)') is null)"), 'PROPOSALS_CHANGED')
    service = services()
    need(any(x['name']=='/supabase_auth_school-queue-local' and x['id']==CURRENT_AUTH and x['running'] for x in service['services']), 'AUTH_IDENTITY')
    flags = subprocess.run(['python','-B','-c','from scripts.auth_mfa_capability import auth_totp_enabled; print(auth_totp_enabled())'], cwd=ROOT,capture_output=True,text=True,timeout=25)
    need(flags.returncode==0 and flags.stdout.strip()=='True', 'AUTH_CAPABILITY')
    from urllib.request import Request, urlopen
    health = {}
    for name,path in [('auth','/auth/v1/health'),('settings','/auth/v1/settings'),('api','/rest/v1/counter_state?select=counter_label')]:
        with urlopen(Request('http://127.0.0.1:54321'+path,headers={'apikey':local.get('PUBLISHABLE_KEY') or local['ANON_KEY'],**({'Accept-Profile':'queue_display'} if name=='api' else {})}),timeout=10) as response:
            health[name]=response.status
            if name=='settings': health['googleEnabled']=json.load(response)['external']['google']
    need(all(health[k]==200 for k in ('auth','settings','api')) and health['googleEnabled'], 'AUTH_API_HEALTH')
    return {'observedAt':datetime.now(timezone.utc).isoformat(),'factors':factors,'account':account,'hashes':hashes,'protected':protected,'audits':audits,'security':security,'state':state,'service':service,'health':health}


def public_receipt(value, baseline=None):
    out={'observedAt':value['observedAt'],'readOnly':True,'ownerUuid':TARGET,'factorSuffix':'c1fc9a6f','factorBindingSha256':FACTOR_BINDING,
         'endpoint':{'host':'127.0.0.1','port':54322,'database':'postgres','cluster':'7696959712798593061','project':'school-queue-local'},
         'factor':{k:v for k,v in value['factors'].items() if not k.endswith('Hash')},'account':value['account'],'health':value['health'],
         'authMutationIssuedByObserver':False}
    if baseline is not None:
        out['applicationTablesPreserved']=all(h==value['hashes'].get(k) for k,h in baseline['hashes'].items() if k.startswith('queue_'))
        out['migrationsPreserved']=all(value['hashes'][k]==baseline['hashes'][k] for k in ('auth.schema_migrations','supabase_migrations.schema_migrations'))
        out['securityPreserved']=value['security']==baseline['security']
        out['accountAndGoogleBindingPreserved']=value['account']==baseline['account']
        out['unrelatedAuthAndProtectedFieldsPreserved']=value['protected']==baseline['protected']
        out['otherFactorsPreserved']=value['factors']['otherFactorsHash']==baseline['factors']['otherFactorsHash']
        out['challengesPreserved']=value['factors']['allChallengesHash']==baseline['factors']['allChallengesHash']
        a,b=baseline['service'],value['service']
        out['resourcesPreserved']=a['inventory']==b['inventory']
        out['servicesPreserved']=len(a['services'])==len(b['services']) and all(x['id']==y['id'] and x['definition']==y['definition'] and ('vector' in x['name'] or x==y) for x,y in zip(a['services'],b['services']))
        out['existingAuditRowsPreserved']=all(value['audits'].get(k)==v for k,v in baseline['audits'].items())
        added=[v for k,v in value['audits'].items() if k not in baseline['audits']]
        out['newAuditCount']=len(added)
        out['newAuditCategories']=sorted({x['action'] for x in added if isinstance(x['action'],str)})
        out['newAuditsBoundToOwner']=all(x['target'] for x in added)
        out['changedAuthTableFingerprints']=[k for k in value['hashes'] if k.startswith('auth.') and value['hashes'][k]!=baseline['hashes'][k]]
        out['preservationPass']=all(out[k] for k in ('applicationTablesPreserved','migrationsPreserved','securityPreserved','accountAndGoogleBindingPreserved','unrelatedAuthAndProtectedFieldsPreserved','otherFactorsPreserved','challengesPreserved','resourcesPreserved','servicesPreserved','existingAuditRowsPreserved','newAuditsBoundToOwner'))
    return out


def main():
    need(sys.argv[1:] in ([], ['--serve-files']), 'OBSERVER_ARGUMENTS')
    run=uuid.uuid4().hex[:8]
    directory=ROOT/'.local-browser/mfa-cleanup-execution'/run
    directory.mkdir(parents=True,exist_ok=False)
    code_fence()
    initial=inspection.inspect()
    f=initial['factors']['inventory'][0]
    need(f['bindingSha256']==FACTOR_BINDING and f['challenges']==f['associatedSessions']==0, 'APPROVED_FACTOR')
    factor_id=recover_factor()
    baseline=snapshot(factor_id)
    need(baseline['factors']['selectedStillExact'] and baseline['factors']['ownerCount']==1 and baseline['factors']['ownerVerified']==baseline['factors']['selectedChallenges']==baseline['factors']['selectedSessions']==0,'PREFLIGHT')
    # Freeze only file digests; the private full factor ID stays in this process.
    names=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=ROOT).decode().split('\0')
    files={p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in set(names) if p and (ROOT/p).is_file()}
    with (directory/'inputs.json').open('x') as output:json.dump(files,output)
    def emit(label,value):
        value={'run':run,'result':label,**value}
        with (ROOT/'tests/integration/results'/f'approved_mfa_cleanup_{run}_{label.lower()}.json').open('x') as output:json.dump(value,output,indent=2)
        print(json.dumps(value),flush=True)
    emit('PREFLIGHT_PASS_WAITING_FOR_OWNER',public_receipt(baseline))
    def commands():
        if '--serve-files' not in sys.argv:
            yield from sys.stdin
            return
        # Some Windows execution hosts provide no interactive stdin. Only fixed
        # read-only commands are accepted; the selected factor ID stays in memory.
        deadline=time.monotonic()+1800
        for number in range(1,5):
            path=directory/f'command-{number}.txt'
            while not path.exists():
                need(time.monotonic()<deadline, 'OBSERVER_WINDOW_EXPIRED')
                time.sleep(0.25)
            yield path.read_text(encoding='utf-8')
    for command in commands():
        command=command.strip()
        if command=='cancel':
            emit('CANCELLED_NO_OBSERVER_MUTATION',{'observedAt':datetime.now(timezone.utc).isoformat(),'authMutationIssuedByObserver':False});return
        need(command in ('check','after'),'OBSERVER_COMMAND')
        current=snapshot(factor_id);out=public_receipt(current,baseline)
        out['allExistingInputsUnchanged']=all((ROOT/p).is_file() and hashlib.sha256((ROOT/p).read_bytes()).hexdigest()==h for p,h in files.items())
        need(out['allExistingInputsUnchanged'] and out['preservationPass'],'PRESERVATION')
        if command=='check':
            need(current['factors']['selectedStillExact'] and current['factors']['ownerCount']==1 and current['factors']['ownerVerified']==current['factors']['selectedChallenges']==current['factors']['selectedSessions']==0,'PREACTION_CHANGED')
            emit('FRESH_CHECK_PASS',out)
        else:
            absent=not current['factors']['selectedPresent'] and current['factors']['ownerCount']==current['factors']['ownerVerified']==0
            emit('ABSENCE_VERIFIED' if absent else 'STILL_PRESENT_STOP_NO_RETRY',out)
            return
    # EOF never executes an action or assumes the owner completed cleanup.
    print(json.dumps({'run':run,'result':'OBSERVER_CLOSED_NO_CLEANUP_CLAIM','authMutationIssuedByObserver':False}),flush=True)


if __name__=='__main__':
    try:main()
    except Exception:
        print(json.dumps({'result':'FAIL_STOPPED','phase':inspection.PHASE,'detail':'Read-only approved-cleanup observer stopped; private diagnostics suppressed.','authMutationIssuedByObserver':False}),flush=True)
        sys.exit(1)
