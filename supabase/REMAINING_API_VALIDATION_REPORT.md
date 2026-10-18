# Engineering report: remaining local API validation

Date: October 16, 2026. Result: **18 passed, 0 failed, 5 skipped**.
Scope: local Supabase only. Production deployment is neither performed nor authorized.

Evidence: [remaining_api_1d975e04.json](tests/results/remaining_api_1d975e04.json).
Command: `python supabase/tests/run_local_api_security.py --remaining`.

## Initial state and isolation

The inspected database contained 20 accounts, 14 tickets, no active tickets, and
closed queue days for October 16 and 17. The earlier concurrency and API fixtures
were present. PostgreSQL remained at 127.0.0.1:54322 and the API at
http://127.0.0.1:54321. No .env or hosted credentials were read.

The suite created six new local Auth users and six new ticket records on separate
historical fixture dates, October 14 and 15. Historical fixture SQL supplied only
new records; HTTP cashier completion then exercised the actual business functions.
Counter 4 was used as an initially closed, unassigned spare counter.

## Coverage and results

| Scenario | Result and evidence |
| --- | --- |
| Existing fixture inspection/preservation | PASS; initial snapshot and final comparison |
| Successful student HTTP issuance | SKIP; current day is already closed |
| Issued numbering/service assignment | SKIP; requires successful current-day issuance |
| HTTP issuance idempotency | SKIP; requires successful current-day issuance |
| Issuance refusal after two served tickets | SKIP; closed-day guard precedes quota evaluation |
| Closed-day failure handling | PASS; explicit P0001 business error and no replay record |
| Positive ADMIN service configuration | PASS; rename/disable unused PNEP through HTTP |
| ADMIN configuration idempotency/restoration | PASS; exact retry replays once and original name/enabled values restored |
| Disabled CASHIER with existing session | PASS; protected reads, call and finish denied while Auth still accepts token |
| Busy cashier disable/demotion | PASS; rejected before active work can lose its authorized cashier |
| Concurrent completion and demotion | PASS; service commits once and subsequent cashier access/replay is denied |
| Interrupted in-flight HTTP call | PASS; request reached the controlled mutation lock; client aborted; same-key retry reconciled one call |
| Discarded response and parameter mismatch | PASS; replay returns original result; changed parameters rejected with 22023 |
| Invalid cashier action | PASS; 22023, ticket unchanged, no replay record |
| Issuance-date quota after midnight | PASS for logical date separation; completion today charges historical issuance day |
| Second historical-day service | PASS over HTTP |
| Third historical-day service | PASS rejection with P0001; no partial status/replay change |
| Actual clock boundary during lock wait | SKIP; no injectable database clock and no host-time change allowed |
| Realtime reconnect | PASS; two WebSocket instances observed, backend readiness restored |
| Snapshot recovery and later updates | PASS; REST reconciles the offline mutation; subsequent event delivered |
| Public data privacy | PASS; 45 public events checked against field allowlists and private canaries |
| Fixture closure and preservation | PASS; only new days closed; old fixtures retained |

The table groups related assertions; the executable suite reports 23 named checks:
18 PASS and 5 SKIP. Prior 35 pgTAP assertions, three concurrency tests, and 27 API
security checks were not rerun and are not added to this run's counts.
Six offline structural checks also passed, and JavaScript/Python syntax checks passed.

## Important observed behavior

The interrupted HTTP request **committed before its retry**, despite the caller
receiving AbortError. The retry reused the same UUID and returned the original
call result with exactly one CALLED event. A frontend timeout must therefore be
treated as an unknown outcome, not proof of rollback. Preserve the request key,
refresh authorized state, and retry the same operation with that key.

In the observed role race, service completion won the mutation lock before
demotion. Both succeeded in that valid order. Separate busy-state checks confirmed
demotion/disablement is rejected while the called ticket is unresolved. The old
cashier token could not execute cashier RPCs or replay its old cashier call after
demotion. No role refresh was needed for database enforcement.

