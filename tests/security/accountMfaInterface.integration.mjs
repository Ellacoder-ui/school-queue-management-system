// Actual Auth + installed SDK + application MFA controller, synthetic fixture only.
import {randomBytes,createHmac} from 'node:crypto'
import {writeFileSync} from 'node:fs'
import {AuthMfaFixture} from './authMfaFixture.mjs'
import {QueueFixture,availableFixtureRun,preservationQuery,need,digest} from '../integration/queueFixture.mjs'
import {createAccountMfa,totpImage} from '../../src/lib/accountMfa.js'
import {guardMfaRequest} from '../../src/lib/mfaRequestPolicy.js'
const run=availableFixtureRun(),fixture=new AuthMfaFixture(run),fence=new QueueFixture(run)
const report={run,checks:[],retainedWrites:false,syntheticOnly:true,actualAuthAndSdk:true}
const check=(name,value)=>{need(value,'AMUI_CHECK_FAILED');report.checks.push({name,result:'PASS'});console.log('PASS: '+name)}
function totp(secret,offset=0){let bits='';for(const c of secret)bits+='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0');const key=Buffer.from(bits.match(/.{8}/g).map(x=>parseInt(x,2))),step=Buffer.alloc(8);step.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)+offset));const h=createHmac('sha1',key).update(step).digest(),at=h[19]&15;return((h.readUInt32BE(at)&0x7fffffff)%1000000).toString().padStart(6,'0')}
const settle=()=>new Promise(r=>setImmediate(r))
let before,rows,inventory,client,controller,secret='',password=randomBytes(24).toString('hex')
try{
 before=await fence.retained();rows=fence.retainedRead(preservationQuery).trim();inventory=await fence.inventory()
 const body=fixture.authBody.bind(fixture);fixture.authBody=(fail=false)=>{const x=body(fail);x.Env=x.Env.map(v=>/^GOTRUE_MFA_TOTP_(ENROLL|VERIFY)_ENABLED=/.test(v)?v.replace('=false','=true'):v);return x}
 await fixture.start();const initial=await fixture.engine.probe(fixture.db,'db-state')
 check('isolated same cached Auth starts with TOTP and Google enabled, no host ports',!!fixture.original)
 const send=fixture.fetch.bind(fixture);fixture.fetch=(input,options)=>{guardMfaRequest(input,options);return send(input,options)}
 client=fixture.client();const enroll=client.auth.mfa.enroll;client.auth.mfa.enroll=async args=>{
  const value=await enroll(args),raw=value.data?.totp?.qr_code||'',svg=raw.replace(/^data:image\/svg\+xml;utf-8,/,'')
  const normalized=svg.trim().replace(/^<\?xml\s+version=["']1\.0["'](?:\s+encoding=["']UTF-8["'])?\s*\?>\s*/i,'').replace(/<!--[\s\S]*?-->/g,'').trim()
  report.qrFormat={returned:!!raw,sdkPrefix:raw.startsWith('data:image/svg+xml;utf-8,'),xmlDeclaration:/^\s*<\?xml\b/.test(svg),comment:/<!--/.test(svg),doctype:/<!DOCTYPE/i.test(svg),svgRoot:/^\s*<svg[\s>]/.test(svg),normalizedRoot:/^<svg[\s>]/.test(normalized),normalizedEnd:/<\/svg>\s*$/.test(normalized),forbiddenMarkup:/<!|<\?|<script|<style|foreignObject|\bon\w+\s*=/i.test(normalized),externalHref:/(?:href|src)\s*=\s*(?!["']?\s*#)/i.test(normalized),externalUrl:/url\s*\(\s*(?!["']?\s*#)/i.test(normalized),xmlAttributes:[...svg.match(/^\s*<\?xml\b([^?]*)\?>/)?.[1]?.matchAll(/([\w-]+)\s*=/g)||[]].map(x=>x[1]),secretShape:/^[A-Za-z2-7]{16,128}$/.test(value.data?.totp?.secret||''),apiError:!!value.error}
  report.qrFormat.length=raw.length;report.qrFormat.factorTypeTotp=value.data?.type==='totp';report.qrFormat.idShape=/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value.data?.id||'');try{totpImage(raw);report.qrFormat.rendererAccepts=true}catch{report.qrFormat.rendererAccepts=false}
  return value
 };const signup=await client.auth.signUp({email:'controller-mfa@example.invalid',password});need(!signup.error&&signup.data.user,'AMUI_SIGNUP')
 const actor=signup.data.user.id;let accepted=0
 controller=createAccountMfa(client.auth,{enabled:true,getScope:()=>({actor,version:1}),onVerified:()=>{accepted++},timeoutMs:30000})
 await controller.open();await settle();check('application inventory requires explicit enrollment',controller.getState().phase==='choose')
 await controller.enroll();await settle();let state=controller.getState();secret=state.secret
 check('authentic SDK-generated QR passes the application renderer in memory',state.phase==='setup'&&state.qr?.startsWith('data:image/svg+xml;')&&!!secret)
 await controller.enroll();check('duplicate setup is blocked before another enrollment',controller.getState().phase==='setup')
 await controller.verify(totp(secret,-20));await settle();check('actual Auth rejects an expired TOTP without claiming AAL2',controller.getState().phase==='verify'&&accepted===0)
 const valid=new Set([-1,0,1].map(n=>totp(secret,n)));let wrong='000000';while(valid.has(wrong))wrong=String(Number(wrong)+1).padStart(6,'0')
 await controller.verify(wrong);wrong='';await settle();check('wrong code clears setup material and permits explicit retry',controller.getState().phase==='verify'&&!controller.getState().qr&&!controller.getState().secret)
 await controller.verify(totp(secret));secret='';await settle();check('supported challenge/verify reaches actual AAL2 with a verified factor',controller.getState().phase==='verified'&&controller.getState().currentLevel==='aal2'&&controller.getState().factors.length===1&&accepted===1)
 controller.close();await controller.open();await settle();check('reopening rechecks server factors and assurance without a setup key',controller.getState().phase==='verified'&&!controller.getState().secret)
 // A new real fixture session must not retarget an old controller intent.
 const login=await client.auth.signInWithPassword({email:'controller-mfa@example.invalid',password});need(!login.error,'AMUI_LOGIN')
 controller.close();await controller.open();await settle();const chosen=controller.getState().factors[0]?.id;controller.select(chosen)
 const otherSession=await client.auth.signInWithPassword({email:'controller-mfa@example.invalid',password});need(!otherSession.error,'AMUI_SESSION_CHANGE')
 await controller.verify('000000');await settle();check('same-user replacement session interrupts rather than verifying an old intent',controller.getState().phase==='interrupted')
 const final=await fixture.engine.probe(fixture.db,'db-state')
 check('fixture migrations and witness survive synthetic Auth side effects',digest(initial.migrations)===digest(final.migrations)&&initial.witness===final.witness&&final.users===1)
 report.result='PASS'
}catch{report.result='FAIL';report.failure='Synthetic MFA integration stopped; private diagnostics suppressed';report.controllerPhase=controller?.getState().phase;process.exitCode=1}
finally{
 secret='';password='';controller?.stop();client?.auth.stopAutoRefresh()
 try{await fixture.stop();report.stopped=true}catch{report.stopped=false;report.result='FAIL';process.exitCode=1}
 try{const services=await fence.retained(),current=await fence.inventory();report.retainedPreservation=rows===fence.retainedRead(preservationQuery).trim()&&services.every((x,i)=>x.id===before[i].id&&x.definition===before[i].definition&&(x.name.includes('vector')||digest(x)===digest(before[i])))&&digest(current.volumes)===digest(inventory.volumes)&&digest(current.containers)===digest([...inventory.containers,...fixture.engine.containers].sort())&&digest(current.networks)===digest([...inventory.networks,fixture.engine.networkId].sort());need(report.retainedPreservation,'AMUI_PRESERVATION')}catch{report.retainedPreservation=false;report.result='FAIL';process.exitCode=1}
 report.containers=[...fixture.engine.containers];report.network=fixture.engine.networkId||null;report.passed=report.checks.length
 writeFileSync(`supabase/tests/results/account_mfa_interface_${run}.json`,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({run,result:report.result,passed:report.passed,retainedPreservation:report.retainedPreservation}))
}
