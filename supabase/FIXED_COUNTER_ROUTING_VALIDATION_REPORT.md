# Engineering report: sixth migration and isolated fixed-routing validation

Date: October 16, 2026. Result: **PASS for the completed isolated runs**.
The migration is ready for retained-local cutover review. **It has not been applied
to the retained development database.** Production deployment is outside this approval.

## Migration and enforcement

Created [20261016000600_fixed_counter_routing.sql](migrations/20261016000600_fixed_counter_routing.sql).
All five original migration files retain their original SHA-256 hashes.

| Counter | Mandatory service |
| --- | --- |
| 1 | TP — Tuition Payment |
| 2 | SOA — Statement of Account |
| 3 | PNEP — Promissory Notes and Exam Permits |
| 4 | REF — Refund Process |
| 5 | ADJ — Adjustment Clerk |

The migration retains `counter_services`, its composite primary key, both parent
foreign keys and the existing ticket-to-route composite foreign key. It adds:

- `counter_services_one_service`: UNIQUE(counter_id).
- `counter_services_one_counter`: UNIQUE(service_id).
- A private canonical-code helper and complete-map validator. Validation requires
  exactly five counters, five services and all five correct numbered/code pairs.
- Deferred constraint triggers on routes, counters and services. Removing a route,
  deleting a parent or changing its identity cannot commit an incomplete/wrong map.
  Closed counters and disabled services must still retain their fixed relationship.
- Statement triggers that acquire the existing queue mutex before tuple changes;
  TRUNCATE is rejected. Direct ordinary SQL changes receive the same final-map checks.
- A replacement body for `configure_counter`, with its original signature/ACL.
  New requests require exactly one correct service, including when closing a counter.
  Valid requests change staffing/open state without deleting/reinserting the route.

The ADMIN check, current enabled-account check, mutex, busy-counter guard, eligible
cashier validation, request arguments/operation name, audit, replay and display
refresh behavior remain. New helper functions pin an empty search_path, qualify
database objects and have no PUBLIC/anon/authenticated/service_role EXECUTE grants.
The existing application grants and RLS policies are unchanged. Trusted database
owners can change/disable database controls and remain outside the browser-role
security boundary.

The migration refuses active WAITING/CALLED tickets, takes bounded locks, normalizes
only service relationships, validates the resulting matrix, writes one
`FIXED_ROUTING_CUTOVER` audit containing old/new matrices, refreshes display projections
and commits atomically. It does not change counter availability, staff assignments,
accounts, queue days, ticket numbers, events, allocators, quotas or old replay records.
No issuance/call/finish algorithm or RPC signature was changed.

## Disposable environments

Both projects used PostgreSQL 17.11 and separate project identities, networks,
database volumes and verified loopback-only published ports.

| Purpose | Project ID | API | PostgreSQL | Database volume |
| --- | --- | --- | --- | --- |
| Populated legacy upgrade | sq-routing-upgrade-b558edf3 | 127.0.0.1:55321 | 127.0.0.1:55322 | supabase_db_sq-routing-upgrade-b558edf3 |
| Fresh installation | sq-routing-fresh-b558edf3 | 127.0.0.1:56321 | 127.0.0.1:56322 | supabase_db_sq-routing-fresh-b558edf3 |

Configuration/workdirs are under ignored `.local-routing/b558edf3/`. Docker container
names, running state, published HostIp/ports, volume names and CLI status URLs were
checked before application SQL/test phases. SQL and HTTP test processes independently
validate their exact endpoints; redirects and hosted URLs are not used.

