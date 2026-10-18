# Minimal frontend integration plan

Status: Phase 1 public display is implemented; see [FRONTEND_PHASE1_REPORT.md](FRONTEND_PHASE1_REPORT.md).
Read-only Auth/navigation contracts are now implemented and locally validated in
migration `20261016000500_queue_read_context.sql`; see
[READ_CONTEXT_VALIDATION_REPORT.md](READ_CONTEXT_VALIDATION_REPORT.md).
Google frontend preparation now implements one product entry, PKCE and an explicit
local callback; the provider remains disabled/unconfigured. See
[GOOGLE_AUTH_FRONTEND_PHASE_REPORT.md](GOOGLE_AUTH_FRONTEND_PHASE_REPORT.md) and
[LOCAL_GOOGLE_OAUTH_SETUP.md](LOCAL_GOOGLE_OAUTH_SETUP.md). Password login is isolated
to /dev/login in development builds. STUDENT presents the shared Queue Dashboard;
roles still come only from verified Auth plus my_context. Staff approval, administrator
MFA and operational ticket/staff/administrator workflows remain unimplemented.
Use the existing Vue 3 / Vite / Supabase JS client; keep service secrets out of Vite.

Fixed routing migration `20261016000600_fixed_counter_routing.sql` is now validated
in separate fresh and populated disposable local projects; see
[FIXED_COUNTER_ROUTING_VALIDATION_REPORT.md](FIXED_COUNTER_ROUTING_VALIDATION_REPORT.md).
It is now applied and postvalidated on the retained development database, with a
verified six-version recovery bundle. Counters 1–5 have TP/SOA/PNEP/REF/ADJ respectively. The existing RPC/DTO
signatures remain unchanged. Configure-counter forms must present the fixed service
as read-only and submit its one-item array even when closing. my_context still filters
disabled services, so service_codes can be empty despite a mandatory stored route.
Public counter_state.service_code remains the currently CALLED ticket's service,
not an idle counter's permanent route. No new public route contract was added.
Positive current-day HTTP issuance/retry/quota tests passed in the isolated upgrade
project; frontend issuance is still disabled pending its own reviewed integration
and admission decisions. No frontend Auth or operational workflow changed in this task.

## API boundary

`src/lib/supabase.js` creates a client with the default schema. `src/main.js` provides
it to components. `src/App.vue` now uses the public queue composable and a responsive
view. The reusable service in `src/services/queueApi.js` explicitly selects queue_api
for permitted business operations; `src/lib/queue.js` provides its configured instance:

```javascript
import { queueApi } from '../lib/queue.js'

// Existing wrapper; use only after authenticated views are implemented.
const ownTickets = await queueApi.read('my_tickets')
```

Public reads use a separate stateless client with the same public key, explicitly
selecting queue_display. They cannot inherit a stored user session. Do not change
the shared client's global schema merely to make business RPCs work.
Role checks in the router are for navigation only. The database remains authoritative.

## Implemented read contracts

Both functions accept **no arguments**, return one JSON object, and need no mutation
request UUID. Call them with the existing public API key; only my_context also needs
the user's Auth session. No account ID, role, date or timezone can be supplied.

```javascript
import { supabase, publicSupabase } from '../lib/supabase.js'

const own = await supabase.schema('queue_api').rpc('my_context')
const publicContext = await publicSupabase.schema('queue_display').rpc('public_queue_context')
// Handle .error before using .data. These are the exact implemented RPC names.
```

The queueApi.read allowlist now includes my_context. readMyContext() validates its
exact response shape; readPublicContext() uses the stateless public client and
queue_display. readPublicSnapshot() includes public context with both display
tables, applying all three results together after version checks. Separate HTTP
reads remain separate database snapshots.

## Implemented local Auth and navigation

useQueueAuth owns the Auth listener/controller for App. It detects stored sessions,
signs in existing users with signInWithPassword, and signs out with scope:'local'.
No signup or OAuth UI/call was added; Auth server signup/admission settings were not
changed. Credentials are never logged and the password input clears on submission.

Session verification uses getSession/getUser and then readMyContext. The Auth
callback clears prior context synchronously and defers API work until after the
callback returns. Every request has a generation/abort guard. Views receive only
status and validated context; passwords, JWTs, email, metadata and account IDs are
not exposed through controller state.

Only an enabled ready context may select its matching workspace. Disabled accounts
get an access-disabled panel. Missing context, recovery failures and offline state
remove protected views. Logout clears navigation before its network request; failed
logout remains locked. Unexpected SIGNED_OUT and unsuccessful expiry recovery show
the signed-out/session-ended state. The SDK still manages token refresh/persistence.

