import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createQueueActions } from '../../src/lib/queueActions.js'
import { createQueueApi, QueueRequestError } from '../../src/services/queueApi.js'
const actor = '11111111-1111-4111-8111-111111111111', ticket = '22222222-2222-4222-8222-222222222222'
const receipt = { ticket_id: ticket, sequence_number: 1, service: 'TP', business_date: '2026-10-18', status: 'WAITING' }
const tick = () => new Promise(done => setImmediate(done))
function harness() {
  const values = new Map(), calls = []
  let scope = { actor, context: { enabled: true, role: 'STUDENT' } }
  const api = { readMyContext: async () => scope.context, readPublicContext: async () => ({ business_date: '2026-10-18', queue_day_open: true, services: [{ code: 'TP', issuance_status: 'OPEN' }] }),
    read: async () => [], createMutationIntent: (operation, parameters) => Object.freeze({ operation, parameters: Object.freeze({ ...parameters, p_request_key: randomUUID() }) }),
    executeMutation: async (intent, options) => { calls.push({ intent, options }); return receipt } }
  const options = { getAccess: () => scope, store: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }, withLock: body => body() }
  const controller = createQueueActions(api, options); controller.syncAccess()
  return { api, controller, calls, values, options, setScope: value => { scope = value; controller.syncAccess() } }
}
test('only supported actions proceed after fresh database context and admission checks', async () => {
  const h = harness(); await h.controller.perform('set_account', {}); assert.equal(h.calls.length, 0)
  h.api.readMyContext = async () => ({ enabled: true, role: 'CASHIER' }); await h.controller.perform('issue_ticket', { p_service: 'TP' })
  assert.equal(h.calls.length, 0); assert.equal(h.controller.getState().phase, 'error')
})
test('successful issue records one immutable intent and pins its verified actor', async () => {
  const h = harness(); await h.controller.perform('issue_ticket', { p_service: 'TP' })
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].options.expectedActor, actor)
  assert.equal(h.controller.getState().phase, 'success'); assert.equal(h.values.size, 0)
  assert.ok(Object.isFrozen(h.calls[0].intent.parameters))
})
test('closed day, unavailable service, active ticket and served quota block before any mutation', async () => {
  for (const [day, rows] of [
    [{ queue_day_open: false, services: [{ code: 'TP', issuance_status: 'OPEN' }] }, []],
    [{ queue_day_open: true, services: [] }, []],
    [{ queue_day_open: true, services: [{ code: 'TP', issuance_status: 'OPEN' }] }, [{ status: 'WAITING' }]],
    [{ queue_day_open: true, services: [{ code: 'TP', issuance_status: 'OPEN' }] }, Array.from({ length: 2 }, () => ({ status: 'SERVED', service: 'TP', business_date: '2026-10-18' }))],
  ]) {
    const h = harness(); h.api.readPublicContext = async () => ({ business_date: '2026-10-18', ...day }); h.api.read = async () => rows
    await h.controller.perform('issue_ticket', { p_service: 'TP' }); assert.equal(h.calls.length, 0); assert.equal(h.controller.getState().phase, 'error')
  }
})
test('closed and cutoff service admissions are stopped before queue reads or writes', async () => {
  for (const status of ['COUNTER_CLOSED', 'QUEUE_CUTOFF', 'AFTER_HOURS']) {
    const h = harness()
    h.api.readPublicContext = async () => ({ business_date: '2026-10-18', queue_day_open: true, services: [{ code: 'TP', issuance_status: status }] })
    await h.controller.perform('issue_ticket', { p_service: 'TP' })
    assert.equal(h.calls.length, 0)
    assert.equal(h.controller.getState().phase, 'error')
    assert.match(h.controller.getState().message, status === 'QUEUE_CUTOFF' ? /ended today/ : status === 'COUNTER_CLOSED' ? /closed/ : /5:00 PM/)
  }
})
test('ambiguous write remains durable across reload and only explicit retry reuses its exact key', async () => {
  const h = harness(); h.api.executeMutation = async (intent, options) => { h.calls.push({ intent, options }); throw new QueueRequestError({ outcome: 'unknown' }) }
  await h.controller.perform('issue_ticket', { p_service: 'TP' }); assert.equal(h.controller.getState().phase, 'unknown'); assert.equal(h.values.size, 1)
  await h.controller.perform('issue_ticket', { p_service: 'TP' }); assert.equal(h.calls.length, 1)
  h.controller.stop(); const next = createQueueActions(h.api, h.options); next.syncAccess(); assert.equal(next.getState().phase, 'unknown')
  await next.retry(); assert.equal(h.calls.length, 2); assert.deepEqual(h.calls[0].intent, h.calls[1].intent)
})
test('unknown issuance never crosses a business-date boundary automatically or on replay', async () => {
  const h = harness(); h.api.executeMutation = async () => { throw Error('Lost response') }
  await h.controller.perform('issue_ticket', { p_service: 'TP' })
  h.api.readPublicContext = async () => ({ business_date: '2026-10-19' })
  let sent = false; h.api.executeMutation = async () => { sent = true }; await h.controller.retry()
  assert.equal(sent, false); assert.equal(h.controller.getState().phase, 'unknown'); assert.equal(h.values.size, 1)
})
test('a rejected retry cannot erase an earlier unknown committed outcome', async () => {
  const h = harness(); h.api.executeMutation = async () => { throw Error('Lost') }; await h.controller.perform('issue_ticket', { p_service: 'TP' })
  h.api.executeMutation = async () => { throw new QueueRequestError({ reason: 'unauthorized', outcome: 'rejected' }) }; await h.controller.retry()
  assert.equal(h.controller.getState().phase, 'unknown'); assert.equal(h.values.size, 1)
})
test('pending duplicate clicks coalesce and account changes cannot restore a prior result', async () => {
  const h = harness(); let resolve
  h.api.executeMutation = (intent, options) => { h.calls.push({ intent, options }); return new Promise(done => { resolve = done }) }
  const pending = h.controller.perform('issue_ticket', { p_service: 'TP' }); await tick()
  void h.controller.perform('issue_ticket', { p_service: 'TP' }); assert.equal(h.calls.length, 1)
  h.setScope({ actor: '33333333-3333-4333-8333-333333333333', context: { enabled: true, role: 'STUDENT' } })
  resolve(receipt); await pending; assert.equal(h.controller.getState().phase, 'idle'); assert.equal(h.controller.getState().result, null)
})
test('storage failure, corrupt journal and an unavailable cross-tab lock fail closed', async () => {
  const h = harness(); h.options.store.setItem = () => { throw Error('Storage unavailable') }; await h.controller.perform('issue_ticket', { p_service: 'TP' }); assert.equal(h.calls.length, 0)
  const bad = harness(); bad.values.set('cqs-queue-intent-v1:' + actor, 'INVALID'); bad.controller.syncAccess(); assert.equal(bad.controller.getState().phase, 'blocked')
  const locked = harness(); const c = createQueueActions(locked.api, { ...locked.options, withLock: () => { throw Error('Unavailable lock') } }); c.syncAccess(); await c.perform('issue_ticket', { p_service: 'TP' }); assert.equal(locked.calls.length, 0)
})
test('counter and ticket state are checked against actual assignments before new actions', async () => {
  const h = harness(); h.setScope({ actor, context: { enabled: true, role: 'CASHIER', cashier_counters: [] } })
  await h.controller.perform('call_next', { p_counter: ticket, p_service: 'TP' }); assert.equal(h.calls.length, 0)
  await h.controller.perform('finish_ticket', { p_ticket: ticket, p_action: 'SERVE' }); assert.equal(h.calls.length, 0)
})
test('cashier counter open/close changes require the current cashier assignment and are replay-safe', async () => {
  const h = harness()
  const counter = '33333333-3333-4333-8333-333333333333'
  h.setScope({ actor, context: { enabled: true, role: 'CASHIER', cashier_counters: [
    { counter_id: counter, counter_number: 1, service_codes: ['TP'] },
  ] } })
  h.api.executeMutation = async (intent, options) => {
    h.calls.push({ intent, options })
    return { counter: intent.parameters.p_counter, open: intent.parameters.p_open }
  }
  await h.controller.perform('set_counter_open', { p_counter: counter, p_open: true })
  assert.equal(h.calls.length, 1)
  assert.equal(h.controller.getState().phase, 'success')
  assert.match(h.controller.getState().message, /opened/)

  const denied = harness()
  denied.setScope({ actor, context: { enabled: true, role: 'CASHIER', cashier_counters: [] } })
  await denied.controller.perform('set_counter_open', { p_counter: counter, p_open: false })
  assert.equal(denied.calls.length, 0)
})
test('calling uses the live server counter state instead of stale my_context open state', async () => {
  const h = harness()
  const counter = '33333333-3333-4333-8333-333333333333'
  h.setScope({ actor, context: { enabled: true, role: 'CASHIER', cashier_counters: [
    { counter_id: counter, counter_number: 1, counter_label: 'Counter 1', is_open: false, service_codes: ['TP'] },
  ] } })
  h.api.executeMutation = async (intent, options) => {
    h.calls.push({ intent, options })
    return { ticket_id: ticket, status: 'CALLED' }
  }

  await h.controller.perform('call_next', { p_counter: counter, p_service: 'TP' })

  assert.equal(h.calls.length, 1)
  assert.equal(h.controller.getState().phase, 'success')
  assert.match(h.controller.getState().message, /Ticket called/)
})
test('after-hours counter opening denial explains the Manila closing time', async () => {
  const h = harness()
  const counter = '33333333-3333-4333-8333-333333333333'
  h.setScope({ actor, context: { enabled: true, role: 'CASHIER', cashier_counters: [
    { counter_id: counter, counter_number: 1, service_codes: ['TP'] },
  ] } })
  h.api.executeMutation = async () => { throw new QueueRequestError({ reason: 'counter_after_hours' }) }

  await h.controller.perform('set_counter_open', { p_counter: counter, p_open: true })

  assert.match(h.controller.getState().message, /5:00 PM Manila time/)
})
test('RPC error reasons are allowlisted; arbitrary diagnostic strings remain private', async () => {
  const api = createQueueApi({ schema: () => ({ rpc: async () => ({ error: { code: 'P0001', message: 'Active ticket already exists' }, status: 400 }) }) })
  await assert.rejects(api.read('my_tickets'), error => error.reason === 'active_ticket' && !error.message.includes('Active ticket'))
})
test('actor-pinned RPC refuses a different token subject before request execution', async () => {
  let sent = false
  const token = 'header.' + btoa(JSON.stringify({ sub: ticket })) + '.signature'
  const api = createQueueApi({ auth: { getSession: async () => ({ data: { session: { access_token: token, user: { id: actor } } } }) },
    schema: () => ({ rpc: () => ({ setHeader() { sent = true; return this } }) }) })
  await assert.rejects(api.executeMutation(api.createMutationIntent('issue_ticket', { p_service: 'TP' }), { expectedActor: actor }), error => error.reason === 'unauthorized')
  assert.equal(sent, false)
})
test('mutation transport explicitly disables SDK automatic retries', async () => {
  let setting
  const request = Promise.resolve({ data: receipt, status: 200, error: null })
  request.retry = enabled => { setting = enabled; return request }
  const api = createQueueApi({ schema: () => ({ rpc: () => request }) })
  await api.executeMutation(api.createMutationIntent('issue_ticket', { p_service: 'TP' }))
  assert.equal(setting, false)
})
test('offline operations do not reserve a key or issue a mutation', async () => {
  const h = harness(); const c = createQueueActions(h.api, { ...h.options, online: () => false }); c.syncAccess()
  await c.perform('issue_ticket', { p_service: 'TP' }); assert.equal(h.calls.length, 0); assert.equal(h.values.size, 0)
})
test('a malformed successful HTTP receipt remains an unknown outcome with its original key', async () => {
  const api = createQueueApi({ schema: () => ({ rpc: async () => ({ data: { ticket_id: 'invalid' }, status: 200, error: null }) }) })
  const intent = api.createMutationIntent('issue_ticket', { p_service: 'TP' })
  await assert.rejects(api.executeMutation(intent), error => error.outcome === 'unknown' && error.requestKey === intent.parameters.p_request_key)
})
test('new actions stay locked until the post-operation authoritative refresh finishes', async () => {
  const h = harness(); let refreshed
  const c = createQueueActions(h.api, { ...h.options, afterOperation: () => new Promise(done => { refreshed = done }) }); c.syncAccess()
  const pending = c.perform('issue_ticket', { p_service: 'TP' }); await tick()
  assert.equal(c.getState().phase, 'success'); assert.equal(c.getState().busy, true)
  c.clearMessage(); assert.equal(c.getState().busy, true); assert.equal(c.getState().phase, 'success')
  await c.perform('issue_ticket', { p_service: 'TP' }); assert.equal(h.calls.length, 1)
  refreshed(); await pending; assert.equal(c.getState().busy, false)
})
