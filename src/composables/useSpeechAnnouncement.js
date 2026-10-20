import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const SERVICE_NAMES = {
  TP: 'Tuition Payment',
  SOA: 'Statement of Account',
  PNEP: 'Promissory Notes and Exam Permits',
  REF: 'Refund Process',
  ADJ: 'Adjustment Clerk',
}

export function useSpeechAnnouncement(getCalledTickets) {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window
  const enabled = ref(false)
  const muted = ref(false)
  const announced = ref(new Set())
  const queue = ref([])
  const speaking = ref(false)

  function speak(text) {
    if (!supported || !enabled.value || muted.value) return
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 0.9
    utterance.pitch = 1
    utterance.volume = 1
    utterance.onend = () => {
      speaking.value = false
      processQueue()
    }
    utterance.onerror = () => {
      speaking.value = false
      processQueue()
    }
    queue.value.push(utterance)
    processQueue()
  }

  function processQueue() {
    if (speaking.value || queue.value.length === 0) return
    speaking.value = true
    const next = queue.value.shift()
    window.speechSynthesis.speak(next)
  }

  function announceTicket(ticketLabel, counterNumber) {
    const key = `${ticketLabel}-${counterNumber}`
    if (announced.value.has(key)) return
    announced.value.add(key)
    const serviceCode = ticketLabel.split('-')[0]
    const serviceName = SERVICE_NAMES[serviceCode] || serviceCode
    const number = ticketLabel.split('-')[1]
    speak(`Counter ${counterNumber}. ${serviceName}. Ticket ${number}.`)
  }

  function enable() {
    if (!supported) return
    enabled.value = true
    // Resume any queued utterances
    processQueue()
  }

  function disable() {
    enabled.value = false
    if (supported) {
      window.speechSynthesis.cancel()
      queue.value = []
      speaking.value = false
    }
  }

  function toggleMute() {
    muted.value = !muted.value
    if (muted.value && supported) {
      window.speechSynthesis.cancel()
      queue.value = []
      speaking.value = false
    }
  }

  function replayLast() {
    if (!supported || !enabled.value) return
    const last = [...announced.value].pop()
    if (last) {
      const [ticketLabel, counterNumber] = last.split('-')
      // Re-announce without dedup check
      const serviceCode = ticketLabel.split('-')[0]
      const serviceName = SERVICE_NAMES[serviceCode] || serviceCode
      const number = ticketLabel.split('-')[1]
      speak(`Counter ${counterNumber}. ${serviceName}. Ticket ${number}.`)
    }
  }

  function reset() {
    announced.value = new Set()
    queue.value = []
    speaking.value = false
    if (supported) window.speechSynthesis.cancel()
  }

  onBeforeUnmount(() => {
    if (supported) window.speechSynthesis.cancel()
  })

  return {
    supported,
    enabled,
    muted,
    speaking,
    enable,
    disable,
    toggleMute,
    replayLast,
    announceTicket,
    reset,
  }
}