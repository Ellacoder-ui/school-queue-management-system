# Engineering report: retained-local migration 006 — applied, validation stopped

Date: October 16, 2026. Overall task result: **FAIL — stopped at the mandatory
postflight constraint-inventory check.** The requested filename is retained, but
it does not indicate a successful validation run.

**Migration 006 was successfully committed.** The Supabase CLI exited 0, the database
contains six migration versions, and the exact permanent routing is installed.
The failure was in newly written comparison automation, which omitted three expected
constraint-trigger catalog entries. Read-only diagnosis confirmed the reviewed
changes and data preservation. Regression suites were not started after the failure;
full retained-local validation is therefore incomplete.

## Target, authorization and recovery gate

The attached request explicitly authorized only migration 006 and its reviewed
retained-local configuration changes, conditional on recovery and preflight.

| Item | Verified value |
| --- | --- |
| Project/workdir | school-queue-local / C:\Users\Hp\school-queue-management-system |
| API | http://127.0.0.1:54321 |
| PostgreSQL client endpoint | 127.0.0.1:54322/postgres, user postgres |
| PostgreSQL server | 17.11; container internal port 5432 |
| Cluster system identifier | 7696959712798593061 |
| Database container/volume | supabase_db_school-queue-local / supabase_db_school-queue-local |
| Gateway/network | supabase_kong_school-queue-local / supabase_network_school-queue-local |
| Migration | 20261016000600_fixed_counter_routing.sql |
| Migration SHA-256 | 9d854ab795e3ef3098fa1d3a05cb6541242d0c8e503a8ebee1acfe9df418137c |

The existing read-only command `python supabase/tests/schema_privilege_recovery.py verify`
passed before cutover. It checked all original and supplemental artifact hashes,
restricted NTFS access, source association, the completed isolated recovery evidence,
and the stopped recovery destination. The full restore was not repeated.

Protected recovery directory:

`C:\Users\Hp\school-queue-management-system\.local-backups\20261016T135430Z_46a582fc`

The archive, source manifest, password-free roles, exact schema supplement, separately
approved database prerequisites and matching platform remain the verified recovery
unit. Their files and checksums were checked again read-only after cutover. No artifact
was modified, restored, deleted or uploaded. See the
[backup validation report](RETAINED_LOCAL_BACKUP_VALIDATION_REPORT.md) for the complete
artifact list and recovery order.

## Fresh preflight and integrity evidence

Independent preflight and an immediate pre-apply repeat confirmed:

- Exactly the original five migrations applied; only the reviewed sixth pending.
- All six migration-file hashes match their validated versions; the original five
  SQL files and both validated isolated copies of migration 006 are unchanged.
- All 69 logical table counts/fingerprints match the verified backup snapshot.
- Schema/security metadata, global roles/memberships, sequence states, partition
  inventory and additional ACL/database-setting hashes match their recovery baselines.
- Five services/counters, original legacy routing and staffing, all seven days closed,
  the current Manila day closed and zero WAITING/CALLED tickets.
- 39 accounts, 20 tickets, 57 events, 69 replay records and 31 administrative audits.
- All 15 application tables have RLS, browser roles lack queue_private usage and the
  queue Realtime publication contains only counter_state and service_state.

Sanitized preflight evidence includes full row hashes, metadata and aggregate state,
not raw private records, Auth identities, passwords, JWTs or sensitive setting values.

## Migration execution and routing

The one-shot runner executed the existing local CLI workflow:

~~~text
supabase migration up --local --workdir <verified project directory> --network-id supabase_network_school-queue-local
~~~

The installed CLI was invoked through the project's existing local dependency.
The runner refused additional pending migrations and reverified the target/state
immediately before execution. No hosted or linked target, include-all, reset, push
or custom replacement SQL was used.

| Counter | Before | After |
| --- | --- | --- |
| 1 | TP, SOA | TP |
| 2 | TP, SOA | SOA |
| 3 | None | PNEP |
| 4 | None | REF |
| 5 | None | ADJ |

The two conflicting relationships were removed, the two canonical existing pairs
retained, and the three missing pairs added. No counter availability, staff, role,
service enabled flag or queue-day state changed.

