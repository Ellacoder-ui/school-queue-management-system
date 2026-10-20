# Direct Add Staff Release Plan

**Date:** October 20, 2026
**Branch:** `backend`
**Admin account:** `ellasharmaineabeso2004@gmail.com` (UUID: `5c96debb-697f-4cad-805f-92b518e28343`)
**Role:** ADMIN (local development, 1 verified TOTP factor, AAL2 confirmed)

---

## 1. Current Implementation Status

### What Works Now

| Feature | Status | Backend |
|---|---|---|
| Admin Dashboard (3 tabs) | ✅ Functional | Frontend + existing RPCs |
| Staff Management (directory, role change, counter assignment) | ✅ Functional | `admin_configuration`, `set_account`, `configure_counter` |
| Add Staff by Email (resolve Google account) | ✅ Functional (lookup only) | `resolve_staff_google` (installed) |
| Add Staff activation (promote to CASHIER/ADMIN) | ❌ Disabled | Requires `add_verified_staff` (not installed) |
| Payor Management (queue records + history) | ✅ Functional | `admin_payors`, `admin_payor_events` (installed) |
| Right-side live queue monitor | ✅ Functional | Realtime (existing) |
| Automatic role-based login routing | ✅ Functional | `my_context()` (existing) |
| MFA enrollment (personal ADMIN) | ✅ Complete | 1 verified TOTP factor |
| AAL2 session | ✅ Confirmed | Active session, aal2 |
| Staff directory with emails | ✅ Functional | `admin_staff_accounts()` (installed) |

### What Requires Approval

| Item | Status | Requires |
|---|---|---|
| Migration 007 (staff security) | ❌ Unapplied | Explicit approval |
| `add_verified_staff()` (Direct Add Staff) | ❌ Not installed | Explicit approval + migration 007 |
| Frontend activation enablement | ❌ Disabled | `STAFF_ACTIVATION_RELEASED = false` |

---

## 2. Migration 007 Impact Analysis

### Objects Created

**New table:**
- `queue_private.staff_access_approvals` — RLS-protected, operator-only approval register
  - Columns: id, account_id, staff_role, identity_sha256, approval_reference, approved_by, approved_at, expires_at, revoked_at
  - Constraints: unique approval_reference, 30-day max expiry, identity hash format (64 hex chars)

**New functions (private, operator-only):**
- `queue_private.google_staff_binding(p_user)` — SHA-256 hash of verified Google identity
- `queue_private.require_staff_approval(p_user, p_role)` — checks active approval exists
- `queue_private.require_staff_mfa(p_role)` — checks AAL2 + verified MFA factor + approval
- `queue_private.review_staff_access(...)` — operator-only approval creation
- `queue_private.revoke_staff_review(p_reference)` — operator-only approval revocation
- `queue_private.promote_approved_admin(...)` — operator-only ADMIN promotion

**Modified functions (wrapped with MFA/approval gates):**
- `queue_api.admin_configuration()` → now calls `require_staff_mfa('ADMIN')`
- `queue_api.set_account()` → now calls `require_staff_mfa('ADMIN')` + `require_staff_approval(p_user, p_role)`
- `queue_api.configure_counter()` → now calls `require_staff_mfa('ADMIN')` + `require_staff_approval(x, 'CASHIER')`
- `queue_api.configure_service()` → now calls `require_staff_mfa('ADMIN')`
- `queue_api.manage_day()` → now calls `require_staff_mfa('ADMIN')`
- `queue_api.call_next()` → now calls `require_staff_mfa('CASHIER')`
- `queue_api.finish_ticket()` → now calls `require_staff_mfa('CASHIER')`
- `queue_api.staff_queue()` → now calls `require_staff_mfa(current role)`

### MFA/AAL2 Requirements (After 007)

- **Every** staff RPC requires `auth.jwt()->>'aal' = 'aal2'`
- **Every** staff RPC requires a verified TOTP factor (`auth.mfa_factors` with `status='verified'`)
- **Every** staff RPC requires an active operator approval (`staff_access_approvals` with matching identity hash, not revoked, not expired)

