# Engineering report: read-only Auth and queue context

Date: October 16, 2026. Result: **PASS for the exercised local scenarios**.
Frontend Auth integration can begin as a scoped local task. OAuth, admission rules,
operational dashboards and production acceptance are not completed by this phase.

## Migration and database objects

Created and applied **20261016000500_queue_read_context.sql** using the guarded
local runner and `supabase migration up --local`. The target was independently
verified as PostgreSQL **127.0.0.1:54322**, database postgres, server **17.11**, and
API **http://127.0.0.1:54321**. Local history now contains five applied migrations.
The four original migration files match their pre-task SHA-256 hashes.

New functions:

| Function | Availability | Purpose |
| --- | --- | --- |
| queue_api.my_context() | authenticated only | Current caller's navigation context |
| queue_display.public_queue_context() | anon and authenticated | Sanitized catalog and current queue-day context |
| queue_private.public_context_at(timestamptz) | trusted operator/definer only | Shared read projection with deterministic internal clock input |

There are no new tables, columns, indexes, RLS policies or Realtime publications.
Anonymous users still have no queue_api schema usage. Browser roles still have no
queue_private schema/table access. All 15 application tables retain RLS; the
publication still contains only counter_state and service_state.

Both exposed functions use SECURITY DEFINER, empty search_path, qualified objects,
explicit EXECUTE revocation followed by narrow grants, and a PostgREST schema-cache
reload notification. The private helper is SECURITY INVOKER with empty search_path
and no browser EXECUTE grants. No application function trusts user-editable metadata.

## Exact response contracts

Both RPCs accept **no parameters** and return one JSON object, not an array. They
perform no writes and require no request/idempotency UUID.

`POST /rest/v1/rpc/my_context`, profile **queue_api**:

```typescript
{
  role: 'STUDENT' | 'CASHIER' | 'ADMIN' | null,
  enabled: boolean,
  cashier_counters: Array<{
    counter_id: string,
    counter_number: number,
    counter_label: string,
    is_open: boolean,
    service_codes: string[]
  }>
}
```

The authenticated subject identifies the caller; accounts.role/enabled and current
assignment/service rows determine the result. Only an enabled CASHIER receives
its own assigned counters, ordered by number. service_codes includes enabled
assigned services only, ordered by code. Closed assigned counters remain listed
with is_open=false; an empty service array grants no service operation. STUDENT
and ADMIN receive empty counter arrays. Counter UUIDs are public identifiers.
No account UUID, student profile, other cashier assignment, JWT claim or audit
record is returned. The frontend needs no additional navigation flags.

**Disabled-account policy:** return HTTP 200 with exactly
`{"role":null,"enabled":false,"cashier_counters":[]}` to support an access-disabled
page. This masks the stored role and removes all operational navigation. It is
a deliberate narrow exception to protected-read denial, not an authorization
grant. Existing protected reads and mutations continue to reject disabled users.

Missing/unprovisioned subjects and anonymous Auth identities raise **42501**.
The anonymous database role cannot invoke the function at all. Existing sessions
do not preserve old application privileges after a committed role change.

`POST /rest/v1/rpc/public_queue_context`, profile **queue_display**:

```typescript
{
  timezone: 'Asia/Manila',
  business_date: string, // YYYY-MM-DD
  queue_day_open: boolean,
  services: Array<{ code: 'TP' | 'SOA' | 'PNEP' | 'REF' | 'ADJ', name: string }>
}
```

The public wrapper captures one server clock instant, then projects that date in
the configured institution timezone. Only an existing unclosed row for that exact
date makes queue_day_open=true. Missing and formally closed days both return false;
counter availability is independent. services contains enabled entries only,
ordered by code, and can be empty. No internal IDs or configuration fields are
included. Missing settings fails with **55000**, rather than guessing a date/state.
Caller-supplied dates, clocks or identities have no accepted signature.

## Validation results

| Validation | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| New retained-fixture-safe pgTAP assertions | **44** | **0** | **0** |
| Actual local Auth/Data API checks | **24** | **0** | **0** |
| Offline migration structural checks | **6** | **0** | **0** |
| Database lint --local | No schema errors | 0 | 0 |

Evidence:
[read_context_database.json](tests/results/read_context_database.json),
[read_context_http_ae068c42.json](tests/results/read_context_http_ae068c42.json).

The 24 HTTP checks include:

- Anonymous self-context denial and public-context success.
- Exact student context, absence of foreign identities, and rejection of a
  supplied foreign account ID. ADMIN metadata does not promote a student.
- Assigned/unassigned cashier context and ADMIN context without cashier override.
- CASHIER and ADMIN role revocation through the existing secured set_account RPC,
  followed by current-context/protected-read checks using the same original JWTs.
- Disabled STUDENT, CASHIER and ADMIN policy checks using an unchanged Auth session;
  Auth still recognizes the token while protected operations reject the account.
- Identical public responses across anonymous, student, cashier, admin, revoked
  and disabled sessions; exact field/type allowlists and private canary scanning.
- REST rejection of date overrides/private helper calls/private table profiles;
  public OpenAPI advertises no private helper, account paths or identity fields.
- Repeated read calls leave application/display/Auth rows unchanged.
- New-date open/closed projection and exact Manila midnight behavior, with current
  HTTP results unaffected by an unrelated open future day.
