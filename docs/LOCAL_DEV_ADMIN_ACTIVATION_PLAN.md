# Local Development ADMIN Activation Plan

**Date:** October 19, 2026
**Branch:** `backend`
**Mode:** LOCAL DEVELOPMENT ONLY — preparation and isolated testing
**Status:** AWAITING EXPLICIT APPROVAL before any database change

---

## 1. Database Target Verification (read-only)

| Property | Value |
|---|---|
| Host | `127.0.0.1` (loopback only) |
| Port | `54322` |
| Database | `postgres` |
| Cluster system identifier | `7696959712798593061` |
| PostgreSQL version | 17.11 |
| Project ID | `school-queue-local` |
| Auth service | `supabase_auth_school-queue-local` (container, healthy) |
| Kong gateway | `127.0.0.1:54321` |
| Supabase CLI | Local development mode |

**This is a LOCAL development database.** It is not a deployed or production database. The `.env` file points to a production cloud URL (`kzppqundnzjpiviwhqiv.supabase.co`), but all operations here target the local Supabase instance on `127.0.0.1`. No production database is reachable from this procedure.

**Verification command (read-only):**
```sql
SELECT current_database();                                    -- postgres
SELECT system_identifier::text FROM pg_control_system();        -- 7696959712798593061
SELECT version();                                              -- PostgreSQL 17.11
```

---

## 2. Target Account Identity Verification (read-only)

| Property | Value | Verified |
|---|---|---|
| Email | `ellasharmaineabeso2004@gmail.com` | ✅ |
| Auth UUID | `5c96debb-697f-4cad-805f-92b518e28343` | ✅ |
| Email confirmed | Yes | ✅ |
| Anonymous | No | ✅ |
| Google identity | 1 (provider: google, subject: 103692752526830470141) | ✅ |
| Application account | Exists in `queue_private.accounts` | ✅ |
| Current role | **STUDENT** | ✅ |
| Account enabled | Yes (`enabled = true`) | ✅ |
| MFA factors | 1 unverified TOTP (not verified) | ✅ |
| Staff assignments | 0 | ✅ |
| Active tickets | 0 | ✅ |

**School account (must remain STUDENT):**

| Property | Value |
|---|---|
| Email | `eabeso63122@liceo.edu.ph` |
| Auth UUID | `b7d9aee8-c54d-455f-9913-a4c4dea0d097` |
| Current role | **STUDENT** (enabled) |
| **No changes will be made to this account.** | |

---

## 3. Existing Role-Management Functions (read-only inspection)

### Currently applied (migrations 001–006)

| Function | Location | Authorization check | MFA required? | Operator approval? |
|---|---|---|---|---|
| `set_account(p_user, p_role, p_enabled, p_request_key)` | `queue_api` | Caller must be ADMIN (`a.role = 'ADMIN'`) | **No** | **No** |
| `admin_configuration()` | `queue_api` | Caller must be ADMIN | **No** | **No** |
| `configure_counter(...)` | `queue_api` | Caller must be ADMIN | **No** | **No** |

### NOT applied (migration 007 — proposed only)

| Function | Status | Requires |
|---|---|---|
| `review_staff_access(...)` | **Does not exist** | Migration 007 not applied |
| `promote_approved_admin(...)` | **Does not exist** | Migration 007 not applied |
| `require_staff_mfa('ADMIN')` | **Does not exist** | Migration 007 not applied |
| `require_staff_approval(...)` | **Does not exist** | Migration 007 not applied |
| `staff_access_approvals` table | **Does not exist** | Migration 007 not applied |

**Conclusion:** Since migration 007 is NOT applied, the current role-management system does NOT enforce MFA or operator approval. Role changes via `set_account` only require ADMIN role. However, since we don't have an existing ADMIN session, the direct SQL approach is used.

---

## 4. What the Admin Dashboard Would Show After Role Change

The `AdminDashboard.vue` component renders when `workspace === 'admin'` and `context.role === 'ADMIN'`. It includes:

| Section | Status | Notes |
|---|---|---|
| Overview & analytics | ✅ Functional | Open counters, waiting/called tickets, enabled services, active tickets table |
| Queue configuration | ✅ Read-only | "Manage configuration" button is disabled (frontend placeholder) |
| Staff management tab | ⚠️ Disabled | Frontend shows "Staff management is not available yet" |
| Counter assignments | ⚠️ Not exposed | `AdminManagement.vue` exists but is not wired into `AuthWorkspace.vue` |

**What would work after promotion:**
- Admin Dashboard renders with analytics and queue overview
- `admin_configuration()` RPC returns staff directory (requires ADMIN role)
- `set_account()` RPC works (requires ADMIN role — no MFA/approval gate since 007 is unapplied)