### Operator-Approval Requirements

- Approvals created only by `session_user = 'postgres'` (direct database operator)
- Approval bound to: exact account UUID, intended role, verified Google identity hash
- Approval reference: unique, 1-200 characters
- Approval expires: 1-30 days (configurable)
- Approval can be revoked by reference
- No browser/API writes (RLS + revoke all from public/anon/authenticated/service_role)

### Effect on Current Accounts

**Privileged accounts (12 total):**

| Account | Email | Role | Enabled | Google ID | MFA Factor | After 007 |
|---|---|---|---|---|---|---|
| Personal ADMIN | ellasharmaineabeso2004@gmail.com | ADMIN | Yes | 1 | 1 verified | ✅ Retains access |
| Test ADMIN (6) | *.example.invalid | ADMIN | Yes (5), No (1) | 0 | ❌ Locked out |
| Test CASHIER (5) | *.example.invalid | CASHIER | Yes | 0 | ❌ Locked out |

**STUDENT accounts (30):** Unaffected. `issue_ticket` and student dashboard remain functional.

### Effect on Call Next, Skip and Serve

After migration 007:
- `call_next()` requires `require_staff_mfa('CASHIER')` → AAL2 + verified MFA + operator approval
- `finish_ticket()` requires `require_staff_mfa('CASHIER')` → same
- `staff_queue()` requires `require_staff_mfa(current role)` → same

**Result:** No cashier can perform any queue operation until they have:
1. Verified MFA factor
2. AAL2 session
3. Active operator approval

### Administrative Lockout Risk

**HIGH RISK if applied without preparation.** Applying migration 007 without preparation would:
- Lock out 5 of 6 enabled ADMINs (all except personal ADMIN)
- Lock out all 5 CASHIERs
- Prevent all queue operations (Call Next, Serve, Skip)
- Prevent staff management (set_account, configure_counter)
- Prevent queue day management

**Mitigation:** The personal ADMIN (with verified MFA) retains access. But this creates a single point of failure.

### Existing Cashier Service Impact

| Cashier | Counter | MFA | Google ID | After 007 (unprepared) |
|---|---|---|---|---|
| 3c08ca87 (test) | Counter 1 (TP), Counter 2 (SOA) | 0 | 0 | ❌ Locked out |
| 92a2d664 (test) | Counter 5 (ADJ) | 0 | 0 | ❌ Locked out |
| 97b0561d (test) | None | 0 | 0 | ❌ Locked out |
| 1abe1490 (test) | None | 0 | 0 | ❌ Locked out |
| df7361b6 (test) | None | 0 | 0 | ❌ Locked out |

**Note:** All 5 CASHIER accounts are synthetic test accounts (no Google identities, no MFA). They are not legitimate operators. The personal ADMIN is the only real operator.

### Which Accounts Are Test vs Legitimate

Based on evidence from the database:
- **Personal ADMIN** (`ellasharmaineabeso2004@gmail.com`): Has verified Google identity, MFA factor, AAL2 session. This is the **only legitimate operator**.
- **All other 11 privileged accounts**: Have `@example.invalid` emails, 0 Google identities, 0 MFA factors. These are **synthetic test accounts** created during automated testing. They have no real Google bindings and cannot be prepared for migration 007.

**Conclusion:** Only the personal ADMIN account can be prepared for migration 007. The 10 test accounts will be locked out (which is acceptable since they are test accounts).

---

## 3. Migration 012 (add_verified_staff) Analysis

### Function Signature

```sql
queue_api.add_verified_staff(
  p_user uuid,
  p_email text,
  p_identity_sha256 text,
  p_role text,
  p_counter uuid,
  p_request_key uuid
) → jsonb
```

### Security Checks (in order)

