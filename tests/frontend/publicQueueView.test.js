import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'

const server = await createServer({ mode: 'test', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
const { default: View } = await server.ssrLoadModule('/src/components/PublicQueueDisplay.vue')
after(() => server.close())
const base = { counters: [], services: [], hasSnapshot: false, loading: false, refreshing: false,
  connection: 'connecting', synchronized: false, error: null, lastRefreshed: null }
const render = patch => renderToString(createSSRApp(View, { state: { ...base, ...patch } }))

test('loading view contains no fabricated tickets or wait estimates', async () => {
  const html = await render({ loading: true })
  assert.match(html, /Loading public queue/)
  assert.doesNotMatch(html, /TP-027|TP-023|~12 min|Average service/)
  assert.doesNotMatch(html, /Authentication is not connected|Your private ticket will appear/)
  assert.match(html, /Business-day status and service catalog are unavailable/)
})

test('authoritative closed day is independent of open counters and catalog names are escaped', async () => {
  const html = await render({ hasSnapshot: true, connection: 'connected', synchronized: true,
    context: { timezone: 'Asia/Manila', business_date: '2026-10-16', queue_day_open: false,
      services: [{ code: 'TP', name: '<img src=x onerror=alert(1)>' }] },
    counters: [{ counter_id: 'counter', counter_label: 'Counter 1', is_open: true, ticket_label: null }] })
  assert.match(html, /Queue day not open/)
  assert.match(html, /Asia\/Manila/)
  assert.match(html, /&lt;img/)
  assert.doesNotMatch(html, /<img src=x/)
})

test('empty public snapshot renders explicit empty states without invented waiting totals', async () => {
  const html = await render({ hasSnapshot: true, connection: 'connected', synchronized: true })
  assert.match(html, /No counters have been published/)
  assert.match(html, /No waiting totals have been published/)
  assert.match(html, /No tickets are currently being called/)
})

test('view always represents all five destinations but renders only supplied tickets and counts', async () => {
  const html = await render({ hasSnapshot: true, connection: 'connected', synchronized: true,
    counters: [{ counter_id: 'counter', counter_label: 'Counter 5', is_open: true,
      ticket_label: 'ADJ-004', service_code: 'ADJ', business_date: '2026-10-16' }],
    services: [{ service_code: 'ADJ', business_date: '2026-10-16', waiting_count: 7 }] })
  assert.match(html, /ADJ-004/)
  for (let counter = 1; counter <= 5; counter++) assert.match(html, new RegExp(`data-counter="${counter}"`))
  assert.match(html, /COUNTER 05/)
  assert.match(html, /Data unavailable/)
  assert.match(html, /Live public display/)
  assert.doesNotMatch(html, /TP-027|Estimated wait/)
})

test('disconnected view labels retained data as a stale snapshot', async () => {
  const html = await render({ hasSnapshot: true, connection: 'disconnected' })
  assert.match(html, /Disconnected/)
  assert.match(html, /snapshot may be out of date/)
  assert.doesNotMatch(html, /Live public display/)
})

test('error and recovery states are accessible and do not claim live status', async () => {
  const html = await render({ hasSnapshot: true, connection: 'connected', error: 'Unable to load the public queue.' })
  assert.match(html, /role="alert"/)
  assert.match(html, /Showing the last successful snapshot/)
  assert.match(html, /Refresh display/)
  assert.doesNotMatch(html, /Live public display/)
})
