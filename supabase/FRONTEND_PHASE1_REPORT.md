# Engineering report: Vue frontend integration, Phase 1

Date: October 16, 2026. Result: public display implemented and locally validated.
Authenticated workflows and ticket issuance remain non-operational.

## Features implemented

- Replaced static queue numbers, counts, dates, wait estimates and personal-ticket
  claims with actual sanitized counter_state/service_state reads.
- Kept the existing emerald/slate palette, header, cards and responsive two-column
  layout. Student, cashier and administrator sections are explicitly labeled previews
  with disabled controls and no business requests.
- Added a reusable queue service: business reads and prepared future actions use
  `supabase.schema('queue_api').rpc(...)`; public reads explicitly select queue_display.
- Public reads select only known display columns, discard unexpected fields and
  reject truncated responses rather than presenting partial totals.
- Added separate stateless public Supabase client so stored Auth sessions cannot
  change public display requests. Both clients receive only a public API key.
- Subscribed only to counter_state/service_state, including INSERT/UPDATE/DELETE
  invalidation. Change payloads are not merged into application state.
- Backend postgres_changes readiness is required for both tables. Channel membership
  alone never marks the display live. A fresh snapshot follows readiness/reconnect.
- Snapshots apply both tables together; request epochs/versioning discard responses
  invalidated by changes, disconnects, retries or unmount. Bursts coalesce into a
  follow-up read. The last successful snapshot stays visibly stale during outages.
- Added loading, missing-data, empty, synchronizing, refreshing, disconnected and
  error states, with a manual retry and refreshed-at timestamp.
- Added online/offline and visibility reconciliation, bounded reads, and cleanup
  of only this display's channels/listeners when unmounted.

There is no public API for authoritative queue-day open status or full editable
service names. The page therefore shows reported service codes/dates and counter
availability, not an inferred office-open state. An empty service table renders
"No waiting totals have been published" and an unavailable total, rather than a
fabricated zero or a claim that the office is closed.

## Request safety

Future mutation preparation generates exactly one UUID and freezes the original
parameters. Execution/retry receives the prepared intent and never generates another
key. Abort/transport/ambiguous server errors carry outcome=unknown and the original
key, requiring reconciliation. No automatic mutation retry is implemented.

The permitted future helper operations are call_next, finish_ticket, set_account,
configure_counter, configure_service and manage_day. They are not wired to any UI.
issue_ticket is deliberately excluded from both read and mutation helper allowlists
until its outstanding positive HTTP validation is complete.

## Verification results

| Check | Result |
| --- | --- |
| Frontend service/controller/rendered-view checks | **18 passed, 0 failed** |
| Final live frontend integration checks | **7 passed, 0 failed** |
| Existing offline database structural checks | **6 passed** |
| npm production build with local process overrides | **Passed** |
| Built bundle scan for known local service-role/secret keys | **Passed; none embedded** |
| JavaScript/Python syntax and diff whitespace checks | Passed |
| Interactive browser/viewport visual review | Not run; no browser connected to automation |

The frontend checks include stale-response races, post-reconnect generations,
error retention, empty state, unmount cleanup, partial subscription setup cleanup,
readiness of both listeners, public field selection, truncation rejection, immutable
request keys, hosted/secret-key configuration rejection, and five rendered Vue views.
No third-party test dependency was installed; Node test runner, existing Vue SSR
packages and Vite were sufficient. There was no existing lint/typecheck frontend script.

Live evidence:
[frontend_public_3386a8c8.json](tests/results/frontend_public_3386a8c8.json).
An earlier live run also passed seven checks and is retained as
[frontend_public_208f02f8.json](tests/results/frontend_public_208f02f8.json).
Repeated checks are not added together to inflate scenario coverage.

The live harness imports the exact queueApi factory and publicQueueController used
by Vue. It validates every frontend HTTP request's URL, schema, apikey and anonymous
authorization. WebSocket targets are restricted to the same local gateway. It tested
both actual tables, coalesced snapshots after service inserts, forced socket closure,
fresh post-reconnect state, updates after reconnect and channel cleanup.

Frontend traffic used only the public key selected by the same algorithm as the
development/build helper (modern publishable key when available, legacy public
anon key otherwise). Privileged SQL belongs only to a separate test fixture operator;
no database credentials or service-role key are passed to frontend source or Vite.

## Local configuration and commands

