<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import GoogleAuthCallback from './GoogleAuthCallback.vue'
import LocalTestLogin from './LocalTestLogin.vue'
import StudentDashboard from './StudentDashboard.vue'
import CashierDashboard from './CashierDashboard.vue'
import AdminDashboard from './AdminDashboard.vue'
import QueueOverview from './QueueOverview.vue'
import WorkspaceDialog from './WorkspaceDialog.vue'
import QueueOperationNotice from './QueueOperationNotice.vue'
import AccountMfaDialog from './AccountMfaDialog.vue'
import { emptyWorkspace } from '../lib/workspaceData.js'
import { supabase } from '../lib/supabase.js'
import { emptyAdmin } from '../lib/adminWorkspace.js'
const props = defineProps({ state: { type: Object, required: true }, developmentLogin: Boolean,
  managementState: { type: Object, default: emptyAdmin },
  adminRecords: {type:Object,default:undefined},
  mfaMode: { type: Boolean, default: false },
  actor: { type: String, default: null },
  mfaState: { type: Object, default: () => ({ phase: 'closed' }) },
  oauthState: { type: Object, default: () => ({ phase: 'idle', message: null }) },
  publicState: { type: Object, default: () => ({ counters: [], services: [], hasSnapshot: false, context: null }) },
  data: { type: Object, default: emptyWorkspace },
  actionState: { type: Object, default: () => ({ phase: 'idle', message: null }) } })
const emit = defineEmits(['login', 'logout', 'refresh', 'navigate', 'google', 'refresh-data', 'queue-action', 'retry-action', 'dismiss-action', 'mfa-open', 'mfa-close', 'mfa-enroll', 'mfa-select', 'mfa-verify', 'mfa-request-discard', 'mfa-cancel-discard', 'mfa-discard', 'refresh-staff', 'management-action', 'reconcile-management','records-tab','records-find','records-clear','records-query','records-events','records-close-history','records-retry'])
const busy = computed(() => ['initializing', 'signing-in', 'signing-out', 'checking'].includes(props.state.status))
const ready = computed(() => props.state.status === 'ready' && props.state.context?.enabled)
const oauthBusy = computed(() => ['starting', 'redirecting', 'exchanging', 'checking', 'blocked'].includes(props.oauthState.phase))
const profile = ref({ name: '', avatar: '' })
function loadProfile(user) {
  if (!user) { profile.value = { name: '', avatar: '' }; return }
  const meta = user.user_metadata || {}
  profile.value = {
    name: meta.full_name || meta.name || meta.display_name || user.email || 'Signed-in user',
    avatar: meta.avatar_url || meta.picture || '',
  }
}
let profileEventTimer, profileSubscription
onMounted(() => {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    // Supabase awaits auth listeners under its auth lock. Defer UI-only session
    // metadata work and never call another Auth method from this callback.
    clearTimeout(profileEventTimer)
    profileEventTimer = setTimeout(() => loadProfile(session?.user), 0)
  })
  profileSubscription = data.subscription
})
onUnmounted(() => {
  clearTimeout(profileEventTimer)
  profileSubscription?.unsubscribe?.()
})
const displayName = computed(() => profile.value.name || 'Signed-in user')
const roleLabel = computed(() => ({ STUDENT: 'Payor', CASHIER: 'Cashier Staff', ADMIN: 'Admin' })[props.state.context?.role] || '')
const avatarUrl = computed(() => profile.value.avatar)
const initials = computed(() => (displayName.value || 'U').split(' ').map(p => p[0]).join('').slice(0,2).toUpperCase())
const logoutOpen = ref(false), signedOut = ref(false)
watch(() => props.state.status, (next, previous) => { if (next === 'anonymous' && previous === 'signing-out') signedOut.value = true; if (next === 'ready') signedOut.value = false; if (next !== 'ready') logoutOpen.value = false })
function logout() { logoutOpen.value = false; emit('logout') }
function closeMfa() { emit('mfa-close'); void nextTick(() => (document.querySelector('[data-testid="account-security"]') || document.querySelector('[data-testid="back-to-dashboard"]'))?.focus()) }
</script>
<template>
  <div id="account-workspace" class="cqs-app" :aria-busy="busy">
    <a class="cqs-skip" href="#workspace-main">Skip to main content</a>
    <template v-if="ready">
      <header class="cqs-header"><a href="/" class="cqs-brand" aria-label="Liceo de Cagayan University home"><img src="/liceo-logo.png" alt="Liceo de Cagayan University logo" class="cqs-brand-logo" /><span><strong>Liceo de Cagayan University</strong><small>University cashier services</small></span></a><div class="cqs-header-actions"><span class="cqs-account"><img v-if="avatarUrl" :src="avatarUrl" alt="Google profile picture" class="cqs-avatar-img" @error="profile.avatar=''" /><span v-else class="cqs-avatar" aria-hidden="true">{{ initials }}</span><span>{{ displayName }}<small>{{ roleLabel }}</small></span></span><button type="button" class="cqs-button cqs-button-outline" data-testid="sign-out" @click="logoutOpen = true">Sign out</button></div></header>
      <main id="workspace-main" class="cqs-workspace" :key="state.accountVersion">
        <nav v-if="props.mfaMode" class="cqs-workspace-nav" aria-label="Account security navigation"><button type="button" class="cqs-link" data-testid="account-security" @click="emit('mfa-open')">Account security</button><a href="/" class="cqs-link" data-testid="back-to-dashboard">← Back to dashboard</a></nav>
        <p v-if="props.mfaMode && state.context?.enabled" class="cqs-notice" role="status" data-testid="mfa-mode-banner">Secure account security page. This is the intentional MFA enrollment entry point. It does not change your role or grant ADMIN access. Verified account: {{ props.actor || 'verifying…' }}</p>
