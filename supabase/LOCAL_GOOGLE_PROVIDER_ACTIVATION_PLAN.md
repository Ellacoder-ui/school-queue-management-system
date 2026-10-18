# Step 22.5: local Google provider activation plan

October 17, 2026. **Planning and read-only verification completed. Google remains
disabled. No configuration change, restart, migration or real login was performed.**

The proposed change is ready for review. Activation is conditional on confirming the
saved Google client fields, preparing protected credentials, and verifying a fresh
recovery point for the current inventory. Those gates have not been cleared here.

## Verified retained environment

Evidence: [read-only inspection](tests/results/local_google_provider_preparation_bac51e40.json).
The inspector verified the existing final frontend PASS evidence and compared live
state with its immutable baseline using the reviewed Realtime classifier.

| Item | Observed value |
| --- | --- |
| Project / directory | school-queue-local / C:\Users\Hp\school-queue-management-system |
| Database / API | 127.0.0.1:54322/postgres / http://127.0.0.1:54321 |
| PostgreSQL / cluster identifier | 17.11 / 7696959712798593061 |
| Database container and volume | supabase_db_school-queue-local |
| Gateway / network | supabase_kong_school-queue-local / supabase_network_school-queue-local |
| CLI | Installed project dependency, 2.121.0 |
| Auth image | public.ecr.aws/supabase/gotrue:v2.197.0 |
| Auth image ID | sha256:1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b |
| Migration history | Exactly 20261016000100 through 20261016000600; file hashes unchanged |
| Permanent routing | 1:TP, 2:SOA, 3:PNEP, 4:REF, 5:ADJ |
| Durable state | 39 accounts, 20 terminal tickets, 57 events, 69 replay records, 32 audits |
| Work / staffing | Seven closed days, zero active tickets, four assignments unchanged |
| Security | All 15 application tables retain RLS; browser roles lack queue_private USAGE |
| Application Realtime publication | Only queue_display.counter_state and service_state |

Existing host bindings were inspected and left unchanged; all application/database
connections in this task explicitly used 127.0.0.1. No hosted Supabase was contacted.

Current Auth settings, read without exposing its full environment:

| Setting | Running value |
| --- | --- |
| Public Auth settings: external.google | false |
| Site URL | http://127.0.0.1:3000 |
| Additional redirect allowlist | https://127.0.0.1:3000 |
| External Auth URL | http://127.0.0.1:54321/auth/v1 |
| Signup disabled | false |
| Email provider / mail auto-confirm | true / true |
| Anonymous sign-ins / manual linking | false / false |
| JWT lifetime | 3600 seconds |

Google credential environment fields were absent. No credential was requested,
captured or validated. The two port-3000 URLs conflict with the implemented frontend.
The current config.toml has no explicit Auth/provider block; running defaults are
not evidence that Google is configured.

The existing AFTER INSERT trigger on auth.users still calls
queue_private.provision_account(). It creates one ordinary enabled STUDENT account
atomically for a new Auth user. No new migration or browser account insert is needed.
It does not create an enrollment profile, assign a cashier, grant ADMIN or issue a
ticket. Current database role/enabled state remains authoritative on every login.

## Google Console verification remains pending

The project, Web client, External/Testing audience and two test users are
**user-reported**. No connected browser was available. Browser inventory was empty,
and opening Chrome through the browser tool returned “Browser is not available:
chrome.” The user's follow-up restated expected URLs, not observed saved fields.
Consequently the existing client cannot yet be declared correctly registered.

Manually open Google Auth Platform → Clients →
**School Queue Management System - Local Development**, in the reported
**School Queue Management System** project. Confirm the saved fields exactly:

| Google field | Required saved value |
| --- | --- |
| Application type | Web application |
| Authorized JavaScript origins | http://127.0.0.1:5173 |
| Authorized redirect URIs | http://127.0.0.1:54321/auth/v1/callback |

Also verify Audience is External/Testing and both consenting accounts remain listed:
eabeso63122@liceo.edu.ph and ellasharmaineabeso2004@gmail.com. Confirm the client
credentials belong to this same client. Report only the saved URLs/status, never
credentials or credential JSON. Unexpected additional destinations require review.

