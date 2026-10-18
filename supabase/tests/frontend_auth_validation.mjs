/** Phase 2 local-only real SDK/controller/browser tests. No dotenv or original-row changes. */
import {createClient} from '@supabase/supabase-js'
import {spawn, spawnSync} from 'node:child_process'
import {randomUUID, randomBytes, createHash} from 'node:crypto'
import {mkdirSync, writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {createQueueApi} from '../../src/services/queueApi.js'
import {createAuthController} from '../../src/lib/authController.js'
import {createPublicQueueController} from '../../src/lib/publicQueueController.js'
import {createLocalFetch} from '../../src/lib/localFetch.js'
import {validateLocalPublicConfig} from '../../src/lib/supabaseConfig.js'
import {startLocalBrowser} from './headless_local_browser.mjs'

const base = process.env.QUEUE_E2E_API, pub = process.env.QUEUE_E2E_ANON_KEY,
  service = process.env.QUEUE_E2E_SERVICE_KEY, psql = process.env.QUEUE_E2E_PSQL
validateLocalPublicConfig(base, pub)
if (process.env.PGHOST !== '127.0.0.1' || process.env.PGHOSTADDR !== '127.0.0.1' || process.env.PGPORT !== '54322' || !service || !psql) throw new Error('Local launcher required')
const run = randomUUID().slice(0,8), users = {}, privateValues = [], checks = [], requests = [], sockets = []
const report = {run, target: '127.0.0.1:54321 / 127.0.0.1:54322', checks}
const directory = fileURLToPath(new URL('./results/', import.meta.url))
mkdirSync(directory, {recursive: true})
let baseline, controller, publicController, browser, vite, failed = false
class Failure extends Error {}
const check = (v, message) => { if (!v) throw new Failure(message) }
const q = value => "'" + String(value).replaceAll("'", "''") + "'"
const delay = ms => new Promise(r => setTimeout(r, ms))
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
function sql(statement, readOnly = true) {
  const result = spawnSync(psql, ['-X','-w','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],
    {input: `begin${readOnly ? ' read only' : ''}; ${statement}; commit;`, env: process.env, encoding: 'utf8', timeout: 30000})
  check(!result.error && result.status === 0, 'Local SQL fixture operation failed; details suppressed')
  return result.stdout.trim() ? JSON.parse(result.stdout.trim().split('\n').at(-1)) : null
}
function snapshot() {
  const tables = sql("select jsonb_agg(format('%I.%I',schemaname,tablename) order by schemaname,tablename) from pg_tables where schemaname in ('queue_private','queue_display')")
  tables.push('auth.users','auth.identities')
  return Object.fromEntries(tables.map(table => [table, sql(`select coalesce(jsonb_agg(md5(to_jsonb(t)::text) order by md5(to_jsonb(t)::text)),'[]') from ${table} t`)]))
}
function preserved() {
  const after = snapshot()
  for (const [table, rows] of Object.entries(baseline)) check(rows.every(row => after[table].includes(row)), 'Pre-existing fixture changed')
  report.existing_fixtures_preserved = true
}
async function waitFor(fn, message) {
  const until = Date.now() + 22000
  while (Date.now() < until) { if (await fn()) return; await delay(50) }
  throw new Failure(message)
}
async function test(name, body, skip) {
  if (skip) { checks.push({name, result: 'SKIP', reason: skip}); console.log(`SKIP: ${name}`); return }
  try { await body(); checks.push({name, result: 'PASS'}); console.log(`PASS: ${name}`) }
  catch (error) { checks.push({name, result: 'FAIL', reason: error instanceof Failure ? error.message : 'Harness exception; raw details suppressed'}); throw error }
}
async function subject(name) {
  const email = `queue-ui-${run}-${name}@example.invalid`, password = randomBytes(32).toString('base64url')
  const response = await fetch(`${base}/auth/v1/admin/users`, {method: 'POST', redirect: 'error',
    headers: {apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({email, password, email_confirm: true, user_metadata: {role: 'ADMIN', display_name: `PRIVATE-UI-${run}`}})})
  check(response.ok, 'Fixture Auth creation failed')
  const data = await response.json(); users[name] = {id: data.id, email, password}
  privateValues.push(data.id, email, password, `PRIVATE-UI-${run}`)
}
function role(name, value, enabled = true) {
  sql(`update queue_private.accounts set role=${q(value)}::queue_private.app_role,enabled=${enabled},updated_at=clock_timestamp() where id=${q(users[name].id)}; select jsonb_build_object('updated',true)`, false)
}
const publicPaths = new Set(['/rest/v1/counter_state','/rest/v1/service_state','/rest/v1/rpc/public_queue_context'])
function guardedFetch(isPublic) {
  return createLocalFetch(async (input, options) => {
    const url = new URL(input instanceof Request ? input.url : input)
    const headers = new Headers(options?.headers || (input instanceof Request ? input.headers : undefined))
    check(headers.get('apikey') === pub, 'Frontend request used a non-public API key')
    const path = url.pathname
    if (isPublic) {
      check(publicPaths.has(path), 'Unexpected public endpoint')
      check(headers.get('Authorization') === `Bearer ${pub}`, 'Public display inherited a session')
      check((headers.get('Content-Profile') || headers.get('Accept-Profile')) === 'queue_display', 'Wrong public schema')
    } else check(path.startsWith('/auth/v1/') || path === '/rest/v1/rpc/my_context', 'Operational or private frontend endpoint refused')
    requests.push({path, public: isPublic})
    return fetch(input, options)
  })
}
class Transport extends WebSocket {
  constructor(url, ...args) {
    check(new URL(url).origin === 'ws://127.0.0.1:54321', 'Non-local socket refused')
    super(url, ...args); sockets.push(this)
  }
}
const business = createClient(base, pub, {auth: {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false},
  global: {fetch: guardedFetch(false)}})
const publicClient = createClient(base, pub, {auth: {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false},
  global: {fetch: guardedFetch(true)}, realtime: {transport: Transport, reconnectAfterMs: () => 200, logger: () => {}}})
const api = createQueueApi(business, publicClient)
async function login(name, expected = name) {
  await controller.login(users[name].email, users[name].password)
  await waitFor(() => controller.getState().status === 'ready', 'Role context not ready after real login')
  check(controller.getState().context.role.toLowerCase() === expected, 'Wrong role after login')
}
async function browserWait(selector) { await waitFor(() => browser.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`), 'Browser UI state timed out') }
async function browserLogin(name, selector) {
  await browserWait('#login-email')
  await browser.evaluate(`(() => {
    const email = document.querySelector('#login-email'), password = document.querySelector('#login-password');
    email.value = ${JSON.stringify(users[name].email)}; email.dispatchEvent(new Event('input', {bubbles:true}));
    password.value = ${JSON.stringify(users[name].password)}; password.dispatchEvent(new Event('input', {bubbles:true}));
    document.querySelector('#account-workspace form').requestSubmit();
  })()`)
  await browserWait(selector)
}
async function browserLogout() {
  await browser.evaluate("[...document.querySelectorAll('#account-workspace button')].find(b=>b.textContent.trim()==='Sign out').click()")
  await browserWait('#login-email')
}

try {
  baseline = snapshot()
  await test('Five migrations and unchanged database security preflight', () => {
    check(sql('select count(*) from supabase_migrations.schema_migrations') === 5, 'Unexpected migration history')
    check(sql("select count(*) from pg_tables where schemaname in ('queue_private','queue_display') and rowsecurity") === 15, 'RLS changed')
  })
  for (const name of ['student','cashier','admin','revoked','disabled']) await subject(name)
  role('cashier','CASHIER'); role('revoked','CASHIER'); role('admin','ADMIN'); role('disabled','STUDENT',false)
  sql(`insert into queue_private.staff_counter_assignments(account_id,counter_id)
    select ${q(users.cashier.id)},id from queue_private.counters where number=5; select jsonb_build_object('assigned',true)`, false)
  controller = createAuthController(business.auth, api)
  controller.start()
  await test('Anonymous public snapshot includes current catalog and authoritative day', async () => {
    const snapshot = await api.readPublicSnapshot()
    check(snapshot.counters.length === 5 && snapshot.context.timezone === 'Asia/Manila', 'Public snapshot contract mismatch')
    check(snapshot.context.queue_day_open === false && snapshot.context.services.length === 5, 'Current closed day/catalog mismatch')
    check(privateValues.every(value => !JSON.stringify(snapshot).includes(value)), 'Public snapshot identity leak')
  })
  await test('Incorrect password produces generic sign-in failure without a workspace', async () => {
    await controller.login(users.student.email, 'incorrect-local-test-password')
    check(controller.getState().status === 'anonymous' && controller.getState().context === null, 'Failed login granted workspace')
  })
  for (const name of ['student','cashier','admin']) await test(`Real ${name.toUpperCase()} login selects only its authorized workspace`, async () => {
    await login(name)
    check(!controller.navigate(name === 'admin' ? 'cashier' : 'admin'), 'Foreign workspace navigation allowed')
    if (name === 'cashier') check(controller.getState().context.cashier_counters[0]?.counter_number === 5, 'Assignment not loaded')
    await controller.logout(); check(controller.getState().context === null, 'Logout retained context')
  })
  await test('Disabled account can authenticate but sees only access-disabled state', async () => {
    await controller.login(users.disabled.email, users.disabled.password)
    await waitFor(() => controller.getState().status === 'disabled', 'Disabled state not rendered')
    check(!controller.navigate('student'), 'Disabled navigation permitted'); await controller.logout()
  })
  await test('Revoked cashier session revalidates to student after protected-denial signal', async () => {
    await login('revoked','cashier'); role('revoked','STUDENT')
    controller.protectedDenied(); check(controller.getState().context === null, 'Revocation recheck retained role')
    await waitFor(() => controller.getState().status === 'ready', 'Revoked role recheck timed out')
    check(controller.getState().context.role === 'STUDENT', 'Existing session kept former role'); await controller.logout()
  })
  await test('Actual token refresh rechecks database role without trusting ADMIN metadata', async () => {
    await login('student'); await business.auth.refreshSession()
    await waitFor(() => controller.getState().status === 'ready', 'Token refresh context timed out')
    check(controller.getState().context.role === 'STUDENT', 'Metadata promoted account'); await controller.logout()
  })
  await test('Realtime reconnect refreshes the complete public context snapshot', async () => {
    publicController = createPublicQueueController(api)
    publicController.start()
    await waitFor(() => publicController.getState().synchronized, 'Public readiness timed out')
    const count = sockets.length, before = publicController.getState().lastRefreshed
    sockets.at(-1).close(4000, 'Local reconnect test')
    await waitFor(() => sockets.length > count && publicController.getState().synchronized && publicController.getState().lastRefreshed !== before, 'Fresh reconnect snapshot not observed')
    check(publicController.getState().context.queue_day_open === false, 'Reconnect lost authoritative context')
    await publicController.stop()
  })
  browser = await startLocalBrowser(run)
  if (browser) {
    const frontendEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(PG|QUEUE_|VITE_|SUPABASE_)/i.test(key)))
    Object.assign(frontendEnv, {VITE_SUPABASE_URL: base, VITE_SUPABASE_PUBLISHABLE_KEY: pub})
    vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5174','--strictPort'],
      {env: frontendEnv, windowsHide: true, stdio: 'ignore'})
    await waitFor(async () => { try { return (await fetch('http://127.0.0.1:5174', {redirect:'error'})).ok } catch { return false } }, 'Isolated Vite startup timed out')
    let unsafe = false, browserError = false
    const browserRequests = []
    await browser.send('Network.enable'); await browser.send('Runtime.enable'); await browser.send('Page.enable')
    browser.on('Runtime.exceptionThrown', () => { browserError = true })
    await browser.send('Fetch.enable', {patterns: [{urlPattern:'*', requestStage:'Request'}]})
    browser.on('Fetch.requestPaused', event => {
      const url = new URL(event.request.url)
      const local = ['http://127.0.0.1:5174','http://127.0.0.1:54321'].includes(url.origin)
      const permitted = local && (url.port === '5174' || publicPaths.has(url.pathname)
        || url.pathname === '/rest/v1/rpc/my_context' || url.pathname.startsWith('/auth/v1/'))
      if (!permitted) unsafe = true
      browserRequests.push(url.pathname)
      void browser.send(permitted ? 'Fetch.continueRequest' : 'Fetch.failRequest', {requestId:event.requestId, ...(permitted ? {} : {errorReason:'BlockedByClient'})}).catch(() => {})
    })
    await browser.send('Emulation.setDeviceMetricsOverride', {width:1440,height:1000,deviceScaleFactor:1,mobile:false})
    await browser.send('Page.navigate', {url:'http://127.0.0.1:5174'})
    await test('Desktop browser anonymous display and sign-in form render without overflow', async () => {
      await browserWait('#login-email'); await browserWait('[data-testid="business-context"]')
      check(await browser.evaluate("document.documentElement.scrollWidth <= innerWidth && document.body.textContent.includes('Queue day not open')"), 'Desktop layout/day state incorrect')
      await browser.screenshot(`${directory}/frontend_auth_${run}_desktop.png`)
    })
    for (const name of ['student','cashier','admin']) await test(`Browser ${name} login/logout and navigation`, async () => {
      await browserLogin(name, `[data-testid="${name}-workspace"]`)
      check(await browser.evaluate(`!document.querySelector('[data-testid="${name === 'admin' ? 'cashier' : 'admin'}-workspace"]')`), 'Foreign workspace rendered')
      if (name === 'cashier') check(await browser.evaluate("document.querySelector('[data-testid=\"cashier-workspace\"]').textContent.includes('Counter 5')"), 'Browser counter assignment missing')
      if (name === 'student') {
        await browser.send('Page.reload')
        await browserWait('[data-testid="student-workspace"]')
      }
      await browserLogout()
    })
    await test('Browser disabled account and sign-out', async () => {
      await browserLogin('disabled','[data-testid="access-disabled"]')
      check(await browser.evaluate("!document.querySelector('[data-testid=\"student-workspace\"]')"), 'Disabled browser account got workspace')
      await browserLogout()
    })
    await test('Browser existing cashier session loses role on visibility restoration', async () => {
      await browserLogin('cashier','[data-testid="cashier-workspace"]'); role('cashier','STUDENT')
      await browser.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
      await browserWait('[data-testid="student-workspace"]')
      check(await browser.evaluate("!document.querySelector('[data-testid=\"cashier-workspace\"]')"), 'Revoked browser cashier persisted')
      await browserLogout()
    })
    await test('Browser offline access clearing and online reconciliation', async () => {
      await browserLogin('admin','[data-testid="admin-workspace"]')
      await browser.send('Network.emulateNetworkConditions', {offline:true,latency:0,downloadThroughput:0,uploadThroughput:0})
      await browser.evaluate("window.dispatchEvent(new Event('offline'))")
      check(await browser.evaluate("!document.querySelector('[data-testid=\"admin-workspace\"]')"), 'Offline privileged state retained')
      await browser.send('Network.emulateNetworkConditions', {offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1})
      await browser.evaluate("window.dispatchEvent(new Event('online'))")
      await browserWait('[data-testid="admin-workspace"]'); await browserLogout()
    })
    await test('Mobile browser at 390px renders accessible login and public queue without overflow', async () => {
      await browser.send('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:true})
      check(await browser.evaluate("document.documentElement.scrollWidth <= innerWidth && !!document.querySelector('#login-password[type=password]')"), 'Mobile layout overflow or login missing')
      await browser.screenshot(`${directory}/frontend_auth_${run}_mobile.png`)
    })
    await test('Browser credentials remain local and no operational/private requests or runtime exceptions occur', () => {
      check(!unsafe && !browserError, 'Browser network boundary or runtime failure')
      check(browserRequests.includes('/rest/v1/rpc/my_context') && browserRequests.includes('/rest/v1/rpc/public_queue_context'), 'Browser contracts not exercised')
    })
    report.browser = {engine:'Chrome 155 headless',desktop:'1440x1000',mobile:'390x844',local_requests_only:true}
  } else await test('Desktop/mobile browser acceptance', async () => {}, 'Preinstalled Chrome unavailable')
  await test('Every pre-existing application, display and Auth fixture remains unchanged', preserved)
} catch (error) {
  failed = true
  if (!checks.some(item => item.result === 'FAIL')) checks.push({name:'Harness setup',result:'FAIL',reason:'Setup failed; details suppressed'})
  console.error('STOP: ' + (error instanceof Failure ? error.message : 'Harness exception; raw details suppressed'))
} finally {
  controller?.stop(); if (publicController) await publicController.stop()
  await publicClient.removeAllChannels(); await business.auth.stopAutoRefresh()
  if (browser) await browser.close(); vite?.kill()
  if (baseline) { try { preserved() } catch { failed = true; checks.push({name:'Postflight preservation',result:'FAIL',reason:'Original fixture mismatch'}) } }
  report.counts = {passed:checks.filter(c=>c.result==='PASS').length,failed:checks.filter(c=>c.result==='FAIL').length,
    skipped:checks.filter(c=>c.result==='SKIP').length,completed:!failed}
  report.frontend_endpoints = [...new Set(requests.map(r=>r.path))].sort()
  const output = JSON.stringify(report,null,2)+'\n'
  check(privateValues.every(secret => !output.includes(secret)), 'Private value in evidence; refused to write')
  writeFileSync(`${directory}/frontend_auth_${run}.json`,output,{flag:'wx'})
  console.log('Sanitized Phase 2 summary: '+JSON.stringify(report.counts))
}
process.exitCode = failed ? 1 : 0
