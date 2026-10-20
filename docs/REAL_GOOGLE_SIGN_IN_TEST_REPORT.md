# Phase 5 - real Google Sign-In test

October 19, 2026 (UTC+08). **PASS for both user-controlled real Google logins and
correct STUDENT dashboard routing.** Database roles and Google identities were
independently verified. School refresh recovery/logout and the loaded dashboard's
clean address were explicitly confirmed by the user. Network-level limitations
and untested coverage are recorded below; this is not privileged production acceptance.

## Account and browser results

| Check | Result and evidence source |
| --- | --- |
| Personal Gmail: ellasharmaineabeso2004@gmail.com | **PASS:** user-controlled Google selection and Student/payor dashboard observed in the recording; enabled STUDENT and one Google identity independently verified |
| School: eabeso63122@liceo.edu.ph | **PASS:** user explicitly confirmed selecting this account and reaching Student/payor; enabled STUDENT and one Google identity independently verified |
| Personal refresh recovery | **PASS:** user reported dashboard restoration without another sign-in |
| School refresh recovery | **PASS:** user explicitly confirmed Student/payor returned |
| School Sign out followed by reload | **PASS:** user explicitly confirmed the login screen remained and the private dashboard did not return |
| Personal sign-out | Success and return to login observed in the recording; a separate personal-account post-logout reload was not explicitly confirmed |
| Loaded dashboard URL | **PASS by user confirmation:** neither `?` nor `#` remains; no URL values were requested |
| Refresh presentation | User confirmed a brief **Verifying account access** screen; this is the intended loading state before authorization completes |
| Unauthorized anonymous context request | Read-only `queue_api.my_context` request denied with **HTTP 401** |

Both accounts were absent from the local Auth/application baseline. The existing
provisioning trigger created ordinary STUDENT accounts. Neither account had a prior
ADMIN/CASHIER authorization to preserve. School domains, Google metadata and browser
input grant no privileged role. No account was promoted or assigned to a counter.

No consent or Workspace-policy block was reported for either successful attempt.
This does not establish policy for every school account. No additional test identity
was created by the agent.

## PKCE, callback and session behavior

The existing single Auth flow uses PKCE/S256, manually exchanges the callback code,
scrubs callback input before SDK initialization, verifies `getUser`, then retrieves
current `queue_api.my_context` before choosing the workspace. Real Google identities,
user/video observations and independently verified database roles agree with the
reported dashboards. Loaded-address cleanup and school session recovery/logout are
user-confirmed.

**Individual real browser `getUser`/`my_context` HTTP responses, the exact real PKCE
exchange count and the intermediate callback redirect were not captured.** Those
controls passed the existing intercepted Vue/SDK regressions; simulated responses
are not counted as real Google network observations. Account switching, cancellation,
expired/missing verifiers and disabled/privileged contexts have synthetic coverage,
not newly completed live acceptance with the two real accounts. No privileged
real-account dashboard was tested or needed for these new STUDENT accounts.

Browser-control runtimes failed initialization with OS error 3, so Google selection
and authentication were performed personally by the user in their normal browser.
No passwords, verification codes, access/refresh tokens or HAR exports were requested.
Private Auth rows were reduced to counts and hashes inside PostgreSQL; tokens and
raw diagnostics were not written to public evidence.

## Recording and refresh correction

Reviewed `Recording 2026-10-19 111157.mp4` locally: **54.67 seconds**, 1918 x 1092.
Approximately 0-5 seconds show Continue with Google, the real account chooser and
return to the app. Student/payor is visible by about 6 seconds. Service browsing and
a disabled confirmation are shown; no ticket issuance is shown. At about 52-54 seconds,
the user confirms Sign out and the login screen reports success.

The recording predates the refresh correction. The login layout was rendered during
`initializing`/`checking`, producing the reported flash. `AuthWorkspace.vue` now renders
a neutral branded pending screen until session/user and database-role checks finish.
It exposes neither the Google entry nor a private dashboard during verification.
The user subsequently confirmed **Verifying account access** appears briefly, which
is the intended state. No authorization check was removed or replaced by a local
session hint.

The recording initially left URL interpretation uncertain. Local OCR emitted only
fixed categories/parameter names; extracted images omit the address bar. The user's
subsequent explicit confirmation of no `?` or `#` resolves the loaded-address check.
The exact earlier fragment and its cause were not established. No leaked token is
inferred, and the original video was not changed.