1. **Operator check:** `lock_actor()` — caller must be ADMIN
2. **Migration 007 check:** `require_staff_mfa()` and `require_staff_approval()` must exist (refuses if 007 not applied)
3. **AAL2 check:** `auth.jwt()->>'aal' = 'aal2'`
4. **MFA factor check:** Verified TOTP factor on ADMIN account
5. **Self-change prevention:** `p_user ≠ a.id`
6. **Role validation:** `p_role IN ('ADMIN', 'CASHIER')`
7. **Counter validation:** CASHIER requires counter, ADMIN requires no counter
8. **Replay check:** Idempotent (same request key returns same result)
9. **Identity lock:** `FOR UPDATE` on auth.users, `FOR SHARE` on auth.identities
10. **Google identity verification:** `resolve_staff_google()` must return matching account
11. **Target state check:** Must be STUDENT with no counter assignments
12. **Counter validation:** Counter must exist (if CASHIER)
13. **Atomic execution:** `set_account()` + `configure_counter()` in one transaction
14. **Audit:** `ADD_VERIFIED_STAFF` entry in admin_audit_events
15. **Operation request:** Idempotency receipt

### Dependencies

- **Requires migration 007** — checks `to_regprocedure('queue_private.require_staff_mfa(text)')` and `to_regprocedure('queue_private.require_staff_approval(uuid,text)')` exist
- **Requires 5 read-only functions** — calls `admin_configuration()`, `resolve_staff_google()`, `set_account()`, `configure_counter()`
- **Requires verified MFA on ADMIN** — AAL2 + TOTP factor
- **Requires operator approval** — ADMIN must have active approval in `staff_access_approvals`

### Transaction Atomicity

The entire operation is in one transaction:
- Role change (`set_account`)
- Counter assignment (`configure_counter` for CASHIER)
- Audit entry
- Operation request (idempotency)

If any step fails, the entire transaction rolls back. No partial changes.

### Idempotency

Uses `queue_private.replay()` with the request key. If the same request key is replayed, the original result is returned without re-executing.

### Audit Logging

Creates `ADD_VERIFIED_STAFF` entry in `admin_audit_events` with:
- Actor ID (ADMIN)
- Action: `ADD_VERIFIED_STAFF`
- Parameters: user, email, identity_sha256, role, counter

### Counter Conflict Handling

- CASHIER requires a valid counter (must exist in `queue_private.counters`)
- Counter assignment adds the new cashier to the existing counter's cashiers
- If counter assignment fails, the entire transaction rolls back (including role change)

### Automatic Role-Based Dashboard Routing

After `add_verified_staff()` succeeds:
- Target account's role is changed to CASHIER/ADMIN in `queue_private.accounts`
- On next login, `my_context()` returns the new role
- `authController.js` routes to the appropriate dashboard (cashier/admin)
- No frontend role-selection screen
- No email-based override

### Checksum

| File | SHA-256 |
|---|---|
| `supabase/20261020001200_admin_staff_activation.PROPOSED.sql` | `ea741017c1c757b607b678c8e647547ebda92cc25b78714b917fce3b574a8d93` |

---

## 4. Safe Transition Plan

### Phase 1: Prepare Existing Operators (Before Migration 007)

**Step 1.1 — Personal ADMIN MFA enrollment: ✅ COMPLETE**
- Personal ADMIN has 1 verified TOTP factor
- AAL2 session confirmed
- No further action needed

**Step 1.2 — Enroll MFA for other privileged accounts (if needed)**

Read-only inspection reveals that **all 10 other privileged accounts are synthetic test accounts**:
- Emails end in `@example.invalid`
- 0 Google identities (no verified Google binding)
- 0 MFA factors
- Cannot be prepared for migration 007 (no Google identity to bind approval to)

These accounts **cannot** receive operator approvals because `review_staff_access()` requires a verified Google identity hash. They will be locked out after migration 007 (which is acceptable for test accounts).

**Minimum legitimate operator set: 1 (personal ADMIN only).**

**Step 1.3 — Create operator approval (personal ADMIN only)**

The personal ADMIN's operator approval can be created **within the same transaction as migration 007** (bootstrap approach). This avoids a lockout window:

