import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createQueueApi, validateMyContext, validatePublicContext } from '../../src/services/queueApi.js'
import { createLocalFetch } from '../../src/lib/localFetch.js'

const context = { timezone: 'Asia/Manila', business_date: '2026-10-16', queue_day_open: false, services: [] }
const publicRpc = () => ({ abortSignal() { return Promise.resolve({ data: context, error: null }) } })
import { validateLocalPublicConfig } from '../../src/lib/supabaseConfig.js'

const legacy = role => `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`
test('local client rejects hosted targets, secret keys, and service-role JWTs', () => {
  assert.throws(() => validateLocalPublicConfig('https://example.supabase.co', legacy('anon')))
  assert.throws(() => validateLocalPublicConfig('http://127.0.0.1:54321', 'sb_secret_example'))
  assert.throws(() => validateLocalPublicConfig('http://127.0.0.1:54321', legacy('service_role')))
  assert.equal(validateLocalPublicConfig('http://127.0.0.1:54321', legacy('anon')).url, 'http://127.0.0.1:54321')
  assert.equal(validateLocalPublicConfig('http://127.0.0.1:54321', 'sb_publishable_example').publicKey, 'sb_publishable_example')
})

test('business reads target queue_api; issuance is an explicit validated mutation only', async () => {
  let invoked
  const api = createQueueApi({ schema(schema) { return { rpc(name, params) {
    invoked = { schema, name, params }; return Promise.resolve({ data: [], error: null, status: 200 })
  } } } })
  await api.read('my_tickets')
  assert.equal(invoked.schema, 'queue_api')
  assert.throws(() => api.read('issue_ticket'))
  assert.equal(api.createMutationIntent('issue_ticket', { p_service: 'TP' }).operation, 'issue_ticket')
  assert.throws(() => api.createMutationIntent('issue_ticket', { p_service: 'UNKNOWN' }))
  assert.throws(() => api.createMutationIntent('issue_ticket', { p_service: 'TP', p_role: 'ADMIN' }))
  assert.equal(api.createMutationIntent('set_counter_open', {
    p_counter: '11111111-1111-4111-8111-111111111111', p_open: true,
  }).operation, 'set_counter_open')
  assert.throws(() => api.createMutationIntent('set_counter_open', {
    p_counter: '11111111-1111-4111-8111-111111111111', p_open: 'true',
  }))
})
test('counter opening after hours has a distinct operator-facing reason',async()=>{
 const api=createQueueApi({schema(){return{rpc(){return Promise.resolve({
  error:{code:'P0001',message:'Counter opening is unavailable after 5:00 PM'},status:400
 })}}}})
 const intent=api.createMutationIntent('set_counter_open',{p_counter:'11111111-1111-4111-8111-111111111111',p_open:true})
 await assert.rejects(api.executeMutation(intent),error=>error.reason==='counter_after_hours')
})

test('email assignments use the owner RPC contract and validate pending-first-login receipts',async()=>{
 const calls=[],receipt={status:'PENDING_FIRST_LOGIN',invitation:'11111111-1111-4111-8111-111111111111',email:'new.staff@example.invalid',role:'CASHIER',counter:'22222222-2222-4222-8222-222222222222'}
 const api=createQueueApi({schema(schema){return{rpc(name,params){calls.push({schema,name,params});return Promise.resolve({data:receipt,error:null,status:200})}}}})
 const intent=api.createMutationIntent('assign_staff_by_email',{p_email:'new.staff@example.invalid',p_role:'CASHIER',p_counter:receipt.counter})
 assert.deepEqual(await api.executeMutation(intent),receipt)
 assert.equal(calls[0].schema,'queue_api');assert.equal(calls[0].name,'assign_staff_by_email')
 assert.equal(calls[0].params.p_request_key,intent.parameters.p_request_key)
 assert.throws(()=>api.createMutationIntent('assign_staff_by_email',{p_email:'new.staff@example.invalid',p_role:'STUDENT',p_counter:null}))
})

test('staff role and counter changes use the atomic owner RPC contract',async()=>{
 const calls=[],receipt={user:'11111111-1111-4111-8111-111111111111',role:'CASHIER',enabled:true,counter:'22222222-2222-4222-8222-222222222222'}
 const api=createQueueApi({schema(schema){return{rpc(name,params){calls.push({schema,name,params});return Promise.resolve({data:receipt,error:null,status:200})}}}})
 const intent=api.createMutationIntent('set_staff_access',{p_user:receipt.user,p_role:'CASHIER',p_enabled:true,p_counter:receipt.counter})
 assert.deepEqual(await api.executeMutation(intent),receipt)
 assert.equal(calls[0].schema,'queue_api');assert.equal(calls[0].name,'set_staff_access')
 assert.equal(calls[0].params.p_request_key,intent.parameters.p_request_key)
 assert.throws(()=>api.createMutationIntent('set_staff_access',{p_user:receipt.user,p_role:'CASHIER',p_enabled:true,p_counter:null}))
})