Current navigation is an in-page guarded workspace selector; no Vue Router or URL
route/deep-link contract has been introduced. Public queue content remains mounted
and accessible throughout sign-in/out. Student/Cashier/Admin views are previews:
cashier assignments are real, but issuance, history and staff/admin actions are not
connected. No operational mutation is invoked by these components.

Context refreshes on Auth changes, online, visibility restoration, successful public
Realtime reconnection and a 60-second visible-tab check. queueApi authorization-denial
listeners trigger revalidation for protected operations; my_context denial is excluded
to prevent a retry loop. Polling is UX reconciliation, never an authorization lease.

Public context refreshes with snapshots, after readiness/reconnect/visibility, and
at the next date change computed in the RPC timezone. A 60-second check also detects
clock changes. Client dates only trigger reads; displayed dates/open status come
from the server. Service names use Vue text interpolation. All listeners, channels,
request controllers, polling and expiration/rollover timers are cleaned up on unmount.

`queue_api.my_context()` returns exactly:

```typescript
type MyContext = {
  role: 'STUDENT' | 'CASHIER' | 'ADMIN' | null
  enabled: boolean
  cashier_counters: Array<{
    counter_id: string // public counter UUID, never an account UUID
    counter_number: number
    counter_label: string
    is_open: boolean
    service_codes: string[]
  }>
}
```

- Enabled caller: role comes from its current queue_private.accounts row, not Auth
  metadata/JWT application-role claims. Only CASHIER gets assignments, sorted by
  counter number; enabled assigned service codes are sorted alphabetically.
- Closed assigned counters remain listed with is_open=false. An empty service list
  means no enabled assigned service; it does not authorize operating that counter.
- Disabled caller: HTTP 200 with exactly
  `{"role":null,"enabled":false,"cashier_counters":[]}`. This deliberately permits
  rendering an access-disabled page. Existing protected reads/mutations still deny.
- Anonymous callers, anonymous Auth identities, missing/unprovisioned identities:
  SQLSTATE 42501. Raw anonymous REST requests receive HTTP 401; ordinary signed-in
  authorization failures generally receive HTTP 403.
- STUDENT and ADMIN receive an empty counter array. ADMIN has no cashier override.
  No caller receives account/student identity, other staff assignments or audit data.

`queue_display.public_queue_context()` returns exactly:

```typescript
type PublicQueueContext = {
  timezone: 'Asia/Manila'
  business_date: string // YYYY-MM-DD, based on one server clock instant
  queue_day_open: boolean
  services: Array<{ code: 'TP' | 'SOA' | 'PNEP' | 'REF' | 'ADJ'; name: string }>
}
```

services contains only currently enabled catalog entries, sorted by code; it may
be empty. Render names as text, without v-html. queue_day_open is true only if an
open queue_days row exists for this exact server-local date. False includes both
absent and formally closed days and does not describe counter/office availability.
There is no client date override. Missing institution settings raises SQLSTATE
55000; network/server errors must never be interpreted as an open day or permission.

The anonymous role retains no USAGE on queue_api or queue_private. The public RPC
lives in queue_display so it needs no broader schema grant. Its private deterministic
clock helper cannot be called by browser roles and is not exposed through the API.

Reload own context after login/session/account changes, reconnect, returning to the
page, and protected-operation denial. Discard responses from older session/request
generations; never retain privileged controls while the current context is unknown.
This is a navigation snapshot, not an authorization lease: every protected action
still checks current database state. Do not subscribe to private account tables.

Refresh public context with public snapshots after subscription readiness/reconnect
and on visibility restoration. Also schedule a refresh around midnight in the
reported timezone: a clock-only date change generates no Realtime table event.
Client clocks are refresh hints; the server's date remains authoritative. Re-fetch
after relevant queue/configuration changes. This RPC and the display-table reads
remain separate snapshots, not one cross-table atomic transaction.

Administrative audit pagination is another future read contract if the admin UI
must show audit history. Current admin_configuration exposes settings and roles,
not a paginated audit feed or account identity directory.

Additional contracts belong in new reviewed migrations with authorization tests.

## Google authentication

1. Configure a dedicated development Google OAuth client and local Supabase provider
   in a separately authorized task. Do not put the Google client secret in VITE_*.
2. The documented local provider callback is
   `http://127.0.0.1:54321/auth/v1/callback`. Separately allowlist the Vue application
   callback route, for example `http://127.0.0.1:5173/auth/callback`.
3. Use `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })`.
   Choose and test the callback/code-exchange flow explicitly; if PKCE is selected,
   configure it and exchange the returned code once on the callback route.
