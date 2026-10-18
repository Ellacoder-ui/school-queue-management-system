/** Positive current-day HTTP acceptance, isolated populated upgrade ONLY.
 * Credentials exist only in process memory. Fail fast; never reset/erase fixtures.
 */
import {createClient} from '@supabase/supabase-js'
import {randomBytes,randomUUID,createHash} from 'node:crypto'
import {spawn,spawnSync} from 'node:child_process'
import {writeFileSync} from 'node:fs'
import {localTestTarget} from './local_test_target.mjs'

const target=localTestTarget()
if(!target.isolated||!target.project.startsWith('sq-routing-upgrade-'))throw Error('Disposable upgrade required')
const base=target.api,anon=process.env.QUEUE_E2E_ANON_KEY,service=process.env.QUEUE_E2E_SERVICE_KEY,psql=process.env.QUEUE_E2E_PSQL
if(!anon||!service||!psql)throw Error('Guarded launcher required')
const run=randomUUID().slice(0,8),checks=[],users={},secrets=['PRIVATE-SYNTHETIC-PERSON','SYNTHETIC-PRIVATE-001',...Array.from({length:7},(_,i)=>`10000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`)],clients=[],endpoints=new Set()
const summary={run,project:target.project,target:base,checks}
const q=v=>"'"+String(v).replaceAll("'","''")+"'",key=()=>randomUUID(),delay=ms=>new Promise(r=>setTimeout(r,ms))
class Failure extends Error{}
const assert=(v,m)=>{if(!v)throw new Failure(m)}
function sql(statement,readonly=false){
 const r=spawnSync(psql,['-X','-w','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],
  {input:`begin${readonly?' read only':''}; ${statement}; commit;`,env:process.env,encoding:'utf8',timeout:30000})
 assert(!r.error&&r.status===0,'Isolated SQL failed; sensitive diagnostics suppressed')
 return r.stdout.trim()?JSON.parse(r.stdout.trim().split('\n').at(-1)):null
}
function history(){return sql(`select jsonb_build_object('tickets',(select jsonb_agg(md5(to_jsonb(t)::text) order by t.id) from queue_private.tickets t where owner_id::text like '10000000-%'),
 'events',(select jsonb_agg(md5(to_jsonb(e)::text) order by e.id) from queue_private.ticket_events e join queue_private.tickets t on t.id=e.ticket_id where t.owner_id::text like '10000000-%'),
 'requests',(select jsonb_agg(md5(to_jsonb(r)::text) order by r.request_key) from queue_private.operation_requests r where actor_id::text like '10000000-%'),
 'audits',(select jsonb_agg(md5(to_jsonb(a)::text) order by a.id) from queue_private.admin_audit_events a where actor_id::text like '10000000-%'))`,true)}
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex')
async function http(path,{who,body,method='GET',schema='queue_api',authKey=anon,token,signal}={}){
 const url=new URL(path,base);assert(url.origin===base,'Nonlocal HTTP refused');endpoints.add(`${method} ${url.pathname}`)
 const headers={apikey:authKey,Authorization:`Bearer ${token||users[who]?.token||anon}`,'Accept-Profile':schema}
 if(method!=='GET')headers['Content-Profile']=schema
 if(body!==undefined)headers['Content-Type']='application/json'
 const r=await fetch(url,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:signal||AbortSignal.timeout(15000)})
 let data;try{data=await r.json()}catch{data=null}return{ok:r.ok,status:r.status,data}
}
const rpc=(who,name,body={},options={})=>http(`/rest/v1/rpc/${name}`,{who,method:'POST',body,...options})
function ok(r){assert(r.ok,`HTTP success expected; status ${r.status}, code ${r.data?.code||'unavailable'}`);return r.data}
function denied(r,code,msg){assert(!r.ok&&r.data?.code===code&&(!msg||r.data.message?.includes(msg)),'Expected specific rejection missing')}
async function test(name,fn){try{await fn();checks.push({name,result:'PASS'});console.log(`PASS: ${name}`)}catch(e){checks.push({name,result:'FAIL',reason:e instanceof Failure?e.message:'Harness failure; raw diagnostics suppressed'});throw e}}
async function subject(name,role){
 const email=`routing-http-${run}-${name}@example.invalid`,password=randomBytes(32).toString('base64url')
 const u=ok(await http('/auth/v1/admin/users',{method:'POST',authKey:service,token:service,body:{email,password,email_confirm:true,user_metadata:{role:'ADMIN',display_name:`PRIVATE-${run}-${name}`}}}))
 const s=ok(await http('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}}))
 assert(u.id&&s.access_token,'Auth fixture failed');users[name]={id:u.id,token:s.access_token}
 secrets.push(u.id,email,s.access_token,`PRIVATE-${run}-${name}`)
 sql(`update queue_private.accounts set role=${q(role)} where id=${q(u.id)}`)
}
const issue=(who,service='TP',k=key(),options={})=>rpc(who,'issue_ticket',{p_service:service,p_request_key:k},options)
let counters,today,stream,baseline,failed=false
const config=(n,cashiers,open=true,services)=>rpc('admin','configure_counter',{p_counter:counters[n],p_open:open,p_services:services||[{1:'TP',2:'SOA',3:'PNEP',4:'REF',5:'ADJ'}[n]],p_cashiers:cashiers,p_request_key:key()})
const call=(who='cashA',n=1,service='TP',k=key())=>rpc(who,'call_next',{p_counter:counters[n],p_service:service,p_request_key:k})
const finish=(ticket,action='SERVE',who='cashA',k=key())=>rpc(who,'finish_ticket',{p_ticket:ticket,p_action:action,p_request_key:k})
function eventCount(ticket,event){return sql(`select count(*) from queue_private.ticket_events where ticket_id=${q(ticket)} and event_type=${q(event)}`,true)}
function privacy(event){
 const fields=event.table==='counter_state'?['counter_id','counter_label','is_open','ticket_label','service_code','business_date','updated_at']:['service_code','business_date','waiting_count','updated_at']
 for(const row of [event.new,event.old])if(row)assert(Object.keys(row).every(k=>fields.includes(k)),'Unexpected public field')
 assert(secrets.every(v=>!JSON.stringify(event).includes(v)),'Private value in public Realtime payload')
}
async function ready(s,start=0){
 const until=Date.now()+20000
 while(Date.now()<until){if(new Set(s.systems.slice(start).filter(p=>p.extension==='postgres_changes'&&p.status==='ok').map(p=>p.table)).size>=2)return;await delay(100)}
 throw new Failure('Both public subscriptions did not acknowledge readiness')
}
async function connect(){
 const sockets=[],systems=[],events=[]
 class Transport extends WebSocket{constructor(...args){super(...args);sockets.push(this)}}
 const client=createClient(base,anon,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},realtime:{transport:Transport,reconnectAfterMs:()=>300,logger:()=>{}}});clients.push(client)
 await client.realtime.setAuth(anon)
 for(const table of ['counter_state','service_state'])client.channel(`routing-${run}-${table}`).on('system',{},p=>systems.push({...p,table}))
  .on('postgres_changes',{event:'*',schema:'queue_display',table},p=>events.push(p)).subscribe()
 const s={client,sockets,systems,events};await ready(s);return s
}
async function observed(start,predicate){const until=Date.now()+12000;while(Date.now()<until){if(stream.events.slice(start).some(predicate))return;await delay(100)}throw new Failure('Expected Realtime event missing')}
async function holdMutex(){
 const child=spawn(psql,['-X','-w','-qAt','-v','ON_ERROR_STOP=1'],{env:{...process.env,PGAPPNAME:`routing-lock-${run}`},stdio:['pipe','pipe','pipe']})
 const done=new Promise(r=>child.once('close',r));let text=''
 const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Failure('Mutex readiness failed')),4000)
 child.stdout.on('data',d=>{text+=d;if(text.includes('HELD')){clearTimeout(timer);resolve()}});child.once('error',()=>reject(new Failure('Mutex process failed')))})
 child.stderr.on('data',()=>{});child.stdin.end("begin; select 1 from queue_private.settings where id for update; select 'HELD'; select pg_sleep(3); commit;")
 await ready;return{done}
}
try{
 baseline=digest(history())
 counters=sql('select jsonb_object_agg(number,id) from queue_private.counters',true)
 const ctx=ok(await rpc(null,'public_queue_context',{}, {schema:'queue_display'}));today=ctx.business_date
 assert(!sql(`select to_jsonb(exists(select 1 from queue_private.queue_days where business_date=${q(today)}))`,true),'Current day already exists; refusal to reopen')
 await test('Canonical matrix and public/private boundary',async()=>{
  assert(JSON.stringify(sql(`select jsonb_object_agg(c.number,s.code) from queue_private.counter_services x join queue_private.counters c on c.id=x.counter_id join queue_private.services s on s.id=x.service_id`,true))===JSON.stringify({'1':'TP','2':'SOA','3':'PNEP','4':'REF','5':'ADJ'}),'Wrong matrix')
  denied(await http('/rest/v1/accounts',{schema:'queue_private'}),'PGRST106')
  denied(await issue(null),'42501')
 })
 await test('Historical multi-service configuration replay preserves its exact receipt',async()=>{
  const result=sql(`select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true); set local role authenticated;
   select queue_api.configure_counter(${q(counters[1])},true,array['TP','SOA'],array['10000000-0000-4000-8000-000000000002'::uuid],'20000000-0000-4000-8000-000000000001')`)
  const saved=sql("select result from queue_private.operation_requests where request_key='20000000-0000-4000-8000-000000000001'",true)
  assert(digest(result)===digest(saved)&&baseline===digest(history()),'Historical configuration replay changed history')
  assert(sql('select count(*) from queue_private.counter_services',true)===5,'Replay changed routing')
 })
 await test('Historical cross-service call receipt replays without calling again',async()=>{
  const result=sql(`select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true); set local role authenticated;
   select queue_api.call_next(${q(counters[2])},'TP','20000000-0000-4000-8000-000000000101')`)
  const saved=sql("select result from queue_private.operation_requests where request_key='20000000-0000-4000-8000-000000000101'",true)
  assert(digest(result)===digest(saved)&&baseline===digest(history()),'Historical call replay changed history')
 })
 for(const [name,role]of[['admin','ADMIN'],['cashA','CASHIER'],['cashB','CASHIER'],['student','STUDENT'],['other','STUDENT'],['interrupted','STUDENT'],['race','STUDENT']])await subject(name,role)
 await test('ADMIN opens a new current business day through HTTP',async()=>{
  ok(await rpc('admin','manage_day',{p_action:'OPEN',p_date:today,p_request_key:key()}))
  const c=ok(await rpc(null,'public_queue_context',{}, {schema:'queue_display'}));assert(c.queue_day_open&&c.business_date===today&&c.timezone==='Asia/Manila','Open current context incorrect')
 })
 const staff=[users.cashA.id,users.cashB.id,'10000000-0000-4000-8000-000000000002']
 await test('ADMIN closes/opens its fixed counter and assigns eligible cashiers',async()=>{ok(await config(1,staff,false));ok(await config(1,staff));assert(ok(await rpc('cashA','my_context')).cashier_counters.some(c=>c.counter_number===1&&c.service_codes.join()==='TP'),'Cashier context incorrect')})
 await test('Invalid ADMIN service arrays reject atomically',async()=>{
  const before=sql('select count(*) from queue_private.operation_requests',true)
  for(const codes of [[],['SOA'],['TP','SOA'],['TP','TP']])denied(await config(1,staff,false,codes),'22023')
  assert(sql('select count(*) from queue_private.operation_requests',true)===before,'Rejected config wrote a replay record')
 })
 await test('Student/cashier cannot administer; ADMIN cannot call',async()=>{
  for(const who of ['student','cashA'])denied(await rpc(who,'configure_counter',{p_counter:counters[1],p_open:false,p_services:['TP'],p_cashiers:[],p_request_key:key()}),'42501')
  denied(await call('admin'),'42501');denied(await rpc('student','set_account',{p_user:users.student.id,p_role:'ADMIN',p_enabled:true,p_request_key:key()}),'42501')
 })
 await test('Cashier foreign-service and unassigned-counter calls reject',async()=>{denied(await call('cashA',1,'SOA'),'P0001','Service not assigned');denied(await call('cashA',2,'SOA'),'42501')})
 await test('Both anonymous public Realtime tables acknowledge readiness',async()=>{stream=await connect()})
 let first,second,issueKey=key()
 await test('Positive HTTP issuance has correct current-day service and numbering',async()=>{first=ok(await issue('student','TP',issueKey));assert(first.sequence_number===1&&first.service==='TP'&&first.business_date===today&&first.status==='WAITING','Issuance contract incorrect')})
 await test('Eight same-key HTTP issuance retries allocate exactly one ticket/event',async()=>{const responses=await Promise.all(Array.from({length:8},()=>issue('student','TP',issueKey)));assert(responses.every(r=>digest(ok(r))===digest(first))&&eventCount(first.ticket_id,'ISSUED')===1,'Duplicate issuance');denied(await issue('student','SOA',issueKey),'22023')})
 await test('One active ticket applies across services; next owner receives TP-002',async()=>{denied(await issue('student','SOA'),'P0001','Active ticket');second=ok(await issue('other'));assert(second.sequence_number===2,'Number sequence incorrect')})
 await test('Actual call appears only at fixed TP Counter 1',async()=>{const start=stream.events.length;assert(ok(await call()).ticket_id===first.ticket_id,'Wrong first ticket');await observed(start,e=>e.table==='counter_state'&&e.new.counter_id===counters[1]&&e.new.ticket_label==='TP-001'&&e.new.service_code==='TP')})
 await test('Eight concurrent skip retries preserve number and emit once',async()=>{const k=key();const responses=await Promise.all(Array.from({length:8},()=>finish(first.ticket_id,'SKIP','cashA',k)));assert(responses.every(r=>digest(ok(r))===digest(responses[0].data))&&eventCount(first.ticket_id,'SKIPPED')===1,'Skip replay duplicated');assert(sql(`select sequence_number from queue_private.tickets where id=${q(first.ticket_id)}`,true)===1,'Skip renumbered ticket')})
 await test('Skip moves to tail; eventual service counts exactly once',async()=>{assert(ok(await call()).ticket_id===second.ticket_id,'Skip did not move behind waiter');ok(await finish(second.ticket_id));assert(ok(await call()).ticket_id===first.ticket_id,'Skipped ticket not next');ok(await finish(first.ticket_id));assert(eventCount(first.ticket_id,'SERVED')===1,'Skipped quota not counted once')})
 await test('HTTP second service succeeds and third issuance reaches served quota',async()=>{const next=ok(await issue('student'));assert(next.sequence_number===3,'Wrong TP-003');assert(ok(await call()).ticket_id===next.ticket_id,'Wrong quota ticket');ok(await finish(next.ticket_id));for(const r of await Promise.all(Array.from({length:8},()=>issue('student'))))denied(r,'P0001','Daily served-ticket limit');assert(ok(await issue('student','SOA')).sequence_number===1,'Per-service quota leaked')})
 await test('Competing assigned cashiers produce one call and one busy rejection',async()=>{const t=ok(await issue('race'));const results=await Promise.all([call('cashA'),call('cashB')]);assert(results.filter(r=>r.ok).length===1,'Two calls succeeded');denied(results.find(r=>!r.ok),'P0001','Counter busy');assert(eventCount(t.ticket_id,'CALLED')===1,'Duplicate called event');ok(await finish(t.ticket_id))})
 await test('Aborted HTTP issuance reconciles with its original request UUID',async()=>{
  const hold=await holdMutex(),abort=new AbortController(),k=key()
  const pending=issue('interrupted','PNEP',k,{signal:abort.signal}).then(()=> 'response',e=>e.name)
  let waiting=false;const until=Date.now()+2000
  while(Date.now()<until){waiting=sql("select to_jsonb(exists(select 1 from pg_stat_activity where wait_event_type='Lock' and query ilike '%issue_ticket%'))",true);if(waiting)break;await delay(50)}
  assert(waiting,'HTTP issuance never reached controlled lock');abort.abort();assert(await pending==='AbortError','Abort was not observed');assert(await hold.done===0,'Mutex hold failed')
  summary.interrupted_committed_before_retry=sql(`select count(*) from queue_private.operation_requests where actor_id=${q(users.interrupted.id)} and request_key=${q(k)}`,true)===1
  const result=ok(await issue('interrupted','PNEP',k));assert(result.sequence_number===1&&eventCount(result.ticket_id,'ISSUED')===1,'Interrupted retry duplicated issuance')
  assert(digest(ok(await issue('interrupted','PNEP',k)))===digest(result),'Committed response loss replay changed result')
 })
 await test('Disabled CASHIER existing session loses protected authority',async()=>{ok(await rpc('admin','set_account',{p_user:users.cashB.id,p_role:'CASHIER',p_enabled:false,p_request_key:key()}));denied(await rpc('cashB','staff_queue'),'42501');denied(await call('cashB'),'42501');assert(ok(await rpc('cashB','my_context')).enabled===false,'Disabled context incorrect');ok(await http('/auth/v1/user',{who:'cashB'}))})
 await test('Revoked CASHIER existing session uses current STUDENT authority',async()=>{ok(await rpc('admin','set_account',{p_user:users.cashA.id,p_role:'STUDENT',p_enabled:true,p_request_key:key()}));denied(await call('cashA'),'42501');assert(ok(await rpc('cashA','my_context')).role==='STUDENT','Role stayed stale')})
 await test('Realtime reconnect acknowledges both tables and refreshes snapshot',async()=>{
  const start=stream.systems.length,count=stream.sockets.length,socket=stream.sockets.at(-1)
  const closed=new Promise(r=>socket.addEventListener('close',r,{once:true}));socket.close(4000,'isolated reconnect');await closed;await ready(stream,start)
  assert(stream.sockets.length>count,'No new transport');const rows=ok(await http('/rest/v1/counter_state?select=*',{schema:'queue_display'}));assert(rows.length===5&&rows.every(r=>r.ticket_label===null),'Fresh reconnect snapshot incorrect')
 })
 await test('Closing only the newly opened current day clears totals and stays private',async()=>{
  const start=stream.events.length;ok(await rpc('admin','manage_day',{p_action:'CLOSE',p_date:today,p_request_key:key()}))
  await observed(start,e=>e.table==='service_state'&&e.eventType==='DELETE');stream.events.forEach(privacy)
  summary.public_events_checked=stream.events.length;assert(stream.events.length>0,'No public control events')
  assert(!ok(await rpc(null,'public_queue_context',{}, {schema:'queue_display'})).queue_day_open,'Closed day still open')
 })
 await test('Synthetic pre-cutover history remains unchanged',async()=>assert(baseline===digest(history()),'Pre-cutover history changed'))
}catch(e){failed=true;if(!checks.some(c=>c.result==='FAIL'))checks.push({name:'Fixture setup',result:'FAIL',reason:e instanceof Failure?e.message:'Harness failure; raw output suppressed'});console.log('STOP: isolated acceptance failure; no reset or security-policy changes performed.')}
finally{
 await Promise.allSettled(clients.map(c=>c.removeAllChannels()))
 summary.passed=checks.filter(c=>c.result==='PASS').length;summary.failed=checks.filter(c=>c.result==='FAIL').length;summary.skipped=0;summary.endpoints=[...endpoints].sort()
 writeFileSync(new URL(`./results/fixed_routing_http_${run}.json`,import.meta.url),JSON.stringify(summary,null,2)+'\n',{flag:'wx'})
 console.log(`Summary: ${summary.passed} passed; ${summary.failed} failed; 0 skipped.`);process.exitCode=failed?1:0
}
