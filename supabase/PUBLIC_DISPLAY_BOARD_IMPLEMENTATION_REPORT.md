# Engineering report: final public queue display board

Date: October 17, 2026. Result: **PASS for the completed frontend and read-only local acceptance checks.**
The public monitor is available at **/display** without requiring login. The existing
application and account workspace remain at **/**. Google Sign-In, ticket issuance
and operational staff/admin controls remain unimplemented or disabled as before.

## Visual implementation

The attached reference was opened and inspected before implementation. The board
uses its deep burgundy background, rose/maroon hero gradient, warm amber ticket
typography, white text, rounded cards and restrained borders. Branding reads
“Liceo de Cagayan University / CASHIER QUEUE DISPLAY.” The icon is a generic ticket
symbol, not an invented university logo. No external image/font service is required.

The header clock/date use Asia/Manila, update while mounted and clean up their timer.
This is the device clock; authoritative business date/open status still come from
the server RPC and are displayed separately. No open-day inference uses counter flags.

All five fixed destinations always appear:

| Counter | Service |
| --- | --- |
| 01 | TP — Tuition Payment |
| 02 | SOA — Statement of Account |
| 03 | PNEP — Promissory Notes and Exam Permits |
| 04 | REF — Refund Process |
| 05 | ADJ — Adjustment Clerk |

The hero highlights the lowest-numbered counter with a reported call. Its note gives
the simultaneous-call count and explains the deterministic selection; every call
also remains visible in its own counter card. There is no rotation that hides calls.
Tickets retain their complete backend labels, including PNEP and REF.

Loading/unavailable, idle, closed counter, queue-day-not-open, synchronizing,
disconnected and error states are explicit. Last-known calls remain visible during
outages as **Last reported call**, without a current “Proceed to” instruction.
The live heading, green readiness indicators and automatic-update footer depend on
the controller's backend readiness, successful synchronization and absence of errors.

The screenshot's UP NEXT strip becomes **WAITING TICKETS**, with supplied counts and
their queue dates. Missing totals show a dash and “Not reported”; an empty table is
not converted to five fabricated zeros. No individual next ticket is inferred.

The layout uses five cards across on monitors, two on tablet and one on mobile.
Normal closed and five-call test states fit at both 1920×1080 and 1366×768 without
vertical scrolling. Tablet/mobile use natural vertical scrolling with no horizontal
overflow. Arbitrarily large catalogs/date histories or unusually long content can
require more height; content is allowed to wrap rather than being hidden.

Accessibility includes semantic header/main/sections/footer, a skip link to all
counter calls, visible keyboard focus, text alongside status colors, an accessible
refresh button, alert/error states and a polite announcement containing every call.
Clock ticks are excluded from live announcements. Manual screen-reader and physical
distance/readability acceptance remain recommended.

## Data sources and exact field meanings

Existing queueApi/publicQueueController/usePublicQueue are reused without changes.
No database API, migration or public DTO was added or modified.

| Existing public source | Fields consumed / meaning |
| --- | --- |
| queue_display.counter_state | counter_id is a public identifier; counter_label identifies the published desk; is_open is counter availability; ticket_label/service_code/business_date describe its currently CALLED ticket; updated_at is projection time |
| queue_display.service_state | service_code, business_date, waiting_count and updated_at; totals are service/date aggregates, not a list or ordering of individual waiting tickets |
| queue_display.public_queue_context() | timezone, authoritative current business_date, queue_day_open and enabled services [{code,name}] |

The permanent presentation map is approved configuration text, not fabricated live
activity. Enabled service names are taken from the public catalog when available;
fixed names provide desk labels otherwise. Catalog absence does not imply availability.

**Existing contract limitation:** counter_state exposes no numeric counter identity
or permanent route column. Current seed/projection labels are exactly Counter 1–5.
The view accepts only those exact labels and matches them to the approved fixed map;
it never uses array position, UUID ordering or idle service_code to guess a destination.
Unknown/duplicate labels or cross-service called labels produce an explicit data
error/unavailable state. Missing rows leave the corresponding permanent card unavailable.
If custom labels become necessary, a separately reviewed numeric public contract is
needed. No backend endpoint was invented to solve that future requirement.

Queue-day-not-open includes an absent or closed current day. It does not erase a
genuine call reported for another issuance date; ticket dates are shown explicitly.
Separate counter/service/context HTTP reads remain a reconciled snapshot, not one
database transaction.

## Readiness, reconnect and application composition

The existing subscription implementation still listens only to counter_state and
service_state. Both postgres_changes listeners must report backend readiness, followed
by a fresh snapshot. INSERT/UPDATE/DELETE payloads invalidate snapshots; event payloads
are never merged directly into the UI. Request versions/epochs reject delayed responses
after changes, disconnects, retries or unmount; bursts coalesce into a follow-up read.

Online/offline, visibility restoration and institution-date rollover reconciliation
remain in the existing composable/controller. The display clock does not manufacture
a new server business date. Unmount removes listeners, owned channels, requests and
timers through the existing lifecycle plus the new clock cleanup.

App.vue selects a separate /display composition that mounts the public composable
without the Auth controller/form. At /, QueueApplication retains the original Auth
composition and places its unchanged workspace below the board in a light container.
A link opens the monitor. No Router dependency, Auth role logic or protected action
was introduced. A future static host must serve the SPA for direct /display navigation;
the local Vite deep link was exercised successfully.

## Completed verification

| Check/group | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Final frontend unit/controller/SSR tests | **61** | **0** | **0** |
| Final local SDK/Realtime/browser acceptance checks | **15** | **0** | **0** |
| Production build with validated local public configuration | PASS | 0 | 0 |
| Built JavaScript known-local-private-key scan | PASS | 0 | 0 |
| JavaScript/Python syntax and diff whitespace checks | PASS | 0 | 0 |
| Read-only source table/schema preservation | PASS | 0 | 0 |

The 61 tests retain the existing 51-method coverage and add ten board-specific
methods: fixed identity matching, malformed/ambiguous routes, deterministic concurrent
calls, per-date/zero/missing totals, independent day/counter state, stale calls,
subscription synchronization, escaping, Manila midnight formatting and route selection.
The prior view fixture using ADJ at Counter 3 was corrected to the approved Counter 5,
with stronger assertions for all five cards and missing data. No security/race assertion
was removed. Repeated runs are not added together.

The 15 acceptance checks cover actual anonymous HTTP reads, both live listeners,
forced socket closure/fresh reconnect reads, channel cleanup, monitor/root composition,
four real-data viewports, browser offline/reconnect and three explicitly simulated
five-call viewports. Network interception restricted traffic to its own Vite origin
and the existing local public API paths/sockets. Actual data requests required the
public key, anonymous authorization and queue_display profile. Credential-free CORS
OPTIONS requests were allowed only for the known local paths/origin/read methods.
No unexpected endpoint or uncaught browser runtime exception was observed.

Evidence: [completed 15-check run](tests/results/public_board_01af0550.json).

### Browser screenshots and comparison

Installed Chrome was run headlessly with an isolated incognito profile and a separate
Vite process at 127.0.0.1:5175. Both were closed after testing; the ignored disposable
profile is retained. No existing browser profile was reused or modified.

Real database state is currently idle with the current day not open, Counters 1/2
marked open and Counters 3/4/5 closed. It correctly renders no ticket labels/counts.

- [Real 1920×1080 board](tests/results/public_board_01af0550_1920x1080.png)
- [Real 1366×768 board](tests/results/public_board_01af0550_1366x768.png)
- [Real tablet 768×1024](tests/results/public_board_01af0550_768x1024.png)
- [Real mobile 390×844](tests/results/public_board_01af0550_390x844.png)

Serving layout was additionally exercised through browser-only intercepted public
responses. These images have a conspicuous **SIMULATED RENDER TEST — NOT LIVE DATABASE
DATA** banner; the fixtures exist only in the test harness, never in production source
or database records.

- [Simulated five calls, 1920×1080](tests/results/public_board_01af0550_SIMULATED_1920x1080.png)
- [Simulated five calls, 1366×768](tests/results/public_board_01af0550_SIMULATED_1366x768.png)
- [Simulated five calls, mobile](tests/results/public_board_01af0550_SIMULATED_390x844.png)

The real desktop/mobile and simulated desktop images were opened and visually inspected.
Viewport emulation is not physical-device testing. Firefox/Safari, manual keyboard/
screen-reader acceptance and real monitor viewing distance were not exercised.

### Earlier failures retained

Three stopped browser attempts are retained separately: 0ed27f8d, 0bf54865 and a3fca1fc.
The first two were blocked by the harness incorrectly requiring credentials on browser
CORS preflights. The second preserved the exact blocked methods and safe diagnostics.
After correcting interception, 1920×1080 passed but 1366×768 exposed slight vertical
overflow. Compact-monitor spacing/card typography were adjusted; the final run passed
both idle and five-call layouts. Earlier pass counts are not combined with final counts.

The first preservation wrapper also treated Realtime's own allocated subscription-ID
sequence as unchanged database history. Read-only diagnosis showed **only** that sequence
advanced; every table and captured schema/security section remained unchanged. The
corrected frontend test fence explicitly records that operational sequence and rejects
every other baseline difference. It does not modify historical backup comparators.

### Scope limits / tests not run

Actual serving-ticket mutations and live table-change broadcasts were not generated:
doing so would violate this task's no-data-change scope. Event/delayed-response behavior
is covered deterministically by retained controller/service tests; real subscription
readiness, transport reconnect and new authoritative reads were exercised live.
The simulated five-call rendering is not a claim of new business-operation acceptance.
No pgTAP, concurrency, authenticated fixture-creating HTTP suite or server-clock midnight
crossing was run. Google OAuth and operational workflows were outside scope.

## Privacy, security and source preservation

The stateless public client, exact loopback target guard, explicit selected columns,
public context validation and partial-response rejection remain unchanged. The board
does not read queue_private or private ticket records and does not subscribe to private
tables. No names/emails/Auth UUIDs, provider tokens or account credentials enter its
public DOM. Public counter identifiers are used for matching in memory and are not
rendered as DOM attributes. Untrusted service names use escaped Vue interpolation.

The production build receives only local public frontend settings. The existing build
helper scanned generated JavaScript for captured local service-role/secret values and
found none. This is a scan for known values, not proof that every possible secret is
absent. No dependency or system software was installed.

Read-only pre/post fences verified project school-queue-local, PostgreSQL
127.0.0.1:54322/postgres, API 127.0.0.1:54321, exact six migration hashes/history,
fixed routing, all 69 table counts/fingerprints, schema/security metadata, roles and
additional ACL/settings. Accounts, Auth data, tickets/events, assignments, days,
allocators, audit/replay records and public projection rows are unchanged.

The service-owned realtime.subscription_id_seq advanced from **46 to 60** in the
final run as subscriptions were established. Other sequences were unchanged. No SQL
write or business/Auth mutation was requested; the sequence allocation is normal
Realtime infrastructure behavior, not a fixture edit. Earlier attempts also allocated
subscription IDs. An exact old backup source-equality check can consequently reject
this operational sequence difference; no backup baseline was rewritten to hide it.

No application authorization/privacy regression was observed. The frontend navigation
remains UX only; database authority is unchanged. No RLS, grant, provider setting,
migration, recovery artifact, container configuration or Docker volume changed.
No hosted Supabase contact, reset/push/link, Google setup, deployment, commit or push
was performed.

## Files created or modified

| File | Change |
| --- | --- |
| src/App.vue | Select anonymous monitor or existing application composition |
| src/components/PublicQueueDisplay.vue | Reference-based live/idle/stale board and clock lifecycle |
| src/components/PublicQueueMonitor.vue | New public-only monitor composition |
| src/components/QueueApplication.vue | Original public/Auth composition extracted without authorization changes |
| src/lib/publicBoard.js | Permanent presentation map, safe public-label matching, waiting groups, Manila clock and exact monitor path |
| src/style.css | Scoped burgundy/amber board styling and responsive layouts |
| tests/frontend/publicQueueView.test.js | Retain prior scenarios; adapt valid fixed destination/all-counter assertions |
| tests/frontend/publicBoard.test.js | Ten new rendering/model/clock/path methods |
| tests/frontend/publicBoard.browser.mjs | Read-only live SDK/browser acceptance and labeled rendering fixtures |
| tests/frontend/run_public_board.py | Local identity/history/preservation fences around acceptance |
| supabase/tests/results/public_board_*.json and corresponding PNGs | Sanitized completed/stopped evidence and screenshots |
| supabase/PUBLIC_DISPLAY_BOARD_IMPLEMENTATION_REPORT.md | This report |

dist/ was regenerated as an ignored build artifact. Existing main.js, Auth source,
queueApi, publicQueueController, usePublicQueue, SQL files, package dependencies,
environment files and backend test implementations were retained.

## Local usage and next boundary

```powershell
# Use validated local public settings; open http://127.0.0.1:5173/display.
python scripts/local_frontend.py --dev

npm.cmd run test:frontend
python scripts/local_frontend.py --build

# Read-only local SDK/browser acceptance; creates only frontend evidence/profile files.
python tests/frontend/run_public_board.py
```

Use / for the existing account workspace. The monitor page has no login requirement.
Future hosting, Google Auth, new public identity/route APIs, operational issuance and
staff/admin integration require their separately approved phases.

Deviations from the reference are deliberate: five cards instead of three, full
PNEP/REF labels, truthful waiting totals instead of guessed next tickets, explicit
business-day/readiness/refresh/stale information and real idle content in current
screenshots. No reference queue number was inserted into the production board.

**Stopped after implementation and local testing. Awaiting approval before another phase.**
