<script setup>
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { boardCounters } from '../lib/publicBoard.js'
import { ticketLabel } from '../lib/workspaceData.js'
import { emptyAdmin } from '../lib/adminWorkspace.js'
import AdminAddStaff from './AdminAddStaff.vue'
import AdminPayors from './AdminPayors.vue'
import {staffDirectoryRows} from '../lib/adminRecords.js'
import AdminLiveTickets from './AdminLiveTickets.vue'
import WorkspaceDialog from './WorkspaceDialog.vue'
import '../admin.css'

const props = defineProps({
  publicState: { type: Object, required: true },
  data: { type: Object, required: true },
  management: { type: Object, default: emptyAdmin },
  records: { type: Object, default: () => ({ staff: { status: 'unavailable' }, lookup: { status: 'idle' }, payors: { status: 'idle' }, history: { status: 'idle' } }) }
})
const emit = defineEmits(['refresh', 'refresh-staff', 'management-action', 'reconcile-management', 'records-tab', 'records-find', 'records-clear', 'records-query', 'records-events', 'records-close-history', 'records-retry'])

const tab = ref('analytics')
const livePanel = ref(null), panelFits = ref(false)
let panelObserver
function fitLivePanel() { panelFits.value = !!livePanel.value && window.innerWidth > 1000 && livePanel.value.getBoundingClientRect().height <= window.innerHeight - 48 }
onMounted(() => {
  panelObserver = new ResizeObserver(fitLivePanel); panelObserver.observe(livePanel.value)
  window.addEventListener('resize', fitLivePanel); fitLivePanel()
})
onBeforeUnmount(() => { panelObserver?.disconnect(); window.removeEventListener('resize', fitLivePanel) })
const search = ref('')
const service = ref('all')
const counters = computed(() => boardCounters(props.publicState))
const openCounters = computed(() => props.publicState.hasSnapshot && counters.value.every(row => row.row) ? counters.value.filter(row => row.row.is_open).length : '—')
const rows = computed(() => props.data.status === 'ready' ? props.data.rows.filter(row => (service.value === 'all' || row.service === service.value) && `${ticketLabel(row)} ${row.business_date} ${row.status}`.toLowerCase().includes(search.value.toLowerCase().trim())) : [])
const waiting = computed(() => props.data.status === 'ready' ? props.data.rows.filter(row => row.status === 'WAITING').length : '—')
const called = computed(() => props.data.status === 'ready' ? props.data.rows.filter(row => row.status === 'CALLED').length : '—')
const fixedCodes = ['TP', 'SOA', 'PNEP', 'REF', 'ADJ']
const snapshot = computed(() => props.management.status === 'ready' ? props.management.data : null)
const adminConfig = computed(() => snapshot.value ? snapshot.value.configuration : null)
const adminSearch = ref('')
const dialog = ref(null)
const editRole = ref('STUDENT')
const editEnabled = ref(true)
const editOpen = ref(false)
const editCashiers = ref([])
const locked = computed(() => !snapshot.value || props.management.busy || ['pending', 'unknown', 'blocked'].includes(props.management.phase))

const staffAccounts = computed(() => {
  const dir = snapshot.value && snapshot.value.directory ? snapshot.value.directory : []
  return staffDirectoryRows(props.records?.staff,dir)
})

const adminDirectory = computed(() => staffAccounts.value.filter(a => `${a.email || ''} ${a.id} ${a.role}`.toLowerCase().includes(adminSearch.value.trim().toLowerCase())))
const adminCounters = computed(() => adminConfig.value && adminConfig.value.counters ? [...adminConfig.value.counters].sort((a, b) => a.number - b.number) : [])
const adminAssignments = computed(() => adminConfig.value && adminConfig.value.staff_assignments ? adminConfig.value.staff_assignments : [])
const googleVerified = row => props.records && props.records.staff && props.records.staff.status === 'ready' && props.records.staff.value && props.records.staff.value.some(x => x.id === row.id && x.role === row.role && x.enabled === row.enabled && x.email === row.email && x.google_verified)
const accountLabel = id => { const a = staffAccounts.value.find(x => x.id === id); return a ? (a.email || id) : id }
const assignmentsFor = id => adminAssignments.value.filter(a => a.account_id === id).map(a => { const c = adminCounters.value.find(x => x.id === a.counter_id); return c ? c.number : null }).filter(Boolean).join(', ') || 'None'

