<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { boardCounters, boardWaiting, manilaClock } from '../lib/publicBoard.js'
import { useSpeechAnnouncement } from '../composables/useSpeechAnnouncement.js'

const props = defineProps({ state: { type: Object, required: true }, embedded: Boolean })
const now = ref(Date.now())
let clockTimer
onMounted(() => { now.value = Date.now(); clockTimer = setInterval(() => { now.value = Date.now() }, 1000) })
onUnmounted(() => clearInterval(clockTimer))

const clock = computed(() => manilaClock(now.value))
const counters = computed(() => boardCounters(props.state))
const waiting = computed(() => boardWaiting(props.state))
const calling = computed(() => counters.value.filter(counter => counter.row?.ticket_label))
const featured = computed(() => calling.value[0])
const invalidProjection = computed(() => props.state.hasSnapshot && (counters.value.some(counter => counter.invalid)
  || props.state.counters.some(row => !/^Counter [1-5]$/.test(row.counter_label))))
const isLive = computed(() => props.state.connection === 'connected' && props.state.synchronized
  && props.state.hasSnapshot && !props.state.error && !invalidProjection.value)

const speech = useSpeechAnnouncement(() => counters.value.filter(c => c.row?.ticket_label))
const calls = computed(() => counters.value.filter(counter => counter.row?.ticket_label).map(counter => ({
  label: counter.row.ticket_label, number: counter.number,
  date: counter.row.business_date || props.state.context?.business_date || '',
})))
const announcedCalls = new Set()
let liveBaselineReady = false
watch(() => ({ live: isLive.value, calls: calls.value }), snapshot => {
  if (!snapshot.live) { liveBaselineReady = false; return }
  if (!liveBaselineReady) {
    for (const call of snapshot.calls) announcedCalls.add(`${call.date}:${call.label}:${call.number}`)
    liveBaselineReady = true
    return
  }
  for (const call of snapshot.calls) {
    const key = `${call.date}:${call.label}:${call.number}`
    if (!announcedCalls.has(key)) {
      announcedCalls.add(key)
      speech.announceTicket(call.label, call.number, call.date)
    }
  }
}, { deep: true })
const synchronizationFailed = computed(() => !!props.state.error || props.state.connection === 'disconnected')
const dayLabel = computed(() => !props.state.context ? 'Business-day status unavailable'
  : props.state.context.queue_day_open ? 'Queue day open' : 'Queue day not open')
const idleTitle = computed(() => props.state.loading && !props.state.hasSnapshot ? 'Loading public queue'
  : !props.state.hasSnapshot ? 'Waiting for queue data'
    : props.state.context && !props.state.context.queue_day_open ? 'Queue day not open' : 'No tickets are currently being called')
const cardStatus = counter => !props.state.hasSnapshot ? 'Awaiting data' : !counter.row ? 'Data unavailable'
  : counter.row.ticket_label ? (isLive.value ? 'Now serving' : 'Last reported call')
    : !counter.row.is_open ? 'Counter closed' : 'No ticket being called'
</script>