Platform startup initially exposes only `public`, avoiding schema-cache errors
before application schemas exist. After migration, a disposable-only PostgREST
configuration reload exposes `public,queue_api,queue_display`, never `queue_private`.
No container restart was needed for that exposure step. This uses the documented
[PostgREST in-database configuration and reload mechanism](https://docs.postgrest.org/en/stable/references/configuration.html).

Both disposable projects are **stopped with their volumes/data retained**. No reset,
volume erasure or retained-project shutdown was performed. The retained project
`school-queue-local` remains at its original ports and still has **five migrations,
39 accounts and 20 tickets**, with zero active tickets. Full-row fingerprints of
all 15 application/display tables plus Auth users/identities match the pre-task
baseline. Retained access during this task was read-only.

## Test results

Final completed suite counts are reported separately; repeated assertions across
the two database environments are not additional unique coverage.

| Validation | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Fresh pgTAP: original queue 35 + read context 44 + fixed routing 44 | **123** | **0** | **0** |
| Populated-upgrade pgTAP: read context 44 + fixed routing 44 | **88** | **0** | **0** |
| Adapted concurrency suite | **3** | **0** | **0** |
| Focused current-day HTTP/routing/replay/Realtime suite | **23** | **0** | **0** |
| Adapted API authorization/Realtime privacy suite | **27** | **0** | **0** |
| Adapted remaining API suite | **18** | **0** | **5** |
| Existing frontend service/controller/rendering suite | **51** | **0** | **0** |
| Offline migration structural suite | **6** | **0** | **0** |
| Database lint, both disposable projects | No schema errors | 0 | 0 |
| Production build and known-private-key bundle scans | Passed | 0 | 0 |

JavaScript/Python syntax checks and Git diff whitespace checks also passed. Postflight
compared **all 23 application function bodies** with the final migration definitions
in both environments. Issuance, call-next and finish-ticket bodies match the original
migration. Actual COMMIT attempts to remove a mandatory route failed with SQLSTATE
23514 in each project, and full row fingerprints confirmed complete rollback.

The five remaining-suite skips are explicit: four current-day issuance checks
preserve the current day already closed by the preceding concurrency suite; the
separate focused HTTP suite successfully covers those scenarios on a newly opened
current day. The fifth skip is an actual server-clock midnight crossing while a
request waits on a lock. No host clock or existing day was changed to force it.
Deterministic date-boundary/read projections and issuance-day quota assertions
passed; these do not establish a real wall-clock midnight contention result.

Evidence:

- [Project identity, pgTAP summaries and retained preservation](tests/results/routing_isolation_b558edf3.json).
- [Positive HTTP and historical replay: 23 checks](tests/results/fixed_routing_http_184ac129.json).
- [API/Realtime authorization: 27 checks](tests/results/api_realtime_dc37ad1c.json).
- [Remaining API: 18 passed / 5 skipped](tests/results/remaining_api_64fcacbb.json).
- [Concurrency: 3 checks](tests/results/routing_fresh_concurrency_b558edf3_1792152033.json).
- [Fresh postflight](tests/results/routing_postflight_fresh_b558edf3.json) and
  [populated-upgrade postflight](tests/results/routing_postflight_upgrade_b558edf3.json).

## Queue correctness, authorization and privacy

**Positive current-day HTTP issuance passed.** A real ADMIN session opened a new
current Manila day through `manage_day`; real STUDENT sessions then issued tickets
through the HTTP Data API. TP numbering began at 1 and continued sequentially;
SOA and PNEP each began independently at 1. Eight same-key issuance retries returned
one receipt/ticket/event, changed parameters rejected, an active ticket blocked
another service, and a third TP request after two served tickets hit the served quota.

Two eligible cashiers competing at the same fixed TP counter produced one call
and one precise busy rejection. Concurrent completion/retries, eight-owner SOA
numbering, skip retries, skip-to-tail order, eventual-service quota counting and
closure contention passed. Historical ADJ completions charged their issuance day,
not their completion date. Failed actions left no replay record or ticket change.

An HTTP issuance was deliberately aborted while blocked on the queue mutex. The
server had committed before the retry in the observed run. Retrying the **same UUID**
returned the original PNEP-001 and one ISSUED event. The remaining suite also exercised
interrupted cashier calls, discarded responses and unchanged-key reconciliation.
These tests do not justify allocating a new key automatically after an interruption.

Actual HTTP tests covered anonymous denial, owner-only student history, foreign
history denial, metadata promotion rejection, ADMIN-only configuration, assigned
counter enforcement, and rejection of SOA at the TP counter. Revoked/disabled users'
existing sessions lost protected privileges. Busy cashier demotion/disablement was
guarded, and completion versus demotion preserved ticket correctness.

Public updates showed the correct numbered counters, current labels and waiting
counts. Reconnect waited for backend readiness and reconciled a fresh snapshot.
Field allowlists and private canary/token scans found no student identity or account
UUID leakage. Seven unauthorized private subscriptions failed to establish a data
path, including retained subscriptions across role/enable changes. Anonymous sanitized
display data remains public even after disablement. Negative subscription observations
are bounded and supported by catalog/grant checks.

Both postflights found zero active tickets, duplicate daily numbers or served-quota
violations. All 15 tables retain RLS; Realtime publishes only `counter_state` and
`service_state`. No application authorization vulnerability, routing race, privacy
leak or unexpected SQL error was observed in the completed runs.

## Populated upgrade and historical replay

The synthetic legacy database contained flexible TP/SOA routes at Counters 1/2,
REF at Counter 3, ADJ at Counter 4, a deliberately stale STUDENT staff assignment,
private profile canaries, a closed historical day, four terminal tickets, skip/service
events, real configuration/call/finish/day audit records and idempotency receipts.

Migration preservation fingerprints verified all original account/profile/staff,
ticket/event/day/allocator/replay rows unchanged and old audits retained, with exactly
one new cutover audit. Public projection timestamps and routing edges changed as
expected. Subsequent focused tests again verified the original ticket/event/replay/
audit history remained unchanged.

Using the authenticated database role and the original synthetic subjects, an old
TP+SOA `configure_counter` request replayed its exact saved result, and an old TP
call at Counter 2 replayed its old CALLED receipt after that ticket was already served.
Neither replay changed routing, called a ticket or added an event/receipt. These
historical compatibility checks used authenticated SQL claims, not fabricated new
HTTP sessions for the imported legacy users. New Auth users exercised actual HTTP
authorization separately. Current authorization still precedes replay. A receipt
is historical evidence; clients must reload current context/state after replay.

## Harness failures investigated

Stopped setup attempts exposed CLI/test-infrastructure issues rather than application
policy failures: initial schema exposure before migrations, CLI wildcard port binding,
custom-network resolution, unnamed Realtime initialization and Docker attach streaming.
The startup wrapper now forces explicit loopback bindings and fences initializer
image/network/mount/privilege/port access. It forwards Docker upgrade streams. Only
empty disposable platform initialization was recovered; no application fixtures were reset.

One test launch resolved relative test paths from the main workspace and attempted
the fresh-only legacy bootstrap against the synthetic upgrade database. Its one-time
bootstrap guard rejected it, the transaction rolled back, and preservation checks
passed. The launcher now sets the isolated working directory and custom network;
the final upgrade run includes only the two rollback-safe files.

A gateway restart request was rejected and was not performed for schema exposure.
The approved non-destructive configuration reload completed that step. The first
wrapper summary parser also missed the API suite's optional skipped-count segment;
the detailed file already correctly recorded 27 PASS checks. The wrapper record
retains its original zero count and explains the correction; no tests were rerun
or removed to change that result. Final suite counts exclude stopped attempts.

## Files created or modified

| File/group | Change |
| --- | --- |
| migrations/20261016000600_fixed_counter_routing.sql | Sixth migration only |
| tests/database/fixed_routing_test.sql | 44 new rollback-only assertions |
| tests/synthetic_flexible_routing.sql | Populated pre-cutover history fixture |
| tests/fixed_routing_http.mjs | 23 focused actual HTTP/replay/Realtime checks |
| tests/routing_isolation.py | Project/endpoint/volume guards, fresh/upgrade orchestration, evidence and preservation |
| tests/start_loopback_stack.mjs | Disposable-only Docker binding/initializer/stream guard |
| tests/local_test_target.mjs | Exact retained-or-explicit-isolated endpoint fence for reusable test suites |
| tests/database/queue_test.sql | Fixed TP setup; original 35 assertions retained |
| tests/concurrency.py | Two cashiers at Counter 1; SOA at Counter 2; fenced isolated targets |
| tests/run_local_concurrency.py | Six-migration/14-account expectations; fresh-state refusal retained |
| tests/api_realtime_security.mjs | REF at Counter 4, fixed service retained on closure, isolated endpoint support |
| tests/remaining_api_validation.mjs | ADJ at Counter 5, separate TP counter, fixed closing configuration, endpoint support |
| tests/static_check.py | Six-migration manifest and CREATE OR REPLACE definer checks |
| tests/results/routing_*.json, fixed_routing_http_184ac129.json, api_realtime_dc37ad1c.json, remaining_api_64fcacbb.json | Sanitized execution evidence |
| FRONTEND_INTEGRATION_PLAN.md | Fixed-routing validation status and unchanged frontend contracts |
| FIXED_COUNTER_ROUTING_VALIDATION_REPORT.md | This report |
| ../.gitignore | Ignore disposable .local-routing workdirs |

Paths are relative to `supabase/` except the indicated root ignore file. No frontend
source, dependency, original migration, retained RLS/grant, environment file or hosted
configuration changed. Test fixture operator credentials stayed in subprocess memory;
no key, password or JWT was written into reports. Builds used public keys only;
known retained and both isolated private keys were absent from generated JavaScript.

## Retained-local cutover plan and approval

It is reasonable to request **separate approval for a controlled retained-local
cutover**. The current task authorizes preparation and isolated validation only.
Do not run migration commands in the main project yet.

After approval:

1. Independently verify project `school-queue-local`, API 54321/DB 54322, the five
   applied migration versions, original file hashes and exactly the sixth migration
   pending. Capture a recoverable local backup and new row/configuration fingerprints.
2. Recheck five counters/services, the reviewed old route matrix and zero active/
   called tickets. Abort on changed assumptions. Do not force-close days or erase work.
3. Explicitly approve removal of `(1,SOA)` and `(2,TP)` and insertion of `(3,PNEP)`,
   `(4,REF)`, `(5,ADJ)`. Preserve `(1,TP)` and `(2,SOA)`, all staff rows including the
   stale Counter 5 STUDENT assignment, counter availability and closed queue days.
4. Apply only the sixth migration with a dedicated local-target guard. The current
   isolated runner deliberately cannot apply it to port 54322. Review bounded-lock
   failures through transaction rollback; never recover with reset or weakened checks.
5. Verify the exact matrix/constraints/ACLs/function bodies, unchanged history/staff/
   accounts, one new cutover audit and expected display refresh. Run rollback-only
   targeted pgTAP/lint and read-only API checks. The legacy bootstrap/concurrency and
   business-mutation fixtures belong in disposable projects, not retained data.

The retained current day remains closed; successful isolated issuance does not
authorize reopening it or enabling the frontend issuance helper. Google OAuth,
student/payor provisioning/admission, beneficiary/quota aggregation and remote
arrival rules remain separate decisions. Public counter_state.service_code identifies
the currently called ticket; it is not a permanent route catalog. A public destination
contract, if needed by the future shared requester dashboard, still needs review.

Real midnight contention, sustained load/lock-timeout measurements, broader reconnect
fault schedules and complete operational UI acceptance remain additional validation.
No new browser acceptance run was performed; the relevant 51 frontend tests and build
passed. These results support local cutover review, not production readiness.

**Stopped after isolated validation. Retained-local application awaits separate explicit approval.**
