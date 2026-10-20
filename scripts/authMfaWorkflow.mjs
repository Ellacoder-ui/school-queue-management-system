/** MFA-only review/orchestration. No credential-store read, retry or automatic rollback. */
import fs from 'node:fs';
import path from 'node:path';
import {root,need,names,digest,stable,storage,toCreate} from './authOnlyCore.mjs';
import {bytesHash} from './authOnlyWorkflow.mjs';
import {mfaCandidate,exactMfaDelta,mfaToml,mfaCode,MfaDisposableReconciler} from './authMfaPlan.mjs';
const profile='retained-capture';
const retainedConfigHash='e4d5c0c91d449e21a72074660abb150057b6c846fa0aa54470a572a4669677e0';
export async function loadMfaReview(run){names(run);return JSON.parse((await storage('open',run,'mfa-review',undefined,profile)).payload);}
export function approveMfaReview(x,hash,{expiry=true}={}){
  need(x.plan?.version===1 && x.plan.project==='school-queue-local' && x.plan.operation==='auth-only-totp' &&
    /^[0-9a-f]{8}$/.test(x.plan.runId) && typeof x.plan.synthetic==='boolean' && /^[0-9a-f]{64}$/.test(hash||'') && digest(x.plan)===hash,'AMF_REVIEW_APPROVAL');
  need(stable(x.plan.code)===stable(mfaCode()),'AMF_CODE_CHANGED');
  need(x.plan.originalId===x.inspect.Id && x.plan.inspectHash===digest(x.inspect) && x.plan.originalHash===digest(x.original) && x.plan.candidateHash===digest(x.candidate) &&
    x.plan.sourceHash===digest(x.baseline) && x.plan.configHash===bytesHash(Buffer.from(x.config,'base64')) &&
    x.plan.proposedConfigHash===bytesHash(Buffer.from(x.proposedConfig,'base64')),'AMF_REVIEW_BINDING');
  need(x.plan.synthetic || x.plan.configHash===retainedConfigHash,'AMF_TOML_BASELINE');
  need(!expiry || (Date.now()>=Date.parse(x.plan.createdAt) && Date.now()<Date.parse(x.plan.expiresAt) &&
    Date.parse(x.plan.expiresAt)-Date.parse(x.plan.createdAt)<=3600000),'AMF_PLAN_EXPIRED');
  exactMfaDelta(x.original,x.candidate);
  need(mfaToml(Buffer.from(x.config,'base64')).equals(Buffer.from(x.proposedConfig,'base64')),'AMF_TOML_DELTA');
}
export class MfaWorkflow{
  constructor({runId,engine,guard,config,synthetic=false}){names(runId);Object.assign(this,{runId,engine,guard,config,synthetic});}
  file(name){need(/^[a-z-]+\.json$/.test(name),'AMF_JOURNAL');return path.join(root,'.local-auth-only',this.runId,name);}
  journal(name,value){fs.writeFileSync(this.file(name),stable(value),{flag:'wx'});}
  async prepare(baseline,inspect){
    const original=toCreate(inspect,this.engine.names.network),candidate=mfaCandidate(original),config=this.config.read(),proposed=mfaToml(config);
    const createdAt=Date.now();
    const plan={version:1,project:'school-queue-local',operation:'auth-only-totp',runId:this.runId,synthetic:this.synthetic,
      originalId:inspect.Id,inspectHash:digest(inspect),originalHash:digest(original),candidateHash:digest(candidate),sourceHash:digest(baseline),
      configHash:bytesHash(config),proposedConfigHash:bytesHash(proposed),code:mfaCode(),createdAt:new Date(createdAt).toISOString(),expiresAt:new Date(createdAt+3600000).toISOString()};
    const x={plan,baseline,inspect,original,candidate,config:config.toString('base64'),proposedConfig:proposed.toString('base64')};
    approveMfaReview(x,digest(plan));
    await storage('seal',this.runId,'mfa-review',x,profile);
    need(stable(await loadMfaReview(this.runId))===stable(x),'AMF_REVIEW_READBACK');
    this.journal('mfa-review-plan.json',plan);return{plan,hash:digest(plan)};
  }
  async activate(hash){
    const x=await loadMfaReview(this.runId);approveMfaReview(x,hash);
    need(x.plan.runId===this.runId && x.plan.synthetic===this.synthetic,'AMF_PROFILE');
    need(this.config.read().equals(Buffer.from(x.config,'base64')),'AMF_CONFIG_CHANGED');
    this.journal('mfa-workflow-attempt.json',{approvedPlanSha256:hash});
    await this.guard(x,'before');
    const r=new MfaDisposableReconciler(this.engine),internal=await r.prepare('activation',x.inspect.Id,Buffer.from(x.config,'base64'));
    need(internal.plan.originalHash===x.plan.originalHash && internal.plan.candidateHash===x.plan.candidateHash,'AMF_CAPTURE_CHANGED');
    await this.guard(x,'before');
    this.config.set(Buffer.from(x.config,'base64'),Buffer.from(x.proposedConfig,'base64'));
    const start=Date.now(),id=await r.apply(internal.plan,internal.hash);
    await this.guard(x,'after',id);
    const result={result:'PASS_ACTIVATED',replacementId:id,planSha256:hash,rollbackApprovalSha256:r.rollbackHash(hash,id),downtimeToAcceptanceMs:Date.now()-start};
    this.journal('mfa-workflow-success.json',result);return result;
  }
  async rollback(hash,separateApproval,id){
    const x=await loadMfaReview(this.runId);approveMfaReview(x,hash,{expiry:false});
    need(x.plan.runId===this.runId && x.plan.synthetic===this.synthetic,'AMF_PROFILE');
    const r=new MfaDisposableReconciler(this.engine);
    need(separateApproval===r.rollbackHash(hash,id),'AMF_ROLLBACK_APPROVAL');
    const plan=JSON.parse(fs.readFileSync(this.file('activation-mfa-plan.json'),'utf8')),capture=await r.load(plan,digest(plan));
    if(this.engine.restoreBinding)await this.engine.restoreBinding(plan.slot+'-mfa',{...capture,plan:{...plan,originalId:plan.id,runId:plan.run}},id);
    await this.guard(x,'rollback-before',id);
    const current=this.config.read(),original=Buffer.from(x.config,'base64'),proposed=Buffer.from(x.proposedConfig,'base64');
    need(current.equals(original)||current.equals(proposed),'AMF_CONFIG_CHANGED');
    const restored=await r.rollback(plan,digest(plan),id,r.rollbackHash(digest(plan),id));
    if(current.equals(proposed))this.config.set(current,original);
    await this.guard(x,'rollback-after',id);
    this.journal('mfa-workflow-rollback.json',{result:'PASS_ROLLED_BACK',originalId:restored});return{result:'PASS_ROLLED_BACK',originalId:restored};
  }
}
