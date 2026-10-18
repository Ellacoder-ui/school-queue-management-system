# Step 22.7: protected local Google credential helpers

October 17, 2026. **PASS for the completed synthetic-only helper validation.**
Final run **3c29be9e**, **21:44:24–21:45:39 UTC+08:00**: **56 checks passed, zero
failed, one skipped**. Real Google credentials were not requested, retrieved,
imported or stored. The production credential directory is protected and empty.
Google remains disabled; no retained service restart or configuration edit occurred.

## Implemented files

Paths in this table are relative to the project root.

| File | Change |
| --- | --- |
| scripts/Set-LocalGoogleCredential.ps1 | Prepare protected storage by default; explicit -Store opens local masked prompts |
| scripts/Start-LocalGoogleAuth.ps1 | Preview-only checks; no activation parameter or implementation |
| scripts/LocalGoogleCredential.psm1 | Shared DPAPI, ACL/path validation, strict process specifications and sanitized diagnostics |
| supabase/tests/google_credential_preflight.py | Read-only source/recovery bridge bound to the verified Step 22.6 evidence |
| supabase/tests/test_google_credential_preflight.py | Twelve offline preflight/security methods |
| tests/security/Test-LocalGoogleCredential.ps1 | Isolated Windows crypto/ACL/process/preview tests using generated dummy values |
| tests/security/credential_child_probe.ps1 | Dummy-only child emits presence/scope booleans, never credential values |
| tests/security/run_google_credential_helpers.py | Separate evidence identities, synthetic orchestration and preservation fences |
| .gitignore | Add /.local-secrets/ and /.local-credential-tests/ |
| supabase/tests/results/local_google_credential_helpers_*.json | Completed and stopped sanitized evidence |
| supabase/LOCAL_GOOGLE_CREDENTIAL_HELPERS_REPORT.md | This report |

Created .local-secrets/ with restricted NTFS permissions. No
.local-secrets/google-local.dpapi exists. Ignored temporary test directories contain
only generated dummy ciphertext or empty fixture directories; no real provider
credential was accessed. All original reports, recovery runners, archives, migrations,
frontend files, dependencies, real environment files and config.toml were retained.

## Storage and access controls

The helpers target **Windows PowerShell 5.1 Desktop**, using its .NET Framework ACL
APIs. Use powershell.exe, not pwsh. Unsupported editions/platforms fail closed.
No PowerShell module or dependency was installed.

Set-LocalGoogleCredential.ps1 without -Store, or with -InitializeOnly, prepares/checks
the directory and returns without credential prompts. Only an explicit -Store opens
two Read-Host -AsSecureString prompts, masking both Client ID and Client Secret.
There are no plaintext credential command-line parameters.

The production path is fixed inside this project. Separate synthetic paths require
an eight-character hexadecimal test identity. Path checks reject outside locations,
invalid test identities and encountered reparse points. Git checks require ignored,
untracked storage. Existing unsafe permissions are rejected rather than repaired by
the production helper. Unexpected files/directories are rejected on initialization
and credential reads.

Directory and credential-file ACLs have inheritance disabled. Exactly the current
Windows user and SYSTEM receive FullControl, and ownership must match the current
user. Additional principals, inherited rules, reduced/unexpected rights and owner
differences fail. Both the directory and existing credential file are checked.
New ciphertext is created with FileMode.CreateNew, so an existing artifact cannot
be overwritten even if it appears after the preliminary existence check.
No overwrite/force or automatic credential-rotation option was added.

