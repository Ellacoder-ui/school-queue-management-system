# Admin Read-Only Backend Application Result

**Date:** October 20, 2026
**Branch:** `backend`
**Mode:** LOCAL DEVELOPMENT ONLY
**Admin account:** `ellasharmaineabeso2004@gmail.com` (UUID: `5c96debb-697f-4cad-805f-92b518e28343`)

---

## 1. Exact Verified Local Database

| Property | Value |
|---|---|
| Host | `127.0.0.1` (loopback) |
| Port | `54322` |
| Database | `postgres` |
| Cluster system identifier | `7696959712798593061` |
| PostgreSQL version | 17.11 |
| Project | `school-queue-local` |
| Auth service | `supabase_auth_school-queue-local` (healthy) |
| Kong gateway | `127.0.0.1:54321` (healthy) |

**Confirmed:** Local development database only. No production or cloud target.

---

## 2. Approved Source Filename and Verified SHA-256

| File | SHA-256 |
|---|---|
| `supabase/20261020001100_admin_readonly.PROPOSED.sql` | `3ed88ab2633a56650e27e931ff07e4684d24df0f67680c2e486725a4d8d423ed` |

**Checksum verified:** MATCH (calculated from actual file bytes).

---

## 3. Fresh Before-State Snapshot

| Item | Count |
|---|---|
| Total accounts | 42 |
| ADMIN accounts (total) | 7 (6 enabled, 1 disabled) |
| CASHIER accounts | 5 |
| STUDENT accounts | 30 |
| Staff counter assignments | 4 |
| Tickets | 20 |
| Admin audit events | 34 |
| MFA factors (target) | 1 (unverified) |
| Google identities (target) | 1 |
| Staff review requests | 1 (pre-existing) |
| Applied migrations | 6 (001–006) |
| Migration 007 | Unapplied |
| Previously approved functions | 2 (admin_staff_directory, request_staff_access) |
| Previously approved tables | 1 (staff_review_requests) |

---

## 4. Preflight Results: PASS

| # | Check | Result |
|---|---|---|
| 1 | TCP loopback connection (127.0.0.1:54322) | ✅ |
| 2 | `current_database()` = `postgres` | ✅ |
| 3 | `system_identifier` = `7696959712798593061` | ✅ |
| 4 | Local project identity | ✅ `school-queue-local` |
| 5 | Not cloud/production | ✅ Loopback only |
| 6 | SQL checksum match | ✅ MATCH |
| 7 | Exactly 5 CREATE FUNCTION statements | ✅ |
| 8 | No `add_verified_staff` in SQL | ✅ |
| 9 | No internal BEGIN/COMMIT | ✅ |
| 10 | No tables, triggers, policies, or unrelated objects | ✅ |
| 11 | Migration 007 unapplied | ✅ |
| 12 | 5 proposed functions absent (pre-application) | ✅ (0) |
| 13 | ADMIN account verified | ✅ `5c96debb-...` is ADMIN, enabled |
| 14 | School account verified | ✅ STUDENT, enabled |
| 15 | Database health | ✅ Healthy |

**Preflight result: PASS — all checks matched.**

---

## 5. Whether the Approved SQL Was Executed: YES

The approved SQL was executed in a single guarded transaction.

---

## 6. Transaction COMMIT Result

```
BEGIN
DO          (cluster guard passed)
DO          (object absence guard passed)
CREATE FUNCTION    (admin_google_binding_v10)
CREATE FUNCTION    (admin_staff_accounts)
CREATE FUNCTION    (resolve_staff_google)
CREATE FUNCTION    (admin_payors)
CREATE FUNCTION    (admin_payor_events)
REVOKE             (all on private helper)
REVOKE             (all on 4 queue_api functions)
GRANT              (execute to authenticated)
NOTIFY             (reload schema)
DO          (5 functions created — verified)
DO          (add_verified_staff absent — verified)
DO          (data preservation — verified)
COMMIT
```

**Transaction outcome:** Committed successfully.
**Functions created:** 5 (exactly as approved).
**No errors.**

