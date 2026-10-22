// Real Vue + installed SDK, deterministic intercepted OAuth only. Never forwards
// Auth writes, fake tokens or my_context requests to the retained database.
import {spawnSync} from 'node:child_process'
import {mkdirSync,writeFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {startLocalBrowser} from '../../supabase/tests/headless_local_browser.mjs'
import {validateLocalPublicConfig} from '../../src/lib/supabaseConfig.js'
import {isCancelledInterception} from './browserInterception.mjs'
import {startTestVite} from './startTestVite.mjs'
import {staffFixture} from './staffFixtures.mjs'
import {OAUTH_MARKER} from '../../src/lib/oauthConfig.js'
import {STAFF_MANAGEMENT_OWNER_ID} from '../../src/lib/adminActivation.js'

const run=randomUUID().slice(0,8),checks=[],directory='supabase/tests/results'
const origin='http://127.0.0.1:5173',viteOrigin='http://127.0.0.1:5176',api='http://127.0.0.1:54321'
const delay=ms=>new Promise(r=>setTimeout(r,ms))
class Failure extends Error {}
const check=(value,message)=>{if(!value)throw new Failure(message)}
const report={run,real_google_login:false,auth_writes_forwarded:false,checks,screenshots:[]}
const mfaMode=process.argv.includes('--mfa')
const navigationBefore=process.argv.includes('--navigation-before')
const devtoolsMode=process.argv.includes('--devtools')
const adminLayoutMode=process.argv.includes('--admin-layout')
let publicUpdate=0,directoryReads=0,configurationReads=0,liveTicketPhase=null
async function adminResponsive(phase) {
  report.admin_responsive=[]
  for(const width of [1440,1280,1024,980,768,640,390,320]){
    await browser.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});await delay(100)
    const layout=await browser.evaluate(`(()=>{const link=document.querySelector('[data-testid="public-display-link"]')||document.querySelector('.cqs-header-actions>a'),out=[...document.querySelectorAll('.cqs-header button')].find(x=>x.textContent==='Sign out');const visible=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0'&&r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth};return{width:innerWidth,publicDisplay:visible(link),signOut:visible(out),noOverflow:document.documentElement.scrollWidth<=innerWidth,staff:!!document.querySelector('[data-testid="staff-management"]')}})()`)
    if(!navigationBefore)check(!layout.publicDisplay&&layout.signOut&&layout.noOverflow,'Administrator header action hidden or overflowing')
    if(!navigationBefore)check(await browser.evaluate(`(()=>{const out=document.querySelector('[data-testid="sign-out"]');out.focus();return document.activeElement===out&&!document.querySelector('[data-testid="public-display-link"]')&&document.querySelectorAll('[data-testid="admin-live-monitor"] .cqs-counter-row').length===5})()`),'Admin navigation or persistent monitor failed')

    report.admin_responsive.push(layout)
    if(!navigationBefore)check(await browser.evaluate(`(()=>{const panel=document.querySelector('[data-testid="admin-live-monitor"]'),main=document.querySelector('.cqs-admin-content'),a=panel.getBoundingClientRect(),b=main.getBoundingClientRect();return innerWidth>1000?getComputedStyle(panel).position==='sticky'&&a.left>=b.right:getComputedStyle(panel).position==='static'&&a.top>=b.bottom-1})()`),'Live monitor does not use the required desktop/sidebar or mobile flow')
    const file=`admin_navigation_${run}_${phase}_${width}.png`;await browser.screenshot(`${directory}/${file}`);report.screenshots.push(file)
    if(!navigationBefore){
      await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Overview & analytics').click()`)
      check(await browser.evaluate(`document.querySelectorAll('.cqs-stat-grid .cqs-stat').length===4&&document.querySelectorAll('.cqs-overview .cqs-counter-row').length===5&&document.documentElement.scrollWidth<=innerWidth`),'Administrator overview/monitor layout failed')
      const overview=`admin_overview_${run}_AFTER_${width}.png`;await browser.screenshot(`${directory}/${overview}`);report.screenshots.push(overview)
      await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Staff management').click()`)
    }
  }
  await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
  if(!navigationBefore){
    await browser.evaluate(`window.scrollTo(0,600)`);await delay(100)
    check(await browser.evaluate(`Math.abs(document.querySelector('[data-testid="admin-live-monitor"]').getBoundingClientRect().top-24)<2`),'Desktop live tickets did not stick at 24px')
    await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:640,deviceScaleFactor:1,mobile:false})
    await waitFor(()=>browser.evaluate(`getComputedStyle(document.querySelector('[data-testid="admin-live-monitor"]')).position==='static'`),'Short viewport trapped the live ticket panel')
    await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await browser.evaluate(`window.scrollTo(0,0)`)
  }
  if(devtoolsMode){
    await browser.evaluate(`window.__dockedAdmin=document.querySelector('[data-testid="admin-workspace"]')`)
    await browser.send('Emulation.clearDeviceMetricsOverride')
    const window=await browser.send('Browser.getWindowForTarget')
    await browser.send('Browser.setWindowBounds',{windowId:window.windowId,bounds:{width:1600,height:1100,windowState:'normal'}})
    const placement=await browser.verifyDevtoolsRight();check(placement.present&&placement.dockedRight,'Actual DevTools right docking was not verified')
    await waitFor(()=>browser.evaluate(`outerWidth-innerWidth>200&&outerHeight-innerHeight<250&&!document.querySelector('[data-testid="public-display-link"]')`),'Docked viewport/header not available')
    const state=await browser.evaluate(`({outerWidth,innerWidth,outerHeight,innerHeight,noOverflow:document.documentElement.scrollWidth<=innerWidth,sameDashboard:window.__dockedAdmin===document.querySelector('[data-testid="admin-workspace"]')})`)
    check(state.noOverflow&&state.sameDashboard,'DevTools docking caused overflow or dashboard remount');report.devtools={...placement,...state}
    const file=`admin_navigation_${run}_ACTUAL_DEVTOOLS_RIGHT.png`;await delay(500);const screenshot=await browser.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(`${directory}/${file}`,Buffer.from(screenshot.data,'base64'));report.screenshots.push(file)
    await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
  }
}
let mfaFactors=[],mfaLevel='aal1',mfaFailure=null,mfaCalls=0
const mfaFactor='70000000-0000-4000-8000-000000000007',mfaChallenge='80000000-0000-4000-8000-000000000008'
const mfaSecret='JBSWY3DPEHPK3PXP'
let browser,vite,enabled=false,role='STUDENT',disabled=false,mode='success',tokenCalls=0,authorizeCalls=0,subject=1
let workspaceMode='populated'
let publicCatalogMode='live'
let staffMode='success',staffRequests=0,staffGate=null
const staffMutations=[]
let userGate, contextGate, userChecks=0, contextChecks=0
const gate=()=>{let release;const pending=new Promise(resolve=>{release=resolve});return{pending,release}}
const workspaceCalls=[]
const ticketFixture={id:'fixture-owner-ticket',service:'TP',number:217,business_date:'2026-10-18',status:'WAITING',counter:null,issued_at:'2026-10-18T01:00:00Z'}
async function captureLayout(name) {
  for(const [width,height] of [[1440,1000],[768,1024],[390,844]]) {
    await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});await delay(120)
    check(await browser.evaluate(`document.documentElement.scrollWidth<=innerWidth`),'Dashboard horizontal overflow')
    if(name==='student'){
      check(await browser.evaluate(`!['My workspace','Public queue','Refresh access','Public display','Open lobby display'].some(label=>[...document.querySelectorAll('a,button')].some(e=>e.textContent.includes(label))) && !!document.querySelector('[data-testid="account-security"]')===/^\\/account\\/security\\/?$/.test(location.pathname)`),'Student navigation differs from its dashboard/security route')
      const layout=await browser.evaluate(`(()=>{const section=document.querySelector('.cqs-service-selection'),grid=section.querySelector('.cqs-service-grid');return{columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,cards:grid.children.length,monitorBelow:section.getBoundingClientRect().bottom<=document.querySelector('[data-testid="student-live-monitor"]').getBoundingClientRect().top,bannerAbsent:!document.querySelector('[data-testid="student-workspace"] .cqs-banner')}})()`)
      check(layout.columns===(width===1440?5:width===768?2:1)&&layout.cards===5&&layout.monitorBelow&&layout.bannerAbsent,'Service layout/order differs from requested responsive grid')
      ;(report.student_layouts??=[]).push({width,...layout})
    }
    await browser.evaluate(`if(!document.querySelector('#fixture-notice')){const note=document.createElement('div');note.id='fixture-notice';note.textContent='BROWSER FIXTURE â€” no real sign-in or queue writes';note.style.cssText='position:fixed;bottom:0;left:0;z-index:9999;padding:4px 10px;background:#fff9ed;color:#65263d;font:10px Arial;pointer-events:none';document.body.append(note)};window.scrollTo(0,0)`)
    const file=`video_ui_${run}_SIMULATED_${name}_${width}.png`;await browser.screenshot(`${directory}/${file}`);report.screenshots.push(file)
  }
  await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
}
const blocked=[],runtime=[],aborted=new Map(),networkFailures=[],publicResponses=[],socketStatuses=[],interceptionDiagnostics=[]
const appResources=[]
const resourceCategory=path=>path.startsWith('/node_modules/.vite/')?'optimized-dependency':path.startsWith('/src/')?'application-module':path==='/'?'document':'development-resource'
const paths=new Set(['/rest/v1/counter_state','/rest/v1/service_state','/rest/v1/rpc/public_queue_context'])
const status=spawnSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','--output','json'],{encoding:'utf8',windowsHide:true})
check(status.status===0,'Local status required; raw diagnostics suppressed')
const settings=JSON.parse(status.stdout),pub=settings.PUBLISHABLE_KEY||settings.ANON_KEY
validateLocalPublicConfig(settings.API_URL,pub)
const id=()=>subject===1?STAFF_MANAGEMENT_OWNER_ID:`00000000-0000-4000-8000-00000000000${subject}`
const staffData=staffFixture(id())
const pendingStaff=[]
const user=()=>({id:id(),aud:'authenticated',role:'authenticated',email:'eabeso63122@liceo.edu.ph',
  app_metadata:{provider:'google',providers:['google']},user_metadata:{role:'ADMIN',email_verified:true},created_at:new Date().toISOString(),factors:mfaMode?mfaFactors:[]})
