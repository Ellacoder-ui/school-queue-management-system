# Add Staff frontend integration

October 19, 2026 (UTC+08). **Implementation and isolated functional tests PASS.**
Staff Management now uses the installed directory and two-argument staff-request RPC.
No retained staff request, role change, assignment or migration was executed.
**Final strict source preservation did not fully pass:** only the `auth.users`
fingerprint changed during the observation window. Application records and all
other compared row sets remained exact; the limitation is recorded below.

## Working interface and installed contracts

Staff Management is organized into **Registered Accounts**, **Add Staff by Email**
and **Cashier Counter Assignments**, using the existing burgundy/gold/white interface.

| Contract | Frontend behavior |
| --- | --- |
| `admin_staff_directory()` | Allowlisted, validated ADMIN read. Exact fields: `id, email, role, enabled, verified_factors, google_identity`. Displays registered email, immutable UUID, database role, enabled status and joined counter assignments. Supports email/UUID/role search. |
| `admin_configuration()` | Existing authorized configuration read supplies accounts, counters, services and assignments. Directory/configuration UUIDs, roles and enabled states must agree. All five fixed routes are validated. |
| `request_staff_access(p_email, p_role)` | Trims/lowercases and validates email; supports only CASHIER/ADMIN review requests. Sends exactly these two arguments. Shows the returned `request_id` and `PENDING_IDENTITY_REVIEW` receipt. |
| `set_account` / `configure_counter` | Existing account role/enabled changes and cashier assignments retain explicit confirmation, immutable target UUIDs, actor pinning and server request keys. Counter service routes remain fixed. The current operator cannot edit their own account through these controls. |

Registered email comes from the installed backend's `auth.users.email` field. It is
not presented as independent verified Google identity evidence. Identity/factor
counts never grant a role. The directory selects no tokens, Google subjects or secrets.
STUDENT/CASHIER access remains denied by PostgreSQL, independently of UI visibility.

Add Staff clearly states that **no invitation email is sent, no account is created,
and no role or approval is granted**. Even an existing account's email produces only
an unbound pending review request. No pending list is invented: the installed backend
provides neither a list nor a request-status lookup endpoint.

Loading locks duplicate submissions. Invalid input, duplicate pending email,
authorization denial and rejected requests have sanitized messages. Ambiguous network,
server or malformed-success responses are treated as **unknown**, not failed inserts.

### Uncertain outcomes

The installed staff-request RPC has **no idempotency/reconciliation contract**.
The browser journal's UUID is local bookkeeping and is never sent as a nonexistent
RPC parameter. The actor-bound journal stores the operation, email/role and local
intent ID, without Auth credentials. Web Locks serialize management submissions in
the browser; SDK automatic mutation retries are disabled.

An uncertain staff request survives reload and blocks further management changes.
There is no retry/force-clear button: a trusted operator must inspect the outcome.
Existing idempotent account/counter operations retain explicit same-key reconciliation.
The backend's duplicate check is not serialized by a unique constraint; simultaneous
submissions from different browsers remain a backend concurrency limitation.

## Files

Modified existing files:

- `src/lib/adminContracts.js`, `src/services/queueApi.js` — installed response/argument
  validation, directory allowlist, exact two-argument dispatch and safe error mapping.
- `src/lib/adminWorkspace.js`, `src/composables/useAdminWorkspace.js` — shared reads,
  actor-bound intents, unknown-outcome handling, refresh/revocation and cleanup.
- `src/components/AdminDashboard.vue`, `AuthWorkspace.vue`, `QueueApplication.vue`
  and `src/admin.css` — management composition, real email rows, forms and confirmation
  dialogs. Student, Google login and MFA implementations were preserved.
- `tests/frontend/adminWorkspace.test.js`, `queueApi.test.js` and
  `googleOAuth.browser.mjs` — compatible contracts and UI/security regressions.

Added `tests/frontend/staffIntegration.test.js`, `staffFixtures.mjs`, and
`tests/integration/{inspectAddStaff,addStaff.integration,closeoutAddStaff}.mjs`,
plus sanitized evidence and this report.

`AdminManagement.vue` was inspected and preserved. It expects the separate versioned
`admin_workspace` contract, including approval/history/request-list data, which is not
installed here. The working `AdminDashboard.vue` uses only the actual installed APIs;
it does not require that proposal or migration 007.

## Verification

Trusted retained read-only inspection verified both installed signatures and function
bodies, SECURITY DEFINER/search-path settings, authenticated execution and private-table
RLS. The actual enabled ADMIN UUID is
`5c96debb-697f-4cad-805f-92b518e28343`; the school account remains STUDENT.
The directory returned **42 accounts**. ADMIN read passed and STUDENT/CASHIER reads
returned **42501** using current real account UUIDs in read-only authenticated SQL
contexts. This was operator SQL inspection, not a captured real browser JWT/session.
[Installed-contract evidence](../tests/integration/results/add_staff_inspection_eed60a92.json).

