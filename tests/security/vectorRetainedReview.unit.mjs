import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { digest, repaired, toCreate, vectorImage } from '../../scripts/vectorRepairCore.mjs';
import { target, recoveryDesign, validateRecoveryDesign, reviewRetained, validateFutureApproval, startupDecision, LockedRetainedAdapter } from '../../scripts/vectorRetainedReview.mjs';

const assessment = JSON.parse(fs.readFileSync('supabase/tests/results/vector_analytics_assessment_a856fe4f.json')).analytics_after;
const codes = ['db', 'kong', 'auth', 'realtime', 'rest', 'storage', 'edge_runtime', 'inbucket', 'studio', 'pg_meta', 'analytics', 'vector'];
function item(code, index) {
  return { Id: code === 'vector' ? target.vectorId : digest('synthetic-' + index), Name: '/supabase_' + code + '_' + target.project,
    Image: code === 'vector' ? vectorImage : 'sha256:' + digest(code), RestartCount: 0,
    State: { Running: true, Restarting: false, StartedAt: 'synthetic-time', Health: { Status: 'healthy' } },
    Config: { Image: 'synthetic-image', Env: ['DOCKER_HOST=http://host.docker.internal:2375', 'SYNTHETIC_LOGGING_KEY=canary-never-emit'],
      Labels: { 'com.supabase.cli.project': target.project, 'com.docker.compose.project': target.project },
      Healthcheck: { Test: ['synthetic'] } },
    HostConfig: { Mounts: [], Binds: null, NetworkMode: target.network, AutoRemove: false, ContainerIDFile: '' }, Mounts: [],
    NetworkSettings: { Networks: { [target.network]: { NetworkID: target.networkId, Aliases: ['synthetic-alias'], IPAMConfig: null } } } };
}
function input() {
  const reference = codes.map(item);
  const volumes = [{ Name: 'supabase_db_school-queue-local', CreatedAt: 'synthetic', definitionSha256: digest('volume') }];
  return { identity: { project: target.project, workdir: target.workdir, endpoint: target.endpoint, cluster: target.cluster, context: target.context },
    reference, current: structuredClone(reference), referenceVolumes: volumes, currentVolumes: structuredClone(volumes),
    yamlSha256: target.yaml, sourceReceiptSha256: digest('source'), codeSha256: digest('code'),
    assessment, recoveryPlan: recoveryDesign(assessment) };
}
const vector = x => x.current.find(x => x.Name.includes('_vector_'));
const failure = (change, pattern) => { const x = input(); change(x); assert.throws(() => reviewRetained(x), pattern); };

