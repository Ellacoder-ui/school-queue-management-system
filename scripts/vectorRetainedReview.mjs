/** Step 22.8D pure review model. No Engine adapter, process, storage or mutation.
 * Input receipts are review evidence, never authorization. All execution methods
 * throw even when every model check passes. Existing operational locks stay put.
 */
import { toCreate, repaired, exactDelta, digest, stable, vectorImage, need } from './vectorRepairCore.mjs';

export const target = Object.freeze({
  project: 'school-queue-local', workdir: 'C:\\Users\\Hp\\school-queue-management-system',
  cluster: '7696959712798593061', database: '_supabase', endpoint: '127.0.0.1:54322',
  context: 'npipe:////./pipe/dockerDesktopLinuxEngine',
  network: 'supabase_network_school-queue-local',
  networkId: 'e1f4c1a26ff768b3ebd984c2e80d570985d0762b775e4edf753570f7dbbf656d',
  vectorId: 'b6d521af4f244e0ab8ede06130d31bf067e9483ed1dd920544759b607cc9bc59',
  yaml: 'ce74949a121530bdc91c43ec327b6e0bf746d2acf76b1548385ece2da3a2e1e8',
});
const services = ['db', 'kong', 'auth', 'realtime', 'rest', 'storage', 'edge_runtime', 'inbucket', 'studio', 'pg_meta', 'analytics', 'vector'];
const names = services.map(s => '/supabase_' + s + '_' + target.project).sort();
const vectorName = '/supabase_vector_' + target.project;
const sha = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const equal = (a, b, code) => need(stable(a) === stable(b), code);

export function recoveryDesign(assessment) {
  need(assessment.identity.database === target.database && assessment.identity.cluster === target.cluster &&
    assessment.identity.version_num === 170011 && assessment.client_endpoint === target.endpoint + '/_supabase', 'VAR_RECOVERY_TARGET');
  need(assessment.table_count === assessment.tables.length && assessment.table_count > 0 && sha(assessment.catalog_sha256), 'VAR_RECOVERY_INVENTORY');
  need(new Set(assessment.tables.map(t => t.identity_sha256)).size === assessment.tables.length &&
    assessment.tables.every(t => sha(t.identity_sha256) && ['p', 'u'].includes(t.persistence)), 'VAR_RECOVERY_TABLE_IDENTITY');
  return {
    version: 1, status: 'DESIGN_ONLY_NOT_A_BACKUP', source: { database: target.database, cluster: target.cluster,
      endpoint: target.endpoint, catalogSha256: assessment.catalog_sha256, assessmentSha256: digest(assessment) },
    archive: { format: 'custom', fullDatabase: true, tableFilters: [], schemaFilters: [], excludedTables: [],
      includeUnlogged: true, physicalDataEntries: assessment.tables.filter(t => t.kind === 'r').length,
      tables: assessment.tables.map(t => ({ identitySha256: t.identity_sha256, persistence: t.persistence })).sort((a, b) => a.identitySha256.localeCompare(b.identitySha256)) },
    sourceGuards: ['exact-loopback-project-cluster-volumes-images', 'postgres-six-migration-routing-security-gate',
      'exported-repeatable-read-read-only-snapshot', 'manifest-hashed-before-dump', 'all-table-canonical-fingerprints',
      'non-mvcc-sequences-roles-acls-settings-before-after', 'fail-on-unreviewed-churn-no-worker-stop', 'no-historical-rebase'],
    protection: ['new-run-create-new', 'no-reparse-points', 'current-user-and-SYSTEM-only', 'git-ignored-untracked',
      'encrypted-sensitive-archive-and-supplements', 'private-readback-and-hash-binding', 'no-passwords-in-role-supplement'],
    restore: { actualRequired: true, network: 'none', tcp: false, newVolume: true, distinctCluster: true,
      servicesStarted: [], sameImageLocalePreloadExtensions: true, ownersAndACLs: true, clean: false,
      exactComparison: ['all-tables-including-unlogged-and-empty', 'partitions-and-attachments', 'all-schema-security-sections',
        'roles-memberships', 'all-sequences', 'database-schema-column-type-acls', 'database-role-settings', 'publication-definitions'],
      sourceDerivedSupplementsOnly: true, negativeTargetTest: true, retainStoppedClone: true },
    external: { replicationSlots: assessment.dependencies.replication_slots,
      slotProgressRecoveredByDump: false, crossDatabaseAtomicityClaim: false,
      serviceSecretsKeysAndRolePasswordsRequireSeparateProtectedProcedure: true,
      workersMayNotConnectToClone: true, reconstructPeerLeasesOnlyAfterExactComparisonAndSeparateServiceReview: true },
    requiresSeparateBackupApproval: true, recoverabilityVerified: false,
  };
}

export function validateRecoveryDesign(plan, assessment) {
  equal(plan, recoveryDesign(assessment), 'VAR_RECOVERY_PLAN_DELTA');
  return { result: 'VALID_DESIGN_ONLY', backupExecuted: false, recoverabilityVerified: false };
}

