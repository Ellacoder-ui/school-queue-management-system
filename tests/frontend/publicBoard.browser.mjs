// Read-only live SDK + browser acceptance. Synthetic serving responses exist only
// behind this test's interception and are visibly labeled; no database fixture writes.
import { createClient } from '@supabase/supabase-js'
import { spawnSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createQueueApi } from '../../src/services/queueApi.js'
import { createPublicQueueController } from '../../src/lib/publicQueueController.js'
import { validateLocalPublicConfig } from '../../src/lib/supabaseConfig.js'
import { startLocalBrowser } from '../../supabase/tests/headless_local_browser.mjs'
import { createBrowserInterception, publicRequestPolicy } from './browserInterception.mjs'
import { startTestVite } from './startTestVite.mjs'

const run = randomUUID().slice(0, 8), checks = [], sockets = [], requests = [], blocked = [], errors = []
const directory = 'supabase/tests/results', origin = 'http://127.0.0.1:5175', base = 'http://127.0.0.1:54321'
mkdirSync(directory, { recursive: true })
const report = { run, source_writes: false, checks, screenshots: [], synthetic_screenshots: [] }
let activePhase = 'setup'
class ValidationFailure extends Error {}
const check = (value, message) => { if (!value) throw new ValidationFailure(message) }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitFor(fn, message) {
  const deadline = Date.now() + 25000
  while (Date.now() < deadline) { if (await fn()) return; await delay(75) }
  throw new ValidationFailure(message)
}
async function test(name, body) {
  activePhase = name
  try { await body(); checks.push({ name, result: 'PASS' }); console.log(`PASS: ${name}`) }
  catch (error) { checks.push({ name, result: 'FAIL', reason: error.message }); throw error }
}
let browser, vite, controller, client, interception, synthetic = false
const browserHandlers=[]
const status = spawnSync(process.execPath, ['node_modules/supabase/dist/supabase.js', 'status', '--output', 'json'], { encoding: 'utf8', windowsHide: true })
check(status.status === 0, 'Local CLI status required; diagnostics suppressed')
const settings = JSON.parse(status.stdout), pub = settings.PUBLISHABLE_KEY || settings.ANON_KEY
validateLocalPublicConfig(settings.API_URL, pub)
const paths = new Set(['/rest/v1/counter_state', '/rest/v1/service_state', '/rest/v1/rpc/public_queue_context'])
const snapshot = { context: null, counters: [], services: [] }
class Transport extends WebSocket {
  constructor(url, ...args) { check(new URL(url).origin === 'ws://127.0.0.1:54321', 'Non-local socket refused'); super(url, ...args); sockets.push(this) }
}
const guardedFetch = (input, options) => {
  const url = new URL(input instanceof Request ? input.url : input)
  const headers = new Headers(options?.headers || (input instanceof Request ? input.headers : undefined))
  check(url.origin === base && paths.has(url.pathname), 'Unexpected live endpoint')
  check(headers.get('apikey') === pub && headers.get('Authorization') === `Bearer ${pub}`, 'Only anonymous public credentials allowed')
  check((headers.get('Accept-Profile') || headers.get('Content-Profile')) === 'queue_display', 'Only display schema allowed')
  check(publicRequestPolicy({url:url.href,method:options?.method || (input instanceof Request ? input.method : 'GET'),headers:Object.fromEntries(headers)},
    {origin,api:base,publicKey:pub}).allowed, 'Public read method/profile policy rejected request')
  requests.push(url.pathname)
  return fetch(input, { ...options, redirect: 'error' })
}
try {
  client = createClient(base, pub, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: guardedFetch }, realtime: { transport: Transport, reconnectAfterMs: () => 200, logger: () => {} } })
  const api = createQueueApi(client, client)
  await test('Actual anonymous snapshot matches all five fixed destinations and authoritative day context', async () => {
    Object.assign(snapshot, await api.readPublicSnapshot())
    check(snapshot.counters.length === 5 && snapshot.context.timezone === 'Asia/Manila', 'Unexpected public contract')
    check(snapshot.counters.every(row => /^Counter [1-5]$/.test(row.counter_label)), 'Public counter identity contract differs')
  })
  await test('Both actual postgres_changes listeners require readiness and a fresh snapshot', async () => {
    controller = createPublicQueueController(api); controller.start()
    await waitFor(() => controller.getState().synchronized && !controller.getState().refreshing, 'Subscription readiness failed')
    check(requests.length >= 6, 'Fresh readiness snapshot missing')
  })
  await test('Forced actual socket closure invalidates state and reconnect performs fresh reads', async () => {
    const previous = requests.length
    const socket = sockets.at(-1), closed = new Promise(resolve => socket.addEventListener('close', resolve, { once: true }))
    socket.close(4000, 'local read-only reconnect test'); await closed
    await waitFor(() => !controller.getState().synchronized, 'Disconnect did not clear readiness')
    await waitFor(() => controller.getState().synchronized && !controller.getState().refreshing && requests.length > previous, 'Fresh reconnect failed')
  })
  await test('Public controller cleanup removes all owned subscriptions', async () => {
    await controller.stop(); check(client.getChannels().length === 0, 'Subscriptions retained after stop')
  })

  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(VITE_|SUPABASE_|PG|QUEUE_)/i.test(key)))
  Object.assign(env, { VITE_SUPABASE_URL: base, VITE_SUPABASE_PUBLISHABLE_KEY: pub })
  vite = startTestVite(5175,`public-${run}`,env)
  report.isolated_vite_cache=true
  await waitFor(async () => { check(vite.exitCode===null&&vite.signalCode===null,'Owned Vite process exited');try { return (await fetch(origin, { redirect: 'error' })).ok } catch { return false } }, 'Isolated Vite server unavailable')
  browser = await startLocalBrowser(`public-board-${run}`)
  check(browser, 'Installed headless Chrome unavailable')
  await browser.send('Network.enable'); await browser.send('Runtime.enable'); await browser.send('Page.enable')
  await browser.send('Browser.getVersion').then(version => { report.chrome_version = version.product; report.cdp_version = version.protocolVersion })
  browserHandlers.push(browser.on('Network.webSocketCreated', event => {
    if (!['ws://127.0.0.1:5175','ws://127.0.0.1:54321'].includes(new URL(event.url).origin)) blocked.push('Unexpected socket')
  }))
  interception=createBrowserInterception(browser,{origin,api:base,publicKey:pub}, {
    phase:()=>activePhase,
    respond:event=>{
      const url = new URL(event.request.url)
      if (synthetic && url.origin===base && paths.has(url.pathname) && event.request.method!=='OPTIONS') {
          const codes = ['TP','SOA','PNEP','REF','ADJ'], names = ['Tuition Payment','Statement of Account','Promissory Notes and Exam Permits','Refund Process','Adjustment Clerk']
          const day = snapshot.context.business_date
          let body = url.pathname.endsWith('counter_state') ? codes.map((code, i) => ({ counter_id:`test-public-${i}`, counter_label:`Counter ${i+1}`,
            is_open:true, ticket_label:`${code}-${['014','042','023','008','003'][i]}`, service_code:code, business_date:day, updated_at:new Date().toISOString() }))
            : url.pathname.endsWith('service_state') ? codes.map((code,i) => ({ service_code:code, business_date:day, waiting_count:i, updated_at:new Date().toISOString() }))
              : { timezone:'Asia/Manila', business_date:day, queue_day_open:true, services:codes.map((code,i) => ({code,name:names[i]})) }
          return { responseCode:200,
            responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:origin},
              {name:'Access-Control-Expose-Headers',value:'Content-Range'},{name:'Content-Range',value:'0-4/5'}], body:Buffer.from(JSON.stringify(body)).toString('base64') }
      }
      return null
    },
  })
  await interception.start()
  async function metrics(width, height, mobile = false) {
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor:1, mobile })
  }
  async function layout(width, height, filename) {
    await metrics(width,height,width<600); await delay(150)
    const result = await browser.evaluate(`({ overflow:document.documentElement.scrollWidth>innerWidth,
      scroll:document.documentElement.scrollHeight>innerHeight, cards:document.querySelectorAll('[data-counter]').length,
      clipped:[...document.querySelectorAll('.board-counter-ticket,.board-feature-ticket')].some(e=>e.scrollWidth>e.clientWidth+1) })`)
    check(!result.overflow && !result.clipped && result.cards===5, 'Responsive clipping or missing counter')
    if (width>=1366) check(!result.scroll, 'Monitor requires vertical scrolling')
    await browser.screenshot(`${directory}/${filename}`)
  }
  await metrics(1920,1080)
  await browser.send('Page.navigate', { url:`${origin}/display` })
  await waitFor(() => browser.evaluate(`document.querySelector('.queue-board[data-live="true"]')`), 'Actual monitor did not become live')
  await test('Anonymous monitor uses real public state and mounts no login/workspace', async () => {
    const result = await browser.evaluate(`({text:document.body.innerText, login:!!document.querySelector('#login-email'), cards:document.querySelectorAll('[data-counter]').length})`)
    check(!result.login && result.cards===5 && result.text.includes('Liceo de Cagayan University'), 'Monitor composition incorrect')
    check(result.text.includes(snapshot.context.queue_day_open ? 'Queue day open' : 'Queue day not open'), 'Day status differs from actual RPC')
    check(!blocked.length, 'Unexpected network traffic')
  })
  for (const [width,height] of [[1920,1080],[1366,768],[768,1024],[390,844]]) await test(`Actual board responsive at ${width}x${height}`, async () => {
    const name=`public_board_${run}_${width}x${height}.png`; await layout(width,height,name); report.screenshots.push(name)
  })
  await test('Browser offline state removes live/proceed claims and reconnect obtains fresh readiness', async () => {
    await browser.send('Network.emulateNetworkConditions', { offline:true, latency:0, downloadThroughput:0, uploadThroughput:0 })
    await browser.evaluate(`window.dispatchEvent(new Event('offline'))`)
    await waitFor(() => browser.evaluate(`document.querySelector('.queue-board[data-live="false"]')`), 'Offline board still live')
    check(await browser.evaluate(`!document.body.innerText.includes('QUEUE UPDATES AUTOMATICALLY')&&!document.body.innerText.includes('LIVE SERVICE BOARD')`), 'Stale live claim')
    await browser.send('Network.emulateNetworkConditions', { offline:false, latency:0, downloadThroughput:-1, uploadThroughput:-1 })
    await browser.evaluate(`window.dispatchEvent(new Event('online'))`)
    await waitFor(() => browser.evaluate(`document.querySelector('.queue-board[data-live="true"]')`), 'Online board did not reconcile')
  })
  await test('Root application retains anonymous workspace with the single Google entry', async () => {
    await browser.send('Page.navigate', {url:origin})
    await waitFor(() => browser.evaluate(`!!document.querySelector('[data-testid="google-login"]')`), 'Google entry missing')
    check(await browser.evaluate(`!document.querySelector('#login-email')`),'Product password form still present')
    check(await browser.evaluate(`!!document.querySelector('a[href="/display"]')`), 'Monitor link missing')
  })

  synthetic = true
  await browser.send('Page.navigate', { url:`${origin}/display` })
  await waitFor(() => browser.evaluate(`document.body.innerText.includes('PNEP-023')`), 'Synthetic rendering fixture did not load')
  await browser.evaluate(`const banner=document.createElement('div');banner.textContent='SIMULATED RENDER TEST — NOT LIVE DATABASE DATA';banner.style.cssText='position:fixed;top:0;left:0;right:0;z-index:9999;text-align:center;background:#fff;color:#65152b;font:bold 12px Arial';document.body.append(banner)`)
  for (const [width,height] of [[1920,1080],[1366,768],[390,844]]) await test(`Clearly labeled synthetic five-call rendering at ${width}x${height}`, async () => {
    const name=`public_board_${run}_SIMULATED_${width}x${height}.png`; await layout(width,height,name); report.synthetic_screenshots.push(name)
    check(await browser.evaluate(`document.querySelector('.board-feature-ticket')?.textContent==='TP-014'&&document.body.innerText.includes('5 counters calling')`), 'Concurrent calls not represented')
  })
  await interception.stop()
  await test('No private/operational/hosted request or uncaught runtime error', async () => {
    check(!blocked.length && !errors.length && interception.healthy(), 'Unexpected network or runtime behavior')
    check(interception.diagnostics.closed && interception.diagnostics.owned_handlers===0, 'Interception handlers retained')
  })
  report.result='PASS'
} catch (error) {
  report.result='FAIL'; report.failure=error instanceof ValidationFailure ? error.message : 'Harness exception; raw diagnostics suppressed'
  if (!checks.some(c=>c.result==='FAIL')) checks.push({name:'Browser/setup acceptance gate',result:'FAIL',reason:report.failure})
  report.blocked=blocked; report.runtime_errors=errors
  try {
    report.browser_state=await browser?.evaluate(`({live:!!document.querySelector('.queue-board[data-live="true"]'),board:!!document.querySelector('.queue-board'),path:location.pathname})`)
    if(browser) await browser.screenshot(`${directory}/public_board_${run}_failure.png`)
  } catch {}
  console.error(report.failure); process.exitCode=1
} finally {
  try { await controller?.stop() } catch {}
  try { await client?.realtime.disconnect() } catch {}
  if (interception) await interception.stop()
  for (const dispose of browserHandlers) dispose()
  try { await browser?.close() } catch {}
  vite?.kill()
  report.passed=checks.filter(c=>c.result==='PASS').length; report.failed=checks.filter(c=>c.result==='FAIL').length
  report.interception = interception?.diagnostics
  writeFileSync(`${directory}/public_board_${run}.json`, JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({result:report.result,passed:report.passed,failed:report.failed,evidence:`public_board_${run}.json`}))
}
