# Step 22.8: controlled Google activation readiness — stopped

October 17, 2026. **FAIL — stopped at the full retained-service health prerequisite.**
The existing credential preview and source/recovery checks passed. Preparation then
found **supabase_vector_school-queue-local unhealthy and restarting**. Google remains
disabled. No retained stop/start, configuration change or real Google login ran.

**The activation workflow is not ready for approval.** Its draft activation and
rollback entry points are locked, without a bypass switch. Disposable-process
rehearsals and the installed-CLI configuration probe did not start. The requested
Phase 5 approval gate has not been reached.

## Exact blocker and stop

Run **e05966ff** began October 17 at **22:27:22 UTC+08:00** and stopped during
`prepare-protected-proposal`, before writing a rollback copy or proposal manifest.
The checker returned **LGA_SERVICE_HEALTH**. Read-only diagnosis reproduced it.

At **22:35:04 UTC+08:00**, the sanitized container inspection recorded:

| Property | Observed value |
| --- | --- |
| Container | supabase_vector_school-queue-local |
| Image | public.ecr.aws/supabase/vector:0.58.0-alpine |
| Image ID | sha256:5dcf67db0ee378caa87f3395cb9484ebe3e97bb0334d119f2ac33116e00c5773 |
| Running / restarting | true / true |
| Health | unhealthy |
| Docker restart count | 1530 |

The other eleven project containers were running; those with configured health
checks reported healthy in the separate status read. No Vector logs or environment
values were printed. Its underlying restart-loop cause was not investigated or
repaired. The observed restart activity was not requested by this task. It would
be inaccurate to describe every retained service as having an unchanged start time.

The four independently fenced database, gateway, Auth and Realtime containers
retained their IDs, start times and restart counts. The Docker container/volume/
network inventory digest also matched. No Docker resource was created or removed.

The request says to stop if a prerequisite fails and requires successful rehearsal
before activation approval. Accordingly, no unhealthy-service exclusion, ignored
health check, automatic retry, configuration rollback cycle or service repair was
attempted. Only read-only diagnosis and preservation checks followed the failure.

## Preconditions that passed

Initial evidence: [5933aa1f](tests/results/google_activation_preflight_5933aa1f.json).
The existing public preview returned PASS with `SyntheticCredentials=false`,
`CredentialValid=true` and `CredentialChildExecuted=false`. It decrypted the existing
DPAPI store privately and built/discarded its preview child environment. No credential
was requested, entered, printed, exported or changed.

| Item | Verified value |
| --- | --- |
| Project / directory | school-queue-local / C:\Users\Hp\school-queue-management-system |
| PostgreSQL / API | 127.0.0.1:54322/postgres / http://127.0.0.1:54321 |
| Server / source cluster | PostgreSQL 17.11 / 7696959712798593061 |
| Database container / volume | supabase_db_school-queue-local |
| Gateway / network | supabase_kong_school-queue-local / supabase_network_school-queue-local |
| CLI | 2.121.0 |
| Migrations | Exactly 001–006; all six file hashes unchanged |
| Fixed routing | 1:TP, 2:SOA, 3:PNEP, 4:REF, 5:ADJ |
| Queue work | Zero active tickets; seven closed days; no open day |
| Security | All 15 application tables retain RLS; browser roles lack queue_private USAGE |
| Application publication | Only queue_display.counter_state and service_state |
| Provider | Google disabled |

The saved Google client origin/callback, External/Testing audience and test users are
confirmed by the user's new request. This task did not independently open Google
Console or contact Google to validate the stored credential against that client.
Format/decryption validation is not proof that Google will accept a credential.

The first preview invocation encountered Windows script-execution policy before its
script ran. The approved retry used `powershell.exe -ExecutionPolicy Bypass` only for
that process. No persistent execution-policy setting was changed.

## Configuration proposal — not applied

The original config.toml remains byte-for-byte unchanged, SHA-256:

`a929af299d0c49ec0a0632cf1a84a8227bdbdf250e1f23a2d3be53e3a2b003a8`

The draft generator preserves its existing project, API, database and disabled-seed
sections and proposes appending exactly:

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

The TOML comparison tests reject duplicate sections, unrelated settings, raw secrets,
alternate environment references, hosted/wildcard/wrong callbacks and security
relaxations. The installed CLI version/help were inspected. Its read-only `status`
probe against isolated original/proposed workdirs was prepared but **not executed**,
because preparation stopped before those files existed. Installed-schema and complete
resolved-configuration acceptance therefore remain unfinished.

