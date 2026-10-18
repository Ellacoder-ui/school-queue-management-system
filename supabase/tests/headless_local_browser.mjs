// Software acceptance tests using pre-installed Chrome; no desktop UI automation.
import {spawn} from 'node:child_process'
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {cdpError} from './cdp_errors.mjs'
const delay = ms => new Promise(r => setTimeout(r, ms))
export async function startLocalBrowser(run) {
  const executable = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  if (!existsSync(executable)) return null
  const profile = resolve('.local-browser', run)
  mkdirSync(profile, {recursive: true})
  const child = spawn(executable, ['--headless=new', '--incognito', '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
    '--disable-sync', '--disable-extensions', '--disable-domain-reliability', '--metrics-recording-only',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank'],
  {windowsHide: true, stdio: 'ignore'})
  const portFile = resolve(profile, 'DevToolsActivePort')
  const deadline = Date.now() + 25000
  while (!existsSync(portFile) && Date.now() < deadline && child.exitCode === null) await delay(100)
  if (!existsSync(portFile)) { child.kill(); throw new Error('Headless browser startup unavailable') }
  const port = Number(readFileSync(portFile, 'utf8').split('\n')[0])
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid loopback browser port')
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {method: 'PUT', redirect: 'error'})).json()
  const address = new URL(target.webSocketDebuggerUrl)
  if (address.protocol !== 'ws:' || address.hostname !== '127.0.0.1' || Number(address.port) !== port) throw new Error('Non-local debugger refused')
  const socket = new WebSocket(address), pending = new Map(), handlers = new Map()
  let sequence = 0
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  socket.onmessage = event => {
    const data = JSON.parse(event.data)
    if (data.id) {
      const request = pending.get(data.id); if (!request) return
      pending.delete(data.id); clearTimeout(request.timer)
      if (data.error) request.reject(cdpError(request.method, data.error))
      else request.resolve(data.result)
    } else for (const fn of handlers.get(data.method) || []) fn(data.params)
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Browser command timeout')) }, 15000)
    pending.set(id, {resolve, reject, timer, method}); socket.send(JSON.stringify({id, method, params}))
  })
  return {
    send,
    on(method, fn) {
      handlers.set(method, [...(handlers.get(method) || []), fn])
      return () => {
        const remaining = (handlers.get(method) || []).filter(handler => handler !== fn)
        if (remaining.length) handlers.set(method, remaining)
        else handlers.delete(method)
      }
    },
    async evaluate(expression) {
      const result = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true})
      if (result.exceptionDetails) throw new Error('Browser evaluation failed; diagnostics suppressed')
      return result.result.value
    },
    async screenshot(path) {
      const result = await send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: true})
      writeFileSync(path, Buffer.from(result.data, 'base64'))
    },
    async close() {
      try { await send('Browser.close') } catch {}
      socket.close(); child.kill()
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Browser closed')) }
      pending.clear()
    },
  }
}
