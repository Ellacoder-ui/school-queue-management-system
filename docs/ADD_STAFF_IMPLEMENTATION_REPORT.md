# Add Staff Implementation Report

**Date:** October 20, 2026
**Branch:** `backend`

---

## 1. Files Changed

### Production Files (Modified)

| File | Change |
|---|---|
| `src/components/AdminAddStaff.vue` | Removed permanent explanatory text below heading. Lookup form, role selection, counter assignment, and confirmation remain. |
| `src/components/AdminDashboard.vue` | Staff directory uses `admin_staff_accounts()` for email display. Staff management section functional. |
| `src/lib/adminActivation.js` | `STAFF_ACTIVATION_RELEASED = false` (unchanged — activation still disabled) |

### Production Files (Created)

| File | Purpose |
|---|---|
| `src/composables/useSpeechAnnouncement.js` | Web Speech API composable |
| `src/composables/useTicketNotifications.js` | Web Notifications API composable |

### Test Files (Modified)

| File | Change |
|---|---|
| `tests/frontend/adminHandoff.test.js` | Updated assertion for removed explanatory text |

---

## 2. Add Staff UI Changes

### Before

The Add Staff section showed:
- Heading: "Add Staff"
- Button: "Find registered account"
- Permanent explanatory text: "Google account lookup is available. Staff activation is unavailable until the atomic activation RPC and its frontend release are separately approved."

### After

The Add Staff section shows:
- Heading: "Add Staff"
- Button: "Find registered account"

When clicked, opens a modal containing:
- Google email input (validated)
- "Find Google account" button
- Account details (email, UUID, role, enabled, verification status)
- Role selection (CASHIER/ADMIN)
- Counter selection (when CASHIER selected, 5 permanent counters)
- Contextual explanation inside modal (not below heading)
- Cancel and Add Staff buttons (Add Staff disabled until backend approved)

### Counter Choices

| Counter | Service | Code |
|---|---|---|
| 1 | Tuition Payment | TP |
| 2 | Statement of Account | SOA |
| 3 | Promissory Notes and Exam Permits | PNEP |
| 4 | Refund Process | REF |
| 5 | Adjustment Clerk | ADJ |

---

## 3. Automatic Role Recognition

### How It Works

1. User signs in with Google (any domain: `@liceo.edu.ph`, `@gmail.com`, etc.)
2. Supabase Auth verifies the identity (immutable UUID, Google subject)
3. Backend maps Auth UUID to `queue_private.accounts`
4. `my_context()` returns the account's current role
5. Frontend routes based on role: ADMIN → AdminDashboard, CASHIER → CashierDashboard, STUDENT → StudentDashboard

### No Email-Domain Assumptions

- No hardcoded email lists
- No domain-based role assignment
- No client-side role overrides
- Authorization is database-authoritative via `my_context()`

### Verified Google Accounts

| Account | Email | Role | Google Identity |
|---|---|---|---|
| Personal ADMIN | ellasharmaineabeso2004@gmail.com | ADMIN | 1 verified |
| School account | eabeso63122@liceo.edu.ph | STUDENT | 1 verified |
| Second school account | bmabing62681@liceo.edu.ph | STUDENT | 1 verified |

All three have verified Google identities. The domain does not determine privileges.

---

## 4. Add Staff Backend Readiness

### Installed Backend Functions (Read-Only)

| Function | Status | Purpose |
|---|---|---|
| `admin_staff_accounts()` | ✅ Installed | Staff directory with emails |
| `resolve_staff_google(p_email)` | ✅ Installed | Resolve verified Google account by email |
| `admin_payors(...)` | ✅ Installed | Payor queue records |
| `admin_payor_events(p_ticket)` | ✅ Installed | Ticket event history |
| `admin_staff_directory()` | ✅ Installed | Staff directory (emails) |
| `request_staff_access(p_email, p_role)` | ✅ Installed | Pending review requests |

### Not Yet Installed (Requires Approval)

| Function | Status | Requires |
|---|---|---|
| `add_verified_staff(...)` | ❌ Not installed | Migration 007 + approval |
| Migration 007 | ❌ Not applied | Separate approval |
| Migration 012 | ❌ Not applied | Separate approval + 007 |

### Lookup Functionality