The CLI exited **0** without a reported SQLSTATE. Migration history contains exactly
20261016000100 through 20261016000600. The original five history rows are unchanged,
and the sixth appears once with its migration statements/name. The transaction is
committed; no rollback, migration retry or automatic backup restore was attempted.

## Postflight failure and exact root cause

The new `compare_schema()` routine in tests/apply_retained_migration_006.py expected
only two additions in its pg_constraint inventory:

- counter_services_one_service: UNIQUE(counter_id).
- counter_services_one_counter: UNIQUE(service_id).

PostgreSQL also creates pg_constraint entries for the three reviewed constraint
triggers. The actual additional entries were:

| Relation | Catalog entry | Type / definition |
| --- | --- | --- |
| queue_private.counter_services | fixed_routing_complete | t / TRIGGER DEFERRABLE INITIALLY DEFERRED |
| queue_private.counters | fixed_counters_complete | t / TRIGGER DEFERRABLE INITIALLY DEFERRED |
| queue_private.services | fixed_services_complete | t / TRIGGER DEFERRABLE INITIALLY DEFERRED |

This is documented PostgreSQL behavior: user-defined constraint triggers also create
entries in [pg_constraint](https://www.postgresql.org/docs/17/catalog-pg-constraint.html).
The checker raised `Unexpected constraints additions/removals` without a PostgreSQL
error. It had counted those objects only under pg_trigger.

The required stop rule was observed. The checker expectation was not changed to
continue, no migration or database object was altered, and no regression suite was
run. The original FAIL and failing phase remain in the evidence. A separate read-only
diagnostic records why these three entries are expected; it does not convert this
task to PASS or replace unexecuted regression evidence.

## Read-only diagnosis and preservation

All **24 diagnostic checks passed**, including:

- Same retained identity, exact six-version history and exact five canonical routes.
- All 65 tables outside the four approved change categories are byte-for-byte
  unchanged according to canonical row fingerprints. This includes all Auth tables,
  accounts/profiles, services/counters, staff, tickets/events, days, numbering
  allocators, settings and operation requests.
- All 31 original audit rows are unchanged, with exactly one new actor-null
  FIXED_ROUTING_CUTOVER audit containing the expected before/after matrices and version.
- All 69 replay records are unchanged, including their saved historical responses.
  No replay RPC was executed in this retained run; behavioral replay testing remains
  the earlier isolated evidence.
- All five original migration-history rows are unchanged, plus exactly the sixth row.
- Five public counter rows retain the same content except expected updated_at refreshes;
  no public ticket label remains. Service projections remain empty because all days
  are closed. Audit/display timestamps fall within the observed cutover interval.
- All 11 other semantic schema sections are identical. Existing functions, owners and
  ACLs are unchanged except the reviewed configure_counter definition replacement.
- All 23 application function bodies match the final migration definitions. Issuance,
  call-next, finish-ticket, quotas and skip algorithms match their original bodies.
- Exactly four new private functions have the reviewed signatures, language,
  volatility/definer flags, pinned empty search_path and owner-only EXECUTE ACLs.
- Constraint changes are exactly two UNIQUE constraints and the three constraint-trigger
  entries; existing constraints remain unchanged. Both new unique indexes are valid/ready.
- Exactly six reviewed triggers are enabled; the three canonical-coverage checks are
  DEFERRABLE INITIALLY DEFERRED with the expected functions/events.
- Global roles, memberships, sequence states, partition/table inventory, type/column/
  sequence/database ACLs and database-setting hashes remain unchanged.
- RLS, original grants/policies and publication boundaries remain unchanged. Counters
  1/2 stay open, Counters 3/4/5 stay closed; all seven days remain closed and no ticket
  is active. Counter 5's deliberately stale STUDENT staff fixture remains intact.
- All protected recovery artifacts remain unchanged and access-restricted.

No additional database-integrity or security difference was observed by diagnosis.
This is catalog/data evidence, not an execution of the deferred negative-DML tests,
HTTP authorization matrix, or application acceptance suites.

## Tests executed and skipped

| Check/group | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| New offline cutover safety methods | 8 | 0 | 0 |
| Existing read-only recovery artifact/source gate | 1 | 0 | 0 |
| Fresh source/preflight and immediate recheck | 1 | 0 | 0 |
| Supabase CLI migration application | 1 | 0 | 0 |
| Mandatory composite postflight checker | 0 | 1 | 0 |
| Subsequent read-only diagnostic checks | 24 | 0 | 0 |
| Database lint | 0 | 0 | 1 |
| Fixed-routing rollback-only pgTAP | 0 | 0 | 1 suite — 44 assertions not executed |
| Read-context rollback-only pgTAP | 0 | 0 | 1 suite — 44 assertions not executed |
| Structural migration checks | 0 | 0 | 1 suite — 6 methods not executed |
| Read-only HTTP/schema authorization checks | 0 | 0 | 1 suite — 7 planned checks not executed |
| Frontend unit tests | 0 | 0 | 1 suite |
| Production build/private-key bundle scan | 0 | 0 | 1 group |
| Legacy bootstrap/concurrency/fixture-generating suites | 0 | 0 | Excluded by safety rules |

Counts are separate methods/check groups, not one aggregate assertion total. Earlier
isolated/backend/frontend pass counts were not rerun or claimed for this cutover.
The eight offline methods did not include the constraint-trigger catalog representation;
that missing test explains why the checker bug survived offline verification.

Python syntax and workspace diff whitespace checks passed. No desktop/mobile browser
run was performed. No test was removed or security control weakened.

## Files created

- tests/apply_retained_migration_006.py — one-shot authorized local cutover, immutable
  backup gate, full baseline, strict postflight and gated regression orchestration.
  It refuses another apply when its evidence already exists. The documented constraint
  expectation bug remains uncorrected after the stop.
- tests/test_retained_cutover.py — eight offline safety/comparison methods.
- tests/diagnose_retained_cutover.py — read-only diagnosis and preservation capture;
  no migration, restore or regression execution.
- tests/results/retained_migration_006_cutover.json — sanitized preflight, original
  failure, successful migration outcome, final state and read-only diagnostic evidence.
- RETAINED_LOCAL_MIGRATION_006_SUCCESS_REPORT.md — this report, explicitly marked FAIL.

Paths above are relative to supabase/. No previous migration, existing test,
application/frontend file, dependency, environment file, RLS policy, grant or Auth
provider setting was modified. Prior failure/recovery reports remain historical records.

## Recovery limits and next instruction

The verified bundle remains a recovery point for the **pre-migration five-version
database**. It has not become a backup of the new six-version state. Its complete
restore prerequisites and service-level exclusions still apply: global passwords,
external Auth/provider/JWT/encryption configuration, storage files, infrastructure
and replication progress require separate recovery procedures. Artifacts are locally
permission-protected, not encrypted. No automatic rollback restore is appropriate.

The old `schema_privilege_recovery.py verify` command intentionally compares the live
source to the old five-version snapshot and will now reject the approved cutover
differences. Do not rewrite that snapshot or rerun the cutover merely to satisfy it.
Artifact hashes and protected access were verified separately after the migration.

The next task should explicitly authorize correcting the comparator to include and
strictly validate the three named type-t constraints, add the missing offline case,
and validate the **already-applied** migration without applying it again. Then run
the skipped fixture-safe lint, two rollback-only pgTAP files, structural/read-only
HTTP checks, frontend tests and local production build/private-key scan. Capture a
fresh post-cutover recovery point before later database-changing work.

Google Sign-In and shared Student/Payor integration should wait for that validation.
Subsequent design still needs admission/provisioning, payor identity and quota/
beneficiary rules, reviewed local Google callback/provider setup, protected session
recovery and administrator MFA decisions. This run configured none of those features
and enabled no operational frontend ticket issuance.

No hosted Supabase endpoint was contacted. No reset, db push, link, Docker volume
deletion, deployment, Google setup, Git commit or push occurred. Credentials and raw
diagnostics stayed in process memory; reports contain no private keys, JWTs or passwords.

Evidence: [cutover and stopped validation](tests/results/retained_migration_006_cutover.json).

**Stopped after the mandatory postflight failure. Migration 006 is committed; complete
retained-local regression acceptance awaits a new instruction.**
