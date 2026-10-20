# Phase 6, Part E — Student/Payor service-card layout

October 19, 2026 (UTC+08). **PASS for the authorized layout update and regressions.**
The introductory banner is removed. The existing five working service cards now
occupy the top of the dashboard, directly below its header/navigation. ADMIN and
MFA changes remain preparation only; none was activated in this task.

## Layout and behavior

- One service-card list, with the fixed mapping **1:TP, 2:SOA, 3:PNEP, 4:REF, 5:ADJ**.
  Each card shows its service name/code, assigned counter and actual availability.
  Burgundy, gold and white styling, visible keyboard focus and native button behavior
  are preserved. The old portal slogan, introductory copy and decorative number are gone.
- **Five columns at 1200px and above; three at 801–1199px; two at 480–800px;
  one below 480px.** Cards share compact spacing, with no duplicate service heading
  or horizontal page overflow at the tested sizes.
- The existing confirmation dialog and ticket actions remain connected to their
  original data and handlers. Disabled/unknown service catalogs and failed/missing
  snapshots prevent card selection. Counter-open status remains informational:
  the existing backend does not require an open counter to issue a ticket for an
  enabled service. Closed-day, active-ticket and quota validation still govern
  confirmation; no new admission rule was introduced.
- The shared live five-counter monitor is below service selection. The active-ticket
  rail remains sticky on desktop and stacks on smaller screens. No new subscription,
  Auth client, iframe or public/private data source was introduced. `/display` remains
  independent and functional.

Screenshots of the final layout:

- [Desktop — 1440px](../supabase/tests/results/video_ui_c702ac66_SIMULATED_student_1440.png)
- [Tablet — 768px](../supabase/tests/results/video_ui_c702ac66_SIMULATED_student_768.png)
- [Mobile — 390px](../supabase/tests/results/video_ui_c702ac66_SIMULATED_student_390.png)
- [Existing confirmation dialog](../supabase/tests/results/video_ui_c702ac66_SIMULATED_student-dialog_390.png)
- [Ticket issued through the real isolated backend](../tests/integration/results/full_stack_1349a1e7_student-issued_1440.png)
- [Actual anonymous standalone display](../supabase/tests/results/public_board_67cedc24_1366x768.png)

Desktop/mobile screenshots were visually inspected. Dashboard screenshots label
their synthetic Auth/ticket fixtures; public monitor data use real anonymous local
reads. The isolated issuance screenshot uses real disposable PostgreSQL/PostgREST
data with simulated Auth. No fixture ticket or availability value enters product code.

## Validation

| Check | Final result |
| --- | --- |
| Frontend unit/view/security tests | **125 passed**, zero failures/skips |
| Browser interception policy | **15 passed** |
| Vue/SDK browser regression, `c702ac66` | **19 groups passed** |
| Real isolated Vue/PostgreSQL/PostgREST flow, `1349a1e7` | **7 groups passed**; existing **123 SQL policy checks passed** |
| Standalone public-display regression, `67cedc24` | **15 groups passed** |
| Public-only production build and known local private-key scan | PASS |
| JavaScript syntax and whitespace checks | PASS |

Browser checks verified exactly five cards before the monitor, every service-to-counter
dialog binding, Enter activation, focus containment/return, disabled-card rejection,
availability failure/recovery, one live public queue socket and the sticky rail at
24px after scrolling. Responsive grid checks passed at 1440/768/390px. The standalone
monitor passed 1920/1366/768/390px, actual subscription readiness, offline/reconnect
and cleanup. Existing controlled invalidation-to-render tests also passed.

The real isolated backend flow verified issuance, duplicate-active rejection, cashier
processing, served history and explicit same-key recovery after response loss. Those
writes reached only the owned fixture. Real retained queue mutations and real Google
login were not performed. The fixture has no Realtime service; its operation refreshes
are HTTP-based. Actual anonymous Realtime behavior is covered separately above.

Earlier failed browser runs remain separate: `e917a415` lacked the native Enter event's
text payload; `58bcb4a3` exposed a malformed selector in the new availability test.
Both harness defects were corrected; no application acceptance condition was waived.
The unit run also emitted nonfatal file-watcher lock notices for the concurrent owned
Chrome profile; all 125 methods completed successfully.

Evidence: [Vue/SDK acceptance](../supabase/tests/results/google_oauth_frontend_c702ac66.json),
[real isolated operation acceptance](../tests/integration/results/full_stack_browser_1349a1e7.json),
[standalone display](../supabase/tests/results/public_board_67cedc24.json).

## Preservation and ADMIN/MFA boundary

Existing modified and untracked work was inspected and preserved. All **744** captured
pre-existing inputs remain; **740** retain their hashes. Only these four files changed:

- `src/components/StudentDashboard.vue` — template/card selection availability.
- `src/workspace.css` — compact responsive service-grid styling.
- `tests/frontend/embeddedMonitor.test.js` — layout/availability regressions.
- `tests/frontend/googleOAuth.browser.mjs` — card/dialog/layout/availability acceptance.

Ticket issuance logic, request-key reconciliation, quotas, RPC functions, migrations,
Auth/callback code, configuration and the public queue controller remain unchanged.
The isolated runner passed retained queue/Auth-user/identity fingerprints, function
hashes, service preservation and exact Docker resource accounting. Its two new test
containers are stopped; their labeled network remains. No volume was created/deleted.
Owned test servers/browsers were stopped; the user's existing frontend remains running.
Backups and Google credential storage were not opened or changed.

**No retained MFA enablement, staff-security migration or ADMIN promotion is authorized
or performed by this layout result.** The prior verified school-account binding and
required approval/enrollment work remain documented in
[the ADMIN preparation report](EMBEDDED_QUEUE_AND_ADMIN_SETUP_REPORT.md).
The proposed 007 SQL remains outside `supabase/migrations/`, unchanged at SHA-256
`b22d63d24c991b9ebf0d380d27a716d5ea72e418f5e62e177c96dded4481222c`.
No new MFA readiness or enrollment test is claimed. Sensitive staff controls remain
disabled pending the previously identified backend protections and separate approvals.

No retained database/Auth write, role/assignment change, service restart, Google
configuration change, backup/volume deletion, deployment, Git commit or push occurred.
**Stopped after the Part E layout, testing and report.**
