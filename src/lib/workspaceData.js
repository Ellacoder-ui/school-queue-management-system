// Private reads follow verified database context; never infer a role from metadata.
const services = new Set(['TP', 'SOA', 'PNEP', 'REF', 'ADJ'])
const statuses = new Set(['WAITING', 'CALLED', 'SERVED', 'FORFEITED'])
export const ticketLabel = ticket => `${ticket.service}-${String(ticket.number).padStart(3, '0')}`
export const activeTicket = rows => rows.find(row => ['WAITING', 'CALLED'].includes(row.status)) || null
export const emptyWorkspace = () => ({ status: 'idle', rows: [], updatedAt: null, refreshing: false })
export function validateWorkspaceRows(rows, role) {
  if (!Array.isArray(rows)) throw new Error('Unavailable queue data')
  const seen = new Set()
  return rows.map(row => {
    const id = role === 'STUDENT' ? row.id : row.ticket_id
    if (typeof id !== 'string' || seen.has(id) || !services.has(row.service)
      || !Number.isSafeInteger(row.number) || row.number < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(row.business_date)
      || !statuses.has(row.status)) throw new Error('Unavailable queue data')
    seen.add(id)
    if (role === 'STUDENT') {
      if (!(row.counter === null || typeof row.counter === 'string') || typeof row.issued_at !== 'string'
        || !Number.isFinite(Date.parse(row.issued_at))) throw new Error('Unavailable ticket data')
      return { id, service: row.service, number: row.number, business_date: row.business_date,
        status: row.status, counter: row.counter, issued_at: row.issued_at }
    }
    if (!['WAITING', 'CALLED'].includes(row.status) || !(row.counter_id === null || typeof row.counter_id === 'string')
      || !Number.isSafeInteger(row.wait_position)) throw new Error('Unavailable staff data')
    return { ticket_id: id, service: row.service, number: row.number, business_date: row.business_date,
      status: row.status, counter_id: row.counter_id, wait_position: row.wait_position }
  })
}
export function createWorkspaceReader(api, { onState = () => {} } = {}) {
  let state = emptyWorkspace(), key = '', role = null, generation = 0, active, currentPromise, queued = false, stopped = false
  const emit = patch => { state = { ...state, ...patch }; onState(state) }
  function setAccess(access) {
    const nextRole = access.status === 'ready' && access.context?.enabled ? access.context.role : null
    const nextKey = nextRole ? `${access.accountVersion}:${nextRole}` : ''
    if (nextKey === key) return
    generation++; active?.abort(); active = null; queued = false; currentPromise = null; key = nextKey; role = nextRole
    emit(emptyWorkspace())
    if (nextRole) void refresh()
  }
  function refresh({ force = false, invalidate = false } = {}) {
    if (stopped || !key) return Promise.resolve()
    if (active && !force) { if (invalidate) queued = true; return currentPromise }
    if (active) { generation++; active.abort(); active = null; queued = false }
    const version = generation, expectedRole = role, abort = new AbortController()
    active = abort
    emit({ status: state.status === 'ready' ? 'ready' : 'loading', refreshing: true })
    currentPromise = (async () => { try {
      const rows = validateWorkspaceRows(await api.read(expectedRole === 'STUDENT' ? 'my_tickets' : 'staff_queue', {}, { signal: abort.signal }), expectedRole)
      if (!stopped && version === generation && !queued) emit({ status: 'ready', rows, updatedAt: Date.now() })
    } catch (error) {
      if (!stopped && version === generation) emit({ status: expectedRole !== 'STUDENT' && error?.code === '42501' ? 'restricted' : 'error', rows: [], updatedAt: null })
    } finally {
      if (version === generation) {
        active = null
        if (!stopped && queued) { queued = false; await refresh() }
        else if (!stopped) emit({ refreshing: false })
      }
    } })()
    return currentPromise
  }
  return { getState: () => state, setAccess, refresh, stop() { stopped = true; generation++; active?.abort(); active = null; state = emptyWorkspace() } }
}
