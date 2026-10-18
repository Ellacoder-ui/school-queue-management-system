# Engineering report: fixed service-based counter routing

Date: October 16, 2026. Status: **inspection and implementation plan only**.
No database changes or migrations were generated/applied during this task.

## Recommendation

The existing schema and RPCs can operate the confirmed mapping through configuration.
Configuration alone cannot guarantee that it stays fixed: the relationship is
many-to-many, and configure_counter accepts several services or none for a closed
counter. A small sixth migration should enforce the five permanent pairs and tighten
administrator configuration validation. Retain the existing relationship table,
ticket foreign key, action signatures and queue algorithms.

issue_ticket(), call_next() and finish_ticket() require **no routing algorithm or
signature change** for authenticated requesters under this mapping. Separate payor
identity/admission decisions may require a later change; they should not be hidden
inside this routing migration. Do not implement or enable issuance before its
outstanding positive current-day HTTP validation is complete.

## Inspection evidence

Only PostgreSQL **127.0.0.1:54322**, database postgres, server **17.11**, was queried.
Local CLI status was captured in memory to verify that database endpoint and the
local API endpoint. Database inspection used a repeatable-read, read-only transaction
and a read-only libpq default. It invoked no application mutation or Auth operation.
No .env file, key, JWT, password, student identity or account UUID was printed.

Evidence: [fixed_routing_inspection.json](tests/results/fixed_routing_inspection.json).
All **19** inspected application function bodies match the five migration files.

| Migration | Relevant findings |
| --- | --- |
| 20261016000100_queue_tables.sql | Many-to-many counter_services; composite ticket-to-route FK; active/called unique indexes; private RLS boundary |
| 20261016000200_queue_operations.sql | Serialized issuance, calls, finishes, quota and replay checks; owner-only history; public projections |
| 20261016000300_queue_administration.sql | ADMIN configuration; arbitrary service arrays; role/assignment/active-work guards; scoped staff reads |
| 20261016000400_queue_seed_security.sql | Five service/counter seeds; initially no routes/staff/open days; explicit grants and two public Realtime tables |
| 20261016000500_queue_read_context.sql | Caller-only role/counter context and anonymous-safe catalog/current day; no routing cardinality enforcement |

The database retains 15 RLS-enabled application tables. Browser roles have no
queue_private schema usage. Realtime publishes only counter_state and service_state.
Five migrations are applied. There are **39 accounts, 20 tickets, 57 ticket events,
69 replay records and 31 administrator audit records**. All 20 tickets are terminal:
10 SERVED and 10 FORFEITED. All seven recorded queue days are closed, including the
current Manila date, October 16, and the retained future test day. There is no active
ticket to move or forfeit, but this must be checked again before any approved cutover.

## Actual configuration versus confirmed mapping

| Counter | Current services | Confirmed service | Current availability | Staff assignments: eligible / total |
| --- | --- | --- | --- | --- |
| 1 | TP, SOA | TP — Tuition Payment | Open | 1 / 1 |
| 2 | TP, SOA | SOA — Statement of Account | Open | 1 / 1 |
| 3 | None | PNEP — Promissory Notes and Exam Permits | Closed | 0 / 0 |
| 4 | None | REF — Refund Process | Closed | 0 / 0 |
| 5 | None | ADJ — Adjustment Clerk | Closed | 1 / 2 |

All five services are enabled. TP and SOA each currently have two counters; PNEP,
REF and ADJ have none. Counter 5's second staff row belongs to an enabled STUDENT,
deliberately retained by the Phase 2 revocation test. That row grants no cashier
authority: current role checks reject it and my_context returns no assignments to
the student. Do not promote that account or silently delete its fixture row.

Open counters do not imply an open queue day. Counters 3/4 also need approved staff
assignments before becoming operational. Fixed routing should not automatically
open counters, appoint cashiers, enable services, open days or issue tickets.

## Current routing and authorization behavior

**Issuance:** issue_ticket(p_service, p_request_key) accepts an enabled,
non-anonymous authenticated account whose database role is STUDENT. After the
singleton mutation lock and replay check, it obtains the current Manila date,
requires an open day and enabled service, checks the owner-wide active-ticket
restriction and issuance-day/service served quota, allocates the next number and
waiting position, and records the ticket/event/replay atomically.

