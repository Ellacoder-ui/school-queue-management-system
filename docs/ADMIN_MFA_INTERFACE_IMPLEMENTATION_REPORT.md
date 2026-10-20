# Phase 6, Part F — MFA interface implementation

October 19, 2026 (UTC+08). **PASS for implementation and disposable verification.**
The Account security interface is functional. **Retained TOTP remains disabled;
no real factor was enrolled, security migration applied or account promoted.**
The completed Student/Payor service cards and embedded monitor were preserved.

## Implemented interface

Signed-in users can open **Account security** from the existing workspace navigation.
It reuses the existing Supabase client, Google/PKCE flow and Auth controller.

- Explicit authenticator-app enrollment, private QR display and optional manual key.
  The QR is rendered locally as an image; no third-party QR service or HTML injection.
- Six-digit code entry, a fresh challenge for each explicit submission, verification,
  loading, cancellation, generic errors and wrong/expired-code handling. Successful
  verification requires AAL2 and the current verified factor, then refreshes the
  existing `getUser`/database-context flow. **MFA never assigns a role.**
- Account/session changes, expiry, timeout, close and tab hiding clear sensitive UI.
  Request scope pins the actor and session so an SDK account switch cannot retarget
  an MFA intent. Interrupted requests are not automatically retried.
- An unfinished setup can be completed if its authenticator was already configured.
  Its QR/key cannot be recovered after closing. A lost setup key requires trusted
  operator review; this interface has no factor-removal or duplicate-setup action.
- Current disabled configuration shows a truthful unavailable panel with no enrollment
  or verification call. `local_frontend.py` derives the nonsecret UI capability from
  private, read-only inspection of the matching healthy local Auth container. The
  browser hint is not an authorization boundary. Auth and PostgreSQL enforce access.

