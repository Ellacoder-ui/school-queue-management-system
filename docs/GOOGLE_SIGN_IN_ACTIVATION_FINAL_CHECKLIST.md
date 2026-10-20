# Phase 4 — Google Sign-In activation checklist

October 19, 2026 (UTC+08). **Ready for separate Auth-only activation approval.**
Implementation, fresh read-only plan verification and disposable rehearsal passed.
**Retained Google is still disabled. No retained service or record was changed.**

## Readiness and scope

- Final rehearsal `030185c5`, **02:58:47–03:00:10**: **30 offline methods and 37
  Windows/Docker checks passed**, zero failures/skips. Real cached Auth 2.197.0 ran
  against an isolated PostgreSQL fixture: Google false → true → false, exact JWT/DB/
  email/MFA/alias preservation, fresh-executor rollback, exit-42 startup failure,
  duplicate rejection and encrypted-storage/privacy checks. All 75 fixture Auth
  migration receipts, zero fixture users and witness rows remained exact.
- **113 frontend tests and 18 intercepted browser groups passed.** Existing PKCE,
  callback scrubbing, single exchange, verified `getUser` and current `my_context`
  select the student/cashier/admin workspace. No frontend rewrite was needed.
  These Auth responses are simulated; real Google acceptance remains untested.
- Current Auth health/settings and anonymous API reads returned **200**, Google
  **false**. Retained data/security, six migrations/routes, eleven non-Vector
  lifecycles, all service definitions and **93 backup files** were preserved.
  Historical recovery PASS/live pruning FAIL remain unchanged.

