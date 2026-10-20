<script setup>
import { ref, watch } from 'vue'
import WorkspaceDialog from './WorkspaceDialog.vue'
const props = defineProps({ state: { type: Object, required: true } })
const emit = defineEmits(['close', 'enroll', 'select', 'verify', 'refresh', 'request-discard', 'cancel-discard', 'discard'])
const code = ref(''), manual = ref(false), qrFailed = ref(false)
watch(() => props.state.phase, () => { code.value = ''; manual.value = false; qrFailed.value = false })
watch(() => props.state.qr, () => { qrFailed.value = false })
function verify() { const value = code.value; code.value = ''; emit('verify', value) }
</script>
<template>
  <WorkspaceDialog v-if="state.phase !== 'closed'" title="Account security" @close="emit('close')">
    <div class="cqs-mfa" data-testid="account-mfa" :data-phase="state.phase" :aria-busy="state.busy">
      <p class="cqs-notice">Authenticator verification protects your session. It does not grant ADMIN or CASHIER access. Staff roles and approval remain institution-controlled.</p>
      <p v-if="state.message" :role="state.phase === 'verified' ? 'status' : 'alert'" class="cqs-notice" data-testid="mfa-message">{{ state.message }}</p>
      <p v-if="['loading', 'enrolling', 'verifying', 'discarding'].includes(state.phase)" role="status">{{ state.phase === 'enrolling' ? 'Preparing authenticator setup…' : state.phase === 'verifying' ? 'Verifying your code…' : state.phase === 'discarding' ? 'Discarding only the unfinished setup…' : 'Checking your account security…' }}</p>
      <template v-if="state.phase === 'choose'">
        <h3>{{ state.factors.length ? 'Verify your authenticator' : state.unfinished.length ? 'An unfinished setup needs attention' : 'Set up an authenticator app' }}</h3>
        <p>Use an authenticator app on a device you control. Never share its setup key or verification codes.</p>
        <button v-for="factor in state.factors" :key="factor.id" type="button" class="cqs-button cqs-button-primary" :disabled="state.busy" data-testid="mfa-select-factor" @click="emit('select', factor.id)">Verify {{ factor.label }}</button>
        <button v-if="!state.factors.length && !state.unfinished.length" type="button" class="cqs-button cqs-button-primary" :disabled="state.busy" data-testid="mfa-enroll" @click="emit('enroll')">Set up authenticator</button>
        <div v-for="factor in state.unfinished" :key="factor.id" class="cqs-notice">
          <p>An unfinished setup exists. If you already scanned its QR code, finish verification below. The QR and key cannot be shown again. If you never scanned it, ask the trusted operator to review this setup before explicitly discarding it. A new setup is never created automatically.</p>
          <button type="button" class="cqs-button cqs-button-outline" :disabled="state.busy" data-testid="mfa-resume" @click="emit('select', factor.id)">Finish existing authenticator setup</button>
          <button v-if="state.currentLevel === 'aal1' && !state.factors.length" type="button" class="cqs-link" :disabled="state.busy" data-testid="mfa-request-discard" @click="emit('request-discard', factor.id)">I never scanned it — review discard</button>
        </div>
      </template>
      <section v-if="state.phase === 'confirm-reset'" data-testid="mfa-confirm-reset" aria-labelledby="mfa-reset-title">
        <h3 id="mfa-reset-title">Discard this unfinished setup?</h3>
        <p>Only continue after trusted operator review and explicit approval. This removes the selected unverified setup from your signed-in account. It does not remove a verified authenticator, change your role or start another enrollment.</p>
        <p class="cqs-caption">Factor ID: <code>{{ state.resetFactor }}</code></p>
        <button type="button" class="cqs-button cqs-button-outline" data-testid="mfa-cancel-discard" :disabled="state.busy" @click="emit('cancel-discard')">Keep setup</button>
        <button type="button" class="cqs-button cqs-button-primary" data-testid="mfa-discard" :disabled="state.busy" @click="emit('discard')">Discard only this unfinished setup</button>
      </section>
      <template v-if="state.phase === 'setup'">
        <h3>Scan with your authenticator app</h3><p>Keep this setup private. Do not capture or share this screen.</p>
        <img v-if="state.qr && !qrFailed" class="cqs-mfa-qr" :src="state.qr" alt="Private authenticator setup QR code" referrerpolicy="no-referrer" draggable="false" data-testid="mfa-qr" @error="qrFailed = true">
        <p v-if="!state.qr || qrFailed" class="cqs-notice" role="alert" data-testid="mfa-qr-error">The QR image could not be displayed. Use the private manual setup instructions below with this same setup. Do not create another enrollment.</p>
        <button type="button" class="cqs-link" :aria-expanded="manual" @click="manual = !manual">{{ manual ? 'Hide manual setup key' : 'Show manual setup instructions' }}</button>
        <div v-if="manual" class="cqs-notice" data-testid="mfa-manual"><p>Choose a time-based account in your authenticator, name it Cashier Queue, and enter this key. Use six digits and a 30-second interval.</p><code class="cqs-mfa-key">{{ state.secret }}</code></div>
      </template>
      <form v-if="['setup', 'verify'].includes(state.phase)" @submit.prevent="verify">
        <label class="cqs-field" for="mfa-code">Authenticator code<input id="mfa-code" v-model="code" data-testid="mfa-code" name="authenticator-code" type="password" inputmode="numeric" autocomplete="off" pattern="[0-9]{6}" minlength="6" maxlength="6" required :disabled="state.busy" aria-describedby="mfa-code-help"></label>
        <p id="mfa-code-help" class="cqs-caption">Enter the current six-digit code. If a code expires, wait for a new one.</p>
        <button type="submit" class="cqs-button cqs-button-primary" data-testid="mfa-verify" :disabled="state.busy || !/^\d{6}$/.test(code)">Verify code</button>
      </form>
      <p v-if="state.phase === 'verified'" class="cqs-notice cqs-notice-success" data-testid="mfa-verified">This session is verified at AAL2. Your dashboard still follows your current database role. Sensitive staff controls remain unavailable until the required backend protections and approvals are complete.</p>
      <button v-if="state.phase === 'interrupted'" type="button" class="cqs-button cqs-button-outline" :disabled="state.busy" data-testid="mfa-recheck" @click="emit('refresh')">Check current MFA status</button>
      <p v-if="['setup', 'verify', 'verifying', 'enrolling', 'interrupted'].includes(state.phase)" class="cqs-caption">Closing clears the setup display and code. It does not undo a request already sent. Reopen account security to inspect any unfinished setup or completed verification.</p>
    </div>
    <template #actions><button type="button" class="cqs-button cqs-button-outline" data-testid="mfa-close" @click="emit('close')">{{ state.phase === 'verified' ? 'Done' : 'Close' }}</button></template>
  </WorkspaceDialog>
</template>
