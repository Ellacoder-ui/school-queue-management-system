# ADMIN handoff resumption and final acceptance

October 20, 2026 (UTC+08), branch **backend**. **Staff/Payor read integration verified;
sign-in recovery corrected and user-confirmed.** The user confirmed that Staff
management, Find registered account, Payor management and Ticket history all work.
**Direct staff activation remains disabled. No retained privileged SQL was applied.**

## Handoff and completed fixes

OpenCode had already installed the five approved read-only functions and connected
the four public RPCs through `useAdminRecords`, the queue API and response validators.
The three ADMIN tabs and shared right-side monitor were already present. These were
inspected and reused. The installed function bodies exactly match approved 011 source
SHA-256 `3ed88ab2633a56650e27e931ff07e4684d24df0f67680c2e486725a4d8d423ed`.
This verifies current installation, not the historical application transaction.

Changes during resumption:

- Kept `admin_staff_accounts` as the primary directory. Denied/error/loading reads
  cannot revive cached legacy account rows. A missing optional endpoint alone may
  use the limited, validated legacy staff view.
- Kept verified Google account lookup working, while explicitly locking final staff
  activation in the form, submission handler and operation/reconciliation entry
  points. A read-only installation cannot enable a write accidentally.
- Fixed sign-in verification restart loops from duplicate same-session SDK events;
  added a total verification deadline and safe session/user/permission progress text.
  Changed tokens/accounts and protected denials still clear access and reverify.
- Fixed unfinished OAuth presentation and a reproduced recovery bug: reconciling a
  cancelled/disappeared flow marker could return silently and leave “Checking sign-in”
  forever. It now ends with a generic error and explicit cancellation. No cancelled
  session is adopted, code re-exchanged or authorization check skipped.
- Corrected contradictory/stale sections of
  [the read-only frontend report](ADMIN_READONLY_FRONTEND_INTEGRATION_REPORT.md).
  Read integration is complete; direct activation is separate. The original report
  remains in the ignored review directory. Historical backend receipts are unchanged.

## Actual local backend and browser acceptance

Trusted PostgreSQL transactions were repeatable-read **READ ONLY**, against local
PostgreSQL 17.11, cluster **7696959712798593061** and the retained volume.

| Contract | Verified current behavior |
| --- | --- |
| `admin_staff_accounts()` | **12** staff rows: seven ADMIN, five CASHIER; no STUDENT. Registered emails, enabled flags and Google-verification booleans validate. Only **one** staff row currently has `google_verified=true`. |
| `resolve_staff_google(p_email)` | Resolves the exact registered Google UUID/binding; missing/unverified returns null. Lookup changes no role, account or assignment. |
| `admin_payors(p_search,p_service,p_date,p_status,p_offset,p_limit)` | 20 actual student-owned tickets: 10 SERVED, 10 FORFEITED; zero WAITING/CALLED. Status filters and DTO validation pass; offset 25 is empty. |
| `admin_payor_events(p_ticket)` | Actual history returned and validated; the sampled ticket has three events. SKIPPED is an event; its resulting ticket status is WAITING. |

All four public functions have authenticated execution grants, postgres ownership,
SECURITY DEFINER and empty search paths; the private Google-binding helper is
postgres-only. STUDENT and CASHIER were each denied all four reads: **eight** actual
SQL-context checks. These trusted authorization contexts are not browser JWT captures.
All four read operations are allowlisted with exact parameters and validated DTOs.

**Real browser, user-controlled:** the user initially reported stuck verification,
then explicitly confirmed “Dashboard opened” after the fixes and “All four views work”
for Staff management, lookup of `bmabing62681@liceo.edu.ph`, Payor management and one
Ticket history. No role/counter confirmation or ticket issuance was requested.
Individual real `getUser`/RPC responses and PKCE exchange counts were not captured.
The database observations and user confirmation support live read acceptance;
intercepted tests below provide separate, controlled regression coverage.

Browser-control tools failed initialization with OS error 3. The user performed
Google sign-in in their normal browser. No passwords, OTPs, QR material, tokens,
full callback URLs or session exports were requested or captured.

## Reviewed school account and pending request

| Item | Current trusted finding |
| --- | --- |
| Email | `bmabing62681@liceo.edu.ph` |
| Immutable Auth/application UUID | `91a77243-319e-470b-a826-4c61bcfe87ae` |
| Authorization | Enabled **STUDENT**; zero assignments, active tickets or verified factors |
| Google identity | Unique verified matching identity; provider subject binding validated |
| v10 lookup binding SHA-256 | `145c39cbe0fabbf1eb7ace7d7128eaa80a875f7ad72023ebeed9370e9d17ce8c` |
| Existing request | `897a71f0-55ac-4cf1-a05c-36c7d32c806c`; CASHIER; `PENDING_IDENTITY_REVIEW`; unbound, unexpired at inspection |

