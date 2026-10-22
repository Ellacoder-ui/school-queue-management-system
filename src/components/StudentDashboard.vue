<script setup>
import { computed, onMounted, ref } from 'vue'
import { boardCounters } from '../lib/publicBoard.js'
import { activeTicket, ticketLabel } from '../lib/workspaceData.js'
import PublicQueueDisplay from './PublicQueueDisplay.vue'
import WorkspaceDialog from './WorkspaceDialog.vue'
import { useTicketNotifications } from '../composables/useTicketNotifications.js'
const props = defineProps({ publicState: { type: Object, required: true }, data: { type: Object, required: true },
  actionState: { type: Object, default: () => ({ phase: 'idle' }) } })
const emit = defineEmits(['refresh', 'issue'])
const selected = ref(null), checklist = ref([])
const notifications = useTicketNotifications(() => props.data.rows)
const checklistItems = ['Prepare the documents required for your chosen service.', 'Keep your payment or transaction reference ready.', 'Watch the public display for your ticket call.']
onMounted(() => { try { const saved = JSON.parse(localStorage.getItem('cqs-preparation-v1')); if (Array.isArray(saved)) checklist.value = saved.filter(n => Number.isInteger(n) && n >= 0 && n < 3) } catch {} })
function saveChecklist() { try { localStorage.setItem('cqs-preparation-v1', JSON.stringify(checklist.value)) } catch {} }
const services = computed(() => boardCounters(props.publicState))
const ticket = computed(() => activeTicket(props.data.rows))
const history = computed(() => props.data.rows.filter(row => !['WAITING', 'CALLED'].includes(row.status)))
const locked = computed(() => props.actionState.busy || ['pending', 'unknown', 'blocked'].includes(props.actionState.phase))
const unavailableReason = status => ({
  COUNTER_CLOSED: 'Counter is currently closed.',
  QUEUE_CUTOFF: 'Ticket issuance for this service has ended today.',
  AFTER_HOURS: 'Ticket issuance closes at 5:00 PM.',
  SERVICE_UNAVAILABLE: 'Service unavailable',
})[status] || null
const issuanceReason = computed(() => {
  if (locked.value) return 'Resolve the current operation before requesting another ticket.'
  if (props.data.status !== 'ready') return 'Your ticket status is being checked. Wait for it to reconnect before requesting a ticket.'
  if (ticket.value) return 'You already have an active ticket across services.'
  if (!props.publicState.hasSnapshot || props.publicState.error) return 'Service availability is reconnecting. Wait for a fresh live status before requesting a ticket.'
  if (!props.publicState.context?.queue_day_open) return 'The current queue day is not open.'
  const reason = unavailableReason(selected.value?.issuance_status)
  if (reason) return reason
  if (!props.publicState.context.services.some(row => row.code === selected.value?.code)) return 'Select an enabled service.'
  return null
})
function issue() {
  if (issuanceReason.value || !selected.value) return
  const service = selected.value.code; selected.value = null; emit('issue', { p_service: service })
}
function waiting(code) {
  const rows = props.publicState.services.filter(row => row.service_code === code && row.business_date === props.publicState.context?.business_date)
  return props.publicState.hasSnapshot && rows.length === 1 && Number.isSafeInteger(rows[0].waiting_count) && rows[0].waiting_count >= 0 ? rows[0].waiting_count : null
}
</script>
<template>
  <article data-testid="student-workspace">
    <section class="cqs-service-selection" aria-labelledby="student-services-title" data-testid="student-service-selection">
      <div class="cqs-page-heading"><div><p class="cqs-eyebrow">Queue Dashboard</p><h1 id="student-services-title">Choose a cashier service</h1><p>Students and outside payors share the same secure queue.</p></div></div>
      <div id="request-services" class="cqs-service-grid">
        <button v-for="service in services" :key="service.code" type="button" class="cqs-service-card" :data-testid="`service-${service.code}`" :disabled="service.enabled !== true || service.issuance_status !== 'OPEN' || !publicState.hasSnapshot || !!publicState.error || !publicState.context?.queue_day_open" @click="selected = service">
          <span class="cqs-service-top"><span class="cqs-service-icon" :data-service="service.code">{{ service.code }}</span><span class="cqs-arrow" aria-hidden="true">↗</span></span>
          <h2>{{ service.name }}</h2><p>Counter {{ service.number }} · {{ service.row ? service.row.is_open ? 'Open' : 'Closed' : 'Availability unavailable' }}</p>
          <span class="cqs-service-footer"><span>{{ unavailableReason(service.issuance_status) || (!publicState.context?.queue_day_open ? 'Queue day closed' : service.enabled !== true || !publicState.hasSnapshot || publicState.error ? 'Service unavailable' : 'View service') }}</span><span v-if="waiting(service.code) !== null">{{ waiting(service.code) }} waiting</span><span v-else aria-label="Waiting count unavailable">—</span></span>
        </button>
      </div>
      <p class="cqs-caption">Queue date · {{ publicState.context?.business_date || '—' }}</p>
    </section>
    <div class="cqs-student-grid">
      <div class="cqs-main-column">
        <section class="cqs-embedded-monitor" aria-labelledby="student-monitor-title" data-testid="student-live-monitor">
          <div class="cqs-section-heading"><div><p class="cqs-eyebrow">Across all five counters</p><h2 id="student-monitor-title">Live queue monitor</h2></div></div>
          <PublicQueueDisplay :state="publicState" embedded />
        </section>
      </div>
      <aside class="cqs-ticket-rail">
        <section class="cqs-ticket-card" aria-label="Your active ticket">
          <p class="cqs-eyebrow">Your active ticket</p>
          <template v-if="data.status === 'ready' && ticket"><div class="cqs-ticket-number">{{ ticketLabel(ticket) }}</div><span class="cqs-ticket-status">{{ ticket.status === 'CALLED' ? 'You are being called' : 'Waiting for your call' }}</span><p>{{ ticket.business_date }} · {{ ticket.counter || 'Counter assigned when called' }}</p><div class="cqs-ticket-divider"></div><p>{{ ticket.status === 'CALLED' ? 'Please proceed to your assigned counter.' : 'Keep this dashboard open and check the public display.' }}</p></template>
          <template v-else><div class="cqs-ticket-placeholder" aria-hidden="true">— — —</div><h2>{{ data.status === 'ready' ? 'No active ticket' : data.status === 'loading' ? 'Checking your ticket…' : 'Ticket unavailable' }}</h2><p>{{ data.status === 'ready' ? 'Choose an available service to request your ticket.' : 'Your ticket status will be checked automatically when the connection is restored.' }}</p></template>
          <div class="cqs-ticket-divider"></div><small>One active ticket across all services. Maximum two SERVED tickets per service per issuance day.</small>
        </section>
        <section class="cqs-card cqs-checklist"><p class="cqs-eyebrow">Before your turn</p><h2>Come prepared</h2><label v-for="(item, index) in checklistItems" :key="item"><input v-model="checklist" type="checkbox" :value="index" @change="saveChecklist"> <span>{{ item }}</span></label><small>Checklist saved on this browser. Specific document requirements should be confirmed with the cashier office.</small></section>
        <p class="cqs-notice">Review your chosen service before confirming. Browsing a service does not join a queue.</p>
      </aside>
    </div>
    <div class="cqs-student-details">
        <section class="cqs-card" aria-label="Your ticket history">
          <div class="cqs-section-heading"><div><p class="cqs-eyebrow">Your previous visits</p><h2>Ticket history</h2></div></div>
          <p v-if="data.status === 'loading'" role="status" class="cqs-empty">Loading your tickets…</p>
          <p v-else-if="data.status !== 'ready'" role="alert" class="cqs-empty">Your ticket history is unavailable. Updates will resume automatically when the connection is restored.</p>
          <p v-else-if="!history.length" class="cqs-empty">No served or forfeited tickets to show.</p>
          <div v-else class="cqs-table-scroll" tabindex="0" aria-label="Ticket history table"><table class="cqs-table"><thead><tr><th>Ticket</th><th>Queue date</th><th>Counter</th><th>Status</th></tr></thead><tbody><tr v-for="row in history" :key="row.id"><td><strong>{{ ticketLabel(row) }}</strong></td><td>{{ row.business_date }}</td><td>{{ row.counter || (row.status === 'WAITING' ? 'Awaiting counter' : 'Counter not recorded') }}</td><td><span class="cqs-badge">{{ row.status }}</span></td></tr></tbody></table></div>
        </section>
    </div>
    <WorkspaceDialog v-if="selected" title="Review your service" @close="selected = null">
      <div class="cqs-selected-service"><span class="cqs-service-icon" :data-service="selected.code">{{ selected.code }}</span><div><h3>{{ selected.name }}</h3><p>Counter {{ selected.number }}</p></div></div>
      <div class="cqs-dialog-facts"><div><small>Waiting · {{ publicState.context?.business_date || 'date unavailable' }}</small><strong>{{ waiting(selected.code) === null ? 'Unavailable' : waiting(selected.code) }}</strong></div><div><small>Queue day</small><strong>{{ publicState.context ? publicState.context.queue_day_open ? 'Open' : 'Closed' : 'Unavailable' }}</strong></div></div>
      <p class="cqs-notice">One active ticket per account across all services. At most two SERVED tickets per service per issuance day. New tickets stop at 5:00 PM; a service with at least ten tickets by 4:30 PM closes to new issuance.</p><p id="issuance-status" class="cqs-caption">{{ issuanceReason || 'Confirming requests a real ticket for this service. Current access and admission are checked again.' }}</p>
      <template #actions><button class="cqs-button cqs-button-outline" type="button" @click="selected = null">Go back</button><button class="cqs-button cqs-button-primary" type="button" data-testid="confirm-issue-ticket" :disabled="!!issuanceReason" aria-describedby="issuance-status" @click="issue">Confirm &amp; get ticket</button></template>
    </WorkspaceDialog>
  </article>
</template>