The previous .env was not read, printed or changed. An ignored .env.development.local
was created with local API/public-key values from captured local CLI status. It
affects development only. The client rejects endpoints other than
http://127.0.0.1:54321 in all modes and rejects secret/service-role key formats.

Build configuration was supplied to the npm build subprocess in memory, preventing
the existing .env from supplying hosted values. No production environment file was
modified. A future hosted rollout requires an explicit review of the local endpoint
guard and separate deployment approval.

```powershell
# Starts Vite on 127.0.0.1:5173 using validated local public settings.
python scripts/local_frontend.py --dev

npm.cmd run test:frontend

# Runs npm run build with local process overrides and a private-key bundle check.
python scripts/local_frontend.py --build

# Creates/retains one isolated closed test day; preserves existing fixtures.
python supabase/tests/run_local_api_security.py --frontend
```

`--prepare` creates the ignored development override once and refuses to overwrite
an existing file. Ordinary npm run dev also uses that development override. The
validated helper is the recommended way to build locally because ordinary Vite
build uses production-mode environment precedence.

The development server was started at http://127.0.0.1:5173 for this task. No connected
browser was available, so automated SSR rendering and live SDK/controller tests
were used; manual desktop/mobile visual review remains recommended.

## Fixture preservation

Existing Auth/app accounts, private profiles, service/counter configuration, tickets,
events, queue days, allocators, assignments, replay and audit rows were fingerprinted
and remained unchanged. No previous fixture day was reopened.

Each of two live checks created one new empty historical fixture day (October 13
and October 12), populated its legitimate zero-wait display projections, then closed
only that new day. These records and closure audits are retained. No ticket or user
was created in this phase. Derived display timestamps changed normally. No existing
business records were deleted, and no database reset was performed.

## Files created or modified

| File | Change |
| --- | --- |
| src/App.vue | Container for public queue view and composable |
| src/components/PublicQueueDisplay.vue | Responsive public UI and disabled workspace previews |
| src/composables/usePublicQueue.js | Vue lifecycle, connectivity and visibility hooks |
| src/services/queueApi.js | Explicit schema access, public snapshots/subscriptions, prepared request intents |
| src/lib/publicQueueController.js | Snapshot/version/reconnect state machine |
| src/lib/queue.js | Configured service instance |
| src/lib/supabaseConfig.js | Local endpoint/public-key validation |
| src/lib/supabase.js | Validated shared client and stateless public client |
| scripts/local_frontend.py | Credential-safe local configuration, development and build commands |
| .env.development.local | Generated ignored local public configuration; values omitted from reports |
| package.json | Added test:frontend script; no dependency changes |
| tests/frontend/*.test.js | Three test files covering service, controller and rendered Vue view |
| supabase/tests/frontend_public_display.mjs | Real frontend service/controller integration harness |
| supabase/tests/run_local_api_security.py | Added --frontend routing and matching public-key selection |
| supabase/tests/results/frontend_public_*.json | Sanitized live evidence |
| supabase/FRONTEND_INTEGRATION_PLAN.md | Updated Phase 1 status and implemented API boundary |
| supabase/FRONTEND_PHASE1_REPORT.md | This report |

src/main.js and style.css were inspected and retained. No applied migration, RLS,
database grant, production configuration or package dependency was changed.

## Remaining requirements and next phase

- Safe self-context RPC for current role/enabled state and cashier assignments.
- Sanitized enabled-service catalog and authoritative current business-day context.
- Positive HTTP issuance/numbering/retry/quota validation on a fresh open current day.
- Google OAuth, identity/enrollment admission and protected navigation.
- Administrator audit pagination and MFA decisions before administrative UI acceptance.
- Browser desktop/mobile, offline and multi-tab acceptance checks.
- If strict cross-table atomic display snapshots are required, add a reviewed read
  contract: current parallel REST reads are not one database transaction. Event-driven
  invalidation reconciles changes but cannot make separate HTTP reads atomic.
- Public datasets exceeding the current API row cap require pagination; the UI
  currently fails safely rather than displaying truncated totals.

Recommended next phase: review the missing read contracts in a new versioned
migration, validate issuance in an isolated local stack, and then implement Auth
and role-specific views. Phase 1 does not implement or authorize those changes.

No hosted Supabase project was contacted. No credentials were exposed in reports,
no deployment occurred, and no Git commit or push was performed. Local validation
does not establish production readiness.