Keep Data Access limited to identity scopes: openid, userinfo.email and
userinfo.profile. Do not request Gmail/Drive access or offline provider tokens.
The Supabase setup documents the local Auth callback above; Google's URI validation
requires matching registration and permits loopback exceptions. Do not silently
replace 127.0.0.1 with localhost, change ports or add wildcards.
[Supabase Google setup](https://supabase.com/docs/guides/auth/social-login/auth-google),
[Google redirect validation](https://developers.google.com/identity/protocols/oauth2/web-server#uri-validation).

External audience supports the intended personal and school account population;
school Workspace policy can still block consent. Do not add an hd/domain restriction
or interpret a school email as enrollment or staff approval.
[Google consent configuration](https://developers.google.com/workspace/guides/configure-oauth-consent).

## Exact proposed configuration, not applied

After separate approval, append this block to supabase/config.toml, retaining the
existing project, API, database, exposed-schema and disabled-seed configuration:

```toml
[auth]
enabled = true
site_url = "http://127.0.0.1:5173"
additional_redirect_urls = ["http://127.0.0.1:5173/auth/callback"]
enable_signup = true
enable_anonymous_sign_ins = false
enable_manual_linking = false

[auth.external.google]
enabled = true
client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"
secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET)"
redirect_uri = "http://127.0.0.1:54321/auth/v1/callback"
skip_nonce_check = false
email_optional = false
```

Only Site URL, additional redirects and Google provider settings are intended to
change. Signup/anonymous/manual-linking entries explicitly preserve current behavior.
Preserve email authentication, confirmation policy, JWT keys/expiry, MFA, rate limits,
other providers and all unmentioned effective settings. Compare the complete resolved
configuration privately before any stop; unexpected changes fail the gate.

The pinned CLI provider schema supports these fields; its environment interpolator
resolves env(NAME) references in string fields, including client_id. Empty/unset
variables can leave unresolved references, so the future wrapper must reject either
missing credential and any unresolved env(...) before touching Docker.
[Provider schema, CLI 2.121.0](https://github.com/supabase/cli/blob/v2.121.0/packages/config/src/auth/providers.ts),
[Environment interpolation, CLI 2.121.0](https://github.com/supabase/cli/blob/v2.121.0/packages/config/src/lib/env.ts).

The CLI generates GOTRUE_EXTERNAL_GOOGLE_ENABLED, CLIENT_ID, SECRET, REDIRECT_URI,
SKIP_NONCE_CHECK and EMAIL_OPTIONAL from that block. It also maps site_url and
additional_redirect_urls to GOTRUE_SITE_URL and GOTRUE_URI_ALLOW_LIST. Check the
resulting nonsecret values and credential equality as booleans in memory.
[Pinned Auth container builder](https://github.com/supabase/cli/blob/v2.121.0/apps/cli/src/commands/start/services/gotrue.service.ts).

Google returns to Auth on port 54321; Auth then returns the PKCE code to Vue on port
5173. These are distinct callbacks. Keep the existing SDK 2.118.0 frontend unchanged:
one Google button, exact callback, PKCE, detectSessionInUrl=false, explicit single
exchange, URL scrubbing, verified getUser followed by my_context, and current-role
navigation. No Google JavaScript SDK or additional browser secret is required.
The Auth-to-Google confidential-client exchange and the app-to-Auth PKCE exchange
are separate legs; the pinned Google provider's RequiresPKCE=false does not disable
the frontend's PKCE protection.
[Auth 2.197.0 Google provider](https://github.com/supabase/auth/blob/v2.197.0/internal/api/provider/google.go).

## Proposed protected credential intake

Prepare and test the following helpers in the later implementation task; they do not
exist as a result of this plan:

| Proposed file | Responsibility |
| --- | --- |
| scripts/Set-LocalGoogleCredential.ps1 | Masked local intake, DPAPI encryption and restricted file ACLs; no service changes |
| scripts/Start-LocalGoogleAuth.ps1 | Target/config/recovery fences, process-only injection, captured diagnostics and approved stop/start |
| tests for those helpers | Dummy-credential encryption round-trip, missing-variable refusal, output redaction and target/command rejection |
| .gitignore | Add /.local-secrets/ before credential intake; verify ignored and untracked |
| .local-secrets/google-local.dpapi | Proposed encrypted payload, created only after secure helper review |

The manual sequence is:

1. Verify the saved client fields above. Open its credential details locally; do not
   send them to chat, screenshots or reports. Avoid downloading credential JSON.
2. The intake helper creates a fresh ignored directory, disables inheritance and
   allows only the current Windows SID and SYSTEM. Fail if protection or a same-user
   read/write probe fails. Refuse overwriting an existing credential artifact.
3. Enter Client ID and Client Secret at masked local prompts, without literal values
   in commands/history. Encrypt the payload with Windows DPAPI CurrentUser before
   writing it; decrypt/recheck privately and emit only success/failure. No plaintext
   .env file, transcript, exported environment or report contains either value.
   [Microsoft ProtectedData](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata).
4. The activation helper decrypts in memory, validates one dedicated Web client ID
   and a nonempty secret, and supplies the two named SUPABASE_AUTH variables only in
   the CLI child's environment. Use ProcessStartInfo with UseShellExecute=false and
   its environment dictionary; do not persist User/Machine environment variables.
   [Microsoft process environment](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.processstartinfo.environment).
5. Capture CLI output privately and emit a strict sanitized allowlist. Do not use
   debug output, echo the environment, print CLI status or upload support diagnostics.
   Dispose secret buffers where possible and remove child-environment entries in
   finally paths. Never pass provider credentials into Vite, builds or unrelated jobs.

DPAPI protects storage, not a compromised Windows account. Decryption also produces
plaintext in process memory; the CLI stores Auth's effective secret in Docker's
container environment. Docker administrators can inspect it. This method is not a
Docker-secret mount and cannot conceal credentials from those administrators.
Same-user DPAPI recovery and Google credential rotation need a separate protected
operator procedure; the database dump does not recover that credential store.
If clipboard transfer is unavoidable, keep it out of clipboard history/sync and
clear the copied value immediately. Never use VITE_* for provider credentials.

## Recovery gate before infrastructure changes

Read-only checks passed for the complete existing six-version recovery bundle:

`C:\Users\Hp\school-queue-management-system\.local-backups\post006_20261016T163319Z_4c79fb00`

Its original archive, snapshot, password-free roles, exact schema-grant supplement,
approved database environment supplement and bundle hashes/associations remain intact
and NTFS-restricted. Its actual isolated restore is documented in
[POST_MIGRATION_006_BACKUP_REPORT.md](POST_MIGRATION_006_BACKUP_REPORT.md).
No restore or new dump was executed here.

**Recommend, and require in this activation plan, a fresh verified recovery point.**
The historical bundle has 69 logical tables; the running inventory has 70, including
the reviewed empty messages_2026_10_20 leaf. The parent and seven October 14–20 leaves
are empty. Anonymous public subscription rows and their allocation sequence are
operational metadata; no application/Auth/history difference was found. This does
not turn the historical archive into a backup of today's exact inventory.

Use a new run identity and protected directory. Extend the reviewed backup procedure
to the explicitly inspected current inventory, preserving all old evidence. The old
post_migration_006_backup.py run path hardcodes 69 tables and historical source
equality: do not invoke it unchanged or weaken its assertions to force a pass.
The new recovery task must include:

- Exact loopback/project/volume/cluster checks, six unchanged migrations, zero active
  work and a new read-only exported-snapshot manifest with the complete inventory.
- Full custom dump, all physical partition data/attachments, password-free roles,
  source-derived ACL/settings supplements and protected checksums. Bound all artifacts
  to the new source snapshot; fence non-MVCC roles/sequences before and after.
- Actual full restore into a new network-none, no-TCP disposable cluster using matching
  PostgreSQL image, extensions, locale and preload prerequisites. Compare every table,
  partition, function, constraint/trigger, RLS/ACL, role, sequence and migration receipt.
- Final source preservation and retention of both recovery points/restored volumes.

Separately capture the effective service configuration, image IDs/digests, mounted
volume identities and rollback configuration securely. Logical dumps do not include
role passwords, external Auth/JWT/provider secrets, storage files or infrastructure.
The sensitive local database setting must remain confined to protected supplements.
Fresh recovery preparation itself needs its later authorized task; nothing was rebased
or backed up in this planning run.

## Later activation and preserving restart

These are proposed operations, not permission to run them now:

1. Confirm saved Console values, recovery completion, protected credential availability
   and separate approval for provider configuration/restart. Authorize real-login Auth
   mutations explicitly if they are also included in that later task.
2. Reverify project/path, cluster identifier, existing database/storage volumes, images,
   bindings, network membership, six migrations, routing and zero active work. Inspect
   all effective config/env overrides privately; reject other project IDs or unexpected
   pending files. Hash/copy the original config into protected rollback storage.
3. Validate the proposed config and resolved service image plan before stopping.
   Retain existing images and keys; an image upgrade is a separate change. Rehearse the
   wrapper with dummy secrets/disposable infrastructure. Confirm api.schemas stays
   public,queue_api,queue_display, seeds remain disabled and no service is newly enabled.
4. Apply only the reviewed config block. The wrapper executes these pinned commands
   with validated child environment and sanitized captured output:

   ```powershell
   node node_modules/supabase/dist/supabase.js stop --project-id school-queue-local --workdir C:\Users\Hp\school-queue-management-system
   node node_modules/supabase/dist/supabase.js start --workdir C:\Users\Hp\school-queue-management-system --network-id supabase_network_school-queue-local
   ```

   The CLI stop removes matching containers and may prune the unused project network;
   without --no-backup it retains volumes. Start recreates services using configuration.
   Network/container IDs may change; database cluster and existing data-volume identity
   must not. Verify labels before stop and retained volume presence again before start.
   No --all, --no-backup, reset, push, link or volume deletion is permitted.
   [Pinned stop implementation](https://github.com/supabase/cli/blob/v2.121.0/apps/cli/src/commands/stop/stop.handler.ts).
5. An existing-volume start skips fresh database migration/seed setup. It still runs
   platform convergence, including webhook-extension handling. Confirm its resolved
   behavior matches the existing extension inventory; do not assume startup is read-only.
   If the retained volume is absent, abort before CLI start could initialize a fresh
   database. No migration/application bootstrap is part of activation.
   [Pinned database startup](https://github.com/supabase/cli/blob/v2.121.0/apps/cli/src/command-internal/db-bootstrap/start-database.ts),
   [Pinned platform setup](https://github.com/supabase/cli/blob/v2.121.0/apps/cli/src/command-internal/db-bootstrap/db-setup.ts).
6. Require healthy services and actual expected published endpoints. Do not ignore
   health errors. An ordinary docker restart would reuse the old environment and is
   not the configuration application method. Stop on any mismatch; preserve diagnostics
   without dumping environment values or running destructive recovery commands.

## Verification before and after real sign-in

Before any user login, require exact durable row/security equality with the fresh
baseline, unchanged migration history/routing and no additional permissions. Use the
existing strict Realtime classifier only within its reviewed lifecycle scope; unknown
maintenance changes require review. Check credential equality privately, effective
Google callback/Site URL/allowlist, and GET /auth/v1/settings reporting google=true.
Do not use the old inspection entry point unchanged after activation: it deliberately
asserts Google disabled. Add a separately reviewed activated-provider verifier instead.

Rerun the relevant frontend/SDK/interception/preservation suites, local production
build and known-private-key scan. Extend the in-memory bundle scan to the newly supplied
Google secret without printing it. Verify /display remains anonymous and read-only,
both public listeners recover after restart, and realtime/queue_private REST profiles
remain rejected. Negative private/hosted/redirect cases belong in mocked tests, not
requests sent to forbidden targets. No operational fixture-creating suites are needed
on retained data.

For separately authorized real provider acceptance, the user controls consent and
Google credentials/2FA. Test the two registered accounts sequentially using clean
browser profiles or explicit sign-out; never save tokens, callback URLs/codes or
unredacted network traces in evidence. Establish each account's current state privately
before testing; neither account's new/existing/role status was assumed in this plan.

| Scenario | Required result |
| --- | --- |
| Personal and school test-account consent | Both complete the registered Google → local Auth → exact Vue callback flow; school policy failures are reported |
| New identity | One Auth user and one enabled STUDENT account via the existing atomic trigger; no profile/staff grant/ticket |
| Existing verified-email identity | Inspect actual supported linking outcome; preserve user/account ID, role, enabled state and history; no duplicate or forced role reset |
| Repeated login / logout / reload | Same account, verified session and current my_context; callback exchanged once and URL scrubbed |
| Cancellation, missing verifier, expired/replayed code, interruption | Safe failure/reconciliation; no automatic code reuse or unauthorized workspace |
| Two independent tabs / account switching | Existing Web Lock/generation safeguards prevent stale context/navigation |
| Disabled/revoked and metadata-adversarial cases | Current database authority wins; use mocks/disposable fixtures unless separate retained mutations are approved |
| Public monitor during signed-in use | Anonymous composition remains isolated; no private identity or provider token in its DOM/subscriptions |

For existing email users, automatic identity linking is a separate behavior from the
disabled manual-linking feature. Do not enable manual linking to make a test pass.
First login is a real Auth/session/account write; after approved tests, compare only
explicitly authorized identity/session/provisioning changes while requiring all queue
history, roles, assignments, routes and quotas unchanged. Retain consenting test users
and their evidence; do not delete records to recreate the old baseline. Real provider
acceptance does not approve cashier access, administrator designation/MFA bypass,
beneficiary access or ticket issuance.

## Configuration rollback

Before real login, a failed configuration check should stop acceptance. The reviewed
rollback restores the exact protected previous config and startup environment, then
uses the same preserving stop/start workflow and rechecks data, endpoints and Google
disabled status. Do not remove/reset the database or automatically restore an old dump.
If a container/startup check fails, keep volumes and report the precise failed phase.

Disabling Google later prevents new provider starts; it does not automatically undo
new Auth records, linked identities or already issued Supabase sessions. Session
revocation, credential rotation and any record cleanup require their own explicit
authorization. Never erase legitimate new users/history as a configuration rollback.

## Work completed and stop boundary

This task's read-only local identity, migration, provisioning, source-preservation,
Realtime-scope and protected recovery-artifact checks passed both initially and in
the [final inspection](tests/results/local_google_provider_preparation_6dd1674f.json).
Comparing these two captures passed: configuration hash, Auth image/settings and all
durable rows/security metadata matched. Inventory stayed at 70; no new partition
appeared. Anonymous public subscription counts stayed at two, while their operational
allocation sequence advanced from 286 to 288. That scoped platform change is recorded,
not described as database-wide immutability or attributed to a specific background job.
The inspector requested no subscription or SQL write.

Python syntax, new-file whitespace and Git diff whitespace checks passed. No frontend
or provider regression suite was rerun for this plan. CLI start/stop **help** and
pinned source were reviewed; the commands themselves were not executed. Console
inspection could not run because no browser was connected. Credential intake,
fresh backup/restore, restart, live Google consent/linking/provisioning and subsequent
acceptance tests were not performed. Earlier PASS counts remain historical evidence.

Created in this task:

- This plan.
- tests/inspect_google_provider_preparation.py: read-only inspection with allowlisted
  Auth fields and credential-presence booleans; no activation/restart entry point.
- tests/results/local_google_provider_preparation_*.json: sanitized new inspection
  evidence, separate from all historical reports and recovery manifests.

No existing config, product source, migration, Auth setting/record, RLS/grant, backup
or Docker resource was changed. Official documentation/source was read from Supabase,
Google, GitHub and Microsoft; no hosted Supabase endpoint was contacted.

**Google client readiness: pending saved-field verification. Fresh recovery point:
recommended and an activation prerequisite in this plan. Credential method: proposed,
not yet implemented or exercised. Activation: reviewable for a later conditional
approval, not cleared for execution now. Stopped after the plan.**
