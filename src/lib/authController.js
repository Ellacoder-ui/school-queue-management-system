// No token, password, email, Auth metadata or account UUID is emitted to view state.
export function createAuthController(auth, api, {
  onState, now = () => Date.now(), defer = fn => setTimeout(fn, 0),
  setTimer = setTimeout, clearTimer = clearTimeout, timeoutMs = 13000,
} = {}) {
  let state = { status: 'initializing', signedIn: false, context: null, workspace: 'public', message: null, accountVersion: 0 }
  let started = false, stopped = false, generation = 0, command = 0, session = null
  let subscription, active, expiration, blocked = false, autoNavigate = true
  const emit = patch => { if (!stopped) { state = { ...state, ...patch }; onState?.(state) } }
  const clear = (status, message = null) => {
    generation++
    active?.abort()
    clearTimer(expiration)
    emit({ status, context: null, workspace: 'public', signedIn: !!session, message, accountVersion: state.accountVersion + 1 })
    return generation
  }
  async function bounded(promise, signal) {
    let timer, abort
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        abort = () => reject(new Error('Interrupted'))
        signal?.addEventListener('abort', abort, { once: true })
        if (signal?.aborted) return abort()
        timer = setTimer(() => reject(new Error('Unavailable')), timeoutMs)
      })])
    } finally { clearTimer(timer); signal?.removeEventListener('abort', abort) }
  }
  function expired() {
    blocked = true
    session = null
    clear('expired', 'Your session has expired. Sign in again.')
  }
  function scheduleExpiration() {
    clearTimer(expiration)
    if (session) expiration = setTimer(() => refresh(), Math.min(2147483647, Math.max(0, session.expires_at * 1000 - now())))
  }
  async function verify(expectedGeneration) {
    if (stopped || blocked || expectedGeneration !== generation || !session) return
    const expectedUser = session.user.id
    const abort = new AbortController(); active = abort
    try {
      const current = await bounded(auth.getSession(), abort.signal)
      if (stopped || expectedGeneration !== generation) return
      if (current.error || !current.data.session || current.data.session.user.id !== expectedUser) {
        expired(); return
      }
      session = current.data.session
      if (!Number.isFinite(session.expires_at) || session.expires_at * 1000 <= now()) { expired(); return }
      const user = await bounded(auth.getUser(), abort.signal)
      if (stopped || expectedGeneration !== generation) return
      if (user.error || user.data.user?.id !== expectedUser) {
        if (user.error?.status === 401 || user.error?.status === 403 || !user.error) expired()
        else throw new Error('Account verification unavailable')
        return
      }
      const context = await bounded(api.readMyContext({ signal: abort.signal }), abort.signal)
      if (stopped || expectedGeneration !== generation || blocked) return
      if (session.expires_at * 1000 <= now()) { expired(); return }
      const workspace = context.role?.toLowerCase() === 'admin' ? 'admin' : context.role?.toLowerCase()
      emit({ context, status: context.enabled ? 'ready' : 'disabled', message: null,
        workspace: context.enabled && autoNavigate ? workspace : 'public' })
      scheduleExpiration()
    } catch (error) {
      if (!stopped && expectedGeneration === generation) {
        if (error?.status === 401 || error?.code === 'PGRST301') expired()
        else emit({ status: 'error', context: null, workspace: 'public', message: 'Account access could not be verified. Retry or sign out.' })
      }
    } finally { if (active === abort) active = null }
  }
  function receive(next, event) {
    if (stopped) return
    if (!next) {
      const ended = !!session && !blocked && event === 'SIGNED_OUT'
      session = null
      if (ended) { blocked = true; clear('expired', 'Your session has ended. Sign in again.') }
      else clear('anonymous')
      return
    }
    if (blocked) return
    if (event === 'INITIAL_SESSION' && state.status === 'signing-in') return
    const changedUser = next.user.id !== session?.user.id
    if (changedUser) { command++; autoNavigate = true }
    session = next
    const epoch = clear('checking') // synchronous clearing, no awaited SDK calls in callback
    defer(() => { void verify(epoch) })
  }
  function refresh() {
    if (stopped || blocked || !session) return
    const epoch = clear('checking')
    defer(() => { void verify(epoch) })
  }
  return {
    getState: () => state,
    start({ suspended = false } = {}) {
      if (started || stopped) return
      started = true
      blocked = suspended
      subscription = auth.onAuthStateChange((event, next) => receive(next, event)).data.subscription
      if (suspended) return
      const epoch = generation
      void bounded(auth.getSession()).then(result => {
        if (stopped || generation !== epoch) return
        if (result.error) { session = null; clear('error', 'Session recovery failed. Sign in again.'); return }
        receive(result.data.session, 'INITIAL_SESSION')
      }).catch(() => { if (!stopped && generation === epoch) clear('error', 'Session recovery failed. Try again.') })
    },
    beginExternal() {
      command++; blocked = true; session = null; autoNavigate = true
      clear('signing-in')
      return command
    },
    acceptExternal(action, next) {
      if (stopped || action !== command || !next) return
      blocked = false
      receive(next, 'SIGNED_IN')
    },
    rejectExternal(action, message, existingSession = null) {
      if (stopped || action !== command) return
      blocked = true; session = existingSession
      clear(existingSession ? 'error' : 'anonymous', message)
    },
    async login(email, password) {
      if (stopped || ['signing-in', 'signing-out'].includes(state.status)) return
      const action = ++command
      blocked = false; session = null; autoNavigate = true; clear('signing-in')
      try {
        const result = await bounded(auth.signInWithPassword({ email: email.trim(), password }))
        // SIGNED_IN can increment command when adopting a new subject. The callback
        // already owns verification then; never restore state from this result.
        if (stopped || action !== command) return
        if (result.error || !result.data.session) throw new Error('Sign-in failed')
        receive(result.data.session, 'SIGNED_IN')
      } catch {
        if (!stopped && action === command) {
          blocked = true; session = null
          clear('anonymous', 'Sign-in failed. Check your credentials and connection, then try again.')
        }
      }
    },
    async logout() {
      if (stopped || state.status === 'signing-out') return
      const action = ++command
      blocked = true
      clear('signing-out') // remove privileged state before the network request
      try {
        const result = await bounded(auth.signOut({ scope: 'local' }))
        if (stopped || action !== command) return
        if (result.error) throw new Error('Sign-out failed')
        session = null
        clear('anonymous')
      } catch {
        if (!stopped && action === command) clear('error', 'Sign-out could not be confirmed. Access is locked. Retry sign-out.')
      }
    },
    refresh,
    offline() { if (!stopped && session) clear('error', 'You are offline. Reconnect to verify account access.') },
    protectedDenied() { refresh() },
    navigate(workspace) {
      if (workspace === 'public') { autoNavigate = false; emit({ workspace }); return true }
      if (state.status !== 'ready' || !state.context?.enabled || workspace !== state.context.role.toLowerCase()) return false
      autoNavigate = true; emit({ workspace }); return true
    },
    stop() {
      stopped = true; generation++; command++
      active?.abort(); clearTimer(expiration); subscription?.unsubscribe()
      session = null
    },
  }
}
