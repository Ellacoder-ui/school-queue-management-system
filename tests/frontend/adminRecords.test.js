import {test} from 'node:test'
import assert from 'node:assert/strict'
import {availableStaffCounters,createAdminRecordReader,validateRecordArgs,validateRecordRead,visibleAdminStaffRows} from '../../src/lib/adminRecords.js'
import {validateAdminMutation,validateAdminReceipt} from '../../src/lib/adminContracts.js'
import {createAdminWorkspace} from '../../src/lib/adminWorkspace.js'
import {staffFixture} from './staffFixtures.mjs'
import {QueueRequestError} from '../../src/services/queueApi.js'
const id=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const args={p_user:id(3),p_email:'student@example.invalid',p_identity_sha256:'a'.repeat(64),p_role:'CASHIER',p_counter:id(100)}
test('staff directory omits the current operator and accounts without a usable email',()=>{
 const rows=[
  {id:id(1),email:'owner@example.invalid',role:'ADMIN'},
  {id:id(2),email:null,role:'CASHIER'},
  {id:id(3),email:'  ',role:'ADMIN'},
  {id:id(4),email:'staff@example.invalid',role:'CASHIER'},
  {id:`pending:${id(5)}`,email:'invited@example.invalid',role:'CASHIER'}
 ]
 assert.deepEqual(visibleAdminStaffRows(rows,id(1)),[rows[3],rows[4]])
})
test('staff confirmation requires immutable UUID, reviewed binding and exact counter-role arguments',()=>{
 validateAdminMutation('add_verified_staff',args)
 for(const p of [{...args,p_user:args.p_email},{...args,p_identity_sha256:null},{...args,p_role:'ADMIN'},{...args,p_counter:null},{...args,access_token:'CANARY'}])assert.throws(()=>validateAdminMutation('add_verified_staff',p))
 assert.throws(()=>validateAdminReceipt('add_verified_staff',{user:id(3),role:'CASHIER',enabled:true,counter:null}))
})
test('email-based assignments and pending edits accept only exact owner-operation shapes',()=>{
 const direct={p_email:'staff@example.invalid',p_role:'CASHIER',p_counter:id(100)}
 validateAdminMutation('assign_staff_by_email',direct)
 assert.deepEqual(validateAdminReceipt('assign_staff_by_email',{status:'PENDING_FIRST_LOGIN',invitation:id(12),email:direct.p_email,role:'CASHIER',counter:id(100)}),
  {status:'PENDING_FIRST_LOGIN',invitation:id(12),email:direct.p_email,role:'CASHIER',counter:id(100)})
 assert.deepEqual(validateAdminReceipt('assign_staff_by_email',{status:'ASSIGNED',user:id(13),email:direct.p_email,role:'CASHIER',counter:id(100)}).status,'ASSIGNED')
 for(const p of [{...direct,p_email:'UPPER@example.invalid'},{...direct,other:'CANARY'},{...direct,p_counter:null},{...direct,p_role:'STUDENT'}])assert.throws(()=>validateAdminMutation('assign_staff_by_email',p))
 const update={p_invitation:id(12),p_action:'UPDATE',p_email:'new@example.invalid',p_role:'ADMIN',p_counter:null}
 validateAdminMutation('manage_pending_staff',update)
 validateAdminMutation('manage_pending_staff',{p_invitation:id(12),p_action:'CANCEL',p_email:null,p_role:null,p_counter:null})
 assert.throws(()=>validateAdminMutation('manage_pending_staff',{...update,p_counter:id(100)}))
 assert.throws(()=>validateAdminReceipt('manage_pending_staff',{invitation:id(12),email:'new@example.invalid',role:'ADMIN',counter:id(100),status:'PENDING_FIRST_LOGIN'}))
})
test('cashier counter availability excludes every active assignment and pending CASHIER reservation',()=>{
 const counters=[1,2,3,4,5].map(number=>({id:id(100+number),number}))
 const assignments=[{account_id:id(1),counter_id:id(101)},{account_id:id(2),counter_id:id(105)}]
 const pending=[
  {id:id(20),role:'CASHIER',counter:id(102)},
  {id:id(21),role:'ADMIN',counter:null}
 ]
 assert.deepEqual(availableStaffCounters(counters,assignments,pending).map(row=>row.number),[3,4])
 assert.deepEqual(availableStaffCounters(counters,[],[]).map(row=>row.number),[1,2,3,4,5])
})
test('staff role editor accepts only atomic CASHIER/ADMIN access shapes',()=>{
 const cashier={p_user:id(3),p_role:'CASHIER',p_enabled:true,p_counter:id(100)}
 validateAdminMutation('set_staff_access',cashier)
 assert.deepEqual(validateAdminReceipt('set_staff_access',{user:id(3),role:'CASHIER',enabled:true,counter:id(100)}),
  {user:id(3),role:'CASHIER',enabled:true,counter:id(100)})
 validateAdminMutation('set_staff_access',{p_user:id(3),p_role:'ADMIN',p_enabled:true,p_counter:null})
 validateAdminMutation('set_staff_access',{p_user:id(3),p_role:'CASHIER',p_enabled:false,p_counter:null})
 for(const invalid of [{...cashier,p_counter:null},{...cashier,p_role:'STUDENT'},{...cashier,extra:true},
  {p_user:id(3),p_role:'ADMIN',p_enabled:true,p_counter:id(100)}])assert.throws(()=>validateAdminMutation('set_staff_access',invalid))
})
test('ineligible counter assignment removal accepts only exact owner RPC receipts',()=>{
 const parameters={p_counter:id(100),p_user:id(3)}
 const receipt={counter:id(100),user:id(3),role:'STUDENT',enabled:true,removed:true}
 validateAdminMutation('remove_ineligible_counter_assignment',parameters)
 assert.deepEqual(validateAdminReceipt('remove_ineligible_counter_assignment',receipt),receipt)
 assert.deepEqual(validateAdminReceipt('remove_ineligible_counter_assignment',{
  ...receipt,role:'CASHIER',enabled:false
 }),{...receipt,role:'CASHIER',enabled:false})
 for(const invalid of [{...parameters,extra:true},{...parameters,p_counter:null},
  {...receipt,role:'CASHIER'},{...receipt,removed:false},{...receipt,extra:'CANARY'}]) {
  assert.throws(()=>invalid.counter||invalid.removed!==undefined
   ?validateAdminReceipt('remove_ineligible_counter_assignment',invalid)
   :validateAdminMutation('remove_ineligible_counter_assignment',invalid))
 }
})
test('pending staff directory is bounded and rejects malformed identities or assignment states',()=>{
 validateRecordArgs('admin_pending_staff',{})
 const row={id:id(20),email:'staff@example.invalid',role:'CASHIER',counter:id(100),created_at:'2026-10-20T10:00:00Z'}
 assert.deepEqual(validateRecordRead('admin_pending_staff',{},[row]),[row])
 for(const invalid of [{...row,email:'STAFF@example.invalid'},{...row,role:'ADMIN'},{...row,secret:'CANARY'}])assert.throws(()=>validateRecordRead('admin_pending_staff',{},[invalid]))
})
test('verified identity lookup rejects extra Auth fields, wrong email and invalid subject binding',()=>{
 const x={id:id(3),email:args.p_email,role:'STUDENT',enabled:true,identity_sha256:args.p_identity_sha256,counter_ids:[]}
 assert.deepEqual(validateRecordRead('resolve_staff_google',{p_email:args.p_email},x),x)
 for(const row of [{...x,email:'other@example.invalid'},{...x,secret:'CANARY'},{...x,identity_sha256:'email-only'}])assert.throws(()=>validateRecordRead('resolve_staff_google',{p_email:args.p_email},row))
 assert.equal(validateRecordRead('resolve_staff_google',{p_email:args.p_email},null),null)
})
test('payor filters and results are bounded and preserve actual statuses without private Auth fields',()=>{
 const p={p_search:'',p_service:null,p_date:null,p_status:null,p_offset:0,p_limit:25};validateRecordArgs('admin_payors',p)
 for(const change of [{p_limit:1000},{p_status:'SKIPPED'},{p_service:'UNKNOWN'},{p_offset:-1}])assert.throws(()=>validateRecordArgs('admin_payors',{...p,...change}))
 const row={ticket_id:id(4),owner_id:id(3),number:1,service:'TP',status:'WAITING',business_date:'2026-10-20',issued_at:'2026-10-20T01:00:00Z',counter_id:null,student_number:null,display_name:null}
 assert.equal(validateRecordRead('admin_payors',p,{rows:[row],more:false,offset:0,limit:25}).rows[0].display_name,null)
 assert.throws(()=>validateRecordRead('admin_payors',p,{rows:[{...row,status:'SKIPPED'}],more:false,offset:0,limit:25}))
 assert.throws(()=>validateRecordRead('admin_staff_accounts',{},[{id:id(3),email:args.p_email,role:'STUDENT',enabled:true,google_verified:true}]))
})
test('record readers coalesce reads, preserve ready rows and discard superseded/foreign actor responses',async()=>{
 let actor=id(1),release=[],calls=0;const r=createAdminRecordReader({read:()=>{calls++;return new Promise(resolve=>release.push(resolve))}},{getActor:()=>actor})
 const first=r.read('admin_staff_accounts'),second=r.read('admin_staff_accounts');assert.equal(first,second);assert.equal(calls,1)
 release.shift()([]);await first;assert.equal(r.getState().status,'ready')
 const old=r.read('admin_staff_accounts');assert.equal(r.getState().status,'ready');assert.equal(r.getState().refreshing,true)
 actor=id(2);r.clear();release.shift()([{private:'CANARY'}]);await old;assert.equal(r.getState().value,null);r.stop()
})
test('missing RPC and permission denial clear cached private records and never invent empty acceptance',async()=>{
 for(const code of ['42501','PGRST202']){let denied=false;const r=createAdminRecordReader({read:async()=>{if(denied)throw new QueueRequestError({code});return []}},{getActor:()=>id(1)})
 await r.read('admin_staff_accounts');denied=true;await r.read('admin_staff_accounts');assert.equal(r.getState().status,code==='42501'?'restricted':'unavailable');assert.equal(r.getState().value,null);r.stop()}
})
test('atomic staff intent survives unknown outcome and uses one exact key only on explicit reconciliation',async()=>{
 const f=staffFixture(),store=new Map(),writes=[];let lose=true
 const api={read:async name=>name==='admin_configuration'?f.configuration:f.directory,readMyContext:async()=>({role:'ADMIN',enabled:true}),createMutationIntent:(operation,p)=>({operation,parameters:{...p,p_request_key:id(999)}}),executeMutation:async intent=>{writes.push(intent);if(lose)throw new QueueRequestError({outcome:'unknown'});f.directory[2].role=f.configuration.accounts[2].role='CASHIER';f.configuration.staff_assignments.push({account_id:id(3),counter_id:id(100)});return {user:id(3),role:'CASHIER',enabled:true,counter:id(100)}}}
 const c=createAdminWorkspace(api,{contract:'installed-directory',getAccess:()=>({actor:id(1),context:{role:'ADMIN',enabled:true}}),store:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},withLock:fn=>fn()})
 await c.refresh();await c.perform('add_verified_staff',args);assert.equal(c.getState().phase,'unknown');assert.equal(writes.length,1);assert.equal(store.size,1)
 await c.perform('add_verified_staff',args);assert.equal(writes.length,1);lose=false;await c.retry();assert.deepEqual(writes[0],writes[1]);assert.match(c.getState().message,/Staff added successfully/);assert.equal(store.size,0);c.stop()
})
test('email staff assignment reconciles a confirmed pending first-login receipt',async()=>{
 const f=staffFixture(),store=new Map(),writes=[]
 const api={read:async name=>name==='admin_configuration'?f.configuration:f.directory,readMyContext:async()=>({role:'ADMIN',enabled:true}),
  createMutationIntent:(operation,p)=>({operation,parameters:{...p,p_request_key:id(998)}}),
  executeMutation:async intent=>{writes.push(intent);return {status:'PENDING_FIRST_LOGIN',invitation:id(998),email:'future@example.invalid',role:'CASHIER',counter:id(100)}}}
 const controller=createAdminWorkspace(api,{contract:'installed-directory',getAccess:()=>({actor:id(1),context:{role:'ADMIN',enabled:true}}),
  store:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},withLock:fn=>fn()})
 await controller.refresh()
 await controller.perform('assign_staff_by_email',{p_email:'future@example.invalid',p_role:'CASHIER',p_counter:id(100)})
 assert.equal(controller.getState().phase,'success')
 assert.equal(controller.getState().message,'Staff added successfully.')
 assert.equal(writes.length,1);assert.equal(store.size,0)
 controller.stop()
})
test('atomic staff access changes require the exact database-confirmed role and counter',async()=>{
 const fixture=staffFixture(),store=new Map(),counter=id(100),user=id(3)
 const api={read:async name=>name==='admin_configuration'?fixture.configuration:fixture.directory,
  readMyContext:async()=>({role:'ADMIN',enabled:true}),
  createMutationIntent:(operation,p)=>({operation,parameters:{...p,p_request_key:id(997)}}),
  executeMutation:async()=>({user,role:'CASHIER',enabled:true,counter})}
 const controller=createAdminWorkspace(api,{contract:'installed-directory',
  getAccess:()=>({actor:id(1),context:{role:'ADMIN',enabled:true}}),
  store:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
  withLock:fn=>fn()})
 await controller.refresh()
 await controller.perform('set_staff_access',{p_user:user,p_role:'CASHIER',p_enabled:true,p_counter:counter})
 assert.equal(controller.getState().phase,'success')
 assert.equal(controller.getState().message,'Staff changes saved successfully.')
 assert.equal(store.size,0)
 controller.stop()
})
