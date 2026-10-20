import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mfaCandidate, exactMfaDelta, mfaToml, activateRetainedMfa } from '../../scripts/authMfaPlan.mjs'
import { authImage } from '../../scripts/authOnlyCore.mjs'
import { digest } from '../../scripts/authOnlyCore.mjs'
import { mfaCode, validateMfaRetained } from '../../scripts/authMfaPlan.mjs'
import { approveMfaReview } from '../../scripts/authMfaWorkflow.mjs'
import { bytesHash } from '../../scripts/authOnlyWorkflow.mjs'
import { retainedMfaEngine } from '../../scripts/authOnlyRetained.mjs'
import { mfaHealthy } from '../../scripts/authMfaCli.mjs'
const original={Image:authImage,Env:['GOTRUE_MFA_TOTP_ENROLL_ENABLED=false','GOTRUE_MFA_TOTP_VERIFY_ENABLED=false','GOTRUE_EXTERNAL_GOOGLE_ENABLED=true','GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID=fixture','GOTRUE_EXTERNAL_GOOGLE_SECRET=PRIVATE_DUMMY','GOTRUE_SITE_URL=http://127.0.0.1:5173','GOTRUE_URI_ALLOW_LIST=http://127.0.0.1:5173/auth/callback','GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI=http://127.0.0.1:54321/auth/v1/callback','GOTRUE_EXTERNAL_GOOGLE_SKIP_NONCE_CHECK=false','GOTRUE_EXTERNAL_GOOGLE_EMAIL_OPTIONAL=false','GOTRUE_JWT_SECRET=JWT_DUMMY','GOTRUE_DB_DATABASE_URL=DATABASE_DUMMY','GOTRUE_SMTP_HOST=unchanged'],HostConfig:{NetworkMode:'fixture'},NetworkingConfig:{EndpointsConfig:{fixture:{Aliases:['auth','canonical']}}},Cmd:['auth']}
test('MFA plan preserves Google, JWT/database/email and full container fields',()=>{
  const candidate=mfaCandidate(original);exactMfaDelta(original,candidate)
  assert.equal(candidate.Env.filter((v,i)=>v!==original.Env[i]).length,2)
  assert.deepEqual(candidate.HostConfig,original.HostConfig);assert.deepEqual(candidate.NetworkingConfig,original.NetworkingConfig)
})
test('the retained image tag is preserved exactly while unreviewed tags are rejected',()=>{
  const tagged={...original,Image:'public.ecr.aws/supabase/gotrue:v2.197.0'}
  assert.equal(mfaCandidate(tagged).Image,tagged.Image)
  assert.throws(()=>mfaCandidate({...tagged,Image:'public.ecr.aws/supabase/gotrue:latest'}))
})
test('MFA plan rejects changes to image, aliases, unrelated keys and existing Google secrets',()=>{
  for(const change of [x=>{x.Image='other'},x=>{x.NetworkingConfig.EndpointsConfig.fixture.Aliases=[]},x=>{x.Env.push('UNEXPECTED=true')},x=>{x.Env[x.Env.findIndex(v=>v.startsWith('GOTRUE_EXTERNAL_GOOGLE_SECRET='))]='GOTRUE_EXTERNAL_GOOGLE_SECRET=changed'}]){
    const candidate=mfaCandidate(original);change(candidate);assert.throws(()=>exactMfaDelta(original,candidate))
  }
})
test('MFA plan refuses missing, enabled or duplicate baseline flags',()=>{
  for(const env of [original.Env.filter(v=>!v.startsWith('GOTRUE_MFA_TOTP_ENROLL_ENABLED=')),original.Env.map(v=>v==='GOTRUE_MFA_TOTP_ENROLL_ENABLED=false'?v.replace('false','true'):v),[...original.Env,'GOTRUE_MFA_TOTP_VERIFY_ENABLED=false']])assert.throws(()=>mfaCandidate({...original,Env:env}))
})
test('MFA TOML preserves all existing bytes and rejects an already configured MFA section',()=>{
  const source=Buffer.from('[auth.external.google]\nenabled = true\n'),next=mfaToml(source)
  assert.ok(next.subarray(0,source.length).equals(source));assert.match(next.toString(),/\[auth.mfa.totp\]\nenroll_enabled = true\nverify_enabled = true/)
  assert.throws(()=>mfaToml(next))
})
test('retained MFA execution has no unlock or environment bypass',()=>{assert.throws(()=>activateRetainedMfa(),/AMF_RETAINED_EXECUTION_LOCKED/)})
function review(){
  const config=Buffer.from('[auth.external.google]\nenabled = true\n'),proposed=mfaToml(config)
  const x={inspect:{Id:'a'.repeat(64)},original, candidate:mfaCandidate(original),baseline:{credential:['metadata-only'],source:'opaque'},config:config.toString('base64'),proposedConfig:proposed.toString('base64')}
  x.plan={version:1,project:'school-queue-local',operation:'auth-only-totp',runId:'1234abcd',synthetic:true,
    originalId:x.inspect.Id,inspectHash:digest(x.inspect),originalHash:digest(x.original),candidateHash:digest(x.candidate),sourceHash:digest(x.baseline),
    configHash:bytesHash(config),proposedConfigHash:bytesHash(proposed),code:mfaCode(),createdAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()}
  return x
}
test('fresh MFA review accepts only exact plan approval and binds its operation/profile',()=>{
  const x=review();approveMfaReview(x,digest(x.plan));assert.throws(()=>approveMfaReview(x,'0'.repeat(64)))
  for(const key of ['project','operation','version','runId']){const y=review();y.plan[key]='other';assert.throws(()=>approveMfaReview(y,digest(y.plan)))}
})
test('MFA review independently binds source, full inspect, candidate, TOML and code',()=>{
  for(const change of [x=>x.baseline.source='different',x=>x.inspect.State={Running:false},x=>x.candidate.Cmd=['different'],x=>x.proposedConfig=Buffer.from('different').toString('base64'),x=>x.plan.code['scripts/authMfaCli.mjs']='changed']){
    const x=review();change(x);assert.throws(()=>approveMfaReview(x,digest(x.plan)))
  }
})
test('a recomputed candidate/TOML hash cannot authorize unrelated security changes',()=>{
  const x=review();x.candidate.Env.push('UNRELATED=changed');x.plan.candidateHash=digest(x.candidate);assert.throws(()=>approveMfaReview(x,digest(x.plan)),/UNRELATED_CHANGE/)
  const y=review();y.proposedConfig=Buffer.from(Buffer.from(y.proposedConfig,'base64').toString()+'\n[other]\nenabled=true\n').toString('base64');y.plan.proposedConfigHash=bytesHash(Buffer.from(y.proposedConfig,'base64'));assert.throws(()=>approveMfaReview(y,digest(y.plan)),/TOML_DELTA/)
})
test('MFA activation expires after one hour; separately approved rollback still binds code after expiry',()=>{
  const x=review();x.plan.expiresAt=new Date(Date.now()-1).toISOString();assert.throws(()=>approveMfaReview(x,digest(x.plan)),/EXPIRED/);approveMfaReview(x,digest(x.plan),{expiry:false})
  x.plan.createdAt=new Date(Date.now()+1000).toISOString();x.plan.expiresAt=new Date(Date.now()+10000).toISOString();assert.throws(()=>approveMfaReview(x,digest(x.plan)),/EXPIRED/)
  x.plan.code['scripts/authMfaCli.mjs']='changed';assert.throws(()=>approveMfaReview(x,digest(x.plan),{expiry:false}),/CODE_CHANGED/)
})
test('retained MFA validation rejects the old Google container and wrong identity before transport',()=>{
  for(const id of ['9f7742bf04e680d82988376411720e3500c9c0c069b0e57de5b7f3dc3ebb4ef6','b'.repeat(64)])assert.throws(()=>validateMfaRetained({Id:id}),/RETAINED_IDENTITY/)
})
test('a disposable review cannot open retained transport even with its exact approval hash',async()=>{
  const x=review();await assert.rejects(()=>retainedMfaEngine(x.inspect,x.plan.runId,{review:x,hash:digest(x.plan)}),/RETAINED_AUTHORIZATION/)
})
test('a failed Auth start or unhealthy check stops acceptance without a retry',async()=>{
  for(const state of [{Running:false,Restarting:false},{Running:true,Restarting:false,Health:{Status:'unhealthy'}}]){
    let inspections=0;await assert.rejects(()=>mfaHealthy({inspect:async()=>{inspections++;return{State:state}}},'fixture'),/AMF_AUTH_(START_FAILED|UNHEALTHY)/)
    assert.equal(inspections,1)
  }
})