The implementation uses the supported `mfa.enroll`, `listFactors`, `challenge`,
`verify` and `getAuthenticatorAssuranceLevel` APIs.
[Supabase TOTP flow](https://supabase.com/docs/guides/auth/auth-mfa/totp).
The pinned Auth settings endpoint does not expose the two TOTP flags; no fictional
availability API was added.
[Auth 2.197.0 settings](https://github.com/supabase/auth/blob/v2.197.0/internal/api/settings.go).

Setup keys/codes stay in transient UI/controller memory and are cleared from the
display; no new secret/token store, logging, clipboard export or recovery material
was added. The existing SDK continues managing its normal session cache, including
the upgraded session. This is not a claim that session JWTs are absent from that
pre-existing cache or that managed process memory can be securely erased.

Safe screenshots, with simulated Auth and no QR/key/code content:
[unavailable desktop](../supabase/tests/results/video_ui_36549f73_SIMULATED_mfa-unavailable_1440.png),
[verified desktop](../supabase/tests/results/video_ui_7a908283_SIMULATED_mfa-verified_1440.png),
[verified mobile](../supabase/tests/results/video_ui_7a908283_SIMULATED_mfa-verified_390.png).
Desktop/mobile were visually inspected; 1440/768/390px overflow checks passed.

## Security compatibility and configuration rehearsal

The unchanged proposed 007 migration requires the current enabled database staff role,
signed AAL2, a verified factor and an active identity-bound operator approval. It
remains outside `supabase/migrations/`, unapplied, at SHA-256
`b22d63d24c991b9ebf0d380d27a716d5ea72e418f5e62e177c96dded4481222c`.
Enrollment satisfies none of its role/approval requirements by itself. Sensitive
staff-management controls remain disabled; the running backend still has the previously
documented gaps until that proposal is separately approved and applied.

Staff permission denials now clear private data and show restricted access. Repeated
`staff_queue` permission failures do not cause an Auth-refresh loop; an authentication
failure still reconciles access. A successful staff read resets that denial latch.
The SDK's partial `MFA_CHALLENGE_VERIFIED` event now triggers managed-session/user/role
reverification instead of being adopted as a complete session.

The separate **MFA-only** plan changes exactly:

```text
GOTRUE_MFA_TOTP_ENROLL_ENABLED=false -> true
GOTRUE_MFA_TOTP_VERIFY_ENABLED=false -> true
```

Its future TOML supplement is:

```toml
[auth.mfa.totp]
enroll_enabled = true
verify_enabled = true
```

Only a future approved recreation of `supabase_auth_school-queue-local` is contemplated.
Google provider settings/URLs/credentials, JWT/database/email settings, image, aliases
and every unrelated definition field stay exact. No retained configuration changed.
The Google-only helper was not reused or bypassed for this delta.

New `authMfaPlan.mjs` provides strict comparison, code/target/approval binding,
create-new journals and protected DPAPI original/candidate/TOML captures for the
**disposable-only** executor. The rehearsal exercised real cached Auth 2.197.0 and
PostgreSQL: disabled enrollment refusal, replacement, actual installed-SDK enrollment,
wrong/expired-code refusal, AAL2 verification, duplicate rejection, separately bound
fresh-executor rollback and exit-42 failure rollback. Google stayed enabled throughout.
No synthetic event or account reached retained Auth.

**Retained MFA execution remains unconditionally locked.** Safe status preview:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-AuthOnlyMfa.ps1 -Preview
```

`-Activate` and `-Rollback` refuse with `AMF_RETAINED_EXECUTION_LOCKED`. There is no
current command that enables retained MFA. A retained adapter, fresh encrypted capture,
source/target/configuration checks and concrete approval still require separate review.
After eventual activation, a fresh frontend launch/build derives the enabled capability;
the user's current frontend was left running with MFA unavailable.

## Completed tests and limits

| Check | Result |
| --- | --- |
| Frontend tests | **146 passed**, zero failures/skips |
| Separate MFA-plan / Python capability methods | **5 / 3 passed** |
| Browser interception policy | **15 passed** |
| MFA-enabled intercepted Vue/SDK regression, `7a908283` | **22 groups passed** |
| Default Google/PKCE and disabled-MFA regression, `36549f73` | **20 groups passed** |
| Actual Auth/TOTP/configuration/rollback rehearsal, `d0c8916e` | **19 checks passed** |
| Isolated staff-security proposal, `de8cdb04` | **21 groups passed**, plus **123 existing SQL checks** |
| Actual anonymous public-display regression, `5edcab5f` | **15 groups passed** |
| Production build, known local private-key and fixture-canary scans | PASS |
| Syntax, PowerShell preview and whitespace checks | PASS |

Browser Auth/MFA responses are intercepted; no real Google or factor write is forwarded.
QR/manual display is inspected in memory, never captured in screenshots; failure
screenshots redact the MFA panel. Actual TOTP protocol acceptance uses a separate
synthetic Auth fixture. Staff-policy tests use real PostgreSQL/PostgREST with synthetic
signed JWTs/factor rows. These establish separate API and authorization coverage,
not a completed real Google → TOTP → approved ADMIN acceptance flow.

Earlier FAIL evidence remains: the fixture SDK/direct-Auth path mismatch, an abandoned
unfinished-factor-removal test's CORS omission, and the partial MFA-event defect fixed
above. One full unit run had 145/146 passes because an old test assumed its asynchronous
context request existed after 5ms; it now waits for the observable pending request.
The final 146-method run passed. A browser rerun was temporarily not executed because
automatic approval review hit a usage limit; a later normal approval retry succeeded.
No failed evidence was overwritten or promoted to PASS.

Evidence: [real Auth rehearsal](../supabase/tests/results/auth_mfa_rehearsal_d0c8916e.json),
[MFA browser](../supabase/tests/results/google_oauth_frontend_7a908283.json),
[default browser](../supabase/tests/results/google_oauth_frontend_36549f73.json),
[staff authorization](../tests/integration/results/admin_security_de8cdb04.json),
[public display](../supabase/tests/results/public_board_5edcab5f.json),
[retained read-only check](../supabase/tests/results/retained_mfa_readiness_3297e1f0.json).

## Files and retained preservation

New interface files: `AccountMfaDialog.vue`, `useAccountMfa.js`, `accountMfa.js` and
`mfaRequestPolicy.js`. Existing Auth composition/controller, local fetch, queue API,
workspace reader, styles and related tests were updated in place. No second Auth flow
or client was introduced.

New preparation files: `Start-AuthOnlyMfa.ps1`, `authMfaPlan.mjs`,
`auth_mfa_capability.py`; the public-only launcher now supplies the verified capability.
New tests: `accountMfa.test.js`, `authMfaPlan.unit.mjs`,
`test_auth_mfa_capability.py`, `authMfaFixture.mjs`, `rehearse_auth_mfa.mjs` and the
fixed read-only `check_mfa_readiness.mjs`.

All **806 captured pre-existing inputs remain; 793 retain their hashes**. The 13
intended changes are the existing frontend/launcher/test files described above.
StudentDashboard.vue, the monitor/controller, ticket-action implementation, Google
OAuth/callback modules, config.toml, all six migration files, proposed 007, prior
reports/evidence, dependencies and existing credential/activation helpers are unchanged.

The read-only check verified healthy retained Auth, HTTP **200** for Auth/settings/API,
Google enabled, both TOTP flags false and proposed approval storage absent. The exact
school UUID **`b7d9aee8-c54d-455f-9913-a4c4dea0d097`** remains an enabled **STUDENT**,
with the same reviewed Google identity binding and **zero MFA factors**. School email
domain is never an authorization rule. Retained row/function/service preservation and
exact Docker resource accounting passed around both isolated backend suites.

Across completed and failed attempts, **14 new disposable containers are stopped**;
four labeled test networks remain. No volume was created/deleted or image pulled.
Owned test browsers/servers were stopped. Backups and the Google DPAPI store were not
opened or changed. Private runtime inspection was used only for configuration checks.
No retained SQL write, service restart, real enrollment, promotion, queue operation,
deployment, Git commit or push occurred.

## Remaining approvals and real enrollment

1. Review the separate retained MFA adapter/plan and fresh protected rollback capture;
   explicitly approve the two Auth flags/TOML changes and brief Auth-only recreation.
   Preserve Google and all unrelated settings; require health and source acceptance.
2. Separately authorize the school user's real MFA side effects. Personally sign in
   through the existing Google flow, open Account security, start setup, scan the QR
   on your authenticator and enter its current code in the app. Do not send the key
   or code to the agent. Verification must return AAL2 and refresh current DB context;
   the account remains STUDENT at this point.
3. Review/apply 007 only after separate approval and its applicable safeguards. Its
   impact on every existing privileged account must be accepted. Sensitive controls
   remain disabled until backend protection and operator approvals are in place.
4. Freshly reverify the exact school UUID/email/Google binding and enrolled factor.
   Separately approve the identity-bound staff review and STUDENT-to-ADMIN operator
   transaction in the [existing preparation report](EMBEDDED_QUEUE_AND_ADMIN_SETUP_REPORT.md).
   No frontend service-role key or email-only promotion is permitted.
5. Only then test the actual ADMIN dashboard with current AAL2 and approval, including
   expiry/revocation/denial. Real device enrollment, live session behavior and combined
   privileged acceptance remain unperformed.

**Stopped after interface implementation, disposable testing and preparation.
No MFA activation, retained migration or ADMIN promotion is initiated by this report.**