The pending review never granted CASHIER, so its Student dashboard is correct.
No promotion, binding, request update or counter assignment was performed.
Personal Gmail `5c96debb-697f-4cad-805f-92b518e28343` remains enabled ADMIN;
`eabeso63122@liceo.edu.ph` remains STUDENT. The personal account currently has one
unfinished MFA factor and **zero verified factors**. No factor was removed/enrolled.

## Smallest remaining secure activation change

Prepared only: [012 mutation proposal](../supabase/20261020001200_admin_staff_activation.PROPOSED.sql),
SHA-256 **`ea741017c1c757b607b678c8e647547ebda92cc25b78714b917fce3b574a8d93`**.
It adds only:

```text
queue_api.add_verified_staff(
  p_user uuid, p_email text, p_identity_sha256 text,
  p_role text, p_counter uuid, p_request_key uuid
) -> jsonb
```

The actor must be a current enabled, approved ADMIN with signed AAL2 and a verified
TOTP factor. Self-change is denied. It locks trusted Auth identity rows and verifies
the exact target UUID/email/hash, enabled STUDENT state and absence of assignments.
CASHIER requires a fixed counter; ADMIN adds no counter assignment.

Existing `set_account` and `configure_counter` wrappers perform the changes in one
transaction, preserving fixed routing, existing cashiers and counter availability.
Counter failure rolls back the role, assignments, audits and receipts together.
Actor-bound request-key receipts support explicit same-key reconciliation; current
actor authorization is checked before replay. No automatic mutation retry is added.

**007 is a hard prerequisite:** the proposal refuses if its staff-security helpers
are absent. Existing wrappers enforce current operator approvals for actor/target and
assigned cashiers. The v10 lookup hash is distinct from 007's approval binding and
must not be substituted for it. No browser/service-role bypass or new identity is used.

Do **not** apply the old combined 010 proposal: five of its functions are already
installed. 012 is separate, uninstalled and outside `supabase/migrations/`.
`STAFF_ACTIVATION_RELEASED=false` is a frontend release lock, not backend security.

The retained backend still lacks 007's AAL2/operator-approval protections. Current
legacy staff controls were preserved, not certified as fully protected. Later work
requires separate approval for 007 and its effect on every existing privileged
account, verified personal MFA/AAL2, exact operator approvals, guarded 012 installation
and a reviewed frontend release. Real target role/assignment changes require their
own explicit scope. None is authorized by this result.

## Tests and visual checks

| Final coverage | Result |
| --- | --- |
| Full frontend suite, serial | **198 passed**, zero failures/skips |
| Interception policy | **15 passed** |
| Default OAuth/UI, `1bff930d` | **26 groups passed** |
| MFA-enabled OAuth/UI, `13018c3a` | **28 groups passed**, including recovery error cancellation |
| Separate 011/012 + 007 fixture, `f8e99429` | **13 groups passed**, plus **123** existing SQL policy/routing methods |
| Actual anonymous display/Realtime, `5be24dc7` | **15 groups passed** |
| Public-only production build; known local private-key scan | PASS |
| Source/assets fixture-canary/private-pattern scan; syntax/whitespace | PASS |

The isolated backend used cached PostgreSQL/PostgREST, synthetic identities/JWTs,
tmpfs data, a separate bridge and loopback-only API. It tested missing-007 refusal,
STUDENT/CASHIER/forged-metadata denial, AAL1/factor/approval denial, exact identity
matching, self-change denial, atomic rollback, fixed routing, replay/revocation and
target-only activation. 007 and all role/assignment writes occurred **only there**.

Intercepted browser suites exercise the actual Vue application and installed SDK,
while blocking retained Auth/private mutations. They cover lookup-only activation,
existing management confirmations, real contract shapes, history, access revocation,
one shared public socket, monitor persistence, background updates and preserved tab,
search/drafts/DOM. Real anonymous Realtime covers readiness, reconnect and cleanup;
no retained queue mutation was used to create a push. The earlier real Vue/isolated
queue run `fa1b26cc` passed seven groups; it preceded the handoff fixes and is separate
evidence, not a new retained mutation or combined Google/queue acceptance.

ADMIN layouts passed **1440/1280/1024/980/768/640/390/320px**: monitor on the right and
sticky on desktop, below content on smaller screens; no horizontal page overflow.
No ADMIN Public Display, Refresh Queue or Refresh Directory control appears. Wide
tables scroll internally. Student/Cashier layouts and `/display` remain functional.

