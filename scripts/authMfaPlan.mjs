/** Separate MFA-only contract. Retained execution requires a fresh MFA-specific review and explicit approval. */
import fs from 'node:fs'
import path from 'node:path'
import { root, need, digest, stable, environment, toCreate, compareCreated, storage, authImage, codeBinding, network } from './authOnlyCore.mjs'
import { AuthOnlyEngine } from './authOnlyEngine.mjs'
import { BoundAuthEngine } from './authOnlyRetained.mjs'
export const mfaDelta = { GOTRUE_MFA_TOTP_ENROLL_ENABLED: 'true', GOTRUE_MFA_TOTP_VERIFY_ENABLED: 'true' }
export const mfaAuthTag = 'public.ecr.aws/supabase/gotrue:v2.197.0'
export function mfaCandidate(original) {
  const env = environment(original.Env)
  need([authImage,mfaAuthTag].includes(original.Image) && env.GOTRUE_EXTERNAL_GOOGLE_ENABLED === 'true' && env.GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID && env.GOTRUE_EXTERNAL_GOOGLE_SECRET, 'AMF_GOOGLE_BASELINE')
  need(env.GOTRUE_SITE_URL === 'http://127.0.0.1:5173' && env.GOTRUE_URI_ALLOW_LIST === 'http://127.0.0.1:5173/auth/callback'
    && env.GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI === 'http://127.0.0.1:54321/auth/v1/callback'
    && env.GOTRUE_EXTERNAL_GOOGLE_SKIP_NONCE_CHECK === 'false' && env.GOTRUE_EXTERNAL_GOOGLE_EMAIL_OPTIONAL === 'false'
    && env.GOTRUE_JWT_SECRET && env.GOTRUE_DB_DATABASE_URL, 'AMF_CONFIGURATION_BASELINE')
  need(Object.keys(mfaDelta).every(key => env[key] === 'false'), 'AMF_EXPECT_DISABLED')
  const candidate = structuredClone(original)
  candidate.Env = original.Env.map(entry => { const key = entry.slice(0, entry.indexOf('=')); return Object.hasOwn(mfaDelta, key) ? key + '=true' : entry })
  return candidate
}
export function exactMfaDelta(original, candidate) { need(stable(mfaCandidate(original)) === stable(candidate), 'AMF_UNRELATED_CHANGE') }
export function mfaToml(bytes) {
  need(Buffer.isBuffer(bytes) && !/^\s*\[auth\.mfa(?:\.totp)?\]\s*$/m.test(bytes.toString('utf8')), 'AMF_TOML_REVIEW_REQUIRED')
  return Buffer.concat([bytes, Buffer.from('\n[auth.mfa.totp]\nenroll_enabled = true\nverify_enabled = true\n')])
}
export const mfaRetainedId = '565adceacab15cd43c7e00d5cee19345bc34f6ab981b35d5dc2ba4f8cdd4f399'
export function validateMfaRetained(item) {
  need(item?.Id === mfaRetainedId && item.Name === '/supabase_auth_school-queue-local' && item.Image === authImage && item.Config.Image === 'public.ecr.aws/supabase/gotrue:v2.197.0', 'AMF_RETAINED_IDENTITY')
  need(item.Config.Labels?.['com.supabase.cli.project'] === 'school-queue-local' && item.Config.Labels?.['com.docker.compose.project'] === 'school-queue-local', 'AMF_PROJECT')
  need(stable(item.Config.Cmd) === stable(['auth']) && !item.Config.Entrypoint && item.Mounts.length === 0 && item.State.Running && item.State.Health?.Status === 'healthy', 'AMF_RETAINED_SHAPE')
  need(!item.HostConfig.Privileged && !Object.keys(item.HostConfig.PortBindings || {}).length, 'AMF_RETAINED_PRIVILEGES')
  const original = toCreate(item, network); mfaCandidate(original); return original
}
export const mfaCode = () => ({...codeBinding(), ...Object.fromEntries(['scripts/authMfaPlan.mjs', 'scripts/Start-AuthOnlyMfa.ps1', 'scripts/authMfaWorkflow.mjs', 'scripts/authMfaCli.mjs', 'scripts/auth_mfa_guard.py', 'tests/security/rehearse_auth_mfa.mjs', 'tests/security/authMfaFixture.mjs',
  ...fs.readdirSync(path.join(root,'supabase/migrations')).filter(p=>p.endsWith('.sql')).map(p=>'supabase/migrations/'+p)].map(p => [p, digest(fs.readFileSync(path.join(root, p)))]))})
