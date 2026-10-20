import {after,test} from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'vite'
import {createSSRApp} from 'vue'
import {renderToString} from '@vue/server-renderer'
import {STAFF_ACTIVATION_RELEASED} from '../../src/lib/adminActivation.js'
import {staffDirectoryRows} from '../../src/lib/adminRecords.js'
const server=await createServer({mode:'test',server:{middlewareMode:true,hmr:false,ws:false,watch:{ignored:['**/.local-*/**']}},appType:'custom'})
after(()=>server.close())
const Add=(await server.ssrLoadModule('/src/components/AdminAddStaff.vue')).default
test('read-only installation permits account lookup but never releases staff activation',async()=>{
 assert.equal(STAFF_ACTIVATION_RELEASED,false)
 const html=await renderToString(createSSRApp(Add,{records:{staff:{status:'ready',value:[]},lookup:{status:'idle'}},counters:[]}))
 assert.match(html,/Find registered account/);assert.doesNotMatch(html,/staff-activation-locked/)
 assert.doesNotMatch(html,/Staff added successfully|PENDING_IDENTITY_REVIEW/)
})
test('new RPC is the primary directory; denial cannot resurrect cached private legacy rows',()=>{
 const legacy=[{email:'old@example.invalid',role:'ADMIN'},{email:'student@example.invalid',role:'STUDENT'}]
 const current=[{email:'new@example.invalid',role:'CASHIER'}]
 assert.deepEqual(staffDirectoryRows({status:'ready',value:current},legacy),current)
 for(const status of ['restricted','error','loading','idle'])assert.deepEqual(staffDirectoryRows({status,value:current},legacy),[])
 assert.equal(staffDirectoryRows({status:'unavailable'},legacy).length,1)
})
