# Engineering report: retained-local migration 006

Date: October 16, 2026. Final task result: **FAIL — stopped during backup preparation**.
**Migration execution was NOT ATTEMPTED.** Migration 006 remains unapplied.
The failed check was in newly written backup automation; it does not demonstrate
a defect in the reviewed migration SQL. No verified recoverable backup was produced.

## Verified project and preflight

| Item | Observed result |
| --- | --- |
| Working directory | C:\Users\Hp\school-queue-management-system |
| Supabase project | school-queue-local |
| API | http://127.0.0.1:54321 |
| PostgreSQL client target | 127.0.0.1:54322, database postgres, user postgres |
| PostgreSQL server | 17.11; container internal port 5432 |
| Containers | supabase_db_school-queue-local; supabase_kong_school-queue-local |
| Database volume | supabase_db_school-queue-local |
| Network | supabase_network_school-queue-local |
| Applied migrations | 20261016000100 through 20261016000500 |
| Only pending migration | 20261016000600_fixed_counter_routing.sql |
| Original five migration integrity | Original SHA-256 hashes match |
| Migration 006 integrity | Matches both previously validated fresh/upgrade copies |
| Accounts / tickets / events | 39 / 20 / 57 |
| Replay records / administrative audits | 69 / 31 |
| Counters / services | 5 / 5 |
| Active WAITING/CALLED tickets | 0 |
| Queue days | All seven closed, including the current institution-local day |

The retained published ports match the existing project configuration. Their
existing wildcard IPv4/IPv6 bindings were inspected and left unchanged; all task
connections explicitly targeted 127.0.0.1. No container, network or volume was
reconfigured. CLI status and database credentials were captured in memory only.

Current staff assignment totals and eligible cashier counts matched the reviewed
report: Counter 1 has 1/1, Counter 2 has 1/1, Counters 3/4 have 0/0, Counter 5 has
2 total/1 eligible. Counter 5's deliberately stale STUDENT assignment remains intact.
No identities, assignments, replay responses or historical records were modified.

The comprehensive safety preflight passed. The read-only baseline includes every
application/display row, Auth users/identities, schema/table/function ownership and
ACLs, RLS policies, default privileges and function body hashes. Its row fingerprints
also match the previous isolated-validation task's retained baseline.

## Backup failure and recovery status

A new ignored directory was created:

`C:\Users\Hp\school-queue-management-system\.local-backups\20261016T122435Z_f56966ea`

NTFS permission inheritance was removed; access was granted only to the current
Windows user and SYSTEM. Git ignore and absence of tracked backup files were checked.
The restricted execution identity could not list this protected directory; the
approved read-only diagnostic confirmed that it contains **no .dump archive**.

Backup preparation failed while computing source-snapshot fingerprints, before
the `pg_dump` command. The harness found **69 non-system tables** and generated
one `jsonb_build_object` call with **138 arguments**. PostgreSQL rejected that
read-only SELECT with **SQLSTATE 54023**. A separate read-only reproduction confirmed
the same error. Cleanup of the exited psql process also surfaced a Windows pipe
`OSError [Errno 22]`, obscuring the primary failure in the initial terminal message.

| Backup requirement | Result |
| --- | --- |
| Protected, ignored timestamped directory | Passed |
| Full custom-format archive created | Not reached; no archive exists |
| Archive size / checksum | Unavailable; no file |
| Roles/ownership supplement | Not reached |
| pg_restore structural inspection | Not reached |
| Isolated full restore | Not run |
| Restored row/schema/security comparison | Not run |
| Recoverability verified | **No** |

The directory is retained. There is no verified recovery artifact from this attempt,
so it must not be treated as a backup. No recovery database/container/volume was
created. The restore-verification portion of the new harness is unexecuted scaffolding,
not a validated recovery procedure.

