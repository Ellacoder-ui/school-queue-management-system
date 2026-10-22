const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(x)
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k))
const nullable=(x,check)=>x===null||check(x)
const text=x=>typeof x==='string'&&x.length<=320
const roles=['STUDENT','CASHIER','ADMIN'],codes=['TP','SOA','PNEP','REF','ADJ'],statuses=['WAITING','CALLED','SERVED','FORFEITED']
export const recordReads=new Set(['admin_staff_accounts','admin_pending_staff','resolve_staff_google','admin_payors','admin_payor_events'])
export function staffDirectoryRows(read,legacy=[],pendingRead) {
 let accounts
 if(read?.status==='ready')accounts=read.value
 else if(read?.status==='unavailable')accounts=legacy.filter(x=>['ADMIN','CASHIER'].includes(x.role))
 else return []
 const invitations=pendingRead?.status==='ready'?pendingRead.value:[]
 return [...accounts,...invitations.map(row=>({
  id:`pending:${row.id}`,invitation:row.id,email:row.email,role:row.role,enabled:false,
  google_verified:false,pending:true,counter:row.counter,created_at:row.created_at
 }))]
}
export function visibleAdminStaffRows(rows,actor) {
 return rows.filter(row=>row.id!==actor&&typeof row.email==='string'&&row.email.trim().length>0)
}
export function availableStaffCounters(counters,assignments,pendingAssignments) {
 const occupied=new Set([
  ...assignments.map(row=>row.counter_id),
  ...pendingAssignments.filter(row=>row.role==='CASHIER'&&row.counter).map(row=>row.counter)
 ])
 return counters.filter(row=>!occupied.has(row.id))
}
export function validateRecordRead(name,args,value) {
 if(name==='admin_staff_accounts') {
  if(!Array.isArray(value)||value.length>10000||new Set(value.map(x=>x.id)).size!==value.length||value.some(x=>!exact(x,['id','email','role','enabled','google_verified'])||!uuid(x.id)||!nullable(x.email,text)||!['ADMIN','CASHIER'].includes(x.role)||typeof x.enabled!=='boolean'||typeof x.google_verified!=='boolean'))throw Error('Invalid staff accounts')
 }else if(name==='admin_pending_staff') {
  if(!Array.isArray(value)||value.length>1000||new Set(value.map(x=>x.id)).size!==value.length||value.some(x=>!exact(x,['id','email','role','counter','created_at'])||!uuid(x.id)||!text(x.email)||x.email!==x.email.trim().toLowerCase()||!['ADMIN','CASHIER'].includes(x.role)||!(x.counter===null||uuid(x.counter))||(x.role==='ADMIN'?x.counter!==null:!uuid(x.counter))||!Number.isFinite(Date.parse(x.created_at))))throw Error('Invalid pending staff assignments')
 }else if(name==='resolve_staff_google') {
  if(value!==null&&(!exact(value,['id','email','role','enabled','identity_sha256','counter_ids'])||!uuid(value.id)||!text(value.email)||value.email!==args.p_email||!roles.includes(value.role)||typeof value.enabled!=='boolean'||!/^[0-9a-f]{64}$/.test(value.identity_sha256)||!Array.isArray(value.counter_ids)||value.counter_ids.some(x=>!uuid(x))||new Set(value.counter_ids).size!==value.counter_ids.length))throw Error('Invalid verified account')
 }else if(name==='admin_payors') {
  if(!exact(value,['rows','more','offset','limit'])||!Array.isArray(value.rows)||value.rows.length>args.p_limit||value.offset!==args.p_offset||value.limit!==args.p_limit||typeof value.more!=='boolean'||new Set(value.rows.map(x=>x.ticket_id)).size!==value.rows.length)throw Error('Invalid payor page')
  for(const x of value.rows)if(!exact(x,['ticket_id','owner_id','number','service','status','business_date','issued_at','counter_id','student_number','display_name'])||!uuid(x.ticket_id)||!uuid(x.owner_id)||!Number.isSafeInteger(x.number)||x.number<1||!codes.includes(x.service)||!statuses.includes(x.status)||!/^\d{4}-\d{2}-\d{2}$/.test(x.business_date)||!Number.isFinite(Date.parse(x.issued_at))||!nullable(x.counter_id,uuid)||!nullable(x.student_number,text)||!nullable(x.display_name,text))throw Error('Invalid payor row')
 }else if(name==='admin_payor_events') {
  if(!Array.isArray(value)||value.length>10000||value.some(x=>!exact(x,['event','at','status','counter_id'])||!['ISSUED','CALLED','SKIPPED','SERVED','FORFEITED'].includes(x.event)||!statuses.includes(x.status)||!Number.isFinite(Date.parse(x.at))||!nullable(x.counter_id,uuid)))throw Error('Invalid payor history')
 }
 return structuredClone(value)
}
export function validateRecordArgs(name,p) {
 if(name==='admin_staff_accounts'&&!exact(p,[]))throw Error('Invalid directory parameters')
 if(name==='admin_pending_staff'&&!exact(p,[]))throw Error('Invalid pending staff parameters')
 if(name==='resolve_staff_google'&&(!exact(p,['p_email'])||typeof p.p_email!=='string'||p.p_email.length>254||p.p_email!==p.p_email.trim().toLowerCase()||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.p_email)))throw Error('Invalid lookup')
 if(name==='admin_payor_events'&&(!exact(p,['p_ticket'])||!uuid(p.p_ticket)))throw Error('Invalid ticket')
 if(name==='admin_payors'&&(!exact(p,['p_search','p_service','p_date','p_status','p_offset','p_limit'])||typeof p.p_search!=='string'||p.p_search.length>100||!nullable(p.p_service,x=>codes.includes(x))||!nullable(p.p_status,x=>statuses.includes(x))||!nullable(p.p_date,x=>/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x)))||!Number.isInteger(p.p_offset)||p.p_offset<0||p.p_offset>100000||!Number.isInteger(p.p_limit)||p.p_limit<1||p.p_limit>50))throw Error('Invalid payor filters')
}

