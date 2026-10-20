# Admin automatic updates and responsive navigation

October 20, 2026 (UTC+08). **Implemented and verified.** Public Display remains
accessible at every requested width and with actual right-docked Chrome DevTools.
Refresh Queue and Refresh Directory are removed. Routine updates preserve the
dashboard, selected tab, search and unfinished forms. **No retained database
mutation or Supabase service operation was executed.**

## Root causes and changes

**Disappearing Public Display:** `src/workspace.css` explicitly applied
`.cqs-header-actions > .cqs-link { display: none; }` below **1100px**. Docking DevTools
reduced the page viewport below that breakpoint. This was responsive hiding, not a
DevTools-triggered navigation or reload. The rule is removed; header actions wrap,
remain within their container and retain normal keyboard focus. Sign Out stays visible.
The existing `/display` URL, new-tab behavior and `noopener` are preserved.

**Actual refresh glitches:**

- `useQueueAuth.js` performed a hard access refresh every 60 seconds and when public
  subscription readiness changed. `authController.refresh()` cleared the context and
  incremented `accountVersion`; `AuthWorkspace.vue` then removed/recreated the workspace.
  Tabs, filters and drafts could consequently reset.
- `createWorkspaceReader.refresh()` changed ready data to `loading` on every read,
  temporarily hiding authorized rows. Queue and staff readers also polled every
  30 seconds. Every public snapshot additionally refreshed the staff directory.
- Directory refreshes could abort/restart concurrent reads, and the staff dialog
  closed whenever its read status left `ready`.

Routine focus/reconnect authorization checks now use a coalesced background
`revalidate()` while the existing verified session remains valid. It still checks
the managed session, server `getUser` and current database context. Changed roles or
assignments rebind access. **Initial login, expiry, account/token changes, protected
denials and failed verification retain their access-clearing behavior.** No role is
derived from Google metadata or email. The 60-second Auth poll and public-readiness
Auth coupling are removed.

Ready queue tables remain ready during background reads, with an updating flag.
Access changes still clear protected rows and discard late responses. Staff dialogs
no longer close for ordinary reads; scope/account changes still invalidate them.
No new data-dependent component key, reload call or subscription was introduced.
Source editing can still cause ordinary Vite HMR; that is distinct from these fixed
application refresh paths.

## Automatic update architecture

**Queue:** the existing shared public controller retains one listener for each of
`queue_display.counter_state` and `service_state`, multiplexed over one public socket.
Notifications invalidate the snapshot; **75ms** batching collapses event bursts into
a read. Generation checks discard superseded responses, including after disconnect.
A semantic `queueVersion` ignores timestamp-only/unchanged snapshots, so these do not
reload private ticket data. Meaningful changes revalidate the existing authorized
`my_tickets`/`staff_queue` read. No private table subscription was added.

Reconnect requires backend listener readiness and a fresh snapshot before claiming
live status. Anonymous HTTP fallback runs every 30 seconds **only while updates are
unverified or failing and the page is visible**. Healthy Realtime has no steady queue
HTTP poll. Focus/visibility recovery and institution-date rollover still revalidate.
Disconnected public data remain labeled as a last-known snapshot. The administrator
also has a subtle update-status line.

**Staff:** initial ADMIN access loads the installed directory/configuration pair.
Concurrent reads share one promise; successful writes force a fresh read that cannot
be overwritten by a pre-write response:

| Confirmed operation | Follow-up |
| --- | --- |
| Account role/enabled change | Refresh directory and assignments/configuration |
| Counter assignment/availability change | Refresh configuration; reuse the validated directory |
| Add Staff review request | Refresh the directory; retain the actual pending receipt |

If a partial result disagrees with the cached companion snapshot, a full pair is
fetched. Queue projections are revalidated for account/counter operations, not Add
Staff requests. Public queue snapshots no longer reload staff data. External staff
changes are revalidated on focus, visibility return or reconnect; these events are
coalesced. There is **no staff polling or public staff/Auth subscription**.

