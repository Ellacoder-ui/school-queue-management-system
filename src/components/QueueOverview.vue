<script setup>
import { computed } from 'vue'
import { boardCounters } from '../lib/publicBoard.js'
const props = defineProps({ state: { type: Object, required: true }, compact: Boolean })
const counters = computed(() => boardCounters(props.state))
const synchronizationFailed = computed(() => !!props.state.error || props.state.connection === 'disconnected')
function waiting(code) {
  const rows = props.state.services.filter(row => row.service_code === code && row.business_date === props.state.context?.business_date)
  return props.state.hasSnapshot && rows.length === 1 && Number.isSafeInteger(rows[0].waiting_count) && rows[0].waiting_count >= 0 ? rows[0].waiting_count : null
}
</script>
<template>
  <section class="cqs-card cqs-overview" aria-label="Public counter status">
    <div class="cqs-section-heading"><div><p class="cqs-eyebrow">Five dedicated services</p><h2>At the counters</h2></div><span v-if="synchronizationFailed" class="cqs-badge" role="alert">Updates unavailable</span></div>
    <p v-if="synchronizationFailed" class="cqs-notice" role="alert">Queue synchronization is interrupted. The last available snapshot may be out of date.</p>
    <div class="cqs-counter-list" :class="{ 'cqs-counter-grid': !compact }">
      <div v-for="counter in counters" :key="counter.code" class="cqs-counter-row">
        <span class="cqs-service-icon" :data-service="counter.code">{{ counter.code }}</span>
        <div><h3>Counter {{ counter.number }}</h3><p>{{ counter.name }}</p><small>{{ counter.row ? counter.row.is_open ? 'Open' : 'Closed' : 'Availability unavailable' }} · {{ counter.enabled === false ? 'Service disabled' : counter.enabled === null ? 'Catalog unavailable' : 'Service enabled' }}</small></div>
        <div class="cqs-counter-value"><strong>{{ counter.row?.ticket_label || (counter.row ? 'No call' : '—') }}</strong><small v-if="waiting(counter.code) !== null">{{ waiting(counter.code) }} waiting · {{ state.context.business_date }}</small><small v-else aria-label="Waiting count unavailable">—</small></div>
      </div>
    </div>
  </section>
</template>
