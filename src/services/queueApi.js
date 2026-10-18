const counterFields = ['counter_id', 'counter_label', 'is_open', 'ticket_label', 'service_code', 'business_date', 'updated_at']
const serviceFields = ['service_code', 'business_date', 'waiting_count', 'updated_at']
const readOperations = new Set(['my_context', 'my_tickets', 'my_ticket_events', 'staff_queue', 'admin_configuration'])
const mutationOperations = new Set(['call_next', 'finish_ticket', 'set_account', 'configure_counter', 'configure_service', 'manage_day'])

export class QueueRequestError extends Error {
  constructor({ code, status, outcome = 'rejected', requestKey } = {}) {
    super(outcome === 'unknown'
      ? 'The request outcome is unknown. Refresh state and retry the same action key.'
      : 'The queue request was rejected.')
    this.name = 'QueueRequestError'
    this.code = code || null
    this.status = status || null
    this.outcome = outcome
    this.requestKey = requestKey
  }
}

const codes = new Set(['TP', 'SOA', 'PNEP', 'REF', 'ADJ'])
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field))
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
  async function rpc(operation, parameters, { signal, requestKey } = {}) {
    try {
      let request = client.schema('queue_api').rpc(operation, parameters)
      if (signal) request = request.abortSignal(signal)
      const { data, error, status } = await request
      if (error) {
        if (operation !== 'my_context' && (error.code === '42501' || status === 401 || status === 403)) {
          for (const listener of authorizationListeners) { try { listener() } catch {} }
        }
        const ambiguous = signal?.aborted || !error.code || !status || status >= 500 || status === 408
        throw new QueueRequestError({ code: error.code, status, outcome: ambiguous ? 'unknown' : 'rejected', requestKey })
      }
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
      const result = rpc(operation, parameters, options)
      return operation === 'my_context' ? result.then(validateMyContext) : result
    },
    async readMyContext({ signal } = {}) {
      return validateMyContext(await rpc('my_context', {}, { signal }))
    },
    async readPublicContext({ signal } = {}) {
      let request = publicClient.schema('queue_display').rpc('public_queue_context')
      if (signal) request = request.abortSignal(signal)
      const { data, error } = await request
      if (error) throw new Error('Public context unavailable.')
      return validatePublicContext(data)
    },
    // Preparation is explicit. Execution never generates or changes the key.
    // issue_ticket is intentionally absent until its HTTP validation is complete.
    createMutationIntent(operation, parameters = {}) {
      if (!mutationOperations.has(operation) || Object.hasOwn(parameters, 'p_request_key')) {
        throw new Error('Unsupported action or caller-supplied request key.')
      }
      return freeze({ operation, parameters: { ...structuredClone(parameters), p_request_key: crypto.randomUUID() } })
    },
    executeMutation(intent, options = {}) {
      if (!mutationOperations.has(intent?.operation) || !intent.parameters?.p_request_key) {
        throw new Error('Prepare an action before executing it.')
      }
      return rpc(intent.operation, intent.parameters, { ...options, requestKey: intent.parameters.p_request_key })
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