PostgreSQL's documented custom archive and restoration workflow remains the intended
method: [pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html),
[pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html), and password-free
global role prerequisites through [pg_dumpall](https://www.postgresql.org/docs/18/app-pg-dumpall.html).

## Routing and data preservation

The final read-only diagnostic confirmed the same migration history, counts,
staffing, queue-day status, routing and security state as the preflight.

| Counter | Before this task | After this task | Approved target, not applied |
| --- | --- | --- | --- |
| 1 | SOA, TP | SOA, TP | TP |
| 2 | SOA, TP | SOA, TP | SOA |
| 3 | None | None | PNEP |
| 4 | None | None | REF |
| 5 | None | None | ADJ |

All retained application/display and Auth user/identity row fingerprints are
unchanged. Existing schema ownership, grants, RLS policies and function hashes are
unchanged. All **15** application tables retain RLS. Browser roles still lack
queue_private schema access. Realtime still publishes only
queue_display.counter_state and queue_display.service_state.

No new routing uniqueness constraints, validation triggers, private helpers or
configure_counter implementation were installed in the retained database. No new
cutover audit or migration-history entry exists. No public projection refresh was
performed. The original ticket numbers, ticket/event rows, accounts/profiles,
allocators, cashier assignments, 69 replay records and 31 audit records remain intact.

No migration transaction began, so migration rollback is not applicable. The failed
fingerprint query ran in a read-only transaction; the connection ended without
database changes. The subsequent integrity comparisons verified preservation.

## Checks executed and skipped

| Check/group | Result |
| --- | --- |
| Comprehensive environment/state/integrity preflight | PASS |
| Backup preparation | **FAIL** |
| Read-only SQLSTATE diagnosis and final preservation check | PASS |
| New Python harness syntax check | PASS |
| Git diff whitespace check | PASS |
| Archive verification and isolated restoration | SKIPPED — no archive |
| Migration application and mandatory post-migration checks | SKIPPED — backup gate failed |
| Database lint | SKIPPED |
| Targeted rollback-only pgTAP | SKIPPED |
| Read-only HTTP authorization/schema suite | SKIPPED |
| Structural migration suite | SKIPPED |
| Frontend unit suite | SKIPPED |
| Frontend production build and bundle secret scan | SKIPPED |

No regression suite was executed in this run. The six regression/check groups
listed after migration application were skipped because the requested stop rule
was reached. Previous isolated-validation pass counts were not rerun or claimed
as current cutover results. No fresh bootstrap, concurrency fixture, day reopening,
test-user creation, ticket mutation, system-clock change or reset occurred.

Machine-readable evidence:
[retained_migration_006.json](tests/results/retained_migration_006.json).
It records the preflight, original hashes, final state, preservation fingerprints
and the reproduced SQLSTATE without keys, JWTs, passwords or student identities.

## Proposed correction and next step

The minimal correction is in test/backup automation, requiring **no migration SQL
change**:

1. Aggregate per-table fingerprint rows with `jsonb_object_agg`, instead of passing
   every table as a separate argument to one variadic constructor.
2. Make snapshot-process cleanup tolerate a closed pipe and retain sanitized
   PostgreSQL error codes, so cleanup cannot mask the primary failure.
3. Validate the corrected fingerprint routine against the complete 69-table catalog.
   Normalize any cross-cluster ownership/default-privilege comparison to names rather
   than physical catalog OIDs before certifying restore verification.
4. Start a new safety preflight and backup attempt; inspect the archive, restore
   it into a separate isolated database and verify restored data/schema/security.
   Only after that proof and a fresh unchanged-state check may migration 006 proceed.

These corrections and a backup retry were **not performed after the failure**.
The current task was stopped as explicitly requested. Further development should
first complete backup recoverability validation; operational frontend integration
and Google Sign-In are not the next action for this blocked cutover.

## Files and isolation

Created:

- supabase/tests/retained_migration_006.py — guarded preflight, backup/restore scaffolding
  and read-only failure diagnosis. It has no migration-application command.
- supabase/tests/results/retained_migration_006.json — sanitized failure/preservation evidence.
- supabase/RETAINED_LOCAL_MIGRATION_006_REPORT.md — this report.
- The protected empty timestamped directory under .local-backups/.

Modified `.gitignore` to exclude `.local-backups/`. No migration file, frontend
source, dependency, environment file, Auth credential/provider setting, RLS policy
or existing grant was modified. No hosted endpoint was contacted; no link, db push,
db reset, Docker volume deletion, deployment, Git commit or push occurred.

**Stopped before migration application. Awaiting further instructions.**
