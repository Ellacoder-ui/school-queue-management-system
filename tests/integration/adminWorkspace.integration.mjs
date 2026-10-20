// All security/management writes target only new, guarded disposable resources.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { QueueFixture, need, digest, preservationQuery } from './queueFixture.mjs'
const fixture = new QueueFixture(), checks = [], run = fixture.run
const report = { run, retained_writes: false, synthetic_auth_only: true, checks }
const q = x => "'" + String(x).replaceAll("'", "''") + "'"
const uid = name => fixture.users[name]
// The user may personally complete the explicitly authorized enrollment while this
// fixture runs. Only that actor's mutable Auth rows are outside this test's fence;
// ALL application roles/assignments/queue data and unrelated Auth rows remain exact.
const enrollmentPreservation = preservationQuery
  .replace('from auth.users t)', "from auth.users t where t.id<>'5c96debb-697f-4cad-805f-92b518e28343')")
  .replace('from auth.identities t)', "from auth.identities t where t.user_id<>'5c96debb-697f-4cad-805f-92b518e28343')")
let services, source, inventory
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
async function test(name, body) { try { await body(); checks.push({ name, result: 'PASS' }); console.log('PASS: ' + name) } catch (error) { checks.push({ name, result: 'FAIL' }); throw error } }
async function rpc(actor, name, body = {}, aal = 'aal2') { const r = await fixture.request('/rpc/' + name, { name: actor, body, token: fixture.token(actor, actor === 'anon' ? 'anon' : 'authenticated', aal) }); return { status: r.status, body: await r.json() } }
const denied = r => need(r.status >= 400 && r.body.code === '42501', 'AWS_EXPECTED_DENIAL')
async function rejectSql(sql, code = '42501') { await fixture.sql(`do $negative$ begin begin ${sql}; raise exception 'Unexpected acceptance'; exception when sqlstate '${code}' then null; end; end $negative$;`) }
async function binding(name) { return (await fixture.sql(`select queue_private.google_staff_binding(${q(uid(name))});`)).trim() }
async function review(name, role) { await fixture.sql(`select queue_private.review_staff_access(${q(uid(name))},${q(name + '@example.invalid')},${q(await binding(name))},${q(role)},${q(run + '-' + name + role)},clock_timestamp()+interval '1 day');`) }
try {
  mkdirSync('tests/integration/results', { recursive: true })
  services = await fixture.retained(); source = fixture.retainedRead(enrollmentPreservation).trim(); inventory = await fixture.inventory()
  report.allowed_retained_auth_activity = 'User-controlled enrollment/login for the exact personal UUID only; all application/account roles and unrelated Auth fingerprints remain fenced.'
  await fixture.start(); report.prior_sql_methods = fixture.policyTests
  await fixture.sql(`create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
    create table auth.identities(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users,provider text,provider_id text,identity_data jsonb);
    create table auth.mfa_factors(user_id uuid primary key references auth.users,status text);
    insert into auth.identities(user_id,provider,provider_id,identity_data) select id,'google','fixture-'||id,jsonb_build_object('sub','fixture-'||id,'email',email,'email_verified',true) from auth.users;
    insert into auth.mfa_factors select id,'verified' from auth.users where id in (${q(uid('admin'))},${q(uid('cashier'))});`)
  report.proposals = {}
  for (const name of ['20261019000700_staff_security.PROPOSED.sql', '20261019000800_admin_workspace.PROPOSED.sql']) {
    const sql = readFileSync('supabase/' + name); report.proposals[name] = digest(sql)
    if (name.includes('00700')) need(digest(sql) === 'b22d63d24c991b9ebf0d380d27a716d5ea72e418f5e62e177c96dded4481222c', 'AWS_007_CHANGED')
    fixture.stage = name; await fixture.sql(sql.toString('utf8'))
  }
  await test('proposals seed no staff request, approval or Auth identity', async () => {
    need((await fixture.sql('select count(*) from queue_private.staff_access_requests;')).trim() === '0', 'AWS_SEEDED_REQUEST')
    need((await fixture.sql('select count(*) from queue_private.staff_access_approvals;')).trim() === '0', 'AWS_SEEDED_AUTHORITY')
  })
  await test('ordinary, anonymous, cashier, disabled and unapproved ADMIN cannot read the directory', async () => {
    for (const actor of ['student', 'other', 'anon', 'cashier', 'disabled', 'admin']) {
      denied(await rpc(actor, 'admin_workspace', { p_date: date }))
      denied(await rpc(actor, 'request_staff_access', {p_email:'unapproved@example.invalid',p_role:'ADMIN',p_request_key:randomUUID()}))
    }
  })
  await review('admin', 'ADMIN'); await review('cashier', 'CASHIER')
  await test('approved ADMIN still needs signed AAL2', async () => { denied(await rpc('admin', 'admin_workspace', { p_date: date }, 'aal1')) })
  await test('authorized directory contains real identity bindings and all five exact fixed routes', async () => {
    const r = await rpc('admin', 'admin_workspace', { p_date: date })
    need(r.status === 200 && r.body.version === 8 && r.body.configuration.counters.length === 5 && r.body.directory.length === Object.keys(fixture.users).length, 'AWS_DIRECTORY_READ')
    need(r.body.directory.find(x => x.id === uid('admin')).email === 'admin@example.invalid', 'AWS_EMAIL_BINDING')
    need(!/access_token|refresh_token|provider_id|identity_data|raw_user|secret/i.test(JSON.stringify(r.body)), 'AWS_PRIVATE_DATA_EXPOSURE')
  })
  await test('new email request creates neither Auth user nor staff privilege; explicit replay is exact', async () => {
    const before = (await fixture.sql('select count(*) from auth.users;')).trim()
    const args = { p_email: 'new-staff@example.invalid', p_role: 'CASHIER', p_request_key: randomUUID() }
    const r = await rpc('admin', 'request_staff_access', args)
    need(r.status === 200 && r.body.status === 'PENDING_IDENTITY_REVIEW', 'AWS_PENDING_REQUEST')
    need(JSON.stringify(r.body) === JSON.stringify((await rpc('admin', 'request_staff_access', args)).body), 'AWS_PENDING_REPLAY')
    need((await fixture.sql('select count(*) from auth.users;')).trim() === before, 'AWS_FAKE_AUTH_USER')
    need((await fixture.sql('select count(*) from queue_private.staff_access_approvals;')).trim() === '2', 'AWS_EMAIL_GRANTED_AUTHORITY')
    const wrong = await rpc('admin', 'request_staff_access', { ...args, p_role: 'ADMIN' }); need(wrong.body.code === '22023', 'AWS_REUSED_KEY')
  })
  let requestId
  await test('existing email request requires operator UUID/Google binding; API cannot bind or approve it', async () => {
    const r = await rpc('admin', 'request_staff_access', { p_email: 'other@example.invalid', p_role: 'CASHIER', p_request_key: randomUUID() })
    need(r.status === 200, 'AWS_EXISTING_REQUEST'); requestId = r.body.request_id
    const deniedBind = await rpc('admin', 'bind_staff_request', {}); need(deniedBind.status >= 400, 'AWS_OPERATOR_EXPOSED')
    await rejectSql(`perform queue_private.bind_staff_request(${q(requestId)},${q(uid('student'))},'other@example.invalid',${q(await binding('student'))})`)
    await rejectSql(`perform queue_private.bind_staff_request(${q(requestId)},${q(uid('other'))},'other@example.invalid',${q(await binding('student'))})`)
    await fixture.sql(`select queue_private.bind_staff_request(${q(requestId)},${q(uid('other'))},'other@example.invalid',${q(await binding('other'))});`)
    need((await fixture.sql(`select role from queue_private.accounts where id=${q(uid('other'))};`)).trim() === 'STUDENT', 'AWS_BINDING_PROMOTED_USER')
  })
  await test('pending/bound request cannot replace operator staff approval; self promotion denied', async () => {
    const args = { p_user: uid('other'), p_role: 'CASHIER', p_enabled: true, p_request_key: randomUUID() }
    denied(await rpc('admin', 'set_account', args))
    for (const actor of ['other', 'student']) denied(await rpc(actor, 'set_account', { ...args, p_user: uid(actor), p_role: 'ADMIN' }))
  })
  await test('approved existing target can become CASHIER and be assigned only to fixed services', async () => {
    await review('other', 'CASHIER')
    await fixture.sql(`insert into auth.mfa_factors values(${q(uid('other'))},'verified');`)
    need((await rpc('admin', 'set_account', { p_user: uid('other'), p_role: 'CASHIER', p_enabled: true, p_request_key: randomUUID() })).status === 200, 'AWS_ROLE_CHANGE')
    for (const [number, code] of ['TP', 'SOA', 'PNEP', 'REF', 'ADJ'].entries()) {
      const args = { p_counter: fixture.counters[number + 1], p_open: true, p_services: [code], p_cashiers: [uid('other')], p_request_key: randomUUID() }
      need((await rpc('admin', 'configure_counter', args)).status === 200, 'AWS_FIXED_ASSIGNMENT')
      const bad = await rpc('admin', 'configure_counter', { ...args, p_services: [code === 'TP' ? 'SOA' : 'TP'], p_request_key: randomUUID() })
      need(bad.body.code === '22023', 'AWS_ROUTE_REASSIGNMENT')
    }
  })
  await test('real fixture issuance, skip, call and serve supply exact report totals and sanitized history', async () => {
    need((await rpc('admin','manage_day',{p_action:'OPEN',p_date:date,p_request_key:randomUUID()})).status===200,'AWS_DAY_OPEN')
    const ticket=await rpc('student','issue_ticket',{p_service:'TP',p_request_key:randomUUID()},'aal1')
    need(ticket.status===200,'AWS_ISSUANCE')
    const call=()=>rpc('other','call_next',{p_counter:fixture.counters[1],p_service:'TP',p_request_key:randomUUID()})
    need((await call()).body.ticket_id===ticket.body.ticket_id,'AWS_CALL')
    need((await rpc('other','finish_ticket',{p_ticket:ticket.body.ticket_id,p_action:'SKIP',p_request_key:randomUUID()})).body.status==='WAITING','AWS_SKIP')
    need((await call()).body.ticket_id===ticket.body.ticket_id,'AWS_RECALL')
    need((await rpc('other','finish_ticket',{p_ticket:ticket.body.ticket_id,p_action:'SERVE',p_request_key:randomUUID()})).body.status==='SERVED','AWS_SERVE')
    const report=await rpc('admin','admin_workspace',{p_date:date})
    need(report.status===200&&report.body.metrics.total===1&&report.body.metrics.served===1&&report.body.metrics.waiting===0&&report.body.history[0].ticket_id===ticket.body.ticket_id&&report.body.usage.find(x=>x.service==='TP').total===1,'AWS_REAL_REPORT')
    need(!JSON.stringify(report.body.history).includes(uid('student')),'AWS_OWNER_EXPOSURE')
  })
  await test('ADMIN cannot edit its own authorization; unapproved legacy ADMIN does not defeat last-usable protection', async () => {
    denied(await rpc('admin', 'set_account', { p_user: uid('admin'), p_role: 'STUDENT', p_enabled: true, p_request_key: randomUUID() }))
    // Isolated negative state: legacy role rows are not usable authorization.
    await fixture.sql(`update queue_private.accounts set role='ADMIN' where id=${q(uid('unassigned'))};`)
    await fixture.sql(`select queue_private.revoke_staff_review(${q(run + '-adminADMIN')});`)
    denied(await rpc('admin', 'admin_workspace', { p_date: date }))
    await review('other', 'ADMIN')
    await fixture.sql(`update queue_private.accounts set role='ADMIN' where id=${q(uid('other'))};`)
    need((await rpc('other', 'set_account', { p_user: uid('admin'), p_role: 'STUDENT', p_enabled: true, p_request_key: randomUUID() })).status===200, 'AWS_LEGACY_DEMOTION')
    // No other approved ADMIN: removal of the last approved target is denied even by a direct wrapper invocation.
    await rejectSql(`perform set_config('request.jwt.claims',${q(JSON.stringify({ sub: uid('other'), aal: 'aal2' }))},true); perform queue_api.set_account(${q(uid('other'))},'STUDENT',true,gen_random_uuid())`)
  })
  await test('reports use real queue history without owner identity; expiration and disabled access deny reads', async () => {
    const r = await rpc('other', 'admin_workspace', { p_date: date })
    need(r.status === 200 && r.body.metrics.total === r.body.history.length && r.body.history.every(x => !('owner_id' in x)), 'AWS_HISTORY_CONTRACT')
    await fixture.sql(`update queue_private.staff_access_approvals set approved_at=clock_timestamp()-interval '1 hour',expires_at=clock_timestamp()-interval '1 second' where account_id=${q(uid('other'))};`)
    denied(await rpc('other', 'admin_workspace', { p_date: date }))
    denied(await rpc('other', 'request_staff_access', { p_email: 'x@example.invalid', p_role: 'ADMIN', p_request_key: randomUUID() }))
  })
  report.result = 'PASS'
} catch (error) { report.result = 'FAIL'; report.failure = /^AWS_[A-Z_]+$/.test(error.message || '') ? error.message : 'AWS_FIXTURE_STOPPED'; if(/^Guarded fixture SQL failed/.test(error.message||''))report.failure_category=error.message; process.exitCode = 1 }
finally {
  try { await fixture.stop(); report.owned_containers_stopped = true } catch { report.result = 'FAIL'; report.shutdown_failed = true; process.exitCode = 1 }
  try {
    if (source) need(fixture.retainedRead(enrollmentPreservation).trim() === source, 'AWS_RETAINED_SOURCE_CHANGED')
    if (services) { const next = await fixture.retained(); need(next.every((x, i) => x.name.includes('vector') ? x.id === services[i].id && x.definition === services[i].definition : JSON.stringify(x) === JSON.stringify(services[i])), 'AWS_RETAINED_SERVICE_CHANGED') }
    if (inventory) { const next = await fixture.inventory(); need(JSON.stringify(next.volumes) === JSON.stringify(inventory.volumes) && JSON.stringify(next.containers) === JSON.stringify([...inventory.containers, ...fixture.owned].sort()) && JSON.stringify(next.networks) === JSON.stringify([...inventory.networks, ...(fixture.networkId ? [fixture.networkId] : [])].sort()), 'AWS_RESOURCE_DELTA') }
    report.retained_preservation = true
  } catch { report.result = 'FAIL'; report.retained_preservation = false; process.exitCode = 1 }
  report.passed = checks.filter(x => x.result === 'PASS').length; report.containers = [...fixture.owned]; report.network = fixture.networkId ? fixture.network : null
  const path = `tests/integration/results/admin_workspace_${run}.json`; writeFileSync(path, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); console.log(JSON.stringify({ result: report.result, passed: report.passed, evidence: path }))
}
