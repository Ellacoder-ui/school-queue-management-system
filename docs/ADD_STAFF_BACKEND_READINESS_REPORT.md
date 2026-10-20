# Add Staff Backend Readiness Report

**Date:** October 19, 2026
**Branch:** `backend`
**Admin account:** `ellasharmaineabeso2004@gmail.com` (UUID: `5c96debb-697f-4cad-805f-92b518e28343`)
**Role:** ADMIN (local development, migration 007 not applied)

---

## 1. Verified Features

### Personal ADMIN Role Verification (read-only)

| Check | Result |
|---|---|
| Target UUID `5c96debb-697f-4cad-805f-92b518e28343` role | **ADMIN** (enabled) ✅ |
| School account `b7d9aee8-...` role | STUDENT (enabled) ✅ |
| Google identity | 1 verified, provider: google |
| Auth service | Healthy, Google enabled |
| Total accounts | 42 (unchanged) |

### Live Frontend Admin Dashboard

The Admin Dashboard renders when signed in as the personal ADMIN account. It includes:
- Overview & analytics (open counters, waiting/called tickets, enabled services)
- Active tickets table
- Queue configuration (read-only)
- Staff management tab (now functional with existing RPCs)

### Available Database Functions (read-only inspection)

| Schema | Function | Args | Status |
|---|---|---|---|
| `queue_api` | `admin_configuration` | (none) | ✅ Exists |
| `queue_api` | `set_account` | `p_user, p_role, p_enabled, p_request_key` | ✅ Exists |
| `queue_api` | `configure_counter` | `p_counter, p_open, p_services, p_cashiers, p_request_key` | ✅ Exists |
| `queue_api` | `configure_service` | `p_code, p_name, p_enabled, p_request_key` | ✅ Exists |
| `queue_api` | `manage_day` | `p_action, p_date, p_request_key` | ✅ Exists |
| `queue_api` | `request_staff_access` | `p_email, p_role` | ❌ **Does not exist** |
| `queue_api` | `admin_staff_directory` | (none) | ❌ **Does not exist** |
| `queue_api` | `admin_workspace` | `p_date` | ❌ **Does not exist** (migration 007) |

### Missing Functions Identified

1. **`request_staff_access(p_email, p_role)`** — Called by frontend but not in database. Returns 404/PGRST202.
2. **`admin_staff_directory()`** — Needed for email display in staff directory. Not in database.
3. **`admin_workspace(p_date)`** — Used by `AdminManagement.vue` but not in database (migration 007).

### `admin_configuration()` Response Structure

```json
{
  "accounts": [{"id": "uuid", "role": "STUDENT|CASHIER|ADMIN", "enabled": true}],
  "services": [{"id": "uuid", "code": "TP", "name": "...", "enabled": true}],
  "counters": [{"id": "uuid", "number": 1, "label": "Counter 1", "is_open": false}],
  "counter_services": [{"counter_id": "uuid", "service_id": "uuid"}],
  "staff_assignments": [{"account_id": "uuid", "counter_id": "uuid"}],
  "days": [{"id": "uuid", "business_date": "2026-10-19", "is_open": true}]
}
```

**Limitation:** No email field. Accounts are identified by UUID only.

### `set_account` and `configure_counter` Compatibility

Both functions are compatible with the existing frontend calls:
- `set_account(p_user uuid, p_role text, p_enabled boolean, p_request_key uuid)` ✅
- `configure_counter(p_counter uuid, p_open boolean, p_services text[], p_cashiers uuid[], p_request_key uuid)` ✅
- Both require ADMIN role (enforced by `lock_actor()` check)
- Both protect last enabled ADMIN
- Both protect active/called tickets

---

## 2. Add Staff by Email — Current State

### What Works Now (local dev, no new functions)

| Step | Status | How |
|---|---|---|
| Staff directory | ✅ Works | `admin_configuration()` returns accounts with UUID, role, enabled |
| Change account role | ✅ Works | `set_account(uuid, role, enabled, request_key)` |
| Counter assignment | ✅ Works | `configure_counter(counter, open, services, cashiers, request_key)` |
| Enable/disable account | ✅ Works | `set_account(uuid, role, enabled, request_key)` |
| Revoke cashier access | ✅ Works | `set_account(uuid, 'STUDENT', enabled, request_key)` |

### What Does NOT Work (requires new functions)

| Step | Status | Reason |
|---|---|---|
| Add staff by email (pending review) | ❌ Fails | `request_staff_access` RPC doesn't exist |
| Email display in directory | ❌ Unavailable | `admin_configuration` doesn't return emails |
| Pending request tracking | ❌ Unavailable | No `staff_review_requests` table |

### Frontend Fix Applied

The "Add staff by email" button is now **disabled** with tooltip "Requires approved backend function". The dialog shows a clear "unavailable" message instead of a form that always fails. This prevents showing a functional action that returns an unsupported RPC error.

