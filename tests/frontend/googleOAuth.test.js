import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { createGoogleOAuthController } from '../../src/lib/googleOAuth.js'
import { authenticatedAuthOptions, captureOAuthCallback, validateGoogleAuthorizationUrl, OAUTH_CALLBACK,
  OAUTH_ORIGIN, OAUTH_MARKER, googleProviderEnabled, isDevelopmentLoginPath } from '../../src/lib/oauthConfig.js'

const turn=()=>new Promise(r=>setTimeout(r,5))
const deferred=()=>{ let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject} }
const storage=()=>{ const map=new Map();return{getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)} }
const session={user:{id:'verified-user',user_metadata:{role:'ADMIN',email:'eabeso63122@liceo.edu.ph'}},expires_at:Date.now()/1000+3600,access_token:'PRIVATE-OAUTH-TOKEN'}
const authorization=()=>`http://127.0.0.1:54321/auth/v1/authorize?${new URLSearchParams({provider:'google',redirect_to:OAUTH_CALLBACK,code_challenge:'a'.repeat(43),code_challenge_method:'s256',prompt:'select_account'})}`
function harness(options={}) {
  const store=options.store||storage(),tabStore=storage(),accepted=[],rejected=[],navigations=[],states=[]
  let calls=0,version=0,current=null
  const auth={getSession:async()=>({data:{session:current},error:null}),getUser:async()=>({data:{user:current?.user},error:null}),
    signInWithOAuth:async args=>{calls++;assert.equal(args.provider,'google');assert.equal(args.options.redirectTo,OAUTH_CALLBACK);assert.equal(args.options.skipBrowserRedirect,true);return{data:{url:authorization()},error:null}},
    exchangeCodeForSession:async()=>{current=session;return{data:{session},error:null}},...options.auth}
  const access={beginExternal:()=>++version,acceptExternal:(action,s)=>accepted.push({action,s}),rejectExternal:(action,message)=>rejected.push({action,message})}
  const controller=createGoogleOAuthController(auth,access,{store,tabStore,origin:OAUTH_ORIGIN,navigate:url=>navigations.push(url),cleanPath:()=>{},
    providerEnabled:async()=>true,lock:async fn=>fn(),onState:s=>states.push(s),...options,auth:undefined})
  return{controller,auth,store,tabStore,accepted,rejected,navigations,states,get calls(){return calls},setSession:s=>{current=s}}
}
test('SDK configuration selects PKCE with one manual URL exchange',()=>{
  assert.equal(authenticatedAuthOptions.flowType,'pkce');assert.equal(authenticatedAuthOptions.detectSessionInUrl,false)
  assert.equal(authenticatedAuthOptions.persistSession,true)
})
test('authorization destination validates exact local route, callback, Google and S256',()=>{
  assert.equal(new URL(validateGoogleAuthorizationUrl(authorization())).hostname,'127.0.0.1')
  for(const change of [u=>u.hostname='evil.invalid',u=>u.pathname='/redirect',u=>u.username='user',u=>u.hash='token',
    u=>u.searchParams.set('provider','github'),u=>u.searchParams.set('redirect_to','https://evil.invalid'),
    u=>u.searchParams.set('code_challenge_method','plain'),u=>u.searchParams.append('provider','google'),u=>u.searchParams.set('role','ADMIN')]) {
    const url=new URL(authorization());change(url);assert.throws(()=>validateGoogleAuthorizationUrl(url.href))
  }
})
test('callback captures only exact local path and scrubs codes/errors before returning',()=>{
  let replaced
  const parsed=captureOAuthCallback({href:`${OAUTH_CALLBACK}?code=PRIVATE-CODE`},{replaceState:(_,__,url)=>replaced=url})
  assert.equal(parsed.code,'PRIVATE-CODE');assert.equal(replaced,'/auth/callback')
  assert.equal(captureOAuthCallback({href:`${OAUTH_ORIGIN}/display?code=PRIVATE-CODE`},{replaceState:(_,__,url)=>replaced=url}),null)
  assert.equal(replaced,'/display')
})
test('callback rejects duplicate codes, implicit tokens, foreign origin and mixed errors',()=>{
  for(const url of [`${OAUTH_CALLBACK}?code=a&code=b`,`${OAUTH_CALLBACK}#access_token=PRIVATE`,`${OAUTH_CALLBACK}?code=a&error=denied`,
    'https://evil.invalid/auth/callback?code=a',`${OAUTH_CALLBACK}?code=a&next=//evil.invalid`]) {
    const entry=captureOAuthCallback({href:url},{replaceState(){}});assert.equal(entry.invalid,true);assert.equal(entry.code,null)
  }
})
test('Google start uses exactly one intent and validated navigation without roles/emails',async()=>{
  const h=harness();await h.controller.start();assert.equal(h.calls,1);assert.equal(h.navigations.length,1)
  const marker=JSON.parse(h.store.getItem(OAUTH_MARKER));assert.equal(marker.phase,'redirect')
  assert.doesNotMatch(JSON.stringify(h.states)+h.store.getItem(OAUTH_MARKER),/PRIVATE|eabeso|ADMIN|access_token/)
})
test('disabled provider performs no OAuth preparation or browser navigation',async()=>{
  const h=harness({providerEnabled:async()=>false});await h.controller.start()
  assert.equal(h.calls,0);assert.equal(h.navigations.length,0);assert.match(h.controller.getState().message,/not available yet/)
})
test('unsupported origin and unsafe returned URL fail closed',async()=>{
  for(const h of [harness({origin:'http://localhost:5173'}),harness({auth:{signInWithOAuth:async()=>({data:{url:'https://evil.invalid'},error:null})}})]) {
    await h.controller.start();assert.equal(h.navigations.length,0);assert.equal(h.controller.getState().phase,'error')
  }
})
test('existing session must be signed out before Google account switching',async()=>{
  const h=harness();h.setSession(session);await h.controller.start();assert.equal(h.calls,0);assert.match(h.controller.getState().message,/Sign out/)
})
test('duplicate callback uses one exchange and verifies server user before accepting',async()=>{
  const h=harness();await h.controller.start();let exchanges=0
  const exchange=h.auth.exchangeCodeForSession;h.auth.exchangeCodeForSession=async code=>{exchanges++;return exchange(code)}
  const entry={code:'PRIVATE-CODE'}
  await Promise.all([h.controller.callback(entry),h.controller.callback(entry)])
  assert.equal(exchanges,1);assert.equal(h.accepted.length,1);assert.equal(entry.code,null)
  assert.equal(h.controller.getState().phase,'complete')
})
test('reloaded interrupted callback never exchanges a code again',async()=>{
  const h=harness();await h.controller.start()
  const marker=JSON.parse(h.store.getItem(OAUTH_MARKER));h.store.setItem(OAUTH_MARKER,JSON.stringify({...marker,phase:'exchanging'}))
  let called=false;h.auth.exchangeCodeForSession=()=>{called=true}
  await h.controller.callback({code:'SINGLE-USE'});assert.equal(called,false);assert.equal(h.accepted.length,0)
})
test('cancellation masks provider text and cannot adopt a workspace',async()=>{
  const h=harness();await h.controller.start();await h.controller.callback({cancelled:true,error:true,code:null})
  assert.equal(h.accepted.length,0);assert.equal(h.controller.getState().phase,'cancelled')
})
test('missing verifier or expired code remains generic with explicit reconciliation',async()=>{
  for(const code of ['pkce_verifier_missing','flow_state_expired']) {
    const h=harness({auth:{exchangeCodeForSession:async()=>({error:{code,message:'PRIVATE PROVIDER DIAGNOSTIC'},data:{session:null}})}})
    await h.controller.start();await h.controller.callback({code:'PRIVATE-CODE'})
    assert.equal(h.accepted.length,0);assert.equal(h.controller.getState().phase,'uncertain')
    assert.doesNotMatch(JSON.stringify(h.states),/PRIVATE|pkce_verifier|flow_state_expired/)
  }
})
test('interrupted exchange cannot automatically restore access when its response arrives late',async()=>{
  const pending=deferred();const h=harness({timeoutMs:10,auth:{exchangeCodeForSession:()=>pending.promise}})
  await h.controller.start();await h.controller.callback({code:'PRIVATE-CODE'})
  h.setSession(session);pending.resolve({data:{session},error:null});await turn()
  assert.equal(h.accepted.length,0);assert.equal(h.controller.getState().phase,'uncertain')
  await h.controller.reconcile();assert.equal(h.accepted.length,1)
})
test('cancel/logout invalidates late callback and leaves persistent access gate',async()=>{
  const pending=deferred();const h=harness({auth:{exchangeCodeForSession:()=>pending.promise}})
  await h.controller.start();const task=h.controller.callback({code:'PRIVATE-CODE'});await turn();h.controller.cancel()
  h.setSession(session);pending.resolve({data:{session},error:null});await task
  assert.equal(h.accepted.length,0);assert.equal(h.controller.shouldGate(),true)
})

