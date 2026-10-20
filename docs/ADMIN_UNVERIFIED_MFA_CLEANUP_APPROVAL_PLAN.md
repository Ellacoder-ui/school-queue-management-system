# One unverified TOTP factor — cleanup approval plan

October 20, 2026 (UTC+08), branch **backend**. **Preparation and isolated tests PASS.**
The real factor is still present and unverified. **No real cleanup or enrollment
was performed. Separate explicit approval is required before the owner confirms
the removal described below.**

## Exact local target and sanitized inventory

Fresh checks used the existing PostgreSQL client with repeatable-read **READ ONLY**
transactions over the actual loopback TCP endpoint. Initial inspection completed
**04:12:22**; final preservation inspection completed **04:19:03 UTC+08**.

| Binding | Verified value |
| --- | --- |
| Workspace / branch | `C:\Users\Hp\school-queue-management-system` / `backend` |
| Project / network | `school-queue-local` / `supabase_network_school-queue-local` |
| Client host / port / database | **127.0.0.1 / 54322 / postgres** |
| Server / cluster | PostgreSQL **17.11** / **7696959712798593061** |
| Database container | `16f1de8f80f73115d5792cb395f6680ed2d73135b156d6311a31c96765d540b9`; original retained volume |
| Auth container | `supabase_auth_school-queue-local`, ID `5c57bce94c516ec320f259e94ebaf2d348598b6c26e7e2d979c719a8381992ae`; Auth **2.197.0** |
| Intended owner | `ellasharmaineabeso2004@gmail.com` |
| Immutable Auth/application UUID | **`5c96debb-697f-4cad-805f-92b518e28343`**, equal in both tables |
| Current application access | **ADMIN, enabled**; confirmed nonanonymous Auth user |
| Google identity | One; verified matching email and provider subject/ID binding |
| Factor inventory for this UUID | **One total: TOTP, unverified; zero verified factors** |
| Selected factor identifier | **…`c1fc9a6f`**; full UUID intentionally omitted |
| Factor created / last updated | **October 19, 20:28:07.613277 UTC+08**, equal timestamps |
| Selected factor challenges / associated sessions | **0 / 0** |
| Owner staff assignments / active tickets | **0 / 0** |
| Health | Auth/settings/anonymous API **HTTP 200**; Google and TOTP enabled |

The server's internal port is 5432 behind the verified Docker mapping; the client
connected to **127.0.0.1:54322**. No production or remote endpoint was used.

The unchanged Google identity-binding SHA-256 is:

`0fa3fe400dbd117642d5cb7eb89bfed7471e6ef447e59bfc8ac8426001e39701`

The **factor review binding** is:

`6d4ce8ad136ebfd9fb70e659691764b77cdffbc8fe9b984e02ad3219e8987bf9`

The latter hashes the canonical PostgreSQL JSONB object containing the full immutable
user/factor UUIDs, type, status and creation/update timestamps. It contains no setup
secret. The suffix is a display aid; **the full UUID and matching hash must select
the operation**, never a suffix, friendly name or submitted email alone. Full factor
IDs and Google subjects are absent from this report and its public evidence.

The school account `eabeso63122@liceo.edu.ph` remains enabled STUDENT. It is outside
this cleanup scope. [Initial inspection](../tests/integration/results/unverified_mfa_baseline.json),
[final inspection](../tests/integration/results/unverified_mfa_closeout.json).

## Supported method and existing interface

