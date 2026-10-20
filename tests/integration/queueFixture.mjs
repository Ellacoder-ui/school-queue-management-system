// Disposable-only Engine adapter. No retained mutation, pull, remove or prune path.
import http from 'node:http'
import { spawnSync } from 'node:child_process'
import { randomBytes, randomUUID, createHash, createHmac } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fixtureSubnet } from '../../scripts/authOnlyEngine.mjs'

export const pgImage = 'sha256:6058a6759ab9268cff8ee70641d61f1bd75953316281b76427cf5a6b4db2eafc'
export const restImage = 'sha256:d155c6718ed9a9f990d159a2ab7c0a3f16944dbb6d0a0344557421042acfe0df'
const label = 'school-queue.phase3.fixture'
export const need = (value, message) => { if (!value) throw new Error(message) }
export const digest = value => createHash('sha256').update(Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const root = process.cwd()
export function availableFixtureRun() {
  need(process.platform==='win32'&&root.toLowerCase()==='c:\\users\\hp\\school-queue-management-system','Wrong fixture workspace')
  const list=spawnSync('docker',['network','ls','-q'],{encoding:'utf8',windowsHide:true});need(list.status===0,'Fixture network inventory unavailable')
  const ids=list.stdout.trim().split(/\s+/);need(ids.every(x=>/^[0-9a-f]{12,64}$/.test(x)),'Invalid network inventory')
  const result=spawnSync('docker',['network','inspect',...ids],{encoding:'utf8',windowsHide:true});need(result.status===0,'Fixture network inspection unavailable')
  const networks=JSON.parse(result.stdout),tail=randomUUID().replaceAll('-','').slice(0,6)
  for(let prefix=255;prefix>=0;prefix--){const run=prefix.toString(16).padStart(2,'0')+tail;try{fixtureSubnet(run,networks);return run}catch(error){if(error.message!=='AGO_FIXTURE_SUBNET_CONFLICT')throw error}}
  throw Error('No available fixture subnet')
}
export const preservationQuery = `select json_build_object('cluster',(select system_identifier::text from pg_control_system()),
 'rows',(select json_object_agg(name,hash) from (values ${['queue_private.settings','queue_private.accounts','queue_private.student_profiles','queue_private.services','queue_private.counters','queue_private.counter_services','queue_private.staff_counter_assignments','queue_private.queue_days','queue_private.service_day_state','queue_private.tickets','queue_private.ticket_events','queue_private.operation_requests','queue_private.admin_audit_events','queue_display.counter_state','queue_display.service_state','auth.users','auth.identities'].map(name => `('${name}',(select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) from ${name} t))`).join(',')}) x(name,hash)),
 'functions',(select md5(string_agg(pg_get_functiondef(p.oid),'' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('queue_api','queue_private','queue_display')))`
