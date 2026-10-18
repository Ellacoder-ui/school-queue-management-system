import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAuthController } from '../../src/lib/authController.js'
import { dateInZone, nextDateDelay } from '../../src/lib/businessDate.js'
import { createPublicQueueController } from '../../src/lib/publicQueueController.js'

const turn = () => new Promise(resolve => setTimeout(resolve, 5))
const context = role => ({ role, enabled: true, cashier_counters: [] })
const identity = (id = 'one', expires = Date.now() / 1000 + 3600) => ({ user: { id, user_metadata: { role: 'ADMIN' } }, expires_at: expires, access_token: 'PRIVATE-TOKEN' })
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
function harness(t, initial = null, overrides = {}, options = {}) {
  let current = initial, callback, unsubscribed = false
  const requests = [], states = []
  const auth = {
    onAuthStateChange(fn) { callback = fn; return { data: { subscription: { unsubscribe() { unsubscribed = true } } } } },
    async getSession() { return { data: { session: current }, error: null } },
    async getUser() { return { data: { user: current?.user }, error: null } },
    async signInWithPassword() { current = identity(); callback('SIGNED_IN', current); return { data: { session: current }, error: null } },
    async signOut() { current = null; callback('SIGNED_OUT', null); return { error: null } },
    ...overrides,
  }
  const api = { readMyContext({ signal }) { const request = deferred(); requests.push({ ...request, signal }); return request.promise } }
  const controller = createAuthController(auth, api, { onState: state => states.push(state), ...options })
  t.after(() => controller.stop())
  controller.start()
  return { controller, requests, states, auth,
    event(next, event = 'SIGNED_IN') { current = next; callback(event, next) },
    get unsubscribed() { return unsubscribed } }
}
async function ready(h, role = 'STUDENT') { await turn(); h.requests.at(-1).resolve(context(role)); await turn() }

test('anonymous startup permits public navigation only and emits no sensitive session data', async t => {
  const h = harness(t); await turn()
  assert.equal(h.controller.getState().status, 'anonymous')
  assert.equal(h.controller.navigate('admin'), false)
  assert.equal(h.controller.navigate('public'), true)
  assert.doesNotMatch(JSON.stringify(h.states), /PRIVATE-TOKEN|user_metadata/)
})

test('external OAuth remains gated through SIGNED_IN until explicit completion and fresh context', async t => {
  const h=harness(t);await turn()
  const action=h.controller.beginExternal()
  h.event(identity())
  await turn();assert.equal(h.requests.length,0);assert.equal(h.controller.getState().context,null)
  h.controller.acceptExternal(action,identity());await ready(h)
  assert.equal(h.controller.getState().context.role,'STUDENT')
})

