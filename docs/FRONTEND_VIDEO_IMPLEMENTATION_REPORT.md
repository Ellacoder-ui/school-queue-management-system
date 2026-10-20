# Frontend video implementation — Phase 2

October 18, 2026. **Implemented and tested.** The application now follows the video's
split login, service-card dashboard, ticket rail, cashier terminal and administrator
overview. Burgundy `#65263D` / hover `#4D1B2D`, gold, white and warm neutrals are retained.
No dependency, router or folder restructure was needed. This result covers presentation
and approved reads; operational writes remain disabled.

## Screens and interactions

| Screen | Implemented behavior |
| --- | --- |
| Login / callback | Burgundy promotional panel, white Google entry, verification/error/reconciliation states, public-display link and logout feedback. One existing Auth/PKCE flow; no role selector. Provider availability is checked before navigation. |
| Student / payor | Five fixed service cards, selection dialog with disabled confirmation, own active ticket and history, real counter availability, public calls/counts, local preparation checklist and logout confirmation. Ticket rail sticks on desktop and stacks on smaller screens. |
| Cashier | Database-assigned counter, current call, up next, queue table and ticket/service/date search with status filtering. Call Next, Mark Served and Skip are disabled with an explanation. No invented customer identities, priority or break status. |
| Administrator | Current open-counter, waiting/called-ticket and enabled-service summaries; all five counters; active-ticket search/service filter; public queue configuration readouts. Historical analytics and Staff tabs show truthful unavailable states. Staff invitation, configuration and promotion controls are disabled. |
| Public monitor | `/display` and `/display/` retain the existing independent composition, five-counter routing, Manila date handling, anonymous subscriptions and responsive styles. |

Ticket rules remain **one active ticket across all services**, and **at most two SERVED
tickets per service per issuance day**. The UI does not calculate an ETA, precise student
queue position, office hours or remaining quota. Ticket labels are accompanied by their
queue date. Empty, loading, unavailable and interrupted public updates are distinct.

Native modal dialogs include keyboard focus containment, Escape/close and focus return.
Buttons, forms and tables have visible focus states; wide tables scroll inside their
containers. Mobile/tablet behavior is an adaptation: the reference recording only
demonstrated desktop. The L monogram is a simple brand treatment, not an official seal.

## Files and reused contracts

Modified existing files:

- `src/components/QueueApplication.vue` — replaces the monitor-wrapped placeholder with
  the product workspace; retains exactly one `useQueueAuth` instance.
- `src/components/AuthWorkspace.vue` — split login, shared header, role-specific views,
  public overview navigation and sign-out confirmation.
- `tests/frontend/googleOAuth.browser.mjs` — preserves callback/security tests and adds
  dashboard, dialog, error/empty, responsive and disabled-control acceptance.

New frontend files:

- `src/components/StudentDashboard.vue`, `CashierDashboard.vue`, `AdminDashboard.vue`.
- `src/components/QueueOverview.vue`, `WorkspaceDialog.vue`.
- `src/composables/useWorkspaceData.js`, `src/lib/workspaceData.js`.
- `src/workspace.css` — prefixed dashboard styles, loaded with the product workspace.
- `tests/frontend/workspaceData.test.js`, `workspaceViews.test.js`.

Existing `authController.js`, Google OAuth/callback modules, `useQueueAuth.js`,
`queueApi.js`, authenticated/anonymous client separation, public controller, monitor
components/styles, migrations and backend authorization remain unchanged.

| UI data | Existing permitted contract |
| --- | --- |
| Role, enabled access, cashier assignments | Existing verified `getUser` → `queue_api.my_context` flow |
| Student's active ticket and history | `queue_api.my_tickets` through the existing authenticated API |
| Cashier/admin active queues | `queue_api.staff_queue`; cashier display further scopes to its selected assignment |
| Service catalog, business date/day | `queue_display.public_queue_context` |
| Counter calls, availability and waiting totals | Existing anonymous `counter_state` / `service_state` reads and Realtime invalidation/reload |

Private reads refresh on public snapshot changes, visibility/online recovery, a visible
30-second poll and manual refresh. Access changes abort and clear private state; generation
checks discard late responses even if cancellation is ignored. Errors never display raw
diagnostics. Nothing subscribes to private tables or invokes a mutation RPC.

`admin_configuration` is deliberately **not requested**: its account directory lacks
the approved MFA boundary identified in the audit. The staff screen stays unavailable
instead of exposing that data or inventing names/emails/invitations. Current summaries
use public state and the authorized active-queue read, not historical statistics.

## Validation and visual evidence

