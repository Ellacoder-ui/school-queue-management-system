# Add Staff Backend Application Result

**Date:** October 19, 2026
**Branch:** `backend`
**Mode:** LOCAL DEVELOPMENT ONLY
**Admin account:** `ellasharmaineabeso2004@gmail.com` (UUID: `5c96debb-697f-4cad-805f-92b518e28343`)

---

## 1. Exact Database and Cluster Verified

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

## 2. Proposal SQL Checksum

| File | SHA-256 |
|---|---|
| `supabase/20261019000900_staff_directory.PROPOSED.sql` | `4f101ff6918755e7affe33cbf78020f7b784105f87db872fb92fa874bd5cb25a` |

---

## 3. Approved Objects and Actual Objects Created

| # | Approved Object | Schema | Type | Created | Verified |
|---|---|---|---|---|---|
| 1 | `staff_review_requests` | `queue_private` | Table | ✅ | ✅ (1 table exists) |
| 2 | `admin_staff_directory()` | `queue_api` | Function | ✅ | ✅ (1 function exists) |
| 3 | `request_staff_access(p_email, p_role)` | `queue_api` | Function | ✅ | ✅ (1 function exists) |

**No additional objects created.** No triggers, indexes, policies, helper functions, or schema modifications beyond the three approved objects.

---

## 4. Read-Only Preflight Results: PASS

| # | Check | Result |
|---|---|---|
| 1 | TCP loopback connection | ✅ |
| 2 | `current_database()` = `postgres` | ✅ |
| 3 | `system_identifier` = `7696959712798593061` | ✅ |
| 4 | Local project identity | ✅ `school-queue-local` |
| 5 | Not cloud/production | ✅ Loopback only |
| 6 | Applied migration inventory | ✅ 6 migrations (001–006) |
| 7 | Migration 007 unapplied | ✅ Confirmed |
| 8 | Proposed objects absent (pre-application) | ✅ All 3 absent |
| 9 | SQL syntax review | ✅ Valid |
| 10 | Schema compatibility | ✅ All columns, constraints, types verified |
| 11 | No unrelated objects | ✅ |
| 12 | ADMIN account role | ✅ `5c96debb-...` is ADMIN, enabled |
| 13 | Before-state snapshot | ✅ Captured |
| 14 | Database health | ✅ Healthy |
| 15 | Project files preserved | ✅ No files modified during preflight |

---

## 5. Isolated Rehearsal Results: PASS

The exact proposed SQL was tested in a rollback transaction before retained application:

| Test | Result |
|---|---|
| Table creation | ✅ Success |
| `admin_staff_directory()` creation | ✅ Success |
| `request_staff_access()` creation | ✅ Success |
| ADMIN authorization (read directory) | ✅ Returns data |
| STUDENT authorization (read directory) | ✅ Blocked (42501) |
| Malformed email rejection | ✅ "Invalid email" |
| Invalid role rejection | ✅ "Invalid role" |
| Duplicate request rejection | ✅ "Pending review request already exists" |
| Rollback | ✅ Transaction rolled back, no retained changes |
| Post-rollback verification | ✅ Table and functions confirmed absent |

---

## 6. Transaction Execution and COMMIT Outcome

```
BEGIN
CREATE TABLE       (staff_review_requests)
ALTER TABLE        (enable RLS)
REVOKE             (all on table from public, anon, authenticated, service_role)
CREATE FUNCTION    (admin_staff_directory)
REVOKE             (all on function)
GRANT              (execute to authenticated)
CREATE FUNCTION    (request_staff_access)
REVOKE             (all on function)
GRANT              (execute to authenticated)
NOTIFY             (reload schema)
COMMIT
```

**Transaction outcome:** Committed successfully.
**Affected objects:** 3 (1 table, 2 functions).
**No errors.**

---

## 7. Final Table/Function Definitions and Authorization Checks

### Table: `queue_private.staff_review_requests`

| Column | Type | Constraints |
|---|---|---|
| `id` | uuid | PK, default gen_random_uuid() |
| `email` | text | NOT NULL, lowercase, email format |
| `requested_role` | app_role | NOT NULL, CASHIER or ADMIN |
| `status` | text | NOT NULL, default PENDING_IDENTITY_REVIEW |
| `bound_user` | uuid | FK → accounts(id), nullable |
| `identity_sha256` | text | CHECK hex 64 chars, nullable |
| `requested_by` | uuid | NOT NULL, FK → accounts(id) |
| `requested_at` | timestamptz | NOT NULL, default clock_timestamp() |
| `expires_at` | timestamptz | NOT NULL, max 30 days from requested_at |

