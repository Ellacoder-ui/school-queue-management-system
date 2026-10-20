# UI Customization Guide

**Project:** School Queue Management System
**Default Theme:** Burgundy, Gold and White

This guide explains how to customize the visual appearance of the application without breaking Supabase functionality.

---

## 1. Design Tokens (Colors, Fonts, Spacing)

All design tokens are centralized in one file:

**File:** `src/design-tokens.css`

This file defines CSS custom properties on `:root`. Change any value here and it propagates throughout the entire application.

### Color Palette

```css
:root {
  --cqs-burgundy: #65263d;       /* Primary brand color */
  --cqs-hover: #4d1b2d;          /* Darker burgundy for hover states */
  --cqs-gold: #e5bd68;           /* Accent color (badges, highlights) */
  --cqs-ink: #30292d;            /* Primary text color */
  --cqs-muted: #716971;          /* Secondary text color */
  --cqs-line: #e8e4e1;           /* Border/divider color */
  --cqs-surface: #fffdf9;        /* Card/panel background */
  --cqs-bg: #ffffff;             /* Page background */

  /* Public display (/display page) */
  --board-gold: #ffd065;
  --board-muted: #dbc5cc;
  --board-bg: #1e0c14;
}
```

### Typography

```css
:root {
  --cqs-font-family: Arial, Helvetica, sans-serif;
  --cqs-font-size-base: 15px;
  --cqs-line-height-base: 1.6;
  --cqs-font-heading: Georgia, serif;
}
```

### Spacing & Borders

```css
:root {
  --cqs-space-xs: 4px;
  --cqs-space-sm: 8px;
  --cqs-space-md: 16px;
  --cqs-space-lg: 24px;
  --cqs-space-xl: 32px;

  --cqs-radius-sm: 8px;
  --cqs-radius-md: 11px;
  --cqs-radius-lg: 14px;
  --cqs-radius-full: 50%;
}
```

### How to Change the Color Scheme

1. Open `src/design-tokens.css`
2. Modify the hex values in the `:root` block
3. Save — Vite HMR will update the browser instantly
4. No other files need to change

### Hardcoded Colors

Some colors are still hardcoded in `src/workspace.css` and `src/admin.css` (e.g., `#fff`, `#faf6f7`). To fully customize, search for hex colors in these files and replace with `var(--cqs-*)` tokens.

---

## 2. Font Customization

### Where to Edit

**File:** `src/design-tokens.css` (line 20-24)

```css
:root {
  --cqs-font-family: 'Your Font', sans-serif;
  --cqs-font-heading: 'Your Heading Font', serif;
}
```

### Loading Custom Fonts

Add font imports to `src/main.js` before the CSS imports:

```javascript
import { createApp } from 'vue'
import './design-tokens.css'
// Add Google Fonts or local font imports here
import './style.css'
import App from './App.vue'
```

Or add `@import` at the top of `src/design-tokens.css`:

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
:root {
  --cqs-font-family: 'Inter', sans-serif;
}
```

---

## 3. Where to Edit Each Dashboard

### Admin Dashboard

**File:** `src/components/AdminDashboard.vue`

Structure:
- Line 1-30: Script (imports, computed properties, state)
- Line 31+: Template (tabs, analytics, staff management, payor management)
- Right-side live monitor: `<aside class="cqs-admin-live">`

**Styling:** `src/admin.css` (admin-specific) + `src/workspace.css` (shared)

### Student Dashboard

**File:** `src/components/StudentDashboard.vue`

Structure:
- Service selection grid
- Embedded live queue monitor
- Sticky active-ticket panel
- Ticket history

**Styling:** `src/workspace.css`

### Cashier Dashboard

**File:** `src/components/CashierDashboard.vue`

Structure:
- Counter strip (current counter, open/closed status)
- Now serving panel (call next, serve, skip)
- Up next panel
- Active queue table

**Styling:** `src/workspace.css`

### Live Tickets Panel

**File:** `src/components/AdminLiveTickets.vue` (or `QueueOverview.vue`)

Structure:
- Five counter cards with service codes
- Current called ticket per counter
- Waiting counts
- Connection status

**Styling:** `src/admin.css` (`.cqs-live-tickets`)

---

## 4. Customizing Buttons, Forms, Modals, Cards

### Buttons

Button styles are defined in `src/workspace.css` under `.cqs-button`, `.cqs-button-primary`, `.cqs-button-outline`, `.cqs-button-green`.

To change button appearance globally:
- Search for `.cqs-button` in `src/workspace.css`
- Modify border-radius, padding, font-weight, colors

### Forms

Form fields use `.cqs-field` class. Input styles are in `src/workspace.css`.

### Modals

Modals use `WorkspaceDialog.vue` component + `.cqs-dialog` class. Border radius, padding, and shadow are defined in `.cqs-dialog`.

### Cards

Cards use `.cqs-card` class. Background, border, and shadow are in `src/workspace.css`.

### Tables

Tables use `.cqs-table` and `.cqs-table-scroll` classes. Header styles, row hover, and cell padding are in `src/workspace.css`.

---

## 5. How to Preview UI Changes Locally

### Development Server

```powershell
python scripts/local_frontend.py --dev
```

This starts Vite on `http://127.0.0.1:5173` with hot module replacement (HMR). Changes to CSS and Vue files update instantly in the browser.

