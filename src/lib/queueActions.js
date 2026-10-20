import { QueueRequestError, validateOperationParameters } from '../services/queueApi.js'
import { counterRoutes } from './publicBoard.js'
import { activeTicket } from './workspaceData.js'

const supported = new Set(['issue_ticket', 'call_next', 'finish_ticket'])
const messages = {
  day_closed: 'The queue day is closed. Refresh the queue before trying again.',
  service_unavailable: 'This service is unavailable. Refresh its availability.',
  active_ticket: 'You already have an active ticket. Check your ticket first.',
  served_quota: 'You have reached two served tickets for this service on its issuance day.',
  counter_closed: 'This counter is closed. Refresh your assignment.',
  counter_busy: 'This counter already has a called ticket. Refresh the queue.',
  unauthorized: 'Your current account is not authorized for this action. Refresh access.',
}
const initial = () => ({ phase: 'idle', message: null, operation: null, result: null, busy: false })
const uuid = value => typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)
const journalKey = actor => `cqs-queue-intent-v1:${actor}`
const unavailable = reason => { throw new QueueRequestError({ reason, outcome: 'rejected' }) }
export function parseActionJournal(text, actor) {
  const value = JSON.parse(text)
  if (!value || value.version !== 1 || value.actor !== actor || !uuid(actor) || !supported.has(value.intent?.operation)
    || !uuid(value.intent.parameters?.p_request_key) || !/^\d{4}-\d{2}-\d{2}$/.test(value.businessDate)) throw new Error('Invalid operation journal')
  const { p_request_key, ...parameters } = value.intent.parameters
  validateOperationParameters(value.intent.operation, parameters)
  return Object.freeze({ ...value, intent: Object.freeze({ operation: value.intent.operation, parameters: Object.freeze({ ...parameters, p_request_key }) }) })
}

