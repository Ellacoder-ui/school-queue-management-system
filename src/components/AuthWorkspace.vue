<script setup>
import { computed } from 'vue'
import GoogleAuthCallback from './GoogleAuthCallback.vue'
import LocalTestLogin from './LocalTestLogin.vue'

const props = defineProps({ state: { type: Object, required: true }, developmentLogin:Boolean,
  oauthState:{type:Object,default:() => ({phase:'idle',message:null})} })
const emit = defineEmits(['login', 'logout', 'refresh', 'navigate', 'google', 'reconcile-oauth', 'cancel-oauth'])
const busy = computed(() => ['initializing', 'signing-in', 'signing-out', 'checking'].includes(props.state.status))
const roleLabel = computed(() => ({ STUDENT: 'Queue Dashboard', CASHIER: 'Cashier workspace', ADMIN: 'Administrator workspace' })[props.state.context?.role])
const ready = computed(() => props.state.status === 'ready' && props.state.context?.enabled)
const oauthBusy = computed(() => ['starting','redirecting','exchanging','checking'].includes(props.oauthState.phase))
</script>

<template>
  <section id="account-workspace" class="mt-8 rounded-lg border border-slate-200 bg-white p-5 sm:p-7" aria-label="Account workspace" :aria-busy="busy">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div><h2 class="text-lg font-semibold">{{ developmentLogin ? 'Development test sign-in' : 'Your queue workspace' }}</h2><p class="mt-1 text-sm text-slate-500">{{ developmentLogin ? 'For existing local test accounts only.' : 'One sign-in for students, payors and authorized staff.' }}</p></div>
      <button v-if="state.signedIn" type="button" @click="emit('logout')" :disabled="state.status === 'signing-out'"
        class="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50">{{ state.status === 'signing-out' ? 'Signing out…' : 'Sign out' }}</button>
    </div>
    <p v-if="state.message" role="alert" class="mt-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">{{ state.message }}</p>
    <GoogleAuthCallback :state="oauthState" @reconcile="emit('reconcile-oauth')" @cancel="emit('cancel-oauth')" />
    <p v-if="busy" role="status" class="mt-5 text-sm text-slate-500">{{ state.status === 'signing-in' ? 'Signing in…' : state.status === 'signing-out' ? 'Clearing your session…' : 'Verifying account access…' }}</p>
    <div v-else-if="state.status === 'disabled'" class="mt-5 rounded-lg bg-slate-50 p-5" data-testid="access-disabled">
      <h3 class="font-semibold">Account access disabled</h3><p class="mt-2 text-sm leading-6 text-slate-600">Contact the institution to review your access. The public queue remains available.</p>
      <button type="button" @click="emit('refresh')" class="mt-4 text-sm font-medium text-emerald-800 underline">Check access again</button>
    </div>
    <template v-else-if="ready">
      <nav aria-label="Workspace navigation" class="mt-5 flex flex-wrap gap-2">
        <button type="button" @click="emit('navigate', 'public')" :aria-current="state.workspace === 'public' ? 'page' : undefined" class="rounded-lg border border-slate-300 px-4 py-2 text-sm">Public queue</button>
        <button type="button" @click="emit('navigate', state.context.role.toLowerCase())" :aria-current="state.workspace !== 'public' ? 'page' : undefined" class="auth-primary">{{ roleLabel }}</button>
        <button type="button" @click="emit('refresh')" class="px-2 py-2 text-sm text-emerald-800 underline">Refresh access</button>
      </nav>
      <article v-if="state.workspace === state.context.role.toLowerCase()" :key="state.accountVersion" class="mt-5 border-t border-slate-100 pt-5" :data-testid="`${state.workspace}-workspace`">
        <h3 class="text-lg font-semibold">{{ roleLabel }}</h3>
        <p class="mt-2 text-sm leading-6 text-slate-600">{{ state.context.role === 'STUDENT' ? 'Students and outside payors share this queue dashboard. Ticket requests are not available yet.' : state.context.role === 'CASHIER' ? 'Your assigned counters are shown below. Counter actions will be connected in a later phase.' : 'Your administrator access is verified. Configuration tools will be connected in a later phase.' }}</p>
        <template v-if="state.context.role === 'CASHIER'">
          <p v-if="!state.context.cashier_counters.length" class="mt-4 text-sm text-slate-500">No counters are currently assigned to you.</p>
          <ul v-else class="mt-4 grid gap-3 sm:grid-cols-2">
            <li v-for="counter in state.context.cashier_counters" :key="counter.counter_id" class="rounded-lg border border-slate-200 p-4">
              <p class="font-medium">{{ counter.counter_label }}</p><p class="mt-1 text-sm text-slate-500">{{ counter.is_open ? 'Open counter' : 'Closed counter' }}</p>
              <p class="mt-2 text-sm text-slate-600">{{ counter.service_codes.length ? counter.service_codes.join(' · ') : 'No enabled services assigned' }}</p>
            </li>
          </ul>
        </template>
        <button type="button" disabled class="mt-5 cursor-not-allowed rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-500">{{ state.context.role === 'STUDENT' ? 'Ticket issuance not available yet' : state.context.role === 'CASHIER' ? 'Counter actions not available yet' : 'Administration actions not available yet' }}</button>
      </article>
      <p v-else class="mt-5 text-sm text-slate-500">You are viewing the public queue. Your authorized workspace is available above.</p>
    </template>
    <button v-else-if="state.signedIn" type="button" @click="emit('refresh')" class="mt-5 rounded-lg border border-slate-300 px-4 py-2 text-sm">Retry access verification</button>
    <LocalTestLogin v-else-if="developmentLogin" :disabled="busy || oauthBusy" @login="(...args) => emit('login', ...args)" />
    <div v-else class="google-login-panel">
      <button type="button" class="auth-primary google-login-button" data-testid="google-login" :disabled="busy || oauthBusy" @click="emit('google')">Continue with Google</button>
      <p>Use your personal or school Google account. Your access is verified securely after sign-in.</p>
      <a href="/display" class="auth-text-link">View the public queue without signing in</a>
    </div>
  </section>
</template>
