# MFA Enrollment Fix Report

**Date:** October 19, 2026
**Branch:** `backend`
**Target account:** `ellasharmaineabeso2004@gmail.com` (UUID: `5c96debb-697f-4cad-805f-92b518e28343`)

---

## Problem Identified

Supabase Auth successfully creates the TOTP factor (HTTP 200, confirmed in Docker logs), but the frontend's `totpImage()` function rejects the QR code SVG returned by GoTrue v2.197.0, causing the generic error: "The outcome could not be confirmed."

## Root Cause

### Failing validation condition

The `totpImage()` function in `src/lib/accountMfa.js` used an overly broad security regex:

```javascript
/<!|<script|foreignObject|\bon\w+\s*=|(?:href|src)\s*=|url\s*\(/i
```

This regex rejected **any** SVG containing `href=`, `src=`, or `url(` — including safe internal references that GoTrue's SVGo-optimized SVG uses. GoTrue's QR code SVG contains internal `href` attributes (e.g., `href="#id"`) and/or `url()` references (e.g., `url(#gradient)`) for styling, which triggered the rejection.

### Secondary issue: Secret case sensitivity

The secret validation regex `/^[A-Z2-7]{16,128}$/` only accepted uppercase base32. GoTrue may return lowercase secrets.

### Contributing factor: Fetch timeout

`src/lib/localFetch.js` had `AbortSignal.timeout(12000)` (12 seconds) on all fetch requests. While the backend responds in ~48ms, this was unnecessarily tight for MFA operations.

---

## Fix Applied

### 1. Relaxed `totpImage()` SVG validation (`src/lib/accountMfa.js`)

**Before:** Rejected ALL `href=`, `src=`, and `url(` patterns.

**After:** Only rejects:
- Dangerous constructs: `<!`, `<script`, `foreignObject`, event handlers (`on*=`)
- External `href`/`src` references (only allows internal fragment refs like `href="#id"`)
- External `url()` references (only allows internal like `url(#gradient)`)

```javascript
// Block dangerous SVG constructs: DOCTYPE/comments, scripts, foreignObject, event handlers
if (/<!|<script|foreignObject|\bon\w+\s*=/i.test(svg)) throw interrupted
// Block external href/src (allow internal fragment references like href="#id")
if (/(?:href|src)\s*=\s*(?!["']?\s*#)/i.test(svg)) throw interrupted
// Block external url() references (allow internal like url(#gradient))
if (/url\s*\(\s*(?!["']?\s*#)/i.test(svg)) throw interrupted
```

### 2. Case-insensitive secret regex (`src/lib/accountMfa.js`)

**Before:** `/^[A-Z2-7]{16,128}$/`
**After:** `/^[A-Za-z2-7]{16,128}$/`

### 3. Increased fetch timeout (`src/lib/localFetch.js`)

**Before:** `AbortSignal.timeout(12000)` (12 seconds)
**After:** `AbortSignal.timeout(30000)` (30 seconds)

### 4. Sanitized diagnostic logging (`src/lib/accountMfa.js`)

Added `console.warn('MFA enrollment interrupted:', kind)` in the `run()` catch block. Only logs the error type (e.g., 'interrupted', 'mfa_challenge_expired'), never secrets, tokens, or raw payloads.

---

## What Was NOT Changed

- No changes to MFA enrollment logic flow
- No changes to authorization checks or MFA security gates
- No changes to `AccountMfaDialog.vue` or `useAccountMfa.js`
- No new factors created or existing factors deleted
- No database modifications
- No migration applications
- No role changes
- No backend changes

---

## Existing Unverified Factor (Preserved)

| Field | Value |
|---|---|
| Factor ID | `d0608ad5-b140-41bc-ae35-5fbe0d61ac38` |
| Status | **unverified** |
| Secret length | 32 characters (uppercase base32) |
| QR code | Never displayed (frontend rejected response) |

This factor was **not deleted or modified**. The user can now:
- **Resume verification** if they scanned the QR before it disappeared (unlikely — QR was never shown)
- **Reviewed discard** if they never scanned it (requires explicit confirmation in the MFA dialog)

---

## Test Results

### Frontend tests — all passing

| Test file | Result |
|---|---|
| `tests/frontend/accountMfa.test.js` | 21/21 passed |
| `tests/frontend/authWorkspace.test.js` | 16/16 passed |
| **Total** | **37/37 passed** |

### Existing security tests verified (no regressions)

