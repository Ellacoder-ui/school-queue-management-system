# Step 22.8D: Analytics recovery and locked Vector integration review

October 18, 2026. **Inspection, locked review and disposable tests completed;
final readiness BLOCKED by the unchanged 70-table recovery prerequisite.** A new
empty Realtime partition appeared after the passing combined run. Retained Vector
repair and Google activation remain locked. The next task should protect **the complete
`_supabase` database with a separately authorized backup and actual isolated restore**,
and review the now-71-table postgres recovery inventory, before retained Vector repair.
No new retained backup/restore, retained service operation or SQL write ran here.

Combined validation **377dcd35** completed October 18, **03:37:40–03:40:34 UTC+08:00**.
Its 37 offline methods and 24 Windows/Engine synthetic checks passed. A later fixed
socket probe **7646b570**, **12:05:58–12:06:27**, also passed. The last passing read-only
assessment **f93ecba4** completed **12:21:58–12:22:30**. The subsequent strict
preflight stopped at **12:27:09–12:27:14**; read-only diagnosis **f9a8d09f** completed
**12:29:25–12:29:41**. These are separate observation
windows; they do not establish continuous retained health between them.

## Late prerequisite stop: preserved separately from earlier PASS

The last inspector run, **3839691a**, stopped before its new inventory checks because
`google_credential_preflight.py` still requires exactly the reviewed 70-table catalog.
Read-only diagnosis found **71 tables**, with one added empty
`realtime.messages_2026_10_21` and no removed table. The unchanged independent Realtime
classifier accepted its exact template/catalog/security pattern within its reviewed
date window and confirmed all other application/Auth/history/security state. This
supports platform-maintenance classification, not an independently proven creation
time or writer. The task issued no DDL.

**The classifier result does not turn the separate strict 70-table prerequisite into
PASS.** That prerequisite, its historical source/manifests and all previous FAIL/PASS
evidence remain unchanged. No disposable operations were repeated after this stop;
only diagnosis and reporting followed. The old bundle remains a verified historical
70-table recovery point. A later task must review the current inventory and its
recovery/preflight binding without rerunning the old hardcoded backup path or silently
rebasing its manifest. Fresh current-inventory postgres recovery may be required by
the later infrastructure plan alongside the separate Analytics recovery.

The read-only collector was also strengthened to cross-check CLI project labels,
Compose project labels and canonical project names. A Compose-only or unlabeled
canonical extra cannot disappear from the twelve-container model. Its new regression
and actual read-only discovery passed in the stopped-run diagnosis. The strict source
prerequisite remains failed despite that successful independent discovery.

Evidence: [stopped strict preflight](tests/results/vector_analytics_assessment_3839691a.json),
[diagnosis with unchanged classifier](tests/results/vector_analytics_stopped_diagnosis_f9a8d09f.json).

## Analytics database findings

| Property | Read-only observation |
| --- | --- |
| Project/workdir | school-queue-local / C:\Users\Hp\school-queue-management-system |
| Client target | 127.0.0.1:54322/_supabase; primary, repeatable-read/read-only transactions |
| PostgreSQL/cluster | 17.11 / 7696959712798593061 |
| Retained container/volume | supabase_db_school-queue-local / supabase_db_school-queue-local |
| Database owner/tablespace | postgres / pg_default |
| Encoding/locale | UTF8; ICU en-US; en_US.UTF-8 collation and ctype |
| Database size | 11,679,411 bytes, approximately 11.14 MiB |
| Non-system schemas | _analytics, _supavisor, public |
| Tables | 39, all in _analytics; _supavisor/public have no user tables |
| Storage/persistence | 38 permanent tables; one unlogged table, oban_peers |
| Partition hierarchy | No partitioned table or attached leaf; all 39 are ordinary tables |
| Relation storage | 2,539,520 total bytes at the measured capture, including 1,671,168 index bytes |
| Owners | Nine log-event tables: postgres; remaining 30 tables: supabase_admin |
| Extension | plpgsql 1.0, pg_catalog, owner supabase_admin |
| Additional dependencies | No foreign tables/servers/wrappers, large objects, materialized views, subscriptions or prepared transactions |