test('logout invalidates external completion without restoring previous OAuth privileges', async t => {
  const h=harness(t);await turn()
  const action=h.controller.beginExternal()
  await h.controller.logout();h.controller.acceptExternal(action,identity());await turn()
  assert.equal(h.controller.getState().context,null);assert.equal(h.controller.getState().workspace,'public')
})
test('stored session needs fresh server user and role context before navigation', async t => {
  const h = harness(t, identity()); await turn()
  assert.equal(h.controller.navigate('admin'), false)
  assert.equal(h.controller.getState().context, null)
  await ready(h)
  assert.equal(h.controller.getState().workspace, 'student')
  assert.equal(h.controller.navigate('admin'), false)
})
for (const role of ['STUDENT', 'CASHIER', 'ADMIN']) test(`${role} context exclusively controls workspace selection`, async t => {
  const h = harness(t, identity()); await ready(h, role)
  assert.equal(h.controller.getState().workspace, role.toLowerCase())
  assert.equal(h.controller.navigate(role.toLowerCase()), true)
  assert.equal(h.controller.navigate(role === 'ADMIN' ? 'cashier' : 'admin'), false)
})
test('disabled account has no role navigation', async t => {
  const h = harness(t, identity()); await turn()
  h.requests[0].resolve({ role: null, enabled: false, cashier_counters: [] }); await turn()
  assert.equal(h.controller.getState().status, 'disabled')
  assert.equal(h.controller.navigate('student'), false)
})
test('logout clears assignments synchronously and late context cannot restore them', async t => {
  const h = harness(t, identity()); await turn()
  const old = h.requests[0]
  const logout = h.controller.logout()
  assert.equal(h.controller.getState().context, null)
  old.resolve(context('ADMIN')); await logout; await turn()
  assert.equal(h.controller.getState().status, 'anonymous')
  assert.equal(h.controller.navigate('admin'), false)
})
test('account switch aborts old read and ignores its response even if abort is ignored', async t => {
  const h = harness(t, identity('old')); await turn()
  const old = h.requests[0]
  h.event(identity('new')); assert.equal(old.signal.aborted, true)
  assert.equal(h.controller.getState().context, null)
  await ready(h, 'CASHIER')
  old.resolve(context('ADMIN')); await turn()
  assert.equal(h.controller.getState().context.role, 'CASHIER')
})
test('initial session lookup cannot overwrite a newer Auth event', async t => {
  const old = deferred()
  let first = true
  const h = harness(t, null, { getSession: async () => {
    if (first) { first = false; return old.promise }
    return { data: { session: identity('new') }, error: null }
  } })
  h.event(identity('new')); await ready(h, 'STUDENT')
  old.resolve({ data: { session: identity('old') }, error: null }); await turn()
  assert.equal(h.controller.getState().context.role, 'STUDENT')
  assert.equal(h.requests.length, 1)
})
test('role revocation removes previous workspace before new context arrives', async t => {
  const h = harness(t, identity()); await ready(h, 'ADMIN')
  h.controller.refresh(); assert.equal(h.controller.getState().context, null)
  assert.equal(h.controller.navigate('admin'), false)
  await ready(h, 'STUDENT')
  assert.equal(h.controller.getState().workspace, 'student')
})
test('choosing public navigation stays public across overlapping access refreshes', async t => {
  const h = harness(t, identity()); await ready(h, 'ADMIN')
  h.controller.navigate('public'); h.controller.refresh(); h.controller.refresh()
  await ready(h, 'ADMIN')
  assert.equal(h.controller.getState().workspace, 'public')
})
test('expiry timer clears an existing workspace before failed session recovery', async t => {
  let clock = 1000000
  const callbacks = new Map(); let nextTimer = 0
  const h = harness(t, identity('one', 1010), {}, { now: () => clock,
    setTimer(fn, ms) { callbacks.set(++nextTimer, {fn, ms}); return nextTimer }, clearTimer(id) { callbacks.delete(id) } })
  await ready(h, 'ADMIN')
  const expiration = [...callbacks.values()].find(timer => timer.ms === 10000)
  assert.ok(expiration)
  clock = 1010000; expiration.fn()
  assert.equal(h.controller.getState().context, null)
  await turn()
  assert.equal(h.controller.getState().status, 'expired')
})
test('offline and protected-denial reconciliation fail closed then load fresh context', async t => {
  const h = harness(t, identity()); await ready(h, 'CASHIER')
  h.controller.offline(); assert.equal(h.controller.getState().context, null)
  h.controller.refresh(); await ready(h, 'CASHIER')
  h.controller.protectedDenied(); assert.equal(h.controller.navigate('cashier'), false)
  await ready(h, 'STUDENT')
  assert.equal(h.controller.getState().context.role, 'STUDENT')
})
test('context errors reveal no database diagnostics and grant no navigation', async t => {
  const h = harness(t, identity()); await turn()
  h.requests[0].reject(new Error('PRIVATE database detail')); await turn()
  assert.equal(h.controller.getState().status, 'error')
  assert.doesNotMatch(JSON.stringify(h.states), /PRIVATE database/)
  assert.equal(h.controller.navigate('student'), false)
})
test('expired unrefreshed session cannot retain or regain a workspace', async t => {
  const h = harness(t, identity('one', Date.now() / 1000 - 1)); await turn()
  assert.equal(h.controller.getState().status, 'expired')
  assert.equal(h.requests.length, 0)
  assert.equal(h.controller.navigate('student'), false)
})
test('Auth SIGNED_OUT without user logout clears the current workspace as session ended', async t => {
  const h = harness(t, identity()); await ready(h)
  h.event(null, 'SIGNED_OUT')
  assert.equal(h.controller.getState().status, 'expired')
  assert.equal(h.controller.getState().context, null)
})
test('TOKEN_REFRESHED invalidates old role then verifies fresh context', async t => {
  const h = harness(t, identity()); await ready(h, 'ADMIN')
  h.event(identity(), 'TOKEN_REFRESHED')
  assert.equal(h.controller.getState().context, null)
  await ready(h, 'STUDENT')
  assert.equal(h.controller.getState().context.role, 'STUDENT')
})
test('failed login is generic; a late successful event after timeout stays blocked', async t => {
  const pending = deferred()
  const h = harness(t, null, { signInWithPassword: () => pending.promise }, { timeoutMs: 10 })
  await turn(); await h.controller.login('private@example.invalid', 'PRIVATE-PASSWORD')
  assert.match(h.controller.getState().message, /Sign-in failed/)
  h.event(identity()); await turn()
  assert.equal(h.controller.getState().context, null)
  assert.doesNotMatch(JSON.stringify(h.states), /PRIVATE-PASSWORD|private@example/)
})
test('logout failure locks access and ignores surviving session events', async t => {
  const h = harness(t, identity(), { signOut: async () => ({ error: new Error('internal') }) }); await ready(h, 'ADMIN')
  await h.controller.logout(); h.event(identity(), 'TOKEN_REFRESHED'); await turn()
  assert.equal(h.controller.getState().context, null)
  assert.equal(h.controller.navigate('admin'), false)
  assert.match(h.controller.getState().message, /Access is locked/)
})
test('login followed by logout and a different login obtains a new context', async t => {
  const h = harness(t); await turn(); await h.controller.login('one@local.invalid', 'password')
  await ready(h, 'CASHIER'); await h.controller.logout()
  await h.controller.login('two@local.invalid', 'different'); await ready(h, 'STUDENT')
  assert.equal(h.controller.getState().context.role, 'STUDENT')
})
test('unmount unsubscribes Auth and ignores outstanding context', async t => {
  const h = harness(t, identity()); await turn(); const old = h.requests[0]
  h.controller.stop(); const count = h.states.length
  old.resolve(context('ADMIN')); h.event(identity('new')); await turn()
  assert.equal(h.unsubscribed, true)
  assert.equal(h.states.length, count)
})
test('Manila date rollover is derived from RPC timezone and triggers a fresh public snapshot', async () => {
  let clock = Date.parse('2026-10-16T15:59:59Z'), callback, requests = 0
  const ctx = { timezone: 'Asia/Manila', business_date: '2026-10-16', queue_day_open: false, services: [] }
  assert.equal(nextDateDelay(clock, ctx.timezone), 1000)
  assert.equal(dateInZone(clock + 1000, ctx.timezone), '2026-10-17')
  const api = { async readPublicSnapshot() { requests++; return { counters: [], services: [], context: { ...ctx, business_date: dateInZone(clock, ctx.timezone) } } },
    subscribePublicDisplay() { return async () => {} } }
  const controller = createPublicQueueController(api, { clock: () => clock, setTimer(fn) { callback = fn; return 1 }, clearTimer() {} })
  controller.start(); await turn(); clock += 1000; callback(); await turn()
  assert.equal(requests, 2)
  assert.equal(controller.getState().context.business_date, '2026-10-17')
  await controller.stop()
})
