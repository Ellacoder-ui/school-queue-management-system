import { randomUUID, createHash } from 'node:crypto'
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { QueueFixture, need, digest } from './queueFixture.mjs'
import { createClient } from '@supabase/supabase-js'
import { createQueueApi } from '../../src/services/queueApi.js'
import { createQueueActions } from '../../src/lib/queueActions.js'

const fixture = new QueueFixture(), directory = 'tests/integration/results'
mkdirSync(directory, { recursive: true })
const path = `${directory}/queue_operations_${fixture.run}.json`
const report = { run: fixture.run, result: 'IN_PROGRESS', retained_writes: false, checks: [] }
const save = () => writeFileSync(path, JSON.stringify(report, null, 2) + '\n', { flag: 'w' })
const check = async (name, body) => { try { await body(); report.checks.push({ name, result: 'PASS' }); console.log('PASS: ' + name) }
  catch (error) { report.checks.push({ name, result: 'FAIL' }); throw error } finally { save() } }
const q = value => "'" + value.replaceAll("'", "''") + "'"
const signatures = ['queue_api.my_context()', 'queue_api.my_tickets()', 'queue_api.my_ticket_events(uuid)', 'queue_api.issue_ticket(text,uuid)',
  'queue_api.staff_queue()', 'queue_api.call_next(uuid,text,uuid)', 'queue_api.finish_ticket(uuid,text,uuid)', 'queue_display.public_queue_context()']
const retainedQuery = `select json_build_object('cluster',(select system_identifier::text from pg_control_system()),'database',current_database(),
 'migrations',(select json_agg(version order by version) from supabase_migrations.schema_migrations),
 'rows',(select json_object_agg(name,hash) from (values ${['queue_private.settings','queue_private.accounts','queue_private.student_profiles','queue_private.services','queue_private.counters','queue_private.counter_services','queue_private.staff_counter_assignments','queue_private.queue_days','queue_private.service_day_state','queue_private.tickets','queue_private.ticket_events','queue_private.operation_requests','queue_private.admin_audit_events','queue_display.counter_state','queue_display.service_state','auth.users','auth.identities'].map(name => `('${name}',(select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) from ${name} t))`).join(',')}) x(name,hash)),
 'rpcs',(select json_agg(json_build_object('signature',p.oid::regprocedure::text,'body_md5',md5(p.prosrc),'arguments',pg_get_function_arguments(p.oid),
 'definer',p.prosecdef,'settings',p.proconfig,'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'anon',has_function_privilege('anon',p.oid,'EXECUTE')) order by p.oid::regprocedure::text)
 from pg_proc p where p.oid in (${signatures.map(s => q(s) + '::regprocedure').join(',')})))`
