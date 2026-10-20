# MFA Enrollment Access Fix Report

**Date:** October 19, 2026
**Branch:** `backend`
**Target account:** `ellasharmaineabeso2004@gmail.com` (UUID: `5c96debb-697f-4cad-805f-92b518e28343`)

---

## Problem

The recent Student/Payor navigation cleanup (removing Account security from the normal Student nav) inadvertently blocked the intended ADMIN account from accessing MFA enrollment. The account is still STUDENT and must complete MFA enrollment before its approved promotion to ADMIN.

## Solution

### Secure MFA Enrollment Entry Point

**Route:** `/account/security`

**URL:** `http://127.0.0.1:5173/account/security`

This is a separate, intentional, authenticated route that does not appear in normal Student/Payor navigation. It provides access to the existing Account security MFA enrollment flow while preserving the clean Student dashboard.

### How it works

1. User navigates to `/account/security` (intentional action — not auto-opened)
2. If not authenticated, the login page is shown (Google Sign-In)
3. If authenticated, a minimal "Account security" page is shown with:
   - The verified authenticated UUID (for verification before enrollment)
   - A button to open the MFA dialog (not auto-opened)
   - Sign out button
   - "Back to dashboard" link
4. The existing `AccountMfaDialog` component is reused (no new MFA logic)
5. The existing `useAccountMfa` composable handles all MFA operations with existing authorization checks
6. The MFA dialog is not automatically opened — the user must click "Open authenticator security"

### Files modified

| File | Change |
|---|---|
| `src/App.vue` | Added `isAccountSecurityPath` check for `/account/security` route; passes `mfaMode` prop |
| `src/components/QueueApplication.vue` | Added `mfaMode` prop; passes it and `actor` to AuthWorkspace |
| `src/components/AuthWorkspace.vue` | Added `mfaMode` and `actor` props; shows Account security button for STUDENT when `mfaMode` is true; displays MFA mode banner with verified UUID |

### What was NOT changed

- No changes to `AccountMfaDialog.vue` (reused as-is)
- No changes to `useAccountMfa.js` (reused as-is)
- No changes to MFA backend logic
- No changes to auth controller or role routing
- No database modifications
- No migration applications
- No role changes

---

## Existing MFA Factor State (DO NOT AUTO-DELETE)

A query of `auth.mfa_factors` for the target account revealed:

| Field | Value |
|---|---|
| Factor ID | `41c29861-e329-42df-9207-7bc0a0045d90` |
| Friendly name | "Cashier Queue account" |
| Factor type | TOTP |
| Status | **unverified** (unfinished setup) |
| Created | 2026-10-19 10:46:50 UTC |

**This unfinished authenticator setup exists from a prior enrollment attempt.**

### Important notes about this factor

- It is **unverified** — scanning the QR and entering a code was never completed
- The QR code and setup key **cannot be recovered** after closing (per the MFA interface design)
- If you never scanned the QR, you can request a **reviewed discard** through the MFA dialog (requires explicit confirmation)
- If you did scan it, you can **resume verification** using the "Finish existing authenticator setup" button
- **No automatic deletion or replacement** occurs — the MFA interface never creates duplicate factors or removes unfinished setups without explicit user action

### To complete enrollment with this existing factor

1. Navigate to `http://127.0.0.1:5173/account/security`
2. Sign in with Google (`ellasharmaineabeso2004@gmail.com`)
3. Click "Open authenticator security"
4. The MFA dialog will show the unfinished setup
5. If you scanned the QR: click "Finish existing authenticator setup" and enter the current code
6. If you never scanned it: click "I never scanned it — review discard" (requires explicit confirmation)

**Separate approval is required before discarding this factor.** I will not delete or replace it.

---

## Test Results

### Frontend tests — all passing

| Test file | Result |
|---|---|
| `tests/frontend/authWorkspace.test.js` | 16/16 passed |
| `tests/frontend/accountMfa.test.js` | 19/19 passed |
| `tests/frontend/workspaceViews.test.js` | 6/6 passed |
| `tests/frontend/publicBoard.test.js` | 11/11 passed |
| **Total** | **52/52 passed** |

