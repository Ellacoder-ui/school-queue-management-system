import { OAUTH_CALLBACK, OAUTH_MARKER, OAUTH_ORIGIN, validateGoogleAuthorizationUrl } from './oauthConfig.js'

const ttl = 10 * 60 * 1000
const generic = 'Google sign-in could not be completed. Start a new attempt when you are ready.'
export function createGoogleOAuthController(auth, access, {
  store, tabStore, origin, navigate, cleanPath, providerEnabled, lock,
  now = Date.now, uuid = () => crypto.randomUUID(), timeoutMs = 14000,
  setTimer = setTimeout, clearTimer = clearTimeout, onState,
} = {}) {
  let state = { phase:'idle', message:null }, stopped = false, epoch = 0, task = null, callbackTask = null, markerExpiry, action
  let locallyCancelled = false
  const emit = patch => { if (!stopped) { state = { ...state, ...patch }; onState?.(state) } }
  const read = () => {
    const raw = store.getItem(OAUTH_MARKER)
    if (!raw) return null
    const marker = JSON.parse(raw)
    if (!marker || typeof marker.id !== 'string' || typeof marker.owner !== 'string' || !Number.isFinite(marker.created)
      || !['redirect','exchanging','uncertain','cancelled','error','complete'].includes(marker.phase)) throw new Error('Invalid flow marker')
    return marker
  }
  const owner = () => {
    let id = tabStore.getItem(OAUTH_MARKER)
    if (!id) { id = uuid(); tabStore.setItem(OAUTH_MARKER, id) }
    return id
  }
  const write = marker => store.setItem(OAUTH_MARKER, JSON.stringify(marker))
  const owned = marker => marker && marker.owner === owner()
  const current = marker => { const next = read(); return next?.id === marker.id && next.phase !== 'cancelled' }
  // OAuth status owns OAuth errors; keep the Auth banner clear to avoid rendering
  // the same failure twice.
  const fail = (message = generic, existingSession = null) => { access.rejectExternal(action, null, existingSession); emit({phase:'error',message}) }
  // This marker is app-owned recovery metadata, not Supabase Auth state. Retiring
  // it never removes the SDK's session or PKCE verifier.
  function shouldGate() {
    try {
      const marker = read()
      if (!marker) return false
      if (['complete','cancelled','error'].includes(marker.phase) || now()-marker.created >= ttl) {
        clearTimer(markerExpiry); markerExpiry=null
        store.removeItem(OAUTH_MARKER)
        return false
      }
      return true
    } catch {
      store.removeItem(OAUTH_MARKER)
      return false
    }
  }
  async function bounded(promise) {
    let timer
    try { return await Promise.race([promise, new Promise((_,reject) => { timer=setTimer(() => reject(new Error('Unavailable')),timeoutMs) })]) }
    finally { clearTimer(timer) }
  }
  function block() { action = access.beginExternal(); return ++epoch }
  async function accept(session, version, marker) {
    if (stopped || version !== epoch || locallyCancelled || !current(marker)) return false
    if (!session?.user?.id) throw new Error('Missing session')
    const user = await bounded(auth.getUser())
    if (user.error || user.data.user?.id !== session.user.id) throw new Error('User verification failed')
    if (stopped || version !== epoch || locallyCancelled || !current(marker)) return false
    write({ ...marker, phase:'complete' })
    access.acceptExternal(action, session) // The Auth controller independently verifies user/context again.
    cleanPath('/')
    emit({phase:'complete',message:null})
    return true
  }
  async function start() {
    if (stopped || task) return
    locallyCancelled = false
    const version = block()
    emit({phase:'starting',message:null})
    task = (async () => {
      try {
        if (origin !== OAUTH_ORIGIN) throw new Error('Wrong application origin')
        const enabled = await bounded(providerEnabled())
        if (!enabled) { fail('Google Sign-In is not available yet. Please try again later. The public queue remains available.'); return }
        await lock(async () => {
          if (stopped || version !== epoch) return
          const previous = read()
          if (previous && !owned(previous) && previous.phase !== 'complete' && now()-previous.created < ttl) {
            const message='Google sign-in is in progress in another tab. Try again after it finishes.'
            access.rejectExternal(action,null)
            emit({phase:'blocked',message})
            clearTimer(markerExpiry)
            markerExpiry=setTimer(() => {
              markerExpiry=null
              try { if (read()?.id === previous.id && now()-previous.created >= ttl && state.phase === 'blocked') emit({phase:'idle',message:null}) }
              catch { emit({phase:'idle',message:null}) }
            },Math.max(0,ttl-(now()-previous.created))+1)
            return
          }
          const session = await bounded(auth.getSession())
          if (session.error) throw new Error('Session unavailable')
          if (session.data.session) { fail('Sign out the existing session before switching accounts.', session.data.session); return }
          if (stopped || version !== epoch) return
          const marker = {id:uuid(),owner:owner(),created:now(),phase:'redirect'}
          write(marker)
          const result = await bounded(auth.signInWithOAuth({ provider:'google', options:{
            redirectTo:OAUTH_CALLBACK, skipBrowserRedirect:true, queryParams:{prompt:'select_account'},
          } }))
          if (stopped || version !== epoch || !current(marker)) return
          if (result.error) throw new Error('OAuth preparation failed')
          const url = validateGoogleAuthorizationUrl(result.data.url)
          emit({phase:'redirecting',message:'Opening Google Sign-In…'})
          navigate(url)
        })
      } catch { if (!stopped && version === epoch) fail() }
    })().finally(() => { task = null })
    return task
  }
  function callback(entry) {
    if (callbackTask) return callbackTask
    const version = block()
    emit({phase:'exchanging',message:'Completing sign-in…'})
    callbackTask = (async () => {
      let marker
      try {
        marker = read()
        if (entry?.cancelled) { cancel('Google sign-in was cancelled. You can try again.'); return }
        if (!entry || entry.invalid || entry.error || !entry.code || !owned(marker) || now()-marker.created >= ttl) throw new Error('Invalid callback')
        if (marker.phase !== 'redirect') {
          // Reloaded/duplicate callback: never exchange its single-use code again.
          emit({phase:'uncertain',message:'This sign-in was already handled or interrupted. Check its outcome or start a new attempt.'})
          access.rejectExternal(action, null); return
        }
        // Hold an origin-wide Web Lock through the real exchange, even if the UI
        // deadline expires. Another tab cannot overwrite its SDK PKCE verifier.
        task = lock(async () => {
          if (!current(marker) || stopped || version !== epoch) return
          marker = {...marker,phase:'exchanging'}; write(marker)
          const result = await auth.exchangeCodeForSession(entry.code)
          if (stopped || version !== epoch || !current(marker)) return
          if (result.error) throw new Error('Exchange rejected')
          await accept(result.data.session,version,marker)
        }).finally(() => {
          task=null
          // A deadline can expire while Auth is still finishing its request.
          // Reconcile automatically once the SDK/lock settles; never replay
          // the single-use authorization code.
          if (!stopped && state.phase === 'uncertain') void reconcile()
        })
        await bounded(task)
      } catch {
        if (stopped || version !== epoch) return
        epoch++ // A late SDK completion may save a session, but cannot restore navigation.
        const exchangeMayHaveCompleted = marker && owned(marker) && ['exchanging','uncertain'].includes(marker.phase) && current(marker)
        if (exchangeMayHaveCompleted) {
          write({...marker,phase:'uncertain'})
          emit({phase:'uncertain',message:'Sign-in is being checked. If the check is interrupted, refresh the page to recover it.'})
          access.rejectExternal(action, null)
          if (!task) void reconcile()
        } else {
          try { if (marker && owned(marker) && current(marker)) store.removeItem(OAUTH_MARKER) } catch { store.removeItem(OAUTH_MARKER) }
          fail()
        }
      } finally { if (entry) entry.code = null; entry = null }
    })()
    return callbackTask
  }
  async function reconcile() {
    if (stopped || task) return
    const version = block(); locallyCancelled = false
    emit({phase:'checking',message:'Checking sign-in…'})
    try {
      const marker = read()
      if (!marker || marker.phase === 'cancelled' || (!owned(marker) && marker.phase !== 'complete')) throw new Error('Unknown sign-in')
      const result = await bounded(auth.getSession())
      if (result.error || !result.data.session) throw new Error('No session')
      if (!await accept(result.data.session,version,marker)) throw new Error('Sign-in changed')
    } catch {
      if (!stopped && version === epoch) {
        // A reload without a callback cannot finish the code exchange. Retire
        // only this attempt's marker so a fresh login can start. Do not touch
        // Supabase storage: valid sessions and PKCE state belong to the SDK.
        try { const marker=read(); if (owned(marker) && marker.phase !== 'complete') store.removeItem(OAUTH_MARKER) } catch { store.removeItem(OAUTH_MARKER) }
        fail('No sign-in could be verified. You can try Google sign-in again.')
      }
    }
  }
  function cancel(message = 'Sign-in cancelled. You can start a new attempt.') {
    locallyCancelled = true; block()
    try { const marker=read(); if (marker && owned(marker) && marker.phase !== 'complete') store.removeItem(OAUTH_MARKER) } catch {}
    access.rejectExternal(action,message)
    emit({phase:'cancelled',message})
  }
  function storageChanged() {
    if (stopped || locallyCancelled) return
    try {
      const marker=read()
      if (!marker || ['complete','cancelled','error'].includes(marker.phase) || now()-marker.created >= ttl) {
        clearTimer(markerExpiry); markerExpiry=null
        if (['blocked','error'].includes(state.phase)) emit({phase:'idle',message:null})
      }
      // A shared marker never suspends Auth restoration or warns merely because
      // another tab opened. start() checks it before a new PKCE flow is created.
    } catch {
      clearTimer(markerExpiry); markerExpiry=null; store.removeItem(OAUTH_MARKER)
      if (['blocked','error'].includes(state.phase)) emit({phase:'idle',message:null})
    }
  }
  function returnedToApp() {
    if (stopped || state.phase !== 'redirecting') return false
    try {
      const marker=read()
      // A history-restored page has no callback to finish. Invalidate only its
      // local attempt state; never delete Supabase session or PKCE storage.
      if (marker && !owned(marker) && now()-marker.created < ttl) return false
      cancel('')
      return true
    } catch {
      cancel('')
      return true
    }
  }
  return { getState:() => state, shouldGate, start, callback, reconcile, cancel, storageChanged,
    returnedToApp,
    pending() {
      shouldGate() // retire only terminal, malformed, or expired app-owned markers
    },
    stop() { clearTimer(markerExpiry); if (task) cancel(); stopped=true; epoch++ },
  }
}

export function browserOAuthLock(fn) {
  if (!globalThis.navigator?.locks) return Promise.reject(new Error('Safe sign-in coordination unavailable'))
  return navigator.locks.request('school-queue-google-oauth', {ifAvailable:true}, lock => {
    if (!lock) throw new Error('Another sign-in is completing')
    return fn()
  })
}
