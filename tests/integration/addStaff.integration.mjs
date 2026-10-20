// Actual installed 009 contracts exercised only in new guarded PostgreSQL/PostgREST.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fixtureSubnet } from '../../scripts/authOnlyEngine.mjs'
import { createClient } from '@supabase/supabase-js'
import { QueueFixture, need, digest, preservationQuery } from './queueFixture.mjs'
import { createQueueApi, QueueRequestError } from '../../src/services/queueApi.js'
import { createAdminWorkspace } from '../../src/lib/adminWorkspace.js'
// Retained disposable networks can consume earlier /24s. Select a checked free
// identity before creating anything; QueueFixture checks the subnet again at start.
function freshRun() {
  const ids = spawnSync('docker',['network','ls','-q'],{encoding:'utf8',windowsHide:true})
  need(ids.status===0,'ASF_NETWORK_INVENTORY')
  const names=ids.stdout.trim().split(/\s+/);need(names.every(x=>/^[0-9a-f]{12,64}$/.test(x)),'ASF_NETWORK_IDENTITIES')
  const inspected=spawnSync('docker',['network','inspect',...names],{encoding:'utf8',windowsHide:true})
  need(inspected.status===0,'ASF_NETWORK_INVENTORY');const networks=JSON.parse(inspected.stdout),tail=randomUUID().replaceAll('-','').slice(0,6)
  for(let prefix=0;prefix<256;prefix++){const run=prefix.toString(16).padStart(2,'0')+tail;try{fixtureSubnet(run,networks);return run}catch(error){if(error.message!=='AGO_FIXTURE_SUBNET_CONFLICT')throw error}}
  throw Error('ASF_NO_FREE_FIXTURE_SUBNET')
}
const f = new QueueFixture(freshRun()), checks = [], run = f.run, clients = []
const report = { run, retained_writes:false, migration007_applied:false, synthetic_auth_only:true, checks }
const q=x=>"'"+String(x).replaceAll("'","''")+"'"
let services,source,inventory,reviewRows
const reviewQuery="select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) from queue_private.staff_review_requests t"
async function test(name,fn){try{await fn();checks.push({name,result:'PASS'});console.log('PASS: '+name)}catch(error){checks.push({name,result:'FAIL'});throw error}}
function apiFor(name){
  const token=f.token(name,name==='anon'?'anon':'authenticated')
  const client=createClient('http://127.0.0.1:54321',f.token('anon','anon'),{accessToken:async()=>token,auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(input,options={})=>{
    const url=new URL(input instanceof Request?input.url:input),headers=new Headers(options.headers)
    need(url.origin==='http://127.0.0.1:54321'&&url.pathname.startsWith('/rest/v1/'),'ASF_SDK_SCOPE')
    return f.request(url.pathname.slice('/rest/v1'.length)+url.search,{method:options.method||'GET',body:options.body?JSON.parse(options.body):{},profile:headers.get('Content-Profile')||headers.get('Accept-Profile')||'queue_api',token:headers.get('Authorization')?.slice(7)})
  }}})
  clients.push(client)
  return createQueueApi({schema:(...args)=>client.schema(...args),auth:{getSession:async()=>({data:{session:{access_token:token,user:{id:f.users[name]}}},error:null})}},client)
}
const rejection=async(fn,reason)=>{try{await fn()}catch(error){need(error instanceof QueueRequestError&&error.outcome==='rejected'&&(!reason||error.reason===reason),'ASF_REJECTION_MISMATCH');return}throw Error('ASF_UNEXPECTED_ACCEPTANCE')}
try{
  mkdirSync('tests/integration/results',{recursive:true});services=await f.retained();source=f.retainedRead(preservationQuery).trim();reviewRows=f.retainedRead(reviewQuery).trim();inventory=await f.inventory()
  await f.start();report.prior_sql_methods=f.policyTests
  await f.sql(`create table auth.identities(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users,provider text);create table auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users,status text);
    insert into auth.identities(user_id,provider) select id,'google' from auth.users;`)
  const sql=readFileSync('supabase/20261019000900_staff_directory.PROPOSED.sql');need(digest(sql)==='4f101ff6918755e7affe33cbf78020f7b784105f87db872fb92fa874bd5cb25a','ASF_PROPOSAL_CHANGED');await f.sql(sql.toString('utf8'))
  const expected=JSON.parse(readFileSync('.local-browser/add-staff-frontend/baseline.json','utf8')).metadata.functions
  const functions=JSON.parse((await f.sql("select jsonb_agg(jsonb_build_object('name',p.proname,'source',p.prosrc)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='queue_api' and p.proname in ('admin_staff_directory','request_staff_access');")).trim())
  await test('isolated function bodies match the installed retained contracts; 007 is not installed',async()=>{
    need(functions.length===2&&functions.every(x=>digest(x.source.replaceAll('\r\n','\n'))===digest(expected.find(y=>y.name===x.name).source.replaceAll('\r\n','\n'))),'ASF_FUNCTION_BODY_MISMATCH')
    need((await f.sql("select to_regclass('queue_private.staff_access_approvals') is null;")).trim()==='t','ASF_007_UNEXPECTED')
  })
  const admin=apiFor('admin'),student=apiFor('student'),cashier=apiFor('cashier'),disabled=apiFor('disabled'),anon=apiFor('anon')
  await test('real SDK ADMIN directory joins existing configuration with registered emails and fixed routing',async()=>{
    const directory=await admin.read('admin_staff_directory',{}, {expectedActor:f.users.admin});need(directory.length===9&&directory.find(x=>x.id===f.users.cashier).email==='cashier@example.invalid','ASF_DIRECTORY')
    need(directory.every(x=>Object.keys(x).sort().join(',')==='email,enabled,google_identity,id,role,verified_factors'),'ASF_PRIVATE_EXPOSURE')
  })
  await test('STUDENT CASHIER disabled and anonymous contexts cannot read directory or submit staff requests',async()=>{
    for(const api of [student,cashier,disabled,anon]){
      await rejection(()=>api.read('admin_staff_directory'),'unauthorized')
      await rejection(()=>api.executeMutation(api.createMutationIntent('request_staff_access',{p_email:'denied@example.invalid',p_role:'ADMIN'})),'unauthorized')
    }
  })
  const beforeRoles=(await f.sql('select jsonb_object_agg(id,to_jsonb(a)) from queue_private.accounts a;')).trim()
  const beforeUsers=(await f.sql('select count(*) from auth.users;')).trim()
  await test('normalized Add Staff RPC uses exactly two arguments and returns actual pending ID/status',async()=>{
    const intent=admin.createMutationIntent('request_staff_access',{p_email:'  New.Staff@EXAMPLE.INVALID  ',p_role:'CASHIER'})
    const result=await admin.executeMutation(intent,{expectedActor:f.users.admin})
    need(result.status==='PENDING_IDENTITY_REVIEW','ASF_REQUEST_RECEIPT')
    const row=JSON.parse((await f.sql(`select jsonb_build_object('id',id,'email',email,'role',requested_role,'status',status,'bound_user',bound_user) from queue_private.staff_review_requests where id=${q(result.request_id)};`)).trim())
    need(row.email==='new.staff@example.invalid'&&row.bound_user===null&&row.role==='CASHIER','ASF_PENDING_BINDING')
    report.synthetic_request_id=result.request_id
  })
  await test('duplicate pending email is rejected explicitly without producing a success receipt',async()=>{
    await rejection(()=>admin.executeMutation(admin.createMutationIntent('request_staff_access',{p_email:'new.staff@example.invalid',p_role:'ADMIN'})),'staff_duplicate')
    need((await f.sql('select count(*) from queue_private.staff_review_requests;')).trim()==='1','ASF_DUPLICATE_INSERT')
  })
  await test('backend invalid email and unsupported role reject independently of browser validation',async()=>{
    for(const body of [{p_email:'invalid',p_role:'CASHIER'},{p_email:'x@example.invalid',p_role:'OWNER'}]){
      const response=await f.request('/rpc/request_staff_access',{name:'admin',body});const value=await response.json();need(response.status>=400&&value.code==='22023','ASF_INVALID_INPUT')
    }
  })
  await test('existing verified-looking email still creates only pending review; no automatic binding or role',async()=>{
    const result=await admin.executeMutation(admin.createMutationIntent('request_staff_access',{p_email:'student@example.invalid',p_role:'ADMIN'}))
    need((await f.sql(`select bound_user is null from queue_private.staff_review_requests where id=${q(result.request_id)};`)).trim()==='t','ASF_EMAIL_AUTO_BINDING')
    need((await f.sql('select jsonb_object_agg(id,to_jsonb(a)) from queue_private.accounts a;')).trim()===beforeRoles&&(await f.sql('select count(*) from auth.users;')).trim()===beforeUsers,'ASF_EMAIL_PROMOTED_OR_CREATED')
  })
  await test('lost committed staff response stays unknown and never replays a non-idempotent request',async()=>{
    const store=new Map();let attempts=0
    const adapter={...admin,executeMutation:async(intent,options)=>{attempts++;await admin.executeMutation(intent,options);throw new QueueRequestError({outcome:'unknown'})}}
    const controller=createAdminWorkspace(adapter,{contract:'installed-directory',getAccess:()=>({actor:f.users.admin,context:{role:'ADMIN',enabled:true}}),store:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},withLock:fn=>fn()})
    await controller.refresh();await controller.perform('request_staff_access',{p_email:'lost@example.invalid',p_role:'CASHIER'});await controller.retry();controller.syncAccess();await new Promise(r=>setTimeout(r,100));await controller.retry()
    need(attempts===1&&controller.getState().phase==='unknown'&&!controller.getState().canRetry&&store.size===1,'ASF_UNSAFE_RETRY')
    need((await f.sql("select count(*) from queue_private.staff_review_requests where email='lost@example.invalid';")).trim()==='1','ASF_LOST_RECEIPT_DUPLICATED');controller.stop()
  })
  await test('existing UUID-based account/counter controls work only in fixture and retain server request keys',async()=>{
    const intent=admin.createMutationIntent('set_account',{p_user:f.users.other,p_role:'CASHIER',p_enabled:true});const first=await admin.executeMutation(intent)
    need(first.role==='CASHIER'&&JSON.stringify(first)===JSON.stringify(await admin.executeMutation(intent)),'ASF_ACCOUNT_REPLAY')
    const counter=admin.createMutationIntent('configure_counter',{p_counter:f.counters[2],p_open:true,p_services:['SOA'],p_cashiers:[f.users.other]});await admin.executeMutation(counter)
    const c=await admin.read('admin_configuration');need(c.staff_assignments.some(x=>x.counter_id===f.counters[2]&&x.account_id===f.users.other),'ASF_COUNTER_ASSIGNMENT')
    for(const [number,code]of ['TP','SOA','PNEP','REF','ADJ'].entries())need(c.counter_services.some(x=>x.counter_id===f.counters[number+1]&&c.services.find(s=>s.id===x.service_id)?.code===code),'ASF_FIXED_ROUTE_CHANGED')
    await admin.executeMutation(admin.createMutationIntent('set_account',{p_user:f.users.other,p_role:'CASHIER',p_enabled:false}));await admin.executeMutation(admin.createMutationIntent('set_account',{p_user:f.users.other,p_role:'CASHIER',p_enabled:true}));await admin.executeMutation(admin.createMutationIntent('set_account',{p_user:f.users.other,p_role:'STUDENT',p_enabled:true}))
    need((await admin.read('admin_staff_directory')).find(x=>x.id===f.users.other).role==='STUDENT','ASF_REVOKE_CASHIER')
  })
  await test('no private request-list endpoint or direct browser table privilege is invented',async()=>{
    const privileges=JSON.parse((await f.sql("select jsonb_build_object('read',has_table_privilege('authenticated','queue_private.staff_review_requests','SELECT'),'insert',has_table_privilege('authenticated','queue_private.staff_review_requests','INSERT'));" )).trim())
    need(!privileges.read&&!privileges.insert,'ASF_PRIVATE_REQUEST_TABLE')
    const directory=await admin.read('admin_staff_directory');need(!JSON.stringify(directory).includes('PENDING_IDENTITY_REVIEW'),'ASF_INVENTED_PENDING_LIST')
  })
  report.result='PASS'
}catch(error){report.result='FAIL';report.failure=/^(ASF|AGO)_[A-Z_]+$/.test(error.message||'')?error.message:'ASF_FIXTURE_STOPPED';report.stage=f.stage||'fixture-preparation';process.exitCode=1}
finally{
  for(const client of clients)await client.removeAllChannels()
  try{await f.stop();report.owned_containers_stopped=true}catch{report.result='FAIL';report.shutdown_failed=true;process.exitCode=1}
  try{
    if(source)need(f.retainedRead(preservationQuery).trim()===source&&f.retainedRead(reviewQuery).trim()===reviewRows,'ASF_RETAINED_SOURCE_CHANGED')
    if(services){const next=await f.retained();need(next.every((x,i)=>x.name.includes('vector')?x.id===services[i].id&&x.definition===services[i].definition:JSON.stringify(x)===JSON.stringify(services[i])),'ASF_RETAINED_SERVICES')}
    if(inventory){const next=await f.inventory();need(JSON.stringify(next.volumes)===JSON.stringify(inventory.volumes)&&JSON.stringify(next.containers)===JSON.stringify([...inventory.containers,...f.owned].sort())&&JSON.stringify(next.networks)===JSON.stringify([...inventory.networks,...(f.networkId?[f.networkId]:[])].sort()),'ASF_RESOURCE_DELTA')}
    report.retained_preservation=true
  }catch{report.result='FAIL';report.retained_preservation=false;process.exitCode=1}
  report.passed=checks.filter(x=>x.result==='PASS').length;report.containers=[...f.owned];report.network=f.networkId?f.network:null
  const path=`tests/integration/results/add_staff_${run}.json`;writeFileSync(path,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({result:report.result,passed:report.passed,evidence:path}))
}