test('checking a cancelled sign-in reaches a generic error instead of waiting forever',async()=>{
  const h=harness();await h.controller.start();h.controller.cancel();h.setSession(session)
  await h.controller.reconcile()
  assert.equal(h.accepted.length,0)
  assert.equal(h.controller.getState().phase,'error')
  assert.match(h.controller.getState().message,/No sign-in could be verified/)
})

test('reconciliation cannot remain checking when its flow marker disappears',async()=>{
  const h=harness();await h.controller.start();h.setSession(session)
  h.auth.getUser=async()=>{h.store.removeItem(OAUTH_MARKER);return{data:{user:session.user},error:null}}
  await h.controller.reconcile()
  assert.equal(h.accepted.length,0)
  assert.equal(h.controller.getState().phase,'error')
})
test('other-tab marker blocks competing verifier generation and context restoration',async()=>{
  const store=storage(),one=harness({store}),two=harness({store});await one.controller.start();await two.controller.start()
  assert.equal(two.calls,0);assert.equal(two.accepted.length,0);assert.match(two.controller.getState().message,/Another tab/)
})
test('unmount prevents pending OAuth navigation',async()=>{
  const pending=deferred();const h=harness({providerEnabled:()=>pending.promise})
  const task=h.controller.start();h.controller.stop();pending.resolve(true);await task;assert.equal(h.navigations.length,0)
})
test('development password route is never selected in a production build',()=>{
  assert.equal(isDevelopmentLoginPath(true,'/dev/login'),true)
  assert.equal(isDevelopmentLoginPath(false,'/dev/login'),false)
  assert.equal(isDevelopmentLoginPath(true,'/'),false)
})
test('provider availability is a local public read and returns only the Google boolean',async()=>{
  let request
  const value=await googleProviderEnabled(async(url,options)=>{request={url,options};return{ok:true,json:async()=>({external:{google:false,email:true}})}},'PUBLIC-KEY')
  assert.equal(value,false);assert.equal(request.url,'http://127.0.0.1:54321/auth/v1/settings');assert.equal(request.options.redirect,'error')
})
test('actual installed SDK creates S256 verifier without network and missing verifier fails locally',async()=>{
  const store=storage();let network=0
  const client=createClient('http://127.0.0.1:54321','sb_publishable_offline',{auth:{...authenticatedAuthOptions,autoRefreshToken:false,persistSession:false,storage:store},
    global:{fetch:()=>{network++;throw new Error('Offline test forbids HTTP')}}})
  const result=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:OAUTH_CALLBACK,skipBrowserRedirect:true,queryParams:{prompt:'select_account'}}})
  assert.equal(result.error,null);validateGoogleAuthorizationUrl(result.data.url);assert.equal(network,0)
  await client.auth.signOut({scope:'local'}) // No session: clears local SDK verifier state only.
  const missing=await client.auth.exchangeCodeForSession('OFFLINE-CODE')
  assert.ok(missing.error);assert.equal(network,0);client.auth.stopAutoRefresh()
})