// One abortable/coalesced reader per view. Scope changes clear private results;
// background reads retain authorized rows, but a denial removes them immediately.
export function createAdminRecordReader(api,{getActor,onState=()=>{}}) {
 let generation=0,controller,pending,stopped=false,lastKey=null
 let state={status:'idle',value:null,refreshing:false}
 const emit=patch=>{if(!stopped){state={...state,...patch};onState(state)}}
 const clear=()=>{generation++;controller?.abort();pending=null;lastKey=null;emit({status:'idle',value:null,refreshing:false})}
 function read(name,args={},force=false){
  const actor=getActor(),key=JSON.stringify([actor,name,args])
  if(!actor||stopped){clear();return Promise.resolve()}
  if(pending&&key===lastKey&&!force)return pending
  const version=++generation,same=key===lastKey;lastKey=key;controller?.abort();controller=new AbortController();const c=controller
  emit({status:same&&state.status==='ready'?'ready':'loading',value:same?state.value:null,refreshing:true})
  const timer=setTimeout(()=>c.abort(),12000)
  const task=(async()=>{try{
   const value=await api.read(name,args,{expectedActor:actor,signal:c.signal})
   if(!stopped&&version===generation&&actor===getActor()&&!c.signal.aborted)emit({status:'ready',value})
  }catch(e){if(!stopped&&version===generation)emit({status:['PGRST202','42883'].includes(e.code)?'unavailable':e.code==='42501'||e.status===401||e.status===403?'restricted':'error',value:null})}
  finally{clearTimeout(timer);if(version===generation){pending=null;emit({refreshing:false})}}})()
  pending=task;return task
 }
 return {read,clear,getState:()=>state,stop(){clear();stopped=true}}
}