**Only `supabase_auth_school-queue-local` will be recreated**, using its exact cached
image and canonical aliases. PostgreSQL, Kong, REST, Realtime, Vector and Analytics
remain running. Vector is outside the OAuth request path; full-stack health is not
being declared healthy. This is a custom guarded Docker workflow using the
[documented Auth environment model](https://supabase.com/docs/guides/self-hosting/self-hosted-oauth),
not a new Supabase CLI Auth-only command.

## Exact authorized configuration proposal

Activation changes only these eight effective Auth environment entries:

| Entry | Value |
| --- | --- |
| `GOTRUE_SITE_URL` | `http://127.0.0.1:5173` |
| `GOTRUE_URI_ALLOW_LIST` | `http://127.0.0.1:5173/auth/callback` |
| `GOTRUE_EXTERNAL_GOOGLE_ENABLED` | `true` |
| `GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID` | Private existing DPAPI value |
| `GOTRUE_EXTERNAL_GOOGLE_SECRET` | Private existing DPAPI value |
| `GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI` | `http://127.0.0.1:54321/auth/v1/callback` |
| `GOTRUE_EXTERNAL_GOOGLE_SKIP_NONCE_CHECK` | `false` |
| `GOTRUE_EXTERNAL_GOOGLE_EMAIL_OPTIONAL` | `false` |

The exact nonsecret TOML proposal is mirrored into `supabase/config.toml` during
approved activation, with `env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)` and
`env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET)` references. Signup stays enabled;
anonymous sign-in and manual linking stay disabled. All unrelated settings, database
credentials, JWT/signing keys, image and container/network definition stay exact.
**Actual config.toml remains unchanged in this phase.**

## Secure activation — future approval only

1. Approve one Auth-only recreation, its brief downtime, private production DPAPI
   read and exact TOML/environment delta. Real login writes require separate scope.
2. Use Windows PowerShell 5.1 as the same Windows user in the project directory.
   Prepare/check a fresh plan; neither command activates Google:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-AuthOnlyGoogle.ps1 -Prepare
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-AuthOnlyGoogle.ps1 -CheckPlan -RunId '<run-id>' -ApprovedPlanSha256 '<plan-sha256>'
   ```

3. Review the nonsecret receipt and exact plan hash. Plans expire after one hour;
   changed source/resources/configuration/code or credential metadata require a new
   review. A returned hash is a review binding, **not user approval**. Only after
   explicit approval run:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-AuthOnlyGoogle.ps1 -Activate -RunId '<approved-run-id>' -ApprovedPlanSha256 '<approved-plan-sha256>' -ConfirmAuthOnlyRecreation
   ```

Preparation encrypts original inspect/create configuration, original/proposed TOML
and preservation baseline under `.local-auth-only/<run-id>/review/`. Activation
privately reads DPAPI credentials only after approval/freshness checks, seals the
exact candidate, rechecks, changes TOML, then stops/renames/detaches only original
Auth and creates/starts its replacement. It retains the stopped original and journals.
No secret enters arguments, Vite or plaintext project files. DPAPI is user/profile/
path-bound; Docker administrators can inspect a running container's environment.

Reserve **1–2 minutes** for the short Auth outage and acceptance; this is an operator
allowance, not a measured retained bound. Final fixture replacement acceptance took
**3.18 seconds**. Retained health scheduling and Kong DNS convergence remain untested.
Require healthy Auth, gateway health/settings with Google=true, anonymous API success,
unchanged migration/data/security state, keys and all unaffected services. Health
polling is bounded; failures stop without dependency restarts or mutation retries.

## Rollback

Review and separately approve the exact replacement ID and rollback hash printed by
activation or its failure receipt. The following restores the retained original
Auth ID/definition/aliases and original TOML; Google becomes false:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-AuthOnlyGoogle.ps1 -Rollback -RunId '<run-id>' -ApprovedPlanSha256 '<original-plan-sha256>' -ReplacementId '<replacement-id>' -ApprovedRollbackSha256 '<separately-approved-rollback-sha256>' -ConfirmAuthOnlyRollback
```

Rollback reloads the encrypted capture in a new process, retains the failed
replacement and verifies original health/source preservation. It never restores a
database dump or removes users/history. An interrupted operation without a recorded
replacement, changed objects/code, or legitimate Auth writes after real login needs
operator review; do not rerun activation or force old-state equality. Both original
and failed containers keep their labels. Future full-stack CLI operations/cleanup
remain separately reviewed work; the extra project container is not silently ignored.

## Roles, remaining protections and real login tests

New ordinary Auth users are provisioned as **STUDENT** by the existing database
trigger. Existing verified database roles/assignments determine access. Google email
domain, metadata and browser input never promote ADMIN/CASHIER; disabled access
clears the workspace. No role or grant was changed.

**Protection gap:** current staff administration RPCs do not enforce the planned AAL2
or complete approval workflow. Cashier operation authorization also does not enforce
an AAL2 requirement. Sensitive staff-management UI remains disabled. Google login
does not complete these protections; privileged production acceptance requires that
separate work. Do not promote accounts or expose management controls for this test.

After activation acceptance, separately authorize user-controlled Auth/session/account
creation or automatic identity-linking effects, then test:

- Personal and school test accounts: consent/Workspace policy, exact callback chain,
  one PKCE exchange, scrubbed callback, `getUser` and current database context.
  New ordinary accounts must reach STUDENT; inspect linking for an existing email
  without creating duplicate application accounts or changing its authorized role.
- Cancellation, denied/expired consent, missing verifier, reload/repeated callback,
  login/logout and account switch; errors stay generic and grant no stale access.
- Approved existing staff/disabled accounts: correct database-authorized workspace,
  assignments and denial behavior. No staff promotion or queue mutation is part of
  the Google login test authorization. Real credential validity and gateway/session
  behavior can only be accepted in this later live flow.

## Evidence and preservation

[Final rehearsal](../supabase/tests/results/auth_only_readiness_030185c5.json),
[37 disposable checks](../supabase/tests/results/auth_only_disposable_030185c5.json),
[intercepted browser acceptance](../supabase/tests/results/google_oauth_frontend_c928012c.json).
Fresh retained preparation/check passed for `6fc25b88`; its
[review receipt](../supabase/tests/results/auth_only_final_plan_6fc25b88.json) expires
**October 19, 04:00:46 UTC+08** and is not authorization to execute.

Earlier test evidence remains separate: a default network-pool failure created no
resource; subsequent fixtures used checked non-overlapping internal /24s. Initial
discovery and int64 transport defects were fixed and tested without relaxing the
source comparator. PostgreSQL int64 metadata now crosses JavaScript as a bounded,
opaque lossless snapshot. Historical reports/evidence were not edited.

All existing modified/untracked frontend work was preserved. Only seven existing
Auth-helper/test files changed; five new workflow/guard/test files and this checklist
were added, plus new evidence. All **596** initial input files remain; **589** retain
their hashes. This task's **18 disposable containers are stopped**, three test networks
are retained, and no volume was created/deleted. No real Google credential was opened,
retained service operation or SQL write ran, and no commit, push or deployment occurred.

**Stop: implementation/rehearsal complete. Explicit approval is still required before
changing retained Auth; real Google login remains a subsequent authorized test.**
