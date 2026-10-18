/** Remaining local validation. Requires run_local_api_security.py --remaining.
 * No dotenv, migration changes, clock overrides, existing-day reopening or deletes.
 */
import {createClient} from '@supabase/supabase-js';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {localTestTarget} from './local_test_target.mjs';

const base=process.env.QUEUE_E2E_API, anon=process.env.QUEUE_E2E_ANON_KEY,
  service=process.env.QUEUE_E2E_SERVICE_KEY, psql=process.env.QUEUE_E2E_PSQL;
const target=localTestTarget();
if(!anon||!service||!psql)
  throw new Error('Validated local launcher required');
const run=randomUUID().slice(0,8), checks=[], users={}, secrets=[], endpoints=new Set(), clients=[];
const summary={run,target:`${target.api} / 127.0.0.1:${target.dbPort}`,checks};
let baseline, counter, tuitionCounter, tuitionOriginal, fixtureDays, originalService, stream, failed=false;
class Failure extends Error {}
const assert=(v,m)=>{if(!v)throw new Failure(m);};
const q=v=>"'"+String(v).replaceAll("'","''")+"'";
const key=()=>randomUUID();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function sql(statement,readOnly=false){
  const result=spawnSync(psql,['-X','-w','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],
    {input:`begin${readOnly?' read only':''}; ${statement}; commit;`,env:process.env,encoding:'utf8',timeout:30000});
  assert(!result.error&&result.status===0,'Local SQL fixture/catalog operation failed; diagnostics suppressed');
  return result.stdout.trim()?JSON.parse(result.stdout.trim().split('\n').at(-1)):null;
}
function snapshot(){
  const tables=['accounts','student_profiles','tickets','ticket_events','queue_days','service_day_state',
    'staff_counter_assignments','counter_services','operation_requests','admin_audit_events','services','counters'];
  return sql('select jsonb_build_object('+tables.map(t=>`${q(t)},(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from queue_private.${t} x)`).join(',')+')',true);
}
function normalized(table,row){
  const result={...row};
  // Approved positive configuration tests restore business values. Their real
  // audit timestamps must not be forged back to old values.
  if(table==='services'&&row.code==='PNEP'||table==='counters'&&[1,5].includes(row.number))delete result.updated_at;
  return result;
}
function preserved(){
  const after=snapshot();
  for(const [table,rows] of Object.entries(baseline)){
    const hashes=new Set(after[table].map(r=>digest(normalized(table,r))));
    assert(rows.every(r=>hashes.has(digest(normalized(table,r)))),'Pre-existing fixture or restored configuration changed');
  }
  summary.existing_fixtures_preserved=true;
}
async function http(path,{who,body,method='GET',schema='queue_api',authKey=anon,token,signal}={}){
  const url=new URL(path,base); assert(url.origin===base,'Non-local HTTP request refused');
  endpoints.add(`${method} ${url.pathname}`);
  const headers={apikey:authKey,Authorization:`Bearer ${token||users[who]?.token||anon}`,
    'Accept-Profile':schema};
  if(method!=='GET')headers['Content-Profile']=schema;
  if(body!==undefined)headers['Content-Type']='application/json';
  const response=await fetch(url,{method,headers,body:body===undefined?undefined:JSON.stringify(body),
    redirect:'error',signal:signal||AbortSignal.timeout(15000)});
  let data;try{data=await response.json();}catch{data=null;}
  return{ok:response.ok,status:response.status,data};
}
const rpc=(who,name,body={},options={})=>http(`/rest/v1/rpc/${name}`,{who,method:'POST',body,...options});
function ok(r){assert(r.ok,`Authorized HTTP operation failed (status ${r.status})`);return r.data;}
function denied(r,code,message){assert(!r.ok&&r.data?.code===code&&(!message||r.data.message.includes(message)),
  'Unexpected HTTP rejection or unauthorized success');}
async function test(name,body,skip){
  if(skip){checks.push({name,result:'SKIP',reason:skip});console.log(`SKIP: ${name}`);return;}
  try{await body();checks.push({name,result:'PASS'});console.log(`PASS: ${name}`);}
  catch(error){checks.push({name,result:'FAIL',reason:error instanceof Failure?error.message:'Harness exception; raw output suppressed'});failed=true;throw error;}
}
async function subject(name,role){
  const email=`queue-gap-${run}-${name}@example.invalid`,password=randomBytes(32).toString('base64url');
  const user=ok(await http('/auth/v1/admin/users',{method:'POST',authKey:service,token:service,
    body:{email,password,email_confirm:true,user_metadata:{display_name:`PRIVATE-GAP-${run}-${name}`}}}));
  const signed=ok(await http('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}}));
  assert(user.id&&signed.access_token,'Local Auth setup failed');users[name]={id:user.id,token:signed.access_token,role};
  secrets.push(user.id,email,signed.access_token,`PRIVATE-GAP-${run}-${name}`);
}
function mint(owner,day,status='WAITING'){
  return sql(`select 1 from queue_private.settings where id for update;
    insert into queue_private.service_day_state(queue_day_id,service_id)
      select ${q(day.id)},id from queue_private.services where code='ADJ' on conflict do nothing;
    update queue_private.service_day_state set last_number=last_number+1 where queue_day_id=${q(day.id)}
      and service_id=(select id from queue_private.services where code='ADJ');
    update queue_private.settings set last_wait_position=last_wait_position+1 where id;
    insert into queue_private.tickets(owner_id,queue_day_id,service_id,sequence_number,wait_position,status,issued_at,served_at)
      select ${q(owner)},ds.queue_day_id,ds.service_id,ds.last_number,st.last_wait_position,
        ${q(status)}::queue_private.ticket_status,
        (d.business_date::timestamp+interval '9 hours') at time zone 'Asia/Manila',
        case when ${q(status)}='SERVED' then (d.business_date::timestamp+interval '10 hours') at time zone 'Asia/Manila' end
      from queue_private.service_day_state ds cross join queue_private.settings st
      join queue_private.queue_days d on d.id=ds.queue_day_id where ds.queue_day_id=${q(day.id)}
      and ds.service_id=(select id from queue_private.services where code='ADJ');
    insert into queue_private.ticket_events(ticket_id,actor_id,event_type,to_status)
      select id,owner_id,'ISSUED','WAITING' from queue_private.tickets where owner_id=${q(owner)} and queue_day_id=${q(day.id)}
      order by sequence_number desc limit 1;
    insert into queue_private.ticket_events(ticket_id,actor_id,event_type,from_status,to_status)
      select id,owner_id,'SERVED','CALLED','SERVED' from queue_private.tickets where owner_id=${q(owner)}
      and queue_day_id=${q(day.id)} and status='SERVED' and ${q(status)}='SERVED' order by sequence_number desc limit 1;
    select jsonb_build_object('id',id,'number',sequence_number) from queue_private.tickets
      where owner_id=${q(owner)} and queue_day_id=${q(day.id)} order by sequence_number desc limit 1`);
}
function ticketState(id){return sql(`select to_jsonb(t) from queue_private.tickets t where id=${q(id)}`,true);}
function replayCount(who,k){return sql(`select count(*) from queue_private.operation_requests where actor_id=${q(users[who].id)} and request_key=${q(k)}`,true);}
async function holdMutex(){
  const child=spawn(psql,['-X','-w','-qAt','-v','ON_ERROR_STOP=1'],{env:{...process.env,PGAPPNAME:`queue-gap-lock-${run}`},stdio:['pipe','pipe','pipe']});
  let buffered='';
  const done=new Promise(resolve=>child.once('close',code=>resolve(code)));
  const ready=new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Failure('Mutex fixture did not become ready')),4000);
    child.stdout.on('data',data=>{buffered+=data.toString();if(buffered.includes('QUEUE_MUTEX_HELD')){clearTimeout(timeout);resolve();}});
    child.once('error',()=>{clearTimeout(timeout);reject(new Failure('Mutex fixture process failed'));});
  });
  child.stderr.on('data',()=>{});
  child.stdin.end("begin; select 1 from queue_private.settings where id for update; select 'QUEUE_MUTEX_HELD'; select pg_sleep(8); commit;");
  await ready;return {done};
}
function privacy(event){
  const allowed=['counter_id','counter_label','is_open','ticket_label','service_code','business_date','updated_at'];
  for(const row of [event.new,event.old])if(row)assert(Object.keys(row).every(k=>allowed.includes(k)),'Unexpected public Realtime field');
  assert(secrets.every(s=>!JSON.stringify(event).includes(s)),'Private value leaked in public payload');
}
async function connectStream(){
  const sockets=[],events=[],systems=[],statuses=[];
  class Transport extends WebSocket{constructor(...args){super(...args);sockets.push(this);}}
  const client=createClient(base,anon,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    realtime:{transport:Transport,reconnectAfterMs:()=>200,logger:()=>{}}});clients.push(client);
  await client.realtime.setAuth(anon);
  const channel=client.channel(`queue-gap-${run}`).on('system',{},p=>systems.push(p))
    .on('postgres_changes',{event:'*',schema:'queue_display',table:'counter_state'},p=>events.push(p));
  channel.subscribe(status=>statuses.push(status));
  const s={client,channel,sockets,events,systems,statuses};await ready(s,0);return s;
}
async function ready(s,start){
  const deadline=Date.now()+20000;
  while(Date.now()<deadline){if(s.systems.slice(start).some(p=>p.extension==='postgres_changes'&&p.status==='ok'))return;await delay(100);}
  throw new Failure('Realtime database-listener readiness timed out');
}
async function observed(s,start,label){
  const deadline=Date.now()+12000;
  while(Date.now()<deadline){const e=s.events.slice(start).find(e=>e.new.counter_id===counter.id&&e.new.ticket_label===label);if(e){privacy(e);return;}await delay(100);}
  throw new Failure('Expected public update was not delivered');
}