**What would NOT work (requires migration 007):**
- Staff management UI (frontend placeholder, disabled)
- MFA/AAL2 gating (not enforced without 007)
- Operator approval flow (table doesn't exist)

---

## 5. Authorization Impact

### Before role change
- Target account: STUDENT → routes to StudentDashboard
- Can issue tickets, view ticket history, use embedded queue monitor
- Cannot access `admin_configuration()`, `set_account()`, or any ADMIN RPC
- Cannot render AdminDashboard

### After role change (temporary local dev)
- Target account: ADMIN → routes to AdminDashboard
- Can view analytics, queue overview, active tickets
- Can call `admin_configuration()` (returns staff directory)
- Can call `set_account()` (change other accounts' roles)
- Can call `configure_counter()` (assign cashiers)
- **No MFA or operator approval required** (migration 007 unapplied)
- **This is a local development simplification** — production would require MFA + approval

### Risk assessment
- **Scope:** Single account, single database, local only
- **Reversibility:** Full rollback via SQL (see Section 7)
- **Audit:** Audit log entry created for both promotion and rollback
- **Production impact:** None — local database only
- **Other accounts:** No changes
- **Queue data:** No changes

---

## 6. Exact-Target, Auditable, Reversible Role-Change Plan

### Pre-conditions (all must be verified before execution)

1. ✅ Database target verified: `postgres` on `127.0.0.1:54322`, cluster `7696959712798593061`
2. ✅ Target account verified: UUID `5c96debb-697f-4cad-805f-92b518e28343`, email `ellasharmaineabeso2004@gmail.com`, role STUDENT, enabled
3. ✅ Google identity verified: 1 Google identity, provider subject `103692752526830470141`
4. ✅ School account verified: UUID `b7d9aee8-c54d-455f-9913-a4c4dea0d097`, role STUDENT (will not be changed)
5. ✅ Migration 007 NOT applied (no MFA/approval gates exist)
6. ✅ No active tickets or staff assignments for target account

### Promotion transaction (execute only after explicit approval)

```sql
-- LOCAL DEVELOPMENT ONLY — NOT FOR PRODUCTION
BEGIN;

-- Guard: verify correct database target
DO $guard$ BEGIN
  IF current_database() <> 'postgres' OR
     (SELECT system_identifier::text FROM pg_control_system()) <> '7696959712798593061'
  THEN RAISE EXCEPTION 'Wrong source target' USING ERRCODE='42501'; END IF;
END $guard$;

-- Verify target account state before change
DO $check$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM queue_private.accounts WHERE id = '5c96debb-697f-4cad-805f-92b518e28343' AND role = 'STUDENT' AND enabled = true) THEN
    RAISE EXCEPTION 'Target account state changed — aborting' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM queue_private.tickets WHERE owner_id = '5c96debb-697f-4cad-805f-92b518e28343' AND status IN ('WAITING', 'CALLED')) THEN
    RAISE EXCEPTION 'Target has active tickets — resolve first' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM queue_private.staff_counter_assignments WHERE account_id = '5c96debb-697f-4cad-805f-92b518e28343') THEN
    RAISE EXCEPTION 'Target has staff assignments — resolve first' USING ERRCODE='42501';
  END IF;
END $check$;

-- Change role
UPDATE queue_private.accounts
SET role = 'ADMIN', updated_at = clock_timestamp()
WHERE id = '5c96debb-697f-4cad-805f-92b518e28343'
  AND role = 'STUDENT';

-- Audit entry
INSERT INTO queue_private.admin_audit_events (actor_id, action, parameters)
VALUES (
  '5c96debb-697f-4cad-805f-92b518e28343',
  'DEV_ADMIN_ACTIVATION',
  jsonb_build_object(
    'actor_kind', 'DATABASE_OPERATOR',
    'operator', session_user,
    'target', '5c96debb-697f-4cad-805f-92b518e28343',
    'target_email', 'ellasharmaineabeso2004@gmail.com',
    'previous_role', 'STUDENT',
    'new_role', 'ADMIN',
    'reason', 'LOCAL_DEV_ADMIN_TESTING',
    'migration_007_applied', false,
    'mfa_verified', false
  )
);

COMMIT;
```

### Rollback procedure (execute to revert)

```sql
-- ROLLBACK: Revert to STUDENT
BEGIN;

DO $guard$ BEGIN
  IF current_database() <> 'postgres' OR
     (SELECT system_identifier::text FROM pg_control_system()) <> '7696959712798593061'
  THEN RAISE EXCEPTION 'Wrong source target' USING ERRCODE='42501'; END IF;
END $guard$;

DO $check$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM queue_private.accounts WHERE id = '5c96debb-697f-4cad-805f-92b518e28343' AND role = 'ADMIN' AND enabled = true) THEN
    RAISE EXCEPTION 'Target account is not currently ADMIN — aborting rollback' USING ERRCODE='42501';
  END IF;
END $check$;

UPDATE queue_private.accounts
SET role = 'STUDENT', updated_at = clock_timestamp()
WHERE id = '5c96debb-697f-4cad-805f-92b518e28343'
  AND role = 'ADMIN';

INSERT INTO queue_private.admin_audit_events (actor_id, action, parameters)
VALUES (
  '5c96debb-697f-4cad-805f-92b518e28343',
  'DEV_ADMIN_ROLLBACK',
  jsonb_build_object(
    'actor_kind', 'DATABASE_OPERATOR',
    'operator', session_user,
    'target', '5c96debb-697f-4cad-805f-92b518e28343',
    'target_email', 'ellasharmaineabeso2004@gmail.com',
    'previous_role', 'ADMIN',
    'new_role', 'STUDENT',
    'reason', 'LOCAL_DEV_ADMIN_TESTING_ROLLBACK'
  )
);

COMMIT;
```

---

## 7. Tests and Preservation Checks

### Pre-change snapshot (run before promotion)

```sql
-- Account count
SELECT count(*) FROM queue_private.accounts;                          -- Expected: 42
-- Target account state
SELECT id, role::text, enabled FROM queue_private.accounts WHERE id = '5c96debb-697f-4cad-805f-92b518e28343';  -- STUDENT, t
-- School account state
SELECT id, role::text, enabled FROM queue_private.accounts WHERE id = 'b7d9aee8-c54d-455f-9913-a4c4dea0d097';  -- STUDENT, t
-- Staff assignments count
SELECT count(*) FROM queue_private.staff_counter_assignments;         -- Expected: 4
-- Tickets count
SELECT count(*) FROM queue_private.tickets;                           -- Expected: 20
-- Audit events count
SELECT count(*) FROM queue_private.admin_audit_events;                -- Expected: 32
-- MFA factors for target
SELECT count(*) FROM auth.mfa_factors WHERE user_id = '5c96debb-697f-4cad-805f-92b518e28343';  -- Expected: 1
```

### Post-change verification (run after promotion)

```sql
-- Target account state
SELECT id, role::text, enabled FROM queue_private.accounts WHERE id = '5c96debb-697f-4cad-805f-92b518e28343';  -- ADMIN, t
-- School account state (must be unchanged)
SELECT id, role::text, enabled FROM queue_private.accounts WHERE id = 'b7d9aee8-c54d-455f-9913-a4c4dea0d097';  -- STUDENT, t
-- Account count (must be unchanged)
SELECT count(*) FROM queue_private.accounts;                          -- Expected: 42
-- Staff assignments count (must be unchanged)
SELECT count(*) FROM queue_private.staff_counter_assignments;         -- Expected: 4
-- Tickets count (must be unchanged)
SELECT count(*) FROM queue_private.tickets;                           -- Expected: 20
-- Audit events count (should increase by 1)
SELECT count(*) FROM queue_private.admin_audit_events;                -- Expected: 33
-- MFA factors for target (must be unchanged)
SELECT count(*) FROM auth.mfa_factors WHERE user_id = '5c96debb-697f-4cad-805f-92b518e28343';  -- Expected: 1
```

### Frontend tests (run after role change)

```powershell
npm run test:frontend
npm run build
```

### Expected frontend behavior after promotion

1. Sign out and sign back in with Google (`ellasharmaineabeso2004@gmail.com`)
2. `authController.js` reads `my_context` → `role: 'ADMIN'`
3. `workspace` is set to `'admin'`
4. `AuthWorkspace.vue` renders `<AdminDashboard>`
5. Admin Dashboard shows analytics, queue overview, active tickets
6. Staff management tab shows "Staff management is not available yet" (frontend placeholder, expected until migration 007)

---

## 8. What This Procedure Does NOT Do

| Action | Status |
|---|---|
| Apply migration 007 | ❌ Not applied |
| Remove MFA verification | ❌ Not removed |
| Weaken existing security functions | ❌ Not weakened |
| Hardcode ADMIN in Vue | ❌ No email-based role mapping |
| Modify other accounts | ❌ Only target account changed |
| Delete backups | ❌ Not touched |
| Commit or push | ❌ Not done |
| Reset PostgreSQL | ❌ Not reset |
| Recreate Supabase Auth | ❌ Not recreated |
| Affect production database | ❌ Local only |

---

## 9. What Still Requires Future Approval (Not Included)

1. **Migration 007 application** — requires explicit approval (adds MFA/AAL2/operator approval gates)
2. **MFA enrollment** — personal action by account owner
3. **Operator staff approval** — requires trusted database operator
4. **Production ADMIN promotion** — requires all of the above in a production environment
5. **Staff management UI** — requires migration 007 + AdminManagement component wiring
6. **Unverified MFA factor discard** — requires explicit user confirmation

---

## 10. Summary

This plan prepares a narrowly scoped, auditable, and reversible LOCAL DEVELOPMENT role change for the single target account. It:

- Targets ONLY `5c96debb-697f-4cad-805f-92b518e28343` (personal Gmail)
- Leaves the school account (`b7d9aee8-...`) and all 41 other accounts unchanged
- Preserves all 4 staff assignments, 20 tickets, and 32 audit events
- Creates an audit log entry for the promotion
- Provides a complete rollback procedure
- Does not apply migration 007 or weaken security
- Does not affect any production database
- Does not modify any frontend code

**AWAITING EXPLICIT APPROVAL before executing the promotion transaction.**

To approve, respond with: "Approve local dev ADMIN activation for UUID 5c96debb-697f-4cad-805f-92b518e28343"