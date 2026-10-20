// Fixed read-only closeout. Never creates a request, changes an account or operates a service.
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { QueueFixture, need, digest, preservationQuery } from './queueFixture.mjs'
import { validateLocalPublicConfig } from '../../src/lib/supabaseConfig.js'
const base=JSON.parse(readFileSync('.local-browser/add-staff-frontend/baseline.json','utf8'))
const fixture=new QueueFixture(),run=randomUUID().slice(0,8)
const owned=['78bdd0d064dd8da35cf3675cd0c5d35f57dca34abc5a3bf9361c57e2107e10db','f36b0dda66168ea5b9390626562bf50f177fef7720a6cce86b3c424a981115a5']
function docker(args){const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true});need(r.status===0,'ASF_RESOURCE_INSPECTION');return JSON.parse(r.stdout)}
try {
  const services=await fixture.retained(),inventory=await fixture.inventory()
  const source=JSON.parse(fixture.retainedRead(preservationQuery).trim())
  const changedRowTables=Object.keys(source.rows).filter(name=>source.rows[name]!==base.source.rows[name])
  const sourcePreserved=digest(source)===digest(base.source)
  const extra=JSON.parse(fixture.retainedRead(`select jsonb_build_object('review_requests',(select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) from queue_private.staff_review_requests t),'factors',(select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) from auth.mfa_factors t))`).trim())
  need(digest(extra)===digest(base.extraRows),'ASF_PRIVATE_ROWS_CHANGED')
  for(const old of base.services){const actual=services.find(x=>x.id===old.id);need(actual&&actual.definition===old.definition&&actual.image===old.image,'ASF_SERVICE_DEFINITION_CHANGED');if(!old.name.includes('vector'))need(actual.started===old.started&&actual.restarts===old.restarts&&actual.running===old.running,'ASF_SERVICE_LIFECYCLE_CHANGED')}
  need(services.length===base.services.length,'ASF_PROJECT_INVENTORY_CHANGED')
  const created=docker(['inspect',...owned]);need(created.every(x=>!x.State.Running&&x.Config.Labels['school-queue.phase3.fixture']==='00a01ecb'),'ASF_FIXTURE_NOT_STOPPED')
  const [network]=docker(['network','inspect','sq-queue-00a01ecb-net'])
  need(network.Labels['school-queue.phase3.fixture']==='00a01ecb','ASF_FIXTURE_NETWORK')
  need(digest(inventory.containers)===digest([...base.inventory.containers,...owned].sort())&&digest(inventory.networks)===digest([...base.inventory.networks,network.Id].sort())&&digest(inventory.volumes)===digest(base.inventory.volumes),'ASF_RESOURCE_DELTA_CHANGED')
  const facts=JSON.parse(fixture.retainedRead(`select jsonb_build_object('accounts',(select count(*) from queue_private.accounts),'requests',(select count(*) from queue_private.staff_review_requests),'personal_role',(select role from queue_private.accounts where id='5c96debb-697f-4cad-805f-92b518e28343'),'school_role',(select role from queue_private.accounts where id='b7d9aee8-c54d-455f-9913-a4c4dea0d097'),'migration007_absent',to_regclass('queue_private.staff_access_approvals') is null,'routes',(select jsonb_agg(jsonb_build_object('counter',c.number,'service',s.code) order by c.number) from queue_private.counters c join queue_private.counter_services cs on cs.counter_id=c.id join queue_private.services s on s.id=cs.service_id),'application_rls',(select bool_and(relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='queue_private' and c.relkind='r'))`).trim())
  need(facts.accounts===42&&facts.requests===0&&facts.personal_role==='ADMIN'&&facts.school_role==='STUDENT'&&facts.migration007_absent&&facts.application_rls,'ASF_AUTHORIZATION_CHANGED')
  need(JSON.stringify(facts.routes)===JSON.stringify(['TP','SOA','PNEP','REF','ADJ'].map((service,i)=>({counter:i+1,service}))),'ASF_ROUTE_CHANGED')
  const status=spawnSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','--output','json'],{encoding:'utf8',windowsHide:true})
  need(status.status===0,'ASF_PUBLIC_CONFIGURATION_UNAVAILABLE');const config=JSON.parse(status.stdout),pub=config.PUBLISHABLE_KEY||config.ANON_KEY
  validateLocalPublicConfig(config.API_URL,pub);need(config.API_URL==='http://127.0.0.1:54321','ASF_WRONG_API')
  const headers={apikey:pub},health=await fetch(config.API_URL+'/auth/v1/health',{headers}),settings=await fetch(config.API_URL+'/auth/v1/settings',{headers}),api=await fetch(config.API_URL+'/rest/v1/counter_state?select=counter_label',{headers:{...headers,'Accept-Profile':'queue_display'}})
  need(health.status===200&&settings.status===200&&api.status===200,'ASF_HEALTH_FAILED');const google=(await settings.json()).external?.google;need(google===true,'ASF_GOOGLE_DISABLED')
  const receipt={run,result:sourcePreserved?'PASS_READ_ONLY_CLOSEOUT':'FAIL_SOURCE_FINGERPRINT_CHANGED',observedAt:new Date().toISOString(),cluster:source.cluster,facts,sourceRowsAndFunctionsPreserved:sourcePreserved,changedRowTables,functionDefinitionsPreserved:source.functions===base.source.functions,staffRequestAndMfaRowsPreserved:true,serviceDefinitionsPreserved:true,nonVectorLifecyclesPreserved:true,allowedNewContainers:owned,allowedNewNetwork:network.Id,volumesPreserved:true,authHealth:health.status,settingsHealth:settings.status,anonymousApi:api.status,googleEnabled:google,retainedWrites:false}
  const path=`tests/integration/results/add_staff_closeout_${run}.json`;writeFileSync(path,JSON.stringify(receipt,null,2),{flag:'wx'});console.log(JSON.stringify({...receipt,evidence:path}));if(!sourcePreserved)process.exitCode=1
} catch(error){console.log(JSON.stringify({result:'FAIL_STOPPED',code:/^ASF_[A-Z_]+$/.test(error.message||'')?error.message:'ASF_CLOSEOUT_STOPPED'}));process.exitCode=1}
