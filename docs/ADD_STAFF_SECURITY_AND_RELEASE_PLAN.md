# Add Staff Security and Release Plan

**Date:** October 20, 2026
**Branch:** `backend`

---

## 1. Current Security State

### Applied Functions (Retained Database)

| Function | Schema | Type | Authorization | MFA Gate |
|---|---|---|---|---|
| `admin_configuration()` | `queue_api` | Read | ADMIN role | ❌ No (007 unapplied) |
| `set_account()` | `queue_api` | Write | ADMIN role | ❌ No (007 unapplied) |
| `configure_counter()` | `queue_api` | Write | ADMIN role | ❌ No (007 unapplied) |
| `admin_staff_accounts()` | `queue_api` | Read | ADMIN role | ❌ No (007 unapplied) |
| `resolve_staff_google()` | `queue_api` | Read | ADMIN role | ❌ No (007 unapplied) |
| `admin_payors()` | `queue_api` | Read | ADMIN role | ❌ No (007 unapplied) |
| `admin_payor_events()` | `queue_api` | Read | ADMIN role | ❌ No (007 unapplied) |
| `admin_staff_directory()` | `queue_api` | Read | ADMIN role | ❌ No (007 unapplied) |
| `request_staff_access()` | `queue_api` | Write | ADMIN role | ❌ No (007 unapplied) |

### Unapplied Security (Migration 007)

Migration 007 would add:
- `staff_access_approvals` table (RLS-protected, operator-only)
- `require_staff_mfa()` — checks AAL2 + verified MFA factor
- `require_staff_approval()` — checks active operator approval
- `review_staff_access()` — operator-only approval creation
- `revoke_staff_review()` — operator-only approval revocation
- `promote_approved_admin()` — operator-only ADMIN promotion
- Wraps all staff RPCs with MFA/AAL2/approval gates

### Unapplied Activation (Migration 012)

Migration 012 would add:
- `add_verified_staff()` — atomic STUDENT→CASHIER/ADMIN promotion
- Requires migration 007's security gates
- Requires ADMIN + AAL2 + verified MFA + operator approval

---

## 2. Security Architecture

### Current Authorization Model (No Migration 007)

```
ADMIN RPC → lock_actor() → checks role = 'ADMIN' → executes
```

No MFA, no AAL2, no operator approval. ADMIN role alone grants access.

### After Migration 007

```
ADMIN RPC → lock_actor() → require_staff_mfa('ADMIN') → checks:
  1. auth.jwt()->>'aal' = 'aal2'
  2. auth.mfa_factors has verified TOTP factor
  3. staff_access_approvals has active approval (matching identity hash)
  → executes
```

### After Migration 012 (add_verified_staff)

```
add_verified_staff() → lock_actor() → require_staff_mfa('ADMIN') → require_staff_approval()
  → checks AAL2 + verified MFA + operator approval
  → verifies Google identity binding (prevents identity swap)
  → verifies target is STUDENT with no assignments
  → atomically: set_account() + configure_counter()
  → creates audit entry + operation request
```

---

## 3. Safe Deployment Sequence

### Step 1: Enroll MFA for All Privileged Accounts

**Who:** Each account holder personally
**Action:** Sign in with Google → Account security → Scan QR → Enter code
**Accounts:** 12 privileged (7 ADMIN + 5 CASHIER), 6 enabled ADMIN + 1 disabled ADMIN
**Personal ADMIN:** ✅ Already enrolled (1 verified TOTP)

### Step 2: Create Operator Approvals

**Who:** Trusted database operator (postgres session)
**Action:** Call `review_staff_access()` for each privileged account
**Binding:** Exact account UUID + Google identity hash + role + approval reference + expiry

### Step 3: Apply Migration 007

**File:** `supabase/20261019000701_staff_security_corrected.PROPOSED.sql`
**Checksum:** `af77775adcf4861f59fa0eae6eadc73ebeff74cb4e4d3cf3f752f9e841204635`

**Execution:**
1. Begin guarded transaction
2. Verify database target (cluster ID, database name)
3. Apply migration SQL
4. Create personal ADMIN operator approval (bootstrap)
5. Verify all RPCs are wrapped
6. Verify personal ADMIN can access (with AAL2)
7. Verify unprepared accounts are blocked (42501)
8. Verify no account roles changed
9. COMMIT

**Rollback:** If any check fails, ROLLBACK. No partial changes.

### Step 4: Apply Migration 012

**File:** `supabase/20261020001200_admin_staff_activation.PROPOSED.sql`
**Checksum:** `ea741017c1c757b607b678c8e647547ebda92cc25b78714b917fce3b574a8d93`

**Prerequisites:** Migration 007 applied and verified

