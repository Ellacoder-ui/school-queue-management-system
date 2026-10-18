# Step 22.8F: Realtime partition lifecycle and recovery diagnosis

October 18, 2026. **Read-only investigation completed. The installed Realtime version
automatically prunes old partitions, and October 14 fits its October 18 cutoff.
However, deletion-time emptiness is unproven, so the existing preservation FAIL
remains. The encrypted historical archive is intact; recoverability remains unverified.**

No preservation rule, historical evidence or retained data was changed. No new backup,
isolated restore, container/volume creation, retained service operation, Vector repair
or Google activation ran. This task does not clear any retained execution gate.

Main assessment **a982ed79** ran **14:06:51–14:07:23 UTC+08:00**. A separate bounded
database-log review completed at **14:08:22**. These are observation windows, not a
claim of continuous state or health outside them.

## Current source and partition state

| Item | Verified value |
| --- | --- |
| Project/workdir | school-queue-local / C:\Users\Hp\school-queue-management-system |
| PostgreSQL/API | 127.0.0.1:54322/postgres / http://127.0.0.1:54321 |
| Server/cluster | PostgreSQL 17.11 / 7696959712798593061 |
| Database container/volume | supabase_db_school-queue-local |
| Gateway/network | supabase_kong_school-queue-local / supabase_network_school-queue-local |
| Docker context endpoint | npipe:////./pipe/dockerDesktopLinuxEngine |
| Current postgres inventory | 70 logical tables; seven daily message leaves, October 15–21 |
| Application history | Exactly migrations 001–006 and their original file hashes |
| Fixed routing | 1:TP, 2:SOA, 3:PNEP, 4:REF, 5:ADJ |
| Work | Zero active tickets; no open day |

Compared with the immutable 71-table capsule, the only missing table remains
`realtime.messages_2026_10_14`. No new table appeared in either main assessment.
The missing leaf and its associated catalog entries remain explicit failures.
Table-count equality with the older 70-table bundle does not imply inventory equality:
that bundle contains October 14–20, whereas the current source contains October 15–21.

| Current leaf | Inclusive lower bound | Exclusive upper bound | Rows |
| --- | --- | --- | ---: |
| messages_2026_10_15 | October 15 00:00 | October 16 00:00 | 0 |
| messages_2026_10_16 | October 16 00:00 | October 17 00:00 | 0 |
| messages_2026_10_17 | October 17 00:00 | October 18 00:00 | 0 |
| messages_2026_10_18 | October 18 00:00 | October 19 00:00 | 0 |
| messages_2026_10_19 | October 19 00:00 | October 20 00:00 | 0 |
| messages_2026_10_20 | October 20 00:00 | October 21 00:00 | 0 |
| messages_2026_10_21 | October 21 00:00 | October 22 00:00 | 0 |

All seven are permanent ordinary leaves attached directly to `realtime.messages`,
whose partition key is RANGE(inserted_at). Their owner remains
supabase_realtime_admin. Parent and logical rows are empty at these observations.
Full captured ownership/ACLs, bounds and remaining catalog definitions match the
archive's corresponding objects. The parent retains RLS; physical leaves retain
RLS=false/forced=false. Every leaf has absent column ACLs, the correct two parent-index
attachments and effective direct table privileges denied for anon, authenticated and
service_role. No security setting was repaired or inferred safe merely from emptiness.

Evidence: [main read-only assessment](tests/results/realtime_lifecycle_recovery_diagnosis_a982ed79.json).

## Pinned automatic creation and pruning implementation

Installed image: `public.ecr.aws/supabase/realtime:v2.143.4`, ID
`sha256:35e99d3f1cbba5aa5585e8ac3cf70ecc54909ee4aee0626effed93c60fb41439`.
The release file still reports `16.4.0.4 2.143.4`. The reviewed official tag's commit
is `fa948248588b55692114c9c3536cd71780d14e4b`. Nine fixed source/test files were fetched
at that commit and checksummed in a new receipt; no source or dependency was patched.
This is version/image/source correspondence, not an independent reproducible-build
attestation.

