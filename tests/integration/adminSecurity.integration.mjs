// Applies the proposed migration ONLY through the disposable fixture's immutable-ID guard.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {QueueFixture,need,digest,preservationQuery} from './queueFixture.mjs'
const run=randomUUID().slice(0,8),fixture=new QueueFixture(run),checks=[]
const report={run,retained_writes:false,real_mfa_or_google_login:false,checks}
const path=`tests/integration/results/admin_security_${run}.json`
const candidate='supabase/20261019000700_staff_security.PROPOSED.sql'
let before,source,inventory
const q=x=>"'"+String(x).replaceAll("'","''")+"'"
const uid=name=>fixture.users[name]
async function test(name,body){try{await body();checks.push({name,result:'PASS'});console.log('PASS: '+name)}catch(e){checks.push({name,result:'FAIL'});throw e}}
async function rpc(actor,name,args={},aal='aal1',token){const r=await fixture.request('/rpc/'+name,{name:actor,body:args,token:token||fixture.token(actor,'authenticated',aal)});return{status:r.status,body:await r.json()}}
const denied=r=>need(r.status>=400&&r.body.code==='42501','Expected authorization denial')
async function rejectedSql(sql,code='42501'){sql=sql.replace(/;+\s*$/,'');await fixture.sql(`do $negative$ begin begin ${sql}; raise exception 'Expected rejection did not occur'; exception when sqlstate '${code}' then null; end; end $negative$;`)}
async function binding(name){return(await fixture.sql(`select queue_private.google_staff_binding(${q(uid(name))});`)).trim()}
async function review(name,role){const ref=`${run}-${name}-${role}`;await fixture.sql(`select queue_private.review_staff_access(${q(uid(name))},${q(name+'@example.invalid')},${q(await binding(name))},${q(role)},${q(ref)},clock_timestamp()+interval '1 day');`);return ref}
const accountArgs=(name,role='CASHIER',enabled=true)=>({p_user:uid(name),p_role:role,p_enabled:enabled,p_request_key:randomUUID()})
try{
 mkdirSync('tests/integration/results',{recursive:true})
 before=await fixture.retained();source=JSON.parse(fixture.retainedRead(preservationQuery).trim());inventory=await fixture.inventory()
 await fixture.start();report.prior_policy_methods=fixture.policyTests
 await fixture.sql(`create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
  create table auth.identities(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users,provider text,provider_id text,identity_data jsonb);
  create table auth.mfa_factors(user_id uuid primary key references auth.users,status text);
  insert into auth.identities(user_id,provider,provider_id,identity_data) select id,'google','sub-'||id,jsonb_build_object('sub','sub-'||id,'email',email,'email_verified',true) from auth.users;
  insert into auth.mfa_factors select id,'verified' from auth.users where id<>${q(uid('other'))};`)
 const originalRoles=(await fixture.sql('select json_object_agg(id,role) from queue_private.accounts;')).trim()
 await fixture.sql(readFileSync(candidate,'utf8'));report.candidate_sha256=digest(readFileSync(candidate))
 await test('proposed migration changes no role and seeds no approvals',async()=>{
  need((await fixture.sql('select json_object_agg(id,role) from queue_private.accounts;')).trim()===originalRoles,'Migration promoted an account')
  need((await fixture.sql('select count(*) from queue_private.staff_access_approvals;')).trim()==='0','Migration seeded authority')
 })
 await test('ordinary and disabled users cannot self-promote with ADMIN metadata or AAL2',async()=>{
  for(const actor of ['student','other','disabled'])for(const aal of ['aal1','aal2']){
   denied(await rpc(actor,'set_account',accountArgs(actor,'ADMIN'),aal));denied(await rpc(actor,'admin_configuration',{},aal))
  }
 })
 await test('unreviewed existing ADMIN is denied even with signed AAL2',async()=>{denied(await rpc('admin','admin_configuration',{},'aal2'))})
 await test('operator review rejects wrong UUID, .edu.com/email mismatch and wrong identity hash',async()=>{
  const h=await binding('other')
  await rejectedSql(`perform queue_private.review_staff_access(${q(randomUUID())},'other@example.invalid',${q(h)},'ADMIN','wrong-uuid',clock_timestamp()+interval '1 day');`,'22023')
  await rejectedSql(`perform queue_private.review_staff_access(${q(uid('other'))},'other@school.edu.com',${q(h)},'ADMIN','wrong-email',clock_timestamp()+interval '1 day');`,'22023')
  await rejectedSql(`perform queue_private.review_staff_access(${q(uid('other'))},'other@example.invalid',${q('0'.repeat(64))},'ADMIN','wrong-hash',clock_timestamp()+interval '1 day');`)
 })
 await test('operator helpers and approval tables are unavailable through browser roles',async()=>{
  const r=await rpc('admin','review_staff_access',{p_user:uid('other')},'aal2');need(r.status>=400,'Operator helper exposed by API')
  const security=JSON.parse((await fixture.sql(`select json_build_object('usage',has_schema_privilege('authenticated','queue_private','USAGE'),'table',has_table_privilege('authenticated','queue_private.staff_access_approvals','INSERT'),'execute',has_function_privilege('authenticated','queue_private.promote_approved_admin(uuid,text,text,text,text)','EXECUTE'));`)).trim())
  need(Object.values(security).every(x=>!x),'Browser acquired operator privileges')
 })
 let otherReview=await review('other','ADMIN')
 const promotion=async(hash,email='other@example.invalid',target=uid('other'))=>{hash??=await binding('other');return `perform queue_private.promote_approved_admin(${q(target)},${q(email)},'STUDENT',${q(hash)},${q(otherReview)});`}
 await test('approved target still cannot be promoted before verified MFA enrollment',async()=>{await rejectedSql(await promotion())})
 await fixture.sql(`insert into auth.mfa_factors values(${q(uid('other'))},'verified');`)
 await test('promotion checks exact target binding and retains the reviewed target on failure',async()=>{
  await rejectedSql(await promotion('0'.repeat(64)))
  await rejectedSql(await promotion(await binding('other'),'other@school.edu.com'))
  await rejectedSql(await promotion(await binding('other'),'other@example.invalid',uid('student')))
  need((await fixture.sql(`select role from queue_private.accounts where id=${q(uid('other'))};`)).trim()==='STUDENT','Failed check changed target role')
 })
 await test('separately reviewed operator promotion changes only its exact synthetic account',async()=>{
  const prev=JSON.parse((await fixture.sql('select json_object_agg(id,to_jsonb(a)) from queue_private.accounts a;')).trim())
  await fixture.sql(`do $promotion$ begin ${await promotion()} end $promotion$;`)
  const after=JSON.parse((await fixture.sql('select json_object_agg(id,to_jsonb(a)) from queue_private.accounts a;')).trim())
  need(after[uid('other')].role==='ADMIN','Approved promotion failed')
  for(const id of Object.keys(prev))if(id!==uid('other'))need(JSON.stringify(prev[id])===JSON.stringify(after[id]),'Promotion changed unrelated account')
 })
 await test('promotion and review repeats cannot silently overwrite approval or promote again',async()=>{
  await rejectedSql(await promotion());await rejectedSql(`perform queue_private.review_staff_access(${q(uid('other'))},'other@example.invalid',${q(await binding('other'))},'ADMIN','duplicate-review',clock_timestamp()+interval '1 day');`,'22023')
 })
 await review('admin','ADMIN')
 await test('approved ADMIN AAL1 cannot read or execute any sensitive administrative RPC',async()=>{
  for(const [name,args]of [['admin_configuration',{}],['set_account',accountArgs('student')],['configure_counter',{p_counter:fixture.counters[2],p_open:true,p_services:['SOA'],p_cashiers:[uid('student')],p_request_key:randomUUID()}],['configure_service',{p_code:'TP',p_name:'Tuition Payment',p_enabled:true,p_request_key:randomUUID()}],['manage_day',{p_action:'OPEN',p_date:'2026-10-19',p_request_key:randomUUID()}]])denied(await rpc('admin',name,args))
 })
 await test('approved ADMIN AAL2 reads the complete five-counter directory without Auth secrets',async()=>{
  const r=await rpc('admin','admin_configuration',{},'aal2');need(r.status===200&&r.body.counters.length===5,'Approved directory read failed')
  need(r.body.accounts.every(a=>Object.keys(a).sort().join(',')==='enabled,id,role'),'Directory included unexpected identity fields')
 })
 await test('forged AAL2 JWT signature cannot substitute for real authentication',async()=>{
  const t=fixture.token('admin','authenticated','aal2').split('.');t[2]='INVALID_SIGNATURE'
  const r=await rpc('admin','admin_configuration',{},'aal2',t.join('.'));need(r.status===401,'Forged JWT accepted')
 })
 await test('CASHIER assignment requires operator approval of that exact target identity',async()=>{
  denied(await rpc('admin','set_account',accountArgs('student'),'aal2'))
  await review('student','CASHIER');const r=await rpc('admin','set_account',accountArgs('student'),'aal2')
  need(r.status===200&&r.body.role==='CASHIER','Approved cashier assignment failed')
 })
 await review('cashier','CASHIER')
 await test('all fixed counters retain routing and accept only approved enabled cashiers',async()=>{
  const args={p_counter:fixture.counters[2],p_open:true,p_services:['SOA'],p_cashiers:[uid('student')],p_request_key:randomUUID()}
  const r=await rpc('admin','configure_counter',args,'aal2');need(r.status===200,'Approved counter assignment failed')
  const wrong=await rpc('admin','configure_counter',{...args,p_services:['TP'],p_request_key:randomUUID()},'aal2');need(wrong.status>=400,'Fixed service routing changed')
  const r2=await rpc('admin','admin_configuration',{},'aal2');need(r2.body.counters.length===5&&r2.body.staff_assignments.some(x=>x.account_id===uid('student')&&x.counter_id===fixture.counters[2]),'Counter assignment missing')
 })
 await test('approved administrator can disable and re-enable an approved existing cashier',async()=>{
  need((await rpc('admin','set_account',accountArgs('student','CASHIER',false),'aal2')).status===200,'Disable failed')
  denied(await rpc('student','staff_queue',{},'aal2'))
  need((await rpc('admin','set_account',accountArgs('student'),'aal2')).status===200,'Re-enable failed')
 })
 await test('cashier queue reads require AAL2 and administrator context cannot be injected',async()=>{
  denied(await rpc('cashier','staff_queue'));need((await rpc('cashier','staff_queue',{},'aal2')).status===200,'Approved cashier read failed')
  denied(await rpc('cashier','admin_configuration',{},'aal2'))
 })
 await test('cashier call/serve/replay enforce AAL2 before the original operation logic',async()=>{
  const date=(await fixture.sql("select (clock_timestamp() at time zone 'Asia/Manila')::date;")).trim()
  need((await rpc('admin','manage_day',{p_action:'OPEN',p_date:date,p_request_key:randomUUID()},'aal2')).status===200,'Fixture day did not open')
  need((await rpc('browser','issue_ticket',{p_service:'TP',p_request_key:randomUUID()})).status===200,'Ordinary issuance changed')
  const args={p_counter:fixture.counters[1],p_service:'TP',p_request_key:randomUUID()}
  denied(await rpc('cashier','call_next',args));const call=await rpc('cashier','call_next',args,'aal2');need(call.status===200&&call.body.ticket_id,'Approved call failed')
  const finish={p_ticket:call.body.ticket_id,p_action:'SERVE',p_request_key:randomUUID()}
  denied(await rpc('cashier','finish_ticket',finish));need((await rpc('cashier','finish_ticket',finish,'aal2')).body.status==='SERVED','Approved serve failed')
  denied(await rpc('cashier','finish_ticket',finish))
 })
 await test('removed verified MFA enrollment denies an otherwise approved AAL2 token',async()=>{
  await fixture.sql(`update auth.mfa_factors set status='unverified' where user_id=${q(uid('admin'))};`)
  denied(await rpc('admin','admin_configuration',{},'aal2'))
  await fixture.sql(`update auth.mfa_factors set status='verified' where user_id=${q(uid('admin'))};`)
 })
 await test('changed Google identity invalidates approval without changing database role',async()=>{
  await fixture.sql(`update auth.identities set identity_data=jsonb_set(identity_data,'{email_verified}','false') where user_id=${q(uid('admin'))};`)
  denied(await rpc('admin','admin_configuration',{},'aal2'))
  await fixture.sql(`update auth.identities set identity_data=jsonb_set(identity_data,'{email_verified}','true') where user_id=${q(uid('admin'))};`)
 })
 await test('revoked and expired approvals deny AAL2 staff access',async()=>{
  await fixture.sql(`select queue_private.revoke_staff_review(${q(run+'-cashier-CASHIER')});`);denied(await rpc('cashier','staff_queue',{},'aal2'))
  await fixture.sql(`update queue_private.staff_access_approvals set approved_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 day' where account_id=${q(uid('admin'))};`)
  denied(await rpc('admin','admin_configuration',{},'aal2'))
 })
 await test('private core implementations and approval table have no browser bypass',async()=>{
  const x=JSON.parse((await fixture.sql(`select json_build_object('core_grants',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='queue_private' and p.proname like '%core007' and (has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('service_role',p.oid,'EXECUTE'))),'approval_rls',(select relrowsecurity from pg_class where oid='queue_private.staff_access_approvals'::regclass),'publication',(select count(*) from pg_publication_tables where pubname='supabase_realtime'));`)).trim())
  need(x.core_grants===0&&x.approval_rls&&x.publication===2,'Private core or publication boundary changed')
 })
 report.result='PASS'
}catch(e){report.result='FAIL';report.failure=e.message;console.error(e.message);process.exitCode=1}
finally{
 report.owned_resources={containers:[...fixture.owned],network:fixture.networkId?fixture.network:null}
 try{await fixture.stop();report.owned_containers_stopped=true}catch{report.result='FAIL';report.shutdown='Owned fixture shutdown failed';process.exitCode=1}
 try{
  if(source){need(digest(JSON.parse(fixture.retainedRead(preservationQuery).trim()))===digest(source),'Retained data/functions changed');report.retained_rows_functions_exact=true}
  if(before){const after=await fixture.retained();need(after.every((x,i)=>x.name.includes('vector')?x.id===before[i].id&&x.definition===before[i].definition:JSON.stringify(x)===JSON.stringify(before[i])),'Retained services changed');report.retained_services_exact=true}
  if(inventory){const after=await fixture.inventory();need(JSON.stringify(after.volumes)===JSON.stringify(inventory.volumes)&&JSON.stringify(after.containers)===JSON.stringify([...inventory.containers,...fixture.owned].sort())&&JSON.stringify(after.networks)===JSON.stringify([...inventory.networks,...(fixture.networkId?[fixture.networkId]:[])].sort()),'Unexpected Docker inventory');report.docker_inventory_exact=true}
 }catch(e){report.result='FAIL';report.preservation=e.message;process.exitCode=1}
 report.passed=checks.filter(x=>x.result==='PASS').length;report.failed=checks.filter(x=>x.result==='FAIL').length
 writeFileSync(path,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({result:report.result,passed:report.passed,failed:report.failed,evidence:path}))
}
