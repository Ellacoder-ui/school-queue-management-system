/** Disposable-only Unix socket experiment. No retained configuration is loaded.
 * Probe mode has no server and sends exactly two fixed GETs to the real daemon.
 * Fixture mode has no daemon mount or network and cannot forward any request.
 */
import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const fakeId = 'a'.repeat(64);
export const fakeName = 'disposable-synthetic-vector-source';
const socketPath = '/experiment/docker.sock';
export function classify(method, target) {
  if (method !== 'GET' || target.length > 8192 || !target.startsWith('/') || target.startsWith('//') || /[#\\\s]/.test(target)) return 'denied';
  const url = new URL(target, 'http://fixture.invalid');
  if (url.pathname.includes('%')) return 'denied';
  const path = url.pathname.replace(/^\/v1\.\d+\//, '/');
  if (path === '/_ping' || path === '/version') return url.search ? 'denied' : path.slice(1);
  const knownQuery = allowed => {
    const keys = [...url.searchParams.keys()];
    return new Set(keys).size === keys.length && keys.every(k => allowed.includes(k));
  };
  if (path === '/containers/json') return knownQuery(['all', 'limit', 'size', 'filters']) ? 'list' : 'denied';
  if (path === '/events') return knownQuery(['since', 'until', 'filters']) ? 'events' : 'denied';
  if (path === `/containers/${fakeId}/json`) return knownQuery(['size']) ? 'inspect' : 'denied';
  if (path === `/containers/${fakeId}/logs`) return knownQuery(['stdout', 'stderr', 'follow', 'timestamps', 'since', 'until', 'tail', 'details']) ? 'logs' : 'denied';
  return 'denied';
}

async function realGet(path) {
  if (!['/_ping', '/version'].includes(path)) throw Error('FIXED_PROBE_ONLY');
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    const request = http.request({ socketPath: '/var/run/docker.sock', path, method: 'GET', timeout: 5000 }, response => {
      if (response.statusCode !== 200) { response.resume(); reject(Error('PROBE_STATUS')); return; }
      response.on('data', chunk => { size += chunk.length; if (size > 32768) request.destroy(Error('PROBE_BOUND')); else chunks.push(chunk); });
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    request.on('timeout', () => request.destroy(Error('PROBE_TIMEOUT')));
    request.on('error', reject); request.end();
  });
}

async function probe() {
  const s = fs.statSync('/var/run/docker.sock');
  if (!s.isSocket()) throw Error('NOT_SOCKET');
  if ((await realGet('/_ping')).trim() !== 'OK') throw Error('PING');
  const version = JSON.parse(await realGet('/version'));
  for (const field of ['Version', 'ApiVersion', 'MinAPIVersion']) {
    if (!/^\d+\.\d+(?:\.\d+)?$/.test(version[field])) throw Error('VERSION_FORMAT');
  }
  process.stdout.write(JSON.stringify({ result: 'PASS', socket: true, uid: process.getuid(),
    mode: (s.mode & 0o777).toString(8), socket_uid: s.uid, socket_gid: s.gid,
    requests: ['GET /_ping', 'GET /version'],
    engine: version.Version, api: version.ApiVersion, minimum_api: version.MinAPIVersion }) + '\n');
}

function fixture() {
  const counts = { ping: 0, version: 0, list: 0, inspect: 0, events: 0, logs: 0, denied: 0, synthetic_frames: 0 };
  const deniedShapes = [];
  const versions = new Set();
  let unversionedRequests = 0;
  const summary = () => process.stdout.write(JSON.stringify({ fixture_summary: true, counts,
    client_versions: [...versions].sort(), unversioned_requests: unversionedRequests, denied_shapes: deniedShapes }) + '\n');
  const version = { Version: '29.8.2', ApiVersion: '1.56', MinAPIVersion: '1.40', Os: 'linux', Arch: 'amd64' };
  const server = http.createServer((request, response) => {
    const kind = classify(request.method, request.url); counts[kind]++;
    const api = /^\/v(1\.\d+)\//.exec(request.url)?.[1];
    if (api) versions.add(api);
    else if (kind !== 'denied') unversionedRequests++;
    const json = body => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
    if (kind === 'denied') {
      if (deniedShapes.length < 10) deniedShapes.push({ method_get: request.method === 'GET',
        absolute_form: /^https?:\/\//.test(request.url), encoded_query: request.url.split('?')[1]?.includes('%') || false,
        numeric_version: /^\/v(\d+\.\d+(?:\.\d+)?)\//.exec(request.url)?.[1] || null,
        known_list_suffix: request.url.split('?')[0].endsWith('/containers/json') });
      response.writeHead(403); response.end(); return;
    }
    if (kind === 'ping') { response.end('OK'); return; }
    if (kind === 'version') { json(version); return; }
    if (api && (Number(api) < 1.40 || Number(api) > 1.56)) { response.writeHead(400); response.end(); return; }
    if (kind === 'list') { json([{ Id: fakeId, Names: ['/' + fakeName], Image: 'synthetic-only', State: 'running', Labels: {} }]); return; }
    if (kind === 'inspect') { json({ Id: fakeId, Name: '/' + fakeName, Created: '2026-10-17T00:00:00Z',
      Config: { Image: 'synthetic-only', Labels: {}, Tty: false }, State: { Running: true } }); return; }
    response.writeHead(200, { 'Content-Type': kind === 'logs' ? 'application/vnd.docker.raw-stream' : 'application/json' });
    response.flushHeaders();
    if (kind === 'events') { response.write('\n'); return; }
    const send = () => {
      const body = Buffer.from(new Date().toISOString() + ' VECTOR_SYNTHETIC_SOCKET_TEST\n');
      const header = Buffer.alloc(8); header[0] = 1; header.writeUInt32BE(body.length, 4);
      response.write(Buffer.concat([header, body])); counts.synthetic_frames++;
    };
    const first = setTimeout(send, 300);
    const timer = setInterval(send, 5000);
    response.on('close', () => { clearTimeout(first); clearInterval(timer); });
  });
  server.on('error', () => { process.stderr.write('FIXTURE_SERVER_FAILED\n'); process.exit(1); });
  server.listen(socketPath, () => {
    fs.chmodSync(socketPath, 0o660);
    process.stdout.write(JSON.stringify({ fixture_ready: true, uid: process.getuid(), socket_mode: '660' }) + '\n');
  });
  const timer = setInterval(summary, 2000);
  const finish = () => { clearInterval(timer); summary(); server.closeAllConnections(); server.close(); setTimeout(() => process.exit(0), 200); };
  process.on('SIGTERM', finish);
  setTimeout(finish, 180000); // Hard bound even if the orchestrator disappears.
}

if (process.argv[1] && (fileURLToPath(import.meta.url) === process.argv[1] || ['probe', 'fixture'].includes(process.argv[1]))) {
  const mode = process.argv[1] === 'probe' || process.argv[1] === 'fixture' ? process.argv[1] : process.argv[2];
  if (mode === 'probe') probe().catch(() => { process.stderr.write('FIXED_SOCKET_PROBE_FAILED\n'); process.exitCode = 1; });
  else if (mode === 'fixture') fixture();
  else { process.stderr.write('DISPOSABLE_MODE_REQUIRED\n'); process.exitCode = 1; }
}
