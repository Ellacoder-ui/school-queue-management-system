/** Nonsecret operator receipts. Private inspection stays in bounded pipes and DPAPI. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {root,need,stable,cleanEnv,network} from './authOnlyCore.mjs';
import {ConfigFile} from './authOnlyWorkflow.mjs';
import {mfaDelta,validateMfaRetained,mfaRetainedId} from './authMfaPlan.mjs';
import {MfaWorkflow,loadMfaReview,approveMfaReview} from './authMfaWorkflow.mjs';
import {retainedMfaEngine} from './authOnlyRetained.mjs';
export async function mfaReadOnlyGuard(request){return new Promise((resolve,reject)=>{
  const child=spawn('python',['-B',path.join(root,'scripts/auth_mfa_guard.py')],{cwd:root,env:cleanEnv(),windowsHide:true,stdio:['pipe','pipe','pipe']});
  let size=0;const chunks=[],timer=setTimeout(()=>{child.kill();reject(Error('AMF_GUARD_TIMEOUT'));},90000);
  child.stdout.on('data',b=>{size+=b.length;if(size>4194304)child.kill();else chunks.push(b);});
  child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
  child.on('error',()=>{clearTimeout(timer);reject(Error('AMF_GUARD_PROCESS'));});
  child.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(Error('AMF_READ_ONLY_GUARD_REJECTED'));
    try{const x=JSON.parse(Buffer.concat(chunks).toString('utf8'));need(x.result==='PASS','AMF_GUARD_RECEIPT');resolve(x);}catch{reject(Error('AMF_GUARD_RECEIPT'));}});
  child.stdin.end(stable(request));
});}
export async function mfaHealthy(engine,id){const start=Date.now();while(Date.now()-start<60000){
  const x=await engine.inspect(id);need(x.State.Running && !x.State.Restarting,'AMF_AUTH_START_FAILED');
  if(x.State.Health?.Status==='healthy')return;
  need(x.State.Health?.Status!=='unhealthy','AMF_AUTH_UNHEALTHY');await new Promise(r=>setTimeout(r,1000));
}throw Error('AMF_AUTH_HEALTH_TIMEOUT');}
async function main(){
  const [mode,run,hash,replacement,rollbackHash]=process.argv.slice(2);let receipt,exit=0;
  try{
    if(mode==='preview'){
      need(process.argv.length===3,'AMF_ARGUMENTS');
      receipt={result:'PREVIEW_ONLY',affectedContainer:'supabase_auth_school-queue-local',approvalRequired:true,delta:mfaDelta,retainedServiceChanged:false};
    }else if(mode==='prepare'){
      need(process.argv.length===3,'AMF_ARGUMENTS');
      const runId=crypto.randomBytes(4).toString('hex'),baseline=(await mfaReadOnlyGuard({phase:'capture'})).capture;
      const item=baseline.items.find(x=>x.Id===mfaRetainedId);validateMfaRetained(item);
      const w=new MfaWorkflow({runId,engine:{names:{network}},config:new ConfigFile(runId)});
      const prepared=await w.prepare(baseline,item);
      await mfaReadOnlyGuard({phase:'before',baseline});
      receipt={result:'PASS_PREPARED',runId,planSha256:prepared.hash,expiresAt:prepared.plan.expiresAt,originalId:item.Id,delta:mfaDelta,retainedServiceChanged:false};
    }else if(mode==='checkplan'){
      need(process.argv.length===5,'AMF_ARGUMENTS');
      const x=await loadMfaReview(run);approveMfaReview(x,hash);need(!x.plan.synthetic && x.plan.runId===run,'AMF_PROFILE');
      validateMfaRetained(x.inspect);need(new ConfigFile(run).read().equals(Buffer.from(x.config,'base64')),'AMF_CONFIG_CHANGED');
      await mfaReadOnlyGuard({phase:'before',baseline:x.baseline});
      receipt={result:'PASS_PLAN_CHECKED',runId:run,planSha256:hash,expiresAt:x.plan.expiresAt,retainedServiceChanged:false};
    }else if(mode==='activate'||mode==='rollback'){
      need((mode==='activate' && process.argv.length===6 && process.argv[5]==='confirm-mfa-auth-only') ||
        (mode==='rollback' && process.argv.length===8 && process.argv[7]==='confirm-mfa-auth-only-rollback'),'AMF_EXPLICIT_APPROVAL_REQUIRED');
      const x=await loadMfaReview(run);approveMfaReview(x,hash,{expiry:mode==='activate'});
      const engine=await retainedMfaEngine(x.inspect,run,{review:x,hash,replacementId:mode==='rollback'?replacement:undefined});
      const guard=async(review,phase,id)=>{
        if(phase==='after')await mfaHealthy(engine,id);
        if(phase==='rollback-after')await mfaHealthy(engine,x.inspect.Id);
        await mfaReadOnlyGuard({phase,baseline:review.baseline,replacement:id});
      };
      const w=new MfaWorkflow({runId:run,engine,guard,config:new ConfigFile(run)});
      receipt=mode==='activate'?await w.activate(hash):await w.rollback(hash,rollbackHash,replacement);
    }else throw Error('AMF_ARGUMENTS');
  }catch(error){exit=1;receipt={result:'FAIL_STOPPED',code:/^(AMF|AGO)_[A-Z0-9_]+$/.test(error.message||'')?error.message:'AMF_STOPPED_PRIVATE_DIAGNOSTICS_SUPPRESSED',automaticRetry:false,automaticRollback:false};
    if(/^[0-9a-f]{8}$/.test(run||'')){
      try{const id=JSON.parse(fs.readFileSync(path.join(root,'.local-auth-only',run,'activation-mfa-replacement.json'),'utf8')).id;
        need(/^[0-9a-f]{64}$/.test(id),'AMF_ID');receipt.replacementId=id;
        receipt.rollbackApprovalSha256=crypto.createHash('sha256').update(stable({operation:'rollback-mfa-only',planHash:hash,replacementId:id})).digest('hex');
      }catch{}
    }
  }
  console.log(JSON.stringify(receipt));process.exitCode=exit;
}
if(process.argv[1] && path.resolve(process.argv[1])===path.join(root,'scripts/authMfaCli.mjs'))await main();
