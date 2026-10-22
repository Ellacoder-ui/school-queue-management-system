// Approved permanent presentation map, not a claim about counter availability.
export const counterRoutes = Object.freeze([
  { number: 1, code: 'TP', name: 'Tuition Payment' },
  { number: 2, code: 'SOA', name: 'Statement of Account' },
  { number: 3, code: 'PNEP', name: 'Promissory Notes and Exam Permits' },
  { number: 4, code: 'REF', name: 'Refund Process' },
  { number: 5, code: 'ADJ', name: 'Adjustment Clerk' },
].map(Object.freeze))

export function boardCounters(state) {
  return counterRoutes.map(route => {
    // No counter_number in the public DTO: use only its known seeded label.
    // Never guess destinations from array order, a UUID or a called service code.
    const matches = state.hasSnapshot
      ? state.counters.filter(row => row.counter_label === `Counter ${route.number}`) : []
    const row = matches.length === 1 ? matches[0] : null
    const invalid = !!row?.ticket_label && (row.service_code !== route.code
      || !new RegExp(`^${route.code}-[0-9]{3,}$`).test(row.ticket_label))
    const service = state.context?.services.find(item => item.code === route.code)
    const enabled = !!service
    return { ...route, name: service?.name || route.name,
      row: invalid ? null : row, invalid: matches.length > 1 || invalid,
      enabled: state.context ? enabled : null,
      issuance_status: service?.issuance_status || (state.context ? 'SERVICE_UNAVAILABLE' : null) }
  })
}

export function boardWaiting(state) {
  return counterRoutes.map(route => ({ ...route,
    rows: state.hasSnapshot ? state.services.filter(row => row.service_code === route.code)
      .sort((a, b) => a.business_date.localeCompare(b.business_date)) : [],
  }))
}

export function manilaClock(instant) {
  const date = new Date(instant)
  return {
    time: new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', hour12: true }).format(date),
    date: new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(date),
  }
}

export const isPublicMonitorPath = path => /^\/display\/?$/.test(path)