test('ineligible counter assignment cleanup uses the explicit owner RPC contract',async()=>{
 const calls=[],receipt={counter:'11111111-1111-4111-8111-111111111111',user:'22222222-2222-4222-8222-222222222222',role:'STUDENT',enabled:true,removed:true}
 const api=createQueueApi({schema(schema){return{rpc(name,params){calls.push({schema,name,params});return Promise.resolve({data:receipt,error:null,status:200})}}}})
 const intent=api.createMutationIntent('remove_ineligible_counter_assignment',{p_counter:receipt.counter,p_user:receipt.user})
 assert.deepEqual(await api.executeMutation(intent),receipt)
 assert.equal(calls[0].schema,'queue_api');assert.equal(calls[0].name,'remove_ineligible_counter_assignment')
 assert.equal(calls[0].params.p_request_key,intent.parameters.p_request_key)
 assert.throws(()=>api.createMutationIntent('remove_ineligible_counter_assignment',{p_counter:receipt.counter,p_user:'student@example.invalid'}))
})

test('an ambiguous action retry preserves its UUID and immutable original parameters', async () => {
  const calls = []; let attempt = 0
  const api = createQueueApi({ schema(schema) { return { rpc(name, params) {
    calls.push({ schema, name, params }); attempt += 1
    return Promise.resolve(attempt === 1 ? { error: { message: 'AbortError', code: '' }, status: 0 }
      : { data: { counter:'11111111-1111-4111-8111-111111111111',open:false,services:['TP'],cashiers:[] }, error: null, status: 200 })
  } } } })
  const params = { p_counter: '11111111-1111-4111-8111-111111111111', p_open:false, p_services: ['TP'], p_cashiers:[] }
  const intent = api.createMutationIntent('configure_counter', params)
  params.p_services.push('SOA')
  await assert.rejects(api.executeMutation(intent), error => error.outcome === 'unknown' && error.requestKey === intent.parameters.p_request_key)
  await api.executeMutation(intent)
  assert.equal(calls[0].params.p_request_key, calls[1].params.p_request_key)
  assert.deepEqual(calls[1].params.p_services, ['TP'])
  assert.throws(() => { intent.parameters.p_services.push('ADJ') })
})

test('public snapshot uses explicit display columns and drops unexpected private fields', async () => {
  const requests = []
  const rows = { counter_state: [{ counter_id: 'counter', counter_label: 'Counter 1', is_open: true,
    ticket_label: null, service_code: null, business_date: null, updated_at: '2026-10-16T00:00:00Z', owner_id: 'PRIVATE' }],
  service_state: [{ service_code: 'TP', business_date: '2026-10-16', waiting_count: 0, updated_at: '2026-10-16T00:00:00Z' }] }
  const api = createQueueApi({ schema(schema) { return { rpc: publicRpc, from(table) {
    const builder = { select(columns) { requests.push({ schema, table, columns }); return this }, order() { return this },
      abortSignal() { return Promise.resolve({ data: rows[table], error: null }) } }
    return builder
  } } } })
  const result = await api.readPublicSnapshot()
  assert.ok(requests.every(r => r.schema === 'queue_display' && !r.columns.includes('*')))
  assert.equal(result.counters[0].owner_id, undefined)
  assert.equal(result.services[0].waiting_count, 0)
})

test('public subscriptions require both database listeners, not channel-join acknowledgements', async () => {
  const channels = []; let ready = 0, disconnected = 0, invalidated = 0, removed = 0
  const api = createQueueApi({ channel(name) {
    const channel = { name, handlers: {}, on(type, filter, handler) { this.handlers[type] = handler; this.filter = filter; return this },
      subscribe(handler) { this.status = handler; return this } }
    channels.push(channel); return channel
  }, async removeChannel() { removed += 1 } })
  const cleanup = api.subscribePublicDisplay({ onReady: () => ready++, onDisconnect: () => disconnected++, onInvalidate: () => invalidated++ })
  channels.forEach(c => c.status('SUBSCRIBED')); assert.equal(ready, 0)
  channels[0].handlers.system({ extension: 'postgres_changes', status: 'ok' }); assert.equal(ready, 0)
  channels[1].handlers.system({ extension: 'postgres_changes', status: 'ok' }); assert.equal(ready, 1)
  channels[0].status('CHANNEL_ERROR'); assert.equal(disconnected, 1)
  channels[0].handlers.system({ extension: 'postgres_changes', status: 'ok' }); assert.equal(ready, 2)
  channels[1].handlers.postgres_changes(); assert.equal(invalidated, 1)
  await cleanup(); assert.equal(removed, 2)
  channels[0].handlers.postgres_changes(); assert.equal(invalidated, 1)
})

