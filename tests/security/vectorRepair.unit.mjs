import test from 'node:test';
import assert from 'node:assert/strict';
import { toCreate, repaired, exactDelta, compareCreated, validateApproval, codeBinding, digest, names, DisposableEngine, label, vectorImage, syntheticVectorConfig } from '../../scripts/vectorRepairCore.mjs';

const item = () => ({ Id: 'old-id', State: { Running: false }, Path: 'never-replay',
  Config: { Hostname: 'old-host', Image: 'pinned', Env: ['DOCKER_HOST=http://host.docker.internal:2375', 'SYNTHETIC_LOGGING_KEY=unit-only'], Labels: {} },
  HostConfig: { NetworkMode: 'synthetic', Mounts: [], Binds: null, ContainerIDFile: '', AutoRemove: false },
  NetworkSettings: { Networks: { synthetic: { Aliases: ['vector'], IPAMConfig: null, Links: null, DriverOpts: null, EndpointID: 'runtime-only', IPAddress: 'runtime-only' } } } });
test('inspect translation uses explicit create fields and declared endpoint aliases only', () => {
  const body = toCreate(item(), 'synthetic');
  assert.equal(body.Id, undefined); assert.equal(body.State, undefined); assert.equal(body.Path, undefined);
  assert.deepEqual(body.NetworkingConfig.EndpointsConfig, { synthetic: { Aliases: ['vector'] } });
});
test('unknown inspect configuration cannot be silently dropped', () => {
  for (const field of ['Config', 'HostConfig']) {
    const x = item(); x[field].Unknown = 'test'; assert.throws(() => toCreate(x, 'synthetic'), /UNKNOWN/);
  }
});
test('static endpoint and anonymous-volume state needs separate review', () => {
  for (const field of ['IPAMConfig', 'Links', 'DriverOpts']) {
    const x = item(); x.NetworkSettings.Networks.synthetic[field] = { unexpected: true };
    assert.throws(() => toCreate(x, 'synthetic'), /ENDPOINT/);
  }
  const x = item(); x.Config.Volumes = { '/db': {} }; assert.throws(() => toCreate(x, 'synthetic'), /CREATE_FIELD/);
});
test('only the exact one-env and one-readonly-bind delta is accepted', () => {
  const original = toCreate(item(), 'synthetic'); const candidate = repaired(original, '/owned/socket');
  exactDelta(original, candidate, '/owned/socket');
  assert.deepEqual(candidate.Env, ['DOCKER_HOST=unix:///var/run/docker.sock', 'SYNTHETIC_LOGGING_KEY=unit-only']);
  for (const field of ['Cmd', 'Labels', 'User']) {
    const changed = structuredClone(candidate); changed[field] = 'changed'; assert.throws(() => exactDelta(original, changed, '/owned/socket'), /DELTA/);
  }
  candidate.HostConfig.Mounts[0].ReadOnly = false; assert.throws(() => exactDelta(original, candidate, '/owned/socket'), /DELTA/);
});
test('duplicate Docker host and existing mount are rejected', () => {
  const original = toCreate(item(), 'synthetic');
  original.Env.push('DOCKER_HOST=unexpected'); assert.throws(() => repaired(original, '/owned/socket'), /TRANSPORT/);
  original.Env.pop(); original.HostConfig.Mounts.push({ Target: '/db' }); assert.throws(() => repaired(original, '/owned/socket'), /MOUNTS/);
});
test('Engine round-trip comparison preserves all nontransport fields', () => {
  const original = item(); const body = toCreate(original, 'synthetic');
  compareCreated(body, original, 'synthetic');
  original.Config.Env.push('EXTRA=1'); assert.throws(() => compareCreated(body, original, 'synthetic'), /DEFINITION/);
});
test('only the null/false OOM default representation is canonicalized', () => {
  const original = item(); original.HostConfig.OomKillDisable = null;
  const body = toCreate(original, 'synthetic');
  assert.equal(body.HostConfig.OomKillDisable, false);
  original.HostConfig.OomKillDisable = false; compareCreated(body, original, 'synthetic');
  original.HostConfig.OomKillDisable = true; assert.throws(() => compareCreated(body, original, 'synthetic'), /DEFINITION/);
});
test('approval binds source, target, exact plan and code', () => {
  const plan = { originalId: 'one', sourceHash: 'source', code: codeBinding() }; const hash = digest(plan);
  validateApproval(plan, hash, 'one', 'source');
  assert.throws(() => validateApproval(plan, '0'.repeat(64), 'one', 'source'), /APPROVAL/);
  assert.throws(() => validateApproval(plan, hash, 'two', 'source'), /TARGET_SOURCE/);
  assert.throws(() => validateApproval(plan, hash, 'one', 'changed'), /TARGET_SOURCE/);
  plan.code = {}; assert.throws(() => validateApproval(plan, digest(plan), 'one', 'source'), /CODE/);
});
test('disposable names cannot select retained containers or escape storage', () => {
  assert.match(names('1234abcd').vector, /^sq-vpr-/);
  for (const id of ['school-queue-local', '../x', '1234abcd\n', '1234ABCD', '']) assert.throws(() => names(id), /RUN_ID/);
});
test('disposable creation rejects retained networks and daemon/DB mounts', () => {
  const engine = Object.create(DisposableEngine.prototype); engine.names = names('1234abcd'); engine.id = '1234abcd'; engine.mountSource = '/owned/docker.sock';
  const body = { Image: vectorImage, Labels: { [label]: engine.id }, HostConfig: { NetworkMode: engine.names.network, ReadonlyRootfs: true, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'] } };
  engine.guardBody(engine.names.vector, body);
  const endpoint = structuredClone(body); endpoint.NetworkingConfig = { EndpointsConfig: { supabase_network_school_queue_local: {} } };
  assert.throws(() => engine.guardBody(engine.names.vector, endpoint), /ENDPOINT/);
  for (const source of ['/var/run/docker.sock', '/var/lib/docker/volumes/supabase_db_school-queue-local/_data']) {
    const mounted = structuredClone(body); mounted.HostConfig.Mounts = [{ Type: 'bind', Source: source, Target: '/var/run/docker.sock', ReadOnly: true }];
    assert.throws(() => engine.guardBody(engine.names.vector, mounted), /MOUNT/);
  }
});
test('synthetic Vector components have globally unique names and connected inputs', () => {
  const config = syntheticVectorConfig();
  const all = [...Object.keys(config.sources), ...Object.keys(config.sinks)];
  assert.equal(new Set(all).size, all.length);
  for (const sink of Object.values(config.sinks)) for (const input of sink.inputs) assert.ok(config.sources[input]);
});
