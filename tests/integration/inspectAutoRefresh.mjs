// Fixed read-only observation; no RPC mutation, DDL or service operation.
import { readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { QueueFixture, preservationQuery, need, digest } from './queueFixture.mjs'
import { validateLocalPublicConfig } from '../../src/lib/supabaseConfig.js'
const f=new QueueFixture(),run=randomUUID().slice(0,8),close=process.argv.includes('--closeout')
const path='.local-browser/admin-auto-refresh/baseline.json'
try {
  const services=await f.retained(),inventory=await f.inventory(),source=JSON.parse(f.retainedRead(preservationQuery))
  need(source.cluster==='7696959712798593061','AUTO_WRONG_CLUSTER')
  const extra=JSON.parse(f.retainedRead(`select jsonb_build_object('requests',(select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) from queue_private.staff_review_requests t),'factors',(select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) from auth.mfa_factors t))`))
  const metadata=JSON.parse(f.retainedRead(`select jsonb_build_object(
    'publication_tables',(select jsonb_agg(jsonb_build_object('publication',pubname,'schema',schemaname,'table',tablename) order by pubname,schemaname,tablename) from pg_publication_tables where schemaname in ('queue_display','queue_private','auth')),
    'publication_options',(select jsonb_agg(jsonb_build_object('name',pubname,'insert',pubinsert,'update',pubupdate,'delete',pubdelete) order by pubname) from pg_publication where pubname='supabase_realtime'),
    'projection_permissions',(select jsonb_agg(jsonb_build_object('table',c.relname,'rls',c.relrowsecurity,'replica_identity',c.relreplident,'anon_select',has_table_privilege('anon',c.oid,'SELECT'),'authenticated_select',has_table_privilege('authenticated',c.oid,'SELECT')) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='queue_display' and c.relname in ('counter_state','service_state')),
    'private_browser_usage',has_schema_privilege('authenticated','queue_private','USAGE'),
    'admin_role',(select role from queue_private.accounts where id='5c96debb-697f-4cad-805f-92b518e28343'),
    'school_role',(select role from queue_private.accounts where id='b7d9aee8-c54d-455f-9913-a4c4dea0d097'),
    'accounts',(select count(*) from queue_private.accounts),'requests',(select count(*) from queue_private.staff_review_requests),
    'migration007_absent',to_regclass('queue_private.staff_access_approvals') is null,
    'routes',(select jsonb_agg(c.number::text||':'||s.code order by c.number) from queue_private.counters c join queue_private.counter_services cs on cs.counter_id=c.id join queue_private.services s on s.id=cs.service_id))`))
  need(metadata.admin_role==='ADMIN'&&metadata.school_role==='STUDENT'&&!metadata.private_browser_usage,'AUTO_AUTHORIZATION_CHANGED')
  need(metadata.projection_permissions.length===2&&metadata.projection_permissions.every(x=>x.anon_select&&x.authenticated_select),'AUTO_PUBLIC_PERMISSIONS')
  need(metadata.publication_options?.length===1&&metadata.publication_options.every(x=>x.insert&&x.update&&x.delete),'AUTO_PUBLICATION_EVENTS')
  need(JSON.stringify(metadata.routes)===JSON.stringify(['1:TP','2:SOA','3:PNEP','4:REF','5:ADJ']),'AUTO_ROUTING_CHANGED')
  const current={source,extra,metadata,services,inventory}
  const result={run,observedAt:new Date().toISOString(),result:'PASS_READ_ONLY_BASELINE',metadata,retainedWrites:false}
  if(!close)writeFileSync(path,JSON.stringify(current),{flag:'wx'})
  else {
    const before=JSON.parse(readFileSync(path,'utf8'))
    result.changedRowTables=Object.keys(source.rows).filter(k=>source.rows[k]!==before.source.rows[k])
    result.functionsPreserved=source.functions===before.source.functions
    result.privateRequestsAndFactorsPreserved=digest(extra)===digest(before.extra)
    result.definitionsPreserved=services.every(x=>before.services.some(b=>b.id===x.id&&b.definition===x.definition))&&services.length===before.services.length
    result.nonVectorLifecyclesPreserved=services.filter(x=>!x.name.includes('vector')).every(x=>before.services.some(b=>b.id===x.id&&b.started===x.started&&b.restarts===x.restarts&&b.running===x.running))
    result.newContainers=inventory.containers.filter(x=>!before.inventory.containers.includes(x));result.newNetworks=inventory.networks.filter(x=>!before.inventory.networks.includes(x))
    result.existingResourcesPreserved=['containers','networks','volumes'].every(k=>before.inventory[k].every(x=>inventory[k].includes(x)))
    result.volumesPreserved=digest(inventory.volumes)===digest(before.inventory.volumes)
    const owned=new Map([
      ['16c2c138b1fd27c36184f55a55bba816adba6a21cd91216c45e75cc9e852094e','ff9aa066'],['afe6d2b35ca85a2bd2e24e96e5ec6491eb92bcc3451c82eb806202d434d987dd','ff9aa066']])
    // Bind all exact fixture IDs from this task's immutable successful run receipt.
    const staff=JSON.parse(readFileSync('tests/integration/results/add_staff_01cdebd6.json','utf8'))
    need(staff.result==='PASS'&&staff.run==='01cdebd6'&&staff.containers.length===2,'AUTO_FIXTURE_RECEIPT')
    for(const id of staff.containers){need(/^[0-9a-f]{64}$/.test(id),'AUTO_FIXTURE_ID');owned.set(id,'01cdebd6')}
    const inspected=spawnSync('docker',['inspect',...owned.keys()],{encoding:'utf8',windowsHide:true});need(inspected.status===0,'AUTO_FIXTURE_INSPECTION')
    result.ownedContainersStopped=JSON.parse(inspected.stdout).every(x=>owned.has(x.Id)&&!x.State.Running&&x.Config.Labels['school-queue.phase3.fixture']===owned.get(x.Id))
    const networks=spawnSync('docker',['network','inspect','sq-queue-01cdebd6-net','sq-queue-ff9aa066-net'],{encoding:'utf8',windowsHide:true});need(networks.status===0,'AUTO_NETWORK_INSPECTION')
    const createdNetworks=JSON.parse(networks.stdout);need(createdNetworks.every(x=>['01cdebd6','ff9aa066'].includes(x.Labels['school-queue.phase3.fixture'])),'AUTO_NETWORK_LABELS')
    result.exactResourceDelta=digest([...result.newContainers].sort())===digest([...owned.keys()].sort())&&digest([...result.newNetworks].sort())===digest(createdNetworks.map(x=>x.Id).sort())
    const cli=spawnSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','--output','json'],{encoding:'utf8',windowsHide:true});need(cli.status===0,'AUTO_PUBLIC_CONFIGURATION')
    const config=JSON.parse(cli.stdout),pub=config.PUBLISHABLE_KEY||config.ANON_KEY;validateLocalPublicConfig(config.API_URL,pub);need(config.API_URL==='http://127.0.0.1:54321','AUTO_WRONG_API')
    const headers={apikey:pub},health=await fetch(config.API_URL+'/auth/v1/health',{headers}),settings=await fetch(config.API_URL+'/auth/v1/settings',{headers}),api=await fetch(config.API_URL+'/rest/v1/counter_state?select=counter_label',{headers:{...headers,'Accept-Profile':'queue_display'}})
    result.health={auth:health.status,settings:settings.status,anonymousApi:api.status,googleEnabled:(await settings.json()).external?.google===true}
    need(health.status===200&&settings.status===200&&api.status===200&&result.health.googleEnabled,'AUTO_HEALTH_CHANGED')
    result.result=result.changedRowTables.length||!result.functionsPreserved||!result.privateRequestsAndFactorsPreserved||!result.definitionsPreserved||!result.nonVectorLifecyclesPreserved||!result.existingResourcesPreserved||!result.volumesPreserved||!result.exactResourceDelta||!result.ownedContainersStopped?'FAIL_PRESERVATION_DIFFERENCE':'PASS_READ_ONLY_CLOSEOUT'
    if(result.result.startsWith('FAIL'))process.exitCode=1
  }
  const evidence=`tests/integration/results/admin_auto_refresh_${close?'closeout':'baseline'}_${run}.json`;writeFileSync(evidence,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify({...result,evidence}))
} catch(error){console.log(JSON.stringify({result:'FAIL_STOPPED',code:/^AUTO_[A-Z_]+$/.test(error.message||'')?error.message:'AUTO_INSPECTION_STOPPED'}));process.exitCode=1}
