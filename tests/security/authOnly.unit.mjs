import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {root,names,candidate,exactDelta,environment,credential,proposedToml,validateRetained,retainedId,authImage,network,toCreate,compareCreated,digest,codeBinding,validateApproval} from '../../scripts/authOnlyCore.mjs';
import {AuthOnlyEngine} from '../../scripts/authOnlyEngine.mjs';
import {BoundAuthEngine,retainedAuthEngine} from '../../scripts/authOnlyRetained.mjs';
const creds={ClientId:'123456-unit.apps.googleusercontent.com',ClientSecret:'unit_dummy_secret_12345678901234567890'};
const env=['GOTRUE_SITE_URL=http://127.0.0.1:3000','GOTRUE_URI_ALLOW_LIST=https://127.0.0.1:3000','GOTRUE_DB_DATABASE_URL=private-db',
  'GOTRUE_JWT_SECRET=private-jwt','GOTRUE_DISABLE_SIGNUP=false','GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED=false','GOTRUE_SECURITY_MANUAL_LINKING_ENABLED=false',
  'GOTRUE_MAILER_AUTOCONFIRM=true','GOTRUE_MFA_TOTP_VERIFY_ENABLED=true','GOTRUE_JWT_EXP=3600'];
const original=()=>({Image:authImage,Env:[...env],Cmd:['auth'],HostConfig:{Mounts:[],Binds:null,NetworkMode:network},NetworkingConfig:{EndpointsConfig:{[network]:{Aliases:['auth','canonical']}}}});
const item=()=>{const b=original();const {HostConfig,NetworkingConfig,...Config}=b;return {Id:retainedId,Name:'/supabase_auth_school-queue-local',Image:authImage,Config:{...Config,Image:'public.ecr.aws/supabase/gotrue:v2.197.0',Entrypoint:null,Labels:{'com.supabase.cli.project':'school-queue-local','com.docker.compose.project':'school-queue-local'}},HostConfig,Mounts:[],State:{Running:true,Health:{Status:'healthy'}},NetworkSettings:{Networks:{[network]:{Aliases:['auth','canonical']}}}};};
test('exact eight environment changes preserve all other bytes and fields',()=>{const a=original(),b=candidate(a,creds);exactDelta(a,b,creds);const x=environment(a.Env),y=environment(b.Env);assert.equal(Object.keys(y).filter(k=>y[k]!==x[k]).length,8);for(const k of Object.keys(x).filter(k=>!['GOTRUE_SITE_URL','GOTRUE_URI_ALLOW_LIST'].includes(k)))assert.equal(x[k],y[k]);assert.deepEqual(a.HostConfig,b.HostConfig);assert.deepEqual(a.NetworkingConfig,b.NetworkingConfig);});
test('JWT database email MFA command image aliases and host changes are rejected',()=>{const a=original();for(const key of ['GOTRUE_JWT_SECRET','GOTRUE_DB_DATABASE_URL','GOTRUE_MAILER_AUTOCONFIRM','GOTRUE_MFA_TOTP_VERIFY_ENABLED']){const b=candidate(a,creds);b.Env=b.Env.map(e=>e.startsWith(key+'=')?key+'=changed':e);assert.throws(()=>exactDelta(a,b,creds),/DELTA/);}for(const key of ['Cmd','Image','HostConfig','NetworkingConfig']){const b=candidate(a,creds);b[key]='wrong';assert.throws(()=>exactDelta(a,b,creds),/DELTA/);}});
test('missing malformed unresolved newline credentials fail',()=>{for(const c of [null,{}, {...creds,ClientSecret:''},{...creds,ClientId:creds.ClientId+'\n'},{...creds,ClientSecret:creds.ClientSecret+'\n'},{...creds,ClientSecret:'env(SUPABASE_GOOGLE_SECRET)'}])assert.throws(()=>credential(c),/CREDENTIAL/);});
test('duplicate environment keys and controls fail',()=>{assert.throws(()=>environment(['A=1','A=2']),/DUPLICATE/);assert.throws(()=>environment(['A=1\n']),/ENVIRONMENT/);});
test('already enabled existing credentials and wrong old URLs fail',()=>{for(const e of ['GOTRUE_EXTERNAL_GOOGLE_ENABLED=true','GOTRUE_EXTERNAL_GOOGLE_SECRET=secret']){const a=original();a.Env.push(e);assert.throws(()=>candidate(a,creds),/ALREADY|EXISTING/);}const a=original();a.Env[0]='GOTRUE_SITE_URL=http://localhost:3000';assert.throws(()=>candidate(a,creds),/URLS/);});
test('security relaxations and unexpected Auth mounts fail',()=>{const a=original();a.Env=a.Env.map(e=>e==='GOTRUE_SECURITY_MANUAL_LINKING_ENABLED=false'?'GOTRUE_SECURITY_MANUAL_LINKING_ENABLED=true':e);assert.throws(()=>candidate(a,creds),/SECURITY/);const b=original();b.HostConfig.Mounts=[{Target:'/data'}];assert.throws(()=>candidate(b,creds),/MOUNTS/);});
test('fixed current config proposal contains only expected blocks and env references',()=>{const a=fs.readFileSync(path.join(root,'supabase/config.toml')),b=proposedToml(a);assert.ok(b.subarray(0,a.length).equals(a));const text=b.toString();assert.equal((text.match(/^\[auth\]$/gm)||[]).length,1);assert.equal((text.match(/^\[auth.external.google\]$/gm)||[]).length,1);assert.ok(text.includes('skip_nonce_check = false'));assert.ok(text.includes('env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET)'));assert.ok(!text.includes(creds.ClientSecret));assert.throws(()=>proposedToml(Buffer.concat([a,Buffer.from('\n')])),/BASELINE/);});
test('retained identity project image health and network are checked',()=>{validateRetained(item());for(const mutate of [x=>x.Id='wrong',x=>x.Name='/wrong',x=>x.Image='wrong',x=>x.Config.Labels['com.supabase.cli.project']='wrong',x=>x.State.Health.Status='unhealthy',x=>x.NetworkSettings.Networks={wrong:{Aliases:[]}}]){const a=item();mutate(a);assert.throws(()=>validateRetained(a));}});
test('unknown inspect fields static IPAM and extra networks are rejected',()=>{for(const change of [x=>x.Config.Unknown=true,x=>x.HostConfig.Unknown=true,x=>x.NetworkSettings.Networks[network].IPAMConfig={IPv4Address:'1.2.3.4'},x=>x.NetworkSettings.Networks.extra={}]){const a=item();change(a);assert.throws(()=>toCreate(a,network));}});
test('complete create round-trip checks aliases and effective OOM default',()=>{const a=item(),b=toCreate(a,network);compareCreated(b,a,network);a.HostConfig.OomKillDisable=true;assert.throws(()=>compareCreated(b,a,network),/DEFINITION/);});
test('approval binds exact plan target source project profile and code',()=>{const p={project:'school-queue-local',profile:'disposable-only',originalId:'one',sourceHash:'source',code:codeBinding()};validateApproval(p,digest(p),'one','source');for(const [id,source]of[['two','source'],['one','changed']])assert.throws(()=>validateApproval(p,digest(p),id,source),/TARGET_SOURCE/);for(const key of ['project','profile','code']){const q={...p,[key]:'changed'};assert.throws(()=>validateApproval(q,digest(q),'one','source'));}});
test('resource names and owned-ID set exclude all retained operations',async()=>{for(const n of ['school-queue-local','../escape','abcdefgh','12345678\n'])assert.throws(()=>names(n));const e=new AuthOnlyEngine('1234abcd');await assert.rejects(()=>e.action(retainedId,'stop'),/NOT_OWNED/);});
test('Engine refuses project labels host mounts ports privileges and retained DB',()=>{const e=new AuthOnlyEngine('1234abcd');const b={Image:authImage,Labels:{'school-queue.auth-only-rehearsal':'1234abcd'},Env:['GOTRUE_DB_DATABASE_URL=postgres://postgres:'+ 'a'.repeat(48)+'@db:5432/postgres?sslmode=disable&search_path=auth'],HostConfig:{NetworkMode:e.names.network,ReadonlyRootfs:true,CapDrop:['ALL'],SecurityOpt:['no-new-privileges']}};e.guardBody(e.names.auth,b);for(const change of [x=>x.Labels['com.supabase.cli.project']='school-queue-local',x=>x.HostConfig.Binds=['/var/run/docker.sock:/var/run/docker.sock'],x=>x.HostConfig.Privileged=true,x=>x.HostConfig.PortBindings={'9999/tcp':[{HostPort:'9999'}]},x=>x.Env=['GOTRUE_DB_DATABASE_URL=postgres://retained']]){const a=structuredClone(b);change(a);assert.throws(()=>e.guardBody(e.names.auth,a));}});
test('shared plan adapter refuses unknown IDs definitions network identity and arbitrary actions',async()=>{
  const x=item();x.NetworkSettings.Networks[network].NetworkID='network-id';
  const channel={id:'1234abcd',names:{auth:'supabase_auth_school-queue-local',prefix:'dummy-',network},verifyNetwork:async()=>{},inspect:async()=>structuredClone(x)};
  const b=new BoundAuthEngine(channel),old=toCreate(x,network),proposed=candidate(old,creds);
  await b.bind('unit',x.Id,old,proposed);await b.inspect(x.Id);
  await assert.rejects(()=>b.inspect('wrong'),/BOUND_ID/);
  await assert.rejects(()=>b.create('wrong',proposed),/BOUND_CREATE/);
  await assert.rejects(()=>b.create(channel.names.auth,{...proposed,Cmd:['wrong']}),/BOUND_CREATE/);
  await assert.rejects(()=>b.action(x.Id,'delete'),/BOUND_ACTION/);
  x.NetworkSettings.Networks[network].NetworkID='changed';await assert.rejects(()=>b.inspect(x.Id),/BOUND_NETWORK_ID/);
  x.NetworkSettings.Networks[network].NetworkID='network-id';x.Config.Env.push('EXTRA=changed');await assert.rejects(()=>b.inspect(x.Id),/BOUND_DEFINITION/);
});
test('retained factory cannot be unlocked by target plan or environment input',()=>{assert.throws(()=>retainedAuthEngine(item(),'1234abcd'),/RETAINED_ACTIVATION_LOCKED/);});
test('only never-started replacement may have an unassigned endpoint; actual network verification is required',async()=>{
  const x=item();x.NetworkSettings.Networks[network].NetworkID='network-id';
  let verifyCount=0, created=false;const old=toCreate(x,network), proposed=candidate(old,creds);
  const channel={id:'1234abcd',names:{auth:'supabase_auth_school-queue-local',prefix:'dummy-',network},verifyNetwork:async()=>{verifyCount++;},
    inspect:async id=>{const y=structuredClone(x);if(id==='new'){y.Id='new';y.Config.Env=proposed.Env;y.State={Status:created?'created':'exited',Running:false};y.NetworkSettings.Networks[network].NetworkID='';}return y;},
    create:async()=>{created=true;return 'new';}};
  const b=new BoundAuthEngine(channel);await b.bind('unit',x.Id,old,proposed);await b.create(channel.names.auth,proposed);assert.ok(verifyCount>=3);
  created=false;b.pendingEndpoints.delete('new');await assert.rejects(()=>b.inspect('new'),/BOUND_NETWORK_ID/);
  channel.verifyNetwork=async()=>{throw Error('NETWORK_CHANGED');};created=true;await assert.rejects(()=>b.inspect('new'),/NETWORK_CHANGED/);
});
test('stopped original gets pending endpoint permission only after approved reconnect',async()=>{
  const x=item();x.NetworkSettings.Networks[network].NetworkID='network-id';x.State={Running:false,Status:'exited'};
  const old=toCreate(x,network),proposed=candidate(old,creds);let attached=true;
  const channel={id:'1234abcd',names:{auth:'supabase_auth_school-queue-local',prefix:'dummy-',network},verifyNetwork:async()=>{},
    inspect:async()=>{const y=structuredClone(x);if(!attached)y.NetworkSettings.Networks={};return y;},
    action:async(id,op)=>{assert.equal(op,'connect');attached=true;x.NetworkSettings.Networks[network].NetworkID='';}};
  const b=new BoundAuthEngine(channel);await b.bind('unit',x.Id,old,proposed);
  x.NetworkSettings.Networks[network].NetworkID='';await assert.rejects(()=>b.inspect(x.Id),/BOUND_NETWORK_ID/);
  attached=false;await b.action(x.Id,'connect',old.NetworkingConfig.EndpointsConfig[network].Aliases);await b.inspect(x.Id);
  x.NetworkSettings.Networks[network].NetworkID='wrong';await assert.rejects(()=>b.inspect(x.Id),/BOUND_NETWORK_ID/);
});
