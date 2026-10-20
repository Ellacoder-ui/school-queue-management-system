import {shallowRef,watch,onMounted,onUnmounted} from 'vue'
import {queueApi} from '../lib/queue.js'
import {createAdminRecordReader} from '../lib/adminRecords.js'
import {normalizeStaffEmail} from '../lib/adminContracts.js'
import {createRecoveryTask} from '../lib/revalidation.js'
export function useAdminRecords(auth,publicState,management) {
 const staff=shallowRef({status:'idle',value:null}),lookup=shallowRef({status:'idle',value:null}),payors=shallowRef({status:'idle',value:null}),history=shallowRef({status:'idle',value:null})
 const actor=()=>auth.state.value.status==='ready'&&auth.state.value.context?.enabled&&auth.state.value.context.role==='ADMIN'?auth.getVerifiedActor():null
 const reader=state=>createAdminRecordReader(queueApi,{getActor:actor,onState:value=>{state.value=value}})
 const s=reader(staff),l=reader(lookup),p=reader(payors),h=reader(history)
 let active=false,filters={p_search:'',p_service:null,p_date:null,p_status:null,p_offset:0,p_limit:25},timer
 const refresh=()=>{if(!actor())return;void s.read('admin_staff_accounts');if(active)void p.read('admin_payors',filters)}
 const recover=createRecoveryTask(refresh,{visible:()=>document.visibilityState==='visible'})
 watch(()=>JSON.stringify([actor(),auth.state.value.status,auth.state.value.accountVersion,auth.state.value.context]),()=>{s.clear();l.clear();p.clear();h.clear();active=false;clearTimeout(timer);if(actor())refresh()},{immediate:true,flush:'sync'})
 watch(()=>publicState.value.queueVersion,()=>{if(active&&actor()) {clearTimeout(timer);timer=setTimeout(()=>p.read('admin_payors',filters,true),100)}})
 watch(()=>management.state.value.result, value=>{if(value&&actor()){void s.read('admin_staff_accounts',{},true);if(active)void p.read('admin_payors',filters,true)}})
 const visible=()=>recover.schedule()
 onMounted(()=>{window.addEventListener('focus',visible);window.addEventListener('online',visible);document.addEventListener('visibilitychange',visible)})
 onUnmounted(()=>{clearTimeout(timer);recover.stop();[s,l,p,h].forEach(x=>x.stop());window.removeEventListener('focus',visible);window.removeEventListener('online',visible);document.removeEventListener('visibilitychange',visible)})
 return {staff,lookup,payors,history,
  find:email=>l.read('resolve_staff_google',{p_email:normalizeStaffEmail(email)},true),clearLookup:()=>l.clear(),
  activate:tab=>{active=tab==='payors';if(tab==='staff')refresh();if(active)void p.read('admin_payors',filters)},
  query:value=>{filters={...value};h.clear();clearTimeout(timer);timer=setTimeout(()=>{if(active)void p.read('admin_payors',filters)},180)},
  events:id=>h.read('admin_payor_events',{p_ticket:id},true),clearHistory:()=>h.clear(),retry:refresh}
}