```sql
BEGIN;
-- Apply migration 007 (creates table + functions + wraps RPCs)
\i supabase/20261019000700_staff_security.PROPOSED.sql

-- Create operator approval for personal ADMIN (as postgres operator)
SELECT queue_private.review_staff_access(
  '5c96debb-697f-4cad-805f-92b518e28343',
  'ellasharmaineabeso2004@gmail.com',
  '0fa3fe400dbd117642d5cb7eb89bfed7471e6ef447e59bfc8ac8426001e39701',
  'ADMIN',
  'LOCAL_DEV_ADMIN_APPROVAL_001',
  clock_timestamp() + interval '30 days'
);

-- Verify before COMMIT
COMMIT;
```

Because everything is in one transaction, the new security gates only become effective after COMMIT. The approval is created before the gates take effect. This prevents a lockout window for the personal ADMIN.

**No other accounts need preparation** — they are synthetic test accounts that will be locked out (which is acceptable).

### Phase 2: Apply Migration 007

**Pre-conditions:**
- All 11 privileged accounts have verified MFA factors
- All 11 privileged accounts have active operator approvals
- Personal ADMIN has AAL2 session

**Execution:**
1. Apply `20261019000700_staff_security.PROPOSED.sql` in a single transaction
2. Verify all RPCs are wrapped with MFA/approval gates
3. Verify all privileged accounts can still access their functions (with AAL2)
4. Verify STUDENT accounts are unaffected

**Risk:** If any privileged account doesn't have MFA/approval, they are locked out. The personal ADMIN (with MFA) retains access.

### Phase 3: Apply Migration 012

**Pre-conditions:**
- Migration 007 applied and verified
- Personal ADMIN has AAL2 + verified MFA + operator approval
- `add_verified_staff()` function reviewed

**Execution:**
1. Apply `20261020001200_admin_staff_activation.PROPOSED.sql`
2. Verify function exists with correct signature
3. Verify grants (authenticated + postgres)
4. Test with synthetic accounts in isolated environment

### Phase 4: Enable Frontend Activation

**Pre-conditions:**
- Migration 007 applied
- Migration 012 applied
- Personal ADMIN verified in browser

**Execution:**
1. Set `STAFF_ACTIVATION_RELEASED = true` in `src/lib/adminActivation.js`
2. Update `AdminAddStaff.vue` to enable "Add Staff" button and call `add_verified_staff()`
3. Update frontend to call `add_verified_staff()` instead of `request_staff_access()`
4. Run frontend tests and build
5. Verify with real local ADMIN session

---

## 5. Administrative Lockout Prevention

### Before Migration 007

| Account | Access |
|---|---|
| Personal ADMIN | ✅ Full access (MFA enrolled) |
| 5 other ADMINs | ✅ Full access (no MFA required yet) |
| 5 CASHIERs | ✅ Full access (no MFA required yet) |
| 30 STUDENTs | ✅ Student dashboard only |

### During Migration 007 (without preparation)

| Account | Access |
|---|---|
| Personal ADMIN | ✅ Full access (has MFA + AAL2) |
| 5 other ADMINs | ❌ **LOCKED OUT** (no MFA) |
| 5 CASHIERs | ❌ **LOCKED OUT** (no MFA) |
| 30 STUDENTs | ✅ Unchanged |

### During Migration 007 (with preparation)

| Account | Access |
|---|---|
| Personal ADMIN | ✅ Full access (has MFA + AAL2 + approval) |
| Other prepared ADMINs | ✅ Full access (has MFA + AAL2 + approval) |
| Other prepared CASHIERs | ✅ Full access (has MFA + AAL2 + approval) |
| Unprepared accounts | ❌ Locked out (fail closed) |
| 30 STUDENTs | ✅ Unchanged |

### Lockout Prevention Strategy

