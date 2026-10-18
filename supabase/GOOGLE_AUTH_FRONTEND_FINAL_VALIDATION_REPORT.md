# Engineering report: Step 21 frontend final validation

Date: October 17, 2026. Result: **PASS for the completed local frontend postvalidation.**
The original public-board CDP error was reproduced, identified and corrected without
relaxing the network guard. All required checks completed in fresh run **9d91d12f**,
October 17, **13:25:45–13:27:26 UTC+08:00**. Previous FAIL evidence remains unchanged.

Google remains disabled. No real Google login, provider activation, administrator
designation, migration or business/Auth record mutation was performed.

## Established CDP root cause

The original public-board handler reduced every interception exception to
`Browser interception failure`. The shared Chrome driver also discarded the protocol
error payload, preventing a reliable diagnosis.

A diagnostic run retained the strict failing behavior while capturing sanitized
protocol and request-lifecycle metadata. It reproduced three errors during the browser
offline/reconnect scenario:

| Property | Observation |
| --- | --- |
| Browser / protocol | Chrome 155.0.8059.40 / CDP 1.3 |
| Command | Fetch.continueRequest |
| Protocol code / reviewed message category | -32602 / invalid-interception-id |
| Requests | Two permitted GET public projections and one permitted POST public-context read |
| Associated Network event | loadingFailed, canceled=true, net::ERR_ABORTED |
| Cancellation timing | Already recorded when the command error was handled |
| Policy violations / uncaught browser exceptions | None recorded |

