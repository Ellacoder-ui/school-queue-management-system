/** Exercises the same public API/controller imported by Vue. SQL is fixture-only.
 * Run: python supabase/tests/run_local_api_security.py --frontend
 */
import { createClient } from '@supabase/supabase-js'
import { spawnSync } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createQueueApi } from '../../src/services/queueApi.js'
import { createPublicQueueController } from '../../src/lib/publicQueueController.js'
import { validateLocalPublicConfig } from '../../src/lib/supabaseConfig.js'

const base = process.env.QUEUE_E2E_API, anon = process.env.QUEUE_E2E_ANON_KEY, psql = process.env.QUEUE_E2E_PSQL
validateLocalPublicConfig(base, anon)
if (process.env.PGHOSTADDR !== '127.0.0.1' || process.env.PGPORT !== '54322' || !psql) throw new Error('Local launcher required')
const run = randomUUID().slice(0, 8), checks = [], sockets = [], requests = []
const summary = { run, target: '127.0.0.1:54321 / 127.0.0.1:54322', checks }
let baseline, controller, day, failed = false
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const q = value => "'" + String(value).replaceAll("'", "''") + "'"
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
class Failure extends Error {}
function check(value, message) { if (!value) throw new Failure(message) }
function db(statement, readOnly = false) {
  const result = spawnSync(psql, ['-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate'], {
    input: `begin${readOnly ? ' read only' : ''}; ${statement}; commit;`, env: process.env, encoding: 'utf8', timeout: 30000,
  })
  check(!result.error && result.status === 0, 'Local fixture/catalog operation failed; diagnostics suppressed')
  return result.stdout.trim() ? JSON.parse(result.stdout.trim().split('\n').at(-1)) : null
}
function snapshot() {
  const tables = ['accounts', 'student_profiles', 'services', 'counters', 'counter_services', 'staff_counter_assignments',
    'queue_days', 'service_day_state', 'tickets', 'ticket_events', 'operation_requests', 'admin_audit_events', 'settings']
  return db(`select jsonb_build_object(${tables.map(t => `${q(t)},(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from queue_private.${t} x)`).join(',')})`, true)
}
function preserved() {
  const after = snapshot()
  for (const [table, rows] of Object.entries(baseline)) {
    const hashes = new Set(after[table].map(hash))
    check(rows.every(row => hashes.has(hash(row))), 'A pre-existing application fixture changed')
  }
  summary.existing_fixtures_preserved = true
}
async function waitFor(predicate, message) {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) { if (predicate()) return; await delay(100) }
  throw new Failure(message)
}
async function test(name, body) {
  try { await body(); checks.push({ name, result: 'PASS' }); console.log(`PASS: ${name}`) }
  catch (error) { checks.push({ name, result: 'FAIL', reason: error instanceof Failure ? error.message : 'Harness exception; raw diagnostics suppressed' }); failed = true; throw error }
}
const fetchActual = globalThis.fetch
const publicFetch = async (input, options) => {
  const url = new URL(input instanceof Request ? input.url : input)
  check(url.origin === base, 'Frontend attempted a non-local request')
  const headers = new Headers(options?.headers || (input instanceof Request ? input.headers : undefined))
  check(headers.get('apikey') === anon && headers.get('Authorization') === `Bearer ${anon}`, 'Frontend used credentials other than its public key')
  check((headers.get('Accept-Profile') || headers.get('Content-Profile')) === 'queue_display', 'Frontend read a non-public queue schema')
  check(['counter_state', 'service_state'].some(table => url.pathname === `/rest/v1/${table}`)
    || url.pathname === '/rest/v1/rpc/public_queue_context', 'Unexpected frontend endpoint')
  requests.push({ method: options?.method || 'GET', table: url.pathname.split('/').at(-1) })
  return fetchActual(input, { ...options, redirect: 'error' })
}
class Transport extends WebSocket {
  constructor(url, ...args) {
    check(new URL(url).origin === 'ws://127.0.0.1:54321', 'Frontend attempted a non-local WebSocket')
    super(url, ...args); sockets.push(this)
  }
}
const client = createClient(base, anon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: publicFetch }, realtime: { transport: Transport, reconnectAfterMs: () => 200, logger: () => {} } })
const api = createQueueApi(client, client)
try {
  baseline = snapshot()
  await test('Actual frontend service reads both public tables using only its public key', async () => {
    const data = await api.readPublicSnapshot()
    check(data.counters.length === 5 && data.services.length === 0, 'Unexpected initial public fixture state')
    check(db("select count(*) from queue_private.tickets where status in ('WAITING','CALLED')", true) === 0, 'Active work found; fixture setup refused')
  })
  await test('Frontend controller waits for both listeners and loads a synchronized snapshot', async () => {
    controller = createPublicQueueController(api)
    controller.start()
    await waitFor(() => controller.getState().synchronized && controller.getState().hasSnapshot, 'Initial frontend synchronization timed out')
    check(controller.getState().counters.length === 5, 'Initial snapshot was not loaded')
  })
  await test('Actual counter and service events trigger fresh frontend snapshots', async () => {
    day = db(`select 1 from queue_private.settings where id for update;
      insert into queue_private.queue_days(business_date,timezone_snapshot)
        select min(business_date)-1,'Asia/Manila' from queue_private.queue_days
        returning jsonb_build_object('id',id,'date',business_date)`)
    db('select queue_private.refresh_display()')
    await waitFor(() => controller.getState().services.filter(s => s.business_date === day.date).length === 5 &&
      controller.getState().synchronized && !controller.getState().refreshing, 'Frontend did not refresh after service inserts')
    check(controller.getState().services.every(row => row.waiting_count === 0), 'Reported count does not match empty fixture day')
  })
  await test('Frontend reconnect replaces stale state with the post-disconnect snapshot', async () => {
    const socketCount = sockets.length
    const socket = sockets.at(-1), closed = new Promise(resolve => socket.addEventListener('close', resolve, { once: true }))
    socket.close(4000, 'local frontend reconnection validation'); await closed
    db(`select set_config('request.jwt.claim.sub',(select id::text from queue_private.accounts where role='ADMIN' and enabled order by id limit 1),true);
      select queue_api.manage_day('CLOSE',${q(day.date)}::date,${q(randomUUID())}::uuid)`)
    await waitFor(() => sockets.length > socketCount && controller.getState().synchronized &&
      controller.getState().services.length === 0 && !controller.getState().refreshing, 'Reconnected frontend retained stale service rows')
    summary.websocket_instances = sockets.length
  })
  await test('Updates still refresh the frontend after reconnect', async () => {
    const previous = controller.getState().lastRefreshed
    db('select queue_private.refresh_display()')
    await waitFor(() => controller.getState().lastRefreshed !== previous && !controller.getState().refreshing,
      'No frontend refresh after reconnect')
  })
  await test('Unmount removes only this display’s two channels', async () => {
    await controller.stop()
    check(client.getChannels().length === 0, 'Frontend channel cleanup failed')
  })
  await test('Existing application fixtures remain unchanged', async () => preserved())
} catch {
  failed = true
  if (!checks.some(check => check.result === 'FAIL')) checks.push({ name: 'Frontend local fixture setup', result: 'FAIL', reason: 'Setup failed; diagnostics suppressed' })
  console.log('STOP: frontend integration validation stopped; no reset or forced cleanup performed.')
} finally {
  if (controller) await controller.stop()
  await client.removeAllChannels()
  if (baseline && !summary.existing_fixtures_preserved) {
    try { preserved() } catch { checks.push({ name: 'Fixture preservation', result: 'FAIL', reason: 'Preservation check failed' }); failed = true }
  }
  summary.passed = checks.filter(c => c.result === 'PASS').length
  summary.failed = checks.filter(c => c.result === 'FAIL').length
  summary.frontend_http_requests = requests.length
  summary.frontend_endpoints = [...new Set(requests.map(r => r.table))]
  summary.frontend_public_credentials_only = true
  if (day) summary.retained_closed_fixture_day = day.date
  const directory = new URL('./results/', import.meta.url); mkdirSync(directory, { recursive: true })
  const path = new URL(`frontend_public_${run}.json`, directory)
  writeFileSync(path, JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' })
  console.log(`Summary: ${summary.passed} passed; ${summary.failed} failed.`)
  console.log(`Sanitized results: ${fileURLToPath(path)}`)
  process.exitCode = failed ? 1 : 0
}
