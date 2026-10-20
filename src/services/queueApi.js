import { adminMutations, normalizeStaffEmail, validateAdminMutation, validateAdminReceipt, validateStaffDirectory } from '../lib/adminContracts.js'
import { recordReads, validateRecordArgs, validateRecordRead } from '../lib/adminRecords.js'
const counterFields = ['counter_id', 'counter_label', 'is_open', 'ticket_label', 'service_code', 'business_date', 'updated_at']
const serviceFields = ['service_code', 'business_date', 'waiting_count', 'updated_at']
const readOperations = new Set(['my_context', 'my_tickets', 'my_ticket_events', 'staff_queue', 'admin_configuration', 'admin_staff_directory', ...recordReads])
const mutationOperations = new Set(['issue_ticket', 'call_next', 'finish_ticket', 'set_account', 'configure_counter', 'configure_service', 'manage_day', 'request_staff_access', 'add_verified_staff'])
const rejectionReasons = new Map([
  ['Current queue day is not open', 'day_closed'], ['Service unavailable', 'service_unavailable'],
  ['Active ticket already exists', 'active_ticket'], ['Daily served-ticket limit reached', 'served_quota'],
  ['Counter closed', 'counter_closed'], ['Counter busy', 'counter_busy'],
  ['Service not assigned or disabled', 'service_unavailable'], ['Queue day closed', 'day_closed'],
  ['Pending review request already exists for this email', 'staff_duplicate'], ['Invalid email', 'invalid_email'], ['Invalid role', 'invalid_role'],
])

export class QueueRequestError extends Error {
  constructor({ code, status, outcome = 'rejected', requestKey, reason = null } = {}) {
    super(outcome === 'unknown'
      ? 'The request outcome is unknown. Refresh state and retry the same action key.'
      : 'The queue request was rejected.')
    this.name = 'QueueRequestError'
    this.code = code || null
    this.status = status || null
    this.outcome = outcome
    this.requestKey = requestKey
    this.reason = reason
  }
}

const codes = new Set(['TP', 'SOA', 'PNEP', 'REF', 'ADJ'])
const isUuid = value => typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field))
export function validateOperationParameters(operation, parameters) {
  if (adminMutations.has(operation)) validateAdminMutation(operation, parameters)
  if (operation === 'issue_ticket' && (!exact(parameters, ['p_service']) || !codes.has(parameters.p_service))) throw new Error('Invalid service request.')
  if (operation === 'call_next' && (!exact(parameters, ['p_counter', 'p_service']) || !isUuid(parameters.p_counter) || !codes.has(parameters.p_service))) throw new Error('Invalid counter request.')
  if (operation === 'finish_ticket' && (!exact(parameters, ['p_ticket', 'p_action']) || !isUuid(parameters.p_ticket) || !['SERVE', 'SKIP'].includes(parameters.p_action))) throw new Error('Invalid ticket action.')
}
export function validateOperationResult(operation, result) {
  if (adminMutations.has(operation)) validateAdminReceipt(operation, result)
  if (operation === 'issue_ticket') {
    if (!exact(result, ['ticket_id', 'sequence_number', 'service', 'business_date', 'status']) || !isUuid(result.ticket_id)
      || !Number.isSafeInteger(result.sequence_number) || result.sequence_number < 1 || !codes.has(result.service)
      || !/^\d{4}-\d{2}-\d{2}$/.test(result.business_date) || result.status !== 'WAITING') throw new Error('Invalid issuance receipt.')
  } else if (operation === 'call_next') {
    if (!(exact(result, ['ticket_id']) && result.ticket_id === null)
      && !(exact(result, ['ticket_id', 'status']) && isUuid(result.ticket_id) && result.status === 'CALLED')) throw new Error('Invalid call receipt.')
  } else if (operation === 'finish_ticket') {
    if (!exact(result, ['ticket_id', 'status']) || !isUuid(result.ticket_id) || !['SERVED', 'WAITING'].includes(result.status)) throw new Error('Invalid finish receipt.')
  }
  return freeze(structuredClone(result))
}
export function validateMyContext(value) {
  if (!exact(value, ['role', 'enabled', 'cashier_counters']) || typeof value.enabled !== 'boolean'
    || !Array.isArray(value.cashier_counters)) throw new Error('Invalid account context.')
  if (!value.enabled) {
    if (value.role !== null || value.cashier_counters.length) throw new Error('Invalid disabled context.')
  } else if (!['STUDENT', 'CASHIER', 'ADMIN'].includes(value.role)
    || (value.role !== 'CASHIER' && value.cashier_counters.length)) throw new Error('Invalid role context.')
  const seen = new Set()
  for (const counter of value.cashier_counters) {
    if (!exact(counter, ['counter_id', 'counter_number', 'counter_label', 'is_open', 'service_codes'])
      || typeof counter.counter_id !== 'string' || !/^[\da-f-]{36}$/i.test(counter.counter_id)
      || seen.has(counter.counter_id) || !Number.isInteger(counter.counter_number)
      || counter.counter_number < 1 || counter.counter_number > 5 || typeof counter.counter_label !== 'string'
      || typeof counter.is_open !== 'boolean' || !Array.isArray(counter.service_codes)
      || counter.service_codes.some(code => !codes.has(code))) throw new Error('Invalid counter context.')
    seen.add(counter.counter_id)
  }
  return freeze(structuredClone(value))
}
export function validatePublicContext(value) {
  if (!exact(value, ['timezone', 'business_date', 'queue_day_open', 'services'])
    || value.timezone !== 'Asia/Manila' || !/^\d{4}-\d{2}-\d{2}$/.test(value.business_date)
    || Number.isNaN(Date.parse(value.business_date)) || typeof value.queue_day_open !== 'boolean'
    || !Array.isArray(value.services)) throw new Error('Invalid public context.')
  const seen = new Set()
  for (const service of value.services) {
    if (!exact(service, ['code', 'name']) || !codes.has(service.code) || seen.has(service.code)
      || typeof service.name !== 'string' || !service.name.trim()) throw new Error('Invalid service catalog.')
    seen.add(service.code)
  }
  return freeze(structuredClone(value))
}