test('full database design includes all 39 tables and unlogged peers without claiming a backup', () => {
  const p = recoveryDesign(assessment); assert.equal(p.archive.tables.length, 39);
  assert.equal(p.archive.tables.filter(x => x.persistence === 'u').length, 1);
  assert.equal(validateRecoveryDesign(p, assessment).recoverabilityVerified, false);
});
test('wrong database cluster and loopback destination fail recovery review', () => {
  for (const [field, value] of [['database', 'postgres'], ['cluster', 'other']]) {
    const a = structuredClone(assessment); a.identity[field] = value; assert.throws(() => recoveryDesign(a), /TARGET/);
  }
  const a = structuredClone(assessment); a.client_endpoint = 'https://hosted.invalid'; assert.throws(() => recoveryDesign(a), /TARGET/);
});
test('partial archives, missing unlogged data and owner/ACL loss are rejected', () => {
  for (const mutate of [p => p.archive.excludedTables.push('oban_peers'), p => p.archive.schemaFilters.push('_analytics'),
    p => p.archive.includeUnlogged = false, p => p.restore.ownersAndACLs = false]) {
    const p = recoveryDesign(assessment); mutate(p); assert.throws(() => validateRecoveryDesign(p, assessment), /DELTA/);
  }
});
test('clone isolation, exact comparisons and actual restoration are mandatory', () => {
  for (const mutate of [p => p.restore.network = target.network, p => p.restore.tcp = true, p => p.restore.newVolume = false,
    p => p.restore.actualRequired = false, p => p.restore.servicesStarted.push('analytics'), p => p.restore.exactComparison.pop()]) {
    const p = recoveryDesign(assessment); mutate(p); assert.throws(() => validateRecoveryDesign(p, assessment), /DELTA/);
  }
});
test('slot progress, external secrets and cross-database consistency cannot be claimed by a logical dump', () => {
  for (const key of ['slotProgressRecoveredByDump', 'crossDatabaseAtomicityClaim']) {
    const p = recoveryDesign(assessment); p.external[key] = true; assert.throws(() => validateRecoveryDesign(p, assessment), /DELTA/);
  }
});
test('missing or duplicate table identity fails the design', () => {
  const a = structuredClone(assessment); a.tables.pop(); assert.throws(() => recoveryDesign(a), /INVENTORY/);
  a.table_count--; a.tables[1] = a.tables[0]; assert.throws(() => recoveryDesign(a), /IDENTITY/);
});
test('exact synthetic retained target passes the locked review and emits hashes only', () => {
  const receipt = reviewRetained(input()); assert.equal(receipt.result, 'LOCKED_REVIEW_VALID');
  assert.equal(receipt.backupStillRequired, true); assert.equal(receipt.repairLocked, true);
  assert.ok(!JSON.stringify(receipt).includes('canary-never-emit'));
});
test('workdir project cluster endpoint and Docker context cannot drift', () => {
  for (const k of Object.keys(input().identity)) failure(x => x.identity[k] = 'wrong', /IDENTITY/);
});
test('unknown extra and duplicate project containers fail even if stopped', () => {
  failure(x => x.current.push({ ...x.current[0], Name: '/rollback-vector' }), /EXTRA/);
  failure(x => x.current[0].Name = x.current[1].Name, /NAMES/);
  failure(x => x.current[0].Id = x.current[1].Id, /DUPLICATE/);
});
test('Vector image YAML target ID and project labels remain exact', () => {
  failure(x => vector(x).Image = 'other', /VECTOR_IDENTITY/);
  failure(x => x.yamlSha256 = digest('other'), /VECTOR_IDENTITY/);
  failure(x => vector(x).Id = digest('later-cli-id'), /VECTOR_IDENTITY/);
  failure(x => vector(x).Config.Labels['com.supabase.cli.project'] = 'other', /LABELS/);
});
test('network identity extra networks and recreated volumes fail', () => {
  failure(x => vector(x).NetworkSettings.Networks[target.network].NetworkID = 'other', /NETWORK/);
  failure(x => vector(x).NetworkSettings.Networks.extra = {}, /NETWORK/);
  failure(x => x.currentVolumes[0].CreatedAt = 'recreated', /VOLUME/);
});
test('all eleven unaffected definitions and lifecycles must remain exact', () => {
  for (const code of codes.filter(c => c !== 'vector')) {
    failure(x => x.current.find(x => x.Name.includes('supabase_' + code + '_')).RestartCount++, /LIFECYCLE/);
  }
  failure(x => x.current[0].Config.Env.push('UNREVIEWED=1'), /DEFINITION/);
});
test('existing automatic Vector restart does not authorize a definition difference', () => {
  const x = input(); vector(x).RestartCount++; assert.equal(reviewRetained(x).repairLocked, true);
  failure(x => vector(x).HostConfig.Privileged = true, /DEFINITION/);
});
test('unknown original fields are refused before candidate construction', () => {
  const x = input();
  for (const item of [vector(x), x.reference.find(x => x.Name.includes('_vector_'))]) item.Config.Unknown = 'synthetic';
  assert.throws(() => reviewRetained(x), /UNKNOWN/);
});
test('candidate retains every original field except reviewed transport and socket mount', () => {
  const x = input(); const original = toCreate(vector(x), target.network);
  const candidate = repaired(original, '/var/run/docker.sock');
  assert.deepEqual(candidate.HostConfig.Mounts, [{ Type: 'bind', Source: '/var/run/docker.sock', Target: '/var/run/docker.sock', ReadOnly: true }]);
  assert.equal(candidate.Env[1], original.Env[1]); assert.deepEqual(candidate.Labels, original.Labels);
});
function approvalFixture() {
  const plan = reviewRetained(input()); const approval = digest(plan);
  const recovery = { result: 'VERIFIED_ISOLATED_RESTORE', database: target.database, cluster: target.cluster,
    planSha256: plan.recoveryPlanSha256, bundleSha256: digest('synthetic-bundle'), snapshotSha256: digest('synthetic-snapshot') };
  return { plan, approval, recovery };
}
test('missing approval or unverified Analytics recovery cannot arm even the binding model', () => {
  const { plan, approval, recovery } = approvalFixture();
  assert.throws(() => validateFutureApproval(plan, '', plan.originalId, plan.sourceReceiptSha256, plan.codeSha256, recovery), /APPROVAL/);
  assert.throws(() => validateFutureApproval(plan, approval, plan.originalId, plan.sourceReceiptSha256, plan.codeSha256, null), /RECOVERY_PENDING/);
});
test('changed target source or code requires new capture and approval', () => {
  const { plan, approval, recovery } = approvalFixture();
  const args = [plan.originalId, plan.sourceReceiptSha256, plan.codeSha256];
  for (let i = 0; i < 3; i++) { const changed = [...args]; changed[i] = digest('changed');
    assert.throws(() => validateFutureApproval(plan, approval, ...changed, recovery), /NEW_CAPTURE/); }
});
test('later CLI recreation returns a new approval gate without an automatic apply', () => {
  const x = input(); vector(x).Id = digest('new-cli-id');
  assert.deepEqual(startupDecision(x.current, target.vectorId, digest('old-body')), { result: 'NEW_CAPTURE_AND_APPROVAL_REQUIRED', activationBlocked: true });
});
test('startup requires every service healthy and still blocks activation after model success', () => {
  const x = input(); const hash = digest(toCreate(vector(x), target.network));
  assert.equal(startupDecision(x.current, target.vectorId, hash).activationBlocked, true);
  for (const item of x.current) { item.State.Health.Status = 'unhealthy';
    assert.throws(() => startupDecision(x.current, target.vectorId, hash), /HEALTH/); item.State.Health.Status = 'healthy'; }
});
test('all retained execution methods remain unconditional locks with apparently valid approvals', () => {
  const adapter = new LockedRetainedAdapter(); const x = approvalFixture();
  for (const method of ['repair', 'rollback', 'startStack']) assert.throws(() => adapter[method](x), /NOT_CERTIFIED/);
  assert.equal(adapter.review(input()).startupLocked, true);
});
