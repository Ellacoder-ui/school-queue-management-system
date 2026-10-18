# Technical implementation plan: Google Sign-In and shared requester access

Date: October 17, 2026. Status: **inspection and design only; awaiting implementation approval**.

The smallest secure approach is to reuse the existing automatic ordinary-account
trigger, add a Google PKCE callback to Vue, and introduce a separately reviewed
cashier-approval authorization contract. No new provisioning system or PAYOR role
is needed. Students and outside payors share a **Queue dashboard** backed by the
existing STUDENT permission. Google identity is not evidence of school enrollment.

No database record, migration, frontend source, provider setting or recovery artifact
was changed. Google Sign-In and ticket issuance remain unavailable. All RPC names
identified below as proposed are design contracts, not existing endpoints.

## 1. Inspection and verified baseline

Reviewed all six migrations, the six-version recovery/postvalidation reports,
FRONTEND_INTEGRATION_PLAN.md, FRONTEND_PHASE2_REPORT.md, Auth/session/service/public
display code and database, HTTP, concurrency and frontend authorization tests.

Fresh local inspection used verified local CLI/container identity and read-only
PostgreSQL transactions. Captured results contain aggregates and hashes, not account
identities or credentials. Before/after checks matched the completed six-migration
postvalidation across all 69 logical tables and captured schema, roles, sequences,
catalog and additional privileges/settings.

| Item | Observed state |
| --- | --- |
| Project | school-queue-local |
| PostgreSQL / API | 127.0.0.1:54322/postgres / http://127.0.0.1:54321 |
| Server / cluster | PostgreSQL 17.11 / 7696959712798593061 |
| Database container and volume | supabase_db_school-queue-local |
| Network | supabase_network_school-queue-local |
| Migrations | Exactly 20261016000100 through 20261016000600; file hashes unchanged |
| Routing | 1:TP, 2:SOA, 3:PNEP, 4:REF, 5:ADJ |
| Durable business totals | 39 accounts, 20 terminal tickets, 57 events, 69 replay receipts, 32 audits |
| Operational state | Seven closed days; zero WAITING/CALLED tickets; no open day |
| Auth | 39 users; 26 email-provider identities; no Google identities; no missing application accounts |
| Staff fixtures | Four assignments; Counter 5 retains its deliberately stale STUDENT assignment |
| Security boundary | 15 application tables with RLS; browser roles lack queue_private USAGE; publication contains only counter_state/service_state |

Evidence: [sanitized design inspection](tests/results/google_auth_design_inspection.json).
The [six-version recovery report](POST_MIGRATION_006_BACKUP_REPORT.md) establishes the
existing recovery point; this task neither repeated restoration nor recertified it.

## 2. Current authentication architecture

`src/lib/supabase.js` creates an authenticated public-key client and a separate
stateless public-display client. Requests are restricted to the exact local gateway;
redirects are refused. The authenticated client persists/refreshes sessions and sets
detectSessionInUrl=false. It does not select PKCE or implement a callback exchange.
The installed Auth SDK defaults to implicit flow unless configured otherwise.

`authController.js` subscribes to Auth events, verifies stored sessions with getUser(),
then calls queue_api.my_context(). It synchronously clears privileged state on Auth
changes and uses generations/abort signals to reject stale completions. SDK calls
are deferred outside Auth callbacks. Logout clears access first and uses local scope;
failure leaves protected access locked. Visibility, online, public Realtime readiness,
protected-operation denial and visible-tab polling trigger context reconciliation.

`AuthWorkspace.vue` currently offers existing-account email/password login and guarded
workspace previews. It has no OAuth or signup UI. Navigation is an in-page selector,
not Vue Router. Operational controls and issue_ticket remain disabled; the queue API
helper deliberately excludes issuance. Public data remains available anonymously.

The current my_context response remains the frontend authority for navigation:

```typescript
{
  role: 'STUDENT' | 'CASHIER' | 'ADMIN' | null,
  enabled: boolean,
  cashier_counters: Array<{
    counter_id: string, counter_number: number, counter_label: string,
    is_open: boolean, service_codes: string[]
  }>
}
```

It reads current accounts/assignments, not editable metadata. Disabled accounts get
exactly `{role:null, enabled:false, cashier_counters:[]}`; missing/unprovisioned and
anonymous Auth subjects fail with 42501. Only enabled cashiers receive their own
counters. This is a snapshot for UX; every protected operation authorizes separately.

