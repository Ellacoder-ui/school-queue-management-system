import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
const server = await createServer({ mode: 'test', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
after(() => server.close())
const load = async name => (await server.ssrLoadModule(`/src/components/${name}.vue`)).default
const publicState = { counters: [], services: [], hasSnapshot: false, context: null, synchronized: false }
const data = { status: 'ready', rows: [], updatedAt: 1 }
const render = async (name, props) => renderToString(createSSRApp(await load(name), props))
test('split login keeps one Google entry and truthful provider check with no selectable roles', async () => {
  const html = await render('AuthWorkspace', { state: { status: 'anonymous', signedIn: false } })
  assert.match(html, /Less waiting\./); assert.match(html, /Provider availability is checked/)
  assert.equal((html.match(/data-testid="google-login"/g) || []).length, 1)
  assert.doesNotMatch(html, /<select|type="password"|Google is enabled/)
})
test('student has all five services, owner history and no invented queue or ETA', async () => {
  const html = await render('StudentDashboard', { publicState, data })
  for (const code of ['TP', 'SOA', 'PNEP', 'REF', 'ADJ']) assert.match(html, new RegExp(`data-testid="service-${code}"`))
  assert.match(html, /One active ticket across all services/); assert.match(html, /two SERVED tickets/)
  assert.match(html, /No served or forfeited tickets/); assert.match(html, /Review your chosen service before confirming/)
  assert.doesNotMatch(html, /TP-001|Estimated wait|You are next|Student ID/)
})
test('cashier renders only assigned services, with all operations disabled', async () => {
  const context = { cashier_counters: [{ counter_id: 'counter', counter_number: 5, counter_label: 'Counter 5', is_open: false, service_codes: ['ADJ'] }] }
  const row = { ticket_id: 'x', service: 'ADJ', number: 7, business_date: '2026-10-18', status: 'WAITING', counter_id: null, wait_position: 1 }
  const html = await render('CashierDashboard', { context, data: { ...data, rows: [row, { ...row, ticket_id: 'y', service: 'TP', number: 99 }] } })
  assert.match(html, /Adjustment Clerk|ADJ-007/); assert.doesNotMatch(html, /TP-099|Customer name|Priority/)
  for (const action of ['Skip', 'Mark Served', 'Call Next']) assert.match(html, new RegExp(`disabled[^>]*>${action}</button>`))
})
test('admin uses current snapshots and unavailable historical metrics instead of demo charts', async () => {
  const html = await render('AdminDashboard', { publicState, data })
  assert.match(html, /Staff management/); assert.match(html, /Historical analytics/); assert.match(html, /No estimates are shown/)
  assert.match(html, /No active tickets/); assert.match(html, /Live tickets/)
  assert.doesNotMatch(html, /Queue configuration|Manage configuration|Business timezone|Permanent routing/)
  assert.doesNotMatch(html, /98%|9 min|Supervisor|<canvas|Average wait.*\d/)
})

const liveState=()=>({hasSnapshot:true,synchronized:true,connection:'connected',refreshing:false,error:null,lastRefreshed:'2026-10-19T19:25:00Z',context:{business_date:'2026-10-20',services:[{code:'TP',name:'Tuition Payment'},{code:'SOA',name:'Statement of Account'},{code:'PNEP',name:'Promissory Notes and Exam Permits'},{code:'REF',name:'Refund Process'},{code:'ADJ',name:'Adjustment Clerk'}]},counters:['TP','SOA','PNEP','REF','ADJ'].map((code,i)=>({counter_label:`Counter ${i+1}`,is_open:i<2,ticket_label:i===0?'TP-073':null,service_code:i===0?'TP':null,business_date:i===0?'2026-10-20':null})),services:[{service_code:'TP',business_date:'2026-10-20',waiting_count:0}]})
test('ADMIN live tickets render five fixed destinations and dated public calls without private history',async()=>{
 const html=await render('AdminLiveTickets',{state:liveState()})
 assert.equal((html.match(/data-live-counter=/g)||[]).length,5)
 for(const [i,code]of ['TP','SOA','PNEP','REF','ADJ'].entries())assert.match(html,new RegExp(`data-live-counter="${i+1}"[\\s\\S]*?data-service="${code}"`))
 assert.match(html,/Currently called/);assert.match(html,/TP-073/);assert.match(html,/Ticket date 2026-10-20/)
 assert.match(html,/<strong>0<\/strong> waiting/);assert.equal((html.match(/No ticket being called/g)||[]).length,4)
 assert.doesNotMatch(html,/<button|Refresh|SERVED|FORFEITED/)
})
test('cleared called projection never reuses a served or forfeited private ticket',async()=>{
 const state=liveState();state.counters[0].ticket_label=null;state.counters[0].service_code=null;state.counters[0].business_date=null
 const html=await render('AdminDashboard',{publicState:state,data:{status:'ready',rows:[{ticket_id:'old',service:'TP',number:999,status:'SERVED',business_date:'2026-10-20'}]}})
 const aside=html.slice(html.indexOf('<aside'),html.indexOf('</aside>'))
 assert.doesNotMatch(aside,/TP-073|TP-999|Currently called/);assert.equal((aside.match(/No ticket being called/g)||[]).length,5)
})
test('disconnected and resynchronizing snapshots are explicitly stale until fresh readiness',async()=>{
 const state=liveState();state.connection='disconnected';state.synchronized=false
 const offline=await render('AdminLiveTickets',{state});assert.match(offline,/Connection interrupted/);assert.match(offline,/Last reported call · stale/);assert.doesNotMatch(offline,/Currently called/)
 state.connection='connected';const reconnect=await render('AdminLiveTickets',{state});assert.match(reconnect,/Synchronizing/);assert.match(reconnect,/Last-known snapshot/)
 state.synchronized=true;const ready=await render('AdminLiveTickets',{state});assert.match(ready,/Currently called/);assert.doesNotMatch(ready,/snapshot — stale/)
})
test('background updating keeps the public calls and zero/missing waiting counts distinct',async()=>{
 const state=liveState();state.refreshing=true
 const html=await render('AdminLiveTickets',{state});assert.match(html,/data-live="true"/);assert.match(html,/Updating/);assert.match(html,/TP-073/)
 assert.match(html,/Updating call snapshot/);assert.doesNotMatch(html,/Currently called/)
 assert.equal((html.match(/Waiting count not reported/g)||[]).length,4)
 state.services.push({...state.services[0]});const duplicate=await render('AdminLiveTickets',{state});assert.equal((duplicate.match(/Waiting count not reported/g)||[]).length,5)
})
test('missing or mismatched counter projections cannot claim live current calls',async()=>{
 const state=liveState();state.counters[0].service_code='SOA'
 const html=await render('AdminLiveTickets',{state});assert.match(html,/Data unavailable/);assert.match(html,/Call data unavailable/);assert.doesNotMatch(html,/TP-073|Currently called/)
 state.hasSnapshot=false;const pending=await render('AdminLiveTickets',{state});assert.match(pending,/Waiting for a verified public queue snapshot/);assert.doesNotMatch(pending,/TP-073/)
})
test('unavailable private reads never render cached ticket rows', async () => {
  const rows = [{ id: 'x', service: 'TP', number: 987, status: 'SERVED', business_date: '2026-10-18' }]
  const html = await render('StudentDashboard', { publicState, data: { status: 'error', rows } })
  assert.match(html, /ticket history is unavailable/); assert.doesNotMatch(html, /TP-987/)
})