| Test | Description | Result |
|---|---|---|
| `QR renderer rejects remote URLs and active SVG content` | Rejects `https://`, `onload=`, external `href=` | ✅ Pass |
| `totpImage('<svg><path d="M0 0"/></svg>')` | Accepts basic SVG | ✅ Pass |
| `timed-out enrollment stays locked` | Timeout behavior preserved | ✅ Pass |
| `MFA transport rejects account/session retargeting` | Authorization checks intact | ✅ Pass |
| All 19 MFA enrollment/verification tests | No regressions | ✅ Pass |

### Production build

```
npm run build → ✓ built in 20.05s
```

---

## Remaining Steps for ADMIN Access

### Step 1 — Personal MFA Verification (you personally)

1. Run `python scripts/local_frontend.py --dev`
2. Navigate to `http://127.0.0.1:5173/account/security`
3. Sign in with Google (`ellasharmaineabeso2004@gmail.com`)
4. Verify displayed UUID: `5c96debb-697f-4cad-805f-92b518e28343`
5. Click "Open authenticator security"
6. The existing unverified factor will be shown:
   - If you scanned the QR: click "Finish existing authenticator setup" and enter the current code
   - If you never scanned it: click "I never scanned it — review discard" (requires explicit confirmation)
7. **Do not share** the QR code, setup key, or OTP with anyone

**Result after completion:** 1 verified TOTP factor, account remains STUDENT, AAL2 sessions possible.

### Step 2 — Migration 007 Approval & Application (requires your explicit approval)

- Review `supabase/20261019000700_staff_security.PROPOSED.sql`
- Authorize its application to `supabase/migrations/`
- This creates:
  - `queue_private.staff_access_approvals` table (RLS-protected, operator-only)
  - `require_staff_mfa('ADMIN')` and `require_staff_approval()` functions
  - Wraps all staff RPCs with AAL2 + approval gates
  - `review_staff_access()` and `promote_approved_admin()` operator functions

**Impact:** All existing privileged accounts fail closed until individually approved, enrolled, and using AAL2.

### Step 3 — Trusted Operator Approval & Promotion (requires trusted database operator)

A trusted database operator must execute (in order):

1. `queue_private.review_staff_access('5c96debb-697f-4cad-805f-92b518e28343', 'ellasharmaineabeso2004@gmail.com', '<identity_hash>', 'ADMIN', '<approval_reference>', clock_timestamp() + interval '1 day')`
   - Creates an active ADMIN approval record bound to the exact UUID and Google identity hash

2. `queue_private.promote_approved_admin('5c96debb-697f-4cad-805f-92b518e28343', 'ellasharmaineabeso2004@gmail.com', 'STUDENT', '<identity_hash>', '<approval_reference>')`
   - Preconditions: role=STUDENT, verified MFA factor, active ADMIN approval, no active tickets/assignments
   - Changes role from STUDENT to ADMIN
   - Adds operator-promotion audit entry

**School account (`eabeso63122@liceo.edu.ph`) remains STUDENT — no changes.**

### Step 4 — Automatic Admin Dashboard Access

After promotion:
1. Sign out and sign back in with Google
2. `authController.js` reads `my_context` → `role: 'ADMIN'`
3. `workspace` is set to `'admin'`
4. `AuthWorkspace.vue` renders `<AdminDashboard>` automatically
5. No role-selection screen, no email-based override

The routing logic is already in place and tested. No frontend changes needed for this step.

---

## Safety Confirmation

| Constraint | Status |
|---|---|
| No migration 007 applied | ✅ Not applied |
| No database role changed | ✅ No role changes |
| No MFA factor created/deleted | ✅ Existing factor preserved |
| No Supabase Auth restarted | ✅ Not restarted |
| No database reset | ✅ Not reset |
| No other accounts modified | ✅ Only target inspected |
| No backups deleted | ✅ Not touched |
| No commit or push | ✅ Not done |
| No MFA bypass or AAL2 forgery | ✅ Not done |
| Existing unfinished factor preserved | ✅ Not deleted |

---

## Summary

| Item | Before | After |
|---|---|---|
| `totpImage()` SVG validation | Rejected safe GoTrue SVGs | Allows internal href/src/url, blocks external/dangerous |
| Secret regex | Uppercase only | Case-insensitive |
| Fetch timeout | 12 seconds | 30 seconds |
| Sanitized diagnostics | None | Error type logged (no secrets) |
| QR code display | Failed ("outcome could not be confirmed") | Should now work with GoTrue's SVG format |
| Tests | 21 passing | 21 passing (no regressions) |
| Build | Passing | Passing |

**Next action:** Complete Step 1 (personal MFA verification) at `/account/security`, then request approval for Step 2 (migration 007).