<script setup>
import {computed,ref,watch} from 'vue'
import {normalizeStaffEmail} from '../lib/adminContracts.js'
import {STAFF_ACTIVATION_RELEASED} from '../lib/adminActivation.js'
import WorkspaceDialog from './WorkspaceDialog.vue'
const props=defineProps({records:{type:Object,required:true},counters:{type:Array,required:true},locked:Boolean,actor:String})
const emit=defineEmits(['find','clear','submit'])
const open=ref(false),email=ref(''),role=ref('CASHIER'),counter=ref('')
const valid=computed(()=>{try{normalizeStaffEmail(email.value);return true}catch{return false}})
const match=computed(()=>props.records.lookup.status==='ready'?props.records.lookup.value:null)
const available=computed(()=>props.records.staff.status==='ready')
const canConfirm=computed(()=>STAFF_ACTIVATION_RELEASED&&!props.locked&&match.value?.enabled&&match.value.role==='STUDENT'&&match.value.id!==props.actor&&match.value.counter_ids.length===0&&(role.value==='ADMIN'||props.counters.some(x=>x.id===counter.value)))
function close(){open.value=false;emit('clear');email.value='';counter.value=''}
function submit(){if(!canConfirm.value)return;emit('submit','add_verified_staff',{p_user:match.value.id,p_email:match.value.email,p_identity_sha256:match.value.identity_sha256,p_role:role.value,p_counter:role.value==='CASHIER'?counter.value:null});close()}
watch(email,()=>emit('clear'),{flush:'sync'})
watch(()=>props.actor,close)
</script>
<template>
 <section class="cqs-staff-add"><div class="cqs-section-heading"><h3>Add Staff</h3><button type="button" class="cqs-button cqs-button-primary" data-testid="add-staff" :disabled="locked||!available" @click="open=true;role='CASHIER'">Find registered account</button></div>

 <p v-if="records.staff.status==='unavailable'" class="cqs-notice" data-testid="add-staff-unavailable">Secure Google account matching and atomic staff activation require the proposed backend update. Add Staff is unavailable until that update is approved and installed.</p>
 <p v-else-if="!available" class="cqs-notice" role="status">{{ records.staff.status==='restricted'?'Current administrator authorization is insufficient.':records.staff.status==='error'?'Secure staff capabilities could not be verified.':'Checking secure staff capabilities…' }}</p>
 </section>
 <WorkspaceDialog v-if="open" title="Add Staff" @close="close">
  <form id="admin-add-staff" @submit.prevent="submit">
   <label class="cqs-field">Google email<input v-model="email" type="email" maxlength="254" autocomplete="off" data-testid="staff-request-email" required></label>
   <p v-if="email&&!valid" role="alert">Enter a valid staff email address.</p>
   <button type="button" class="cqs-button cqs-button-outline" data-testid="staff-resolve" :disabled="!valid||records.lookup.refreshing||locked" @click="emit('find',normalizeStaffEmail(email))">{{ records.lookup.refreshing?'Finding account…':'Find Google account' }}</button>
   <p v-if="records.lookup.status==='ready'&&!match" role="status">This account must sign in with Google before it can be added as staff.</p>
   <p v-if="['error','restricted','unavailable'].includes(records.lookup.status)" role="alert">{{ records.lookup.status==='restricted'?'Current administrator authorization is insufficient.':'Google account matching is unavailable. No access was changed.' }}</p>
   <div v-if="match" data-testid="staff-resolved-account" class="cqs-notice"><strong>{{ match.email }}</strong><span class="cqs-account-id">{{ match.id }}</span><p>Verified Google account · {{ match.role }} · {{ match.enabled?'Enabled':'Disabled' }}</p><p v-if="match.role!=='STUDENT'||!match.enabled||match.counter_ids.length||match.id===actor">This account is not eligible for Add Staff. Use existing staff management or trusted operator review.</p></div>
   <label class="cqs-field">Role<select v-model="role" data-testid="staff-request-role"><option>CASHIER</option><option>ADMIN</option></select></label>
   <label v-if="role==='CASHIER'" class="cqs-field">Counter assignment<select v-model="counter" data-testid="staff-request-counter" required><option value="">Choose counter</option><option v-for="row in counters" :key="row.id" :value="row.id">{{ row.label }} · {{ ['TP','SOA','PNEP','REF','ADJ'][row.number-1] }}</option></select></label>
   <p v-if="role==='ADMIN'" class="cqs-notice">Confirm ADMIN access for this exact account. Administrators can manage staff and queue configuration. No cashier assignment will be made.</p>
   <p v-else class="cqs-caption">Confirm CASHIER access and the selected fixed counter. Existing cashiers and counter availability are preserved.</p>
  </form>
  <p v-if="!STAFF_ACTIVATION_RELEASED" class="cqs-notice">Finding this account does not change its role or counter. Direct staff activation is not installed. No invitation or review request is submitted.</p>
  <template #actions><button type="button" class="cqs-button cqs-button-outline" @click="close">Cancel</button><button type="submit" form="admin-add-staff" class="cqs-button cqs-button-primary" data-testid="staff-confirm" :disabled="!canConfirm">{{ STAFF_ACTIVATION_RELEASED?'Add Staff':'Activation unavailable' }}</button></template>
 </WorkspaceDialog>
</template>
