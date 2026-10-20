# MFA Enrollment Issue Investigation Report

**Date:** October 19, 2026
**Branch:** `backend`
**Account:** `ellasharmaineabeso2004@gmail.com`
**Verified Auth UUID:** `5c96debb-697f-4cad-805f-92b518e28343`

---

## 1. Account Identity Verification

| Field | Value | Verified |
|---|---|---|
| Email | `ellasharmaineabeso2004@gmail.com` | ✅ |
| Auth UUID | `5c96debb-697f-4cad-805f-92b518e28343` | ✅ |
| Email confirmed | Yes | ✅ |
| Anonymous | No | ✅ |
| Google identities | Exactly 1 | ✅ |
| Database role | STUDENT (enabled) | ✅ |

---

## 2. Current MFA Factors (read-only query)

Query: `SELECT id, user_id, friendly_name, factor_type, status, created_at, updated_at FROM auth.mfa_factors WHERE user_id = '5c96debb-697f-4cad-805f-92b518e28343'`

| Field | Value |
|---|---|
| Factor ID | `d0608ad5-b140-41bc-ae35-5fbe0d61ac38` |
| User ID | `5c96debb-697f-4cad-805f-92b518e28343` |
| Friendly name | "Cashier Queue account" |
| Factor type | `totp` |
| Status | **unverified** |
| Created at | `2026-10-19 12:03:37.968625 UTC` |
| Updated at | `2026-10-19 12:03:37.968625 UTC` |

**Total factors for this account: 1 (unverified)**

---

## 3. Old Discarded Factor — Confirmed Gone

The previously reported unverified factor (`41c29861-e329-42df-9207-7bc0a0045d90`) is **no longer present** in the database. It was successfully discarded via the reviewed discard flow.

Docker Auth log confirms:
```
{"auth_event":{"action":"factor_unenrolled",...,"traits":{"factor_id":"367163c0-3155-4686-95bc-499ec29640f9","factor_status":"unverified"}}}
```

(The factor ID in the log differs from the one in the earlier report because an intermediate factor was also created and discarded.)

---

## 4. New Unverified Factor — Confirmed Created

A new unverified TOTP factor was created:

| Factor ID | Status | Created |
|---|---|---|
| `d0608ad5-b140-41bc-ae35-5fbe0d61ac38` | unverified | 2026-10-19 12:03:37 UTC |

Docker Auth log confirms:
```
{"auth_audit_event":{"action":"factor_in_progress",...,"traits":{"factor_id":"d0608ad5-b140-41bc-ae35-5fbe0d61ac38"}}}
{"auth_event":{"action":"factor_in_progress",...}}
{"component":"api","duration":48512962,"level":"info","method":"POST","msg":"request completed","path":"/factors","status":200}
```

The backend returned **HTTP 200** — the factor creation **succeeded on the backend**.

---

## 5. Root Cause Analysis

### Symptom
- User clicked "Set up authenticator" after discarding old factor
- Interface showed: "The outcome could not be confirmed. Close and reopen account security to check the current state."
- After reopening: "An unfinished setup exists."

### Frontend enrollment flow (`src/lib/accountMfa.js`)

The `enroll()` function:
```javascript
enroll() {
  if (state.phase !== 'choose' || state.unfinished.length || state.factors.length) return
  return run(async version => {
    const data = await result(mutation('enroll', { factorType: 'totp', ... }, version), version)
    if (!uuid(data.id) || data.type !== 'totp' || !/^[A-Z2-7]{16,128}$/.test(data.totp?.secret || '')) throw interrupted
    const qr = totpImage(data.totp.qr_code)
    await identity(version); factor = data.id
    emit({ phase: 'setup', qr, secret: data.totp.secret, message: null })
  }, 'enrolling')
}
```

The `run()` function wraps enrollment in a 13-second timeout:
```javascript
const work = (async () => { await identity(version, first); await body(version) })()
try { await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(interrupted), timeoutMs) })]) }
```

### Identified root cause: **Frontend validation rejects the backend response**

The backend successfully creates the factor (HTTP 200, confirmed in Docker logs). However, one of the frontend validation steps after the API call fails, throwing `interrupted` (a Symbol). The `failure()` function maps `interrupted` to the generic message "The outcome could not be confirmed."

**Most likely cause: `totpImage()` SVG validation rejects the QR code from GoTrue v2.197.0.**

The `totpImage()` function (`src/lib/accountMfa.js` lines 5-10):
```javascript
export function totpImage(value) {
  if (typeof value !== 'string' || value.length > 200000) throw interrupted
  const svg = value.replace(/^data:image\/svg\+xml;utf-8,/, '')
  if (!/^<svg[\s>]/.test(svg) || !/<\/svg>\s*$/.test(svg) || /<!|<script|foreignObject|\bon\w+\s*=|(?:href|src)\s*=|url\s*\(/i.test(svg)) throw interrupted
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}
```

The SDK prepends `data:image/svg+xml;utf-8,` to the QR code. The `totpImage()` function strips this prefix and validates the SVG. If GoTrue's SVG contains patterns that trigger the security regex (such as `href=`, `src=`, `url(`, `<!`, `<script`, `foreignObject`, or event handlers like `onload=`), the validation fails and throws `interrupted`.

**Secondary possibility: Secret format mismatch.** The regex `/^[A-Z2-7]{16,128}$/` requires uppercase base32. If GoTrue returns a secret in a different format (lowercase, different length, or with padding), this check fails.

**Tertiary possibility: `identity()` re-verification.** The `identity(version)` call after enrollment re-verifies the session. If the session changed during enrollment (unlikely given the fast backend response), this would throw `interrupted`.

