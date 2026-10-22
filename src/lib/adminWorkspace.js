// Staff mutations are additionally restricted to the identity-bound owner in the database.
// Pending-intent storage holds only operation arguments/IDs, never Auth material.
import { validateOperationParameters, QueueRequestError } from '../services/queueApi.js'
import { validateAdminMutation, validateAdminReceipt, validateInstalledStaff, mutationCanReplay } from './adminContracts.js'
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)
const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(value))
const roles = ['STUDENT', 'CASHIER', 'ADMIN']
const supported = new Set(['set_account', 'set_staff_access', 'configure_counter', 'remove_ineligible_counter_assignment', 'request_staff_access', 'add_verified_staff', 'assign_staff_by_email', 'manage_pending_staff'])
export const emptyAdmin = () => ({ status: 'idle', data: null, actor: null, busy: false, refreshing: false, phase: 'idle', message: null, result: null, operation: null, canRetry: false })
export function validateAdminWorkspace(value, expectedDate) {
  if (value?.version !== 8 || value.date !== expectedDate || !date(value.date) || !value.configuration
    || !Array.isArray(value.directory) || value.directory.length > 500 || !Array.isArray(value.requests)
    || value.requests.length > 100 || !Array.isArray(value.history) || value.history.length > 500
    || typeof value.history_more !== 'boolean' || !Array.isArray(value.usage) || value.usage.length !== 5) throw new Error('Invalid admin response')
  const c = value.configuration, seen = new Set()
  for (const key of ['accounts', 'services', 'counters', 'counter_services', 'staff_assignments', 'days']) if (!Array.isArray(c[key])) throw new Error('Invalid configuration')
  if (c.counters.length !== 5 || c.services.length !== 5 || c.counter_services.length !== 5) throw new Error('Incomplete routing')
  const codes = ['TP', 'SOA', 'PNEP', 'REF', 'ADJ']
  for (const counter of c.counters) {
    const service = c.services.find(s => s.code === codes[counter.number - 1])
    if (!uuid(counter.id) || seen.has(counter.number) || !service || !uuid(service.id) || typeof counter.is_open !== 'boolean'
      || !c.counter_services.some(x => x.counter_id === counter.id && x.service_id === service.id)) throw new Error('Invalid fixed route')
    seen.add(counter.number)
  }
  seen.clear()
  for (const row of value.directory) {
    if (!uuid(row.id) || seen.has(row.id) || !roles.includes(row.role) || typeof row.enabled !== 'boolean'
      || !(row.email === null || typeof row.email === 'string' && row.email.length <= 254)
      || !(row.identity_sha256 === null || /^[0-9a-f]{64}$/.test(row.identity_sha256))
      || !Number.isSafeInteger(row.verified_factors) || row.verified_factors < 0 || !Array.isArray(row.approvals)
      || row.approvals.some(a => !['ADMIN', 'CASHIER'].includes(a.role) || !Number.isFinite(Date.parse(a.expires_at)))) throw new Error('Invalid directory')
    seen.add(row.id)
  }
  for (const key of ['total', 'waiting', 'called', 'served', 'forfeited']) if (!Number.isSafeInteger(value.metrics?.[key]) || value.metrics[key] < 0) throw new Error('Invalid metric')
  if (value.metrics.total !== ['waiting', 'called', 'served', 'forfeited'].reduce((n, k) => n + value.metrics[k], 0)) throw new Error('Invalid totals')
  if (new Set(value.usage.map(row => row.service)).size !== 5 || value.usage.some(row => !codes.includes(row.service) || !Number.isSafeInteger(row.total) || row.total < 0)) throw new Error('Invalid usage')
  for (const row of value.history) if (!uuid(row.ticket_id) || !codes.includes(row.service) || !Number.isSafeInteger(row.number) || row.number < 1 || !['WAITING', 'CALLED', 'SERVED', 'FORFEITED'].includes(row.status) || row.business_date !== expectedDate) throw new Error('Invalid history')
  for (const row of value.requests) if (!uuid(row.id) || typeof row.email !== 'string' || !['ADMIN', 'CASHIER'].includes(row.role)
    || !['PENDING_IDENTITY_REVIEW', 'BOUND_REVIEW_REQUIRED', 'EXPIRED', 'REVOKED'].includes(row.status)) throw new Error('Invalid request')
  return structuredClone(value)
}
export function parseAdminIntent(text, actor) {
  const record = JSON.parse(text)
  if (record?.version !== 1 || record.actor !== actor || !uuid(actor) || !supported.has(record.intent?.operation) || !uuid(record.intent?.parameters?.p_request_key)) throw new Error('Invalid admin intent')
  const { p_request_key, ...args } = record.intent.parameters
  validateAdminMutation(record.intent.operation, args)
  validateOperationParameters(record.intent.operation, args)
  return record
}
export function createAdminWorkspace(api, { getAccess, store, withLock, onState = () => {}, afterWrite = async () => {}, contract = 'versioned' } = {}) {
  let state = emptyAdmin(), generation = 0, accessGeneration = 0, controller, readPromise, stopped = false, running = false, reportDate = null
  const emit = patch => { if (!stopped) { state = { ...state, ...patch }; onState(state) } }
  const access = () => { const x = getAccess(); return x?.context?.enabled && x.context.role === 'ADMIN' && uuid(x.actor) ? x : null }
  const key = actor => `cqs-admin-intent-v1:${actor}`
  const saved = actor => { const text = store.getItem(key(actor)); return text ? parseAdminIntent(text, actor) : null }
  const unknown = intent => {
    if (!intent || !supported.has(intent.operation)) { emit({ phase:'blocked', result:null, canRetry:false, message:'Saved management action cannot be reconciled safely.' }); return }
    emit({ phase: 'unknown', result: null, operation: intent.operation, canRetry: mutationCanReplay(intent.operation),
      message: mutationCanReplay(intent.operation) ? 'A management action is unconfirmed. Explicitly reconcile the same request before another change.'
        : 'The staff review request outcome is unknown. Do not submit it again until its status is checked.' })
  }
  function pending(actor) {
    try { const record = saved(actor); if (record) unknown(record.intent) }
    catch { emit({ phase: 'blocked', message: 'Saved management action cannot be verified. Refresh current state before trying again.' }) }
  }
  async function readAdministration(actor, signal, selectedDate = reportDate, scope = 'all') {
    if (contract === 'installed-directory') {
      if (state.data && scope !== 'all') {
        const part = await api.read(scope === 'directory' ? 'admin_staff_directory' : 'admin_configuration', {}, { signal, expectedActor:actor })
        try { return validateInstalledStaff(scope === 'directory' ? state.data.configuration : part, scope === 'directory' ? part : state.data.directory) }
        catch { /* Concurrent account/configuration changes require one consistent full pair. */ }
      }
      const [configuration, directory] = await Promise.all([
        api.read('admin_configuration', {}, { signal, expectedActor: actor }),
        api.read('admin_staff_directory', {}, { signal, expectedActor: actor }),
      ])
      return validateInstalledStaff(configuration, directory)
    }
    return validateAdminWorkspace(await api.read('admin_workspace', { p_date: selectedDate }, { signal, expectedActor: actor }), selectedDate)
  }
  function refresh(selectedDate = reportDate, { background = true, force = false, scope = 'all' } = {}) {
    reportDate = selectedDate
    const actor = access()?.actor
    if (!actor || contract !== 'installed-directory' && !date(selectedDate) || stopped) return Promise.resolve()
    if (readPromise && !force) return readPromise
    const version = ++generation
    controller?.abort(); controller = new AbortController()
    const abort = controller, timer = setTimeout(() => abort.abort(), 12000)
    if (!background || state.status !== 'ready') emit({ status: 'loading', data: null, actor, refreshing:true })
    else emit({ refreshing:true })
    const task = (async () => { try {
      const value = await readAdministration(actor, abort.signal, selectedDate, scope)
      if (stopped || version !== generation || access()?.actor !== actor || abort.signal.aborted) return
      emit({ status: 'ready', data: value })
    } catch (error) {
      if (!stopped && version === generation) emit({ status: error.code === '42501' ? 'restricted' : ['PGRST202', '42883'].includes(error.code) ? 'unavailable' : 'error', data: null })
    } finally { clearTimeout(timer); if (controller===abort) { readPromise=null; emit({refreshing:false}) } } })()
    readPromise=task
    return task
  }
  function syncAccess(selectedDate = reportDate) {
    accessGeneration++; generation++; controller?.abort(); readPromise=null
    const actor = access()?.actor
    emit({ ...emptyAdmin(), busy: running, actor: actor || null })
    if (actor) { pending(actor); void refresh(selectedDate) }
  }
  function receiptMatches(intent, value) {
    const p = intent.parameters
    if (intent.operation === 'add_verified_staff') return value.user===p.p_user && value.role===p.p_role && value.enabled===true && value.counter===p.p_counter
    if (intent.operation === 'assign_staff_by_email') return value.email===p.p_email && value.role===p.p_role && value.counter===p.p_counter
      && (value.status==='ASSIGNED'&&uuid(value.user)||value.status==='PENDING_FIRST_LOGIN'&&uuid(value.invitation))
    if (intent.operation === 'manage_pending_staff') return value.invitation===p.p_invitation
      && (p.p_action==='CANCEL' ? value.status==='CANCELLED'
        : value.email===p.p_email&&value.role===p.p_role&&value.counter===p.p_counter&&value.status==='PENDING_FIRST_LOGIN')
    if (intent.operation === 'set_account') return value.user === p.p_user && value.role === p.p_role && value.enabled === p.p_enabled
    if (intent.operation === 'set_staff_access') return value.user === p.p_user && value.role === p.p_role && value.enabled === p.p_enabled && value.counter === p.p_counter
    if (intent.operation === 'configure_counter') return value.counter === p.p_counter && value.open === p.p_open && JSON.stringify(value.services) === JSON.stringify(p.p_services) && JSON.stringify(value.cashiers) === JSON.stringify(p.p_cashiers)
    if (intent.operation === 'remove_ineligible_counter_assignment') return value.counter === p.p_counter && value.user === p.p_user && value.removed === true
    return uuid(value.request_id) && value.status === 'PENDING_IDENTITY_REVIEW'
  }
  async function perform(operation, args, retry = false) {
    const actor = access()?.actor
    if (!actor || stopped || running || state.phase === 'blocked' || contract !== 'installed-directory' && !date(reportDate) || !retry && (state.status !== 'ready' || ['unknown', 'pending'].includes(state.phase))) return
    running = true; const version = accessGeneration
    let intent, sent = false, confirmed = false
    emit({ busy: true, phase: 'pending', result: null, operation, canRetry: false, message: 'Checking current administrator authorization…' })
    try {
      await withLock(async () => {
        const prior = saved(actor)
        intent = prior?.intent
        if (!retry && prior) { pending(actor); return }
        if (retry && !prior) throw new Error('Missing intent')
        if (retry && !mutationCanReplay(prior.intent.operation)) { unknown(prior.intent); return }
        const context = await api.readMyContext({ expectedActor: actor })
        if (!context.enabled || context.role !== 'ADMIN') throw new QueueRequestError({ code: '42501' })
        await readAdministration(actor)
        if (stopped || access()?.actor !== actor || version !== accessGeneration) return
        if (!retry) validateAdminMutation(operation, args)
        intent = retry ? prior.intent : api.createMutationIntent(operation, args)
        if (!supported.has(intent.operation)) throw new Error('Unsupported action')
        if (!retry) {
          const text = JSON.stringify({ version: 1, actor, intent })
          store.setItem(key(actor), text)
          if (store.getItem(key(actor)) !== text) throw new Error('Journal unavailable')
        }
        sent = true
        const value = await api.executeMutation(intent, { expectedActor: actor })
        validateAdminReceipt(intent.operation, value)
        if (!receiptMatches(intent, value)) throw new QueueRequestError({ outcome: 'unknown' })
        store.removeItem(key(actor))
        if (store.getItem(key(actor))) throw new Error('Journal not cleared')
        confirmed = true
        if (access()?.actor === actor && version === accessGeneration) emit({ phase: 'success', result: value, operation: intent.operation, canRetry: false, message: intent.operation === 'request_staff_access'
          ? 'Staff review request recorded. No email, Auth account, approval or role was created.'
          : intent.operation==='assign_staff_by_email' ? 'Staff added successfully.'
          : intent.operation==='manage_pending_staff' ? value.status==='CANCELLED'
            ? 'Pending staff assignment cancelled.' : 'Pending staff assignment updated.'
          : intent.operation==='set_staff_access' ? 'Staff changes saved successfully.'
          : intent.operation==='remove_ineligible_counter_assignment' ? 'Ineligible counter assignment removed. Account role and history were preserved.'
          : 'The database confirmed the change. Current state is refreshing.' })
      })
    } catch (error) {
      if (!stopped && access()?.actor === actor) {
        if (retry || sent && (!(error instanceof QueueRequestError) || error.outcome === 'unknown')) unknown(intent)
        else {
          try { if (intent) store.removeItem(key(actor)) } catch { emit({ phase: 'blocked', message: 'Action state could not be saved. Refresh current state before trying again.' }); return }
          const messages = { staff_duplicate: 'A pending assignment already exists for this email. Review the existing pending assignment before making another.',
            invalid_email: 'Enter a valid staff email address.', invalid_role: 'Choose CASHIER or ADMIN for a review request.' }
          emit({ phase: 'error', result: null, message: messages[error.reason] || (error.code === '42501' || error.status === 401 || error.status === 403 ? 'Current administrator authorization is insufficient. Refresh your access before another change.'
            : error.status === 429 ? 'Too many requests. Wait before another explicit submission.' : 'The server did not accept the change. Refresh and review its current database state.') })
        }
      }
    } finally {
      if (!stopped && access()?.actor === actor) {
        await refresh(reportDate, {force:true,scope:confirmed ? intent.operation==='request_staff_access' ? 'directory' : ['configure_counter','remove_ineligible_counter_assignment'].includes(intent.operation) ? 'configuration' : 'all' : 'all'})
        if (confirmed && intent.operation==='add_verified_staff' && version===accessGeneration) {
          const p=intent.parameters, row=state.data?.directory.find(x=>x.id===p.p_user)
          const matches=state.status==='ready' && row?.enabled && row.role===p.p_role && (p.p_role==='ADMIN' || state.data.configuration.staff_assignments.some(x=>x.account_id===p.p_user&&x.counter_id===p.p_counter))
          emit({message:matches?'Staff added successfully. Current database role and assignment verified.':'The transaction was confirmed, but current role/assignment verification is incomplete. Review current state before another change.'})
        }
        if (sent) try { await afterWrite(intent.operation, {confirmed}) } catch {}
      }
      running = false; emit({ busy: false })
    }
  }
  return { getState: () => state, syncAccess, refresh, perform, retry: () => perform(null, null, true),
    stop() { stopped = true; accessGeneration++; generation++; controller?.abort(); state = emptyAdmin() } }
}