### Production Build Preview

```powershell
npm run build
npm run preview
```

### Testing Changes

```powershell
npm run test:frontend
```

Run this after UI changes to ensure nothing broke.

---

## 6. Avoiding Supabase Breakage

### Rules for Safe UI Editing

1. **Never modify** `src/lib/supabase.js`, `src/lib/supabaseConfig.js`, or `src/lib/oauthConfig.js`
2. **Never modify** `src/services/queueApi.js` unless you understand the RPC contracts
3. **Never remove** `data-testid` attributes — tests depend on them
4. **Never change** the `v-if`/`v-else-if` role routing in `AuthWorkspace.vue`
5. **Never modify** `src/lib/authController.js` — it handles authentication state
6. **CSS only changes** are always safe — modify `src/design-tokens.css`, `src/workspace.css`, `src/admin.css`, or `src/style.css`
7. **Template changes** are safe as long as you keep the same data bindings and event handlers
8. **Component structure** — keep the same prop names and emit events

### What You Can Freely Change

- Colors, fonts, spacing (via design tokens)
- Button styles, card styles, modal styles
- Layout (grid, flex, positioning)
- Responsive breakpoints
- Typography (font sizes, weights, line heights)
- Animations and transitions
- Icon styles
- Table appearance
- Form field styling

### What You Should NOT Change

- Supabase client configuration
- Authentication flow (Google OAuth, PKCE)
- RPC function names or parameters
- Role routing logic
- Queue Realtime subscriptions
- MFA dialog logic
- Test IDs (data-testid attributes)

---

## 7. File Organization

```
src/
├── design-tokens.css     ← Colors, fonts, spacing (edit here first)
├── style.css             ← Public display (/display page) styles
├── workspace.css         ← Main app styles (login, dashboards, forms, tables)
├── admin.css             ← Admin-specific styles (staff panel, counters, live tickets)
├── main.js               ← App entry point (imports CSS)
├── App.vue               ← Root component (routes to monitor or app)
├── components/
│   ├── AuthWorkspace.vue ← Main workspace (role-based routing)
│   ├── AdminDashboard.vue ← Admin dashboard (3 tabs + live monitor)
│   ├── AdminAddStaff.vue ← Add Staff form
│   ├── AdminPayors.vue   ← Payor Management
│   ├── CashierDashboard.vue ← Cashier dashboard
│   ├── StudentDashboard.vue ← Student/Payor dashboard
│   ├── QueueOverview.vue ← Public queue display
│   └── ...
├── lib/
│   ├── authController.js ← Authentication state (do not modify)
│   ├── queueApi.js       ← API contracts (do not modify RPC names)
│   └── ...
└── composables/
    ├── useQueueAuth.js   ← Auth composable (do not modify)
    └── ...
```

---

## 8. Quick Reference: Editing Each Dashboard

| Dashboard | Component File | CSS File | Key Classes |
|---|---|---|---|
| Admin | `src/components/AdminDashboard.vue` | `src/admin.css` | `.cqs-admin-shell`, `.cqs-admin-live`, `.cqs-staff-panel` |
| Student | `src/components/StudentDashboard.vue` | `src/workspace.css` | `.cqs-service-grid`, `.cqs-ticket-rail`, `.cqs-student-grid` |
| Cashier | `src/components/CashierDashboard.vue` | `src/workspace.css` | `.cqs-cashier-grid`, `.cqs-serving`, `.cqs-counter-strip` |
| Live Tickets | `src/components/AdminLiveTickets.vue` | `src/admin.css` | `.cqs-live-tickets`, `.cqs-live-ticket-list` |
| Public Display | `src/components/PublicQueueDisplay.vue` | `src/style.css` | `.queue-board`, `.board-feature` |

---

## 9. Testing After UI Changes

After making UI changes:

1. Run the dev server: `python scripts/local_frontend.py --dev`
2. Check the browser at `http://127.0.0.1:5173`
3. Run frontend tests: `npm run test:frontend`
4. Run production build: `npm run build`
5. Verify responsive layouts at 1440px, 768px, 390px

If tests fail, check that you didn't remove any `data-testid` attributes or change component prop names.