# ADMIN Live Tickets and MFA interface

October 20, 2026 (UTC+08), branch **backend**. **Implemented and tested.** Queue
configuration is removed from the ADMIN template. The persistent Live Tickets panel
uses the existing public snapshot. Authentic QR rendering and AAL2 verification passed
against isolated Auth. **The real personal MFA factor remains unverified and untouched.**

## Dashboard implementation

- Removed the entire Queue configuration card, its disabled Manage configuration
  button, obsolete styles and the ADMIN monitor's unused retry event wiring.
  PostgreSQL settings, business-date/timezone calculation, queue-day rules, routing
  and configuration RPCs remain unchanged.
- Added `AdminLiveTickets.vue` beside the three existing tabs. It receives the
  parent's public state; it creates no client, request, subscription or iframe.
  Counter mapping remains **1:TP, 2:SOA, 3:PNEP, 4:REF, 5:ADJ**, with full service
  names, availability, dated called tickets, dated waiting counts and refresh status.
- A missing waiting total says **Not reported**; zero stays zero. Empty counters
  say **No ticket being called** after synchronization. Invalid/mismatched counter
  rows cannot claim a current call. A pending background read retains the number
  with **Updating call snapshot** rather than presenting it as newly confirmed.
- Disconnected, failed and resynchronizing snapshots are explicitly stale; calls
  say **Last reported call** until backend readiness and a fresh snapshot restore
  live status. No manual queue-refresh control or page reload was added.
- The panel stays mounted across Overview & Analytics, Staff Management and Payor
  Management. A DOM ResizeObserver makes it sticky at 24px only when its actual
  height fits the desktop viewport; it becomes ordinary document flow when too tall.
  The observer and resize listener are removed on unmount. Tablet/mobile reposition
  the panel below content; medium widths use two counter-card columns.

The shared `counter_state`/`service_state` listeners, one public socket, 75ms event
batching, generation guards, reconnect and conditional HTTP fallback are unchanged.
The panel uses the public projections exclusively, never private ticket history.
Existing approved mutations refresh those projections: Call Next adds the call;
Serve/Skip clear it; issuance changes waiting totals; counter changes update availability.
Skip returns a ticket to WAITING; FORFEITED is a ticket status, not a new cashier action.

Read-only PostgreSQL inspection independently verified that all five published calls
match actual **CALLED** tickets and counter availability. At the checkpoint there
were **zero called tickets**: Counters 1/2 were open, 3/4/5 closed. No retained ticket
was issued or changed to manufacture a display. Direct private edits that fail to
refresh the existing projections remain a backend limitation; no private subscription
or SQL workaround was introduced.

## MFA findings and corrections

The existing supported enrollment/challenge/verify flow is preserved. An actual
isolated Auth 2.197.0 response reproduced two QR refusals:

1. Auth's SVG contains an XML declaration and generator comment, which the renderer
   rejected before displaying an image.
2. Its QR was about **363 KB**, exceeding the former **200 KB** limit.

The renderer now removes that harmless metadata, retains a **1 MiB** size bound and
rejects declarations/entities, active markup, event handlers and external references.
The validated SVG is encoded for an `<img>`, never inserted as HTML. If validation or
image decoding fails, the same enrollment's manual key remains privately available;
the UI does not create a duplicate factor. Browser tests verify real image decoding
and the error-to-manual fallback. No QR/key is saved to evidence or screenshots.

Unfinished setup now has an explicit **An unfinished setup needs attention** heading.
Closing/hiding, account changes and interruptions still clear sensitive display data.
Wrong codes clear the input, and explicit retry creates a fresh challenge. Expired
challenges, cancellation, session replacement and duplicate enrollment fail safely.
Provider diagnostics are no longer written to the console. An AAL2 claim without a
currently verified TOTP factor cannot display verified success.

The real Auth settings remain enabled, and the existing frontend serves the enabled
MFA capability and fix at `/account/security` (HTTP 200). Trusted inspection confirms
personal UUID **`5c96debb-697f-4cad-805f-92b518e28343`** remains enabled ADMIN with
**one unfinished factor / zero verified factors**. The existing setup's QR/key cannot
be redisplayed by this interface. Fixing new QR rendering does not recover that key.

