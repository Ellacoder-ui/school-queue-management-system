// Deterministic protocol/policy tests, with no browser or network access.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createBrowserInterception, publicRequestPolicy} from './browserInterception.mjs'
import {cdpError} from '../../supabase/tests/cdp_errors.mjs'

const config={origin:'http://127.0.0.1:5175',api:'http://127.0.0.1:54321',publicKey:'TEST_PUBLIC_KEY'}
const request=(overrides={})=>({url:config.api+'/rest/v1/counter_state?select=counter_label',method:'GET',
  headers:{apikey:config.publicKey,authorization:`Bearer ${config.publicKey}`,'accept-profile':'queue_display'},...overrides})
const event=(overrides={})=>({requestId:'fetch-1',networkId:'network-1',request:request(),...overrides})
class Browser {
  handlers=new Map(); commands=[]; hook=null
  on(name,fn) {
    if(!this.handlers.has(name)) this.handlers.set(name,new Set())
    this.handlers.get(name).add(fn)
    return()=>{this.handlers.get(name).delete(fn);if(!this.handlers.get(name).size)this.handlers.delete(name)}
  }
  emit(name,data) { for(const fn of [...this.handlers.get(name)||[]]) fn(data) }
  async send(method,params={}) {
    this.commands.push({method,params})
    if(method==='Page.navigate') this.emit('Page.frameNavigated',{frame:{url:params.url}})
    return await this.hook?.(method,params)
  }
}
async function setup(options) {
  const browser=new Browser(),guard=createBrowserInterception(browser,config,{cancellationWaitMs:10,...options})
  await guard.start();return{browser,guard}
}
const aborted={requestId:'network-1',canceled:true,errorText:'net::ERR_ABORTED'}
const invalid=method=>cdpError(method,{code:-32602,message:'Invalid InterceptionId.'})

