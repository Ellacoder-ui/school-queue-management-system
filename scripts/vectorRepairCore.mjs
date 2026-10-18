/** Reviewed primitives for DISPOSABLE rehearsal only. Retained profile is locked.
 * Docker create bodies travel over a local named pipe. Secret-bearing JSON never
 * enters child arguments or operator output. No delete/prune/start-stack API.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const vectorImage = 'sha256:5dcf67db0ee378caa87f3395cb9484ebe3e97bb0334d119f2ac33116e00c5773';
export const nodeImage = 'sha256:145325b7e39f8ef4931d6e8cfd3f6f4d655de09d72a2ccc96d9513542c2202bd';
export const label = 'school-queue.vector-repair-rehearsal';
export function syntheticVectorConfig() {
  return { data_dir: '/tmp/vector', api: { enabled: true, address: '127.0.0.1:9001' },
    sources: { synthetic_source: { type: 'docker_logs', include_containers: ['disposable-synthetic-vector-source'] } },
    sinks: { synthetic_output: { type: 'console', inputs: ['synthetic_source'], encoding: { codec: 'json' } } } };
}
export function need(value, code) { if (!value) throw Error(code); }
export const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
export const digest = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex');
export function names(id) {
  need(typeof id === 'string' && id.length === 8 && /^[0-9a-f]{8}$/.test(id), 'VPR_RUN_ID');
  return { prefix: `sq-vpr-${id}-`, vector: `sq-vpr-${id}-vector`, fixture: `sq-vpr-${id}-fixture`, witness: `sq-vpr-${id}-witness`,
    volume: `sq-vpr-${id}-socket`, network: `sq-vpr-${id}-network` };
}
export const configKeys = new Set('Hostname Domainname User AttachStdin AttachStdout AttachStderr ExposedPorts Tty OpenStdin StdinOnce Env Cmd Healthcheck ArgsEscaped Image Volumes WorkingDir Entrypoint OnBuild Labels StopSignal StopTimeout Shell'.split(' '));
const hostKeys = new Set(('AutoRemove Binds BlkioDeviceReadBps BlkioDeviceReadIOps BlkioDeviceWriteBps BlkioDeviceWriteIOps BlkioWeight BlkioWeightDevice CapAdd CapDrop Cgroup CgroupParent CgroupnsMode ConsoleSize ContainerIDFile CpuCount CpuPercent CpuPeriod CpuQuota CpuRealtimePeriod CpuRealtimeRuntime CpuShares CpusetCpus CpusetMems DeviceCgroupRules DeviceRequests Devices Dns DnsOptions DnsSearch ExtraHosts GroupAdd IOMaximumBandwidth IOMaximumIOps IpcMode Isolation Links LogConfig MaskedPaths Memory MemoryReservation MemorySwap MemorySwappiness Mounts NanoCpus NetworkMode OomKillDisable OomScoreAdj PidMode PidsLimit PortBindings Privileged PublishAllPorts ReadonlyPaths ReadonlyRootfs RestartPolicy Runtime SecurityOpt ShmSize StorageOpt Sysctls Tmpfs UTSMode Ulimits UsernsMode VolumeDriver VolumesFrom').split(' '));
export function toCreate(item, network) {
  need(item && item.Config && item.HostConfig && item.NetworkSettings, 'VPR_INSPECT_SHAPE');
  need(Object.keys(item.Config).every(k => configKeys.has(k)), 'VPR_UNKNOWN_CONFIG_FIELD');
  need(Object.keys(item.HostConfig).every(k => hostKeys.has(k)), 'VPR_UNKNOWN_HOST_FIELD');
  need(!item.HostConfig.ContainerIDFile && !item.Config.Volumes && !item.HostConfig.AutoRemove, 'VPR_UNSUPPORTED_CREATE_FIELD');
  need(Object.keys(item.NetworkSettings.Networks).length === 1 && item.NetworkSettings.Networks[network], 'VPR_NETWORK_SHAPE');
  const endpoint = item.NetworkSettings.Networks[network];
  need(!endpoint.IPAMConfig && !endpoint.Links && !endpoint.DriverOpts && !(endpoint.GwPriority), 'VPR_UNSUPPORTED_ENDPOINT');
  // Explicit create-field translation; inspect Id, State, Paths, NetworkID,
  // EndpointID, generated IPs and DNSNames are never replayed as create fields.
  const body = structuredClone(item.Config);
  body.HostConfig = structuredClone(item.HostConfig);
  // Engine 29 inspect may report the default as null; create/inspect returns
  // false. Preserve the explicit effective default, and never normalize true.
  body.HostConfig.OomKillDisable ??= false;
  body.NetworkingConfig = { EndpointsConfig: { [network]: { Aliases: structuredClone(endpoint.Aliases || []) } } };
  return body;
}
export function repaired(body, source) {
  need(body.Env.filter(x => x.startsWith('DOCKER_HOST=')).length === 1 && body.Env.includes('DOCKER_HOST=http://host.docker.internal:2375'), 'VPR_ORIGINAL_TRANSPORT');
  need(!body.HostConfig.Mounts?.length && !body.HostConfig.Binds?.length, 'VPR_ORIGINAL_MOUNTS');
  const next = structuredClone(body);
  next.Env = next.Env.map(x => x.startsWith('DOCKER_HOST=') ? 'DOCKER_HOST=unix:///var/run/docker.sock' : x);
  next.HostConfig.Mounts = [{ Type: 'bind', Source: source, Target: '/var/run/docker.sock', ReadOnly: true }];
  return next;
}
export function exactDelta(original, candidate, source) {
  need(stable(candidate) === stable(repaired(original, source)), 'VPR_DEFINITION_DELTA');
}
export function compareCreated(expected, item, network) {
  const actual = toCreate(item, network);
  // Engine makes the default bind propagation explicit on inspect.
  const normalize = body => {
    const x = structuredClone(body);
    for (const m of x.HostConfig.Mounts || []) if (m.Type === 'bind' && (!m.BindOptions || m.BindOptions.Propagation === 'rprivate')) {
      if (m.BindOptions) need(Object.keys(m.BindOptions).every(k => k === 'Propagation'), 'VPR_BIND_OPTIONS');
      delete m.BindOptions;
    }
    return x;
  };
  need(stable(normalize(actual)) === stable(normalize(expected)), 'VPR_CREATED_DEFINITION');
}
export function codeBinding() {
  return Object.fromEntries(['scripts/vectorRepairCore.mjs', 'scripts/VectorRepairStorage.ps1', 'scripts/Repair-LocalVector.ps1'].map(p => [p, digest(fs.readFileSync(path.join(root, p), 'utf8'))]));
}
export function validateApproval(plan, supplied, currentId, sourceHash) {
  need(/^[0-9a-f]{64}$/.test(supplied) && digest(plan) === supplied, 'VPR_APPROVAL');
  need(plan.originalId === currentId && plan.sourceHash === sourceHash, 'VPR_TARGET_SOURCE');
  need(stable(plan.code) === stable(codeBinding()), 'VPR_CODE_CHANGED');
}
export function cleanEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(PG|SUPABASE_|QUEUE_|VITE_)/i.test(k) && !['NODE_OPTIONS', 'NODE_PATH', 'PYTHONPATH', 'PYTHONSTARTUP'].includes(k.toUpperCase())));
}
export async function storage(operation, runId, slot, payload) {
  names(runId); need(/^[a-z][a-z0-9-]{0,31}$/.test(slot), 'VPR_SLOT');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts/VectorRepairStorage.ps1')],
      { cwd: root, env: cleanEnv(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let size = 0;
    const timer = setTimeout(() => { child.kill(); reject(Error('VPR_STORAGE_TIMEOUT')); }, 20000);
    child.stdout.on('data', b => { size += b.length; if (size > 2097152) { child.kill(); reject(Error('VPR_STORAGE_BOUND')); } else out += b; });
    child.stderr.on('data', () => {}); // Raw diagnostics are never forwarded.
    child.on('error', () => { clearTimeout(timer); reject(Error('VPR_STORAGE_PROCESS')); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) { reject(Error('VPR_STORAGE_REJECTED')); return; }
      try { const result = JSON.parse(out); need(result.result === 'PASS', 'VPR_STORAGE_RECEIPT'); resolve(result); }
      catch { reject(Error('VPR_STORAGE_RECEIPT')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ operation, runId, slot, ...(payload === undefined ? {} : { payload: stable(payload) }) }));
  });
}

export class DisposableEngine {
  constructor(id) {
    this.id = id; this.names = names(id); this.containers = new Set(); this.networkId = null; this.mountSource = null;
    need(process.platform === 'win32' && root.toLowerCase() === 'c:\\users\\hp\\school-queue-management-system', 'VPR_PLATFORM');
    need(!['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'].some(k => process.env[k]), 'VPR_DOCKER_OVERRIDE');
  }
  async #request(method, target, body, raw = false) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const request = http.request({ socketPath: '//./pipe/dockerDesktopLinuxEngine', path: '/v1.56' + target, method,
        timeout: 20000, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {} }, response => {
        let size = 0; const chunks = [];
        response.on('data', b => { size += b.length; if (size > 2097152) request.destroy(Error('VPR_ENGINE_BOUND')); else chunks.push(b); });
        response.on('end', () => {
          if (response.statusCode < 200 || response.statusCode >= 300) { reject(Error('VPR_ENGINE_STATUS')); return; }
          if (raw) { resolve(Buffer.concat(chunks)); return; }
          const text = Buffer.concat(chunks).toString('utf8');
          try { resolve(text ? JSON.parse(text) : null); } catch { reject(Error('VPR_ENGINE_JSON')); }
        });
      });
      request.on('timeout', () => request.destroy(Error('VPR_ENGINE_TIMEOUT')));
      request.on('error', () => reject(Error('VPR_ENGINE_REQUEST')));
      request.end(data);
    });
  }
  async inspect(id) {
    need(this.containers.has(id), 'VPR_NOT_OWNED');
    const x = await this.#request('GET', `/containers/${id}/json`);
    need(x.Id === id && x.Name.startsWith('/' + this.names.prefix) && x.Config.Labels[label] === this.id, 'VPR_OWNED_IDENTITY');
    need(!x.HostConfig.Privileged && !Object.keys(x.HostConfig.PortBindings || {}).length && !x.HostConfig.VolumesFrom?.length, 'VPR_OWNED_PRIVILEGES');
    need([vectorImage, nodeImage].includes(x.Image), 'VPR_OWNED_IMAGE');
    need(Object.keys(x.NetworkSettings.Networks).every(k => [this.names.network, 'none'].includes(k)), 'VPR_OWNED_NETWORK');
    for (const m of x.Mounts) need((m.Type === 'volume' && m.Name === this.names.volume && m.Destination === '/experiment') ||
      (m.Type === 'bind' && this.mountSource && m.Source === this.mountSource && m.Destination === '/var/run/docker.sock' && !m.RW), 'VPR_OWNED_MOUNT');
    return x;
  }
  guardBody(name, body) {
    need(name.startsWith(this.names.prefix) && /^[a-z0-9-]+$/.test(name) && body.Labels?.[label] === this.id, 'VPR_CREATE_IDENTITY');
    need([vectorImage, nodeImage].includes(body.Image), 'VPR_CREATE_IMAGE');
    const h = body.HostConfig;
    need(h && !h.Privileged && !h.AutoRemove && !h.Binds?.length && !h.VolumesFrom?.length && !Object.keys(h.PortBindings || {}).length && !h.PublishAllPorts, 'VPR_CREATE_PRIVILEGES');
    need(!h.CapAdd?.length && !h.Devices?.length && !h.DeviceRequests?.length && !h.ExtraHosts?.length && !h.Links?.length,
      'VPR_CREATE_HOST_ACCESS');
    need(h.ReadonlyRootfs && h.CapDrop?.includes('ALL') && h.SecurityOpt?.includes('no-new-privileges'), 'VPR_CREATE_HARDENING');
    need(['none', this.names.network].includes(h.NetworkMode), 'VPR_CREATE_NETWORK');
    need(Object.keys(body.NetworkingConfig?.EndpointsConfig || {}).every(k => k === this.names.network), 'VPR_CREATE_ENDPOINT');
    need(!body.Volumes && !h.ContainerIDFile && !['host', 'container'].some(v => [h.PidMode, h.IpcMode, h.UTSMode].some(mode => mode?.startsWith(v))), 'VPR_CREATE_NAMESPACE');
    need(!h.LogConfig || ['json-file', 'local', 'none'].includes(h.LogConfig.Type), 'VPR_CREATE_LOG_DRIVER');
    for (const m of h.Mounts || []) need((m.Type === 'volume' && m.Source === this.names.volume && m.Target === '/experiment') ||
      (m.Type === 'bind' && this.mountSource && m.Source === this.mountSource && m.Target === '/var/run/docker.sock' && m.ReadOnly === true), 'VPR_CREATE_MOUNT');
  }
  async create(name, body) {
    this.guardBody(name, body);
    const x = await this.#request('POST', '/containers/create?name=' + encodeURIComponent(name), body);
    need(/^[0-9a-f]{64}$/.test(x.Id), 'VPR_CREATED_ID'); this.containers.add(x.Id);
    await this.inspect(x.Id); return x.Id;
  }
  async action(id, operation, value) {
    const item = await this.inspect(id);
    if (operation === 'stop') { if (item.State.Running) await this.#request('POST', `/containers/${id}/stop?t=5`); }
    else if (operation === 'start') await this.#request('POST', `/containers/${id}/start`);
    else if (operation === 'rename') { need(value.startsWith(this.names.prefix) && /^[a-z0-9-]+$/.test(value), 'VPR_RENAME'); await this.#request('POST', `/containers/${id}/rename?name=${encodeURIComponent(value)}`); }
    else if (operation === 'disconnect') { need(this.networkId && item.NetworkSettings.Networks[this.names.network], 'VPR_DISCONNECT'); await this.#request('POST', `/networks/${this.networkId}/disconnect`, { Container: id, Force: false }); }
    else if (operation === 'connect') { need(this.networkId && !Object.keys(item.NetworkSettings.Networks).length, 'VPR_CONNECT'); await this.#request('POST', `/networks/${this.networkId}/connect`, { Container: id, EndpointConfig: { Aliases: value } }); }
    else throw Error('VPR_ACTION_DENIED');
  }
  async infrastructure() {
    // Uniqueness is Engine-enforced for names; never reuse an existing resource.
    const old = await this.#request('GET', '/networks?filters=' + encodeURIComponent(JSON.stringify({ name: [this.names.network] })));
    need(!old.some(x => x.Name === this.names.network), 'VPR_RESOURCE_EXISTS');
    const vols = await this.#request('GET', '/volumes?filters=' + encodeURIComponent(JSON.stringify({ name: [this.names.volume] }))); need(!vols.Volumes?.some(x => x.Name === this.names.volume), 'VPR_RESOURCE_EXISTS');
    const network = await this.#request('POST', '/networks/create', { Name: this.names.network, Driver: 'bridge', Internal: true, Labels: { [label]: this.id } });
    this.networkId = network.Id;
    const volume = await this.#request('POST', '/volumes/create', { Name: this.names.volume, Labels: { [label]: this.id } });
    need(volume.Name === this.names.volume && volume.Labels[label] === this.id, 'VPR_VOLUME_ID');
    need(volume.Mountpoint === `/var/lib/docker/volumes/${this.names.volume}/_data`, 'VPR_VOLUME_PATH');
    this.mountSource = volume.Mountpoint + '/docker.sock';
  }
  async logs(id) { await this.inspect(id); return (await this.#request('GET', `/containers/${id}/logs?stdout=true&stderr=true&tail=100`, undefined, true)).toString('utf8'); }
  async image(id) { need([vectorImage, nodeImage].includes(id), 'VPR_IMAGE_DENIED'); const item = await this.#request('GET', `/images/${id}/json`); need(item.Id === id && !item.Config.Volumes, 'VPR_IMAGE_PREREQUISITE'); }
}

export class Reconciler {
  constructor(engine, sourceHash) { this.engine = engine; this.sourceHash = sourceHash; }
  directory() { return path.join(root, '.local-vector-repair', this.engine.id); }
  writeNew(name, value) {
    need(/^[a-z0-9-]+\.json$/.test(name), 'VPR_ARTIFACT_NAME');
    fs.writeFileSync(path.join(this.directory(), name), stable(value), { flag: 'wx' });
  }
  async prepare(slot, id, interrupt = false) {
    need(/^[a-z][a-z0-9-]{0,20}$/.test(slot), 'VPR_SLOT');
    const item = await this.engine.inspect(id);
    need(item.Name === '/' + this.engine.names.vector, 'VPR_CANONICAL_TARGET');
    await storage('initialize', this.engine.id, slot);
    this.writeNew(slot + '-reserved.json', { originalId: id, phase: 'reserved' });
    if (interrupt) throw Error('VPR_INTERRUPTED_PREPARATION');
    const original = toCreate(item, this.engine.names.network);
    const candidate = repaired(original, this.engine.mountSource);
    exactDelta(original, candidate, this.engine.mountSource);
    const plan = { version: 1, profile: 'disposable-only', runId: this.engine.id, slot, originalId: id,
      sourceHash: this.sourceHash, originalHash: digest(original), candidateHash: digest(candidate), code: codeBinding() };
    await storage('seal', this.engine.id, slot, { inspect: item, original, candidate, plan });
    const readback = JSON.parse((await storage('open', this.engine.id, slot)).payload);
    need(stable(readback.original) === stable(original) && stable(readback.plan) === stable(plan), 'VPR_CAPTURE_READBACK');
    this.writeNew(slot + '-plan.json', plan);
    return { plan, hash: digest(plan) };
  }
  async load(plan, approval) {
    const value = JSON.parse((await storage('open', this.engine.id, plan.slot)).payload);
    validateApproval(plan, approval, plan.originalId, this.sourceHash);
    need(stable(plan) === stable(value.plan) && digest(value.original) === plan.originalHash && digest(value.candidate) === plan.candidateHash, 'VPR_CAPTURE_HASH');
    exactDelta(value.original, value.candidate, this.engine.mountSource);
    return value;
  }
  async apply(plan, approval, currentSourceHash, failReplacement = false) {
    validateApproval(plan, approval, plan.originalId, currentSourceHash);
    const value = await this.load(plan, approval);
    const item = await this.engine.inspect(plan.originalId);
    need(item.Name === '/' + this.engine.names.vector && digest(toCreate(item, this.engine.names.network)) === plan.originalHash, 'VPR_TARGET_CHANGED');
    this.writeNew(plan.slot + '-attempt.json', { phase: 'armed', originalId: plan.originalId });
    await this.engine.action(item.Id, 'stop');
    await this.engine.action(item.Id, 'rename', this.engine.names.prefix + plan.slot + '-original');
    await this.engine.action(item.Id, 'disconnect');
    this.writeNew(plan.slot + '-original-isolated.json', { originalId: item.Id });
    const candidate = await this.engine.create(this.engine.names.vector, value.candidate);
    compareCreated(value.candidate, await this.engine.inspect(candidate), this.engine.names.network);
    this.writeNew(plan.slot + '-replacement.json', { replacementId: candidate });
    if (failReplacement) return { originalId: item.Id, replacementId: candidate, injectedFailure: true };
    await this.engine.action(candidate, 'start');
    return { originalId: item.Id, replacementId: candidate, injectedFailure: false };
  }
  async rollback(plan, approval, replacementId, separateApproval) {
    const value = await this.load(plan, approval);
    need(separateApproval === digest({ operation: 'rollback', planHash: approval, replacementId }), 'VPR_ROLLBACK_APPROVAL');
    this.writeNew(plan.slot + '-rollback-attempt.json', { replacementId });
    const replacement = await this.engine.inspect(replacementId);
    need(replacement.Name === '/' + this.engine.names.vector, 'VPR_ROLLBACK_TARGET');
    await this.engine.action(replacementId, 'stop');
    await this.engine.action(replacementId, 'rename', this.engine.names.prefix + plan.slot + '-failed');
    await this.engine.action(replacementId, 'disconnect');
    const old = await this.engine.inspect(plan.originalId);
    need(old.Name === '/' + this.engine.names.prefix + plan.slot + '-original' && !old.State.Running && !Object.keys(old.NetworkSettings.Networks).length, 'VPR_ROLLBACK_ORIGINAL');
    await this.engine.action(old.Id, 'rename', this.engine.names.vector);
    await this.engine.action(old.Id, 'connect', value.original.NetworkingConfig.EndpointsConfig[this.engine.names.network].Aliases);
    compareCreated(value.original, await this.engine.inspect(old.Id), this.engine.names.network);
    if (value.inspect.State.Running) await this.engine.action(old.Id, 'start');
    return { restoredOriginalId: old.Id, knownFailingTransportRestored: true, originalRunningStateRestored: value.inspect.State.Running };
  }
}
