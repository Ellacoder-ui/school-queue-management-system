// Software-test fence. Diagnostics never serialize URLs, headers, claims or bodies.
const publicPaths = new Map([
  ['/rest/v1/counter_state', {method:'GET', category:'public-projection'}],
  ['/rest/v1/service_state', {method:'GET', category:'public-projection'}],
  ['/rest/v1/rpc/public_queue_context', {method:'POST', category:'public-context'}],
])
const sensitiveParameter = /(?:token|password|secret|credential|api[-_]?key|code)/i
const safeMethod = method => ['GET','HEAD','POST','OPTIONS','PUT','PATCH','DELETE'].includes(method) ? method : 'OTHER'
export function publicRequestPolicy(request, {origin, api, publicKey}) {
  let url
  try { url = new URL(request.url) } catch { return {allowed:false,category:'malformed-url'} }
  const headers = Object.fromEntries(Object.entries(request.headers || {}).map(([k,v])=>[k.toLowerCase(),v]))
  const deny = category => ({allowed:false,category})
  if (url.username || url.password || [...url.searchParams.keys()].some(key=>sensitiveParameter.test(key))) return deny('credential-bearing-url')
  if (url.origin===origin) return {allowed:['GET','HEAD'].includes(request.method),category:'app-resource'}
  if (url.origin!==api) return deny('external-endpoint')
  const route=publicPaths.get(url.pathname)
  if (!route) return deny(url.pathname.startsWith('/auth/') ? 'auth-endpoint' : 'unapproved-api-endpoint')
  if (request.method==='OPTIONS') return {category:'public-preflight',
    allowed:headers.origin===origin && headers['access-control-request-method']===route.method}
  if (request.method!==route.method) return deny('operational-method')
  if (headers.apikey!==publicKey || headers.authorization!==`Bearer ${publicKey}`) return deny('unexpected-credentials')
  const profile=route.method==='GET' ? headers['accept-profile'] : headers['content-profile']
  if (profile!=='queue_display' || ['accept-profile','content-profile'].some(key=>headers[key] && headers[key]!=='queue_display')) return deny('private-or-unexpected-profile')
  if (headers.cookie) return deny('unexpected-cookie')
  return {allowed:true,category:route.category}
}

const cancelled = failure => failure?.canceled===true && failure.category==='net::ERR_ABORTED'
export const isCancelledInterception = (protocol, failure) =>
  ['Fetch.continueRequest','Fetch.fulfillRequest'].includes(protocol?.method)
  && protocol.code===-32602 && protocol.category==='invalid-interception-id' && cancelled(failure)
const safeFailure = event => ({canceled:event.canceled===true,
  category:['net::ERR_ABORTED','net::ERR_INTERNET_DISCONNECTED'].includes(event.errorText) ? event.errorText : 'other-network-failure'})

