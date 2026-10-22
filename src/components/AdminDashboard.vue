<script setup>
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { boardCounters } from '../lib/publicBoard.js'
import { ticketLabel } from '../lib/workspaceData.js'
import { emptyAdmin } from '../lib/adminWorkspace.js'
import AdminAddStaff from './AdminAddStaff.vue'
import AdminPayors from './AdminPayors.vue'
import {availableStaffCounters,staffDirectoryRows,visibleAdminStaffRows} from '../lib/adminRecords.js'
import AdminLiveTickets from './AdminLiveTickets.vue'
import WorkspaceDialog from './WorkspaceDialog.vue'
import { STAFF_ACTIVATION_RELEASED, STAFF_MANAGEMENT_OWNER_ID } from '../lib/adminActivation.js'
import { normalizeStaffEmail } from '../lib/adminContracts.js'
import '../admin.css'

const props = defineProps({
  publicState: { type: Object, required: true },
  data: { type: Object, required: true },
  management: { type: Object, default: emptyAdmin },
  records: { type: Object, default: () => ({ staff: { status: 'unavailable' }, pending: { status: 'unavailable' }, lookup: { status: 'idle' }, payors: { status: 'idle' }, history: { status: 'idle' } }) }
})
const emit = defineEmits(['refresh', 'refresh-staff', 'management-action', 'reconcile-management', 'records-tab', 'records-query', 'records-events', 'records-close-history', 'records-retry'])

const validTabs = ['analytics', 'staff', 'payors']
const initialTab = (() => { try { const t = new URLSearchParams(window.location.search).get('tab'); return validTabs.includes(t) ? t : 'analytics' } catch { return 'analytics' } })()
const tab = ref(initialTab)
function syncTabUrl(value) { try { const url = new URL(window.location.href); url.searchParams.set('tab', value); window.history.replaceState({}, '', url.toString()) } catch {} }
watch(tab, value => { syncTabUrl(value); emit('records-tab', value) })
window.addEventListener('popstate', () => { try { const t = new URLSearchParams(window.location.search).get('tab'); if (validTabs.includes(t)) tab.value = t } catch {} })
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
const addStaffRef = ref(null)
const editRole = ref('CASHIER')
const editEnabled = ref(true)
const editAccountCounter = ref('')
const pendingDialog = ref(null)
const pendingEmail = ref('')
const pendingRole = ref('CASHIER')
const pendingCounter = ref('')
const pendingCancel = ref(null)
const removeStaff = ref(null)
const pendingEmailValid = computed(() => { try { normalizeStaffEmail(pendingEmail.value); return true } catch { return false } })
const locked = computed(() => !snapshot.value || props.management.busy || ['pending', 'unknown', 'blocked'].includes(props.management.phase))
const staffOwner = computed(() => props.management.actor === STAFF_MANAGEMENT_OWNER_ID)

const staffAccounts = computed(() => {
  const dir = snapshot.value && snapshot.value.directory ? snapshot.value.directory : []
  return staffDirectoryRows(props.records?.staff,dir,props.records?.pending)
})

const adminDirectory = computed(() => visibleAdminStaffRows(staffAccounts.value, props.management.actor)
  .filter(a => a.id !== STAFF_MANAGEMENT_OWNER_ID)
  .filter(a => `${a.email} ${a.role} ${counterFor(a)}`.toLowerCase().includes(adminSearch.value.trim().toLowerCase())))
const adminCounters = computed(() => adminConfig.value && adminConfig.value.counters ? [...adminConfig.value.counters].sort((a, b) => a.number - b.number) : [])
const adminAssignments = computed(() => adminConfig.value && adminConfig.value.staff_assignments ? adminConfig.value.staff_assignments : [])
const pendingAssignments = computed(() => props.records?.pending?.status === 'ready' ? props.records.pending.value : [])
const cashierAvailabilityReady = computed(() => !!adminConfig.value && props.records?.pending?.status === 'ready')
const availableCashierCounters = computed(() => cashierAvailabilityReady.value
  ? availableStaffCounters(adminCounters.value, adminAssignments.value, pendingAssignments.value) : [])
