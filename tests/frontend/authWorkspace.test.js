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

test('pending session verification shows a neutral loading view, never login or a stale dashboard', async () => {
  for (const status of ['initializing', 'checking', 'signing-in', 'signing-out']) {
    const html = await render({ status, signedIn: true, workspace: 'admin', context: { role: 'ADMIN', enabled: true } })
    assert.match(html, /data-testid="auth-pending"/)
    assert.match(html, /role="status"/)
    assert.doesNotMatch(html, /class="cqs-login"|data-testid="google-login"|data-testid="(student|cashier|admin)-workspace"/)
  }
})

test('pending OAuth callback keeps cancellation available without presenting another sign-in', async () => {
  const html = await render({ status: 'signing-in' }, { oauthState: { phase: 'exchanging', message: 'Completing sign-in.' } })
  assert.match(html, /data-testid="auth-pending"/)
  assert.match(html, /Completing sign-in\.|Cancel sign-in/)
  assert.doesNotMatch(html, /data-testid="google-login"/)
})
test('ordinary users share Queue Dashboard without an enrollment or admin-email exception', async () => {
  const html = await render({status:'ready',signedIn:true,workspace:'student',context:{role:'STUDENT',enabled:true,cashier_counters:[]}})
  assert.match(html,/Queue Dashboard/)
  assert.match(html,/Students and outside payors/)
  assert.doesNotMatch(html,/student access is verified|Administrator workspace|Cashier workspace/)
})
test('student navigation keeps logout only and removes redundant display/access/security links', async () => {
  const html = await render({status:'ready',signedIn:true,workspace:'student',context:{role:'STUDENT',enabled:true,cashier_counters:[]}})
  assert.match(html,/data-testid="sign-out"/)
  assert.doesNotMatch(html,/data-testid="account-security"/)
  const controls=(html.match(/<(?:a|button)\b[^>]*>[\s\S]*?<\/(?:a|button)>/g)||[]).join(' ')
  assert.doesNotMatch(controls,/My workspace|Public queue|Refresh access|Public display|Open lobby display|Account security/)
  assert.equal((html.match(/class="cqs-service-card"/g)||[]).length,5)
  assert.match(html,/data-testid="student-live-monitor"/)
})
test('cashier and administrator retain account security navigation', async () => {
  for(const role of ['CASHIER','ADMIN']){
    const html = await render({status:'ready',signedIn:true,workspace:role.toLowerCase(),context:{role,enabled:true,cashier_counters:[]}})
    assert.match(html,/data-testid="account-security"/)
    assert.match(html,/data-testid="sign-out"/)
  }
})
test('mfa-mode path exposes account security for student without auto-opening dialog', async () => {
  const html = await render({status:'ready',signedIn:true,workspace:'student',context:{role:'STUDENT',enabled:true,cashier_counters:[]}}, { mfaMode: true, actor: '5c96debb-697f-4cad-805f-92b518e28343' })
  assert.match(html,/data-testid="account-security"/)
  assert.match(html,/data-testid="mfa-mode-banner"/)
  assert.match(html,/5c96debb-697f-4cad-805f-92b518e28343/)
  assert.match(html,/data-testid="sign-out"/)
  // MFA dialog should not be auto-opened (phase starts closed)
  assert.doesNotMatch(html,/data-testid="account-mfa"/)
})
test('mfa-mode path preserves five service cards and live monitor for student', async () => {
  const html = await render({status:'ready',signedIn:true,workspace:'student',context:{role:'STUDENT',enabled:true,cashier_counters:[]}}, { mfaMode: true })
  assert.equal((html.match(/class="cqs-service-card"/g)||[]).length,5)
  assert.match(html,/data-testid="student-live-monitor"/)
})
test('cashier and administrator retain their navigation and access-refresh controls', async () => {
  for(const role of ['CASHIER','ADMIN']){
    const html = await render({status:'ready',signedIn:true,workspace:role.toLowerCase(),context:{role,enabled:true,cashier_counters:[]}})
    for(const label of ['My workspace','Public queue','Refresh access','Account security'])assert.ok(html.includes(label))
    assert.equal(html.includes('data-testid="public-display-link"'),role==='CASHIER')
  }
})
test('callback interruption exposes reconciliation and cancellation without raw diagnostics', async () => {
  const html = await render({}, {oauthState:{phase:'uncertain',message:'Sign-in could not be confirmed.'}})
  assert.match(html,/Check sign-in outcome|Cancel sign-in/)
  assert.match(html,/role="alert"/)
  assert.doesNotMatch(html,/access_token|refresh_token|code_verifier/)
})

test('unfinished OAuth recovery asks for action instead of presenting an endless completion spinner',async()=>{
 const html=await render({status:'signing-in',signedIn:false},{oauthState:{phase:'uncertain',message:'An unfinished sign-in needs checking or cancellation.'}})
 assert.match(html,/Sign-in needs your attention/);assert.match(html,/Check sign-in outcome/)
 assert.doesNotMatch(html,/class="cqs-spinner"|Completing sign-in|data-testid="google-login"/)
})
for (const role of ['STUDENT','CASHIER','ADMIN']) test(`${role} cannot execute operations without ready queue data/assignment`, async () => {
  const html = await render({ status: 'ready', signedIn: true, workspace: role.toLowerCase(), context: { role, enabled: true, cashier_counters: [] } })
  assert.match(html, new RegExp(`data-testid="${role.toLowerCase()}-workspace"`))
  if (role === 'STUDENT') assert.doesNotMatch(html, /data-testid="confirm-issue-ticket"/)
  else if (role === 'CASHIER') assert.match(html, /disabled/)
  else assert.doesNotMatch(html, /Manage configuration|data-testid="staff-confirm"|>Confirm change<\/button>/)
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