export function createBrowserInterception(browser, config, {respond=()=>null, phase=()=> 'test', cancellationWaitMs=200}={}) {
  const entries=new Map(), failures=new Map(), pending=new Set(), disposers=[]
  const diagnostics={requests:[],protocol_errors:[],benign_cancellations:[],policy_violations:[],fatal_errors:[],
    duplicates:0,closed:false,owned_handlers:0}
  let stopping=false
  function on(method, fn) { disposers.push(browser.on(method,fn)); diagnostics.owned_handlers++ }
  function fatal(category, entry, protocol) {
    diagnostics.fatal_errors.push({category,...(entry ? {ordinal:entry.trace.ordinal} : {}),...(protocol ? {protocol} : {})})
  }
  function networkFailed(event) {
    const failure=safeFailure(event)
    failures.set(event.requestId,failure)
    for (const entry of entries.values()) if (entry.networkId===event.requestId) {
      entry.trace.network_failure=failure
      entry.notifyCancellation?.()
    }
  }
  async function correlateCancellation(entry) {
    if (cancelled(entry.trace.network_failure)) return true
    // Chrome may deliver the loadingFailed event just after the command reply.
    await new Promise(resolve => {
      const timer=setTimeout(()=>{entry.notifyCancellation=null;resolve()},cancellationWaitMs)
      entry.notifyCancellation=()=>{clearTimeout(timer);entry.notifyCancellation=null;resolve()}
    })
    return cancelled(entry.trace.network_failure)
  }
  async function handle(entry,event) {
    const trace=entry.trace
    try {
      if (!trace.permitted) {
        trace.action='Fetch.failRequest'
        await browser.send(trace.action,{requestId:event.requestId,errorReason:'BlockedByClient'})
        trace.state='failed-by-policy'; return
      }
      // This request already ceased to exist; Chrome's own cancellation is terminal.
      if (cancelled(trace.network_failure)) { trace.state='cancelled-before-command'; return }
      const fixture=await respond(event,entry.decision)
      if (cancelled(trace.network_failure)) { trace.state='cancelled-before-command'; return }
      trace.action=fixture ? 'Fetch.fulfillRequest' : 'Fetch.continueRequest'
      await browser.send(trace.action,{...fixture,requestId:event.requestId})
      trace.state=fixture ? 'fulfilled' : 'continued'
    } catch(error) {
      const protocol=error.cdp || {code:null,category:'non-protocol-error'}
      const diagnostic={protocol,ordinal:trace.ordinal,phase_at_error:phase(),request:trace,
        network_failure_at_error:trace.network_failure}
      diagnostics.protocol_errors.push(diagnostic)
      // Exact observed error + same Network request's verified browser cancellation.
      // Never pardon a forbidden request, unknown code, detached session or timeout.
      if (trace.permitted && ['Fetch.continueRequest','Fetch.fulfillRequest'].includes(trace.action)
          && protocol.method===trace.action && protocol.code===-32602 && protocol.category==='invalid-interception-id'
          && await correlateCancellation(entry)) {
        trace.state='cancelled-during-command'
        diagnostics.benign_cancellations.push({ordinal:trace.ordinal,protocol,network_failure:trace.network_failure})
      } else { trace.state='command-error'; fatal('interception-command',entry,protocol) }
    }
  }
  function paused(event) {
    const decision=publicRequestPolicy(event.request,config)
    // Check every event's policy before deduplication; a replay cannot hide a violation.
    if (!decision.allowed) diagnostics.policy_violations.push({category:decision.category,method:safeMethod(event.request.method)})
    const existing=entries.get(event.requestId)
    const signature=JSON.stringify([event.networkId,event.request]) // private in-memory only
    if (existing) {
      if (existing.signature===signature) diagnostics.duplicates++
      else fatal('conflicting-paused-event',existing)
      return
    }
    const trace={ordinal:diagnostics.requests.length+1,category:decision.category,method:safeMethod(event.request.method),
      phase:phase(),permitted:decision.allowed,state:'paused',network_failure:failures.get(event.networkId) || null}
    const entry={trace,decision,networkId:event.networkId,signature}
    entries.set(event.requestId,entry); diagnostics.requests.push(trace)
    const task=handle(entry,event)
    pending.add(task); void task.finally(()=>pending.delete(task))
  }
  async function drain() { while(pending.size) await Promise.all([...pending]) }
  async function start() {
    on('Network.loadingFailed',networkFailed)
    on('Runtime.exceptionThrown',()=>fatal('uncaught-browser-exception'))
    on('Inspector.detached',()=>fatal('unexpected-target-detachment'))
    on('Fetch.requestPaused',paused)
    await browser.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]})
  }
  async function stop() {
    if (stopping) return
    stopping=true
    let navigationTimer
    try {
      // Keep the guard attached until the application is gone and pauses are terminal.
      await browser.send('Page.stopLoading')
      const blankCommitted=new Promise((resolve,reject)=>{
        navigationTimer=setTimeout(()=>reject(new Error('Owned blank navigation deadline')),2000)
        on('Page.frameNavigated',event=>{
          if (!event.frame.parentId && event.frame.url==='about:blank') resolve()
        })
      })
      void blankCommitted.catch(()=>{}) // Await below still reports failure; prevent early rejection races.
      await browser.send('Page.navigate',{url:'about:blank'})
      await blankCommitted
      clearTimeout(navigationTimer)
      await drain()
      await browser.send('Fetch.disable')
      await drain()
    } catch(error) { fatal('interception-cleanup',null,error.cdp || {code:null,category:'non-protocol-error'}) }
    finally {
      clearTimeout(navigationTimer)
      for (const dispose of disposers.splice(0)) dispose()
      diagnostics.owned_handlers=0; diagnostics.closed=true
      entries.clear(); failures.clear()
    }
  }
  const healthy=()=>!diagnostics.policy_violations.length && !diagnostics.fatal_errors.length
  return {start,stop,drain,healthy,diagnostics}
}
