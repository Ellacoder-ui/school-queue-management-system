<script setup>
import { computed, ref } from 'vue'
import { ticketLabel } from '../lib/workspaceData.js'
import { counterRoutes } from '../lib/publicBoard.js'
import WorkspaceDialog from './WorkspaceDialog.vue'
const props = defineProps({ context: { type: Object, required: true }, data: { type: Object, required: true }, actionState: { type: Object, default: () => ({ phase: 'idle' }) } })
const emit = defineEmits(['refresh', 'action'])
const selection = ref(''), search = ref(''), status = ref('all')
const confirmation = ref(null)
const counter = computed(() => props.context.cashier_counters.find(row => row.counter_id === selection.value) || props.context.cashier_counters[0])
const assigned = computed(() => props.data.rows.filter(row => counter.value?.service_codes.includes(row.service)))
const current = computed(() => assigned.value.find(row => row.status === 'CALLED' && row.counter_id === counter.value?.counter_id))
const waiting = computed(() => assigned.value.filter(row => row.status === 'WAITING').sort((a, b) => a.wait_position - b.wait_position))
const rows = computed(() => assigned.value.filter(row => (status.value === 'all' || row.status === status.value) && `${ticketLabel(row)} ${row.service} ${row.business_date}`.toLowerCase().includes(search.value.toLowerCase().trim())))
const route = computed(() => counterRoutes.find(row => row.number === counter.value?.counter_number))
const validAssignment = computed(() => counter.value && counter.value.service_codes.length === 1 && counter.value.service_codes[0] === route.value?.code)
const locked = computed(() => props.data.status !== 'ready' || props.actionState.busy || ['pending', 'unknown', 'blocked'].includes(props.actionState.phase))
const canCall = computed(() => !locked.value && validAssignment.value && counter.value.is_open && !current.value)
const canFinish = computed(() => !locked.value && validAssignment.value && !!current.value)
function prepare(action) {
  if (action === 'CALL' ? !canCall.value : !canFinish.value) return
  confirmation.value = { action, counter: counter.value.counter_id, service: route.value.code, ticket: current.value?.ticket_id, label: current.value ? ticketLabel(current.value) : null }
}
const confirmationValid = computed(() => confirmation.value && confirmation.value.counter === counter.value?.counter_id && (confirmation.value.action === 'CALL' ? canCall.value : canFinish.value && confirmation.value.ticket === current.value?.ticket_id))
function confirm() {
  if (!confirmationValid.value) return
  const item = confirmation.value; confirmation.value = null
  if (item.action === 'CALL') emit('action', 'call_next', { p_counter: item.counter, p_service: item.service })
  else emit('action', 'finish_ticket', { p_ticket: item.ticket, p_action: item.action })
}
</script>
<template>
  <article data-testid="cashier-workspace">
    <div class="cqs-page-heading"><div><p class="cqs-eyebrow">Cashier workspace</p><h1>Your counter, at a glance.</h1><p>Serve with focus. Keep the queue moving.</p></div><button class="cqs-button cqs-button-outline" type="button" :disabled="data.status === 'loading'" @click="$emit('refresh')">Refresh queue</button></div>
    <div class="cqs-counter-strip"><div><span class="cqs-service-icon" :data-service="route?.code">{{ route?.code || '—' }}</span><div><h2>{{ counter?.counter_label || 'No assigned counter' }}</h2><p>{{ route?.name || 'An authorized administrator must assign your counter.' }}</p></div></div><span v-if="counter" class="cqs-badge" :class="{ 'cqs-badge-green': counter.is_open }">{{ counter.is_open ? 'Open counter' : 'Closed counter' }}</span><label v-if="context.cashier_counters.length > 1" class="cqs-field">Assigned counter<select v-model="selection"><option v-for="item in context.cashier_counters" :key="item.counter_id" :value="item.counter_id">{{ item.counter_label }}</option></select></label></div>
    <p v-if="data.status !== 'ready'" class="cqs-notice" :role="data.status === 'error' ? 'alert' : 'status'">{{ data.status === 'loading' ? 'Loading your authorized queue…' : 'The queue could not be confirmed. Refresh to try again.' }}</p>
    <div class="cqs-cashier-grid">
      <section class="cqs-card cqs-serving"><div class="cqs-section-heading"><p class="cqs-eyebrow">Now serving</p><span class="cqs-badge cqs-badge-green">{{ data.status === 'ready' ? current ? 'CALLED' : 'No current call' : 'Unconfirmed' }}</span></div><div class="cqs-serving-label">{{ data.status === 'ready' && current ? ticketLabel(current) : '— — —' }}</div><h2>{{ data.status === 'ready' ? current ? route?.name : 'Ready for the next call' : 'Queue unavailable' }}</h2><p>{{ current && data.status === 'ready' ? `Queue date · ${current.business_date}` : 'Only tickets for your assigned services appear here.' }}</p><div class="cqs-action-row"><button type="button" class="cqs-button cqs-button-outline" data-testid="skip-ticket" :disabled="!canFinish" @click="prepare('SKIP')">Skip</button><button type="button" class="cqs-button cqs-button-green" data-testid="serve-ticket" :disabled="!canFinish" @click="prepare('SERVE')">Mark Served</button><button type="button" class="cqs-button cqs-button-primary" data-testid="call-next" :disabled="!canCall" @click="prepare('CALL')">Call Next</button></div><p class="cqs-caption" role="status">{{ locked ? 'Refresh the queue or resolve your current operation before continuing.' : !validAssignment ? 'A valid fixed-service counter assignment is required.' : 'Actions require confirmation. Mark Served does not automatically call the next ticket.' }}</p></section>
      <section class="cqs-card cqs-up-next"><p class="cqs-eyebrow">Up next</p><template v-if="data.status === 'ready' && waiting.length"><div class="cqs-next-label">{{ ticketLabel(waiting[0]) }}</div><h3>{{ route?.name }}</h3><p>Queue date · {{ waiting[0].business_date }}</p><span class="cqs-badge">WAITING</span></template><div v-else class="cqs-empty"><h2>{{ data.status === 'ready' ? 'A clear queue.' : 'Not confirmed' }}</h2><p>{{ data.status === 'ready' ? 'No waiting tickets for this assignment.' : 'Waiting tickets are unavailable.' }}</p></div><p class="cqs-caption">Tickets are listed in queue order. Waiting times are not estimated.</p></section>
    </div>
    <section class="cqs-card"><div class="cqs-section-heading"><div><p class="cqs-eyebrow">Your assigned services</p><h2>Active queue <span v-if="data.status === 'ready'" class="cqs-count">{{ assigned.length }}</span></h2></div><div class="cqs-filters"><label class="cqs-field">Search tickets<input v-model="search" type="search" placeholder="Ticket, service or queue date"></label><label class="cqs-field">Status<select v-model="status"><option value="all">All active</option><option value="WAITING">Waiting</option><option value="CALLED">Called</option></select></label></div></div>
      <div class="cqs-table-scroll" tabindex="0" aria-label="Active queue table"><table class="cqs-table"><thead><tr><th>Ticket</th><th>Service</th><th>Queue date</th><th>Status</th></tr></thead><tbody><template v-if="data.status === 'ready'"><tr v-for="row in rows" :key="row.ticket_id"><td><strong>{{ ticketLabel(row) }}</strong></td><td>{{ row.service }}</td><td>{{ row.business_date }}</td><td><span class="cqs-badge">{{ row.status }}</span></td></tr></template><tr v-if="data.status !== 'ready' || !rows.length"><td colspan="4" class="cqs-empty">{{ data.status === 'loading' ? 'Loading queue…' : data.status !== 'ready' ? 'Queue data unavailable.' : assigned.length ? 'No tickets match your filters.' : 'No active tickets for your assigned services.' }}</td></tr></tbody></table></div>
    </section>
    <WorkspaceDialog v-if="confirmation" :title="confirmation.action === 'CALL' ? 'Call the next waiting ticket?' : confirmation.action === 'SERVE' ? 'Mark this ticket served?' : 'Move this ticket to the waiting tail?'" @close="confirmation = null">
      <p v-if="confirmation.action === 'CALL'">Call the next eligible {{ confirmation.service }} ticket at {{ counter?.counter_label }}. The database determines queue order.</p>
      <p v-else>{{ confirmation.label }} · {{ current?.business_date }}. {{ confirmation.action === 'SERVE' ? 'This completes the ticket. Call Next remains a separate action.' : 'The same ticket number returns to the end of its waiting queue.' }}</p>
      <p v-if="!confirmationValid" class="cqs-notice">The queue or assignment changed. Close this dialog and refresh before continuing.</p>
      <template #actions><button type="button" class="cqs-button cqs-button-outline" @click="confirmation = null">Go back</button><button type="button" class="cqs-button cqs-button-primary" data-testid="confirm-cashier-action" :disabled="!confirmationValid" @click="confirm">Confirm {{ confirmation.action === 'CALL' ? 'call' : confirmation.action === 'SERVE' ? 'served' : 'skip' }}</button></template>
    </WorkspaceDialog>
  </article>
</template>
