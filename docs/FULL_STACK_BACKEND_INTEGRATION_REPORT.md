# Full-stack backend integration — Phase 3

October 19, 2026 (UTC+08). **PASS for implementation and isolated verification.**
Student issuance and cashier call/serve/skip were demonstrated from the existing Vue
screens against real disposable PostgreSQL/PostgREST instances. **Retained-environment
end-to-end operation and real Google login were not performed. Google remains disabled.**

## Implemented behavior

- Student: service confirmation now invokes `issue_ticket`; the real receipt and refreshed
  owner ticket list supply the assigned number, queue date, active status and history.
  Day/service availability, one active ticket across services and served quota are checked
  again before sending; PostgreSQL remains authoritative. Counter status is informative;
  no additional counter-open issuance rule was invented.
- Cashier: database-assigned fixed-service counters support confirmed Call Next, Mark
  Served and Skip. Controls require ready queue data and valid assignment/state. Skip
  returns the same numbered ticket to the waiting tail. Serve does not call another ticket.
- Operations: one immutable request UUID per intent, actor-bound durable browser journal,
  cross-tab Web Lock, no SDK automatic mutation retries, strict receipt validation and
  explicit same-key reconciliation after an unknown outcome. Existing ticket presence
  alone is not treated as a confirmed operation receipt.
- Refresh: successful or failed attempts refresh authoritative private/public reads.
  A forced private refresh discards reads begun before the write. Controls stay locked
  through that refresh. Access changes clear protected render state and abort requests;
  pinned JWT subjects prevent an account switch from retargeting an intended write.
- UI: original layouts, five services, dialogs, search, responsive behavior and public
  monitor remain. Real success/error/unknown messages replace the Phase 2 unavailable
  notices. Sign-out warns when an operation is unconfirmed.

The local journal contains operation/actor identifiers and a request key, **not tokens,
credentials or queue-history rows**. It is saved and read back before sending. Unconfirmed
keys do not silently expire. Another action is blocked until reconciliation; ISSUE/CALL
replay across a changed business date requires staff review. Corrupt storage and unavailable
locking fail closed. No ticket-cancellation operation was added.

## Verified contracts

Live read-only metadata matched all eight function bodies to migrations 001–006, with
the expected execution grants and security-definer settings. No migration was changed.

| RPC and arguments | Actual result / authority |
| --- | --- |
| `my_context()` | `role`, `enabled`, `cashier_counters`; current DB account, not Google metadata/domain. Disabled access masks role/assignments. |
| `my_tickets()` | Own `id, service, number, business_date, status, counter, issued_at`. |
| `my_ticket_events(p_ticket uuid)` | Owner-only `event, at, status`; cross-owner requests denied. Verified in backend tests; no new event-timeline UI. |
| `issue_ticket(p_service text, p_request_key uuid)` | STUDENT; returns `ticket_id, sequence_number, service, business_date, status=WAITING`. Institution date is captured by PostgreSQL in Asia/Manila. |
| `staff_queue()` | Current CASHIER assignments or ADMIN; active `ticket_id, service, number, business_date, status, counter_id, wait_position`. No customer identity fields. |
| `call_next(p_counter uuid, p_service text, p_request_key uuid)` | Assigned CASHIER, open counter and enabled matching service; returns `ticket_id,status=CALLED`, or exactly `ticket_id=null` for empty queue. |
| `finish_ticket(p_ticket uuid, p_action text, p_request_key uuid)` | CASHIER assigned to the called ticket's counter; `SERVE → SERVED`, `SKIP → WAITING`, returning `ticket_id,status`. Issuance-day quota remains enforced. |
| `queue_display.public_queue_context()` | Anonymous-safe `timezone, business_date, queue_day_open, services[{code,name}]`. |

Queue mutations serialize through the existing settings-row lock. Successful receipts
are recorded per actor/request key: the same operation/parameters replay their result;
changed parameters with that key return **22023**. Current authorization still applies.
Unauthorized operations return **42501**. Existing business rejections use **P0001**;
only exact allowlisted reasons become friendly UI messages. Network/timeouts, ambiguous
server errors and malformed success receipts remain unknown. No raw SQL diagnostics appear.

## What was actually tested

**Real backend:** cached PostgreSQL **17.11** and PostgREST **16.4**, fresh uniquely
labeled containers, separate bridge, no retained mounts, no PostgreSQL host port and
test API bound only to `127.0.0.1`. The unchanged six migrations were applied only there.
The fixture uses minimal synthetic Auth identities and signed test JWTs; no Auth service,
real account or Google credential is used. It is not a complete Supabase deployment.

The real HTTP/SDK tests cover issuance, duplicate active/quota/closed-day/unavailable
service rejection, anonymous/disabled rejection, owner history/events, role/assignment
denials, no metadata promotion, call/busy/empty queue, serve replay, skip-to-tail, competing
requests, changed-key arguments, sanitized public projections and a lost successful
response recovered by explicit same-key replay. Existing SQL tests independently check
RLS, grants, private boundaries, read contexts, routing, quotas and queue operations.

**Real Vue-to-backend browser flow:** issuance, active-ticket rejection, cashier call,
skip ordering, separate serve/call, actual served history, dropped-response recovery and
public call rendering passed through the SDK and owned PostgREST API. Interception routes
all application API traffic to that fixture; it never forwards a mutation to the retained
gateway. Layouts were checked at **1440, 768 and 390px**.

