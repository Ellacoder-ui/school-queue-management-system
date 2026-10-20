# Phase 6, Part G — MFA-only activation plan and navigation cleanup

October 19, 2026 (UTC+08). **Ready for separate activation approval.** The retained
adapter, encrypted capture, fresh plan check and disposable activation/rollback passed.
**Retained TOTP remains disabled. No real factor, migration 007 or ADMIN promotion ran.**

## Exact configuration and affected service

Only `supabase_auth_school-queue-local` is eligible for recreation, using cached Auth
2.197.0, image `sha256:1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b`.
Its current ID is `565adceacab15cd43c7e00d5cee19345bc34f6ab981b35d5dc2ba4f8cdd4f399`.
The exact existing image tag is preserved and checked against that digest before
creation; the created container's actual image is checked again before startup.

| Effective Auth entry | Current | Proposed |
| --- | --- | --- |
| `GOTRUE_MFA_TOTP_ENROLL_ENABLED` | `false` | `true` |
| `GOTRUE_MFA_TOTP_VERIFY_ENABLED` | `false` | `true` |

The proposed TOML appends only:

```toml
[auth.mfa.totp]
enroll_enabled = true
verify_enabled = true
```

**Actual config.toml is unchanged.** Google settings, credentials and URLs, nonce/email
validation, JWT/signing keys, database credentials, email policy, image, aliases and
all unrelated container fields must remain exact. PostgreSQL, Kong, REST, Realtime,
Analytics and Vector stay running. Reserve **1–2 minutes** for Auth downtime and
acceptance; this is an allowance, not a measured retained guarantee. The same-image
Auth startup migration check must preserve its existing receipts and application data.

## Fresh reviewed plan — approval still required

| Binding | Value |
| --- | --- |
| Run | `0f6aaa88` |
| Plan SHA-256 | `08e5e9587e570d07afbec2f66f796e3aa2238f1dd8838759312dee89ac778d4a` |
| Expires | **October 19, 18:13:05 UTC+08** |
| Protected rollback capture | `.local-auth-only/0f6aaa88/mfa-review/payload.dpapi` |
| Status | `PASS_PREPARED` and `PASS_PLAN_CHECKED`; no activation approval received |

Preparation privately inspected the current Auth definition, sealed original/candidate
definitions, original/proposed TOML and the preservation baseline, and verified private
read-back. DPAPI CurrentUser, exact user/SYSTEM ACLs, path/profile binding and create-new
writes are reused. No Google credential-store decryption is needed: existing runtime
credentials are preserved inside the encrypted configuration capture. Plaintext exists
in private process memory; profile-loss recovery is not certified.

The plan binds code, all six migration files, source/configuration hashes, immutable
Auth ID, network and project identities, backup inventory and the existing parked
Google-activation original. Unknown resources, changed state/settings/code, wrong
approval or expiry stop execution. Attempts and rollback journals refuse repeats.
There is no automatic retry, rollback, deletion, dependency restart or force option.
The returned hash is a review binding, not user approval.

After explicit approval of this exact plan, use Windows PowerShell 5.1 as the same
Windows user in the project directory. **These activation commands were not run:**

```powershell
$run = '0f6aaa88'
$plan = '08e5e9587e570d07afbec2f66f796e3aa2238f1dd8838759312dee89ac778d4a'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-AuthOnlyMfa.ps1 -CheckPlan -RunId $run -ApprovedPlanSha256 $plan
# Only following explicit approval and a passing fresh check:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-AuthOnlyMfa.ps1 -Activate -RunId $run -ApprovedPlanSha256 $plan -ConfirmMfaAuthOnlyRecreation
```

If expired or changed, run `-Prepare`, review the new receipt/hash and obtain approval
for that new plan. Keep the app signed out during the change window: legitimate new
Auth activity can invalidate the strict preservation check. Do not relax it to pass.

