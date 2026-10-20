// Fixed private HTTP bridge to a new internal Auth fixture, never retained Auth.
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { AuthOnlyEngine, nodeImage } from '../../scripts/authOnlyEngine.mjs'
import { authImage, pgImage, label, need } from '../../scripts/authOnlyCore.mjs'
import { mfaAuthTag } from '../../scripts/authMfaPlan.mjs'
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const program = `const http=require('http');const x=JSON.parse(process.env.AMF_REQUEST);
if(!/^(GET|POST|DELETE)$/.test(x.method)||!/^\\/(health|settings|signup|token|user|logout|factors)(?:[/?]|$)/.test(x.path)||x.path.includes('..'))process.exit(2);
const body=x.body==null?null:Buffer.from(x.body);const r=http.request({host:'auth',port:9999,path:x.path,method:x.method,headers:x.headers,timeout:10000},s=>{let n=0,c=[];s.on('data',b=>{n+=b.length;if(n>524288)r.destroy();else c.push(b)});s.on('end',()=>process.stdout.write(JSON.stringify({status:s.statusCode,version:s.headers['x-supabase-api-version']||null,body:Buffer.concat(c).toString('base64')})))});r.on('error',()=>process.exit(3));r.on('timeout',()=>r.destroy());r.end(body);`
export class AuthMfaFixture {
  constructor(run) { this.engine = new AuthOnlyEngine(run); this.jwt = randomBytes(32).toString('hex'); this.password = randomBytes(24).toString('hex') }
  base(image, alias) { const e = this.engine; return { Image: image, Labels: { [label]: e.id }, HostConfig: { NetworkMode: e.names.network,
    ReadonlyRootfs: true, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'], Memory: 536870912, NanoCpus: 1000000000, PidsLimit: 128,
    RestartPolicy: { Name: 'no', MaximumRetryCount: 0 }, Tmpfs: { '/tmp': 'rw,nosuid,size=268435456' } },
    NetworkingConfig: { EndpointsConfig: { [e.names.network]: { Aliases: [alias] } } } } }
  authBody(fail = false) { return { ...this.base(mfaAuthTag, 'auth'), Cmd: ['auth'], Env: [
    'GOTRUE_API_HOST=0.0.0.0', 'GOTRUE_API_PORT=9999', 'API_EXTERNAL_URL=http://127.0.0.1:54321/auth/v1', 'GOTRUE_DB_DRIVER=postgres', 'GOTRUE_DB_NAMESPACE=auth',
    `GOTRUE_DB_DATABASE_URL=postgres://postgres:${this.password}@db:5432/postgres?sslmode=disable&search_path=auth`,
    'GOTRUE_SITE_URL=http://127.0.0.1:5173', 'GOTRUE_URI_ALLOW_LIST=http://127.0.0.1:5173/auth/callback', 'GOTRUE_DISABLE_SIGNUP=false',
    'GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED=false', 'GOTRUE_SECURITY_MANUAL_LINKING_ENABLED=false', 'GOTRUE_EXTERNAL_EMAIL_ENABLED=true', 'GOTRUE_MAILER_AUTOCONFIRM=true',
    'GOTRUE_JWT_SECRET=' + this.jwt, 'GOTRUE_JWT_EXP=3600', 'GOTRUE_JWT_AUD=authenticated', 'GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated', 'GOTRUE_JWT_ADMIN_ROLES=service_role',
    'GOTRUE_EXTERNAL_GOOGLE_ENABLED=true', 'GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID=123456-mfa-fixture.apps.googleusercontent.com', 'GOTRUE_EXTERNAL_GOOGLE_SECRET=' + randomBytes(32).toString('hex'),
    'GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI=http://127.0.0.1:54321/auth/v1/callback', 'GOTRUE_EXTERNAL_GOOGLE_SKIP_NONCE_CHECK=false', 'GOTRUE_EXTERNAL_GOOGLE_EMAIL_OPTIONAL=false',
    'GOTRUE_MFA_TOTP_ENROLL_ENABLED=false', 'GOTRUE_MFA_TOTP_VERIFY_ENABLED=false', 'GOTRUE_MFA_MAX_ENROLLED_FACTORS=10'],
    ...(fail ? { Entrypoint: ['/bin/sh'], Cmd: ['-ec', 'if [ "$GOTRUE_MFA_TOTP_ENROLL_ENABLED" = true ]; then exit 42; fi; exec auth'] } : {}),
    Healthcheck: { Test: ['CMD-SHELL', 'wget --no-verbose --tries=1 --spider http://127.0.0.1:9999/health'], Interval: 1000000000, Timeout: 2000000000, Retries: 3 } } }
  async start() {
    const e = this.engine
    for (const image of [authImage, pgImage, nodeImage]) await e.image(image)
    await e.infrastructure()
    const pg = { ...this.base(pgImage, 'db'), User: 'postgres', Entrypoint: ['/bin/sh'], Env: ['FIXTURE_DB_PASSWORD=' + this.password], Cmd: ['-ec',
      `test ! -e /tmp/auth-db/PG_VERSION; printf '%s' "$FIXTURE_DB_PASSWORD" > /tmp/pw; initdb -D /tmp/auth-db -U postgres --auth-local=trust --auth-host=scram-sha-256 --pwfile=/tmp/pw --no-locale --encoding=UTF8 >/tmp/init.log 2>&1; printf '%s\\n' 'host postgres postgres samenet scram-sha-256' >> /tmp/auth-db/pg_hba.conf; exec postgres -D /tmp/auth-db -h 0.0.0.0 -k /tmp`] }
    this.db = await e.create(e.names.db, pg); await e.action(this.db, 'start')
    let ready = false
    for (let i = 0; i < 40; i++) { if (await e.probe(this.db, 'db-ready')) { ready = true; break } await delay(500) }
    need(ready, 'AMF_DB_READY'); await e.probe(this.db, 'db-bootstrap')
    this.witness = await e.create(e.names.prefix + 'mfa-probe', { ...this.base(nodeImage, 'probe'), Entrypoint: ['node'], Cmd: ['-e', 'setInterval(()=>{},10000)'] })
    await e.action(this.witness, 'start')
    this.original = await e.create(e.names.auth, this.authBody()); await e.action(this.original, 'start'); await this.health(this.original)
  }
  async health(id) {
    for (let i = 0; i < 45; i++) {
      const x = await this.engine.inspect(id); need(x.State.Running && x.RestartCount === 0, 'AMF_AUTH_STOPPED')
      if (x.State.Health?.Status === 'healthy') { const result = await this.engine.probe(this.witness, 'auth-http'); need(result.health === 200 && result.settings === 200 && result.google === true, 'AMF_HTTP'); return result }
      await delay(1000)
    }
    throw Error('AMF_HEALTH_TIMEOUT')
  }
  async #request(method, path, body, raw = false) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? null : Buffer.from(JSON.stringify(body))
      const r = http.request({ socketPath: '//./pipe/dockerDesktopLinuxEngine', path: '/v1.56' + path, method, timeout: 20000, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {} }, s => {
        const chunks = []; let size = 0
        s.on('data', b => { size += b.length; if (size > 1048576) r.destroy(); else chunks.push(b) })
        s.on('end', () => { if (s.statusCode < 200 || s.statusCode >= 300) { reject(Error('AMF_PRIVATE_IPC_STATUS')); return }
          try { resolve(raw ? Buffer.concat(chunks) : JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { reject(Error('AMF_PRIVATE_IPC_JSON')) } })
      }); r.on('error', () => reject(Error('AMF_PRIVATE_IPC'))); r.on('timeout', () => r.destroy()); r.end(data)
    })
  }
  async fetch(input, options = {}) {
    const url = new URL(input instanceof Request ? input.url : input)
    const path = url.pathname.replace(/^\/auth\/v1(?=\/)/, '') // SDK gateway prefix -> direct Auth fixture
    need(url.origin === 'http://auth:9999' && /^\/(health|settings|signup|token|user|logout|factors)(?:[/?]|$)/.test(path) && !path.includes('..'), 'AMF_HTTP_SCOPE')
    const item = await this.engine.inspect(this.witness); need(item.Image === nodeImage && item.State.Running, 'AMF_PROBE_ID')
    await this.engine.verifyNetwork()
    const payload = { method: options.method || 'GET', path: path + url.search, headers: Object.fromEntries(new Headers(options.headers)), body: options.body || null }
    need(['GET', 'POST', 'DELETE'].includes(payload.method) && (typeof payload.body === 'string' || payload.body === null), 'AMF_HTTP_BODY')
    const created = await this.#request('POST', `/containers/${this.witness}/exec`, { AttachStdout: true, AttachStderr: true,
      Env: ['AMF_REQUEST=' + JSON.stringify(payload)], Cmd: ['node', '-e', program] })
    const raw = await this.#request('POST', `/exec/${created.Id}/start`, { Detach: false, Tty: false }, true)
    const execution = await this.#request('GET', `/exec/${created.Id}/json`)
    need(execution.ContainerID === this.witness && !execution.Running && execution.ExitCode === 0, 'AMF_PRIVATE_EXECUTION')
    // Only captured stdout is decoded. No request, code, factor or token is emitted.
    let at = 0; const chunks = []
    while (at < raw.length) { need(at + 8 <= raw.length, 'AMF_IPC_FRAME'); const size = raw.readUInt32BE(at + 4); need(at + 8 + size <= raw.length, 'AMF_IPC_FRAME'); if (raw[at] === 1) chunks.push(raw.subarray(at + 8, at + 8 + size)); at += 8 + size }
    let value; try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw Error('AMF_IPC_RESPONSE') }
    return new Response(Buffer.from(value.body, 'base64').length ? Buffer.from(value.body, 'base64') : null, { status: value.status, headers: { 'Content-Type': 'application/json', ...(value.version ? { 'X-Supabase-Api-Version': value.version } : {}) } })
  }
  client() { return createClient('http://auth:9999', 'synthetic-public-fixture-key', { global: { fetch: this.fetch.bind(this) }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) }
  async stop() { for (const id of [...this.engine.containers].reverse()) await this.engine.action(id, 'stop') }
}