let before, source, inventory
const clients = []
function apiFor(name) {
  const token = fixture.token(name, name === 'anon' ? 'anon' : 'authenticated')
  const transport = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input)
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : {}))
    need(url.origin === 'http://127.0.0.1:54321' && url.pathname.startsWith('/rest/v1/'), 'SDK fixture transport target refused')
    return fixture.request(url.pathname.slice('/rest/v1'.length) + url.search, { method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : {},
      profile: headers.get('Content-Profile') || headers.get('Accept-Profile') || 'queue_display', token: headers.get('Authorization')?.slice(7) })
  }
  const client = createClient('http://127.0.0.1:54321', fixture.token('anon', 'anon'), { accessToken: async () => token,
    global: { fetch: transport }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  // The fixture issues signed test JWTs, not real Auth sessions. Only this adapter
  // supplies the SDK session required to test actor-pinned mutation headers.
  const signed = { schema: (...args) => client.schema(...args), auth: { getSession: async () => ({ data: { session: { access_token: token, user: { id: fixture.users[name] } } }, error: null }) } }
  clients.push(client)
  return createQueueApi(signed, client)
}
let student, other, cashier, admin, unassigned
const intent = (api, op, parameters) => api.createMutationIntent(op, parameters)
const execute = (api, op, parameters) => api.executeMutation(intent(api, op, parameters))
const fail = async (body, reason) => { try { await body() } catch (error) { need(error.outcome === 'rejected' && (!reason || error.reason === reason), 'Unexpected rejection'); return } throw new Error('Expected rejection was accepted') }
try {
  before = await fixture.retained()
  inventory = await fixture.inventory()
  source = JSON.parse(fixture.retainedRead(retainedQuery).trim())
  need(source.cluster === '7696959712798593061' && source.database === 'postgres' && source.migrations.length === 6, 'Retained identity/migrations changed')
  for (const rpc of source.rpcs) {
    const signature = rpc.signature, name = signature.split('(')[0]
    const pattern = new RegExp(`create(?: or replace)? function ${name.replace('.', '\\.')}\\([^]*?as \\$\\$([^]*?)\\$\\$`, 'i')
    let expected
    for (const file of readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort()) {
      const match = readFileSync('supabase/migrations/' + file, 'utf8').replaceAll('\r\n', '\n').match(pattern)
      if (match) expected = createHash('md5').update(match[1]).digest('hex')
    }
    need(expected === rpc.body_md5 && rpc.definer && rpc.authenticated && rpc.anon === signature.startsWith('queue_display.'), 'Live RPC definition/privilege mismatch')
  }
  report.source_contracts = source.rpcs; report.retained_before_sha256 = digest(source)
  await check('actual retained RPC signatures, bodies and execution permissions match migrations', async () => {})
  await fixture.start()
  report.fixture = { containers: [...fixture.owned], network: fixture.network, cluster: fixture.cluster, migrations: fixture.migrations, policy_tests_passed: fixture.policyTests,
    auth_boundary: 'synthetic signed JWTs and minimal Auth identity fixture; no Auth service or Google login' }
  await check('fresh isolated PostgreSQL 17 and real PostgREST; existing SQL/policy suites pass', async () => { need(fixture.policyTests > 50, 'Policy test coverage missing') })
  student = apiFor('student'); other = apiFor('other'); cashier = apiFor('cashier'); admin = apiFor('admin'); unassigned = apiFor('unassigned')
  const rpc = async (name, body, actor = 'student') => { const r = await fixture.request('/rpc/' + name, { body, name: actor }); return { ok: r.ok, status: r.status, data: await r.json() } }
  await check('closed-day, disabled service and anonymous identities are rejected', async () => {
    await fail(() => execute(student, 'issue_ticket', { p_service: 'TP' }), 'day_closed')
    await fixture.sql(`set request.jwt.claim.sub='${fixture.users.admin}'; select queue_api.manage_day('OPEN',(clock_timestamp() at time zone 'Asia/Manila')::date,gen_random_uuid()); select queue_api.configure_service('REF','Refund Process',false,gen_random_uuid());`)
    await fail(() => execute(student, 'issue_ticket', { p_service: 'REF' }), 'service_unavailable')
    for (const actor of ['anon', 'anonymous', 'disabled']) need(!(await rpc('issue_ticket', { p_service: 'TP', p_request_key: randomUUID() }, actor)).ok, 'Unauthorized issuance accepted')
  })
  let first, second, issueIntent
  await check('real SDK issuance returns exact ticket; repeat key replays and changed key parameters reject', async () => {
    issueIntent = intent(student, 'issue_ticket', { p_service: 'TP' }); first = await student.executeMutation(issueIntent)
    need(first.status === 'WAITING' && first.sequence_number === 1, 'Unexpected first ticket')
    need(JSON.stringify(await student.executeMutation(issueIntent)) === JSON.stringify(first), 'Issue receipt changed')
    const changed = await rpc('issue_ticket', { p_service: 'SOA', p_request_key: issueIntent.parameters.p_request_key }); need(!changed.ok && changed.data.code === '22023', 'Key reuse not rejected')
    await fail(() => execute(student, 'issue_ticket', { p_service: 'SOA' }), 'active_ticket')
    second = await execute(other, 'issue_ticket', { p_service: 'TP' })
  })
  await check('caller-only history/events; database roles ignore ADMIN metadata', async () => {
    need((await student.readMyContext()).role === 'STUDENT', 'Metadata elevated role')
    const rows = await student.read('my_tickets'); need(rows.length === 1 && rows[0].id === first.ticket_id, 'Owner history incorrect')
    need((await student.read('my_ticket_events', { p_ticket: first.ticket_id }))[0].event === 'ISSUED', 'Issued event missing')
    await fail(() => other.read('my_ticket_events', { p_ticket: first.ticket_id }), 'unauthorized')
    need(!(await rpc('set_account', { p_user: fixture.users.student, p_role: 'ADMIN', p_enabled: true, p_request_key: randomUUID() })).ok, 'Student promoted self')
    await fail(() => execute(student, 'call_next', { p_counter: fixture.counters['1'], p_service: 'TP' }), 'unauthorized')
    await fail(() => execute(unassigned, 'call_next', { p_counter: fixture.counters['1'], p_service: 'TP' }), 'unauthorized')
    await fail(() => execute(cashier, 'call_next', { p_counter: fixture.counters['2'], p_service: 'SOA' }), 'unauthorized')
    const configuration = await rpc('configure_counter', { p_counter: fixture.counters['2'], p_open: true, p_services: ['SOA'], p_cashiers: [fixture.users.cashier], p_request_key: randomUUID() }, 'cashier')
    need(!configuration.ok && configuration.data.code === '42501', 'Cashier managed an unrelated counter')
  })
  await check('Call Next, busy counter, Skip-to-tail and Serve are real separate operations', async () => {
    const call = await execute(cashier, 'call_next', { p_counter: fixture.counters['1'], p_service: 'TP' }); need(call.ticket_id === first.ticket_id, 'FIFO order incorrect')
    await fail(() => execute(unassigned, 'finish_ticket', { p_ticket: first.ticket_id, p_action: 'SERVE' }), 'unauthorized')
    await fail(() => execute(student, 'finish_ticket', { p_ticket: first.ticket_id, p_action: 'SKIP' }), 'unauthorized')
    await fail(() => execute(cashier, 'call_next', { p_counter: fixture.counters['1'], p_service: 'TP' }), 'counter_busy')
    const skipped = await execute(cashier, 'finish_ticket', { p_ticket: first.ticket_id, p_action: 'SKIP' }); need(skipped.status === 'WAITING', 'Skip did not return waiting')
    const next = await execute(cashier, 'call_next', { p_counter: fixture.counters['1'], p_service: 'TP' }); need(next.ticket_id === second.ticket_id, 'Skip did not move to tail')
    const finish = intent(cashier, 'finish_ticket', { p_ticket: second.ticket_id, p_action: 'SERVE' }); await cashier.executeMutation(finish)
    need((await cashier.executeMutation(finish)).status === 'SERVED', 'Serve replay failed')
    need(!(await cashier.read('staff_queue')).some(row => row.status === 'CALLED'), 'Serve automatically called next')
    await execute(cashier, 'call_next', { p_counter: fixture.counters['1'], p_service: 'TP' }); await execute(cashier, 'finish_ticket', { p_ticket: first.ticket_id, p_action: 'SERVE' })
  })
  await check('second served ticket succeeds; third same-service issuance is rejected', async () => {
    const ticket = await execute(student, 'issue_ticket', { p_service: 'TP' }); await execute(cashier, 'call_next', { p_counter: fixture.counters['1'], p_service: 'TP' })
    await execute(cashier, 'finish_ticket', { p_ticket: ticket.ticket_id, p_action: 'SERVE' })
    await fail(() => execute(student, 'issue_ticket', { p_service: 'TP' }), 'served_quota')
  })
  await check('concurrent same-key calls return one immutable empty receipt', async () => {
    const call = intent(cashier, 'call_next', { p_counter: fixture.counters['1'], p_service: 'TP' })
    const results = await Promise.all([cashier.executeMutation(call), cashier.executeMutation(call)])
    need(results.every(row => row.ticket_id === null), 'Empty queue replay failed')
  })
  await check('concurrent issuance and competing calls serialize without duplicate active/called tickets', async () => {
    const api = apiFor('parallel')
    const results = await Promise.allSettled([execute(api, 'issue_ticket', { p_service: 'TP' }), execute(api, 'issue_ticket', { p_service: 'TP' })])
    need(results.filter(row => row.status === 'fulfilled').length === 1, 'Concurrent issue violated active limit')
    need(results.find(row => row.status === 'rejected')?.reason.reason === 'active_ticket', 'Concurrent issuance failed for an unexpected reason')
    const calls = await Promise.allSettled([execute(cashier, 'call_next', { p_counter: fixture.counters['1'], p_service: 'TP' }), execute(cashier, 'call_next', { p_counter: fixture.counters['1'], p_service: 'TP' })])
    need(calls.filter(row => row.status === 'fulfilled').length === 1, 'Concurrent counter calls were not serialized')
    need(calls.find(row => row.status === 'rejected')?.reason.reason === 'counter_busy', 'Competing call failed for an unexpected reason')
    const current = (await cashier.read('staff_queue')).find(row => row.status === 'CALLED'); await execute(cashier, 'finish_ticket', { p_ticket: current.ticket_id, p_action: 'SERVE' })
  })
  await check('lost successful HTTP outcome is recovered only by explicit same-key reconciliation', async () => {
    const api = apiFor('browser'), store = new Map(); let lost = true, calls = 0, lastKey
    const adapted = { ...api, executeMutation: async (intent, options) => { calls++; if (lastKey) need(lastKey === intent.parameters.p_request_key, 'Retry generated new key'); lastKey = intent.parameters.p_request_key
      const result = await api.executeMutation(intent, options); if (lost) { lost = false; throw new Error('Synthetic response loss after real commit') } return result } }
    const controller = createQueueActions(adapted, { getAccess: () => ({ actor: fixture.users.browser, context: { enabled: true, role: 'STUDENT' } }),
      store: { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) }, withLock: fn => fn() })
    controller.syncAccess(); await controller.perform('issue_ticket', { p_service: 'TP' }); need(controller.getState().phase === 'unknown' && calls === 1, 'Ambiguous write was not retained')
    await controller.perform('issue_ticket', { p_service: 'TP' }); need(calls === 1, 'Automatic second ticket attempted')
    await controller.retry(); need(controller.getState().phase === 'success' && calls === 2 && (await api.read('my_tickets')).length === 1, 'Explicit replay did not recover one ticket')
    controller.stop()
  })
  await check('public projection updates and browser roles cannot access private tables or direct writes', async () => {
    const response = await fixture.request('/service_state?select=service_code,business_date,waiting_count', { method: 'GET', profile: 'queue_display', name: 'anon' })
    const rows = await response.json(); need(response.ok && rows.some(row => row.service_code === 'TP' && row.waiting_count === 1), 'Public aggregate not refreshed')
    need(rows.every(row => Object.keys(row).sort().join(',') === 'business_date,service_code,waiting_count'), 'Private public fields exposed')
    const security = JSON.parse((await fixture.sql(`select json_build_object('private',has_schema_privilege('authenticated','queue_private','USAGE'),'write',has_table_privilege('authenticated','queue_display.counter_state','UPDATE'),'rls',(select count(*) from pg_tables where schemaname in ('queue_private','queue_display') and rowsecurity),'publication',(select count(*) from pg_publication_tables where pubname='supabase_realtime'));`)).trim())
    need(!security.private && !security.write && security.rls === 15 && security.publication === 2, 'Security boundary changed')
  })
  report.result = 'PASS'
} catch (error) { report.result = 'FAIL'; report.failure = error.message; console.error(error.message); process.exitCode = 1 }
finally {
  report.owned_resources = { containers: [...fixture.owned], network: fixture.networkId ? fixture.network : null, stage: fixture.stage }
  if (report.result === 'FAIL' && !report.checks.some(row => row.result === 'FAIL')) report.checks.push({ name: 'Fixture setup gate', result: 'FAIL' })
  try { await fixture.stop(); report.owned_containers_stopped = true } catch { report.result = 'FAIL'; report.cleanup = 'Owned fixture shutdown failed'; process.exitCode = 1 }
  if (source) { try { need(digest(JSON.parse(fixture.retainedRead(retainedQuery).trim())) === digest(source), 'Retained data/catalog changed'); report.retained_rows_and_contracts_unchanged = true } catch { report.result = 'FAIL'; report.preservation = 'Retained read-only fingerprint mismatch'; process.exitCode = 1 } }
  if (before) { try { const after = await fixture.retained(); need(after.length === before.length && after.every((row, i) => row.name.includes('vector') ? row.definition === before[i].definition && row.id === before[i].id : JSON.stringify(row) === JSON.stringify(before[i])), 'Retained service changed'); report.retained_services_unchanged = true } catch { report.result = 'FAIL'; report.preservation = 'Retained service mismatch'; process.exitCode = 1 } }
  if (inventory) { try { const after = await fixture.inventory(); need(JSON.stringify(after.volumes) === JSON.stringify(inventory.volumes)
    && JSON.stringify(after.containers) === JSON.stringify([...inventory.containers, ...fixture.owned].sort())
    && JSON.stringify(after.networks) === JSON.stringify([...inventory.networks, ...(fixture.networkId ? [fixture.networkId] : [])].sort()), 'Unexpected Docker inventory delta'); report.docker_inventory_exact = true } catch { report.result = 'FAIL'; report.preservation = 'Unexpected Docker resource'; process.exitCode = 1 } }
  report.passed = report.checks.filter(row => row.result === 'PASS').length; report.failed = report.checks.filter(row => row.result === 'FAIL').length
  save(); console.log(JSON.stringify({ result: report.result, passed: report.passed, failed: report.failed, evidence: path }))
}