---

## 3. Staff Directory — Email Display

### Current limitation
`admin_configuration()` returns account UUIDs but not emails. Emails are stored in `auth.users` (Supabase Auth). Joining `queue_private.accounts` with `auth.users` requires a new database function.

### Proposed function: `admin_staff_directory()`

```sql
CREATE OR REPLACE FUNCTION queue_api.admin_staff_directory()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
begin
  if not exists(select 1 from queue_private.accounts where id=auth.uid() and role='ADMIN' and enabled) then
    raise exception 'Administrator required' using errcode='42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id,
      'email', u.email,
      'role', a.role,
      'enabled', a.enabled,
      'verified_factors', (select count(*) from auth.mfa_factors f where f.user_id = a.id and f.status = 'verified'),
      'google_identity', (select count(*) from auth.identities i where i.user_id = a.id and i.provider = 'google')
    ) order by a.id)
    from queue_private.accounts a
    join auth.users u on u.id = a.id
  ), '[]'::jsonb);
end $$;
```

### Security properties
- Requires ADMIN role (same check as `admin_configuration`)
- Returns only accounts that exist in `queue_private.accounts` (not the entire Auth user directory)
- Does not expose MFA secrets, tokens, or sensitive data
- Read-only (no data modification)

### Isolated test result
- ✅ ADMIN account can read the directory (returns data)
- ✅ STUDENT account gets `42501 Administrator required` (correctly blocked)
- ✅ Tested in a rollback transaction (no retained changes)

---

## 4. Backend Security — Proposed Changes

### Smallest Database Change Required

To make "Add Staff by Email" functional, the minimum required change is:

**1. Create `staff_review_requests` table** — stores pending review requests for unregistered emails.

**2. Create `request_staff_access(p_email, p_role)` function** — creates a pending review request. Does NOT create accounts, grant privileges, or send emails.

**3. Create `admin_staff_directory()` function** — returns verified accounts with emails (for staff directory display).

### Security Impact

| Aspect | Impact |
|---|---|
| Data modification | New table stores pending requests only. No existing data modified. |
| Privilege escalation | None. `request_staff_access` only creates pending requests. No role changes. |
| Account creation | None. No Supabase Auth accounts are created. |
| Email delivery | None. No emails are sent. |
| Auth user directory exposure | Minimal. `admin_staff_directory` joins `queue_private.accounts` with `auth.users` for email display. Only ADMIN can call it. Only existing application accounts are returned (not all Auth users). |
| MFA/AAL2 | Not enforced (migration 007 not applied). ADMIN role check only. |
| Operator approval | Not required (migration 007 not applied). |

### What Would NOT Change

- No existing accounts modified
- No existing roles changed
- No migration 007 applied
- No MFA requirements added or removed
- No security functions weakened
- No service-role credentials exposed

### Proposed SQL File

`supabase/20261019000900_staff_directory.PROPOSED.sql`

This file contains the table and function definitions. It is deliberately outside `supabase/migrations/` to avoid accidental application.

### Isolated Test Result

- ✅ Table creation: success
- ✅ Function creation: success (both functions)
- ✅ ADMIN authorization: verified (returns data)
- ✅ STUDENT authorization: verified (blocked with 42501)
- ✅ Rollback: transaction rolled back, no retained changes
- ✅ Post-rollback verification: table and functions confirmed absent from retained database

---

## 5. UI and Error Handling

### Changes Made to `AdminDashboard.vue`

1. **"Add staff by email" button** — disabled with tooltip "Requires approved backend function"
2. **Dialog** — shows clear "unavailable" message instead of a form that always fails
3. **Staff directory** — shows UUID, role, enabled status, and assigned counters
4. **Account review dialog** — functional (uses `set_account`)
5. **Counter assignment dialog** — functional (uses `configure_counter`)
6. **Search/filter** — works on UUID and role
7. **Caption** — notes that email display requires a backend directory function

### What Is NOT Shown

- No fake success messages
- No functional form that always returns an error
- No mock data in the Admin Dashboard

---

## 6. Testing

### Frontend tests — all passing

| Test file | Result |
|---|---|
| `authWorkspace.test.js` | 16/16 passed |
| `accountMfa.test.js` | 21/21 passed |
| `workspaceViews.test.js` | 6/6 passed |
| `publicBoard.test.js` | 11/11 passed |
| `adminManagementViews.test.js` | 2/2 passed |
| **Total** | **56/56 passed** |

### Production build

```
npm run build → ✓ built in 9.12s
```

### Isolated backend test

- ✅ `admin_staff_directory()` created and tested (ADMIN can read, STUDENT blocked)
- ✅ `request_staff_access()` created and tested (syntax valid, authorization enforced)
- ✅ `staff_review_requests` table created and tested (constraints valid)
- ✅ All changes rolled back (no retained database modifications)