const code = mfaCode
export function activateRetainedMfa() { throw Error('AMF_RETAINED_EXECUTION_LOCKED') }
export class MfaDisposableReconciler {
  constructor(engine) { need(engine instanceof AuthOnlyEngine || (engine instanceof BoundAuthEngine && engine.restoreDelta === exactMfaDelta), 'AMF_BOUND_ENGINE_REQUIRED'); this.engine = engine; this.profile = engine instanceof AuthOnlyEngine ? 'synthetic' : 'retained-capture' }
  journal(slot, suffix, data) { fs.writeFileSync(path.join(root, '.local-auth-only', this.engine.id, `${slot}-mfa-${suffix}.json`), stable(data), { flag: 'wx' }) }
  async prepare(slot, id, config) {
    need(/^[a-z][a-z0-9-]{0,24}$/.test(slot), 'AMF_SLOT')
    const inspect = await this.engine.inspect(id)
    need(inspect.Image === authImage && inspect.Name === '/' + this.engine.names.auth, 'AMF_TARGET')
    const original = toCreate(inspect, this.engine.names.network), candidate = mfaCandidate(original)
    await storage('initialize', this.engine.id, slot, undefined, this.profile)
    this.journal(slot, 'reserved', { id })
    const proposedConfig = mfaToml(config)
    const plan = { profile: this.profile, operation: 'enable-totp-only', run: this.engine.id, slot, id,
      inspectHash: digest(inspect), originalHash: digest(original), candidateHash: digest(candidate), originalConfigHash: digest(config), proposedConfigHash: digest(proposedConfig), code: code() }
    await storage('seal', this.engine.id, slot, { inspect, original, candidate, plan, originalConfig: config.toString('base64'), proposedConfig: proposedConfig.toString('base64') }, this.profile)
    await this.load(plan, digest(plan))
    this.journal(slot, 'plan', plan)
    return { plan, hash: digest(plan) }
  }
  async load(plan, approval) {
    need(plan.profile === this.profile && plan.operation === 'enable-totp-only' && plan.run === this.engine.id && digest(plan) === approval && stable(plan.code) === stable(code()), 'AMF_APPROVAL_OR_CODE')
    const value = JSON.parse((await storage('open', this.engine.id, plan.slot, undefined, this.profile)).payload)
    need(stable(value.plan) === stable(plan) && value.inspect.Id === plan.id && digest(value.inspect) === plan.inspectHash && digest(value.original) === plan.originalHash && digest(value.candidate) === plan.candidateHash, 'AMF_CAPTURE')
    exactMfaDelta(value.original, value.candidate)
    need(digest(Buffer.from(value.originalConfig, 'base64')) === plan.originalConfigHash && digest(Buffer.from(value.proposedConfig, 'base64')) === plan.proposedConfigHash, 'AMF_CONFIG_BINDING')
    need(mfaToml(Buffer.from(value.originalConfig, 'base64')).equals(Buffer.from(value.proposedConfig, 'base64')), 'AMF_TOML_DELTA')
    return value
  }
  async apply(plan, approval) {
    const value = await this.load(plan, approval), current = await this.engine.inspect(plan.id)
    need(current.Name === '/' + this.engine.names.auth && digest(toCreate(current, this.engine.names.network)) === plan.originalHash, 'AMF_TARGET_CHANGED')
    this.journal(plan.slot, 'attempt', { id: plan.id })
    if (this.engine.bind) await this.engine.bind(plan.slot + '-mfa', plan.id, value.original, value.candidate)
    await this.engine.action(plan.id, 'stop'); await this.engine.action(plan.id, 'rename', this.engine.names.prefix + plan.slot + '-mfa-original'); await this.engine.action(plan.id, 'disconnect')
    const id = await this.engine.create(this.engine.names.auth, value.candidate)
    this.journal(plan.slot, 'replacement', { id })
    compareCreated(value.candidate, await this.engine.inspect(id), this.engine.names.network)
    await this.engine.action(id, 'start'); return id
  }
  rollbackHash(hash, id) { return digest({ operation: 'rollback-mfa-only', planHash: hash, replacementId: id }) }
  async rollback(plan, approval, id, rollbackApproval) {
    const value = await this.load(plan, approval)
    need(rollbackApproval === this.rollbackHash(approval, id), 'AMF_ROLLBACK_APPROVAL')
    const receipt = JSON.parse(fs.readFileSync(path.join(root, '.local-auth-only', this.engine.id, `${plan.slot}-mfa-replacement.json`)))
    need(receipt.id === id, 'AMF_ROLLBACK_ID')
    const old = await this.engine.inspect(plan.id), replacement = await this.engine.inspect(id)
    need(old.Name === '/' + this.engine.names.prefix + plan.slot + '-mfa-original' && !old.State.Running && !Object.keys(old.NetworkSettings.Networks).length && replacement.Name === '/' + this.engine.names.auth, 'AMF_ROLLBACK_STATE')
    const restored = structuredClone(old); restored.NetworkSettings.Networks = value.inspect.NetworkSettings.Networks
    compareCreated(value.original, restored, this.engine.names.network)
    compareCreated(value.candidate, replacement, this.engine.names.network)
    this.journal(plan.slot, 'rollback', { id })
    await this.engine.action(id, 'stop'); await this.engine.action(id, 'rename', this.engine.names.prefix + plan.slot + '-mfa-failed'); await this.engine.action(id, 'disconnect')
    await this.engine.action(plan.id, 'rename', this.engine.names.auth)
    await this.engine.action(plan.id, 'connect', value.original.NetworkingConfig.EndpointsConfig[this.engine.names.network].Aliases)
    compareCreated(value.original, await this.engine.inspect(plan.id), this.engine.names.network)
    if (value.inspect.State.Running) await this.engine.action(plan.id, 'start')
    return plan.id
  }
}