**RLS:** Enabled. **Grants:** Only postgres (no public, anon, authenticated, service_role).

### Function: `queue_api.admin_staff_directory()`

- **Returns:** jsonb (array of account objects with id, email, role, enabled, verified_factors, google_identity)
- **Authorization:** Requires ADMIN role (`auth.uid()` must be an enabled ADMIN)
- **Grants:** EXECUTE to `authenticated` and `postgres`
- **Security:** SECURITY DEFINER, search_path = '' (safe)
- **Data exposure:** Only accounts in `queue_private.accounts` joined with `auth.users` for email. Not the entire Auth user directory.

### Function: `queue_api.request_staff_access(p_email text, p_role text)`

- **Returns:** jsonb (`{request_id, status: 'PENDING_IDENTITY_REVIEW'}`)
- **Authorization:** Requires ADMIN role
- **Validates:** Email format, role (CASHIER or ADMIN)
- **Creates:** Pending review request in `staff_review_requests` table
- **Does NOT:** Create Auth accounts, grant roles, send emails, or create approvals
- **Audit:** Inserts `STAFF_REVIEW_REQUEST` entry in `admin_audit_events`
- **Grants:** EXECUTE to `authenticated` and `postgres`

### Authorization test results

| Test | Result |
|---|---|
| ADMIN can read staff directory | ✅ Returns data |
| STUDENT cannot read staff directory | ✅ 42501 "Administrator required" |
| Valid request creates pending request | ✅ Returns `{request_id, status: 'PENDING_IDENTITY_REVIEW'}` |
| Duplicate request rejected | ✅ "Pending review request already exists for this email" |
| Invalid email rejected | ✅ "Invalid email" |
| Invalid role rejected | ✅ "Invalid role" |
| No role granted by creating request | ✅ CASHIER count unchanged |
| No Auth user created | ✅ Account count unchanged |
| No email sent | ✅ (no email delivery configured) |

---

## 8. PostgREST API Compatibility

Both functions are in the `queue_api` schema with EXECUTE granted to `authenticated`. PostgREST exposes them as RPC endpoints:

- `POST /rest/v1/rpc/admin_staff_directory` (no parameters)
- `POST /rest/v1/rpc/request_staff_access` (parameters: `p_email`, `p_role`)

The frontend's `queueApi` needs `admin_staff_directory` added to `readOperations` and `request_staff_access` is already in `mutationOperations`.

---

## 9. Staff-Directory Availability

The `admin_staff_directory()` function is now available in the retained database. It returns:
- Account UUID
- Verified Google email
- Database role (STUDENT/CASHIER/ADMIN)
- Enabled status
- Verified MFA factor count
- Google identity count

**Access:** ADMIN only (enforced by `auth.uid()` check).

**Security:** Only accounts in `queue_private.accounts` are returned (not the entire Auth user directory). No MFA secrets, tokens, or sensitive data exposed.

---

## 10. Pending Staff-Request Behavior

When an admin calls `request_staff_access(p_email, p_role)`:
1. Validates email format and role
2. Checks for existing pending request (rejects duplicates)
3. Creates a row in `staff_review_requests` with status `PENDING_IDENTITY_REVIEW`
4. Creates an audit entry in `admin_audit_events`
5. Returns `{request_id, status: 'PENDING_IDENTITY_REVIEW'}`

**What does NOT happen:**
- No Auth user is created
- No account role is changed
- No cashier assignment is made
- No email is sent
- No approval is granted

The request stays pending until:
- The person signs in with Google (identity verified)
- An administrator binds the request to the verified identity
- An operator approves the staff access (requires migration 007)

---

## 11. Preserved User Roles, Assignments, Tickets and History

| Item | Before | After | Status |
|---|---|---|---|
| Total accounts | 42 | 42 | ✅ Unchanged |
| Target role (ADMIN) | ADMIN | ADMIN | ✅ Unchanged |
| School account role | STUDENT | STUDENT | ✅ Unchanged |
| Second school account | STUDENT | STUDENT | ✅ Unchanged |
| Staff assignments | 4 | 4 | ✅ Unchanged |
| Tickets | 20 | 20 | ✅ Unchanged |
| Audit events | 33 | 33 (+ test entries cleaned) | ✅ |
| MFA factors (target) | 1 | 1 | ✅ Unchanged |
| Google identities (target) | 1 | 1 | ✅ Unchanged |
| Enabled ADMIN count | 6 | 6 | ✅ Unchanged |