function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
function snapshotRows(rows, fields, table) {
  if (!Array.isArray(rows)) throw new Error('Invalid public queue response.')
  return rows.map(row => {
    const selected = Object.fromEntries(fields.map(field => [field, row[field]]))
    if (table === 'counter_state') {
      if (typeof selected.counter_id !== 'string' || typeof selected.counter_label !== 'string' ||
          typeof selected.is_open !== 'boolean' || !(selected.ticket_label === null || typeof selected.ticket_label === 'string')) {
        throw new Error('Invalid public counter response.')
      }
    } else if (!Number.isSafeInteger(selected.waiting_count) || selected.waiting_count < 0 ||
        typeof selected.business_date !== 'string' || typeof selected.service_code !== 'string') {
      throw new Error('Invalid public service response.')
    }
    return selected
  })
}

export function createQueueApi(client, publicClient = client) {
  const authorizationListeners = new Set()
  const staffPermissionDenied = new Set()
  async function rpc(operation, parameters, { signal, requestKey, expectedActor } = {}) {
    try {
      let request = client.schema('queue_api').rpc(operation, parameters)
      // A write with an uncertain outcome must wait for explicit same-key replay.
      if (mutationOperations.has(operation) && typeof request.retry === 'function') request = request.retry(false)
      if (expectedActor) {
        const session = await client.auth.getSession()
        const token = session.data?.session?.access_token
        let subject
        try { subject = JSON.parse(atob(token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/'))).sub } catch {}
        if (session.error || !isUuid(expectedActor) || subject !== expectedActor || session.data?.session?.user?.id !== expectedActor) {
          throw new QueueRequestError({ code: '42501', status: 403, reason: 'unauthorized', requestKey })
        }
        // Pin this request to the verified actor even if another tab switches accounts.
        request = request.setHeader('Authorization', `Bearer ${token}`)
      }
      if (signal) request = request.abortSignal(signal)
      const { data, error, status } = await request
      if (error) {
        const staffDenial = (['staff_queue','admin_configuration','admin_staff_directory'].includes(operation) || recordReads.has(operation)) && error.code === '42501' && status === 403
        const repeatedStaffDenial = staffDenial && staffPermissionDenied.has(operation)
        if (staffDenial) staffPermissionDenied.add(operation)
        if (operation !== 'my_context' && !repeatedStaffDenial && (error.code === '42501' || status === 401 || status === 403)) {
          for (const listener of authorizationListeners) { try { listener() } catch {} }
        }
        const ambiguous = signal?.aborted || !error.code || !status || status >= 500 || status === 408
        throw new QueueRequestError({ code: error.code, status, outcome: ambiguous ? 'unknown' : 'rejected', requestKey,
          reason: rejectionReasons.get(error.message) || (error.code === '42501' || status === 401 || status === 403 ? 'unauthorized' : null) })
      }
      staffPermissionDenied.delete(operation)
      return data
    } catch (error) {
      if (error instanceof QueueRequestError) throw error
      throw new QueueRequestError({ outcome: 'unknown', requestKey })
    }
  }

  return {
    onAuthorizationDenied(listener) {
      authorizationListeners.add(listener)
      return () => authorizationListeners.delete(listener)
    },
    read(operation, parameters = {}, options = {}) {
      if (!readOperations.has(operation)) throw new Error('Unsupported queue read operation.')
      if (recordReads.has(operation)) { validateRecordArgs(operation, parameters); return rpc(operation, parameters, options).then(value=>validateRecordRead(operation,parameters,value)) }
      const result = rpc(operation, parameters, options)
      return operation === 'my_context' ? result.then(validateMyContext) : operation === 'admin_staff_directory' ? result.then(validateStaffDirectory) : result
    },
    async readMyContext(options = {}) {
      return validateMyContext(await rpc('my_context', {}, options))
    },
    async readPublicContext({ signal } = {}) {
      let request = publicClient.schema('queue_display').rpc('public_queue_context')
      if (signal) request = request.abortSignal(signal)
      const { data, error } = await request
      if (error) throw new Error('Public context unavailable.')
      return validatePublicContext(data)
    },
    // Preparation is explicit. Execution never generates or changes the key.
    createMutationIntent(operation, parameters = {}) {
      if (!mutationOperations.has(operation) || Object.hasOwn(parameters, 'p_request_key')) {
        throw new Error('Unsupported action or caller-supplied request key.')
      }
      if (operation === 'request_staff_access') parameters = { ...parameters, p_email: normalizeStaffEmail(parameters.p_email) }
      validateOperationParameters(operation, parameters)
      return freeze({ operation, parameters: { ...structuredClone(parameters), p_request_key: crypto.randomUUID() } })
    },
    executeMutation(intent, options = {}) {
      if (!mutationOperations.has(intent?.operation) || !intent.parameters?.p_request_key) {
        throw new Error('Prepare an action before executing it.')
      }
      const { p_request_key, ...parameters } = intent.parameters
      validateOperationParameters(intent.operation, parameters)
      if (!isUuid(p_request_key)) throw new Error('Invalid request key.')
      // Local intent UUID is a browser journal identifier, not backend idempotency.
      const wire = intent.operation === 'request_staff_access' ? parameters : intent.parameters
      return rpc(intent.operation, wire, { ...options, requestKey: p_request_key }).then(result => {
        try { return validateOperationResult(intent.operation, result) }
        catch { throw new QueueRequestError({ outcome: 'unknown', requestKey: p_request_key }) }
      })
    },
    async readPublicSnapshot({ signal } = {}) {
      const controller = new AbortController()
      const abort = () => controller.abort()
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) controller.abort()
      const timeout = setTimeout(abort, 12000)
      try {
        const results = await Promise.all([
          publicClient.schema('queue_display').from('counter_state').select(counterFields.join(','), { count: 'exact' })
            .order('counter_label').abortSignal(controller.signal),
          publicClient.schema('queue_display').from('service_state').select(serviceFields.join(','), { count: 'exact' })
            .order('business_date').order('service_code').abortSignal(controller.signal),
          publicClient.schema('queue_display').rpc('public_queue_context').abortSignal(controller.signal),
        ])
        if (results.some(result => result.error)) throw new Error('Public snapshot unavailable.')
        if (results.some(result => Number.isInteger(result.count) && result.count > result.data?.length)) {
          throw new Error('Public snapshot was truncated; partial totals are not displayed.')
        }
        return { counters: snapshotRows(results[0].data, counterFields, 'counter_state'),
          services: snapshotRows(results[1].data, serviceFields, 'service_state'), context: validatePublicContext(results[2].data) }
      } finally {
        clearTimeout(timeout)
        signal?.removeEventListener('abort', abort)
      }
    },
    subscribePublicDisplay({ onReady, onDisconnect, onInvalidate }) {
      let disposed = false
      let allReady = false
      const ready = new Set()
      const channels = []
      const markDisconnected = table => {
        if (disposed) return
        ready.delete(table)
        allReady = false
        onDisconnect()
      }
      const timer = setTimeout(() => { if (!disposed && !allReady) onDisconnect() }, 15000)
      try {
        for (const table of ['counter_state', 'service_state']) {
          const channel = publicClient.channel(`public-queue-${table}-${crypto.randomUUID()}`)
          channels.push(channel)
          channel.on('system', {}, payload => {
            if (disposed || payload.extension !== 'postgres_changes') return
            if (payload.status !== 'ok') { markDisconnected(table); return }
            ready.add(table)
            if (ready.size === 2 && !allReady) {
              allReady = true
              clearTimeout(timer)
              onReady()
            }
          })
          .on('postgres_changes', { event: '*', schema: 'queue_display', table }, () => {
            if (!disposed) onInvalidate()
          })
          .subscribe(status => {
            if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) markDisconnected(table)
          })
        }
      } catch {
        disposed = true
        clearTimeout(timer)
        void Promise.allSettled(channels.map(channel => publicClient.removeChannel(channel)))
        throw new Error('Public subscription unavailable.')
      }
      return async () => {
        disposed = true
        clearTimeout(timer)
        await Promise.allSettled(channels.map(channel => publicClient.removeChannel(channel)))
      }
    },
  }
}
