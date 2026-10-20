# Personal ADMIN and staff management — in progress

October 19, 2026 (UTC+08). **Stopped at the real MFA enrollment gate. No retained
migration or promotion has run.** Personal Gmail and the school account remain
enabled STUDENT. Google login is working; it is followed by a separate Account
security enrollment step. This is an interim report, not completed ADMIN acceptance.

## Verified identity, health and enrollment

Trusted read-only preflight `f7a5d5d9` completed at **18:22:30**. Auth health,
settings and anonymous API returned **200**. Google and both TOTP settings are enabled.
Canonical Auth remains ID `5c57bce94c516ec320f259e94ebaf2d348598b6c26e7e2d979c719a8381992ae`;
no Auth or other Docker service operation was performed.

| Account | Immutable Auth/application UUID | Role / enabled | Verified factors |
| --- | --- | --- | ---: |
| Personal `ellasharmaineabeso2004@gmail.com` | `5c96debb-697f-4cad-805f-92b518e28343` | STUDENT / true | 0 at last checkpoint |
| School `eabeso63122@liceo.edu.ph` | `b7d9aee8-c54d-455f-9913-a4c4dea0d097` | STUDENT / true | 0 at last checkpoint |

The personal Google identity binding remains
`0fa3fe400dbd117642d5cb7eb89bfed7471e6ef447e59bfc8ac8426001e39701`.
The school binding remains
`7b236769634b0910b034c035cc1422021f2281be9d6fd77d5c882ffd9ed86bbd`.
Both have no staff assignments or queue tickets. Email text, domains and editable
metadata grant no privilege.

The user explicitly authorized personal authenticator enrollment. The owned Vite
process was identified and relaunched through `python -B scripts/local_frontend.py
--dev`, with no duplicate server. Frontend and MFA module returned **200**, with the
verified nonsecret TOTP capability true. The initial cold-start health request timed
out; the warmed check passed. The frontend remains available at
`http://127.0.0.1:5173/` (owned launcher session 16039).

A reported AAL2 screen was **not accepted as successful enrollment**: independent
checks still found zero personal factors and no recent AAL2 session. The user then
confirmed the app showed **Set up an authenticator app**, and clarified that only
Continue with Google had been clicked. At the **18:45:06** checkpoint, no factor had
been created. No QR key, OTP, browser JWT or screenshot of enrollment was requested
or inspected.

Next user action: sign in with the personal Gmail, open **Account security** on the
dashboard, click **Set up authenticator**, privately scan the QR, and enter the
authenticator code in the application. Report only the final status and close the
dialog. The agent must independently check the exact factor/session/identity binding
before proceeding. No synthetic factor or AAL2 token may substitute for this gate.

## Migration impact and approval gates

Proposed 007 is unchanged and unapplied:
`supabase/20261019000700_staff_security.PROPOSED.sql`, SHA-256
`b22d63d24c991b9ebf0d380d27a716d5ea72e418f5e62e177c96dded4481222c`.

It creates private operator approvals and protects eight staff/admin API functions,
moving their original implementations into private cores. It seeds no approval and
changes no account role. Fresh inspection found **six ADMIN accounts (five enabled)
and five enabled CASHIER accounts**, all with zero verified factors. Applying 007
would block all ten currently enabled staff accounts' protected operations until
individually enrolled and identity-bound approved. Student issuance and public reads
are outside these wrappers. Last-ADMIN, work-resolution and fixed-routing constraints
remain enforced.

Existing role routing already uses verified `getUser` and current `my_context`.
Neither MFA enrollment nor an approval row changes the personal role automatically.
The operator promotion function verifies enrollment, but does not itself verify a
live browser JWT: current trusted AAL2 is an additional mandatory preflight.

New **008 preparation**, outside `supabase/migrations/`, supplies contracts missing
from the existing administration API:
`supabase/20261019000800_admin_workspace.PROPOSED.sql`, SHA-256
`b2d34376031ab47001bfc2da81ffaa1c9d33847f0862a8c460503d9f06b12af6`.

- `admin_workspace(date)`: approved AAL2 ADMIN directory, verified Google bindings,
  current approval/MFA state, all five counter assignments, exact date-based metrics,
  service usage and sanitized history. No student owner identity or Auth secret.
- `request_staff_access(email,role,key)`: audited, idempotent pending request for an
  existing or new email. It creates **no Auth user, operator approval or staff role**.
  No email is sent. Requests expire after seven days; the screen shows the latest 100.
- Operator-only `bind_staff_request`: binds a pending email to an actually registered,
  verified Google UUID/hash. Separate 007 approval and authorized role change are still
  required. A pending request is never authorization.
- Additional account-management protection rejects self-authorization changes and
  removal of the last usable approved administrator. The original audit/replay and
  target approval checks remain.

008 requires 007 and its own explicit retained approval. Neither proposal is an
automatically discovered migration. Directory responses stop beyond 500 accounts;
history shows at most 500 tickets for a selected day and explicitly reports truncation.
Totals remain exact for the whole selected day. SMTP delivery and a full history export
are not implemented or implied.

