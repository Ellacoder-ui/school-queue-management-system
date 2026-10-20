// Complete 007 + ONE approval, tested only on immutable-ID owned fixture resources.
import {readFileSync,writeFileSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {QueueFixture,availableFixtureRun,need,digest,preservationQuery,delay} from './queueFixture.mjs'
import {bootstrap007,migrationBody,statements,reviewed007} from '../security/bootstrap007Plan.mjs'
const f=new QueueFixture(availableFixtureRun()),report={run:f.run,checks:[],retainedWrites:false,syntheticContexts:true}
const path=`tests/integration/results/bootstrap007_final_${f.run}.json`
const bytes=readFileSync('supabase/20261019000700_staff_security.PROPOSED.sql'),installed=readFileSync('.local-browser/007-final-verification/installed-admin-reads.sql','utf8')
let services,source,extra,inventory,cluster,hash,baseline,mode=process.argv[2]||'atomic'
const q=x=>"'"+String(x).replaceAll("'","''")+"'"
const wrappers=['admin_configuration','set_account','configure_counter','configure_service','manage_day','call_next','finish_ticket','staff_queue']
const adminReads=[['admin_staff_accounts',{}],['resolve_staff_google',{p_email:'student@example.invalid'}],['admin_payors',{}],['admin_payor_events',{p_ticket:null}]]
const stateSql="select jsonb_build_object('tables',(select jsonb_agg(row(schemaname,tablename)::text order by schemaname,tablename) from pg_tables where schemaname in ('queue_private','queue_display')),'functions',(select md5(string_agg(row(p.oid,pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig)::text,'' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('queue_private','queue_api','queue_display')),'rows',(select md5(string_agg(row(name,hash)::text,'' order by name)) from (values ('accounts',(select md5(string_agg(to_jsonb(x)::text,'' order by id)) from queue_private.accounts x)),('assignments',(select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by account_id,counter_id),'')) from queue_private.staff_counter_assignments x)),('audit',(select md5(string_agg(to_jsonb(x)::text,'' order by id)) from queue_private.admin_audit_events x))) x(name,hash)))"
const fingerprint=async()=>JSON.parse((await f.sql(stateSql)).trim())
const rpc=async(actor,name,args={},aal='aal2')=>{const r=await f.request('/rpc/'+name,{name:actor,body:args,token:f.token(actor,'authenticated',aal)});return{http:r.status,body:await r.json()}}
const denied=x=>need(x.http>=400&&x.body.code==='42501','B007_DENIAL')
const test=async(name,fn)=>{try{await fn();report.checks.push({name,result:'PASS'});console.log('PASS: '+name)}catch(e){report.checks.push({name,result:'FAIL'});throw e}}
async function rejectedTransaction(sql,expected){
 await f.inspect(f.db)
 const r=spawnSync('docker',['exec','-i','--user','postgres',f.db,'psql','-X','-w','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h','/tmp','-U','postgres','-d','postgres'],{input:sql,encoding:'utf8',timeout:40000,windowsHide:true})
 const states=[...(r.stderr||'').matchAll(/(?:ERROR|FATAL):\s+([A-Z0-9]{5}):/g)].map(x=>x[1])
 need(r.status!==0&&states.includes(expected),'B007_WRONG_SQLSTATE');return expected
}
const bundle=(overrides={})=>bootstrap007(bytes,{target:f.users.admin,email:'admin@example.invalid',binding:hash,reference:'FIXTURE_ONE_ADMIN_'+f.run,cluster,days:1,...overrides})
const bodyOnly=sql=>sql.replace(/COMMIT;\s*$/,'')
const claims=(actor,aal='aal2')=>`set local role authenticated;set local request.jwt.claim.sub=${q(f.users[actor])};set local request.jwt.claims=${q(JSON.stringify({sub:f.users[actor],role:'authenticated',aal}))};`
const expectDenial=sql=>`do $denied$ begin begin ${sql};raise exception 'Required denial missing';exception when sqlstate '42501' then null;end;end $denied$;`
try{
 need(['atomic','nested-demo'].includes(mode),'B007_MODE');report.mode=mode
 services=await f.retained();source=f.retainedRead(preservationQuery).trim();extra=f.retainedRead("select json_build_object('factors',(select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) from auth.mfa_factors x),'requests',(select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) from queue_private.staff_review_requests x))").trim();inventory=await f.inventory()
 await f.start();report.existingSqlMethods=f.policyTests
 await f.sql(`create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
 create table auth.identities(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users,provider text,provider_id text,identity_data jsonb);
 create table auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users,status text,factor_type text);
 insert into auth.identities(user_id,provider,provider_id,identity_data) select id,'google','fixture-'||id,jsonb_build_object('sub','fixture-'||id,'email',email,'email_verified',true) from auth.users where id<>${q(f.users.unassigned)};
 insert into auth.mfa_factors(user_id,status,factor_type) select id,'verified','totp' from auth.users where id in (${q(f.users.admin)},${q(f.users.parallel)},${q(f.users.cashier)});
 update queue_private.accounts set role='ADMIN' where id in (${q(f.users.parallel)},${q(f.users.disabled)});`)
 await f.sql(readFileSync('supabase/20261019000900_staff_directory.PROPOSED.sql','utf8'))
 await f.sql('begin;\n'+installed+'\ncommit;notify pgrst,\'reload schema\';')
 cluster=f.cluster;hash=(await f.sql(`select encode(sha256(convert_to(jsonb_build_object('user_id',u.id,'identity_id',i.id,'provider',i.provider,'provider_id',i.provider_id,'subject',i.identity_data->>'sub','email',lower(u.email),'identity_email',lower(i.identity_data->>'email'),'email_verified',i.identity_data->>'email_verified')::text,'UTF8')),'hex') from auth.users u join auth.identities i on i.user_id=u.id where u.id=${q(f.users.admin)};`)).trim()
 baseline=await fingerprint();report.migrationSha256=digest(bytes);report.body=migrationBody(bytes);report.body={sha256:report.body.sha256,topLevelStatements:report.body.topLevelStatements};report.installedReadCloneSha256=digest(installed)
 if(mode==='nested-demo'){
  await test('literal outer BEGIN + unchanged 007 COMMIT leaves migration installed after bootstrap failure',async()=>{
   const code=await rejectedTransaction(`begin;\n${bytes.toString('utf8')}\nselect queue_private.review_staff_access(${q(f.users.admin)},'admin@example.invalid',${q('0'.repeat(64))},'ADMIN','BAD_DOCUMENTED_NESTING',clock_timestamp()+interval '1 day');commit;`,'42501')
   const state=JSON.parse((await f.sql("select jsonb_build_object('tableExists',to_regclass('queue_private.staff_access_approvals') is not null,'approvalCount',(select count(*) from queue_private.staff_access_approvals),'coreExists',to_regprocedure('queue_private.admin_configuration_core007()') is not null)")).trim())
   need(state.tableExists&&state.coreExists&&state.approvalCount===0,'B007_NESTED_DEMO');report.documentedNestedPattern={bootstrapFailureSqlstate:code,...state,atomic:false}
  })
 }else{
  await test('reviewed full body has exactly two removable outer transaction controls',async()=>{
   need(digest(bytes)===reviewed007,'B007_SOURCE');const list=statements(bundle());need(list[0].text.trim()==='BEGIN;'&&list.at(-1).text.trim()==='COMMIT;','B007_BUNDLE')
   need(!/\bbegin\s*;|\bcommit\s*;/i.test(migrationBody(bytes).body),'B007_NESTED_BODY')
   let refused=false;try{migrationBody(Buffer.concat([bytes,Buffer.from('\ncommit;')]))}catch{refused=true}need(refused,'B007_CHANGED_INPUT')
  })
  await test('wrong identity binding rolls back every 007 DDL change and approval',async()=>{
   await rejectedTransaction(bundle({binding:'0'.repeat(64)}),'42501');need(digest(await fingerprint())===digest(baseline),'B007_IDENTITY_ROLLBACK')
  })
  await test('injected failure after approval rolls back functions table grants roles and approval',async()=>{
   await rejectedTransaction(bodyOnly(bundle())+"do $fail$ begin raise exception 'Injected final acceptance failure';end $fail$;commit;",'P0001');need(digest(await fingerprint())===digest(baseline),'B007_LATE_ROLLBACK')
  })
  await test('duplicate approval before COMMIT aborts the entire combined transaction',async()=>{
   await rejectedTransaction(bodyOnly(bundle())+`select queue_private.review_staff_access(${q(f.users.admin)},'admin@example.invalid',${q(hash)},'ADMIN','SECOND_REF',clock_timestamp()+interval '1 day');commit;`,'22023');need(digest(await fingerprint())===digest(baseline),'B007_DUPLICATE_ROLLBACK')
  })
  await test('wrong cluster stops before any migration object is created',async()=>{
   await rejectedTransaction(bundle({cluster:'7696959712798593061'}),'42501');need(digest(await fingerprint())===digest(baseline),'B007_CLUSTER_GUARD')
  })
  // Prime the installed reads before replacement, including pooled connections.
  for(let n=0;n<20;n++){const r=await rpc('admin','admin_staff_accounts',{},'aal1');if(r.http===200)break;need(r.body.code==='PGRST202','B007_READINESS');await delay(150)}
  await test('complete 007 and exactly one identity-bound one-day ADMIN approval commit together',async()=>{
   // Also exercise pre-commit AAL2 acceptance in this same transaction.
   await f.sql(bodyOnly(bundle())+claims('admin')+'select queue_api.admin_configuration();reset role;commit;')
   const approval=JSON.parse((await f.sql(`select jsonb_build_object('total',count(*),'exact',bool_and(account_id=${q(f.users.admin)}::uuid and staff_role='ADMIN' and identity_sha256=${q(hash)} and approval_reference=${q('FIXTURE_ONE_ADMIN_'+f.run)} and approved_by='postgres' and revoked_at is null and expires_at>approved_at+interval '23 hours' and expires_at<=approved_at+interval '1 day')) from queue_private.staff_access_approvals;`)).trim())
   need(approval.total===1&&approval.exact,'B007_APPROVAL_SCOPE');const after=await fingerprint();need(after.rows===baseline.rows,'B007_ROLE_OR_ASSIGNMENT_CHANGED');report.bootstrapApproval={exactlyOne:true,role:'ADMIN',duration:'1 day',identityBound:true,operator:'postgres'}
  })
  await test('approved signed AAL2 ADMIN can read all actual installed 011 endpoints',async()=>{
   const config=await rpc('admin','admin_configuration');need(config.http===200&&config.body.counters.length===5,'B007_APPROVED_CONFIG')
   for(const [name,args]of adminReads){const r=await rpc('admin',name,args);need(name==='admin_payor_events'?r.body.code==='42501':r.http===200,'B007_APPROVED_READ')}
   // A valid ticket history is seeded only inside a rollback fixture transaction.
   await f.sql(`begin;
    insert into queue_private.queue_days(business_date,timezone_snapshot,closed_at,closed_by) values('2020-01-01','Asia/Manila',clock_timestamp(),${q(f.users.admin)});
    insert into queue_private.service_day_state(queue_day_id,service_id,last_number) select d.id,s.id,1 from queue_private.queue_days d,queue_private.services s where d.business_date='2020-01-01' and s.code='TP';
    insert into queue_private.tickets(owner_id,queue_day_id,service_id,sequence_number,wait_position,status,served_at) select ${q(f.users.student)},d.id,s.id,1,1,'SERVED',clock_timestamp() from queue_private.queue_days d,queue_private.services s where d.business_date='2020-01-01' and s.code='TP';
    insert into queue_private.ticket_events(ticket_id,actor_id,event_type,to_status) select id,${q(f.users.student)},'ISSUED','WAITING' from queue_private.tickets;
    select set_config('fixture.ticket',(select id::text from queue_private.tickets limit 1),true);
    ${claims('admin')}do $history$ begin if jsonb_array_length(queue_api.admin_payor_events(current_setting('fixture.ticket')::uuid))<>1 then raise exception 'Fixture history missing';end if;end $history$;rollback;`)
  })
  await test('unapproved ADMIN and approved ADMIN at AAL1 are denied all protected reads',async()=>{
   for(const [actor,aal]of [['parallel','aal2'],['admin','aal1']])for(const [name,args]of [['admin_configuration',{}],...adminReads])denied(await rpc(actor,name,args,aal))
  })
  await test('unapproved CASHIER and STUDENT cannot use protected staff operations',async()=>{
   for(const actor of ['cashier','unassigned','student'])for(const [name,args]of [['staff_queue',{}],['admin_configuration',{}],['call_next',{p_counter:f.counters[1],p_service:'TP',p_request_key:randomUUID()}],['finish_ticket',{p_ticket:randomUUID(),p_action:'SERVE',p_request_key:randomUUID()}]])denied(await rpc(actor,name,args))
  })
  await test('STUDENT context tickets issuance contract and public routes stay unchanged',async()=>{
   need((await rpc('student','my_context',{},'aal1')).body.role==='STUDENT','B007_STUDENT_CONTEXT');need((await rpc('student','my_tickets',{},'aal1')).http===200,'B007_STUDENT_TICKETS')
   const issue=await rpc('student','issue_ticket',{p_service:'TP',p_request_key:randomUUID()},'aal1');need(issue.body.code==='P0001','B007_STUDENT_ISSUE_RULE')
   need((await f.sql("select string_agg(c.number::text||':'||s.code,',' order by c.number) from queue_private.counters c join queue_private.counter_services x on x.counter_id=c.id join queue_private.services s on s.id=x.service_id;")).trim()==='1:TP,2:SOA,3:PNEP,4:REF,5:ADJ','B007_ROUTES')
  })
  await test('all eight wrappers private cores and operator helpers have expected definer owner search path and grants',async()=>{
   const metadata=JSON.parse((await f.sql(`select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'path',p.proconfig,'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'service',has_function_privilege('service_role',p.oid,'EXECUTE'))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='queue_api' and p.proname in (${wrappers.map(q).join(',')})) or (n.nspname='queue_private' and (p.proname like '%_core007' or p.proname in ('google_staff_binding','require_staff_mfa','require_staff_approval','review_staff_access','revoke_staff_review','promote_approved_admin')))`)).trim())
   need(metadata.length===22&&metadata.every(x=>x.owner==='postgres'&&x.definer&&x.path?.length===1&&x.path[0]==='search_path=""'&&!x.anon&&!x.service&&x.authenticated===(x.schema==='queue_api')),'B007_GRANTS')
   need((await f.sql("select relrowsecurity and not has_table_privilege('authenticated',oid,'INSERT') and not has_table_privilege('anon',oid,'SELECT') and not has_table_privilege('service_role',oid,'UPDATE') from pg_class where oid='queue_private.staff_access_approvals'::regclass")).trim()==='t','B007_TABLE_RLS');report.protectedFunctionsChecked=metadata.length
  })
  await test('approval expiry revocation identity change and missing factor each fail closed',async()=>{
   for(const change of ["update queue_private.staff_access_approvals set expires_at=approved_at+interval '1 millisecond'","update queue_private.staff_access_approvals set revoked_at=clock_timestamp()",`update auth.identities set identity_data=identity_data||'{"email_verified":false}' where user_id=${q(f.users.admin)}`,`update auth.mfa_factors set status='unverified' where user_id=${q(f.users.admin)}`])await f.sql('begin;'+change+';'+claims('admin')+expectDenial('perform queue_api.admin_configuration()')+'rollback;')
  })
  await test('repeat migration and approvals beyond 30 days are refused',async()=>{
   await rejectedTransaction(bundle(),'42501');await f.sql(`begin;do $cap$ begin begin perform queue_private.review_staff_access(${q(f.users.parallel)},'parallel@example.invalid',queue_private.google_staff_binding(${q(f.users.parallel)}),'ADMIN','TOO_LONG',clock_timestamp()+interval '31 days');raise exception 'Expected expiry refusal';exception when sqlstate '22023' then null;end;end $cap$;rollback;`)
  })
  await test('legacy directory still bypasses 007 at AAL1 without operator approval — blocker reproduced',async()=>{
   const r=await rpc('parallel','admin_staff_directory',{},'aal1');need(r.http===200&&Array.isArray(r.body),'B007_LEGACY_READ_TEST');report.blockers??=[];report.blockers.push('Installed admin_staff_directory remains callable by unapproved AAL1 ADMIN')
  })
  await test('legacy request_staff_access still writes at AAL1 without approval — blocker reproduced only in fixture',async()=>{
   const r=await rpc('parallel','request_staff_access',{p_email:'fixture-review@example.invalid',p_role:'CASHIER'},'aal1');need(r.http===200&&r.body.status==='PENDING_IDENTITY_REVIEW','B007_LEGACY_WRITE_TEST');report.blockers.push('Installed request_staff_access still writes pending requests for unapproved AAL1 ADMIN')
  })
 }
 report.result='PASS_VERIFICATION_NO_GO_RETAINED_APPLICATION'
}catch(e){report.result='FAIL';report.failure=/^B007_[A-Z_]+$/.test(e.message||'')?e.message:'B007_FIXTURE_STOPPED';report.stage=f.stage;process.exitCode=1}
finally{
 try{await f.stop();report.stopped=true;const after=await f.retained(),now=await f.inventory();need(source===f.retainedRead(preservationQuery).trim()&&extra===f.retainedRead("select json_build_object('factors',(select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) from auth.mfa_factors x),'requests',(select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) from queue_private.staff_review_requests x))").trim(),'B007_RETAINED_ROWS');need(after.every((x,i)=>x.id===services[i].id&&x.definition===services[i].definition&&(x.name.includes('vector')||digest(x)===digest(services[i]))),'B007_SERVICES');need(digest(now.volumes)===digest(inventory.volumes)&&digest(now.containers)===digest([...inventory.containers,...f.owned].sort())&&digest(now.networks)===digest([...inventory.networks,...(f.networkId?[f.networkId]:[])].sort()),'B007_RESOURCES');report.retainedPreservation=true;report.exactResourceDelta=true}catch{report.result='FAIL';report.retainedPreservation=false;process.exitCode=1}
 report.containers=[...f.owned];report.network=f.network;report.passed=report.checks.filter(x=>x.result==='PASS').length
 writeFileSync(path,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({result:report.result,mode,passed:report.passed,failure:report.failure,evidence:path}))
}
