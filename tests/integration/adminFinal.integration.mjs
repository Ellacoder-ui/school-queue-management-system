// New proposal runs ONLY on immutable-ID guarded disposable resources.
import {readFileSync,writeFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {QueueFixture,availableFixtureRun,need,digest,preservationQuery,delay} from './queueFixture.mjs'
const f=new QueueFixture(availableFixtureRun()),checks=[],report={run:f.run,checks,retained_writes:false,synthetic_auth:true}
let source,services,inventory
const q=x=>"'"+String(x).replaceAll("'","''")+"'"
const rpc=async(actor,name,args={},aal='aal2')=>{const r=await f.request('/rpc/'+name,{name:actor,body:args,token:f.token(actor,'authenticated',aal)});return {status:r.status,body:await r.json()}}
const ok=r=>{need(r.status===200,'AF_RPC_REJECTED');return r.body}
const denied=r=>need(r.status>=400&&r.body.code==='42501','AF_EXPECTED_DENIAL')
async function test(name,fn){try{await fn();checks.push({name,result:'PASS'});console.log('PASS: '+name)}catch(e){checks.push({name,result:'FAIL'});throw e}}
const proposal='supabase/20261020001200_admin_staff_activation.PROPOSED.sql'
try{
 services=await f.retained();source=f.retainedRead(preservationQuery).trim();inventory=await f.inventory()
 await f.start();report.prior_sql_methods=f.policyTests
 await f.sql(`create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
 create table auth.identities(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users,provider text,provider_id text,identity_data jsonb);
 create table auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users,status text,factor_type text default 'totp');
 insert into auth.identities(user_id,provider,provider_id,identity_data) select id,'google','sub-'||id,jsonb_build_object('sub','sub-'||id,'email',email,'email_verified',true) from auth.users;
 insert into auth.mfa_factors(user_id,status) values(${q(f.users.admin)},'verified');`)
 await f.sql(readFileSync('supabase/20261019000900_staff_directory.PROPOSED.sql','utf8'))
 const readonly=readFileSync('supabase/20261020001100_admin_readonly.PROPOSED.sql','utf8');need(digest(Buffer.from(readonly))==='3ed88ab2633a56650e27e931ff07e4684d24df0f67680c2e486725a4d8d423ed','AF_READONLY_SOURCE')
 await f.sql('begin;\n'+readonly+'\ncommit;')
 const mutation=readFileSync(proposal,'utf8');need((mutation.match(/create function /gi)||[]).length===1&&mutation.includes('create function queue_api.add_verified_staff('),'AF_MUTATION_SCOPE')
 await f.sql('begin;\n'+mutation+'\ncommit;');report.proposal_sha256=digest(readFileSync(proposal));report.readonly_source_sha256=digest(Buffer.from(readonly))
 for(let n=0;n<20;n++){const r=await rpc('admin','admin_staff_accounts');if(r.status===200)break;need(r.body.code==='PGRST202','AF_SCHEMA_READINESS');await delay(150)}
 await test('proposed activation refuses without the separately reviewed 007 security installation',async()=>{
  denied(await rpc('admin','add_verified_staff',{p_user:f.users.other,p_email:'other@example.invalid',p_identity_sha256:'0'.repeat(64),p_role:'ADMIN',p_counter:null,p_request_key:randomUUID()}))
 })
 await f.sql(readFileSync('supabase/20261019000700_staff_security.PROPOSED.sql','utf8'));report.migration007_fixture_only=true
 for(const [name,role]of [['admin','ADMIN'],['cashier','CASHIER'],['other','CASHIER'],['parallel','ADMIN'],['browser','CASHIER']]){
  const hash=(await f.sql(`select queue_private.google_staff_binding(${q(f.users[name])});`)).trim()
  await f.sql(`select queue_private.review_staff_access(${q(f.users[name])},${q(name+'@example.invalid')},${q(hash)},${q(role)},${q('fixture-'+name)},clock_timestamp()+interval '1 day');`)
 }
 await f.sql(`insert into auth.mfa_factors(user_id,status) values(${q(f.users.cashier)},'verified');`)
 const args=name=>({p_user:f.users[name],p_email:name+'@example.invalid',p_identity_sha256:null,p_role:'CASHIER',p_counter:f.counters[1],p_request_key:randomUUID()})
 async function resolved(name){return ok(await rpc('admin','resolve_staff_google',{p_email:name+'@example.invalid'}))}
 async function addArgs(name,role='CASHIER'){return {...args(name),p_identity_sha256:(await resolved(name)).identity_sha256,p_role:role,p_counter:role==='CASHIER'?f.counters[1]:null}}
 await test('authorized directory includes only real staff; no Auth material',async()=>{
  const rows=ok(await rpc('admin','admin_staff_accounts'));need(rows.length===3&&rows.every(x=>['ADMIN','CASHIER'].includes(x.role)&&x.google_verified&&Object.keys(x).sort().join(',')==='email,enabled,google_verified,id,role'),'AF_DIRECTORY')
 })
 await test('STUDENT CASHIER disabled and forged metadata cannot use any new administrative RPC',async()=>{
  for(const actor of ['student','cashier','disabled'])for(const [name,p]of [['admin_staff_accounts',{}],['resolve_staff_google',{p_email:'other@example.invalid'}],['admin_payors',{}],['admin_payor_events',{p_ticket:randomUUID()}],['add_verified_staff',args('other')]])denied(await rpc(actor,name,p))
 })
 await test('unique confirmed Google resolution rejects missing, mismatched or ambiguous identities',async()=>{
  const x=await resolved('other');need(x.id===f.users.other&&x.role==='STUDENT'&&x.identity_sha256.length===64,'AF_BINDING')
  need(ok(await rpc('admin','resolve_staff_google',{p_email:'missing@example.invalid'}))===null,'AF_UNREGISTERED')
  await f.sql(`update auth.identities set identity_data=identity_data||'{"email_verified":false}' where user_id=${q(f.users.other)};`);need(await resolved('other')===null,'AF_UNVERIFIED')
  await f.sql(`update auth.identities set identity_data=identity_data||'{"email_verified":true}' where user_id=${q(f.users.other)};insert into auth.identities(user_id,provider,provider_id,identity_data) select user_id,provider,provider_id,identity_data from auth.identities where user_id=${q(f.users.other)};`);need(await resolved('other')===null,'AF_AMBIGUOUS');await f.sql(`delete from auth.identities where id=(select id from auth.identities where user_id=${q(f.users.other)} order by id limit 1);`)
 })
 await test('AAL1, missing verified factor, self change and altered immutable binding reject',async()=>{
  const p=await addArgs('other');denied(await rpc('admin','add_verified_staff',p,'aal1'))
  await f.sql(`update auth.mfa_factors set status='unverified';`);denied(await rpc('admin','add_verified_staff',p));await f.sql(`update auth.mfa_factors set status='verified';`)
  denied(await rpc('admin','add_verified_staff',{...p,p_user:f.users.admin}));denied(await rpc('admin','add_verified_staff',{...p,p_identity_sha256:'0'.repeat(64)}))
 })
 let receipt, cashierArgs
 await test('atomic CASHIER activation preserves unrelated assignments, exact route and counter-open state',async()=>{
  cashierArgs=await addArgs('other');receipt=ok(await rpc('admin','add_verified_staff',cashierArgs));need(receipt.role==='CASHIER'&&receipt.counter===f.counters[1],'AF_CASHIER')
  const c=ok(await rpc('admin','admin_configuration'));need(c.staff_assignments.some(x=>x.account_id===f.users.cashier&&x.counter_id===f.counters[1])&&c.staff_assignments.some(x=>x.account_id===f.users.other&&x.counter_id===f.counters[1])&&c.counters.find(x=>x.number===1).is_open,'AF_ASSIGNMENT_PRESERVATION')
  const context=ok(await rpc('other','my_context'));need(context.role==='CASHIER'&&context.cashier_counters.length===1,'AF_ROLE_CONTEXT')
 })
 await test('same-key lost-result reconciliation replays exactly; changed arguments and revoked actors reject',async()=>{
  need(JSON.stringify(ok(await rpc('admin','add_verified_staff',cashierArgs)))===JSON.stringify(receipt),'AF_REPLAY')
  const changed=await rpc('admin','add_verified_staff',{...cashierArgs,p_counter:f.counters[2]});need(changed.body.code==='22023','AF_CHANGED_REPLAY')
  await f.sql(`update queue_private.accounts set enabled=false where id=${q(f.users.admin)};`);denied(await rpc('admin','add_verified_staff',cashierArgs));await f.sql(`update queue_private.accounts set enabled=true where id=${q(f.users.admin)};`)
 })
 await test('ADMIN activation adds no cashier privilege and subsequent context is database-authoritative',async()=>{
  const p=await addArgs('parallel','ADMIN');ok(await rpc('admin','add_verified_staff',p));const c=ok(await rpc('parallel','my_context'));need(c.role==='ADMIN'&&c.cashier_counters.length===0,'AF_ADMIN_CONTEXT')
 })
 await test('counter rejection rolls back role, assignment, audits and receipts without compensation',async()=>{
  const a=f.users.admin;ok(await rpc('admin','manage_day',{p_action:'OPEN',p_date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(new Date()),p_request_key:randomUUID()}))
  ok(await rpc('student','issue_ticket',{p_service:'TP',p_request_key:randomUUID()}));ok(await rpc('cashier','call_next',{p_counter:f.counters[1],p_service:'TP',p_request_key:randomUUID()}))
  const before=(await f.sql("select jsonb_build_object('accounts',(select jsonb_agg(to_jsonb(a) order by id) from queue_private.accounts a),'audits',(select count(*) from queue_private.admin_audit_events),'receipts',(select count(*) from queue_private.operation_requests));")).trim()
  const r=await rpc('admin','add_verified_staff',await addArgs('browser'));need(r.status>=400,'AF_COUNTER_FAILURE')
  need((await f.sql("select jsonb_build_object('accounts',(select jsonb_agg(to_jsonb(a) order by id) from queue_private.accounts a),'audits',(select count(*) from queue_private.admin_audit_events),'receipts',(select count(*) from queue_private.operation_requests));")).trim()===before,'AF_PARTIAL_CHANGE')
 })
 await test('payors use actual ticket owners, bounded pages, filters and authorized SKIPPED history',async()=>{
  const first=ok(await rpc('admin','admin_payors',{p_limit:1,p_offset:0}));need(first.rows.length===1&&first.rows[0].owner_id===f.users.student&&first.rows[0].status==='CALLED','AF_PAYOR_ROW')
  const ticket=first.rows[0].ticket_id;ok(await rpc('cashier','finish_ticket',{p_ticket:ticket,p_action:'SKIP',p_request_key:randomUUID()}))
  const waiting=ok(await rpc('admin','admin_payors',{p_status:'WAITING',p_service:'TP',p_search:f.users.student}));need(waiting.rows.length===1&&waiting.rows[0].status==='WAITING','AF_PAYOR_FILTER')
  const history=ok(await rpc('admin','admin_payor_events',{p_ticket:ticket}));need(history.some(x=>x.event==='SKIPPED'&&x.status==='WAITING'),'AF_SKIP_HISTORY')
  need(ok(await rpc('admin','admin_payors',{p_offset:1})).rows.length===0,'AF_PAGINATION')
  const invalid=await rpc('admin','admin_payors',{p_limit:1000});need(invalid.body.code==='22023','AF_PAGE_BOUND')
  await f.sql(`update queue_private.accounts set role='CASHIER' where id=${q(f.users.student)};`);need(ok(await rpc('admin','admin_payors',{})).rows.length===0,'AF_STAFF_NOT_EXCLUDED');denied(await rpc('admin','admin_payor_events',{p_ticket:ticket}));await f.sql(`update queue_private.accounts set role='STUDENT' where id=${q(f.users.student)};`)
 })
 await test('revocation and disabled access clear authoritative staff context',async()=>{
  ok(await rpc('admin','set_account',{p_user:f.users.other,p_role:'STUDENT',p_enabled:true,p_request_key:randomUUID()}));need(ok(await rpc('other','my_context')).role==='STUDENT','AF_REVOKE')
  ok(await rpc('admin','set_account',{p_user:f.users.parallel,p_role:'ADMIN',p_enabled:false,p_request_key:randomUUID()}));need(ok(await rpc('parallel','my_context')).enabled===false,'AF_DISABLE')
 })
 await test('proposal adds no private table grants and all five fixed routes remain exact',async()=>{
  need((await f.sql("select has_schema_privilege('authenticated','queue_private','USAGE');")).trim()==='f','AF_PRIVATE_SCHEMA')
  need((await f.sql("select string_agg(c.number::text||':'||s.code,',' order by c.number) from queue_private.counters c join queue_private.counter_services x on x.counter_id=c.id join queue_private.services s on s.id=x.service_id;")).trim()==='1:TP,2:SOA,3:PNEP,4:REF,5:ADJ','AF_ROUTES')
 })
 await test('new endpoints preserve proposed 007 operator approval and MFA gates when installed in fixture only',async()=>{
  await f.sql(`update queue_private.staff_access_approvals set revoked_at=clock_timestamp() where account_id in (${q(f.users.admin)},${q(f.users.browser)});`)
  // 007 wrappers also lock authorization state. The new read RPCs must allow
  // those wrappers to execute and must never fall back to unprotected cores.
  for(const [name,p]of [['admin_staff_accounts',{}],['admin_payors',{}],['resolve_staff_google',{p_email:'browser@example.invalid'}]])denied(await rpc('admin',name,p))
  const binding=(await f.sql(`select queue_private.google_staff_binding(${q(f.users.admin)});`)).trim()
  await f.sql(`select queue_private.review_staff_access(${q(f.users.admin)},'admin@example.invalid',${q(binding)},'ADMIN','fixture-admin-review-renewed',clock_timestamp()+interval '1 day');`)
  need(ok(await rpc('admin','admin_staff_accounts')).length>=3,'AF_007_COMPATIBILITY')
  ok(await rpc('admin','admin_payors',{}));denied(await rpc('admin','admin_staff_accounts',{},'aal1'))
  const p=await addArgs('browser');denied(await rpc('admin','add_verified_staff',p))
  need((await f.sql(`select role from queue_private.accounts where id=${q(f.users.browser)};`)).trim()==='STUDENT','AF_007_BYPASSED')
 })
 report.result='PASS'
}catch(e){report.result='FAIL';report.failure=/^AF_[A-Z_]+$/.test(e.message)?e.message:'AF_FIXTURE_STOPPED';report.stage=f.stage;process.exitCode=1}
finally{
 try{await f.stop();report.stopped=true;if(source)need(f.retainedRead(preservationQuery).trim()===source,'AF_RETAINED_DATA');if(services){const after=await f.retained();need(after.every((x,i)=>x.id===services[i].id&&x.definition===services[i].definition&&(x.name.includes('vector')||JSON.stringify(x)===JSON.stringify(services[i]))),'AF_RETAINED_SERVICE')}if(inventory){const x=await f.inventory();need(digest(x.volumes)===digest(inventory.volumes)&&digest(x.containers)===digest([...inventory.containers,...f.owned].sort())&&digest(x.networks)===digest([...inventory.networks,...(f.networkId?[f.networkId]:[])].sort()),'AF_RESOURCES')}report.retained_preservation=true}catch{report.result='FAIL';report.retained_preservation=false;process.exitCode=1}
 report.containers=[...f.owned];report.network=f.network;report.passed=checks.filter(x=>x.result==='PASS').length;const path=`tests/integration/results/admin_final_${f.run}.json`;writeFileSync(path,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({result:report.result,passed:report.passed,evidence:path}))
}
