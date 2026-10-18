# Engineering report: local Data API authorization and Realtime privacy

Date: October 16, 2026. Final result: **27 checks passed, 0 failed** in the completed run.
Scope: local validation only; no production-readiness claim.

## Evidence and environment

- API/Auth/Realtime gateway: `http://127.0.0.1:54321`.
- PostgreSQL: `127.0.0.1:54322`, server 17.11.
- Four applied migrations; all 15 application tables have RLS enabled.
- Local configuration exposes `public`, `queue_api`, and `queue_display`.
- Live publication contains only `queue_display.counter_state` and `queue_display.service_state`.
- Browser roles lack USAGE on `queue_private` and cannot directly access its tables.
- Existing `@supabase/supabase-js` and Python/Node standard libraries were sufficient.
  No dependency or system-software installation was required.
- Earlier 35 pgTAP assertions and three concurrency tests were not rerun in this phase.

Completed machine-readable evidence:
[api_realtime_ac079a5b_resume_1792089826828.json](tests/results/api_realtime_ac079a5b_resume_1792089826828.json).

The completed run exercised actual local Auth sessions, HTTP Data API requests,
and WebSocket subscriptions. The fixture operator used local privileged Auth
access only to create seven test identities and obtain sessions; application
authorization checks used anonymous or ordinary authenticated user credentials.

## Inspection findings

The Vue client in `src/lib/supabase.js` reads Vite URL/publishable-key variables,
checks URL syntax, and creates a standard client. It does not implement role
authorization. The test suite does not import this client or read `.env`; its
endpoints and credentials come only from validated local CLI status. Application
RPC integration should explicitly select `queue_api`; the client currently defaults
to the usual public schema. The frontend's actual environment values were not inspected.

Mutations use `queue_private.lock_actor()` to check `auth.uid()`, the current account
role, enabled state, and anonymous-Auth status after acquiring the mutation lock.
Read RPCs also consult current account state. App roles are not trusted from the
JWT's user-editable metadata. Existing Auth sessions remain valid when an app role
changes, but the next protected RPC uses the new database authorization state.

Definer functions pin an empty search_path and qualify object names. Their trusted
owner bypasses table RLS; the private security boundary is restricted grants plus
explicit checks inside reviewed functions. Browser EXECUTE grants do not bypass
those checks. Operator-only bootstrap is not an exposed RPC.

## API operations tested

All RPC requests use `POST /rest/v1/rpc/<name>` with the `queue_api` profile.

| RPC | Positive behavior exercised | Negative behavior exercised |
| --- | --- | --- |
| my_tickets | Student sees only own ticket; enabled empty account read | Anonymous and disabled denied |
| my_ticket_events | Owner sees permitted ticket event fields | Anonymous, other student, foreign cashier/admin, disabled denied |
| issue_ticket | Closed-current-day business rejection confirmed | Anonymous, ADMIN, and disabled denied; successful issuance not exercised |
| call_next | Assigned CASHIER calls isolated REF tickets | Student, ADMIN, unassigned cashier, revoked cashier denied |
| finish_ticket | Assigned CASHIER skips and serves | Student and unassigned cashier denied |
| staff_queue | CASHIER and ADMIN receive permitted operational reads | Student and revoked cashier denied |
| admin_configuration | ADMIN reads configuration | Anonymous, student, cashier, revoked admin denied |
| set_account | ADMIN revokes roles and disables the test account | Anonymous/student/cashier denied; student promotion to either staff role denied |
| configure_counter | ADMIN assigns isolated spare counter and closes it afterward | Anonymous/student/cashier/revoked admin denied; busy reconfiguration rejected |
| configure_service | No positive mutation, preserving existing service configuration | Anonymous/student/cashier denied |
| manage_day | ADMIN closes only the isolated future fixture day | Anonymous/student/cashier denied; current day remains untouched |

Additional raw HTTP tests:

- GET/PATCH/POST `/rest/v1/accounts` with `queue_private`: rejected with PGRST106
  for anonymous, student, cashier, and admin sessions.
- GET `/rest/v1/tickets` using the public schema: no private-table fallback (PGRST205).
- POST `/rest/v1/rpc/bootstrap_admin`: not exposed (PGRST202).
- PATCH public counter state: rejected for all four application access types.
- GET `/rest/v1/` OpenAPI using queue_api: no private table paths or student profile fields.
- GET `/rest/v1/` with queue_private: rejected.
- Anonymous GET counter_state/service_state: successful, with explicit field allowlists
  and checks against private canary names, student numbers, account UUIDs, and JWTs.
- Local Auth metadata update: adding `role: ADMIN` did not change the student's
  authoritative role or authorize administrator RPCs.

## Permission results

| Access type | Result |
| --- | --- |
| Anonymous | Sanitized display reads permitted; private reads and all application RPCs denied |
| STUDENT | Own ticket/history permitted; foreign history, staff operations, role promotion and administration denied |
| CASHIER | Assigned-counter operations and operational reads permitted; other counters and administration denied |
| ADMIN | Explicit configuration/role/day operations permitted; cashier operations, student issuance and foreign owner-history endpoint denied |
| Revoked CASHIER/ADMIN | Existing token still accepted by Auth, but former protected privileges immediately denied |
| Disabled STUDENT | Existing token still accepted by Auth; protected reads and issuance denied |

The remaining enabled test administrator was used to revoke other test roles.
No original concurrency-test account was changed.

## Realtime findings

