# Engineering report: Vue authentication and secure navigation, Phase 2

Date: October 16, 2026. Result: **PASS for the exercised local scenarios**.
Existing local users can sign in with email/password, recover a stored session,
sign out and navigate to their database-authorized workspace. Operational actions
remain disabled. Google OAuth was not configured or invoked.

## Implemented flows

- Session detection subscribes to Auth events and reads the existing SDK session.
  Before rendering a workspace, it verifies the user with local Auth and calls
  queue_api.my_context(). Auth metadata/JWT application roles never choose a role.
- Local password sign-in uses the existing public-key client. The form has email/
  password labels and autocomplete hints; passwords clear on submission. No signup,
  OAuth, password-reset, account-creation or operational mutation UI was introduced.
- Logout requests scope:'local', affecting the current SDK session rather than
  every session for that account. Protected state clears before the request. Failed
  logout keeps access locked and permits another sign-out attempt.
- Auth callbacks clear role/counter state synchronously, then defer verification;
  they do not await nested SDK calls. Request generations and abort signals reject
  responses from previous users, prior tokens, logout or unmounted components.
- Session expiry has a deadline timer and re-verification path. Unrecoverable
  expiry/session-ended events remove protected views and allow signing in again.
  Auth/API errors use generic messages without raw diagnostics or credentials.
- Context refreshes after Auth events, online, visibility restoration, Realtime
  readiness/reconnect and a 60-second visible-tab check. Protected-operation denial
  notifications also trigger revalidation. Self-context denial never creates an
  automatic retry loop. The public-queue selection survives overlapping refreshes.
- Auth listener, authorization-denial listener, polling, timers and in-flight
  requests are cleaned up when the component unmounts.

## Role navigation

| State | Result |
| --- | --- |
| Anonymous | Public queue and existing-account sign-in form |
| Enabled STUDENT | Student workspace preview; ticket issuance disabled |
| Enabled CASHIER | Cashier workspace preview and own actual assigned counters/services; actions disabled |
| Enabled ADMIN | Administrator workspace preview; configuration actions disabled |
| Disabled account | Access-disabled panel, retry/sign-out; no protected workspace |
| Context unavailable, checking or offline | Prior privileged view/counters cleared; retry or sign-out |
| Revoked role with existing session | New database role determines navigation after revalidation |
| Expired/ended session | Protected state removed; sign-in available |

Navigation is an in-page workspace selector, without adding Vue Router or URL
deep-link semantics. It exposes only the current permitted workspace and public
queue. Router/UI checks remain UX; PostgreSQL authorizes every protected operation.
No ticket history, directory, administrator configuration or mutation endpoint is
called by the new views. No account UUID, email or session details enter view state.

## Public context

Public snapshots now load counter_state, service_state and
queue_display.public_queue_context() through the separate stateless public client.
They validate/select known fields and apply together after request-version checks.
They remain three HTTP/database reads, not an atomic database transaction.

The UI displays enabled service codes/names, the RPC timezone/date and authoritative
queue-day open status. The local day is closed while two counters remain marked
open: the page correctly shows **Queue day not open**. It does not infer day status
from counter availability. Empty catalogs/totals and failures have explicit states.
Names/labels use text interpolation; HTML canaries are escaped in rendering tests.

After subscription readiness/reconnect, a fresh snapshot includes context. A timer
computes the next date change in the returned timezone, with a bounded periodic
check for changed clocks. It triggers a read; it never manufactures a new business
date or open status in the browser. Outage data is visibly labeled last reported.
Only the two existing public display tables are subscribed to; no private stream
or publication change was introduced.

## Test results

| Validation | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Final frontend service/controller/rendering tests | **51** | **0** | **0** |
| Local SDK/controller and headless browser acceptance checks | **20** | **0** | **0** |
| Offline database migration structural checks | **6** | **0** | **0** |
| Production npm build with local process configuration | Passed | 0 | 0 |
| Bundle scan for known local service-role/secret keys | Passed; none embedded | 0 | 0 |

