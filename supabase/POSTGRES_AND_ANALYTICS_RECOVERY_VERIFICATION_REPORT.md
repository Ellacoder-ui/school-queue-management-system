# Step 22.8E: PostgreSQL and Analytics recovery verification — stopped

October 18, 2026. **FAIL — no new verified recovery reference was established.**
Encrypted PostgreSQL backups were created, but independent restoration did not pass
all required comparisons. The subsequent source preflight found a removed Realtime
partition and correctly stopped under the unchanged preservation policy. **The
`_supabase` backup and restore never started. Current-inventory recovery prerequisites
are not satisfied, and retained Vector repair is not cleared for execution approval.**

The final recovery attempt, **2c8767d1**, stopped at **13:33:21–13:33:30 UTC+08:00**.
Only read-only diagnosis, provider/lock checks and reporting followed. Final diagnosis
**5cd9ef5b**, **13:39:33–13:39:47**, preserves the source failure separately from the
earlier backup and restore failures. No retained service or database was repaired,
restarted or changed by this task. Google remains disabled; all repair/activation
locks remain intact.

## Verified target and source inventory

| Item | Verified retained value |
| --- | --- |
| Project/workdir | school-queue-local / C:\Users\Hp\school-queue-management-system |
| PostgreSQL targets | 127.0.0.1:54322/postgres and 127.0.0.1:54322/_supabase |
| API | http://127.0.0.1:54321 |
| Server/source cluster | PostgreSQL 17.11 / 7696959712798593061 |
| Database container/volume | supabase_db_school-queue-local |
| Gateway/network | supabase_kong_school-queue-local / supabase_network_school-queue-local |
| Cached database image | public.ecr.aws/supabase/postgres:17.11.0.004 |
| Image ID | sha256:6058a6759ab9268cff8ee70641d61f1bd75953316281b76427cf5a6b4db2eafc |
| Migration history | Exactly 20261016000100 through 20261016000600; original file hashes |
| Fixed routing | 1:TP, 2:SOA, 3:PNEP, 4:REF, 5:ADJ |
| Queue work | Zero active tickets, seven historical closed days, no open day |
| Security | All 15 application tables retain RLS; browser roles lack queue_private USAGE |

Retained connections used explicit loopback targets, read-only defaults and read-only
transactions. The existing strict Realtime classifier was reused without modification.
Initial preflights accepted **71 postgres tables**: the historical inventory plus the
exact reviewed empty `realtime.messages_2026_10_21` daily leaf. The new manifests derived
their table inventory from the captured catalog; no hardcoded table count was changed
to obtain a pass. The 71-table snapshot had eight daily leaves, October 14–21.

The final source contains **70 tables**, with leaves October 15–21. Compared with the
completed 71-table backup snapshot, only `realtime.messages_2026_10_14` is missing; no
table was added. Its ten columns, two constraints, two indexes, partition ancestry and
platform-publication membership are also absent. The unchanged classifier permits
reviewed empty additions and narrowly scoped subscriptions, **not pruning/deletion**.
It therefore reports FAIL. A return to the number 70 does not restore the historical
70-table inventory, which contained October 14–20.

The removed leaf held zero rows in the last protected backup snapshot. That does not
prove it was empty at deletion time. This task issued no source DDL/DML; the deletion's
exact time and actor were not independently attributed. The final diagnosis compares
unaffected objects explicitly, but does not classify this deletion as permitted or
convert the strict failure into PASS. No partition was recreated, manifest rebased or
preservation rule broadened.

Evidence: [final source diagnosis](tests/results/dual_recovery_final_diagnosis_5cd9ef5b.json)
and [stopped source preflight](tests/results/postgres_analytics_recovery_2c8767d1.json).

## New PostgreSQL backups and actual restoration results

Each attempt has separate evidence and protected storage. Earlier failures remain
unchanged. Times below are October 18, UTC+08:00.

| Run | Window | Actual result |
| --- | --- | --- |
| d27d7046 | 12:46:00–12:46:25 | Synthetic encryption self-test only; not a database backup |
| b44b72f5 | 12:55:33–12:56:05 | Encrypted manifest/archive/roles created; archive TOC text decoding failed before any clone |
| 93426091 | 13:17:15–13:18:10 | Complete 71-table encrypted backup capsule; isolated clone prepared, then pg_restore SQL-output invocation failed |
| 8fa0e0c7 | 13:24:30–13:25:45 | Independent verification of the completed 93426091 capsule; entire archive SQL executed in a new clone, then exact schema guard failed |
| 2c8767d1 | 13:33:21–13:33:30 | Strict source preflight rejected the missing October 14 leaf; no new directory, dump or clone |

