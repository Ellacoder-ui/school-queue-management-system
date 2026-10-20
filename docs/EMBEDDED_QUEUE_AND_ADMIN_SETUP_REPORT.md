# Embedded queue display and ADMIN preparation

October 19, 2026 (UTC+08). **Embedded monitor implemented and tested. ADMIN access
prepared and isolate-tested; no retained promotion or security migration applied.**
The school account remains enabled STUDENT. Real ADMIN activation is blocked by
disabled MFA configuration, absent MFA enrollment and the outstanding approvals below.

## Embedded public monitor

`StudentDashboard.vue` now embeds the existing `PublicQueueDisplay.vue` in the main
column, beside the desktop sticky ticket rail. It replaces the old compact counter
summary. The presentation receives the parent's existing public state; it creates
no Auth client, iframe, private read or additional subscription.

- All five fixed destinations remain **1:TP, 2:SOA, 3:PNEP, 4:REF, 5:ADJ** with their
  existing service names. Current calls, counter availability, dated waiting totals,
  connection status and last refresh use the existing anonymous-safe contracts.
- `counter_state`, `service_state` and `public_queue_context` remain the only public
  data sources. Missing totals display **Not reported**; zero remains zero. Stale
  snapshots are labeled and never instruct the student to proceed as if live.
- The existing `usePublicQueue`/controller handles Realtime invalidations, reconnect,
  refresh and cleanup once at the application parent. Browser checks observed **one
  live public WebSocket** with the embedded monitor mounted.
- Desktop keeps the active ticket sticky; tablet/mobile stack without horizontal
  page overflow. Embedded mode omits the lobby header and nested `<main>`. Burgundy,
  gold and white styling and the independent `/display` page remain functional.

Screenshots: [desktop 1440px](../supabase/tests/results/video_ui_1b3891e8_SIMULATED_student_1440.png),
[tablet 768px](../supabase/tests/results/video_ui_1b3891e8_SIMULATED_student_768.png),
[mobile 390px](../supabase/tests/results/video_ui_1b3891e8_SIMULATED_student_390.png).
Desktop/mobile were visually inspected. Screenshots are explicitly marked browser
fixtures: Auth/owner-ticket responses are intercepted; the monitor uses real local
anonymous reads. No fixture ticket or statistic was placed in production code.
Current public data have no active call or published waiting totals, which is shown
truthfully. [Actual standalone monitor](../supabase/tests/results/public_board_3ea08679_1366x768.png).

## Verified school identity and existing administrators

Trusted loopback PostgreSQL read-only inspection verified:

| Binding | Actual value |
| --- | --- |
| Intended email | `eabeso63122@liceo.edu.ph` — not `.edu.com` |
| Immutable `auth.users.id` | `b7d9aee8-c54d-455f-9913-a4c4dea0d097` |
| Application account ID | Same UUID |
| Current authorization | **STUDENT**, enabled |
| Google identity | Exactly one; provider subject matches provider ID; confirmed user email matches verified identity email |
| Verified MFA factors | **0** |
| Existing ADMIN inventory | Six accounts, five enabled; the target is not one of them |

The UUID hash also matches the independently recorded Phase 5 school-account binding.
Only server-owned `auth.users`/`auth.identities` facts are used, not editable user
metadata. The identity binding SHA-256 is:

`7b236769634b0910b034c035cc1422021f2281be9d6fd77d5c882ffd9ed86bbd`

It binds the UUID, Google identity ID, provider/subject and verified matching emails.
It is a review receipt, not a secret or authorization. Identity changes require a
fresh review. The old `bootstrap_admin(uuid)` refuses when an ADMIN already exists,
so it is unsuitable here and was not invoked.
[Identity evidence](../supabase/tests/results/embedded_admin_identity_5c85b727.json).

## Staff operations and security preparation

Existing database operations already support the following; current staff controls
remain disabled, and no new management UI or invitation system was enabled.

| Existing contract | Supported behavior |
| --- | --- |
| `admin_configuration()` | Account UUID/role/enabled records; all five counters, services and assignments; no Auth tokens or account-email directory |
| `set_account(uuid,text,boolean,uuid)` | Change existing accounts' roles/enabled state; protect the last enabled ADMIN and unresolved work |
| `configure_counter(uuid,boolean,text[],uuid[],uuid)` | Assign eligible cashiers and availability; migration 006 enforces permanent service routing |
| `configure_service`, `manage_day` | Authorized service/day management with existing audit/replay safeguards |
| `staff_queue`, `call_next`, `finish_ticket` | Current-role/assignment-based staff reads and cashier processing |