### Local configuration gaps

config.toml has no explicit Auth, Google, redirect or MFA configuration. A whitelist
inspection of the running Auth container found the following non-secret settings:

| Setting | Current value / implication |
| --- | --- |
| Site URL | http://127.0.0.1:3000; differs from the recommended Vite origin on 5173 |
| Additional redirect allowlist | https://127.0.0.1:3000; also has a scheme mismatch |
| Signup disabled | false; server signup is currently enabled |
| Email provider / autoconfirm | Both enabled; absence of a signup form is not a server admission rule |
| Anonymous users / manual identity linking | Both disabled |
| TOTP enrollment / verification | Both disabled |
| JWT lifetime | 3,600 seconds |
| Google provider | No explicit config or enable flag observed; no Google identity exists |

These are local development settings, not a certification of safe internet exposure.
They were left unchanged. The older integration plan contains historical phase
status; a future implementation must update it to the now-applied sixth migration.

## 3. Automatic ordinary-account provisioning

**No database change is required for basic first-login provisioning.** Migration 002
already installs `queue_account_created`, an AFTER INSERT trigger on auth.users,
calling queue_private.provision_account(). It inserts accounts(id=new.id), whose
defaults are role=STUDENT and enabled=true. The primary key binds one application
account to one Auth user; its FK references auth.users(id) with deletion restricted.

The intended flow is:

1. Supabase Auth validates Google OAuth and creates or resolves an Auth user.
2. A genuinely new auth.users row creates its ordinary account in the same database
   transaction. Trigger failure fails user creation; the UI must handle that error.
3. Vue verifies the returned session and fetches authoritative context. An ordinary
   user immediately receives the shared Queue dashboard, without administrator approval.
4. Existing users retain their current account, role, enabled state, tickets and quotas.

No browser account insert, role selector, email-domain promotion, enrollment check,
student-profile creation or second account table belongs in this flow. Do not copy
Google names into verified student profiles. Google/profile metadata remains display
information only, rendered as text if later needed.