### Contributing factor: 12-second fetch timeout

`src/lib/localFetch.js` line 8:
```javascript
const signals = [AbortSignal.timeout(12000), options.signal || (input instanceof Request ? input.signal : null)].filter(Boolean)
```

All fetch requests through the local fetch wrapper have a 12-second timeout. While the backend responds in ~48ms for MFA enrollment, this timeout could cause issues under load or if the backend is slow. Additionally, the `accountMfa.js` has its own 13-second timeout. The 12-second fetch timeout would fire first, aborting the request before the 13-second application timeout.

### Evidence summary

| Evidence | Finding |
|---|---|
| Docker Auth log | POST `/factors` returned HTTP 200 (factor created successfully) |
| Database query | 1 unverified factor exists (created at 12:03:37 UTC) |
| Frontend message | "The outcome could not be confirmed" → `failure()` returned generic message |
| `failure()` logic | Generic message returned when error doesn't match specific codes |
| `enroll()` validation | `interrupted` thrown by `totpImage()` or secret regex or `identity()` |
| `totpImage()` security regex | Could reject GoTrue's SVG if it contains `href=`, `src=`, `url(`, etc. |
| `localFetch.js` | 12-second `AbortSignal.timeout` on all fetch requests |
| `accountMfa.js` | 13-second `timeoutMs` on enrollment operations |

---

## 6. Safest Recovery Procedure

### Current state
- **1 unverified TOTP factor** exists: `d0608ad5-b140-41bc-ae35-5fbe0d61ac38`
- The QR code was **never displayed** to the user (enrollment response was rejected by frontend validation)
- The user **cannot scan** the QR code because it was never shown

### Recovery options (choose one)

**Option A — Resume verification (if you scanned the QR before it disappeared):**
Not applicable — the QR code was never displayed.

**Option B — Reviewed discard + re-enroll with fix:**
1. Open MFA dialog at `/account/security`
2. Click "I never scanned it — review discard"
3. Confirm discard (removes the unverified factor)
4. Apply the frontend fix (see below)
5. Re-attempt enrollment

**Option C — Discard via reviewed discard flow (recommended):**
Same as Option B. The unfinished setup should be discarded because the QR code was never displayed and cannot be recovered.

### Important: Do not automatically delete
This report does not recommend automatic deletion. The user must explicitly confirm the discard through the MFA dialog's reviewed discard flow, which requires AAL1 and verifies no verified factors exist.

---

## 7. Proposed Smallest Safe Fix (pending approval)

### Fix 1: Relax `totpImage()` SVG validation

The security regex in `totpImage()` may be too strict for GoTrue v2.197.0's SVG output. The fix would:

- Allow `href` and `src` attributes in SVG (GoTrue may use them for styling)
- Allow `url()` in CSS (GoTrue may use it for gradients)
- Keep protection against `<script>`, `foreignObject`, event handlers, and `<!` (DOCTYPE/ENTITY)

**File:** `src/lib/accountMfa.js`, function `totpImage()`

### Fix 2: Make secret regex case-insensitive

Change `/^[A-Z2-7]{16,128}$/` to `/^[A-Za-z2-7]{16,128}$/` to accept lowercase base32 secrets (GoTrue may return lowercase).

**File:** `src/lib/accountMfa.js`, `enroll()` function

### Fix 3: Increase fetch timeout for MFA enrollment

The 12-second `AbortSignal.timeout` in `localFetch.js` should be increased for MFA enrollment requests, or the MFA enrollment should use a longer timeout. Alternatively, the `accountMfa.js` timeout should be increased to accommodate the backend's response time.

**File:** `src/lib/localFetch.js`, line 8

### Fix 4: Add diagnostic logging (development only)

Add sanitized error logging (error code only, no secrets) to the `run()` catch block to help diagnose future enrollment failures.

**File:** `src/lib/accountMfa.js`, `run()` function

### Order of implementation

1. Fix 1 + Fix 2 (validation relaxation) — smallest change, highest impact
2. Fix 3 (timeout increase) — safety net
3. Fix 4 (diagnostics) — optional, for future debugging

### What will NOT change

- No changes to MFA enrollment logic flow
- No changes to authorization checks
- No changes to backend
- No changes to database
- No new factors created or deleted
- No role changes

---

## 8. What Remains Uncertain

1. **Exact failure point:** Without browser console access, I cannot confirm whether the failure is in `totpImage()` validation, secret regex, or `identity()` re-verification. The Docker logs only show the backend succeeded (HTTP 200).

2. **QR code format:** I cannot verify the exact SVG format returned by GoTrue v2.197.0 without making an API call (which would create a new factor).

3. **Secret format:** I cannot verify whether GoTrue returns uppercase or lowercase base32 secrets without making an API call.

4. **Whether the 12-second fetch timeout contributed:** The backend responds in ~48ms, so the fetch timeout shouldn't fire. But under load or with network latency, it could.

---

## 9. Summary

| Item | Status |
|---|---|
| Account identity | ✅ Verified |
| Current MFA factors | 1 unverified (`d0608ad5-...`) |
| Old discarded factor | ✅ Confirmed gone |
| New factor created | ✅ Confirmed (backend HTTP 200) |
| QR code displayed | ❌ Never displayed (frontend rejected response) |
| Root cause | Likely `totpImage()` SVG validation or secret regex rejecting GoTrue's response format |
| Proposed fix | Relax SVG validation, make secret regex case-insensitive, increase timeout |
| Fix applied | ❌ Awaiting approval |

**Next step:** Approve the proposed fix (Fix 1 + Fix 2 minimum) and I will implement it. Then discard the current unverified factor and re-attempt enrollment.