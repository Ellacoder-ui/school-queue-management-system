# MFA Recovery Options Report

**Date:** October 20, 2026
**Branch:** `backend`
**Account:** `ellasharmaineabeso2004@gmail.com`
**Auth UUID:** `5c96debb-697f-4cad-805f-92b518e28343`
**Role:** ADMIN (local development)

---

## Current State (Read-Only Verified)

| Property | Value |
|---|---|
| Auth UUID | `5c96debb-697f-4cad-805f-92b518e28343` |
| Application role | ADMIN (enabled) |
| Google identity | 1 verified (provider: google) |
| MFA factors | 1 (TOTP, verified) |
| MFA recovery codes | 0 (none enrolled) |
| AAL2 session | Not currently active (AAL1 session exists) |
| TOTP secret access | User cannot generate codes (QR photo too blurry, no working authenticator entry) |

---

## Recovery Options

### Option 1: Admin API (Service Role) — RECOMMENDED

**Mechanism:** Use Supabase's server-side Admin API to delete the verified factor.

```javascript
// Server-side only (Node.js / Supabase Edge Function)
const { data, error } = await supabase.auth.admin.mfa.deleteFactor({
  userId: '5c96debb-697f-4cad-805f-92b518e28343',
  id: 'e2aea9ff-40ed-4aac-942d-087513242686'
})
```

**Requirements:**
- Service role key (server-side only, never in browser)
- Trusted operator execution
- User authorization

