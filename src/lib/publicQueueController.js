// Framework-independent state machine, used by Vue and by local integration tests.
import { dateInZone, nextDateDelay } from './businessDate.js'

export function createPublicQueueController(api, { onState, now = () => new Date().toISOString(),
  clock = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let state = { counters: [], services: [], hasSnapshot: false, loading: true,
    refreshing: false, connection: 'connecting', synchronized: false, error: null, lastRefreshed: null, context: null }
  let stopped = false
  let started = false
  let epoch = 0
  let version = 0
  let active = null
  let unsubscribe = null
  let dateTimer
  function scheduleDateCheck() {
    clearTimer(dateTimer)
    if (stopped || !state.context) return
    dateTimer = setTimer(() => {
      if (stopped) return
      if (dateInZone(clock(), state.context.timezone) !== state.context.business_date) refresh()
      scheduleDateCheck()
    }, Math.min(60000, nextDateDelay(clock(), state.context.timezone)))
  }
  const emit = patch => {
    if (stopped) return
    state = { ...state, ...patch }
    onState?.(state)
  }

  async function drain() {
    if (stopped || active) return
    const request = { epoch, version, abort: new AbortController() }
    active = request
    emit({ loading: !state.hasSnapshot, refreshing: true })
    try {
      const snapshot = await api.readPublicSnapshot({ signal: request.abort.signal })
      if (stopped || request.epoch !== epoch || request.version !== version) return
      emit({ ...snapshot, hasSnapshot: true, synchronized: state.connection === 'connected', error: null, lastRefreshed: now() })
      scheduleDateCheck()
    } catch {
      if (!stopped && request.epoch === epoch && request.version === version) {
        emit({ error: 'Unable to load the public queue. Check the connection and try again.' })
      }
    } finally {
      if (active === request) active = null
      if (!stopped) {
        if (request.epoch !== epoch || request.version !== version) void drain()
        else emit({ loading: false, refreshing: false })
      }
    }
  }
  function refresh() {
    if (stopped) return
    version += 1
    void drain()
  }
  function invalidateConnection(connection) {
    epoch += 1
    version += 1
    active?.abort.abort()
    emit({ connection, synchronized: false })
  }
  async function reconnect() {
    if (stopped) return
    invalidateConnection('connecting')
    const connectionEpoch = epoch
    const previous = unsubscribe
    unsubscribe = null
    if (previous) await previous()
    if (stopped || connectionEpoch !== epoch) return
    try {
      unsubscribe = api.subscribePublicDisplay({
        onReady() { if (!stopped) { invalidateConnection('connected'); refresh() } },
        onDisconnect() { if (!stopped) invalidateConnection('disconnected') },
        onInvalidate: refresh,
      })
      refresh() // First usable snapshot, followed by another after backend readiness.
    } catch {
      invalidateConnection('disconnected')
      refresh()
    }
  }
  return {
    getState: () => state,
    start() { if (!started && !stopped) { started = true; void reconnect() } },
    refresh,
    retry: reconnect,
    offline() { if (!stopped) invalidateConnection('disconnected') },
    async stop() {
      if (stopped) return
      stopped = true
      epoch += 1
      clearTimer(dateTimer)
      active?.abort.abort()
      if (unsubscribe) await unsubscribe()
      unsubscribe = null
    },
  }
}
