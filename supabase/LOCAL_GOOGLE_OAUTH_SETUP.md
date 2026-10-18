# Local Google OAuth setup — preparation only

October 17, 2026. The frontend is prepared; **the provider is not enabled**.
Nothing in this document was applied to the running Auth server. Obtain approval
before creating credentials, editing local provider settings or restarting the stack.
The intended administrator account must not be created/promoted by this setup.

## Fixed local addresses

| Purpose | Exact address |
| --- | --- |
| Vue product / Site URL | http://127.0.0.1:5173 |
| Google-to-Supabase registered callback | http://127.0.0.1:54321/auth/v1/callback |
| Supabase-to-Vue allowed callback | http://127.0.0.1:5173/auth/callback |
| Anonymous monitor | http://127.0.0.1:5173/display |
| Password test UI, Vite development only | http://127.0.0.1:5173/dev/login |

The two callback addresses have different purposes. The frontend rejects other OAuth
origins, ports, providers and redirect targets. Do not substitute localhost silently;
browser storage/verifiers are origin-specific. If Google's console requires a hostname
adjustment, review the complete origin/allowlist/client guard change before proceeding.

The current running Site URL is http://127.0.0.1:3000, and its additional allowlist is
https://127.0.0.1:3000. Neither matches this frontend. They remain unchanged in this task.

## Google development client, after approval

Create a dedicated Web application OAuth client in a development Google Cloud project.
Choose **External** audience for personal Gmail and school Google accounts; do not
restrict by school domain or use an organization-only audience. While the consent
screen is in Testing, list consenting development test accounts. This temporary Google
restriction is not administrator approval for ordinary application accounts.
Request only OpenID/email/profile access; no Gmail/Drive or offline access is needed.
Register the Vue origin and the Google-to-Supabase callback above. Keep client ownership
and consent-screen contacts with the institution's designated development operator.
[Supabase Google provider instructions](https://supabase.com/docs/guides/auth/social-login/auth-google).

School Google administrators may separately restrict third-party applications. A school
email, domain or provider profile is never a staff/admin grant or enrollment certificate.

## Proposed local configuration — do not apply yet

The following is a non-secret review example, not an activated configuration file:

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
client_id = "<dedicated-development-web-client-id>"
secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET)"
skip_nonce_check = false
```

Keep new OAuth user creation enabled: existing auth.users insertion already provisions
an ordinary enabled STUDENT account atomically. Do not add frontend upserts, role
selectors or an administrator-email exception. Do not overwrite an existing user's
role, enabled state, ticket history or quota on repeated login. Separate email signup
policy, cashier approvals and MFA need later authorization; this example does not
change those policies or activate MFA.

Inject SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET only into the local Supabase CLI/
server startup process through approved protected secret storage. Its value must not
appear in a command-line argument, echoed shell transcript, tracked .env, VITE_ variable,
browser, screenshot or report. Do not paste it into this document. Client ID is a public
identifier; client secret is not. No hosted dashboard/API configuration is required.

## Restart and verification, after approval

config.toml edits require a controlled local stop/start to rebuild the running service
configuration. An ordinary Docker restart merely restarts the old container environment.
Use the pinned project CLI, project directory, existing network and preserved volumes;
review the restart as a separate local infrastructure action.
[Supabase local configuration reference](https://supabase.com/docs/guides/local-development/cli/config).

The installed CLI help confirms stop --no-backup **deletes data volumes**. Never use
that flag, stop --all, reset, push, link, volume deletion or a new project identity to
apply provider settings to the retained instance. Do not upgrade platform images as
part of this provider setup. The approved restart procedure must independently verify
school-queue-local, DB 54322, API 54321, the existing volume/network and six migrations,
then check them again afterwards. No restart command was executed in this step.

Before restart, recheck the six-version recovery bundle and source state. Read-only
Realtime tests may advance its internal subscription-ID sequence; preserve this
operational difference explicitly rather than rewriting recovery evidence. Any new
business/Auth state requires refreshed recovery/preservation review.

After restart, verify only non-secret effective Site URL/redirect/provider fields.
GET http://127.0.0.1:54321/auth/v1/settings with the local public API key must report
external.google=true; never print the full CLI status or container environment. The
frontend uses that public read to prevent navigation while Google is unavailable.
[Auth public settings contract](https://github.com/supabase/auth/blob/master/openapi.yaml).

Start Vite with `python scripts/local_frontend.py --dev`. Sign in manually with one
consenting personal and one school Google test account. Confirm Google returns to
the local Auth callback, then Vue receives a code at the exact application callback.
The URL is scrubbed and one PKCE exchange completes, followed by getUser/my_context.
Codes last five minutes and are single-use; missing verifiers or interrupted exchanges
require reconciliation/new explicit attempts, not automatic code reuse.
[Supabase PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow).

Real sign-in creates Auth sessions and may create accounts. Those acceptance writes
need separate approval and isolated fixtures; this task's browser tests intercept
them and do not establish real Google/provider/provisioning acceptance. Test cancellation,
repeat login/linking, disabled accounts, two tabs and session recovery before enabling
operational workflows. Do not designate the real administrator or approve cashiers
as part of provider acceptance.

## Frontend safety and limitations

- Product entry is one Continue with Google button; the development password page is
  only selected by a development build. It is not a server-side email-provider policy.
- The Auth client uses PKCE, detectSessionInUrl=false and one explicit callback handler.
  Supabase handles provider state/verifiers. App flow markers contain no identity or
  token and do not authorize roles; they gate interrupted/competing browser flows.
- Origin-wide Web Locks are required for safe flow coordination. Unsupported browsers
  fail closed. Callback exchange timeout locks navigation until explicit reconciliation;
  an already-running exchange is not retried or allowed to restore access late.
- Sessions remain SDK-persisted in localStorage and therefore accessible to same-origin
  scripts. This is not an HttpOnly-session/XSS or production-readiness certification.
- Current role/enabled/counter records remain authoritative. Staff email approval and
  administrator MFA enforcement are separate missing backend gates. All operational
  controls and ticket issuance remain disabled.
- The application is deliberately loopback-only. This setup does not provide remote
  network access or authorize any hosted deployment.