export class QueueFixture {
  constructor(run = randomUUID().slice(0, 8)) {
    need(/^[0-9a-f]{8}$/.test(run), 'Invalid fixture identity')
    need(process.platform === 'win32' && root.toLowerCase() === 'c:\\users\\hp\\school-queue-management-system', 'Wrong workspace/platform')
    need(!['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'].some(k => process.env[k]), 'Docker overrides refused')
    this.run = run; this.prefix = `sq-queue-${run}-`; this.network = this.prefix + 'net'; this.owned = new Set()
    this.password = randomBytes(24).toString('hex'); this.secret = randomBytes(32).toString('hex')
    this.users = Object.fromEntries(['student', 'other', 'cashier', 'unassigned', 'admin', 'disabled', 'anonymous', 'browser', 'parallel'].map(name => [name, randomUUID()]))
  }
  async #engine(method, path, body) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? null : Buffer.from(JSON.stringify(body))
      const request = http.request({ socketPath: '//./pipe/dockerDesktopLinuxEngine', path: '/v1.56' + path, method, timeout: 20000,
        headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {} }, response => {
        const chunks = []; let size = 0
        response.on('data', chunk => { size += chunk.length; if (size > 4 * 1024 * 1024) request.destroy(); else chunks.push(chunk) })
        response.on('end', () => { if (response.statusCode < 200 || response.statusCode >= 300) return reject(new Error('Fixture Engine request failed'))
          try { resolve(Buffer.concat(chunks).length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null) } catch { reject(new Error('Fixture Engine response invalid')) } })
      })
      request.on('timeout', () => request.destroy()); request.on('error', () => reject(new Error('Fixture Engine transport failed'))); request.end(data)
    })
  }
  async retained() {
    const items = await this.#engine('GET', '/containers/json?all=1')
    const retained = items.filter(item => item.Labels?.['com.supabase.cli.project'] === 'school-queue-local' || item.Names.some(n => /^\/supabase_.*_school-queue-local$/.test(n)))
    const parked = new Map([
      ['9f7742bf04e680d82988376411720e3500c9c0c069b0e57de5b7f3dc3ebb4ef6', '/supabase_auth_school-queue-local-e17c030c-activation-original'],
      ['565adceacab15cd43c7e00d5cee19345bc34f6ab981b35d5dc2ba4f8cdd4f399', '/supabase_auth_school-queue-local-9169970e-activation-mfa-original'],
    ])
    need(retained.length === 14 && [...parked].every(([id,name])=>retained.some(x=>x.Id===id&&x.Names.includes(name))) && retained.filter(x=>x.Names.some(n=>/^\/supabase_.*_school-queue-local$/.test(n))).length===12, 'Unexpected retained project inventory')
    const result = []
    for (const item of retained) {
      const x = await this.#engine('GET', `/containers/${item.Id}/json`)
      if(parked.has(x.Id)) need(x.Name===parked.get(x.Id)&&!x.State.Running&&Object.keys(x.NetworkSettings.Networks).length===0,'Auth rollback original changed')
      if(x.Name==='/supabase_auth_school-queue-local') need(x.Id==='5c57bce94c516ec320f259e94ebaf2d348598b6c26e7e2d979c719a8381992ae'&&x.Image==='sha256:1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b'&&x.State.Running,'Activated MFA Auth identity changed')
      result.push({ name: x.Name, id: x.Id, definition: digest([x.Config, x.HostConfig, x.Mounts, x.NetworkSettings.Networks]),
        image: x.Image, started: x.State.StartedAt, restarts: x.RestartCount, running: x.State.Running })
      if (x.Name === '/supabase_db_school-queue-local') {
        need(x.Image === pgImage && x.Mounts.some(m => m.Type === 'volume' && m.Name === 'supabase_db_school-queue-local'), 'Wrong retained DB identity')
        need(!x.Config.Env.some(e => /^PGHOST=/.test(e) && !['PGHOST=/var/run/postgresql', 'PGHOST=/tmp'].includes(e)), 'Unexpected retained libpq host')
        this.retainedDb = x.Id
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name))
  }
  async inventory() {
    const [containers, networks, volumes] = await Promise.all([this.#engine('GET', '/containers/json?all=1'), this.#engine('GET', '/networks'), this.#engine('GET', '/volumes')])
    return { containers: containers.map(x => x.Id).sort(), networks: networks.map(x => x.Id).sort(), volumes: (volumes.Volumes || []).map(x => x.Name).sort() }
  }
  retainedRead(query) {
    need(/^[0-9a-f]{64}$/.test(this.retainedDb), 'Retained read target not verified')
    return this.#psql(this.retainedDb, `begin transaction isolation level repeatable read read only; set local statement_timeout='15s'; ${query}; commit;`, false)
  }
  #psql(id, sql, owned) {
    if (owned) need(this.owned.has(id) && id === this.db, 'SQL target is not owned')
    const args = ['exec', '-i', '--user', 'postgres', id, 'psql', '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres']
    if (owned) args.push('-h', '/tmp')
    const result = spawnSync('docker', args, { input: sql, encoding: 'utf8', timeout: 40000, windowsHide: true })
    if (result.error || result.status !== 0) {
      const category = /column .* does not exist/.test(result.stderr || '') ? 'missing-column' : /function .* does not exist/.test(result.stderr || '') ? 'missing-function'
        : /relation .* does not exist/.test(result.stderr || '') ? 'missing-relation' : /extension .* is not available/.test(result.stderr || '') ? 'extension-unavailable'
        : /Confirmed non-anonymous/.test(result.stderr || '') ? 'fixture-confirmation' : 'sql-error'
      throw new Error(`Guarded ${owned ? 'fixture' : 'retained read-only'} SQL failed at ${this.stage || 'inspection'}: ${category}; raw diagnostics suppressed`)
    }
    return result.stdout
  }
  async inspect(id) {
    need(this.owned.has(id), 'Unowned container refused')
    const x = await this.#engine('GET', `/containers/${id}/json`)
    need(x.Id === id && x.Name.startsWith('/' + this.prefix) && x.Config.Labels[label] === this.run, 'Fixture container identity mismatch')
    need([pgImage, restImage].includes(x.Image) && !x.HostConfig.Privileged && x.HostConfig.ReadonlyRootfs, 'Fixture image/privilege mismatch')
    need(x.Mounts.every(m => m.Type === 'tmpfs' && m.Destination === '/tmp'), 'Fixture retained mount refused')
    need(Object.keys(x.NetworkSettings.Networks).every(n => n === this.network), 'Unexpected fixture network')
    const network = await this.#engine('GET', `/networks/${this.networkId}`)
    need(network.Id === this.networkId && network.Name === this.network && !network.Internal && network.IPAM.Config?.length===1 && network.IPAM.Config[0].Subnet===this.subnet && network.Labels?.[label] === this.run
      && Object.keys(network.Containers || {}).every(id => this.owned.has(id)), 'Unexpected fixture network member')
    for (const rows of Object.values(x.NetworkSettings.Ports || {})) for (const binding of rows || []) need(binding.HostIp === '127.0.0.1' && !['54321', '54322'].includes(binding.HostPort), 'Unsafe fixture binding')
    return x
  }
  async create(kind, body) {
    need(['db', 'rest'].includes(kind) && body.Image === (kind === 'db' ? pgImage : restImage), 'Unknown fixture resource')
    need(body.HostConfig.NetworkMode === this.network && !body.HostConfig.Binds?.length && !body.HostConfig.Mounts?.length && !body.Volumes, 'Unsafe fixture definition')
    need(body.HostConfig.CapDrop?.includes('ALL') && body.HostConfig.ReadonlyRootfs && body.HostConfig.SecurityOpt?.includes('no-new-privileges'), 'Fixture hardening missing')
    need(!body.HostConfig.Privileged && !body.HostConfig.PublishAllPorts && !body.HostConfig.VolumesFrom?.length, 'Fixture privileges refused')
    need(kind === 'db' ? !Object.keys(body.HostConfig.PortBindings || {}).length
      : JSON.stringify(body.HostConfig.PortBindings) === JSON.stringify({ '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: '' }] }), 'Fixture port definition refused')
    body.Labels = { [label]: this.run }
    const x = await this.#engine('POST', '/containers/create?name=' + this.prefix + kind, body)
    need(/^[0-9a-f]{64}$/.test(x.Id), 'Invalid created identity'); this.owned.add(x.Id)
    if (kind === 'db') this.db = x.Id; else this.rest = x.Id
    await this.inspect(x.Id)
    await this.#engine('POST', `/containers/${x.Id}/start`)
    return x.Id
  }
  async sql(query) { await this.inspect(this.db); return this.#psql(this.db, query, true) }
  token(name, role = 'authenticated', aal = 'aal1') {
    need(['aal1','aal2'].includes(aal),'Unknown fixture assurance level')
    const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url')
    const body = `${encoded({ alg: 'HS256', typ: 'JWT' })}.${encoded({ role, aal, sub: this.users[name], aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
      user_metadata: { role: 'ADMIN' }, email: 'fixture@example.invalid' })}`
    return body + '.' + createHmac('sha256', this.secret).update(body).digest('base64url')
  }
  async request(path, { method = 'POST', body = {}, name = 'student', profile = 'queue_api', token, timeout = 15000 } = {}) {
    const x = await this.inspect(this.rest)
    const bindings = x.NetworkSettings.Ports['3000/tcp']
    need(bindings?.length === 1 && bindings[0].HostIp === '127.0.0.1', 'Fixture API binding missing')
    const target = `http://127.0.0.1:${bindings[0].HostPort}`
    need(/^\/(rpc\/[a-z_]+|counter_state(?:\?[^#]*)?|service_state(?:\?[^#]*)?)$/.test(path), 'Fixture endpoint refused')
    return fetch(target + path, { method, redirect: 'error', signal: AbortSignal.timeout(timeout), headers: { 'Content-Type': 'application/json',
      'Content-Profile': profile, 'Accept-Profile': profile, Authorization: `Bearer ${token || this.token(name, name === 'anon' ? 'anon' : 'authenticated')}` },
      ...(method === 'GET' || method === 'HEAD' ? {} : { body: JSON.stringify(body) }) })
  }
  async start() {
    for (const image of [pgImage, restImage]) {
      const x = await this.#engine('GET', `/images/${image}/json`)
      need(x.Id === image && !Object.keys(x.Config.Volumes || {}).length, 'Cached fixture image missing or anonymous volumes')
    }
    const before = await this.#engine('GET', '/containers/json?all=1')
    need(!before.some(x => x.Names.some(n => n.startsWith('/' + this.prefix))), 'Fixture name already exists')
    const networks = await this.#engine('GET', '/networks'); need(!networks.some(x => x.Name === this.network), 'Fixture network exists')
    this.subnet=fixtureSubnet(this.run,networks)
    const network = await this.#engine('POST', '/networks/create', { Name: this.network, Driver: 'bridge', Internal: false,
      IPAM:{Driver:'default',Config:[{Subnet:this.subnet}]},
      Options: { 'com.docker.network.bridge.host_binding_ipv4': '127.0.0.1' }, Labels: { [label]: this.run } })
    this.networkId = network.Id
    const host = () => ({ NetworkMode: this.network, ReadonlyRootfs: true, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'],
      Memory: 536870912, NanoCpus: 1000000000, PidsLimit: 128, RestartPolicy: { Name: 'no' }, Tmpfs: { '/tmp': 'rw,nosuid,size=268435456' } })
    await this.create('db', { Image: pgImage, User: 'postgres', Entrypoint: ['/bin/sh'], Env: ['FIXTURE_PASSWORD=' + this.password],
      Cmd: ['-ec', 'test ! -e /tmp/queue-db/PG_VERSION; printf \'%s\' "$FIXTURE_PASSWORD" > /tmp/pw; initdb -D /tmp/queue-db -U postgres --auth-local=trust --auth-host=scram-sha-256 --pwfile=/tmp/pw --no-locale --encoding=UTF8 >/tmp/init.log 2>&1; printf \'%s\\n\' \'host all all samenet scram-sha-256\' >> /tmp/queue-db/pg_hba.conf; exec postgres -D /tmp/queue-db -h 0.0.0.0 -k /tmp -c wal_level=logical'],
      HostConfig: host(), NetworkingConfig: { EndpointsConfig: { [this.network]: { Aliases: ['db'] } } } })
    let ready = false
    for (let i = 0; i < 40; i++) { try { const r = await this.sql('select 1;'); if (r.trim() === '1') { ready = true; break } } catch {} await delay(300) }
    need(ready, 'Fixture database did not become ready')
    this.stage = 'platform-bootstrap'
    await this.sql(`create role anon nologin; create role authenticated nologin; create role service_role nologin; create role authenticator login noinherit password '${this.password}'; grant anon,authenticated to authenticator;
      create schema auth; create schema extensions; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,is_anonymous boolean default false,raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''), (nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'sub'))::uuid $$;
      grant usage on schema auth,extensions to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
      create publication supabase_realtime;`)
    const files = readdirSync('supabase/migrations').filter(x => /^20261016000[1-6]00_.*\.sql$/.test(x)).sort()
    need(files.length === 6, 'Exactly six reviewed application migrations required')
    this.migrations = files.map(file => ({ file, sha256: digest(readFileSync('supabase/migrations/' + file)) }))
    for (const file of files) { this.stage = file; await this.sql(readFileSync('supabase/migrations/' + file, 'utf8').replaceAll('\r\n', '\n')) }
    this.policyTests = 0
    for (const file of ['queue_test.sql', 'read_context_test.sql', 'fixed_routing_test.sql']) {
      this.stage = file
      const tap = await this.sql(readFileSync('supabase/tests/database/' + file, 'utf8'))
      need(!/^not ok/m.test(tap) && /^1\.\.\d+/m.test(tap), 'Existing isolated queue/policy tests failed')
      this.policyTests += (tap.match(/^ok\b/gm) || []).length
    }
    this.stage = 'synthetic-fixture-seed'
    // These are new synthetic identities, never retained accounts.
    await this.sql(`insert into auth.users(id,email,email_confirmed_at,is_anonymous) values ${Object.entries(this.users).map(([name, id]) => `('${id}','${name}@example.invalid',clock_timestamp(),${name === 'anonymous'})`).join(',')};
      select queue_private.bootstrap_admin('${this.users.admin}'); update queue_private.accounts set role='CASHIER' where id in ('${this.users.cashier}','${this.users.unassigned}'); update queue_private.accounts set enabled=false where id='${this.users.disabled}';
      set request.jwt.claim.sub='${this.users.admin}'; select queue_api.configure_counter((select id from queue_private.counters where number=1),true,array['TP'],array['${this.users.cashier}']::uuid[],gen_random_uuid());`)
    const h = host(); h.PortBindings = { '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: '' }] }
    await this.create('rest', { Image: restImage, ExposedPorts: { '3000/tcp': {} }, Env: [`PGRST_DB_URI=postgres://authenticator:${this.password}@db:5432/postgres`, 'PGRST_DB_SCHEMAS=queue_display,queue_api',
      'PGRST_DB_ANON_ROLE=anon', 'PGRST_SERVER_PORT=3000', 'PGRST_SERVER_HOST=0.0.0.0', 'PGRST_JWT_SECRET=' + this.secret], HostConfig: h,
      NetworkingConfig: { EndpointsConfig: { [this.network]: { Aliases: ['rest'] } } } })
    ready = false
    let last = 'no-response'
    for (let i = 0; i < 10; i++) { try { const r = await this.request('/rpc/public_queue_context', { profile: 'queue_display', name: 'anon', timeout: 2000 }); if (r.ok) { ready = true; break }
      const body = await r.json(); last = `${r.status}:${/^[A-Z0-9]{5,8}$/.test(body.code) ? body.code : 'unclassified'}`
    } catch (error) { last = error.message === 'Fixture API binding missing' ? 'missing-port-binding' : 'transport-unavailable' } await delay(300) }
    need(ready, 'Fixture PostgREST readiness failed: ' + last)
    this.counters = JSON.parse((await this.sql('select json_object_agg(number,id) from queue_private.counters;')).trim())
    this.cluster = (await this.sql('select system_identifier::text from pg_control_system();')).trim()
    need(this.cluster !== '7696959712798593061', 'Fixture is retained cluster')
  }
  async stop() {
    for (const id of [...this.owned].reverse()) { const x = await this.inspect(id); if (x.State.Running) await this.#engine('POST', `/containers/${id}/stop?t=10`) }
    for (const id of this.owned) need(!(await this.inspect(id)).State.Running, 'Fixture container still running')
  }
}
