// Real Vue + installed SDK, deterministic intercepted OAuth only. Never forwards
// Auth writes, fake tokens or my_context requests to the retained database.
import {spawnSync} from 'node:child_process'
import {mkdirSync,writeFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {startLocalBrowser} from '../../supabase/tests/headless_local_browser.mjs'
import {validateLocalPublicConfig} from '../../src/lib/supabaseConfig.js'
import {isCancelledInterception} from './browserInterception.mjs'
import {startTestVite} from './startTestVite.mjs'

const run=randomUUID().slice(0,8),checks=[],directory='supabase/tests/results'
const origin='http://127.0.0.1:5173',viteOrigin='http://127.0.0.1:5176',api='http://127.0.0.1:54321'
const delay=ms=>new Promise(r=>setTimeout(r,ms))
class Failure extends Error {}
const check=(value,message)=>{if(!value)throw new Failure(message)}
const report={run,real_google_login:false,auth_writes_forwarded:false,checks,screenshots:[]}
let browser,vite,enabled=false,role='STUDENT',disabled=false,mode='success',tokenCalls=0,authorizeCalls=0,subject=1
const blocked=[],runtime=[],aborted=new Map(),networkFailures=[],publicResponses=[],socketStatuses=[],interceptionDiagnostics=[]
const appResources=[]
const resourceCategory=path=>path.startsWith('/node_modules/.vite/')?'optimized-dependency':path.startsWith('/src/')?'application-module':path==='/'?'document':'development-resource'
const paths=new Set(['/rest/v1/counter_state','/rest/v1/service_state','/rest/v1/rpc/public_queue_context'])
const status=spawnSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','--output','json'],{encoding:'utf8',windowsHide:true})
check(status.status===0,'Local status required; raw diagnostics suppressed')
const settings=JSON.parse(status.stdout),pub=settings.PUBLISHABLE_KEY||settings.ANON_KEY
validateLocalPublicConfig(settings.API_URL,pub)
const id=()=>`00000000-0000-4000-8000-00000000000${subject}`
const user=()=>({id:id(),aud:'authenticated',role:'authenticated',email:'eabeso63122@liceo.edu.ph',
  app_metadata:{provider:'google',providers:['google']},user_metadata:{role:'ADMIN',email_verified:true},created_at:new Date().toISOString()})
const token=()=>`${Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:id(),role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.TEST_SIGNATURE`
async function waitFor(fn,message){const end=Date.now()+25000;while(Date.now()<end){if(await fn())return;await delay(60)}throw new Failure(message)}
async function test(name,fn){try{await fn();checks.push({name,result:'PASS'});console.log(`PASS: ${name}`)}catch(error){checks.push({name,result:'FAIL',reason:error instanceof Failure?error.message:'Harness exception; details suppressed'});throw error}}
const exists=selector=>browser.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)
const click=selector=>browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
async function reset(){await browser.evaluate('localStorage.clear(); sessionStorage.clear()');await browser.send('Page.navigate',{url:origin});await waitFor(()=>exists('[data-testid="google-login"]'),'Google login not ready')}
async function fulfill(event,body,status=200,headers=[]){await browser.send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:status,
  responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:origin},
    {name:'Access-Control-Allow-Headers',value:'authorization,apikey,x-client-info,content-type,content-profile,accept-profile,x-supabase-api-version'},
    {name:'Access-Control-Allow-Methods',value:'GET,POST,OPTIONS'},...headers],body:Buffer.from(body==null?'':JSON.stringify(body)).toString('base64')})}
