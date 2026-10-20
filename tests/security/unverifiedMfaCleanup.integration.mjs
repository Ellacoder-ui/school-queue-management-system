// Supported owner unenrollment against real disposable Auth; no retained Auth write.
import {randomBytes, createHmac} from 'node:crypto'
import {readFileSync, readdirSync, writeFileSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {AuthMfaFixture} from './authMfaFixture.mjs'
import {QueueFixture, availableFixtureRun, preservationQuery, digest, need} from '../integration/queueFixture.mjs'
import {createAccountMfa} from '../../src/lib/accountMfa.js'
import {guardMfaRequest} from '../../src/lib/mfaRequestPolicy.js'
import {pgImage} from '../../scripts/authOnlyCore.mjs'

const run=availableFixtureRun(), fixture=new AuthMfaFixture(run), fence=new QueueFixture(run)
const report={run,syntheticOnly:true,actualAuthAndSdk:true,retainedWrites:false,checks:[]}
let phase='initial', before, rows, extra, inventory, owner, other, controller, ownerId, secret='', key='', password=randomBytes(24).toString('hex')
const check=(name,value)=>{need(value,'CHECK_FAILED');report.checks.push({name,result:'PASS'});console.log('PASS: '+name)}
const settle=()=>new Promise(r=>setImmediate(r))
const extraSql="select json_build_object('factors',(select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) from auth.mfa_factors x),'challenges',(select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) from auth.mfa_challenges x),'requests',(select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by id),'')) from queue_private.staff_review_requests x))"

function totp(secret,offset=0){let bits='';for(const c of secret)bits+='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0');const key=Buffer.from(bits.match(/.{8}/g).map(x=>parseInt(x,2))),step=Buffer.alloc(8);step.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)+offset));const h=createHmac('sha1',key).update(step).digest(),at=h[19]&15;return((h.readUInt32BE(at)&0x7fffffff)%1000000).toString().padStart(6,'0')}
async function sql(query){
  // SQL can reach only this new engine's exact owned tmpfs PostgreSQL container.
  const item=await fixture.engine.inspect(fixture.db);await fixture.engine.verifyNetwork()
  need(item.Image===pgImage && item.State.Running && !Object.keys(item.HostConfig.PortBindings||{}).length,'FIXTURE_DATABASE')
  const r=spawnSync('docker',['exec','-i','--user','postgres',fixture.db,'psql','-X','-w','-qAt','-v','ON_ERROR_STOP=1','-h','/tmp','-U','postgres','-d','postgres'],{input:query,encoding:'utf8',timeout:30000,windowsHide:true})
  if(r.status!==0){report.sqlFailure=/already exists/.test(r.stderr||'')?'already-exists':/does not exist/.test(r.stderr||'')?'missing-object':/permission denied/.test(r.stderr||'')?'permissions':'other';throw Error('FIXTURE_SQL_FAILED')}
  return r.stdout.trim()
}
async function read(query){return JSON.parse(await sql('begin read only; '+query+'; rollback;'))}
const accounts=()=>read("select json_build_object('accounts',(select md5(string_agg(to_jsonb(a)::text,'' order by id)) from queue_private.accounts a),'tickets',(select count(*) from queue_private.tickets),'identities',(select md5(string_agg(to_jsonb(i)::text,'' order by id)) from auth.identities i),'users',(select count(*) from auth.users),'activeUsers',(select count(*) from auth.users where deleted_at is null and (banned_until is null or banned_until<now())))")
const allFactors=()=>read("select coalesce(json_agg(json_build_object('id',id,'owner',user_id,'type',factor_type,'status',status,'hash',md5(to_jsonb(f)::text)) order by id),'[]') from auth.mfa_factors f")
const factorChallenges=id=>read(`select count(*) from auth.mfa_challenges where factor_id='${id}'`)
const safeError=value=>value?.error && Number.isInteger(value.error.status) && /^[a-z_]+$/.test(value.error.code||'') ? {status:value.error.status,code:value.error.code}:null

