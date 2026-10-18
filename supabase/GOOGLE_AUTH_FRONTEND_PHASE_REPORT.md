# Engineering report: Step 21 Google frontend and OAuth preparation

Date: October 17, 2026. **Frontend implementation completed; exact retained-source
postflight FAILED on Realtime platform metadata changes.** The final browser-only
suite passed 15 checks and the frontend suite passed 85 tests. Full task acceptance
is not represented as PASS because the preservation wrapper stopped. No real Google
login, administrator designation, provider activation or migration was performed.

## Implemented login and navigation

The product at / now offers one prominent **Continue with Google** button, with
maroon/gold styling, accessible labels/focus/loading/error states and public-display
access. It has no password form, signup form or role selector. Existing email/password
testing is isolated at /dev/login, selected only in a Vite development build. This
does not disable server email authentication or signup; existing Auth policy was retained.

The frontend checks the local Auth public-settings endpoint before OAuth preparation.
The real endpoint currently reports Google disabled. Clicking the product button
therefore shows a safe unavailable message instead of navigating to a disabled provider.
No credential or frontend feature flag can bypass database role authorization.

Enabled STUDENT now presents the shared **Queue Dashboard** for students and outside
payors. CASHIER and ADMIN retain their existing database-authorized workspace previews;
disabled accounts retain the masked disabled page, and unavailable context fails closed.
No email/domain/metadata exception grants staff privileges. The intended future real
administrator was not created, promoted, bootstrapped or modified. Its address appears
only as an adversarial synthetic test identity, never as a production authorization rule.

Ticket issuance and cashier/admin mutations remain disabled. Google login does not
issue a ticket, upsert an account, create a student profile, approve a cashier or grant
beneficiary/financial-record access. /display remains a separate anonymous composition
with the existing stateless public client and unchanged public projection authorization.

## PKCE and callback handling

Installed supabase-js/auth-js are **2.118.0**. The authenticated client now explicitly
uses flowType=pkce, persistSession=true, autoRefreshToken=true and
detectSessionInUrl=false. The public client remains stateless and has no URL exchange.

The exact application origin is http://127.0.0.1:5173 and its only OAuth callback is
/auth/callback. Startup captures the callback privately in memory and removes its
query/fragment before Auth-client initialization. The page has no-referrer policy.
Implicit token fragments, duplicated/conflicting callback parameters, unexpected
parameters and wrong origins are rejected. Raw provider error descriptions are never
rendered or logged; the code is cleared from the in-memory entry after handling.

signInWithOAuth uses provider=google, the exact callback, skipBrowserRedirect=true
and prompt=select_account. Before browser navigation, the returned URL must match
the exact local Auth origin/authorize path, Google provider, callback, single allowed
parameters and a 43-character S256 challenge. No alternate host, userinfo, fragment,
role/email parameter or plain challenge is accepted. The installed SDK emits the
method as lowercase s256. skipBrowserRedirect controls SDK navigation and is not an
extra skip_http_redirect query parameter in this method.

One explicit handler exchanges the code. A shared callback promise prevents duplicate
calls in a mounted controller; a persistent flow phase prevents code reuse after
reload. Reconciliation reads the stored session and verifies getUser, then the existing
Auth controller independently verifies the session/user and fetches my_context before
navigation. The callback receipt or JWT metadata never selects a workspace.

Opaque flow markers contain attempt/tab identifiers, creation time and phase only,
not codes, tokens, emails, roles or Auth UUIDs. Origin-wide Web Locks protect SDK
verifier preparation/exchange against competing tabs. Unsupported coordination/storage
fails closed. Existing sessions must be signed out before starting an account switch.
Provider cancellation, missing verifiers, expired/repeated codes and interrupted
exchanges have safe error/cancel/reconciliation states.

A timeout invalidates the response generation: late SDK completion can save a session,
but cannot automatically restore a workspace. The underlying exchange retains its lock
until it settles. Explicit reconciliation is required; no automatic repeated code
exchange or new OAuth attempt occurs. Logout/cancellation/unmount invalidate callbacks
and pending context. Cross-tab flow changes clear prior navigation and require fresh
verification. Auth callbacks still avoid awaiting nested SDK calls.