1. **Prepare first, apply second** — Enroll MFA and create approvals BEFORE applying 007
2. **Phased rollout** — Apply 007 only after all privileged accounts are prepared
3. **Personal ADMIN as fallback** — The personal ADMIN (with MFA) retains access to manage accounts even if others are locked out
4. **No automatic retry** — If an account is locked out, manual operator intervention is required
5. **Rollback available** — Migration 007 can be rolled back (restore original functions)

---

## 6. Existing Cashier Continuity Plan

### Current state (before 007)

- 5 CASHIER accounts, all enabled, 0 MFA factors
- All can perform Call Next, Skip, Serve
- All can view staff_queue

### After 007 (without preparation)

- All 5 CASHIERs locked out
- No queue operations possible
- Students can still issue tickets (issue_ticket doesn't require staff role)

### After 007 (with preparation)

- Prepared CASHIERs can continue working (with AAL2 session)
- Unprepared CASHIERs are locked out
- Queue operations continue for prepared cashiers

### Continuity Strategy

1. **Enroll MFA for all cashiers first** — each cashier signs in, scans QR, verifies code
2. **Create operator approvals** — trusted operator calls `review_staff_access()` for each cashier
3. **Apply 007** — all prepared cashiers retain access
4. **Unprepared cashiers** — can be prepared later without affecting the system

---

## 7. Isolated Testing Plan

### Test Environment

- Disposable PostgreSQL container (not retained database)
- Synthetic accounts, Google identities, MFA factors
- No real user data, credentials, or MFA secrets
- Separate network, no host ports, tmpfs data

### Test Cases

| # | Test | Expected Result |
|---|---|---|
| 1 | Apply 007 to isolated DB | ✅ All objects created |
| 2 | ADMIN with MFA+AAL2 can call admin_configuration() | ✅ Returns data |
| 3 | ADMIN without MFA cannot call admin_configuration() | ✅ 42501 |
| 4 | ADMIN without AAL2 cannot call admin_configuration() | ✅ 42501 |
| 5 | ADMIN without approval cannot call admin_configuration() | ✅ 42501 |
| 6 | CASHIER with MFA+AAL2+approval can call staff_queue() | ✅ Returns data |
| 7 | CASHIER without MFA cannot call staff_queue() | ✅ 42501 |
| 8 | CASHIER can call call_next() | ✅ Works |
| 9 | CASHIER can call finish_ticket() | ✅ Works |
| 10 | STUDENT cannot call any staff RPC | ✅ 42501 |
| 11 | Disabled ADMIN cannot call any staff RPC | ✅ 42501 |
| 12 | Revoked approval blocks access | ✅ 42501 |
| 13 | Expired approval blocks access | ✅ 42501 |
| 14 | Apply 012 to isolated DB (with 007) | ✅ Function created |
| 15 | add_verified_staff() without AAL2 | ✅ 42501 |
| 16 | add_verified_staff() with AAL2 but no MFA | ✅ 42501 |
| 17 | add_verified_staff() without operator approval | ✅ 42501 |
| 18 | add_verified_staff() promoting non-STUDENT | ✅ 22023 |
| 19 | add_verified_staff() promoting self | ✅ 42501 |
| 20 | add_verified_staff() with invalid counter | ✅ 22023 |
| 21 | add_verified_staff() with identity mismatch | ✅ 42501 |
| 22 | add_verified_staff() success (STUDENT→CASHIER) | ✅ Role changed, counter assigned |
| 23 | add_verified_staff() success (STUDENT→ADMIN) | ✅ Role changed, no counter |
| 24 | add_verified_staff() idempotency (same request key) | ✅ Returns original result |
| 25 | add_verified_staff() atomic rollback (counter failure) | ✅ Role change rolled back |
| 26 | add_verified_staff() without 007 installed | ✅ 42501 |
| 27 | Role-based dashboard routing after promotion | ✅ CASHIER→CashierDashboard, ADMIN→AdminDashboard |
| 28 | Student ticket issuance still works | ✅ Unchanged |
| 29 | Cashier Call/Skip/Serve still works | ✅ Unchanged |
| 30 | All 5 counter mappings preserved | ✅ 1:TP, 2:SOA, 3:PNEP, 4:REF, 5:ADJ |
| 31 | Rollback 007 + 012 | ✅ All changes reverted |
| 32 | Post-rollback verification | ✅ No objects remain |

### Test Data

- Synthetic accounts: `10000000-0000-4000-8000-000000000001` through `...005`
- Synthetic emails: `admin@test.invalid`, `cashier@test.invalid`, `student@test.invalid`
- Synthetic Google identities: fake provider IDs and subjects
- Synthetic MFA factors: fake TOTP factors (verified and unverified)
- No real user data, credentials, or MFA secrets

---

## 8. Frontend Readiness

### Current State

| Component | Uses | Backend Status | UI State |
|---|---|---|---|
| `AdminDashboard.vue` | `admin_configuration()` | ✅ Available | Functional |
| `AdminAddStaff.vue` | `resolve_staff_google()`, `add_verified_staff()` | ⚠️ Lookup available, activation not | Lookup works, activation disabled |
| `AdminPayors.vue` | `admin_payors()`, `admin_payor_events()` | ✅ Available | Functional |

### Frontend Changes Needed After Backend Installation

1. **Set `STAFF_ACTIVATION_RELEASED = true`** in `src/lib/adminActivation.js`
2. **Update `AdminAddStaff.vue`** to enable "Add Staff" button and call `add_verified_staff()`
3. **Update `AdminDashboard.vue`** to use `admin_staff_accounts()` for email display
4. **Update `AdminPayors.vue`** to call `admin_payors()` and `admin_payor_events()`
5. **Run frontend tests and build**

These are frontend-only changes. No database modifications required.

---

## 9. Retained Data Preservation

### Current State (read-only verified)

| Item | Value |
|---|---|
| Total accounts | 42 |
| Personal ADMIN role | ADMIN (enabled) |
| School account role | STUDENT (enabled) |
| Second school account | STUDENT (enabled) |
| Staff assignments | 4 |
| Tickets | 20 |
| Audit events | 34 |
| MFA factors (personal) | 1 (verified) |
| Google identities (personal) | 1 |
| Migration 007 | Unapplied |
| `add_verified_staff` | Not installed |
| 5 read-only functions | Installed |
| Auth service | Healthy |

### After Migration 007 + 012 (expected)

| Item | Expected |
|---|---|
| Total accounts | 42 (unchanged) |
| Personal ADMIN role | ADMIN (unchanged) |
| School accounts | STUDENT (unchanged) |
| Staff assignments | 4 (unchanged, unless new assignments made) |
| Tickets | 20 (unchanged) |
| Audit events | 34+ (new entries for approvals and promotions) |
| MFA factors | 1+ (existing + new enrollments) |
| Migration 007 | Applied |
| `add_verified_staff` | Installed |
| 5 read-only functions | Still installed |

---

## 10. Exact Approval Requirements

### Approval 1: Migration 007 Application

**Original file:** `supabase/20261019000700_staff_security.PROPOSED.sql`
**Original checksum:** `b22d63d24c991b9ebf0d380d27a716d5ea72e418f5e62e177c96dded4481222c`

**Corrected file (recommended):** `supabase/20261019000701_staff_security_corrected.PROPOSED.sql`
**Corrected checksum:** `af77775adcf4861f59fa0eae6eadc73ebeff74cb4e4d3cf3f752f9e841204635`

**Correction:** The corrected version removes internal BEGIN/COMMIT (for transaction safety) and fixes two legacy endpoints (`admin_staff_directory` and `request_staff_access`) by adding `perform queue_api.admin_configuration()` to inherit 007's MFA/AAL2/operator-approval gates.

**Prerequisites:**
- Personal ADMIN has verified MFA factor ✅ (already enrolled)
- Personal ADMIN has AAL2 session ✅ (already confirmed)
- Personal ADMIN operator approval created within the same transaction (bootstrap)
- All other privileged accounts are synthetic test accounts (will be locked out — acceptable)

**To approve:** "Approve applying migration 007 with personal ADMIN operator approval bootstrap to local development database"

**Prerequisites:**
- Personal ADMIN has verified MFA factor ✅ (already enrolled)
- Personal ADMIN has AAL2 session ✅ (already confirmed)
- Personal ADMIN operator approval created within the same transaction (bootstrap)
- All other privileged accounts are synthetic test accounts (will be locked out — acceptable)

**Bootstrap approach:** Migration 007 and the personal ADMIN's operator approval are created in the same guarded transaction. The security gates only become effective after COMMIT, by which point the approval already exists.

**To approve:** "Approve applying migration 007 with personal ADMIN operator approval bootstrap to local development database"

### Approval 2: Migration 012 Application

**File:** `supabase/20261020001200_admin_staff_activation.PROPOSED.sql`
**Checksum:** `ea741017c1c757b607b678c8e647547ebda92cc25b78714b917fce3b574a8d93`

**Prerequisites:**
- Migration 007 applied and verified
- Personal ADMIN has AAL2 + verified MFA + operator approval

**To approve:** "Approve applying migration 012 (add_verified_staff) to local development database"

### Approval 3: Frontend Activation

**File:** `src/lib/adminActivation.js`
**Change:** `STAFF_ACTIVATION_RELEASED = false` → `true`

**Prerequisites:**
- Migration 007 applied
- Migration 012 applied
- Personal ADMIN verified in browser

**To approve:** "Approve enabling Direct Add Staff in the frontend"

---

## 11. Recommended Next Step

**Only the personal ADMIN account needs to be prepared.** All other 10 privileged accounts are synthetic test accounts with no Google identities or MFA factors. They cannot be prepared and will be locked out after migration 007 (which is acceptable for test accounts).

The immediate next step is to **apply migration 007 with the personal ADMIN's operator approval in a single guarded transaction** (bootstrap approach). This:

1. Applies migration 007 (creates approval table + security gates)
2. Creates an operator approval for the personal ADMIN
3. Verifies before COMMIT
4. Result: personal ADMIN retains access, all test accounts locked out

**Personal ADMIN is already prepared** (verified MFA + AAL2 + Google identity). No MFA enrollment is needed for other accounts.

After migration 007 is applied and verified, apply migration 012 (`add_verified_staff()`) in a separate guarded transaction.

Then enable frontend activation (`STAFF_ACTIVATION_RELEASED = true`).

---

## 12. Summary

| Category | Status |
|---|---|
| Personal MFA enrollment | ✅ Complete (1 verified TOTP) |
| AAL2 session | ✅ Confirmed |
| Migration 007 impact analysis | ✅ Complete |
| Migration 012 security review | ✅ Complete |
| Bootstrap approval plan | ✅ Prepared (same-transaction approach) |
| Lockout prevention plan | ✅ Prepared |
| Cashier continuity plan | ✅ Prepared (only personal ADMIN is real operator) |
| Isolated test plan | ✅ 32 test cases defined |
| Frontend readiness | ✅ Prepared (activation disabled) |
| Retained data preservation | ✅ Verified |
| Migration 007 applied | ❌ Not applied (awaiting approval) |
| Migration 012 applied | ❌ Not applied (awaiting approval) |
| Direct Add Staff enabled | ❌ Disabled (awaiting approval) |

**The safe deployment sequence is: (1) Apply migration 007 with personal ADMIN operator approval bootstrap, (2) Apply migration 012, (3) Enable frontend activation. Steps 1 and 2 require separate explicit approval.**

**Correction from previous version:** Only the personal ADMIN account needs preparation. All other 10 privileged accounts are synthetic test accounts with no Google identities or MFA. They will be locked out after migration 007 (acceptable). No MFA enrollment is needed for test accounts.

**Awaiting your decision on the next step.** The immediate action is to approve applying migration 007 with the bootstrap approach. If approved, I will execute the guarded transaction.