The "Find registered account" button calls `resolve_staff_google(p_email)` which:
- Validates email format
- Checks for exactly one matching account with verified Google identity
- Returns account details (id, email, role, enabled, identity_sha256, counter_ids)
- Returns null for unregistered or unverified accounts

### Activation (Disabled)

The "Add Staff" confirmation button is disabled (`STAFF_ACTIVATION_RELEASED = false`). When clicked, it would call `add_verified_staff()` which:
- Requires ADMIN + AAL2 + verified MFA + operator approval
- Atomically promotes STUDENT → CASHIER/ADMIN
- Assigns counter (for CASHIER)
- Creates audit entry
- Is idempotent (same request key returns same result)

---

## 5. Google Domain Compatibility

### Supported Domains

The system supports Google accounts from **any domain**:
- `@liceo.edu.ph` (school domain)
- `@gmail.com` (personal Gmail)
- `@another-school.edu.ph` (other school domains)
- Any other Google-verified domain

### Authorization Rule

Privileges are determined by:
1. **Immutable Auth UUID** (from Supabase Auth)
2. **Database role** (from `queue_private.accounts`)
3. **Verified Google identity** (immutable subject + provider ID)

**NOT by:**
- Email domain
- Email address
- Google profile metadata
- Client-side role selection

### Identity Verification

`resolve_staff_google()` verifies:
- Email is confirmed (`email_confirmed_at IS NOT NULL`)
- User is not anonymous
- Google identity email matches Auth user email
- Google identity is verified (`email_verified = 'true'`)
- Google subject matches provider ID
- Exactly one Google identity exists

---

## 6. Tests and Build Results

### Frontend Tests

- 208/208 passing (full suite)
- All individual test files pass when run separately

### Production Build

```
npm run build → ✓ built in 9.36s
```

### Responsive Widths

| Width | Status |
|---|---|
| 1440px | ✅ |
| 1280px | ✅ |
| 1024px | ✅ |
| 768px | ✅ |
| 640px | ✅ |
| 390px | ✅ |
| 320px | ✅ |

---

## 7. Database Preservation

| Item | Value | Status |
|---|---|---|
| Personal ADMIN role | ADMIN (enabled) | ✅ Unchanged |
| School account role | STUDENT (enabled) | ✅ Unchanged |
| Total accounts | 42 | ✅ Unchanged |
| Staff assignments | 4 | ✅ Unchanged |
| Tickets | 20 | ✅ Unchanged |
| MFA factors | 1 (verified) | ✅ Unchanged |
| Google identities | 1 | ✅ Unchanged |
| Read-only functions | 5 installed | ✅ Unchanged |
| Migration 007 | Unapplied | ✅ Unchanged |
| `add_verified_staff` | Not installed | ✅ Unchanged |
| Auth service | Healthy | ✅ |

---

## 8. Remaining Backend Blockers

| Blocker | Status | Requires |
|---|---|---|
| Migration 007 | Unapplied | Separate approval |
| Migration 012 (`add_verified_staff`) | Unapplied | Separate approval + 007 |
| Frontend activation (`STAFF_ACTIVATION_RELEASED`) | `false` | Approval after 007 + 012 |

### Exact Approval Commands (When Ready)

1. "Approve applying migration 007 with personal ADMIN operator approval bootstrap to local development database"
2. "Approve applying migration 012 (add_verified_staff) to local development database"
3. "Approve enabling Direct Add Staff in the frontend"

---

## 9. Summary

| Category | Status |
|---|---|
| Add Staff UI simplified | ✅ Technical text removed |
| Add Staff form functional | ✅ Lookup, role selection, counter selection, confirmation |
| Automatic role recognition | ✅ Database-authoritative via `my_context()` |
| Google domain compatibility | ✅ Any domain supported, no domain-based assumptions |
| No fake accounts or mock data | ✅ Only real database results |
| No hardcoded email-to-role mappings | ✅ |
| No unsafe fallback mutations | ✅ Activation disabled until backend approved |
| Staff Management preserved | ✅ |
| Payor Management preserved | ✅ |
| Live Tickets preserved | ✅ |
| All dashboards preserved | ✅ |
| Frontend tests | ✅ 208/208 passing |
| Production build | ✅ Passing |
| Database preservation | ✅ All checks pass |
| Backend blockers | ⚠️ 3 approvals needed (007, 012, frontend) |

**Stop: Add Staff implementation complete. UI simplified. Backend activation requires separate approval.**