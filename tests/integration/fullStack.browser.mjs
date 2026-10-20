// Real frontend -> private proxy -> disposable PostgREST/PostgreSQL. Auth is mocked.
// No Auth or RPC request is ever forwarded to the retained local gateway.
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { QueueFixture, availableFixtureRun, need, digest, delay, preservationQuery } from './queueFixture.mjs'
import { startLocalBrowser } from '../../supabase/tests/headless_local_browser.mjs'
import { startTestVite } from '../frontend/startTestVite.mjs'
import { isCancelledInterception } from '../frontend/browserInterception.mjs'

const fixture = new QueueFixture(availableFixtureRun()), run = fixture.run, origin = 'http://127.0.0.1:5173', viteOrigin = 'http://127.0.0.1:5176', apiOrigin = 'http://127.0.0.1:54321'
const directory = 'tests/integration/results'; mkdirSync(directory, { recursive: true })
const file = `${directory}/full_stack_browser_${run}.json`
const report = { run, result: 'IN_PROGRESS', retained_writes: false, real_postgresql_rpc: true, real_auth: false, real_realtime_delivery: false, checks: [], screenshots: [] }
const save = () => writeFileSync(file, JSON.stringify(report, null, 2) + '\n')
const check = async (name, body) => { try { await body(); report.checks.push({ name, result: 'PASS' }); console.log('PASS: ' + name) } catch (error) { report.checks.push({ name, result: 'FAIL' }); throw error } finally { save() } }
const tokens = new Map(), token = name => { if (!tokens.has(name)) tokens.set(name, fixture.token(name, name === 'anon' ? 'anon' : 'authenticated')); return tokens.get(name) }
let browser, vite, retainedBefore, dataBefore, inventoryBefore, currentActor = 'browser', loseNextIssue = false, droppedKey, issueKeys = [], runtime = [], blocked = [], cancellations = new Map(), pendingHandlers = new Set()
async function waitFor(body, message) { const end = Date.now() + 30000; while (Date.now() < end) { if (await body()) return; await delay(60) } throw new Error(message) }
const exists = selector => browser.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)
const click = selector => waitFor(() => browser.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)return false;e.focus();e.click();return true})()`), 'Requested UI control unavailable')
const textIncludes = text => browser.evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`)
async function capture(name) {
  for (const [width, height] of [[1440, 1000], [768, 1024], [390, 844]]) {
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 }); await delay(120)
    need(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth'), 'Responsive horizontal overflow')
    await browser.evaluate(`if(!document.querySelector('#fixture-notice')){const note=document.createElement('div');note.id='fixture-notice';note.textContent='ISOLATED REAL QUEUE · Auth mocked · no retained writes';note.style.cssText='position:fixed;bottom:0;left:0;padding:4px 8px;background:#fff9ed;color:#65263d;font:10px Arial;z-index:9999;pointer-events:none';document.body.append(note)};window.scrollTo(0,0)`)
    const path = `${directory}/full_stack_${run}_${name}_${width}.png`; await browser.screenshot(path); report.screenshots.push(path)
  }
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
}
async function respond(event, body, status = 200, headers = []) {
  await browser.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: status, responseHeaders: [
    { name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: origin },
    { name: 'Access-Control-Allow-Headers', value: 'authorization,apikey,content-type,content-profile,accept-profile,x-client-info,x-supabase-api-version,prefer,range,range-unit' },
    { name: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' }, ...headers], body: Buffer.from(body == null ? '' : JSON.stringify(body)).toString('base64') })
}
const fixtureUser = () => ({ id: fixture.users[currentActor], aud: 'authenticated', role: 'authenticated', email: 'synthetic@example.invalid', email_confirmed_at: new Date().toISOString(),
  created_at: new Date().toISOString(), app_metadata: { provider: 'google', providers: ['google'] }, user_metadata: { role: 'ADMIN' } })
async function login(name) { currentActor = name; await click('[data-testid="google-login"]'); await waitFor(() => exists(`[data-testid="${name === 'cashier' ? 'cashier' : 'student'}-workspace"]`), 'Verified fixture workspace missing') }
async function logout() { await click('[data-testid="sign-out"]'); await waitFor(() => exists('[data-testid="confirm-sign-out"]'), 'Logout dialog missing'); await click('[data-testid="confirm-sign-out"]'); await waitFor(() => exists('[data-testid="google-login"]'), 'Fixture logout did not clear access') }
async function cashierAction(selector) { await waitFor(() => browser.evaluate(`!!document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled`), 'Cashier action did not become ready'); await click(selector); await waitFor(() => exists('[data-testid="confirm-cashier-action"]'), 'Action confirmation missing'); await click('[data-testid="confirm-cashier-action"]') }
async function rpc(name, body, actor) { const r = await fixture.request('/rpc/' + name, { body, name: actor }); need(r.ok, 'Fixture setup RPC rejected'); return r.json() }
try {
  retainedBefore = await fixture.retained(); inventoryBefore = await fixture.inventory(); dataBefore = fixture.retainedRead(preservationQuery).trim()
  need(JSON.parse(dataBefore).cluster === '7696959712798593061', 'Retained identity mismatch')
  await fixture.start()
  await fixture.sql(`set request.jwt.claim.sub='${fixture.users.admin}'; select queue_api.manage_day('OPEN',(clock_timestamp() at time zone 'Asia/Manila')::date,gen_random_uuid());`)
  report.fixture = { containers: [...fixture.owned], network: fixture.network, cluster: fixture.cluster, existing_policy_tests: fixture.policyTests }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(PG|QUEUE_|VITE_|SUPABASE_)/i.test(key)))
  Object.assign(env, { VITE_SUPABASE_URL: apiOrigin, VITE_SUPABASE_PUBLISHABLE_KEY: token('anon') })
  vite = startTestVite(5176, `queue-${run}`, env)
  await waitFor(async () => { need(vite.exitCode === null, 'Owned Vite exited'); try { return (await fetch(viteOrigin)).ok } catch { return false } }, 'Test Vite unavailable')
  for (const path of ['/src/main.js', '/src/components/QueueApplication.vue']) need((await fetch(viteOrigin + path)).ok, 'Frontend compile failed')
  browser = await startLocalBrowser(`queue-integration-${run}`); need(browser, 'Installed Chrome unavailable')
  await browser.send('Page.enable'); await browser.send('Runtime.enable'); await browser.send('Network.enable')
  await browser.send('Browser.grantPermissions', { origin, permissions: ['loopbackNetwork'] })
  // The fixture has no Realtime service. Keep this boundary explicit and offline;
  // no invalid test JWT/WebSocket can reach the retained Realtime gateway.
  await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `{
    const Native=window.WebSocket;
    class OfflineSocket extends EventTarget { constructor(url){super();this.url=url;this.readyState=0;this.bufferedAmount=0}send(){}close(){this.readyState=3} }
    window.WebSocket=new Proxy(Native,{construct(target,args){return new URL(args[0]).origin==='ws://127.0.0.1:54321'?new OfflineSocket(args[0]):Reflect.construct(target,args)}})
  }` })
  browser.on('Runtime.exceptionThrown', () => runtime.push('Browser runtime exception'))
  browser.on('Network.loadingFailed', event => { if (event.canceled && event.errorText === 'net::ERR_ABORTED') cancellations.set(event.requestId, { canceled: true, category: 'net::ERR_ABORTED' }) })
  browser.on('Network.webSocketCreated', event => { if (new URL(event.url).origin === 'ws://127.0.0.1:54321') blocked.push('Retained socket attempted') })
  await browser.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] })
  browser.on('Fetch.requestPaused', event => {
    const pending = (async () => {
      const url = new URL(event.request.url), path = url.pathname
      if (url.origin === origin) {
        const response = await fetch(viteOrigin + path + url.search, { redirect: 'error' }); const body = await response.arrayBuffer()
        await browser.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: response.status, responseHeaders: [{ name: 'Content-Type', value: response.headers.get('content-type') || 'text/plain' }], body: Buffer.from(body).toString('base64') }); return
      }
      if (url.origin !== apiOrigin) { blocked.push('External endpoint refused'); await browser.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' }); return }
      if (event.request.method === 'OPTIONS') { await respond(event, null, 204); return }
      if (path === '/auth/v1/settings') { await respond(event, { external: { google: true } }); return }
      if (path === '/auth/v1/authorize') { need(url.searchParams.get('code_challenge_method') === 's256', 'PKCE required'); await respond(event, null, 302, [{ name: 'Location', value: origin + '/auth/callback?code=ISOLATED_SINGLE_USE_CODE' }]); return }
      if (path === '/auth/v1/token') { need(url.searchParams.get('grant_type') === 'pkce', 'Unexpected Auth flow'); await respond(event, { access_token: token(currentActor), refresh_token: 'SYNTHETIC_REFRESH_ONLY', token_type: 'bearer', expires_in: 3600, user: fixtureUser() }); return }
      if (path === '/auth/v1/user') { await respond(event, fixtureUser()); return }
      if (path === '/auth/v1/logout') { await respond(event, null, 204); return }
      const allowed = new Set(['my_context', 'my_tickets', 'my_ticket_events', 'staff_queue', 'issue_ticket', 'call_next', 'finish_ticket', 'public_queue_context'])
      const isRpc = path.startsWith('/rest/v1/rpc/') && allowed.has(path.slice('/rest/v1/rpc/'.length))
      need(isRpc || ['/rest/v1/counter_state', '/rest/v1/service_state'].includes(path), 'Unapproved fixture API endpoint')
      const headers = new Headers(event.request.headers), profile = headers.get('Content-Profile') || headers.get('Accept-Profile')
      need(['queue_api', 'queue_display'].includes(profile), 'Unknown fixture schema')
      const body = event.request.postData ? JSON.parse(event.request.postData) : {}
      const response = await fixture.request(path.slice('/rest/v1'.length) + url.search, { method: event.request.method, body, profile, token: headers.get('Authorization')?.replace(/^Bearer /, '') })
      if (path.endsWith('/issue_ticket')) {
        issueKeys.push(body.p_request_key)
        if (loseNextIssue && response.ok) { loseNextIssue = false; droppedKey = body.p_request_key; await response.arrayBuffer(); await browser.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'ConnectionClosed' }); return }
      }
      const data = await response.json()
      await respond(event, data, response.status, response.headers.has('content-range') ? [{ name: 'Content-Range', value: response.headers.get('content-range') }, { name: 'Access-Control-Expose-Headers', value: 'Content-Range' }] : [])
    })().catch(async error => { await delay(200); if (!isCancelledInterception(error.cdp, cancellations.get(event.networkId))) { runtime.push('Fixture interception failed'); report.interception_failure = error.cdp?.category || error.message } })
    pendingHandlers.add(pending); void pending.finally(() => pendingHandlers.delete(pending))
  })
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await browser.send('Page.navigate', { url: origin }); await waitFor(() => exists('[data-testid="google-login"]'), 'Login unavailable')
  await check('database STUDENT context overrides synthetic ADMIN metadata', async () => { await login('browser'); need(!await exists('[data-testid="admin-workspace"]'), 'Metadata elevated account') })
  await check('student confirms and receives a real isolated ticket; duplicate active confirmation is disabled', async () => {
    await click('[data-testid="service-TP"]'); await waitFor(() => browser.evaluate(`!!document.querySelector('[data-testid="confirm-issue-ticket"]')&&!document.querySelector('[data-testid="confirm-issue-ticket"]').disabled`), 'Issuance not ready')
    await click('[data-testid="confirm-issue-ticket"]'); await waitFor(() => textIncludes('TP-001'), 'Real issued ticket not rendered')
    await waitFor(() => textIncludes('Waiting for your call'), 'Active ticket read did not refresh'); await capture('student-issued')
    await click('[data-testid="service-SOA"]'); need(await browser.evaluate(`document.querySelector('[data-testid="confirm-issue-ticket"]').disabled`), 'Second active ticket enabled'); await click('dialog button[aria-label="Close dialog"]')
  })
  await rpc('issue_ticket', { p_service: 'TP', p_request_key: randomUUID() }, 'other')
  await logout(); await login('cashier')
  await check('cashier Call Next reaches real PostgreSQL and renders the authorized call', async () => {
    await cashierAction('[data-testid="call-next"]'); await waitFor(() => browser.evaluate(`document.querySelector('.cqs-serving-label')?.textContent==='TP-001'`), 'Actual call not rendered'); await capture('cashier-called')
    need(await browser.evaluate(`document.querySelector('[data-testid="call-next"]').disabled`), 'Busy counter enabled Call Next')
  })
  await check('Skip moves the same ticket to the tail; Serve does not call another ticket', async () => {
    await cashierAction('[data-testid="skip-ticket"]'); await waitFor(() => browser.evaluate(`document.querySelector('.cqs-next-label')?.textContent==='TP-002'`), 'Skip order did not refresh')
    await cashierAction('[data-testid="call-next"]'); await waitFor(() => browser.evaluate(`document.querySelector('.cqs-serving-label')?.textContent==='TP-002'`), 'Second call missing')
    await cashierAction('[data-testid="serve-ticket"]'); await waitFor(() => browser.evaluate(`document.querySelector('.cqs-serving-label')?.textContent==='— — —'&&document.querySelector('.cqs-next-label')?.textContent==='TP-001'`), 'Serve called next or failed to refresh')
    await cashierAction('[data-testid="call-next"]'); await waitFor(() => browser.evaluate(`document.querySelector('.cqs-serving-label')?.textContent==='TP-001'`), 'Skipped ticket not recalled')
    await cashierAction('[data-testid="serve-ticket"]'); await waitFor(() => browser.evaluate(`document.querySelector('.cqs-serving-label')?.textContent==='— — —'&&!document.querySelector('[data-testid="call-next"]').disabled&&document.querySelector('[data-testid="serve-ticket"]').disabled&&document.querySelector('[data-testid="queue-operation-status"]')?.dataset.phase==='success'`), 'Final served receipt and empty counter did not settle')
  })
  await logout(); await login('browser')
  await check('student history reflects actual served status', async () => { await waitFor(() => browser.evaluate(`document.querySelector('[aria-label="Your ticket history"] tbody')?.innerText.includes('SERVED')&&document.querySelector('[aria-label="Your ticket history"] tbody')?.innerText.includes('TP-001')`), 'Real served history row missing'); need(await textIncludes('No active ticket'), 'Previous active ticket not cleared') })
  await check('response loss leaves one ticket and an explicit same-key retry recovers the receipt', async () => {
    loseNextIssue = true; const previous = issueKeys.length
    await click('[data-testid="service-TP"]'); await waitFor(() => browser.evaluate(`!document.querySelector('[data-testid="confirm-issue-ticket"]').disabled`), 'Second permitted issuance not ready'); await click('[data-testid="confirm-issue-ticket"]')
    await waitFor(() => exists('[data-testid="retry-queue-operation"]'), 'Ambiguous outcome not exposed')
    need(issueKeys.length === previous + 1, 'Mutation retried automatically'); await capture('student-unknown')
    await click('[data-testid="retry-queue-operation"]'); await waitFor(() => textIncludes('Your ticket was issued.'), 'Replay receipt not confirmed')
    need(issueKeys.length === previous + 2 && issueKeys.at(-1) === droppedKey, 'Retry changed the operation key')
    const r = await fixture.request('/rpc/my_tickets', { name: 'browser' }); const rows = await r.json(); need(rows.length === 2 && rows.filter(t => t.status === 'WAITING').length === 1, 'Replay created a second ticket')
  })
  await check('anonymous monitor renders real sanitized fixture calls without private identities', async () => {
    await rpc('call_next', { p_counter: fixture.counters['1'], p_service: 'TP', p_request_key: randomUUID() }, 'cashier')
    await browser.send('Page.navigate', { url: origin + '/display/' }); await waitFor(() => textIncludes('TP-003'), 'Public projection not updated')
    need(await browser.evaluate(`!document.querySelector('#account-workspace')&&document.querySelectorAll('[data-counter]').length===5`), 'Public monitor composition changed')
    for (const id of Object.values(fixture.users)) need(!await textIncludes(id), 'Public identity leaked')
    await capture('public-monitor')
  })
  await Promise.all([...pendingHandlers]); need(!blocked.length && !runtime.length, 'Unexpected browser network/runtime behavior')
  report.result = 'PASS'
} catch (error) { report.result = 'FAIL'; report.failure = error.message; process.exitCode = 1; console.error(error.message)
  if (!report.checks.some(row => row.result === 'FAIL')) report.checks.push({ name: 'Browser/setup gate', result: 'FAIL' })
  try { if (browser) await browser.screenshot(`${directory}/full_stack_${run}_failure.png`) } catch {}
} finally {
  try { await browser?.close() } catch {} vite?.kill()
  try { await fixture.stop(); report.owned_containers_stopped = true } catch { report.result = 'FAIL'; report.cleanup_failed = true; process.exitCode = 1 }
  try {
    if (dataBefore) need(fixture.retainedRead(preservationQuery).trim() === dataBefore, 'Retained rows/contracts changed')
    if (retainedBefore) { const after = await fixture.retained(); need(after.every((row, i) => row.name.includes('vector') ? row.id === retainedBefore[i].id && row.definition === retainedBefore[i].definition : JSON.stringify(row) === JSON.stringify(retainedBefore[i])), 'Retained service changed') }
    if (inventoryBefore) { const after = await fixture.inventory(); need(JSON.stringify(after.volumes) === JSON.stringify(inventoryBefore.volumes)
      && JSON.stringify(after.containers) === JSON.stringify([...inventoryBefore.containers, ...fixture.owned].sort())
      && JSON.stringify(after.networks) === JSON.stringify([...inventoryBefore.networks, ...(fixture.networkId ? [fixture.networkId] : [])].sort()), 'Unexpected Docker inventory delta') }
    report.retained_preservation = true
  } catch { report.result = 'FAIL'; report.retained_preservation = false; process.exitCode = 1 }
  report.owned_resources = { containers: [...fixture.owned], network: fixture.networkId ? fixture.network : null }
  report.runtime_errors = runtime; report.blocked = blocked
  report.passed = report.checks.filter(row => row.result === 'PASS').length; report.failed = report.checks.filter(row => row.result === 'FAIL').length
  save(); console.log(JSON.stringify({ result: report.result, passed: report.passed, failed: report.failed, evidence: file }))
}
