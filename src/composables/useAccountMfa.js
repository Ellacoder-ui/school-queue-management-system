import { onUnmounted, shallowRef, watch } from 'vue'
import { createAccountMfa } from '../lib/accountMfa.js'
export function useAccountMfa(auth, controller, authState) {
  const mfa = createAccountMfa(auth, { enabled: import.meta.env.VITE_AUTH_MFA_TOTP_ENABLED === 'true',
    getScope: controller.getMfaScope, onVerified: controller.refresh, onState: next => { state.value = next } })
  const state = shallowRef(mfa.getState())
  watch(authState, () => mfa.accessChanged(), { flush: 'sync' })
  const hidden = () => { if (document.visibilityState === 'hidden') mfa.close() }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', hidden)
  onUnmounted(() => { if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', hidden); mfa.stop() })
  return { state, open: mfa.open, enroll: mfa.enroll, select: mfa.select, verify: mfa.verify, close: mfa.close,
    requestDiscard: mfa.requestDiscard, cancelDiscard: mfa.cancelDiscard, discardUnfinished: mfa.discardUnfinished }
}