The pinned Auth builder maps these provider fields and Site URL/allowlist to the
Auth environment. That source review does not substitute for the unexecuted CLI
probe or a restart verification.
[CLI 2.121.0 Auth builder](https://github.com/supabase/cli/blob/v2.121.0/apps/cli/src/commands/start/services/gotrue.service.ts).

## Draft workflow and safeguards

Default invocation remains preview-only. `-Prepare` is intended to create a new
protected, ignored proposal directory. The draft activation interface additionally
requires `-Activate`, a run identity, the exact approved plan SHA-256 and
`-ConfirmRetainedLocalServiceRestart`. Rollback has its own explicit switch and
confirmation. **Both execution paths currently refuse with
LGA_REHEARSAL_NOT_CERTIFIED.** Python mutation entry points are also locked.

The draft design includes:

- Same-user/SYSTEM NTFS protection, reparse-point rejection, ignored/untracked
  storage and refusal to overwrite proposal/rollback artifacts.
- A byte-for-byte original-config copy, exact proposed config, source preservation
  baseline, service environment hashes, image/binding/mount inventory and volume
  creation metadata, all bound to a reviewed plan and tested code hashes.
- Immediate source/recovery/configuration/credential-file checks before arming;
  refusal to repeat an activation attempt or accept changed artifacts.
- Exact CLI argument allowlists and credential injection only into its child
  environment. No VITE variables, command-line secrets or persistent Windows
  credential environment settings.
- Stop-on-failure semantics; configuration-only recovery after a failed change,
  without an automatic service retry or database restore. Partial effective service
  state would still require review and explicit rollback approval.
- Strict postchecks for image IDs, active ports, mounts, all service environment
  entries except the reviewed Auth delta, database cluster/data/security, provider
  availability, credential equality in memory and known-secret frontend scans.

These are draft implementation properties, **not successful end-to-end activation
or rollback evidence**. The safety lock was added after the required stop so the
unrehearsed workflow cannot be used as an approved activation mechanism.

Only `.local-google-activation/b12bfc2e` was created, under a protected ignored root.
That run directory is **empty**. It contains no usable rollback copy, proposal,
approval hash or readiness certificate. No disposable Docker stack, test volume or
synthetic credential store was created by the stopped rehearsal.

## Tests completed and stopped

| Check/group | Passed | Failed | Skipped/not started |
| --- | ---: | ---: | --- |
| Existing preflight methods, with explicit-confirmation assertion updated | 12 | 0 | 0 |
| New offline activation/configuration methods | 24 | 0 | 0 |
| Initial real-store preview and source/recovery gate | PASS | 0 | 0 |
| Full retained-service health gate | 0 | 1 | 0 |
| Final read-only source/artifact preservation | PASS | 0 | 0 |
| Disposable PowerShell child/partial-failure/rollback rehearsal | 0 | 0 | Entire suite not started |
| Installed-CLI candidate-schema/key-preservation probe | 0 | 0 | Not started |
| Actual disposable Docker stop/start rehearsal | 0 | 0 | Not performed |
| Retained activation, postactivation browsers/build/secret scan | 0 | 0 | Not authorized or run |
| Real Google consent/login/linking/provisioning | 0 | 0 | Outside this preparation task |

There are **36 passing offline methods**, not a completed PASS for Step 22.8.
Repeated executions are not added together. The earlier Step 22.7 56 checks and
Step 22.6 101 recovery methods were not rerun or counted here.

Offline coverage includes exact TOML changes, duplicate sections, callbacks, raw/
alternate secret references, security flags, unrelated environment changes, service
addition/removal, image/mount/network/port changes, recreated/missing volumes,
approval/run identity rejection, backup failure before arming, repeat refusal,
atomic disposable configuration writes, exact rollback and concurrent changes.
Those cases use fixtures and temporary configuration files; they do not mutate the
retained target or prove that a real CLI restart preserves its effective settings.

PowerShell parsing, Python syntax and whitespace checks passed. The final execution
lock is a stop safeguard, not a newly completed activation rehearsal.

## Source, credentials and recovery preservation

Final diagnosis: [ea11174b](tests/results/google_activation_stopped_diagnosis_ea11174b.json).
All business/Auth/history fingerprints and captured security metadata matched the
verified baseline under the existing strict Realtime classifier. Inventory remained
70 tables; no new partition appeared. Compared with the recovery snapshot, the
recorded subscription difference remains two rows to zero and allocation 298 to 320.
No other row/object/role/privilege difference was accepted. No historical baseline
was rewritten.

State remains 39 accounts, 39 Auth users, 26 Auth identities, 20 terminal tickets,
57 events, 69 replay receipts, 32 audits, seven closed days, four staff assignments
and zero active tickets. Fixed routing, staffing, RLS, publication and six migrations
remain unchanged. Current Auth URLs remain the old port-3000 values; Google is disabled.

The existing credential ciphertext retained its exact SHA-256 privately; its value
was not printed. All **135 historical report/evidence/configuration/product inputs**
captured at initial inspection retained their hashes.

All **50 existing backup files** retained their size/hash tree digest:

`9ae20f6cf67e0c894217892abf1fe48e56ad6e6858215a8da23614455d77ac81`

The verified recovery unit remains the complete Step 22.6 bundle:

`.local-backups/pre_google_20261017T063856Z_6e3beebe`

Bundle SHA-256:
`50164d4afb5083a83044f5ee3df3d13b1b2002ba29ee03143e460c181b915a52`.

Its source-derived supplements, matching platform and protected access were checked
again, together with both historical bundles. No dump/restore ran and no stopped
recovery volume was started, replaced or deleted. The bundle remains database-level
recovery evidence with its existing service/secret/infrastructure exclusions.

## Proposed restart, rollback and acceptance — unavailable until review completes

The intended future scope is all twelve currently labeled project containers:
db, kong, auth, realtime, rest, storage, edge_runtime, inbucket, studio, pg_meta,
analytics and vector, each with the `_school-queue-local` suffix and `supabase_`
prefix. This is a full local-stack recreation, not an Auth-only restart.

The fixed proposed CLI commands remain:

```powershell
node node_modules/supabase/dist/supabase.js stop --project-id school-queue-local --workdir C:\Users\Hp\school-queue-management-system
node node_modules/supabase/dist/supabase.js start --workdir C:\Users\Hp\school-queue-management-system --network-id supabase_network_school-queue-local
```

No `--no-backup`, `--all`, ignored health checks, reset/push/link or volume removal is
permitted. The pinned stop implementation preserves volumes without `--no-backup`
but removes matching containers and may prune their network; that explains the
need for volume/cluster and recreated-binding checks.
[CLI 2.121.0 stop implementation](https://github.com/supabase/cli/blob/v2.121.0/apps/cli/src/commands/stop/stop.handler.ts).

Downtime would span CLI stop through healthy startup and verification, provisionally
several minutes. It has **not been measured or bounded by a successful rehearsal**;
the present Vector failure could prevent successful startup. Existing-volume startup
also performs platform convergence, so it must not be assumed read-only.
[Pinned database startup](https://github.com/supabase/cli/blob/v2.121.0/apps/cli/src/command-internal/db-bootstrap/start-database.ts).

After a later successful preparation/rehearsal, the proposed wrapper invocation is:

```powershell
# NOT READY: no successful run identity/approval hash exists in this task.
powershell.exe -NoProfile -File .\scripts\Start-LocalGoogleAuth.ps1 -Activate -RunId <reviewed-run-id> -ApprovedPlanSha256 <reviewed-plan-sha256> -ConfirmRetainedLocalServiceRestart
```

The draft rollback would use the exact protected original configuration, separately
confirmed preserving stop/start, then require original environment/keys, disabled
Google, unchanged volume/cluster and durable data. It must never restore an old dump
over retained data or erase users/history. No verified rollback copy exists from
this stopped preparation, so this is a design requiring rehearsal, not an executable
recovery instruction for the current environment.

Planned postactivation acceptance includes exact effective Auth settings and
in-memory credential checks; six migrations/routing/data/security and artifact
checks; mocked OAuth and anonymous public-board/browser reconnect acceptance;
private-schema REST denials; frontend/security tests; public-only production build
and known-private/Google-secret scans. Real Google sign-in remains a subsequent,
separately approved user-controlled task. No administrator/cashier authority follows
from provider activation.

## Files and decision

Created:

- scripts/LocalGoogleActivation.ps1 — draft preparation/orchestration, protected
  proposal handling and locked activation/rollback functions.
- supabase/tests/google_activation_workflow.py — configuration/preservation support,
  draft future operations and a disabled mutation gate.
- supabase/tests/test_google_activation_workflow.py — 24 offline methods.
- tests/security/activation_child_probe.ps1 and Test-LocalGoogleActivation.ps1 —
  disposable-process rehearsal code; not executed in this task.
- tests/security/inspect_google_activation.py, run_google_activation_rehearsal.py
  and diagnose_google_activation.py — initial gate, stopped run and read-only diagnosis.
- New sanitized evidence, the empty protected preparation directory and this report.

Modified:

- scripts/Start-LocalGoogleAuth.ps1 — preview default plus explicit preparation and
  locked confirmation-gated interfaces.
- scripts/LocalGoogleCredential.psm1 — load the new workflow; credential format,
  encryption, intake and existing preview behavior retained.
- supabase/tests/test_google_credential_preflight.py — preserve prior cases and
  update its entry-point assertion for the new explicit confirmation requirement.
- .gitignore — add /.local-google-activation/.

No config.toml, frontend/product source, migration SQL, provider/Auth record, RLS,
grant, real credential store, dependency, historical report/evidence or backup changed.
No hosted Supabase, Google login, service repair/restart command, deployment, record/
volume deletion, administrator promotion, cashier approval, issuance, Git commit or
push occurred.

Evidence:

- [Initial preflight](tests/results/google_activation_preflight_5933aa1f.json), SHA-256
  `a8a6ac1435d3b0f13a958a306104960992e72cfb35b82a30946470d425d37a8b`.
- [Stopped preparation](tests/results/google_activation_readiness_e05966ff.json),
  SHA-256 `6376e66b6905088697de5906740b10a9f2946b618d7b8bf0f86002eda260e07c`.
- [Final read-only diagnosis/preservation](tests/results/google_activation_stopped_diagnosis_ea11174b.json),
  SHA-256 `a6b6993404365afa78a548b2b04bd81314d54e04845820699c4fb6228a2774f4`.

**Not ready for activation approval. Stopped at the required health failure.**
The next instruction should address the Vector health blocker before resuming
proposal generation and synthetic/disposable rehearsal. This task provides no
permission to repair that service, restart the stack or activate Google.
