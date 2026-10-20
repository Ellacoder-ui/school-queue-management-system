import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const STORAGE_KEY = 'cqs-notified-tickets-v1'

export function useTicketNotifications(getTickets) {
  const supported = typeof window !== 'undefined' && 'Notification' in window
  const permission = ref(supported ? Notification.permission : 'denied')
  const enabled = ref(false)
  const notified = ref(new Set())

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
    if (!enabled.value || !Array.isArray(tickets)) return
    for (const ticket of tickets) {
      if (!ticket || !ticket.id) continue
      const key = `${ticket.id}-${ticket.status}`
      if (notified.value.has(key)) continue
      notified.value.add(key)
      saveNotified()

      const label = `${ticket.service}-${String(ticket.number).padStart(3, '0')}`
      switch (ticket.status) {
        case 'WAITING':
          notify('Ticket Issued', `Your ticket ${label} is in the queue.`, key)
          break
        case 'CALLED':
          notify('Ticket Called', `Your ticket ${label} is being called. Please proceed to your counter.`, key)
          break
        case 'SERVED':
          notify('Ticket Served', `Your ticket ${label} has been served.`, key)
          break
        case 'FORFEITED':
          notify('Ticket Forfeited', `Your ticket ${label} was forfeited.`, key)
          break
      }
    }
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