<script setup>
import { computed } from 'vue'
import { boardCounters } from '../lib/publicBoard.js'
const props = defineProps({ state: { type: Object, required: true } })
const counters = computed(() => boardCounters(props.state))
const invalid = computed(() => props.state.hasSnapshot && (counters.value.some(x => !x.row || x.invalid) || props.state.counters.length !== 5))
const live = computed(() => props.state.hasSnapshot && props.state.connection === 'connected' && props.state.synchronized && !props.state.error && !invalid.value)
const status = computed(() => invalid.value ? 'Data unavailable' : props.state.error ? 'Updates unavailable'
  : props.state.connection === 'disconnected' ? 'Connection interrupted'
    : props.state.connection !== 'connected' ? 'Connecting'
      : !props.state.synchronized || !props.state.hasSnapshot ? 'Synchronizing'
        : props.state.refreshing ? 'Updating' : 'Live')
const refreshed = computed(() => Number.isFinite(Date.parse(props.state.lastRefreshed))
  ? new Intl.DateTimeFormat('en-PH', { timeZone:'Asia/Manila', hour:'numeric', minute:'2-digit', second:'2-digit' }).format(new Date(props.state.lastRefreshed)) : null)
function waiting(code) {
  const rows = props.state.hasSnapshot ? props.state.services.filter(x => x.service_code === code && x.business_date === props.state.context?.business_date) : []
  return rows.length === 1 && Number.isSafeInteger(rows[0].waiting_count) && rows[0].waiting_count >= 0 ? rows[0].waiting_count : null
}
</script>

<template>
  <section class="cqs-card cqs-overview cqs-live-tickets" aria-labelledby="admin-live-title" data-testid="admin-live-tickets" :data-live="live">
    <div class="cqs-section-heading"><div><p class="cqs-eyebrow">Five permanent counters</p><h2 id="admin-live-title">Live tickets</h2></div><span class="cqs-badge" :class="{ 'cqs-badge-green': live }" role="status" data-testid="live-ticket-connection">{{ status }}</span></div>
    <p v-if="!live" class="cqs-live-state" role="status">{{ state.hasSnapshot ? 'Last-known snapshot — stale. Calls, availability and counts may have changed.' : 'Waiting for a verified public queue snapshot.' }} Updates resume automatically after connection and a fresh snapshot.</p>
    <p v-else class="cqs-live-state">Current calls from the public queue display.</p>
    <div class="cqs-live-ticket-list">
      <section v-for="counter in counters" :key="counter.code" class="cqs-counter-row cqs-live-ticket-card" :data-live-counter="counter.number" :aria-labelledby="'live-counter-'+counter.number">
        <span class="cqs-service-icon" :data-service="counter.code">{{ counter.code }}</span>
        <div><h3 :id="'live-counter-'+counter.number">Counter {{ counter.number }}</h3><p>{{ counter.name }}</p><small>{{ counter.row ? counter.row.is_open ? 'Open' : 'Closed' : 'Availability unavailable' }} · {{ counter.enabled === null ? 'Catalog unavailable' : counter.enabled ? 'Service enabled' : 'Service disabled' }}</small></div>
        <div class="cqs-counter-value">
          <template v-if="counter.row?.ticket_label"><small>{{ live ? state.refreshing ? 'Updating call snapshot' : 'Currently called' : 'Last reported call · stale' }}</small><strong data-testid="live-called-ticket">{{ counter.row.ticket_label }}</strong><small>Ticket date {{ counter.row.business_date || 'not reported' }}</small></template>
          <p v-else class="cqs-live-empty">{{ !counter.row ? 'Call data unavailable' : live ? 'No ticket being called' : 'No call in last snapshot' }}</p>
        </div>
        <p class="cqs-live-waiting"><template v-if="waiting(counter.code) !== null"><strong>{{ waiting(counter.code) }}</strong> waiting · {{ state.context.business_date }}</template><template v-else>Waiting count not reported</template></p>
      </section>
    </div>
    <p class="cqs-live-updated">{{ refreshed ? `Snapshot updated ${refreshed} · Asia/Manila` : 'No successful refresh yet' }}</p>
  </section>
</template>