| Final test group | Result |
| --- | --- |
| Frontend unit/view/security tests | **179 passed**, 0 failed/skipped |
| Browser interception policy | **15 passed** |
| Real isolated PostgreSQL/PostgREST + installed SDK | **10 groups passed**, plus **123 existing SQL checks** |
| Intercepted OAuth/UI browser, `470e03e0` | **24 groups passed** |
| Intercepted MFA-enabled browser, `72a23369` | **26 groups passed** |
| Actual anonymous display/Realtime, `04ee35c6` | **15 groups passed** |
| Public-only production build / known local private-key scan | PASS |
| Built fixture/private-pattern scan; syntax and Git whitespace | PASS |
| Final strict retained source fingerprint comparison | **FAIL: `auth.users` only**; other checks below passed |

The real backend fixture used cached PostgreSQL 17.11/PostgREST, separate resources,
loopback-only API, tmpfs data and synthetic identities/JWTs. Its directory/request
function bodies matched the installed versions. It tested actual pending inserts,
duplicates, invalid input, denied roles, lost committed responses, and account/counter
changes **only in that fixture**. Existing-role and fixed-routing checks passed.
[Backend evidence](../tests/integration/results/add_staff_00a01ecb.json).

Browser Auth and staff calls were intercepted; no real Google/MFA or retained staff
mutation was forwarded. Tests cover normalized email, double-click prevention, exact
receipt, duplicate/unknown states, unknown persistence without replay, confirmation,
session/account changes and database-context routing. Public reads/Realtime use the
real anonymous local boundary. These tests do not claim retained authenticated
end-to-end submission acceptance.

Screenshots at **1440/768/390px** passed overflow checks; desktop/mobile were visually
inspected. Wide account tables scroll within their container. Screenshots show labeled
synthetic Auth/staff data, with real anonymous queue reads:

- [Registered accounts — mobile](../supabase/tests/results/video_ui_470e03e0_SIMULATED_admin-staff_390.png)
- [Confirmed pending receipt — desktop](../supabase/tests/results/video_ui_470e03e0_SIMULATED_admin-staff-receipt_1440.png)
- [Unknown outcome — mobile](../supabase/tests/results/video_ui_470e03e0_SIMULATED_admin-staff-unknown_390.png)

[OAuth/UI evidence](../supabase/tests/results/google_oauth_frontend_470e03e0.json),
[MFA regression](../supabase/tests/results/google_oauth_frontend_72a23369.json),
[standalone display](../supabase/tests/results/public_board_04ee35c6.json).

Earlier failures remain separate: fixture preflight/subnet guards stopped two attempts
before resource creation; browser attempts exposed confirmation timing, a read/action
generation race and a Vue shallow-ref multi-source watch that cleared receipts on
public refresh. Those defects were corrected and final suites passed. An old API
test also required a valid existing counter-operation contract. Repeated passes are
not added together, and failed evidence was not overwritten.

## Preservation and remaining limits

The final read-only closeout at **22:15:24 UTC+08** found:

- Application account/role/enabled, cashier assignment, queue/history/audit/public
  projection and Google-identity fingerprints unchanged. Staff requests remain **0**;
  MFA factor rows and all compared queue function definitions remain exact.
- Fixed routes remain **1:TP, 2:SOA, 3:PNEP, 4:REF, 5:ADJ**. Application RLS remains
  enabled; migration 007 approval storage is absent. Six application migration files,
  configuration and prior evidence retain their hashes.
- Original database cluster/volume, all retained service definitions and non-Vector
  lifecycles unchanged. Auth/settings/API return **200**; Google remains enabled.
- Exactly two owned fixture containers were added and stopped; their one labeled
  network remains. No volume changed or image was pulled.

**`auth.users` differed from the initial aggregate fingerprint.** The baseline does
not contain per-row/column snapshots, so the changed field/actor cannot be attributed
from this comparison. No Auth write was forwarded by the browser harness or issued by
the read-only inspectors. The discrepancy is retained as a failed strict source gate;
no full Auth-row immutability claim or replacement baseline is made.
[Closeout evidence](../tests/integration/results/add_staff_closeout_e8d9ce4a.json).

All **1,086 captured existing inputs remain; 1,075 retain their hashes**. The eleven
changes are the intended frontend/test files above. Existing modified/untracked work,
credential helpers, migrations, proposals and historical reports/evidence were preserved.
Backups and credential storage were not opened or changed. Owned test browsers/servers
were closed; the user's existing frontend was left running.

The installed legacy staff operations enforce enabled database ADMIN authorization;
they **do not implement the proposed AAL2/operator-approval gates**. This integration
does not claim to supply those backend protections. Migration 007 remains unapplied,
as instructed. Pending-request review/binding, approval/revocation workflow, invitation
delivery and historical reporting remain separate unsupported capabilities here.

**Stopped after implementation, testing and reporting.** No retained staff request,
role/assignment/queue change, SQL object/migration application, Auth/service restart,
credential change, backup deletion, deployment, Git commit or push occurred.