### Authorization tests

| Test | Expected | Result |
|---|---|---|
| ADMIN can read staff directory | Returns data | ✅ Verified |
| STUDENT cannot read staff directory | 42501 error | ✅ Verified |
| ADMIN can change account roles | `set_account` succeeds | ✅ (existing, unchanged) |
| STUDENT cannot change account roles | 42501 error | ✅ (existing, unchanged) |
| CASHIER cannot promote themselves | 42501 error | ✅ (existing, unchanged) |

### Data preservation

| Item | Before | After | Status |
|---|---|---|---|
| Total accounts | 42 | 42 | ✅ Unchanged |
| Target role | ADMIN | ADMIN | ✅ Unchanged |
| School account role | STUDENT | STUDENT | ✅ Unchanged |
| Staff assignments | 4 | 4 | ✅ Unchanged |
| Tickets | 20 | 20 | ✅ Unchanged |
| MFA factors | 1 | 1 | ✅ Unchanged |

---

## 7. Smallest Database Change Requiring Approval

To make "Add Staff by Email" fully functional, the minimum required change is:

### Option A: Apply proposed functions only (no migration 007)

Apply `supabase/20261019000900_staff_directory.PROPOSED.sql` to create:
1. `staff_review_requests` table
2. `admin_staff_directory()` function
3. `request_staff_access(p_email, p_role)` function

**Impact:** Minimal. Three new objects (1 table, 2 functions). No existing data modified. No security functions weakened. ADMIN role check enforced on all functions.

**Risk:** Low. Functions are read-only or create pending requests only. No account creation, no role changes, no privilege grants.

### Option B: Apply migration 007 (full security)

Apply `supabase/20261019000700_staff_security.PROPOSED.sql` which includes:
- Everything in Option A plus
- AAL2/MFA gating on all staff RPCs
- Operator approval flow
- Full staff management security

**Impact:** High. Blocks all existing ADMIN/CASHIER accounts until they have MFA enrollment and operator approval. Requires careful migration planning.

**Risk:** Medium. Existing privileged accounts lose access until individually approved.

### Recommendation

**Option A** is the smallest safe change. It enables:
- Staff directory with emails
- Pending review requests for unregistered emails
- Clear pending status display

It does NOT enable:
- MFA/AAL2 gating (requires 007)
- Operator approval flow (requires 007)
- Full staff management security (requires 007)

---

## 8. Frontend Changes Needed After Backend Approval

Once the backend functions are approved and applied:

1. **Add `admin_staff_directory` to `readOperations`** in `queueApi.js`
2. **Update `AdminDashboard.vue`** to call `admin_staff_directory()` instead of `admin_configuration()` for the staff directory
3. **Update `AdminDashboard.vue`** to enable the "Add staff by email" button and form
4. **Remove the "unavailable" message** and restore the functional form
5. **Update tests** to verify the new functionality

These frontend changes are prepared but not applied (waiting for backend approval).

---

## 9. Remaining Limitations

1. **Email display** — Requires `admin_staff_directory()` (approval pending)
2. **Pending review requests** — Requires `request_staff_access()` (approval pending)
3. **MFA/AAL2 gating** — Requires migration 007 (approval pending)
4. **Operator approval flow** — Requires migration 007 (approval pending)
5. **Full staff management UI** — `AdminManagement.vue` requires `admin_workspace` RPC (migration 007)
6. **Personal MFA enrollment** — Still incomplete (1 unverified factor, QR code fix applied but not yet tested with real enrollment)

---

## 10. Summary

| Item | Status |
|---|---|
| Personal ADMIN role | ✅ Verified (local dev) |
| Staff directory (UUID, role, enabled, counters) | ✅ Functional |
| Account role management | ✅ Functional |
| Counter assignment | ✅ Functional |
| Enable/disable staff | ✅ Functional |
| Revoke cashier access | ✅ Functional |
| Add staff by email (pending review) | ⚠️ Requires backend function (prepared, tested, awaiting approval) |
| Email display in directory | ⚠️ Requires backend function (prepared, tested, awaiting approval) |
| MFA/AAL2 gating | ❌ Requires migration 007 (not applied) |
| Operator approval flow | ❌ Requires migration 007 (not applied) |
| Frontend tests | ✅ 56/56 passing |
| Production build | ✅ Passing |
| Isolated backend test | ✅ Passed (rolled back, no retained changes) |

**Smallest database change requiring approval:** Apply `supabase/20261019000900_staff_directory.PROPOSED.sql` to create `staff_review_requests` table + `admin_staff_directory()` + `request_staff_access()` functions. This enables staff directory with emails and pending review requests without applying migration 007.

**Awaiting your explicit approval before applying any database changes.**