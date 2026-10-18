# Engineering report: Step 21 preservation postvalidation

Date: October 17, 2026. Overall result: **FAIL — stopped at the public-board browser
network/runtime acceptance guard.** The Realtime classification repair, retained-source
checks, 24 new regression methods, 85 frontend tests and 15 OAuth browser checks passed.
The separate public-board suite passed 14 checks and failed its final guard. Full task
acceptance and permission to proceed with Google configuration are **not established**.

No migration, provider configuration, real Auth mutation or business-record change was
requested. Previous reports, failed evidence and recovery manifests remain unchanged.

## Original preservation failure and platform evidence

The old wrapper required exact equality with the historical 69-table snapshot except
for one subscription sequence. It therefore rejected both a new daily message leaf
and transient subscription rows. This was a checker policy gap; the original exact
comparison really failed and its historical FAIL evidence has not been changed.

Read-only inspection confirmed Realtime image
`public.ecr.aws/supabase/realtime:v2.143.4`, image ID
`sha256:35e99d3f1cbba5aa5585e8ac3cf70ecc54909ee4aee0626effed93c60fb41439`.
The running release file reports Erlang `16.4.0.4`, Realtime `2.143.4`. The official
version tag resolves to commit `fa948248588b55692114c9c3536cd71780d14e4b`.
Source URLs and SHA-256 hashes are retained in
[the source review](tests/results/realtime_platform_source_review.json).

