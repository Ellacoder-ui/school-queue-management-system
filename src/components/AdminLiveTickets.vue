<script setup>
import { computed } from 'vue'
import { boardCounters } from '../lib/publicBoard.js'
import { useSpeechAnnouncement } from '../composables/useSpeechAnnouncement.js'
const props = defineProps({ state: { type: Object, required: true } })
const counters = computed(() => boardCounters(props.state))
const live = computed(() => props.state.hasSnapshot && props.state.connection === 'connected' && props.state.synchronized && !props.state.error)
const speech = useSpeechAnnouncement(() => counters.value.filter(c => c.row?.ticket_label))
function waiting(code) {
  const rows = props.state.hasSnapshot ? props.state.services.filter(x => x.service_code === code && x.business_date === props.state.context?.business_date) : []
  return rows.length === 1 && Number.isSafeInteger(rows[0].waiting_count) && rows[0].waiting_count >= 0 ? rows[0].waiting_count : null
}
function cardStatus(counter) {
  if (!props.state.hasSnapshot) return 'Awaiting data'
  if (!counter.row) return 'Data unavailable'
  if (counter.row.ticket_label) return live.value ? 'Now serving' : 'Last reported call'
  return counter.row.is_open ? 'Counter open' : 'Counter closed'
}
</script>

<template>
  <section class="cqs-card cqs-live-tickets" aria-labelledby="admin-live-title" data-testid="admin-live-tickets" :data-live="live">
    <div class="cqs-section-heading">
      <div class="admin-live-heading-left"><h2 id="admin-live-title">Live tickets</h2></div>
      <div class="admin-live-heading-right">
        <a class="admin-public-display-link" href="/display" target="_blank" rel="noopener noreferrer">View Public Display ↗</a>
        <div class="board-voice-controls">
        <button type="button" class="board-voice-btn" :class="{ 'is-active': speech.enabled.value }" @click="speech.enabled.value ? speech.disable() : speech.enable()">{{ speech.enabled.value ? 'Voice on' : 'Enable Audio' }}</button>
        <button type="button" class="board-voice-btn" :disabled="!speech.enabled.value" @click="speech.toggleMute()">{{ speech.muted.value ? 'Unmute' : 'Mute' }}</button>
        <button type="button" class="board-voice-btn" :disabled="!speech.enabled.value" @click="speech.replayLast()">Replay</button>
      </div>
    </div>
    </div>
    <div class="admin-live-grid" id="admin-live-counters">
      <article v-for="counter in counters" :key="counter.number" class="board-counter" :data-counter="counter.number">
        <div class="board-counter-top">
          <p class="board-counter-status"><span class="board-dot" :class="{ 'is-live': live && counter.row?.is_open }" aria-hidden="true"></span>{{ cardStatus(counter) }}</p>
          <span class="board-code">{{ counter.code }}</span>
        </div>
        <h2 class="board-counter-service">{{ counter.name }}</h2>
        <div class="board-counter-bottom">
          <p class="board-counter-ticket" :class="{ 'is-placeholder': !counter.row?.ticket_label }">
            {{ counter.row?.ticket_label || (counter.row && !counter.row.is_open ? 'Closed' : (live ? 'No ticket being called' : '�?"')) }}
          </p>
          <span class="board-counter-badge">COUNTER {{ String(counter.number).padStart(2, '0') }}</span>
        </div>
        <p class="board-ticket-day">{{ waiting(counter.code) === null ? 'Waiting count unavailable' : waiting(counter.code) + ' waiting' }}</p>
      </article>
    </div>
  </section>
</template>