The original context-generation, expiration, reconnect/visibility/denial refresh and
account-switch guards remain. Owner roles/counters are still read from current database
state. Administrative MFA and cashier email approval are not implemented or bypassed.

## Backend and recovery inspection

Initial read-only inspection independently verified school-queue-local, API
127.0.0.1:54321, PostgreSQL 127.0.0.1:54322/postgres, six applied migrations and unchanged
migration file hashes. The actual AFTER INSERT auth.users trigger still calls
queue_private.provision_account(), inserting accounts(id) with STUDENT/enabled defaults.
That existing atomic mechanism supports ordinary first-login provisioning without
administrator approval; no additional migration or browser account insert is needed.
Real first-Google-login provisioning remains untested until provider acceptance.

The six-version recovery bundle's checksums, source associations, generated supplements
and restricted NTFS access passed read-only verification before testing and again in
final diagnosis. The archive was not rewritten/restored and no recovery volume was
started or deleted. Artifact integrity is distinct from exact equality to the current
running database after platform maintenance.

Initial evidence: [read-only inspection](tests/results/google_auth_frontend_inspection.json).

## Test results

| Group | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Final frontend unit/controller/SSR/SDK methods | **85** | **0** | **0** |
| Final browser-only acceptance | **15** | **0** | **0** |
| Initial six-version/provisioning/recovery inspection | PASS | 0 | 0 |
| Final exact source-preservation wrapper | 0 | **1** | 0 |
| Read-only application/Auth preservation and blocker diagnosis | PASS | 0 | 0 |
| Local production build / known-private-key scan | PASS | 0 | 0 |
| JavaScript/Python syntax and diff whitespace checks | PASS | 0 | 0 |
| Real Google provider / first-user creation acceptance | 0 | 0 | 1 — provider disabled |
| New standalone live forced-reconnect suite | 0 | 0 | 1 — no further live test after preservation stop |

The 85 frontend tests retain prior coverage and add OAuth URL/callback, actual SDK
S256/missing-verifier, cancellation, duplicate/reloaded callback, timeout/late-response,
cross-tab intent, development-form isolation, external-auth generation and shared
requester navigation checks. Existing disabled/revoked/session-expiry/reconnect,
metadata escalation, request-key and public board tests passed. Repeated runs are not
added together. Real JWT expiry and Google identity linking were not newly exercised.

The browser suite used actual Vue and the installed Auth SDK with deterministic
interception of availability, authorize redirects, token exchange, getUser, logout and
my_context. **No Auth mutation or synthetic authorization request was forwarded to
the retained server.** The adversarial user metadata/email remained ordinary until
the mocked authoritative context changed. Tests covered session restoration, staff
context compatibility, revocation/disablement, account switching, duplicate callback,
cancellation, expired code, missing verifier, desktop/mobile, dev login and /display.

Public projection reads and Realtime subscription readiness on /display were real.
The new standalone transport-reconnect run was not started after postflight failed;
deterministic reconnect/stale-response tests passed in the 85-method suite. Older
public-board live reconnect results remain historical and are not claimed as new counts.

Browser-only evidence: [15 passing checks](tests/results/google_oauth_frontend_1f7dca31.json).
It intentionally lacks a passing source-preservation field: the Python wrapper failed
after those checks. No new pgTAP, concurrency, fixture-creating HTTP or business-mutation
suite was run. No dependency or system software was installed.

### Browser environment, screenshots and investigated failures

An owned Vite process used port 5176. CDP served its resources under the exact approved
5173 browser origin, without contacting or changing an existing Vite server there.
Only the isolated incognito test browser received origin-scoped loopback permission:
Chrome otherwise rejected the intercepted documents' local requests with
LocalNetworkAccessPermissionDenied. No global browser flag, user profile, firewall,
server CORS rule or application guard was weakened. Auth endpoints stayed intercepted;
other unexpected endpoints/Google/hosted traffic were denied.

The test browser and owned Vite process were closed. The ignored disposable browser
profile and sanitized evidence remain. Desktop 1440×1000 and mobile 390×844 rendered
without horizontal overflow; this is viewport emulation, not physical-device or
screen-reader acceptance.

- [Desktop callback/login state](tests/results/google_oauth_frontend_1f7dca31_1440.png)
- [Mobile callback/login state](tests/results/google_oauth_frontend_1f7dca31_390.png)