function editAccount(row) {
  if (locked.value || row.id === props.management.actor) return
  dialog.value = { kind: 'account', row }
  editRole.value = row.role
  editEnabled.value = row.enabled
}

function editCounterRow(row) {
  if (locked.value) return
  dialog.value = { kind: 'counter', row }
  editOpen.value = row.is_open
  editCashiers.value = adminAssignments.value.filter(a => a.counter_id === row.id).map(a => a.account_id)
}

function saveAccount() {
  if (locked.value || !dialog.value || dialog.value.kind !== 'account' || dialog.value.row.id === props.management.actor) return
  emit('management-action', 'set_account', { p_user: dialog.value.row.id, p_role: editRole.value, p_enabled: editEnabled.value })
  dialog.value = null
}

function saveCounter() {
  if (locked.value || !dialog.value || dialog.value.kind !== 'counter') return
  const row = dialog.value.row
  emit('management-action', 'configure_counter', { p_counter: row.id, p_open: editOpen.value, p_services: [fixedCodes[row.number - 1]], p_cashiers: [...editCashiers.value].sort() })
  dialog.value = null
}

watch(() => props.management.actor, (next, previous) => { if (next !== previous) dialog.value = null })
watch(tab, value => emit('records-tab', value))
</script>

<template>
  <article data-testid="admin-workspace">
    <div class="cqs-page-heading"><div><p class="cqs-eyebrow">Administrator workspace</p><h1>A clear view of campus service.</h1><p>Monitor service activity across all five counters.</p></div></div>
    <p class="cqs-update-status" role="status" data-testid="admin-update-status">{{ !publicState.synchronized || publicState.error ? 'Queue updates interrupted — showing the last known state.' : data.refreshing ? 'Updating authorized queue data…' : 'Automatic queue updates connected.' }}</p>
    <nav class="cqs-tabs" aria-label="Administrator sections"><button type="button" :aria-current="tab === 'analytics' ? 'page' : undefined" @click="tab = 'analytics'">Overview &amp; analytics</button><button type="button" :aria-current="tab === 'staff' ? 'page' : undefined" @click="tab = 'staff'">Staff management</button><button type="button" :aria-current="tab==='payors'?'page':undefined" @click="tab='payors'">Payor management</button></nav>
    <div class="cqs-admin-shell"><div class="cqs-admin-content">
    <template v-if="tab === 'analytics'">
      <div class="cqs-stat-grid"><section class="cqs-card cqs-stat"><p>Open counters</p><strong>{{ openCounters }}<small> / 5</small></strong><span>Public snapshot</span></section><section class="cqs-card cqs-stat"><p>Waiting tickets</p><strong>{{ waiting }}</strong><span>Across all active queue dates</span></section><section class="cqs-card cqs-stat"><p>Called tickets</p><strong>{{ called }}</strong><span>Awaiting service at a counter</span></section><section class="cqs-card cqs-stat"><p>Enabled services</p><strong>{{ publicState.context?.services.length ?? '—' }}</strong><span>Published service catalog</span></section></div>
      <div><section class="cqs-card cqs-chart-unavailable"><p class="cqs-eyebrow">Service insights</p><h2>Historical analytics</h2><h3>Historical reports are not available yet.</h3><p>Daily throughput, average wait and service trends are not available yet. No estimates are shown.</p></section></div>
      <section class="cqs-card"><div class="cqs-section-heading"><div><p class="cqs-eyebrow">Current operations</p><h2>Active tickets</h2></div><div class="cqs-filters"><label class="cqs-field">Search tickets<input v-model="search" type="search" placeholder="Ticket, date or status"></label><label class="cqs-field">Service<select v-model="service"><option value="all">All services</option><option v-for="item in counters" :key="item.code" :value="item.code">{{ item.code }}</option></select></label></div></div><p v-if="data.status !== 'ready'" class="cqs-notice" role="status">{{ data.status === 'loading' ? 'Loading authorized active tickets…' : 'Active queue is unavailable.' }} <button v-if="data.status==='error'" type="button" class="cqs-link" @click="emit('refresh')">Retry</button></p><div class="cqs-table-scroll" tabindex="0" aria-label="Administrator active tickets"><table class="cqs-table"><thead><tr><th>Ticket</th><th>Service</th><th>Queue date</th><th>Status</th></tr></thead><tbody><template v-if="data.status === 'ready'"><tr v-for="row in rows" :key="row.ticket_id"><td><strong>{{ ticketLabel(row) }}</strong></td><td>{{ row.service }}</td><td>{{ row.business_date }}</td><td><span class="cqs-badge">{{ row.status }}</span></td></tr></template><tr v-if="data.status === 'ready' && !rows.length"><td colspan="4" class="cqs-empty">{{ data.rows.length ? 'No tickets match your filters.' : 'No active tickets.' }}</td></tr></tbody></table></div></section>
    </template>
    <section v-else-if="tab==='staff'" class="cqs-card cqs-staff-panel" data-testid="staff-management">
      <div class="cqs-section-heading"><div><p class="cqs-eyebrow">Authorized institution staff</p><h2>Staff management</h2><p>Manage institution staff and fixed-counter assignments.</p></div></div>
      <p v-if="management.message" class="cqs-notice" role="status" data-testid="staff-message">{{ management.message }} <button v-if="management.phase==='unknown' && management.canRetry" type="button" class="cqs-link" :disabled="management.busy" data-testid="management-reconcile" @click="emit('reconcile-management')">Reconcile same request</button></p>
      <p v-if="management.status!=='ready'" class="cqs-notice" role="alert" data-testid="staff-unavailable">{{ management.status==='loading'?'Loading authorized staff directory…':management.status==='restricted'?'Administrator authorization required. Access is being revalidated.':'Staff directory is unavailable.' }} <button v-if="['error','unavailable'].includes(management.status)" type="button" class="cqs-link" @click="emit('refresh-staff')">Retry</button></p>
      <AdminAddStaff :records="records" :counters="adminCounters" :locked="locked" :actor="management.actor" @find="emit('records-find',$event)" @clear="emit('records-clear')" @submit="(...args)=>emit('management-action',...args)" />
      <template v-if="snapshot">
        <h3>Registered Accounts</h3><label class="cqs-field">Search accounts<input v-model="adminSearch" type="search" placeholder="Registered email, UUID or role" data-testid="staff-search"></label>
        <div class="cqs-table-scroll" tabindex="0" aria-label="Registered accounts"><table class="cqs-table"><thead><tr><th>Registered email / account</th><th>Role</th><th>Status</th><th>Counters</th><th>Action</th></tr></thead><tbody>
          <tr v-for="row in adminDirectory" :key="row.id" :data-account="row.id"><td><strong>{{ row.email || 'Email not reported' }}</strong><small class="cqs-account-id">{{ googleVerified(row)?'Verified Google account':'Registered email · Google verification not reported' }}</small><small class="cqs-account-id">{{ row.id }}</small></td><td>{{ row.role }}</td><td>{{ row.enabled?'Enabled':'Disabled' }}</td><td>{{ assignmentsFor(row.id) }}</td><td><button type="button" class="cqs-link" :disabled="locked || row.id===management.actor" :data-testid="'staff-edit-'+row.id" @click="editAccount(row)">{{ row.id===management.actor?'Current operator':'Edit Staff' }}</button></td></tr>
          <tr v-if="!adminDirectory.length"><td colspan="5" class="cqs-empty">No registered accounts match.</td></tr>
        </tbody></table></div>
      </template>
      <section v-if="snapshot"><h3>Cashier Counter Assignments</h3><div class="cqs-counter-admin-grid"><section v-for="counter in adminCounters" :key="counter.id" class="cqs-card"><h3>{{ counter.label }} · {{ fixedCodes[counter.number-1] }}</h3><p>{{ adminConfig.services.find(s=>s.code===fixedCodes[counter.number-1])?.name }}</p><p>{{ counter.is_open?'Open':'Closed' }}</p><p class="cqs-caption">{{ adminAssignments.filter(a=>a.counter_id===counter.id).map(a=>accountLabel(a.account_id)).join(', ') || 'No assigned cashier' }}</p><button type="button" class="cqs-button cqs-button-outline" :data-testid="'counter-edit-'+counter.number" :disabled="locked" @click="editCounterRow(counter)">Edit assignments</button></section></div></section>
      <p class="cqs-caption">Access follows database roles. Registered email or a Google identity count alone never grants staff privileges. Role and counter changes require explicit confirmation.</p>
    </section>
    <AdminPayors v-show="tab==='payors'" :state="records.payors" :history="records.history" :counters="adminCounters" @query="emit('records-query',$event)" @events="emit('records-events',$event)" @close-history="emit('records-close-history')" @retry="emit('records-retry')" />
    </div><aside ref="livePanel" class="cqs-admin-live" :class="{ 'cqs-admin-live-fits': panelFits }" data-testid="admin-live-monitor" aria-label="Live five-counter tickets"><AdminLiveTickets :state="publicState" /></aside></div>
    <WorkspaceDialog v-if="dialog" :title="dialog.kind==='account'?'Edit Staff · confirm access change':'Confirm cashier counter assignments'" @close="dialog=null">
      <form v-if="dialog.kind==='account'" id="admin-account-change" @submit.prevent="saveAccount"><p><strong>{{ dialog.row.email || 'Email not reported' }}</strong></p><p class="cqs-account-id">{{ dialog.row.id }}</p><label class="cqs-field">Database role<select v-model="editRole" data-testid="staff-edit-role"><option value="STUDENT">STUDENT — Remove staff access</option><option>CASHIER</option><option>ADMIN</option></select></label><label><input v-model="editEnabled" type="checkbox" data-testid="staff-edit-enabled"> Account enabled</label><p class="cqs-notice">Confirm this exact account change. Revoking or disabling a cashier can remove its assignments. PostgreSQL checks current administrator access, the last enabled ADMIN and unresolved work.</p></form>
      <form v-else id="admin-counter-change" @submit.prevent="saveCounter"><h3>{{ dialog.row.label }} · {{ fixedCodes[dialog.row.number-1] }}</h3><label><input v-model="editOpen" type="checkbox" data-testid="counter-edit-open"> Counter open</label><fieldset><legend>Enabled cashiers</legend><label v-for="row in staffAccounts.filter(a=>a.enabled&&a.role==='CASHIER'||editCashiers.includes(a.id))" :key="row.id" class="cqs-cashier-choice"><input v-model="editCashiers" type="checkbox" :value="row.id" :data-testid="'cashier-select-'+row.id">{{ row.email || row.id }}{{ !row.enabled||row.role!=='CASHIER'?' (ineligible; remove before saving)':'' }}</label></fieldset><p class="cqs-caption">The service mapping stays fixed. An open counter requires at least one eligible cashier; resolve called tickets before reconfiguration.</p></form>
      <template #actions><button type="button" class="cqs-button cqs-button-outline" @click="dialog=null">Cancel</button><button type="submit" class="cqs-button cqs-button-primary" data-testid="staff-confirm" :form="dialog.kind==='account'?'admin-account-change':'admin-counter-change'" :disabled="locked || (dialog.kind==='counter'&&editOpen&&!editCashiers.length)">Confirm change</button></template>
    </WorkspaceDialog>
  </article>
</template>