Before any retained application, present the final reviewed hashes, current source
bindings, affected objects, lockout impact and recovery limitations for explicit user
approval. Transaction failure must roll back before commit. Reverting committed
security protections requires separate review; no automatic rollback or historical
database restore is appropriate. The historical recovery PASS and live-pruning FAIL
remain distinct; no new current-inventory recovery certification was performed.

After approved migration acceptance and fresh personal AAL2/identity review, present
the exact personal UUID/hash, current STUDENT state, proposed ADMIN approval reference
and expiry, target-only expected audit/role changes, and obtain the user's **final
explicit confirmation before role COMMIT**. Keep the school account STUDENT.

## Prepared Admin interface — not connected to the live workspace yet

New `AdminManagement.vue` provides Overview, Staff management, Counter management and
Reports/history sections. It embeds the existing presentational public monitor. Its
forms select exact account UUIDs, expose approval/enrollment requirements, preserve
fixed service routes and distinguish pending requests from privileges. There is no
role selector for login, impersonation, invitation sending or frontend service key.

New `adminContracts.js`, `adminWorkspace.js`, `useAdminWorkspace.js` and `admin.css`
prepare strict contracts, private-state clearing on access changes, late-response
rejection, current authorization checks, actor-bound durable management intents,
Web Lock serialization and explicit same-key recovery. Journals contain minimal
operation arguments/UUIDs, including the pending-request email when necessary;
they contain no JWT, setup key, OTP or directory/history snapshot.

**These new modules are not yet imported by the running product composition.**
Connecting the versioned endpoint and management actions, browser screenshots,
full browser regression and the final production build remain pending. The current
Student/MFA UI was deliberately left unchanged during the user's private enrollment
so hot reload would not interrupt the setup. Existing staff controls remain disabled.

## Completed verification

| Check | Actual result |
| --- | --- |
| Full frontend suite, including new reader/contract/view tests | **159 passed**, 0 failed/skipped |
| New Admin reader/contract/view subset | **11 methods passed**; included above |
| Final real PostgreSQL/PostgREST Admin proposal run `e91765c0` | **11 groups passed** |
| Existing SQL policy/read/routing methods in that fixture | **123 passed** |
| Retained identity/health/queue/security checkpoints | PASS; real enrollment pending |
| Real MFA, retained 007/008, personal ADMIN/dashboard acceptance | Not completed/applied |
| New management screenshots, final browser/build acceptance | Pending live frontend wiring |

The isolated backend run exercised real issuance, Call Next, Skip, Serve, a nonzero
served-history result, exact usage counts, fixed routing, pending existing/new email
requests, immutable identity binding, changed-key replay rejection, unauthorized
reads/writes, self-promotion denial, approval expiry and self/last-usable-ADMIN guards.
JWTs and factors there were synthetic; this is not real MFA or retained acceptance.

Earlier `7b0e99af` failed only the expired-approval fixture check; its generated
timestamps violated the table constraint. That test was corrected. `3ece9f5b` then
passed ten groups; final `e91765c0` added real ticket/history coverage and passed eleven.
No failure evidence was overwritten. Each attempt preserved retained roles/queue/
unrelated Auth fingerprints and service definitions/lifecycles, allowing only the
user-authorized personal Auth activity during the test window. All six created test
containers are stopped; three labeled networks remain. No volume was created/deleted.

## Preservation and remaining work

The latest read-only comparison retained all application/account/assignment/queue rows,
six original migration bindings, fixed routes, schema/security/functions and service
definitions. Google/TOTP remain enabled. Normal Auth login/logout/refresh row changes
were observed and reported separately; they were not called database-wide immutability
or attributed solely from counts. All **93 backup files** retain digest
`27e6ed58b1fe58031c3a953e2c95cd8d362e869735f598c84577673498905e96`.

All **1,054 captured existing input files remain; 1,053 retain their hashes**. The
single changed existing file is `tests/integration/queueFixture.mjs`, updated to accept
only the exact approved canonical MFA Auth and both exact stopped rollback originals,
while continuing to reject unknown project resources. Prior modified/untracked work,
Student layout/monitor, Auth/PKCE implementation, configuration, six migrations,
007 proposal, credentials and historical evidence are preserved.

New files: the two read-only personal inspectors, proposed 008, prepared Admin modules/
component/styles, Admin unit/view/integration tests, sanitized evidence and this report.
The pre-enrollment source/configuration baseline is encrypted and privately read back at
`.local-auth-only/f7a5d5d9/personal-admin-baseline/payload.dpapi` using the existing
CurrentUser DPAPI/ACL mechanism. No private plaintext staging was added.

Remaining sequence: complete real enrollment → verify current personal AAL2 and
identity → approve retained security proposals and pass acceptance → final exact-target
promotion confirmation → target-only promotion → real ADMIN role-routing and management
acceptance. Connect/test the prepared frontend after the private enrollment dialog is
closed. No queued action silently performs any of these steps.

Evidence: [initial preflight](../supabase/tests/results/personal_admin_live_f7a5d5d9_preflight.json),
[final isolated backend](../tests/integration/results/admin_workspace_e91765c0.json).

**No retained migration, ADMIN/CASHIER role change, assignment/queue write, Docker
restart, credential change, backup/volume deletion, deployment, commit or push occurred.**
This task remains in progress at the user-controlled MFA gate.
