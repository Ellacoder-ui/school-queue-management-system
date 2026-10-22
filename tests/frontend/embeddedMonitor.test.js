import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { counterRoutes } from '../../src/lib/publicBoard.js'
import { createPublicQueueController } from '../../src/lib/publicQueueController.js'
const server=await createServer({mode:'test',server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'})
after(()=>server.close())
const render=async(name,props)=>renderToString(createSSRApp((await server.ssrLoadModule(`/src/components/${name}.vue`)).default,props))
const state={hasSnapshot:true,loading:false,refreshing:false,connection:'connected',synchronized:true,error:null,
  lastRefreshed:'2026-10-19T04:00:00Z',context:{timezone:'Asia/Manila',business_date:'2026-10-19',queue_day_open:true,services:counterRoutes.map(x=>({...x,issuance_status:'OPEN'}))},
  counters:counterRoutes.map(x=>({counter_label:`Counter ${x.number}`,is_open:x.number<3,service_code:x.code,ticket_label:x.number===1?'TP-123':null,business_date:'2026-10-19'})),
  services:[{service_code:'TP',business_date:'2026-10-19',waiting_count:0},{service_code:'SOA',business_date:'2026-10-18',waiting_count:3}]}
test('student embeds exactly one presentational monitor, all fixed counters and no nested main',async()=>{
  const html=await render('StudentDashboard',{publicState:state,data:{status:'ready',rows:[]}})
  assert.equal((html.match(/data-testid="public-board"/g)||[]).length,1)
  for(const x of counterRoutes)assert.match(html,new RegExp(`data-counter="${x.number}"`))
  assert.match(html,/Live queue monitor|TP-123/);assert.doesNotMatch(html,/Open lobby display/)
  assert.doesNotMatch(html,/<main|Counter 6|TP-001/)
})
test('student keeps service cards and removes manual notification and browse buttons',async()=>{
  const html=await render('StudentDashboard',{publicState:state,data:{status:'ready',rows:[]}})
  assert.equal((html.match(/class="cqs-service-card"/g)||[]).length,5)
  assert.doesNotMatch(html,/Enable notifications|Notifications on|Browse services|enable-notifications/)
})
test('student replaces the introductory banner with one five-service section before the monitor',async()=>{
  const html=await render('StudentDashboard',{publicState:state,data:{status:'ready',rows:[]}})
  assert.doesNotMatch(html,/cqs-banner|Student &amp; payor portal|Your time matters\.|Choose your service\. Follow your ticket\.|01—05/)
  assert.equal((html.match(/class="cqs-service-card"/g)||[]).length,5)
  const section=html.slice(html.indexOf('data-testid="student-service-selection"'),html.indexOf('data-testid="student-live-monitor"'))
  for(const route of counterRoutes){
    assert.match(section,new RegExp(`data-testid="service-${route.code}"`))
    assert.ok(section.includes(route.name));assert.ok(section.includes(`Counter ${route.number}`))
  }
  assert.equal((html.match(/id="request-services"/g)||[]).length,1)
  assert.match(html,/<h1 id="student-services-title">Choose a cashier service/)
})
test('disabled and unknown service catalogs disable selection without inventing counter-open admission rules',async()=>{
  const html=await render('StudentDashboard',{publicState:{...state,context:{...state.context,services:counterRoutes.filter(x=>x.code!=='ADJ').map(x=>({...x,issuance_status:'OPEN'}))}},data:{status:'ready',rows:[]}})
  assert.match(html,/data-testid="service-ADJ" disabled/)
  assert.doesNotMatch(html,/data-testid="service-REF" disabled/)
  assert.match(html,/Service unavailable/)
  const unknown=await render('StudentDashboard',{publicState:{...state,context:null},data:{status:'ready',rows:[]}})
  assert.equal((unknown.match(/data-testid="service-[A-Z]+" disabled/g)||[]).length,5)
})
test('ticket buttons show cutoff reasons and are disabled by per-service admission state',async()=>{
 const context={...state.context,services:state.context.services.map(item=>({...item,
   issuance_status:item.code==='TP'?'COUNTER_CLOSED':item.code==='SOA'?'QUEUE_CUTOFF':item.code==='PNEP'?'AFTER_HOURS':'OPEN'}))}
 const html=await render('StudentDashboard',{publicState:{...state,context},data:{status:'ready',rows:[]}})
 assert.match(html,/data-testid="service-TP" disabled/)
 assert.match(html,/data-testid="service-SOA" disabled/)
 assert.match(html,/Counter is currently closed\./)
 assert.match(html,/Ticket issuance for this service has ended today\./)
 assert.match(html,/Ticket issuance closes at 5:00 PM\./)
 assert.doesNotMatch(html,/data-testid="service-REF" disabled/)
})
test('missing or failed public snapshots cannot enable service selection from a cached catalog',async()=>{
  for(const change of [{hasSnapshot:false},{error:'Public availability could not be refreshed.'}]){
    const html=await render('StudentDashboard',{publicState:{...state,...change},data:{status:'ready',rows:[]}})
    assert.equal((html.match(/data-testid="service-[A-Z]+" disabled/g)||[]).length,5)
    assert.match(html,/Service unavailable/)
  }
})
test('embedded monitor shows current-day totals, zero and genuine update status',async()=>{
  const html=await render('PublicQueueDisplay',{state,embedded:true})
  assert.doesNotMatch(html,/Live public display|Connecting|Synchronizing/);assert.match(html,/<strong>0<\/strong>/)
  assert.doesNotMatch(html,/2026-10-18/)
  assert.match(html,/Counter closed/)
  assert.doesNotMatch(html,/Refresh display/)
})
test('cashier dashboard embeds the shared live board and exposes the shared counter control',async()=>{
 const html=await render('CashierDashboard',{context:{cashier_counters:[{counter_id:'11111111-1111-4111-8111-111111111111',counter_number:1,counter_label:'Counter 1',is_open:false,service_codes:['TP']}]},publicState:state,data:{status:'ready',rows:[]}})
 assert.match(html,/data-testid="cashier-live-monitor"/);assert.match(html,/data-testid="public-board"/)
 assert.match(html,/data-testid="toggle-counter"[^>]*>Open Counter/)
 assert.doesNotMatch(html,/Refresh queue|Refresh display/)
  assert.doesNotMatch(html,/undefined|NaN|queue-board.*PRIVATE/)
})
test('disconnected embedded calls are explicitly stale and never claim live collection',async()=>{
  const html=await render('PublicQueueDisplay',{state:{...state,connection:'disconnected',synchronized:false},embedded:true})
  assert.match(html,/Queue synchronization is interrupted|Last reported call|TP-123/)
  assert.doesNotMatch(html,/Live public display|Proceed to|QUEUE UPDATES AUTOMATICALLY/)
})
test('embedded presentation starts no subscription and receives the existing shared state',()=>{
  for(const name of ['StudentDashboard','PublicQueueDisplay']){
    const source=readFileSync(`src/components/${name}.vue`,'utf8')
    assert.doesNotMatch(source,/usePublicQueue|subscribePublicDisplay|supabase\.channel|createClient/)
  }
  const parent=readFileSync('src/components/QueueApplication.vue','utf8')
  assert.equal((parent.match(/= usePublicQueue\(/g)||[]).length,1)
  assert.match(readFileSync('src/components/StudentDashboard.vue','utf8'),/<PublicQueueDisplay :state="publicState" embedded/)
})
test('monitor rejects ambiguous destinations and escapes unexpected content',async()=>{
  const bad={...state,counters:[...state.counters,{...state.counters[0],ticket_label:'PRIVATE-123',counter_label:'Counter 1'}],context:{...state.context,services:[{code:'TP',name:'<script>PRIVATE</script>'}]}}
  const html=await render('PublicQueueDisplay',{state:bad,embedded:true})
  assert.match(html,/Snapshot unavailable|Counter data could not be matched safely/)
  assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>PRIVATE|PRIVATE-123/)
})

test('one shared controller refreshes rendered calls on invalidation and cleans up its subscription',async()=>{
  let callbacks,subscriptions=0,cleanups=0
  let snapshot=structuredClone(state)
  const controller=createPublicQueueController({
    readPublicSnapshot:async()=>({counters:snapshot.counters,services:snapshot.services,context:snapshot.context}),
    subscribePublicDisplay:handlers=>{subscriptions++;callbacks=handlers;return async()=>{cleanups++}},
  })
  const settle=()=>new Promise(resolve=>setTimeout(resolve,0))
  try{
    controller.start();callbacks.onReady();await settle();await settle()
    let html=await render('PublicQueueDisplay',{state:controller.getState(),embedded:true})
    assert.match(html,/TP-123/)
    snapshot.counters[0].ticket_label='TP-124';callbacks.onInvalidate();await settle()
    html=await render('PublicQueueDisplay',{state:controller.getState(),embedded:true})
    assert.match(html,/TP-124/);assert.doesNotMatch(html,/TP-123/)
    assert.equal(subscriptions,1)
    callbacks.onDisconnect()
    html=await render('PublicQueueDisplay',{state:controller.getState(),embedded:true})
    assert.match(html,/Last reported call/);assert.doesNotMatch(html,/Live public display/)
  }finally{await controller.stop()}
  assert.equal(cleanups,1)
})

test('unexpected private identity fields never render in the public monitor',async()=>{
  const html=await render('PublicQueueDisplay',{state:{...state,counters:state.counters.map(row=>({...row,email:'PRIVATE_EMAIL_CANARY',owner_id:'PRIVATE_OWNER_CANARY',access_token:'PRIVATE_TOKEN_CANARY'}))},embedded:true})
  assert.doesNotMatch(html,/PRIVATE_EMAIL_CANARY|PRIVATE_OWNER_CANARY|PRIVATE_TOKEN_CANARY/)
})