The completed backup in **93426091**, capture identity **d7f3aa3b**, contains **71
logical tables, 70 physical tables/TABLE DATA entries, eight partition attachments
and 824 logical rows**. Empty tables and all physical leaves are included. There was
no table/schema filter, extension-data exclusion, unlogged-data omission or owner/ACL
omission. The exporting repeatable-read read-only transaction stayed open through
dump and password-free role capture. The bound manifest was encrypted before dumping.
Strict role, sequence and additional ACL/settings fences passed around the capture
and dump. `pg_dump`, `pg_dumpall` and `pg_restore --list` exited zero. Host tools were
18.6; actual destination PostgreSQL/psql was 17.11.

Run 8fa0e0c7 verified that capsule's immutable evidence/checksums and re-encrypted its
contents into a new verification directory. It retained the original snapshot identity
and plaintext archive hash. **It did not take another PostgreSQL dump or represent a
new source snapshot.** Both runs remain FAIL; archive completeness alone is insufficient
to establish recoverability.

Three tool-transport defects were isolated without weakening the comparisons:

1. Native Windows TOC stdout contains CRLF line endings. The original strict TOC
   parser rejected the trailing carriage returns. Text decoding restored the parser's
   expected representation; the same exact coverage validator then accepted 71/70/8.
2. The new reconstruction invocation omitted an explicit output destination. Host
   `pg_restore` required `--file=-`; a private, database-free reconstruction confirmed
   that option succeeds. The first partial clone never received archive SQL.
3. Native Windows reconstructed-SQL stdout expanded LF to CRLF inside function
   definitions. The second clone executed the archive, but the unchanged pre-supplement
   schema guard correctly rejected those extra bytes. Private byte comparisons found
   all 23 multiline application bodies in their CRT-expanded form; decoding the text
   restores their exact protected source bytes. A regression covers original LF,
   CRLF and lone-CR input. Binary archive bytes are never text-normalized.

The final code applies the text decoding to reconstructed SQL too. **A complete
positive restore of that correction was not verified:** the next attempt stopped at
the genuine source-pruning failure. No schema/database supplement was applied to the
second clone, and its final exact row/sequence/security comparison and live wrong-target
supplement test were not reached. No expected discrepancy was simply whitelisted.

Diagnostics: [TOC decoder](tests/results/dual_recovery_decoder_diagnosis_03f20544.json),
[explicit output destination](tests/results/dual_recovery_stdout_diagnosis_2efba6c7.json),
[SQL byte comparison](tests/results/dual_recovery_sql_text_diagnosis_70db2b63.json).

### Protected artifact identities

All directories below are under the ignored project `.local-backups/` root. Sensitive
artifacts use `.dpapi` envelopes; raw diagnostic text is encrypted too.

| Directory | Contents/status |
| --- | --- |
| dual_20261018T044600Z_d27d7046 | Synthetic ciphertext/access probe only; not recovery evidence |
| dual_20261018T045533Z_b44b72f5 | First incomplete encrypted PostgreSQL attempt |
| dual_20261018T051715Z_93426091 | Completed encrypted PostgreSQL backup capsule; restoration unverified |
| dual_20261018T052430Z_8fa0e0c7 | Re-encrypted capsule plus failed independent restore diagnostics |

Plaintext archive SHA-256 for b44b72f5, **537,858 bytes**:
`6a1683974a678d4d08a6b22614a490febd4befb59e666294d53da0d82636daf9`.

Plaintext archive SHA-256 for 93426091 and its 8fa0e0c7 verification copy,
**537,857 bytes**:
`d6c831973afee9feddfa59637d5f6eaeb5a6a85e51a43a53844b07f1ceb1a29c`.

Their encrypted archive SHA-256 values are respectively:

- b44b72f5: `066b60098c201272ee6b83c4142244e1f05578e2e4df3acb8b694e33f55bde14`.
- 93426091: `c725c660d05938b765d88de32d5607c2834a1a40dce2c84517fd2c699c7463f9`.
- 8fa0e0c7: `d47b57cacdb1c63e2e39d833c091c71b477d75f174bcc925c82bb5a33fe8227c`.