**Pros:**
- Supported by Supabase
- Bypasses AAL2 requirement (admin API doesn't require user session)
- Clean removal (factor + challenges + AMR claims cascaded)
- Audit log entry created automatically

**Cons:**
- Requires service role key access (server-side)
- Not available through the browser

### Option 2: Direct Database Deletion (Trusted Operator)

**Mechanism:** Delete the factor row directly from `auth.mfa_factors` as the postgres operator.

```sql
BEGIN;
-- Verify target
SELECT id, factor_type, status FROM auth.mfa_factors
WHERE user_id = '5c96debb-697f-4cad-805f-92b518e28343';

-- Delete factor (cascades to challenges and AMR claims)
DELETE FROM auth.mfa_factors
WHERE user_id = '5c96debb-697f-4cad-805f-92b518e28343'
  AND id = 'e2aea9ff-40ed-4aac-942d-087513242686'
  AND factor_type = 'totp'
  AND status = 'verified';

-- Verify deletion
SELECT count(*) FROM auth.mfa_factors WHERE user_id = '5c96debb-697f-4cad-805f-92b518e28343';

COMMIT;
```

**Requirements:**
- Direct postgres database access (trusted operator)
- User authorization

**Pros:**
- Direct and immediate
- No service role key needed
- Can be done in a guarded transaction with rollback

**Cons:**
- Manual SQL (requires careful verification)
- No automatic audit log entry (must be created manually)
- Bypasses Supabase's internal cleanup logic

### Option 3: Owner-Controlled Unenrollment (NOT Available)

**Mechanism:** Use the frontend's existing "Discard" flow.

**Status:** ❌ NOT AVAILABLE

The frontend's `AccountMfaDialog.vue` only allows discarding **unverified** factors. Verified factors cannot be unenrolled through the UI at AAL1. The user would need AAL2 to unenroll a verified factor, but they can't reach AAL2 without the TOTP code.

This creates a catch-22:
- To unenroll the verified factor → need AAL2
- To reach AAL2 → need TOTP code
- To generate TOTP code → need the factor secret/QR
- The secret/QR is unavailable (photo too blurry, no working authenticator entry)

### Option 4: Recovery Codes (NOT Available)

**Mechanism:** Use pre-enrolled recovery codes to verify MFA instead of TOTP.

**Status:** ❌ NOT AVAILABLE

No recovery codes are enrolled for this account (`auth.mfa_recovery_code_sets` count = 0). Recovery codes must be enrolled at AAL2, which the user cannot reach.

---

## Recommended Recovery Procedure

### Step 1: Authorize Factor Deletion (User Decision)

Choose one of:
- **Option 1** (Admin API) — if service role key is available server-side
- **Option 2** (Direct DB deletion) — if direct postgres access is available

Both require explicit user authorization. Neither is performed automatically.

### Step 2: Delete the Verified Factor

Execute the chosen option with the exact factor ID:
- Factor ID: `e2aea9ff-40ed-4aac-942d-087513242686`
- Factor type: TOTP
- Status: verified
- Owner: `5c96debb-697f-4cad-805f-92b518e28343`

**Safety checks before deletion:**
- Verify factor belongs to target UUID
- Verify factor is the only factor (count = 1)
- Verify account is ADMIN and enabled
- Verify no active tickets or assignments for the account

### Step 3: Verify Factor Deletion

After deletion:
- `auth.mfa_factors` count for target = 0
- `auth.mfa_challenges` count for target = 0
- `auth.mfa_amr_claims` count for target = 0
- Account role remains ADMIN, enabled
- Google identity remains unchanged

### Step 4: Enroll New TOTP Factor

1. User signs in with Google (AAL1)
2. Opens Account security
3. Clicks "Set up authenticator"
4. Scans the QR code with Google Authenticator
5. Enters the six-digit code
6. Verification succeeds → AAL2 session established
7. Factor status becomes "verified"

### Step 5: Verify AAL2

1. Confirm `auth.sessions` has a row with `aal = 'aal2'` for the target UUID
2. Confirm `auth.mfa_factors` has a verified TOTP factor
3. Confirm `auth.mfa_amr_claims` has a row for the session
4. User confirms "This session is verified at AAL2" in the browser

### Step 6: Resume Migration 007

After AAL2 is confirmed:
1. Apply migration 007 with bootstrap approval
2. Verify all security gates
3. Test with real ADMIN session

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Factor deletion fails | Transaction rollback (Option 2) or error handling (Option 1) |
| Wrong factor deleted | Verify factor ID, type, status, owner before deletion |
| Account lockout | Account remains ADMIN/enabled; MFA can be re-enrolled |
| Session invalidation | Sessions associated with deleted factor are downgraded to AAL1 |
| Data loss | Only the factor row is deleted; no account/queue data affected |
| Unauthorized deletion | Requires trusted operator + user authorization |

---

## What Is NOT Available

| Mechanism | Status | Reason |
|---|---|---|
| Frontend unenroll (verified factor) | ❌ Not available | Requires AAL2 (can't reach) |
| Recovery codes | ❌ Not enrolled | Requires AAL2 to enroll |
| Email-based recovery | ❌ Not configured | No email recovery configured |
| Admin API (browser) | ❌ Not available | Requires service role key (server-side only) |

---

## Supported Recovery Mechanisms

| Mechanism | Supabase Support | Available? | Notes |
|---|---|---|---|
| `auth.mfa.unenroll()` (SDK) | ✅ | ❌ | Requires AAL2 for verified factors |
| `auth.admin.mfa.deleteFactor()` (Admin API) | ✅ | ⚠️ Server-side only | Requires service role key |
| Direct SQL deletion | ✅ | ⚠️ Operator only | Requires postgres access |
| Recovery codes | ✅ | ❌ | Not enrolled |
| TOTP secret recovery | ❌ | ❌ | Not supported by Supabase |

---

## Exact Steps Requiring Your Approval

### Approval 1: Factor Deletion

Choose one option:
- **Option 1 (Admin API):** "Authorize deleting the verified TOTP factor for UUID 5c96debb-697f-4cad-805f-92b518e28343 using the service role key"
- **Option 2 (Direct SQL):** "Authorize deleting the verified TOTP factor for UUID 5c96debb-697f-4cad-805f-92b518e28343 via trusted database operator"

### Approval 2: New Factor Enrollment (After Deletion)

"Authorize enrolling a new TOTP factor for UUID 5c96debb-697f-4cad-805f-92b518e28343"

This is performed by the user personally (scan QR, enter code). No agent involvement.

### Approval 3: AAL2 Verification (After Enrollment)

"Authorize verifying AAL2 status for UUID 5c96debb-697f-4cad-805f-92b518e28343"

This is verified read-only through database inspection.

---

## Summary

| Item | Status |
|---|---|
| Current verified TOTP factor | ✅ Exists (cannot generate codes) |
| Recovery codes enrolled | ❌ None |
| Frontend unenroll (verified) | ❌ Not available (requires AAL2) |
| Admin API deletion | ⚠️ Available (server-side, needs authorization) |
| Direct SQL deletion | ⚠️ Available (operator, needs authorization) |
| New enrollment possible | ✅ After factor deletion |
| AAL2 after new enrollment | ✅ Achievable |
| Migration 007 ready | ⚠️ After AAL2 verification |

**The user cannot reach AAL2 with the current factor because the TOTP secret is unavailable. The only supported recovery is factor deletion (via Admin API or direct SQL), followed by new enrollment. Both require explicit user authorization.**

**Awaiting your approval for the recovery procedure.** Choose Option 1 or Option 2. I will not delete any factor without explicit authorization.