### New tests added

| Test | Description | Result |
|---|---|---|
| `mfa-mode path exposes account security for student without auto-opening dialog` | Verifies Account security button appears for STUDENT when mfaMode is true, MFA dialog is NOT auto-opened, verified UUID is displayed, sign-out is present | ✅ Pass |
| `mfa-mode path preserves five service cards and live monitor for student` | Verifies the five service cards and live monitor remain visible on the MFA enrollment page | ✅ Pass |

### Existing tests verified (no regressions)

| Test | Description | Result |
|---|---|---|
| `student navigation keeps logout only and removes redundant display/access/security links` | Student nav no longer shows Account security (normal mode) | ✅ Pass |
| `cashier and administrator retain account security navigation` | CASHIER and ADMIN still see Account security | ✅ Pass |
| `cashier and administrator retain their navigation and access-refresh controls` | All nav controls present for non-STUDENT | ✅ Pass |
| `product login contains exactly one Google entry and no password/signup/role selection` | Login flow unchanged | ✅ Pass |
| `pending session verification shows a neutral loading view` | Loading states unchanged | ✅ Pass |

### Production build

```
npm run build → ✓ built in 4.38s
```

---

## Verification Checklist

| Requirement | Status |
|---|---|
| Clean Student/Payor Dashboard preserved | ✅ Five service cards, live monitor, sticky ticket unchanged |
| Account security hidden from normal Student nav | ✅ Not visible unless on `/account/security` route |
| Separate intentional MFA enrollment entry point | ✅ `/account/security` route |
| Authenticated (requires sign-in) | ✅ Shows login page if not signed in |
| Uses existing Supabase MFA components | ✅ Reuses `AccountMfaDialog` and `useAccountMfa` |
| Verifies authenticated UUID before enrollment | ✅ UUID displayed in banner; MFA scope pins actor internally |
| No ADMIN grant through frontend | ✅ No email-to-role mapping; role comes from `my_context` |
| MFA dialog not auto-opened | ✅ Phase starts as 'closed'; user clicks button |
| No duplicate/unfinished factors created | ✅ MFA interface never auto-creates factors |
| Google Sign-In preserved | ✅ Login flow unchanged |
| Automatic role-based routing preserved | ✅ `authController` routing by `context.role` unchanged |
| Five service cards preserved | ✅ Verified in tests |
| Live queue monitor preserved | ✅ Verified in tests |
| Sticky active-ticket panel preserved | ✅ Unchanged |
| Existing MFA factor not auto-deleted | ✅ 1 unverified factor remains (see above) |

---

## Security Notes

- The `/account/security` route does not bypass any authorization checks
- The MFA dialog uses `controller.getMfaScope()` which verifies the authenticated session
- The `actor` prop displays the verified UUID but is not used for authorization decisions
- No role changes are made by this frontend fix
- The existing `require_staff_mfa` and `require_staff_approval` backend gates remain intact
- Migration 007 is still unapplied; ADMIN promotion remains blocked

---

## Next Steps (require your action)

1. **Navigate to** `http://127.0.0.1:5173/account/security` (run `python scripts/local_frontend.py --dev` first if not running)
2. **Sign in** with Google (`ellasharmaineabeso2004@gmail.com`)
3. **Verify** the displayed UUID matches `5c96debb-697f-4cad-805f-92b518e28343`
4. **Click "Open authenticator security"**
5. **Choose one:**
   - If you scanned the QR: click "Finish existing authenticator setup" and enter the current code
   - If you never scanned it: click "I never scanned it — review discard" (requires explicit confirmation)
6. **Do not share** the QR code, setup key, or OTP with anyone

After successful enrollment, your account will have 1 verified TOTP factor and can establish AAL2 sessions. ADMIN promotion (migration 007 + operator approval) remains a separate step requiring your explicit approval.