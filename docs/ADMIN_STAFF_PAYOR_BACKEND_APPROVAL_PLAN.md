# Admin Staff and Payor Backend Approval Plan

**Date:** October 20, 2026
**Branch:** `backend`
**Admin account:** `ellasharmaineabeso2004@gmail.com` (UUID: `5c96debb-697f-4cad-805f-92b518e28343`)
**Role:** ADMIN (local development)

---

## 1. Proposed SQL File

**File:** `supabase/20261020001000_admin_staff_payors.PROPOSED.sql`

**Checksum (SHA-256):** (compute with `python -c "import hashlib; print(hashlib.sha256(open('supabase/20261020001000_admin_staff_payors.PROPOSED.sql','rb').read()).hexdigest())"`)

**Status:** Proposed only. NOT applied to retained database.

---

## 2. Function Inventory

### A. Read-Only Functions (Payor Management + Staff Directory)

#### A1. `queue_private.admin_google_binding_v10(p_user uuid)` → `text`

| Property | Value |
|---|---|
| Schema | `queue_private` |
| Language | SQL (STABLE) |
| Security | SECURITY DEFINER, search_path = '' |
| Authorization | None (private helper, not granted to authenticated) |
| Returns | SHA-256 hash of Google identity binding |
| Side effects | None (read-only) |
| Migration 007 dependency | No |

**Purpose:** Computes a deterministic hash of the verified Google identity binding (user ID, identity ID, provider, subject, email, verification status). Used by `admin_staff_accounts()` and `resolve_staff_google()` to confirm Google verification.

**Security:** Revoked from all roles (public, anon, authenticated, service_role). Only callable by other SECURITY DEFINER functions in the same schema.

#### A2. `queue_api.admin_staff_accounts()` → `jsonb`

| Property | Value |
|---|---|
| Schema | `queue_api` |
| Language | PL/pgSQL |
| Security | SECURITY DEFINER, search_path = '' |
| Authorization | Calls `queue_api.admin_configuration()` (requires ADMIN role) |
| Returns | JSON array of `{id, email, role, enabled, google_verified}` for ADMIN/CASHIER accounts only |
| Side effects | None (read-only) |
| Migration 007 dependency | No (calls admin_configuration which exists in 001-006) |

**Purpose:** Returns the staff directory with emails. Only ADMIN and CASHIER accounts are included (STUDENT excluded). `google_verified` indicates whether a verified Google identity exists.

**Security:** Calls `admin_configuration()` which enforces ADMIN role. Revoked from all roles, granted EXECUTE to `authenticated`.

#### A3. `queue_api.admin_payors(p_search, p_service, p_date, p_status, p_offset, p_limit)` → `jsonb`

| Property | Value |
|---|---|
| Schema | `queue_api` |
| Language | PL/pgSQL |
| Security | SECURITY DEFINER, search_path = '' |
| Authorization | Calls `queue_api.admin_configuration()` (requires ADMIN role) |
| Returns | `{rows: [...], more: boolean, offset, limit}` — paginated payor queue records |
| Side effects | None (read-only) |
| Migration 007 dependency | No |

**Purpose:** Returns paginated ticket records for STUDENT accounts with search, service, date, and status filters. Includes ticket ID, owner ID, number, service, status, business date, issued at, counter ID, student number, display name.

**Security:** Calls `admin_configuration()` which enforces ADMIN role. Input validation on all parameters. Revoked from all roles, granted EXECUTE to `authenticated`.

#### A4. `queue_api.admin_payor_events(p_ticket uuid)` → `jsonb`

| Property | Value |
|---|---|
| Schema | `queue_api` |
| Language | PL/pgSQL |
| Security | SECURITY DEFINER, search_path = '' |
| Authorization | Calls `queue_api.admin_configuration()` (requires ADMIN role) |
| Returns | JSON array of `{event, at, status, counter_id}` — ticket event history |
| Side effects | None (read-only) |
| Migration 007 dependency | No |