The isolated test exercised the application controller and installed SDK against real
Auth: authentic QR acceptance, expired/wrong TOTP refusal, verified factor/AAL2,
reopening without setup material and same-user session replacement rejection. This
is **synthetic account acceptance**, not real personal-device enrollment. The existing
Google flow, verified `getUser` and current database-role resolution remain unchanged.
MFA does not grant a role. [Supported Supabase TOTP flow](https://supabase.com/docs/guides/auth/auth-mfa/totp).

## Tests and responsive evidence

| Final check | Result |
| --- | --- |
| Full frontend suite, serial | **208 passed**, zero failures/skips |
| Browser interception policy | **15 passed** |
| Final Vue/SDK OAuth/MFA/ADMIN browser, `f600f789` | **29 groups passed** |
| Actual Auth/application MFA controller, `f2e9d840` | **10 checks passed** |
| Real Student/Cashier browser + isolated backend, `f065b356` | **7 groups passed**, plus **123** existing SQL policy/routing methods |
| Actual anonymous `/display`/Realtime, `3372292f` | **15 groups passed** |
| Final public-only production build and known local private-key scan | PASS |
| Source/assets fixture-canary/private-pattern scan; syntax/whitespace | PASS |

ADMIN tests passed **1440/1280/1024/980/768/640/390/320px**, internal table scrolling,
keyboard/dialog behavior and no horizontal page overflow. Actual sticky positioning,
short viewports, five-call panel height and recovery in a taller viewport were tested.
Staff directory/search, verified UUID lookup, disabled direct activation, existing
role/counter confirmations, Payor filters/history and persistent tab/search/drafts
passed. No authenticated ADMIN Public Display link or Refresh Queue/Directory returned.

The browser suite uses intercepted Auth/private RPCs and controlled public snapshots
for call/serve/skip/issuance/closure transitions. It also closes the actual anonymous
socket and checks stale labels, fresh reconnect, one live socket and unchanged panel/
dashboard DOM. The standalone suite exercises actual anonymous local subscriptions.
The separate real queue browser suite performs mutations **only in its disposable
PostgreSQL/PostgREST fixture**. That fixture has no Realtime server; HTTP operation
refresh and real Realtime readiness are separate coverage, not a retained mutation-
to-Realtime acceptance claim. No new real Google login was performed in this task.

Screenshots are explicitly browser fixtures; no fixture value entered product code.
Desktop/mobile and the safe unfinished-setup screen were visually inspected:

- [Live Tickets — desktop](../supabase/tests/results/video_ui_f600f789_SIMULATED_admin-live-called_1440.png)
- [Live Tickets — tablet](../supabase/tests/results/video_ui_f600f789_SIMULATED_admin-live-called_768.png)
- [Live Tickets — mobile](../supabase/tests/results/video_ui_f600f789_SIMULATED_admin-live-called_390.png)
- [Unfinished setup — no QR/key/code](../supabase/tests/results/video_ui_f600f789_SIMULATED_mfa-unfinished_390.png)

Earlier failed evidence remains: five isolated MFA runs exposed the metadata/size
compatibility defects before final acceptance. Each preserved retained state and
stopped its fixtures. One full unit run had **207/208** because an obsolete ADMIN
test relied on the removed disabled configuration button; the updated test verifies
absence of confirmation controls instead. The final 208-method rerun passed. Browser
`5ea9ee1b` checked the short viewport before the ResizeObserver callback; the final
test awaits the actual layout state. No acceptance requirement was waived.

## Files and preservation

New product file: `src/components/AdminLiveTickets.vue`.

Changed product files: `AdminDashboard.vue`, `AccountMfaDialog.vue`,
`AuthWorkspace.vue` (unused event only), `src/lib/accountMfa.js`, `src/admin.css` and
`src/workspace.css` (unused configuration styles only). Updated tests:
`accountMfa.test.js`, `workspaceViews.test.js`, `authWorkspace.test.js` and
`googleOAuth.browser.mjs`. Added fixed read-only `inspectAdminLive.mjs` and isolated
`accountMfaInterface.integration.mjs`, plus this report and new evidence.

All **2,099** captured pre-existing inputs remain; **2,089** retain their hashes.
The ten intended changes are the six product/four test files above. Existing
modified/untracked work, Student/Cashier source, ticket actions, queue API/contracts,
Realtime controller, Google/PKCE modules, dependency files, configuration, all six
migrations, proposed 007/012 and historical reports/evidence were preserved.

Final trusted closeout **03:53:11 UTC+08** passed against this task's fresh baseline:
application/Auth-user/identity fingerprints, factor/request hashes, functions/ACLs,
migration receipts, service definitions and non-Vector lifecycles matched. There
remain **42 accounts, 20 tickets, 57 events, four assignments**, six migrations and
the same five routes. The school account remains STUDENT; no account role changed.
Auth/settings/API returned **200**, Google and TOTP remain enabled. 007/012 remain absent.
This task's PASS does not rewrite the earlier handoff's separate Auth-fingerprint finding.

Exact resource checks account for **20 stopped disposable containers and seven labeled
test networks** across attempts. No retained mount, image pull or volume creation/
deletion occurred. Existing services and parked Auth originals remain. No retained
SQL/Auth/MFA mutation, staff request, assignment, queue change, service restart,
credential change, backup access/deletion, deployment, commit or push was performed.
Owned test browsers/servers were closed; the existing user frontend remains running.

## Manual MFA step and remaining limits

Open **http://127.0.0.1:5173/account/security** and personally sign in with
`ellasharmaineabeso2004@gmail.com` if needed. Open Account security.

- If the authenticator already contains this unfinished setup, choose **Finish
  existing authenticator setup** and personally enter its current six-digit code
  **in the app only**. Success must show verified AAL2 and refresh current DB context.
- You previously confirmed that you never scanned it. In that case, **stop at the
  unfinished-setup screen**. Separate trusted review and explicit approval for the
  exact unverified-factor cleanup are needed before a new setup. No cleanup is
  performed or authorized by this task. Do not repeatedly enroll or guess codes.
- After that separately approved cleanup, personally choose Set up authenticator,
  scan the new QR (or use its private manual key) and verify in the app. Never send
  QR images, setup keys, OTPs or tokens to Codex/ChatGPT. No screenshot of setup is needed.

Real personal AAL2 remains unverified. Existing staff-security approval/AAL2 gaps
remain until separately reviewed 007 application and operator approvals. Direct Add
Staff remains locked; 012 installation and release require separate approval. No
privileged production-readiness claim follows from these UI and isolated results.

Evidence: [baseline](../tests/integration/results/admin_live_baseline.json),
[strict closeout](../tests/integration/results/admin_live_closeout.json),
[unit/build/preservation receipt](../tests/integration/results/admin_live_validation.json),
[final browser](../supabase/tests/results/google_oauth_frontend_f600f789.json),
[actual synthetic MFA](../supabase/tests/results/account_mfa_interface_f2e9d840.json),
[real isolated queue](../tests/integration/results/full_stack_browser_f065b356.json),
[anonymous display](../supabase/tests/results/public_board_3372292f.json).

**Stopped after implementation, tests and reporting. Real factors, roles, assignments,
queue records and security migrations remain untouched.**
