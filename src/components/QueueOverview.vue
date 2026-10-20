<script setup>
import { computed } from 'vue'
import { boardCounters } from '../lib/publicBoard.js'
const props = defineProps({ state: { type: Object, required: true }, compact: Boolean })
defineEmits(['retry'])
const counters = computed(() => boardCounters(props.state))
const live = computed(() => props.state.hasSnapshot && props.state.synchronized && !props.state.error)
function waiting(code) {
  const rows = props.state.services.filter(row => row.service_code === code && row.business_date === props.state.context?.business_date)
  return props.state.hasSnapshot && rows.length === 1 ? rows[0].waiting_count : null
}
</script>
<template>
  <section class="cqs-card cqs-overview" aria-label="Public counter status">
    <div class="cqs-section-heading"><div><p class="cqs-eyebrow">Five dedicated services</p><h2>At the counters</h2></div><span class="cqs-badge" :class="{ 'cqs-badge-green': live }">{{ live ? 'Live public updates' : state.hasSnapshot ? 'Last known snapshot' : 'Connecting' }}</span></div>
    <p v-if="!live" class="cqs-notice" role="status">{{ state.hasSnapshot ? 'Updates are interrupted. Check the display before proceeding.' : 'Counter availability is not confirmed yet.' }} <button v-if="state.error || state.connection==='disconnected'" type="button" class="cqs-link" @click="$emit('retry')">Retry</button></p>
    <div class="cqs-counter-list" :class="{ 'cqs-counter-grid': !compact }">
      <div v-for="counter in counters" :key="counter.code" class="cqs-counter-row">
        <span class="cqs-service-icon" :data-service="counter.code">{{ counter.code }}</span>
        <div><h3>Counter {{ counter.number }}</h3><p>{{ counter.name }}</p><small>{{ counter.row ? counter.row.is_open ? 'Open' : 'Closed' : 'Availability unavailable' }} · {{ counter.enabled === false ? 'Service disabled' : counter.enabled === null ? 'Catalog unavailable' : 'Service enabled' }}</small></div>
        <div class="cqs-counter-value"><strong>{{ counter.row?.ticket_label || (counter.row ? 'No call' : '—') }}</strong><small v-if="waiting(counter.code) !== null">{{ waiting(counter.code) }} waiting · {{ state.context.business_date }}</small><small v-else>Waiting count unavailable</small></div>
      </div>
    </div>
  </section>
</template>
