<script setup>
import { computed, ref, watch } from 'vue'
import { normalizeStaffEmail } from '../lib/adminContracts.js'
import { PENDING_STAFF_ASSIGNMENTS_RELEASED, STAFF_ACTIVATION_RELEASED, STAFF_MANAGEMENT_OWNER_ID } from '../lib/adminActivation.js'
import WorkspaceDialog from './WorkspaceDialog.vue'

const props = defineProps({ records: { type: Object, required: true }, counters: { type: Array, required: true }, locked: Boolean, actor: String, hideButton: Boolean })
const emit = defineEmits(['submit'])
const open = ref(false)
const email = ref('')
const role = ref('CASHIER')
const counter = ref('')
const valid = computed(() => {
  try { normalizeStaffEmail(email.value); return true } catch { return false }
})
const owner = computed(() => props.actor === STAFF_MANAGEMENT_OWNER_ID)
const pending = computed(() => props.records.pending || { status: 'unavailable', value: null })
const available = computed(() => props.records.staff.status === 'ready' && pending.value.status === 'ready')
const canSubmit = computed(() => STAFF_ACTIVATION_RELEASED && PENDING_STAFF_ASSIGNMENTS_RELEASED && owner.value
  && !props.locked && available.value && valid.value
  && (role.value === 'ADMIN' || props.counters.some(row => row.id === counter.value)))

function reset() {
  open.value = false
  email.value = ''
  role.value = 'CASHIER'
  counter.value = ''
}

function submit() {
  if (!canSubmit.value) return
  emit('submit', 'assign_staff_by_email', {
    p_email: normalizeStaffEmail(email.value),
    p_role: role.value,
    p_counter: role.value === 'CASHIER' ? counter.value : null
  })
  reset()
}

watch(() => props.actor, reset)
watch(() => props.counters.map(row => row.id).join(','), () => {
  if (!props.counters.some(row => row.id === counter.value)) counter.value = ''
})

defineExpose({ openStaff: () => { reset(); open.value = true } })
</script>

<template>
  <section v-if="!hideButton" class="cqs-staff-add">
    <div class="cqs-section-heading">
      <button type="button" class="cqs-button cqs-button-primary" data-testid="add-staff"
        :disabled="locked || !available || !STAFF_ACTIVATION_RELEASED || !PENDING_STAFF_ASSIGNMENTS_RELEASED || !owner"
        @click="reset(); open = true">Add Staff</button>
    </div>
    <p v-if="!available" class="cqs-notice" role="status" data-testid="add-staff-unavailable">Staff assignment options are unavailable. Refresh to try again.</p>
    <p v-else-if="!owner" class="cqs-notice" data-testid="staff-owner-only">Only the designated administrator can change staff access.</p>
  </section>
  <WorkspaceDialog v-if="open" title="Add Staff" @close="reset">
    <form id="admin-add-staff" @submit.prevent="submit">
      <label class="cqs-field">Staff Email<input v-model="email" type="email" maxlength="254" autocomplete="off" data-testid="staff-request-email" required></label>
      <p v-if="email && !valid" role="alert">Enter a valid email.</p>
      <label class="cqs-field">Role
        <select v-model="role" data-testid="staff-request-role"><option>CASHIER</option><option>ADMIN</option></select>
      </label>
      <label v-if="role === 'CASHIER'" class="cqs-field">Assigned Counter
        <select v-model="counter" data-testid="staff-request-counter" :required="props.counters.length > 0" :disabled="!props.counters.length">
          <option value="">Choose counter</option>
          <option v-for="row in props.counters" :key="row.id" :value="row.id">
            {{ row.label }} — {{ ['Tuition Payment', 'Statement of Account', 'Promissory Notes and Exam Permits', 'Refund Process', 'Adjustment Clerk'][row.number - 1] }} ({{ ['TP', 'SOA', 'PNEP', 'REF', 'ADJ'][row.number - 1] }})
          </option>
        </select>
      </label>
      <p v-if="role === 'CASHIER' && !props.counters.length" class="cqs-notice" role="status">No available counters.</p>
    </form>
    <template #actions>
      <button type="button" class="cqs-button cqs-button-outline" @click="reset">Cancel</button>
      <button type="submit" form="admin-add-staff" class="cqs-button cqs-button-primary" data-testid="staff-confirm"
        :disabled="!canSubmit || role === 'CASHIER' && !props.counters.length">Add Staff</button>
    </template>
  </WorkspaceDialog>
</template>
