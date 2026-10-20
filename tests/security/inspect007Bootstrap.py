"""Fixed READ ONLY local inventory and installed-read capture for 007 rehearsal."""
import hashlib
import json
from pathlib import Path
import sys
from datetime import datetime, timezone

import observeApprovedMfaCleanup as shared

ROOT=shared.ROOT
db=shared.db
need=shared.need
DIR=ROOT/'.local-browser/007-final-verification'
TARGET=shared.TARGET


def inspect():
    local,env,_=db.target()
    with db.Snapshot(env) as s:
        endpoint=s.query("select jsonb_build_object('cluster',(select system_identifier::text from pg_control_system()),'database',current_database(),'readOnly',current_setting('transaction_read_only')='on')")
        need(endpoint=={'cluster':'7696959712798593061','database':'postgres','readOnly':True},'LOCAL_TARGET')
        inventory=s.query(f"""select jsonb_build_object('counts',(select jsonb_object_agg(role,n) from (select role,count(*) n from queue_private.accounts group by role) x),
          'enabledAdmins',(select count(*) from queue_private.accounts where role='ADMIN' and enabled),
          'disabledAdmins',(select count(*) from queue_private.accounts where role='ADMIN' and not enabled),
          'privileged',(select jsonb_agg(jsonb_build_object('id',a.id,'email',u.email,'role',a.role,'enabled',a.enabled,
            'authExists',u.id is not null,'confirmed',u.email_confirmed_at is not null,'anonymous',u.is_anonymous,
            'identities',(select coalesce(jsonb_agg(jsonb_build_object('provider',provider,'verifiedEmail',identity_data->>'email_verified'='true',
              'matchingEmail',lower(identity_data->>'email')=lower(u.email)) order by provider),'[]') from auth.identities i where i.user_id=a.id),
            'googleCount',(select count(*) from auth.identities i where i.user_id=a.id and provider='google'),
            'factors',(select count(*) from auth.mfa_factors f where f.user_id=a.id),
            'verifiedTotp',(select count(*) from auth.mfa_factors f where f.user_id=a.id and status='verified' and factor_type='totp'),
            'aal2WithVerifiedTotp',(select count(*) from auth.sessions z join auth.mfa_factors f on z.factor_id=f.id and f.user_id=z.user_id where z.user_id=a.id and z.aal='aal2' and f.status='verified' and f.factor_type='totp'),
            'metadataKeys',(select coalesce(jsonb_agg(k order by k),'[]') from jsonb_object_keys(coalesce(u.raw_user_meta_data,'{{}}'::jsonb)) k),
            'counters',(select coalesce(jsonb_agg(c.number order by c.number),'[]') from queue_private.staff_counter_assignments x join queue_private.counters c on c.id=x.counter_id where x.account_id=a.id)) order by a.role,a.id)
            from queue_private.accounts a join auth.users u on u.id=a.id where a.role in ('ADMIN','CASHIER')),
          'ineligibleAssignments',(select coalesce(jsonb_agg(jsonb_build_object('idPrefix',left(a.id::text,8),'role',a.role,'enabled',a.enabled,'counter',c.number)),'[]') from queue_private.staff_counter_assignments x join queue_private.accounts a on a.id=x.account_id join queue_private.counters c on c.id=x.counter_id where a.role<>'CASHIER' or not a.enabled),
          'googleBinding',(select encode(sha256(convert_to(jsonb_build_object('user_id',u.id,'identity_id',i.id,'provider',i.provider,'provider_id',i.provider_id,'subject',i.identity_data->>'sub','email',lower(u.email),'identity_email',lower(i.identity_data->>'email'),'email_verified',i.identity_data->>'email_verified')::text,'UTF8')),'hex') from auth.users u join auth.identities i on i.user_id=u.id and i.provider='google' where u.id='{TARGET}' and u.email_confirmed_at is not null and u.is_anonymous is not true and i.provider_id=i.identity_data->>'sub' and lower(i.identity_data->>'email')=lower(u.email) and i.identity_data->>'email_verified'='true'),
          '007Absent',to_regclass('queue_private.staff_access_approvals') is null,
          '012Absent',not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='queue_api' and p.proname='add_verified_staff'))""")
        need(inventory['counts']=={'ADMIN':7,'CASHIER':5,'STUDENT':30} and inventory['enabledAdmins']==6 and inventory['disabledAdmins']==1,'COUNTS')
        personal=next(x for x in inventory['privileged'] if x['id']==TARGET)
        need(personal['email']=='ellasharmaineabeso2004@gmail.com' and personal['role']=='ADMIN' and personal['enabled'] and personal['googleCount']==personal['verifiedTotp']==personal['factors']==1 and personal['aal2WithVerifiedTotp']>=1 and inventory['googleBinding']==shared.GOOGLE_BINDING,'PERSONAL_BINDING')
        need(inventory['007Absent'] and inventory['012Absent'],'ALREADY_APPLIED')
        definitions=s.query("""select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'signature',pg_get_function_identity_arguments(p.oid),
          'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig,'bodySha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),
          'ddl',pg_get_functiondef(p.oid),'roles',(select jsonb_agg(coalesce(r.rolname,'public') order by coalesce(r.rolname,'public')) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x left join pg_roles r on r.oid=x.grantee where privilege_type='EXECUTE')) order by p.proname)
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='queue_api' and p.proname in ('admin_staff_accounts','resolve_staff_google','admin_payors','admin_payor_events','admin_staff_directory','request_staff_access')) or (n.nspname='queue_private' and p.proname='admin_google_binding_v10')""")
        need(len(definitions)==7 and all(x['owner']=='postgres' and x['definer'] and x['config']==['search_path=""'] for x in definitions),'READ_DEFINITIONS')
        names=s.query("select jsonb_agg(format('%I.%I',schemaname,tablename) order by schemaname,tablename) from pg_tables where schemaname in ('queue_private','queue_display')")
        names+=['auth.users','auth.identities','auth.mfa_factors','auth.mfa_challenges','auth.sessions','auth.refresh_tokens','auth.mfa_amr_claims','auth.audit_log_entries','auth.schema_migrations','supabase_migrations.schema_migrations']
        hashes=s.query('select jsonb_build_object('+','.join(f"'{name}',(select md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' order by md5(to_jsonb(x)::text)),'')) from {name} x)" for name in names)+')')
        security=shared.digest(db.legacy_security(env))
    flag=(ROOT/'src/lib/adminActivation.js').read_text()
    need('export const STAFF_ACTIVATION_RELEASED = false' in flag and 'STAFF_ACTIVATION_RELEASED = true' not in flag,'FRONTEND_RELEASED')
    return {'observedAt':datetime.now(timezone.utc).isoformat(),'endpoint':{'host':'127.0.0.1','port':54322,**endpoint},'inventory':inventory,'definitions':definitions,'hashes':hashes,'security':security,'services':shared.services(),'activationReleased':False}


