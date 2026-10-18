/** Local-only E2E authorization/privacy suite. Run through run_local_api_security.py.
 * Real Auth sessions + HTTP REST/RPC + WebSockets. Never loads .env files.
 * Existing rows are fingerprinted and preserved. New fixtures are retained.
 */
import { createClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { localTestTarget } from './local_test_target.mjs';

const base = process.env.QUEUE_E2E_API;
const anonKey = process.env.QUEUE_E2E_ANON_KEY;
const serviceKey = process.env.QUEUE_E2E_SERVICE_KEY;
const psql = process.env.QUEUE_E2E_PSQL;
const target = localTestTarget();
if (!anonKey || !serviceKey || !psql) {
  throw new Error('Run the local-only Python launcher; expected endpoint configuration missing.');
}
const resume = process.env.QUEUE_E2E_RESUME_RUN;
if (resume && !/^[0-9a-f]{8}$/.test(resume)) throw new Error('Invalid resume fixture identifier');
const run = resume || randomUUID().slice(0, 8);
const checks = [];
const realtime = [];
const clients = [];
const subjects = {};
const forbiddenValues = [];
const paths = new Set();
let baseline;
let day;
let counter;
let tickets;
let preserved = false;
let failed = false;
let setupStage = 'initial inspection';
let exclusion = { users: [], day: null, counter: null };
const summary = { run, target: `${target.api} / 127.0.0.1:${target.dbPort}`, checks, realtime,
  limitations: ['Current business day is closed; successful issue_ticket is not exercised.',
    'Negative Realtime observations are bounded; private publication/grants are also inspected.',
    'Public sanitized feeds remain public after account disable/revocation by design.'] };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
class ValidationFailure extends Error {}
function check(value, message) { if (!value) throw new ValidationFailure(message); }

function db(statement, readOnly = false) {
  const result = spawnSync(psql, ['-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate'], {
    input: `begin${readOnly ? ' read only' : ''}; ${statement}; commit;`,
    env: process.env, encoding: 'utf8', timeout: 30000,
  });
  check(!result.error && result.status === 0, 'Local fixture/catalog SQL failed; raw diagnostics suppressed');
  return result.stdout.trim() ? JSON.parse(result.stdout.trim().split('\n').at(-1)) : null;
}

function snapshot() {
  const tables = ['accounts', 'student_profiles', 'tickets', 'ticket_events', 'queue_days',
    'service_day_state', 'staff_counter_assignments', 'counter_services', 'operation_requests', 'admin_audit_events', 'services'];
  const users = exclusion.users.length ? exclusion.users.map(literal).join(',') : 'null';
  const filters = exclusion.users.length ? {
    accounts: `id not in (${users})`, student_profiles: `account_id not in (${users})`,
    tickets: `owner_id not in (${users})`,
    ticket_events: `(actor_id is null or actor_id not in (${users}))`,
    queue_days: `id<>${literal(exclusion.day)}`, service_day_state: `queue_day_id<>${literal(exclusion.day)}`,
    staff_counter_assignments: `account_id not in (${users})`, counter_services: `counter_id<>${literal(exclusion.counter)}`,
    operation_requests: `actor_id not in (${users})`, admin_audit_events: `(actor_id is null or actor_id not in (${users}))`,
  } : {};
  const pairs = tables.map(table => `${literal(table)},(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from queue_private.${table} t${filters[table] ? ' where '+filters[table] : ''})`);
  pairs.push(`'counters',(select coalesce(jsonb_agg(to_jsonb(t) order by number),'[]'::jsonb) from queue_private.counters t where number in (1,2))`);
  return db(`select jsonb_build_object(${pairs.join(',')})`, true);
}
const rowHash = row => createHash('sha256').update(JSON.stringify(row)).digest('hex');
function unchanged() {
  const current = snapshot();
  for (const [table, rows] of Object.entries(baseline)) {
    const hashes = new Set(current[table].map(rowHash));
    check(rows.every(row => hashes.has(rowHash(row))), 'A pre-existing fixture row changed');
  }
  preserved = true;
}

async function http(path, { token, schema, method = 'GET', body, key = anonKey, openapi = false } = {}) {
  const url = new URL(path, base);
  check(url.origin === base, 'Non-local HTTP request refused');
  paths.add(`${method} ${url.pathname}`);
  const headers = { apikey: key, Authorization: `Bearer ${token || anonKey}` };
  if (schema) {
    headers['Accept-Profile'] = schema;
    if (method !== 'GET' && method !== 'HEAD') headers['Content-Profile'] = schema;
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (openapi) headers.Accept = 'application/openapi+json';
  const response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error', signal: AbortSignal.timeout(10000) });
  let data;
  try { data = await response.json(); } catch { data = null; }
  return { ok: response.ok, status: response.status, data };
}
const rpc = (who, name, body = {}) => http(`/rest/v1/rpc/${name}`, {
  token: subjects[who]?.token, schema: 'queue_api', method: 'POST', body,
});
const key = () => randomUUID();
function denied(result, codes = ['42501']) {
  check(!result.ok && codes.includes(result.data?.code), 'Operation was not denied with the expected authorization/schema error');
}
function allowed(result) {
  const rawCode = result.data?.code || result.data?.error_code || result.data?.error;
  const code = typeof rawCode==='string' && /^[A-Za-z0-9_]+$/.test(rawCode) ? rawCode : 'unspecified';
  check(result.ok, `Authorized HTTP operation failed (status ${result.status}; code ${code})`);
  return result.data;
}
function sanitized(table, record) {
  const allowedKeys = table === 'counter_state'
    ? ['counter_id', 'counter_label', 'is_open', 'ticket_label', 'service_code', 'business_date', 'updated_at']
    : ['service_code', 'business_date', 'waiting_count', 'updated_at'];
  check(Object.keys(record).every(field => allowedKeys.includes(field)), 'Unexpected public payload field');
  const encoded = JSON.stringify(record);
  check(forbiddenValues.every(value => !encoded.includes(value)), 'Sensitive canary value appeared in public data');
}
async function test(name, body) {
  try {
    await body();
    checks.push({ name, result: 'PASS' });
    console.log(`PASS: ${name}`);
  } catch (error) {
    checks.push({ name, result: 'FAIL', reason: error instanceof ValidationFailure ? error.message : 'Test harness exception; raw diagnostics suppressed' });
    failed = true;
    throw error;
  }
}

async function createSubject(name, role) {
  if (resume) {
    setupStage=`resume ${name}: lookup`;
    const account=db(`select jsonb_build_object('id',u.id,'email',u.email,'role',a.role,'enabled',a.enabled)
      from auth.users u join queue_private.accounts a on a.id=u.id
      where lower(u.email)=lower(${literal(`queue-e2e-${run}-${name}@example.invalid`)})`,true);
    check(account?.id && account.role===role && account.enabled,'Incomplete run is not at a safely resumable fixture stage');
    setupStage=`resume ${name}: generate local login link`;
    const link=allowed(await http('/auth/v1/admin/generate_link',{method:'POST',key:serviceKey,token:serviceKey,
      body:{type:'magiclink',email:account.email}}));
    const tokenHash=link.hashed_token || link.properties?.hashed_token;
    check(tokenHash,'Local one-time session token unavailable');
    setupStage=`resume ${name}: verify local login link`;
    const signed=allowed(await http('/auth/v1/verify',{method:'POST',body:{type:'magiclink',token_hash:tokenHash}}));
    check(signed.access_token,'Local session resumption failed');
    subjects[name]={id:account.id,token:signed.access_token,role};
    forbiddenValues.push(account.id,account.email,`PRIVATE-${run}-${name}`,signed.access_token);
    return;
  }
  const password = randomBytes(32).toString('base64url');
  const email = `queue-e2e-${run}-${name}@example.invalid`;
  const created = allowed(await http('/auth/v1/admin/users', { method: 'POST', key: serviceKey, token: serviceKey,
    body: { email, password, email_confirm: true, user_metadata: { role: 'ADMIN', display_name: `PRIVATE-${run}-${name}` } } }));
  const signed = allowed(await http('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } }));
  check(created.id && signed.access_token, 'Local Auth session setup failed');
  subjects[name] = { id: created.id, token: signed.access_token, role };
  forbiddenValues.push(created.id, email, `PRIVATE-${run}-${name}`, signed.access_token);
}

async function subscribe(who, schema, table) {
  const token = subjects[who]?.token;
  const client = createClient(base, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { logger: () => {}, timeout: 5000 }, ...(token ? { accessToken: async () => token } : {}) });
  clients.push(client);
  await client.realtime.setAuth(token || anonKey);
  const events = [];
  const systems = [];
  const channel = client.channel(`e2e-${run}-${who}-${schema}-${table}`)
    .on('system', {}, payload => systems.push(payload))
    .on('postgres_changes', { event: '*', schema, table }, payload => events.push(payload));
  let status;
  await new Promise(resolve => {
    const timeout = setTimeout(() => { status = 'NO_ACK'; resolve(); }, 7000);
    channel.subscribe(value => {
      if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT'].includes(value)) {
        status = value;
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  if (schema==='queue_display' && status==='SUBSCRIBED') {
    const deadline=Date.now()+15000;
    while (Date.now()<deadline && !systems.some(p=>p.extension==='postgres_changes' && ['ok','error'].includes(p.status))) await delay(100);
  } else if (schema==='queue_private') {
    await delay(500);
  }
  const ready=systems.some(p=>p.extension==='postgres_changes' && p.status==='ok');
  const observation={ who, schema, table, status, postgres_ready:ready,
    system_statuses:systems.map(p=>({extension:p.extension,status:p.status})) };
  realtime.push(observation);
  const entry = { who, schema, table, status, events, channel, ready, observation };
  return entry;
}
async function eventAfter(subscription, start, predicate) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const event = subscription.events.slice(start).find(predicate);
    if (event) return event;
    await delay(100);
  }
  throw new ValidationFailure('Expected public Realtime update was not delivered within 10 seconds');
}

try {
  if (resume) {
    const context=db(`select jsonb_build_object('users',(select jsonb_agg(id) from auth.users where email like ${literal(`queue-e2e-${run}-%@example.invalid`)}),
      'day',(select jsonb_build_object('id',d.id,'date',d.business_date) from queue_private.queue_days d
        where d.id in (select t.queue_day_id from queue_private.tickets t join auth.users u on u.id=t.owner_id where u.email like ${literal(`queue-e2e-${run}-%@example.invalid`)}) and d.closed_at is null),
      'counter',(select jsonb_build_object('assigned',x.counter_id,'other',(select id from queue_private.counters where number=3))
        from queue_private.staff_counter_assignments x join auth.users u on u.id=x.account_id where u.email=${literal(`queue-e2e-${run}-cashier@example.invalid`)}))`,true);
    check(context?.users?.length===7 && context.day && context.counter,'Incomplete local fixtures not found');
    exclusion={users:context.users,day:context.day.id,counter:context.counter.assigned};
    day=context.day; counter=context.counter;
  }
  baseline = snapshot();
  await test('Catalog: RLS, grants and publication exclude private data', async () => {
    const catalog = db(`select jsonb_build_object(
      'private_published',exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='queue_private'),
      'private_usage',has_schema_privilege('authenticated','queue_private','USAGE') or has_schema_privilege('anon','queue_private','USAGE'),
      'rls_count',(select count(*) from pg_tables where schemaname in ('queue_private','queue_display') and rowsecurity),
      'active',(select count(*) from queue_private.tickets where status in ('WAITING','CALLED')))`, true);
    check(!catalog.private_published && !catalog.private_usage && catalog.rls_count === 15, 'Unsafe catalog configuration');
    check(catalog.active === (resume ? 2 : 0), 'Existing active operational work found; isolated setup refused');
  });
  for (const [name, role] of [['studentA','STUDENT'],['studentB','STUDENT'],['disabled','STUDENT'],
    ['cashier','CASHIER'],['revokedCashier','CASHIER'],['admin','ADMIN'],['revokedAdmin','ADMIN']]) {
    await createSubject(name, role);
  }
  const assignment = Object.values(subjects).map(s => `update queue_private.accounts set role=${literal(s.role)} where id=${literal(s.id)};`).join('\n');
  if (!resume) counter = db(`select jsonb_build_object('assigned',
    (select id from queue_private.counters c where number=4 and not is_open and not exists(select 1 from queue_private.staff_counter_assignments x where x.counter_id=c.id)),
    'other',(select id from queue_private.counters where number=3))`, true);
  check(counter.assigned && counter.other, 'Spare counters unavailable; existing assignments preserved');
  if (!resume) day = db(`${assignment}
    insert into queue_private.queue_days(business_date,timezone_snapshot)
    select greatest(coalesce(max(business_date),(clock_timestamp() at time zone 'Asia/Manila')::date),
      (clock_timestamp() at time zone 'Asia/Manila')::date)+1,'Asia/Manila' from queue_private.queue_days
    returning jsonb_build_object('id',id,'date',business_date)`);
  summary.fixture_business_date = day.date;
  await test('Administrator spare-counter configuration is authorized and busy-safe', async () => {
    const result=await rpc('admin','configure_counter',{p_counter:counter.assigned,p_open:true,p_services:['REF'],p_cashiers:[subjects.cashier.id],p_request_key:key()});
    if (resume && !result.ok) {
      check(result.data?.code==='P0001' && result.data.message==='Resolve called ticket before reconfiguration','Unexpected administrator configuration rejection');
      const config=allowed(await rpc('admin','admin_configuration'));
      check(config.staff_assignments.some(x=>x.account_id===subjects.cashier.id && x.counter_id===counter.assigned),'Isolated assignment missing');
    } else allowed(result);
  });
  if (resume) {
    tickets=db(`select jsonb_object_agg(owner_id,id) from queue_private.tickets where queue_day_id=${literal(day.id)} and status in ('WAITING','CALLED')`,true);
    check(tickets && Object.keys(tickets).length===2,'Resume requires the original two active fixture tickets');
  } else tickets = db(`select 1 from queue_private.settings where id for update;
    insert into queue_private.service_day_state(queue_day_id,service_id,last_number)
      select ${literal(day.id)},id,2 from queue_private.services where code='REF';
    update queue_private.settings set last_wait_position=last_wait_position+2 where id;
    insert into queue_private.student_profiles(account_id,student_number,display_name,verified_at) values
      (${literal(subjects.studentA.id)},${literal(`PRIVATE-STUDENT-${run}-A`)},${literal(`PRIVATE-${run}-studentA`)},clock_timestamp()),
      (${literal(subjects.studentB.id)},${literal(`PRIVATE-STUDENT-${run}-B`)},${literal(`PRIVATE-${run}-studentB`)},clock_timestamp());
    insert into queue_private.tickets(owner_id,queue_day_id,service_id,sequence_number,wait_position)
      select ${literal(subjects.studentA.id)},${literal(day.id)},s.id,1,st.last_wait_position-1
      from queue_private.services s cross join queue_private.settings st where s.code='REF';
    insert into queue_private.tickets(owner_id,queue_day_id,service_id,sequence_number,wait_position)
      select ${literal(subjects.studentB.id)},${literal(day.id)},s.id,2,st.last_wait_position
      from queue_private.services s cross join queue_private.settings st where s.code='REF';
    insert into queue_private.ticket_events(ticket_id,actor_id,event_type,to_status)
      select id,owner_id,'ISSUED','WAITING' from queue_private.tickets where queue_day_id=${literal(day.id)};
    select queue_private.refresh_display();
    select jsonb_object_agg(owner_id,id) from queue_private.tickets where queue_day_id=${literal(day.id)}`);
  forbiddenValues.push(`PRIVATE-STUDENT-${run}-A`, `PRIVATE-STUDENT-${run}-B`);
  const ticketA = tickets[subjects.studentA.id], ticketB = tickets[subjects.studentB.id];
  const adminBodies = {
    admin_configuration: {}, set_account: {p_user:subjects.studentA.id,p_role:'ADMIN',p_enabled:true,p_request_key:key()},
    configure_counter: {p_counter:counter.other,p_open:false,p_services:['PNEP'],p_cashiers:[],p_request_key:key()},
    configure_service: {p_code:'REF',p_name:'Refund Process',p_enabled:true,p_request_key:key()},
    manage_day: {p_action:'CLOSE',p_date:day.date,p_request_key:key()},
  };
  await test('Anonymous RPCs cannot read private information or mutate queues', async () => {
    const bodies = {...adminBodies,my_tickets:{},my_ticket_events:{p_ticket:ticketA},staff_queue:{},
      issue_ticket:{p_service:'REF',p_request_key:key()},call_next:{p_counter:counter.assigned,p_service:'REF',p_request_key:key()},
      finish_ticket:{p_ticket:ticketA,p_action:'SERVE',p_request_key:key()}};
    for (const [name,body] of Object.entries(bodies)) denied(await rpc('anonymous',name,body));
  });
  await test('Students receive only their own tickets and permitted history', async () => {
    for (const who of ['studentA','studentB']) {
      const own = allowed(await rpc(who,'my_tickets'));
      check(own.length === 1 && own[0].id === tickets[subjects[who].id], 'Cross-owner ticket data returned');
      const events = allowed(await rpc(who,'my_ticket_events',{p_ticket:own[0].id}));
      check(events.length >= 1 && events[0].event === 'ISSUED', 'Owner event retrieval failed');
      check(!JSON.stringify(events).includes('actor_id'), 'Private actor identifiers exposed');
    }
  });
  await test('Cross-student and foreign staff ticket history is denied', async () => {
    denied(await rpc('studentA','my_ticket_events',{p_ticket:ticketB}));
    denied(await rpc('cashier','my_ticket_events',{p_ticket:ticketA}));
    denied(await rpc('admin','my_ticket_events',{p_ticket:ticketA}));
  });
  await test('Student promotion and every administrator RPC are denied', async () => {
    for (const [name,body] of Object.entries(adminBodies)) denied(await rpc('studentA',name,body));
    denied(await rpc('studentA','set_account',{...adminBodies.set_account,p_role:'CASHIER',p_request_key:key()}));
    denied(await rpc('studentA','staff_queue'));
    denied(await rpc('studentA','call_next',{p_counter:counter.assigned,p_service:'REF',p_request_key:key()}));
    denied(await rpc('studentA','finish_ticket',{p_ticket:ticketA,p_action:'SERVE',p_request_key:key()}));
  });
  await test('User-editable role metadata does not elevate the student session', async () => {
    allowed(await http('/auth/v1/user',{token:subjects.studentA.token,method:'PUT',body:{data:{role:'ADMIN'}}}));
    denied(await rpc('studentA','admin_configuration'));
    check(db(`select to_jsonb(role='STUDENT') from queue_private.accounts where id=${literal(subjects.studentA.id)}`,true) === true,'Metadata changed authoritative role');
  });
  await test('Cashiers cannot invoke administrator operations', async () => {
    for (const [name,body] of Object.entries(adminBodies)) denied(await rpc('cashier',name,body));
  });
  await test('Cashiers cannot call an unassigned counter', async () => {
    denied(await rpc('cashier','call_next',{p_counter:counter.other,p_service:'REF',p_request_key:key()}));
    denied(await rpc('revokedCashier','call_next',{p_counter:counter.assigned,p_service:'REF',p_request_key:key()}));
  });
  await test('Administrator has explicit configuration reads but no cashier or student issuance authority', async () => {
    const config = allowed(await rpc('admin','admin_configuration'));
    check(config.accounts.some(a => a.id === subjects.admin.id && a.role === 'ADMIN'),'Administrator read unavailable');
    allowed(await rpc('admin','staff_queue'));
    denied(await rpc('admin','call_next',{p_counter:counter.assigned,p_service:'REF',p_request_key:key()}));
    denied(await rpc('admin','issue_ticket',{p_service:'REF',p_request_key:key()}));
  });
  await test('Closed current day blocks issuance without reopening preserved fixtures', async () => {
    const result = await rpc('disabled','issue_ticket',{p_service:'REF',p_request_key:key()});
    check(!result.ok && result.data?.code === 'P0001' && result.data.message === 'Current queue day is not open','Unexpected closed-day result');
  });
  await test('Private schema GET/POST/PATCH and public-schema fallbacks cannot bypass RPCs', async () => {
    for (const who of ['anonymous','studentA','cashier','admin']) {
      for (const method of ['GET','POST','PATCH']) {
        denied(await http('/rest/v1/accounts',{token:subjects[who]?.token,schema:'queue_private',method,
          ...(method==='GET'?{}:{body:{role:'ADMIN'}})}),['PGRST106']);
      }
      denied(await http('/rest/v1/tickets',{token:subjects[who]?.token,schema:'public'}),['PGRST205']);
      denied(await http('/rest/v1/rpc/bootstrap_admin',{token:subjects[who]?.token,schema:'queue_api',method:'POST',body:{p_user:subjects.studentA.id}}),['PGRST202']);
    }
  });
  await test('Public display writes are forbidden to every application role', async () => {
    for (const who of ['anonymous','studentA','cashier','admin']) {
      denied(await http(`/rest/v1/counter_state?counter_id=eq.${counter.assigned}`,{token:subjects[who]?.token,schema:'queue_display',method:'PATCH',body:{ticket_label:'FORGED'}}));
    }
  });
  await test('Exposed API schema contains functions and no private tables or profile fields', async () => {
    const schema = allowed(await http('/rest/v1/',{token:subjects.studentA.token,schema:'queue_api',openapi:true}));
    const serialized = JSON.stringify(schema);
    check(!Object.keys(schema.paths).some(path => ['accounts','tickets','student_profiles'].some(name => path===`/${name}`)),'Private table exposed');
    check(!serialized.includes('student_number') && !serialized.includes('display_name'),'Private profile fields exposed in API schema');
    denied(await http('/rest/v1/',{token:subjects.admin.token,schema:'queue_private',openapi:true}),['PGRST106']);
  });
  await test('Anonymous public REST endpoints contain only sanitized fields', async () => {
    for (const table of ['counter_state','service_state']) {
      const rows = allowed(await http(`/rest/v1/${table}?select=*`,{schema:'queue_display'}));
      check(rows.length>0,'Sanitized endpoint returned no testable records');
      rows.forEach(row=>sanitized(table,row));
    }
  });

  let publicCounter, publicService, disabledPublic;
  const privateSubs=[];
  await test('Public Realtime counter and service subscriptions are acknowledged', async () => {
    publicCounter=await subscribe('anonymous','queue_display','counter_state');
    publicService=await subscribe('anonymous','queue_display','service_state');
    disabledPublic=await subscribe('disabled','queue_display','counter_state');
    check([publicCounter,publicService,disabledPublic].every(s=>s.status==='SUBSCRIBED' && s.ready),'Public database-change listener not ready');
  });
  await test('Private Realtime subscription attempts cannot establish a data path', async () => {
    for (const who of ['anonymous','studentA','cashier','admin','disabled','revokedCashier','revokedAdmin']) {
      privateSubs.push(await subscribe(who,'queue_private','tickets'));
    }
    check(privateSubs.every(s=>!s.ready && (s.status==='CHANNEL_ERROR' ||
      (s.status==='SUBSCRIBED' && s.observation.system_statuses.some(p=>p.extension==='postgres_changes' && p.status==='error')))),
      'Private database listener was accepted or its denial was inconclusive');
  });
  await test('Assigned cashier call updates public ticket number and counter safely', async () => {
    const start=publicCounter.events.length;
    const serviceStart=publicService.events.length;
    const state=db(`select jsonb_build_object('status',status,'counter',counter_id) from queue_private.tickets where id=${literal(ticketA)}`,true);
    if (resume && state.status==='CALLED') {
      check(state.counter===counter.assigned,'Unexpected existing isolated counter');
      summary.realtime_replayed_existing_call=true;
      // Re-emit the state of the already successful HTTP call without reverting it.
      db('select queue_private.refresh_display()');
    } else {
      const result=allowed(await rpc('cashier','call_next',{p_counter:counter.assigned,p_service:'REF',p_request_key:key()}));
      check(result.ticket_id===ticketA,'Wrong isolated ticket called');
    }
    const event=await eventAfter(publicCounter,start,e=>e.new.counter_id===counter.assigned && e.new.ticket_label==='REF-001');
    sanitized('counter_state',event.new);
    check(event.new.service_code==='REF' && event.new.business_date===day.date,'Incorrect public counter data');
    await eventAfter(publicService,serviceStart,e=>e.new.service_code==='REF' && e.new.business_date===day.date && e.new.waiting_count===1);
  });
  await test('Unassigned cashier cannot finish another counter ticket', async () => {
    denied(await rpc('revokedCashier','finish_ticket',{p_ticket:ticketA,p_action:'SERVE',p_request_key:key()}));
  });
  await test('Cashier skip and service updates preserve public payload privacy', async () => {
    let start=publicCounter.events.length;
    allowed(await rpc('cashier','finish_ticket',{p_ticket:ticketA,p_action:'SKIP',p_request_key:key()}));
    await eventAfter(publicCounter,start,e=>e.new.counter_id===counter.assigned && e.new.ticket_label===null);
    start=publicCounter.events.length;
    check(allowed(await rpc('cashier','call_next',{p_counter:counter.assigned,p_service:'REF',p_request_key:key()})).ticket_id===ticketB,'Skip did not move ticket to tail');
    await eventAfter(publicCounter,start,e=>e.new.counter_id===counter.assigned && e.new.ticket_label==='REF-002');
    start=publicCounter.events.length;
    allowed(await rpc('cashier','finish_ticket',{p_ticket:ticketB,p_action:'SERVE',p_request_key:key()}));
    await eventAfter(publicCounter,start,e=>e.new.counter_id===counter.assigned && e.new.ticket_label===null);
  });
  await test('Cashier revocation takes effect with its unchanged Auth session', async () => {
    allowed(await rpc('revokedCashier','staff_queue'));
    allowed(await rpc('admin','set_account',{p_user:subjects.revokedCashier.id,p_role:'STUDENT',p_enabled:true,p_request_key:key()}));
    denied(await rpc('revokedCashier','staff_queue'));
    denied(await rpc('revokedCashier','call_next',{p_counter:counter.assigned,p_service:'REF',p_request_key:key()}));
    allowed(await http('/auth/v1/user',{token:subjects.revokedCashier.token}));
  });
  await test('Administrator revocation takes effect with its unchanged Auth session', async () => {
    allowed(await rpc('revokedAdmin','admin_configuration'));
    allowed(await rpc('admin','set_account',{p_user:subjects.revokedAdmin.id,p_role:'STUDENT',p_enabled:true,p_request_key:key()}));
    denied(await rpc('revokedAdmin','admin_configuration'));
    denied(await rpc('revokedAdmin','configure_counter',adminBodies.configure_counter));
    allowed(await http('/auth/v1/user',{token:subjects.revokedAdmin.token}));
  });
  await test('Disabled account loses protected access while its Auth token remains valid', async () => {
    allowed(await rpc('disabled','my_tickets'));
    allowed(await rpc('admin','set_account',{p_user:subjects.disabled.id,p_role:'STUDENT',p_enabled:false,p_request_key:key()}));
    denied(await rpc('disabled','my_tickets'));
    denied(await rpc('disabled','issue_ticket',{p_service:'REF',p_request_key:key()}));
    denied(await rpc('disabled','my_ticket_events',{p_ticket:ticketA}));
    allowed(await http('/auth/v1/user',{token:subjects.disabled.token}));
  });
  await test('Preexisting revoked/disabled subscriptions reveal no private mutations', async () => {
    const start=disabledPublic.events.length;
    allowed(await rpc('cashier','call_next',{p_counter:counter.assigned,p_service:'REF',p_request_key:key()}));
    await eventAfter(disabledPublic,start,e=>e.new.counter_id===counter.assigned && e.new.ticket_label==='REF-001');
    // Explicit private canaries owned by the disabled and revoked accounts; grants/publication unchanged.
    db(`update queue_private.accounts set updated_at=clock_timestamp() where id in
      (${literal(subjects.disabled.id)},${literal(subjects.revokedCashier.id)},${literal(subjects.revokedAdmin.id)});
      update queue_private.tickets set updated_at=clock_timestamp() where queue_day_id=${literal(day.id)}`);
    await delay(3000);
    check(privateSubs.every(s=>s.events.length===0),'Private Realtime data leaked');
  });
  await test('All captured public payloads exclude student identifiers and private values', async () => {
    for (const sub of [publicCounter,publicService,disabledPublic]) {
      check(sub.events.length>0,'Realtime privacy check lacked positive control events');
      for (const event of sub.events) {
        if (Object.keys(event.new??{}).length) sanitized(sub.table,event.new);
        if (Object.keys(event.old??{}).length) sanitized(sub.table,event.old);
        check(forbiddenValues.every(value=>!JSON.stringify(event).includes(value)),'Sensitive value in Realtime envelope');
      }
    }
  });
  await test('Administrator closes only the isolated day and restores spare counter availability', async () => {
    allowed(await rpc('admin','manage_day',{p_action:'CLOSE',p_date:day.date,p_request_key:key()}));
    allowed(await rpc('admin','configure_counter',{p_counter:counter.assigned,p_open:false,p_services:['REF'],p_cashiers:[],p_request_key:key()}));
    check(db(`select count(*) from queue_private.tickets where queue_day_id=${literal(day.id)} and status in ('WAITING','CALLED')`,true)===0,'Isolated tickets left active');
  });
  await test('Original concurrency fixture rows remain byte-for-byte unchanged',async()=>unchanged());
} catch (error) {
  failed=true;
  if (!checks.some(c=>c.result==='FAIL')) checks.push({name:'Fixture or test infrastructure setup',result:'FAIL',
    reason:setupStage+': '+(error instanceof ValidationFailure?error.message:'Harness exception; raw diagnostics suppressed')});
  console.log('STOP: affected validation stopped; inspect the sanitized result report.');
} finally {
  await Promise.allSettled(clients.map(client=>client.removeAllChannels()));
  if (baseline && !preserved) {
    try { unchanged(); } catch { checks.push({name:'Original fixture preservation',result:'FAIL',reason:'Preservation check failed'}); failed=true; }
  }
  summary.passed=checks.filter(c=>c.result==='PASS').length;
  summary.failed=checks.filter(c=>c.result==='FAIL').length;
  summary.existing_fixture_rows_preserved=preserved;
  summary.endpoints=[...paths].sort();
  summary.new_fixture_records_retained=true;
  const directory=new URL('./results/',import.meta.url);
  mkdirSync(directory,{recursive:true});
  const resultPath=new URL(`api_realtime_${run}${resume?'_resume_'+Date.now():''}.json`,directory);
  writeFileSync(resultPath,JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
  console.log(`Summary: ${summary.passed} passed; ${summary.failed} failed.`);
  console.log(`Sanitized results: ${fileURLToPath(resultPath)}`);
  process.exitCode=failed?1:0;
}
