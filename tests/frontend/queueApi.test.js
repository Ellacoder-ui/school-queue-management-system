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

test('business reads explicitly target queue_api and reject issuance helpers', async () => {
  let invoked
  const api = createQueueApi({ schema(schema) { return { rpc(name, params) {
    invoked = { schema, name, params }; return Promise.resolve({ data: [], error: null, status: 200 })
  } } } })
  await api.read('my_tickets')
  assert.equal(invoked.schema, 'queue_api')
  assert.throws(() => api.read('issue_ticket'))
  assert.throws(() => api.createMutationIntent('issue_ticket', { p_service: 'TP' }))
})

test('an ambiguous action retry preserves its UUID and immutable original parameters', async () => {
  const calls = []; let attempt = 0
  const api = createQueueApi({ schema(schema) { return { rpc(name, params) {
    calls.push({ schema, name, params }); attempt += 1
    return Promise.resolve(attempt === 1 ? { error: { message: 'AbortError', code: '' }, status: 0 }
      : { data: { status: 'SERVED' }, error: null, status: 200 })
  } } } })
  const params = { p_counter: 'counter', p_services: ['TP'] }
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
