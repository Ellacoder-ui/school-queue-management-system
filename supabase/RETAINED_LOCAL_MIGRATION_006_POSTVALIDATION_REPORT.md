# Engineering report: migration 006 retained-local postvalidation

Date: October 16, 2026. Result: **PASS — the already-applied migration 006 passed
the requested retained-local postflight and fixture-safe regression checks.**
No migration was applied or database restored during this task. The previous FAIL
report and evidence remain unchanged. This result completes the specified local
validation scope; it does not establish production readiness.

## Original application and checker repair

The preceding task committed 20261016000600_fixed_counter_routing.sql successfully
through the local Supabase CLI. Its postflight then stopped because compare_schema()
expected only two UNIQUE additions to pg_constraint. The three reviewed constraint
triggers also have entries in that catalog; they were previously counted only under
pg_trigger. No application SQL error caused that stop.

The corrected comparison explicitly requires these five new catalog records:

| Relation | Constraint | Type | Definition / deferrability |
| --- | --- | --- | --- |
| queue_private.counter_services | counter_services_one_service | u | UNIQUE (counter_id); not deferrable |
| queue_private.counter_services | counter_services_one_counter | u | UNIQUE (service_id); not deferrable |
| queue_private.counter_services | fixed_routing_complete | t | TRIGGER DEFERRABLE INITIALLY DEFERRED |
| queue_private.counters | fixed_counters_complete | t | TRIGGER DEFERRABLE INITIALLY DEFERRED |
| queue_private.services | fixed_services_complete | t | TRIGGER DEFERRABLE INITIALLY DEFERRED |

Validation checks exact schema, relation, name, type, definition, validated state,
deferrability and initial-deferred state. Every constraint trigger is cross-checked
through its actual pg_trigger-to-pg_constraint link, enabled state, full definition,
event/row/timing flags and function. All six new triggers must match exactly, including
the three BEFORE STATEMENT mutex triggers. Existing constraints/triggers remain equal
to the original pre-cutover snapshot. Missing, extra, renamed, disabled or altered
objects fail; constraint differences are not ignored.

The original migration SQL, RLS, grants and database objects were not changed to fix
the checker. All six migration files retain their validated SHA-256 hashes.

## Verified retained target and read-only postflight

| Item | Verified value |
| --- | --- |
| Project/workdir | school-queue-local / C:\Users\Hp\school-queue-management-system |
| PostgreSQL client endpoint | 127.0.0.1:54322/postgres |
| API | http://127.0.0.1:54321 |
| Server / cluster identifier | PostgreSQL 17.11 / 7696959712798593061 |
| Database container / volume | supabase_db_school-queue-local / supabase_db_school-queue-local |
| Gateway / network | supabase_kong_school-queue-local / supabase_network_school-queue-local |
| Applied migration versions | Exactly 20261016000100 through 20261016000600 |
| Migration 006 receipt | Present once; original five history rows unchanged |

The new verification-only entry point, tests/validate_retained_migration_006.py,
inspected the existing six-version database. It never called the original apply
entry point, migration execution, restoration, reset, push or link. Its CLI task
allowlist permits only local lint and the two reviewed rollback-only pgTAP files.

Read-only postflight used the original pre-cutover snapshot in
tests/results/retained_migration_006_cutover.json. It also required exact equality
with that file's recorded post-cutover state, preventing subsequent changes from
silently becoming a new baseline. The five-version recovery snapshot was not used
as a current-source equality check or rewritten.

The permanent mapping is:

| Counter | Service |
| --- | --- |
| 1 | TP |
| 2 | SOA |
| 3 | PNEP |
| 4 | REF |
| 5 | ADJ |

Postflight confirmed both uniqueness constraints, all three deferred constraint
records, all six triggers, configure_counter's reviewed replacement and all **23
application function bodies**. Issuance, call-next and finish-ticket match their
original migration definitions. Function owners, ACLs, search paths and existing
security definitions remain correct.

## Test results

Completed run: October 16, 23:53:36–23:54:13, UTC+08:00.
Repeated offline executions are not added together.

