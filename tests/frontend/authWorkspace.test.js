import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
const server = await createServer({ mode: 'test', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
const { default: View } = await server.ssrLoadModule('/src/components/AuthWorkspace.vue')
after(() => server.close())
const base = { status: 'anonymous', signedIn: false, context: null, workspace: 'public', accountVersion: 0 }
const render = (patch, props = {}) => renderToString(createSSRApp(View, { state: { ...base, ...patch }, ...props }))
test('product login contains exactly one Google entry and no password/signup/role selection', async () => {
  const html = await render({})
  assert.equal((html.match(/data-testid="google-login"/g)||[]).length,1)
  assert.match(html,/Continue with Google/)
  assert.doesNotMatch(html,/type="email"|type="password"|<select|Sign in as|signUp|data-testid="admin-workspace"/)
})
test('password login appears only on the explicitly selected development surface', async () => {
  const html = await render({}, {developmentLogin:true})
  assert.match(html, /autocomplete="current-password"/)
  assert.match(html, /type="email"/)
  assert.doesNotMatch(html, /data-testid="google-login"|signUp|data-testid="admin-workspace"/)
})
test('ordinary users share Queue Dashboard without an enrollment or admin-email exception', async () => {
  const html = await render({status:'ready',signedIn:true,workspace:'student',context:{role:'STUDENT',enabled:true,cashier_counters:[]}})
  assert.match(html,/Queue Dashboard/)
  assert.match(html,/Students and outside payors/)
  assert.doesNotMatch(html,/student access is verified|Administrator workspace|Cashier workspace/)
})
test('callback interruption exposes reconciliation and cancellation without raw diagnostics', async () => {
  const html = await render({}, {oauthState:{phase:'uncertain',message:'Sign-in could not be confirmed.'}})
  assert.match(html,/Check sign-in outcome|Cancel sign-in/)
  assert.match(html,/role="alert"/)
  assert.doesNotMatch(html,/access_token|refresh_token|code_verifier/)
})
for (const role of ['STUDENT','CASHIER','ADMIN']) test(`${role} rendered workspace has disabled operational controls`, async () => {
  const html = await render({ status: 'ready', signedIn: true, workspace: role.toLowerCase(), context: { role, enabled: true, cashier_counters: [] } })
  assert.match(html, new RegExp(`data-testid="${role.toLowerCase()}-workspace"`))
  assert.match(html, /disabled/)
  assert.match(html, /Sign out/)
})
test('disabled and context-unavailable views cannot render privileged workspaces', async () => {
  for (const status of ['disabled', 'checking', 'error']) {
    const html = await render({ status, signedIn: true, context: status === 'disabled' ? { role: null, enabled: false, cashier_counters: [] } : null })
    assert.doesNotMatch(html, /data-testid="(student|cashier|admin)-workspace"/)
  }
})
test('cashier view escapes labels and shows only supplied assignments', async () => {
  const html = await render({ status: 'ready', signedIn: true, workspace: 'cashier', context: { role: 'CASHIER', enabled: true,
    cashier_counters: [{ counter_id: 'counter', counter_label: '<script>PRIVATE</script>', is_open: false, service_codes: ['ADJ'] }] } })
  assert.match(html, /&lt;script&gt;/)
  assert.doesNotMatch(html, /<script>PRIVATE/)
  assert.match(html, /Closed counter/)
})