Activation preserves the stopped, detached original and creates one replacement.
Acceptance requires healthy Auth, HTTP 200 through Kong, Google still enabled, both
TOTP flags enabled, anonymous API success and exact unaffected source/service state.
Failure stops; do not retry or roll back automatically. After successful approved
activation, a fresh Vue launcher invocation must rederive the enabled MFA capability;
the existing running frontend is left untouched with MFA unavailable in this task.

## Separately approved rollback

Review the actual replacement ID and rollback hash from the activation/failure receipt:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-AuthOnlyMfa.ps1 -Rollback -RunId '<approved-run>' -ApprovedPlanSha256 '<original-plan-hash>' -ReplacementId '<exact-replacement-id>' -ApprovedRollbackSha256 '<separately-approved-rollback-hash>' -ConfirmMfaAuthOnlyRollback
```

A fresh process reloads the protected capture, checks both exact containers and aliases,
retains the failed replacement, restores the original ID/configuration and TOML, then
requires health and source preservation. Google stays enabled; TOTP returns to false.
No database restore is involved. Expiry alone does not prevent separately approved
rollback; code, identity and state checks still apply. Interrupted operations without
a recorded replacement, or legitimate login/enrollment changes after capture, require
operator review. Do not force old-state equality or remove factors. Both parked
originals retain project labels; later stack operations must account for them explicitly.

## Student navigation cleanup

Removed the Student-only **My workspace**, **Public queue**, **Refresh access** and
header **Public display ↗** controls, plus **Open lobby display ↗** beside its monitor.
**Account security** and Sign out remain accessible. Cashier/admin navigation is
unchanged. Automatic access revalidation, authenticated reads, ticket actions and the
existing Google/PKCE flow remain intact; no shared authentication handler was deleted.

The five service cards, fixed counter bindings, confirmation dialog, single shared
Realtime controller, embedded monitor and desktop sticky rail are preserved. Direct
`/display` works independently. No CSS redesign or new data source/subscription was
introduced. Responsive, keyboard/dialog focus and availability checks passed.

Screenshots: [desktop 1440px](../supabase/tests/results/video_ui_bd271956_SIMULATED_student_1440.png),
[tablet 768px](../supabase/tests/results/video_ui_bd271956_SIMULATED_student_768.png),
[mobile 390px](../supabase/tests/results/video_ui_bd271956_SIMULATED_student_390.png).
Desktop/mobile were visually inspected. Auth/owner tickets are labeled browser fixtures;
the embedded monitor uses real local anonymous data. No fixture data entered production.

## Tests and limits

| Final check | Result |
| --- | --- |
| Frontend unit/view/security methods | **148 passed**, zero failures/skips |
| MFA plan / existing Google workflow / interception methods | **13 / 7 / 15 passed** |
| MFA / existing private-guard Python methods | **3 / 6 passed** |
| Actual Auth/MFA/configuration rehearsal, `654b8795` | **22 checks passed** |
| MFA-enabled Vue/SDK browser, `bd271956` | **22 groups passed** |
| Default OAuth/PKCE + disabled MFA, `23fa81ca` | **20 groups passed** |
| Actual anonymous display/Realtime, `1b78f406` | **15 groups passed** |
| Public-only production build; private-pattern/fixture-canary scans | PASS |
| Syntax, whitespace, preview and missing-confirmation refusal | PASS |

The final disposable run used the retained image-tag form, separate internal network,
cached Auth/PostgreSQL, no published ports or retained mounts. It exercised the complete
review/configuration/replacement workflow, actual installed-SDK TOTP enrollment,
wrong/expired-code rejection, verified AAL2, repeat refusal and fresh-executor rollback
of both container and TOML. An injected exit-42 failure and separately approved rollback
also passed through the shared reconciler. Fixture users, migration receipts and witness
data were preserved. Health/settings returned 200 and Google stayed enabled throughout.
Fixture Google credentials are synthetic: real Google consent/exchange was not tested.

Browser Auth/MFA responses are intercepted; no real factor or identity write is forwarded.
Tests cover current database-context routing, insufficient assurance, session recovery,
logout, revoked access and metadata failing to grant ADMIN. The standalone regression
exercises actual anonymous subscriptions, reconnect/cleanup and 1920/1366/768/390px.
Student checks include five cards, no unwanted links, one live public socket, service
dialog/availability preservation and sticky positioning at 24px after scrolling.

Earlier failures remain separate: a one-millisecond plan-lifetime defect, fixture ACL
initialization, retained image-tag handling, and browser refresh/control timing. They
were corrected without changing acceptance requirements.
An initial navigation assertion also matched monitor copy rather than controls; its
scope was corrected before the final 148-method frontend PASS. The legacy Google plan tests
now use their immutable pre-activation Git configuration rather than today's legitimately
enabled config. Superseded plans remain preserved and are not this approval target.
Final passing repetitions are not added together.

## Files, preservation and remaining steps

New: `scripts/authMfaWorkflow.mjs`, `authMfaCli.mjs`, `auth_mfa_guard.py`,
`tests/security/test_auth_mfa_guard.py`, sanitized evidence and this report.
Updated: `Start-AuthOnlyMfa.ps1`, `authMfaPlan.mjs`, shared `authOnlyRetained.mjs` /
`authOnlyEngine.mjs`, MFA fixture/rehearsal/plan tests and the legacy workflow test.
Frontend changes are limited to `AuthWorkspace.vue`, `StudentDashboard.vue` and their
three affected view/browser tests. The implemented MFA interface was not redesigned.

All **935** existing captured inputs remain; **922** retain their hashes. The 13 changes
are those listed above. Prior modified/untracked work, reports/evidence, config.toml,
migrations, proposed 007, ticket implementation, authentication/security controllers and
the public controller are preserved. Across attempts, **30 disposable containers are
stopped** and six labeled networks retained; no volume was created/deleted or image pulled.
Owned browsers/test servers were stopped; the user's existing frontend remains running.

Fresh read-only checks passed exact project/cluster/network identities, Auth/API health,
Google enabled, both TOTP flags false, all six migrations and fixed routes. There remain
**41 accounts, 41 Auth users, 28 identities, 20 tickets and 57 ticket events**; zero active
work/open day. Strict within-run source/function/service comparisons passed. All **93
backup files** retain digest
`27e6ed58b1fe58031c3a953e2c95cd8d362e869735f598c84577673498905e96`.
Normal scoped public subscriptions remain subject to the existing narrow comparator;
no database-wide immutability or new recovery certification is claimed.

The verified school account remains enabled **STUDENT**, UUID
`b7d9aee8-c54d-455f-9913-a4c4dea0d097`, unchanged Google identity binding and **zero
MFA factors**. After separately approved activation, separately authorize personal
enrollment through Account security. Never send QR keys or codes to the agent.
MFA success must establish AAL2 and refresh current context; it does not assign ADMIN.
Migration 007, identity-bound operator approval and exact UUID-bound promotion remain
separate approvals. Existing backend staff approval/AAL2 gaps remain until that migration
is reviewed/applied; sensitive staff-management controls stay disabled.

Evidence: [final plan/preservation](../supabase/tests/results/auth_mfa_final_plan_0f6aaa88.json),
[actual disposable rehearsal](../supabase/tests/results/auth_mfa_rehearsal_654b8795.json),
[MFA browser](../supabase/tests/results/google_oauth_frontend_bd271956.json),
[default browser](../supabase/tests/results/google_oauth_frontend_23fa81ca.json),
[standalone display](../supabase/tests/results/public_board_1b78f406.json).

**Stop: please explicitly approve plan `0f6aaa88` and its SHA-256 above before one
MFA-only Auth recreation.** No retained MFA activation, real enrollment, database/role
write, migration, unrelated restart, credential change, backup/volume deletion,
deployment, commit or push was performed.