---

## 7. Actual Five Functions Installed

| # | Function | Schema | Signature | Verified |
|---|---|---|---|---|
| 1 | `admin_google_binding_v10` | `queue_private` | `(p_user uuid) → text` | ✅ |
| 2 | `admin_staff_accounts` | `queue_api` | `() → jsonb` | ✅ |
| 3 | `resolve_staff_google` | `queue_api` | `(p_email text) → jsonb` | ✅ |
| 4 | `admin_payors` | `queue_api` | `(p_search, p_service, p_date, p_status, p_offset, p_limit) → jsonb` | ✅ |
| 5 | `admin_payor_events` | `queue_api` | `(p_ticket uuid) → jsonb` | ✅ |

**`add_verified_staff`:** NOT installed (0 functions). ✅

---

## 8. Functions and Grants Verified

### Grants

| Function | Granted to | Revoked from |
|---|---|---|
| `admin_google_binding_v10` (private) | (none) | public, anon, authenticated, service_role |
| `admin_staff_accounts` | authenticated, postgres | public, anon, authenticated, service_role (before grant) |
| `resolve_staff_google` | authenticated, postgres | public, anon, authenticated, service_role (before grant) |
| `admin_payors` | authenticated, postgres | public, anon, authenticated, service_role (before grant) |
| `admin_payor_events` | authenticated, postgres | public, anon, authenticated, service_role (before grant) |

### SECURITY DEFINER and search_path

All functions use `SECURITY DEFINER` with `SET search_path TO ''`. Verified via `pg_proc.prosecdef = true`.

---

## 9. ADMIN/STUDENT/CASHIER Authorization Results

| Test | Account | Result |
|---|---|---|
| `admin_staff_accounts()` | ADMIN (5c96debb...) | ✅ Returns data |
| `admin_payors()` | ADMIN | ✅ Returns data |
| `resolve_staff_google(valid_email)` | ADMIN | ✅ Returns account data |
| `resolve_staff_google(unregistered_email)` | ADMIN | ✅ Returns null |
| `admin_staff_accounts()` | STUDENT (b7d9aee8...) | ✅ 42501 "Administrator required" |
| `admin_payors()` | STUDENT | ✅ 42501 "Administrator required" |
| `admin_google_binding_v10` (private) | No grants | ✅ Not callable by authenticated |

**Authorization verified:** ADMIN-only access enforced at PostgreSQL level.

---

## 10. Local PostgREST Compatibility

The functions are in the `queue_api` schema with EXECUTE granted to `authenticated`. PostgREST is configured with `PGRST_DB_SCHEMAS=public,queue_api,queue_display`.

The frontend's `queueApi.js` uses `client.schema('queue_api').rpc(operation, parameters)` which sets the correct `Accept-Profile` and `Content-Profile` headers.

**Compatibility verified:** The existing code pattern in `queueApi.js` already supports `queue_api` schema functions. The new functions follow the same signature pattern as existing ones.

---

## 11. Payor Management Readiness

### `admin_payors(p_search, p_service, p_date, p_status, p_offset, p_limit)`

- **Authorization:** ADMIN role required (via `admin_configuration()`)
- **Input validation:** All parameters validated (search max 100 chars, service must be valid code, status must be valid, offset/limit bounds)
- **Pagination:** Max 50 per page, max offset 100,000
- **Returns:** `{rows: [...], more: boolean, offset, limit}`
- **Row fields:** ticket_id, owner_id, number, service, status, business_date, issued_at, counter_id, student_number, display_name
- **Scoped to:** STUDENT accounts only (WHERE a.role = 'STUDENT')
- **Student profiles:** Only verified profiles (`verified_at IS NOT NULL`)

### `admin_payor_events(p_ticket)`

- **Authorization:** ADMIN role required (via `admin_configuration()`)
- **Validation:** Ticket must belong to a STUDENT account
- **Returns:** Array of `{event, at, status, counter_id}` (most recent 100 events)
- **Error:** 42501 "Payor ticket unavailable" if ticket not found or not owned by STUDENT