Machine-readable live evidence:
[frontend_auth_097cbea5.json](tests/results/frontend_auth_097cbea5.json).

The final 51 checks cover role selection, contract validation, current/foreign
navigation, disabled state, account switching, stale startup/context responses,
logout failure, delayed sign-in completion, token refresh, expiry deadline,
protected-denial reconciliation, reconnect generations, unmount cleanup, immutable
mutation request keys, local/redirect guards, rollover scheduling, escaped service
names/counter labels and rendered empty/error/role views.

The 20 live checks import the exact queueApi/authController/publicQueueController
used by Vue and exercise actual local Auth and HTTP/WebSocket traffic. They include
wrong-password rejection, student/cashier/admin login, disabled access, revoked
cashier access with an unchanged session, real token refresh, public reconnect,
browser account switching/reload recovery and fixture preservation.

An initial frontend run passed 48 checks but its two SSR servers reported a shared
HMR-port warning. SSR tests now disable the unused Vite WebSocket server. The final
51-check run passed without that warning. Additional checks cover expiry deadlines,
public-navigation preference during overlapping refreshes and denial notifications.
The live run preceded the final denial-listener wiring/public-selection refinement;
those paths were covered by the final unit tests and production build.

The earlier PostgreSQL/pgTAP/concurrency/API runtime suites were not rerun or added
to these counts. The six offline migration checks were rerun and passed. No
dependency was installed. Existing Vue SSR/Vite, Node test runner,
Supabase SDK and pre-installed Chrome were sufficient.

## Browser results

Connected computer-use surfaces were empty. Acceptance instead used the installed
**Chrome 155** headlessly, an isolated incognito profile and a separate Vite process
at **127.0.0.1:5174**, supplied only local public frontend configuration.

- Desktop **1440 × 1000**: public catalog/day status, sign-in form, all three role
  workspaces, cashier Counter 5 assignment, logout/account switching and reload
  session recovery passed.
- Existing browser cashier session changed to STUDENT after trusted modification
  of only its new fixture account and a visibility event; former workspace vanished.
- Offline simulation immediately removed the administrator workspace; reconnect
  recovered access through a fresh server context.
- Mobile **390 × 844**: public queue/catalog and accessible login rendered without
  horizontal overflow. This is viewport emulation, not a physical mobile device.
- Browser interception allowed only the local Vite/API origins and Auth/read API
  paths. No operational/private request or uncaught runtime exception was observed.
- Anonymous desktop/mobile screenshots were inspected; service names wrap, cards
  stack and login fields fit. No account credentials appear in these images.

Screenshots:
[desktop](tests/results/frontend_auth_097cbea5_desktop.png),
[mobile](tests/results/frontend_auth_097cbea5_mobile.png).

The test browser and its Vite process were closed. Incognito site data was discarded;
the generated browser profile directory is ignored. No existing browser profile
was reused or changed. Manual keyboard/screen-reader acceptance, independent-tab
coordination and Safari/Firefox/physical mobile coverage remain additional checks.

## Security and preservation

- Both application clients receive only the local public API key. Every frontend
  fetch additionally validates the exact local gateway, refuses redirects and has
  a bounded deadline. Hosted/secret/service-role configurations remain rejected.
- Controller state and reports contain no passwords, JWTs, account IDs or Auth
  metadata. The app does not log requests, sessions or raw Auth/database errors.
- No SQL migration, RLS/grant, Auth provider/server configuration or .env file was
  changed. No public self-registration capability was added to the frontend.
  This UI restriction does not replace a server-side admission/signup policy;
  those existing server settings were not changed or certified in this phase.
- The privileged local Auth key was available only to the separate test fixture
  operator. It was not passed to Vite or frontend clients. The build scans known
  local service-role/secret values in generated JavaScript and found none.
- Tests created five unique local Auth users and one new cashier assignment. Role/
  enable changes affected only these new accounts. Their records remain; the cashier
  account ends as STUDENT with a deliberately stale fixture assignment, which
  my_context correctly excludes. No queue day or ticket was created or altered.
