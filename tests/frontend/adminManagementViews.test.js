import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
const server = await createServer({ mode: 'test', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
after(() => server.close())
const View = (await server.ssrLoadModule('/src/components/AdminManagement.vue')).default
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const publicState = { counters: [], services: [], context: null, hasSnapshot: false }
const state = { status: 'ready', actor: id(1), phase: 'idle', busy: false, data: { date: '2026-10-19', configuration: {
  counters: ['TP', 'SOA', 'PNEP', 'REF', 'ADJ'].map((code, i) => ({ id: id(i + 100), number: i + 1, label: 'Counter ' + (i + 1), is_open: false })),
  services: [], staff_assignments: [] }, directory: [], requests: [], metrics: { total: 7, waiting: 2, called: 1, served: 4, forfeited: 0 }, history: [], usage: [] } }
test('management overview renders supplied database totals and one existing monitor, with no impersonation', async () => {
  const html = await renderToString(createSSRApp(View, { state, publicState }))
  assert.match(html, /Total tickets/); assert.match(html, /<strong>7<\/strong>/)
  assert.equal((html.match(/data-testid="public-board"/g) || []).length, 1)
  for (const section of ['overview', 'staff', 'counters', 'reports']) assert.match(html, new RegExp(`data-testid="admin-tab-${section}"`))
  assert.doesNotMatch(html, /Impersonate|access_token|refresh_token|<iframe/)
})
test('restricted or revoked management never renders cached directory or metrics', async () => {
  const html = await renderToString(createSSRApp(View, { state: { ...state, status: 'restricted' }, publicState }))
  assert.match(html, /authorization is insufficient/); assert.doesNotMatch(html, /<strong>7<\/strong>|Registered accounts|data-testid="add-staff"/)
})