const editCashierCounters = computed(() => {
  const currentId = dialog.value?.kind === 'account' ? dialog.value.row.id : null
  const otherAssignments = adminAssignments.value.filter(row => row.account_id !== currentId)
  return availableStaffCounters(adminCounters.value, otherAssignments, pendingAssignments.value)
})
const assignmentsFor = id => adminAssignments.value.filter(a => a.account_id === id).map(a => { const c = adminCounters.value.find(x => x.id === a.counter_id); return c ? c.number : null }).filter(Boolean).join(', ') || 'None'
const counterFor = row => row.pending ? (adminCounters.value.find(c => c.id === row.counter)?.number ?? '—') : assignmentsFor(row.id)
const canEditPending = computed(() => staffOwner.value && !locked.value && props.records?.pending?.status === 'ready')
function editPending(row) {
  if (!canEditPending.value) return
  pendingDialog.value = row
  pendingEmail.value = row.email
  pendingRole.value = row.role
  pendingCounter.value = row.counter || ''
}

function savePending() {
  if (!pendingDialog.value || !canEditPending.value || !pendingEmailValid.value) return
  let email
  try { email = normalizeStaffEmail(pendingEmail.value) } catch { return }
  if (pendingRole.value === 'CASHIER' && !adminCounters.value.some(c => c.id === pendingCounter.value)) return
  emit('management-action', 'manage_pending_staff', {
    p_invitation: pendingDialog.value.invitation, p_action: 'UPDATE', p_email: email,
    p_role: pendingRole.value, p_counter: pendingRole.value === 'CASHIER' ? pendingCounter.value : null
  })
  pendingDialog.value = null
}

function cancelPending() {
  if (!pendingCancel.value || !canEditPending.value) return
  emit('management-action', 'manage_pending_staff', {
    p_invitation: pendingCancel.value.invitation, p_action: 'CANCEL',
    p_email: null, p_role: null, p_counter: null
  })
  pendingCancel.value = null
}

function editAccount(row) {
  if (locked.value || row.id === props.management.actor) return
  dialog.value = { kind: 'account', row }
  editRole.value = row.role === 'ADMIN' ? 'ADMIN' : 'CASHIER'
  editEnabled.value = row.enabled
  editAccountCounter.value = adminAssignments.value.find(assignment => assignment.account_id === row.id)?.counter_id || ''
}

function saveAccount() {
  if (locked.value || !dialog.value || dialog.value.kind !== 'account' || dialog.value.row.id === props.management.actor) return
  if (editRole.value === 'CASHIER' && editEnabled.value
    && !editCashierCounters.value.some(counter => counter.id === editAccountCounter.value)) return
  if (editRole.value === 'CASHIER' && editEnabled.value) {
    emit('management-action', 'set_staff_access', {
      p_user: dialog.value.row.id, p_role: 'CASHIER', p_enabled: true, p_counter: editAccountCounter.value
    })
  } else {
    emit('management-action', 'set_staff_access', {
      p_user: dialog.value.row.id, p_role: editRole.value, p_enabled: editEnabled.value,
      p_counter: null
    })
  }
  dialog.value = null
}

function requestRemoveStaff() {
  if (locked.value || dialog.value?.kind !== 'account' || dialog.value.row.id === props.management.actor) return
  removeStaff.value = dialog.value.row
  dialog.value = null
}

function confirmRemoveStaff() {
  if (locked.value || !removeStaff.value || removeStaff.value.id === props.management.actor) return
  emit('management-action', 'set_account', {
    p_user: removeStaff.value.id, p_role: 'STUDENT', p_enabled: removeStaff.value.enabled
  })
  removeStaff.value = null
}

watch(() => props.publicState.queueVersion, (next, previous) => {
  if (tab.value === 'staff' && next !== previous) emit('refresh-staff')
})
watch(() => props.management.actor, (next, previous) => { if (next !== previous) dialog.value = null })

</script>