<p v-if="data.status === 'restricted' && ['ADMIN', 'CASHIER'].includes(state.context.role)" class="cqs-notice" role="alert">Staff access could not be authorized. Verify your authenticator and contact the institution about current staff approval. Controls remain unavailable while access is denied.</p>
        <QueueOperationNotice :state="actionState" @retry="emit('retry-action')" @dismiss="emit('dismiss-action')" />
        <StudentDashboard v-if="state.workspace === 'student' && state.context.role === 'STUDENT'" :public-state="publicState" :data="data" :action-state="actionState" @issue="parameters => emit('queue-action', 'issue_ticket', parameters)" @refresh="emit('refresh-data')" />
        <CashierDashboard v-else-if="state.workspace === 'cashier' && state.context.role === 'CASHIER'" :context="state.context" :public-state="publicState" :data="data" :action-state="actionState" @action="(...args) => emit('queue-action', ...args)" @refresh="emit('refresh-data')" />
        <AdminDashboard v-else-if="state.workspace === 'admin' && state.context.role === 'ADMIN'" :public-state="publicState" :data="data" :management="managementState" :records="adminRecords" @records-tab="emit('records-tab',$event)" @records-find="emit('records-find',$event)" @records-clear="emit('records-clear')" @records-query="emit('records-query',$event)" @records-events="emit('records-events',$event)" @records-close-history="emit('records-close-history')" @records-retry="emit('records-retry')" @refresh="emit('refresh-data')"
          @refresh-staff="emit('refresh-staff')" @management-action="(...args)=>emit('management-action',...args)" @reconcile-management="emit('reconcile-management')" />
        <QueueOverview v-else :state="publicState" />
      </main>
      <footer class="cqs-footer">Liceo Cashier Queue <span>Five services. One organized campus.</span></footer>
    </template>
    <main v-else-if="busy" id="workspace-main" class="cqs-session" data-testid="auth-pending">
      <section class="cqs-session-card" aria-labelledby="session-title">
        <div class="cqs-brand"><img src="/liceo-logo.png" alt="Liceo de Cagayan University logo" class="cqs-brand-logo" /><span><strong>Liceo de Cagayan University</strong><small>University cashier services</small></span></div>
        <h1 id="session-title">{{ state.status === 'initializing' ? 'Restoring your session' : state.status === 'signing-out' ? 'Signing out' : state.status === 'signing-in' ? 'Completing sign-in' : 'Verifying account access' }}</h1>
        <p role="status" class="cqs-verifying"><span class="cqs-spinner" aria-hidden="true"></span>{{ state.status === 'signing-out' ? 'Clearing your session…' : ({session:'Checking your saved session…',user:'Confirming your sign-in with Auth…',permissions:'Checking your account permissions…'}[state.verificationStep] || 'Please wait while we verify your access.') }}</p>
        <GoogleAuthCallback :state="oauthState" />
      </section>
    </main>
    <main v-else id="workspace-main" class="cqs-login">
      <section class="cqs-login-story" aria-label="University cashier services"><a href="/" class="cqs-brand"><img src="/liceo-logo.png" alt="Liceo de Cagayan University logo" class="cqs-brand-logo" /><span><strong>Liceo de Cagayan University</strong><small>University cashier services</small></span></a><div class="cqs-login-message"><p class="cqs-eyebrow">Campus cashier services</p><h1>Less waiting.<br>More learning.</h1><p>Your campus, your time. A simpler way to connect with the university cashier office.</p><div class="cqs-login-features"><div><strong>05</strong><span>Dedicated services</span></div><div><strong>One</strong><span>Secure sign-in</span></div><div><strong>Live</strong><span>Public queue updates</span></div></div></div><p class="cqs-login-footer">University Cashier Office <span>Made for a more organized day.</span></p></section>
      <section class="cqs-login-form" aria-label="Account workspace"><div class="cqs-login-inner"><p class="cqs-eyebrow">{{ developmentLogin ? 'Local development' : 'Welcome to your campus queue' }}</p><h2>{{ developmentLogin ? 'Development test sign-in' : 'Get in line, not held up.' }}</h2><p class="cqs-login-intro">{{ developmentLogin ? 'For existing local test accounts only.' : 'Sign in with Google to access your student or authorized staff workspace.' }}</p>
        <p v-if="signedOut" class="cqs-notice cqs-notice-success" role="status">You have signed out of this browser.</p><p v-if="state.message" role="alert" class="cqs-notice">{{ state.message }}</p>
        <GoogleAuthCallback :state="oauthState" />
        <div v-if="state.status === 'disabled'" class="cqs-notice" data-testid="access-disabled"><h3>Account access disabled</h3><p>Contact the institution to review your access. The public queue remains available.</p><button type="button" class="cqs-link" @click="emit('refresh')">Check access again</button></div>
        <button v-else-if="state.signedIn || state.status === 'error'" type="button" class="cqs-button cqs-button-outline" data-testid="auth-retry" :disabled="busy" @click="emit('refresh')">{{ state.signedIn ? 'Retry access verification' : 'Retry session verification' }}</button>
        <LocalTestLogin v-else-if="developmentLogin" :disabled="busy || oauthBusy" @login="(...args) => emit('login', ...args)" />
        <div v-else class="cqs-google-entry"><button type="button" class="cqs-google-button" data-testid="google-login" :disabled="busy || oauthBusy" @click="emit('google')"><svg aria-hidden="true" viewBox="0 0 24 24"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.6h3.3c1.9-1.8 2.9-4.4 2.9-7.5Z"/><path fill="#34A853" d="M12 22c2.7 0 4.9-.9 6.6-2.4l-3.3-2.6a6 6 0 0 1-9-3.1H2.9v2.7A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.3 13.9a6 6 0 0 1 0-3.8V7.4H2.9a10 10 0 0 0 0 9.2l3.4-2.7Z"/><path fill="#EA4335" d="M12 6a5.5 5.5 0 0 1 3.9 1.5l2.9-2.9A9.8 9.8 0 0 0 12 2a10 10 0 0 0-9.1 5.4l3.4 2.7A6 6 0 0 1 12 6Z"/></svg>Continue with Google</button><p class="cqs-caption">Use your personal or school Google account. Provider availability is checked when you continue.</p></div>
        <button v-if="state.signedIn" type="button" class="cqs-link cqs-signout-recovery" :disabled="busy" @click="logoutOpen = true">Sign out</button>
      </div><p class="cqs-login-legal">Cashier Queueing System · Liceo-inspired campus experience</p></section>
    </main>
    <WorkspaceDialog v-if="logoutOpen" title="Sign out of your workspace?" @close="logoutOpen = false"><p>Your local session will be cleared. You can still view the public queue.</p><p v-if="['pending', 'unknown'].includes(actionState.phase)" class="cqs-notice">A queue operation is unconfirmed. Signing out will not undo it. Its request key is retained for this account to reconcile later.</p><template #actions><button type="button" class="cqs-button cqs-button-outline" @click="logoutOpen = false">Stay signed in</button><button type="button" class="cqs-button cqs-button-primary" data-testid="confirm-sign-out" @click="logout">Sign out</button></template></WorkspaceDialog>
    <AccountMfaDialog :state="mfaState" @close="closeMfa" @refresh="emit('mfa-open')" @enroll="emit('mfa-enroll')" @select="id => emit('mfa-select', id)" @verify="code => emit('mfa-verify', code)"
      @request-discard="id => emit('mfa-request-discard', id)" @cancel-discard="emit('mfa-cancel-discard')" @discard="emit('mfa-discard')" />
  </div>
</template>
