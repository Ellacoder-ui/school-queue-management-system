/** Auth-only preparation and DISPOSABLE execution. No retained mutation adapter.
 * Private Docker bodies and DPAPI IPC never enter shell arguments or receipts. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { root, need, stable, digest, toCreate, compareCreated, cleanEnv } from './vectorRepairCore.mjs';
export { root, need, stable, digest, toCreate, compareCreated, cleanEnv };
export const authImage='sha256:1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b';
export const pgImage='sha256:6058a6759ab9268cff8ee70641d61f1bd75953316281b76427cf5a6b4db2eafc';
export const label='school-queue.auth-only-rehearsal';
export const retainedId='9f7742bf04e680d82988376411720e3500c9c0c069b0e57de5b7f3dc3ebb4ef6';
export const network='supabase_network_school-queue-local';
export function proposedToml(bytes){
  need(Buffer.isBuffer(bytes) && crypto.createHash('sha256').update(bytes).digest('hex')==='a929af299d0c49ec0a0632cf1a84a8227bdbdf250e1f23a2d3be53e3a2b003a8','AGO_CONFIG_BASELINE');
  return Buffer.concat([bytes,Buffer.from('\n[auth]\nenabled = true\nsite_url = "http://127.0.0.1:5173"\nadditional_redirect_urls = ["http://127.0.0.1:5173/auth/callback"]\nenable_signup = true\nenable_anonymous_sign_ins = false\nenable_manual_linking = false\n\n[auth.external.google]\nenabled = true\nclient_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"\nsecret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET)"\nredirect_uri = "http://127.0.0.1:54321/auth/v1/callback"\nskip_nonce_check = false\nemail_optional = false\n')]);
}
export const delta={GOTRUE_SITE_URL:'http://127.0.0.1:5173', GOTRUE_URI_ALLOW_LIST:'http://127.0.0.1:5173/auth/callback',
  GOTRUE_EXTERNAL_GOOGLE_ENABLED:'true', GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI:'http://127.0.0.1:54321/auth/v1/callback',
  GOTRUE_EXTERNAL_GOOGLE_SKIP_NONCE_CHECK:'false', GOTRUE_EXTERNAL_GOOGLE_EMAIL_OPTIONAL:'false'};
export function names(id){need(typeof id==='string' && /^[0-9a-f]{8}$/.test(id),'AGO_RUN_ID');
  return {prefix:`sq-ago-${id}-`,auth:`sq-ago-${id}-auth`,db:`sq-ago-${id}-db`,network:`sq-ago-${id}-network`};}
export function environment(entries){
  need(Array.isArray(entries),'AGO_ENVIRONMENT'); const out={};
  for(const entry of entries){need(typeof entry==='string' && /^[A-Za-z_][A-Za-z0-9_]*=/.test(entry) && !/[\r\n\0]/.test(entry),'AGO_ENVIRONMENT');
    const i=entry.indexOf('=');const k=entry.slice(0,i);need(!Object.hasOwn(out,k),'AGO_DUPLICATE_ENV');out[k]=entry.slice(i+1);}
  return out;
}
export function credential(value){need(value && typeof value.ClientId==='string' && /^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(value.ClientId) && !/[\r\n]/.test(value.ClientId) && value.ClientId.length<=255 &&
  typeof value.ClientSecret==='string' && /^[\x21-\x7e]{24,4096}$/.test(value.ClientSecret) && !/env\(/i.test(value.ClientSecret),'AGO_CREDENTIAL');return value;}
export function candidate(original, credentials){
  credential(credentials); const env=environment(original.Env);
  need(env.GOTRUE_SITE_URL==='http://127.0.0.1:3000' && env.GOTRUE_URI_ALLOW_LIST==='https://127.0.0.1:3000','AGO_OLD_URLS');
  need(!env.GOTRUE_EXTERNAL_GOOGLE_ENABLED || env.GOTRUE_EXTERNAL_GOOGLE_ENABLED==='false','AGO_ALREADY_ENABLED');
  need(!env.GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID && !env.GOTRUE_EXTERNAL_GOOGLE_SECRET,'AGO_EXISTING_PROVIDER_CREDENTIAL');
  need(env.GOTRUE_DB_DATABASE_URL && env.GOTRUE_JWT_SECRET && env.GOTRUE_DISABLE_SIGNUP==='false' &&
    env.GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED==='false' && env.GOTRUE_SECURITY_MANUAL_LINKING_ENABLED==='false','AGO_SECURITY_BASELINE');
  need(!original.HostConfig.Mounts?.length && !original.HostConfig.Binds?.length && !original.Volumes,'AGO_AUTH_MOUNTS');
  const changes={...delta,GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID:credentials.ClientId,GOTRUE_EXTERNAL_GOOGLE_SECRET:credentials.ClientSecret};
  const out=structuredClone(original);
  out.Env=original.Env.map(entry=>{const key=entry.slice(0,entry.indexOf('='));return Object.hasOwn(changes,key)?key+'='+changes[key]:entry;});
  for(const [key,value] of Object.entries(changes))if(!Object.hasOwn(env,key))out.Env.push(key+'='+value);
  return out;
}
export function exactDelta(original, proposed, credentials){need(stable(candidate(original,credentials))===stable(proposed),'AGO_DEFINITION_DELTA');}
export function validateRetained(item){
  need(item.Id===retainedId && item.Name==='/supabase_auth_school-queue-local' && item.Image===authImage &&
    item.Config.Image==='public.ecr.aws/supabase/gotrue:v2.197.0','AGO_RETAINED_IDENTITY');
  need(item.Config.Labels?.['com.supabase.cli.project']==='school-queue-local' && item.Config.Labels?.['com.docker.compose.project']==='school-queue-local','AGO_PROJECT');
  need(stable(item.Config.Cmd)===stable(['auth']) && !item.Config.Entrypoint && item.Mounts.length===0 &&
    item.State.Running && item.State.Health?.Status==='healthy','AGO_RETAINED_SHAPE');
  need(!item.HostConfig.Privileged && !Object.keys(item.HostConfig.PortBindings||{}).length,'AGO_RETAINED_PRIVILEGES');
  const body=toCreate(item,network); environment(body.Env);return body;
}
export function codeBinding(){return Object.fromEntries(['scripts/authOnlyCore.mjs','scripts/authOnlyEngine.mjs','scripts/authOnlyRetained.mjs','scripts/AuthOnlyStorage.ps1',
  'scripts/AuthOnlyCredentialBridge.ps1','scripts/Start-AuthOnlyGoogle.ps1','scripts/vectorRepairCore.mjs','scripts/LocalGoogleCredential.psm1',
  'tests/security/rehearse_auth_only.mjs','tests/security/authOnlyStorageAclProbe.ps1',
  'tests/security/capture_auth_original.mjs','tests/security/run_auth_only_rehearsal.py'].map(p=>[p,digest(fs.readFileSync(path.join(root,p),'utf8'))]));}
export async function privateBridge(script, request){return new Promise((resolve,reject)=>{
  need(['AuthOnlyStorage.ps1','AuthOnlyCredentialBridge.ps1'].includes(script),'AGO_BRIDGE');
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts',script)],
    {cwd:root,env:cleanEnv(),windowsHide:true,stdio:['pipe','pipe','pipe']});
  const chunks=[];let size=0;const timer=setTimeout(()=>{child.kill();reject(Error('AGO_BRIDGE_TIMEOUT'));},20000);
  child.stdout.on('data',b=>{size+=b.length;if(size>2097152){child.kill();reject(Error('AGO_BRIDGE_BOUND'));}else chunks.push(b);});
  child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
  child.on('error',()=>{clearTimeout(timer);reject(Error('AGO_BRIDGE_PROCESS'));});
  child.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(Error('AGO_BRIDGE_REJECTED'));
    try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(Error('AGO_BRIDGE_JSON'));}});
  child.stdin.end(JSON.stringify(request));
});}
export async function storage(operation,runId,slot,payload,profile='synthetic'){
  names(runId);need(/^[a-z][a-z0-9-]{0,31}$/.test(slot),'AGO_SLOT');
  need(['synthetic','retained-capture'].includes(profile),'AGO_PROFILE');
  return privateBridge('AuthOnlyStorage.ps1',{operation,runId,slot,profile,...(payload===undefined?{}:{payload:stable(payload)})});
}
export function validateApproval(plan, approval, currentId, sourceHash){
  need(plan.profile==='disposable-only' && plan.project==='school-queue-local' && /^[0-9a-f]{64}$/.test(approval) && digest(plan)===approval,'AGO_APPROVAL');
  need(plan.originalId===currentId && plan.sourceHash===sourceHash,'AGO_TARGET_SOURCE');
  need(stable(plan.code)===stable(codeBinding()),'AGO_CODE_CHANGED');
}
export class AuthReconciler{
  constructor(engine,sourceHash){this.engine=engine;this.sourceHash=sourceHash;}
  directory(){return path.join(root,'.local-auth-only',this.engine.id);}
  writeNew(name,value){need(/^[a-z0-9-]+\.json$/.test(name),'AGO_JOURNAL');fs.writeFileSync(path.join(this.directory(),name),stable(value),{flag:'wx'});}
  async prepare(slot,id,credentials){
    const item=await this.engine.inspect(id);need(item.Name==='/'+this.engine.names.auth,'AGO_CANONICAL');
    const original=toCreate(item,this.engine.names.network), proposed=candidate(original,credentials);
    if(this.engine.bind)await this.engine.bind(slot,id,original,proposed);
    await storage('initialize',this.engine.id,slot);this.writeNew(slot+'-reserved.json',{originalId:id});
    const plan={version:1,project:'school-queue-local',profile:'disposable-only',runId:this.engine.id,slot,originalId:id,sourceHash:this.sourceHash,
      originalHash:digest(original),candidateHash:digest(proposed),code:codeBinding()};
    await storage('seal',this.engine.id,slot,{inspect:item,original,candidate:proposed,plan});
    const opened=JSON.parse((await storage('open',this.engine.id,slot)).payload);
    need(stable(opened.original)===stable(original) && stable(opened.candidate)===stable(proposed),'AGO_READBACK');
    this.writeNew(slot+'-plan.json',plan);return {plan,hash:digest(plan)};
  }
  async load(plan,approval){
    validateApproval(plan,approval,plan.originalId,this.sourceHash);
    const x=JSON.parse((await storage('open',this.engine.id,plan.slot)).payload);
    need(stable(x.plan)===stable(plan) && digest(x.original)===plan.originalHash && digest(x.candidate)===plan.candidateHash,'AGO_CAPTURE_HASH');
    const e=environment(x.candidate.Env);exactDelta(x.original,x.candidate,{ClientId:e.GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID,ClientSecret:e.GOTRUE_EXTERNAL_GOOGLE_SECRET});return x;
  }
  async apply(plan,approval,sourceHash){
    validateApproval(plan,approval,plan.originalId,sourceHash);const x=await this.load(plan,approval);
    const item=await this.engine.inspect(plan.originalId);
    need(item.Name==='/'+this.engine.names.auth && digest(toCreate(item,this.engine.names.network))===plan.originalHash,'AGO_TARGET_CHANGED');
    this.writeNew(plan.slot+'-attempt.json',{phase:'armed',originalId:item.Id});
    await this.engine.action(item.Id,'stop');await this.engine.action(item.Id,'rename',this.engine.names.prefix+plan.slot+'-original');
    await this.engine.action(item.Id,'disconnect');
    const id=await this.engine.create(this.engine.names.auth,x.candidate);
    this.writeNew(plan.slot+'-replacement.json',{replacementId:id});
    compareCreated(x.candidate,await this.engine.inspect(id),this.engine.names.network);
    await this.engine.action(id,'start');return id;
  }
  rollbackHash(planHash,replacementId){return digest({operation:'rollback',planHash,replacementId});}
  async rollback(plan,approval,id,separateApproval){
    const x=await this.load(plan,approval);
    need(separateApproval===this.rollbackHash(approval,id),'AGO_ROLLBACK_APPROVAL');
    const journal=JSON.parse(fs.readFileSync(path.join(this.directory(),plan.slot+'-replacement.json')));
    need(journal.replacementId===id,'AGO_ROLLBACK_BINDING');
    const replacement=await this.engine.inspect(id), old=await this.engine.inspect(plan.originalId);
    need(replacement.Name==='/'+this.engine.names.auth && old.Name==='/'+this.engine.names.prefix+plan.slot+'-original' &&
      !old.State.Running && !Object.keys(old.NetworkSettings.Networks).length,'AGO_ROLLBACK_STATE');
    // Check all original configuration privately before changing either object.
    const disconnected=structuredClone(old);disconnected.NetworkSettings.Networks=x.inspect.NetworkSettings.Networks;
    compareCreated(x.original,disconnected,this.engine.names.network);
    this.writeNew(plan.slot+'-rollback-attempt.json',{replacementId:id});
    await this.engine.action(id,'stop');await this.engine.action(id,'rename',this.engine.names.prefix+plan.slot+'-failed');await this.engine.action(id,'disconnect');
    await this.engine.action(old.Id,'rename',this.engine.names.auth);
    await this.engine.action(old.Id,'connect',x.original.NetworkingConfig.EndpointsConfig[this.engine.names.network].Aliases);
    compareCreated(x.original,await this.engine.inspect(old.Id),this.engine.names.network);
    if(x.inspect.State.Running)await this.engine.action(old.Id,'start');return old.Id;
  }
}