<template>
  <article data-testid="admin-workspace">
    <div class="cqs-page-heading"><div><p class="cqs-eyebrow">Administrator workspace</p><h1>A clear view of campus service.</h1><p>Monitor service activity across all five counters.</p></div></div>
    <p v-if="publicState.error || publicState.connection === 'disconnected'" class="cqs-update-status" role="alert" data-testid="admin-update-status">Queue updates interrupted — showing the last known state.</p>
    <nav class="cqs-tabs" aria-label="Administrator sections"><button type="button" :aria-current="tab === 'analytics' ? 'page' : undefined" @click="tab = 'analytics'">Overview &amp; analytics</button><button type="button" :aria-current="tab === 'staff' ? 'page' : undefined" @click="tab = 'staff'">Staff management</button><button type="button" :aria-current="tab==='payors'?'page':undefined" @click="tab='payors'">Queue History</button></nav>
    <div class="cqs-admin-shell"><div class="cqs-admin-content">
    <template v-if="tab === 'analytics'">
      <div class="admin-overview-layout">
        <div class="admin-overview-left">
          <div class="cqs-stat-grid"><section class="cqs-card cqs-stat"><p>Open counters</p><strong>{{ openCounters }}<small> / 5</small></strong><span>Public snapshot</span></section><section class="cqs-card cqs-stat"><p>Waiting tickets</p><strong>{{ waiting }}</strong><span>Across all active queue dates</span></section><section class="cqs-card cqs-stat"><p>Called tickets</p><strong>{{ called }}</strong><span>Awaiting service at a counter</span></section><section class="cqs-card cqs-stat"><p>Enabled services</p><strong>{{ publicState.context?.services.length ?? '—' }}</strong><span>Published service catalog</span></section></div>
      <div><section class="cqs-card cqs-chart-unavailable"><p class="cqs-eyebrow">Service insights</p><h2>Historical analytics</h2><h3>Historical reports are not available yet.</h3><p>Daily throughput, average wait and service trends are not available yet. No estimates are shown.</p></section></div>

            <section class="cqs-card"><div class="cqs-section-heading"><div><p class="cqs-eyebrow">Current operations</p><h2>Active tickets</h2></div><div class="cqs-filters"><label class="cqs-field">Search tickets<input v-model="search" type="search" placeholder="Ticket, date or status"></label><label class="cqs-field">Service<select v-model="service"><option value="all">All services</option><option v-for="item in counters" :key="item.code" :value="item.code">{{ item.code }}</option></select></label></div></div><p v-if="data.status !== 'ready'" class="cqs-notice" role="status">{{ data.status === 'loading' ? 'Loading authorized active tickets…' : 'Active queue is unavailable.' }} <button v-if="data.status==='error'" type="button" class="cqs-link" @click="emit('refresh')">Retry</button></p><div class="cqs-table-scroll" tabindex="0" aria-label="Administrator active tickets"><table class="cqs-table"><thead><tr><th>Ticket</th><th>Service</th><th>Queue date</th><th>Status</th></tr></thead><tbody><template v-if="data.status === 'ready'"><tr v-for="row in rows" :key="row.ticket_id"><td><strong>{{ ticketLabel(row) }}</strong></td><td>{{ row.service }}</td><td>{{ row.business_date }}</td><td><span class="cqs-badge">{{ row.status }}</span></td></tr></template><tr v-if="data.status === 'ready' && !rows.length"><td colspan="4" class="cqs-empty">{{ data.rows.length ? 'No tickets match your filters.' : 'No active tickets.' }}</td></tr></tbody></table></div></section>
      </div>
      <div class="admin-overview-right">
        <AdminLiveTickets :state="publicState" />
      </div>
      </div>

    </template>
    <section v-else-if="tab==='staff'" class="cqs-card cqs-staff-panel" data-testid="staff-management">
      <div class="cqs-section-heading"><div><p class="cqs-eyebrow">Authorized institution staff</p><h2>Staff management</h2></div></div>
      <p v-if="management.message" class="cqs-notice" role="status" data-testid="staff-message">{{ management.message }} <button v-if="management.phase==='unknown' && management.canRetry" type="button" class="cqs-link" :disabled="management.busy" data-testid="management-reconcile" @click="emit('reconcile-management')">Reconcile same request</button></p>
      <p v-if="management.status!=='ready'" class="cqs-notice" role="alert" data-testid="staff-unavailable">{{ management.status==='loading'?'Loading authorized staff directory…':management.status==='restricted'?'Administrator authorization required. Access is being revalidated.':'Staff directory is unavailable.' }} <button v-if="['error','unavailable'].includes(management.status)" type="button" class="cqs-link" @click="emit('refresh-staff')">Retry</button></p>
      <AdminAddStaff ref="addStaffRef" :records="records" :counters="cashierAvailabilityReady ? availableCashierCounters : []" :locked="locked||!STAFF_ACTIVATION_RELEASED||!staffOwner" :actor="management.actor" :hideButton="true" @submit="(...args)=>emit('management-action',...args)" />
      <template v-if="snapshot">
        <div class="cqs-staff-directory-heading"><h3>Staff Directory</h3><button type="button" class="cqs-button cqs-button-primary" data-testid="add-staff" :disabled="locked||!STAFF_ACTIVATION_RELEASED||!staffOwner||!cashierAvailabilityReady" @click="addStaffRef?.openStaff?.()">Add Staff</button></div><label class="cqs-field">Search staff<input v-model="adminSearch" type="search" placeholder="Email or role" data-testid="staff-search"></label>
        <div class="cqs-table-scroll" tabindex="0" aria-label="Staff directory"><table class="cqs-table"><thead><tr><th>Email / account</th><th>Role</th><th>Status</th><th>Counters</th><th>Action</th></tr></thead><tbody>
          <tr v-for="row in adminDirectory" :key="row.id" :data-account="row.pending ? undefined : row.id" :data-pending-assignment="row.pending ? row.invitation : undefined"><td><strong>{{ row.email }}</strong></td><td>{{ row.role }}</td><td>{{ row.pending ? 'Invitation saved' : row.enabled?'Enabled':'Disabled' }}</td><td>{{ counterFor(row) }}</td><td><div class="cqs-table-actions" :class="{ 'cqs-table-actions-pending': row.pending }"><template v-if="row.pending"><button type="button" class="cqs-link" :disabled="!canEditPending" :data-testid="'pending-edit-'+row.invitation" @click="editPending(row)">Edit assignment</button><button type="button" class="cqs-link" :disabled="!canEditPending" :data-testid="'pending-cancel-'+row.invitation" @click="pendingCancel=row">Cancel assignment</button></template><button v-else type="button" class="cqs-link" :disabled="locked || !STAFF_ACTIVATION_RELEASED || !staffOwner" :data-testid="'staff-edit-'+row.id" @click="editAccount(row)">Edit Staff</button></div></td></tr>
          <tr v-if="!adminDirectory.length"><td colspan="5" class="cqs-empty">No registered accounts match.</td></tr>
        </tbody></table></div>
      </template>
      <p class="cqs-caption">Assign a cashier counter when adding staff. Cashiers open and close their own assigned counter from the cashier dashboard.</p>
      <p v-if="!staffOwner" class="cqs-caption">Only the designated administrator can change staff roles or counter assignments.</p>
      <p class="cqs-caption">Access follows database roles. Registered email or a Google identity count alone never grants staff privileges. Role and counter changes require explicit confirmation.</p>
    </section>
    <AdminPayors v-show="tab==='payors'" :state="records.payors" :history="records.history" :counters="adminCounters" @query="emit('records-query',$event)" @events="emit('records-events',$event)" @close-history="emit('records-close-history')" @retry="emit('records-retry')" />
    </div><aside ref="livePanel" class="cqs-admin-live" :class="{ 'cqs-admin-live-fits': panelFits }" data-testid="admin-live-monitor" aria-label="Live five-counter tickets"></aside></div>
    <WorkspaceDialog v-if="dialog" title="Edit Staff" @close="dialog=null">
      <form id="admin-account-change" @submit.prevent="saveAccount">
        <p><strong>{{ dialog.row.email }}</strong></p>
        <label class="cqs-field">Role<select v-model="editRole" data-testid="staff-edit-role"><option>CASHIER</option><option>ADMIN</option></select></label>
        <label v-if="editRole==='CASHIER'&&editEnabled" class="cqs-field">Assigned Counter
          <select v-model="editAccountCounter" data-testid="staff-edit-counter" required>
            <option v-for="row in editCashierCounters" :key="row.id" :value="row.id">{{ row.label }} — {{ ['Tuition Payment','Statement of Account','Promissory Notes and Exam Permits','Refund Process','Adjustment Clerk'][row.number-1] }} ({{ fixedCodes[row.number-1] }})</option>
          </select>
        </label>
        <p v-if="editRole==='CASHIER'&&editEnabled&&!editCashierCounters.length" class="cqs-notice" role="status">No available counters.</p>
        <label class="cqs-field"><span><input v-model="editEnabled" type="checkbox" data-testid="staff-edit-enabled"> Account enabled</span></label>
      </form>
      <template #actions>
        <button v-if="dialog.kind==='account'&&dialog.row.role!=='STUDENT'&&dialog.row.id!==management.actor" type="button" class="cqs-button cqs-button-danger" data-testid="remove-staff" @click="requestRemoveStaff">Remove Staff</button>
        <button type="button" class="cqs-button cqs-button-outline" @click="dialog=null">Cancel</button>
        <button type="submit" class="cqs-button cqs-button-primary" data-testid="staff-confirm" form="admin-account-change"
          :disabled="locked || editRole==='CASHIER'&&editEnabled&&(!editAccountCounter||!editCashierCounters.some(row=>row.id===editAccountCounter))">Confirm change</button>
      </template>
    </WorkspaceDialog>
    <WorkspaceDialog v-if="removeStaff" title="Remove staff access" @close="removeStaff=null">
      <p>Remove staff access for <strong>{{ removeStaff.email }}</strong>?</p>
      <p>Their account and ticket history will remain. Their cashier assignment will be released.</p>
      <template #actions><button type="button" class="cqs-button cqs-button-outline" @click="removeStaff=null">Cancel</button><button type="button" class="cqs-button cqs-button-danger" :disabled="locked" @click="confirmRemoveStaff">Remove Staff</button></template>
    </WorkspaceDialog>
    <WorkspaceDialog v-if="pendingDialog" title="Edit pending staff assignment" @close="pendingDialog=null">
      <form id="edit-pending-staff" @submit.prevent="savePending">
        <label class="cqs-field">Staff Email<input v-model="pendingEmail" type="email" maxlength="254" autocomplete="off" required></label>
        <p v-if="pendingEmail&&!pendingEmailValid" role="alert">Enter a valid email.</p>
        <label class="cqs-field">Role<select v-model="pendingRole"><option>CASHIER</option><option>ADMIN</option></select></label>
        <label v-if="pendingRole==='CASHIER'" class="cqs-field">Counter assignment<select v-model="pendingCounter" required><option value="">Choose counter</option><option v-for="row in adminCounters" :key="row.id" :value="row.id">{{ row.label }} · {{ fixedCodes[row.number-1] }}</option></select></label>
      </form>
      <template #actions><button type="button" class="cqs-button cqs-button-outline" @click="pendingDialog=null">Cancel</button><button type="submit" form="edit-pending-staff" class="cqs-button cqs-button-primary" :disabled="!canEditPending||!pendingEmailValid||(pendingRole==='CASHIER'&&!adminCounters.some(row=>row.id===pendingCounter))">Save assignment</button></template>
    </WorkspaceDialog>
    <WorkspaceDialog v-if="pendingCancel" title="Cancel pending assignment" @close="pendingCancel=null">
      <p>Cancel the {{ pendingCancel.role }} assignment for <strong>{{ pendingCancel.email }}</strong>?</p>
      <template #actions><button type="button" class="cqs-button cqs-button-outline" @click="pendingCancel=null">Keep assignment</button><button type="button" class="cqs-button cqs-button-primary" :disabled="!canEditPending" @click="cancelPending">Confirm cancellation</button></template>
    </WorkspaceDialog>
  </article>
</template>