4. Subscribe to Auth state changes and load the protected self-context after login.
   Google authentication alone is not enrollment verification. New accounts currently
   receive STUDENT, and admission/verification remains a separate unresolved policy.

Google login necessarily contacts Google and was not attempted during local-only
database validation. References:
[Supabase Google sign-in](https://supabase.com/docs/guides/auth/social-login/auth-google),
[redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls).

## Student ticket flow

Existing RPCs:

- `my_tickets()` for own ticket state/history.
- `my_ticket_events({ p_ticket })` for own permitted event history.
- `issue_ticket({ p_service, p_request_key })` for issuance.

Generate one request UUID per intended issuance. Retain it across retries of the
same service until the result is known. A new intention gets a new UUID. Disable
duplicate UI submits for usability, while retaining database duplicate protection.
After success, refresh my_tickets. On a transport failure, refresh and reconcile
the same request key instead of issuing a fresh one. Render closed-day, active-ticket,
quota and unavailable-service rejections distinctly. Do not calculate quota or
business date in the browser as an authorization decision.

Positive HTTP issuance, numbering, issuance replay and issuance quota are implemented
in the remaining test suite but currently skipped on the preserved closed date.
Validate them in the isolated instance before accepting this flow as complete.

## Cashier dashboard

Use `my_context()` for current role and own assigned counters. Load `staff_queue()`
and offer only supported assigned counters/services, respecting is_open.

- `call_next({ p_counter, p_service, p_request_key })`.
- `finish_ticket({ p_ticket, p_action: 'SERVE' | 'SKIP', p_request_key })`.

Generate a separate key for each intended action and retain it for ambiguous
retries. Refresh after every action. If access becomes denied, remove privileged
controls and reload self-context. A valid Auth session can outlive cashier authority.
Show busy-counter and role-change guard errors. There is no administrator cashier
override under the current single-role contract.

## Administrator dashboard

Start with `admin_configuration()`, then the explicitly approved operations:

- `set_account({ p_user, p_role, p_enabled, p_request_key })`.
- `configure_counter({ p_counter, p_open, p_services, p_cashiers, p_request_key })`.
- `configure_service({ p_code, p_name, p_enabled, p_request_key })`.
- `manage_day({ p_action: 'OPEN' | 'CLOSE', p_date, p_request_key })`.

For closing, show the selected date and explain that unfinished tickets for that
day are forfeited and it cannot reopen through the API. Preserve last-admin and
busy-cashier safeguards. Initial administrator bootstrap remains an operator task,
never a browser feature. Mandatory administrator MFA and identity-directory access
remain decisions before production use.

## Public display and Realtime

Read `supabase.schema('queue_display').from('counter_state')` and `service_state`.
Subscribe only to those tables with postgres_changes. Do not subscribe to private
operational tables or add student identity to display/presence/broadcast payloads.

Treat notifications as refresh signals. Confirm the backend postgres_changes
system readiness before depending on live delivery. Subscribe, wait for readiness,
then fetch a snapshot; coalesce notifications arriving during the fetch to avoid
stale overwrites. After reconnect, re-establish readiness and refetch both public
state and the signed-in user's authorized RPC data. Remove channels on component
unmount and account change. Avoid logging payloads that contain session information.

Public display access is intentionally anonymous. Disabling an account blocks
protected operations, while public information remains accessible.

References: [Realtime protocol](https://supabase.com/docs/guides/realtime/protocol),
[reconnect/missed-update guidance](https://supabase.com/docs/guides/troubleshooting/realtime-postgres-changes-troubleshooting).

## Integration order and acceptance gates

1. Complete: API wrapper, loading/error handling, snapshot reconciliation and public display.
2. Complete: self-context and public catalog contracts; 44 new pgTAP assertions and
   24 real Auth/HTTP checks passed. A current-open-day HTTP result remains unexercised
   on this closed retained date; deterministic open/closed/midnight projections passed.
3. Complete: local password Auth, safe role navigation, public context and expiry/
   reconnect handling; 51 frontend checks and 20 live SDK/browser checks passed.
4. Configure and validate Google Auth plus the approved enrollment policy.
5. Complete positive current-day issuance validation in a fresh isolated stack.
6. Wire operational student, cashier and administrator views with secured RPCs.
7. Extend browser coverage to independent tabs, real mobile browsers, Google callback
   recovery and mutation retry acceptance. Chrome role-revocation/offline checks passed.

This permits continued scoped local integration work. Phase 1 public display is
implemented, but this remains neither a production deployment plan nor approval.