function projectInventory(items) {
  need(Array.isArray(items) && items.length === 12, 'VAR_EXTRA_PROJECT_CONTAINER');
  equal(items.map(x => x.Name).sort(), names, 'VAR_PROJECT_NAMES');
  need(new Set(items.map(x => x.Id)).size === 12, 'VAR_DUPLICATE_CONTAINER');
  for (const item of items) {
    need(item.Config.Labels?.['com.supabase.cli.project'] === target.project &&
      item.Config.Labels?.['com.docker.compose.project'] === target.project, 'VAR_PROJECT_LABELS');
    need(item.NetworkSettings.Networks?.[target.network]?.NetworkID === target.networkId &&
      Object.keys(item.NetworkSettings.Networks).length === 1, 'VAR_NETWORK_IDENTITY');
  }
}

const definition = item => ({ Config: item.Config, HostConfig: item.HostConfig, Mounts: item.Mounts,
  Image: item.Image, Networks: item.NetworkSettings.Networks });
const lifecycle = item => ({ Id: item.Id, started: item.State.StartedAt, running: item.State.Running,
  restarting: item.State.Restarting, restarts: item.RestartCount, health: item.State.Health?.Status ?? 'not-configured' });

export function reviewRetained(input) {
  equal(input.identity, { project: target.project, workdir: target.workdir, endpoint: target.endpoint,
    cluster: target.cluster, context: target.context }, 'VAR_RETAINED_IDENTITY');
  projectInventory(input.reference); projectInventory(input.current);
  equal(input.currentVolumes, input.referenceVolumes, 'VAR_VOLUME_INVENTORY');
  need(input.referenceVolumes.some(v => v.Name === 'supabase_db_school-queue-local' && v.CreatedAt && sha(v.definitionSha256)), 'VAR_DATABASE_VOLUME');
  const original = input.current.find(x => x.Name === vectorName);
  need(original.Id === target.vectorId && original.Image === vectorImage && input.yamlSha256 === target.yaml, 'VAR_VECTOR_IDENTITY');
  for (const previous of input.reference) {
    const now = input.current.find(x => x.Name === previous.Name);
    equal(definition(previous), definition(now), 'VAR_SERVICE_DEFINITION');
    need(previous.Id === now.Id, 'VAR_SERVICE_ID');
    if (now.Name !== vectorName) equal(lifecycle(previous), lifecycle(now), 'VAR_UNAFFECTED_LIFECYCLE');
  }
  const body = toCreate(original, target.network);
  const candidate = repaired(body, '/var/run/docker.sock');
  exactDelta(body, candidate, '/var/run/docker.sock');
  validateRecoveryDesign(input.recoveryPlan, input.assessment);
  need(sha(input.sourceReceiptSha256) && sha(input.codeSha256), 'VAR_REVIEW_BINDING');
  // Hashes only: no original/candidate body, logging key or environment is emitted.
  return { result: 'LOCKED_REVIEW_VALID', originalId: original.Id, originalHash: digest(body),
    candidateHash: digest(candidate), sourceReceiptSha256: input.sourceReceiptSha256, codeSha256: input.codeSha256,
    recoveryPlanSha256: digest(input.recoveryPlan), backupStillRequired: true, socketReprobeStillRequired: true,
    repairLocked: true, rollbackLocked: true, startupLocked: true };
}

export function validateFutureApproval(plan, approval, currentId, sourceHash, codeHash, recoveryReceipt) {
  need(sha(approval) && digest(plan) === approval, 'VAR_APPROVAL');
  need(plan.originalId === currentId && plan.sourceReceiptSha256 === sourceHash && plan.codeSha256 === codeHash, 'VAR_NEW_CAPTURE_APPROVAL_REQUIRED');
  // Model of a future verified receipt; this function cannot arm any executor.
  need(recoveryReceipt?.result === 'VERIFIED_ISOLATED_RESTORE' && recoveryReceipt.database === target.database &&
    recoveryReceipt.cluster === target.cluster && recoveryReceipt.planSha256 === plan.recoveryPlanSha256 &&
    sha(recoveryReceipt.bundleSha256) && sha(recoveryReceipt.snapshotSha256), 'VAR_ANALYTICS_RECOVERY_PENDING');
  return { result: 'BINDING_MODEL_VALID_EXECUTION_LOCKED' };
}

export function startupDecision(items, approvedVectorId, expectedDefinitionHash) {
  projectInventory(items);
  const vector = items.find(x => x.Name === vectorName);
  if (vector.Id !== approvedVectorId) return { result: 'NEW_CAPTURE_AND_APPROVAL_REQUIRED', activationBlocked: true };
  need(digest(toCreate(vector, target.network)) === expectedDefinitionHash, 'VAR_STARTUP_DEFINITION');
  need(items.every(x => x.State.Running && !x.State.Restarting &&
    (!x.Config.Healthcheck || x.State.Health?.Status === 'healthy')), 'VAR_FULL_SERVICE_HEALTH');
  return { result: 'HEALTH_MODEL_VALID_INDEPENDENT_ACCEPTANCE_PENDING', activationBlocked: true,
    continuousHealthSecondsRequired: 600, maximumSampleGapSeconds: 30, deliveryCorrelationRequired: true };
}

export class LockedRetainedAdapter {
  review(input) { return reviewRetained(input); }
  repair() { throw Error('VPR_RETAINED_EXECUTION_NOT_CERTIFIED'); }
  rollback() { throw Error('VPR_RETAINED_EXECUTION_NOT_CERTIFIED'); }
  startStack() { throw Error('LGA_REHEARSAL_NOT_CERTIFIED'); }
}
