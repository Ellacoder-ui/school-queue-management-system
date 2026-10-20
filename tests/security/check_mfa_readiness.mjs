// Fixed read-only retained closeout. No mutation, credential-store or factor API.
import http from 'node:http'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { QueueFixture, need, preservationQuery } from '../integration/queueFixture.mjs'
import { environment, stable } from '../../scripts/authOnlyCore.mjs'
const run=randomBytes(4).toString('hex'),guard=new QueueFixture(run),file=`supabase/tests/results/retained_mfa_readiness_${run}.json`
const report={run,result:'IN_PROGRESS',retained_writes:false}
try{
  const before=await guard.retained(),rows=guard.retainedRead(preservationQuery).trim()
  const auth=before.find(x=>x.name==='/supabase_auth_school-queue-local')
  need(auth?.id==='565adceacab15cd43c7e00d5cee19345bc34f6ab981b35d5dc2ba4f8cdd4f399','AMF_RETAINED_AUTH_CHANGED')
  const item=await new Promise((resolve,reject)=>{
    const request=http.get({socketPath:'//./pipe/dockerDesktopLinuxEngine',path:`/v1.56/containers/${auth.id}/json`,timeout:15000},response=>{
      const chunks=[];let size=0;response.on('data',b=>{size+=b.length;if(size>1048576)request.destroy();else chunks.push(b)})
      response.on('end',()=>{try{need(response.statusCode===200,'AMF_INSPECT_STATUS');resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))}catch{reject(Error('AMF_PRIVATE_INSPECT'))}})
    });request.on('timeout',()=>request.destroy());request.on('error',()=>reject(Error('AMF_PRIVATE_INSPECT')))
  })
  const env=environment(item.Config.Env)
  need(env.GOTRUE_EXTERNAL_GOOGLE_ENABLED==='true'&&env.GOTRUE_MFA_TOTP_ENROLL_ENABLED==='false'&&env.GOTRUE_MFA_TOTP_VERIFY_ENABLED==='false','AMF_RETAINED_FLAGS_CHANGED')
  report.configuration={google:true,totpEnroll:false,totpVerify:false,authHealthy:item.State.Health?.Status==='healthy'}
  need(report.configuration.authHealthy,'AMF_AUTH_HEALTH')
  const target=JSON.parse(guard.retainedRead(`select json_build_object('cluster',(select system_identifier::text from pg_control_system()),
    'id',u.id,'account_id',a.id,'role',a.role,'enabled',a.enabled,'email_matches',lower(u.email)='eabeso63122@liceo.edu.ph',
    'verified_factors',(select count(*) from auth.mfa_factors f where f.user_id=u.id and f.status='verified'),
    'factor_count',(select count(*) from auth.mfa_factors f where f.user_id=u.id),
    'google_identities',(select count(*) from auth.identities i where i.user_id=u.id and i.provider='google'),
    'binding_sha256',(select encode(sha256(convert_to(jsonb_build_object('user_id',u.id,'identity_id',i.id,'provider',i.provider,'provider_id',i.provider_id,'subject',i.identity_data->>'sub','email',lower(u.email),'identity_email',lower(i.identity_data->>'email'),'email_verified',i.identity_data->>'email_verified')::text,'UTF8')),'hex') from auth.identities i where i.user_id=u.id and i.provider='google'),
    'staff_proposal_unapplied',to_regclass('queue_private.staff_access_approvals') is null)
    from auth.users u join queue_private.accounts a on a.id=u.id where u.id='b7d9aee8-c54d-455f-9913-a4c4dea0d097';`).trim())
  need(target.cluster==='7696959712798593061'&&target.id===target.account_id&&target.role==='STUDENT'&&target.enabled&&target.email_matches&&target.factor_count===0&&target.verified_factors===0&&target.google_identities===1&&target.binding_sha256==='7b236769634b0910b034c035cc1422021f2281be9d6fd77d5c882ffd9ed86bbd'&&target.staff_proposal_unapplied,'AMF_TARGET_OR_SECURITY_CHANGED')
  report.target=target
  const status=spawnSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','--output','json'],{encoding:'utf8',windowsHide:true})
  need(status.status===0,'AMF_PUBLIC_STATUS');const config=JSON.parse(status.stdout),pub=config.PUBLISHABLE_KEY||config.ANON_KEY
  need(config.API_URL==='http://127.0.0.1:54321'&&pub&&!pub.startsWith('sb_secret_'),'AMF_LOCAL_API')
  const headers={apikey:pub,Authorization:`Bearer ${pub}`}
  const health=await fetch(config.API_URL+'/auth/v1/health',{headers,redirect:'error',signal:AbortSignal.timeout(12000)})
  const settings=await fetch(config.API_URL+'/auth/v1/settings',{headers,redirect:'error',signal:AbortSignal.timeout(12000)})
  const api=await fetch(config.API_URL+'/rest/v1/counter_state?select=counter_label',{headers:{...headers,'Accept-Profile':'queue_display'},redirect:'error',signal:AbortSignal.timeout(12000)})
  report.http={auth:health.status,settings:settings.status,api:api.status,google:(await settings.json()).external?.google===true}
  need(health.status===200&&settings.status===200&&api.status===200&&report.http.google,'AMF_HTTP_HEALTH')
  need(rows===guard.retainedRead(preservationQuery).trim(),'AMF_RETAINED_ROW_CHANGE')
  const after=await guard.retained()
  need(after.every((row,i)=>row.name.includes('vector')?row.id===before[i].id&&row.definition===before[i].definition:stable(row)===stable(before[i])),'AMF_RETAINED_SERVICE_CHANGE')
  report.preservation=true;report.result='PASS'
}catch(error){report.result='FAIL';report.failure=/^AMF_[A-Z_]+$/.test(error.message||'')?error.message:'AMF_READONLY_CLOSEOUT_STOPPED';process.exitCode=1}
fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'})
console.log(JSON.stringify({result:report.result,evidence:file}))