That version creates daily `realtime.messages` partitions from UTC yesterday through
three days ahead, using one-day ranges and `supabase_realtime_admin` ownership.
Tenant connection and janitor maintenance invoke this operation. October 20 is within
the October 17 creation window. This supports classification as the documented platform
pattern. There is no historical DDL audit proving the exact creation time or which
invocation created this particular leaf; attribution remains an inference from the
pinned code and matching catalog. See the pinned
[partition implementation](https://github.com/supabase/realtime/blob/fa948248588b55692114c9c3536cd71780d14e4b/lib/realtime/tenants.ex),
[connection path](https://github.com/supabase/realtime/blob/fa948248588b55692114c9c3536cd71780d14e4b/lib/realtime/tenants/connect.ex)
and [maintenance path](https://github.com/supabase/realtime/blob/fa948248588b55692114c9c3536cd71780d14e4b/lib/realtime/tenants/janitor/maintenance_task.ex).

| New leaf property | Verified observation |
| --- | --- |
| Relation | realtime.messages_2026_10_20; ordinary permanent partition |
| Parent / partition key | realtime.messages / RANGE(inserted_at) |
| Bound | October 20 00:00 through October 21 00:00, exclusive upper bound |
| Owner | supabase_realtime_admin |
| Rows | Zero; logical parent and all seven physical leaves remain empty |
| Columns | Ten exact existing-template columns, types, defaults and nullability |
| Constraints | PRIMARY KEY(id, inserted_at); payload/binary_payload exclusivity CHECK |
| Indexes | Exact primary-key and private-broadcast inserted_at/topic indexes; both valid/ready and attached to the correct parent indexes |
| RLS / forced RLS | false / false, matching the reviewed physical-leaf template |
| ACLs | Exact template grantors, grantees, privileges and grant options; no column ACL |
| Browser-role access | anon, authenticated and service_role have no direct leaf table privileges |
| Publication | Only the existing platform supabase_realtime_messages_publication |

The parent retains its original RLS and ACLs. Leaf RLS=false was evaluated together
with effective privileges, rather than assumed safe because the leaf is empty.
Effective table privileges were denied for all three browser-facing roles on every
physical leaf, including inherited/PUBLIC access. The application publication remains
exactly `queue_display.counter_state` and `queue_display.service_state`.
Actual anonymous REST requests for `realtime` and `queue_private` profiles both returned
HTTP 406 / PGRST106. No new exposed REST schema was observed.

## Strict checker implementation

`tests/frontend/realtime_preservation.py` pins the immutable postvalidation snapshot's
SHA-256 and the running Realtime image/release. It compares the full captured source
against that snapshot and separately against the unchanged recovery manifest.

Only these differences are classified:

1. **Empty daily leaf additions** within the pinned implementation's current UTC
   creation window. Each added catalog row, relation/ACL, column, constraint, index,
   partition bound/ancestry and platform publication entry must equal the reviewed
   historical leaf template after exact date/name substitution. Live checks also
   require correct index ancestry, absent column grants and denied browser privileges.
2. **Subscription rows** only when every current row describes an anonymous,
   unfiltered `*` subscription to one of the two public display tables, with no subject
   claim, no selected-column override and positive allocation IDs. The same read-only
   snapshot captures both row fingerprints and this scope check. Missing/null scope
   evidence fails. Raw claims, IDs and tokens are not emitted.
3. **subscription_id_seq allocations** only with its existing definition/security
   unchanged, a nondecreasing value, called state and current row IDs within allocation
   bounds. Every other sequence remains exact.

Realtime subscriptions are backend-managed connection metadata, not queue transactions;
the pinned implementation creates/updates them and deletes them during unsubscribe or
cleanup. They cannot be used to exempt changes to other rows. See
[the pinned subscription implementation](https://github.com/supabase/realtime/blob/fa948248588b55692114c9c3536cd71780d14e4b/lib/extensions/postgres_cdc_rls/subscriptions.ex)
and [subscription manager](https://github.com/supabase/realtime/blob/fa948248588b55692114c9c3536cd71780d14e4b/lib/extensions/postgres_cdc_rls/subscription_manager.ex).

All other rows and metadata remain exact, including Auth, application/display data,
migration history, fixed routing, roles, functions, RLS, grants, default privileges,
database-setting hashes and application publication. Unknown objects are reported by
named comparison paths without exposing private values. Wrong bounds/parents/owners,
extra grants/indexes/triggers/publications, nonempty new leaves and private/authenticated
subscription metadata fail. Partition deletion/pruning and message writes are deliberately
not permitted by this policy; a later maintenance difference requires separate review.
There is no blanket exclusion for the realtime schema.

The frontend wrappers now use this classifier and identify exactly the new browser
evidence file created by their invocation. A new orchestration identity preserves
earlier evidence instead of overwriting it. No historical backup comparator was changed.

## Completed checks and required stop

| Check/group | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| New preservation regression methods | **24** | **0** | **0** |
| Frontend unit/controller/SSR/SDK tests | **85** | **0** | **0** |
| Mocked OAuth browser acceptance | **15** | **0** | **0** |
| Public-board SDK/browser acceptance | **14** | **1** | **0** |
| Anonymous REST schema-denial checks | **2** | **0** | **0** |
| Read-only preflight, scoped preservation and recovery-artifact checks | PASS | 0 | 0 |
| Final read-only preservation after failure | PASS | 0 | 0 |
| Python syntax and diff whitespace checks | PASS | 0 | 0 |
| Production build / private-key scan planned after browsers | 0 | 0 | 1 — stopped |
| Real Google authentication/provisioning | 0 | 0 | Outside scope; provider disabled |

Repeated executions are not added together. The 24 methods test real recorded catalog
additions and reject malformed/far-future partitions, owner/ACL/RLS/bound/parent/index/
column/constraint changes, unknown functions, publication exposure, application/Auth
mutations, migration/routing changes, missing scope evidence and sequence regression.
They also prove subscription changes cannot mask business mutations.

The new OAuth browser run passed all 15 existing scenarios with actual Vue/SDK and
intercepted OAuth, session and authoritative-context responses. No mocked Auth mutation
was forwarded to the retained service. Its real public monitor traffic passed the
new preservation fence. Evidence:
[google_oauth_frontend_f1df006d.json](tests/results/google_oauth_frontend_f1df006d.json).

The public-board run passed real anonymous snapshots, both listeners, forced transport
closure/fresh reconnect reads, owned-controller cleanup, offline recovery, root/monitor
composition, four real viewports and three labeled simulated-call layouts. Its final
`No private/operational/hosted request or uncaught runtime error` check failed with
`Browser interception failure`. Evidence:
[public_board_46bba6cd.json](tests/results/public_board_46bba6cd.json).

The blocked-endpoint list is empty, and no `Uncaught browser exception` entry was
recorded. The existing interception catch discards the underlying CDP exception and
event association. Consequently the cause cannot be established from this evidence.
A cancelled/invalid paused request is a possible explanation, not a proven diagnosis.
This failure is neither proof of a data leak nor a passing privacy acceptance check.
The guard was not weakened, its error was not ignored, and the suite was not retried.
The runner stopped before build and subsequent acceptance work.

An earlier orchestration attempt, `f52a3faa`, stopped because its new parser expected
TAP `# pass 85`, while Node 24.18.1 emitted spec-format `pass 85`. The frontend subprocess
exited 0; a direct diagnostic confirmed 85 passing tests. Only that parser was corrected
before the fresh `66bd264d` run. Its original FAIL evidence remains unchanged. That
automation error does not alter the later unresolved browser failure.

## Retained source, recovery and final result

Identity was independently verified before and after testing: project
`school-queue-local`, PostgreSQL `127.0.0.1:54322/postgres`, API
`http://127.0.0.1:54321`, server 17.11, cluster `7696959712798593061`, and the original
database/gateway/network/volume identities. Six migration versions and file hashes
remain unchanged, with migration 006 present once.

Final retained state is unchanged: 39 accounts, 20 terminal tickets, 57 events,
69 replay receipts, 32 audits, seven closed days, five services/counters and four
staff assignments. There are zero WAITING/CALLED tickets and no open days. Routes
remain 1:TP, 2:SOA, 3:PNEP, 4:REF, 5:ADJ. The stale Counter 5 STUDENT fixture is intact.
All original application/Auth/history rows match their immutable baselines. All 15
application tables retain RLS; browser roles still lack queue_private usage.

The live inventory remains 70 tables. No additional partition appeared during this
run. Against the task's initial capture, all 69 tables outside the explicitly scoped
subscription table and all schema/security/role/settings metadata matched exactly.
Transient subscription counts included 26 immediately after OAuth browser activity,
then returned to the original two anonymous public subscriptions. The allocation
sequence advanced from 118 to 162; other sequences were unchanged.

Protected recovery artifact hashes, associations, generated supplements and restricted
NTFS access passed again in the final read-only diagnostic. The original verified
six-version bundle remains a historical **69-table recovery point**, not a new dump
of the current 70-table inventory. No snapshot was rebased and no backup/restore was
performed. Existing exact backup source-equality commands may still reject these
explicitly recorded operational differences. A fresh verified recovery inventory
should precede later provider/infrastructure changes.

**The preservation failure is repaired within the reviewed classification scope.
Step 21's complete requested postvalidation is still FAIL because the separate browser
guard failed. It is not appropriate to treat this run as clearance for Google provider
configuration.** A later authorized repair should capture sanitized CDP error codes,
request categories and cancellation correlation, resolve the browser guard without
weakening it, and complete the stopped checks. Real OAuth setup remains a separate task.

Evidence:
[stopped orchestration](tests/results/google_frontend_postvalidation_66bd264d.json),
[final preservation/artifact diagnosis](tests/results/google_frontend_postvalidation_final_66bd264d.json),
[initial catalog/security inspection](tests/results/realtime_preservation_security_inspection.json).

## Files

Modified only `tests/frontend/run_google_auth.py` and `tests/frontend/run_public_board.py`.
Created:

- `tests/frontend/realtime_preservation.py` — strict classifier and read-only capture.
- `tests/frontend/test_realtime_preservation.py` — 24 offline regression methods.
- `tests/frontend/run_google_auth_postvalidation.py` — separate evidence orchestration.
- `tests/frontend/diagnose_google_postvalidation.py` — final read-only failure preservation.
- `supabase/tests/inspect_realtime_preservation.py` — read-only catalog/version investigation.
- New sanitized inspection/source-review/run/final-diagnosis evidence and browser screenshots.
- This report.

Existing browser test implementations and product source were retained. No application
or Auth record, migration SQL, RLS/grant, provider/environment setting, recovery artifact
or Docker volume was changed. No hosted Supabase project was contacted. Official
Realtime source was downloaded read-only from GitHub. No reset, push, link, deployment,
administrator designation, operational issuance, volume deletion, Git commit or push
occurred. Owned browser/Vite processes exited; disposable profiles/evidence were retained.

**Stopped after the required browser-guard failure and final read-only checks.**