if __name__=='__main__':
    try:
        close=sys.argv[1:]==['--closeout'];need(sys.argv[1:] in ([],['--closeout']),'ARGUMENTS')
        value=inspect()
        if not close:
            with (DIR/'retained-baseline.json').open('x') as output:json.dump(value,output)
            statements=[]
            for x in value['definitions']:
                sig=x['schema']+'.'+x['name']+'('+x['signature']+')'
                statements.extend([x['ddl'].rstrip()+';',f'revoke all on function {sig} from public,anon,authenticated,service_role;',f'alter function {sig} owner to postgres;'])
                if 'authenticated' in x['roles']:statements.append(f'grant execute on function {sig} to authenticated;')
            with (DIR/'installed-admin-reads.sql').open('x',encoding='utf-8') as output:output.write('\n'.join(statements))
        else:
            before=json.loads((DIR/'retained-baseline.json').read_text())
            need(value['hashes']==before['hashes'] and value['security']==before['security'] and value['inventory']==before['inventory'] and value['definitions']==before['definitions'],'RETAINED_SOURCE_CHANGE')
            need(all(x['id']==y['id'] and x['definition']==y['definition'] and ('vector' in x['name'] or x==y) for x,y in zip(value['services']['services'],before['services']['services'])),'RETAINED_SERVICE_CHANGE')
        out={'result':'PASS_READ_ONLY_CLOSEOUT' if close else 'PASS_READ_ONLY_BASELINE','observedAt':value['observedAt'],'endpoint':value['endpoint'],'inventory':value['inventory'],'activationReleased':False,
             'installedFunctions':[{k:v for k,v in x.items() if k!='ddl'} for x in value['definitions']], 'sourcePreserved':True if close else None,'retainedWrites':False}
        with (ROOT/'tests/integration/results'/('bootstrap007_retained_closeout.json' if close else 'bootstrap007_retained_baseline.json')).open('x') as output:json.dump(out,output,indent=2)
        print(json.dumps(out))
    except Exception:
        print(json.dumps({'result':'FAIL_STOPPED','detail':'Read-only bootstrap inspection rejected; private diagnostics suppressed'}));sys.exit(1)
