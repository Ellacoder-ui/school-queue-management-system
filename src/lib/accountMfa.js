// Account security only. Never grants a role; setup material lives only in memory.
import { withMfaRequest } from './mfaRequestPolicy.js'
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)
const interrupted = Symbol('interrupted')
export function totpImage(value) {
  if (typeof value !== 'string' || value.length > 1024 * 1024) throw interrupted
  let svg = value.replace(/^data:image\/svg\+xml;utf-8,/, '').trim()
  // Auth's SVGo output includes an XML declaration and a generator comment.
  // Remove metadata only; validate the resulting SVG before encoding for <img>.
  if (/<!DOCTYPE|<!ENTITY/i.test(svg)) throw interrupted
  svg = svg.replace(/^<\?xml\s+version=["']1\.0["'](?:\s+encoding=["']UTF-8["'])?\s*\?>\s*/i, '')
    .replace(/<!--[\s\S]*?-->/g, '').trim()
  if (!/^<svg[\s>]/.test(svg) || !/<\/svg>\s*$/.test(svg)) throw interrupted
  // Block declarations/processing instructions, active content and event handlers.
  if (/<!|<\?|<script|<style|foreignObject|\bon\w+\s*=/i.test(svg)) throw interrupted
  // Block external href/src (allow internal fragment references like href="#id")
  if (/(?:href|src)\s*=\s*(?!["']?\s*#)/i.test(svg)) throw interrupted
  // Block external url() references (allow internal like url(#gradient))
  if (/url\s*\(\s*(?!["']?\s*#)/i.test(svg)) throw interrupted
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}
function sessionBinding(session, now) {
  if (!session?.user?.id || !Number.isFinite(session.expires_at) || session.expires_at * 1000 <= now()) throw interrupted
  try {
    // Continuity only. getUser and the existing Auth controller verify identity.
    const claims = JSON.parse(atob(session.access_token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')))
    if (!uuid(claims.session_id)) throw interrupted
    return { actor: session.user.id, session: claims.session_id }
  } catch { throw interrupted }
}
export function createAccountMfa(auth, { enabled = false, getScope, onState, onVerified = () => {}, now = Date.now, timeoutMs = 13000 } = {}) {
  let state = { phase: 'closed', busy: false, message: null, qr: null, secret: null, factors: [], unfinished: [], currentLevel: null, resetFactor: null }
  let epoch = 0, scope, binding, factor, stopped = false, running = false
  const emit = patch => { if (!stopped) { state = { ...state, ...patch }; onState?.(state) } }
  const hide = () => ({ qr: null, secret: null, resetFactor: null })
  const sameScope = () => scope && JSON.stringify(getScope?.()) === JSON.stringify(scope)
  function valid(version) { if (stopped || version !== epoch || !sameScope()) throw interrupted }
  function failure(error) {
    if (error?.status === 401 || ['session_not_found', 'refresh_token_not_found', 'bad_jwt'].includes(error?.code)) return 'Your session could not be verified. Close this panel and sign in again.'
    if (['mfa_totp_enroll_not_enabled', 'mfa_totp_verify_not_enabled', 'mfa_disabled'].includes(error?.code)) return 'Authenticator MFA is unavailable in the running Auth service.'
    if (error?.code === 'mfa_verification_failed') return 'The code was not accepted. Check your authenticator and device time, then enter a new code.'
    if (['mfa_challenge_expired', 'mfa_challenge_not_found'].includes(error?.code)) return 'The verification challenge expired. Enter a fresh code to create a new challenge.'
    if (error?.status === 429) return 'Too many attempts. Wait before trying again.'
    return 'The outcome could not be confirmed. Close and reopen account security to check the current state.'
  }
  async function result(promise, version) {
    const value = await promise; valid(version)
    if (value?.error) throw value.error
    if (!value?.data) throw interrupted
    return value.data
  }
  async function identity(version, first = false) {
    const current = await result(auth.getSession(), version), next = sessionBinding(current.session, now)
    if (next.actor !== scope.actor || (!first && JSON.stringify(next) !== JSON.stringify(binding))) throw interrupted
    const user = await result(auth.getUser(), version)
    if (user.user?.id !== next.actor) throw interrupted
    if (first) binding = next
  }
  const mutation = (method, args, version, requiredAal) => withMfaRequest({ ...binding, requiredAal }, () => !stopped && version === epoch && !!sameScope(), () => auth.mfa[method](args))
  async function inventory(version) {
    const [list, level] = await Promise.all([result(auth.mfa.listFactors(), version), result(auth.mfa.getAuthenticatorAssuranceLevel(), version)])
    if (!Array.isArray(list.all) || !['aal1', 'aal2'].includes(level.currentLevel)) throw interrupted
    const rows = list.all.filter(row => row.factor_type === 'totp')
    if (rows.some(row => !uuid(row.id) || !['verified', 'unverified'].includes(row.status))) throw interrupted
    const verified = rows.filter(row => row.status === 'verified')
    if (level.currentLevel === 'aal2' && !verified.length) throw interrupted
    const safe = row => ({ id: row.id, label: row.status === 'verified' ? 'Authenticator ' + (verified.indexOf(row) + 1) : 'Unfinished authenticator setup' })
    await identity(version); factor = null
    emit({ ...hide(), phase: level.currentLevel === 'aal2' ? 'verified' : 'choose', currentLevel: level.currentLevel,
      factors: verified.map(safe), unfinished: rows.filter(row => row.status === 'unverified').map(safe), message: null })
  }
  async function run(body, phase, first = false) {
    if (stopped || running || !sameScope()) return
    running = true; const version = epoch
    emit({ busy: true, phase, message: null })
    let timer
    const work = (async () => { await identity(version, first); await body(version) })()
    try { await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(interrupted), timeoutMs) })]) }
    catch (error) {
      if (!stopped && version === epoch) { epoch++; factor = null; emit({ ...hide(), phase: 'interrupted', message: failure(error) }) }
    } finally {
      clearTimeout(timer)
      // A timeout/cancel never retries or permits a competing mutation while settling.
      void work.catch(() => {}).finally(() => { running = false; if (!stopped) emit({ busy: false }) })
    }
  }
  return {
    getState: () => state,
    open() {
      if (stopped || running) return
      epoch++; factor = null; binding = null; scope = getScope?.()
      emit({ ...hide(), factors: [], unfinished: [], currentLevel: null, message: null })
      if (!scope) { emit({ phase: 'interrupted', message: 'Sign in and verify your account before setting up MFA.' }); return }
      if (!enabled) { emit({ phase: 'unavailable', message: 'Authenticator MFA is not enabled for this local application. Setup and verification are unavailable until the reviewed Auth configuration is activated.' }); return }
      return run(inventory, 'loading', true)
    },
    enroll() {
      if (state.phase !== 'choose' || state.unfinished.length || state.factors.length) return
      return run(async version => {
        const data = await result(mutation('enroll', { factorType: 'totp', friendlyName: 'Cashier Queue account', issuer: 'Cashier Queue' }, version), version)
        if (!uuid(data.id) || data.type !== 'totp' || !/^[A-Za-z2-7]{16,128}$/.test(data.totp?.secret || '')) throw interrupted
        let qr = null
        try { qr = totpImage(data.totp.qr_code) } catch { /* Same-factor manual setup remains available; never render rejected SVG. */ }
        await identity(version); factor = data.id
        emit({ phase: 'setup', qr, secret: data.totp.secret, message: qr ? null : 'The QR image is unavailable. Use the private manual setup instructions for this same authenticator setup.' })
      }, 'enrolling')
    },
    select(id) {
      if (running || state.phase !== 'choose' || ![...state.factors, ...state.unfinished].some(row => row.id === id)) return
      factor = id; emit({ ...hide(), phase: 'verify', message: null })
    },
    requestDiscard(id) {
      if (running || state.phase !== 'choose' || state.currentLevel !== 'aal1' || state.factors.length
        || !state.unfinished.some(row => row.id === id)) return
      emit({ ...hide(), phase: 'confirm-reset', resetFactor: id, message: null })
    },
    cancelDiscard() {
      if (!running && state.phase === 'confirm-reset') emit({ ...hide(), phase: 'choose', message: null })
    },
    discardUnfinished() {
      if (running || state.phase !== 'confirm-reset' || !uuid(state.resetFactor)) return
      const chosen = state.resetFactor
      return run(async version => {
        const list = await result(auth.mfa.listFactors(), version)
        const level = await result(auth.mfa.getAuthenticatorAssuranceLevel(), version)
        if (level.currentLevel !== 'aal1' || !Array.isArray(list.all) || list.all.some(row => row.status === 'verified')
          || !list.all.some(row => row.id === chosen && row.factor_type === 'totp' && row.status === 'unverified')) throw interrupted
        await identity(version)
        // Pin the actual outgoing JWT to AAL1. Auth refuses removing a factor that
        // became verified concurrently; an upgraded SDK session cannot retarget it.
        const removed = await result(mutation('unenroll', { factorId: chosen }, version, 'aal1'), version)
        if (removed.id !== chosen) throw interrupted
        await inventory(version)
        if (state.unfinished.some(row => row.id === chosen) || state.factors.some(row => row.id === chosen)) throw interrupted
        emit({ message: 'The unfinished setup was discarded. Start a new setup only when you are ready to scan its QR. Your role is unchanged.' })
      }, 'discarding')
    },
    verify(code) {
      if (!['setup', 'verify'].includes(state.phase) || !factor || running) return
      if (!/^\d{6}$/.test(code)) { emit({ message: 'Enter the six digits shown in your authenticator app.' }); return }
      const chosen = factor
      return run(async version => {
        const challenge = await result(mutation('challenge', { factorId: chosen }, version), version)
        if (!uuid(challenge.id) || !Number.isFinite(challenge.expires_at) || challenge.expires_at * 1000 <= now()) throw { code: 'mfa_challenge_expired' }
        await identity(version)
        let response
        try { response = await mutation('verify', { factorId: chosen, challengeId: challenge.id, code }, version) }
        finally { code = '' }
        valid(version)
        if (response?.error) {
          if (['mfa_verification_failed', 'mfa_challenge_expired', 'mfa_challenge_not_found'].includes(response.error.code)) {
            emit({ phase: 'verify', ...hide(), message: failure(response.error) }); return
          }
          throw response.error
        }
        emit(hide()); await identity(version); await inventory(version)
        if (state.currentLevel !== 'aal2' || !state.factors.some(row => row.id === chosen)) throw interrupted
        await onVerified()
        valid(version); emit({ phase: 'verified', message: 'Authenticator verification succeeded. Your institution still controls your role and staff approval.' })
      }, 'verifying')
    },
    accessChanged() { if (state.phase !== 'closed' && scope && !sameScope()) { epoch++; factor = null; binding = null; emit({ ...hide(), phase: 'interrupted', factors: [], unfinished: [], message: 'Your session or account access changed. Close this panel and verify your sign-in again.' }) } },
    close() { epoch++; factor = null; binding = null; scope = null; emit({ ...hide(), phase: 'closed', message: null, factors: [], unfinished: [], currentLevel: null }) },
    stop() { epoch++; stopped = true; factor = null; binding = null; scope = null; state = { phase: 'closed', ...hide() } },
  }
}