Add Staff still creates only a pending review request. No invitation, account,
approval or role is invented. Unknown outcomes retain their actor-bound journal,
block further changes and **never automatically replay** this non-idempotent RPC.
Existing explicit same-key account/counter reconciliation remains intact.

## Interface and responsive evidence

Removed both manual refresh buttons. Small **Retry** actions appear only for genuine
loading failures. Their internal read/recovery functions remain in use. Staff order is
now description → **Add Staff by Email** → **Search Accounts/Registered Accounts** →
counter assignments. Existing Overview & Analytics, authorized active-ticket table,
five services, Account Security and logout remain. There is no separate implemented
Payor Management contract/tab to expose; none was fabricated.

Public Display and Sign Out passed at **1440, 1280, 1024, 980, 768, 640, 390 and 320px**.
Staff/overview layouts passed without horizontal page overflow. Header controls were
checked for overlap, obscured hit targets, focus and the correct route. Wide account
tables retain their keyboard-accessible internal scrolling.

Before/after screenshots use explicitly synthetic account/queue fixtures; production
contains no fixture data. Public monitoring normally uses real anonymous local reads.

- [Before — 980px, hidden Public Display](../supabase/tests/results/admin_navigation_8acc6e91_BEFORE_980.png)
- [After — 980px](../supabase/tests/results/admin_navigation_22ed84e2_AFTER_980.png)
- [Overview — desktop](../supabase/tests/results/admin_overview_22ed84e2_AFTER_1440.png)
- [Staff — tablet](../supabase/tests/results/admin_navigation_22ed84e2_AFTER_768.png)
- [Staff — 320px](../supabase/tests/results/admin_navigation_22ed84e2_AFTER_320.png)
- [Actual right-docked DevTools page viewport, intercepted ADMIN](../supabase/tests/results/admin_navigation_0832cfed_ACTUAL_DEVTOOLS_RIGHT.png)