const token=()=>`${Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:id(),role:'authenticated',aud:'authenticated',aal:mfaLevel,session_id:`90000000-0000-4000-8000-00000000000${subject}`,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.TEST_SIGNATURE`
async function waitFor(fn,message){const end=Date.now()+25000;while(Date.now()<end){if(await fn())return;await delay(60)}throw new Failure(message)}
async function test(name,fn){try{await fn();checks.push({name,result:'PASS'});console.log(`PASS: ${name}`)}catch(error){checks.push({name,result:'FAIL',reason:error instanceof Failure?error.message:'Harness exception; details suppressed'});throw error}}
const exists=selector=>browser.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)
async function reloadPage(){
  let dispose,timer
  const loaded=new Promise((resolve,reject)=>{dispose=browser.on('Page.loadEventFired',resolve);timer=setTimeout(()=>reject(new Failure('Reload document did not finish loading')),25000)})
  try{await Promise.all([browser.send('Page.reload'),loaded])}finally{clearTimeout(timer);dispose()}
}
const click=selector=>waitFor(()=>browser.evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)return false;element.focus();element.click();return true})()`),'Requested control is not available')
const staffClick=selector=>waitFor(()=>browser.evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element||element.disabled)return false;element.focus();element.click();return true})()`),`Staff control is not ready: ${selector}`)
const field=async(selector,value)=>browser.evaluate(`{const input=document.querySelector(${JSON.stringify(selector)});input.value=${JSON.stringify(value)};input.dispatchEvent(new Event(input.tagName==='SELECT'?'change':'input',{bubbles:true}))}`)
async function verifyEmailAssignmentFlow(){
  await waitFor(()=>browser.evaluate(`document.querySelector('[data-testid="add-staff"]')?.disabled===false`),'Owner email assignment unavailable')
  const attempts=staffRequests
  await staffClick('[data-testid="add-staff"]')
  check(await browser.evaluate(`!!document.querySelector('[data-testid="staff-request-email"]')&&!document.querySelector('[data-testid="staff-resolve"]')&&!document.body.innerText.includes('Find Google account')`),'Email form requires Google lookup')
  await field('[data-testid="staff-request-email"]','Future.Staff@example.invalid')
  await field('[data-testid="staff-request-counter"]',staffData.configuration.counters[0].id)
  await staffClick('[data-testid="staff-confirm"]')
  await waitFor(()=>browser.evaluate(`document.body.innerText.includes('Pending staff assignment saved')`),'Pending assignment receipt not shown')
  await waitFor(()=>browser.evaluate(`document.querySelector('[data-testid="pending-staff-list"]').innerText.includes('future.staff@example.invalid')`),'Pending assignment list did not refresh')
  check(staffRequests===attempts+1,'Email assignment did not make exactly one request')
  check(await browser.evaluate(`!document.body.innerText.includes('Find Google account')`),'Legacy lookup step is visible')

  staffMode='duplicate';await staffClick('[data-testid="add-staff"]')
  await field('[data-testid="staff-request-email"]','future.staff@example.invalid')
  await field('[data-testid="staff-request-counter"]',staffData.configuration.counters[0].id)
  await staffClick('[data-testid="staff-confirm"]')
  await waitFor(()=>browser.evaluate(`document.body.innerText.includes('A pending assignment already exists for this email')`),'Duplicate pending email was not disclosed')
  check(staffRequests===attempts+2,'Duplicate attempt was not sent once')
  staffMode='success'
}
async function reset(){await browser.evaluate('localStorage.clear(); sessionStorage.clear()');await browser.send('Page.navigate',{url:origin});await waitFor(()=>exists('[data-testid="google-login"]'),'Google login not ready')}
async function fulfill(event,body,status=200,headers=[]){await browser.send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:status,
  responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:origin},
    {name:'Access-Control-Allow-Headers',value:'authorization,apikey,x-client-info,content-type,content-profile,accept-profile,x-supabase-api-version'},
    {name:'Access-Control-Allow-Methods',value:'GET,POST,OPTIONS'},...headers],body:Buffer.from(body==null?'':JSON.stringify(body)).toString('base64')})}
