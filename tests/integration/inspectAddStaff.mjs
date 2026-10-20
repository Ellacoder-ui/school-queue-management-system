// Fixed retained reads only. No staff request, role change, service action or DDL.
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { QueueFixture, need, digest, preservationQuery } from './queueFixture.mjs'
const fixture = new QueueFixture(), run = randomUUID().slice(0, 8)
const target = '5c96debb-697f-4cad-805f-92b518e28343'
const directory = '.local-browser/add-staff-frontend'
const extra = `select jsonb_build_object('review_requests',(select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) from queue_private.staff_review_requests t),'factors',(select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) from auth.mfa_factors t))`
function contextRead(id, sql) {
  const r = spawnSync('docker', ['exec', '-i', '--user', 'postgres', fixture.retainedDb, 'psql', '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', '-U', 'postgres', '-d', 'postgres'], {
    input: `begin transaction isolation level repeatable read read only; set local statement_timeout='10s'; set local request.jwt.claims='{"sub":"${id}","role":"authenticated","aal":"aal1"}'; set local role authenticated; ${sql}; commit;`, encoding: 'utf8', timeout: 20000, windowsHide: true })
  if (r.status !== 0) return { code: /42501/.test(r.stderr || '') ? '42501' : 'UNCLASSIFIED_READ_FAILURE' }
  return { data: JSON.parse(r.stdout.trim()) }
}
try {
  const services = await fixture.retained(), inventory = await fixture.inventory()
  const source = JSON.parse(fixture.retainedRead(preservationQuery).trim())
  need(source.cluster === '7696959712798593061', 'ASF_WRONG_CLUSTER')
  const extraRows = JSON.parse(fixture.retainedRead(extra).trim())
  const metadata = JSON.parse(fixture.retainedRead(`select jsonb_build_object(
    'functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'args',pg_get_function_arguments(p.oid),'identity_args',pg_get_function_identity_arguments(p.oid),'result',pg_get_function_result(p.oid),'security_definer',p.prosecdef,'settings',p.proconfig,'source',p.prosrc,
      'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='queue_api' and p.proname in ('admin_staff_directory','request_staff_access')),
    'table_rls',(select relrowsecurity from pg_class where oid='queue_private.staff_review_requests'::regclass),
    'direct_browser_read',has_table_privilege('authenticated','queue_private.staff_review_requests','SELECT'),
    'review_count',(select count(*) from queue_private.staff_review_requests),
    'migration007_absent',to_regclass('queue_private.staff_access_approvals') is null,
    'target',(select jsonb_build_object('id',a.id,'email',u.email,'role',a.role,'enabled',a.enabled) from queue_private.accounts a join auth.users u on u.id=a.id where a.id='${target}'),
    'school_role',(select role from queue_private.accounts where id='b7d9aee8-c54d-455f-9913-a4c4dea0d097'),
    'student',(select id from queue_private.accounts where role='STUDENT' and enabled order by id limit 1),
    'cashier',(select id from queue_private.accounts where role='CASHIER' and enabled order by id limit 1))`).trim())
  need(metadata.functions.length === 2 && metadata.functions.every(f => f.security_definer && f.authenticated_execute && !f.anon_execute && JSON.stringify(f.settings) === JSON.stringify(['search_path=""'])), 'ASF_FUNCTION_SECURITY')
  need(metadata.functions.find(f => f.name === 'request_staff_access')?.args === 'p_email text, p_role text', 'ASF_SIGNATURE_CHANGED')
  need(metadata.target.id === target && metadata.target.email === 'ellasharmaineabeso2004@gmail.com' && metadata.target.role === 'ADMIN' && metadata.target.enabled && metadata.school_role === 'STUDENT', 'ASF_TARGET_AUTHORIZATION')
  const admin = contextRead(target, 'select queue_api.admin_staff_directory()')
  need(Array.isArray(admin.data), 'ASF_ADMIN_DIRECTORY_READ')
  const student = contextRead(metadata.student, 'select queue_api.admin_staff_directory()')
  const cashier = contextRead(metadata.cashier, 'select queue_api.admin_staff_directory()')
  need(student.code === '42501' && cashier.code === '42501', 'ASF_DIRECTORY_AUTHORIZATION')
  need(metadata.table_rls && !metadata.direct_browser_read, 'ASF_PRIVATE_REQUEST_TABLE')
  const baseline = { source, extraRows, services, inventory, metadata }
  mkdirSync(directory, { recursive: true }); writeFileSync(directory + '/baseline.json', JSON.stringify(baseline), { flag: 'wx' })
  // Values stay in the private test process; public evidence retains shapes/counts only.
  const shape = [...new Set(admin.data.map(row => Object.keys(row).sort().join(',')))]
  const receipt = { result: 'PASS_READ_ONLY_INSTALLED_CONTRACT', run, observedAt: new Date().toISOString(), cluster: source.cluster,
    target: metadata.target, schoolRole: metadata.school_role, directoryRows: admin.data.length, rowFields: shape,
    functionBindings: metadata.functions.map(({ source, ...rest }) => ({ ...rest, sourceSha256: digest(source.replaceAll('\r\n', '\n')) })),
    privateTableRls: metadata.table_rls, browserTableRead: metadata.direct_browser_read, existingReviewRequests: metadata.review_count,
    migration007Absent: metadata.migration007_absent, readChecks: { ADMIN: 'PASS', STUDENT: student.code, CASHIER: cashier.code },
    authenticationBoundary: 'Trusted operator read-only SQL using current real account UUIDs and authenticated role; no browser JWT or live Google session was read.',
    proposalSha256: digest(readFileSync('supabase/20261019000900_staff_directory.PROPOSED.sql')), retainedWrites: false }
  const path = `tests/integration/results/add_staff_inspection_${run}.json`; writeFileSync(path, JSON.stringify(receipt, null, 2), { flag: 'wx' }); console.log(JSON.stringify({ ...receipt, evidence: path }))
} catch (error) { console.log(JSON.stringify({ result: 'FAIL_STOPPED', code: /^ASF_[A-Z_]+$/.test(error.message || '') ? error.message : 'ASF_INSPECTION_STOPPED' })); process.exitCode = 1 }