The ticket belongs to a service, not a preselected physical counter. Waiting tickets
have no counter_id. Issuance neither checks an assigned/open/staffed counter nor
requires physical presence or an enrolled student profile. Consequently an open
day can currently accept an enabled service even when its counter is closed or
unmapped. Whether that should remain permitted is an admission/availability rule,
not a necessary routing change. Preserve the current behavior unless approved otherwise.

**Calling:** call_next(p_counter, p_service, p_request_key) locks the same mutex,
checks the current enabled CASHIER role and that caller's assignment to that
counter, and checks replay. For a new request it requires the counter to be open,
the requested service to be enabled and present in counter_services, and the counter
not already to have a CALLED ticket. It locks/selects the oldest waiting position
for that service across still-open queue days, then assigns the ticket to the counter.

Thus a new call cannot bypass the configured service relationship by spoofing
p_service. With today's configuration, an assigned cashier legitimately can call
SOA at Counter 1 and TP at Counter 2. After an enforced fixed mapping, those new
calls reject with the existing service-not-assigned/disabled business error. The
ticket composite FK provides a second route-integrity check.

**Finishing:** finish_ticket checks current CASHIER authority, called-ticket state,
assignment to its actual counter and an open issuance day. Serving rechecks the
issuance-day quota; skipping retains the service/number and appends a new waiting
position. The counter/service FK and busy-reconfiguration guard protect the route
while a ticket is CALLED. Terminal tickets clear counter_id; events retain history.

Cashier-to-counter assignment remains a separate relationship. A cashier assigned
to Counters 1 and 2 can operate TP at 1 and SOA at 2. The confirmed service map does
not by itself impose one counter per cashier or one cashier per counter.

## What configuration alone can and cannot do

The existing ADMIN configure_counter RPC can set each counter's p_services to a
single correct code. This is sufficient for correct new call selection while that
configuration remains intact. It does not enforce:

- At most one service per counter: the composite PK rejects only duplicate pairs.
- At most one counter per service: no individual service uniqueness exists.
- At least one service per closed counter: empty service arrays are permitted.
- The exact numbered pairs: an administrator can choose another known service.

The live catalog confirms only the pair PK and two FKs, with no application trigger
on counter_services. A frontend single-select alone cannot protect the invariant
from direct authorized RPC requests.

Bulk use of configure_counter is also inappropriate for a routing-only cutover
on the retained database. It deletes/rebuilds staff assignments as well as service
links. Counter 5's ineligible STUDENT row cannot be passed back through its cashier
validation. A focused migration can change only service links and leave staff
fixtures, roles, open flags and historical records untouched.

## Smallest durable implementation, subject to approval

1. **Keep counter_services and its pair PK/FKs.** Add individual UNIQUE constraints
   on counter_id and service_id. They impose the two upper bounds without rewriting
   tickets or removing their existing composite FK. Upper bounds alone do not
   ensure a route exists or that its numbered pair is correct.
2. **Enforce the complete canonical map in private database validation.** Add a
   private invariant validator and deferred constraint triggers covering route
   changes and relevant counter/service identity/catalog changes. At transaction
   completion, require exactly the five confirmed numbered/code pairs, including
   mappings for closed counters and disabled services. Prevent counter-number or
   service-code changes from bypassing that validation. Validate the initial state
   explicitly when installing these controls; installing triggers is not a scan
   of existing rows.
3. **Tighten configure_counter, keeping its signature.** For a new request require
   exactly one p_services item and the fixed code for that counter. Reject empty,
   multiple, duplicate or wrong-service inputs atomically, even for a closed counter.
   Preserve current ADMIN checks, mutation lock, busy guard, eligible-cashier checks,
   request arguments/replay operation name, audit behavior and display refresh.
   Avoid deleting/reinserting the route when its fixed pair is already unchanged.
4. **Leave queue algorithms and action/read signatures intact.** No change is
   required to issue_ticket, call_next, finish_ticket, daily allocators, ticket
   statuses, quota indexes, owner restrictions, my_context or public_queue_context.
   No new role, browser private-table access, RLS relaxation or existing grant change
   is needed. New private helper functions must follow empty search_path, qualified
   references and no browser EXECUTE conventions.
