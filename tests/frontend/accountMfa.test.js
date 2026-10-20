import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAccountMfa, totpImage } from '../../src/lib/accountMfa.js'
import { guardMfaRequest, withMfaRequest } from '../../src/lib/mfaRequestPolicy.js'
const actor = '10000000-0000-4000-8000-000000000001', factorId = '20000000-0000-4000-8000-000000000002'
const sessionId = '30000000-0000-4000-8000-000000000003', challengeId = '40000000-0000-4000-8000-000000000004'
const settle = () => new Promise(resolve => setImmediate(resolve))
function fixture(options = {}) {
  let scope = { actor, version: 1 }, session = sessionId, level = 'aal1', factors = [], verified = 0
  const calls = [], states = []
  const ok = data => ({ data, error: null })
  const token = () => 'x.' + Buffer.from(JSON.stringify({ session_id: session })).toString('base64url') + '.x'
  const auth = {
    getSession: async () => ok({ session: { user: { id: actor }, expires_at: Date.now()/1000 + 600, access_token: token() } }),
    getUser: async () => ok({ user: { id: actor } }),
    mfa: {
      listFactors: async () => ok({ all: factors }),
      getAuthenticatorAssuranceLevel: async () => ok({ currentLevel: level, nextLevel: factors.length ? 'aal2' : level }),
      enroll: async () => { calls.push('enroll'); factors = [{ id: factorId, factor_type: 'totp', status: 'unverified' }]; return ok({ id: factorId, type: 'totp', totp: { secret: 'JBSWY3DPEHPK3PXP', qr_code: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>' } }) },
      challenge: async () => { calls.push('challenge'); return ok({ id: challengeId, expires_at: Date.now()/1000 + 60 }) },
      verify: async () => { calls.push('verify'); level='aal2'; factors[0].status='verified'; return ok({}) },
      unenroll: async () => { calls.push('unenroll'); factors=[]; return ok({ id:factorId }) },
    },
  }
  const controller = createAccountMfa(auth, { enabled: true, getScope: () => scope,
    onState: next => states.push(next), onVerified: () => { verified++ }, ...options })
  return { auth, controller, calls, states, get verified(){return verified},
    setScope: value => { scope=value; controller.accessChanged() }, setSession: value => { session=value },
    setFactors: value => { factors=value }, setLevel: value => { level=value } }
}
async function setup(f) { await f.controller.open(); await settle(); await f.controller.enroll(); await settle(); assert.equal(f.controller.getState().phase,'setup') }
test('MFA unavailable makes no factor or session API call and offers no setup',async()=>{
  const f=fixture({enabled:false}); f.auth.getSession=()=>{throw Error('Unexpected read')}
  await f.controller.open();assert.equal(f.controller.getState().phase,'unavailable');await f.controller.enroll();assert.deepEqual(f.calls,[])
})
test('explicit enrollment and verification use a fresh challenge and require AAL2 plus current factor',async()=>{
  const f=fixture();await setup(f);assert.ok(f.controller.getState().qr.startsWith('data:image/svg+xml;'))
  await f.controller.verify('123456');await settle()
  assert.equal(f.controller.getState().phase,'verified');assert.equal(f.verified,1)
  assert.deepEqual(f.calls,['enroll','challenge','verify']);assert.equal(f.controller.getState().secret,null)
  assert.ok(!JSON.stringify(f.controller.getState()).includes('access_token'))
})
test('malformed code is rejected before challenge and never enters public state',async()=>{
  const f=fixture();await setup(f);await f.controller.verify('invalid')
  assert.deepEqual(f.calls,['enroll']);assert.ok(!JSON.stringify(f.controller.getState()).includes('invalid'))
})
test('wrong code is sanitized, clears QR and supports an explicit fresh challenge',async()=>{
  const f=fixture();await setup(f);const verify=f.auth.mfa.verify
  f.auth.mfa.verify=async()=>({error:{code:'mfa_verification_failed',message:'PRIVATE_DIAGNOSTIC'}})
  await f.controller.verify('123456');await settle();assert.equal(f.controller.getState().phase,'verify')
  assert.equal(f.controller.getState().qr,null);assert.ok(!f.controller.getState().message.includes('PRIVATE'))
  f.auth.mfa.verify=verify;await f.controller.verify('654321');await settle()
  assert.equal(f.controller.getState().phase,'verified');assert.equal(f.calls.filter(x=>x==='challenge').length,2)
})
test('expired challenge is never submitted and interrupted setup is hidden',async()=>{
  const f=fixture();await setup(f);f.auth.mfa.challenge=async()=>({data:{id:challengeId,expires_at:1}})
  await f.controller.verify('123456');await settle();assert.equal(f.controller.getState().phase,'interrupted')
  assert.equal(f.controller.getState().secret,null);assert.ok(!f.calls.includes('verify'))
})
test('successful API response with insufficient AAL cannot claim successful verification',async()=>{
  const f=fixture();await setup(f);f.auth.mfa.verify=async()=>({data:{}})
  await f.controller.verify('123456');await settle();assert.equal(f.controller.getState().phase,'interrupted');assert.equal(f.verified,0)
})

test('an AAL2 claim without a currently verified TOTP factor cannot show verified success',async()=>{
 const f=fixture();f.setLevel('aal2');f.setFactors([{id:factorId,status:'unverified',factor_type:'totp'}])
 await f.controller.open();await settle();assert.equal(f.controller.getState().phase,'interrupted');assert.equal(f.verified,0)
})

test('provider diagnostics are never written to a console during interrupted MFA',async()=>{
 const f=fixture(),logs=[],warn=console.warn;console.warn=(...args)=>logs.push(args)
 try{f.auth.getUser=async()=>({error:{code:'PRIVATE_SETUP_MATERIAL',message:'PRIVATE_SETUP_MATERIAL'}});await f.controller.open();await settle();assert.deepEqual(logs,[]);assert.doesNotMatch(JSON.stringify(f.controller.getState()),/PRIVATE_SETUP_MATERIAL/)}finally{console.warn=warn}
})
test('same-user replacement session is rejected before factor mutation',async()=>{
  const f=fixture();await setup(f);f.setSession(challengeId);await f.controller.verify('123456');await settle()
  assert.equal(f.controller.getState().phase,'interrupted');assert.deepEqual(f.calls,['enroll'])
})
test('account access change clears setup immediately and late enrollment cannot restore it',async()=>{
  const f=fixture();await f.controller.open();await settle();let release
  const enroll=f.auth.mfa.enroll;f.auth.mfa.enroll=()=>new Promise(resolve=>{release=async()=>resolve(await enroll())})
  const pending=f.controller.enroll();await settle();f.setScope({actor:challengeId,version:2});await release();await pending;await settle()
  assert.equal(f.controller.getState().secret,null);assert.equal(f.controller.getState().phase,'interrupted')
})
test('cancelling an in-flight setup never duplicates it; reopening reviews unfinished factors',async()=>{
  const f=fixture();await f.controller.open();await settle();let release
  const enroll=f.auth.mfa.enroll;f.auth.mfa.enroll=()=>new Promise(resolve=>{release=async()=>resolve(await enroll())})
  const pending=f.controller.enroll();await settle();f.controller.close();await f.controller.open();await f.controller.enroll()
  await release();await pending;await settle();assert.equal(f.calls.length,1);assert.equal(f.controller.getState().phase,'closed')
  await f.controller.open();await settle();assert.equal(f.controller.getState().unfinished.length,1);assert.equal(f.controller.getState().secret,null)
})
test('expired or server-rejected sessions cannot enroll and reveal no raw diagnostics',async()=>{
  const f=fixture();f.auth.getUser=async()=>({error:{status:401,message:'PRIVATE_DIAGNOSTIC'}})
  await f.controller.open();await settle();await f.controller.enroll();assert.deepEqual(f.calls,[])
  assert.equal(f.controller.getState().phase,'interrupted');assert.ok(!f.controller.getState().message.includes('PRIVATE'))
})
test('only explicitly selected verified TOTP factors can be challenged',async()=>{
  const f=fixture();f.setFactors([{id:factorId,status:'verified',factor_type:'totp'}]);await f.controller.open();await settle()
  f.controller.select(challengeId);await f.controller.verify('123456');assert.deepEqual(f.calls,[])
  f.controller.select(factorId);await f.controller.verify('123456');await settle();assert.equal(f.controller.getState().phase,'verified')
})
test('unfinished setup can be resumed without exposing a setup key or deleting a factor',async()=>{
  const f=fixture();f.setFactors([{id:factorId,status:'unverified',factor_type:'totp'}]);await f.controller.open();await settle()
  f.controller.select(factorId);assert.equal(f.controller.getState().phase,'verify');assert.equal(f.controller.getState().secret,null)
  await f.controller.verify('123456');await settle();assert.equal(f.controller.getState().phase,'verified');assert.ok(!f.calls.includes('unenroll'))
})
test('unfinished setup blocks duplicate enrollment and no discard happens without explicit confirmation',async()=>{
  const f=fixture();f.setFactors([{id:factorId,status:'unverified',factor_type:'totp'}]);await f.controller.open();await settle()
  await f.controller.enroll();await f.controller.discardUnfinished();assert.deepEqual(f.calls,[])
  f.controller.requestDiscard(factorId);assert.equal(f.controller.getState().phase,'confirm-reset');assert.deepEqual(f.calls,[])
  f.controller.cancelDiscard();await f.controller.discardUnfinished();assert.equal(f.controller.getState().phase,'choose');assert.deepEqual(f.calls,[])
})

test('explicit reviewed discard removes only the chosen unverified setup and never reenrolls',async()=>{
  const f=fixture();f.setFactors([{id:factorId,status:'unverified',factor_type:'totp'}]);await f.controller.open();await settle()
  f.controller.requestDiscard(factorId);await f.controller.discardUnfinished();await settle()
  assert.deepEqual(f.calls,['unenroll']);assert.equal(f.controller.getState().phase,'choose');assert.equal(f.controller.getState().unfinished.length,0)
  assert.equal(f.controller.getState().qr,null);assert.equal(f.verified,0)
})

test('verified factors, AAL2, unknown IDs and status changes cannot pass unfinished discard',async()=>{
  for(const [status,level]of [['verified','aal1'],['unverified','aal2']]){
    const f=fixture();f.setFactors([{id:factorId,status,factor_type:'totp'}]);f.setLevel(level);await f.controller.open();await settle()
    f.controller.requestDiscard(factorId);await f.controller.discardUnfinished();assert.deepEqual(f.calls,[])
  }
  const f=fixture();f.setFactors([{id:factorId,status:'unverified',factor_type:'totp'}]);await f.controller.open();await settle()
  f.controller.requestDiscard(challengeId);assert.equal(f.controller.getState().phase,'choose')
  f.controller.requestDiscard(factorId);f.setFactors([{id:factorId,status:'verified',factor_type:'totp'}]);await f.controller.discardUnfinished();await settle()
  assert.deepEqual(f.calls,[]);assert.equal(f.controller.getState().phase,'interrupted')
})

test('session change or ambiguous discard cannot silently remove another setup or auto retry',async()=>{
  const f=fixture();f.setFactors([{id:factorId,status:'unverified',factor_type:'totp'}]);await f.controller.open();await settle()
  f.controller.requestDiscard(factorId);f.setSession(challengeId);await f.controller.discardUnfinished();await settle()
  assert.deepEqual(f.calls,[])
  const second=fixture();second.setFactors([{id:factorId,status:'unverified',factor_type:'totp'}]);await second.controller.open();await settle()
  let attempts=0;second.auth.mfa.unenroll=async()=>{attempts++;throw Error('PRIVATE_DIAGNOSTIC')}
  second.controller.requestDiscard(factorId);await second.controller.discardUnfinished();await settle();await second.controller.discardUnfinished()
  assert.equal(attempts,1);assert.equal(second.controller.getState().phase,'interrupted');assert.ok(!second.controller.getState().message.includes('PRIVATE'))
})

test('unfinished discard transport pins AAL1 and rejects an SDK AAL2 switch',async()=>{
  const url='http://127.0.0.1:54321/auth/v1/factors/'+factorId
  const headers=aal=>({authorization:'Bearer x.'+Buffer.from(JSON.stringify({sub:actor,session_id:sessionId,aal,exp:Date.now()/1000+600})).toString('base64url')+'.x'})
  await withMfaRequest({actor,session:sessionId,requiredAal:'aal1'},()=>true,async()=>{
    guardMfaRequest(url,{headers:headers('aal1')});assert.throws(()=>guardMfaRequest(url,{headers:headers('aal2')}))
  })
})
test('timed-out enrollment stays locked until settlement and never retries automatically',async()=>{
  const f=fixture({timeoutMs:20});await f.controller.open();await settle();let release
  f.auth.mfa.enroll=()=>new Promise(resolve=>{release=()=>resolve({error:{code:'timeout'}})})
  await f.controller.enroll();assert.equal(f.controller.getState().phase,'interrupted');assert.equal(f.controller.getState().busy,true)
  await f.controller.open();assert.equal(f.controller.getState().phase,'interrupted');release();await settle();assert.equal(f.controller.getState().busy,false)
})
test('QR renderer rejects remote URLs and active SVG content; no raw HTML insertion',()=>{
  for(const value of ['https://example.invalid/qr','<svg onload="x()"></svg>','<svg><image href="https://example.invalid"/></svg>'])assert.throws(()=>totpImage(value))
  assert.ok(totpImage('<svg><path d="M0 0"/></svg>').startsWith('data:image/svg+xml;'))
})
test('QR renderer accepts authentic SVGo XML metadata without allowing active/external content',()=>{
 const prefix='data:image/svg+xml;utf-8,<?xml version="1.0"?>\n<!-- Generated by SVGo -->\n'
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="white"/><path d="M0 0h1v1z"/></svg>'
 const image=totpImage(prefix+svg);assert.ok(decodeURIComponent(image).endsWith(svg));assert.doesNotMatch(decodeURIComponent(image),/<\?xml|<!--/)
 for(const body of ['<svg onload="alert(1)"></svg>','<svg><script>alert(1)</script></svg>','<!DOCTYPE svg [<!ENTITY x SYSTEM "https://example.invalid">]><svg/>','<svg><image href="https://example.invalid"/></svg>'])assert.throws(()=>totpImage(prefix+body))
})
test('QR renderer accepts actual Auth-sized SVGs while retaining a one-MiB bound',()=>{
 const large='<svg>'+ '<rect x="1" y="1" width="1" height="1"/>'.repeat(9500)+'</svg>'
 assert.ok(large.length>200000);assert.ok(totpImage(large).startsWith('data:image/svg+xml;'))
 assert.throws(()=>totpImage('<svg>'+ ' '.repeat(1024*1024)+'</svg>'))
})
test('a rejected QR retains private manual setup for the same factor without duplicate enrollment',async()=>{
 const f=fixture(),enroll=f.auth.mfa.enroll
 f.auth.mfa.enroll=async()=>{const data=await enroll();data.data.totp.qr_code='https://example.invalid/qr';return data}
 await setup(f);assert.equal(f.controller.getState().phase,'setup');assert.equal(f.controller.getState().qr,null);assert.ok(f.controller.getState().secret)
 await f.controller.enroll();assert.deepEqual(f.calls,['enroll']);f.controller.close();assert.equal(f.controller.getState().secret,null)
})
test('close and stop remove setup material without unenrolling an existing factor',async()=>{
  const f=fixture();await setup(f);f.controller.close();assert.equal(f.controller.getState().secret,null)
  f.controller.stop();assert.equal(f.controller.getState().qr,null);assert.ok(!f.calls.includes('unenroll'))
})
test('MFA transport rejects account/session retargeting and cancelled intents before sending',async()=>{
  const url='http://127.0.0.1:54321/auth/v1/factors'
  const headers=(sub,sid)=>({authorization:'Bearer x.'+Buffer.from(JSON.stringify({sub,session_id:sid,exp:Date.now()/1000+600})).toString('base64url')+'.x'})
  assert.throws(()=>guardMfaRequest(url,{headers:headers(actor,sessionId)}))
  await withMfaRequest({actor,session:sessionId},()=>true,async()=>{
    guardMfaRequest(url,{headers:headers(actor,sessionId)})
    assert.throws(()=>guardMfaRequest(url,{headers:headers(factorId,sessionId)}))
    assert.throws(()=>guardMfaRequest(url,{headers:headers(actor,challengeId)}))
  })
  await withMfaRequest({actor,session:sessionId},()=>false,async()=>{assert.throws(()=>guardMfaRequest(url,{headers:headers(actor,sessionId)}))})
})
