# Admin Read-Only Frontend Integration Report

**Date:** October 20, 2026
**Branch:** `backend`
**Admin account:** `ellasharmaineabeso2004@gmail.com` (UUID: `5c96debb-697f-4cad-805f-92b518e28343`)
**Role:** ADMIN (local development)

---

## 1. Backend Contract Verification (Read-Only)

All five installed functions were verified via read-only PostgreSQL inspection:

| Function | Schema | Signature | Grants | ADMIN-only? |
|---|---|---|---|---|
| `admin_google_binding_v10` | `queue_private` | `(p_user uuid) → text` | postgres only | Private helper |
| `admin_staff_accounts` | `queue_api` | `() → jsonb` | authenticated, postgres | ✅ |
| `resolve_staff_google` | `queue_api` | `(p_email text) → jsonb` | authenticated, postgres | ✅ |
| `admin_payors` | `queue_api` | `(p_search, p_service, p_date, p_status, p_offset, p_limit) → jsonb` | authenticated, postgres | ✅ |
| `admin_payor_events` | `queue_api` | `(p_ticket uuid) → jsonb` | authenticated, postgres | ✅ |

### Authorization Verification
- ADMIN account can call all functions ✅
- STUDENT account blocked (42501 "Administrator required") ✅
- CASHIER account blocked (42501) ✅
- Private helper not callable by authenticated ✅

### PostgREST Compatibility
- Functions in `queue_api` schema, exposed via `PGRST_DB_SCHEMAS=public,queue_api,queue_display`
- Frontend uses `client.schema('queue_api').rpc(operation, parameters)`
- All function signatures match frontend expectations

---

## 2. Real Staff Directory Results

### Implementation

`AdminDashboard.vue` staff directory now uses `admin_staff_accounts()` (via `useAdminRecords`) instead of `admin_configuration()`:

- **Emails displayed** — `row.email` from `admin_staff_accounts()` response
- **Role displayed** — `row.role` (ADMIN or CASHIER only, STUDENT excluded)
- **Enabled status** — `row.enabled` (Enabled/Disabled)
- **Counter assignments** — from `adminAssignments` (admin_configuration)
- **Google verification** — `row.google_verified` (verified Google identity exists)
- **Search** — by email, UUID, or role

### Staff Directory Data (real, from backend)

The directory shows only ADMIN and CASHIER accounts (STUDENT excluded by backend). Each entry includes:
- Registered email (from `auth.users`); Google verification is a separate boolean
- Database role (ADMIN/CASHIER)
- Enabled/disabled status
- Assigned counters
- Google verification status

### Staff Management Controls (existing, preserved)

- Edit account (change role, enable/disable)
- Counter assignment (assign/remove cashiers)
- Last-ADMIN protection (enforced by `set_account`)
- Active ticket protection (enforced by `set_account`)

---

## 3. Google Account Lookup Functionality

### Implementation

`AdminAddStaff.vue` uses `resolve_staff_google(p_email)` via `useAdminRecords`:

- **Email normalization** — `normalizeStaffEmail()` validates and lowercases
- **Find button** — calls `records.find(email)` → `resolve_staff_google(p_email)`
- **Resolved account display** — email, UUID, role, enabled status, counter assignments
- **Unregistered/unverified** — shows "This account must sign in with Google before it can be added as staff"
- **Eligibility check** — only STUDENT accounts with no counter assignments can be promoted
- **Counter selection** — when CASHIER role selected, counter dropdown appears
- **Final activation button** — unconditionally disabled by the release lock; read-only account lookup remains available

### Lookup Results

When an admin enters an email and clicks "Find registered account":
- If verified Google identity exists: shows account details (email, UUID, role, enabled, counters)
- If no verified identity: shows "must sign in with Google first"
- If account not found: the same "must sign in with Google first" message; unavailable is reserved for a missing/failed endpoint

### Important Distinction

**Finding an account does NOT promote it.** The `resolve_staff_google()` function is read-only. Role activation requires `add_verified_staff()` which is NOT installed. The final "Activation unavailable" button remains disabled. The read-only lookup button is available.

---

## 4. Real Payor Management Results

### Implementation

`AdminPayors.vue` uses `admin_payors()` and `admin_payor_events()` via `useAdminRecords`:

- **Real queue records** from PostgreSQL (STUDENT-owned tickets only)
- **Search** — by ticket number, student number, display name, account UUID
- **Service filter** — TP, SOA, PNEP, REF, ADJ
- **Date filter** — queue date
- **Status filter** — WAITING, CALLED, SERVED, FORFEITED
- **Pagination** — 25 per page, server-side
- **Ticket history** — most recent 100 events per ticket
- **Student number and display name** — shown when authorized backend provides them (verified profiles only)

### Payor Records Display

Each row shows:
- Ticket number and business date
- Issued timestamp (Asia/Manila)
- Payor (display_name or student_number or owner_id)
- Service and counter
- Status
- History button (loads ticket events)

### Important Note: STUDENT Role Filtering

The `admin_payors()` function filters by `a.role = 'STUDENT'`. This means:
- **Historical tickets owned by users who were later promoted to CASHIER or ADMIN will NOT appear** in Payor Management
- This is by design — Payor Management shows records for current STUDENT accounts only
- No SQL change was made to alter this behavior (per user constraints)

---

## 5. Ticket History Functionality

### Implementation