try{
  mkdirSync(directory,{recursive:true})
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^(VITE_|SUPABASE_|PG|QUEUE_)/i.test(key)))
  Object.assign(env,{VITE_SUPABASE_URL:api,VITE_SUPABASE_PUBLISHABLE_KEY:pub})
  env.VITE_AUTH_MFA_TOTP_ENABLED=mfaMode?'true':'false'
  vite=startTestVite(5176,`google-${run}`,env)
  report.isolated_vite_cache=true
  await waitFor(async()=>{check(vite.exitCode===null&&vite.signalCode===null,'Owned Vite process exited');try{return(await fetch(viteOrigin)).ok}catch{return false}},'Test Vite unavailable')
  // Compile the owned cold-cache entry graph before starting the browser deadline.
  for(const path of ['/src/main.js','/src/components/QueueApplication.vue']) check((await fetch(viteOrigin+path)).ok,'Test application compile failed')
  browser=await startLocalBrowser(`google-frontend-${run}`,{devtools:devtoolsMode});check(browser,'Installed Chrome unavailable')
  // CDP-fulfilled app documents have no real transport IP classification. Grant
  // loopback access only to this approved origin in this disposable incognito
  // browser, as a user would grant local-device permission; no global flag/profile.
  await browser.send('Browser.grantPermissions',{origin,permissions:['loopbackNetwork']})
  report.isolated_browser_loopback_permission=true
  await browser.send('Page.enable');await browser.send('Runtime.enable');await browser.send('Network.enable')
  browser.on('Runtime.exceptionThrown',event=>runtime.push({category:event.exceptionDetails.exception?.className||'Browser runtime exception',line:event.exceptionDetails.lineNumber,frames:event.exceptionDetails.stackTrace?.callFrames.map(x=>({function:x.functionName,path:new URL(x.url||origin,origin).pathname,line:x.lineNumber})).slice(0,4)}))
  browser.on('Network.loadingFailed',event=>{
    if(event.canceled===true && event.errorText==='net::ERR_ABORTED') aborted.set(event.requestId,{canceled:true,category:'net::ERR_ABORTED'})
  })
  browser.on('Network.loadingFailed',event=>{if(!event.canceled)networkFailures.push({type:event.type,error:event.errorText,cors:event.corsErrorStatus?.corsError})})
  browser.on('Network.responseReceived',event=>{const url=new URL(event.response.url);if(paths.has(url.pathname))publicResponses.push({path:url.pathname,status:event.response.status})})
  browser.on('Network.webSocketHandshakeResponseReceived',event=>socketStatuses.push(event.response.status))
  browser.on('Network.webSocketCreated',event=>{
    if(!['ws://127.0.0.1:5173','ws://127.0.0.1:5176','ws://127.0.0.1:54321'].includes(new URL(event.url).origin))blocked.push({reason:'Unexpected socket origin'})
  })
  await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`{
    const sockets=[],NativeSocket=window.WebSocket;
    window.WebSocket=class extends NativeSocket{constructor(...args){super(...args);if(new URL(args[0]).origin==='ws://127.0.0.1:54321')sockets.push(this)}};
    window.__publicQueueSocketCount=()=>sockets.filter(socket=>socket.readyState===0||socket.readyState===1).length;
    window.__closePublicQueueSocket=()=>sockets.filter(socket=>socket.readyState===1).forEach(socket=>socket.close(4000,'Owned public reconnect check'));
  }`})
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
      if(path==='/auth/v1/user'){userChecks++;if(userGate)await userGate.pending;await fulfill(event,user());return}
      if(path==='/auth/v1/logout'){await fulfill(event,null,204);return}
      if(mfaMode&&path.startsWith('/auth/v1/factors')){
        mfaCalls++;const body=event.request.postData?JSON.parse(event.request.postData):{}
        if(path==='/auth/v1/factors'&&event.request.method==='POST'){
          check(body.factor_type==='totp','Unexpected MFA enrollment type')
          mfaFactors=[{id:mfaFactor,factor_type:'totp',status:'unverified',friendly_name:'Fixture authenticator'}]
          await fulfill(event,{id:mfaFactor,type:'totp',totp:{secret:mfaSecret,qr_code:'<?xml version="1.0"?>\n<!-- Generated by SVGo -->\n<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path d="M0 0h16v16H0z"/></svg>'}});return
        }
        if(path===`/auth/v1/factors/${mfaFactor}/challenge`){await fulfill(event,{id:mfaChallenge,type:'totp',expires_at:mfaFailure==='expired'?1:Math.floor(Date.now()/1000)+120});return}
        if(path===`/auth/v1/factors/${mfaFactor}/verify`){
          if(mfaFailure==='wrong'){await fulfill(event,{error_code:'mfa_verification_failed',msg:'TEST_PROVIDER_PRIVATE_TEXT'},422);return}
          check(body.code==='123456'&&body.challenge_id===mfaChallenge,'Unexpected synthetic MFA verification')
          mfaFactors[0].status='verified';mfaLevel='aal2'
          await fulfill(event,{access_token:token(),refresh_token:'TEST_PRIVATE_REFRESH',token_type:'bearer',expires_in:3600,user:user()});return
        }
        throw new Failure('Unapproved MFA fixture endpoint')
      }
      if(path==='/rest/v1/rpc/my_context'){
        contextChecks++;if(contextGate)await contextGate.pending
        await fulfill(event,{role:disabled?null:role,enabled:!disabled,cashier_counters:!disabled&&role==='CASHIER'?[{
          counter_id:'11111111-1111-4111-8111-111111111111',counter_number:1,counter_label:'Counter 1',is_open:true,service_codes:['TP']}]:[]});return
      }
      if(['/rest/v1/rpc/admin_configuration','/rest/v1/rpc/admin_staff_directory'].includes(path)){
        if(path.endsWith('admin_staff_directory'))directoryReads++;else configurationReads++
        if(role!=='ADMIN'||disabled){await fulfill(event,{code:'42501',message:'Administrator required'},403);return}
        await fulfill(event,path.endsWith('admin_staff_directory')?staffData.directory:staffData.configuration);return
      }
      if(path==='/rest/v1/rpc/admin_staff_accounts'){
        if(staffMode==='missing'){await fulfill(event,{code:'PGRST202',message:'Missing proposed endpoint'},404);return}
        if(role!=='ADMIN'||disabled||staffMode==='denied-directory'){await fulfill(event,{code:'42501',message:'Administrator required'},403);return}
        await fulfill(event,staffData.directory.filter(x=>['ADMIN','CASHIER'].includes(x.role)).map(({id,email,role,enabled})=>({id,email,role,enabled,google_verified:true})));return
      }
      if(path==='/rest/v1/rpc/admin_pending_staff'){
        if(staffMode==='missing'){await fulfill(event,{code:'PGRST202',message:'Missing proposed endpoint'},404);return}
        if(role!=='ADMIN'||disabled||staffMode==='denied-directory'){await fulfill(event,{code:'42501',message:'Administrator required'},403);return}
        await fulfill(event,pendingStaff);return
      }
      if(path==='/rest/v1/rpc/resolve_staff_google'){
        const body=JSON.parse(event.request.postData||'{}');check(Object.keys(body).join(',')==='p_email','Lookup parameters');
        const row=staffData.directory.find(x=>x.email===body.p_email);
        await fulfill(event,row?{id:row.id,email:row.email,role:row.role,enabled:row.enabled,identity_sha256:'a'.repeat(64),counter_ids:staffData.configuration.staff_assignments.filter(x=>x.account_id===row.id).map(x=>x.counter_id)}:null);return
      }
      if(path==='/rest/v1/rpc/add_verified_staff'){
        const body=JSON.parse(event.request.postData||'{}');staffRequests++;
        check(role==='ADMIN'&&!disabled&&body.p_identity_sha256==='a'.repeat(64)&&body.p_user!==id()&&Object.keys(body).sort().join(',')==='p_counter,p_email,p_identity_sha256,p_request_key,p_role,p_user','Unbound staff activation');
        if(staffGate)await staffGate.pending;
        if(staffMode==='server-error'){await fulfill(event,{code:'XX000',message:'TEST_STAFF_PRIVATE_DIAGNOSTIC'},503);return}
        if(staffMode==='rejected'){await fulfill(event,{code:'P0001',message:'Resolve called ticket before reconfiguration'},400);return}
        const row=staffData.directory.find(x=>x.id===body.p_user),account=staffData.configuration.accounts.find(x=>x.id===body.p_user);check(row?.email===body.p_email&&row.role==='STUDENT','Wrong verified target');
        row.role=account.role=body.p_role;
        if(body.p_role==='CASHIER')staffData.configuration.staff_assignments.push({account_id:row.id,counter_id:body.p_counter});
        await fulfill(event,{user:row.id,role:row.role,enabled:true,counter:body.p_counter});return
      }
      if(path==='/rest/v1/rpc/assign_staff_by_email'){
        const body=JSON.parse(event.request.postData||'{}');staffRequests++
        check(role==='ADMIN'&&!disabled&&id()===STAFF_MANAGEMENT_OWNER_ID
          &&Object.keys(body).sort().join(',')==='p_counter,p_email,p_request_key,p_role'
          &&body.p_email===body.p_email.trim().toLowerCase()&&['CASHIER','ADMIN'].includes(body.p_role)
          &&(body.p_role==='ADMIN'?body.p_counter===null:staffData.configuration.counters.some(c=>c.id===body.p_counter)),
          'Unbound email staff assignment')
        if(staffGate)await staffGate.pending
        if(staffMode==='duplicate'){await fulfill(event,{code:'23505',message:'Pending staff assignment already exists for this email'},400);return}
        if(staffMode==='server-error'){await fulfill(event,{code:'XX000',message:'TEST_STAFF_PRIVATE_DIAGNOSTIC'},503);return}
        const invitation='50000000-0000-4000-8000-000000000005'
        pendingStaff.push({id:invitation,email:body.p_email,role:body.p_role,counter:body.p_counter,created_at:new Date().toISOString()})
        await fulfill(event,{status:'PENDING_FIRST_LOGIN',invitation,email:body.p_email,role:body.p_role,counter:body.p_counter});return
      }
      if(path==='/rest/v1/rpc/admin_payors'){
        if(staffMode==='missing'){await fulfill(event,{code:'PGRST202',message:'Missing proposed endpoint'},404);return}
        const body=JSON.parse(event.request.postData||'{}');const row={ticket_id:'60000000-0000-4000-8000-000000000006',owner_id:'20000000-0000-4000-8000-000000000003',number:219,service:'TP',status:'WAITING',business_date:'2026-10-20',issued_at:'2026-10-20T01:00:00Z',counter_id:null,student_number:null,display_name:null};
        await fulfill(event,{rows:body.p_search&& !row.owner_id.includes(body.p_search)?[]:[row],more:false,offset:body.p_offset,limit:body.p_limit});return
      }
      if(path==='/rest/v1/rpc/admin_payor_events'){await fulfill(event,[{event:'SKIPPED',at:'2026-10-20T01:01:00Z',status:'WAITING',counter_id:staffData.configuration.counters[0].id}]);return}
      if(path==='/rest/v1/rpc/request_staff_access'){
        const body=JSON.parse(event.request.postData||'{}');staffRequests++
        check(Object.keys(body).sort().join(',')==='p_email,p_role'&&body.p_email===body.p_email.trim().toLowerCase()&&['ADMIN','CASHIER'].includes(body.p_role),'Wrong installed staff-request parameters')
        if(staffGate)await staffGate.pending
        if(staffMode==='duplicate'){await fulfill(event,{code:'22023',message:'Pending review request already exists for this email'},400);return}
        if(staffMode==='server-error'){await fulfill(event,{code:'XX000',message:'TEST_STAFF_PRIVATE_DIAGNOSTIC'},503);return}
        await fulfill(event,{request_id:'50000000-0000-4000-8000-000000000005',status:'PENDING_IDENTITY_REVIEW'});return
      }
      if(['/rest/v1/rpc/set_account','/rest/v1/rpc/configure_counter'].includes(path)){
        check(role==='ADMIN'&&!disabled,'Non-admin management mutation attempted')
        const body=JSON.parse(event.request.postData||'{}');check(/^[0-9a-f-]{36}$/.test(body.p_request_key),'Missing management request key')
        staffMutations.push(path.endsWith('set_account')?'account':'counter')
        if(path.endsWith('set_account')){
          const row=staffData.directory.find(x=>x.id===body.p_user),account=staffData.configuration.accounts.find(x=>x.id===body.p_user)
          check(row&&account&&row.id!==id(),'Wrong account target')
          row.role=account.role=body.p_role;row.enabled=account.enabled=body.p_enabled
          await fulfill(event,{user:body.p_user,role:body.p_role,enabled:body.p_enabled});return
        }
        const counter=staffData.configuration.counters.find(x=>x.id===body.p_counter)
        check(counter&&JSON.stringify(body.p_services)===JSON.stringify([['TP','SOA','PNEP','REF','ADJ'][counter.number-1]]),'Counter route changed')
        counter.is_open=body.p_open
        staffData.configuration.staff_assignments=staffData.configuration.staff_assignments.filter(x=>x.counter_id!==counter.id).concat(body.p_cashiers.map(account_id=>({account_id,counter_id:counter.id})))
        await fulfill(event,{counter:counter.id,open:body.p_open,services:body.p_services,cashiers:body.p_cashiers});return
      }
      if(['/rest/v1/rpc/my_tickets','/rest/v1/rpc/staff_queue'].includes(path)){
        workspaceCalls.push(path)
        if(workspaceMode==='error'){await fulfill(event,{message:'TEST_PROVIDER_PRIVATE_TEXT'},503);return}
        const rows=workspaceMode==='empty'?[]:path.endsWith('my_tickets')?[ticketFixture,{...ticketFixture,id:'fixture-history',number:216,status:'SERVED'}]:[
          {ticket_id:'fixture-called',service:'TP',number:215,business_date:'2026-10-18',status:'CALLED',counter_id:'11111111-1111-4111-8111-111111111111',wait_position:1},
          {ticket_id:'fixture-waiting',service:'TP',number:217+publicUpdate,business_date:'2026-10-18',status:'WAITING',counter_id:null,wait_position:2}]
        await fulfill(event,rows);return
      }
      if(paths.has(path)){
        const h=Object.fromEntries(Object.entries(event.request.headers).map(([k,v])=>[k.toLowerCase(),v]))
        check(h.apikey===pub&&h.authorization===`Bearer ${pub}`,'Public view inherited fake session')
        if(liveTicketPhase&&event.request.method==='GET'&&['/rest/v1/counter_state','/rest/v1/service_state'].includes(path)){
          const response=await fetch(api+path+url.search,{headers:{apikey:pub,Authorization:`Bearer ${pub}`,'Accept-Profile':'queue_display'},redirect:'error'});check(response.ok,'Public fixture source failed')
          let rows=await response.json()
          if(path.endsWith('counter_state'))rows=rows.map(row=>{const n=Number(row.counter_label.slice(-1)),called=liveTicketPhase==='all-called'||n===1&&liveTicketPhase==='called',code=['TP','SOA','PNEP','REF','ADJ'][n-1];return{...row,ticket_label:called?`${code}-441`:null,service_code:called?code:null,business_date:called?'2026-10-20':null,...(n===1?{is_open:liveTicketPhase!=='closed'}:{})}})
          else rows=[{service_code:'TP',business_date:'2026-10-20',waiting_count:liveTicketPhase==='issued'?3:liveTicketPhase==='skipped'?2:1,updated_at:new Date().toISOString()}]
          await fulfill(event,rows);return
        }
        if(publicUpdate&&path==='/rest/v1/counter_state'&&event.request.method==='GET'){
          const response=await fetch(api+path+url.search,{headers:{apikey:pub,Authorization:`Bearer ${pub}`,'Accept-Profile':'queue_display'},redirect:'error'})
          check(response.ok,'Public projection fixture read failed');const rows=await response.json()
          rows[0]={...rows[0],ticket_label:`TP-${217+publicUpdate}`,service_code:'TP'}
          await fulfill(event,rows);return
        }
        // Isolated response fixtures exercise unavailable services without source writes.
        if(path==='/rest/v1/rpc/public_queue_context'&&publicCatalogMode!=='live'){
          if(publicCatalogMode==='unavailable'){await fulfill(event,{message:'Availability test fixture'},503);return}
          const response=await fetch(api+path,{method:event.request.method,headers:{apikey:pub,Authorization:`Bearer ${pub}`,'Content-Type':'application/json','Content-Profile':'queue_display','Accept-Profile':'queue_display'},body:event.request.method==='POST'?event.request.postData:undefined})
          check(response.ok,'Public context fixture source unavailable')
          const context=await response.json();context.services=context.services.filter(row=>row.code!=='ADJ')
          await fulfill(event,context);return
        }
        await browser.send('Fetch.continueRequest',{requestId:event.requestId});return
      }
    }
    blocked.push({path,origin:url.origin});await browser.send('Fetch.failRequest',{requestId:event.requestId,errorReason:'BlockedByClient'})
  })().catch(async error=>{
    // As in the public-display guard, wait for Chrome's matching cancellation event.
    await delay(200)
    const protocol=error.cdp || {code:null,category:'non-protocol-error'}
    const benign=isCancelledInterception(protocol,aborted.get(event.networkId))
    interceptionDiagnostics.push({protocol,path:new URL(event.request.url).pathname,correlated_cancellation:benign})
    if(!benign)runtime.push('Interception failure')
  })})
  await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
  await browser.send('Page.navigate',{url:origin})
  await waitFor(()=>exists('[data-testid="google-login"]'),'Product login unavailable')
  if(devtoolsMode||adminLayoutMode){
    await test(devtoolsMode?'Actual docked Chrome uses an intercepted ADMIN session without retained identity writes':'Focused headless layout uses an intercepted ADMIN session without retained identity writes',async()=>{
      enabled=true;role='ADMIN';await click('[data-testid="google-login"]');await waitFor(()=>exists('[data-testid="admin-workspace"]'),'Docked ADMIN workspace missing')
      await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Staff management').click()`)
      await waitFor(()=>browser.evaluate(`document.querySelector('[data-testid="add-staff"]')?.disabled===false`),'Owner email invitation controls did not load')
    })
    await test('Owner can submit a first-login email assignment without Google lookup; duplicate is rejected',verifyEmailAssignmentFlow)
    await test('Admin Public Display is absent, Sign Out remains visible and monitor persists at eight widths',()=>adminResponsive('AFTER'))
    if(adminLayoutMode)await test('Admin staff confirmation and payor/mobile monitor have painted viewport evidence without private secrets',async()=>{
      const shot=async(name,width)=>{const file=`admin_final_${run}_${name}_${width}_VIEWPORT.png`;const r=await browser.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(`${directory}/${file}`,Buffer.from(r.data,'base64'));report.screenshots.push(file)}
      await browser.evaluate(`if(!document.querySelector('#fixture-notice')){const n=document.createElement('div');n.id='fixture-notice';n.textContent='SIMULATED ADMIN / PAYOR DATA · NO RETAINED WRITES';n.style.cssText='position:fixed;bottom:0;left:0;z-index:9999;background:#fff9ed;color:#65263d;font:10px Arial;padding:4px';document.body.append(n)};window.scrollTo(0,0)`)
      for(const width of [1440,768,390]){await browser.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});await delay(150);await shot('staff',width)}
      await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
      check(await browser.evaluate(`!document.querySelector('[data-testid="staff-resolve"]')&&!document.body.innerText.includes('Find Google account')`),'Legacy Google lookup remains visible');await shot('staff-access-enabled',1440)
      await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Payor management').click()`);await waitFor(()=>browser.evaluate(`document.querySelector('[data-testid="payor-management"]').innerText.includes('TP-219')`),'Payor snapshot missing')
      for(const width of [1440,768,390]){await browser.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});await browser.evaluate('window.scrollTo(0,0)');await delay(150);await shot('payors',width);await browser.evaluate(`document.querySelector('[data-testid="admin-live-monitor"]').scrollIntoView({block:'start'})`);await delay(150);await shot('monitor',width)}
      staffMode='missing';await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Staff management').click();window.scrollTo(0,0);window.dispatchEvent(new Event('focus'))`);await waitFor(()=>exists('[data-testid="add-staff-unavailable"]'),'Unavailable email assignment backend not disclosed');await shot('backend-unavailable',390)
    })
    await test('Direct public display route opens without private workspace or Auth controls',async()=>{
      await browser.send('Page.navigate',{url:origin+'/display'});await waitFor(()=>browser.evaluate(`document.querySelector('.queue-board[data-live="true"]')`),'Docked standalone display missing')
      check(await browser.evaluate(`document.querySelectorAll('[data-counter]').length===5&&!document.querySelector('#account-workspace')`),'Docked public route rendered private UI')
    })
  }else{
  await test('Real Vue product exposes one Google button and no password/role selection',async()=>{
    check(await browser.evaluate(`document.querySelectorAll('[data-testid="google-login"]').length===1&&!document.querySelector('#login-email')&&!document.querySelector('select')`),'Product login incorrect')
  })
  await test('Split login matches desktop, tablet and mobile without overflow',async()=>{await captureLayout('login')})
  await test('Unconfigured provider shows a safe error without OAuth navigation',async()=>{
    await click('[data-testid="google-login"]');await waitFor(()=>browser.evaluate(`document.body.innerText.includes('Google Sign-In is not available yet')`),'Setup error missing')
    check(authorizeCalls===0&&tokenCalls===0,'Disabled provider attempted OAuth')
  })
  await test('Mocked full PKCE callback verifies ordinary shared dashboard despite ADMIN metadata/email',async()=>{
    enabled=true;await click('[data-testid="google-login"]')
    report.mock_callback_observations=[]
    await waitFor(async()=>{
      const observed=await browser.evaluate(`({root:location.pathname==='/',query_empty:!location.search,fragment_empty:!location.hash,
        student:!!document.querySelector('[data-testid="student-workspace"]'),dashboard:document.body.textContent.includes('Queue Dashboard'),
        admin_absent:!document.querySelector('[data-testid="admin-workspace"]')})`)
      if(JSON.stringify(observed)!==JSON.stringify(report.mock_callback_observations.at(-1)))report.mock_callback_observations.push(observed)
      return Object.values(observed).every(value=>value===true)
    },'Callback not scrubbed or dashboard missing')
    check(tokenCalls===1,'Expected one token exchange')
  })
  if(!mfaMode)await test('Current disabled MFA displays unavailable without a factor mutation',async()=>{
    await browser.send('Page.navigate',{url:origin+'/account/security'});await waitFor(()=>exists('[data-testid="student-workspace"]'),'Security route unavailable')
    await click('[data-testid="account-security"]');await waitFor(()=>exists('[data-testid="account-mfa"]'),'Account security unavailable')
    check(await browser.evaluate(`document.querySelector('[data-testid="mfa-message"]').textContent.includes('not enabled')&&!document.querySelector('[data-testid="mfa-enroll"]')&&!document.querySelector('[data-testid="mfa-code"]')`),'Disabled MFA offered setup')
    await captureLayout('mfa-unavailable');await click('[data-testid="mfa-close"]');check(mfaCalls===0,'Disabled MFA contacted factor API')
  })
  if(mfaMode){
    await browser.send('Page.navigate',{url:origin+'/account/security'});await waitFor(()=>exists('[data-testid="student-workspace"]'),'Security route unavailable')
    report.simulated_mfa=true
    const press=async selector=>{await waitFor(()=>browser.evaluate(`!!document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled`),'MFA control not ready');await click(selector)}
    const code=async value=>browser.evaluate(`{const input=document.querySelector('[data-testid="mfa-code"]');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}))}`)
    const open=async()=>{await click('[data-testid="account-security"]');await waitFor(async()=>await exists('[data-testid="mfa-enroll"], [data-testid="mfa-select-factor"], [data-testid="mfa-resume"], [data-testid="mfa-recheck"]')||await browser.evaluate(`!!document.querySelector('[data-testid="account-mfa"] h3')`),'MFA inventory missing')}
    await test('MFA setup is explicit, QR/manual key stay private, and cancellation reviews unfinished setup',async()=>{
      await open();await waitFor(()=>browser.evaluate(`!!document.querySelector('[data-testid="mfa-enroll"]')&&!document.querySelector('[data-testid="mfa-enroll"]').disabled`),'Enrollment not ready')
      await click('[data-testid="mfa-enroll"]');await waitFor(()=>exists('[data-testid="mfa-qr"]'),'MFA QR not rendered')
      check(await browser.evaluate(`document.querySelector('[data-testid="mfa-qr"]').getAttribute('src').startsWith('data:image/svg+xml;')&&!document.querySelector('[data-testid="mfa-manual"]')`),'QR source/manual privacy incorrect')
      await waitFor(()=>browser.evaluate(`document.querySelector('[data-testid="mfa-qr"]')?.complete&&document.querySelector('[data-testid="mfa-qr"]')?.naturalWidth>0`),'Private QR did not load as a real image')
      await browser.evaluate(`document.querySelector('[data-testid="mfa-qr"]').dispatchEvent(new Event('error'))`)
      await waitFor(()=>exists('[data-testid="mfa-qr-error"]'),'QR failure did not offer same-setup manual fallback')
      await browser.evaluate(`[...document.querySelectorAll('dialog button')].find(b=>b.textContent.includes('Show manual setup')).click()`)
      check(await browser.evaluate(`!!document.querySelector('[data-testid="mfa-manual"] code')&&!JSON.stringify(localStorage).includes('${mfaSecret}')&&!JSON.stringify(sessionStorage).includes('${mfaSecret}')`),'Setup key persisted or unavailable')
      await code('12');check(await browser.evaluate(`document.querySelector('[data-testid="mfa-verify"]').disabled`),'Malformed code enabled verification')
      await click('[data-testid="mfa-close"]');await waitFor(()=>browser.evaluate(`!document.querySelector('[data-testid="mfa-qr"], [data-testid="mfa-code"], [data-testid="mfa-manual"]')`),'Closing retained sensitive DOM')
      await open();await waitFor(()=>browser.evaluate(`document.querySelector('[data-testid="account-mfa"]').textContent.includes('unfinished setup')`),'Interrupted setup not detected')
      check(await exists('[data-testid="mfa-resume"]')&&!await exists('[data-testid="mfa-enroll"]'),'Unfinished setup offered duplicate enrollment or no resumption')
      await captureLayout('mfa-unfinished')
      await click('[data-testid="mfa-close"]')
    })
    await test('MFA wrong code is sanitized and explicit retry reaches AAL2 without a role promotion',async()=>{
      await open();await press('[data-testid="mfa-resume"]');await waitFor(()=>exists('[data-testid="mfa-code"]'),'Verification form missing')
      mfaFailure='wrong';await code('123456');await press('[data-testid="mfa-verify"]')
      await waitFor(()=>browser.evaluate(`document.querySelector('[data-testid="mfa-message"]')?.textContent.includes('not accepted')`),'Wrong-code feedback missing')
      check(await browser.evaluate(`!document.querySelector('[data-testid="mfa-qr"]')&&!document.querySelector('[data-testid="mfa-code"]').value&&!document.body.textContent.includes('TEST_PROVIDER_PRIVATE_TEXT')`),'Wrong-code privacy failed')
      mfaFailure=null;await code('123456');await press('[data-testid="mfa-verify"]');await waitFor(()=>exists('[data-testid="mfa-verified"]'),'AAL2 verification missing')
      await waitFor(()=>exists('[data-testid="student-workspace"]'),'Current role not refreshed after MFA')
      check(!await exists('[data-testid="admin-workspace"]'),'MFA promoted user')
      await captureLayout('mfa-verified');await click('[data-testid="mfa-close"]')
    })
    await test('Existing authenticator challenges handle expiry and session recovery without cached setup material',async()=>{
      mfaLevel='aal1'
      await browser.evaluate(`(async()=>{const {supabase}=await import('/src/lib/supabase.js');await supabase.auth.setSession({access_token:${JSON.stringify(token())},refresh_token:'TEST_PRIVATE_REFRESH'})})()`)
      await waitFor(()=>exists('[data-testid="account-security"]'),'AAL1 fixture restoration failed')
      await open();await waitFor(()=>exists('[data-testid="mfa-select-factor"]'),'Existing factor not offered');await press('[data-testid="mfa-select-factor"]')
      mfaFailure='expired';await code('123456');const previous=mfaCalls;await press('[data-testid="mfa-verify"]')
      await waitFor(()=>exists('[data-testid="mfa-recheck"]'),'Expired challenge did not interrupt')
      check(mfaCalls===previous+1,'Expired challenge was submitted for verification')
      mfaFailure=null;await press('[data-testid="mfa-recheck"]');await waitFor(()=>exists('[data-testid="mfa-select-factor"]'),'MFA status did not recover')
      await click('[data-testid="mfa-close"]');await reloadPage();await waitFor(()=>exists('[data-testid="student-workspace"]'),'Session recovery failed')
      check(await browser.evaluate(`!document.querySelector('[data-testid="account-mfa"], [data-testid="mfa-qr"], [data-testid="mfa-code"]')&&!JSON.stringify(localStorage).includes('${mfaSecret}')`),'Reload recovered sensitive setup material')
    })
  }
  await test('Student service dialog traps focus, disables issuance and restores focus on Escape',async()=>{
    await waitFor(()=>browser.evaluate(`document.body.innerText.includes('TP-217')&&document.body.innerText.includes('TP-216')&&document.querySelector('[data-testid="student-live-monitor"] .queue-board[data-live="true"]')`),'Owner tickets and initial public readiness not settled')
    check(await browser.evaluate(`document.querySelectorAll('[data-testid="student-live-monitor"] [data-counter]').length===5&&document.querySelectorAll('[data-testid="public-board"]').length===1&&document.querySelectorAll('main').length===1`),'Embedded display missing counters, duplicated or nested main')
    const socketCount=await browser.evaluate('window.__publicQueueSocketCount()')
    report.embedded_public_socket_count=socketCount
    check(socketCount===1,'Embedded display duplicated public Realtime connection')
    check(await browser.evaluate(`document.querySelectorAll('.cqs-service-card').length===5`),'Missing fixed service')
    for(const [index,code] of ['TP','SOA','PNEP','REF','ADJ'].entries()){
      if(index===0){
        await browser.evaluate(`document.querySelector('[data-testid="service-TP"]').focus()`)
        await browser.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'})
        await browser.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
      }else await click(`[data-testid="service-${code}"]`)
      await waitFor(()=>exists('dialog[open]'),'Service keyboard/click activation failed')
      check(await browser.evaluate(`document.querySelector('dialog .cqs-selected-service').innerText.includes(${JSON.stringify(code)})&&document.querySelector('dialog .cqs-selected-service').innerText.includes('Counter ${index+1}')&&document.querySelector('dialog .cqs-selected-service h3').textContent===document.querySelector('[data-testid="service-${code}"] h2').textContent`),'Service dialog counter/name binding incorrect')
      await click('dialog button[aria-label="Close dialog"]')
    }
    await click('[data-testid="service-ADJ"]');await waitFor(()=>exists('dialog[open]'),'Service dialog unavailable')
    check(await browser.evaluate(`document.querySelector('dialog').contains(document.activeElement)&&[...document.querySelectorAll('dialog button')].some(b=>b.disabled&&b.textContent.includes('Confirm'))`),'Focus or issuance lock missing')
    for(let i=0;i<5;i++) { await browser.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9}); await browser.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9}); check(await browser.evaluate(`document.querySelector('dialog').contains(document.activeElement)`),'Dialog focus escaped') }
    await browser.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await browser.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
    await waitFor(()=>browser.evaluate(`!document.querySelector('dialog')&&document.activeElement===document.querySelector('[data-testid="service-ADJ"]')`),'Dialog focus not restored')
    await captureLayout('student')
    await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
    check(await browser.evaluate(`getComputedStyle(document.querySelector('.cqs-ticket-rail')).position==='sticky'`),'Desktop ticket rail is not sticky')
    await browser.evaluate(`window.scrollTo(0,Math.min(700,document.querySelector('.cqs-main-column').scrollHeight/2))`)
    check(await browser.evaluate(`Math.abs(document.querySelector('.cqs-ticket-rail').getBoundingClientRect().top-24)<3`),'Desktop ticket rail did not stay visible beside monitor')
    await browser.evaluate('window.scrollTo(0,0)')
    await click('[data-testid="service-SOA"]');await captureLayout('student-dialog');await click('dialog button[aria-label="Close dialog"]')
  })
  await test('Disabled or unavailable public service catalog prevents card selection and recovers without a duplicate socket',async()=>{
    report.simulated_service_availability=true
    const signalPublic=()=>browser.evaluate(`(async()=>{const {publicSupabase}=await import('/src/lib/supabase.js');for(const channel of publicSupabase.getChannels())for(const binding of channel.bindings.postgres_changes||[])binding.callback({eventType:'UPDATE'})})()`)
    report.availability_stage='disable-service'
    publicCatalogMode='disabled';await signalPublic()
    await waitFor(()=>browser.evaluate(`document.querySelector('[data-testid="service-ADJ"]')?.disabled&&document.querySelector('[data-testid="service-ADJ"]')?.textContent.includes('Service disabled')`),'Disabled service remained selectable')
    report.availability_stage='disabled-click'
    await click('[data-testid="service-ADJ"]');check(!await exists('dialog'),'Disabled service opened confirmation')
    check(await browser.evaluate(`document.querySelector('[data-testid="service-TP"]')?.disabled===false`),'Enabled service incorrectly disabled')
    report.availability_stage='unavailable-context'
    publicCatalogMode='unavailable';await signalPublic()
    await waitFor(()=>browser.evaluate(`[...document.querySelectorAll('.cqs-service-card')].every(card=>card.disabled)&&!!document.querySelector('.board-alert[role="alert"]')`),'Unavailable catalog remained selectable')
    report.availability_stage='unavailable-click'
    await click('[data-testid="service-TP"]');check(!await exists('dialog'),'Unavailable service opened confirmation')
    report.availability_stage='restore-live'
    publicCatalogMode='live';await signalPublic()
    await waitFor(()=>browser.evaluate(`[...document.querySelectorAll('.cqs-service-card')].every(card=>!card.disabled)&&document.querySelector('[data-testid="student-live-monitor"] .queue-board[data-live="true"]')`),'Live service availability did not recover')
    check(await browser.evaluate('window.__publicQueueSocketCount()===1'),'Availability recovery duplicated public subscription')
    report.availability_stage='verified'
  })
  await test('Owner ticket error and empty states are distinct and private diagnostics stay hidden',async()=>{
    workspaceMode='error';await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Refresh tickets').click()`)
    await waitFor(()=>browser.evaluate(`document.body.innerText.includes('ticket history is unavailable')`),'Unavailable state missing')
    check(await browser.evaluate(`!document.body.innerText.includes('TP-217')&&!document.body.innerText.includes('TEST_PROVIDER_PRIVATE_TEXT')`),'Stale or private data exposed')
    workspaceMode='empty';await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Refresh tickets').click()`)
    await waitFor(()=>browser.evaluate(`document.body.innerText.includes('No served or forfeited tickets')`),'Empty ticket state missing')
    workspaceMode='populated'
  })
  await test('Reload has no login flash and waits for mocked getUser and current database context',async()=>{
    userGate=gate();contextGate=gate();const beforeUser=userChecks,beforeContext=contextChecks
    const observer=await browser.send('Page.addScriptToEvaluateOnNewDocument',{source:`
      window.__loginFlash=false;
      new MutationObserver(()=>{if(document.querySelector('.cqs-login,[data-testid="google-login"]'))window.__loginFlash=true})
        .observe(document,{childList:true,subtree:true});`})
    try {
      await reloadPage()
      await waitFor(async()=>userChecks>beforeUser&&await exists('[data-testid="auth-pending"]'),'Session restoration view missing')
      await captureLayout('session-loading')
      check(await browser.evaluate(`!window.__loginFlash&&!document.querySelector('[data-testid="student-workspace"]')`),'Login flashed or unverified session exposed workspace')
      userGate.release();userGate=null
      await waitFor(()=>contextChecks>beforeContext,'Current context not requested')
      check(await exists('[data-testid="auth-pending"]'),'Workspace rendered before database authorization')
      contextGate.release();contextGate=null
      await waitFor(()=>exists('[data-testid="student-workspace"]'),'Stored mock session failed')
      check(await browser.evaluate(`!window.__loginFlash&&document.body.textContent.includes('Student / payor')`),'Reload flashed login or lost authorized role')
      check(tokenCalls===1,'Reload exchanged the code again')
    } finally {
      userGate?.release();contextGate?.release();userGate=null;contextGate=null
      await browser.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:observer.identifier})
    }
  })
  await test('Authoritative cashier/admin context overrides metadata with existing session',async()=>{
    for(const next of ['CASHIER','ADMIN']){
      role=next;await browser.evaluate(`document.dispatchEvent(new Event('visibilitychange'))`);await waitFor(()=>exists(`[data-testid="${next.toLowerCase()}-workspace"]`),'Mock role context failed')
      await waitFor(()=>browser.evaluate(`document.body.innerText.includes('TP-217')`),'Staff read not rendered')
      await captureLayout(next.toLowerCase())
      if(next==='CASHIER') {
        check(await browser.evaluate(`document.querySelector('[data-testid="call-next"]').disabled&&!document.querySelector('[data-testid="serve-ticket"]').disabled&&!document.querySelector('[data-testid="skip-ticket"]')`),'Cashier controls do not match the called-ticket fixture')
        await browser.evaluate(`const input=document.querySelector('input[type=search]');input.value='NOT-A-TICKET';input.dispatchEvent(new Event('input',{bubbles:true}))`)
        check(await browser.evaluate(`document.body.innerText.includes('No tickets match your filters')`),'Cashier search not applied')
      } else {
        await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Staff management').click()`)
        await waitFor(()=>browser.evaluate(`document.body.innerText.includes('cashier@example.invalid')&&!document.querySelector('[data-testid="add-staff"]').disabled`),'Installed staff directory did not load')
        check(await browser.evaluate(`document.querySelectorAll('[data-account]').length===2&&document.querySelector('[data-testid="staff-edit-00000000-0000-4000-8000-000000000001"]').disabled`),'Directory/current-operator binding failed')
        await captureLayout('admin-staff')
        await adminResponsive(navigationBefore?'BEFORE':'AFTER')
      }
    }
  })
  if(!navigationBefore){
  await test('Background queue notifications and focus revalidation preserve the staff tab, draft, search and component',async()=>{
    check(await browser.evaluate(`!['Refresh queue','Refresh directory'].some(label=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim().toLowerCase()===label.toLowerCase()))&&document.querySelector('[data-testid="add-staff"]').getBoundingClientRect().top<document.querySelector('[data-testid="staff-search"]').getBoundingClientRect().top`),'Refresh controls remain or Add Staff is below search')
    await field('[data-testid="staff-search"]','cashier');await staffClick('[data-testid="add-staff"]');await field('[data-testid="staff-request-email"]','draft@example.invalid')
    await browser.evaluate(`window.__stableAdmin=document.querySelector('[data-testid="admin-workspace"]');window.__stableDialog=document.querySelector('dialog');window.__stableInput=document.querySelector('[data-testid="staff-request-email"]')`)
    const reads=directoryReads,configReads=configurationReads,queues=workspaceCalls.length;publicUpdate=1
    await browser.evaluate(`(async()=>{const {publicSupabase}=await import('/src/lib/supabase.js');for(let i=0;i<50;i++)for(const c of publicSupabase.getChannels())for(const binding of c.bindings.postgres_changes||[])binding.callback({eventType:'UPDATE'})})()`)
    await waitFor(()=>workspaceCalls.length>queues,'Notification did not refresh authorized queue data')
    await waitFor(()=>browser.evaluate(`document.querySelector('[data-testid="admin-live-monitor"]').innerText.includes('TP-218')`),'Persistent monitor did not render the changed public projection')
    check(directoryReads===reads&&configurationReads===configReads,'Public queue events reloaded the staff directory')
    await browser.evaluate(`window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'))`)
    await waitFor(()=>directoryReads>reads&&configurationReads>configReads,'Focus did not revalidate staff data')
    await waitFor(()=>browser.evaluate(`!document.querySelector('[data-testid="admin-workspace"]').__vueParentComponent.props.management.refreshing`),'Directory revalidation did not settle')
    check(await browser.evaluate(`window.__stableAdmin===document.querySelector('[data-testid="admin-workspace"]')&&window.__stableDialog===document.querySelector('dialog')&&window.__stableInput===document.querySelector('[data-testid="staff-request-email"]')&&window.__stableInput.value==='draft@example.invalid'&&document.querySelector('[data-testid="staff-search"]').value==='cashier'&&!document.querySelector('[data-testid="auth-pending"]')`),'Background updates reset the workspace or draft')
    check(directoryReads===reads+1&&configurationReads===configReads+1,'Recovery events duplicated directory reads')
    check(await browser.evaluate(`window.__publicQueueSocketCount()===1`),'Background updates duplicated subscriptions')
    await staffClick('dialog button[aria-label="Close dialog"]');await field('[data-testid="staff-search"]','');report.controlled_queue_notifications=true
    publicUpdate=0;const priorQueues=workspaceCalls.length
    await browser.evaluate(`(async()=>{const {publicSupabase}=await import('/src/lib/supabase.js');for(const c of publicSupabase.getChannels())for(const binding of c.bindings.postgres_changes||[])binding.callback({eventType:'UPDATE'})})()`)
    await waitFor(()=>workspaceCalls.length>priorQueues,'Controlled public fixture did not return to live reads')
  })
  await test('Live tickets use only current public calls, clear after serve/skip, and recover without replacing the dashboard',async()=>{
    await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Overview & analytics').click();window.__livePanel=document.querySelector('[data-testid="admin-live-monitor"]');window.__liveAdmin=document.querySelector('[data-testid="admin-workspace"]')`)
    check(await browser.evaluate(`!document.querySelector('.cqs-config')&&!document.body.innerText.includes('Queue configuration')&&document.querySelectorAll('[data-live-counter]').length===5`),'Configuration card remains or live counters missing')
    const signal=()=>browser.evaluate(`(async()=>{const {publicSupabase}=await import('/src/lib/supabase.js');for(const c of publicSupabase.getChannels())for(const b of c.bindings.postgres_changes||[])b.callback({eventType:'UPDATE'})})()`)
    for(const phase of ['called','served','skipped','issued','closed']){
      liveTicketPhase=phase;await signal()
      await waitFor(()=>browser.evaluate(`(()=>{const row=document.querySelector('[data-live-counter="1"]');return row&&${phase==='called'?"row.textContent.includes('TP-441')&&row.textContent.includes('Currently called')":phase==='issued'?"!row.textContent.includes('TP-441')&&row.textContent.includes('3 waiting')":phase==='skipped'?"!row.textContent.includes('TP-441')&&row.textContent.includes('2 waiting')":phase==='closed'?"!row.textContent.includes('TP-441')&&row.textContent.includes('Closed')":"!row.textContent.includes('TP-441')&&row.textContent.includes('No ticket being called')"}})()`),'Live ticket phase did not render: '+phase)
    }
    liveTicketPhase='called';await signal();await waitFor(()=>browser.evaluate(`document.querySelector('[data-live-counter="1"]')?.textContent.includes('TP-441')`),'Call fixture missing before disconnect')
    await captureLayout('admin-live-called')
    liveTicketPhase='all-called';await signal();await waitFor(()=>browser.evaluate(`document.querySelectorAll('[data-testid="live-called-ticket"]').length===5&&getComputedStyle(document.querySelector('[data-testid="admin-live-monitor"]')).position==='static'`),'Tall five-call panel remained trapped in sticky positioning')
    await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1500,deviceScaleFactor:1,mobile:false})
    await waitFor(()=>browser.evaluate(`getComputedStyle(document.querySelector('[data-testid="admin-live-monitor"]')).position==='sticky'`),'Panel did not become sticky when enough height returned')
    await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
    liveTicketPhase='called';await signal();await waitFor(()=>browser.evaluate(`document.querySelectorAll('[data-testid="live-called-ticket"]').length===1`),'Single-call fixture did not recover')
    await browser.evaluate(`window.__closePublicQueueSocket()`)
    await waitFor(()=>browser.evaluate(`document.querySelector('[data-testid="admin-live-tickets"]')?.dataset.live==='false'`),'Disconnect kept live status')
    check(await browser.evaluate(`document.querySelector('[data-testid="admin-live-monitor"]').textContent.includes('stale')&&!document.querySelector('[data-testid="admin-live-monitor"]').textContent.includes('Currently called')`),'Disconnected calls were presented as current')
    await waitFor(()=>browser.evaluate(`document.querySelector('[data-testid="admin-live-tickets"]')?.dataset.live==='true'&&window.__publicQueueSocketCount()===1`),'Fresh reconnect did not restore one live socket')
    check(await browser.evaluate(`window.__livePanel===document.querySelector('[data-testid="admin-live-monitor"]')&&window.__liveAdmin===document.querySelector('[data-testid="admin-workspace"]')`),'Realtime updates remounted dashboard or live panel')
    liveTicketPhase=null;await signal();await waitFor(()=>browser.evaluate(`!document.querySelector('[data-testid="admin-live-monitor"]').textContent.includes('TP-441')`),'Live read restoration failed')
    await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Staff management').click()`)
    report.controlled_live_ticket_phases=true
  })
  await test('Staff email search preserves the owner-only staff controls without a separate counter editor',async()=>{
    await browser.evaluate(`window.__staffTrace=[];new MutationObserver(()=>{const s=document.querySelector('[data-testid="admin-workspace"]')?.__vueParentComponent.props.management;if(s){const value=JSON.stringify({status:s.status,phase:s.phase,busy:s.busy,message:s.message});if(window.__staffTrace.at(-1)!==value)window.__staffTrace.push(value)}}).observe(document.body,{childList:true,subtree:true,attributes:true})`)
    await field('[data-testid="staff-search"]','cashier@example.invalid');check(await browser.evaluate(`document.querySelectorAll('[data-account]').length===1`),'Email search failed');await field('[data-testid="staff-search"]','')
    await staffClick('[data-testid="staff-edit-20000000-0000-4000-8000-000000000002"]');await waitFor(()=>exists('[data-testid="staff-edit-role"]'),'Account confirmation missing')
    check(staffMutations.length===0,'Account changed before confirmation');await field('[data-testid="staff-edit-role"]','CASHIER');await staffClick('[data-testid="staff-confirm"]')
    await waitFor(()=>browser.evaluate(`!document.querySelector('dialog')&&document.querySelector('[data-account="20000000-0000-4000-8000-000000000002"]')?.textContent.includes('CASHIER')===true`),'Confirmed account change did not refresh')
    check(await browser.evaluate(`!document.querySelector('[data-testid="staff-management"]').textContent.includes('Cashier Counter Assignments')&&!document.querySelector('[data-testid^="counter-edit-"]')&&!document.querySelector('[data-testid="staff-management"]').textContent.includes('Email unavailable')`),'Separate counter assignment editor or unavailable email was still shown')
    check(staffMutations.join(',')==='account','Unexpected management operation')
  })
  await test('Payor tab preserves one live monitor, supports authorized history and responsive layouts',async()=>{
    const monitor=await browser.evaluate(`window.__adminMonitor=document.querySelector('[data-testid="admin-live-monitor"]');true`)
    await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Payor management').click()`)
    await waitFor(()=>browser.evaluate(`document.querySelector('[data-testid="payor-management"]').innerText.includes('TP-219')`),'Payor page missing')
    check(await browser.evaluate(`window.__adminMonitor===document.querySelector('[data-testid="admin-live-monitor"]')&&window.__publicQueueSocketCount()===1&&!document.querySelector('[data-testid="public-display-link"]')`),'Tab change replaced monitor or added subscriptions')
    await browser.evaluate(`[...document.querySelectorAll('[data-testid="payor-management"] button')].find(b=>b.textContent==='Ticket history').click()`)
    await waitFor(()=>browser.evaluate(`document.querySelector('dialog')?.innerText.includes('SKIPPED → WAITING')`),'Actual history contract not rendered');await staffClick('dialog button[aria-label="Close dialog"]')
    for(const width of [1440,768,390]){await browser.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});check(await browser.evaluate(`document.documentElement.scrollWidth<=innerWidth`),'Payor overflow');const file=`admin_payors_${run}_SIMULATED_${width}.png`;await browser.screenshot(`${directory}/${file}`);report.screenshots.push(file)}
    await browser.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
    await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Staff management').click()`)
  })
  await test('Owner can submit a first-login email assignment without Google lookup; duplicate is rejected',async()=>{
    await verifyEmailAssignmentFlow()
  })
  await test('Missing read capability is truthful and a denied directory cannot revive cached legacy accounts',async()=>{
    staffMode='missing';await browser.evaluate(`window.dispatchEvent(new Event('focus'))`);await waitFor(()=>exists('[data-testid="add-staff-unavailable"]'),'Missing assignment endpoint not gated')
    await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Payor management').click()`);await waitFor(()=>exists('[data-testid="payor-unavailable"]'),'Missing payor endpoint not disclosed');await captureLayout('admin-payor-unavailable')
    staffMode='denied-directory';await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Staff management').click()`)
    // A protected denial intentionally clears/reverifies authorization and can
    // remount this workspace. Wait for its resulting state before selecting a tab.
    await waitFor(()=>browser.evaluate(`document.querySelector('[data-testid="admin-workspace"]')?.__vueParentComponent?.props?.records?.staff?.status==='restricted'`),'Directory denial missing')
    await waitFor(()=>browser.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Staff management');if(!b)return false;b.click();return true})()`),'Authoritative ADMIN recovery failed')
    await waitFor(()=>exists('[data-testid="staff-management"]'),'Staff panel did not recover')
    check(await browser.evaluate(`document.querySelectorAll('[data-account]').length===0&&!document.querySelector('[data-testid="staff-management"]').innerText.includes('cashier@example.invalid')`),'Denied directory exposed cached private rows')
    staffMode='success';await browser.evaluate(`window.dispatchEvent(new Event('focus'))`)
    await waitFor(()=>browser.evaluate(`document.querySelector('[data-testid="admin-workspace"]')?.__vueParentComponent?.props?.records?.staff?.status==='ready'`),'Directory read did not recover')
    await waitFor(()=>browser.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Staff management');if(!b)return false;b.click();return true})()`),'Staff tab unavailable after recovery')
    await waitFor(()=>browser.evaluate(`document.querySelectorAll('[data-account]').length===2`),'Recovered directory rows missing')
  })
  await test('Revoked role and disabled account immediately clear prior workspace on revalidation',async()=>{
    role='STUDENT';await browser.evaluate(`document.dispatchEvent(new Event('visibilitychange'))`);await waitFor(()=>exists('[data-testid="student-workspace"]'),'Revoked role not reflected')
    disabled=true;await browser.evaluate(`document.dispatchEvent(new Event('visibilitychange'))`);await waitFor(()=>exists('[data-testid="access-disabled"]'),'Disabled view missing')
    check(await browser.evaluate(`!document.querySelector('[data-testid="admin-workspace"]')&&!document.querySelector('[data-testid="cashier-workspace"]')`),'Old staff workspace remained')
  })
  await test('Mock logout and Google account switching cannot retain previous context',async()=>{
    await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Sign out').click()`)
    await waitFor(()=>exists('[data-testid="confirm-sign-out"]'),'Logout confirmation missing');await click('[data-testid="confirm-sign-out"]')
    await waitFor(()=>exists('[data-testid="google-login"]'),'Logout did not clear access')
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
  await test('Cancelled saved sign-in has a terminal recovery error without adopting its SDK session',async()=>{
    const previous=tokenCalls
    await browser.evaluate(`(()=>{const key=${JSON.stringify(OAUTH_MARKER)},marker=JSON.parse(localStorage.getItem(key));localStorage.setItem(key,JSON.stringify({...marker,phase:'cancelled'}))})()`)
    await reloadPage()
    await waitFor(()=>browser.evaluate(`document.body.innerText.includes('Sign-in needs your attention')`),'Unfinished sign-in did not expose recovery')
    await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Check sign-in outcome').click()`)
    await waitFor(()=>browser.evaluate(`document.body.innerText.includes('No sign-in could be verified')`),'Cancelled recovery remained pending')
    check(tokenCalls===previous&&await browser.evaluate(`!document.querySelector('[data-testid="student-workspace"]')&&!document.querySelector('[data-testid="admin-workspace"]')`),'Cancelled session restored private access or re-exchanged a code')
    await browser.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Cancel sign-in').click()`)
    await waitFor(()=>browser.evaluate(`document.body.innerText.includes('Sign-in cancelled')&&!document.querySelector('[data-testid="google-login"]').disabled`),'Recovery error did not allow explicit cancellation')
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
    await waitFor(()=>browser.evaluate(`document.querySelector('.queue-board[data-live="true"]')`),'Public board did not synchronize')
    check(await browser.evaluate(`!document.querySelector('#account-workspace')&&document.querySelectorAll('[data-counter]').length===5&&!location.search`),'Monitor affected by Auth state')
  })
  await test('No unexpected network path, real Auth write, runtime error or Google/hosted contact',async()=>{check(!blocked.length&&!runtime.length,'Unexpected network/runtime behavior');check(workspaceCalls.some(path=>path.endsWith('my_tickets'))&&workspaceCalls.some(path=>path.endsWith('staff_queue')),'Read integration not exercised')})
  }
  }
  report.result='PASS'
}catch(error){report.result='FAIL';report.failure=error instanceof Failure?error.message:'Harness error; details suppressed';report.blocked=blocked;report.runtime_errors=runtime;
  if(mfaMode){report.mfa_fixture={calls:mfaCalls,assurance:mfaLevel,statuses:mfaFactors.map(row=>row.status)};try{report.mfa_ui=await browser?.evaluate(`({phase:document.querySelector('[data-testid="account-mfa"]')?.dataset.phase,message:document.querySelector('[data-testid="mfa-message"]')?.textContent})`)}catch{}}
  if(!checks.some(item=>item.result==='FAIL'))checks.push({name:'Browser setup gate',result:'FAIL',reason:report.failure})
  report.network_failures=networkFailures;report.public_response_statuses=publicResponses;report.socket_statuses=socketStatuses
  try{report.browser_state=await browser?.evaluate(`({path:location.pathname,live:!!document.querySelector('.queue-board[data-live="true"]'),google:!!document.querySelector('[data-testid="google-login"]')})`)}catch{}
  try{if(browser){report.staff_trace=await browser.evaluate(`window.__staffTrace||[]`);await browser.evaluate(`document.querySelectorAll('[data-testid="account-mfa"]').forEach(node=>node.replaceChildren(document.createTextNode('MFA content redacted for failure evidence')))`);await browser.screenshot(`${directory}/google_oauth_frontend_${run}_failure.png`)}}catch{}
  console.error(report.failure);process.exitCode=1
}finally{
  staffGate?.release()
  try{await browser?.close()}catch{}vite?.kill()
  report.passed=checks.filter(c=>c.result==='PASS').length;report.failed=checks.filter(c=>c.result==='FAIL').length
  report.interception_diagnostics=interceptionDiagnostics
  report.app_resource_statuses=appResources
  writeFileSync(`${directory}/google_oauth_frontend_${run}.json`,JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({result:report.result,passed:report.passed,failed:report.failed,evidence:`google_oauth_frontend_${run}.json`}))
}