**Test data cleanup:** The test pending request and audit entry created during verification were deleted. No retained test data remains.

---

## 12. Current Personal ADMIN Account Status

| Property | Value |
|---|---|
| Email | `ellasharmaineabeso2004@gmail.com` |
| UUID | `5c96debb-697f-4cad-805f-92b518e28343` |
| Role | **ADMIN** (enabled) |
| MFA factors | 1 unverified |
| Google identities | 1 |
| Staff assignments | 0 |
| Active tickets | 0 |

---

## 13. Migration 007 Status: Still Unapplied

| Check | Result |
|---|---|
| `staff_access_approvals` table | ❌ Does not exist |
| `review_staff_access()` function | ❌ Does not exist |
| `promote_approved_admin()` function | ❌ Does not exist |
| `require_staff_mfa()` function | ❌ Does not exist |

Migration 007 remains unapplied. The new functions (`admin_staff_directory`, `request_staff_access`) do not depend on migration 007.

---

## 14. Frontend Integration Results

### Current State

The `AdminDashboard.vue` staff management section:
- Staff directory loads from `admin_configuration()` (UUIDs, roles, enabled, counters)
- "Add staff by email" button is **disabled** (requires backend function)
- Account role management uses `set_account()` ✅
- Counter assignment uses `configure_counter()` ✅

### Frontend Changes Needed (not yet applied)

1. Add `admin_staff_directory` to `readOperations` in `queueApi.js`
2. Update `AdminDashboard.vue` to call `admin_staff_directory()` for email display
3. Enable the "Add staff by email" button and form
4. Update `request_staff_access` call (already in `mutationOperations`)
5. Update `adminContracts.js` validation (already has `request_staff_access` validation)

These changes are prepared but not applied. The backend functions are now available in the retained database.

### Tests

| Test file | Result |
|---|---|
| `authWorkspace.test.js` | 16/16 passed |
| `accountMfa.test.js` | 21/21 passed |
| `workspaceViews.test.js` | 6/6 passed |
| `publicBoard.test.js` | 11/11 passed |
| `adminManagementViews.test.js` | 2/2 passed |
| **Total** | **56/56 passed** |

### Production Build

```
npm run build → ✓ built in 7.08s
```

---

## 15. Failed Tests, Limitations and Next Steps

### No failed tests

All 56 frontend tests pass. Isolated backend tests passed. Production build succeeds.

### Limitations

1. **MFA/AAL2 not enforced** — Migration 007 not applied. ADMIN RPCs don't require MFA or operator approval.
2. **Operator approval flow not available** — `review_staff_access` and `promote_approved_admin` don't exist.
3. **Frontend not yet updated** — `AdminDashboard.vue` still uses `admin_configuration()` (no emails). Needs update to use `admin_staff_directory()`.
4. **Staff management UI** — `AdminManagement.vue` (more complete) still not wired in. Requires `admin_workspace` RPC (migration 007).
5. **Personal MFA enrollment** — Still incomplete (1 unverified factor).

### Next Steps (require your approval)

1. **Update frontend** to use `admin_staff_directory()` for email display and enable "Add staff by email" form
2. **Complete MFA enrollment** at `/account/security`
3. **Approve migration 007** for full security (MFA/AAL2/operator approval)
4. **Wire `AdminManagement.vue`** for complete staff management UI

---

## Summary

| Item | Status |
|---|---|
| Proposed SQL applied | ✅ 3 objects created (table + 2 functions) |
| Transaction | ✅ Committed |
| RLS enabled | ✅ |
| Grants correct | ✅ (authenticated + postgres only) |
| ADMIN authorization | ✅ Verified |
| STUDENT denial | ✅ Verified (42501) |
| Pending request behavior | ✅ Verified (creates request, no role grant) |
| Duplicate rejection | ✅ Verified |
| Invalid input rejection | ✅ Verified |
| No Auth user created | ✅ Verified |
| No email sent | ✅ Verified |
| No cashier assignment created | ✅ Verified |
| All account roles preserved | ✅ Verified |
| All staff assignments preserved | ✅ Verified |
| All tickets preserved | ✅ Verified |
| Migration 007 still unapplied | ✅ Verified |
| Auth service healthy | ✅ Verified |
| Frontend tests | ✅ 56/56 passing |
| Production build | ✅ Passing |
| Test data cleaned up | ✅ No retained test requests |

**The Add Staff backend is now available in the local development database. Frontend integration and further security hardening require separate approval.**