Analytics remains the healthy Logflare **1.53.0** container with the previously
reviewed image ID. Earlier and current service inspections bind it to `_supabase`
on the retained cluster. No connection string, backend row or log payload is emitted.
The assessment covers the entire database, including the two other schemas.

The catalog contains **359 columns, 74 constraints, 93 indexes, 28 sequences and one
enum/domain type**. There are no captured non-system functions, user triggers,
policies or default-privilege entries. The 39 entries in the metadata section named
`partitions` describe every table's ancestry; they are **not 39 actual partitions**.
All tables have RLS/forced RLS false. Effective checks deny anon, authenticated and
service_role `_analytics` USAGE and all table SELECT/write privileges. These controls
were observed and preserved; no RLS or grant repair was attempted.

The three schema owners and complete schema/database ACLs are recorded in sanitized
evidence. `_analytics` and `_supavisor` are owned by postgres; public is owned by
pg_database_owner. Existing database PUBLIC CONNECT/TEMPORARY entries remain intact.
There are **31 cluster roles and 25 memberships**, compared without passwords. No
database-specific or role-in-this-database setting entry was found. Global role
settings and server preload prerequisites are still recovery dependencies; their
hashes are captured without revealing sensitive values.

Publication **logflare_pub**, owned by supabase_admin, contains 11 tables and enables
INSERT/UPDATE/DELETE/TRUNCATE. One active **temporary logical pgoutput slot**, held by
supabase_admin, was observed. Its name/progress are represented only by hashes. The
temporary slot identity and progress differ across the later observations. No
consumer application name was supplied, so exact client attribution is not claimed.
No slot was consumed, advanced, dropped or created by these tools.

Assessment evidence:
[f93ecba4](tests/results/vector_analytics_assessment_f93ecba4.json).

## Data that must be protected

| Category | Finding and recovery decision |
| --- | --- |
| Log-event storage | Nine `log_events_<source>` tables, all currently empty. Preserve their DDL, indexes, ownership and every future row. Emptiness does not authorize omission or deletion. Public evidence aliases source identifiers. |
| Configuration and authorization | sources, users, endpoint queries, OAuth authorization tables, versions, plans, rules, backend associations, searches, key/value and related tables. Preserve every table and record, including empty tables. Some records are sensitive independently of Google credentials. |
| Platform migration history | 180 Analytics schema_migrations rows. These are separate from the application's six migrations in postgres. Preserve exactly; do not initialize Analytics against the restore clone. |
| Persistent work/history | oban_jobs is permanent. All observed jobs were completed, but that neither makes history disposable nor guarantees no future pending work. Preserve job arguments, status/history and identifiers privately in the future recovery bundle. |
| Coordination leases | oban_peers is unlogged and held one row. Version-matching Oban source independently establishes expiring election leases and renewal/cleanup. Its **live leases** can be reconstructed by workers later, but the table/data still belong in this archive and exact clone comparison. |
| Counters/metrics and sequences | Operational records can change during normal running. Preserve their snapshot values. Do not exempt them from restoration comparisons or treat every operational table as reconstructible. |

The last passing assessment contains **1,210 rows**, including 1,012 completed jobs, 180 migration
rows, nine sources and the other configuration/authorization/coordination records.
The combined rehearsal captures contained 1,208 rows and 1,010 completed jobs. Even
with the same earlier count, job fingerprints changed. Peer fingerprints also changed;
oban_jobs_id_seq moved **1937 to 1939** across the combined rehearsal and was **1989**
at that inspection. Other table fingerprints and schema/security sections matched
across those assessment captures. The later diagnosis recorded 1,209 rows; live job/
lease activity continues. Each individual final before/after snapshot pair
matched exactly. This is an inventory of live change, not database-wide immutability.

