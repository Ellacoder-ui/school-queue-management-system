# Step 22.9: Auth-only Google activation helper

October 18, 2026. **Implementation and disposable rehearsal PASS; retained activation
remains disabled.** Final run **93e39602**, **21:39:55–21:40:47 UTC+08:00**:
**17 offline methods and 29 Windows/Docker checks passed**, zero failures/skips.
Google remains disabled in the running project. No retained service operation or
database/Auth write was performed.

**Implemented:** `scripts/Start-AuthOnlyGoogle.ps1`, `authOnlyCore.mjs`,
`authOnlyEngine.mjs`, `authOnlyRetained.mjs`, `AuthOnlyStorage.ps1` and
`AuthOnlyCredentialBridge.ps1`, plus tests under `tests/security/`.
The executor preserves the complete Auth definition, requires bound source/target/
code/approval hashes, refuses repeats and uses separate rollback approval. It retains
original/failed containers. It has no delete, force, stack restart or automatic retry.

**Configuration:** only these eight effective environment values change:

| Auth environment | Proposed value |
| --- | --- |
| GOTRUE_SITE_URL | http://127.0.0.1:5173 |
| GOTRUE_URI_ALLOW_LIST | http://127.0.0.1:5173/auth/callback |
| GOTRUE_EXTERNAL_GOOGLE_ENABLED | true |
| GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID / SECRET | Private DPAPI input |
| GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI | http://127.0.0.1:54321/auth/v1/callback |
| GOTRUE_EXTERNAL_GOOGLE_SKIP_NONCE_CHECK / EMAIL_OPTIONAL | false / false |

The corresponding TOML proposal is generated against the original configuration
hash; actual config.toml is unchanged. JWT/database/email/MFA settings, image, aliases
and every unrelated field remain exact. This custom Docker helper uses the
[documented Auth environment model](https://supabase.com/docs/guides/self-hosting/self-hosted-oauth).

**Rollback and secrecy:** the actual original Auth inspect/create definition and
original/proposed TOML were encrypted and privately read back at
`.local-auth-only/93e39602/retained-original/payload.dpapi`.
DPAPI CurrentUser binds profile/user/path; ACLs allow only the current user and SYSTEM,
with inheritance disabled and overwrite refusal. This is a configuration capture.
Profile-loss recovery is not certified; private process memory contains plaintext.
The existing credential module handled dummy credentials privately. Real Google
storage was checked by metadata only, never opened/decrypted/changed. No secret went
to arguments, Vite, plaintext files or public evidence.

**Rehearsal:** the actual cached Auth 2.197.0 image ran against a separate PostgreSQL
fixture on an internal network, without ports or retained mounts. Health/settings
returned 200: Google false initially, true after replacement, false after rollback.
The clean binary's 75 migration receipts, zero users and witness rows remained exact.
Tests covered exit-42 startup failure, rollback, repeat rejection, exact configuration,
JWT/database preservation, identity/resource guards and DPAPI tamper/ACL/canary checks.
Earlier fixture/bootstrap and endpoint-state failures remain recorded. An intermediate
harness checked an empty migration table; the final run requires the correct search
path and all 75 receipts. No earlier result was overwritten.

**Preservation:** retained Auth/database/API health passed before/after; Google stayed
false. All retained definitions and eleven non-Vector lifecycles matched. Vector's
existing automatic restart loop continues. All application/Auth/history/security data,
six migrations/routes and 93 backup files were preserved; 291 frozen inputs matched.
The unchanged classifier recorded only scoped subscriptions 0?2 and allocation 438?440
within the 70-table comparison. Historical restore PASS/live pruning FAIL are unchanged.
All 37 task containers are inactive; eight internal test networks remain. No volume
was created/deleted. No Analytics investigation or frontend change/build ran.
Only .gitignore changed among existing files, adding /.local-auth-only/.
Syntax/whitespace checks passed.

**Readiness and next approval:**

1. **Helper ready:** preparation and shared replacement/rollback passed. Retained
   execution remains unconditionally locked, with no bypass switch.
2. **Affected service:** only `supabase_auth_school-queue-local` would be recreated.
   Keep its stopped/detached original for rollback; account for its project labels.
3. **Data protection:** existing data/backups were preserved. Future safeguards require
   fresh source/capture checks, unchanged keys/settings/migration state, and Auth health/
   Google=true through Kong plus anonymous API success. Brief Auth downtime and gateway
   DNS convergence remain risks. Stop on failure; no automatic dependency restart or
   database restore.
4. **Approval/commands:** separately approve the retained lock-release/orchestration,
   private production DPAPI read, exact config change and one Auth-only recreation.
   The release must connect the public interface to the shared executor and bind a
   fresh source/target/code/capture plan. Safe preview:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-AuthOnlyGoogle.ps1 -Preview
   ```

   Reserved interface, **currently refuses with AGO_RETAINED_ACTIVATION_LOCKED**:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-AuthOnlyGoogle.ps1 -Activate -RunId <fresh-reviewed-id> -ApprovedPlanSha256 <approved-plan-sha256>
   ```

   No current command enables Google; a dummy hash cannot authorize retained use.
5. **Remaining real tests:** consent/credential validity, school/personal account
   policies, identity linking/STUDENT provisioning, cancellation, login/logout, PKCE
   exchange/callback scrubbing, getUser/current my_context and gateway behavior.
   Separately authorize real identity/session/account writes. ADMIN/CASHIER authority
   remains database-controlled; domain/metadata/self-selected roles grant no access.
   Existing staff/MFA requirements remain intact.

Evidence: [final readiness](tests/results/auth_only_readiness_93e39602.json), SHA-256
`c3742b5a6522c2448575b47a16efde4a8cede180bb5d0c94604c3f34462f9146`;
[disposable checks](tests/results/auth_only_disposable_93e39602.json), SHA-256
`07402d9c38403a0c086abb150d914c4aa46c476b96f3ed6f622dd8074418d331`.

**Stopped after rehearsal and report. No retained activation, real login, role change,
deployment, backup/volume deletion, commit or push occurred.**
