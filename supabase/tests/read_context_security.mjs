/** Real local Auth + Data API tests. Launch with run_local_read_context.py --http.
 * Original rows never updated/deleted; new identities, assignments and days retained.
 */
import {randomUUID, randomBytes, createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const base = process.env.QUEUE_E2E_API, anon = process.env.QUEUE_E2E_ANON_KEY;
const service = process.env.QUEUE_E2E_SERVICE_KEY, psql = process.env.QUEUE_E2E_PSQL;
if (base !== 'http://127.0.0.1:54321' || process.env.PGHOST !== '127.0.0.1' ||
    process.env.PGHOSTADDR !== '127.0.0.1' || process.env.PGPORT !== '54322' || !anon || !service || !psql)
  throw new Error('Verified local launcher required');
const run = randomUUID().slice(0, 8), checks = [], users = {}, privateValues = [], endpoints = new Set();
const report = {run, target: '127.0.0.1:54321 / 127.0.0.1:54322', checks};
let baseline, fixtureDay, failed = false;
class Failure extends Error {}
const assert = (value, message) => { if (!value) throw new Failure(message); };
const q = value => "'" + String(value).replaceAll("'", "''") + "'";
const equal = (a, b, message) => assert(JSON.stringify(a) === JSON.stringify(b), message);
const keys = value => Object.keys(value).sort();
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function sql(statement, readOnly = true) {
  const result = spawnSync(psql, ['-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate'],
    {input: `begin${readOnly ? ' read only' : ''}; ${statement}; commit;`, env: process.env,
      encoding: 'utf8', timeout: 30000});
  assert(!result.error && result.status === 0, 'Local fixture/catalog SQL failed; raw diagnostics suppressed');
  return result.stdout.trim() ? JSON.parse(result.stdout.trim().split('\n').at(-1)) : null;
}
function snapshot() {
  const tables = sql("select jsonb_agg(format('%I.%I',schemaname,tablename) order by schemaname,tablename) " +
    "from pg_tables where schemaname in ('queue_private','queue_display')");
  tables.push('auth.users', 'auth.identities');
  return Object.fromEntries(tables.map(table => [table,
    sql(`select coalesce(jsonb_agg(md5(to_jsonb(t)::text) order by md5(to_jsonb(t)::text)),'[]') from ${table} t`)]));
}
function preserved() {
  const after = snapshot();
  for (const [table, rows] of Object.entries(baseline)) {
    const hashes = new Set(after[table]);
    assert(rows.every(hash => hashes.has(hash)), 'A pre-existing application/display/Auth fixture changed');
  }
  report.existing_fixtures_preserved = true;
}
async function http(path, {who, method = 'POST', body = {}, schema = 'queue_api', privileged = false} = {}) {
  const url = new URL(path, base);
  assert(url.origin === base, 'Non-local HTTP target refused');
  endpoints.add(`${method} ${url.pathname} [${schema}]`);
  const response = await fetch(url, {method, redirect: 'error', signal: AbortSignal.timeout(12000),
    headers: {apikey: privileged ? service : anon,
      Authorization: `Bearer ${privileged ? service : users[who]?.token || anon}`,
      'Accept-Profile': schema, 'Content-Profile': schema, 'Content-Type': 'application/json'},
    body: method === 'GET' ? undefined : JSON.stringify(body)});
  let data;
  try { data = await response.json(); } catch { data = null; }
  return {ok: response.ok, status: response.status, data};
}
const rpc = (who, name, body = {}, schema = 'queue_api') => http(`/rest/v1/rpc/${name}`, {who, body, schema});
const publicContext = who => rpc(who, 'public_queue_context', {}, 'queue_display');
function ok(result) {
  assert(result.ok, `Expected HTTP success, received ${result.status}`);
  return result.data;
}
function denied(result, code) {
  assert(!result.ok && result.data?.code === code, 'Unexpected rejection code or unauthorized success');
}
async function test(name, fn) {
  try { await fn(); checks.push({name, result: 'PASS'}); console.log(`PASS: ${name}`); }
  catch (error) {
    checks.push({name, result: 'FAIL', reason: error instanceof Failure ? error.message : 'Harness failure; raw diagnostics suppressed'});
    throw error;
  }
}
async function subject(name) {
  const email = `queue-context-${run}-${name}@example.invalid`, password = randomBytes(32).toString('base64url');
  const displayName = `PRIVATE-CONTEXT-${run}-${name}`;
  const created = ok(await http('/auth/v1/admin/users', {privileged: true,
    body: {email, password, email_confirm: true, user_metadata: {role: 'ADMIN', display_name: displayName}}}));
  const signed = ok(await http('/auth/v1/token?grant_type=password', {body: {email, password}}));
  assert(created.id && signed.access_token, 'Local Auth fixture creation failed');
  users[name] = {id: created.id, token: signed.access_token};
  privateValues.push(created.id, signed.access_token, email, displayName, password);
}
const expectedDisabled = {role: null, enabled: false, cashier_counters: []};
function ownContext(value, role) {
  equal(keys(value), ['cashier_counters', 'enabled', 'role'], 'Unexpected self-context fields');
  assert(value.role === role && value.enabled === true && Array.isArray(value.cashier_counters), 'Incorrect authoritative account context');
  assert(privateValues.every(valueToHide => !JSON.stringify(value).includes(valueToHide)), 'Self-context contains identity/session data');
}
function publicShape(value) {
  equal(keys(value), ['business_date', 'queue_day_open', 'services', 'timezone'], 'Unexpected public context fields');
  assert(value.timezone === 'Asia/Manila' && /^\d{4}-\d{2}-\d{2}$/.test(value.business_date) &&
    typeof value.queue_day_open === 'boolean' && Array.isArray(value.services), 'Invalid public context types');
  for (const item of value.services) {
    equal(keys(item), ['code', 'name'], 'Unexpected public service field');
    assert(typeof item.code === 'string' && typeof item.name === 'string', 'Invalid public service types');
  }
  assert(privateValues.every(secret => !JSON.stringify(value).includes(secret)), 'Private value leaked in public context');
}
async function setAccount(name, role, enabled = true) {
  ok(await rpc('admin', 'set_account', {p_user: users[name].id, p_role: role, p_enabled: enabled, p_request_key: randomUUID()}));
}
function authoritativePublic() {
  return sql("select queue_private.public_context_at(clock_timestamp())");
}

try {
  baseline = snapshot();
  await test('New migration, RLS, schema and publication preflight', () => {
    const state = sql(`select jsonb_build_object(
      'migrations',(select count(*) from supabase_migrations.schema_migrations),
      'rls',(select count(*) from pg_tables where schemaname in ('queue_private','queue_display') and rowsecurity),
      'private_anon',has_schema_privilege('anon','queue_private','USAGE'),
      'private_auth',has_schema_privilege('authenticated','queue_private','USAGE'),
      'api_anon',has_schema_privilege('anon','queue_api','USAGE'),
      'publication',(select jsonb_agg(schemaname||'.'||tablename order by tablename) from pg_publication_tables where pubname='supabase_realtime'))`);
    assert(state.migrations === 5 && state.rls === 15 && !state.private_anon && !state.private_auth && !state.api_anon,
      'Unexpected security boundary or migration state');
    equal(state.publication, ['queue_display.counter_state', 'queue_display.service_state'], 'Publication changed');
  });
  for (const name of ['student', 'other', 'cashier', 'unassigned', 'admin', 'revoked_cashier', 'revoked_admin', 'disabled'])
    await subject(name);
  sql(`update queue_private.accounts set role='ADMIN' where id in (${q(users.admin.id)},${q(users.revoked_admin.id)});
    update queue_private.accounts set role='CASHIER' where id in (${q(users.cashier.id)},${q(users.unassigned.id)},${q(users.revoked_cashier.id)});
    insert into queue_private.staff_counter_assignments(account_id,counter_id)
      select ${q(users.cashier.id)},id from queue_private.counters where number=5;
    insert into queue_private.staff_counter_assignments(account_id,counter_id)
      select ${q(users.revoked_cashier.id)},id from queue_private.counters where number=4;
    select jsonb_build_object('ready',true)`, false);

  await test('Anonymous self-context denied', async () => denied(await rpc(null, 'my_context'), '42501'));
  await test('STUDENT receives exact own context', async () => {
    const value = ok(await rpc('student', 'my_context')); ownContext(value, 'STUDENT');
    equal(value.cashier_counters, [], 'Student received cashier assignments');
  });
  await test('Other student context contains no owner identifiers or private history', async () => {
    const value = ok(await rpc('other', 'my_context')); ownContext(value, 'STUDENT');
    equal(value, ok(await rpc('student', 'my_context')), 'Equivalent student contexts unexpectedly differ');
  });
  await test('Caller cannot supply another account identifier', async () =>
    denied(await rpc('student', 'my_context', {p_user: users.admin.id}), 'PGRST202'));
  await test('User-editable ADMIN metadata has no authority', async () => {
    const user = ok(await http('/auth/v1/user', {who: 'student', method: 'GET'}));
    assert(user.user_metadata.role === 'ADMIN', 'Fixture metadata canary missing');
    ownContext(ok(await rpc('student', 'my_context')), 'STUDENT');
    denied(await rpc('student', 'admin_configuration'), '42501');
  });
  await test('CASHIER receives only own assigned counter and current enabled service codes', async () => {
    const value = ok(await rpc('cashier', 'my_context')); ownContext(value, 'CASHIER');
    const expected = sql(`select coalesce(jsonb_agg(jsonb_build_object('counter_id',c.id,'counter_number',c.number,
      'counter_label',c.label,'is_open',c.is_open,'service_codes',(select coalesce(jsonb_agg(s.code order by s.code),'[]')
        from queue_private.counter_services cs join queue_private.services s on s.id=cs.service_id
        where cs.counter_id=c.id and s.enabled)) order by c.number),'[]')
      from queue_private.staff_counter_assignments a join queue_private.counters c on c.id=a.counter_id
      where a.account_id=${q(users.cashier.id)}`);
    equal(value.cashier_counters, expected, 'Cashier assignments differ from authoritative state');
    assert(value.cashier_counters.length === 1 && value.cashier_counters[0].counter_number === 5,
      'Foreign counter assignment leaked');
    equal(keys(value.cashier_counters[0]), ['counter_id','counter_label','counter_number','is_open','service_codes'],
      'Unexpected counter fields');
  });
  await test('Unassigned CASHIER receives an empty counter list', async () => {
    const value = ok(await rpc('unassigned', 'my_context')); ownContext(value, 'CASHIER');
    equal(value.cashier_counters, [], 'Unassigned cashier received counters');
  });
  await test('ADMIN receives role without cashier override or account directory', async () => {
    const value = ok(await rpc('admin', 'my_context')); ownContext(value, 'ADMIN');
    equal(value.cashier_counters, [], 'Admin received cashier override');
  });
  await test('Revoked CASHIER existing session immediately sees STUDENT and no counters', async () => {
    ownContext(ok(await rpc('revoked_cashier', 'my_context')), 'CASHIER');
    await setAccount('revoked_cashier', 'STUDENT');
    const value = ok(await rpc('revoked_cashier', 'my_context')); ownContext(value, 'STUDENT');
    equal(value.cashier_counters, [], 'Revoked cashier retained assignments');
    denied(await rpc('revoked_cashier', 'staff_queue'), '42501');
  });
  await test('Revoked ADMIN existing session immediately loses admin access', async () => {
    ownContext(ok(await rpc('revoked_admin', 'my_context')), 'ADMIN');
    await setAccount('revoked_admin', 'STUDENT');
    ownContext(ok(await rpc('revoked_admin', 'my_context')), 'STUDENT');
    denied(await rpc('revoked_admin', 'admin_configuration'), '42501');
  });
  for (const role of ['STUDENT', 'CASHIER', 'ADMIN']) {
    await test(`Disabled ${role} existing session gets masked context and protected reads denied`, async () => {
      await setAccount('disabled', role);
      ownContext(ok(await rpc('disabled', 'my_context')), role);
      await setAccount('disabled', role, false);
      equal(ok(await rpc('disabled', 'my_context')), expectedDisabled, 'Disabled policy mismatch');
      const read = role === 'ADMIN' ? 'admin_configuration' : role === 'CASHIER' ? 'staff_queue' : 'my_tickets';
      denied(await rpc('disabled', read), '42501');
      // Auth still recognizes the unchanged token; app authorization is separate.
      ok(await http('/auth/v1/user', {who: 'disabled', method: 'GET'}));
    });
  }
  await test('Anonymous public context exact catalog, timezone and current closed/missing day', async () => {
    const value = ok(await publicContext()); publicShape(value);
    equal(value, authoritativePublic(), 'Public context differs from current database state');
    report.actual_current_day_state = value.queue_day_open ? 'OPEN' : 'CLOSED_OR_ABSENT';
  });
  await test('All authenticated roles and disabled sessions receive the same sanitized public context', async () => {
    const expected = ok(await publicContext());
    for (const who of ['student','cashier','admin','revoked_cashier','revoked_admin','disabled']) {
      const value = ok(await publicContext(who)); publicShape(value); equal(value, expected, 'Public context depends on account privilege');
    }
  });
  await test('Public RPC rejects caller clock/date overrides', async () => {
    denied(await rpc(null, 'public_queue_context', {p_instant: '2090-01-01T00:00:00Z'}, 'queue_display'), 'PGRST202');
    denied(await rpc('student', 'public_queue_context', {business_date: '2090-01-01'}, 'queue_display'), 'PGRST202');
  });
  await test('Private clock helper and private schema stay inaccessible over REST', async () => {
    for (const who of [null,'student','cashier','admin']) {
      denied(await rpc(who, 'public_context_at', {p_instant: '2090-01-01T00:00:00Z'}, 'queue_display'), 'PGRST202');
      denied(await http('/rest/v1/accounts', {who, method: 'GET', schema: 'queue_private'}), 'PGRST106');
    }
  });
  await test('Public OpenAPI exposes only intended display operations, no private helper or identity fields', async () => {
    const spec = ok(await http('/rest/v1/', {method: 'GET', schema: 'queue_display'}));
    const paths = Object.keys(spec.paths || {});
    assert(paths.includes('/rpc/public_queue_context'), 'Public context absent from schema cache');
    assert(!paths.some(path => /my_context|public_context_at|accounts|student_profiles|admin_audit/.test(path)), 'Private API path exposed');
    assert(!/student_number|display_name|owner_id|encrypted_password|raw_user_meta_data/.test(JSON.stringify(spec)),
      'Sensitive fields advertised in public API schema');
  });
  await test('Read RPCs produce no application, display or Auth row changes', async () => {
    const before = digest(snapshot());
    for (let n = 0; n < 3; n++) {
      ok(await rpc('student', 'my_context')); ok(await rpc('cashier', 'my_context')); ok(await publicContext());
    }
    assert(digest(snapshot()) === before, 'Read contract modified database rows');
  });
  await test('New open fixture day projects open internally but cannot override current HTTP date', async () => {
    const before = ok(await publicContext());
    fixtureDay = sql(`insert into queue_private.queue_days(business_date,timezone_snapshot)
      select d::date,'Asia/Manila' from generate_series(date '2091-01-01',date '2091-12-30',interval '1 day') d
      where not exists(select 1 from queue_private.queue_days q where q.business_date in (d::date,d::date+1))
      order by d limit 1 returning jsonb_build_object('id',id,'date',business_date)`, false);
    assert(fixtureDay?.id, 'No unused fixture day available');
    const projected = sql(`select queue_private.public_context_at((${q(fixtureDay.date)}::date::timestamp+interval '12 hours') at time zone 'Asia/Manila')`);
    publicShape(projected); assert(projected.queue_day_open && projected.business_date === fixtureDay.date, 'Open-day projection incorrect');
    equal(ok(await publicContext()), before, 'Unrelated open future day changed current-day HTTP context');
  });
  await test('Internal projection switches exactly at Manila midnight without reopening existing days', () => {
    const boundary = sql(`select jsonb_build_object(
      'before',queue_private.public_context_at(((${q(fixtureDay.date)}::date+1)::timestamp at time zone 'Asia/Manila')-interval '1 microsecond'),
      'after',queue_private.public_context_at((${q(fixtureDay.date)}::date+1)::timestamp at time zone 'Asia/Manila'))`);
    assert(boundary.before.business_date === fixtureDay.date && boundary.before.queue_day_open, 'Pre-midnight date/open status wrong');
    assert(boundary.after.business_date !== fixtureDay.date && !boundary.after.queue_day_open, 'New absent business day incorrectly open');
  });
  await test('Closing only the new fixture day changes its projection to closed and preserves HTTP current day', async () => {
    const before = ok(await publicContext());
    sql(`update queue_private.queue_days set closed_at=clock_timestamp(),closed_by=${q(users.admin.id)}
      where id=${q(fixtureDay.id)} and closed_at is null; select jsonb_build_object('closed',true)`, false);
    const value = sql(`select queue_private.public_context_at((${q(fixtureDay.date)}::date::timestamp+interval '12 hours') at time zone 'Asia/Manila')`);
    assert(value.queue_day_open === false, 'Closed fixture day still projects open');
    equal(ok(await publicContext()), before, 'Closing future fixture affected current-day HTTP context');
    report.fixture_day_retained_closed = true;
  });
  await test('All pre-existing private, display and Auth fixtures remain unchanged', preserved);
} catch (error) {
  failed = true;
  console.error('STOP: ' + (error instanceof Failure ? error.message : 'Harness failure; raw diagnostics suppressed'));
} finally {
  if (baseline) {
    try { preserved(); }
    catch { failed = true; checks.push({name: 'Postflight preservation', result: 'FAIL', reason: 'Original fixture mismatch'}); }
  }
  report.endpoints = [...endpoints].sort();
  report.counts = {passed: checks.filter(c => c.result === 'PASS').length, failed: checks.filter(c => c.result === 'FAIL').length,
    skipped: 0, completed: !failed};
  const text = JSON.stringify(report, null, 2) + '\n';
  assert(privateValues.every(secret => !text.includes(secret)), 'Sensitive value in result output; refused to write');
  const dir = fileURLToPath(new URL('./results/', import.meta.url)); mkdirSync(dir, {recursive: true});
  writeFileSync(`${dir}/read_context_http_${run}.json`, text);
  console.log('Sanitized HTTP summary: ' + JSON.stringify(report.counts));
  console.log('Retained new fixtures; no existing day or configuration was modified.');
}
process.exitCode = failed ? 1 : 0;