**Prefer the owner's existing Account security interface**, after trusted review and
separate approval. It calls the installed SDK's supported
`supabase.auth.mfa.unenroll({ factorId: reviewedFullFactorId })`, which sends one
authenticated `DELETE /auth/v1/factors/<reviewed-full-UUID>`. The owner can remove an
unverified factor at AAL1. Verified-factor removal requires AAL2; this plan excludes
verified factors entirely. [Supabase unenroll reference](https://supabase.com/docs/reference/javascript/auth-mfa-unenroll).

The running version loads the factor by both authenticated owner and factor UUID;
another user's ID is rejected. [Pinned ownership check](https://github.com/supabase/auth/blob/v2.197.0/internal/api/admin.go#L67).
An application ADMIN role does not make a browser session an Auth administrative
credential. The supported server-only `auth.admin.mfa.deleteFactor({userId,id})`
also exists, but its broader authority is unnecessary here and is **not the proposed
operation**. No service-role credential or direct `auth.mfa_factors` SQL deletion is
needed. [Admin API reference](https://supabase.com/docs/reference/javascript/auth-admin-deletefactor).

`AccountMfaDialog.vue` already offers **I never scanned it — review discard**, then
**Keep setup** / **Discard only this unfinished setup**. The controller rechecks
server `getUser`, current factor inventory and assurance, pins actor/session and the
outgoing request to AAL1, and requires explicit confirmation. A verified factor,
changed account/session, unknown factor or failed check stops the action. It does
not enroll a replacement automatically. These existing product files were inspected
and left unchanged.

## Future execution — separate approval only

1. Approve **one owner-initiated removal**, bound to the personal UUID and both hashes
   above, with the selected factor still **TOTP/unverified**. Include normal Auth
   audit effects; separately scope any needed user-controlled Google sign-in. This
   preparation request supplies no execution approval.
2. Use a quiet window: one owner-controlled local-app tab, no MFA operations in
   another tab/device, and no pending enrollment/challenge/verification. Do not scan
   or verify the old setup. Stop if concurrent activity cannot be ruled out.
3. Run fresh trusted loopback READ ONLY verification of the same endpoint, cluster,
   Auth container, owner UUID/Google binding, enabled ADMIN state, and **exactly one
   total factor**, whose full UUID/hash/type/status/timestamps match this review.
   Require zero verified factors, associated sessions and challenges. Any difference
   requires a new review; never choose another factor automatically.
4. In the owner's already verified personal-account session, open Account security.
   Server `getUser` must identify the exact personal UUID. Require AAL1 and the same
   sole unfinished factor. Compare the confirmation's full factor ID privately with
   the reviewed row; do not copy it or any session material into evidence.
5. The owner chooses **I never scanned it — review discard**, checks the confirmation,
   then chooses **Discard only this unfinished setup** **once**. No agent login,
   privileged frontend code, console token export or bulk-factor action is involved.
6. Require the returned ID to equal the reviewed ID, then perform the postchecks
   below. Stop after cleanup verification. Fresh personal enrollment is a later,
   separately authorized action.

**Concurrency limitation:** the supported request has no conditional-status/version
argument. In pinned Auth, ownership/status are read before deletion; they are not an
atomic compare-and-delete condition. Session assurance is also loaded from server
session state. The browser's AAL1 pin prevents client session substitution; it does
not serialize independent verification requests. Therefore this plan is suitable
only for the quiet window above. If another enrollment, status change or verification
appears, **cancel and re-review**, including when the factor has become verified.
Do not switch to an admin override or weaken AAL2. No general race-proof guarantee
is claimed. [Pinned unenrollment](https://github.com/supabase/auth/blob/v2.197.0/internal/api/mfa.go#L950),
[session loading](https://github.com/supabase/auth/blob/v2.197.0/internal/api/auth.go#L108),
[session assurance](https://github.com/supabase/auth/blob/v2.197.0/internal/models/sessions.go#L383).

## Expected changes, reconciliation and recovery

For the reviewed state, successful cleanup removes **one** factor and records Auth's
normal unenrollment audit. Factor-owned challenges cascade if present; the approved
precondition here is zero. Auth's handler also downgrades sessions associated with
the removed factor; this row currently has **none**, so no such session change is
expected. It does not delete the Auth user, Google identity or application account,
and does not change ADMIN, school STUDENT, assignments or queue records.
[Pinned transaction and session handling](https://github.com/supabase/auth/blob/v2.197.0/internal/api/mfa.go#L966).

The unenrollment-notification flag is not explicitly set in current Auth; the pinned
default is false. No notification email is expected without a configuration change.
Recheck that setting before execution. [Pinned notification default](https://github.com/supabase/auth/blob/v2.197.0/internal/conf/configuration.go#L492).

- There is **no request-key receipt contract**. A second DELETE of the absent ID
  returns `404 / mfa_factor_not_found` in the fixture; that is not a replay receipt.
  Do not automatically retry after timeout, disconnection or malformed response.
- For an unknown result, stop all MFA writes. Reopen Account security for read-only
  inventory and have the operator query the **exact reviewed UUID**, then compare
  other factors and preservation fingerprints. Absence establishes current state,
  not proof that a particular lost response succeeded. If still present and exact,
  a new explicit attempt needs confirmation; if changed/verified, stop for review.
- On 401/session expiry, recover sign-in personally before any new review. On 403,
  insufficient assurance, 429 or server error, stop; never escalate credentials or
  try another factor. No automatic rollback or Auth restart is proposed.
- A deleted enrollment cannot be meaningfully restored with its old QR/key through
  the owner API. Do not restore a database dump or copy secret material back. Once
  absence and preservation are confirmed, separately authorize a fresh setup.

Postcleanup reads must verify: the reviewed ID is absent and owner factor count is
zero; `getUser` still returns the exact owner; current assurance remains AAL1; the
Auth user/Google binding and enabled ADMIN application row remain; all unrelated
factors, account roles, assignments, queue/history/request rows, functions, grants
and six migration receipts match the immediate pre-operation baseline. Read only
`id/user_id/type/status` and counts or server-computed hashes, never `secret` values.
Use existing `listFactors()` and trusted READ ONLY SQL; do not use enrollment as an
absence check. Legitimate login/refresh and unenrollment audit effects need explicit
accounting rather than forcing the old whole-Auth fingerprint to match.

## Synthetic acceptance and preservation

| Test group | Result |
| --- | --- |
| Existing MFA controller/transport/privacy tests | **26 passed**, zero failures/skips |
| Actual Auth + installed SDK + application cleanup controller, `eb84d6b2` | **21 checks passed** |
| Fresh retained loopback/account/factor inspection and closeout | **PASS**, exact within-task hashes |
| Syntax, whitespace, existing input hashes and Docker resource checks | **PASS** |

The disposable test used cached Auth **2.197.0** and PostgreSQL **17.11**, a separate
internal network, no host ports, no retained mounts and tmpfs data. It applied the
unchanged six application migrations **only there**, provisioned synthetic accounts
and gave its synthetic owner ADMIN through the existing fixture bootstrap. It tested:

- Wrong-owner `404`, unlisted-ID and cancellation rejection.
- Exactly one selected unverified factor removed; the same owner's other unfinished
  factor and another user's verified factor remained byte-for-byte fingerprint matches.
- Only the selected factor's challenge cascaded; users stayed active and actual
  application account rows/roles and identity fingerprints survived.
- Repeated absent-ID rejection; a lost successful response interrupted the controller,
  with one DELETE and explicit read reconciliation instead of automatic replay.
- Explicit fresh enrollment, authentic QR handling in memory, expired-code refusal,
  verified TOTP/AAL2, unchanged ADMIN role and surviving Auth migration receipts.
- Verified-factor rejection by the cleanup interface at AAL2, and by actual Auth
  from an AAL1 session (`422 / insufficient_aal`). This does not claim Supabase
  forbids its separately authorized, normal AAL2 verified-factor removal feature.

[Actual synthetic receipt](../supabase/tests/results/unverified_mfa_cleanup_eb84d6b2.json),
[validation and preservation receipt](../tests/integration/results/unverified_mfa_validation.json).
No real Google/TOTP acceptance or simultaneous server race was executed. Existing
unit tests separately cover a status/session change before sending. No frontend
implementation changed, so unrelated browser/build suites were not repeated.

Earlier failed receipts remain separate: `ef48f97d` / `ee2a66b1` hit an existing
fixture platform-object conflict; `ed29c352` / `ec31e4c3` exposed an observer installed
after the SDK had captured its fetch. The synthetic deletion itself succeeded in
those latter attempts, but their request-count assertion failed. The harness now
installs observation and the production request guard before client construction.
No acceptance condition was waived or failed evidence overwritten. The initial
read-only inspector also stopped on a mistaken ticket-column name; its corrected
query uses the existing `owner_id` and passed without any database change.

All **2,340** captured pre-existing inputs retain their hashes. Added only this plan,
`tests/security/inspectUnverifiedMfa.py`, `unverifiedMfaCleanup.integration.mjs`,
sanitized receipts and ignored hash-review artifacts. Across five attempts, **15
owned disposable containers are stopped**; their **five labeled internal networks**
remain. Exact resource checks found no volume creation/deletion or unrelated resource
change. No image was pulled. Retained service definitions/lifecycles were preserved,
apart from the existing Vector automatic restart allowance; no operator restart ran.

Final retained comparisons preserved every application/public table, Auth user,
identity, factor, challenge, session, refresh, AMR and audit fingerprint sampled by
the fixed inspector, plus function/ACL/security and migration hashes. There remain
**42 accounts, 20 tickets, 57 events, four assignments and six migrations**, with
the same five fixed routes. 007/012 remain absent. This is a scoped preservation
result, not a database-wide immutability or production-readiness certification.
Backups and Google credential storage were not opened or changed.

## After a future approved cleanup

Following separate enrollment authorization, personally open Account security, choose
Set up authenticator, scan the new QR privately and enter the current code **in the
app only**. Keep the panel visible until scanning and verification finish. Require a
current verified factor, AAL2, server `getUser` and fresh database context. Never send
QR images, setup keys, codes or tokens to the agent. MFA does not grant or alter roles.

The existing staff-security approval/AAL2 gaps and separate 007/012 approvals remain;
this cleanup does not resolve them. No privileged SQL or frontend change is proposed.

**STOP: preparation complete. Await separate explicit approval for one cleanup bound
to this personal UUID and factor hash. No real factor, user, identity, role, assignment,
queue record, configuration, service, backup or volume was changed; no commit/push ran.**
