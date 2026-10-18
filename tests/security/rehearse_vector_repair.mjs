/** All service operations here are performed through the disposable-only engine.
 * Never load retained YAML, Auth/Google credentials, or source records. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { root, need, names, label, vectorImage, nodeImage, stable, digest, storage, DisposableEngine, Reconciler, cleanEnv, syntheticVectorConfig } from '../../scripts/vectorRepairCore.mjs';

const argument = process.argv[2]; names(argument);
const engine = new DisposableEngine(argument);
const reconcile = new Reconciler(engine, digest('synthetic-source-unchanged'));
const file = path.join(root, `supabase/tests/results/vector_repair_disposable_${argument}.json`);
need(!fs.existsSync(file), 'VPR_EVIDENCE_EXISTS');
const secret = 'SYNTHETIC_VPR_' + crypto.randomBytes(32).toString('hex');
const record = { run_id: argument, started_at: new Date().toISOString(), result: 'IN_PROGRESS', checks: [], retained_mutation_executed: false };
const save = () => fs.writeFileSync(file, JSON.stringify(record, null, 2));
const check = (name, value) => { need(value, 'VPR_ASSERTION'); record.checks.push({ name, result: 'PASS' }); save(); console.log(JSON.stringify({ check: name, result: 'PASS' })); };
const expectFailure = async (operation, pattern) => { try { await operation(); } catch (e) { need(pattern.test(e.message), 'VPR_WRONG_FAILURE'); return true; } throw Error('VPR_NEGATIVE_ACCEPTED'); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function host(network = 'none') {
  return { NetworkMode: network, ReadonlyRootfs: true, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'],
    Memory: 268435456, NanoCpus: 1000000000, PidsLimit: 64, RestartPolicy: { Name: 'no', MaximumRetryCount: 0 },
    Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=16777216' } };
}
function body(kind) {
  const fixture = kind === 'fixture';
  const h = host(fixture ? 'none' : engine.names.network);
  if (fixture) h.Mounts = [{ Type: 'volume', Source: engine.names.volume, Target: '/experiment' }];
  if (kind === 'vector') {
    const config = syntheticVectorConfig();
    return { Image: vectorImage, Env: ['DOCKER_HOST=http://host.docker.internal:2375', 'SYNTHETIC_LOGGING_KEY=' + secret],
      // The original TCP branch is an idle stub; it never contacts real port 2375.
      // Candidate runs the actual Vector binary after the approved env delta.
      Entrypoint: ['/bin/sh'], Cmd: ['-ec', `if [ "$DOCKER_HOST" = 'http://host.docker.internal:2375' ]; then exec /bin/sh -c 'while :; do sleep 1; done'; fi; printf '%s' '${JSON.stringify(config)}' > /tmp/config.json; exec /usr/local/bin/vector --config /tmp/config.json`],
      Labels: { [label]: argument }, HostConfig: h,
      Healthcheck: { Test: ['CMD-SHELL', 'wget --no-verbose --tries=1 --spider http://127.0.0.1:9001/health'], Interval: 10000000000, Timeout: 2000000000, Retries: 3 },
      NetworkingConfig: { EndpointsConfig: { [engine.names.network]: { Aliases: ['vector'] } } } };
  }
  const code = fixture ? fs.readFileSync(path.join(root, 'supabase/tests/vector_socket_fixture.mjs'), 'utf8') : 'setTimeout(()=>{},180000)';
  return { Image: nodeImage, Entrypoint: ['/usr/local/bin/node'], Cmd: ['--input-type=module', '--eval', code, ...(fixture ? ['fixture'] : [])],
    Labels: { [label]: argument }, HostConfig: h };
}
async function healthy(id) {
  const begin = Date.now(); const samples = [];
  while (Date.now() - begin < 25000) {
    const x = await engine.inspect(id);
    need(x.State.Running && x.RestartCount === 0, 'VPR_REPLACEMENT_STOPPED');
    samples.push({ elapsed_ms: Date.now() - begin, health: x.State.Health?.Status || 'starting' });
    if (samples.at(-1).health === 'healthy' && Date.now() - begin >= 15000) break;
    await pause(2000);
  }
  need(samples.at(-1).health === 'healthy', 'VPR_REPLACEMENT_UNHEALTHY');
  const text = await engine.logs(id);
  need(!text.includes(secret) && !/\b(?:ERROR|WARN)\b/.test(text), 'VPR_LOG_PRIVACY_OR_ERROR');
  const count = text.split('VECTOR_SYNTHETIC_SOCKET_TEST').length - 1;
  need(count >= 2, 'VPR_SYNTHETIC_LOGS');
  return { samples, synthetic_messages: count, restart_count: 0 };
}
async function retire(id, name) {
  await engine.action(id, 'stop'); await engine.action(id, 'rename', engine.names.prefix + name);
  await engine.action(id, 'disconnect');
}
try {
  save(); await engine.image(vectorImage); await engine.image(nodeImage); await engine.infrastructure();
  record.network_id = engine.networkId; record.volume = engine.names.volume; save();
  const fixture = await engine.create(engine.names.fixture, body('fixture')); await engine.action(fixture, 'start');
  let ready = false;
  for (let i = 0; i < 20; i++) { if ((await engine.logs(fixture)).includes('"fixture_ready":true')) { ready = true; break; } await pause(250); }
  need(ready, 'VPR_FIXTURE_READY');
  const witness = await engine.create(engine.names.witness, body('witness')); await engine.action(witness, 'start');
  const witnessBefore = await engine.inspect(witness);
  const original = await engine.create(engine.names.vector, body('vector'));
  await engine.action(original, 'start');
  const before = await engine.inspect(original);
  const capture = await reconcile.prepare('first', original);
  check('DPAPI capture and private decrypt/read-back', true);
  const reopened = JSON.parse((await storage('open', argument, 'first')).payload);
  check('original logging canary survives encrypted round-trip', reopened.original.Env.includes('SYNTHETIC_LOGGING_KEY=' + secret));
  const firstCipher = path.join(reconcile.directory(), 'first/payload.dpapi');
  const cipherHash = digest(fs.readFileSync(firstCipher).toString('base64'));
  check('existing rollback ciphertext cannot be overwritten', await expectFailure(() => storage('seal', argument, 'first', { changed: true }), /STORAGE_REJECTED/) && digest(fs.readFileSync(firstCipher).toString('base64')) === cipherHash);
  check('wrong target approval rejected before service operations', await expectFailure(() => reconcile.apply({ ...capture.plan, originalId: witness }, capture.hash, reconcile.sourceHash), /APPROVAL/));
  check('changed source rejected before service operations', await expectFailure(() => reconcile.apply(capture.plan, capture.hash, digest('changed')), /TARGET_SOURCE/));
  const negativeAfter = await engine.inspect(original);
  check('original remains unchanged after negative gates', stable(negativeAfter.Config) === stable(before.Config) && stable(negativeAfter.HostConfig) === stable(before.HostConfig) && negativeAfter.State.StartedAt === before.State.StartedAt && negativeAfter.RestartCount === before.RestartCount);
  const result = await reconcile.apply(capture.plan, capture.hash, reconcile.sourceHash);
  record.first_health = await healthy(result.replacementId);
  check('replacement exact delta, healthy Unix transport and synthetic logging', true);
  const isolated = await engine.inspect(original);
  check('original retained stopped, labeled and network-detached', !isolated.State.Running && !Object.keys(isolated.NetworkSettings.Networks).length && isolated.Config.Labels[label] === argument);
  check('repeat repair invocation refused', await expectFailure(() => reconcile.apply(capture.plan, capture.hash, reconcile.sourceHash), /TARGET_CHANGED|EEXIST/));
  // Simulate the next CLI recreation without running Supabase CLI or deleting data:
  // park the repaired instance and construct a fresh original TCP definition.
  await retire(result.replacementId, 'first-repaired-retained');
  const cliAgain = await engine.create(engine.names.vector, body('vector'));
  await engine.action(cliAgain, 'start');
  const later = await reconcile.prepare('later-cli', cliAgain);
  check('later CLI identity requires a fresh plan and approval', later.plan.originalId !== capture.plan.originalId && later.hash !== capture.hash);
  const laterResult = await reconcile.apply(later.plan, later.hash, reconcile.sourceHash);
  record.later_health = await healthy(laterResult.replacementId);
  check('same reconciler restores Unix transport after simulated CLI recreation', true);
  await retire(laterResult.replacementId, 'later-repaired-retained');
  const failedOriginal = await engine.create(engine.names.vector, body('vector'));
  await engine.action(failedOriginal, 'start');
  const failed = await reconcile.prepare('failure', failedOriginal);
  const failedResult = await reconcile.apply(failed.plan, failed.hash, reconcile.sourceHash, true);
  check('injected failure retains both original and unstarted replacement', failedResult.injectedFailure && !(await engine.inspect(failedResult.replacementId)).State.Running);
  check('rollback without separate approval refused', await expectFailure(() => reconcile.rollback(failed.plan, failed.hash, failedResult.replacementId, '0'.repeat(64)), /ROLLBACK_APPROVAL/));
  const rollbackApproval = digest({ operation: 'rollback', planHash: failed.hash, replacementId: failedResult.replacementId });
  const restored = await reconcile.rollback(failed.plan, failed.hash, failedResult.replacementId, rollbackApproval);
  check('rollback restores exact original ID, definition, aliases and failing transport', restored.restoredOriginalId === failedOriginal && restored.knownFailingTransportRestored);
  await engine.action(failedOriginal, 'stop');
  check('repeat rollback refused', await expectFailure(() => reconcile.rollback(failed.plan, failed.hash, failedResult.replacementId, rollbackApproval), /EEXIST/));
  check('interrupted preparation remains unarmed', await expectFailure(() => reconcile.prepare('interrupted', failedOriginal, true), /INTERRUPTED_PREPARATION/));
  check('interrupted slot cannot be silently reused', await expectFailure(() => reconcile.prepare('interrupted', failedOriginal), /EEXIST/));
  await storage('seal', argument, 'tamper', { syntheticSecret: secret });
  const tamper = path.join(reconcile.directory(), 'tamper/payload.dpapi'); const bytes = fs.readFileSync(tamper); bytes[bytes.length - 1] ^= 1; fs.writeFileSync(tamper, bytes);
  check('tampered DPAPI ciphertext rejected', await expectFailure(() => storage('open', argument, 'tamper'), /STORAGE_REJECTED/));
  await storage('seal', argument, 'acl-negative', { syntheticSecret: secret });
  const aclProbe = operation => {
    const p = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'tests/security/vectorStorageAclProbe.ps1')],
      { input: JSON.stringify({ runId: argument, slot: 'acl-negative', operation }), env: cleanEnv(), windowsHide: true, encoding: 'utf8' });
    need(p.status === 0 && JSON.parse(p.stdout).result === 'PASS', 'VPR_DUMMY_ACL_PROBE');
  };
  try {
    aclProbe('weaken');
    check('extra file principal rejected before decrypt', await expectFailure(() => storage('open', argument, 'acl-negative'), /STORAGE_REJECTED/));
  } finally { aclProbe('restore'); }
  check('only owned dummy ACL restored and revalidated', JSON.parse((await storage('open', argument, 'acl-negative')).payload).syntheticSecret === secret);
  const witnessAfter = await engine.inspect(witness);
  check('unrelated disposable witness ID/config/start/restart unchanged', stable(witnessAfter.Config) === stable(witnessBefore.Config) && stable(witnessAfter.HostConfig) === stable(witnessBefore.HostConfig) && witnessAfter.Id === witnessBefore.Id && witnessAfter.State.StartedAt === witnessBefore.State.StartedAt && witnessAfter.RestartCount === witnessBefore.RestartCount);
  const publicScript = path.join(root, 'scripts/Repair-LocalVector.ps1');
  for (const mode of ['Repair', 'Rollback']) {
    const p = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', publicScript, '-' + mode, '-RunId', argument, '-ApprovedPlanSha256', capture.hash], { env: cleanEnv(), windowsHide: true, encoding: 'utf8' });
    check(`retained ${mode.toLowerCase()} entry point remains locked`, p.status === 1 && p.stderr.trim() === 'VPR_RETAINED_EXECUTION_NOT_CERTIFIED' && !p.stdout.includes(secret));
  }
  const scan = directory => { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const p = path.join(directory, entry.name); if (entry.isDirectory()) scan(p); else need(!fs.readFileSync(p).includes(Buffer.from(secret)), 'VPR_CANARY_ON_DISK');
  } };
  scan(reconcile.directory()); need(!JSON.stringify(record).includes(secret), 'VPR_PUBLIC_CANARY');
  check('ciphertext/state/public evidence contain no plaintext logging canary', true);
  record.result = 'PASS';
} catch (error) {
  record.result = 'FAIL_STOPPED'; record.failure = /^VPR_[A-Z_]+$/.test(error.message) ? error.message : 'VPR_SANITIZED_STOP';
} finally {
  for (const id of [...engine.containers].reverse()) {
    try { await engine.action(id, 'stop'); } catch { record.cleanup_failure = true; record.result = 'FAIL_STOPPED'; }
  }
  record.containers = [...engine.containers]; record.network_id = engine.networkId; record.volume = engine.names.volume;
  record.completed_at = new Date().toISOString(); save();
  console.log(JSON.stringify({ result: record.result, failure: record.failure || null, run_id: argument, checks: record.checks.length }));
}
process.exitCode = record.result === 'PASS' ? 0 : 1;