test('truncated public snapshots fail instead of displaying partial totals', async () => {
  const api = createQueueApi({ schema() { return { rpc: publicRpc, from() { return {
    select() { return this }, order() { return this },
    abortSignal() { return Promise.resolve({ data: [], count: 1001, error: null }) },
  } } } } })
  await assert.rejects(api.readPublicSnapshot(), /truncated/)
})

test('self and public context reads use the correct clients and explicit schemas', async () => {
  const calls = []
  const business = { schema(schema) { return { rpc(name) { calls.push({ schema, name, client: 'business' });
    return Promise.resolve({ data: { role: 'STUDENT', enabled: true, cashier_counters: [] }, error: null }) } } } }
  const publicClient = { schema(schema) { return { rpc(name) { calls.push({ schema, name, client: 'public' });
    return Promise.resolve({ data: context, error: null }) } } } }
  const api = createQueueApi(business, publicClient)
  assert.equal((await api.readMyContext()).role, 'STUDENT')
  assert.equal((await api.read('my_context')).role, 'STUDENT')
  assert.equal((await api.readPublicContext()).timezone, 'Asia/Manila')
  assert.deepEqual(calls.at(-1), { schema: 'queue_display', name: 'public_queue_context', client: 'public' })
  assert.ok(calls.slice(0, 2).every(call => call.schema === 'queue_api' && call.name === 'my_context'))
})

test('context contracts reject unexpected identity fields, unknown roles and disabled privileges', () => {
  const value = { role: 'STUDENT', enabled: true, cashier_counters: [] }
  assert.throws(() => validateMyContext({ ...value, owner_id: 'PRIVATE' }))
  assert.throws(() => validateMyContext({ ...value, role: 'SUPERADMIN' }))
  assert.throws(() => validateMyContext({ ...value, enabled: false }))
  assert.deepEqual(validateMyContext({ role: null, enabled: false, cashier_counters: [] }), { role: null, enabled: false, cashier_counters: [] })
  assert.throws(() => validatePublicContext({ ...context, account_id: 'PRIVATE' }))
  assert.throws(() => validatePublicContext({ ...context, timezone: 'Browser/Timezone' }))
})

test('public context exposes only validated per-service issuance states', () => {
  const value = { ...context, services: [{ code: 'TP', name: 'Tuition Payment', issuance_status: 'QUEUE_CUTOFF' }] }
  assert.deepEqual(validatePublicContext(value).services[0].issuance_status, 'QUEUE_CUTOFF')
  assert.throws(() => validatePublicContext({ ...context, services: [{ ...value.services[0], issuance_status: 'OPEN_FOR_ALL' }] }))
  assert.throws(() => validatePublicContext({ ...context, services: [{ code: 'TP', name: 'Tuition Payment' }] }))
})

test('request guard rejects hosted traffic and refuses redirect following', async () => {
  let options
  const guarded = createLocalFetch(async (_, next) => { options = next; return 'ok' })
  assert.throws(() => guarded('https://example.supabase.co/auth/v1/token'))
  assert.equal(await guarded('http://127.0.0.1:54321/auth/v1/user'), 'ok')
  assert.equal(options.redirect, 'error')
  assert.ok(options.signal instanceof AbortSignal)
})

test('protected denials notify Auth reconciliation once and self-context denial cannot loop', async () => {
  const api = createQueueApi({ schema() { return { rpc() {
    return Promise.resolve({ error: { code: '42501' }, status: 403 })
  } } } })
  let denied = 0
  const unsubscribe = api.onAuthorizationDenied(() => { denied++ })
  await assert.rejects(api.read('my_tickets'))
  assert.equal(denied, 1)
  await assert.rejects(api.readMyContext())
  assert.equal(denied, 1)
  unsubscribe()
  await assert.rejects(api.read('my_tickets'))
  assert.equal(denied, 1)
})

test('partial subscription setup failure cleans up channels already created', async () => {
  let created = 0, removed = 0
  const api = createQueueApi({ channel() {
    created += 1
    if (created === 2) throw new Error('Transport setup failure')
    return { on() { return this }, subscribe() { return this } }
  }, async removeChannel() { removed += 1 } })
  assert.throws(() => api.subscribePublicDisplay({ onReady() {}, onDisconnect() {}, onInvalidate() {} }), /unavailable/)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(removed, 1)
})
test('repeated staff approval/AAL denials do not cause an Auth refresh loop; authentication failures still reconcile',async()=>{
  let allowed=false,status=403,denied=0
  const api=createQueueApi({schema(){return{rpc(){return Promise.resolve(allowed?{data:[],status:200}:{error:{code:'42501'},status})}}}})
  api.onAuthorizationDenied(()=>denied++)
  await assert.rejects(api.read('staff_queue'));await assert.rejects(api.read('staff_queue'));assert.equal(denied,1)
  status=401;await assert.rejects(api.read('staff_queue'));assert.equal(denied,2)
  allowed=true;await api.read('staff_queue');allowed=false;status=403
  await assert.rejects(api.read('staff_queue'));assert.equal(denied,3)
})