**Mocked boundary:** Google availability/consent redirect, PKCE token exchange and
`getUser` responses are intercepted in browser tests. The queue RPCs in the full-stack
suite are real; Auth acceptance is not. A deliberately disconnected Realtime boundary
prevents fixture JWTs from reaching retained Realtime. Post-operation HTTP refresh and
public projection changes were verified, **not mutation-driven delivery through a real
disposable Realtime service**. Separate public-monitor regressions verify actual retained
anonymous subscriptions, readiness, offline/reconnect and fresh reads without queue writes.

| Final check | Result |
| --- | --- |
| Frontend unit/view/security tests | **113 passed**, 0 failed/skipped |
| Interception policy methods | **15 passed**, 0 failed/skipped |
| Existing SQL policy/queue/read-context/fixed-routing tests | **123 passed**, 0 failed; fixture only |
| Real PostgreSQL/PostgREST operation groups | **11 passed**, 0 failed; run `73912e16` |
| Real Vue + isolated queue backend browser groups | **7 passed**, 0 failed; run `3fb61049` |
| Intercepted OAuth/UI regression groups | **18 passed**, 0 failed; run `84c2bb79` |
| Live read-only public-display browser groups | **15 passed**, 0 failed; run `f35d20c5` |
| Public-only frontend production build | PASS |
| Source/assets canary/private-pattern scan; known local service/secret-key build scan | PASS |
| JavaScript syntax and Git whitespace checks | PASS |

Counts are separate coverage groups, not summed repetitions. Earlier failed evidence
remains: fixture extension visibility and port publication setup; proxy CORS count headers;
premature test completion assertions; a real controls-before-refresh race fixed with the
busy-state regression; and cold/concurrent browser startup. Test servers now ignore
disposable profiles/results and warm the module graph. Final required suites passed.

Evidence and representative screenshots:

- [Real operation/policy evidence](../tests/integration/results/queue_operations_73912e16.json)
- [Real queue browser evidence](../tests/integration/results/full_stack_browser_3fb61049.json)
- [Student issued ticket](../tests/integration/results/full_stack_3fb61049_student-issued_1440.png)
- [Cashier serving](../tests/integration/results/full_stack_3fb61049_cashier-called_1440.png)
- [Unknown outcome on mobile](../tests/integration/results/full_stack_3fb61049_student-unknown_390.png)
- [OAuth/UI regressions](../supabase/tests/results/google_oauth_frontend_84c2bb79.json)
- [Actual anonymous monitor regression](../supabase/tests/results/public_board_f35d20c5.json)

Screenshots show labeled disposable test data and were visually inspected. A final small
spacing adjustment separates receipt text from its Dismiss button.

## Files, preservation and remaining boundaries

New: `src/lib/queueActions.js`, `src/composables/useQueueActions.js`,
`src/components/QueueOperationNotice.vue`, `tests/frontend/queueActions.test.js`, and
`tests/integration/{queueFixture.mjs,queueOperations.integration.mjs,fullStack.browser.mjs}`.
Existing student/cashier/Auth composition, API wrapper, workspace reader, styles and
related frontend tests were updated in place. The Auth controller adds only a private
verified-actor accessor; PKCE/session verification and database role resolution remain.

The initial working tree already contained Phase 2 modified and untracked work. It was
preserved. **500 of 517 captured existing inputs retained their hashes**; the 17 changed
inputs are the intended frontend/test files. Prior reports/evidence, all migration files,
dependencies, configuration, public-monitor implementation, credential/infrastructure
helpers and unrelated files remain unchanged. No destructive Git command, commit or push.

Each completed isolated run passed strict retained queue/Auth row fingerprints and
service-definition/lifecycle checks. Vector's existing automatic restart activity is
separate; its definition was unchanged. Exact Docker inventory checks allowed only owned
new test resources. Across attempts, **20 test containers are stopped**; their **11 new
networks** remain. No volume was created/deleted and no image was pulled. Synthetic PGDATA
was in disposable tmpfs, not a recovery volume. Existing backups and the Google DPAPI
store were not opened or changed. No retained queue/Auth write or service operation ran.

Still disabled/unavailable: sensitive staff/account management and invitations pending
approved MFA protections; unsupported historical analytics; ticket cancellation without
a backend contract. No administrator/cashier account was promoted or modified.

Remaining acceptance: separately approved Google activation and real consent/session/
identity testing; approved retained-environment operation testing; mutation-to-screen
Realtime delivery with a real isolated Realtime service; operator handling for corrupt
or date-crossing unconfirmed journals. **No retained end-to-end or production-readiness
claim follows from this result.** Final public settings still returned **Google=false**.

## Local startup

With existing local Supabase services already running:

```powershell
Set-Location -LiteralPath 'C:\Users\Hp\school-queue-management-system'
python -B scripts/local_frontend.py --dev
```

Open `http://127.0.0.1:5173/` or `/display`. Google remains unavailable until separately
activated. Do not use retained sign-in/queue writes merely to repeat this task's tests.
The isolated runners above create fresh fixture resources; they are not retained-target
commands. No Supabase reset, stack restart, provider activation or restructuring is needed
to launch the frontend.

**Stopped after implementation, isolated testing, regressions and reporting.**