<template>
  <div class="public-display-shell">
    <div class="queue-board" :class="{ 'queue-board-embedded': embedded }" :data-live="isLive" data-testid="public-board">
      <a v-if="!embedded" class="board-skip" href="#queue-counters">Skip to counter calls</a>
      <header v-if="!embedded" class="board-header">
        <div class="board-brand">
          <img src="/liceo-logo.png" alt="Liceo de Cagayan University logo" class="board-logo" />
          <div><h1>Liceo de Cagayan University</h1><p>CASHIER QUEUE DISPLAY</p></div>
        </div>
        <div class="board-clock" aria-label="Current time and date in Asia/Manila" aria-live="off">
          <p>{{ clock.time }}</p><span>{{ clock.date }}</span>
        </div>
      </header>

      <component :is="embedded ? 'div' : 'main'" class="board-main" :aria-busy="state.loading">
        <div class="board-intro">
          <div class="board-service-label"><span class="board-dot" aria-hidden="true"></span>SERVICE BOARD</div>
          <p>Listen for your ticket number and proceed to the assigned counter.</p>
          <button v-if="!embedded && speech.supported && !speech.enabled.value" type="button" class="board-voice-btn" data-testid="voice-enable" @click="speech.enable()">Enable voice announcements</button>
        </div>

        <p v-if="synchronizationFailed && state.hasSnapshot" class="board-context-note" role="status">Last reported state may be out of date.</p>
        <p v-if="state.error || invalidProjection" class="board-alert" role="alert">
          {{ invalidProjection ? 'Counter data could not be matched safely.' : state.error }}
          <span v-if="state.hasSnapshot">Showing the last successful snapshot.</span>
        </p>
        <p v-else-if="synchronizationFailed" class="board-alert" role="status">Queue synchronization is interrupted. {{ state.hasSnapshot ? 'The last available snapshot may be out of date.' : 'Waiting for a connection.' }}</p>

        <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ isLive ? 'Current calls' : 'Last reported calls' }}: {{ calling.length ? calling.map(counter => `Counter ${counter.number}, ${counter.row.ticket_label}`).join('; ') : 'No calls reported' }}.</p>
        <section class="board-feature" aria-label="Highlighted counter call">
          <template v-if="featured">
            <div class="board-feature-service"><h2>{{ isLive ? 'Now serving' : 'Last reported call' }}</h2><p>{{ featured.name }}</p></div>
            <p class="board-feature-ticket">{{ featured.row.ticket_label }}</p>
            <div class="board-feature-destination"><p>{{ isLive ? 'Proceed to' : 'Last reported at' }}</p><h3>COUNTER {{ String(featured.number).padStart(2, '0') }}</h3></div>
            <p class="board-feature-note">{{ calling.length }} {{ calling.length === 1 ? 'counter calling' : 'counters calling' }} · Highlight: lowest counter number. All calls shown below.<span v-if="featured.row.business_date"> · Ticket day {{ featured.row.business_date }}</span></p>
          </template>
          <div v-else class="board-feature-idle">
            <h2>{{ idleTitle }}</h2>
            <p>{{ !state.hasSnapshot ? 'Public queue information will appear after a successful snapshot.' : 'Keep your ticket ready and watch your service counter below.' }}</p>
            <p v-if="state.hasSnapshot && !state.counters.length">No counters have been published.</p>
          </div>
        </section>

        <section id="queue-counters" class="board-counters" aria-label="All five service counters" tabindex="-1">
          <article v-for="counter in counters" :key="counter.number" class="board-counter" :data-counter="counter.number" :aria-label="`Counter ${counter.number}: ${counter.name}`">
            <div class="board-counter-top"><p class="board-counter-status"><span class="board-dot" :class="{ 'is-live': isLive && counter.row?.is_open }" aria-hidden="true"></span>{{ cardStatus(counter) }}</p><span class="board-code">{{ counter.code }}</span></div>
            <h2 class="board-counter-service">{{ counter.name }}</h2>
            <div class="board-counter-bottom"><p class="board-counter-ticket" :class="{ 'is-placeholder': !counter.row?.ticket_label }">{{ counter.row?.ticket_label || (counter.row && !counter.row.is_open ? 'Closed' : '—') }}</p><span class="board-counter-badge">COUNTER {{ String(counter.number).padStart(2, '0') }}</span></div>
            <p v-if="counter.row?.ticket_label" class="board-ticket-day">Ticket day {{ counter.row.business_date }}</p>
            <p v-else-if="counter.enabled === false" class="board-ticket-day">Service not enabled</p>
          </article>
        </section>

        <section class="board-waiting" aria-label="Public waiting totals">
          <div class="board-waiting-title"><h2>WAITING TICKETS</h2><p>Please be ready</p></div>
          <div v-for="service in waiting" :key="service.code" class="board-waiting-item">
            <span class="board-waiting-code">{{ service.code }}</span>
            <p v-if="service.available"><strong>{{ service.waiting_count }}</strong><span> waiting</span></p>
            <p v-else class="board-waiting-unavailable" aria-label="Waiting count unavailable">—</p>
          </div>
        </section>
        <p v-if="state.hasSnapshot && !state.services.length" class="board-summary-note">No waiting totals have been published.</p>
        <p v-if="!state.context" class="board-summary-note">Business-day status and service catalog are unavailable.</p>
        <p v-else-if="!state.context.services.length" class="board-summary-note">No services are currently enabled.</p>
      </component>

      <footer class="board-footer">
        <p>Keep your ticket visible and prepare the required documents.</p>
      </footer>
    </div>
    <section v-if="$slots.default" class="board-workspace" aria-label="Application access">
      <a href="/display" class="board-monitor-link">Open public monitor display</a>
      <slot />
    </section>
  </div>
</template>