Two new view regressions reproduced the old presentation before the fix. Afterward:

| Validation | Result |
| --- | --- |
| Frontend methods | **115 passed**, zero failures/skips |
| Intercepted Vue/SDK browser groups, run fb710665 | **18 passed**, zero failures; no real Auth writes forwarded |
| Public-only production build and known local private-key scan | PASS |
| Loading view at 1440/768/390px; mobile visual inspection | PASS |
| Syntax/whitespace checks | PASS |

The browser reload regression delays `getUser` and `my_context` separately and observes
DOM mutations: the login screen must never appear, and the dashboard must wait for
current database authorization. These tests were not rerun merely to record later
manual confirmations. [Browser evidence](../supabase/tests/results/google_oauth_frontend_fb710665.json),
[loading view](../supabase/tests/results/video_ui_fb710665_SIMULATED_session-loading_390.png).

## Final read-only preservation and legitimate Auth changes

The final checkpoint completed **11:51:37 UTC+08** against the exact local project,
PostgreSQL **17.11**, cluster **7696959712798593061**, original database volume and
activated canonical Auth container. Auth through Kong and anonymous API reads returned
**200**; Google remained enabled.

- All **39 pre-existing account rows/roles** and **14 other application/public table
  fingerprints** matched the Phase 5 baseline. Cashier assignments and queue history
  remained exact: **20 tickets, 57 events, 69 replay receipts, 32 application audits,
  seven historical days, four assignments; zero active tickets/open days**.
- Six application migration/file checks, **82 Auth migration receipts**, five fixed
  routes, cluster roles, all 15 application RLS controls, private-schema denial and
  the two-table application publication passed preservation checks.
- Unrelated Auth user/identity/session/refresh/audit rows matched their baseline hashes.
  Accounts/Auth users increased **39 to 41**, identities **26 to 28**, exactly the two
  permitted test accounts. Session and refresh-token totals were **37** each versus
  **35** at baseline; Auth audit entries were **123** versus **104**. No flow-state
  row remained. These are point-in-time normal-auth observations, not attribution
  of every audit event or proof of browser access from session-row presence alone.
- All project service IDs/non-Vector lifecycles matched. Vector's existing automatic
  restart loop remains separate; no service operation was issued. No Google
  configuration, role, assignment or queue write was performed by the agent.

The earlier personal checkpoint separately validated an added empty
`realtime.messages_2026_10_22` against the unchanged reviewed template/date/security
rule. The full catalog hash therefore differed from baseline. No DDL was issued,
no classifier was changed and no database-wide catalog immutability is claimed.
Historical recovery PASS/pruning FAIL evidence was not edited or reclassified.

All **641** frozen pre-existing input files remain; **637** retain their hashes.
Only `src/components/AuthWorkspace.vue`, `src/workspace.css`,
`tests/frontend/authWorkspace.test.js` and `tests/frontend/googleOAuth.browser.mjs`
changed for the authorized refresh correction. Existing modified/untracked work
was preserved. New sanitized evidence, ignored media-review artifacts and this
report are additional files. Google DPAPI storage and backups were not opened or
modified; no volume deletion, deployment, Git commit or push occurred.

## Evidence, limits and stop

- [Initial baseline c1fb4e82](../supabase/tests/results/real_google_sign_in_c1fb4e82_baseline.json)
- [Personal checkpoint](../supabase/tests/results/real_google_sign_in_c1fb4e82_personal.json)
- [Recording follow-up d3f43d8c](../supabase/tests/results/real_google_sign_in_c1fb4e82_video_d3f43d8c.json)
- [School checkpoint c819e1d6](../supabase/tests/results/real_google_sign_in_c1fb4e82_school_c819e1d6.json)
- [Final preservation 7707ebe5](../supabase/tests/results/real_google_sign_in_c1fb4e82_final_7707ebe5.json)

The separate personal post-logout reload and real network-level request counts remain
unobserved; they are not promoted to PASS. School logout/reload supplies the completed
live logout/access-denial test. Sensitive staff-management UI remains disabled;
previously documented staff approval/AAL2 and cashier AAL2 enforcement gaps remain.
Google login does not resolve those protections or authorize privileged deployment.

**Core real Google login testing is complete within the recorded scope. Both accounts
correctly reach STUDENT; no login or role-routing blocker remains for these accounts.**
The local frontend is left running for the user's existing workspace. Stop here:
no queue operations, role changes, infrastructure changes or further identity tests
are initiated by this report.
