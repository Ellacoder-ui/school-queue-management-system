/** Operator receipts only. All private subprocess output is captured and bounded. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {root,need,stable,digest,cleanEnv,validateRetained,privateBridge,retainedId} from './authOnlyCore.mjs';
import {AuthOnlyWorkflow,ConfigFile,loadReview,approveReview} from './authOnlyWorkflow.mjs';
import {retainedAuthEngine} from './authOnlyRetained.mjs';
export async function readOnlyGuard(request){return new Promise((resolve,reject)=>{
  const child=spawn('python',['-B',path.join(root,'scripts/auth_only_guard.py')],{cwd:root,env:cleanEnv(),windowsHide:true,stdio:['pipe','pipe','pipe']});
  let size=0;const chunks=[],timer=setTimeout(()=>{child.kill();reject(Error('AGO_GUARD_TIMEOUT'));},90000);
  child.stdout.on('data',b=>{size+=b.length;if(size>4194304)child.kill();else chunks.push(b);});
  child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
  child.on('error',()=>{clearTimeout(timer);reject(Error('AGO_GUARD_PROCESS'));});
  child.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(Error('AGO_READ_ONLY_GUARD_REJECTED'));
    try{const x=JSON.parse(Buffer.concat(chunks).toString('utf8'));need(x.result==='PASS','AGO_GUARD_RECEIPT');resolve(x);}catch{reject(Error('AGO_GUARD_RECEIPT'));}});
  child.stdin.end(stable(request));
});}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function waitHealthy(engine,id){const start=Date.now();while(Date.now()-start<60000){const x=await engine.inspect(id);
  need(x.State.Running && !x.State.Restarting,'AGO_AUTH_START_FAILED');
  if(x.State.Health?.Status==='healthy')return;
  need(x.State.Health?.Status!=='unhealthy','AGO_AUTH_UNHEALTHY');await pause(1000);
}throw Error('AGO_AUTH_HEALTH_TIMEOUT');}
const [mode,run,hash,replacement,rollbackHash]=process.argv.slice(2);
let receipt,exitCode=0;
try{
  if(mode==='preview'){
    need(process.argv.length===3,'AGO_ARGUMENTS');
    receipt={result:'PREVIEW_ONLY',affectedContainer:'supabase_auth_school-queue-local',approvalRequired:true,credentialContentsAccessed:false,retainedServiceChanged:false};
  }else if(mode==='verify-credential'){
    need(!process.stdin.isTTY && !process.stdout.isTTY && process.argv.length===5,'AGO_PRIVATE_IPC');
    const x=await loadReview(run);approveReview(x,hash);
    need(x.plan.runId===run && !x.plan.synthetic,'AGO_CREDENTIAL_PROFILE');
    const j=JSON.parse(fs.readFileSync(path.join(root,'.local-auth-only',run,'workflow-attempt.json'),'utf8'));
    need(j.approvedPlanSha256===hash && j.phase==='approved-before-credential-read','AGO_CREDENTIAL_RESERVATION');
    receipt={credentialReadApproved:true};
  }else if(mode==='prepare'){
    need(process.argv.length===3,'AGO_ARGUMENTS');
    const runId=crypto.randomBytes(4).toString('hex'),baseline=(await readOnlyGuard({phase:'capture'})).capture;
    const item=baseline.items.find(x=>x.Id===retainedId);validateRetained(item);
    const workflow=new AuthOnlyWorkflow({runId,engine:{names:{network:'supabase_network_school-queue-local'}},config:new ConfigFile(runId)});
    const prepared=await workflow.prepare(baseline,item);
    receipt={result:'PREPARED_NOT_ACTIVATED',runId,approvedPlanSha256:prepared.hash,expiresAt:prepared.plan.expiresAt,
      affectedContainer:item.Name.slice(1),originalId:item.Id,privateCredentialRead:false,retainedServiceChanged:false,plan:prepared.plan};
    fs.writeFileSync(path.join(root,`supabase/tests/results/auth_only_final_plan_${runId}.json`),stable(receipt),{flag:'wx'});
    delete receipt.plan; // The complete nonsecret plan is available in the receipt file.
  }else if(mode==='checkplan'){
    need(process.argv.length===5,'AGO_ARGUMENTS');
    const x=await loadReview(run);approveReview(x,hash);need(!x.plan.synthetic && x.plan.runId===run,'AGO_WORKFLOW_PROFILE');
    need(new ConfigFile(run).read().equals(Buffer.from(x.config,'base64')),'AGO_CONFIG_CHANGED');
    await readOnlyGuard({phase:'before',baseline:x.baseline});
    receipt={result:'PASS_PLAN_AND_CURRENT_SOURCE',runId:run,planSha256:hash,google:false,credentialContentsAccessed:false,retainedServiceChanged:false};
  }else{
    need(['activate','rollback'].includes(mode),'AGO_MODE');
    need(mode==='activate'?replacement==='confirm-auth-only' && process.argv.length===6:process.argv[7]==='confirm-auth-only-rollback' && process.argv.length===8,'AGO_EXPLICIT_APPROVAL_REQUIRED');
    const x=await loadReview(run);approveReview(x,hash,{expiry:mode==='activate'});
    const replacementId=mode==='rollback'?replacement:undefined;
    const engine=retainedAuthEngine(x.inspect,run,{review:x,hash,replacementId});
    const guard=async(review,phase,id)=>{
      if(phase==='after' || phase==='rollback-after')await waitHealthy(engine,phase==='after'?id:review.inspect.Id);
      await readOnlyGuard({phase,baseline:review.baseline,replacement:id});
    };
    const workflow=new AuthOnlyWorkflow({runId:run,engine,guard,config:new ConfigFile(run),
      credentials:approved=>privateBridge('AuthOnlyCredentialBridge.ps1',{operation:'read-production',runId:run,approvedPlanSha256:approved})});
    receipt=mode==='activate'?await workflow.activate(hash):await workflow.rollback(hash,rollbackHash,replacementId);
  }
}catch(e){
  receipt={result:'FAIL_STOPPED',failure:/^(AGO|VPR)_[A-Z_]+$/.test(e.message)?e.message:'AGO_SANITIZED_STOP',automaticRetryOrRollback:false};exitCode=1;
  if(/^[0-9a-f]{8}$/.test(run||'') && /^[0-9a-f]{64}$/.test(hash||'')){
    try{const j=JSON.parse(fs.readFileSync(path.join(root,'.local-auth-only',run,'activation-replacement.json'),'utf8'));
      receipt.replacementId=j.replacementId;receipt.rollbackApprovalSha256=digest({operation:'rollback',planHash:hash,replacementId:j.replacementId});}catch{}
  }
}
console.log(JSON.stringify(receipt));process.exitCode=exitCode;