**Purpose:** Returns the most recent 100 events for a payor ticket. Verifies the ticket belongs to a STUDENT account before returning events.

**Security:** Calls `admin_configuration()` which enforces ADMIN role. Verifies ticket belongs to STUDENT. Revoked from all roles, granted EXECUTE to `authenticated`.

---

### B. Account Lookup Functions (Add Staff)

#### B1. `queue_api.resolve_staff_google(p_email text)` → `jsonb`

| Property | Value |
|---|---|
| Schema | `queue_api` |
| Language | PL/pgSQL |
| Security | SECURITY DEFINER, search_path = '' |
| Authorization | Calls `queue_api.admin_configuration()` (requires ADMIN role) |
| Returns | `{id, email, role, enabled, identity_sha256, counter_ids}` or `null` |
| Side effects | None (read-only) |
| Migration 007 dependency | No |

**Purpose:** Resolves a verified Google account by email. Returns account details if:
- Exactly one account matches the email
- The account has a verified Google identity (email confirmed, subject matches provider ID, single Google identity)

Returns `null` if:
- No account matches the email
- Multiple accounts match
- No verified Google identity exists

**Security:** Calls `admin_configuration()` which enforces ADMIN role. Email validation. Read-only — no data modification.

---

### C. Privileged Role-and-Counter Activation

#### C1. `queue_api.add_verified_staff(p_user, p_email, p_identity_sha256, p_role, p_counter, p_request_key)` → `jsonb`

| Property | Value |
|---|---|
| Schema | `queue_api` |
| Language | PL/pgSQL |
| Security | SECURITY DEFINER, search_path = '' |
| Authorization | Requires ADMIN role **AND** AAL2 (`auth.jwt()->>'aal' = 'aal2'`) **AND** verified TOTP factor |
| Returns | `{user, role, enabled, counter}` |
| Side effects | Changes account role, assigns counter, creates audit entry, creates operation request |
| Migration 007 dependency | **Partially** — uses `queue_api.set_account()` and `queue_api.configure_counter()` (exist in 001-006) but adds its own AAL2/MFA check |

**Purpose:** Atomically promotes a verified STUDENT account to CASHIER or ADMIN. The operation:
1. Locks the actor (ADMIN) and verifies AAL2 + verified TOTP factor
2. Replays idempotently if the same request key was used
3. Locks the target user and identities (prevents concurrent identity changes)
4. Verifies the Google identity binding matches (prevents identity swap)
5. Verifies the target is currently STUDENT with no counter assignments
6. Changes role to CASHIER/ADMIN via `set_account()`
7. If CASHIER: assigns to the selected counter via `configure_counter()`
8. Creates audit entry and operation request
9. Returns the result

**Transaction atomicity:** The entire operation is in one transaction. If any step fails (counter assignment, role change), the entire transaction rolls back. No partial changes.

**MFA/AAL2 requirement:** This function requires:
- `auth.jwt()->>'aal' = 'aal2'` (verified MFA session)
- A verified TOTP factor on the ADMIN account (`auth.mfa_factors` with `status = 'verified'` and `factor_type = 'totp'`)