Earlier attempts ce14502d, 102d6c34, ea573b40 and 5507bcc6 remain recorded. They exposed
test timing for removing a verifier and then the intercepted-document local-network
permission issue. A public-preflight adjustment alone did not resolve Chrome's
permission failure; safe network-category diagnosis identified the actual blocker.
The final browser run passed after the isolated permission fixture was added.

One initial offline SDK assertion incorrectly expected skip_http_redirect in the
generated URL. Inspecting the installed method corrected the strict allowlist, and
the retained SDK test passed. No permissive hostname or redirect fallback was added.
CLI --help initially met a sandbox telemetry-file permission error; an approved
help-only rerun succeeded. No stop/start command was executed.

## Exact source-preservation failure and read-only diagnosis

After the final browser checks, the unchanged strict fence rejected differences
beyond realtime.subscription_id_seq. It was not relaxed or rebased. Diagnosis found:

- A new, empty **realtime.messages_2026_10_20** partition attached to realtime.messages,
  owned by supabase_realtime_admin, for UTC October 20–21. It has the platform's two
  new indexes, two constraints and ten columns. The logical table inventory is now
  **70**, compared with the original 69-table snapshot.
- The partition appears in the separate platform
  supabase_realtime_messages_publication. The application supabase_realtime publication
  remains exactly queue_display.counter_state and service_state.
- Transient realtime.subscription rows and its allocation sequence changed during
  live subscription activity. No private business/Auth table changed.
- No pre-existing schema entry was changed or removed. Catalog additions are confined
  to that Realtime partition and its associated objects/publication membership.

These are platform-maintained Realtime objects observed during testing; the frontend
and harness issued no SQL DDL/DML or real Auth writes. The exact background trigger/time
was not independently attributed. **This explanation does not turn the mandatory exact
preservation failure into PASS.** No partition or subscription row was deleted, no
constraint/RLS setting was changed and no automatic restore/recovery was attempted.

The new physical leaf reports relrowsecurity=false; it is not one of the application's
15 RLS-enabled tables. This task did not alter it. Full direct-leaf/platform privilege
acceptance is outside the frontend test scope; do not infer a new public API from its
presence or silently enable/disable platform security controls.

All application/display/Auth/migration-history fingerprints remained unchanged.
Final state still has six migrations; 39 accounts, 20 terminal tickets, 57 events,
69 replay receipts, 32 audits, seven closed days and zero active tickets. All staff
fixtures and fixed routes remain intact. Existing schema definitions/owners/grants,
roles, additional privileges/settings and application security boundaries are unchanged.
The real Auth public-settings endpoint still reports Google disabled. Recovery files
remain intact; no fresh 70-table recovery point was created.

Evidence: [strict postflight failure and diagnosis](tests/results/google_auth_frontend_postflight.json).
A first diagnosis assumed every original table was unchanged and stopped on the
transient subscription-table difference; the final record names that difference
explicitly instead of masking it. No private row content was printed.

## Build, privacy and remaining security limits

The build used validated local public configuration in memory. The existing helper
found no captured local service-role/secret key in generated JavaScript. Additional
mock code/token/email canary checks covered the DOM and bundle. No real Google client
secret was available, so this does not claim a scan against a configured provider secret.
No password, JWT, OAuth code, session or raw provider diagnostic was logged by application
code or written into reports. The SDK verifier/session storage remains sensitive.

The main client still restricts fetches to the exact loopback gateway and refuses
redirect following. Only deliberate full-page navigation through validated local Auth
can start OAuth. Public reads keep the stateless client, explicit columns and existing
schemas; no private subscription or private table access was added.

Remaining gates include real Google callback/consent/identity-linking acceptance,
cross-browser/two-independent-tab provider acceptance, XSS/CSP review for localStorage
sessions, enrollment/beneficiary and abuse policy, server cashier identity approval,
administrator MFA enforcement and protected operational UI acceptance. Existing ADMIN
previews do not certify MFA. No school domain grants enrollment/staff authority.

## Local Google configuration still required

The detailed non-secret procedure is in [LOCAL_GOOGLE_OAUTH_SETUP.md](LOCAL_GOOGLE_OAUTH_SETUP.md).
Its steps were prepared, not executed:

1. Separately approve a dedicated development Google Web client with External audience
   and consenting personal/school test accounts; minimal OpenID/email/profile scopes.
2. Register Google-to-Supabase callback **http://127.0.0.1:54321/auth/v1/callback**.
3. Set local Site URL **http://127.0.0.1:5173** and exact application redirect allowlist
   **http://127.0.0.1:5173/auth/callback**. Current port-3000/scheme mismatch remains.
4. Inject the Google secret only into the local Supabase server/CLI process through
   protected storage; never source/VITE_/tracked files/reports.
5. After source/recovery review and explicit infrastructure approval, activate the local
   provider and perform the controlled pinned-CLI stop/start preserving existing volumes.
   Never use --no-backup: installed help confirms it deletes data volumes.
6. Verify effective non-secret settings and run separately authorized real provider
   acceptance. Automatic ordinary provisioning must use the existing trigger.

Current documentation references:
[Google provider](https://supabase.com/docs/guides/auth/social-login/auth-google),
[PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow),
[local configuration/restart](https://supabase.com/docs/guides/local-development/cli/config).
No Google credentials or hosted settings were created/configured.

## Files changed

| File/group | Change |
| --- | --- |
| src/lib/oauthConfig.js | Fixed origin/callback, PKCE options, strict URL parsing, public availability read and dev route |
| src/lib/oauthEntry.js | Early private callback capture/history scrub |
| src/lib/googleOAuth.js | Explicit OAuth/callback/reconciliation controller and origin-wide locking |
| src/lib/supabase.js | PKCE options, early entry import, public provider-availability check |
| src/lib/authController.js | Suspended startup/external-completion generations; existing verification retained |
| src/composables/useQueueAuth.js | OAuth lifecycle, callback gate, storage events and cancellation-aware logout |
| src/components/AuthWorkspace.vue | Single Google entry, neutral shared dashboard and callback states |
| src/components/GoogleAuthCallback.vue | Accessible pending/error/reconciliation/cancel UI |
| src/components/LocalTestLogin.vue | Separated local password test form |
| src/components/QueueApplication.vue | Connect OAuth UI and development-only login surface |
| src/style.css | Scoped maroon/gold Auth styling |
| index.html | no-referrer policy and product title |
| .env.example | Non-secret local URL example and secret-handling guidance |
| README.md | Local routes, tests and setup documentation link |
| tests/frontend/googleOAuth.test.js | Nineteen deterministic/actual-SDK methods |
| tests/frontend/authController.test.js | Two additional external-flow gate/race methods |
| tests/frontend/authWorkspace.test.js | Product/dev separation, shared-dashboard and callback rendering assertions |
| tests/frontend/googleOAuth.browser.mjs | Intercepted real-SDK/browser scenarios; local public monitor check |
| tests/frontend/run_google_auth.py | Strict read-only source/recovery/configuration fences |
| tests/frontend/publicBoard.browser.mjs | Adapt root login selector to the new single Google entry |
| supabase/tests/results/google_auth_frontend_*.json, google_oauth_frontend_*.json/PNG | Sanitized inspection, browser and failed-postflight evidence |
| supabase/LOCAL_GOOGLE_OAUTH_SETUP.md | Prepared local provider/secret/restart procedure |
| supabase/FRONTEND_INTEGRATION_PLAN.md | Current six-version and Google-preparation status |
| supabase/GOOGLE_AUTH_FRONTEND_PHASE_REPORT.md | This report |

dist/ was regenerated as an ignored artifact. Existing SQL migrations, config.toml,
real environment files, dependencies, public display source/contracts, existing
database grants/policies, Auth provider settings, backup archives and Docker volumes
were not modified. No reset, push, link, deployment, Git commit or push occurred.

## Readiness and stop boundary

The frontend flow is implemented and passed deterministic SDK/browser acceptance.
**Real Google testing is not yet authorized or possible with the disabled provider.**
The exact retained-source postflight remains failed and needs review of Realtime's
new empty partition/transient metadata and the appropriate fresh recovery/preservation
inventory before configuration work. No remaining test was marked passed to bypass
that gate. The original strict runner still refuses the changed baseline.

**Stopped after implementation, tests and this report. Awaiting instructions before
provider configuration, source-baseline/recovery changes, administrator designation
or database authorization work.**