| Validation | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Existing and new offline cutover methods | **19** | **0** | **0** |
| Fixed-routing pgTAP assertions | **44** | **0** | **0** |
| Read-context pgTAP assertions | **44** | **0** | **0** |
| Offline structural migration methods | **6** | **0** | **0** |
| Actual read-only HTTP authorization/schema checks | **7** | **0** | **0** |
| Frontend unit/controller/rendering tests | **51** | **0** | **0** |
| Database lint --local | No schema errors | 0 | 0 |
| Local frontend production build | PASS | 0 | 0 |
| Built-bundle known-private-key scan | PASS | 0 | 0 |
| Corrected read-only postflight / final preservation | PASS | 0 | 0 |

The 19 offline methods retain all eight existing cases and add the requested catalog
regressions: exact UNIQUE/constraint-trigger records, relation/type/name enforcement,
deferrability/validation flags, missing/extra constraints, altered definitions,
disabled/mismatched triggers and preservation of existing constraints. Additional
cases reject migration/restore task names and unsafe transaction envelopes.

Both database suites matched their previously validated isolated copies, began with
BEGIN and ended with ROLLBACK. They contain no committing transaction boundary or
reviewed nontransactional sequence operation. Runtime checks compared all 69 table
fingerprints, schema/security metadata, roles, sequence states and additional ACLs
after each suite. **All fixture changes rolled back; no test users, days, receipts,
audits, assignments or schema objects were retained.**

The fixed-routing suite exercised invalid second/reused/wrong/missing routes,
renumber/code/deletion/truncation guards, valid final-state transactions, disabled
service filtering, authorized counter open/close and cashier assignments, wrong-service
calling, student/cashier/disabled authorization denial and private helper grants.
The read-context suite covered authoritative roles, owner-only counter context,
metadata promotion resistance, disabled/revoked/missing/anonymous subjects, public
data minimization and deterministic business-date projections.

Lint exited 0 with `No schema errors found`. The frontend build used local process
configuration and the public key only. The bundle scan found no known local service-role
or secret key in generated JavaScript; it is a check for those captured values, not
a universal proof that every possible secret is absent.

One initial Python bytecode syntax check met a local filesystem permission error.
The permitted rerun passed. No application/security test or required verification
failed in the completed run. Python syntax and diff whitespace checks passed.

## HTTP and security boundary results

HTTP checks used only http://127.0.0.1:54321 and a public API key, with redirects
refused. No Auth session or user was created. The seven checks covered:

- GET counter_state: five sanitized rows, explicit column allowlist and no stale
  ticket/service/date labels.
- GET service_state: the expected empty closed-day projection.
- POST public_queue_context: exact sanitized catalog/timezone/current-date contract,
  independently matched to the database; queue_day_open=false.
- Anonymous POST my_context: denied with 42501.
- queue_private REST profile: rejected with PGRST106.
- Public-schema tickets fallback: rejected with PGRST205.
- queue_api OpenAPI: no private table/helper paths or unexpected endpoint exposure.

All **15 application tables retain RLS**. Browser roles still lack queue_private
USAGE and private table access. Existing policies/default privileges and table/function
ACLs are unchanged. The four new private helper functions retain owner-only EXECUTE
and reviewed empty search paths. The public queue Realtime publication still contains
only queue_display.counter_state and queue_display.service_state.

Authenticated role behavior was exercised through the rollback-only pgTAP fixtures;
this run did not create real authenticated HTTP sessions or repeat the earlier full
HTTP/Realtime matrix. It verified unchanged publication/grant boundaries, rather than
performing a new live WebSocket privacy acceptance run.

## Final data and artifact preservation

All 69 logical tables and their inventories were checked. Against the original
pre-cutover snapshot, the only persistent differences remain those approved for
migration 006: five canonical relationship rows, one cutover audit, one migration
history row, expected counter-display timestamps and reviewed schema additions/
function replacement. The other **65 tables** remain identical to that snapshot.
Against this task's initial six-version state, **all 69 tables and all captured
schema/security/role/sequence metadata remain unchanged**.

