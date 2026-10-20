// Fixed retained inspection: every SQL transaction is repeatable-read READ ONLY.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {QueueFixture,preservationQuery,digest,need} from './queueFixture.mjs'
const f=new QueueFixture(),close=process.argv.includes('--closeout'),dir='.local-browser/admin-live-mfa'
mkdirSync(dir,{recursive:true})
try{
 const services=await f.retained(),inventory=await f.inventory(),source=JSON.parse(f.retainedRead(preservationQuery))
 need(source.cluster==='7696959712798593061','ALM_WRONG_CLUSTER')
 const security=JSON.parse(f.retainedRead(`select jsonb_build_object('factors',(select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) from auth.mfa_factors x),'requests',(select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) from queue_private.staff_review_requests x),'migrations',(select md5(string_agg(to_jsonb(x)::text,'' order by version)) from supabase_migrations.schema_migrations x),'acl',(select md5(string_agg(row(p.oid,p.proacl,p.proconfig,p.proowner)::text,'' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('queue_private','queue_api','queue_display')))`))
 const metadata=JSON.parse(f.retainedRead(`select jsonb_build_object('accounts',(select count(*) from queue_private.accounts),'tickets',(select count(*) from queue_private.tickets),'events',(select count(*) from queue_private.ticket_events),'assignments',(select count(*) from queue_private.staff_counter_assignments),'migrations',(select count(*) from supabase_migrations.schema_migrations),'personal_role',(select role from queue_private.accounts where id='5c96debb-697f-4cad-805f-92b518e28343'),'personal_enabled',(select enabled from queue_private.accounts where id='5c96debb-697f-4cad-805f-92b518e28343'),'personal_factors',(select count(*) from auth.mfa_factors where user_id='5c96debb-697f-4cad-805f-92b518e28343'),'personal_verified_factors',(select count(*) from auth.mfa_factors where user_id='5c96debb-697f-4cad-805f-92b518e28343' and status='verified'),'school_role',(select role from queue_private.accounts where id='b7d9aee8-c54d-455f-9913-a4c4dea0d097'),'007_absent',to_regclass('queue_private.staff_access_approvals') is null,'012_absent',to_regprocedure('queue_api.add_verified_staff(uuid,text,text,text,uuid,uuid)') is null,'routes',(select jsonb_agg(c.number::text||':'||s.code order by c.number) from queue_private.counters c join queue_private.counter_services cs on cs.counter_id=c.id join queue_private.services s on s.id=cs.service_id),'projection_calls_match',not exists(select 1 from queue_private.counters c left join queue_private.tickets t on t.counter_id=c.id and t.status='CALLED' left join queue_private.services s on s.id=t.service_id left join queue_display.counter_state p on p.counter_id=c.id where p.counter_id is null or p.is_open is distinct from c.is_open or p.ticket_label is distinct from (case when t.id is not null then s.code||'-'||case when t.sequence_number<1000 then lpad(t.sequence_number::text,3,'0') else t.sequence_number::text end end)),'called',(select count(*) from queue_private.tickets where status='CALLED'),'published_tables',(select jsonb_agg(schemaname||'.'||tablename order by tablename) from pg_publication_tables where pubname='supabase_realtime'))`))
 need(metadata.personal_role==='ADMIN'&&metadata.personal_enabled&&metadata.school_role==='STUDENT'&&metadata['007_absent']&&metadata['012_absent']&&metadata.projection_calls_match,'ALM_TARGET_OR_PROJECTION')
 const cli=spawnSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','--output','json'],{encoding:'utf8',windowsHide:true});need(cli.status===0,'ALM_PUBLIC_CONFIG');const cfg=JSON.parse(cli.stdout);need(cfg.API_URL==='http://127.0.0.1:54321','ALM_WRONG_GATEWAY')
 const headers={apikey:cfg.PUBLISHABLE_KEY||cfg.ANON_KEY},rs=await Promise.all([fetch(cfg.API_URL+'/auth/v1/health',{headers}),fetch(cfg.API_URL+'/auth/v1/settings',{headers}),fetch(cfg.API_URL+'/rest/v1/counter_state?select=counter_label,is_open,ticket_label,service_code,business_date',{headers:{...headers,'Accept-Profile':'queue_display'}})])
 const health={auth:rs[0].status,settings:rs[1].status,api:rs[2].status,google:(await rs[1].json()).external?.google===true}
 const capability=spawnSync('python',['-B','-c','from scripts.auth_mfa_capability import auth_totp_enabled; print(auth_totp_enabled())'],{encoding:'utf8',windowsHide:true});need(capability.status===0,'ALM_MFA_CAPABILITY');health.totpEnabled=capability.stdout.trim()==='True'
 need(rs.every(x=>x.status===200)&&health.google&&health.totpEnabled,'ALM_HEALTH')
 const report={observedAt:new Date().toISOString(),readOnly:true,metadata,health,publicCounters:await rs[2].json(),realMfaPerformed:false}
 if(!close)writeFileSync(dir+'/baseline.json',JSON.stringify({source,security,services,inventory}),{flag:'wx'})
 else{
  const before=JSON.parse(readFileSync(dir+'/baseline.json','utf8'))
  report.fullSourcePreserved=digest(source)===digest(before.source)
  report.changedTables=Object.keys(source.rows).filter(k=>source.rows[k]!==before.source.rows[k])
  report.applicationRowsPreserved=Object.keys(source.rows).filter(k=>k.startsWith('queue_')).every(k=>source.rows[k]===before.source.rows[k])
  report.functionsPreserved=source.functions===before.source.functions
  report.securityPreserved=digest(security)===digest(before.security)
  report.servicesPreserved=services.every((x,i)=>x.id===before.services[i].id&&x.definition===before.services[i].definition&&(x.name.includes('vector')||digest(x)===digest(before.services[i])))
  report.volumesPreserved=digest(inventory.volumes)===digest(before.inventory.volumes)
  report.existingResourcesPreserved=['containers','networks','volumes'].every(k=>before.inventory[k].every(x=>inventory[k].includes(x)))
  report.addedResources=Object.fromEntries(['containers','networks'].map(k=>[k,inventory[k].filter(x=>!before.inventory[k].includes(x))]))
  const expected={containers:[],networks:[]}
  const receipts=['f7bbc428','f6c52b3d','f5754d35','f43a2941','f3f30955','f2e9d840'].map(run=>({run,label:'school-queue.auth-only-rehearsal',receipt:JSON.parse(readFileSync(`supabase/tests/results/account_mfa_interface_${run}.json`,'utf8'))}))
  const queue=JSON.parse(readFileSync('tests/integration/results/full_stack_browser_f065b356.json','utf8'))
  need(queue.owned_containers_stopped&&queue.retained_preservation,'ALM_QUEUE_RECEIPT')
  receipts.push({run:'f065b356',label:'school-queue.phase3.fixture',receipt:{...queue.owned_resources,stopped:true,retainedPreservation:true}})
  for(const {run,label,receipt} of receipts){
   need(receipt.stopped&&receipt.retainedPreservation,'ALM_FIXTURE_RECEIPT')
   const net=spawnSync('docker',['network','inspect',receipt.network],{encoding:'utf8',windowsHide:true});need(net.status===0,'ALM_NETWORK_INSPECTION');const [network]=JSON.parse(net.stdout);need(network.Labels?.[label]===run,'ALM_NETWORK_LABEL');expected.networks.push(network.Id)
   const inspect=spawnSync('docker',['inspect',...receipt.containers],{encoding:'utf8',windowsHide:true});need(inspect.status===0,'ALM_CONTAINER_INSPECTION');const items=JSON.parse(inspect.stdout);need(items.length===receipt.containers.length&&items.every(x=>receipt.containers.includes(x.Id)&&!x.State.Running&&x.Config.Labels?.[label]===run),'ALM_CONTAINER_LABEL')
   expected.containers.push(...receipt.containers)
  }
  report.exactOwnedResourceDelta=['containers','networks'].every(k=>digest(report.addedResources[k])===digest(expected[k].sort()))
 }
 report.result=!close||report.fullSourcePreserved&&report.functionsPreserved&&report.securityPreserved&&report.servicesPreserved&&report.volumesPreserved&&report.existingResourcesPreserved&&report.exactOwnedResourceDelta?'PASS':'FAIL_STOPPED'
 writeFileSync(`tests/integration/results/admin_live_${close?'closeout':'baseline'}.json`,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify(report));if(report.result!=='PASS')process.exitCode=1
}catch{console.log(JSON.stringify({result:'FAIL_STOPPED',detail:'Read-only inspection failed; private diagnostics suppressed'}));process.exitCode=1}