5. **Lock ordinary administrator routing edits.** Admin UI should show the service
   as a read-only value per numbered counter; maintain staffing, open/closed state,
   and supported service name/enabled settings separately. Changing the confirmed
   route itself becomes a reviewed versioned change. UI constraints supplement the
   RPC and database invariant rather than replacing them.

This keeps the current normalized model and avoids the broader rewrite that moving
a NOT NULL service_id onto counters would require for the existing composite FK
and every relationship consumer. A CHECK expression that queries other tables is
not an appropriate substitute for cross-table integrity controls.
[PostgreSQL 17 constraint guidance](https://www.postgresql.org/docs/17/ddl-constraints.html).

Deferred validation permits a transaction to update relationship rows while checking
the complete final map. PostgreSQL supports transaction-end AFTER ROW constraint
triggers. Approved routing writes must retain the existing mutex-first lock order;
they must not commit an incomplete mapping. Trusted database owners remain able to
change database controls and are outside the browser-role trust boundary.
[PostgreSQL 17 constraint triggers](https://www.postgresql.org/docs/17/sql-createtrigger.html).

### Preserve historical retries

Do not delete or rewrite operation_requests. Current authorization still runs
before replay, as it does today. An exact old successful configuration/call replay
can describe the historical multi-service route or an old CALLED result; it must
not execute configuration again, call another ticket or add another event. Preserve
the recorded response for that same key/arguments. Require new actions to satisfy
the fixed map, and have clients reload current authoritative state after a replay.

Rejecting an exact historical retry solely because its former configuration is now
forbidden would change existing idempotency semantics. Conversely, a saved response
is never proof of the current map, active-ticket status or current privilege. Tests
must cover this distinction. Do not introduce a new call_next overload or change
argument normalization merely to hide service selection in the UI.

## Safe cutover and fixture preservation

First generate/review a sixth migration in a later approved task, and validate it
in a separate disposable local stack with distinct ports/project identity. Keep the
current retained stack intact. Update fixture builders before running their scenarios
against fixed routing; do not weaken assertions to accept the old configuration.

If applying to this existing local database is later approved:

1. Verify the exact local endpoint, migration history, five counters/services and
   fresh absence of active/called tickets. Fingerprint retained tickets/events,
   days, replay/audit rows, account/profile/staff rows and current configuration.
2. In one transaction acquire the existing singleton mutation lock first and the
   required DDL locks with bounded waits. Abort on changed assumptions or unresolved
   active work. Never force-close a day, forfeit tickets or reset to make it fit.
3. Preserve (Counter 1, TP) and (Counter 2, SOA). Replace the two conflicting
   relationship rows (1, SOA) and (2, TP), then add (3, PNEP), (4, REF), (5, ADJ).
   Those two configuration-row removals are real data changes and require approval;
   they have not occurred. No service/counter/account/ticket deletion is proposed.
4. Install/validate uniqueness and canonical-coverage controls, update only the
   configuration RPC implementation, and record a new cutover audit entry with the
   old/new service matrix and migration identifier. Keep all old audit/replay rows.
5. Refresh sanitized display projections once, reload the schema cache if needed,
   commit atomically and verify the full five-pair matrix and preserved history.
   Display timestamps and the new cutover audit are expected changes. Do not silently
   open/close counters, change cashiers or touch the already closed current day.

Existing routing configuration cannot remain byte-for-byte unchanged while also
becoming the confirmed mapping. Approval must explicitly allow those configuration
changes. The tickets, private identities and historical events can remain unchanged.
On migration failure, transaction rollback should leave the prior state intact;
do not recover by resetting, disabling constraints or erasing replay/history.

Historical events include SOA at Counter 1, TP at Counter 2, REF at Counter 3 and
ADJ at Counter 4. Keep these events as historical facts under the prior configuration.
Do not retrofit the new mapping onto their events, ticket ownership, numbers or
quotas. Apply the new invariant to current routing and future work after cutover.

Counter 5's stale STUDENT staff row is an independent fixture/admission issue. Leave
it intact unless separately approved; do not use it to satisfy eligible staffing.

## Students, outside payors and remote requests

The confirmed shared dashboard/remote-issuance requirement supersedes the earlier
decision to defer the payor experience, but does not fully specify payor identity
or quota aggregation. Fixed service routing itself does not require a PAYOR role.

Technically an authenticated non-staff person provisioned with the existing STUDENT
role can already use issue_ticket without a student profile; that enum currently
acts as the queue-requester permission. This is compatibility, not proof that an
outside person is a student or that outside-payor admission is implemented. Shared
UI labels can later say Queue dashboard while retaining the three approved roles,
subject to approval of that role meaning. Do not infer identity type from editable
metadata or permit anonymous issuance simply to support payors.

Unresolved decisions before enabling the shared issuance flow:

- How outside payors obtain and verify accounts; who provisions/adopts them under
  the unresolved server signup/admission policy. Google is not configured here.
- Whether existing per-authenticated-owner limits apply independently to each payor
  and student, or must aggregate across a beneficiary/student/household. Current
  enforcement is per owner, not per payment beneficiary; keep it until a new rule
  is approved. Creating several accounts must not silently be treated as one person.
- Whether a payor requests a ticket for themselves or on behalf of a student, what
  beneficiary information is necessary, and whether any delegated private-record
  access is permitted. A shared dashboard grants no access to another user's records.
- Remote arrival/no-show expectations and whether enabled services can accept tickets
  while their sole counter is closed or unstaffed. Current skip/day-close behavior
  remains unchanged; no arrival status, remote priority or booking rule is assumed.

issue_ticket has no location restriction, so its database design supports remote
authenticated requests. The present client is intentionally loopback-only, issuance
is excluded from its helper allowlists, and the current day is closed. It is not yet
a usable remote ticket-requesting system. Network/hosted rollout, admission policy,
positive current-day issuance tests and frontend enablement need separate approval.

## Existing test conflicts

| Test/fixture | Required adaptation after approval |
| --- | --- |
| database/queue_test.sql | Replace Counter 1's TP+SOA setup; use Counter 2 for SOA calls. Keep all quota/midnight/security assertions. Run on a fresh instance, not retained days/bootstrap state. |
| concurrency.py | Replace two TP-capable counters with two authorized cashiers competing for Counter 1. SOA uses Counter 2. Preserve retry, numbering, quotas, skip and closure contention coverage. |
| run_local_concurrency.py | It currently pins four migrations and fresh 13-account/12-ticket postflight state; update version/fixture expectations explicitly for the new disposable test layout. Never loosen its retained-state refusal. |
| api_realtime_security.mjs | REF belongs at Counter 4, not spare Counter 3. Closing a fixture counter must retain its fixed service rather than passing an empty service array. |
| remaining_api_validation.mjs | Its Counter 4 ADJ+TP setup violates both the pair and single-service rule. Split ADJ to 5 and TP to 1, preserving scenario assertions and safe staffing/isolation. |
| database/read_context_test.sql | Counter 5 ADJ matches the target map. Its pair insert must remain harmless when already seeded; preserve caller-only/stale-role checks and rollback safety. |
| frontend_auth_validation.mjs | Counter 5 remains ADJ; preserve real role/assignment/revocation tests. Do not reuse a configured counter in a way that rewrites original staff fixtures. |
| frontend_public_display.mjs | Preserve public-only endpoints, reconnect generations and sanitized payload checks; do not reinterpret current-ticket service_code as the permanent route. |

The old three concurrency tests and earlier passing API reports exercised the old
configurable layout. They are useful historical evidence but do not validate the
new invariant. Fixture assumptions must change transparently, with new evidence.

## Regression-test plan

No mutation, pgTAP, HTTP-action, concurrency or Realtime regression suite was run
in this inspection-only task. The following are acceptance criteria, not pass claims.

| Layer | Proposed cases and required observations |
| --- | --- |
| pgTAP: structure | Exact five-pair matrix; one link per counter/service; existing composite ticket FK and active/called indexes retained; private helpers unexecutable by browser roles. |
| pgTAP: invalid routing | Reject second/missing service, duplicated service across counters, wrong numbered pair, deletion of a route at commit, renumber/code/catalog changes that bypass coverage; disabled/closed entries retain their route. Exercise deferred checks explicitly and rollback fixtures. |
| pgTAP: RPC | ADMIN can maintain staffing/open flags with its one fixed service; wrong/empty/multiple services fail atomically; busy guard remains. Student/cashier/disabled/revoked staff cannot administer. Assigned cashier cannot call another service at that counter. |
| pgTAP: queue invariants | Per-service daily numbering and midnight allocation; global active-ticket limit; two served per service/issuance day; skipped tickets retain numbers and tail order; eventual service counts once; closure forfeits only that day's active work. |
| HTTP authorization | Real anonymous/student/cashier/admin sessions; exact counter/service call matrix; unassigned counters denied; foreign-service attempts rejected even with valid counter assignment; owner-only history; metadata promotion ignored; disabled/revoked sessions denied. |
| HTTP issuance/replay | Successful service issuance on a fresh open current day; correct numbers and service; same-key replay; changed parameters reject; active/served quota errors; original keys survive interrupted requests and failed attempts do not allocate extra tickets. |
| Historical replay | Retain exact pre-cutover call/configuration results on permitted same-key retries without changing routes, creating tickets or emitting events. Changed args with that key reject. Re-fetch current state separately. |
| Concurrency | Two authorized cashiers at the same fixed counter compete for one waiter: one actual call/event, with busy rejection for other distinct requests; same-key calls replay. Parallel owners get unique daily service numbers. Preserve finish/skip/closure/revocation/quota and midnight lock-boundary contention. |
| Cutover/configuration contention | Pause behind the mutation lock, race approved configuration with call/role changes, and verify no partially committed or cross-service route. Constraint failure leaves configuration, replay and audit changes rolled back together. |
| Realtime/privacy | Calls appear only at the matching numbered counter; skip/serve/close clear labels and update totals correctly; reconnect fetches fresh state; no student names/numbers/account IDs/tokens appear; private subscriptions remain denied. |
| Frontend regression | Existing Auth/public tests plus one-service cashier presentation, shared requester labels when approved, denial/reconnect clearing, exact DTO validation, HTML escaping, production build and private-key bundle scan. |
| Supabase compatibility | Fresh-install all migrations and upgrade a populated disposable fixture database; lint; inspect function owners/search_path/ACLs, exposed schemas, RLS and the unchanged two-table publication. |

Use a separately isolated local stack for business mutations/HTTP issuance; keep the
retained instance unchanged until approved. Never reopen its closed day or change
the server clock to satisfy tests. Adapt local-only launch guards to the explicit
isolated loopback ports rather than weakening endpoint validation or using a hosted
URL. Check cutover preservation using a populated synthetic copy of the legacy
configuration/history, without copying real credentials into reports.

For the public/student UI, counter_state.service_code is the service of the ticket
currently CALLED; it is null while idle. It is **not** a permanent route catalog.
No new public API is needed for backend routing. If the shared dashboard must show
each service's destination before it is called, separately approve a sanitized
public route-read contract. Do not add fields silently to current context responses:
the Vue validators intentionally reject unexpected fields. Never expose private
assignment/account rows to obtain the route.

## Approval boundaries and files

Approval is required before generating/applying a sixth migration, replacing the
two conflicting route rows, adding the three missing rows, installing invariant
controls or replacing configure_counter. Test-fixture rewrites and any disposable
stack setup should be reviewed with that implementation. Applying to the retained
local database needs explicit consent to its configuration changes; hosted work
remains outside scope. Staff cleanup, payor admission/quota/beneficiary rules and
any new public route API are separate decisions. No Google configuration is proposed
as part of this routing change.

Files created in this task:

- supabase/FIXED_COUNTER_ROUTING_PLAN.md — this report.
- supabase/tests/inspect_local_routing.py — strictly read-only, local-only inspector.
- supabase/tests/results/fixed_routing_inspection.json — sanitized catalog/count evidence.

Existing migrations, frontend files, RLS/grants, Auth configuration, test fixtures
and environment files were not modified. No database reset, data deletion, migration
application, hosted connection, deployment, Git commit or push occurred.

**Stopped after the report. Awaiting approval before implementation.**