`AdminPayors.vue` ticket history dialog:
- Loads via `records.events(ticket_id)` → `admin_payor_events(p_ticket)`
- Shows most recent 100 events in chronological order
- Each event: event type, status, timestamp, counter
- Loading state and error handling

### Authorization

- `admin_payor_events()` requires ADMIN role
- Verifies ticket belongs to a STUDENT account
- Returns 42501 "Payor ticket unavailable" if not found or not STUDENT-owned

---

## 6. Realtime and Dashboard Stability

### Preserved from Codex

- **No Refresh Queue button** — automatic updates via Realtime
- **No Refresh Directory button** — background revalidation
- **No Public Display link** in authenticated admin navigation
- **Automatic queue updates** — one shared WebSocket, 75ms batching
- **Staff directory updates** — after confirmed changes, background revalidation
- **No unnecessary flickering** — semantic `queueVersion` ignores timestamp-only changes
- **No repeated page reloads** — generation checks discard superseded responses
- **No resetting tabs/search/forms** — state preserved during background reads
- **No duplicate subscriptions** — one listener per table, multiplexed
- **Background revalidation** — on focus, visibility, reconnect
- **Reconnection behavior** — requires backend readiness + fresh snapshot

### Tab Switching

- Live queue monitor remains visible while switching tabs (right side on desktop)
- Monitor repositions responsively on mobile/tablet
- Selected tab, search text, and dialog state preserved during background updates

---

## 7. Authorization Results

### Verified (Read-Only)

| Test | Account | Result |
|---|---|---|
| Staff directory (admin_staff_accounts) | ADMIN | ✅ Returns data with emails |
| Staff directory | STUDENT | ✅ 42501 "Administrator required" |
| Staff directory | CASHIER | ✅ 42501 "Administrator required" |
| Payor records (admin_payors) | ADMIN | ✅ Returns data |
| Payor records | STUDENT | ✅ 42501 "Administrator required" |
| Google lookup (resolve_staff_google) | ADMIN | ✅ Returns account or null |
| Google lookup | STUDENT | ✅ 42501 "Administrator required" |
| Ticket history (admin_payor_events) | ADMIN | ✅ Returns events |
| Ticket history | STUDENT | ✅ 42501 "Payor ticket unavailable" |

### Frontend Authorization

- `queueApi.read()` checks `expectedActor` against JWT subject
- `AdminAddStaff.vue` disables "Add Staff" button when backend unavailable
- `AdminPayors.vue` shows "unavailable" message when backend not available
- No client-side role assignment or email-based admin override

---

## 8. Corrected handoff status — October 20, 2026

The frontend read integration is **implemented**, rather than pending. All four
read RPCs are allowlisted, parameter-checked and response-validated. Existing
`useAdminRecords` wiring is retained; it was not rebuilt during resumption.

Fresh trusted PostgreSQL READ ONLY checks returned **12 staff accounts** (seven
ADMIN and five CASHIER), not all 42 application accounts. Only **one** staff row
currently has `google_verified=true`; registered email does not imply verified
Google identity. The directory excludes STUDENT accounts. Actual payor reads returned
20 tickets, working status filters, an empty second page and ticket events. STUDENT
and CASHIER were each denied all four ADMIN reads (eight SQL-context checks).
These checks use trusted SQL authorization contexts, not the user's browser JWT.

The current staff read is primary. A denied/error/loading read cannot revive cached
legacy rows. Missing optional capability may show an explicitly limited legacy staff
view. Account lookup remains read-only and cannot grant a role or assignment.

## 9. Direct activation remains unavailable

`queue_api.add_verified_staff()` is **not installed**. A code release lock now blocks
the final form submission and operation replay, including a programmatic submit.
Existing account/counter management controls are preserved and were tested only
against fixtures; no retained management write is part of this verification.

The separate minimal proposal is
`supabase/20261020001200_admin_staff_activation.PROPOSED.sql`: one atomic mutation
depending on the already installed read-only functions and separately reviewed 007
staff security. It rejects execution if 007 is absent and preserves its current-role,
AAL2, verified-factor and operator-approval gates. Do not reapply the old combined
010 proposal: its five read functions are already installed.

007 is still absent from the retained database. Current legacy ADMIN authorization
does not enforce all proposed staff AAL2/operator-approval requirements. Enabling TOTP
does not resolve that backend gap. Real enrollment and approval must be verified
separately; no successful live MFA/privileged acceptance is inferred here.

## 10. Evidence, preservation and browser limits

The earlier 191-test/build statement describes the handoff checkpoint, not a new
current run and not 191 browser tests. Current test results, screenshots, failures
and closeout are recorded in
[the resumption report](CODEX_RESUMPTION_AND_FINAL_ACCEPTANCE_REPORT.md).

[Fresh read-only evidence](../tests/integration/results/admin_handoff_baseline.json)
independently verifies the installed definitions against the approved 011 source.
This resumption did not install those functions or attest the historical transaction.
No retained role, assignment, request, ticket, MFA or configuration write is authorized.

Real authenticated browser acceptance is a distinct check. After the verification
corrections, the user confirmed dashboard recovery and that Staff management, account
lookup, Payor management and Ticket history all work. Individual browser HTTP responses
were not captured; intercepted tests are reported separately in the resumption report.

The former contradictory "frontend prepared but not applied" section and unsupported
42-staff/one-total-identity counts are superseded by this dated correction. The original
handoff report is retained in the ignored task review directory; backend application
receipts and historical evidence are unchanged.