Public subscriptions were established for anonymous counter/service streams and
an authenticated account's counter stream. Tests waited for the backend
`postgres_changes` system acknowledgement, not only the channel-join callback.

Observed events included:

- REF-001 and REF-002 at the correct isolated counter/date.
- Waiting count changes.
- Clearing the current number after skip/service.
- Recalling the skipped ticket after the other waiter.

Every captured new/old public row was checked against allowed display columns.
Full event envelopes were scanned for private canary values. No student name,
student number, account UUID, or JWT appeared. Counter UUIDs are intentionally
public identifiers and are distinct from account UUIDs.

Seven private-ticket subscription attempts covered anonymous, student, cashier,
admin, disabled-candidate, revoked-cashier-candidate, and revoked-admin-candidate
sessions. Each channel could join the public transport, but its database-change
extension returned **error**, never a ready acknowledgement. No private row events
were delivered, including after private fixture updates and role/enable changes.
Transport membership is not evidence of a successful Postgres Changes subscription.

Existing revoked/disabled subscription objects were retained during role changes.
They gained no private data access. The disabled account continued receiving the
intentionally anonymous sanitized display stream; application disablement does
not revoke information that is public to everyone.

Negative observations used a bounded observation window and catalog controls.
There is no authorized private subscription in this architecture, so this does
not demonstrate revocation of an initially granted private stream.

## Failures investigated

No application authorization vulnerability or public privacy leak was observed.
Several harness issues caused stopped attempts before the completed run:

1. The boolean fixture query returned psql's `t`, which cannot be parsed as JSON.
   It now explicitly uses `to_jsonb`. The student's administrator access was
   already denied before this parser failure.
2. Resume lookups used case-sensitive fixture email names, whereas Auth normalized
   addresses to lowercase. Lookup now normalizes both sides. Two diagnostic resume
   attempts stopped before application tests beyond catalog inspection.
3. `SUBSCRIBED` acknowledged the WebSocket channel before database replication was
   ready, causing a missed-update test failure. The suite now waits for the backend
   system acknowledgement. This behavior is documented in
   [Supabase Realtime troubleshooting](https://supabase.com/docs/guides/troubleshooting/realtime-postgres-changes-troubleshooting).
   Protocol meanings are described in the
   [Realtime protocol](https://supabase.com/docs/guides/realtime/protocol).

Attempt history is retained in separate sanitized JSON files. The final complete
run passed 27 checks. Earlier stopped attempts are not hidden or added to the final
pass count. No RLS/grant changes or new SQL migration were needed for these fixes.

The first cashier call succeeded before the readiness-related timeout. On resume,
its state was preserved and display projections were refreshed after readiness;
subsequent skip/call/serve updates were driven through actual HTTP RPCs. The result
file explicitly records that initial display-state replay.

## Isolation and preservation

The concurrency fixture day, October 16, was already closed. It was not reopened.
This suite used October 17 as a separate future fixture issuance day, REF tickets,
seven new Auth users, two private profiles, and spare Counter 3. Opening/numbering
for that future day used trusted fixture SQL rather than bypassing the production
RPC date rule. Positive current-day issuance therefore remains untested over HTTP.

Pre-existing accounts, profiles, tickets, ticket events, days, daily allocators,
assignments, replay records, administrative audits, services, and Counters 1/2
were fingerprinted in memory. Their original rows remained byte-for-byte unchanged.
Resumption excluded only this suite's own identified fixtures from the baseline.

The isolated day was closed through the secured ADMIN RPC. Counter 3 was restored
to closed/unassigned availability. Test users, profiles, tickets, events, and audits
were retained; the original twelve concurrency tickets and their day were preserved.
Public projections and the global waiting-position allocator changed as expected
from normal operations. No database reset or original-record deletion occurred.

## Files created

- `supabase/tests/run_local_api_security.py`: local credential/endpoint validation,
  read-only inspection/diagnostics, and isolated test launch/resume.
- `supabase/tests/api_realtime_security.mjs`: API role matrix, Auth sessions,
  preservation checks, public/private Realtime tests, and safe result output.
- `supabase/tests/results/api_realtime_*.json`: sanitized evidence for all attempts.
- `supabase/API_REALTIME_VALIDATION_REPORT.md`: this report.

No applied migration, database grant, RLS policy, hosted setting, frontend file,
.env file, dependency, or existing concurrency test was modified in this phase.
Credentials were obtained only from local CLI status and kept in subprocess memory.
No keys, JWTs, passwords, or test account UUIDs were written to reports.

## Reproduction and remaining work

Read-only commands, safe against the retained fixture state:

```powershell
python supabase/tests/run_local_api_security.py --inspect
python supabase/tests/run_local_api_security.py --diagnose-realtime
```

For a new isolated fixture run (creates new local users/day and retains records):

```powershell
python supabase/tests/run_local_api_security.py
```

The suite refuses existing active operational work or an unavailable spare counter.
`--resume-run` is intentionally restricted to incomplete fixtures before their
roles have been revoked/disabled; the completed run is not a resumable stage.

Next validation should cover successful HTTP issuance on a fresh open current day
without modifying existing fixtures, deterministic midnight contention, sustained
load/reconnect behavior, and enrollments/MFA decisions. Explicit positive service
configuration and disabled staff-account variants remain additional coverage.
Realtime Broadcast/Presence privacy and application UI flows were not exercised.

The results support advancing local validation. They do not authorize hosted
migration application or deployment, and do not establish production readiness.