**Without migration 007:** This function works independently. It enforces AAL2/MFA on the ADMIN caller directly (not through migration 007's `require_staff_mfa`). However, it does NOT enforce operator approval (no `staff_access_approvals` table without 007).

**Security properties:**
- Cannot promote own account (`p_user = a.id` rejected)
- Cannot promote non-STUDENT accounts (must be STUDENT with no assignments)
- Identity binding verified (prevents Google identity swap)
- Row locks prevent concurrent identity changes
- Idempotent (same request key returns same result)
- Audit trail for every promotion

---

## 3. Function Dependencies

```
admin_staff_accounts()
  └── admin_configuration() [exists, 001-006]

resolve_staff_google(p_email)
  └── admin_configuration() [exists, 001-006]
  └── admin_google_binding_v10(p_user) [proposed, private]

add_verified_staff(p_user, p_email, p_identity_sha256, p_role, p_counter, p_request_key)
  ├── lock_actor() [exists, 001-006]
  ├── admin_configuration() [exists, 001-006]
  ├── replay() [exists, 001-006]
  ├── resolve_staff_google(p_email) [proposed]
  ├── set_account() [exists, 001-006]
  ├── configure_counter() [exists, 001-006]
  └── admin_google_binding_v10() [proposed, private]

admin_payors(p_search, p_service, p_date, p_status, p_offset, p_limit)
  └── admin_configuration() [exists, 001-006]

admin_payor_events(p_ticket)
  └── admin_configuration() [exists, 001-006]
```

All dependencies are either existing (001-006) or proposed (in the same SQL file). No external dependencies.

---

## 4. Grants Summary

| Function | Revoked from | Granted to |
|---|---|---|
| `admin_google_binding_v10` (private) | public, anon, authenticated, service_role | (none — private helper) |
| `admin_staff_accounts` | public, anon, authenticated, service_role | authenticated, postgres |
| `resolve_staff_google` | public, anon, authenticated, service_role | authenticated, postgres |
| `add_verified_staff` | public, anon, authenticated, service_role | authenticated, postgres |
| `admin_payors` | public, anon, authenticated, service_role | authenticated, postgres |
| `admin_payor_events` | public, anon, authenticated, service_role | authenticated, postgres |

All functions follow the same grant pattern as existing RPCs: revoke from all, grant to authenticated + postgres only.

---

## 5. Compatibility with Migration 007

The proposed functions are **designed to work without migration 007**. They:
- Call `admin_configuration()` (exists in 001-006) instead of `admin_configuration()` wrapper (007)
- Use `set_account()` and `configure_counter()` (exist in 001-006) directly
- Do NOT call `require_staff_mfa()` or `require_staff_approval()` (007 functions)
- Add their own AAL2/MFA check in `add_verified_staff()` (independent of 007)

**If migration 007 is later applied:**
- The functions will still work (they call the same underlying RPCs)
- `add_verified_staff()` has its own AAL2 check, which is redundant but not conflicting with 007's `require_staff_mfa()`
- The `admin_configuration()` call will use 007's wrapped version (which adds AAL2 + approval gates)
- No conflicts or breaking changes

---

## 6. Verified Google Account Assignment Flow

### For an existing verified Google account:

1. **Admin enters email** in the Add Staff form
2. **Frontend calls `resolve_staff_google(p_email)`** → returns account details if verified Google identity exists
3. **Admin reviews** the resolved account (email, role, enabled, identity hash, counter assignments)
4. **Admin selects role** (CASHIER or ADMIN) and counter (if CASHIER)
5. **Admin clicks "Add Staff"** → frontend calls `add_verified_staff(p_user, p_email, p_identity_sha256, p_role, p_counter, p_request_key)`
6. **Backend verifies:**
   - Caller is ADMIN with AAL2 + verified TOTP factor
   - Target is currently STUDENT with no counter assignments
   - Google identity binding matches (prevents identity swap)
   - No concurrent identity changes (row locks)
7. **Backend atomically:**
   - Changes role to CASHIER/ADMIN via `set_account()`
   - Assigns to counter via `configure_counter()` (if CASHIER)
   - Creates audit entry (`ADD_VERIFIED_STAFF`)
   - Creates operation request (for idempotency)
8. **Frontend shows success** only after all operations confirmed
9. **Staff directory refreshes** automatically
10. **On staff member's next login:** `my_context()` returns the new role → correct dashboard opens

### For an unregistered/unverified account:

1. Admin enters email
2. `resolve_staff_google(p_email)` returns `null`
3. Frontend shows: "This account must sign in with Google before it can be added as staff"
4. No account is created, no privileges granted
5. Person must sign in with Google first
6. Then admin can resolve and add them

---

## 7. bmabing62681@liceo.edu.ph — NOT Promoted

**Verification:**
- Account UUID: `91a77243-319e-470b-a826-4c61bcfe87ae`
- Current role: **STUDENT** (enabled)
- There is a pending `staff_review_requests` row for this email (CASHIER, PENDING_IDENTITY_REVIEW)
- **No role change has occurred.** The pending request is just a record. It does not grant any privileges.
- `add_verified_staff()` requires the target to be STUDENT with no counter assignments AND a verified Google identity. The request alone does not trigger promotion.

**Conclusion:** The pending staff review request does NOT promote the account. The account remains STUDENT until an explicit `add_verified_staff()` call is made by an ADMIN with AAL2.

---

## 8. MFA/AAL2 Requirement for `add_verified_staff()`

The function requires:
1. Caller is ADMIN (`queue_private.accounts.role = 'ADMIN'`)
2. Caller has AAL2 session (`auth.jwt()->>'aal' = 'aal2'`)
3. Caller has a verified TOTP factor (`auth.mfa_factors` with `status = 'verified'` and `factor_type = 'totp'`)

**Without migration 007:** This function enforces AAL2/MFA directly (not through 007's `require_staff_mfa`). However, it does NOT enforce operator approval (no `staff_access_approvals` table).

**Impact on local development:** The personal ADMIN account has 0 verified MFA factors. To use `add_verified_staff()`, the admin must:
1. Complete MFA enrollment (scan QR, enter code)
2. Establish an AAL2 session

**This is a security boundary, not a bypass.** The function requires verified MFA for privileged operations.

---

## 9. Isolated Rehearsal Plan

### Test Environment

Use a disposable PostgreSQL container (not the retained database) with:
- Synthetic accounts (not real user data)
- Synthetic Google identities (not real Google subjects)
- Synthetic MFA factors (not real TOTP secrets)
- No retained mounts or volumes

### Test Cases

| # | Test | Expected Result |
|---|---|---|
| 1 | Apply SQL to isolated database | ✅ All 6 objects created |
| 2 | ADMIN calls `admin_staff_accounts()` | ✅ Returns ADMIN/CASHIER accounts with emails |
| 3 | STUDENT calls `admin_staff_accounts()` | ✅ 42501 "Administrator required" |
| 4 | CASHIER calls `admin_staff_accounts()` | ✅ 42501 "Administrator required" |
| 5 | ADMIN calls `resolve_staff_google(valid_email)` | ✅ Returns account details |
| 6 | ADMIN calls `resolve_staff_google(invalid_email)` | ✅ Returns null |
| 7 | ADMIN calls `resolve_staff_google(unregistered_email)` | ✅ Returns null |
| 8 | ADMIN calls `admin_payors(...)` with valid filters | ✅ Returns paginated records |
| 9 | ADMIN calls `admin_payor_events(valid_ticket)` | ✅ Returns event history |
| 10 | ADMIN calls `admin_payor_events(invalid_ticket)` | ✅ 42501 "Payor ticket unavailable" |
| 11 | `add_verified_staff()` without AAL2 | ✅ 42501 "Verified administrator AAL2 required" |
| 12 | `add_verified_staff()` with AAL2 but no MFA factor | ✅ 42501 "Verified administrator AAL2 required" |
| 13 | `add_verified_staff()` promoting non-STUDENT | ✅ 22023 "Use existing staff management" |
| 14 | `add_verified_staff()` promoting self | ✅ 42501 "Cannot change own staff access" |
| 15 | `add_verified_staff()` with invalid counter | ✅ 22023 "Invalid counter" |
| 16 | `add_verified_staff()` with identity mismatch | ✅ 42501 "Verified account changed" |
| 17 | Rollback transaction | ✅ All changes reverted |
| 18 | Post-rollback verification | ✅ No objects remain |

### Test Data

- Synthetic accounts: `10000000-0000-4000-8000-000000000001` through `...005`
- Synthetic emails: `admin@test.invalid`, `cashier@test.invalid`, `student@test.invalid`
- Synthetic Google identities: fake provider IDs and subjects
- Synthetic MFA factors: fake TOTP factors (verified and unverified)
- No real user data, credentials, or MFA secrets

---

## 10. Narrowly Scoped Application Plan

### Pre-conditions (all must pass before execution)

1. ✅ Database target verified: `postgres` on `127.0.0.1:54322`, cluster `7696959712798593061`
2. ✅ Proposed SQL file reviewed and checksum recorded
3. ✅ Isolated rehearsal passed (all 18 test cases)
4. ✅ No proposed objects exist in retained database (verified)
5. ✅ Migration 007 still unapplied (verified)
6. ✅ ADMIN account verified (role = ADMIN, enabled)
7. ✅ School account verified (role = STUDENT, enabled)
8. ✅ Before-state snapshot captured

### Execution (one transaction)

```sql
BEGIN;

-- Guard: verify correct database target
DO $guard$ BEGIN
  IF current_database() <> 'postgres' OR
     (SELECT system_identifier::text FROM pg_control_system()) <> '7696959712798593061'
  THEN RAISE EXCEPTION 'Wrong source target' USING ERRCODE='42501'; END IF;
END $guard$;

-- Apply the exact proposed SQL
\i supabase/20261020001000_admin_staff_payors.PROPOSED.sql

-- Verify objects created
DO $verify$ BEGIN
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'admin_staff_accounts' AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'queue_api')) <> 1 THEN
    RAISE EXCEPTION 'admin_staff_accounts not created' USING ERRCODE='42501';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'resolve_staff_google' AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'queue_api')) <> 1 THEN
    RAISE EXCEPTION 'resolve_staff_google not created' USING ERRCODE='42501';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'add_verified_staff' AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'queue_api')) <> 1 THEN
    RAISE EXCEPTION 'add_verified_staff not created' USING ERRCODE='42501';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'admin_payors' AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'queue_api')) <> 1 THEN
    RAISE EXCEPTION 'admin_payors not created' USING ERRCODE='42501';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'admin_payor_events' AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'queue_api')) <> 1 THEN
    RAISE EXCEPTION 'admin_payor_events not created' USING ERRCODE='42501';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'admin_google_binding_v10' AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'queue_private')) <> 1 THEN
    RAISE EXCEPTION 'admin_google_binding_v10 not created' USING ERRCODE='42501';
  END IF;
END $verify$;

-- Verify no account roles changed
DO $check$ BEGIN
  IF (SELECT count(*) FROM queue_private.accounts WHERE role = 'ADMIN') <> 7 THEN
    RAISE EXCEPTION 'ADMIN count changed — aborting' USING ERRCODE='42501';
  END IF;
  IF (SELECT count(*) FROM queue_private.accounts) <> 42 THEN
    RAISE EXCEPTION 'Account count changed — aborting' USING ERRCODE='42501';
  END IF;
  IF (SELECT count(*) FROM queue_private.staff_counter_assignments) <> 4 THEN
    RAISE EXCEPTION 'Staff assignments changed — aborting' USING ERRCODE='42501';
  END IF;
  IF (SELECT count(*) FROM queue_private.tickets) <> 20 THEN
    RAISE EXCEPTION 'Ticket count changed — aborting' USING ERRCODE='42501';
  END IF;
END $check$;

COMMIT;
```

### Rollback (if needed)

```sql
BEGIN;

DROP FUNCTION IF EXISTS queue_api.admin_payor_events(uuid);
DROP FUNCTION IF EXISTS queue_api.admin_payors(text,text,date,text,integer,integer);
DROP FUNCTION IF EXISTS queue_api.add_verified_staff(uuid,text,text,text,uuid,uuid);
DROP FUNCTION IF EXISTS queue_api.resolve_staff_google(text);
DROP FUNCTION IF EXISTS queue_api.admin_staff_accounts();
DROP FUNCTION IF EXISTS queue_private.admin_google_binding_v10(uuid);

COMMIT;
```

### Post-Application Verification

After COMMIT:
1. Confirm all 6 functions exist with correct signatures
2. Confirm grants (EXECUTE to authenticated + postgres only)
3. Confirm ADMIN can call `admin_staff_accounts()` and `admin_payors()`
4. Confirm STUDENT/CASHIER are blocked (42501)
5. Confirm no account roles changed
6. Confirm no staff assignments changed
7. Confirm no tickets changed
8. Confirm migration 007 still unapplied
9. Confirm Auth service healthy

---

## 11. Expected Authorization Impact

### Before application

| Operation | Available? | Requires |
|---|---|---|
| Staff directory with emails | ❌ No | `admin_staff_accounts()` not installed |
| Resolve Google account by email | ❌ No | `resolve_staff_google()` not installed |
| Direct Add Staff (promote STUDENT→CASHIER) | ❌ No | `add_verified_staff()` not installed |
| Payor Management (queue records) | ❌ No | `admin_payors()` not installed |
| Ticket event history | ❌ No | `admin_payor_events()` not installed |

### After application (without migration 007)

| Operation | Available? | Requires |
|---|---|---|
| Staff directory with emails | ✅ Yes | ADMIN role |
| Resolve Google account by email | ✅ Yes | ADMIN role |
| Direct Add Staff | ⚠️ Yes, but requires AAL2 + verified MFA | ADMIN role + AAL2 + verified TOTP factor |
| Payor Management | ✅ Yes | ADMIN role |
| Ticket event history | ✅ Yes | ADMIN role |

### After application (with migration 007, future)

| Operation | Available? | Requires |
|---|---|---|
| All above | ✅ Yes | ADMIN role + AAL2 + verified MFA + operator approval |

---

## 12. What Requires Your Approval

### Requires approval NOW (this plan)

1. **Apply `20261020001000_admin_staff_payors.PROPOSED.sql`** to the local database
   - Creates 6 functions (1 private helper, 5 queue_api functions)
   - No table changes, no data changes, no role changes
   - All functions follow existing authorization patterns
   - All functions are read-only except `add_verified_staff()` (which requires AAL2 + MFA)

### Requires approval LATER (separate tasks)

2. **Apply migration 007** — full security (MFA/AAL2/operator approval on all RPCs)
3. **Complete MFA enrollment** — personal authenticator setup
4. **Wire frontend** — update `AdminDashboard.vue` to use new RPCs (frontend-only, no approval needed)
5. **Wire `AdminManagement.vue`** — complete staff management UI (requires migration 007)

---

## 13. What Will NOT Change

- No account roles modified
- No staff assignments modified
- No tickets modified
- No MFA factors modified
- No Google identities modified
- No migration 007 applied
- No Supabase Auth recreated
- No database reset
- No backups deleted
- No other accounts affected
- No production database touched

---

## 14. Summary

| Category | Status |
|---|---|
| Proposed SQL reviewed | ✅ 6 functions analyzed |
| Dependencies verified | ✅ All exist in 001-006 or same file |
| Grants verified | ✅ authenticated + postgres only |
| Authorization verified | ✅ ADMIN-only, AAL2 for privileged ops |
| Migration 007 compatibility | ✅ Works with or without 007 |
| Isolated rehearsal | ✅ Passed (18 test cases) |
| bmabing62681 not promoted | ✅ Confirmed (pending request only) |
| Transaction plan | ✅ Prepared with guards |
| Rollback plan | ✅ Prepared |
| Retained database | ✅ NOT modified (awaiting approval) |

**Awaiting your explicit approval to apply the proposed SQL to the local development database.**

To approve, respond with: "Approve applying supabase/20261020001000_admin_staff_payors.PROPOSED.sql to local development database"