try{
  baseline=snapshot();
  const initial=sql(`select jsonb_build_object('today',(clock_timestamp() at time zone 'Asia/Manila')::date,
    'day',(select jsonb_build_object('id',id,'closed',closed_at is not null) from queue_private.queue_days
      where business_date=(clock_timestamp() at time zone 'Asia/Manila')::date),
    'active',(select count(*) from queue_private.tickets where status in ('WAITING','CALLED')),
    'accounts',(select count(*) from queue_private.accounts),'tickets',(select count(*) from queue_private.tickets))`,true);
  summary.initial_state=initial; // Remove the internal queue-day UUID from persisted evidence.
  summary.initial_state.day=initial.day?{closed:initial.day.closed}:null;
  await test('Existing fixture baseline is captured without active operational work',async()=>assert(initial.active===0,'Active work found; isolated validation stopped'));
  for(const [name,role]of[['admin','ADMIN'],['cashierA','CASHIER'],['cashierB','CASHIER'],['request','STUDENT'],['quota','STUDENT'],['issuer','STUDENT']])await subject(name,role);
  sql(Object.values(users).map(u=>`update queue_private.accounts set role=${q(u.role)} where id=${q(u.id)}`).join(';'));
  counter=sql(`select jsonb_build_object('id',id,'label',label) from queue_private.counters c where number=5 and not is_open
    and not exists(select 1 from queue_private.staff_counter_assignments x where x.counter_id=c.id)`,true);
  assert(counter?.id,'Spare Counter 5 unavailable');
  tuitionOriginal=sql(`select jsonb_build_object('id',c.id,'open',c.is_open,'cashiers',
    coalesce((select jsonb_agg(account_id) from queue_private.staff_counter_assignments where counter_id=c.id),'[]'))
    from queue_private.counters c where number=1`,true);
  tuitionCounter=tuitionOriginal.id;
  originalService=sql("select jsonb_build_object('name',name,'enabled',enabled) from queue_private.services where code='PNEP'",true);
  assert(sql("select count(*) from queue_private.tickets t join queue_private.services s on s.id=t.service_id where s.code='PNEP' and status in ('WAITING','CALLED')",true)===0,'Service configuration test would affect active work');
  const dayIds=[key(),key()];
  fixtureDays=sql(`insert into queue_private.queue_days(id,business_date,timezone_snapshot)
    select ${q(dayIds[0])},coalesce(min(business_date),(clock_timestamp() at time zone 'Asia/Manila')::date)-2,'Asia/Manila' from queue_private.queue_days;
    insert into queue_private.queue_days(id,business_date,timezone_snapshot)
    select ${q(dayIds[1])},min(business_date)+1,'Asia/Manila' from queue_private.queue_days;
    select jsonb_agg(jsonb_build_object('id',id,'date',business_date) order by business_date) from queue_private.queue_days
      where id in (${dayIds.map(q).join(',')})`);
  assert(fixtureDays?.length===2,'Historical fixture day isolation failed');
  summary.fixture_dates=fixtureDays.map(d=>d.date);
  ok(await rpc('admin','configure_counter',{p_counter:counter.id,p_open:true,p_services:['ADJ'],p_cashiers:[users.cashierA.id,users.cashierB.id],p_request_key:key()}));
  const first=mint(users.request.id,fixtureDays[0]);
  const quotaFirst=mint(users.quota.id,fixtureDays[0]);
  mint(users.quota.id,fixtureDays[1],'SERVED');mint(users.quota.id,fixtureDays[1],'SERVED');
  sql('select queue_private.refresh_display()');
  let currentOwned=false,issued,issueKey=key();
  if(!initial.day){ok(await rpc('admin','manage_day',{p_action:'OPEN',p_date:initial.today,p_request_key:key()}));currentOwned=true;
    ok(await rpc('admin','configure_counter',{p_counter:tuitionCounter,p_open:true,p_services:['TP'],
      p_cashiers:[...tuitionOriginal.cashiers,users.cashierB.id],p_request_key:key()}));}
  const blocked=currentOwned?null:'Existing current business day is preserved; its closed state cannot be changed for testing.';
  await test('Successful student HTTP ticket issuance',async()=>{
    issued=ok(await rpc('issuer','issue_ticket',{p_service:'TP',p_request_key:issueKey}));
    assert(issued.status==='WAITING'&&issued.business_date===initial.today,'Invalid issuance result');
  },blocked);
  await test('Issued ticket numbering and service assignment',async()=>{
    assert(issued.sequence_number===1&&issued.service==='TP','Unexpected new-day numbering or service');
    const row=ticketState(issued.ticket_id);assert(row.owner_id===users.issuer.id,'Issued ticket owner mismatch');
  },blocked);
  await test('HTTP issuance duplicate-request idempotency',async()=>{
    assert(JSON.stringify(ok(await rpc('issuer','issue_ticket',{p_service:'TP',p_request_key:issueKey})))===JSON.stringify(issued),'Duplicate issuance did not replay');
    denied(await rpc('issuer','issue_ticket',{p_service:'SOA',p_request_key:issueKey}),'22023');
  },blocked);
  await test('HTTP issuance rejects a third ticket after two served tickets',async()=>{
    for(let n=0;n<2;n++){
      if(n)ok(await rpc('issuer','issue_ticket',{p_service:'TP',p_request_key:key()}));
      const called=ok(await rpc('cashierB','call_next',{p_counter:tuitionCounter,p_service:'TP',p_request_key:key()}));
      ok(await rpc('cashierB','finish_ticket',{p_ticket:called.ticket_id,p_action:'SERVE',p_request_key:key()}));
    }
    denied(await rpc('issuer','issue_ticket',{p_service:'TP',p_request_key:key()}),'P0001','Daily served-ticket limit');
  },blocked);
  await test('Closed current-day failure is explicit and does not consume its request key',async()=>{
    if(!initial.day)return;
    const k=key();denied(await rpc('issuer','issue_ticket',{p_service:'TP',p_request_key:k}),'P0001','Current queue day is not open');
    assert(replayCount('issuer',k)===0,'Failed issuance consumed an idempotency record');
  },currentOwned?'No pre-existing closed day on this instance':null);
  await test('ADMIN can rename and disable an unused service through HTTP',async()=>{
    const k=key(),args={p_code:'PNEP',p_name:`PNEP local validation ${run}`,p_enabled:false,p_request_key:k};
    const result=ok(await rpc('admin','configure_service',args));
    assert(result.enabled===false,'Service configuration was not applied');
    const repeated=ok(await rpc('admin','configure_service',args));assert(JSON.stringify(result)===JSON.stringify(repeated),'Admin retry did not replay');
    assert(replayCount('admin',k)===1,'Admin retry duplicated its replay record');
  });
  await test('ADMIN restores original service business values through HTTP',async()=>{
    ok(await rpc('admin','configure_service',{p_code:'PNEP',p_name:originalService.name,p_enabled:originalService.enabled,p_request_key:key()}));
    const restored=sql("select jsonb_build_object('name',name,'enabled',enabled) from queue_private.services where code='PNEP'",true);
    assert(JSON.stringify(restored)===JSON.stringify(originalService),'Service business values were not restored');
  });
  await test('Disabled CASHIER loses protected access with its existing Auth session',async()=>{
    ok(await rpc('cashierA','staff_queue'));
    ok(await rpc('admin','set_account',{p_user:users.cashierA.id,p_role:'CASHIER',p_enabled:false,p_request_key:key()}));
    denied(await rpc('cashierA','staff_queue'),'42501');
    denied(await rpc('cashierA','call_next',{p_counter:counter.id,p_service:'ADJ',p_request_key:key()}),'42501');
    denied(await rpc('cashierA','finish_ticket',{p_ticket:first.id,p_action:'SERVE',p_request_key:key()}),'42501');
    ok(await http('/auth/v1/user',{who:'cashierA'}));
    ok(await rpc('admin','set_account',{p_user:users.cashierA.id,p_role:'CASHIER',p_enabled:true,p_request_key:key()}));
    ok(await rpc('admin','configure_counter',{p_counter:counter.id,p_open:true,p_services:['ADJ'],p_cashiers:[users.cashierA.id,users.cashierB.id],p_request_key:key()}));
  });
  await test('Public Realtime listener is ready before test mutations',async()=>{stream=await connectStream();});
  let callKey=key();
  await test('Interrupted in-flight HTTP call can be retried safely with the same key',async()=>{
    const hold=await holdMutex();const abort=new AbortController();
    const args={p_counter:counter.id,p_service:'ADJ',p_request_key:callKey};
    const pending=rpc('cashierA','call_next',args,{signal:abort.signal}).then(()=>({kind:'response'}),error=>({kind:error.name}));
    let waiting=false;const deadline=Date.now()+5000;
    while(Date.now()<deadline){waiting=sql("select to_jsonb(exists(select 1 from pg_stat_activity where wait_event_type='Lock' and query ilike '%call_next%'))",true);if(waiting)break;await delay(100);}
    assert(waiting,'HTTP call did not reach the controlled database lock');abort.abort();
    assert((await pending).kind==='AbortError','HTTP interruption was not observed');assert(await hold.done===0,'Mutex fixture failed');
    // Cancellation may roll back or commit. The retry must reconcile either outcome.
    summary.interrupted_request_committed_before_retry=replayCount('cashierA',callKey)===1;
    const result=ok(await rpc('cashierA','call_next',args));assert(result.ticket_id===first.id,'Interrupted retry claimed the wrong ticket');
    assert(replayCount('cashierA',callKey)===1,'Interrupted retry duplicated its operation');
    assert(sql(`select count(*) from queue_private.ticket_events where ticket_id=${q(first.id)} and event_type='CALLED'`,true)===1,'Interrupted retry called twice');
  });
  await test('Committed HTTP call with discarded response replays without another action',async()=>{
    const args={p_counter:counter.id,p_service:'ADJ',p_request_key:callKey};
    const discarded=await rpc('cashierA','call_next',args);assert(discarded.ok,'Committed replay failed');
    const result=ok(await rpc('cashierA','call_next',args));assert(result.ticket_id===first.id,'Replay did not identify original ticket');
    denied(await rpc('cashierA','call_next',{...args,p_service:'TP'}),'22023');
  });
  await test('Busy cashier disablement and demotion are rejected without losing service authority',async()=>{
    for(const config of [{p_role:'STUDENT',p_enabled:true},{p_role:'CASHIER',p_enabled:false}])
      denied(await rpc('admin','set_account',{p_user:users.cashierA.id,...config,p_request_key:key()}),'P0001','Resolve called tickets');
    ok(await rpc('cashierA','staff_queue'));
  });
  await test('Concurrent service completion and cashier demotion preserve ticket correctness',async()=>{
    const [served,changed]=await Promise.all([
      rpc('cashierA','finish_ticket',{p_ticket:first.id,p_action:'SERVE',p_request_key:key()}),
      rpc('admin','set_account',{p_user:users.cashierA.id,p_role:'STUDENT',p_enabled:true,p_request_key:key()})]);
    ok(served);if(!changed.ok){denied(changed,'P0001','Resolve called tickets');
      ok(await rpc('admin','set_account',{p_user:users.cashierA.id,p_role:'STUDENT',p_enabled:true,p_request_key:key()}));}
    assert(ticketState(first.id).status==='SERVED','Service lost during role change');
    denied(await rpc('cashierA','staff_queue'),'42501');
    denied(await rpc('cashierA','call_next',{p_counter:counter.id,p_service:'ADJ',p_request_key:callKey}),'42501');
    summary.role_race_demotion_initially_blocked=!changed.ok;
  });
  await test('Failed cashier action rolls back state and leaves no replay record',async()=>{
    assert(ok(await rpc('cashierB','call_next',{p_counter:counter.id,p_service:'ADJ',p_request_key:key()})).ticket_id===quotaFirst.id,'Wrong quota fixture called');
    const before=digest(ticketState(quotaFirst.id)),k=key();
    denied(await rpc('cashierB','finish_ticket',{p_ticket:quotaFirst.id,p_action:'INVALID',p_request_key:k}),'22023');
    assert(replayCount('cashierB',k)===0&&digest(ticketState(quotaFirst.id))===before,'Failed action changed ticket/replay state');
  });
  await test('Serving a historical ticket uses its issuance-day quota rather than completion date',async()=>{
    const k=key(),args={p_ticket:quotaFirst.id,p_action:'SERVE',p_request_key:k};
    const served=ok(await rpc('cashierB','finish_ticket',args));
    assert(JSON.stringify(ok(await rpc('cashierB','finish_ticket',args)))===JSON.stringify(served),'Serve retry did not replay');
    const counts=sql(`select jsonb_object_agg(business_date,n) from (select d.business_date,count(*) n from queue_private.tickets t
      join queue_private.queue_days d on d.id=t.queue_day_id where t.owner_id=${q(users.quota.id)} and t.status='SERVED' group by d.business_date) x`,true);
    assert(counts[fixtureDays[0].date]===1&&counts[fixtureDays[1].date]===2,'Quota charged to wrong issuance day');
    assert(ticketState(quotaFirst.id).served_at.slice(0,10)===new Date().toISOString().slice(0,10),'Historical ticket was not completed now');
  });
  const second=mint(users.quota.id,fixtureDays[0]);
  await test('Second served ticket for the same historical issuance day is allowed over HTTP',async()=>{
    assert(ok(await rpc('cashierB','call_next',{p_counter:counter.id,p_service:'ADJ',p_request_key:key()})).ticket_id===second.id,'Wrong second quota ticket');
    ok(await rpc('cashierB','finish_ticket',{p_ticket:second.id,p_action:'SERVE',p_request_key:key()}));
  });
  const third=mint(users.quota.id,fixtureDays[0]);
  await test('Third service completion is rejected atomically for its issuance day',async()=>{
    assert(ok(await rpc('cashierB','call_next',{p_counter:counter.id,p_service:'ADJ',p_request_key:key()})).ticket_id===third.id,'Wrong third quota ticket');
    const k=key(),before=digest(ticketState(third.id));
    denied(await rpc('cashierB','finish_ticket',{p_ticket:third.id,p_action:'SERVE',p_request_key:k}),'P0001','Daily served-ticket limit');
    assert(replayCount('cashierB',k)===0&&digest(ticketState(third.id))===before,'Quota failure was not atomic');
  });
  await test('Actual clock rollover while issuance waits on a lock',async()=>{},
    'Database clock is not injectable; changing host time or reopening current-day fixtures is prohibited. Historical quota behavior is tested separately.');
  await test('Realtime reconnect restores the listener and snapshot after an offline mutation',async()=>{
    const systemStart=stream.systems.length,socketStart=stream.sockets.length;
    const socket=stream.sockets.at(-1),closed=new Promise(resolve=>socket.addEventListener('close',resolve,{once:true}));
    socket.close(4000,'local reconnect validation');await closed;
    ok(await rpc('cashierB','finish_ticket',{p_ticket:third.id,p_action:'SKIP',p_request_key:key()}));
    await ready(stream,systemStart);assert(stream.sockets.length>socketStart,'WebSocket transport was not recreated');
    const rows=ok(await http('/rest/v1/counter_state?select=*',{schema:'queue_display'}));
    assert(rows.find(r=>r.counter_id===counter.id)?.ticket_label===null,'Snapshot did not reconcile offline change');
    summary.reconnect_socket_count=stream.sockets.length;
  });
  await test('Updates after reconnect arrive and all captured public payloads remain sanitized',async()=>{
    const start=stream.events.length;
    assert(ok(await rpc('cashierB','call_next',{p_counter:counter.id,p_service:'ADJ',p_request_key:key()})).ticket_id===third.id,'Reconnected call selected wrong ticket');
    await observed(stream,start,`ADJ-${String(third.number).padStart(3,'0')}`);
    assert(stream.events.length>0,'No positive Realtime control events');stream.events.forEach(privacy);
    summary.public_events_checked=stream.events.length;
  });
  await test('Only new fixture days close and spare counter business values are restored',async()=>{
    for(const day of fixtureDays)ok(await rpc('admin','manage_day',{p_action:'CLOSE',p_date:day.date,p_request_key:key()}));
    if(currentOwned)ok(await rpc('admin','manage_day',{p_action:'CLOSE',p_date:initial.today,p_request_key:key()}));
    ok(await rpc('admin','configure_counter',{p_counter:counter.id,p_open:false,p_services:['ADJ'],p_cashiers:[],p_request_key:key()}));
    if(currentOwned)ok(await rpc('admin','configure_counter',{p_counter:tuitionCounter,p_open:tuitionOriginal.open,
      p_services:['TP'],p_cashiers:tuitionOriginal.cashiers,p_request_key:key()}));
    assert(sql("select count(*) from queue_private.tickets where status in ('WAITING','CALLED')",true)===0,'Active fixture work remains');
  });
  await test('Existing concurrency/API fixtures and restored configuration are preserved',async()=>preserved());
}catch(error){
  failed=true;if(!checks.some(c=>c.result==='FAIL'))checks.push({name:'Local fixture/test setup',result:'FAIL',reason:error instanceof Failure?error.message:'Harness exception; raw diagnostics suppressed'});
  console.log('STOP: validation stopped; no reset, policy changes or forced cleanup performed.');
}finally{
  await Promise.allSettled(clients.map(c=>c.removeAllChannels()));
  if(baseline&&!summary.existing_fixtures_preserved){try{preserved();}catch{checks.push({name:'Existing fixture preservation',result:'FAIL',reason:'Preservation check failed or intentional configuration has not been restored'});failed=true;}}
  summary.passed=checks.filter(c=>c.result==='PASS').length;summary.failed=checks.filter(c=>c.result==='FAIL').length;summary.skipped=checks.filter(c=>c.result==='SKIP').length;
  summary.endpoints=[...endpoints].sort();summary.new_fixtures_retained=true;
  const dir=new URL('./results/',import.meta.url);mkdirSync(dir,{recursive:true});
  const path=new URL(`remaining_api_${run}.json`,dir);writeFileSync(path,JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
  console.log(`Summary: ${summary.passed} passed; ${summary.failed} failed; ${summary.skipped} skipped.`);
  console.log(`Sanitized results: ${fileURLToPath(path)}`);process.exitCode=failed?1:0;
}
