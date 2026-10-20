<script setup>
import {computed,ref,watch} from 'vue'
import {ticketLabel} from '../lib/workspaceData.js'
import WorkspaceDialog from './WorkspaceDialog.vue'
const props=defineProps({state:{type:Object,required:true},history:{type:Object,required:true},counters:{type:Array,default:()=>[]}})
const emit=defineEmits(['query','events','close-history','retry'])
const search=ref(''),service=ref(''),date=ref(''),status=ref(''),offset=ref(0),selected=ref(null)
const filters=()=>({p_search:search.value.trim(),p_service:service.value||null,p_date:date.value||null,p_status:status.value||null,p_offset:offset.value,p_limit:25})
watch([search,service,date,status],()=>{offset.value=0;emit('query',filters())})
function page(delta){offset.value+=delta*25;emit('query',filters())}
const rows=computed(()=>props.state.status==='ready'?props.state.value.rows:[])
const counter=id=>props.counters.find(x=>x.id===id)?.label||'Not recorded'
function close(){selected.value=null;emit('close-history')}
</script>
<template>
 <div>
 <section class="cqs-card" data-testid="payor-management"><h2>Payor Management</h2>
 <p class="cqs-caption">Queue records belonging to current STUDENT accounts. A skipped ticket returns to WAITING; SKIPPED appears in its history.</p>
 <div class="cqs-payor-filters"><label class="cqs-field">Search payors<input v-model="search" type="search" maxlength="100" placeholder="Ticket, verified profile or account UUID" data-testid="payor-search"></label><label class="cqs-field">Service<select v-model="service"><option value="">All services</option><option v-for="code in ['TP','SOA','PNEP','REF','ADJ']" :key="code">{{ code }}</option></select></label><label class="cqs-field">Queue date<input v-model="date" type="date"></label><label class="cqs-field">Status<select v-model="status"><option value="">All statuses</option><option v-for="s in ['WAITING','CALLED','SERVED','FORFEITED']" :key="s">{{ s }}</option></select></label></div>
 <p v-if="state.status==='unavailable'" class="cqs-notice" data-testid="payor-unavailable">Payor history requires the proposed ADMIN-only read endpoint. It is not installed locally. No payor records can be shown yet.</p>
 <p v-else-if="state.status!=='ready'" class="cqs-notice" role="status">{{ state.status==='restricted'?'Administrator access is required.':state.status==='error'?'Payor records are unavailable.':'Loading authorized payor records…' }} <button v-if="state.status==='error'" class="cqs-link" @click="emit('retry')">Retry</button></p>
 <template v-else><span v-if="state.refreshing" role="status">Updating payor records…</span><div class="cqs-table-scroll" tabindex="0" aria-label="Payor queue records"><table class="cqs-table"><thead><tr><th>Ticket / date</th><th>Payor</th><th>Service / counter</th><th>Status</th><th>History</th></tr></thead><tbody><tr v-for="row in rows" :key="row.ticket_id"><td><strong>{{ ticketLabel(row) }}</strong><small class="cqs-account-id">{{ row.business_date }}<br>{{ new Date(row.issued_at).toLocaleString('en-PH',{timeZone:'Asia/Manila'}) }}</small></td><td>{{ row.display_name || row.student_number || row.owner_id }}</td><td>{{ row.service }}<small class="cqs-account-id">{{ counter(row.counter_id) }}</small></td><td>{{ row.status }}</td><td><button class="cqs-link" @click="selected=row;emit('events',row.ticket_id)">Ticket history</button></td></tr><tr v-if="!rows.length"><td colspan="5" class="cqs-empty">No queued payors match these filters.</td></tr></tbody></table></div><div class="cqs-payor-pages"><button class="cqs-button cqs-button-outline" :disabled="offset===0||state.refreshing" @click="page(-1)">Previous</button><span>Page {{ offset/25+1 }}</span><button class="cqs-button cqs-button-outline" :disabled="!state.value.more||state.refreshing" @click="page(1)">Next</button></div></template>
 </section>
 <WorkspaceDialog v-if="selected" :title="'Ticket history · '+ticketLabel(selected)" @close="close"><p class="cqs-caption">Most recent 100 events, shown in chronological order.</p><p v-if="history.status!=='ready'" role="status">{{ history.status==='loading'?'Loading ticket history…':'Ticket history unavailable.' }}</p><ol v-else><li v-for="(e,i) in history.value" :key="i">{{ e.event }} → {{ e.status }} · {{ new Date(e.at).toLocaleString('en-PH',{timeZone:'Asia/Manila'}) }} · {{ counter(e.counter_id) }}</li></ol><template #actions><button class="cqs-button cqs-button-outline" @click="close">Close</button></template></WorkspaceDialog>
 </div>
</template>