| Check | Final result |
| --- | --- |
| `npm.cmd run test:frontend` | **96 passed**, 0 failed/skipped; includes 11 new reader/view tests |
| `node --test tests/frontend/browserInterception.unit.mjs` | **15 passed**, 0 failed/skipped |
| `node tests/frontend/googleOAuth.browser.mjs` | **18 passed**, 0 failed; final run `8c4add0a` |
| `node tests/frontend/publicBoard.browser.mjs` | **15 passed**, 0 failed; run `d2dba21d` |
| `python -B scripts/local_frontend.py --build` | PASS; public-only build and known local service-role/secret-key scan |
| Additional built-asset scan | PASS; no test identity/token/ticket canaries or matching Google-secret/private-key patterns |
| JavaScript syntax / `git diff --check` | PASS |

The intercepted suite exercises the actual Vue application and installed SDK with
synthetic Auth/private-read responses. **It never forwards those requests to retained
Auth or private RPCs and never contacts Google.** Public-display tests use real anonymous
local reads/subscriptions and test offline/reconnect behavior. Successful screenshots
exist at **1440, 768 and 390px** for login, student, service dialog, cashier, admin overview
and Staff. The monitor also passed **1920, 1366, 768 and 390px** checks.

The private-read wiring uses the existing approved RPC contracts. Live authenticated
read acceptance still needs an approved real session; this phase tested those requests
with intercepted contract fixtures rather than signing in to retained accounts.

Representative screenshots (dashboard tickets/roles are explicitly labeled browser fixtures):

- [Login desktop](../supabase/tests/results/video_ui_8c4add0a_SIMULATED_login_1440.png)
- [Student desktop](../supabase/tests/results/video_ui_8c4add0a_SIMULATED_student_1440.png)
- [Student mobile](../supabase/tests/results/video_ui_8c4add0a_SIMULATED_student_390.png)
- [Service dialog mobile](../supabase/tests/results/video_ui_8c4add0a_SIMULATED_student-dialog_390.png)
- [Cashier desktop](../supabase/tests/results/video_ui_8c4add0a_SIMULATED_cashier_1440.png)
- [Admin overview](../supabase/tests/results/video_ui_8c4add0a_SIMULATED_admin_1440.png)
- [Staff unavailable state](../supabase/tests/results/video_ui_8c4add0a_SIMULATED_admin-staff_390.png)
- [Actual anonymous monitor](../supabase/tests/results/public_board_d2dba21d_1366x768.png)

Evidence: [UI/PKCE acceptance](../supabase/tests/results/google_oauth_frontend_8c4add0a.json),
[public-display acceptance](../supabase/tests/results/public_board_d2dba21d.json).
Screenshots were visually inspected as well as checked for horizontal overflow.

Earlier browser attempts remain separate: an uppercase-heading assertion was corrected;
keyboard testing found and fixed a dialog focus escape; a cold-cache startup was warmed
before browser readiness; and cancellation correlation now uses the existing guard's
200ms bound with the same exact request/error checks. Final acceptance passed. Initial
PowerShell `npm` policy failure was resolved with `npm.cmd`, without policy changes.
The build's sandbox-blocked status read succeeded using the authorized read-only retry.

## Preservation and remaining work

Initial Git status was clean; there was no existing untracked work to overwrite.
Of **405 captured existing source/configuration/test/report inputs**, **402 retained
their hashes**; only the three authorized files listed above changed. Historical audit,
recovery evidence, infrastructure/credential helpers, dependency files and backend source
were preserved. New browser evidence/screenshots and isolated test caches are additional
artifacts. Owned browser/test-server processes were stopped; existing resources were
not deleted. No destructive Git command, staging, commit, push or deployment ran.

No database/Auth write, login, identity creation/linking, promotion, migration, Google
activation, Docker service operation or backup access/change was performed. Normal
public subscriptions were exercised; this is not a new database-wide immutability or
recovery certification. A final public settings read returned HTTP 200, **Google=false**.
The protected Google store was not opened or decrypted. Build scans cover the stated
known values/patterns, not an unavailable real Google secret or every possible secret.

Remaining separate work: provider activation and user-controlled real Google consent/
PKCE/login testing; authorized ticket issuance; cashier operations and reconciliation;
MFA-protected staff management; historical reporting contracts. No simulated production
data or success was added to fill those gaps. ADMIN/CASHIER access remains determined
by current database context, never by role selection, Google metadata or email domain.

## Launch locally

In PowerShell, with the existing local Supabase services already running:

```powershell
Set-Location -LiteralPath 'C:\Users\Hp\school-queue-management-system'
python -B scripts/local_frontend.py --dev
```

Open `http://127.0.0.1:5173/`; use `/display` for the monitor. `/dev/login` retains its
existing development-only form; using it would sign in and is not part of this task.
The launcher supplies only validated local public configuration in memory. Do not use
`--prepare` to overwrite environment files. Google remains unavailable until separately
activated; the product button reports that state truthfully.

**Stopped after frontend implementation, validation and this report. No Phase 3 or
infrastructure operation is authorized or started by this result.**