**Execution:**
1. Begin guarded transaction
2. Verify database target
3. Apply migration 012
4. Verify function exists with correct signature
5. Verify grants (authenticated + postgres)
6. Verify `add_verified_staff()` refuses without 007 (should already be installed)
7. COMMIT

### Step 5: Enable Frontend Activation

**File:** `src/lib/adminActivation.js`
**Change:** `STAFF_ACTIVATION_RELEASED = false` → `true`

**Prerequisites:**
- Migration 007 applied
- Migration 012 applied
- Personal ADMIN verified in browser

**Execution:**
1. Update `adminActivation.js`
2. Update `AdminAddStaff.vue` to enable "Add Staff" button
3. Update frontend to call `add_verified_staff()` instead of `request_staff_access()`
4. Run frontend tests and build
5. Verify with real local ADMIN session

---

## 4. Exact Approval Requirements

### Approval 1: Migration 007 Application

**To approve:** "Approve applying migration 007 with personal ADMIN operator approval bootstrap to local development database"

### Approval 2: Migration 012 Application

**To approve:** "Approve applying migration 012 (add_verified_staff) to local development database"

### Approval 3: Frontend Activation

**To approve:** "Approve enabling Direct Add Staff in the frontend"

---

## 5. Security Impact

### Before Migration 007

- ADMIN role alone grants access to all staff RPCs
- No MFA requirement
- No operator approval requirement
- `admin_staff_directory` and `request_staff_access` bypass even the ADMIN role check (only check role, not MFA)

### After Migration 007

- All staff RPCs require AAL2 + verified MFA + operator approval
- `admin_staff_directory` and `request_staff_access` inherit gates via `admin_configuration()`
- All existing privileged accounts fail closed until prepared
- STUDENT accounts unaffected

### After Migration 012

- `add_verified_staff()` provides atomic, authorized staff promotion
- Requires ADMIN + AAL2 + verified MFA + operator approval
- Verifies Google identity binding (prevents identity swap)
- Uses row locks (prevents concurrent changes)
- Idempotent (same request key returns same result)
- Full audit trail

### No Security Weakening

- No MFA requirements removed
- No approval requirements removed
- No authorization checks weakened
- No service-role credentials exposed
- No public endpoints created
- No client-side role assignment

---

## 6. Rollback Procedures

### Rollback Migration 007

```sql
BEGIN;
-- Restore original RPCs (from migrations 001-006)
-- Drop new table and functions
DROP TABLE IF EXISTS queue_private.staff_access_approvals CASCADE;
DROP FUNCTION IF EXISTS queue_private.google_staff_binding(uuid);
DROP FUNCTION IF EXISTS queue_private.require_staff_approval(uuid, text);
DROP FUNCTION IF EXISTS queue_private.require_staff_mfa(text);
DROP FUNCTION IF EXISTS queue_private.review_staff_access(uuid, text, text, text, text, timestamptz);
DROP FUNCTION IF EXISTS queue_private.revoke_staff_review(text);
DROP FUNCTION IF EXISTS queue_private.promote_approved_admin(uuid, text, text, text, text);
-- Restore original function definitions (rename _core007 back)
-- ... (requires re-running migrations 001-006 or restoring from backup)
COMMIT;
```

**Note:** Rollback requires restoring original function definitions. The migration renames functions (e.g., `admin_configuration` → `admin_configuration_core007`). Rollback would need to reverse these renames. A complete rollback script should be prepared before execution.

### Rollback Migration 012

```sql
BEGIN;
DROP FUNCTION IF EXISTS queue_api.add_verified_staff(uuid, text, text, text, uuid, uuid);
COMMIT;
```

Simple rollback — just drops the function. No data changes to revert (function only).

### Rollback Frontend Activation

```javascript
// src/lib/adminActivation.js
export const STAFF_ACTIVATION_RELEASED = false
```

Simple rollback — just change the flag back to false.

---

## 7. Summary

| Step | Status | Requires Approval |
|---|---|---|
| MFA enrollment (personal ADMIN) | ✅ Complete | Already done |
| MFA enrollment (other 10 accounts) | ❌ Not done | Owner-initiated for each account |
| Operator approvals | ❌ Not created | Trusted database operator |
| Migration 007 | ❌ Not applied | Explicit approval |
| Migration 012 | ❌ Not applied | Explicit approval + 007 |
| Frontend activation | ❌ Disabled | Approval after 007 + 012 |

**The smallest safe sequence is: (1) Enroll MFA for all 10 remaining privileged accounts, (2) Create operator approvals, (3) Apply migration 007, (4) Apply migration 012, (5) Enable frontend activation. Each step requires separate explicit approval.**

**Awaiting your decision on the next step.** The immediate action is MFA enrollment for the remaining 10 privileged accounts. If you'd like to proceed with that, confirm and I'll provide the enrollment instructions. Otherwise, you can approve applying migration 007 first (which will lock out unprepared accounts — not recommended).