test('normal public GET, context RPC and endpoint-specific preflight are permitted',async()=>{
  const {browser,guard}=await setup();browser.emit('Fetch.requestPaused',event());await guard.drain()
  assert.equal(browser.commands.at(-1).method,'Fetch.continueRequest');assert.equal(guard.healthy(),true)
  assert.equal(publicRequestPolicy(request({url:config.api+'/rest/v1/rpc/public_queue_context',method:'POST',headers:{apikey:config.publicKey,authorization:`Bearer ${config.publicKey}`,'content-profile':'queue_display'}}),config).allowed,true)
  assert.equal(publicRequestPolicy(request({method:'OPTIONS',headers:{origin:config.origin,'access-control-request-method':'GET'}}),config).allowed,true)
  assert.equal(publicRequestPolicy(request({method:'OPTIONS',headers:{origin:config.origin,'access-control-request-method':'POST'}}),config).allowed,false)
  await guard.stop()
})
test('private profile remains fatal and is failed before forwarding',async()=>{
  const {browser,guard}=await setup();browser.emit('Fetch.requestPaused',event({request:request({headers:{apikey:config.publicKey,authorization:`Bearer ${config.publicKey}`,'accept-profile':'queue_private'}})}))
  await guard.drain();assert.equal(guard.healthy(),false);assert.equal(browser.commands.at(-1).method,'Fetch.failRequest');await guard.stop()
})
test('hosted destinations fail even when carrying correct public credentials',async()=>{
  const {browser,guard}=await setup();browser.emit('Fetch.requestPaused',event({request:request({url:'https://example.invalid/rest/v1/counter_state?token=PRIVATE_URL_CANARY'})}))
  await guard.drain();assert.equal(guard.healthy(),false);assert.equal(browser.commands.at(-1).method,'Fetch.failRequest')
  assert.ok(!JSON.stringify(guard.diagnostics).includes('PRIVATE_URL_CANARY'));await guard.stop()
})
test('operational RPCs and POST/PATCH/DELETE projection writes fail',async()=>{
  for(const r of [request({url:config.api+'/rest/v1/rpc/issue_ticket',method:'POST'}),...['POST','PATCH','DELETE'].map(method=>request({method}))]) {
    const {browser,guard}=await setup();browser.emit('Fetch.requestPaused',event({request:r}));await guard.drain()
    assert.equal(guard.healthy(),false);assert.equal(browser.commands.at(-1).method,'Fetch.failRequest');await guard.stop()
  }
})
test('cancellation observed before pause requires no stale continuation',async()=>{
  const {browser,guard}=await setup();browser.emit('Network.loadingFailed',aborted);browser.emit('Fetch.requestPaused',event());await guard.drain()
  assert.equal(guard.diagnostics.requests[0].state,'cancelled-before-command')
  assert.equal(browser.commands.filter(c=>c.method==='Fetch.continueRequest').length,0);assert.equal(guard.healthy(),true);await guard.stop()
})
test('the reproduced -32602 race requires matching canceled ERR_ABORTED Network event',async()=>{
  const {browser,guard}=await setup();browser.hook=async method=>{if(method==='Fetch.continueRequest'){browser.emit('Network.loadingFailed',aborted);throw invalid(method)}}
  browser.emit('Fetch.requestPaused',event());await guard.drain()
  assert.equal(guard.diagnostics.benign_cancellations.length,1);assert.equal(guard.healthy(),true);await guard.stop()
})
test('late cancellation correlation is bounded and tied to the same request',async()=>{
  const {browser,guard}=await setup({cancellationWaitMs:30});browser.hook=async method=>{if(method==='Fetch.continueRequest'){setTimeout(()=>browser.emit('Network.loadingFailed',aborted),1);throw invalid(method)}}
  browser.emit('Fetch.requestPaused',event());await guard.drain();assert.equal(guard.healthy(),true);assert.equal(guard.diagnostics.benign_cancellations.length,1);await guard.stop()
})
test('uncorrelated invalid IDs and mismatched cancellation IDs remain fatal',async()=>{
  for(const requestId of ['different-network','none']) {
    const {browser,guard}=await setup();browser.hook=async method=>{if(method==='Fetch.continueRequest'){browser.emit('Network.loadingFailed',{...aborted,requestId});throw invalid(method)}}
    browser.emit('Fetch.requestPaused',event());await guard.drain();assert.equal(guard.healthy(),false);await guard.stop()
  }
})
test('unsupported protocol codes are fatal despite genuine cancellation',async()=>{
  const {browser,guard}=await setup();browser.hook=async method=>{if(method==='Fetch.continueRequest'){browser.emit('Network.loadingFailed',aborted);throw cdpError(method,{code:-32000,message:'Invalid InterceptionId.'})}}
  browser.emit('Fetch.requestPaused',event());await guard.drain();assert.equal(guard.healthy(),false);await guard.stop()
})
test('matching code with unrecognized message and unrelated network failure stay fatal',async()=>{
  for(const [options,canceled] of [[{code:-32602,message:'PRIVATE_UNKNOWN_MESSAGE'},true], [{code:-32602,message:'Invalid InterceptionId.'},false]]) {
    const {browser,guard}=await setup();browser.hook=async method=>{if(method==='Fetch.continueRequest'){browser.emit('Network.loadingFailed',{...aborted,canceled});throw cdpError(method,options)}}
    browser.emit('Fetch.requestPaused',event());await guard.drain();assert.equal(guard.healthy(),false)
    assert.ok(!JSON.stringify(guard.diagnostics).includes('PRIVATE_UNKNOWN_MESSAGE'));await guard.stop()
  }
})
test('duplicate and stale identical pause events receive at most one terminal command',async()=>{
  const {browser,guard}=await setup();browser.emit('Fetch.requestPaused',event());browser.emit('Fetch.requestPaused',event());await guard.drain()
  browser.emit('Fetch.requestPaused',event());await guard.drain()
  assert.equal(browser.commands.filter(c=>c.method==='Fetch.continueRequest').length,1);assert.equal(guard.diagnostics.duplicates,2);assert.equal(guard.healthy(),true);await guard.stop()
})
test('a conflicting duplicate or cancelled forbidden request cannot bypass policy',async()=>{
  const {browser,guard}=await setup();browser.emit('Fetch.requestPaused',event());await guard.drain()
  browser.emit('Network.loadingFailed',aborted);browser.emit('Fetch.requestPaused',event({request:request({url:config.api+'/rest/v1/rpc/call_next',method:'POST'})}))
  await guard.drain();assert.equal(guard.healthy(),false);assert.equal(guard.diagnostics.policy_violations.length,1);await guard.stop()
})
test('unexpected runtime exceptions and target detachment remain fatal',async()=>{
  for(const name of ['Runtime.exceptionThrown','Inspector.detached']) {
    const {browser,guard}=await setup();browser.emit(name,{description:'PRIVATE_EXCEPTION_CANARY'});assert.equal(guard.healthy(),false)
    assert.ok(!JSON.stringify(guard.diagnostics).includes('PRIVATE_EXCEPTION_CANARY'));await guard.stop()
  }
})
test('owned tab shutdown drains in-flight cancellation before disabling and removes every handler',async()=>{
  const {browser,guard}=await setup();let rejectContinuation
  browser.hook=async method=>{
    if(method==='Fetch.continueRequest') await new Promise((_,reject)=>{rejectContinuation=reject})
    if(method==='Page.stopLoading'){browser.emit('Network.loadingFailed',aborted);rejectContinuation(invalid('Fetch.continueRequest'))}
  }
  browser.emit('Fetch.requestPaused',event());await new Promise(resolve=>setImmediate(resolve));await guard.stop()
  assert.equal(guard.healthy(),true);assert.equal(browser.handlers.size,0);assert.equal(guard.diagnostics.owned_handlers,0)
  const commands=browser.commands.map(c=>c.method)
  assert.ok(commands.indexOf('Fetch.disable')>commands.indexOf('Page.stopLoading'))
  const count=browser.commands.length;await guard.stop();browser.emit('Fetch.requestPaused',event());assert.equal(browser.commands.length,count)
})
test('cleanup failure is recorded without leaving handlers or passing acceptance',async()=>{
  const {browser,guard}=await setup();browser.hook=async method=>{if(method==='Page.stopLoading')throw cdpError(method,{code:-32001,message:'UNKNOWN'})}
  await guard.stop();assert.equal(guard.healthy(),false);assert.equal(browser.handlers.size,0)
})