Each encrypted archive is 717,622 bytes. Different ciphertext is expected for separately
sealed copies; exact plaintext hashes bind the reused archive. Full per-artifact
plaintext/ciphertext hashes, sizes and database purposes are in each run's sanitized
evidence. Preserve the manifests, roles, source-derived prerequisites, diagnostics and
binding evidence together. None of these new directories is a certified recovery unit.

### Isolated destinations retained

| Property | First partial clone | Second partial clone |
| --- | --- | --- |
| Container | sq-restore-internal-f34b6305 | sq-restore-internal-135ef7c8 |
| New volume | sq-restore-internal-f34b6305-data | sq-restore-internal-135ef7c8-data |
| Cluster | 7697872777625542682 | 7697874662094864410 |
| Database | queue_restore_verify | queue_restore_verify |
| Furthest completed step | Password-free roles and database preparation | Entire archive SQL execution |
| Final state | Stopped, exit 0; volume retained | Stopped, exit 0; volume retained |

Both used the exact cached PostgreSQL image above, network=none, no published ports,
disabled TCP and guarded `/tmp` Unix sockets. Fresh-volume absence, labels, actual
image/mount identity, blank initial application inventory and distinct cluster IDs
were checked before writes. Bundled Supabase initialization was bypassed. Recorded
UTF8/ICU en-US/en_US.UTF-8 locale and preload prerequisites were prepared. No retained
volume or Docker socket was mounted, and no Auth, Analytics, worker or replication
consumer connected. Sensitive restore SQL traveled through private stdin rather
than command arguments or plaintext host staging files.

**Neither clone passed the complete exact comparison.** Two stopped containers and
two new retained volumes are the only Docker resources created by this task; no new
network or image was needed. Their initialization entry point refuses existing
PGDATA and is not a supported resume procedure. Do not start or delete them merely
to inspect this report.

## Analytics result and consistency limits

**No `_supabase` archive, exported backup snapshot or restore clone was created.**
The workflow required successful PostgreSQL recovery verification first. Consequently
Analytics archive coverage, dump-window non-MVCC fences, restored jobs/peers, all 28
sequence states and exact restored schema/security comparisons remain unperformed.

Read-only assessment still found **39 tables and 1,209 logical rows** in the separate
database. Relative to assessment f93ecba4, `oban_jobs` changed from 1,012 to 1,011 rows;
the single `oban_peers` row changed fingerprint. The job allocation sequence was
2,071 at final inspection. All other compared rows, schema/security metadata, roles
and settings matched. This records narrowly identified live activity, not a permission
to omit jobs, peers, empty event tables, authorization/configuration records or migration
history from a future archive. Specific job/lease writers were not individually
attributed.

The runner's live observation comparison is separate from its strict dump fence and
clone comparator. A future dump must stop on sequence/role/required settings drift
even when row data have an MVCC snapshot. A disconnected clone must match every
captured job, lease and sequence exactly. Workers must not be stopped to force a pass.
Separate database dumps would also not establish cross-database atomicity. This task
does not certify Analytics recovery, active temporary-slot continuity or logging
delivery. None of the historical postgres bundles covers `_supabase`.

## Encryption and security validation

The new bridge targets Windows PowerShell 5.1 Desktop and DPAPI CurrentUser. It accepts
only bounded redirected private pipes, fixed project recovery paths and database-purpose
bindings. Inheritance is disabled; ownership and exactly current-user/SYSTEM FullControl
are required on directories/files. Reparse points, tracked/unignored storage, unexpected
paths, overwrites and oversized input fail. Ciphertext uses create-new writes and
private decrypt/read-back; entropy/envelope bind purpose, exact path, owner and database.
Plaintext is bounded to 64 MiB and ciphertext to 96 MiB. No plaintext fallback was added.

Seven actual Windows checks passed: same-user encrypted round-trip with exact ACLs,
atomic overwrite refusal, wrong-purpose refusal, outside-path refusal, tampered-ciphertext
refusal, plaintext-canary absence and multi-megabyte binary round-trip. Invalid synthetic
ciphertext is retained as negative-test evidence, not usable recovery material. Public
access probes contain no private data. No Google credential was used as a canary.