Visually inspected screenshots use explicitly synthetic accounts/tickets and the
intentional account-security route; the public monitor uses anonymous local data:

- [Staff desktop](../supabase/tests/results/admin_navigation_13018c3a_AFTER_1440.png)
- [Staff at 320px](../supabase/tests/results/admin_navigation_1bff930d_AFTER_320.png)
- [Payor mobile](../supabase/tests/results/admin_payors_13018c3a_SIMULATED_390.png)

Earlier FAILs remain recorded: two OAuth recovery regressions reproduced endless
checking before the fix; an initial event-coalescing change failed the existing
TOKEN_REFRESHED security test and was corrected; browser `c8c902ee` hit a harness
race while authorization intentionally remounted the denied workspace. Final tests
wait for the resulting authorized/restricted state; no denial requirement was waived.
An earlier optional screenshot command was not executed because approval review hit
a usage limit; later normal runs completed. That is separate from the source finding
below and is not evidence that fixture writes reached retained Auth.

## Preservation and files

All **1,881** handoff input files remain; **1,867** retain their hashes. The 14 intended
changes are `AdminDashboard.vue`, `AdminAddStaff.vue`, `AuthWorkspace.vue`,
`GoogleAuthCallback.vue`, `useAdminWorkspace.js`, `adminRecords.js`, `authController.js`,
`googleOAuth.js`, their four related frontend test files, `adminFinal.integration.mjs`
and the corrected read-only frontend report. New files include `adminActivation.js`,
`adminHandoff.test.js`, the fixed read-only inspector, separate 012 SQL and this report.
Student/Cashier source, ticket actions, public controller, dependencies, configuration,
six migration files, proposed 007 and historical application receipts were preserved.
No production source/assets contain the tested fixture identity/ticket/token canaries.

Final independent observations at **03:10:11 UTC+08** matched every application/public
table fingerprint, function definition, request/factor row hash, function ACL, migration
receipt and retained service definition/lifecycle (apart from the existing Vector
automatic restart allowance). There remain **42 accounts, 42 Auth users, 29 identities,
20 tickets, four assignments and one pending request**. Routes remain
**1:TP, 2:SOA, 3:PNEP, 4:REF, 5:ADJ**; six application migrations remain installed.
Auth/settings/API returned **200**, Google enabled. 007 and direct activation remain absent.

**Whole-source preservation comparison: FAIL retained, not reclassified.** At 03:06,
`auth.users` and `auth.identities` fingerprints differed from the 02:40 handoff capture.
Sanitized follow-up found only the personal ADMIN among recently updated Auth rows,
with logout/login audit categories and last sign-in around **03:00:16**. This is
consistent with the user-controlled recovery/login test, but aggregate baseline
hashes cannot prove the exact individual changed fields. No account/identity count
increase or application-role/queue change occurred. No comparator was relaxed and
no database-wide immutability claim is made.

Exact resource accounting permits only this resumption's four stopped fixture
containers and two labeled networks. Original containers/networks/volumes remain;
no volume was created/deleted or image pulled. Owned test browsers/servers were closed;
the user's existing frontend remains running. Backups/Google credentials were not
opened or changed. No retained mutation was issued by Codex, SQL object installed,
Supabase service restarted, deployment, destructive Git operation, commit or push run.

## Evidence and stop

- [Fresh installed-contract baseline](../tests/integration/results/admin_handoff_baseline.json)
- [Strict closeout finding](../tests/integration/results/admin_handoff_closeout.json)
- [Sanitized Auth observations](../tests/integration/results/admin_handoff_auth_observations.json)
- [Final application/function invariants](../tests/integration/results/admin_handoff_final_observations.json)
- [Unit/build/scan receipt](../tests/integration/results/admin_handoff_validation.json)
- [Final MFA/UI browser](../supabase/tests/results/google_oauth_frontend_13018c3a.json)
- [Default OAuth/UI browser](../supabase/tests/results/google_oauth_frontend_1bff930d.json)
- [Isolated mutation/security proposal](../tests/integration/results/admin_final_f8e99429.json)
- [Actual public display/Realtime](../supabase/tests/results/public_board_5be24dc7.json)

**Stopped after safe frontend fixes, read acceptance, isolated security preparation
and reporting.** Read-only Staff/Payor integration and dashboard recovery are accepted
within the stated evidence. Direct activation, real MFA setup changes, retained 007/012
application and any real staff role/assignment change remain separate approvals.
