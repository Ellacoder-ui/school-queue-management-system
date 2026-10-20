/** Final orchestration, shared by the retained entry point and isolated rehearsal.
 * Review uses credential metadata only. Decryption occurs after explicit approval.
 * No retry, automatic rollback, deletion, or unrelated service operation. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {root,need,names,stable,digest,codeBinding,storage,AuthReconciler,toCreate,proposedToml,environment} from './authOnlyCore.mjs';
export const bytesHash=b=>crypto.createHash('sha256').update(b).digest('hex');
const profile='retained-capture';
export async function loadReview(runId){names(runId);return JSON.parse((await storage('open',runId,'review',undefined,profile)).payload);}
export function approveReview(x,hash,{expiry=true}={}){
  need(x.plan?.version===1 && x.plan.project==='school-queue-local' && x.plan.operation==='auth-only-google' &&
    /^[0-9a-f]{64}$/.test(hash||'') && digest(x.plan)===hash,'AGO_REVIEW_APPROVAL');
  need(stable(x.plan.code)===stable(codeBinding()),'AGO_CODE_CHANGED');
  need(x.plan.originalHash===digest(x.original) && x.plan.sourceHash===digest(x.baseline) &&
    x.plan.credentialMetadataHash===digest(x.baseline.credential) && x.plan.originalId===x.inspect.Id &&
    x.plan.configHash===bytesHash(Buffer.from(x.config,'base64')) &&
    x.plan.proposedConfigHash===bytesHash(Buffer.from(x.proposedConfig,'base64')),'AGO_REVIEW_BINDING');
  need(!expiry || (Date.now()>=Date.parse(x.plan.createdAt) && Date.now()<Date.parse(x.plan.expiresAt)),'AGO_PLAN_EXPIRED');
  need(proposedToml(Buffer.from(x.config,'base64')).equals(Buffer.from(x.proposedConfig,'base64')),'AGO_CONFIG_DELTA');
}
export class ConfigFile{
  constructor(runId,synthetic=false){names(runId);this.runId=runId;this.file=path.join(root,synthetic?`.local-auth-only/${runId}/fixture-config.toml`:'supabase/config.toml');}
  read(){for(let p=this.file;p!==root;p=path.dirname(p)){need(!fs.lstatSync(p).isSymbolicLink(),'AGO_CONFIG_REPARSE');}return fs.readFileSync(this.file);}
  set(expected,next){
    need(this.read().equals(expected),'AGO_CONFIG_CHANGED');
    const before=fs.statSync(this.file),temp=this.file+'.'+this.runId+'.new',fd=fs.openSync(temp,'wx',0o600);
    try{fs.writeFileSync(fd,next);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    const now=fs.statSync(this.file);
    need(now.ino===before.ino && now.size===before.size && now.mtimeMs===before.mtimeMs && this.read().equals(expected),'AGO_CONFIG_CONCURRENT_CHANGE');
    fs.renameSync(temp,this.file);need(this.read().equals(next),'AGO_CONFIG_READBACK');
  }
}
export class AuthOnlyWorkflow{
  constructor({runId,engine,guard,credentials,config,synthetic=false}){names(runId);Object.assign(this,{runId,engine,guard,credentials,config,synthetic});}
  file(name){need(/^[a-z-]+\.json$/.test(name),'AGO_WORKFLOW_JOURNAL');return path.join(root,'.local-auth-only',this.runId,name);}
  journal(name,value){fs.writeFileSync(this.file(name),stable(value),{flag:'wx'});}
  async prepare(baseline,inspect){
    const config=this.config.read(),proposed=proposedToml(config),original=toCreate(inspect,this.engine.names.network);
    const plan={version:1,project:'school-queue-local',operation:'auth-only-google',runId:this.runId,synthetic:this.synthetic,
      originalId:inspect.Id,originalHash:digest(original),sourceHash:digest(baseline),credentialMetadataHash:digest(baseline.credential),
      configHash:bytesHash(config),proposedConfigHash:bytesHash(proposed),code:codeBinding(),createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString()};
    const x={plan,baseline,inspect,original,config:config.toString('base64'),proposedConfig:proposed.toString('base64')};
    await storage('seal',this.runId,'review',x,profile);
    need(stable(await loadReview(this.runId))===stable(x),'AGO_REVIEW_READBACK');
    this.journal('review-plan.json',plan);return {plan,hash:digest(plan)};
  }
  async activate(hash){
    const x=await loadReview(this.runId);approveReview(x,hash);need(x.plan.runId===this.runId && x.plan.synthetic===this.synthetic,'AGO_WORKFLOW_PROFILE');
    need(this.config.read().equals(Buffer.from(x.config,'base64')),'AGO_CONFIG_CHANGED');
    await this.guard(x,'before');
    this.journal('workflow-attempt.json',{approvedPlanSha256:hash,phase:'approved-before-credential-read'});
    const credentials=await this.credentials(hash);
    const reconciler=new AuthReconciler(this.engine,x.plan.sourceHash,this.synthetic?'disposable-only':'retained-auth-only');
    const internal=await reconciler.prepare('activation',x.inspect.Id,credentials);
    // Recheck all source/resources after private credential and capture work.
    await this.guard(x,'before');
    this.config.set(Buffer.from(x.config,'base64'),Buffer.from(x.proposedConfig,'base64'));
    const start=Date.now(),id=await reconciler.apply(internal.plan,internal.hash,x.plan.sourceHash);
    await this.guard(x,'after',id);
    const result={result:'PASS_ACTIVATED',replacementId:id,planSha256:hash,rollbackApprovalSha256:reconciler.rollbackHash(hash,id),downtimeToAcceptanceMs:Date.now()-start};
    this.journal('workflow-success.json',result);return result;
  }
  async rollback(hash,separateApproval,id){
    const x=await loadReview(this.runId);approveReview(x,hash,{expiry:false});need(x.plan.runId===this.runId && x.plan.synthetic===this.synthetic,'AGO_WORKFLOW_PROFILE');
    need(separateApproval===digest({operation:'rollback',planHash:hash,replacementId:id}),'AGO_ROLLBACK_APPROVAL');
    const plan=JSON.parse(fs.readFileSync(path.join(root,'.local-auth-only',this.runId,'activation-plan.json'),'utf8'));
    const reconciler=new AuthReconciler(this.engine,x.plan.sourceHash,this.synthetic?'disposable-only':'retained-auth-only');
    const capture=await reconciler.load(plan,digest(plan));
    if(this.engine.restoreBinding)await this.engine.restoreBinding(plan.slot,capture,id);
    await this.guard(x,'rollback-before',id);
    const current=this.config.read();need(current.equals(Buffer.from(x.config,'base64')) || current.equals(Buffer.from(x.proposedConfig,'base64')),'AGO_CONFIG_CHANGED');
    const restored=await reconciler.rollback(plan,digest(plan),id,reconciler.rollbackHash(digest(plan),id));
    if(current.equals(Buffer.from(x.proposedConfig,'base64')))this.config.set(current,Buffer.from(x.config,'base64'));
    await this.guard(x,'rollback-after',id);
    this.journal('workflow-rollback.json',{result:'PASS_ROLLED_BACK',originalId:restored});return {result:'PASS_ROLLED_BACK',originalId:restored};
  }
}