Realtime transport was explicitly closed, an HTTP skip changed the display while
the connection was interrupted, and the client created a second socket. After the
database listener became ready, a REST snapshot showed the current cleared state;
a subsequent HTTP call produced the expected ADJ ticket event. This validates
reconnection plus snapshot recovery, not guaranteed replay of missed notifications.

No unexpected database error, authorization bypass, duplicate transition, served
quota violation, or public privacy leak was observed. Expected rejections were
checked by PostgreSQL code and business error text. No new migration was needed.

## Current-day issuance: safely blocked

The current October 16 day is closed and intentionally cannot be reopened through
the API. The suite did not change that row, delete it, alter its business date,
override clock functions, or bypass the production issuance function. The four
current-day issuance checks are implemented but were explicitly skipped.

Safest isolation strategy: create a second fresh local Supabase workspace and
Docker volume set with a unique project_id and an unused complete port allocation.
Apply copies of the unchanged migrations only to that new database, create test
identities there, and open its own current date through ADMIN manage_day. Then run
the positive issuance/numbering/quota/retry checks. Keep the original stack and
its volume data intact. The harness's strict endpoint allowlist must be explicitly
adapted to those selected loopback ports; it must not accept arbitrary remote URLs.

This second instance was not created or started in this task. Alternatively, use
an actual institution-local date with no existing queue-day row. October 17 already
has a preserved closed fixture row, so waiting only one day would not solve it.

Actual lock waits crossing midnight require a controlled test-clock design or a
scheduled real boundary test. Adding a production-exposed timestamp argument would
undermine the rule and is not proposed. Any database clock seam would require a
separately reviewed versioned migration, not editing applied files.

## Preservation and expected changes

All pre-existing rows were compared against their initial snapshots. Ticket,
account, event, day, allocator, replay, assignment and audit fixture rows remained
unchanged. The prior 14 tickets and their two closed days were retained.

Positive configuration tests intentionally updated unused PNEP and Counter 4,
then restored their original business values. Their updated_at timestamps and new
administrative audit events were retained truthfully; timestamps were not forged
back. The comparison excludes only those two expected timestamp changes.
Global waiting allocation and derived public projection timestamps changed through
normal operations. New fixture records remain, and both new historical days are
closed with no active tickets. No existing records were deleted and no reset occurred.

## Files created or modified

- Added `supabase/tests/remaining_api_validation.mjs`.
- Modified `supabase/tests/run_local_api_security.py` to select the remaining suite
  using --remaining; existing inspect and API-security modes remain available.
- Added `supabase/tests/results/remaining_api_1d975e04.json`.
- Added `supabase/REMAINING_API_VALIDATION_REPORT.md`.
- Added `supabase/FRONTEND_INTEGRATION_PLAN.md`.

No applied migration, RLS policy, grant, hosted configuration, .env, dependency, or
frontend source file was changed. No Git commit, push, or deployment occurred.

## Frontend readiness

**Scoped frontend integration can begin:** the shared API wrapper, own-ticket
reads, public display, cashier actions, admin operations and reconnect/snapshot
handling have useful local evidence. The complete student issuance flow remains
pending its four skipped HTTP checks. Google OAuth itself has not been configured
or tested, and real identity/enrollment admission remains unresolved.

The current API lacks a safe self-context read for role/enabled state and assigned
cashier counters, plus a public service/open-day catalog. These are concrete UX
contract gaps, not authorization bypasses. Any new endpoints require a separate
versioned migration, reviewed grants and tests. Do not infer authoritative roles
from user metadata or expose private tables to bridge the gap.

See [FRONTEND_INTEGRATION_PLAN.md](FRONTEND_INTEGRATION_PLAN.md) for the minimal
integration sequence and exact existing RPC calls. Local results do not establish
production readiness.