**Status:** Backend ready. Frontend `AdminPayors.vue` can be updated to use these functions.

---

## 12. Staff Directory Readiness

### `admin_staff_accounts()`

- **Authorization:** ADMIN role required (via `admin_configuration()`)
- **Returns:** Array of `{id, email, role, enabled, google_verified}`
- **Scoped to:** ADMIN and CASHIER accounts only (STUDENT excluded)
- **Email source:** Joined with `auth.users` (verified Google email)
- **Google verification:** `admin_google_binding_v10()` returns non-null only for verified Google identities

**Status:** Backend ready. Frontend `AdminDashboard.vue` can be updated to use this instead of `admin_configuration()`.

### `resolve_staff_google(p_email)`

- **Authorization:** ADMIN role required (via `admin_configuration()`)
- **Input validation:** Email format, max 254 chars
- **Returns:** `{id, email, role, enabled, identity_sha256, counter_ids}` or `null`
- **Verification:** Exact match (one account, verified Google identity)

**Status:** Backend ready. Frontend `AdminAddStaff.vue` can be updated to use this.

---

## 13. Google Lookup Readiness

`resolve_staff_google()` securely resolves a verified Google account by email:

1. Validates email format
2. Counts matching accounts (must be exactly 1)
3. Verifies Google identity binding (email confirmed, subject matches, single identity)
4. Returns account details with identity hash and counter assignments
5. Returns `null` if no verified match (unregistered or unverified)

**Security:** Does not rely solely on email string. Uses immutable Google subject and provider ID for identity verification.

---

## 14. Frontend Changes (Not Yet Applied)

The backend functions are now available. Frontend changes needed (safe, no database modifications):

1. **Add `admin_staff_accounts`, `resolve_staff_google`, `admin_payors`, `admin_payor_events` to `readOperations`** in `queueApi.js`
2. **Update `AdminDashboard.vue`** to call `admin_staff_accounts()` for email display
3. **Update `AdminAddStaff.vue`** to enable the "Add Staff" button and form (uses `resolve_staff_google`)
4. **Update `AdminPayors.vue`** to enable data loading (uses `admin_payors`, `admin_payor_events`)
5. **Update tests** to verify new functionality

These are frontend-only changes. No database modifications required.

**Note:** `add_verified_staff()` is NOT installed. The "Add Staff" button should still show an "unavailable" message for the actual promotion step, but can now resolve and display Google accounts.

---

## 15. Tests and Production Build Results

### Frontend Tests

| Test file | Result |
|---|---|
| `authWorkspace.test.js` | 16/16 passed |
| `accountMfa.test.js` | 21/21 passed |
| `workspaceViews.test.js` | 6/6 passed |
| `publicBoard.test.js` | 11/11 passed |
| `adminManagementViews.test.js` | 2/2 passed |
| `adminRecords.test.js` | 6/6 passed |
| `staffIntegration.test.js` | 14/14 passed |
| `revalidation.test.js` | (included in total) |
| **Total** | **191/191 passed** |

### Production Build

```
npm run build → ✓ built in 23.44s
```

### Isolated Backend Tests

| Test | Result |
|---|---|
| 5 functions created | ✅ |
| `add_verified_staff` not created | ✅ (0) |
| ADMIN can read staff accounts | ✅ |
| ADMIN can read payors | ✅ |
| ADMIN can resolve verified Google account | ✅ |
| ADMIN gets null for unregistered email | ✅ |
| STUDENT blocked from staff accounts | ✅ (42501) |
| STUDENT blocked from payors | ✅ (42501) |
| Rollback test (previous) | ✅ Clean removal |
| Post-application verification | ✅ All checks pass |

---

## 16. Before/After Data Preservation

