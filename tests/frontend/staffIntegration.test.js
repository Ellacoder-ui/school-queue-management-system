import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createQueueApi, QueueRequestError } from '../../src/services/queueApi.js'
import { createAdminWorkspace } from '../../src/lib/adminWorkspace.js'
import { normalizeStaffEmail, validateStaffDirectory, validateInstalledStaff } from '../../src/lib/adminContracts.js'
const id=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`, actor=id(1)
const codes=['TP','SOA','PNEP','REF','ADJ']
import { staffFixture } from './staffFixtures.mjs'

function setup(overrides={}) {
  const fixture=staffFixture(),store=new Map(),writes=[],reads=[];let scope={actor,context:{role:'ADMIN',enabled:true}}
  const api={read:async(name,args,options)=>{reads.push({name,args,options});return name==='admin_configuration'?fixture.configuration:fixture.directory},
    readMyContext:async()=>scope.context,createMutationIntent:(operation,parameters)=>({operation,parameters:{...parameters,p_request_key:id(900)}}),
    executeMutation:async intent=>{writes.push(intent);return {request_id:id(800),status:'PENDING_IDENTITY_REVIEW'}},...overrides}
  const controller=createAdminWorkspace(api,{contract:'installed-directory',getAccess:()=>scope,
    store:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},withLock:fn=>fn()})
  return {api,fixture,store,writes,reads,controller,setScope:x=>scope=x}
}
function sdk(response) {
  const calls=[]
  const client={}
  client.schema=schema=>({rpc:(operation,parameters)=>{
    const call={schema,operation,parameters};calls.push(call)
    const request={retry:value=>{call.retry=value;return request},setHeader:()=>request,abortSignal:()=>request,
      then:(resolve,reject)=>Promise.resolve(typeof response==='function'?response(call):response).then(resolve,reject)}
    return request
  }})
  return {api:createQueueApi(client),calls}
}
test('staff emails normalize before validation; unsupported roles and identity text cannot act as UUIDs',()=>{
  assert.equal(normalizeStaffEmail('  New.Staff@EXAMPLE.COM  '),'new.staff@example.com')
  for(const value of ['',null,'invalid','a b@example.com','a@b','a'.repeat(255)+'@x.com'])assert.throws(()=>normalizeStaffEmail(value))
  const {api}=sdk({data:{},error:null,status:200})
  assert.throws(()=>api.createMutationIntent('request_staff_access',{p_email:'x@example.com',p_role:'OWNER'}))
  assert.throws(()=>api.createMutationIntent('set_account',{p_user:'admin@example.com',p_role:'ADMIN',p_enabled:true}))
})
test('actual directory shape rejects extra Auth fields, duplicate UUIDs and malformed counts',()=>{
  const {directory}=staffFixture();assert.equal(validateStaffDirectory(directory)[1].email,'cashier@example.invalid')
  for(const rows of [[...directory,directory[0]],[{...directory[0],access_token:'PRIVATE_CANARY'}],[{...directory[0],google_identity:true}],[{...directory[0],role:'OWNER'}]])assert.throws(()=>validateStaffDirectory(rows))
})
test('directory read is allowlisted and returns only validated installed fields',async()=>{
  const {directory}=staffFixture(),{api,calls}=sdk({data:directory,error:null,status:200})
  assert.deepEqual(await api.read('admin_staff_directory'),directory);assert.equal(calls[0].schema,'queue_api');assert.equal(calls[0].operation,'admin_staff_directory')
})
test('staff request wire uses exactly p_email/p_role, disables SDK retries and validates receipt',async()=>{
  const {api,calls}=sdk({data:{request_id:id(800),status:'PENDING_IDENTITY_REVIEW'},error:null,status:200})
  const intent=api.createMutationIntent('request_staff_access',{p_email:'  STAFF@Example.COM ',p_role:'CASHIER'})
  assert.ok(intent.parameters.p_request_key);assert.equal(intent.parameters.p_email,'staff@example.com')
  assert.equal((await api.executeMutation(intent)).request_id,id(800));assert.deepEqual(calls[0].parameters,{p_email:'staff@example.com',p_role:'CASHIER'});assert.equal(calls[0].retry,false)
})
test('existing account mutation retains its real server request key and exact receipt contract',async()=>{
  const {api,calls}=sdk({data:{user:id(3),role:'CASHIER',enabled:true},error:null,status:200})
  const intent=api.createMutationIntent('set_account',{p_user:id(3),p_role:'CASHIER',p_enabled:true});await api.executeMutation(intent)
  assert.equal(calls[0].parameters.p_request_key,intent.parameters.p_request_key)
})
test('installed configuration joins directory by UUID and preserves every fixed service route',()=>{
  const f=staffFixture(),s=validateInstalledStaff(f.configuration,f.directory)
  assert.equal(s.configuration.counters.length,5);assert.equal(s.configuration.staff_assignments[0].account_id,id(2));assert.equal(s.requests,undefined)
  f.configuration.counter_services[0].service_id=id(201);assert.throws(()=>validateInstalledStaff(f.configuration,f.directory))
})
test('ADMIN reader uses only installed directory/configuration APIs and pins the actor',async()=>{
  const h=setup();await h.controller.refresh();assert.equal(h.controller.getState().status,'ready')
  assert.deepEqual(h.reads.map(x=>x.name).sort(),['admin_configuration','admin_staff_directory']);assert.ok(h.reads.every(x=>x.options.expectedActor===actor));h.controller.stop()
})
test('successful pending request retains its actual ID/status without claiming account creation',async()=>{
  const h=setup();await h.controller.refresh();await h.controller.perform('request_staff_access',{p_email:'new@example.com',p_role:'ADMIN'})
  const state=h.controller.getState();assert.equal(state.phase,'success');assert.equal(state.result.request_id,id(800));assert.equal(state.result.status,'PENDING_IDENTITY_REVIEW');assert.match(state.message,/No email, Auth account, approval or role was created/);assert.equal(h.store.size,0);h.controller.stop()
})
test('duplicate and validation errors are specific; raw diagnostics remain hidden',async()=>{
  for(const [reason,pattern]of [['staff_duplicate',/already exists/],['invalid_email',/valid staff email/],['invalid_role',/CASHIER or ADMIN/]]){
    const h=setup({executeMutation:async()=>{throw new QueueRequestError({code:'22023',status:400,reason})}});await h.controller.refresh();await h.controller.perform('request_staff_access',{p_email:'new@example.com',p_role:'CASHIER'})
    assert.equal(h.controller.getState().phase,'error');assert.match(h.controller.getState().message,pattern);assert.equal(h.store.size,0);h.controller.stop()
  }
})
test('non-idempotent lost response persists and neither explicit retry nor another submit sends again',async()=>{
  let attempts=0;const h=setup({executeMutation:async()=>{attempts++;throw new QueueRequestError({outcome:'unknown'})}})
  await h.controller.refresh();await h.controller.perform('request_staff_access',{p_email:'new@example.com',p_role:'CASHIER'})
  assert.equal(h.controller.getState().phase,'unknown');assert.equal(h.controller.getState().canRetry,false);assert.equal(h.store.size,1)
  h.controller.syncAccess();await new Promise(r=>setImmediate(r));await h.controller.retry();await h.controller.perform('request_staff_access',{p_email:'different@example.com',p_role:'ADMIN'})
  assert.equal(attempts,1);assert.match(h.controller.getState().message,/status is checked/);assert.equal(h.store.size,1);h.controller.stop()
})
test('concurrent clicks send one request; background reads do not flicker or close the ready view',async()=>{
  let release;const h=setup({executeMutation:()=>new Promise(r=>release=r)});await h.controller.refresh()
  const first=h.controller.perform('request_staff_access',{p_email:'new@example.com',p_role:'CASHIER'});await new Promise(r=>setImmediate(r))
  await h.controller.perform('request_staff_access',{p_email:'other@example.com',p_role:'ADMIN'});release({request_id:id(800),status:'PENDING_IDENTITY_REVIEW'});await first
  const finish=[];h.api.read=name=>new Promise(r=>finish.push(()=>r(name==='admin_configuration'?h.fixture.configuration:h.fixture.directory)));const read=h.controller.refresh(undefined,{background:true});assert.equal(h.controller.getState().status,'ready');h.controller.stop();finish.forEach(f=>f());await read
})
test('STUDENT/CASHIER cannot start private reads; failed or revoked reads discard all cached directory data',async()=>{
  const h=setup();for(const role of ['STUDENT','CASHIER']){h.setScope({actor,context:{role,enabled:true}});h.controller.syncAccess();await new Promise(r=>setImmediate(r))}
  assert.equal(h.reads.length,0);h.setScope({actor,context:{role:'ADMIN',enabled:true}});await h.controller.refresh();h.api.read=async()=>{throw new QueueRequestError({code:'42501',status:403})};await h.controller.refresh();assert.equal(h.controller.getState().data,null);assert.equal(h.controller.getState().status,'restricted');h.controller.stop()
})

test('an ordinary directory refresh cannot cancel an authorized mutation during its preflight',async()=>{
  let release
  const h=setup({readMyContext:()=>new Promise(resolve=>{release=()=>resolve({role:'ADMIN',enabled:true})})})
  await h.controller.refresh()
  const action=h.controller.perform('request_staff_access',{p_email:'review@example.com',p_role:'CASHIER'})
  await new Promise(resolve=>setImmediate(resolve))
  await h.controller.refresh(undefined,{background:true})
  release();await action
  assert.equal(h.writes.length,1);assert.equal(h.controller.getState().phase,'success');h.controller.stop()
})

test('directory recovery reads coalesce without clearing the ready view and post-write reads are targeted',async()=>{
  const h=setup();await h.controller.refresh();let release
  const original=h.api.read;h.api.read=(...args)=>new Promise(resolve=>{(release??=[]).push(async()=>resolve(await original(...args)))})
  const first=h.controller.refresh(),second=h.controller.refresh();assert.equal(first,second);assert.equal(h.controller.getState().status,'ready');assert.equal(release.length,2)
  await Promise.all(release.map(fn=>fn()));await first;h.api.read=original
  h.reads.length=0;await h.controller.perform('request_staff_access',{p_email:'targeted@example.com',p_role:'CASHIER'})
  assert.deepEqual(h.reads.map(x=>x.name),['admin_configuration','admin_staff_directory','admin_staff_directory'])
  assert.equal(h.controller.getState().phase,'success');h.controller.stop()
})
