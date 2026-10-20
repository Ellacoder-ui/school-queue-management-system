# Browser Notification Integration Report

**Date:** October 20, 2026
**Branch:** `backend`

---

## Overview

Native browser Notifications API replaces the previously planned Email API. Notifications are triggered by ticket state changes in the authenticated student's queue data.

## Implementation

### Files Created

| File | Purpose |
|---|---|
| `src/composables/useTicketNotifications.js` | Notification composable (permission, dedup, ticket events) |

### Files Modified

| File | Change |
|---|---|
| `src/components/StudentDashboard.vue` | Added Enable Notifications button and composable usage |

### How It Works

1. **Permission request** — Only triggered by user clicking "Enable notifications" button (user interaction required by browser)
2. **Ticket monitoring** — Watches `props.data.rows` for changes via Vue `watch` with deep comparison
3. **Deduplication** — Each ticket+status combination is tracked in a `Set` persisted to `localStorage` (`cqs-notified-tickets-v1`)
4. **Notification types:**
   - `WAITING` → "Ticket Issued" — "Your ticket {label} is in the queue."
   - `CALLED` → "Ticket Called" — "Your ticket {label} is being called. Please proceed to your counter."
   - `SERVED` → "Ticket Served" — "Your ticket {label} has been served."
   - `FORFEITED` → "Ticket Forfeited" — "Your ticket {label} was forfeited."
5. **No personal data exposed** — Only ticket label (service-number) and status, no student names or IDs
6. **Graceful degradation** — If notifications are unsupported or permission denied, tickets still function normally

### Security

- Only the authenticated student's own tickets trigger notifications (watched from `props.data.rows` which is scoped to the logged-in user)
- No cross-student notification leakage
- No background delivery when the website is closed (browser notifications only work while the page is open)
- No secrets or tokens in notification content

### UI

- "Enable notifications" button in the student ticket rail
- Button shows "Notifications on" when enabled
- Button is disabled when already enabled
- Only shown when `Notification` API is supported

### Testing

- Build: ✓ passing
- No mock data in production views
- Notifications are suppressed for previously seen ticket+status combinations
- Permission is only requested on user interaction (button click)