Repeated sign-in resolves the same Auth identity and does not rerun the insert trigger.
Do not add a login upsert that resets enabled/role, or creates an account after a
context failure. A missing account fails closed and receives trusted operator diagnosis.
There are currently no missing accounts. Add ON CONFLICT DO NOTHING only if a real
provisioning path demonstrates a need; never conflict-update authorization fields.
Trigger failures must be tested because they can block signup.
[Supabase user-management guidance](https://supabase.com/docs/guides/auth/managing-user-data).

Supabase automatically links verified same-email identities; manual linking of other
identities is a separate feature and is currently disabled. Test Google login to an
existing email account for preservation of the Auth UUID, disabled state and queue
history. Do not implement an application-level email merge, delete/recreate accounts,
or transfer quotas. An unexpected identity collision requires recovery review.
[Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking).

STUDENT remains the compatible internal requester permission. The UI should replace
“Student workspace” and “student access is verified” with **Queue dashboard** and
neutral requester wording. This neither asserts enrollment nor grants access to a
student beneficiary's records. Existing owner-only ticket/history boundaries remain.

## 4. Proposed cashier email approval and identity binding

Google login alone must never grant CASHIER or ADMIN. Ordinary provisioning remains
automatic even when no staff approval exists. Cashier approval is an independent,
audited administrator action.

### Private approval model

A future seventh migration should add one private `cashier_approvals` table with:

| Field group | Proposed semantics |
| --- | --- |
| Approval identity | UUID primary key; normalized email unique; provider fixed to google |
| Binding | Nullable bound account UUID FK and provider subject until first successful bind |
| Lifecycle | Active/revoked status, version, approved/revoked timestamps and administrator attribution |
| Integrity | Unique bound Google subject/provider and bound account where present; no automatic reassignment |

Normalize email with trim and lowercase under a documented policy. Do not strip Gmail
dots or plus suffixes, guess aliases or approve an entire domain. Preserve revoked
bindings as history/tombstones; deliberate reapproval must name the same binding or
require an explicit reviewed replacement. Existing audit/replay mechanisms should
record changes without putting sensitive identities in public responses.

After a verified login, the server may bind an active email approval to auth.uid()
only when the server-maintained Google identity proves the verified email and stable
provider subject. Inspect auth.identities for provider=google and validate the actual
GoTrue identity representation, including a strict verified-email value. Require
agreement with the authenticated account's current email; reject missing, ambiguous,
unverified or conflicting identity evidence. Auth email_confirmed_at alone is
insufficient given the current email-autoconfirm setting. Never use raw_user_meta_data,
user_metadata, browser-supplied email, or an application-role JWT claim for this decision.

Google's subject is the stable identity key; an email can change and is not a permanent
person identifier. Bind both that subject and the Auth UUID, rather than treating a
reused email as a transferable staff entitlement.
[Google OpenID Connect identity guidance](https://developers.google.com/identity/openid-connect/openid-connect).

There are no current Google identities, so their exact stored shape and mutability
must be verified with the pinned local GoTrue version and a real provider flow before
implementing staff binding. Fail closed on unknown shapes. An external Google email
change cannot be detected continuously from a stale local identity; require Google
reauthentication before first binding/rebinding and define a staff reauthentication
interval. Unlinking, local email changes and observed identity mismatches must deny
staff access until administrator review. Manual identity linking should remain off
in the first phase. A new Auth UUID must not inherit a deleted account's staff binding.

### Proposed RPC boundaries

These names and signatures are proposals requiring review:

| Proposed queue_api RPC | Caller and behavior |
| --- | --- |
| sync_staff_access(p_request_key uuid) | Authenticated self only; validates/binds an existing approval and promotes only to CASHIER; no supplied email, account ID or role |
| approve_cashier_email(p_email text, p_request_key uuid) | Enabled ADMIN with MFA; creates or explicitly reactivates a reviewed approval |
| revoke_cashier_approval(p_approval uuid, p_expected_version bigint, p_request_key uuid) | Enabled ADMIN with MFA; atomically revokes current eligibility with concurrency/version protection |
| list_cashier_approvals(p_limit integer, p_cursor text) | Enabled ADMIN with MFA; bounded opaque-cursor page containing only staff-management fields |

sync_staff_access should return a minimal `{synced:true}` receipt, including for an
ordinary unmatched user; the subsequent fresh my_context determines navigation.
It must never re-enable an account, replace ADMIN, transfer a binding or clear a
revocation. Preserve existing active-ticket role-change safeguards. Approving an email
must not create a fake Auth user or grant a counter assignment before identity binding.

Admin mutation receipts should contain only approval ID/version; the restricted list
DTO may contain approved email, status, version and bound account ID needed by the
existing configure_counter RPC. It must exclude ordinary-user directories, student
profiles, tokens and audit internals. Final cursor/DTO/error contracts need review
alongside migration SQL before frontend consumers are written.

Use the existing mutex-first lock order, transactional audit/replay behavior, UUID
request keys and current enabled-account checks. Uniqueness must serialize competing
binds; approval revocation and binding must participate in the same locking discipline.
Same-key replay cannot resurrect an approval or reapply an old promotion. Current
eligibility checks precede protected access; receipts never constitute present authority.

The table stays in queue_private with RLS/default deny, no browser schema/table
access and no Realtime publication. New definer RPCs use qualified objects, empty
search_path, explicit revocation of default EXECUTE and narrow authenticated grants
with internal authorization. Private helpers have no browser EXECUTE permission.

### Enforcement on every protected path

An approval check only at login is insufficient. Propose a shared private current
cashier-eligibility helper and use it at these existing authorization boundaries:

| Boundary | Required future change |
| --- | --- |
| lock_actor | Deny CASHIER operations without a current active matching Google binding |
| my_context and staff_queue | Independently enforce current cashier eligibility; these reads do not rely solely on lock_actor |
| configure_counter | Validate assigned cashiers against current approval as well as enabled CASHIER status |
| set_account targeting CASHIER | Require a valid bound approval; an authorized role setter must not bypass the new approval policy |
| Administrator operations/reads | Require current enabled ADMIN and the approved MFA assurance policy |

issue_ticket, call_next and finish_ticket queue algorithms/signatures should remain
unchanged. Their shared authorization dependency may be strengthened by the reviewed
seventh migration. Maintain fixed routing, one-active-ticket enforcement, issuance-day
served quotas, allocators, skip order and replay semantics.

An eligible bound CASHIER may initially have no counters. Admin then uses the existing
configure_counter with its one fixed service and selected eligible cashier IDs.
Counter 1 remains TP through Counter 5 ADJ; approving an email cannot change routing.
A cashier assigned to several counters can operate only each counter's fixed service.

### Revocation during active work

Existing set_account blocks cashier demotion/disablement while an assigned counter
has a CALLED ticket, and blocks role changes for an account with active owned work.
Do not describe a rejected change as a successful revocation or remove these guards.

Recommended security revocation: commit approval status=revoked immediately, making
subsequent staff RPCs fail even when cleanup is blocked by active work. Demote/remove
assignments in the same transaction only when existing safeguards permit it. Otherwise
retain the stored role/assignment pending a reviewed handover, while the eligibility
guard denies staff access. my_context should fail with 42501 in this inconsistent
enabled-staff state, clearing navigation; it must not misreport enabled=false. Actually
disabled accounts retain the existing masked disabled response.

An already-assigned eligible replacement cashier can finish the counter's ticket
under existing rules. If none exists, a handover/recovery policy is an operational
acceptance gate; no automatic forfeit, day reopening or administrator service override
is proposed. Emergency account disablement while busy is a related explicit policy
decision. Mutex ordering gives a clear commit boundary: an operation already executing
before revocation may complete; later operations must deny current revoked authority.

Revoking refresh sessions is additional defense, not a substitute for database checks.
Signed access tokens may remain valid until expiry after sign-out.
[Supabase sign-out semantics](https://supabase.com/docs/guides/auth/signout).

**Legacy compatibility:** current cashier test accounts have email identities without
Google bindings. The new policy would deny them staff access unless explicitly migrated
under a reviewed compatibility decision. Do not auto-approve fixture emails, fabricate
Google proofs or delete assignments. Preserve Counter 5's stale STUDENT row. Test the
new policy in a disposable stack before any retained Auth/schema cutover.

## 5. Administrator bootstrap and MFA

No email domain, approval table or self-service RPC should create ADMIN. Designate a
specific verified Auth UUID through a trusted, audited operator procedure. The existing
private bootstrap_admin is operator-only, refuses repeat bootstrap and refuses when
any ADMIN already exists. Inspection found six fixture ADMIN accounts and no BOOTSTRAP
audit; therefore bootstrap is currently unavailable. Do not reset its guard. Selecting
a real development administrator requires an explicit transition using an existing
authorized administrator or separately reviewed operator action.

Require TOTP MFA at AAL2 for administrative configuration, account/approval management
and sensitive administrative reads. Enforce it inside SECURITY DEFINER authorization,
because owner execution bypasses table RLS. Current database role/enabled state still
determines authority; signed Auth assurance indicates factor verification only. An
ADMIN at AAL1 may reach an MFA challenge, not administrative data or operations.
my_context need not add fields; the SDK assurance API can guide the challenge UX.
[Supabase MFA assurance guidance](https://supabase.com/docs/guides/auth/auth-mfa).

Local TOTP is currently disabled and must be enabled only in the approved implementation
configuration phase. Define enrollment, factor loss, last-admin protection and audited
operator recovery before enabling operational admin controls. Cashier MFA is recommended
but is a separate policy choice. Do not store factor secrets in frontend configuration
or create a public break-glass endpoint.

## 6. Local Google configuration plan

Start with a dedicated development Google Cloud OAuth **Web application** client.
Use External audience so personal and school accounts can participate; do not use
an organization-only audience or hosted-domain gate. Testing-mode Google test accounts
are a temporary provider-development restriction, not an ordinary-account admin
approval workflow. School administrators may independently restrict third-party apps.
[Google audience configuration](https://developers.google.com/workspace/guides/configure-oauth-consent).

For the retained-local origin, the proposed exact addresses are:

| Purpose | Proposed value |
| --- | --- |
| Vue origin / Supabase site_url | http://127.0.0.1:5173 |
| Google registered redirect URI | http://127.0.0.1:54321/auth/v1/callback |
| Vue redirectTo / exact additional redirect URL | http://127.0.0.1:5173/auth/callback |

The Google-to-Supabase callback and Supabase-to-Vue callback are different endpoints.
Keep origins consistent; localhost and 127.0.0.1 are different browser origins. Verify
Google accepts the chosen loopback JavaScript origin during setup; any required hostname
adjustment needs matching explicit origins throughout, not wildcard redirects.

Configure the local `[auth.external.google]` provider with enabled=true, the development
client ID, secret=`env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET)` and
skip_nonce_check=false. Request only standard OpenID/email/profile access. No Gmail,
Drive or offline provider-token access is needed. Inject the client secret into the
local CLI/server process using approved protected storage; never put it in VITE_
variables, tracked files, screenshots or reports. No hosted management API is needed.
[Supabase Google configuration](https://supabase.com/docs/guides/auth/social-login/auth-google).

Keep automatic new OAuth user creation enabled. Do not globally disable signup in
a way that breaks first-time Google accounts. Separately decide whether email/password
signup should be restricted server-side while retaining isolated test-login support;
verify the installed CLI's provider-specific configuration before choosing those keys.
One Google UI entry alone does not disable other Auth endpoints.

Use exact redirect allowlists without arbitrary next URLs or wildcard callback paths.
Leave anonymous Auth and manual linking disabled initially.
[Supabase redirect allowlists](https://supabase.com/docs/guides/auth/redirect-urls).

Prove setup first in a disposable local Supabase project with distinct volumes/ports
and a separately registered exact development callback. Parameterize test guards only
for those explicit endpoints. A later retained-local configuration change must be
approved and must verify the six-version recovery baseline first. Real Google OAuth
necessarily contacts Google over the internet; that future approval does not authorize
contacting a hosted Supabase project. This design task contacted only public documentation
sites and the local development services.

## 7. Vue PKCE, callback and navigation changes

Keep the separate stateless public client and exact local fetch guard. Google flow
uses full-page browser navigation through local Auth; it does not require allowing
Google/hosted fetches in localFetch.

1. Set flowType='pkce' on the authenticated SDK client. Retain detectSessionInUrl=false
   and implement **one explicit callback exchange path**; do not also auto-exchange.
2. Replace the product login form with one **Continue with Google** button shared by
   all roles. Existing password login may remain only in an explicitly isolated local
   test/dev surface. No role selector, enrollment approval or separate staff login.
3. Request signInWithOAuth(provider:'google', fixed redirectTo, skipBrowserRedirect:true).
   Validate the returned authorization URL against the exact local Auth origin/path
   and Google provider before assigning browser location. Reject arbitrary return URLs.
4. Handle only the exact /auth/callback path before normal protected Auth startup.
   Parse code/provider errors, remove query/fragment credentials with history.replaceState,
   and never log raw callback errors, authorization codes, sessions or provider tokens.
   Use a no-referrer policy and avoid third-party resources on this view.
5. Deduplicate exchangeCodeForSession in one pending promise. Hold normal session/context
   verification behind this callback gate, retaining stale-response generations. Then
   verify getUser, optionally sync approved staff, and load fresh my_context.
6. For cancellation, expired/replayed code, missing verifier or interrupted exchange,
   show a generic recoverable state. Reconcile stored session/getUser/context after an
   ambiguous exchange; do not repeatedly reuse the code or automatically launch another
   OAuth flow. A new attempt requires an explicit user action.
7. Show enabled STUDENT as Queue dashboard, CASHIER with its actual permitted counters,
   and ADMIN behind the MFA challenge. Keep ticket issuance and operational controls
   disabled in this Auth phase. Disabled/missing context shows the current access-disabled
   or access-unavailable state, with retry/sign-out and public queue access.
8. Preserve immediate state clearing on logout/account/token change and offline loss,
   context refresh on reconnect/visibility/denial and listener cleanup. A late callback,
   login, staff-sync or context response must never restore a previous user's workspace.

PKCE codes are short-lived, single-use and require the original verifier/browser.
The SDK handles verifier generation/storage; do not hand-roll OAuth state or token
verification. Concurrent flows can overwrite the verifier in shared storage. Start
with one pending flow per origin plus bounded cross-tab coordination; treat the marker
as UX coordination, not identity proof. Test overlap explicitly before considering
experimental SDK flow-ID options.
[Supabase PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow).

Retain the current SDK session-storage model for this local SPA, with explicit XSS
acceptance limitations: localStorage credentials are readable by same-origin scripts.
Render all names as text, avoid third-party scripts, and review CSP/referrer headers
for future hosting. Do not persist Google provider tokens separately or expose email/
Auth UUID in public display state. MFA and UI routing do not protect against an XSS
attacker possessing a valid session.

The current prepared-mutation helper must generate one UUID per staff action/sync and
preserve it across retry. Abort/timeout means outcome unknown and reconciliation,
not a new UUID. No ticket request is triggered by login, navigation or an OAuth callback.
Context/display DTOs remain unchanged; strict validators must reject unreviewed fields.

## 8. Product decisions and preserved behavior

### Decisions required before the relevant implementation phase

| Decision | Recommendation / boundary |
| --- | --- |
| Development OAuth ownership and origins | Dedicated client, External audience, minimal scopes, explicit local callback/test accounts and protected secret injection |
| Server provider policy | One Google product entry is confirmed; decide server email signup/password availability separately from isolated fixture login |
| Cashier identity lifecycle | Approve exact email-to-subject/UUID binding, reapproval/rename rules, reauthentication interval and no automatic identity transfer |
| Staff cutover and revocation | Explicit legacy fixture treatment, busy-work handover and emergency disablement policy; no silent busy-guard bypass |
| Administrator policy | Designated real administrator, required AAL2, factor recovery and last-admin safeguards |
| Internet exposure | Rate-limit/abuse thresholds, deployment/HTTPS and remote-access review; loopback client remains local until separately approved |

Automatic ordinary provisioning without administrator approval, shared student/payor
dashboard, personal/school account support and no self-selected staff roles are already
confirmed requirements, not open admission decisions.

### Behavior that can safely remain unchanged for Google Auth

| Area | Existing behavior / later decision if changed |
| --- | --- |
| Payor beneficiary | Queue ticket belongs to the authenticated owner; no student-beneficiary record or delegated record access is implied |
| Financial/student records | No such access is granted by Google login or queue ownership; any future feature needs a separate minimal contract and authorization |
| Limits | One active ticket across services; two SERVED tickets per service per issuance day, per Auth owner |
| Multiple accounts | Independent owner quotas; Google email verification does not prove one natural person. Household/beneficiary aggregation needs a new approved rule |
| Remote requests | No physical-presence check exists in issuance. Future remote UI/network enablement is separate; another device cannot use this machine's loopback address |
| Closed/unstaffed designated counter | An enabled service on an open day can currently accept tickets; do not add availability restrictions in an Auth migration |
| Arrival/no-show | Existing skip-to-tail, serve and day-close/forfeit behavior; no check-in, reservation or remote priority rule is invented |
| Routing/queue mechanics | Fixed five pairs, daily numbers, replay keys and issuance-day quotas unchanged |

Before internet exposure, evaluate Auth limits and separate RPC issuance abuse limits
per account/IP. Client debounce is insufficient. Verify which Google OAuth paths can
actually use CAPTCHA; do not assume an email-form CAPTCHA protects OAuth callbacks or
business RPCs. Abuse controls must not introduce mandatory administrator approval for
ordinary access. Enrollment and beneficiary verification remain separate from Google
email/domain proof.
[Supabase Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits),
[CAPTCHA integration](https://supabase.com/docs/guides/auth/auth-captcha).

## 9. Implementation phases and acceptance gates

| Phase | Work and required gate |
| --- | --- |
| A — approval/config design | Resolve the preceding implementation decisions; review explicit disposable identities, origins and secret storage. No credential creation before approval |
| B — ordinary Google Auth | Configure only the approved local provider; add PKCE/button/callback; reuse provisioning trigger; validate personal/school first and returning login, linking, disablement and public access |
| C — staff authorization | Review a seventh migration and exact DTOs; implement private approval/binding, current-eligibility enforcement, audited/idempotent management and revocation. Prove populated legacy compatibility in isolation |
| D — administrator MFA | Enable approved local TOTP, implement enrollment/challenge/recovery UX and backend AAL2 enforcement; validate all sensitive reads/mutations and last-admin recovery |
| E — retained-local acceptance | Verify recovery baseline and source identity; apply only separately approved schema/config changes after disposable tests. Preserve existing fixtures and capture fresh recovery evidence afterwards |
| F — requester operations, separately scoped | Implement owner-only queue dashboard and issuance only after operational acceptance, availability/no-show decisions as needed, actual HTTP regression and explicit UI enablement approval |

Phase B alone can deliver automatic ordinary Google access without requiring staff
approval. Staff/admin controls must not become operational until C/D gates pass.
No existing closed day should be reopened for testing. Do not merge account provisioning,
financial delegation or a queue algorithm rewrite into the staff migration.

## 10. Regression and security test plan

New counts must come from executed future runs. Existing reported test results are
historical evidence only. This task ran read-only inspection/preservation checks;
it did not run Google login, pgTAP, frontend tests, browser acceptance or a build.

| Layer / scenario | Required observation |
| --- | --- |
| Real Google: personal and school first login | Auth validation, exactly one ordinary enabled account, no administrator approval/profile fabrication, shared Queue dashboard |
| Repeated/concurrent login | Same identity/account UUID; no duplicate account, role reset, quota reset or duplicate provision; trigger failures surface safely |
| Automatic identity linking | Existing verified email account retains UUID/history/disabled state; ambiguous/unconfirmed identity cases follow tested Auth behavior without custom merging |
| Metadata and input attacks | ADMIN/CASHIER metadata, domain, role/email query parameters and forged identity evidence cannot promote; non-Google/unverified/missing proof cannot bind staff |
| Approval lifecycle | Exact normalized email only; concurrent binds/revoke serialize; duplicate subject/account rejected; rename/unlink/recycled email/new UUID cannot inherit privilege |
| Authorization | Student/cashier cannot manage approvals or ADMIN configuration; unassigned/wrong-service cashier denied; current approval enforced in every read/mutation path |
| Revocation with original JWT | Idle and busy revocation deny subsequent staff access; busy handover preserves ticket/event/number and does not claim a blocked change succeeded |
| Disabled accounts | Existing session still produces masked disabled context; all protected operations deny; repeated Google login never re-enables |
| ADMIN/MFA | AAL1 cannot read/manage protected admin data; AAL2 authorized operations succeed; expiry/factor loss/recovery and last-admin guards tested |
| Callback/redirect | Cancelled/denied/expired/replayed code, missing verifier, invalid state, query injection, hosted/protocol-relative return URLs and duplicate exchange fail safely; callback URL scrubbed |
| Interrupted requests | Reconcile ambiguous OAuth/staff-sync outcomes; retained request UUID on mutation retry; no duplicate role change or audit; no automatic ticket issuance |
| Session lifecycle | Stored-session verification, refresh/expiry, account switch, sign-out failure, offline/reconnect/visibility and stale callback/context races preserve fail-closed state |
| Multiple tabs | Overlapping PKCE starts, sign-out/account changes, storage events and independent context responses cannot restore foreign privileged state |
| Public/record privacy | Anonymous display unchanged; only two public subscriptions; no emails/identities/tokens in events; foreign ticket history and private tables denied; no student/financial delegation |
| Queue regression | Exact fixed mapping, numbering, one active owner, two served/service/issuance day, skipped tail/eventual single quota count, historical replay, concurrent calls and closure remain correct |
| Database upgrade/security | Fresh and populated disposable migrations, pgTAP, lint, RLS/ACL/owner/search_path checks, unchanged algorithm bodies, exact expected publication and schema exposure |
| Vue/browser | Unit/controller/SSR plus desktop/mobile real browser; keyboard labels/focus/errors, service-name escaping, public access and disabled operational controls |
| Build/secrets | Local-only production build; scan for captured Google secret, private Supabase keys, passwords/token canaries; verify no secret-bearing VITE variable, callback logging or unexpected origin |

Use disposable projects for Auth creation/approval/revocation and active-day business
fixtures. Deterministic mocked OAuth tests do not prove provider validation: real
personal/school Google acceptance requires a separately authorized configured client
and human consent. Do not script account passwords into logs or copy Google cookies.
Actual wall-clock midnight contention, sustained load and physical-device accessibility
remain additional gates unless explicitly exercised.

Existing `frontend_auth_validation.mjs` pins five migrations and email-only fixtures;
it requires an explicit six/seven-version update and valid Google/MFA fixture design,
not an unmodified rerun or weakened assertions. The legacy queue_test.sql is fresh-only
and must remain excluded from retained-data execution. Rollback-only read-context and
routing tests need compatible approved-staff fixtures when the new eligibility guard
is introduced. Keep all original denial, race, replay and preservation assertions.

## 11. Exact expected files for the proposed implementation

The following is the proposed file manifest, not a record of changes made now. The
reserved migration name is subject to the next approved version/date check. No new
dependency is currently justified for basic OAuth/PKCE or the existing in-page selector.

| File | Expected purpose / phase |
| --- | --- |
| supabase/config.toml | Explicit local provider, site/callback, signup/provider and approved MFA configuration |
| .env.example | Non-secret variable names/help only; no provider secret value |
| README.md | Approved local provider setup, secret injection and acceptance commands |
| src/lib/supabase.js | Explicit PKCE on authenticated client; public client retained |
| src/lib/googleOAuth.js — new | Fixed-origin authorization URL and single callback-exchange controller |
| src/composables/useGoogleOAuth.js — new | Callback/pending-flow lifecycle and tab coordination |
| src/components/GoogleAuthCallback.vue — new | Sanitized pending/error callback UI |
| src/components/AuthWorkspace.vue | Single Google entry and neutral requester labels; retain disabled operational actions |
| src/App.vue | Callback gate and Auth/workspace composition |
| src/composables/useQueueAuth.js | Coordinate callback readiness and staff-sync/context lifecycle |
| src/lib/authController.js | Optional staff-sync/MFA transitions with existing generations and safe logout |
| src/services/queueApi.js | Reviewed staff read/mutation allowlists and exact DTOs; issuance still excluded |
| src/components/CashierAccessManager.vue — new | Minimal approved-email/counter management only after backend/MFA acceptance |
| src/components/MfaChallenge.vue — new | Reviewed administrator enrollment/challenge states |
| index.html | Callback referrer policy; any CSP change requires testing against actual app assets |
| supabase/migrations/20261017000700_google_cashier_authorization.sql — proposed only | Private approval model, narrow RPCs, shared eligibility and approved MFA guards; no queue algorithm rewrite |
| supabase/tests/database/google_cashier_auth_test.sql — new | Transactional provisioning/identity/approval/MFA/ACL negative and positive cases |
| supabase/tests/google_auth_validation.mjs — new | Actual local HTTP, lifecycle, browser and authorized provider acceptance |
| supabase/tests/run_local_google_auth.py — new | Explicit disposable target guards, secret-safe setup/test orchestration and preservation |
| supabase/tests/frontend_auth_validation.mjs | Update migration/identity assumptions transparently; retain original scenarios |
| supabase/tests/headless_local_browser.mjs | Scoped Google navigation support while API requests remain confined to the chosen local target |
| supabase/tests/database/read_context_test.sql | Valid approved-staff fixtures; retain disabled/revoked/metadata/minimization assertions |
| supabase/tests/database/fixed_routing_test.sql | Compatible approved-staff/MFA fixtures; retain all route and authority assertions |
| supabase/tests/static_check.py | Explicit new migration manifest and helper/grant/security coverage |
| tests/frontend/googleOAuth.test.js — new | Redirect/callback/PKCE/race/multi-tab unit cases |
| tests/frontend/authController.test.js | Google/staff-sync/MFA lifecycle additions; keep prior cases |
| tests/frontend/authWorkspace.test.js | Replace no-OAuth expectation with single Google entry; retain role/disabled/escaping checks |
| tests/frontend/queueApi.test.js | Exact new contracts, request-key reconciliation and denials |
| supabase/FRONTEND_INTEGRATION_PLAN.md | Current six-version baseline and approved Auth/staff/MFA integration contracts |
| supabase/GOOGLE_AUTH_VALIDATION_REPORT.md — future | Executed results, preservation, limitations and real-provider evidence |
| supabase/tests/results/google_auth_*.json — future | Sanitized run evidence; screenshots only after confirming they contain no credentials |

No change is expected to the six existing migration files, public display contracts,
queue algorithms, package dependencies or production configuration. Keep provider
secrets outside the tracked tree through approved environment injection; this plan
does not create a secret file or assume the CLI automatically loads a new .env path.
Any extra file required by implementation should be explained in the approved scope.

## 12. Current deliverables and approval boundary

Created in this inspection task only:

- supabase/GOOGLE_AUTH_IMPLEMENTATION_PLAN.md — this report.
- supabase/tests/results/google_auth_design_inspection.json — sanitized local identity,
  aggregate Auth configuration and unchanged-baseline evidence.

Read-only identity/preflight, complete 69-table preservation and aggregate Auth/trigger
inspection passed. No new runtime feature test was claimed. Local default signup/
autoconfirm, mismatched redirects, absent Google verification evidence and disabled
MFA are implementation gates; they were not changed or presented as completed security
controls. No newly observed application-data or privilege difference was found.

Implementation approval must cover the chosen local Google setup/secret handling and
Vue callback work. Staff authorization and MFA require review of the new migration,
legacy-account treatment, busy revocation/handover and exact RPC contracts before any
retained-local application. Remote/hosted rollout, financial access and operational
issuance remain separate tasks. Ordinary queue access must remain automatic without
administrator approval.

**Stopped after the design report. No Google credentials/provider setup, database or
frontend change, migration, live issuance, reset, push/link, deployment, backup/volume
deletion, Git commit or push was performed. Awaiting approval before implementation.**