// Storage contains only the actor/operation identifiers and immutable request key.
// No tokens, credentials or queue rows. Unconfirmed intents never expire silently.
export function createQueueActions(api, { getAccess, store, withLock, online = () => true, onState = () => {}, afterOperation = () => {}, onAuthorizationChanged = () => {} }) {
  let state = initial(), generation = 0, busy = false, stopped = false, abort
  const emit = patch => { if (!stopped) { state = { ...state, ...patch }; onState(state) } }
  const access = () => { const value = getAccess(); return value && uuid(value.actor) && ['STUDENT', 'CASHIER'].includes(value.context?.role) && value.context.enabled ? value : null }
  const read = actor => { const text = store.getItem(journalKey(actor)); return text ? parseActionJournal(text, actor) : null }
  const uncertain = journal => emit({ phase: 'unknown', operation: journal.intent.operation, result: null,
    message: 'This operation is unconfirmed. Refresh the queue, then explicitly check or retry the same action. Do not start another operation.' })
  function syncAccess() {
    const next = access()?.actor || null
    generation++; abort?.abort()
    emit({ ...initial(), busy })
    if (!next) return
    try { const saved = read(next); if (saved) uncertain(saved) }
    catch { emit({ phase: 'blocked', message: 'Saved operation details could not be verified. Operations are locked; ask for assistance.' }) }
  }
  async function authorize(actor, operation, parameters, signal, retry) {
    const context = await api.readMyContext({ signal, expectedActor: actor })
    if (!context.enabled || context.role !== (operation === 'issue_ticket' ? 'STUDENT' : 'CASHIER')) unavailable('unauthorized')
    const day = await api.readPublicContext({ signal })
    if (retry) return day.business_date
    if (operation === 'issue_ticket') {
      if (!day.queue_day_open) unavailable('day_closed')
      if (!day.services.some(service => service.code === parameters.p_service)) unavailable('service_unavailable')
      const tickets = await api.read('my_tickets', {}, { signal, expectedActor: actor })
      if (!Array.isArray(tickets)) unavailable()
      if (activeTicket(tickets)) unavailable('active_ticket')
      if (tickets.filter(row => row.service === parameters.p_service && row.business_date === day.business_date && row.status === 'SERVED').length >= 2) unavailable('served_quota')
    } else if (operation === 'call_next') {
      const counter = context.cashier_counters.find(row => row.counter_id === parameters.p_counter)
      const fixed = counterRoutes.find(row => row.number === counter?.counter_number)
      if (!counter || fixed?.code !== parameters.p_service || !counter.service_codes.includes(parameters.p_service)) unavailable('unauthorized')
      if (!counter.is_open) unavailable('counter_closed')
      const rows = await api.read('staff_queue', {}, { signal, expectedActor: actor })
      if (rows.some(row => row.counter_id === parameters.p_counter && row.status === 'CALLED')) unavailable('counter_busy')
    } else {
      const rows = await api.read('staff_queue', {}, { signal, expectedActor: actor })
      const ticket = rows.find(row => row.ticket_id === parameters.p_ticket && row.status === 'CALLED')
      if (!ticket || !context.cashier_counters.some(row => row.counter_id === ticket.counter_id)) unavailable('unauthorized')
    }
    return day.business_date
  }
  async function perform(operation, parameters, retry = false) {
    if (busy || stopped || state.phase === 'blocked' || !online() || !access()) return
    if (!retry && ['unknown', 'pending'].includes(state.phase)) return
    if (!supported.has(operation) && !retry) return
    busy = true
    const scope = access(), actor = scope.actor, version = generation
    abort = new AbortController()
    let journal, sent = false
    emit({ phase: 'pending', busy: true, message: retry ? 'Checking the same operation…' : 'Confirming current access and queue state…', result: null, operation })
    try {
      await withLock(async () => {
        journal = read(actor)
        if (journal && !retry) { if (version === generation) uncertain(journal); return }
        if (retry && !journal) throw new Error('Missing operation journal')
        const op = retry ? journal.intent.operation : operation
        const args = retry ? journal.intent.parameters : parameters
        const date = await authorize(actor, op, args, abort.signal, retry)
        if (access()?.actor !== actor || version !== generation || abort.signal.aborted) return
        if (retry && op !== 'finish_ticket' && date !== journal.businessDate) {
          uncertain(journal); emit({ message: 'The unconfirmed action belongs to an earlier queue date. Review it with staff before issuing or calling another ticket.' }); return
        }
        if (!retry) {
          journal = { version: 1, actor, businessDate: date, intent: api.createMutationIntent(op, parameters) }
          const text = JSON.stringify(journal)
          store.setItem(journalKey(actor), text)
          if (store.getItem(journalKey(actor)) !== text) throw new Error('Operation could not be saved')
        }
        sent = true
        const result = await api.executeMutation(journal.intent, { signal: abort.signal, expectedActor: actor })
        if (op === 'issue_ticket' && result.service !== journal.intent.parameters.p_service
          || op === 'finish_ticket' && (result.ticket_id !== journal.intent.parameters.p_ticket || result.status !== (journal.intent.parameters.p_action === 'SERVE' ? 'SERVED' : 'WAITING'))) throw new QueueRequestError({ outcome: 'unknown' })
        store.removeItem(journalKey(actor))
        if (store.getItem(journalKey(actor))) throw new Error('Operation receipt could not be cleared')
        if (version === generation && access()?.actor === actor) emit({ phase: 'success', operation: op, result,
          message: op === 'issue_ticket' ? 'Your ticket was issued. Your ticket list is refreshing.' : op === 'call_next'
            ? result.ticket_id ? 'Ticket called. The queue is refreshing.' : 'No waiting ticket was available. Nothing was called.'
            : result.status === 'SERVED' ? 'Ticket marked served. Call Next is a separate action.' : 'Ticket returned to the waiting tail with its original number.' })
      })
    } catch (error) {
      const previousUnknown = retry && !!journal
      if (version === generation && access()?.actor === actor) {
        if (journal && (previousUnknown || sent && (!(error instanceof QueueRequestError) || error.outcome === 'unknown'))) uncertain(journal)
        else {
          try { if (journal) store.removeItem(journalKey(actor)) }
          catch { emit({ phase: 'blocked', message: 'Operation storage is unavailable. Ask for assistance before another action.' }); return }
          emit({ phase: 'error', result: null, message: messages[error.reason] || 'The action was not accepted. Refresh your queue and access before trying again.' })
        }
      }
      if (error.reason === 'unauthorized') onAuthorizationChanged()
    } finally {
      if (!stopped && access()?.actor === actor) {
        try { await afterOperation() } catch {}
      }
      busy = false; abort = null
      // Do not re-enable a second operation until authoritative post-reads settle.
      if (!stopped) { if (version !== generation || state.phase === 'pending') syncAccess(); else emit({ busy: false }) }
    }
  }
  return { getState: () => state, syncAccess, perform, retry: () => perform(null, null, true),
    clearMessage() { if (!busy && !['pending', 'unknown', 'blocked'].includes(state.phase)) emit(initial()) },
    stop() { stopped = true; generation++; abort?.abort(); state = initial() } }
}