| Item | Before | After | Status |
|---|---|---|---|
| Total accounts | 42 | 42 | ✅ Unchanged |
| Target role (ADMIN) | ADMIN | ADMIN | ✅ Unchanged |
| School account (STUDENT) | STUDENT | STUDENT | ✅ Unchanged |
| Second school account | STUDENT | STUDENT | ✅ Unchanged |
| Staff assignments | 4 | 4 | ✅ Unchanged |
| Tickets | 20 | 20 | ✅ Unchanged |
| Audit events | 34 | 34 | ✅ Unchanged |
| MFA factors (target) | 1 | 1 | ✅ Unchanged |
| Google identities (target) | 1 | 1 | ✅ Unchanged |
| Staff review requests | 1 | 1 | ✅ Unchanged |
| Migration 007 | Unapplied | Unapplied | ✅ Unchanged |

**Only change:** 5 new read-only functions added. No data modified.

---

## 17. Migration 007 Status: Still Unapplied

| Check | Result |
|---|---|
| `staff_access_approvals` table | ❌ Does not exist |
| `review_staff_access()` function | ❌ Does not exist |
| `promote_approved_admin()` function | ❌ Does not exist |
| `require_staff_mfa()` function | ❌ Does not exist |

Migration 007 remains unapplied. The new functions work independently.

---

## 18. Confirmation That `add_verified_staff` Was NOT Installed

| Check | Result |
|---|---|
| `add_verified_staff` in `pg_proc` | ❌ 0 (not installed) |
| `add_verified_staff` in split SQL | ❌ Not present |
| `add_verified_staff` in original 01000 SQL | ✅ Present (not applied) |

**Confirmed:** `add_verified_staff` was NOT installed. Only the 5 read-only functions were applied.

---

## 19. Remaining Blockers for Activating Real Staff Accounts

### Blocker 1: `add_verified_staff()` Not Installed

**What's needed:** Apply `add_verified_staff()` from `20261020001000_admin_staff_payors.PROPOSED.sql` (or a separate approval).

**Requirements:**
- Personal MFA enrollment complete (verified TOTP factor)
- AAL2 session established
- Migration 007 applied (for operator approval flow)

**Current status:** Personal account has 0 verified MFA factors. Migration 007 not applied.

### Blocker 2: Migration 007 Not Applied

**What's needed:** Apply `20261019000700_staff_security.PROPOSED.sql` to enable:
- `staff_access_approvals` table
- `require_staff_mfa()` and `require_staff_approval()` functions
- AAL2/MFA gating on all staff RPCs
- Operator approval flow

**Impact:** All existing ADMIN/CASHIER accounts will fail closed until individually approved, enrolled, and using AAL2.

### Blocker 3: Personal MFA Enrollment Incomplete

**What's needed:** Complete MFA enrollment at `/account/security`:
1. Sign in with Google
2. Open Account security
3. Scan QR code with authenticator app
4. Enter six-digit code

**Current status:** 1 unverified TOTP factor exists. QR code was never displayed (frontend validation issue was fixed).

### Blocker 4: Frontend Not Updated

**What's needed:** Update `AdminDashboard.vue` to:
- Call `admin_staff_accounts()` for email display
- Enable "Add Staff" button and form
- Update `AdminPayors.vue` to call `admin_payors()` and `admin_payor_events()`

**Status:** Prepared but not applied (waiting for backend availability, now available).

---

## 20. Summary

| Category | Status |
|---|---|
| 5 read-only functions applied | ✅ |
| Transaction committed | ✅ |
| All authorization tests pass | ✅ |
| PostgREST compatibility | ✅ |
| Payor Management ready | ✅ (backend) |
| Staff directory ready | ✅ (backend) |
| Google lookup ready | ✅ (backend) |
| Frontend updated | ⚠️ Prepared, not applied |
| `add_verified_staff` installed | ❌ Not installed (requires approval) |
| Migration 007 applied | ❌ Not applied |
| MFA enrollment complete | ❌ Incomplete (0 verified factors) |
| Frontend tests | ✅ 191/191 passing |
| Production build | ✅ Passing |
| Data preservation | ✅ All checks pass |
| Auth service health | ✅ Healthy |

**The five read-only ADMIN backend functions are now available in the local development database. Direct Add Staff activation still requires `add_verified_staff()` (separate approval) and MFA enrollment. Migration 007 remains unapplied.**