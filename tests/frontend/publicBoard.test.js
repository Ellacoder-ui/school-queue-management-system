import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { boardCounters, boardWaiting, manilaClock, isPublicMonitorPath } from '../../src/lib/publicBoard.js'

const server = await createServer({ mode: 'test', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
const { default: View } = await server.ssrLoadModule('/src/components/PublicQueueDisplay.vue')
after(() => server.close())
const context = { timezone: 'Asia/Manila', business_date: '2026-10-17', queue_day_open: true,
  services: ['TP', 'SOA', 'PNEP', 'REF', 'ADJ'].map(code => ({ code, name: code, issuance_status: 'OPEN' })) }
const state = { counters: [], services: [], hasSnapshot: true, loading: false, refreshing: false,
  connection: 'connected', synchronized: true, error: null, lastRefreshed: null, context }
const row = (number, code, label = `${code}-001`) => ({ counter_id: `public-${number}`, counter_label: `Counter ${number}`,
  is_open: true, ticket_label: label, service_code: code, business_date: '2026-10-17' })
const render = patch => renderToString(createSSRApp(View, { state: { ...state, ...patch } }))

test('permanent destinations never derive from row order or an idle service_code', () => {
  const counters = boardCounters({ ...state, counters: [row(5, 'ADJ'), { ...row(1, 'TP'), ticket_label: null, service_code: null }] })
  assert.deepEqual(counters.map(c => [c.number, c.code]), [[1,'TP'],[2,'SOA'],[3,'PNEP'],[4,'REF'],[5,'ADJ']])
  assert.equal(counters[0].row.ticket_label, null)
  assert.equal(counters[4].row.ticket_label, 'ADJ-001')
})

test('ambiguous labels and cross-service calls fail closed instead of inventing a destination', async () => {
  const html = await render({ counters: [row(1, 'SOA', 'SOA-009'), row(2, 'SOA'), row(2, 'SOA')] })
  assert.match(html, /Counter data could not be matched safely/)
  assert.doesNotMatch(html, /SOA-009|SOA-001|LIVE SERVICE BOARD|QUEUE UPDATES AUTOMATICALLY/)
})

test('simultaneous calls stay visible and lowest counter highlight is deterministic', async () => {
  const html = await render({ counters: [row(5, 'ADJ', 'ADJ-033'), row(2, 'SOA', 'SOA-042'), row(1, 'TP', 'TP-014')] })
  const feature = html.match(/<section class="board-feature"[\s\S]*?<\/section>/)[0]
  assert.match(feature, /TP-014/)
  assert.match(feature, /3 counters calling/)
  assert.doesNotMatch(feature, /ADJ-033|SOA-042/)
  for (const ticket of ['TP-014','SOA-042','ADJ-033']) assert.match(html, new RegExp(ticket))
  assert.match(html, /Counter 5, ADJ-033/)
})

test('waiting strip reports supplied per-date totals, preserves zero and does not calculate next tickets', async () => {
  const services = [{ service_code:'TP', business_date:'2026-10-17', waiting_count:0 },
    { service_code:'TP', business_date:'2026-10-16', waiting_count:7 }]
  assert.deepEqual(boardWaiting({ ...state, services })[0].rows.map(r => r.waiting_count), [7,0])
  const html = await render({ services })
  assert.match(html, /<strong>0<\/strong>/)
  assert.match(html, /<strong>7<\/strong>/)
  assert.match(html, /aria-label="Waiting count unavailable">—/)
  assert.doesNotMatch(html, /TP-008|UP NEXT/)
})

test('closed day remains authoritative with open idle counters', async () => {
  const html = await render({ context: { ...context, queue_day_open: false }, counters: [{ ...row(1,'TP'), ticket_label:null }] })
  assert.match(html, /Queue day not open/)
  assert.match(html, /No ticket being called/)
  assert.doesNotMatch(html, /Queue day open|TP-001/)
})

test('disconnection keeps last calls explicitly stale and never instructs current proceeding', async () => {
  const html = await render({ counters:[row(1,'TP')], connection:'disconnected' })
  assert.match(html, /TP-001/)
  assert.match(html, /Last reported call/)
  assert.match(html, /snapshot may be out of date/)
  assert.doesNotMatch(html, /LIVE SERVICE BOARD|QUEUE UPDATES AUTOMATICALLY|Proceed to/)
})

test('channel readiness without fresh synchronization never produces a live claim', async () => {
  const html = await render({ synchronized:false, counters:[row(1,'TP')] })
  assert.doesNotMatch(html, /Synchronizing|LIVE SERVICE BOARD|QUEUE UPDATES AUTOMATICALLY|Now serving/)
  assert.match(html,/Last reported call/)
})

test('untrusted service names are escaped and public counter IDs do not enter DOM', async () => {
  const html = await render({ context:{ ...context, services:[{ code:'TP', name:'<script>private()</script>', issuance_status:'OPEN' }] }, counters:[row(1,'TP')] })
  assert.match(html, /&lt;script&gt;/)
  assert.doesNotMatch(html, /<script>private|public-1|counter_id/)
})

test('clock uses Manila date boundary, independently of reported business date', () => {
  assert.match(manilaClock('2026-10-16T16:00:00Z').date, /Saturday, October 17, 2026/)
  assert.match(manilaClock('2026-10-16T15:59:00Z').date, /Friday, October 16, 2026/)
  assert.match(manilaClock('2026-10-16T16:00:00Z').time, /12:00 AM/)
})

test('only explicit display path selects monitor composition', () => {
  for (const path of ['/display','/display/']) assert.equal(isPublicMonitorPath(path), true)
  for (const path of ['/','/display/admin','//evil/display','/admin']) assert.equal(isPublicMonitorPath(path), false)
})