try{
  mkdirSync(directory,{recursive:true})
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^(VITE_|SUPABASE_|PG|QUEUE_)/i.test(key)))
  Object.assign(env,{VITE_SUPABASE_URL:api,VITE_SUPABASE_PUBLISHABLE_KEY:pub})
  vite=startTestVite(5176,`google-${run}`,env)
  report.isolated_vite_cache=true
  await waitFor(async()=>{check(vite.exitCode===null&&vite.signalCode===null,'Owned Vite process exited');try{return(await fetch(viteOrigin)).ok}catch{return false}},'Test Vite unavailable')
  browser=await startLocalBrowser(`google-frontend-${run}`);check(browser,'Installed Chrome unavailable')
  // CDP-fulfilled app documents have no real transport IP classification. Grant
  // loopback access only to this approved origin in this disposable incognito
  // browser, as a user would grant local-device permission; no global flag/profile.
  await browser.send('Browser.grantPermissions',{origin,permissions:['loopbackNetwork']})
  report.isolated_browser_loopback_permission=true
  await browser.send('Page.enable');await browser.send('Runtime.enable');await browser.send('Network.enable')
  browser.on('Runtime.exceptionThrown',()=>runtime.push('Browser runtime exception'))
  browser.on('Network.loadingFailed',event=>{
    if(event.canceled===true && event.errorText==='net::ERR_ABORTED') aborted.set(event.requestId,{canceled:true,category:'net::ERR_ABORTED'})
  })
  browser.on('Network.loadingFailed',event=>{if(!event.canceled)networkFailures.push({type:event.type,error:event.errorText,cors:event.corsErrorStatus?.corsError})})
  browser.on('Network.responseReceived',event=>{const url=new URL(event.response.url);if(paths.has(url.pathname))publicResponses.push({path:url.pathname,status:event.response.status})})
  browser.on('Network.webSocketHandshakeResponseReceived',event=>socketStatuses.push(event.response.status))
  browser.on('Network.webSocketCreated',event=>{
    if(!['ws://127.0.0.1:5173','ws://127.0.0.1:5176','ws://127.0.0.1:54321'].includes(new URL(event.url).origin))blocked.push({reason:'Unexpected socket origin'})
  })
  await browser.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]})
  browser.on('Fetch.requestPaused',event=>{void(async()=>{
    const url=new URL(event.request.url),path=url.pathname
    // Proxy only app resources from an owned Vite process. Chrome still sees the
    // approved 5173 origin; no request reaches an existing server on that port.
    if(url.origin===origin){
      const response=await fetch(`${viteOrigin}${path}${url.search}`,{redirect:'error'})
      appResources.push({category:resourceCategory(path),status:response.status})
      const content=await response.arrayBuffer()
      await browser.send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:response.status,responseHeaders:[{name:'Content-Type',value:response.headers.get('content-type')||'text/plain'}],body:Buffer.from(content).toString('base64')});return
    }
    if(url.origin===api){
      if(event.request.method==='OPTIONS'){
        if(paths.has(path)){await browser.send('Fetch.continueRequest',{requestId:event.requestId});return}
        await fulfill(event,null,204);return
      }
      if(path==='/auth/v1/settings'){await fulfill(event,{external:{google:enabled}});return}
      if(path==='/auth/v1/authorize'){
        authorizeCalls++
        check(url.searchParams.get('provider')==='google'&&url.searchParams.get('redirect_to')===`${origin}/auth/callback`,'Wrong OAuth destination')
        check(url.searchParams.get('code_challenge_method')==='s256','SDK did not use S256')
        const destination=mode==='cancel'?`${origin}/auth/callback?error=access_denied&error_description=TEST_PROVIDER_PRIVATE_TEXT`:`${origin}/auth/callback?code=TEST_SINGLE_USE_CODE`
        await fulfill(event,null,302,[{name:'Location',value:destination}]);return
      }
      if(path==='/auth/v1/token'){
        tokenCalls++
        check(url.searchParams.get('grant_type')==='pkce','Unexpected token flow')
        if(mode==='expired'){await fulfill(event,{error_code:'flow_state_expired',msg:'TEST_PROVIDER_PRIVATE_TEXT'},400);return}
        await fulfill(event,{access_token:token(),refresh_token:'TEST_PRIVATE_REFRESH',token_type:'bearer',expires_in:3600,user:user()});return
      }
      if(path==='/auth/v1/user'){await fulfill(event,user());return}
      if(path==='/auth/v1/logout'){await fulfill(event,null,204);return}
      if(path==='/rest/v1/rpc/my_context'){
        await fulfill(event,{role:disabled?null:role,enabled:!disabled,cashier_counters:!disabled&&role==='CASHIER'?[{
          counter_id:'11111111-1111-4111-8111-111111111111',counter_number:1,counter_label:'Counter 1',is_open:true,service_codes:['TP']}]:[]});return
      }
      if(paths.has(path)){
        const h=Object.fromEntries(Object.entries(event.request.headers).map(([k,v])=>[k.toLowerCase(),v]))
        check(h.apikey===pub&&h.authorization===`Bearer ${pub}`,'Public view inherited fake session')
        await browser.send('Fetch.continueRequest',{requestId:event.requestId});return
      }
    }
    blocked.push({path,origin:url.origin});await browser.send('Fetch.failRequest',{requestId:event.requestId,errorReason:'BlockedByClient'})
  })().catch(async error=>{
    await delay(30)
    const protocol=error.cdp || {code:null,category:'non-protocol-error'}
    const benign=isCancelledInterception(protocol,aborted.get(event.networkId))
    interceptionDiagnostics.push({protocol,correlated_cancellation:benign})
    if(!benign)runtime.push('Interception failure')
  })})
  await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
  await browser.send('Page.navigate',{url:origin})
  await waitFor(()=>exists('[data-testid="google-login"]'),'Product login unavailable')
  await test('Real Vue product exposes one Google button and no password/role selection',async()=>{
    check(await browser.evaluate(`document.querySelectorAll('[data-testid="google-login"]').length===1&&!document.querySelector('#login-email')&&!document.querySelector('select')`),'Product login incorrect')
  })
  await test('Unconfigured provider shows a safe error without OAuth navigation',async()=>{
    await click('[data-testid="google-login"]');await waitFor(()=>browser.evaluate(`document.body.innerText.includes('Google Sign-In is not available yet')`),'Setup error missing')
    check(authorizeCalls===0&&tokenCalls===0,'Disabled provider attempted OAuth')
  })
  await test('Mocked full PKCE callback verifies ordinary shared dashboard despite ADMIN metadata/email',async()=>{
    enabled=true;await click('[data-testid="google-login"]')
    report.mock_callback_observations=[]
    await waitFor(async()=>{
      const observed=await browser.evaluate(`({root:location.pathname==='/',query_empty:!location.search,fragment_empty:!location.hash,
        student:!!document.querySelector('[data-testid="student-workspace"]'),dashboard:document.body.innerText.includes('Queue Dashboard'),
        admin_absent:!document.querySelector('[data-testid="admin-workspace"]')})`)
      if(JSON.stringify(observed)!==JSON.stringify(report.mock_callback_observations.at(-1)))report.mock_callback_observations.push(observed)
      return Object.values(observed).every(value=>value===true)
    },'Callback not scrubbed or dashboard missing')
    check(tokenCalls===1,'Expected one token exchange')
  })
  await test('Reload restores the session only through mocked getUser/current-context checks',async()=>{
    await browser.send('Page.reload');await waitFor(()=>exists('[data-testid="student-workspace"]'),'Stored mock session failed')
    check(tokenCalls===1,'Reload exchanged the code again')
  })
  await test('Authoritative cashier/admin context overrides metadata with existing session',async()=>{
    for(const next of ['CASHIER','ADMIN']){role=next;await browser.evaluate(`document.dispatchEvent(new Event('visibilitychange'))`);await waitFor(()=>exists(`[data-testid="${next.toLowerCase()}-workspace"]`),'Mock role context failed')}
  })
  await test('Revoked role and disabled account immediately clear prior workspace on revalidation',async()=>{
    role='STUDENT';await browser.evaluate(`document.dispatchEvent(new Event('visibilitychange'))`);await waitFor(()=>exists('[data-testid="student-workspace"]'),'Revoked role not reflected')
    disabled=true;await browser.evaluate(`document.dispatchEvent(new Event('visibilitychange'))`);await waitFor(()=>exists('[data-testid="access-disabled"]'),'Disabled view missing')
    check(await browser.evaluate(`!document.querySelector('[data-testid="admin-workspace"]')&&!document.querySelector('[data-testid="cashier-workspace"]')`),'Old staff workspace remained')
  })
  await test('Mock logout and Google account switching cannot retain previous context',async()=>{
    await click('#account-workspace > div button');await waitFor(()=>exists('[data-testid="google-login"]'),'Logout did not clear access')
    disabled=false;subject=2;await click('[data-testid="google-login"]');await waitFor(()=>exists('[data-testid="student-workspace"]'),'Second mock account failed')
    check(tokenCalls===2,'Account switch did not make a fresh exchange')
  })
  await test('Repeated callback reconciles without a second exchange',async()=>{
    const previous=tokenCalls;await browser.send('Page.navigate',{url:`${origin}/auth/callback?code=TEST_SINGLE_USE_CODE`})
    await waitFor(()=>browser.evaluate(`document.body.innerText.includes('already handled or interrupted')`),'Duplicate callback not detected')
    check(tokenCalls===previous,'Duplicate callback exchanged code')
    await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Check sign-in outcome').click()`)
    await waitFor(()=>exists('[data-testid="student-workspace"]'),'Reconciliation failed')
  })
  await test('Mock Google cancellation is scrubbed and grants no workspace',async()=>{
    await reset();mode='cancel';await click('[data-testid="google-login"]')
    await waitFor(()=>browser.evaluate(`document.body.innerText.includes('Google sign-in was cancelled')`),'Cancellation state missing')
    check(await browser.evaluate(`!location.search&&!location.hash&&!document.body.innerText.includes('TEST_PROVIDER_PRIVATE_TEXT')`),'Callback error leaked')
  })
  await test('Mock expired code gives generic reconciliation without automatic re-exchange',async()=>{
    await reset();mode='expired';const previous=tokenCalls;await click('[data-testid="google-login"]')
    await waitFor(()=>browser.evaluate(`document.body.innerText.includes('Sign-in could not be confirmed')`),'Expired callback state missing')
    check(tokenCalls===previous+1,'Unexpected repeated exchange')
  })
  await test('SDK missing verifier fails locally before any token HTTP request',async()=>{
    await reset();mode='missing';const previous=tokenCalls
    const script=await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.pathname==='/auth/callback')localStorage.removeItem('sb-127-auth-token-code-verifier')`})
    await click('[data-testid="google-login"]')
    await waitFor(()=>browser.evaluate(`document.body.innerText.includes('Sign-in could not be confirmed')`),'Missing verifier state missing')
    check(tokenCalls===previous,'Missing verifier reached token endpoint')
    await browser.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:script.identifier})
  })
  await test('Callback/login desktop and mobile render without overflow or private canaries',async()=>{
    for(const [width,height,mobile]of[[1440,1000,false],[390,844,true]]){
      await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});await delay(100)
      check(await browser.evaluate(`document.documentElement.scrollWidth<=innerWidth&&!document.body.innerText.includes('TEST_PRIVATE_REFRESH')&&!document.body.innerText.includes('TEST_PROVIDER_PRIVATE_TEXT')&&!document.body.innerText.includes('eabeso63122@liceo.edu.ph')`),'Overflow or sensitive view data')
      await browser.evaluate(`document.querySelector('#account-workspace').scrollIntoView()`)
      const file=`google_oauth_frontend_${run}_${width}.png`;await browser.screenshot(`${directory}/${file}`);report.screenshots.push(file)
    }
  })
  await test('Development password form is isolated at /dev/login',async()=>{
    await reset();await browser.send('Page.navigate',{url:origin+'/dev/login'})
    await waitFor(()=>exists('#login-email'),'Separated development login missing')
    check(await browser.evaluate(`!document.querySelector('[data-testid="google-login"]')&&document.body.innerText.includes('Development test sign-in')`),'Development form mixed with product login')
  })
  await test('Anonymous /display remains available without Auth controls after callback errors',async()=>{
    await browser.send('Page.navigate',{url:origin+'/display'})
    await waitFor(()=>browser.evaluate(`document.querySelector('.board-connection')?.textContent==='Live public display'`),'Public board did not synchronize')
    check(await browser.evaluate(`!document.querySelector('#account-workspace')&&document.querySelectorAll('[data-counter]').length===5&&!location.search`),'Monitor affected by Auth state')
  })
  await test('No unexpected network path, real Auth write, runtime error or Google/hosted contact',async()=>{check(!blocked.length&&!runtime.length,'Unexpected network/runtime behavior')})
  report.result='PASS'
}catch(error){report.result='FAIL';report.failure=error instanceof Failure?error.message:'Harness error; details suppressed';report.blocked=blocked;report.runtime_errors=runtime;
  report.network_failures=networkFailures;report.public_response_statuses=publicResponses;report.socket_statuses=socketStatuses
  try{report.browser_state=await browser?.evaluate(`({path:location.pathname,connection:document.querySelector('.board-connection')?.textContent,google:!!document.querySelector('[data-testid="google-login"]')})`)}catch{}
  try{if(browser)await browser.screenshot(`${directory}/google_oauth_frontend_${run}_failure.png`)}catch{}
  console.error(report.failure);process.exitCode=1
}finally{
  try{await browser?.close()}catch{}vite?.kill()
  report.passed=checks.filter(c=>c.result==='PASS').length;report.failed=checks.filter(c=>c.result==='FAIL').length
  report.interception_diagnostics=interceptionDiagnostics
  report.app_resource_statuses=appResources
  writeFileSync(`${directory}/google_oauth_frontend_${run}.json`,JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({result:report.result,passed:report.passed,failed:report.failed,evidence:`google_oauth_frontend_${run}.json`}))
}