Final retained state:

- 39 accounts, 20 terminal tickets, 57 events and 69 unchanged replay receipts.
- 32 administrative audits: all 31 original rows unchanged plus exactly the expected
  FIXED_ROUTING_CUTOVER audit from the previous task. No new audit was retained here.
- Seven closed queue days, including the current Manila day; zero WAITING/CALLED tickets.
- Five counters/services; original counter availability and all four staff assignments
  unchanged. Counter 5's deliberately stale STUDENT fixture assignment remains intact
  and grants no cashier authority.
- Original Auth users/identities, profiles, ticket numbers, history, numbering allocators
  and queue settings unchanged.
- Global roles/memberships, all three sequence states, partition inventory and explicit
  column/type/sequence/database ACLs/settings hashes unchanged.

Recovery artifact hashes, source associations, Git exclusion and restricted NTFS
access were verified before and after testing. No archive, manifest, role or supplemental
artifact was changed. The verified bundle remains a **pre-cutover five-version recovery
point**, not a backup of the current six-version database. No restore was performed.

The historical FAIL evidence remains byte-for-byte unchanged:

`74a885340d90f7876948926e84ce9c8048b49629b2abec13fe6ecca9fbebf056`

Its prior report was also hashed and confirmed unchanged. The new PASS evidence is
separate and does not rewrite the earlier stop.

## Files created or modified

| File | Change |
| --- | --- |
| tests/apply_retained_migration_006.py | Correct exact catalog comparison; add constraint identity/type and trigger-link inspection; preserve strict existing-object checks |
| tests/test_retained_cutover.py | Expand from 8 to 19 offline methods, preserving prior cases |
| tests/validate_retained_migration_006.py | New verification-only runner, restricted CLI tasks, immutable historical evidence, rollback/preservation checks and safe regression orchestration |
| tests/results/retained_migration_006_postvalidation.json | New sanitized completed-run evidence |
| RETAINED_LOCAL_MIGRATION_006_POSTVALIDATION_REPORT.md | This report |

Paths are relative to supabase/. dist/ was regenerated as an ignored build artifact.
No migration SQL, database test SQL, prior report/evidence, frontend source, package
dependency, environment file, Auth provider configuration, RLS policy or grant changed.
No backup or Docker volume was deleted. No hosted project was contacted, deployment
performed, Google OAuth configured, frontend issuance enabled, Git commit or push made.

## Scope, exclusions and next step

**Migration 006 is validated locally for the requested retained-data scope.** All
required safe checks completed; none was skipped. Legacy fresh-bootstrap tests and
persistent fixture-generating concurrency/API/Realtime/browser suites were deliberately
excluded from this retained database. Their earlier disposable results remain historical
evidence, not new counts. No desktop/mobile browser acceptance run was performed.

Real midnight contention, sustained load, broader reconnect schedules and complete
operational UI acceptance remain separate gates. The retained day stayed closed;
positive issuance was not forced here. Its earlier successful isolated HTTP checks
do not authorize operational frontend enablement or hosted deployment.

Before further database-changing work, capture and actually verify a fresh recovery
bundle for the six-version state. Then resolve admission/provisioning and outside-payor
identity, beneficiary/quota and remote-arrival rules. Google Sign-In requires a separate
reviewed local provider/callback/PKCE task; administrator MFA remains a policy gate.
None of those changes is authorized by this validation result.

Executed command:

~~~powershell
python supabase/tests/validate_retained_migration_006.py --validate
~~~

The runner refuses overwriting its completed evidence; do not rerun the original apply
command or the old five-version source-equality verifier. A repeat validation should
use an explicitly reviewed new evidence identity.

Machine-readable evidence:
[retained migration 006 postvalidation](tests/results/retained_migration_006_postvalidation.json).

Evidence SHA-256:
`5940878a90c15b91eafeed1ec83f536a9ea8f424a723d92b773783b2420804c2`

**Stopped after successful local postvalidation. No migration was applied again.**