Private manifests, archives, SQL and diagnostics stayed in memory/private pipes until
encryption. No source rows, role passwords, keys or raw diagnostics were emitted in
reports or command arguments. Role capture excludes passwords. Plaintext necessarily
exists in process memory; managed strings cannot be guaranteed erased. DPAPI depends
on the Windows user/profile and path-bound envelope; physical second-user access and
power-loss-during-write testing were not performed. Portable recovery after profile
or machine loss is not certified. Restored database files in Docker volumes are
**not encrypted by this artifact bridge**, and Docker administrators can access them.
[Microsoft DPAPI reference](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata.protect?view=netframework-4.8.1).

## Tests, failures and uncompleted gates

| Group | Passed | Failed | Not completed |
| --- | ---: | ---: | --- |
| Final offline methods: 101 existing recovery/preservation + 22 new methods | 123 | 0 | 0 |
| Actual Windows encryption/ACL/private-pipe checks, earlier completed window | 7 | 0 | 0 |
| PostgreSQL 93426091 dump, coverage and strict non-MVCC fences | PASS | 0 | — |
| b44b72f5 strict TOC acceptance | 0 | 1 | Clone not created |
| 93426091 archive SQL reconstruction invocation | 0 | 1 | Archive not executed |
| 8fa0e0c7 exact pre-supplement schema guard | 0 | 1 | Final full comparisons not reached |
| 2c8767d1 source preflight | 0 | 1 | Pruning rejected; no new resources |
| Final read-only diagnostic and historical artifact checks | PASS | 0 | Strict source failure remains |
| Disabled-provider/repair-lock check | PASS | 0 | No real login |
| Draft reference verifier against unverified 8fa0e0c7 | Expected refusal | 0 unexpected | No positive reference exists |
| Complete verified PostgreSQL clone comparison | 0 | — | Not completed |
| Analytics backup/restore and exact comparisons | 0 | — | Not started |
| Physical second-user DPAPI and crash-during-write acceptance | 0 | — | Not performed |

These groups belong to separate observation windows, not one complete passing recovery
run. Repeated executions are not added together. The 123-method count does not cancel
any mandatory failure. Python syntax, PowerShell parsing and whitespace checks passed.
The draft read-only verifier rejected the failed reference with
`DAR_REFERENCE_NOT_VERIFIED` before decryption/database access; its positive path has
not been validated. Frontend/build/provider/Vector repair suites were outside this
recovery task and were not rerun.

Development fixture/parser errors and earlier sanitized diagnosis records remain
separate. The preliminary `dual_recovery_preservation_stop_d6fba351.json` retains an
in-progress result; the completed final diagnosis is 5cd9ef5b. No failed evidence was
overwritten or promoted to PASS.

## Retained state and historical recovery preservation

Final diagnosis compared **69 shared non-subscription postgres tables** with the
protected 71-table snapshot: all matched exactly. The missing leaf and its associated
catalog entries remain explicit failures. Roles, additional ACL/settings, routing,
functions, policies, triggers, extension definitions and the other unchanged schema
sections matched; this is not database-wide schema equality.

Retained business/Auth/history state remains 39 accounts/39 Auth users/26 identities,
20 terminal tickets, 57 events, 69 replay receipts, 32 audits, seven historical days
and four staff assignments. Counter availability and Counter 5's stale STUDENT fixture
remain intact. There is no open day or active ticket. Six migrations/file hashes,
fixed routes, all 15 application RLS controls and private-schema restrictions remain
unchanged. The application publication still contains only counter_state/service_state.

Final anonymous public subscriptions numbered two and passed the existing scope check;
allocation was 400. Allocations outside a dump window remain separately recorded
operational effects. They are not exemptions from the strict backup-window fence.
Auth refresh-token and hooks sequence states remained unchanged. No allocation cause
is attributed.

All eleven non-Vector services retained their IDs, definitions, start times and restart
counts. The original unhealthy Vector retained its ID, image, YAML hash and failing TCP
definition; its pre-existing automatic restart loop was not repaired or requested.
Existing volume/network identities were preserved, together with all prior disposable
and stopped recovery resources. Google was still disabled at **13:43:28**. Its protected
store was checked by size/timestamps/attributes only, never opened, hashed, decrypted,
imported or modified. Both Google activation and retained Vector execution locks passed.

All three historical verified recovery bundles remain intact and separate:

- `.local-backups/20261016T135430Z_46a582fc` — five-version point.
- `.local-backups/post006_20261016T163319Z_4c79fb00` — six-version, 69-table point.
- `.local-backups/pre_google_20261017T063856Z_6e3beebe` — six-version, historical 70-table point;
  bundle SHA-256 `50164d4afb5083a83044f5ee3df3d13b1b2002ba29ee03143e460c181b915a52`.

Their artifact associations, hashes, protected access and recorded restore destinations
passed read-only checks. All **50 original backup files** retained their inventory
digest `9ae20f6cf67e0c894217892abf1fe48e56ad6e6858215a8da23614455d77ac81`.
The final tree contains **81 files**, including this task's 31 new synthetic/failed
attempt files, with digest
`385138f0c3da32fca227d8511d527d679a96899e43d65cd8ec5142ad63f5a8f4`.
That inventory is not a count of certified backups. All 234 frozen existing input
hashes in the final diagnostic matched. No historical bundle was restored or rebased.

## Files, limitations and decision

Created in this task:

- `scripts/RecoveryArtifactCrypto.ps1` — bounded DPAPI/ACL/create-new private bridge.
- `supabase/tests/dual_database_recovery.py` — independent encrypted recovery orchestration
  and exact isolated-destination guards/comparisons.
- `supabase/tests/test_dual_database_recovery.py` — 22 final offline methods.
- `supabase/tests/verify_dual_database_recovery.py` — draft read-only reference verifier;
  failed-reference rejection tested, positive acceptance not established.
- `supabase/tests/diagnose_dual_recovery_final.py` — read-only final preservation diagnosis.
- New sanitized evidence, four protected attempt directories and two stopped partial
  clone containers/volumes, plus this report.

Existing classifiers, backup runners, manifests, reports, application source, SQL
migrations, config.toml, credential/activation/Vector helpers, dependencies and real
environment files were retained. No retained SQL mutation, service operation, hosted
Supabase contact, Google login/activation, administrator designation, RLS/grant change,
reset/push/link, deployment, image pull, backup/volume deletion, Git commit or push ran.

A logical database archive does not recover global role passwords, external service
credentials, encryption/signing keys, infrastructure configuration, WAL/PITR, temporary
replication-slot/consumer continuity or external Storage files. Other databases/templates
and DPAPI profile-loss recovery also require their own procedures. Password-free roles
do not restore usable service passwords. Even a future exact clone PASS would certify
only its tested database unit, not operational Supabase/Auth/Analytics connectivity.
[PostgreSQL dump scope](https://www.postgresql.org/docs/18/app-pgdump.html).

**Current-inventory recovery prerequisite: NOT SATISFIED. Analytics recovery: NOT
ESTABLISHED. Vector repair: NOT READY for separate execution approval.** A later task
must review the removed leaf and source-preservation policy explicitly, preserve this
FAIL evidence and establish the appropriate current inventory without weakening the
existing rules. It must then complete corrected independent PostgreSQL restoration
and the complete encrypted `_supabase` backup/actual restore with strict consistency
and exact clone comparisons. No backup/restore was retried after the pruning stop.
Retained repair, rollback, cleanup, stack recreation and Google activation remain
separate authorization work; this report does not unlock them.

Primary evidence:

- [Completed backup/stopped first clone, 93426091](tests/results/postgres_analytics_recovery_93426091.json),
  SHA-256 `d88a82e21d383b4177b8c49ed275ad922f648622bb653ef7c7fe34ca0684bf0b`.
- [Failed exact restore, 8fa0e0c7](tests/results/postgres_analytics_recovery_8fa0e0c7.json),
  SHA-256 `fea35fefd265a3973386e9e22558a38c1b450f3c3fe835d48b28739c76beaa0d`.
- [Final stopped attempt, 2c8767d1](tests/results/postgres_analytics_recovery_2c8767d1.json),
  SHA-256 `289cb1a6427889b81098699cea11f9c03a68ba4f968703f2054d6419bb747ec9`.
- [Final read-only diagnosis, 5cd9ef5b](tests/results/dual_recovery_final_diagnosis_5cd9ef5b.json),
  SHA-256 `681c72a96040cc3f2032b8a116ac375a70687682c0cde5eb82d5c9ffa3a56870`.
- [Disabled provider and locks](tests/results/dual_recovery_disabled_provider_76a70e3d.json)
  and [unverified-reference refusal](tests/results/dual_recovery_reference_check_abd00577.json).

**Stopped after the required source failure, read-only preservation verification and
report generation. No new recovery reference is certified.**