- Full-row fingerprints verified all pre-existing application/display/Auth user
  and identity rows remained unchanged. Normal sign-in/out created/ended only the
  new users' Auth sessions. Existing fixtures were not reset, deleted or rewritten.
- No application authorization vulnerability, public-data leak or unexpected
  database error was observed. No hosted project connection, deployment, Git commit
  or push occurred. dist/ is a generated ignored local build artifact.

## Files created or modified

| File | Change |
| --- | --- |
| src/App.vue | Compose public display and Auth workspace |
| src/components/AuthWorkspace.vue | Login, disabled/access states, guarded role previews |
| src/components/PublicQueueDisplay.vue | Real service catalog/day/timezone and workspace slot |
| src/composables/useQueueAuth.js | Auth lifecycle, visibility/online/Realtime/denial/poll refresh |
| src/lib/authController.js | Session/context generations, navigation, expiry and logout safety |
| src/lib/businessDate.js | Timezone date/next-rollover calculation |
| src/lib/localFetch.js | Local-only fetch, redirect refusal and deadlines |
| src/lib/supabase.js | Explicit local Auth/public-client options and fetch guards |
| src/lib/publicQueueController.js | Context snapshot and rollover lifecycle |
| src/services/queueApi.js | Validated context reads and protected-denial notifications |
| tests/frontend/authController.test.js | Session/role/race/expiry/rollover checks |
| tests/frontend/authWorkspace.test.js | Auth and role view rendering checks |
| tests/frontend/queueApi.test.js | New contract/client/denial/fetch checks |
| tests/frontend/publicQueueView.test.js | Authoritative day/catalog escaping and current view assertions |
| supabase/tests/frontend_auth_validation.mjs | Actual SDK and browser acceptance harness |
| supabase/tests/headless_local_browser.mjs | Isolated installed-Chrome test driver |
| supabase/tests/run_local_api_security.py | --frontend-auth local launch mode |
| supabase/tests/frontend_public_display.mjs | Recognize public-context RPC in existing request guard |
| supabase/tests/results/frontend_auth_097cbea5.* | Sanitized live JSON and desktop/mobile images |
| .gitignore | Ignore disposable browser profile directory |
| supabase/FRONTEND_INTEGRATION_PLAN.md | Phase 2 status, exact API usage and refresh behavior |
| supabase/FRONTEND_PHASE2_REPORT.md | This report |

src/main.js, style.css, package.json/package-lock, environment files and SQL files
were retained. No new dependency or system installation was needed.

## Commands and remaining work

```powershell
python scripts/local_frontend.py --dev
npm.cmd run test:frontend
python scripts/local_frontend.py --build

# Creates more isolated local users/assignment; retains records and starts/stops
# only its own headless browser and separate Vite test process.
python supabase/tests/run_local_api_security.py --frontend-auth
```

Use known credentials for an existing local account. Automated fixture passwords
were random, held in memory and not exported or applied to older accounts.

Expiry/session-ended logic was tested deterministically; real refresh was exercised
against Auth. The browser run did not wait for a real JWT's full expiration period.
Midnight scheduling was deterministic; the server clock was not changed. Role UI
may remain a snapshot between rechecks; the database still checks every action.
The current queue day remains closed and positive HTTP issuance/quota/retry gates
remain outstanding. No operational workflow was enabled to work around them.

Next, agree the admission/enrollment and server signup policy, then configure a
dedicated development Google OAuth client/provider and exact local callback/redirect
allowlists. Keep provider secrets outside VITE_ variables, choose/test PKCE callback
exchange, and enable URL-session handling only as part of that reviewed flow. Add
callback cancellation/error/session-recovery and independent-tab tests. Administrator
MFA remains a policy/acceptance gate before operational administrative controls.

Relevant primary references:
[Auth state callbacks](https://supabase.com/docs/reference/javascript/auth-onauthstatechange),
[Auth sessions](https://supabase.com/docs/reference/javascript/auth),
[Google Sign-In](https://supabase.com/docs/guides/auth/social-login/auth-google).

Phase 2 supports continued local Auth/UI integration. It does not establish
production readiness or authorize hosted deployment.
