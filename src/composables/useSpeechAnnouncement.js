import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const digits = { '0':'zero', '1':'one', '2':'two', '3':'three', '4':'four', '5':'five', '6':'six', '7':'seven', '8':'eight', '9':'nine' }
const counterWords = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five']
function announcementText(ticketLabel, counterNumber) {
  const [serviceCode, number = ''] = ticketLabel.split('-')
  const spokenCode = [...serviceCode].join(' ')
  const spokenNumber = [...number].map(digit => digits[digit] || digit).join(' ')
  return `Now serving ticket ${spokenCode} ${spokenNumber} at Counter ${counterWords[counterNumber] || counterNumber}.`
}

export function useSpeechAnnouncement(getCalledTickets) {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window
  const enabled = ref(false)
  const muted = ref(false)
  const announced = ref(new Set())
  const queue = ref([])
  const speaking = ref(false)
  const lastAnnouncement = ref(null)

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

  function announceTicket(ticketLabel, counterNumber, businessDate = '') {
    const key = `${businessDate}:${ticketLabel}:${counterNumber}`
    if (announced.value.has(key)) return
    announced.value.add(key)
    lastAnnouncement.value = { ticketLabel, counterNumber, businessDate }
    speak(announcementText(ticketLabel, counterNumber))
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
    const last = lastAnnouncement.value
    if (last) speak(announcementText(last.ticketLabel, last.counterNumber))
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