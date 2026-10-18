import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPublicQueueController } from '../../src/lib/publicQueueController.js'

const turn = () => new Promise(resolve => setImmediate(resolve))
const data = label => ({ counters: [{ counter_id: 'public-counter', ticket_label: label }], services: [] })
function harness() {
  const requests = [], snapshots = []
  let callbacks, cleaned = 0
  const api = {
    readPublicSnapshot({ signal }) { return new Promise((resolve, reject) => requests.push({ resolve, reject, signal })) },
    subscribePublicDisplay(next) { callbacks = next; return async () => { cleaned += 1 } },
  }
  const controller = createPublicQueueController(api, { onState: state => snapshots.push(state) })
  controller.start()
  return { controller, requests, snapshots, get callbacks() { return callbacks }, get cleaned() { return cleaned } }
}

test('initial snapshot stays connecting until backend readiness and a fresh read', async () => {
  const h = harness()
  assert.equal(h.controller.getState().loading, true)
  h.requests[0].resolve(data('initial')); await turn()
  assert.equal(h.controller.getState().connection, 'connecting')
  h.callbacks.onReady()
  assert.equal(h.controller.getState().synchronized, false)
  assert.equal(h.requests.length, 2)
  h.requests[1].resolve(data('ready')); await turn()
  assert.equal(h.controller.getState().connection, 'connected')
  assert.equal(h.controller.getState().synchronized, true)
  assert.equal(h.controller.getState().counters[0].ticket_label, 'ready')
  await h.controller.stop()
})

test('events during a snapshot discard that response and coalesce a follow-up read', async () => {
  const h = harness()
  h.callbacks.onInvalidate(); h.callbacks.onInvalidate()
  h.requests[0].resolve(data('obsolete')); await turn()
  assert.equal(h.controller.getState().hasSnapshot, false)
  assert.equal(h.requests.length, 2)
  h.requests[1].resolve(data('latest')); await turn()
  assert.equal(h.controller.getState().counters[0].ticket_label, 'latest')
  await h.controller.stop()
})

test('disconnect invalidates in-flight responses even when the transport ignores abort', async () => {
  const h = harness()
  h.callbacks.onDisconnect()
  assert.equal(h.requests[0].signal.aborted, true)
  h.requests[0].resolve(data('obsolete')); await turn()
  assert.equal(h.controller.getState().hasSnapshot, false)
  h.callbacks.onReady()
  h.requests[1].resolve(data('obsolete-reconnect')); await turn()
  h.requests[2].resolve(data('reconnected')); await turn()
  assert.equal(h.controller.getState().counters[0].ticket_label, 'reconnected')
  await h.controller.stop()
})

test('snapshot errors retain last-known data and report failure without raw diagnostics', async () => {
  const h = harness()
  h.requests[0].resolve(data('last-known')); await turn()
  h.controller.refresh(); h.requests[1].reject(new Error('sensitive internal error')); await turn()
  const state = h.controller.getState()
  assert.equal(state.counters[0].ticket_label, 'last-known')
  assert.match(state.error, /Unable to load/)
  assert.doesNotMatch(state.error, /sensitive/)
  assert.equal(state.refreshing, false)
  await h.controller.stop()
})

test('empty published data is a successful snapshot, distinct from an error', async () => {
  const h = harness()
  h.requests[0].resolve({ counters: [], services: [] }); await turn()
  assert.equal(h.controller.getState().hasSnapshot, true)
  assert.equal(h.controller.getState().error, null)
  await h.controller.stop()
})

test('manual retry replaces subscriptions and unmount prevents later state writes', async () => {
  const h = harness()
  h.requests[0].resolve(data('first')); await turn()
  await h.controller.retry()
  assert.equal(h.cleaned, 1)
  const count = h.snapshots.length
  await h.controller.stop()
  h.requests[1].resolve(data('after-unmount')); await turn()
  assert.equal(h.cleaned, 2)
  assert.equal(h.snapshots.length, count)
})
