import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAdminWorkspace, validateAdminWorkspace, parseAdminIntent } from '../../src/lib/adminWorkspace.js'
import { validateAdminMutation, validateAdminReceipt } from '../../src/lib/adminContracts.js'
import { QueueRequestError } from '../../src/services/queueApi.js'
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const actor=id(1), day='2026-10-19', codes=['TP','SOA','PNEP','REF','ADJ']
export function adminFixture() {
  return {version:8,date:day,configuration:{accounts:[],services:codes.map((code,i)=>({id:id(100+i),code,name:code,enabled:true})),
    counters:codes.map((code,i)=>({id:id(200+i),number:i+1,label:`Counter ${i+1}`,is_open:false})),
    counter_services:codes.map((code,i)=>({counter_id:id(200+i),service_id:id(100+i)})),staff_assignments:[],days:[]},
    directory:[{id:actor,email:'admin@example.invalid',identity_sha256:'a'.repeat(64),role:'ADMIN',enabled:true,verified_factors:1,approvals:[{role:'ADMIN',expires_at:'2099-01-01T00:00:00Z'}]}],requests:[],metrics:{total:0,waiting:0,called:0,served:0,forfeited:0},usage:codes.map(service=>({service,total:0})),history:[],history_more:false}
}
const access=()=>({actor,context:{role:'ADMIN',enabled:true}})
const tick=()=>new Promise(resolve=>setTimeout(resolve,0))
function harness(overrides={}) {
  let scope=access();const writes=[],store=new Map(),api={
    read:async()=>adminFixture(),readMyContext:async()=>scope.context,
    createMutationIntent:(operation,parameters)=>({operation,parameters:{...parameters,p_request_key:id(700)}}),
    executeMutation:async intent=>{writes.push(intent);return {request_id:id(800),status:'PENDING_IDENTITY_REVIEW'}},...overrides}
  const controller=createAdminWorkspace(api,{getAccess:()=>scope,store:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},withLock:fn=>fn()})
  return {api,writes,store,controller,scope:value=>{scope=value},ready:()=>controller.refresh(day)}
}
test('admin versioned response requires exact metrics, fixed five routes and reviewed directory fields',()=>{
  assert.equal(validateAdminWorkspace(adminFixture(),day).configuration.counters.length,5)
  for(const damage of [x=>x.version=7,x=>x.metrics.total=99,x=>x.configuration.counters[0].number=5,x=>x.directory[0].role='OWNER',x=>x.usage.pop()]){
    const value=adminFixture();damage(value);assert.throws(()=>validateAdminWorkspace(value,day))
  }
})
test('administration intent parameters reject email-only role grants and malformed counter routes',()=>{
  assert.throws(()=>validateAdminMutation('set_account',{p_email:'admin@example.invalid',p_role:'ADMIN',p_enabled:true}))
  assert.throws(()=>validateAdminMutation('request_staff_access',{p_email:'not-email',p_role:'ADMIN'}))
  assert.throws(()=>validateAdminMutation('configure_counter',{p_counter:id(200),p_open:true,p_services:['TP','SOA'],p_cashiers:[]}))
  assert.throws(()=>validateAdminReceipt('set_account',{user:actor,role:'ADMIN',enabled:true,access_token:'CANARY'}))
})
test('owner cleanup confirms one ineligible assignment without changing account role',async()=>{
  const receipt={counter:id(200),user:id(2),role:'STUDENT',enabled:true,removed:true}
  const writes=[]
  const h=harness({executeMutation:async intent=>{writes.push(intent);return receipt}})
  await h.ready()
  await h.controller.perform('remove_ineligible_counter_assignment',{p_counter:receipt.counter,p_user:receipt.user})
  assert.equal(h.controller.getState().phase,'success')
  assert.equal(h.controller.getState().message,'Ineligible counter assignment removed. Account role and history were preserved.')
  assert.equal(writes.length,1)
  assert.equal(writes[0].operation,'remove_ineligible_counter_assignment')
  assert.equal(writes[0].parameters.p_user,receipt.user)
  assert.equal(h.store.size,0)
  h.controller.stop()
})
test('student and cashier browser context cannot start an administrator read',async()=>{
  let reads=0;const h=harness({read:async()=>{reads++;return adminFixture()}})
  for(const role of ['STUDENT','CASHIER']){h.scope({actor,context:{role,enabled:true}});h.controller.syncAccess(day);await tick();assert.equal(h.controller.getState().data,null)}
  assert.equal(reads,0);h.controller.stop()
})
test('revocation clears directory immediately and discards late responses even without cancellation',async()=>{
  let resolve;const h=harness({read:()=>new Promise(r=>resolve=r)})
  const pending=h.ready();h.scope(null);h.controller.syncAccess(day);resolve(adminFixture());await pending
  assert.equal(h.controller.getState().data,null);assert.equal(h.controller.getState().status,'idle');h.controller.stop()
})
test('missing migration and insufficient AAL/approval never display cached staff data',async()=>{
  const h=harness();await h.ready();assert.equal(h.controller.getState().status,'ready')
  h.api.read=async()=>{throw new QueueRequestError({code:'42501',status:403})};await h.ready()
  assert.equal(h.controller.getState().status,'restricted');assert.equal(h.controller.getState().data,null)
  h.api.read=async()=>{throw new QueueRequestError({code:'PGRST202',status:404})};await h.ready();assert.equal(h.controller.getState().status,'unavailable');h.controller.stop()
})
test('unknown idempotent account change survives reload and explicit replay uses the exact actor/request key',async()=>{
  let fail=true;const dispatched=[];const h=harness({executeMutation:async intent=>{dispatched.push(intent);if(fail)throw new QueueRequestError({outcome:'unknown'});return {user:id(2),role:'CASHIER',enabled:true}}})
  await h.ready();await h.controller.perform('set_account',{p_user:id(2),p_role:'CASHIER',p_enabled:true})
  assert.equal(h.controller.getState().phase,'unknown');assert.equal(h.store.size,1)
  h.controller.syncAccess(day);await tick();assert.equal(h.controller.getState().phase,'unknown')
  await h.controller.perform('set_account',{p_user:id(3),p_role:'ADMIN',p_enabled:true});assert.equal(dispatched.length,1)
  fail=false;await h.controller.retry();assert.deepEqual(dispatched[1],dispatched[0]);assert.equal(h.store.size,0);assert.equal(h.controller.getState().phase,'success');h.controller.stop()
})
test('journal cannot be replayed for a different account or unsupported operation',()=>{
  const text=JSON.stringify({version:1,actor,intent:{operation:'request_staff_access',parameters:{p_email:'x@example.invalid',p_role:'ADMIN',p_request_key:id(700)}}})
  assert.equal(parseAdminIntent(text,actor).actor,actor);assert.throws(()=>parseAdminIntent(text,id(2)))
  assert.throws(()=>parseAdminIntent(text.replace('request_staff_access','promote_approved_admin'),actor))
})
test('current context is rechecked and authorization denial sends no management write',async()=>{
  const h=harness({readMyContext:async()=>({role:'STUDENT',enabled:true})});await h.ready()
  await h.controller.perform('request_staff_access',{p_email:'x@example.invalid',p_role:'ADMIN'})
  assert.equal(h.writes.length,0);assert.equal(h.store.size,0);assert.equal(h.controller.getState().phase,'error');h.controller.stop()
})
test('actor switch during preparation cannot retarget a role write',async()=>{
  let resolve;const h=harness({readMyContext:()=>new Promise(r=>resolve=r)});await h.ready()
  const pending=h.controller.perform('request_staff_access',{p_email:'x@example.invalid',p_role:'ADMIN'});h.scope({...access(),actor:id(9)});h.controller.syncAccess(day);resolve({role:'ADMIN',enabled:true});await pending
  assert.equal(h.writes.length,0);assert.equal(h.store.size,0);h.controller.stop()
})