- Byte-level row preservation checks for all pre-existing application/display
  records and Auth users/identities.

pgTAP additionally covers missing subjects, unknown subjects, anonymous Auth
identities, stale assignments after a role change, function ACLs, empty search_path,
RLS/publication controls, and absent-day projection. Its fixtures are rolled back.

The prior 35 pgTAP assertions, three concurrency tests, earlier API/Realtime suites
and frontend integration tests were **not rerun or added to these counts**. The
legacy queue_test.sql assumes a fresh instance, bootstraps the first admin and
rewrites its test day; running it here would violate fixture-preservation rules.
The new targeted file was executed with the real Supabase pgTAP runner instead.

## Open/closed-day isolation and limits of evidence

Inspection found the current Manila date, **October 16**, already formally closed.
It was not reopened, replaced or altered. No current-open-day HTTP response was
claimed. Actual HTTP calls verified the closed-day result and that unrelated
future open days cannot override the server's current date.

Open, absent, closed and exact-midnight behavior was tested through the same private
projection used by the public wrapper, with trusted SQL supplying deterministic
instants. pgTAP used a new unused 2090 date inside rollback. The HTTP harness used
a new unused **2091-01-01** row, verified its projection while open, then closed
only that new row and retained it. This does not simulate HTTP running across a
real server-clock midnight or a current-open-day HTTP request. Those checks need
a fresh disposable stack or a naturally available new current day, with separate
approval if setup would change existing business state.

All five existing service records were enabled and their exact names/codes matched
the returned catalog. Disabled-service filtering is explicit in both SQL projections;
this phase did not disable an original catalog row just to exercise the filter.
A disabled-service/empty-catalog runtime case remains suitable for a disposable
fixture database. No original service or counter configuration was changed.

## Preservation and execution safety

- Migration apply and pgTAP/lint runs compared full row fingerprints before/after;
  every application/display/Auth row was unchanged.
- HTTP tests created eight uniquely named Auth identities and only new assignment,
  account-role, replay/audit and day fixtures. All previous rows remained unchanged.
  The original 20 tickets were neither changed nor supplemented in this phase.
- New test accounts, their final roles/enabled states, one retained new counter
  assignment, audit/replay rows and the closed future day remain locally. The
  revoked cashier's new assignment was removed by the secured role-change RPC.
- No reset, deletion of original data, production SQL, hosted project connection,
  link, db push, commit or push occurred. Secrets came only from captured local CLI
  status, stayed in subprocess memory and were not written into reports/results.
  The privileged local Auth key was used only by the fixture operator; ordinary
  API checks used the public key plus the appropriate user's session.
- One copied checksum typo stopped the first apply attempt before local SQL or
  CLI status execution. Correcting the harness checksum resolved it. No application
  authorization failure, unexpected SQL error or privacy leak was observed.

## Files created or modified

| File | Change |
| --- | --- |
| migrations/20261016000500_queue_read_context.sql | New read contracts and narrow function grants |
| tests/database/read_context_test.sql | 44 rollback-only pgTAP assertions |
| tests/run_local_read_context.py | Guarded local apply/lint/pgTAP/HTTP launcher and preservation checks |
| tests/read_context_security.mjs | 24 real Auth/HTTP checks and isolated fixtures |
| tests/static_check.py | Explicit five-migration manifest and cross-migration API grant coverage |
| tests/results/read_context_database.json | Sanitized lint and pgTAP evidence |
| tests/results/read_context_http_ae068c42.json | Sanitized HTTP evidence |
| FRONTEND_INTEGRATION_PLAN.md | Exact RPC contracts, disabled policy and navigation refresh rules |
| READ_CONTEXT_VALIDATION_REPORT.md | This report |

Paths above are relative to supabase/. No frontend source, dependency, environment
file, original migration, hosted setting, RLS policy or existing grant was changed.

## Reproduction and next steps

```powershell
# Safe targeted validation on retained fixtures; uses rollback-only pgTAP.
python supabase/tests/run_local_read_context.py --validate
python supabase/tests/static_check.py

# Creates additional isolated local identities/day and retains them.
python supabase/tests/run_local_read_context.py --http
```

The migration is already applied locally; --apply deliberately refuses if there
is not exactly that fifth migration pending. Do not use reset/link/db push.

Auth integration can now consume the documented role/enabled/counter and public
catalog contracts. Extend the frontend service allowlist and public read wrapper
with tests in that phase; this task intentionally did not wire Auth UI or change
the existing mock dashboards. Always clear stale privileged state on account
change/error and re-fetch after reconnect/visibility/protected-operation denial.
No private Realtime subscription is required or authorized by these contracts.

The read context is a snapshot, not permission that lasts for a session. Every
mutation still checks current authority. Separate context/display RPCs are not an
atomic combined snapshot. Clock-only midnight rollover emits no Realtime table
event, so the frontend must schedule/refetch public context as well as reconcile
after reconnect. Render service names as text.

Remaining acceptance gates include Google provider/callback setup, enrollment or
admission verification, administrator MFA policy, successful current-day HTTP
issuance/idempotency/quota validation, private administrative directory/audit
contracts if needed, and browser role/offline/multi-tab tests. Hosted rollout still
requires separate approval; these results do not establish production readiness.