Credentials are serialized only in memory and encrypted with
ProtectedData.Protect using **DPAPI CurrentUser**. Purpose entropy binds the project
format, user SID and exact file path. The encrypted payload additionally binds its
version, project, owner, path and synthetic/production designation. Read-back decrypts
with the same scope/entropy and checks exact fields and credential structure.
Tampered ciphertext, wrong entropy, wrong owner binding and relocated/mismatched
payloads are rejected. There is no machine-wide, static-key or plaintext fallback.
[Microsoft DPAPI](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata.protect?view=netframework-4.8.1),
[ACL inheritance control](https://learn.microsoft.com/en-us/dotnet/api/system.security.accesscontrol.objectsecurity.setaccessruleprotection?view=netframework-4.8.1).

Temporary BSTR allocations are zeroed/freed and plaintext byte arrays cleared in
finally paths. Managed plaintext strings necessarily exist during validation and
JSON/process preparation; nulling references cannot guarantee immediate erasure.
DPAPI does not protect against a compromised current-user session or privileged
memory access. Moving to another Windows profile/machine needs a separate protected
credential-recovery/rotation procedure, not an insecure decryption fallback.

Format checks require one Google Web client ID, a nonempty 24–4096-character printable
ASCII secret, and no unresolved env(...) references. They cannot prove the credentials
belong to the intended Google Console client or that Google will accept them.
Strict end-of-input anchors reject trailing newlines in credentials and process
arguments; control characters cannot pass argument validation.

## Preview-only Auth preflight

Start-LocalGoogleAuth.ps1 defaults to preview, including when -Preview is omitted.
It has **no -Activate, restart, configuration-write or real-login implementation**.
An activation path was not added behind a flag. A later activation task must implement
and review that workflow separately.

The read-only Python bridge pins the completed Step 22.6 evidence checksum:

`e1cdfd117369f4469b2b74a1f66ad520d664b848e8452b1009e782ec06d78784`

It verifies the fresh 70-table bundle's artifact hashes, protected ACLs, generated
supplements, source binding and stopped restore destination. It also checks both
historical verified bundles and their recorded artifact inventory. Live checks require:

- Exact project/workdir, 127.0.0.1:54322/postgres, API 127.0.0.1:54321, server/cluster,
  retained volume/network and service images.
- Six unchanged migrations, fixed 1:TP, 2:SOA, 3:PNEP, 4:REF, 5:ADJ routing, zero active
  work, and unchanged business/Auth/history/security metadata.
- The original preactivation config.toml hash and effective Auth settings, with Google
  disabled. Unexpected origins, hosted targets or changed configuration fail.
- Strict reviewed Realtime lifecycle classification, without excluding the schema.

The helper independently checks CLI **2.121.0** and required start/stop help options.
The executable read-only command allowlist permits only the fixed local Python check,
CLI --version, start --help, stop --help, and Git ignore/tracking checks. Actual start,
stop, db and link commands cannot pass that executor. No raw subprocess diagnostics
are printed; public errors are fixed/sanitized messages.

After preflight, the credential is decrypted in the current helper process. A private
constructor validates the exact proposed project/workdir/network command and builds
ProcessStartInfo with UseShellExecute=false. It prepares only these child variables:

```text
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET
```

Inherited PG*, SUPABASE_*, QUEUE_* and VITE_* variables and interpreter hook overrides
are removed before the two credential entries are added. No credential goes into
arguments. The preview **does not execute this credential-bearing process**; it clears
the entries in finally and emits only booleans/version/recovery identifiers.
The only credential-bearing child actually executed in testing was the isolated
dummy probe, never Supabase CLI or a frontend process.
[Microsoft child environment](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.processstartinfo.environmentvariables?view=netframework-4.8.1).

No production code calls Windows User/Machine environment setters or exports provider
credentials globally. Tests confirmed parent process markers remained unchanged while
the dummy child received exactly two SUPABASE variables and no VITE*/PG* variables.
No configuration or provider secret was supplied to Vite or a build.

## Completed tests and exclusions

| Group | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Offline Python target/config/recovery/security methods | 12 | 0 | 0 |
| Actual Windows synthetic DPAPI/ACL/process/preview checks | 44 | 0 | 0 |
| Actual separate-Windows-account access/decryption test | 0 | 0 | 1 |
| Read-only source/recovery and Docker preservation fences | PASS | 0 | 0 |

Repeated executions are not added together. Passing coverage includes encryption and
same-user read-back; owner-binding/tamper/entropy rejection; unsafe file/directory ACLs
and inheritance; missing/invalid credentials; atomic overwrite refusal; unexpected
artifacts; ignored/untracked storage; diagnostic/console redaction; unresolved env
references; exact command/network restrictions; and full preview using a dummy store.

Offline negative cases reject wrong project, cluster, volume/network, database/API
endpoint, hosted/nonapproved origins, configuration, recovery evidence, missing
artifacts, changed Auth settings, enabled provider and business/security changes.
These cases use recorded fixtures/mocks and never connect to a forbidden target.

The actual second-user test was skipped because no second Windows account/profile
was provisioned or impersonated. The passing owner-binding and ACL tests do not claim
to be that physical cross-user test. Real masked credential entry, actual provider
validity/login, activation, restart and production acceptance were outside scope.

Eight existing frontend artifacts were scanned for both runtime-generated dummy
canaries; neither appeared. Ciphertext and emitted test/probe JSON also passed canary
checks. This is specific synthetic-leak coverage, not a universal secret scan or a
scan against an unavailable real Google secret. No frontend rebuild or application
regression suite was needed/run; prior frontend/recovery counts are not new results.

### Earlier test-harness failures retained

- f4026a44 and f9ca2812 stopped before a test passed; sanitized diagnosis recorded an
  unavailable command. Replacing the test's optional security-cmdlet conversion with
  native .NET SecureString construction removed that early failure.
- 974b649b progressed through negative ACL cases, then correctly failed because a
  synthetic fixture's previous ACL had not been restored. Reapplying an unmodified
  GetAccessControl object did not mark its DACL for replacement. Fixture restoration
  now uses a new exact security descriptor and immediately verifies it. Only that
  owned dummy fixture was resecured; its encrypted data was retained.
- An ACL diagnostic initially ran in a shell lacking the .NET Framework API and
  changed nothing. The permitted Windows PowerShell 5.1 invocation succeeded; the
  helpers now explicitly reject incompatible editions.
- Intermediate 3baaffa9 passed 51 checks. Final review added initialization-time
  existing-file ACL checks and read-time inventory checks, with two additional cases.
  Intermediate ff256f84 passed all 53 checks. A further review tightened regex
  end-of-input anchors and added three trailing-newline/control-character cases.
  Final 3c29be9e passed all 56 checks. No previous FAIL/PASS evidence was overwritten.

The initial parser invocation also selected Python files accidentally. The corrected
PowerShell-only selection parsed successfully. None of these harness issues caused
an Auth/business mutation or weakened the helper's permission requirements.

## Retained source and recovery preservation

Final read-only checks verified school-queue-local, PostgreSQL 17.11 at
127.0.0.1:54322/postgres, API http://127.0.0.1:54321 and cluster
7696959712798593061. Six migrations/file hashes and fixed routing remain unchanged.

All business/Auth/history rows and captured security metadata matched the fresh
recovery source under the strict reviewed Realtime rules. The retained state remains
39 accounts, 20 terminal tickets, 57 events, 69 replay records, 32 audits, seven closed
days, four staff assignments and zero active tickets. All 15 application tables retain
RLS; browser roles lack queue_private USAGE. The application publication still contains
only the two sanitized display tables. No account/provider/MFA/role/permission changed.

Inventory remains 70 tables, with no added partition during the final run. Compared
with the recovery snapshot, subscription rows changed from two to zero and the
allocation sequence advanced from 298 to 320; live scope checks passed. At both the
final run's beginning and end there were zero subscription rows and allocation 320.
All other data, objects, privileges and sequences matched. No specific background
allocation/cleanup cause is claimed.

The original five-version bundle, historical 69-table six-version bundle and fresh
70-table bundle all passed hash/association/ACL checks. **All 50 existing backup files**
retained their inventory/hash digest:

`9ae20f6cf67e0c894217892abf1fe48e56ad6e6858215a8da23614455d77ac81`

No backup was restored, overwritten or deleted. Retained container IDs, start times
and restart counts matched before/after; the Docker container/volume/network inventory
digest was unchanged. No Docker resource was created or removed. All 38 recorded
tested application/configuration/helper input hashes stayed unchanged during the
completed run. Config.toml SHA-256 remains:

`a929af299d0c49ec0a0632cf1a84a8227bdbdf250e1f23a2d3be53e3a2b003a8`

## Later manual use — requires separate approval

The helper implementation is ready for separate review/approval of **real local
credential entry and preview** within its tested Windows PowerShell 5.1 scope.
This result does not authorize or implement provider activation.

1. Verify the actual saved Google Console client type, origin and redirect URI,
   External/Testing audience and consenting test users. Their expected values are
   documented in the activation plan; saved fields remain unverified here.
2. After explicit approval, open **Windows PowerShell 5.1 as the same Windows user**,
   change to C:\Users\Hp\school-queue-management-system and run:

   ```powershell
   powershell.exe -NoProfile -File .\scripts\Set-LocalGoogleCredential.ps1 -Store
   ```

   Enter credentials only at the two local masked prompts. Do not paste them into
   chat, command arguments, environment files, reports or screenshots. Avoid clipboard
   history/synchronization; clear copied values after use. Keep transcripts/debug tracing
   disabled while handling credentials. No real intake was performed in this task.
3. Check the current source and recovery state with the preview:

   ```powershell
   powershell.exe -NoProfile -NonInteractive -File .\scripts\Start-LocalGoogleAuth.ps1 -Preview
   ```

   This checks the current disabled-provider configuration and builds/discards the
   child environment. It does not edit config.toml, enable Google or restart anything.
   It will reject later configuration/provider changes until a separately reviewed
   workflow explicitly supports them.
4. If the credential file already exists, stop. Do not delete or overwrite it to
   bypass the guard; request a reviewed rotation/recovery procedure. If preflight
   fails, retain artifacts and report the sanitized error rather than relaxing checks.
5. Obtain separate approval and implementation review for the actual configuration,
   preserving restart and real-provider acceptance. Current callbacks remain the
   proposed Auth 54321 and Vue 5173 addresses; helper validation is not proof that
   Google registered or accepted them.

The synthetic runner can be invoked with
`python -B tests/security/run_google_credential_helpers.py`; it creates a new test
identity and refuses to run if a production credential artifact is present. Do not
use it after real intake without a separately reviewed test workflow. No helper reads
the real production artifact as part of the synthetic tests.

Completed evidence:
[local_google_credential_helpers_3c29be9e.json](tests/results/local_google_credential_helpers_3c29be9e.json).
Evidence SHA-256:
`2de7bda04440492e85d0c55ba6e79001411b34772e6497f1ef0d213cf9fdebd5`.

No real Google credentials, hosted Supabase, provider activation, retained restart,
SQL migration/reset/push/link, administrator promotion, cashier approval, issuance,
deployment, backup/volume deletion, Git commit or push occurred.

**Stopped after helper implementation, synthetic validation and this report. Actual
credential entry, provider activation and service restart await separate approval.**