The pinned creation routine creates daily names `messages_YYYY_MM_DD` from UTC
yesterday through today+3 inclusive and assigns supabase_realtime_admin ownership.
Connection initialization invokes creation after its migration step. The janitor's
maintenance task invokes cleanup first, then creation.
[Creation implementation](https://github.com/supabase/realtime/blob/fa948248588b55692114c9c3536cd71780d14e4b/lib/realtime/tenants.ex),
[connection path](https://github.com/supabase/realtime/blob/fa948248588b55692114c9c3536cd71780d14e4b/lib/realtime/tenants/connect.ex),
[maintenance task](https://github.com/supabase/realtime/blob/fa948248588b55692114c9c3536cd71780d14e4b/lib/realtime/tenants/janitor/maintenance_task.ex).

Cleanup computes the UTC date after subtracting 72 hours from the current UTC time.
It parses each candidate child's date from its name and drops dates **strictly before**
that cutoff. It does not count rows or check emptiness before DROP. Its catalog query
filters parent name `messages` and child schema `realtime`, but does not independently
validate parent schema, actual bounds, owner or ACLs. Those implementation checks are
therefore insufficient as a preservation-policy security boundary.
[Pinned cleanup implementation](https://github.com/supabase/realtime/blob/fa948248588b55692114c9c3536cd71780d14e4b/lib/realtime/messages.ex).

On **October 18 UTC**, the cutoff date is **October 15**. October 14 is eligible for
removal; October 15 is retained. With existing earlier leaves, a completed cleanup
and creation pass can leave October 15–21. This is date-rounded partition retention,
not a guarantee that every individual message lives exactly 72 hours. Upstream tests
exercise deletion of older messages and the resulting day range; those Elixir tests
were read, not executed locally.
[Upstream maintenance tests](https://github.com/supabase/realtime/blob/fa948248588b55692114c9c3536cd71780d14e4b/test/realtime/tenants/janitor/maintenance_task_test.exs).

### Scheduling and local configuration

The container explicitly sets `RUN_JANITOR=true`. It has no explicit override for
the six other inspected janitor variables. Resolving the pinned runtime defaults gives:

| Setting | Value |
| --- | --- |
| Recurring base interval | 14,400,000 ms — four hours |
| Randomization | Enabled; an additional integer 1–59 minutes per timer |
| Extra initial delay | 600,000 ms — ten minutes |
| Chunk size / maximum children | 10 / 5 |
| Child timeout | 5,000 ms |

The initial scheduling expression adds that extra delay to the randomized timer;
subsequent passes use the randomized timer. These values come from the inspected
container environment plus pinned source defaults. The running Erlang application's
in-memory environment and actual pending timer were not queried. Scheduling/tenant
eligibility, uptime and failures can affect when a particular cleanup occurs; no exact
deletion time is inferred from these defaults.
[Runtime configuration](https://github.com/supabase/realtime/blob/fa948248588b55692114c9c3536cd71780d14e4b/config/runtime.exs),
[janitor scheduler](https://github.com/supabase/realtime/blob/fa948248588b55692114c9c3536cd71780d14e4b/lib/realtime/tenants/janitor.ex),
[conditional supervisor](https://github.com/supabase/realtime/blob/fa948248588b55692114c9c3536cd71780d14e4b/lib/realtime/application.ex).

Source receipt: [9aab6f3b](tests/results/realtime_lifecycle_pinned_source_9aab6f3b.json),
SHA-256 `b01cfdca8d72c133246b6670b646041fe04f29fbbbad1a3c47222507e518fb7b`.

## What the deletion evidence establishes

**Confirmed:** automatic pruning exists in the pinned version; the current date/name
pattern fits it; the source leaf is absent; and pg_stat_statements contains one exact
matching DROP statement entry under **supabase_admin**, with calls=1 and rows=0.
That is an observed database execution-role statistic. It does not independently
identify an operator, application process, transaction, commit outcome or deletion
timestamp. In particular, rows=0 for a utility command is **not a pre-drop row count**.
Statistics are aggregate/resettable observations, not an immutable DDL audit trail.
[PostgreSQL statement-statistics reference](https://www.postgresql.org/docs/17/pgstatstatements.html).

The inspected source has log_statement=ddl, pgaudit.log=none and
pg_stat_statements.track_utility=on. A bounded Realtime log read requested 600 lines
over 12 hours; its selected fixed categories showed partition creation, without a
correlated deletion/empty-check record. A separate PostgreSQL container-log read
requested 1,500 lines over eight hours and received 308 lines, with no exact matching
DROP text. Neither bounded sample proves that no relevant log exists elsewhere.
Raw messages, environments, queries other than the fixed statement category and
private records were not persisted.
[Bounded database-log result](tests/results/realtime_drop_log_review_326fb8c2.json).

**Inference:** the observed removal is consistent with Realtime retention maintenance.
**Unresolved:** which specific invocation performed it and whether the leaf was empty
at that instant. The protected snapshot proves zero rows at its own earlier capture,
not throughout the interval before deletion. Browser-role privilege denial also does
not exclude writes by privileged/platform processes. No reliable deletion-time
emptiness proof was found. Thus the removal cannot be certified as safe, permitted
maintenance under the requested no-data-loss preservation contract.

## Preservation-policy review — production classifier unchanged

The existing strict failure remains the correct outcome. No blanket Realtime exclusion,
arbitrary deletion allowance, table-count shortcut or application/Auth exception was
added. Immutable historical snapshots and all prior FAIL evidence remain unchanged.

The new **pure offline design model** can identify a candidate only after exact pinned
image/release, leaf name/date, parent, one-day bounds, owner and complete reviewed-template
equality, with explicit historical count=0 and empty row-hash evidence. It rejects
nonempty/missing evidence, owner/bound/security changes, wrong versions and dates still
inside retention. **Even its matching candidate returns preservation_pass=false and
deletion_authorized=false.** It has no live adapter or authorization effect.

A future narrowly scoped permissive rule would require separately reviewed, independently
verified evidence tying the exact pre-drop catalog/security state and identity to an
empty check protected against intervening writes and the DROP in the same transaction,
plus durable actor/transaction evidence and exact unrelated state preservation. A
snapshot taken minutes earlier, an age predicate, an ordinary log line or an asserted
boolean receipt is insufficient. Obtaining such evidence would require a separately
authorized observation/instrumentation design; this task did not install one. It cannot
retroactively recover the missing proof. Nonempty partitions containing retained data
must never qualify. A later policy review must preserve the present FAIL rather than
rewrite history as if that proof existed.

## Historical archive integrity and Windows transport review

All recorded valid artifacts were privately decrypted and verified against their
recorded ciphertext and plaintext sizes/hashes: **four** in b44b72f5, **nine** in
93426091 and **ten** in 8fa0e0c7. Deliberately invalid synthetic ciphertext is excluded
from their artifact maps and remains negative-test evidence. Original run evidence
hashes also matched. No artifact was re-encrypted, rewritten or used as a new snapshot.

The completed capsule remains:
`.local-backups/dual_20261018T051715Z_93426091`, snapshot **d7f3aa3b**.
Its 537,857-byte custom archive still hashes to
`d6c831973afee9feddfa59637d5f6eaeb5a6a85e51a43a53844b07f1ceb1a29c`.
Offline TOC validation against **its own captured manifest** again found 71 logical
tables, 70 physical TABLE DATA entries and eight partition attachments, without data
exclusions. Current live inventory was not used to redefine this historical coverage.

Private native pg_restore reconstruction with `--file=-` exited zero. No SQL was
executed. All 23 multiline application bodies matched the snapshot's verified function
references: zero original bodies matched raw stdout, all 23 matched its CRT-expanded
form, and all 23 original bodies matched after decoding. The custom archive hash
remained unchanged. Binary get/decrypt paths return bytes directly; text decoding is
used for TOC, roles and reconstructed SQL, not the custom archive.

The correction is technically valid for the **observed Windows native text-output
mode**: CRT output expands each LF to CRLF, so reversing that expansion once restores
original LF, embedded CRLF and lone-CR sequences. Microsoft documents text/binary
translation behavior. The new tests also show why the transformation must not be
applied indiscriminately: an already untranslated original CRLF would be changed.
Porting the helper or changing native executable/output mode therefore needs a fresh
transport check, not an assumption that every stream needs normalization.
[Microsoft CRT modes](https://learn.microsoft.com/en-us/cpp/c-runtime-library/reference/setmode?view=msvc-170).

The added regression coverage includes mixed Unicode/function/COPY text, 128 deterministic
generated newline cases within one method, invalid UTF-8 rejection and a binary-store
identity test that fails if the text decoder is called. This strengthens coverage of
the known defect; it does **not** replace full restored data/function/security comparisons.
Whole reconstructed-SQL hashes can also vary because pg_restore generates a random
psql restriction key by default. Archive hashes and bound semantic comparisons remain
the relevant evidence; a changed reconstruction hash alone is not proof of archive
corruption. No fixed key was introduced into the recovery workflow.
[pg_restore reference](https://www.postgresql.org/docs/18/app-pgrestore.html).

### Independent historical restoration is possible, but not executed here

The existing runner couples archival verification to a live-source preflight:
`Run.main_source()` invokes the strict live classifier, and
`import_complete_postgres()` requires today's catalog to equal the historical capsule's
catalog. The current reference verifier additionally requires both databases already
verified and current-inventory equality. Those are current combined-recovery gates;
they are not evidence that an intact historical archive cannot be restored.

A separately authorized historical-only verifier should bind the original evidence,
manifest, archive, strict captured dump fences, source-derived supplements and code
hashes, then restore that historical unit into a **new** guarded, network-none/no-TCP
cluster. It should require exact 71-table historical data/security/roles/sequences
with no pruning or operational exemptions. It must assess live preservation separately,
retain the known live FAIL and report any successful result as **historical snapshot
recoverability**, never current-inventory recovery. No live catalog equality is needed
to test that historical claim, and no source object needs to be recreated.

This needs a new reviewed entry point; the existing combined runner/verifier was not
changed or bypassed. The two earlier partial clones remain stopped, with volumes
retained. No new isolated cluster was created and the corrected full restore remains
unperformed. Neither archive integrity nor the synthetic model certifies recovery.

## Analytics dependency assessment

`_supabase` did not begin because `Run.run()` processes postgres first and calls its
restore before proceeding to Analytics. The PostgreSQL failures interrupted that loop;
the later live-source pruning failure stops even earlier. This dependency is an
orchestration choice, not a PostgreSQL requirement that one database's new restoration
must succeed before a separate database can be backed up.

**Analytics recovery can be designed as an independent, separately authorized operation.**
It still needs exact loopback/project/cluster/volume checks, six migrations/routing,
unchanged application/Auth/security state, intact historical artifacts and explicit
review of the known live pruning discrepancy. That review must not pretend the strict
postgres gate passes or quietly bypass an applicable infrastructure prerequisite.
An independent result must make no claim of new postgres recovery or repair clearance.

The Analytics operation needs its own fresh complete inventory/exported read-only
snapshot, encryption, strict non-MVCC sequence/role/security fences and actual isolated
restore with exact jobs/peers/data/schema/ACL comparisons. A fence change must stop
that attempt without stopping workers or relaxing checks. No backup/restore started
here. Read-only Analytics inspection found **39 tables, 1,210 rows**, with changed
job/peer fingerprints compared with the earlier assessment even though counts were
again 1,012 jobs and one peer. The job sequence was **2,101**. All other compared rows,
schema/security, roles and settings matched. Cross-database atomicity, temporary-slot
continuity and operational service recovery remain separate matters.

## Preservation, tests and scope

Both main source observations compared 69 shared non-subscription tables with the
historical 71-table snapshot: all matched. Roles, additional privileges/settings,
routing, ancillary objects, functions, policies, triggers and other unaffected schema
sections matched. The full catalog remains unequal because of the missing leaf.
There is no database-wide immutability claim.

Retained state remains 39 accounts/39 Auth users/26 identities, 20 terminal tickets,
57 events, 69 replay receipts, 32 audits, seven historical days and four staff assignments.
Counter availability and the stale Counter 5 STUDENT fixture remain intact. All 15
application tables retain RLS; browser roles lack queue_private USAGE. The application
publication contains only counter_state/service_state. Two anonymous public subscriptions
passed their scope check; allocation was **406 at both ends**, compared with 400 in
the preceding task's final observation. Other sequences matched. No allocation cause
is attributed.

All eleven non-Vector service identities/definitions/lifecycles matched the prior
record and the current before/after checks. Vector remains the original unrepaired
TCP definition with its known automatic restart loop. Docker resource inventory was
unchanged; no container, volume or network was created or deleted. Its YAML and all
repair/activation locks matched. Google remains disabled. The Google credential store
was inspected by metadata only, never opened, hashed or decrypted.

All three historical verified bundles passed artifact/association/protected-access
checks, including the historical 70-table bundle with manifest hash
`50164d4afb5083a83044f5ee3df3d13b1b2002ba29ee03143e460c181b915a52`.
All **81 existing backup-tree files** retained digest
`385138f0c3da32fca227d8511d527d679a96899e43d65cd8ec5142ad63f5a8f4`.
This includes failed/synthetic material and is not a count of verified backups.
All **243 frozen existing/code inputs** matched during the main assessment.

| Check | Passed | Failed | Not performed |
| --- | ---: | ---: | --- |
| New synthetic lifecycle/archive/transport review methods | 17 | 0 | 0 |
| Existing dual-recovery offline methods, rerun | 22 | 0 | 0 |
| Unchanged production classifier regression methods, rerun | 24 | 0 | 0 |
| Pinned source, valid encrypted artifacts and offline reconstruction | PASS | 0 | No restore SQL execution |
| Live strict preservation policy | 0 | 1 expected retained FAIL | No policy change |
| Service/resource/artifact/credential-metadata preservation | PASS | 0 | No mutation |
| Corrected complete isolated PostgreSQL restore | 0 | — | Not authorized in this task |
| Analytics backup/restore | 0 | — | Not authorized in this task |

There are **63 passing offline methods**, with zero test failures/skips. Generated
subcases and repeated executions are not added as methods. The expected strict
preservation failure is recorded independently. No older Windows crypto, recovery,
frontend or provider counts are claimed as newly run tests. Python syntax and whitespace
checks passed. An initial public-source network request was sandbox-blocked; its approved
read-only retry succeeded. No automatic approval rejection or unfinished permission
request remains.

Created only the new source-review script, pure review model, 17-method test module,
read-only diagnosis script, new sanitized evidence and this report. Existing production
classifier, recovery/credential/activation/Vector implementations, old evidence/reports,
manifests, migrations, configuration, dependencies and environment files were retained.
No retained SQL write, new dump, restore execution, service restart/repair, Google login,
credential-store change, hosted Supabase contact, image/dependency installation,
backup/container/volume deletion, deployment, commit or push occurred.

## Recommended follow-up order and stop boundary

1. Review this retention finding and the missing deletion-time proof. Keep the strict
   failure and historical manifests unchanged. Separately review any future lifecycle
   evidence design; do not grant arbitrary pruning permission.
2. Separately authorize and review an archive-only independent restore of capsule
   93426091 into a new isolated cluster. Complete the corrected transport, all exact
   comparisons, supplemental-grant target rejection and stopped-volume preservation.
   Its outcome can certify that historical snapshot only.
3. Separately authorize an independent complete `_supabase` encrypted backup and
   actual restore after the current safety/discrepancy review. Remove the unnecessary
   automatic dependency on a new postgres restore only in a reviewed new workflow;
   retain strict Analytics consistency fences.
4. Decide the current postgres recovery/preservation reference explicitly after the
   known discrepancy review. A historical restore PASS cannot silently certify today's
   inventory or erase the earlier failure.
5. Only after the applicable recovery and concrete retained-plan gates are satisfied,
   review separate Vector execution approval and its daemon authority, rollback and
   delivery acceptance. Google activation remains a later separately approved phase.

**Retained preservation remains FAIL for pruning; current-inventory recovery remains
unsatisfied; historical corrected restore and Analytics recovery remain unverified.
Vector repair and Google activation remain blocked and locked.** This investigation
completed its authorized scope without performing any proposed next operation.

Primary assessment SHA-256:
`57111c843c5f3b98a42c3e46be18fbd46a4d15bb7a879fe7662d52547297865a`.
Bounded log-review SHA-256:
`697a940bdaf4c75b75020a108f843f1969d816c230f2618f0a24341350474d3a`.

**Stopped after read-only investigation, offline tests and this report.**