**The retained backend still has the documented MFA/approval gaps.** Existing ADMIN
checks do not require AAL2 or a separate operator approval. Frontend hiding is not
the security boundary.

Prepared [007 staff-security proposal](../supabase/20261019000700_staff_security.PROPOSED.sql),
deliberately **outside `supabase/migrations/`** to avoid an accidental CLI application
or changing the reviewed six-migration inventory. Its tested SHA-256 is:

`b22d63d24c991b9ebf0d380d27a716d5ea72e418f5e62e177c96dded4481222c`

The proposal adds an RLS-protected, operator-only approval register bound to exact
account UUID, intended staff role and verified Google identity hash. Approval
references are unique, expire, can be revoked, and cannot be created by browser/API
roles. Initial approval is proposed for one day; the schema caps a review at 30 days.
Applying the migration seeds no approvals and changes no roles.

API wrappers require the current enabled database role, signed JWT `aal2`, a current
verified MFA factor and matching active operator approval. They protect account and
counter administration, configuration reads, day/service changes, staff queue reads
and cashier call/finish operations. CASHIER/ADMIN grants and assigned cashiers also
require approval of the exact target. Original 001–006 implementations become
private cores with browser execution revoked; authorization precedes their replay
path. Existing fixed routing, last-admin and unresolved-work checks are retained.
This follows Supabase's [database AAL2 enforcement model](https://supabase.com/docs/guides/auth/auth-mfa)
and [function privilege guidance](https://supabase.com/docs/guides/database/functions).

**Migration impact requires explicit review:** all existing privileged accounts fail
these new gates until individually approved, enrolled and using AAL2. Expiry/revocation
blocks staff operations without silently changing their database role. This is a
tested proposal, not a claim that the running backend is already secured by it.

## MFA blockers and exact proposed promotion

The running Auth definition explicitly has both
`GOTRUE_MFA_TOTP_ENROLL_ENABLED=false` and `GOTRUE_MFA_TOTP_VERIFY_ENABLED=false`.
No TOTP override exists in config.toml. [Observed flags](../supabase/tests/results/admin_mfa_configuration_5c85b727.json).
The [documented CLI TOTP settings](https://supabase.com/docs/guides/local-development/cli/config)
are `auth.mfa.totp.enroll_enabled` and `verify_enabled`.

Before any real promotion:

1. Separately approve preparation/rehearsal of MFA enrollment/challenge UI and its
   Auth configuration plan. The eventual proposed delta is the two TOTP flags above
   becoming `true`, mirrored in TOML. The existing Google-only recreation helper
   permits a different fixed delta; do not rerun or bypass it for MFA. Any necessary
   Auth-only recreation needs a new reviewed plan and explicit approval. No other
   Supabase service needs to be included merely to enable these Auth settings.
2. Add safe AAL2/approval-required UI handling before enabling management controls,
   including expiry/revocation handling without access-refresh loops. The user must
   personally enroll and challenge/verify a factor; never put its QR secret or OTP
   in reports/logs. No enrollment was attempted here.
3. Separately approve applying the reviewed 007 migration with its staff-access
   impact and applicable recovery/source gates. Do not reset or replay old migrations.
4. Reverify project/cluster, the exact UUID/email/Google binding, enabled STUDENT
   state, no target work/assignments and verified MFA enrollment. Approve the specific
   STUDENT-to-ADMIN promotion and a fresh operator review reference.
5. Only then use the trusted database operator, never frontend SQL or a service key.
   The proposed transaction is below. Commit only after exact target-only verification;
   a changed identity/state must abort, not be automatically repaired or retried.

```sql
-- FUTURE EXPLICIT APPROVAL ONLY; not executed in this task.
BEGIN;
DO $guard$ BEGIN
  IF current_database() <> 'postgres' OR
     (SELECT system_identifier::text FROM pg_control_system()) <> '7696959712798593061'
  THEN RAISE EXCEPTION 'Wrong source target' USING ERRCODE='42501'; END IF;
END $guard$;
SELECT queue_private.review_staff_access(
  'b7d9aee8-c54d-455f-9913-a4c4dea0d097', 'eabeso63122@liceo.edu.ph',
  '7b236769634b0910b034c035cc1422021f2281be9d6fd77d5c882ffd9ed86bbd',
  'ADMIN', '<fresh-explicitly-approved-reference>', clock_timestamp()+interval '1 day');
SELECT queue_private.promote_approved_admin(
  'b7d9aee8-c54d-455f-9913-a4c4dea0d097', 'eabeso63122@liceo.edu.ph', 'STUDENT',
  '7b236769634b0910b034c035cc1422021f2281be9d6fd77d5c882ffd9ed86bbd',
  '<fresh-explicitly-approved-reference>');
-- Verify the exact result and unrelated-account preservation before approved COMMIT.
```

Both functions are direct-operator-only. Promotion additionally rejects absent verified
MFA, wrong/missing approval, changed UUID/email/hash/role, active work, assignments
and repeat promotion. It updates only that account's role/timestamp and adds an explicit
operator-promotion audit entry. No Auth identity or unrelated role is rewritten.
After a future approved promotion, fresh `getUser`/`my_context` must select ADMIN;
signed AAL2 and approval must still be checked by the backend on every sensitive RPC.
[Preparation-only bound proposal](../supabase/tests/results/admin_promotion_proposal_5c85b727.json).

## Tests, preservation and stop

| Final group | Result |
| --- | --- |
| Frontend tests, including seven embedded-monitor methods | **122 passed**, 0 failed/skipped |
| Browser interception policy | **15 passed** |
| Vue/SDK browser regression, final `1b3891e8` | **18 passed**; five counters, one live public socket, no nested main, desktop sticky rail and 1440/768/390px layouts |
| Real anonymous standalone display, `3ea08679` | **15 passed**; 1920/1366/768/390px, readiness, offline/reconnect and subscription cleanup |
| Existing SQL policy/routing checks in isolated fixture | **123 passed** |
| Proposed staff security in real isolated PostgreSQL/PostgREST, `f11d40bb` | **21 groups passed**; identity, approval, MFA, forgery, role denial, promotion/repeat and staff operations |
| Public-only production build/private-key scan; syntax/whitespace | PASS |

Realtime invalidation-to-render behavior and one-controller cleanup were exercised
with controlled callback events; real anonymous sockets/readiness/reconnect were
also exercised. No retained queue mutation was used to manufacture a live push.
Synthetic AAL2 JWTs/factor rows test the backend gates, not real MFA enrollment or
a complete Supabase MFA service. No real login was automated in this task.

Earlier stopped attempts remain FAIL: `44723c93` could not publish a fixture API port
on the attempted internal network; `4354c411` found a duplicate terminator in the
negative-test helper. A browser assertion in `13a67fe3` counted historical socket IDs;
the final test counts live sockets in the current document. No acceptance condition
was waived. The final fixture uses its established separate bridge with a checked
nonoverlapping subnet, loopback-only API, no PostgreSQL host port and tmpfs data.

All **six disposable containers** across the three backend attempts are stopped;
their three labeled networks remain. No volume was created/deleted or image pulled.
Owned browser/test servers were stopped; the user's existing frontend remains running.
Each backend attempt passed retained data/function/service and exact resource-delta
checks. The final **12:18:19 UTC+08** read-only closeout again matched the initial
account/Auth-identity/queue/assignment/audit fingerprints and function hashes; six
migrations/routes/security state remain unchanged, Auth/API return **200**, and Google
remains enabled. The new approval table is absent from the retained database.

Of **672 existing inputs**, **667** retain their hashes. The five intended changes are
the two Vue views, workspace CSS, browser test and isolated fixture helper. The latter
now accounts for the exact stopped original Auth container and avoids relying on the
default address pool; it still rejects unrelated project resources. Prior modified/
untracked work, reports/evidence, migrations, Auth helpers, credential files and
dependencies were preserved. No backup access/deletion, retained SQL write, role change,
Auth/Docker restart, Google configuration change, commit, push or deployment occurred.

Evidence: [final browser](../supabase/tests/results/google_oauth_frontend_1b3891e8.json),
[standalone regression](../supabase/tests/results/public_board_3ea08679.json),
[isolated security](../tests/integration/results/admin_security_f11d40bb.json),
[final preservation](../supabase/tests/results/embedded_admin_closeout_5c85b727.json).

**Stop: monitor complete; ADMIN/security changes remain preparation only.** Real MFA
configuration/enrollment, retained migration application, UUID-bound promotion and
enabling staff controls require their own explicit approval and successful gates.
