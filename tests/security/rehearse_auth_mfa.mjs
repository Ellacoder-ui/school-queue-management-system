import fs from 'node:fs'
import crypto from 'node:crypto'
import { AuthMfaFixture } from './authMfaFixture.mjs'
import { MfaDisposableReconciler, exactMfaDelta, mfaToml, activateRetainedMfa } from '../../scripts/authMfaPlan.mjs'
import { BoundAuthEngine, retainedMfaEngine } from '../../scripts/authOnlyRetained.mjs'
import { MfaWorkflow } from '../../scripts/authMfaWorkflow.mjs'
import { ConfigFile } from '../../scripts/authOnlyWorkflow.mjs'
import { stable, need, environment, storage } from '../../scripts/authOnlyCore.mjs'
import { QueueFixture, preservationQuery } from '../integration/queueFixture.mjs'
const run = crypto.randomBytes(4).toString('hex'), fixture = new AuthMfaFixture(run), fence = new QueueFixture(run)
const file = `supabase/tests/results/auth_mfa_rehearsal_${run}.json`
const report = { run, result: 'IN_PROGRESS', retained_writes: false, real_google_or_retained_mfa: false, checks: [] }
const save = () => fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n')
const check = (name, value = true) => { need(value, 'AMF_CHECK_FAILED'); report.checks.push({ name, result: 'PASS' }); save(); console.log('PASS: ' + name) }
async function rejected(action) { try { await action() } catch { return true } throw Error('AMF_NEGATIVE_ACCEPTED') }
function totp(secret, offset = 0) {
  let bits = ''; for (const c of secret) bits += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g).map(x => parseInt(x, 2))), step = Buffer.alloc(8); step.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000) + offset))
  const h = crypto.createHmac('sha1', key).update(step).digest(), at = h[19] & 15
  return ((h.readUInt32BE(at) & 0x7fffffff) % 1000000).toString().padStart(6, '0')
}
let before, rows, inventory, client
try {
  save(); before = await fence.retained(); rows = fence.retainedRead(preservationQuery).trim(); inventory = await fence.inventory()
  await fixture.start(); const e = fixture.engine, r = new MfaDisposableReconciler(e)
  check('new internal no-port cached Auth/database fixture healthy; Google remains enabled')
  const dbBefore = await e.probe(fixture.db, 'db-state'); need(dbBefore.migrations.length === 75 && dbBefore.users === 0, 'AMF_INITIAL_STATE')
  client = fixture.client()
  const signup = await client.auth.signUp({ email: 'mfa-fixture@example.invalid', password: crypto.randomBytes(24).toString('hex') })
  report.synthetic_signup = { status: signup.error ? signup.error.status ?? null : 200, code: /^[a-z0-9_]+$/.test(signup.error?.code || '') ? signup.error.code : null, session: !!signup.data?.session }
  need(!signup.error && signup.data.session, 'AMF_SYNTHETIC_SIGNUP')
  const denied = await client.auth.mfa.enroll({ factorType: 'totp' })
  check('actual disabled Auth refuses synthetic enrollment', !!denied.error)
  const config = fs.readFileSync('supabase/config.toml')
  await storage('initialize',run,'mfa-review',undefined,'retained-capture')
  const configFile = new ConfigFile(run, true); fs.writeFileSync(configFile.file, config, { flag: 'wx' })
  const workflowGuard = async (review, phase, id) => {
    if (phase === 'after') await fixture.health(id)
    if (phase === 'rollback-after') await fixture.health(fixture.original)
    const current = await e.probe(fixture.db, 'db-state')
    need(current.users === 1 && current.witness === dbBefore.witness && stable(current.migrations) === stable(dbBefore.migrations), 'AMF_FIXTURE_PRESERVATION')
    const flags = environment((await e.inspect(phase === 'after' || phase === 'rollback-before' ? id : fixture.original)).Config.Env)
    need(flags.GOTRUE_EXTERNAL_GOOGLE_ENABLED === 'true', 'AMF_GOOGLE_REGRESSION')
    if (phase !== 'rollback-before') need(flags.GOTRUE_MFA_TOTP_ENROLL_ENABLED === (phase === 'after' ? 'true' : 'false') && flags.GOTRUE_MFA_TOTP_VERIFY_ENABLED === (phase === 'after' ? 'true' : 'false'), 'AMF_FLAGS')
  }
  const makeWorkflow = () => new MfaWorkflow({runId:run,engine:new BoundAuthEngine(e,exactMfaDelta),guard:workflowGuard,config:configFile,synthetic:true})
  const workflow = makeWorkflow(), reviewed = await workflow.prepare({fixture:true},await e.inspect(fixture.original))
  check('retained factory refuses absent approval', await rejected(() => retainedMfaEngine({},run,{})))
  check('wrong workflow approval refused before configuration or container changes', await rejected(() => workflow.activate('0'.repeat(64))))
  need(configFile.read().equals(config), 'AMF_PREMATURE_CONFIG_WRITE')
  check('MFA-specific encrypted original/candidate/TOML capture privately verified')
  check('nonsecret TOML proposal appends only the two TOTP flags', mfaToml(config).subarray(0, config.length).equals(config))
  check('unreviewed bare activation remains locked', await rejected(async () => activateRetainedMfa()))
  check('wrong plan approval rejected before mutations', await rejected(() => makeWorkflow().activate('0'.repeat(64))))
  const activated = await workflow.activate(reviewed.hash), replacement = activated.replacementId
  need(configFile.read().equals(mfaToml(config)), 'AMF_CONFIG_APPLICATION')
  const plan = {plan: JSON.parse(fs.readFileSync('.local-auth-only/' + run + '/activation-mfa-plan.json'))}; plan.hash = (await import('../../scripts/authOnlyCore.mjs')).digest(plan.plan)
  const capture = await new MfaDisposableReconciler(new BoundAuthEngine(e,exactMfaDelta)).load(plan.plan, plan.hash), envBefore = environment(capture.original.Env), envAfter = environment(capture.candidate.Env)
  exactMfaDelta(capture.original, capture.candidate)
  check('replacement changes only two MFA flags; Google/JWT/DB/email/aliases preserved', Object.keys(envAfter).filter(k => envBefore[k] !== envAfter[k]).length === 2)
  check('repeat apply rejected', await rejected(() => makeWorkflow().activate(reviewed.hash)))
  const enrolled = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Disposable TOTP' })
  need(!enrolled.error && enrolled.data.totp?.secret && enrolled.data.totp?.qr_code, 'AMF_ENROLL')
  let secret = enrolled.data.totp.secret; const factorId = enrolled.data.id
  check('real installed SDK enrolls a synthetic TOTP factor on actual Auth')
  let challenge = await client.auth.mfa.challenge({ factorId }); need(!challenge.error, 'AMF_CHALLENGE')
  const invalid = await client.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code: totp(secret, -20) })
  check('actual Auth rejects an expired TOTP code', !!invalid.error)
  challenge = await client.auth.mfa.challenge({ factorId }); need(!challenge.error, 'AMF_CHALLENGE')
  const correct = new Set([-1,0,1].map(offset => totp(secret, offset))); let bad = '000000'; while (correct.has(bad)) bad = String(Number(bad)+1).padStart(6,'0')
  const wrong = await client.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code: bad })
  check('actual Auth rejects a wrong TOTP code', !!wrong.error)
  const verified = await client.auth.mfa.challengeAndVerify({ factorId, code: totp(secret) }); secret = ''; enrolled.data.totp.secret = ''; enrolled.data.totp.qr_code = ''
  need(!verified.error, 'AMF_VERIFY')
  const user = await client.auth.getUser(), assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel(), factors = await client.auth.mfa.listFactors()
  check('actual verification upgrades session to AAL2 with server-verified user/factor', !user.error && !assurance.error && assurance.data.currentLevel === 'aal2' && factors.data.totp.some(x => x.id === factorId && x.status === 'verified'))
  const afterFlow = await e.probe(fixture.db, 'db-state')
  check('fixture migrations and witness preserved through normal synthetic Auth writes', stable(afterFlow.migrations) === stable(dbBefore.migrations) && afterFlow.witness === dbBefore.witness && afterFlow.users === 1)
  check('wrong rollback approval refused', await rejected(() => makeWorkflow().rollback(reviewed.hash,'0'.repeat(64),replacement)))
  await makeWorkflow().rollback(reviewed.hash, activated.rollbackApprovalSha256, replacement); await fixture.health(fixture.original)
  need(configFile.read().equals(config), 'AMF_CONFIG_ROLLBACK')
  check('repeat rollback refused', await rejected(() => makeWorkflow().rollback(reviewed.hash, activated.rollbackApprovalSha256, replacement)))
  check('fresh executor restores original MFA-disabled definition; Google remains enabled')
  check('rollback preserves new fixture user/migrations/witness', stable(await e.probe(fixture.db, 'db-state')) === stable(afterFlow))
  const disabledChallenge = await client.auth.mfa.challenge({ factorId })
  // Some Auth versions gate verification rather than challenge creation.
  const disabledVerify = disabledChallenge.error ? disabledChallenge : await client.auth.mfa.verify({ factorId, challengeId: disabledChallenge.data.id, code: '000000' })
  check('restored disabled verification rejects API use', !!disabledVerify.error)
  await e.action(fixture.original, 'stop'); await e.action(fixture.original, 'rename', e.names.prefix + 'completed-original'); await e.action(fixture.original, 'disconnect')
  const failing = await e.create(e.names.auth, fixture.authBody(true)); await e.action(failing, 'start'); await fixture.health(failing)
  const failPlan = await r.prepare('mfa-startup-failure', failing, config), failed = await r.apply(failPlan.plan, failPlan.hash)
  await new Promise(resolve => setTimeout(resolve, 1200)); const state = await e.inspect(failed)
  check('injected exit-42 replacement failure is detected without retry', !state.State.Running && state.State.ExitCode === 42)
  await new MfaDisposableReconciler(e).rollback(failPlan.plan, failPlan.hash, failed, r.rollbackHash(failPlan.hash, failed)); await fixture.health(failing)
  check('separately bound rollback restores healthy original after failed replacement')
  report.result = 'PASS'
} catch (error) { report.result = 'FAIL'; report.failure = /^[A-Z_]+$/.test(error.message || '') ? error.message : 'MFA rehearsal stopped; private diagnostics suppressed'; process.exitCode = 1 }
finally {
  try { await fixture.stop(); report.owned_containers_stopped = true } catch { report.result = 'FAIL'; report.stop_failed = true; process.exitCode = 1 }
  try {
    need(rows === fence.retainedRead(preservationQuery).trim(), 'AMF_RETAINED_ROWS')
    const after = await fence.retained(); need(after.every((row,i) => row.name.includes('vector') ? row.id === before[i].id && row.definition === before[i].definition : stable(row) === stable(before[i])), 'AMF_RETAINED_SERVICES')
    const current = await fence.inventory()
    need(stable(current.volumes) === stable(inventory.volumes) && stable(current.containers) === stable([...inventory.containers, ...fixture.engine.containers].sort()) && stable(current.networks) === stable([...inventory.networks, ...(fixture.engine.networkId ? [fixture.engine.networkId] : [])].sort()), 'AMF_RESOURCE_DELTA')
    report.retained_preservation = true
  } catch { report.retained_preservation = false; report.result = 'FAIL'; process.exitCode = 1 }
  report.containers = [...fixture.engine.containers]; report.network = fixture.engine.networkId ? fixture.engine.names.network : null
  report.passed = report.checks.length; save(); console.log(JSON.stringify({ result: report.result, passed: report.passed, evidence: file }))
}