Desktop/mobile and docked screenshots were visually inspected. The docked test used
an owned Chrome profile, verified the DevTools frontend's right-docked state, measured
the narrowed viewport and confirmed the **same dashboard DOM instance**. Its screenshot
captures the page viewport; it does not purport to capture the entire Chrome window.
Exact CSS-width tests exercise zoom-related reflow; native browser zoom shortcuts were
not separately automated. [Chrome placement reference](https://developer.chrome.com/docs/devtools/customize/placement).

## Tests and coverage limits

| Final group | Result |
| --- | --- |
| Frontend unit/view/security tests | **185 passed**, 0 failed/skipped |
| Browser interception policy | **15 passed** |
| Default OAuth/UI/automatic updates, `22ed84e2` | **25 groups passed** |
| MFA-enabled OAuth/UI, `91d6c1da` | **27 groups passed** |
| Actual right-docked Chrome, `0832cfed` | **3 groups passed** |
| Actual anonymous display/Realtime, `c7200c59` | **15 groups passed** |
| Isolated staff contracts/authorization, `01cdebd6` | **10 groups passed** |
| Real Vue + isolated queue backend, `ff9aa066` | **7 groups passed** |
| Existing SQL policies/read/routing in fixtures | **123 methods passed** in each fixture; repetitions not summed |
| Production build, private-key/canary scans, syntax/whitespace | PASS |

The browser update test sends controlled callbacks through the installed SDK's
existing listeners, verifies automatic private queue refresh, and proves public
events do not reload the directory. Focus bursts produce one directory/configuration
pair while retaining tab, search, draft and DOM identity. Tests also cover notification
storms, unchanged snapshots, superseded responses, cleanup, authorization failure,
unknown journals and all five fixed counter mappings.

Real anonymous subscription readiness, disconnect/reconnect and cleanup were tested
against the running local Realtime service. Queue issuance, Call/Skip/Serve, served
history and lost-response reconciliation used real disposable PostgreSQL/PostgREST.
Staff pending inserts, duplicate/unknown responses and STUDENT/CASHIER denial were
tested only in that isolated backend. Browser Auth/MFA responses are intercepted.
**No new real Google login, retained mutation-to-Realtime delivery or complete live
authenticated end-to-end acceptance is claimed.** The fixture has no Realtime service.

Actual read-only metadata confirmed both projections in `supabase_realtime`, enabled
INSERT/UPDATE/DELETE publication, RLS and the existing anonymous/authenticated SELECT
grants. Staff/Auth tables are not published. Approved queue/counter RPCs call the
existing projection refresh; arbitrary direct edits to private queue tables without
refreshing those projections have no reliable public signal. That backend limitation
was not bypassed with private subscriptions, new functions or migrations.

Earlier failures remain recorded: legacy unit expectations needed the new refreshing
state/debounce timing; a controlled public fixture was left active during later
navigation; reload assertions could observe the outgoing document. The fixture now
returns to live reads, and reload checks await the new document load event. A long
headed Auth run failed that harness timing check; the focused actual DevTools suite
and final headless suites passed. No interception or authorization gate was relaxed.

## Files and preservation

Changed production files: `AdminDashboard.vue`, `AuthWorkspace.vue`,
`QueueApplication.vue`, `QueueOverview.vue`, `workspace.css`; the four existing
queue/Auth/admin composables; `adminWorkspace.js`, `authController.js`,
`publicQueueController.js` and `workspaceData.js`. Added `src/lib/revalidation.js`.

Updated related unit/browser tests, the owned Chrome test helper and isolated queue
fixture/runner. Added `revalidation.test.js` and the fixed read-only
`tests/integration/inspectAutoRefresh.mjs`. The fixture helper selects an available
checked subnet before creating resources; its destination/source guards remain.

All **1,327 captured existing inputs remain; 1,306 retain their hashes**. The 21
changes are the scoped frontend/test files above. Existing modified/untracked work,
StudentDashboard, Google/PKCE/MFA interface modules, ticket-action implementation,
queue API contracts, six migration files, proposed 007, configuration, dependencies,
credential helpers and prior reports/evidence were preserved.

Final read-only closeout **October 20, 00:07:35 UTC+08** passed against the new task
baseline: application/Auth-user/identity and queue fingerprints, request/factor rows,
queue function definitions, service definitions and non-Vector lifecycles matched.
There remain **42 accounts and one pre-existing staff review request**; personal
Gmail remains ADMIN and the school account STUDENT. Auth/settings/API returned **200**,
Google stayed enabled, all five routes matched and proposed 007 storage remained absent.
This does not rewrite the previous task's separate Auth-fingerprint finding.

Exactly **four disposable containers are stopped** and their **two labeled networks**
remain. Existing containers/networks/volumes were preserved; no image was pulled.
Owned browser/test servers were closed; the user's existing frontend was left running.
Anonymous Realtime bookkeeping was exercised; database-wide immutability is not claimed.

[Final preservation/permissions](../tests/integration/results/admin_auto_refresh_closeout_5edb3e4e.json),
[default browser](../supabase/tests/results/google_oauth_frontend_22ed84e2.json),
[MFA browser](../supabase/tests/results/google_oauth_frontend_91d6c1da.json),
[actual DevTools](../supabase/tests/results/google_oauth_frontend_0832cfed.json),
[public display](../supabase/tests/results/public_board_c7200c59.json),
[staff backend](../tests/integration/results/add_staff_01cdebd6.json),
[queue browser/backend](../tests/integration/results/full_stack_browser_ff9aa066.json).

**Stopped after implementation, testing and reporting.** No retained request,
role/assignment/queue/Auth mutation, migration 007, SQL object creation, Supabase
restart, credential change, backup/volume deletion, deployment, Git commit or push ran.