Logflare v1.53.0 pins **Oban 2.20.3**. That Oban peer implementation renews leadership
leases and deletes expired/self entries. The Logflare PostgreSQL pipeline inserts log
batches and its backend migration creates event tables/indexes. This supports the
classification above, but does not prove which invocation changed each observed row.
[Pinned peer implementation](https://github.com/oban-bg/oban/blob/v2.20.3/lib/oban/peers/database.ex),
[PostgreSQL pipeline](https://github.com/Logflare/logflare/blob/v1.53.0/lib/logflare/backends/adaptor/postgres_adaptor/pipeline.ex),
[event storage](https://github.com/Logflare/logflare/blob/v1.53.0/lib/logflare/backends/adaptor/postgres_adaptor/repo/migrations.ex).
URLs and checked source hashes are in
[4120e526](tests/results/vector_analytics_source_review_4120e526.json).

Unlogged storage is not evidence that a table can be discarded. PostgreSQL truncates
unlogged tables after a crash/unclean shutdown and does not replicate their contents
to standbys; this is a reason to include them explicitly in the primary-side logical
recovery design. [PostgreSQL unlogged tables](https://www.postgresql.org/docs/17/sql-createtable.html).

When collection resumes, event inserts, source/counter/timestamp updates, job activity,
sequence allocations and backend-managed storage changes are plausible. Retention
could later remove logging history. Exact configured retention and every worker's
effects were not established by inspecting private configuration rows. No blanket
logging-schema exemption or permission to discard history follows from this assessment.
Record actual per-table changes and delivery correlation during separately approved
retained acceptance; investigate any unexpected object/security change.

## Recovery coverage and exact proposed procedure

The verified Step 22.6 bundle covers **postgres**, not `_supabase`. The older verified
bundles also cover postgres. A persistent volume shared by both databases is not a
verified physical backup. No additional verified physical/WAL/PITR recovery arrangement
for `_supabase` was established in the reviewed project evidence. A logical dump covers
one database; cluster globals require separate capture.
[PostgreSQL dump scope](https://www.postgresql.org/docs/17/app-pgdump.html).

**Require a complete protected `_supabase` bundle and actual isolated restore before
retained repair.** The helper emits a `DESIGN_ONLY_NOT_A_BACKUP` plan with
`recoverabilityVerified=false`. That plan is stored under `locked_retained_review`
in the assessment evidence. It is not an approval, rollback capture or backup receipt.

The later, explicitly authorized task should implement/review these operations:

1. Reverify loopback/project/context, source cluster and existing volume identities,
   matching images, all six application migrations/routes, zero active work, Google
   disabled and the existing postgres recovery/artifact gates. Reinventory all three
   `_supabase` schemas, tables, partitions, ACLs, roles, sequences and dependencies.
   Unknown inventory or new external dependencies require review, not automatic
   acceptance. Never run an old postgres backup command with its database merely renamed.
2. Reserve a new ignored, untracked recovery directory with create-new writes, no
   reparse points, current-user ownership, inheritance disabled and exactly current
   user/SYSTEM access. Verify actual access and every artifact's ACL. Check free space
   for archive, diagnostics, restore volume and expansion; the 11.14 MiB database size
   is a measurement, not a sufficient allocation limit. A conservative initial budget
   is at least 256 MiB protected working capacity plus 1 GiB clone headroom, rechecked
   against the fresh inventory and actual reconstruction requirements.
3. Encrypt sensitive archives, manifests and supplements. A future same-user DPAPI
   envelope may use bounded in-memory dump/restore pipes, purpose/path/user binding,
   create-new ciphertext, private decrypt/read-back and hashes. No plaintext staging,
   arguments, terminal output or report may carry rows or keys. Implement and test
   the bounds/overflow refusal first. DPAPI profile/machine recovery and an approved
   portable encrypted recovery/key procedure remain separate requirements; this
   design does not certify recovery after loss of the Windows profile.
4. Open an exported repeatable-read **read-only** transaction on the exact `_supabase`
   primary. Save/hash the new bound source manifest before dump. Capture every table's
   canonical row fingerprints/count, full schema/security metadata, all partitions,
   28 current sequence states, cluster roles/memberships, database/schema/column/type/
   sequence ACLs, setting values privately and hashes publicly, locale/extension/
   preload prerequisites and service/image associations. Reinventory rather than
   trusting today's count of 39. Capture password-free roles; do not extract passwords.
5. Use the validated pg_dump executable with exact host 127.0.0.1, port 54322,
   database `_supabase`, custom format and that exported snapshot. Keep the exporting
   transaction open throughout dump and role capture. No schema/table/data filter,
   `--no-unlogged-table-data`, owner/ACL omission or exclusion is permitted. Check
   diagnostics/exit codes, the archive TOC and **all 39 current physical TABLE DATA
   entries**, including the empty tables and unlogged peers. No partition attachments
   are currently expected; new ones require complete reviewed coverage.
6. Independently fence non-MVCC sequence values, roles and privileges/settings before
   and after dumping. Live Oban activity makes sequence drift possible despite MVCC.
   Stop on drift; retain the failed encrypted attempt and require a reviewed new run,
   without stopping workers or weakening the gate. Compare live row changes explicitly
   against the exported snapshot and pinned worker behavior; never hide arbitrary
   jobs/configuration mutations. The inspection comparator is **not** this future dump
   fence. Separate database dumps do not establish cross-database atomicity.
7. Restore into a new uniquely labeled network-none, no-port, no-TCP cluster with a
   fresh volume, matching cached PostgreSQL 17.11 image
   `sha256:6058a6759ab9268cff8ee70641d61f1bd75953316281b76427cf5a6b4db2eafc`, locale,
   preload binaries and extension prerequisites. Verify image/labels/mounts, absence
   of retained volumes, blank application inventory and a distinct cluster **before
   SQL**. Bypass bundled Supabase initialization. No Analytics, Oban, replication,
   Auth or other service may connect to the clone.
8. Import the password-free roles/memberships, preserving ALTER/GRANT statements and
   omitting only duplicate creation of the known bootstrap role. Verify plpgsql's
   source ownership/version. Create `_supabase_restore_verify` from template0 with
   owner postgres and the recorded UTF8/ICU/collation. Reconstruct the **entire** custom
   archive with pg_restore `--exit-on-error --single-transaction`; execute through the
   independently guarded Unix socket with psql ON_ERROR_STOP. Use private decrypted
   pipes/protected diagnostics. No clean, filters, no-owner/no-ACL or migrations.
9. Derive any necessary database/prerequisite supplement from this new manifest and
   bind archive, manifest, intended database and distinct destination cluster hashes.
   Review the exact initial discrepancy and reproduce grantors/options with supported
   SQL. Do not reuse the postgres GraphQL eight-grant or JWT-setting supplements:
   their allowlists and source bindings do not describe this database. Test a wrong
   source-cluster target rejection before any supplemental grant.
10. Compare all table inventories/counts/fingerprints **exactly**, including peers,
    jobs and empty log tables. Compare every schema/security/owner/ACL/default,
    constraint/index/trigger/function/type/extension/publication section, roles,
    memberships, all sequence values and database settings. No Realtime, lease or
    job exemption applies to this disconnected clone. Verify source/artifacts again,
    stop only the new clone and retain its volume plus the complete encrypted bundle.
    Only then issue a verified database-recoverability result for that run.

The publication definition belongs in the archive; the active temporary slot and
its WAL/consumer progress do not become recoverable by dumping it. Document separate
consumer reinitialization/resume and continuity requirements before any real service
recovery. Do not copy an LSN into a new slot or claim replay continuity from the clone.
Logical replication also does not carry schema DDL or sequence state automatically.
[PostgreSQL logical replication restrictions](https://www.postgresql.org/docs/17/logical-replication-restrictions.html).

Logical recovery also needs separately protected service configuration, Logflare API/
database credentials, any encryption/signing keys actually used, global role passwords,
image/binary prerequisites, external backend objects and infrastructure procedures.
Database-stored authorization/configuration rows are included in the archive; external
keys that interpret or use them are not. No such secret was exported here. A future
configuration rollback must preserve legitimate new logs rather than erase them to
recreate an old fingerprint.

## Retained adapter and startup integration review

Added **`scripts/vectorRetainedReview.mjs`**, a pure validation model, and a private
stdin review bridge. The bridge receives inspect JSON in captured pipes and emits
only definition/code/source hashes and the nonsecret recovery design. It has **no
Docker adapter or mutation channel**. Actual twelve-service/volume inspections passed
this review. The current target ID, image, network ID and YAML hash remain those of
the original failing Vector. Every other definition and all eleven unaffected
container IDs/start times/restart counts must remain equal. Complete volume inventory,
creation metadata and definition hashes are checked, including the retained DB volume.

The model reuses the existing inspect-to-create translator and exact delta comparator:

```text
DOCKER_HOST=http://host.docker.internal:2375
  -> DOCKER_HOST=unix:///var/run/docker.sock

add only: bind /var/run/docker.sock -> /var/run/docker.sock, ReadOnly=true
```

Original image, YAML/command, user, other environment/logging settings, labels,
health check, restart policy and declared network settings must remain exact.
Unknown original Config/HostConfig fields, unsupported endpoint/IPAM state, existing
mounts or ambiguous transports fail. The prior explicit OomKillDisable null-to-false
effective-default translation is retained; no new normalization was added.

The following remain implementation/approval prerequisites for a real adapter:

- A new protected **retained** original inspect/create/YAML capture, privately
  verified and bound to the exact source, resources, recovery receipt, code and plan.
  The existing DPAPI bridge accepts synthetic captures; this task did not repurpose
  it or create a retained encrypted rollback bundle.
- An independently reviewed private Engine transport restricted to the exact approved
  IDs and stop/rename/detach/create/inspect/start operations. No arbitrary exec,
  delete, prune, force, retry loop or automatic rollback. Each journal/reservation is
  create-new; interrupted or previously armed attempts cannot be silently resumed.
- Verified `_supabase` recovery artifacts, fresh socket identity/permission checks and
  explicit approval of daemon authority and ordinary logging-store effects. Input
  hashes/claimed receipts in a pure model are not independent artifact verification
  or operator authorization. The future executor must verify actual files/read-back
  and source freshness itself.
- Separate rollback approval bound to the exact plan and replacement ID, with failed
  objects retained. Restoring the original TCP definition restores its **known failing
  configuration**, not healthy collection. No database restore is part of rollback.
- Explicit accounting for the stopped, detached original with its project labels
  intact. The existing Google twelve-container inventory must continue to reject the
  thirteenth container. A future phase-specific repair verifier may account for that
  exact approved rollback ID; any removal/quarantine policy requires separate review
  and exact-ID approval. No cleanup implementation was added.

The pure model rejects extra project containers, changed image/network/volume identity,
wrong target/source/code/approval bindings and an unverified recovery claim. A changed
Vector ID requires new capture/approval. Today's model pins today's network ID too;
a future recreated network cannot inherit this receipt. This is a locked review
contract, not a certified retained repair plan or an execution-ready command.

For future CLI startup, keep the existing full-service prerequisite unchanged. The
Windows CLI recipe still recreates TCP Vector. After any separately approved creation,
inspect the new inventory; a new Vector ID returns **NEW_CAPTURE_AND_APPROVAL_REQUIRED**.
An exact existing Unix definition should be verified without recreation. After a
separately approved reconciliation, all twelve services must be healthy, followed by
independent source/security/delivery acceptance. A nonzero CLI health failure remains
a failed startup: stop for review, do not reinterpret it as successful activation or
automatically reconcile/retry. No ignore-health flag or Vector exclusion is introduced.

This design is **not wired into Start-LocalGoogleAuth.ps1**. CLI platform convergence,
service keys/environments, actual full-stack recreation and the real retained hook
still need a later integration rehearsal. Existing activation/rollback locks are
unchanged. No node_modules patch, context/global setting change, Docker TCP listener,
provider configuration or credential use was introduced.

## Socket authority and disposable results

The fresh root probe used the cached postgres-meta image with its Node entrypoint,
network none, no ports, read-only root, dropped capabilities, no-new-privileges and
bounded resources. Its only daemon calls were **GET /_ping** and **GET /version**.
The socket is UID/GID **0:0**, mode **0660**; Engine **29.8.2**, API **1.56**, minimum
**1.40**. Retained Vector still has no user override, so the observed filesystem
permissions support its proposed root transport. No real container/log/event listing
was performed through that probe socket.

Read-only mounting does **not** authorize only read API operations. A process that
can use this socket has privileged daemon authority. Capabilities, collection filters
and network isolation do not restrict that API authority. The probe is safe within
its fixed program; it is not an authorization boundary for Vector. A production proxy
would need authenticated exact object/endpoint/stream controls; GET-only filtering
does not protect sensitive inspect/log data. None was deployed.
[Docker daemon socket security](https://docs.docker.com/engine/security/protect-access/).

| Completed group | Passed | Failed |
| --- | ---: | ---: |
| New recovery/retained/startup policy methods | 20 | 0 |
| New Python privacy/identity/comparison/discovery methods | 7 | 0 |
| Existing translator/approval/isolation offline methods, rerun | 11 | 0 |
| Existing Windows DPAPI/ACL/Engine synthetic checks, fresh run | 24 | 0 |
| Fixed real-daemon two-GET probe | PASS | 0 |
| Actual locked review, source/service/recovery/credential-metadata fences | PASS | 0 |
| Later unchanged strict 70-table prerequisite | 0 | 1 — new 71st table; stopped |
| Separate read-only classifier/discovery/artifact diagnosis | PASS | 0 |
| Python/JavaScript syntax, new-file and Git diff whitespace checks | PASS | 0 |

There are **62 passing methods/checks**, comprising 38 offline methods and 24 synthetic
Windows/Engine checks. The original combined run contains 61; subsequent review added
one discovery regression, and all 20 Node plus seven Python review methods passed
before the later strict prerequisite stopped. The unchanged 11 core methods and 24
synthetic checks retain their completed-run evidence; they were not repeated after
that stop. Repetitions and earlier phases are not added together. The passing method
count does not cancel the separately recorded prerequisite failure.
The fresh rehearsal **ef8b05d9** exercised protected ciphertext/read-back, tamper/ACL/
canary checks, exact delta, unknown definition rejection, approval/duplicate/interruption
guards, two separately captured creation IDs, injected replacement failure and separately
approved rollback. Supabase CLI recreation was **simulated**, not executed. Synthetic
Vector log delivery went only to the disconnected fixture/console, never Analytics.

Its eight containers are stopped/retained with one internal network and socket volume
under `sq-vpr-ef8b05d9-`. The separate `sq-vector-socket-7646b570-probe` exited normally
and is retained; it created no network or volume. Thus this task adds **nine inactive
containers, one network and one volume**, exactly inventoried. Existing disposable and
recovery resources were preserved; nothing was deleted or pulled.

**Pending acceptance:** new `_supabase` backup/restore and encryption/recovery testing;
real retained capture/adapter; actual retained reconciliation/rollback; 600 continuous
healthy seconds sampled at most 30 seconds apart; real Vector-to-Engine list/events/log
collection; privately correlated ordinary Analytics delivery; real CLI startup/hook and
all-service acceptance. No retained mutation was needed or attempted to complete these
tests. Physical second-user DPAPI and physical crash tests were not newly performed.
Frontend/build/Google/provider/application suites were outside this scope and not rerun.

During development, two preliminary read-only catalog queries failed on ambiguous-column
and missing-terminator SQL errors. Checked separate queries replaced them. An offline
negative fixture initially used an invalid catalog shape; it was corrected to alter a
valid owner field, and all six then-existing Python methods passed. The later seventh
discovery method also passed. The separate strict inventory prerequisite subsequently
failed as recorded above. No historical FAIL was rewritten and none of these development
errors changed retained data.

## Final preservation, files and decision

The earlier complete `postgres` preflights passed. Final read-only diagnosis passed
the **unchanged strict Realtime classifier** against the immutable recovery source,
while the separate exact-70-table prerequisite remains failed. Six migration receipts/file hashes,
fixed **1:TP, 2:SOA, 3:PNEP, 4:REF, 5:ADJ**, business/Auth/history fingerprints, roles,
ACLs/settings, RLS and publication remain correct. Counts remain 39 accounts/39 Auth
users/26 identities, 20 terminal tickets, 57 events, 69 replay records, 32 audits,
seven closed days and four staff assignments. Zero active work/open day; Counter 5's
stale STUDENT fixture is intact. All 15 application tables retain RLS and browser roles
lack queue_private USAGE. The app publication still contains only the two display tables.

Inventory was 70 postgres tables through assessment f93ecba4, then became **71** with
the reviewed empty October 21 leaf. Scoped subscription allocation was 380 at the
combined run's assessments, 384 at the later probe/assessment and 386 at the final
diagnosis, which recorded two scoped subscriptions. No allocation/cleanup cause is
attributed. No historical classifier or
source equality baseline was changed. Analytics live jobs/leases, sequences and
temporary replication metadata are separately reported above; there is no new
Analytics mutation exemption in any historical backup comparator.

All eleven unaffected containers retained their identities, definitions and lifecycle
values. Original Vector ID/image/YAML/definition remain exact and **unhealthy**; its
automatic restart count was 1829 in the combined initial assessment, 1832 at its end,
1862 in the later probe and 1878 at assessment f93ecba4. Automatic restarts continued;
no operator restart occurred.
Google remains disabled. Its protected store was checked **by metadata only**, never
opened, hashed, decrypted or imported. Both Google activation locks and the original
retained Vector PowerShell locks remain intact.

All **50 existing backup files** retained tree digest
`9ae20f6cf67e0c894217892abf1fe48e56ad6e6858215a8da23614455d77ac81`.
The fresh postgres bundle remains
`.local-backups/pre_google_20261017T063856Z_6e3beebe`, bundle hash
`50164d4afb5083a83044f5ee3df3d13b1b2002ba29ee03143e460c181b915a52`.
Its protected access, source associations, supplements and stopped restore destination,
and both older bundles, passed again. The combined run froze 181 existing/code inputs;
its recorded hashes remained equal. No archive, previous report/evidence, config.toml,
migration, grant/policy, credential helper, Google activation helper or existing repair
core was modified.

Created in this task:

- `scripts/vectorRetainedReview.mjs` — pure recovery/retained/startup review and
  unconditional locked adapter methods.
- `tests/security/review_retained_vector.mjs` — private stdin review bridge; no Docker
  calls or retained executor.
- `tests/security/vectorRetainedReview.unit.mjs` — twenty policy methods.
- `supabase/tests/inspect_analytics_recovery.py` — read-only catalog/row-digest/dependency
  assessment, locked model review and preservation fences.
- `supabase/tests/test_analytics_recovery_review.py` — seven offline methods.
- `tests/security/run_vector_analytics_review.py` — fresh evidence orchestration of
  those methods, unchanged disposable rehearsal and before/after assessments.
- `supabase/tests/probe_vector_daemon_readonly.py` — fixed probe-only entry using the
  existing owned-resource recipe and preservation checks.
- `supabase/tests/diagnose_analytics_review_stop.py` — separate read-only classification
  and artifact/service/discovery checks; leaves the original prerequisite failed.
- This report, new sanitized evidence, synthetic encrypted captures/journals and the
  nine identified inactive disposable containers plus their network/volume.

Primary evidence:

- [Combined 377dcd35](tests/results/vector_analytics_review_377dcd35.json), SHA-256
  `b6fb3073d57dd07735ddfb442393713dfa8d07f21da7183d509ac79b971ab642`.
- [Disposable ef8b05d9](tests/results/vector_persistent_rehearsal_ef8b05d9.json) and
  [24 synthetic checks](tests/results/vector_repair_disposable_ef8b05d9.json).
- [Fixed probe 7646b570](tests/results/vector_daemon_readonly_probe_7646b570.json), SHA-256
  `af72284359bdd8b6d9c6f58d771192ddb1a8bbd118317afe67cffd2f8b6f31dd`.
- [Last passing assessment f93ecba4](tests/results/vector_analytics_assessment_f93ecba4.json), SHA-256
  `0606d682c57e6919a50c346513e8e245d23ca2c7a469dbffff940a5fcbc4286d`.
- [Final stopped-run diagnosis f9a8d09f](tests/results/vector_analytics_stopped_diagnosis_f9a8d09f.json), SHA-256
  `786906f53b4683ab18009974aed0a0f41a5335b23da766ef4c1f98e7bd8ef85c`.
- [Qualified task closeout](tests/results/vector_analytics_closeout_b281d8f1.json) binds
  the final report/code to the passing tests and the subsequent prerequisite failure.

**Decision: Analytics recovery next; retained Vector repair is not ready for execution
approval.** Separately authorize the complete `_supabase` backup and actual isolated
restore and the changed postgres recovery inventory, then review a concrete retained capture/adapter/approval plan and daemon
authority. Any later repair, rollback, original-container cleanup, stack recreation or
Google activation requires its own applicable approval. No approval is requested here
as though synthetic validation cleared those remaining gates.

This task issued no hosted Supabase contact, Google login, retained restart/rename/recreation, new retained
dump/restore, SQL mutation, environment/provider edit, migration/reset/push/link,
administrator designation, deployment, image/dependency installation, backup/volume
deletion, Git commit or push occurred.

**Stopped after inspection, locked review, disposable testing and this report. All
retained mutation paths remain locked.**
