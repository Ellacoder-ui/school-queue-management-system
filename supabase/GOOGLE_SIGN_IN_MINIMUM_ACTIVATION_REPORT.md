# Local Google Sign-In: minimum activation recommendation

October 18, 2026. **Google OAuth does not require healthy Vector. Recommend preparing
an Auth-only container recreation, preserving the running database/API and all other
services. No configuration, credential, service or record change was made here.**

## Current checks

Read-only inspection at **14:28:45–14:28:49 UTC+08:00** verified school-queue-local,
PostgreSQL 17.11, cluster 7696959712798593061 and the retained database volume.

| Check | Actual result |
| --- | --- |
| PostgreSQL | Docker healthy; read-only SELECT 1 passed |
| Auth | Docker healthy; GET /auth/v1/health through Kong returned 200 |
| API | Kong healthy; anonymous queue_display projection GET returned 200 |
| Google availability | GET /auth/v1/settings returned 200, google=false |
| Vector | Original container unhealthy/restarting; remains unrepaired |

Six migrations/routes, 39 accounts/39 Auth users and zero active queue work remain
as recorded. Container definitions/lifecycles outside Vector and Docker resource
inventory matched before/after. Credential-store metadata and 263 frozen input hashes
matched. Google credentials were not opened/decrypted; no backup was inspected or run.
[Health evidence](tests/results/google_activation_minimum_inspection_aacca7a5.json).

Vector collects logs. Google Sign-In uses the browser, Kong, Auth, PostgreSQL and
Google's endpoints; the application then uses its authoritative context RPC. Vector
is not in that OAuth path. Its failure reduces logging visibility, but is not an OAuth
prerequisite. These checks establish core availability, not completed Google consent
or token-exchange acceptance. Full-stack health is still not PASS.

## Supported configuration and minimum restart

Supabase documents **per-service Auth recreation** for self-hosted OAuth configuration.
This supports configuring Auth through its GOTRUE environment and recreating only that
service. However, this project is **CLI-managed**, not that Docker Compose deployment:
the documented `run.sh recreate auth` command cannot simply be run in this repository.
[Official Auth-only procedure](https://supabase.com/docs/guides/self-hosting/self-hosted-oauth).

Installed CLI **2.121.0** has no Auth-only restart command; `services` lists versions.
The documented CLI configuration application method is stop/start of the local stack.
Running `start` with the existing database running returns the already-running path;
it does not reconcile changed Auth configuration. An ordinary `docker restart` also
keeps the old container environment. Therefore the minimal option needs a **small,
reviewed Auth-only Docker recreation helper**, using the supported Auth environment
model; it is not a first-class CLI operation. The stock CLI stop/start path remains
available separately but affects the whole stack and retains the unresolved Vector
health issue. No health-ignore or service-exclusion workaround is recommended.
[CLI configuration procedure](https://supabase.com/docs/guides/local-development/cli/config),
[pinned start behavior](https://github.com/supabase/cli/blob/v2.121.0/apps/cli/src/commands/start/start.handler.ts).

Auth 2.197.0 supports live reload only when started with `--config-dir`. Current Auth
runs as `auth`, with no such flag or mounts. Reload cannot be assumed available, and
the public settings endpoint is read-only. Adding reload infrastructure would add work
for this one-time change. **Minimum affected service: Auth only.** Preserve its canonical
name/network aliases; Kong and PostgREST should continue using the existing routes.
Require Auth health through Kong after replacement, including any DNS convergence;
if it fails, stop acceptance rather than automatically restarting other services.
[Pinned reload condition](https://github.com/supabase/auth/blob/v2.197.0/cmd/serve_cmd.go).

## Required configuration delta — proposed, not applied

Mirror these settings in config.toml for future CLI consistency and apply their
equivalent GOTRUE values only to the replacement Auth environment. The secret and
Client ID come privately from the existing DPAPI store; do not rewrite that store.

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

The signup/anonymous/manual-linking entries preserve current behavior. Keep all other
effective settings, especially JWT/signing keys, database credentials, email policy,
MFA and rate limits, unchanged. Current Site URL/allowlist use port 3000 and must change
to the exact Vue addresses above. No Vue/PKCE rewrite or Google JavaScript SDK is needed.
[Google local configuration](https://supabase.com/docs/guides/auth/social-login/auth-google),
[pinned environment mapping](https://github.com/supabase/cli/blob/v2.121.0/apps/cli/src/commands/start/services/gotrue.service.ts).

## Necessary safeguards and exact next step

After separate approval, **implement and rehearse an Auth-only recreation helper**:

1. Capture the current Auth create definition/environment privately into protected
   rollback storage. Validate the exact old ID/image, retained DB/volume and current
   security/data state. Change only the two URL settings and Google provider fields;
   preserve all other settings and network aliases. Use existing protected credentials
   through private process/API input, never arguments, VITE variables or plaintext files.
2. Recreate only Auth with the same cached image and existing network; do not stop the
   database, gateway, REST, Realtime, Analytics or Vector. Auth has no data-volume mount.
   Keep a tested configuration rollback. Auth's root command runs its own migration
   check before serving: verify the same-image Auth migration state and compare afterward;
   do not claim startup is intrinsically read-only or apply application migrations.
3. Require actual Auth/container health, gateway health/settings with google=true,
   unchanged database/keys/security and a successful anonymous API read. Only then run
   the existing Vue application at exactly 127.0.0.1:5173 and user-controlled Google
   tests: personal/school login, cancellation, repeat login/logout, callback scrubbing,
   one PKCE exchange, verified getUser and current my_context.

Actual risks are brief Auth downtime, a bad environment/key/alias translation, startup
errors and Google callback/consent/Workspace policy failures. Real login may create or
link Auth identities, sessions and an ordinary account; that needs explicit test-write
authorization. Existing users' roles/enabled state and all queue history must remain
unchanged. STUDENT provisioning uses the existing trigger. ADMIN/CASHIER authority must
continue coming from current database context, never a role selector, email domain or
Google metadata. Staff approval/MFA requirements are not waived by OAuth.

No Analytics backup is technically required merely to configure/recreate Auth while
leaving Analytics and PostgreSQL running. The historical 71-table recovery PASS and
the separate live pruning FAIL remain as recorded; neither is rewritten or presented
as current-inventory equality. Existing full-stack activation locks remain unchanged.
The proposed helper must have its own explicit scope and health acceptance, not bypass
those locks or declare the unhealthy full stack healthy.

**Decision:** prepare/rehearse the narrow Auth-only helper next, then activate and test
only within separately approved scope. No retained activation helper was implemented
or executed in this assessment. No provider, credential, record, migration, backup,
container or deployment was changed. CLI help required an approved sandbox retry for
its telemetry-file access; no start/stop command was run. Only the read-only inspector,
new sanitized health/source evidence and this report were created.

[Pinned source review receipt](tests/results/google_activation_minimum_sources_317fb723.json).
**Stopped for separate approval before implementation/configuration, recreation or real login.**