try{
  phase='retained-preflight';before=await fence.retained();rows=fence.retainedRead(preservationQuery).trim();extra=fence.retainedRead(extraSql).trim();inventory=await fence.inventory()
  const body=fixture.authBody.bind(fixture);fixture.authBody=(fail=false)=>{const x=body(fail);x.Env=x.Env.map(v=>/^GOTRUE_MFA_TOTP_(ENROLL|VERIFY)_ENABLED=/.test(v)?v.replace('=false','=true'):v);return x}
  phase='fixture-start';await fixture.start()
  const initial=await fixture.engine.probe(fixture.db,'db-state')
  check('cached isolated Auth is healthy with Google and TOTP enabled',!!fixture.original)
  phase='fixture-application-schema'
  const platform=await read("select json_build_object('extensions',to_regnamespace('extensions') is not null,'uid',to_regprocedure('auth.uid()') is not null,'publication',exists(select 1 from pg_publication where pubname='supabase_realtime'))")
  if(!platform.extensions)await sql('create schema extensions;')
  if(!platform.uid)await sql("create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;")
  if(!platform.publication)await sql('create publication supabase_realtime;')
  await sql('grant usage on schema auth,extensions to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;')
  const migrations=readdirSync('supabase/migrations').filter(x=>/^20261016000[1-6]00_.*\.sql$/.test(x)).sort();need(migrations.length===6,'SIX_MIGRATIONS')
  report.migrations=migrations.map(name=>({name,sha256:digest(readFileSync('supabase/migrations/'+name))}))
  for(const name of migrations){phase=name;await sql(readFileSync('supabase/migrations/'+name,'utf8'))}
  // Install the request observer before SDK construction: clients capture fetch.
  let guard=false,dropId=null,deleteCalls=0
  const send=fixture.fetch.bind(fixture)
  fixture.fetch=async(input,options={})=>{
    if(guard)guardMfaRequest(input,options)
    const u=new URL(input instanceof Request?input.url:input)
    const deleting=options.method==='DELETE'&&/\/factors\//.test(u.pathname)
    if(deleting)deleteCalls++
    const response=await send(input,options)
    if(deleting&&dropId&&u.pathname.endsWith('/'+dropId)){dropId=null;throw new TypeError('Synthetic response lost')}
    return response
  }
  phase='synthetic-signup';owner=fixture.client();other=fixture.client()
  const a=await owner.auth.signUp({email:'cleanup-owner@example.invalid',password}),b=await other.auth.signUp({email:'cleanup-other@example.invalid',password})
  need(!a.error&&!b.error&&a.data.user&&b.data.user,'FIXTURE_SIGNUP');ownerId=a.data.user.id
  await sql(`select queue_private.bootstrap_admin('${ownerId}');`)
  const base=await accounts();check('real application provisioning creates only synthetic accounts',base.users===2&&base.activeUsers===2)
  phase='synthetic-factor-setup'
  const otherSetup=await other.auth.mfa.enroll({factorType:'totp',friendlyName:'Other account safeguard'});need(!otherSetup.error,'OTHER_ENROLL')
  key=otherSetup.data.totp.secret
  const otherChallenge=await other.auth.mfa.challenge({factorId:otherSetup.data.id});need(!otherChallenge.error,'OTHER_CHALLENGE')
  const otherVerified=await other.auth.mfa.verify({factorId:otherSetup.data.id,challengeId:otherChallenge.data.id,code:totp(key)});key='';need(!otherVerified.error,'OTHER_VERIFY')
  const stale=await owner.auth.mfa.enroll({factorType:'totp',friendlyName:'Synthetic stale setup'});need(!stale.error,'STALE_ENROLL')
  const sibling=await owner.auth.mfa.enroll({factorType:'totp',friendlyName:'Synthetic sibling setup'});need(!sibling.error,'SIBLING_ENROLL')
  // Secret strings are never serialized; the old synthetic QR is intentionally unused.
  const staleChallenge=await owner.auth.mfa.challenge({factorId:stale.data.id});need(!staleChallenge.error,'STALE_CHALLENGE')
  need(await factorChallenges(stale.data.id)===1,'CHALLENGE_WITNESS')
  const beforeFactors=await allFactors(), keep=beforeFactors.filter(x=>x.id!==stale.data.id)
  phase='wrong-owner';const wrongOwner=await owner.auth.mfa.unenroll({factorId:otherSetup.data.id});report.wrongOwner=safeError(wrongOwner)
  check('Auth rejects another user factor and preserves every factor',!!wrongOwner.error&&digest(await allFactors())===digest(beforeFactors))
  guard=true;deleteCalls=0
  controller=createAccountMfa(owner.auth,{enabled:true,getScope:()=>({actor:ownerId,version:1}),timeoutMs:30000})
  phase='controller-review';await controller.open();await settle()
  check('existing application sees real unverified inventory at AAL1',controller.getState().phase==='choose'&&controller.getState().unfinished.length===2&&controller.getState().currentLevel==='aal1')
  controller.requestDiscard(otherSetup.data.id);await controller.discardUnfinished();await settle()
  check('application rejects an unlisted factor before DELETE',deleteCalls===0&&controller.getState().phase==='choose')
  controller.requestDiscard(stale.data.id);controller.cancelDiscard();await controller.discardUnfinished();await settle()
  check('cancellation makes no cleanup request',deleteCalls===0&&digest(await allFactors())===digest(beforeFactors))
  phase='one-supported-cleanup';controller.requestDiscard(stale.data.id);await controller.discardUnfinished();await settle()
  const afterFactors=await allFactors()
  report.cleanupObservation={deleteCalls,phase:controller.getState().phase,aal:controller.getState().currentLevel,
    selectedAbsent:!afterFactors.some(x=>x.id===stale.data.id),otherFactorsExact:digest(afterFactors)===digest(keep),
    beforeCount:beforeFactors.length,afterCount:afterFactors.length}
  check('one explicit owner DELETE removes exactly the selected unverified factor',deleteCalls===1&&!afterFactors.some(x=>x.id===stale.data.id)&&digest(afterFactors)===digest(keep))
  check('same-owner sibling and other-user verified factor remain exact',afterFactors.some(x=>x.id===sibling.data.id&&x.owner===ownerId&&x.status==='unverified')&&afterFactors.some(x=>x.id===otherSetup.data.id&&x.status==='verified'))
  check('only deleted-factor challenges cascade and no automatic enrollment follows',await factorChallenges(stale.data.id)===0&&controller.getState().phase==='choose'&&controller.getState().unfinished.length===1)
  check('Auth users stay active; exact application accounts roles and identities survive',digest(await accounts())===digest(base))
  phase='repeat-read';guard=false
  const repeat=await owner.auth.mfa.unenroll({factorId:stale.data.id});report.repeat=safeError(repeat)
  check('repeating an absent factor reports failure without changing another factor',!!repeat.error&&digest(await allFactors())===digest(keep))
  // A separate synthetic cleanup loses its success response: no blind retry.
  phase='unknown-outcome';guard=true;dropId=sibling.data.id;const count=deleteCalls
  controller.requestDiscard(sibling.data.id);await controller.discardUnfinished();await settle();await controller.discardUnfinished()
  check('lost success response interrupts and does not automatically replay',controller.getState().phase==='interrupted'&&deleteCalls===count+1)
  await controller.open();await settle()
  check('explicit read-only reconciliation observes absence without another DELETE',controller.getState().phase==='choose'&&controller.getState().unfinished.length===0&&deleteCalls===count+1)
  phase='fresh-enrollment';await controller.enroll();await settle();secret=controller.getState().secret
  check('explicit fresh enrollment returns a new QR and secret only in memory',controller.getState().phase==='setup'&&!!controller.getState().qr&&!!secret)
  await controller.verify(totp(secret,-20));await settle()
  check('expired synthetic TOTP cannot verify the replacement',controller.getState().phase==='verify'&&controller.getState().currentLevel!=='aal2')
  await controller.verify(totp(secret));secret='';await settle()
  check('new authenticator verification reaches actual AAL2 and a verified factor',controller.getState().phase==='verified'&&controller.getState().currentLevel==='aal2'&&controller.getState().factors.length===1)
  const verifiedId=controller.getState().factors[0].id, verifiedRows=await allFactors(), deletes=deleteCalls
  controller.requestDiscard(verifiedId);await controller.discardUnfinished();await settle()
  check('cleanup interface refuses a verified factor even at AAL2',deleteCalls===deletes&&digest(await allFactors())===digest(verifiedRows))
  phase='verified-at-aal1';guard=false
  const login=await owner.auth.signInWithPassword({email:'cleanup-owner@example.invalid',password});need(!login.error,'OWNER_RELOGIN')
  const verifiedDenial=await owner.auth.mfa.unenroll({factorId:verifiedId});report.verifiedAtAal1=safeError(verifiedDenial)
  check('real Auth refuses verified-factor unenrollment from AAL1',verifiedDenial.error?.code==='insufficient_aal'&&digest(await allFactors())===digest(verifiedRows))
  // A new AAL1 session still sees the verified factor and cannot discard it.
  phase='status-change';guard=true;controller.close();await controller.open();await settle();const oldCount=deleteCalls
  controller.requestDiscard(verifiedId);await controller.discardUnfinished();await settle()
  check('AAL1 inventory with a verified factor also blocks cleanup before DELETE',deleteCalls===oldCount&&digest(await allFactors())===digest(verifiedRows))
  const final=await fixture.engine.probe(fixture.db,'db-state')
  check('all user/account data, role bindings and original Auth migration receipts survive',digest(await accounts())===digest(base)&&digest(initial.migrations)===digest(final.migrations)&&initial.witness===final.witness&&final.users===2)
  const ownRole=await read(`select to_jsonb(role) from queue_private.accounts where id='${ownerId}'`)
  check('synthetic ADMIN role remains ADMIN after cleanup and AAL2',ownRole==='ADMIN')
  report.result='PASS'
}catch{report.result='FAIL';report.failurePhase=phase;report.failure='Synthetic cleanup stopped; private diagnostics suppressed';process.exitCode=1}
finally{
  secret='';key='';password='';controller?.stop();owner?.auth.stopAutoRefresh();other?.auth.stopAutoRefresh()
  try{await fixture.stop();report.stopped=[...fixture.engine.containers].every(()=>true);for(const id of fixture.engine.containers)need(!(await fixture.engine.inspect(id)).State.Running,'NOT_STOPPED')}catch{report.stopped=false;report.result='FAIL';process.exitCode=1}
  try{
    const services=await fence.retained(),current=await fence.inventory()
    report.retainedPreservation=rows===fence.retainedRead(preservationQuery).trim()&&extra===fence.retainedRead(extraSql).trim()&&services.every((x,i)=>x.id===before[i].id&&x.definition===before[i].definition&&(x.name.includes('vector')||digest(x)===digest(before[i])))
    report.exactResourceDelta=digest(current.volumes)===digest(inventory.volumes)&&digest(current.containers)===digest([...inventory.containers,...fixture.engine.containers].sort())&&digest(current.networks)===digest([...inventory.networks,...(fixture.engine.networkId?[fixture.engine.networkId]:[])].sort())
    need(report.retainedPreservation&&report.exactResourceDelta,'PRESERVATION')
  }catch{report.retainedPreservation=false;report.result='FAIL';process.exitCode=1}
  report.containers=[...fixture.engine.containers];report.network=fixture.engine.networkId||null;report.passed=report.checks.length
  writeFileSync(`supabase/tests/results/unverified_mfa_cleanup_${run}.json`,JSON.stringify(report,null,2),{flag:'wx'})
  console.log(JSON.stringify({run,result:report.result,passed:report.passed,failurePhase:report.failurePhase,sqlFailure:report.sqlFailure,retainedPreservation:report.retainedPreservation,exactResourceDelta:report.exactResourceDelta,stopped:report.stopped}))
}
