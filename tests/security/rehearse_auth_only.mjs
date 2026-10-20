/** Cached real Auth + new isolated PG fixture; synthetic credentials only. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {root,need,stable,digest,authImage,pgImage,label,AuthReconciler,storage,privateBridge,environment,compareCreated,cleanEnv} from '../../scripts/authOnlyCore.mjs';
import {AuthOnlyEngine,nodeImage} from '../../scripts/authOnlyEngine.mjs';
import {BoundAuthEngine,retainedAuthEngine} from '../../scripts/authOnlyRetained.mjs';
import {AuthOnlyWorkflow,ConfigFile,bytesHash} from '../../scripts/authOnlyWorkflow.mjs';
const rid=process.argv[2],engine=new AuthOnlyEngine(rid),sourceHash=digest('isolated-fixture-source');
let reconciler=new AuthReconciler(new BoundAuthEngine(engine),sourceHash);
const file=path.join(root,`supabase/tests/results/auth_only_disposable_${rid}.json`);
need(!fs.existsSync(file),'AGO_EVIDENCE_EXISTS');
const record={run_id:rid,started_at:new Date().toISOString(),result:'IN_PROGRESS',checks:[],containers:[],retained_operations:false,real_credentials_read:false};
const canaries={ClientId:'123456-'+crypto.randomBytes(16).toString('hex')+'.apps.googleusercontent.com',ClientSecret:'AGO_DUMMY_'+crypto.randomBytes(32).toString('hex')};
const jwt=crypto.randomBytes(32).toString('hex'),dbPassword=crypto.randomBytes(24).toString('hex');
const save=()=>{record.containers=[...engine.containers];record.network_id=engine.networkId;fs.writeFileSync(file,JSON.stringify(record,null,2));};
const check=(name,value=true)=>{need(value,'AGO_ASSERTION');record.checks.push({name,result:'PASS'});save();console.log(JSON.stringify({check:name,result:'PASS'}));};
const negative=async(fn,regex=/AGO_|VPR_|EEXIST/)=>{try{await fn();}catch(e){need(regex.test(e.message),'AGO_WRONG_FAILURE');return true;}throw Error('AGO_NEGATIVE_ACCEPTED');};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const host=()=>({NetworkMode:engine.names.network,ReadonlyRootfs:true,CapDrop:['ALL'],SecurityOpt:['no-new-privileges'],
  Memory:536870912,NanoCpus:1000000000,PidsLimit:128,RestartPolicy:{Name:'no',MaximumRetryCount:0},Tmpfs:{'/tmp':'rw,nosuid,size=268435456'}});
function base(image,alias){return {Image:image,Labels:{[label]:rid},HostConfig:host(),NetworkingConfig:{EndpointsConfig:{[engine.names.network]:{Aliases:[alias]}}}};}
function authBody(fail=false){return {...base(authImage,'auth'),Cmd:['auth'],Env:[
  'GOTRUE_API_HOST=0.0.0.0','GOTRUE_API_PORT=9999','API_EXTERNAL_URL=http://127.0.0.1:54321/auth/v1',
  'GOTRUE_DB_DRIVER=postgres','GOTRUE_DB_NAMESPACE=auth',`GOTRUE_DB_DATABASE_URL=postgres://postgres:${dbPassword}@db:5432/postgres?sslmode=disable&search_path=auth`,
  'GOTRUE_SITE_URL=http://127.0.0.1:3000','GOTRUE_URI_ALLOW_LIST=https://127.0.0.1:3000','GOTRUE_DISABLE_SIGNUP=false',
  'GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED=false','GOTRUE_SECURITY_MANUAL_LINKING_ENABLED=false',
  'GOTRUE_EXTERNAL_EMAIL_ENABLED=true','GOTRUE_MAILER_AUTOCONFIRM=true','GOTRUE_JWT_SECRET='+jwt,
  'GOTRUE_JWT_EXP=3600','GOTRUE_JWT_AUD=authenticated','GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated',
  'GOTRUE_JWT_ADMIN_ROLES=service_role','GOTRUE_MFA_TOTP_ENROLL_ENABLED=true','GOTRUE_MFA_TOTP_VERIFY_ENABLED=true'],
  // Startup failure is caused only in this fixture when Google becomes enabled.
  ...(fail?{Entrypoint:['/bin/sh'],Cmd:['-ec','if [ "$GOTRUE_EXTERNAL_GOOGLE_ENABLED" = true ]; then exit 42; fi; exec auth']} : {}),
  Healthcheck:{Test:['CMD-SHELL','wget --no-verbose --tries=1 --spider http://127.0.0.1:9999/health'],Interval:1000000000,Timeout:2000000000,Retries:3}};}
async function health(id,expected){
  const samples=[];const start=Date.now();
  while(Date.now()-start<45000){const x=await engine.inspect(id);need(x.State.Running && x.RestartCount===0,'AGO_AUTH_STOPPED');
    samples.push({elapsed_ms:Date.now()-start,health:x.State.Health?.Status});
    if(x.State.Health?.Status==='healthy'){
      const observed=await engine.probe(witness,'auth-http');need(observed.health===200 && observed.settings===200 && observed.google===expected,'AGO_HTTP_SETTINGS');
      const logs=await engine.logs(id);need(![canaries.ClientSecret,canaries.ClientId,jwt,dbPassword].some(x=>logs.includes(x)),'AGO_LOG_CANARY');
      return {samples,http:observed,restarts:0};}
    await pause(1000);
  }throw Error('AGO_HEALTH_TIMEOUT');
}
let witness;
try{
  save();for(const image of [authImage,pgImage,nodeImage])await engine.image(image);
  await engine.infrastructure();save();
  const pg=base(pgImage,'db');pg.User='postgres';pg.Entrypoint=['/bin/sh'];
  pg.Env=['FIXTURE_DB_PASSWORD='+dbPassword];
  pg.Cmd=['-ec',`test ! -e /tmp/auth-db/PG_VERSION; printf '%s' "$FIXTURE_DB_PASSWORD" > /tmp/pw; initdb -D /tmp/auth-db -U postgres --auth-local=trust --auth-host=scram-sha-256 --pwfile=/tmp/pw --no-locale --encoding=UTF8 >/tmp/init.log 2>&1; printf '%s\\n' 'host postgres postgres samenet scram-sha-256' >> /tmp/auth-db/pg_hba.conf; exec postgres -D /tmp/auth-db -h 0.0.0.0 -k /tmp`];
  const db=await engine.create(engine.names.db,pg);await engine.action(db,'start');save();
  let ready=false;for(let i=0;i<40;i++){if(await engine.probe(db,'db-ready')){ready=true;break;}await pause(500);}need(ready,'AGO_DB_READY');
  await engine.probe(db,'db-bootstrap');
  check('separate disposable database ready; no retained volumes or published ports');
  witness=await engine.create(engine.names.prefix+'probe',{...base(nodeImage,'probe'),Entrypoint:['node'],Cmd:['-e','setInterval(()=>{},10000)']});
  await engine.action(witness,'start');const witnessBefore=await engine.inspect(witness);
  const missing=rid.slice(0,7)+(rid.endsWith('0')?'1':'0');
  check('missing synthetic credentials rejected',await negative(()=>privateBridge('AuthOnlyCredentialBridge.ps1',{operation:'read-dummy',runId:missing})));
  const credentials=await privateBridge('AuthOnlyCredentialBridge.ps1',{operation:'create-dummy',runId:rid,...canaries});
  check('approved DPAPI mechanism private dummy write/read-back',stable(credentials)===stable(canaries));
  check('production credential bridge remains locked',await negative(()=>privateBridge('AuthOnlyCredentialBridge.ps1',{operation:'read-production',runId:rid})));
  check('retained Engine factory remains locked',await negative(async()=>retainedAuthEngine({},rid)));
  const original=await engine.create(engine.names.auth,authBody());await engine.action(original,'start');save();
  record.original_health=await health(original,false);const dbBefore=await engine.probe(db,'db-state');
  record.fixture_migration_observation={count:dbBefore.migrations.length,versionsHash:digest(dbBefore.migrations)};save();
  // The clean pinned Auth binary reports 75 applied migrations. The retained
  // CLI-provisioned database has additional receipts; do not copy its count.
  need(dbBefore.migrations.length===75 && dbBefore.users===0,'AGO_FIXTURE_MIGRATION_RECEIPTS');
  check('actual cached Auth starts with Google disabled and fixture migration receipts captured');
  const capture=await reconciler.prepare('success',original,credentials);
  check('encrypted full inspect/create rollback capture and private read-back');
  const reopened=JSON.parse((await storage('open',rid,'success')).payload);
  check('JWT database email MFA and aliases present unchanged in rollback capture',environment(reopened.original.Env).GOTRUE_JWT_SECRET===jwt && environment(reopened.original.Env).GOTRUE_DB_DATABASE_URL.includes(dbPassword));
  check('ciphertext overwrite refused',await negative(()=>storage('seal',rid,'success',{wrong:true})));
  check('wrong capture profile refused',await negative(()=>storage('open',rid,'success',undefined,'retained-capture')));
  await storage('seal',rid,'tamper',{secret:canaries.ClientSecret});
  const tampered=path.join(reconciler.directory(),'tamper/payload.dpapi'),bytes=fs.readFileSync(tampered);
  bytes[bytes.length-1]^=1;fs.writeFileSync(tampered,bytes);
  check('tampered dummy ciphertext rejected',await negative(()=>storage('open',rid,'tamper')));
  await storage('seal',rid,'acl-negative',{secret:canaries.ClientSecret});
  const acl=operation=>{const p=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'tests/security/authOnlyStorageAclProbe.ps1')],
    {input:JSON.stringify({runId:rid,slot:'acl-negative',operation}),env:cleanEnv(),windowsHide:true,encoding:'utf8'});need(p.status===0 && JSON.parse(p.stdout).result==='PASS','AGO_ACL_PROBE');};
  try{acl('weaken');check('extra principal refused before decrypt',await negative(()=>storage('open',rid,'acl-negative')));}finally{acl('restore');}
  check('owned dummy ACL restored and validated',JSON.parse((await storage('open',rid,'acl-negative')).payload).secret===canaries.ClientSecret);
  check('wrong target approval rejected',await negative(()=>reconciler.apply({...capture.plan,originalId:witness},capture.hash,sourceHash)));
  check('changed source rejected',await negative(()=>reconciler.apply(capture.plan,capture.hash,digest('changed'))));
  check('retained ID cannot enter disposable Engine',await negative(()=>engine.action('9f7742bf04e680d82988376411720e3500c9c0c069b0e57de5b7f3dc3ebb4ef6','stop')));
  const config=new ConfigFile(rid,true),originalConfig=fs.readFileSync(path.join(root,'supabase/config.toml'));
  fs.writeFileSync(config.file,originalConfig,{flag:'wx'});
  const baseline={credential:{synthetic:true,runId:rid},databaseState:dbBefore};
  const workflowGuard=async(x,phase,id)=>{
    need(stable(await engine.probe(db,'db-state'))===stable(dbBefore),'AGO_FIXTURE_SOURCE_CHANGED');
    const w=await engine.inspect(witness);need(w.State.StartedAt===witnessBefore.State.StartedAt && stable(w.Config)===stable(witnessBefore.Config),'AGO_FIXTURE_WITNESS_CHANGED');
    if(phase==='after')await health(id,true);
    if(phase==='rollback-after')await health(original,false);
  };
  const finalWorkflow=new AuthOnlyWorkflow({runId:rid,synthetic:true,engine:new BoundAuthEngine(engine),guard:workflowGuard,config,credentials:async()=>credentials});
  const finalPlan=await finalWorkflow.prepare(baseline,await engine.inspect(original));
  check('final review plan captures exact config source code and credential metadata without private credential read');
  check('wrong external approval rejected before credential access',await negative(()=>finalWorkflow.activate('0'.repeat(64))));
  const finalResult=await finalWorkflow.activate(finalPlan.hash),replacement=finalResult.replacementId;save();
  record.final_workflow={planHash:finalPlan.hash,downtime_to_acceptance_ms:finalResult.downtimeToAcceptanceMs};
  check('final orchestration applies exact nonsecret TOML proposal',bytesHash(config.read())===finalPlan.plan.proposedConfigHash);
  record.replacement_health=await health(replacement,true);
  compareCreated(reopened.candidate,await engine.inspect(replacement),engine.names.network);
  check('real Auth replacement healthy; Google enabled with exact eight-field delta');
  check('Auth migration versions users and witness rows unchanged',stable(await engine.probe(db,'db-state'))===stable(dbBefore));
  const parked=await engine.inspect(original);
  check('original remains stopped and network detached',!parked.State.Running && !Object.keys(parked.NetworkSettings.Networks).length);
  check('repeat activation refused',await negative(()=>finalWorkflow.activate(finalPlan.hash)));
  const resumed=new AuthOnlyWorkflow({runId:rid,synthetic:true,engine:new BoundAuthEngine(engine),guard:workflowGuard,config});
  check('final rollback needs separate approval',await negative(()=>resumed.rollback(finalPlan.hash,'0'.repeat(64),replacement)));
  await resumed.rollback(finalPlan.hash,finalResult.rollbackApprovalSha256,replacement);
  check('final rollback reloads encrypted capture in a fresh executor and restores original Auth and exact TOML',config.read().equals(originalConfig));
  check('final repeat rollback refused',await negative(()=>resumed.rollback(finalPlan.hash,finalResult.rollbackApprovalSha256,replacement)));
  for(const mode of ['Activate','Rollback']){
    const args=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/Start-AuthOnlyGoogle.ps1'),'-'+mode,'-RunId',rid,'-ApprovedPlanSha256',finalPlan.hash];
    if(mode==='Activate')args.push('-ConfirmAuthOnlyRecreation');
    else args.push('-ReplacementId',replacement,'-ApprovedRollbackSha256',finalResult.rollbackApprovalSha256,'-ConfirmAuthOnlyRollback');
    const p=spawnSync('powershell.exe',args,{env:cleanEnv(),windowsHide:true,encoding:'utf8'});
    check('public confirmed '+mode+' refuses synthetic plan before any retained operation',p.status===1 && JSON.parse(p.stdout).failure==='AGO_RETAINED_AUTHORIZATION');
  }
  await engine.action(original,'stop');await engine.action(original,'rename',engine.names.prefix+'success-retained');await engine.action(original,'disconnect');
  const failOriginal=await engine.create(engine.names.auth,authBody(true));await engine.action(failOriginal,'start');save();await health(failOriginal,false);
  reconciler=new AuthReconciler(new BoundAuthEngine(engine),sourceHash);
  const failed=await reconciler.prepare('failure',failOriginal,credentials);
  const failedReplacement=await reconciler.apply(failed.plan,failed.hash,sourceHash);save();
  let stopped;for(let i=0;i<20;i++){stopped=await engine.inspect(failedReplacement);if(!stopped.State.Running)break;await pause(500);}
  check('actual replacement startup failure retained without automatic retry',!stopped.State.Running && stopped.State.ExitCode===42 && stopped.RestartCount===0);
  check('rollback without separate approval refused',await negative(()=>reconciler.rollback(failed.plan,failed.hash,failedReplacement,'0'.repeat(64))));
  const rollbackHash=reconciler.rollbackHash(failed.hash,failedReplacement);
  const restored=await reconciler.rollback(failed.plan,failed.hash,failedReplacement,rollbackHash);
  record.rollback_health=await health(restored,false);
  check('rollback restores original ID definition aliases JWT and Google disabled',restored===failOriginal);
  check('repeat rollback refused',await negative(()=>reconciler.rollback(failed.plan,failed.hash,failedReplacement,rollbackHash)));
  check('fixture database unchanged through replacement failure and rollback',stable(await engine.probe(db,'db-state'))===stable(dbBefore));
  const after=await engine.inspect(witness);
  check('unrelated fixture witness lifecycle and definition unchanged',after.Id===witnessBefore.Id && after.State.StartedAt===witnessBefore.State.StartedAt && after.RestartCount===witnessBefore.RestartCount && stable(after.Config)===stable(witnessBefore.Config));
  for(const mode of ['Activate','Rollback']){
    const args=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/Start-AuthOnlyGoogle.ps1'),'-'+mode,'-RunId',rid,'-ApprovedPlanSha256',capture.hash];
    if(mode==='Rollback')args.push('-ReplacementId',replacement,'-ApprovedRollbackSha256','0'.repeat(64));
    const p=spawnSync('powershell.exe',args,{env:cleanEnv(),windowsHide:true,encoding:'utf8'});
    check('retained '+mode+' refuses missing explicit confirmation',p.status===1 && p.stderr.trim()==='AGO_EXPLICIT_APPROVAL_REQUIRED');
  }
  const scan=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())scan(p);else{
    const b=fs.readFileSync(p);need(![canaries.ClientSecret,canaries.ClientId,jwt,dbPassword].some(c=>b.includes(Buffer.from(c))),'AGO_DISK_CANARY');}}};
  scan(reconciler.directory());
  for(const dir of ['.local-credential-tests/'+rid,'dist'])if(fs.existsSync(path.join(root,dir)))scan(path.join(root,dir));
  need(![canaries.ClientSecret,canaries.ClientId,jwt,dbPassword].some(c=>JSON.stringify(record).includes(c)),'AGO_PUBLIC_CANARY');
  check('ciphertext journals and public receipts contain no plaintext canaries');
  record.fixture={auth_image:authImage,postgres_image:pgImage,auth_migrations:dbBefore.migrations.length,users:dbBefore.users,retained_connections:false};
  record.result='PASS';
}catch(e){record.result='FAIL_STOPPED';record.failure=/^(AGO|VPR)_[A-Z_]+$/.test(e.message)?e.message:'AGO_SANITIZED_STOP';}
finally{
  for(const id of [...engine.containers].reverse()){try{await engine.action(id,'stop');}catch{record.result='FAIL_STOPPED';record.stop_failure=true;}}
  record.completed_at=new Date().toISOString();save();console.log(JSON.stringify({result:record.result,failure:record.failure||null,checks:record.checks.length,run_id:rid}));
}
process.exitCode=record.result==='PASS'?0:1;
