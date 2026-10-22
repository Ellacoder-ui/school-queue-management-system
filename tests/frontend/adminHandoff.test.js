import {after,test} from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'vite'
import {createSSRApp} from 'vue'
import {renderToString} from '@vue/server-renderer'
import {PENDING_STAFF_ASSIGNMENTS_RELEASED,STAFF_ACTIVATION_RELEASED,STAFF_MANAGEMENT_OWNER_ID} from '../../src/lib/adminActivation.js'
import {staffDirectoryRows} from '../../src/lib/adminRecords.js'
const server=await createServer({mode:'test',server:{middlewareMode:true,hmr:false,ws:false,watch:{ignored:['**/.local-*/**']}},appType:'custom'})
after(()=>server.close())
const Add=(await server.ssrLoadModule('/src/components/AdminAddStaff.vue')).default
test('email invitations are enabled only for the designated owner after migration verification',async()=>{
 assert.equal(STAFF_ACTIVATION_RELEASED,true)
 assert.equal(PENDING_STAFF_ASSIGNMENTS_RELEASED,true)
 assert.equal(STAFF_MANAGEMENT_OWNER_ID,'5c96debb-697f-4cad-805f-92b518e28343')
 const records={staff:{status:'ready',value:[]},pending:{status:'ready',value:[]},lookup:{status:'idle'}}
 const counters=[{id:'10000000-0000-4000-8000-000000000001',number:1,label:'Counter 1'}]
 const html=await renderToString(createSSRApp(Add,{records,counters,actor:STAFF_MANAGEMENT_OWNER_ID}))
 assert.match(html,/data-testid="add-staff"[^>]*>Add Staff/)
 assert.doesNotMatch(html,/data-testid="add-staff" disabled/)
 assert.doesNotMatch(html,/Pending first sign-in assignments|Assign a verified Google account now|Registered accounts are assigned only/)
 assert.doesNotMatch(html,/<h3>Add Staff<\/h3>/)
 assert.doesNotMatch(html,/Find Google account|staff-resolve/)
 const nonOwner=await renderToString(createSSRApp(Add,{records,counters,actor:'00000000-0000-0000-0000-000000000001'}))
 assert.match(nonOwner,/staff-owner-only/)
 assert.match(nonOwner,/Only the designated administrator can change staff access/)
 assert.match(nonOwner,/data-testid="add-staff" disabled/)
})
test('pending invitations join the staff directory without appearing as authenticated accounts',()=>{
 const rows=staffDirectoryRows({status:'ready',value:[]},[],{status:'ready',value:[{
  id:'30000000-0000-4000-8000-000000000001',email:'future@example.invalid',role:'CASHIER',
  counter:'10000000-0000-4000-8000-000000000001',created_at:'2026-10-21T00:00:00Z'
 }]})
 assert.equal(rows.length,1)
 assert.equal(rows[0].pending,true)
 assert.equal(rows[0].email,'future@example.invalid')
 assert.equal(rows[0].role,'CASHIER')
 assert.equal(rows[0].enabled,false)
 assert.equal(rows[0].google_verified,false)
 assert.match(rows[0].id,/^pending:/)
 assert.equal(rows[0].counter,'10000000-0000-4000-8000-000000000001')
})
test('new RPC is the primary directory; denial cannot resurrect cached private legacy rows',()=>{
 const legacy=[{email:'old@example.invalid',role:'ADMIN'},{email:'student@example.invalid',role:'STUDENT'}]
 const current=[{email:'new@example.invalid',role:'CASHIER'}]
 assert.deepEqual(staffDirectoryRows({status:'ready',value:current},legacy),current)
 for(const status of ['restricted','error','loading','idle'])assert.deepEqual(staffDirectoryRows({status,value:current},legacy),[])
 assert.equal(staffDirectoryRows({status:'unavailable'},legacy).length,1)
})
