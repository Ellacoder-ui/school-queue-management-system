# Direct Add Staff Execution Readiness

**Date:** October 20, 2026
**Branch:** `backend`

---

## Current State

| Item | Status |
|---|---|
| Personal ADMIN role | ADMIN (enabled) |
| Personal MFA factor | 1 verified TOTP |
| AAL2 session | Confirmed active |
| 5 read-only ADMIN functions | Installed |
| Migration 007 | Unapplied |
| Migration 012 (`add_verified_staff`) | Unapplied |
| `STAFF_ACTIVATION_RELEASED` | `false` |
| Frontend Add Staff | Lookup works, activation disabled |
| Auth service | Healthy, Google enabled |

## Exact Approval Requirements

### Step 1: Approve Migration 007

**File:** `supabase/20261019000701_staff_security_corrected.PROPOSED.sql`
**Checksum:** `af77775adcf4861f59fa0eae6eadc73ebeff74cb4e4d3cf3f752f9e841204635`

**Prerequisites:**
- Personal ADMIN has verified MFA ✅
- Personal ADMIN has AAL2 session ✅
- Personal ADMIN operator approval created within same transaction (bootstrap)

**To approve:** "Approve applying migration 007 with personal ADMIN operator approval bootstrap to local development database"

### Step 2: Approve Migration 012

**File:** `supabase/20261020001200_admin_staff_activation.PROPOSED.sql`
**Checksum:** `ea741017c1c757b607b678c8e647547ebda92cc25b78714b917fce3b574a8d93`

**Prerequisites:**
- Migration 007 applied and verified
- Personal ADMIN has AAL2 + verified MFA + operator approval

**To approve:** "Approve applying migration 012 (add_verified_staff) to local development database"

### Step 3: Approve Frontend Activation

**File:** `src/lib/adminActivation.js`
**Change:** `STAFF_ACTIVATION_RELEASED = false` → `true`

**Prerequisites:**
- Migration 007 applied
- Migration 012 applied
- Personal ADMIN verified in browser

**To approve:** "Approve enabling Direct Add Staff in the frontend"

## Execution Sequence (After All Approvals)

1. Apply migration 007 (guarded transaction with bootstrap approval)
2. Verify migration 007 (all RPCs wrapped, personal ADMIN retains access)
3. Apply migration 012 (guarded transaction)
4. Verify migration 012 (function exists, grants correct, authorization enforced)
5. Update frontend (`STAFF_ACTIVATION_RELEASED = true`, enable Add Staff button)
6. Run frontend tests and build
7. Verify with real local ADMIN session (sign in, open Admin Dashboard, test Add Staff)

## Rollback

If any step fails:
- Rollback the entire transaction
- No partial changes
- Restore original function definitions
- Report the discrepancy

## What Direct Add Staff Will Do (After Activation)

1. Admin enters a registered Google email
2. Backend resolves the verified Google account (`resolve_staff_google`)
3. Admin selects role (CASHIER or ADMIN) and counter (if CASHIER)
4. Admin confirms
5. Backend atomically:
   - Changes role to CASHIER/ADMIN (`set_account`)
   - Assigns counter (`configure_counter` for CASHIER)
   - Creates audit entry (`ADD_VERIFIED_STAFF`)
   - Creates operation request (idempotency)
6. Staff directory refreshes
7. On staff member's next login, `my_context()` returns new role → correct dashboard opens

## Remaining Blockers

1. Migration 007 not applied (requires approval)
2. Migration 012 not applied (requires approval + 007)
3. Frontend activation disabled (requires approval after 007 + 012)
4. Personal MFA enrollment ✅ Complete
5. AAL2 session ✅ Confirmed

**Awaiting your explicit approval to proceed with Step 1.**