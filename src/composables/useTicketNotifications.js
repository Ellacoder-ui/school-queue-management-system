import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const STORAGE_KEY = 'cqs-notified-tickets-v1'

export function useTicketNotifications(getTickets) {
  const supported = typeof window !== 'undefined' && 'Notification' in window
  const permission = ref(supported ? Notification.permission : 'denied')
  // Browser permission must have been granted already. Never prompt without
  // a user gesture; visual queue updates remain available either way.
  const enabled = ref(supported && Notification.permission === 'granted')
  const notified = ref(new Set())
  let previousStatuses = null

  // Load previously notified ticket IDs from localStorage
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (Array.isArray(saved)) notified.value = new Set(saved)
  } catch {}

  function saveNotified() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...notified.value])) } catch {}
  }

  async function requestPermission() {
    if (!supported) return false
    try {
      const result = await Notification.requestPermission()
      permission.value = result
      if (result === 'granted') {
        enabled.value = true
        return true
      }
      return false
    } catch {
      return false
    }
  }

  function enable() {
    if (!supported) return
    if (permission.value === 'granted') {
      enabled.value = true
    } else {
      requestPermission().then(ok => { if (ok) enabled.value = true })
    }
  }

  function disable() {
    enabled.value = false
  }

  function notify(title, body, tag) {
    if (!supported || !enabled.value || permission.value !== 'granted') return
    try {
      const n = new Notification(title, { body, tag, icon: '/favicon.ico' })
      n.onclick = () => { window.focus(); n.close() }
    } catch {}
  }

  function checkTickets(tickets) {
    if (!Array.isArray(tickets)) return
    const current = new Map(tickets.filter(ticket => ticket?.id).map(ticket => [ticket.id, ticket.status]))
    if (previousStatuses === null) { previousStatuses = current; return }
    if (!enabled.value) { previousStatuses = current; return }
    for (const ticket of tickets) {
      if (!ticket?.id || ticket.status !== 'CALLED' || previousStatuses.get(ticket.id) !== 'WAITING') continue
      const key = `${ticket.id}-CALLED`
      if (notified.value.has(key)) continue
      notified.value.add(key)
      saveNotified()

      const label = `${ticket.service}-${String(ticket.number).padStart(3, '0')}`
      notify('Ticket Called', `Your ticket ${label} is being called. Please proceed to your counter.`, key)
    }
    previousStatuses = current
  }

  // Watch for ticket changes
  watch(() => getTickets(), (tickets) => {
    checkTickets(tickets)
  }, { deep: true })

  onBeforeUnmount(() => {
    // Don't clear notified set — persist across sessions
  })

  return {
    supported,
    permission,
    enabled,
    requestPermission,
    enable,
    disable,
    notify,
  }
}