Chrome had canceled these requests and removed their interception jobs before the
asynchronous continuation commands completed. This is an interception lifecycle race,
not an unexpected endpoint or a demonstrated application exception. Chromium returns
an invalid-parameters error when an interception job is absent; this supports the
observed protocol behavior. See the official
[interceptor implementation](https://chromium.googlesource.com/chromium/src/+/c0827554c381cf5837d1c51a3794368ee788558d/content/browser/devtools/devtools_url_loader_interceptor.cc).

Evidence: [diagnostic reproduction, 2c75acab](tests/results/public_board_2c75acab.json).
The older 46bba6cd record lacks sufficient diagnostics for retrospective attribution
of its individual request. The same failing path was reproduced independently before
any benign-error handling was introduced.

## Correction and unchanged security requirements

The new test-only `browserInterception.mjs` tracks each pause through a terminal
continue, fulfill, policy failure or independently verified browser cancellation.

- Policy is evaluated before cancellation or duplicate handling. Forbidden requests
  remain fatal even if Chrome subsequently cancels them.
- An already canceled request is not continued again. A command race is classified
  benign only for **-32602, the exact reviewed Invalid InterceptionId category,
  Fetch.continueRequest/Fetch.fulfillRequest, a permitted request and the same Network
  request's canceled=true / ERR_ABORTED event**. Correlation waits at most 200 ms when
  event delivery follows the command reply.
- Unsupported codes/messages, missing or mismatched correlation, timeouts, nonprotocol
  exceptions and unexpected detachment remain fatal. There is no general CDP-error
  exclusion. The OAuth harness's older cancellation catch was also tightened to this
  exact protocol/cancellation predicate.
- Identical duplicate/stale pause events receive at most one terminal command;
  conflicting duplicates fail. Every duplicate is still checked against policy.
- Shutdown keeps the guard attached while stopping loads and committing an owned
  about:blank document. It drains handlers, disables Fetch, drains again and unregisters
  every owned interception listener before closing Chrome. The owned Node SDK client
  also explicitly disconnects.

The public fence permits only local application GET/HEAD resources, the two public
projection GETs, the existing public-context POST and endpoint-specific CORS preflights.
Actual public reads require the exact local public credentials and queue_display
profile. Private/conflicting profiles, cookies, credential-bearing URLs, other methods,
operational RPCs, Auth endpoints and external origins are rejected. These method/profile
checks strengthen the earlier read-only policy; no destination was added.

Diagnostics contain ordinal request references, fixed endpoint categories, HTTP methods,
test phases, terminal states, numeric protocol codes and reviewed error categories.
They exclude request URLs/queries, headers, cookies, credentials, bodies, claims and raw
exception text. The shared driver preserves only this sanitized protocol information
and now provides listener-disposal callbacks.

The completed public-board run encountered the same three canceled-request races and
classified them using their matching evidence. Its 99 recorded requests ended as
90 continuations, six browser-only synthetic responses and three verified cancellations.
There were **zero policy violations, zero fatal errors and zero retained interception
handlers**. The simulated ticket responses remained confined to the rendering harness.

## Additional test-harness reliability work

The OAuth success assertion now waits for all existing acceptance conditions in one
browser observation: root path, empty query/fragment, student workspace, Queue Dashboard
text and absence of an administrator workspace. It retains the original bounded timeout
and one-exchange assertion. This avoids sampling separate stages of asynchronous
callback/authorization rendering. Only boolean observations are saved.

Each owned browser-test Vite server now has a separate ignored dependency cache and
must remain running during readiness checks. Existing application config and any
developer Vite process are untouched. The OAuth proxy records resource categories and
HTTP statuses; all **388** application-resource responses in the completed OAuth run
were HTTP 200.

Earlier attempts are retained:

| Attempt | Outcome and disposition |
| --- | --- |
| public_board_2c75acab | 14 passed / 1 failed; diagnostic reproduction established the cancellation race before handling was changed |
| final orchestration a58e9ab0 / OAuth 1a8ed6e5 | OAuth assertion failed after two checks; separate workspace and URL/text samples were replaced by the complete atomic wait; product code was retained |
| final orchestration ac3ae692 / OAuth d35e7f7a | Setup timed out on a blank document before scenarios ran; no blocked endpoint or runtime error was recorded. Its exact cause was not established. Resource-status diagnostics, owned-server checks and cache isolation were added; this record remains FAIL |
| OAuth 324abcc5 / public board c12e09b7 | Separate diagnostic confirmations passed 15 checks each; not added to the final suite counts |

No historical failure was overwritten or converted to PASS. The final result below
belongs to a new complete run, with all required observations collected successfully.

## Final completed verification

| Check/group | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| New interception policy/lifecycle unit methods | **15** | **0** | **0** |
| Existing frontend unit/controller/SSR/SDK methods | **85** | **0** | **0** |
| Existing strict Realtime preservation methods | **24** | **0** | **0** |
| Complete mocked OAuth browser acceptance | **15** | **0** | **0** |
| Complete public-board SDK/browser acceptance | **15** | **0** | **0** |
| Anonymous REST schema-denial checks | **2** | **0** | **0** |
| Production build and known-private-key bundle scan | PASS | 0 | 0 |
| Before/after scoped source and recovery-artifact gates | PASS | 0 | 0 |
| Historical evidence and tested-code hash preservation | PASS | 0 | 0 |
| JavaScript/Python syntax and whitespace checks | PASS | 0 | 0 |
| Real Google provider, consent, linking and first-login acceptance | Not run; provider disabled and outside this task | — | — |

Repeated runs are not counted twice. The 15 new unit methods cover normal reads and
preflights; private/hosted/operational rejection; preexisting and in-flight cancellation;
bounded late correlation; wrong request IDs; unsupported codes/messages; duplicate/stale
events; unexpected browser exceptions/detachment; owned shutdown with in-flight work;
and cleanup failure without orphaned handlers. Negative cases use a deterministic
fake CDP transport and make no private/hosted/mutation requests.

The OAuth suite uses actual Vue and the installed SDK with intercepted Auth/OAuth and
authoritative-context responses. It preserves ordinary-role enforcement despite
adversarial metadata, session recovery, cashier/admin context compatibility, revocation,
disablement, logout/account switching, duplicate/canceled/expired/missing-verifier flows,
desktop/mobile and development-login separation. It forwards no mocked Auth mutation
to the retained server. Public monitor reads and Realtime readiness remain real.

The public-board suite includes real anonymous snapshots, both listeners, forced socket
closure/fresh reconnect reads, controller cleanup, offline recovery, root/monitor
composition, four real viewports and three labeled simulated-call layouts. It passes
the final network/runtime and interception-cleanup guard.

The production helper built with validated local public configuration and exited 0.
Its scan found neither captured local service-role nor secret-key value in generated
JavaScript. This is a scan for known local private-key values, not a universal secret
audit or a scan against a configured Google client secret. No dependency was installed.

Completed evidence:

- [Combined validation 9d91d12f](tests/results/google_frontend_final_validation_9d91d12f.json).
- [OAuth browser bd020408](tests/results/google_oauth_frontend_bd020408.json).
- [Public board f8fa6189](tests/results/public_board_f8fa6189.json).

Combined evidence SHA-256:
`9df00996b70e8021fbcb1b053aea2c5b17bb980739f6796dc7347c4126725047`.

## Retained data, security and recovery preservation

Read-only preflight and final inspection independently verified school-queue-local,
PostgreSQL **127.0.0.1:54322/postgres**, API **http://127.0.0.1:54321**, PostgreSQL 17.11,
cluster **7696959712798593061**, and the retained container/network/volume identities.
Exactly migrations 001–006 remain applied, with original file hashes and one 006 receipt.
Fixed routing remains **1:TP, 2:SOA, 3:PNEP, 4:REF, 5:ADJ**.

All application/Auth/history fingerprints and captured schema/security metadata matched.
Final durable state remains 39 accounts, 20 terminal tickets, 57 events, 69 replay
receipts, 32 audits, seven closed days and four staff assignments. There are zero active
WAITING/CALLED tickets and no open days. Counter availability, services and Counter 5's
stale STUDENT fixture assignment remain unchanged.

All 15 application tables retain RLS. Roles, grants, policies, default privileges,
functions and database-setting hashes remain exact. Browser roles lack queue_private
USAGE. The application publication still contains only counter_state/service_state;
anonymous realtime and queue_private REST profiles return 406 / PGRST106.

The strict Realtime classifier was retained and its 24 methods passed. The inventory
remains **70 logical tables**, with no new partition during the completed run. All
69 tables outside the explicitly scoped subscription table remain exact. Anonymous
public subscription rows changed from four to two and subscription_id_seq advanced
from **238 to 280**. Their live scope checks passed; all other sequences were unchanged.
These are recorded platform lifecycle effects, not claimed database-wide immutability.

Protected recovery-file checksums, source associations, generated supplements and NTFS
restrictions passed before and after testing. Seventeen historical evidence/report
files and 45 tested code/configuration files retained their exact hashes. No recovery
manifest was rebased, no archive was restored or rewritten, and no volume was started,
reset or deleted. The original verified bundle remains its historical 69-table recovery
point; this task did not create a new backup of the live 70-table inventory.

The actual local Auth settings endpoint still reports **Google disabled**. Auth container
nonsecret settings and the existing provisioning trigger remain unchanged. No actual
user/session provisioning or staff authorization was tested through a real provider.

## Files and next boundary

Created:

- `supabase/tests/cdp_errors.mjs` — sanitized protocol error categories/codes.
- `tests/frontend/browserInterception.mjs` — strict policy and request lifecycle controller.
- `tests/frontend/browserInterception.unit.mjs` — 15 deterministic unit methods.
- `tests/frontend/startTestVite.mjs` — owned local servers with separate ignored caches.
- New diagnostic/completed evidence, screenshots and this report.

Modified:

- `supabase/tests/headless_local_browser.mjs` — preserve safe protocol details and permit listener disposal.
- `tests/frontend/publicBoard.browser.mjs` — lifecycle controller, strict public-read policy and ordered cleanup.
- `tests/frontend/googleOAuth.browser.mjs` — narrow cancellation handling, atomic acceptance wait and sanitized resource diagnostics.
- `tests/frontend/run_google_auth_postvalidation.py` — interception-unit execution, fresh evidence and expanded immutable-file checks.

Product source, dependencies, SQL migrations, provider/environment files, RLS/grants,
existing business/Auth records and historical reports were retained. dist/ was regenerated
as an ignored artifact. Owned Chrome/Vite processes exited; profiles, isolated caches,
screenshots and evidence were retained. No hosted Supabase project, reset, push, link,
deployment, administrator promotion, real ticket issuance, Git commit or push occurred.

**Step 21 frontend implementation has passed the requested local validation scope.**
It is appropriate to begin a **separately authorized real Google provider setup task**,
with fresh local target/recovery checks and the reviewed secret/callback/redirect procedure.
This result does not activate that phase or establish real-provider, operational UI or
production acceptance. Real consent/callback/linking, independent-tab provider behavior,
admission rules and administrator MFA remain their separate acceptance work.

Executed final command:

~~~powershell
python tests/frontend/run_google_auth_postvalidation.py
~~~

**Stopped after testing and this report. Awaiting further instructions before Google
provider configuration or administrator designation.**
