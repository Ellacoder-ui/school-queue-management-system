// Handoff verification only: every retained SQL transaction is READ ONLY.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {QueueFixture,preservationQuery,digest,need} from './queueFixture.mjs'
import {validateRecordRead} from '../../src/lib/adminRecords.js'
const f=new QueueFixture(),close=process.argv.includes('--closeout'),dir='.local-browser/admin-handoff'
const q=x=>"'"+String(x).replaceAll("'","''")+"'"
const admin='5c96debb-697f-4cad-805f-92b518e28343'
const readAs=(id,query)=>f.retainedRead(`set local role authenticated;set local request.jwt.claim.sub=${q(id)};${query}`).trim()
mkdirSync(dir,{recursive:true})
try{
 const services=await f.retained(),inventory=await f.inventory(),source=JSON.parse(f.retainedRead(preservationQuery))
 need(source.cluster==='7696959712798593061','HANDOFF_WRONG_CLUSTER')
 const sql=readFileSync('supabase/20261020001100_admin_readonly.PROPOSED.sql','utf8');need(digest(Buffer.from(sql))==='3ed88ab2633a56650e27e931ff07e4684d24df0f67680c2e486725a4d8d423ed','HANDOFF_READONLY_SOURCE_CHANGED')
 const definitions=[...sql.matchAll(/create function (queue_private|queue_api)\.(\w+)\([\s\S]*?\bas \$\$([\s\S]*?)\$\$;/gi)]
 need(definitions.length===5,'HANDOFF_SOURCE_COUNT')
 const functions=JSON.parse(f.retainedRead(`select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'args',oidvectortypes(p.proargtypes),'result',pg_get_function_result(p.oid),'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'settings',p.proconfig,'body',p.prosrc,'execute',(select jsonb_agg(coalesce(r.rolname,'public') order by coalesce(r.rolname,'public')) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x left join pg_roles r on r.oid=x.grantee where x.privilege_type='EXECUTE'))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname,p.proname) in (${definitions.map(x=>`(${q(x[1])},${q(x[2])})`).join(',')})`))
 need(functions.length===5,'HANDOFF_FUNCTION_COUNT')
 for(const x of functions){const d=definitions.find(d=>d[1]===x.schema&&d[2]===x.name);need(d&&x.body.trim()===d[3].trim()&&x.owner==='postgres'&&x.definer&&JSON.stringify(x.settings)===JSON.stringify(['search_path=""'])&&JSON.stringify(x.execute)===JSON.stringify(x.schema==='queue_private'?['postgres']:['authenticated','postgres']),'HANDOFF_INSTALLED_DEFINITION_MISMATCH')}
 const extra=JSON.parse(f.retainedRead(`select jsonb_build_object('requests',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from queue_private.staff_review_requests t),'factors',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from auth.mfa_factors t),'acl',(select md5(string_agg(row(p.oid,p.proacl,p.proowner,p.proconfig)::text,'' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('queue_api','queue_private','queue_display')),'migrations',(select md5(string_agg(to_jsonb(m)::text,'' order by version)) from supabase_migrations.schema_migrations m))`))
 const metadata=JSON.parse(f.retainedRead(`select jsonb_build_object('database',current_database(),'operator',current_user,'version',current_setting('server_version'),'roles',(select jsonb_object_agg(role,n) from (select role,count(*) n from queue_private.accounts group by role) x),'admin_enabled',(select enabled from queue_private.accounts where id=${q(admin)}),'personal_role',(select role from queue_private.accounts where id=${q(admin)}),'school_role',(select role from queue_private.accounts where id='b7d9aee8-c54d-455f-9913-a4c4dea0d097'),'add_staff_absent',not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='queue_api' and p.proname='add_verified_staff'),'007_absent',to_regclass('queue_private.staff_access_approvals') is null,'application_migrations',(select count(*) from supabase_migrations.schema_migrations),'tickets',(select count(*) from queue_private.tickets),'assignments',(select count(*) from queue_private.staff_counter_assignments),'pending',(select count(*) from queue_private.staff_review_requests),'routes',(select jsonb_agg(c.number::text||':'||s.code order by c.number) from queue_private.counters c join queue_private.counter_services x on x.counter_id=c.id join queue_private.services s on s.id=x.service_id))`))
 need(metadata.database==='postgres'&&metadata.operator==='postgres'&&metadata.personal_role==='ADMIN'&&metadata.admin_enabled&&metadata.add_staff_absent&&metadata['007_absent'],'HANDOFF_AUTHORIZATION_OR_SCOPE')
 const staff=JSON.parse(readAs(admin,'select queue_api.admin_staff_accounts()'));validateRecordRead('admin_staff_accounts',{},staff)
 const targetEmail='bmabing62681@liceo.edu.ph',target=JSON.parse(readAs(admin,`select queue_api.resolve_staff_google(${q(targetEmail)})`));validateRecordRead('resolve_staff_google',{p_email:targetEmail},target);need(target,'HANDOFF_TARGET_NOT_VERIFIED')
 const targetState=JSON.parse(f.retainedRead(`select jsonb_build_object('id',a.id,'role',a.role,'enabled',a.enabled,'google_verified',queue_private.admin_google_binding_v10(a.id) is not null,'verified_factors',(select count(*) from auth.mfa_factors where user_id=a.id and status='verified'),'assignments',(select count(*) from queue_private.staff_counter_assignments where account_id=a.id),'active_tickets',(select count(*) from queue_private.tickets where owner_id=a.id and status in ('WAITING','CALLED')),'pending_requests',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'role',requested_role,'status',status,'bound',bound_user is not null,'expired',expires_at<=statement_timestamp())),'[]') from queue_private.staff_review_requests where email=${q(targetEmail)})) from queue_private.accounts a where a.id=${q(target.id)}`))
 const filters={p_search:'',p_service:null,p_date:null,p_status:null,p_offset:0,p_limit:25},payors=JSON.parse(readAs(admin,'select queue_api.admin_payors()'));validateRecordRead('admin_payors',filters,payors)
 const byStatus={};for(const status of ['WAITING','CALLED','SERVED','FORFEITED']){const page=JSON.parse(readAs(admin,`select queue_api.admin_payors(p_status=>${q(status)})`));validateRecordRead('admin_payors',{...filters,p_status:status},page);need(page.rows.every(x=>x.status===status),'HANDOFF_FILTER_MISMATCH');byStatus[status]=page.rows.length}
 const page2=JSON.parse(readAs(admin,'select queue_api.admin_payors(p_offset=>25)'));validateRecordRead('admin_payors',{...filters,p_offset:25},page2)
 let historyCount=null;if(payors.rows.length){const events=JSON.parse(readAs(admin,`select queue_api.admin_payor_events(${q(payors.rows[0].ticket_id)})`));validateRecordRead('admin_payor_events',{},events);historyCount=events.length}
 const cashier=f.retainedRead("select id from queue_private.accounts where role='CASHIER' and enabled order by id limit 1").trim();need(/^[0-9a-f-]{36}$/.test(cashier),'HANDOFF_CASHIER_CONTEXT')
 const probes=[`queue_api.admin_staff_accounts()`,`queue_api.resolve_staff_google(${q(targetEmail)})`,`queue_api.admin_payors()`,`queue_api.admin_payor_events(${q(payors.rows[0]?.ticket_id||'00000000-0000-4000-8000-000000000000')})`]
 for(const id of [target.id,cashier])for(const call of probes)readAs(id,`do $deny$ begin begin perform ${call};raise exception 'Expected denial missing';exception when sqlstate '42501' then null;end;end $deny$`)
 const authCounts=JSON.parse(f.retainedRead(`select jsonb_build_object('users',(select count(*) from auth.users),'identities',(select count(*) from auth.identities),'personal_factors',(select count(*) from auth.mfa_factors where user_id=${q(admin)}),'personal_verified_factors',(select count(*) from auth.mfa_factors where user_id=${q(admin)} and status='verified'),'all_factors',(select count(*) from auth.mfa_factors))`))
 const report={observedAt:new Date().toISOString(),retainedWrites:false,result:'PASS',metadata,authCounts,functions:functions.map(({body,...x})=>({...x,body_sha256:digest(body)})),directory:{rows:staff.length,roles:[...new Set(staff.map(x=>x.role))],googleVerified:staff.filter(x=>x.google_verified).length},target:{email:targetEmail,identity_sha256:target.identity_sha256,...targetState},payors:{firstPage:payors.rows.length,more:payors.more,nextPage:page2.rows.length,historyCount,byStatus},studentCashierDenials:8,realBrowserJwt:false}
 const current={source,extra,services,inventory}
 if(!close)writeFileSync(dir+'/baseline.json',JSON.stringify(current),{flag:'wx'})
 else{
  const before=JSON.parse(readFileSync(dir+'/baseline.json','utf8'))
  report.rowsAndFunctionsPreserved=digest(source)===digest(before.source)
  report.requestsFactorsAclMigrationsPreserved=digest(extra)===digest(before.extra)
  report.servicesPreserved=services.every((x,i)=>x.id===before.services[i].id&&x.definition===before.services[i].definition&&(x.name.includes('vector')||digest(x)===digest(before.services[i])))
  report.resourcesPreserved=['containers','networks','volumes'].every(k=>before.inventory[k].every(x=>inventory[k].includes(x)))
  report.volumesPreserved=digest(inventory.volumes)===digest(before.inventory.volumes)
  const expected={containers:[],networks:[]}
  for(const run of ['f96ad8f6','f8e99429']){
   const receipt=JSON.parse(readFileSync(`tests/integration/results/admin_final_${run}.json`,'utf8'))
   need(receipt.result==='PASS'&&receipt.stopped===true&&receipt.retained_preservation===true,'HANDOFF_FIXTURE_RECEIPT')
   expected.containers.push(...receipt.containers)
   const inspect=spawnSync('docker',['network','inspect',receipt.network],{encoding:'utf8',windowsHide:true});need(inspect.status===0,'HANDOFF_FIXTURE_NETWORK')
   const [network]=JSON.parse(inspect.stdout);need(network.Name===`sq-queue-${run}-net`&&network.Labels?.['school-queue.phase3.fixture']===run,'HANDOFF_FIXTURE_NETWORK')
   expected.networks.push(network.Id)
   const containers=spawnSync('docker',['inspect',...receipt.containers],{encoding:'utf8',windowsHide:true});need(containers.status===0,'HANDOFF_FIXTURE_CONTAINERS')
   need(JSON.parse(containers.stdout).every(x=>!x.State.Running&&x.Config.Labels?.['school-queue.phase3.fixture']===run&&[`/sq-queue-${run}-db`,`/sq-queue-${run}-rest`].includes(x.Name)),'HANDOFF_FIXTURE_CONTAINERS')
  }
  report.exactOwnedResourceDelta=['containers','networks'].every(k=>digest(inventory[k].filter(x=>!before.inventory[k].includes(x)))===digest(expected[k].sort()))
  report.disposableResources={stoppedContainers:expected.containers.length,networks:expected.networks.length}
  if(!report.rowsAndFunctionsPreserved||!report.requestsFactorsAclMigrationsPreserved||!report.servicesPreserved||!report.resourcesPreserved||!report.volumesPreserved||!report.exactOwnedResourceDelta){
   report.result='FAIL_STOPPED';report.changedTables=Object.keys(source.rows).filter(k=>source.rows[k]!==before.source.rows[k])
   writeFileSync('tests/integration/results/admin_handoff_closeout.json',JSON.stringify(report,null,2),{flag:'wx'})
   throw Error('HANDOFF_PRESERVATION_DIFFERENCE')
  }
 }
 const cli=spawnSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','--output','json'],{encoding:'utf8',windowsHide:true});need(cli.status===0,'HANDOFF_PUBLIC_CONFIG');const cfg=JSON.parse(cli.stdout);need(cfg.API_URL==='http://127.0.0.1:54321','HANDOFF_API_TARGET');const headers={apikey:cfg.PUBLISHABLE_KEY||cfg.ANON_KEY}
 const responses=await Promise.all([fetch(cfg.API_URL+'/auth/v1/health',{headers}),fetch(cfg.API_URL+'/auth/v1/settings',{headers}),fetch(cfg.API_URL+'/rest/v1/counter_state?select=counter_label',{headers:{...headers,'Accept-Profile':'queue_display'}})]);report.health={auth:responses[0].status,settings:responses[1].status,api:responses[2].status,google:(await responses[1].json()).external?.google===true};need(responses.every(x=>x.status===200)&&report.health.google,'HANDOFF_HEALTH')
 const path=`tests/integration/results/admin_handoff_${close?'closeout':'baseline'}.json`;writeFileSync(path,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify(report))
}catch(e){console.log(JSON.stringify({result:'FAIL_STOPPED',code:/^HANDOFF_[A-Z_]+$/.test(e.message||'')?e.message:'HANDOFF_INSPECTION_STOPPED'}));process.exitCode=1}
