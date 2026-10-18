# Step 22.8C: persistent Vector reconciliation and protected rollback

October 18, 2026. **PASS for the completed preparation and disposable rehearsal.**
The selected persistence mechanism is a guarded, approval-bound Vector reconciliation
step after service creation. It successfully handled an initial synthetic replacement,
a simulated later CLI recreation, and a separately approved synthetic rollback.
**Retained execution is still locked and is not certified by these results.**

Final run **acf64bc3**, **00:33:12–00:34:54 UTC+08:00**. No retained container was
stopped, started, renamed, disconnected, recreated or deleted. Google remains disabled;
both existing Google activation locks remain unchanged. No real Google credential
was opened, hashed, decrypted, imported or modified.

## Preconditions and preserved target

[Initial read-only preflight](tests/results/vector_persistent_preflight_3f840dce.json)
and the final rehearsal fences verified:

| Item | Verified value |
| --- | --- |
| Project/workdir | school-queue-local / C:\Users\Hp\school-queue-management-system |
| Database/API | 127.0.0.1:54322/postgres / http://127.0.0.1:54321 |
| PostgreSQL/cluster | 17.11 / 7696959712798593061 |
| Database container/volume | supabase_db_school-queue-local |
| Gateway/network | supabase_kong_school-queue-local / supabase_network_school-queue-local |
| Docker context endpoint | npipe:////./pipe/dockerDesktopLinuxEngine |
| CLI | Installed project package 2.121.0; unchanged |
| Migrations/routing | Exactly 001–006 with original hashes; 1:TP, 2:SOA, 3:PNEP, 4:REF, 5:ADJ |
| Work | Zero active tickets, seven closed days, no open queue day |
| Retained Vector ID | b6d521af4f244e0ab8ede06130d31bf067e9483ed1dd920544759b607cc9bc59 |
| Vector image ID | sha256:5dcf67db0ee378caa87f3395cb9484ebe3e97bb0334d119f2ac33116e00c5773 |
| Original YAML SHA-256 | ce74949a121530bdc91c43ec327b6e0bf746d2acf76b1548385ece2da3a2e1e8 |

All eleven other retained service identities/start times/restart counts matched the
preceding Step 22.8B capture and remained unchanged. The full retained Config,
HostConfig, mounts, image and network settings were compared privately, not printed.
Vector retains its original TCP transport and remains unhealthy. Its existing
automatic restart count advanced **1647 to 1649** during the final run.

## Persistence approaches evaluated

| Approach | Assessment |
| --- | --- |
| Upstream-supported corrected recipe | The official release API reported v2.121.0. Its pinned and then-current main Vector builders had the same hash and still selected host.docker.internal:2375 for npipe. No corrected recipe was established in those reviewed sources. No upgrade or patch was made. |
| Guarded post-creation reconciliation | Recommended local procedure. Keeps the pinned CLI, context, image and other service definitions. Detects each newly created Vector ID, requires a new bound plan, applies the narrow delta, and runs all health/security gates before startup acceptance. Demonstrated with disposable resources. |
| Linux/WSL CLI | Potential Unix-native creation path, but not selected. Workdir/project labels, Windows DPAPI access, environment/key transfer, CLI/image parity and connection to the same Engine/volumes require separate verification. No WSL distribution was started or installed. |
| Authorization-restricted proxy | Could reduce Vector's daemon authority, but requires a separately owned service, authentication, exact object/endpoint filtering, stream controls and availability/recovery procedures. No production proxy was installed or certified. The synthetic fixture is not that proxy. |

The reviewed Windows npipe branch adds no socket mount. Its Unix branch also derives
the destination from the Windows platform default; setting DOCKER_HOST alone is not
a validated workaround. Official sources were read without modifying node_modules.
[Pinned Vector builder](https://github.com/supabase/cli/blob/v2.121.0/apps/cli/src/commands/start/services/vector.service.ts),
[branch tests](https://github.com/supabase/cli/blob/v2.121.0/apps/cli/src/commands/start/services/vector.service.unit.test.ts),
[observed release](https://github.com/supabase/cli/releases/tag/v2.121.0).

Evidence: [upstream review](tests/results/vector_persistent_upstream_review_bdabe71c.json)
and the unchanged [earlier pinned-source review](tests/results/vector_socket_cli_source_review.json).
The reviewed builder SHA-256 remains
`3f0e428af32fb79686951c065352dccaeacb4637c5ad4bc629d93c762529a728`.

### How the proposed startup process persists the repair

Persistence is procedural; the unmodified CLI itself still generates the TCP definition.
A later approved startup workflow must perform these steps in order:

1. Complete its existing target, recovery, source, configuration, key and volume gates.
   A full-stack CLI stop/start remains a separately authorized infrastructure action.
2. After creation, inspect canonical Vector and all project resources. Refuse unknown
   extra project containers, changed images/YAML, unexpected mounts or configuration.
3. If the exact reviewed Unix definition already exists, verify it; do not recreate it.
   Otherwise prepare a new encrypted capture and proposal for that exact new ID and
   current source/code hashes. An old ID's approval cannot authorize this creation.
4. After the required approval, run the Vector-only reconciliation once. Any unexpected
   state or partial failure stops the workflow; there is no retry loop or automatic
   rollback. The rehearsal core refuses a second apply for the same attempt.
5. Require full service health, source preservation and the retained acceptance below.
   The startup operation is incomplete until these pass. No --ignore-health-check flag,
   unhealthy-service exclusion, seed/reset or dependency restart is introduced.

This integration is a reviewed design and disposable demonstration, **not an enabled
hook in Start-LocalGoogleAuth.ps1**. That existing workflow and its inventory checks
were retained. Its activation locks cannot be bypassed with this helper. A real CLI
stack recreation, its platform convergence, service key preservation and this new
hook together still require integration review/rehearsal before retained use.

## Implemented helper boundaries

`scripts/Repair-LocalVector.ps1` defaults to a lock-status preview. It does not read
credentials or claim to perform a live health preflight. Both -Repair and -Rollback
fail immediately with **VPR_RETAINED_EXECUTION_NOT_CERTIFIED**, regardless of supplied
run ID or approval hash. There is no force/unlock/environment bypass.

`scripts/vectorRepairCore.mjs` implements the shared inspect translation, definition
comparison, approval binding, encrypted capture, replacement, journals and rollback.
Its executable Engine adapter accepts only uniquely named **disposable** resources.
The retained Engine adapter/startup integration is deliberately unavailable pending
separate review. This is not a production-ready retained mutation interface.

The disposable adapter uses Docker's local named pipe. Create bodies containing the
runtime-generated dummy logging key travel in an HTTP JSON body over that pipe, not
process arguments or echoed shell commands. Its HTTP transport is private to the
adapter. Mutations recheck registered IDs, exact experiment labels, permitted images,
network and mounts. It has no delete, prune, reset, stack-start or arbitrary exec path.
Containers cannot attach to retained networks or mount retained/real daemon files.

Docker inspect is translated into explicit create fields. Runtime IDs, State, Paths,
generated IPs/endpoint IDs and DNSNames are excluded. Declared aliases are retained.
Unknown Config/HostConfig fields, static IPAM, unsupported endpoint options, anonymous
image volumes and ambiguous original transport/mounts fail rather than disappear.

One Engine default representation is explicit: **OomKillDisable=null becomes false**
when creating the container. The translator pins that effective default; changing it
to true still fails. This is an observed API representation change, not a permission
or security relaxation. Complete original inspect data remains encrypted alongside
the translated create body. All other compared definition fields stay strict.

## Protected rollback storage

New ignored root: **.local-vector-repair/**. Each rehearsal has a separate run
directory and per-attempt encrypted capture. Storage targets Windows PowerShell 5.1
Desktop and Windows DPAPI CurrentUser; no dependency/module installation occurred.

- Directory/file ownership must be the current user. Inheritance is disabled and
  exactly that SID and SYSTEM receive FullControl. Additional principals, inherited
  rules, reparse points, wrong owners, unexpected files and tracked storage fail.
- A reservation is created before sealing. Ciphertext uses FileMode.CreateNew,
  private read-back and flush; existing captures cannot be overwritten. Plan/attempt
  journals also use create-new writes. Interrupted reservations remain unarmed and
  cannot silently become a resumed or replacement attempt.
- DPAPI entropy binds purpose, user SID and exact path. The encrypted envelope also
  binds format, project, synthetic designation, run, slot, owner and path. It includes
  complete synthetic inspect data, explicit original/candidate bodies and the plan.
- The plan hashes the target ID, source receipt, original/candidate definitions and
  repair/storage/public-entry code. Rollback requires its own approval hash bound to
  the plan and replacement ID. A hash is an operator review binding, not a digital
  signature or authorization against an already compromised Windows account.
- Private decrypt output exists only in redirected, captured child-process pipes.
  Terminal input/output is refused by the storage bridge. Operator receipts and
  persisted evidence contain fixed statuses, hashes and counts. Plaintext byte arrays
  are cleared where possible; managed strings/process memory are not guaranteed erased.

[Microsoft DPAPI](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata),
[atomic file creation](https://learn.microsoft.com/en-us/dotnet/api/system.io.filemode).

All captures in this task contain **synthetic data only**. No retained rollback
capture or executable retained approval plan was created. Real Google storage is a
different path and is never opened by these helpers. DPAPI does not protect against
a compromised current-user session; a real socket mount also exposes credentials
through Docker administration. Same-user ciphertext recovery/rotation needs its own
operator procedure.

## Disposable rehearsal and results

Final resources used the prefix **sq-vpr-acf64bc3-**, a unique experiment label, one
new **internal bridge network** and one new socket volume. The fixture used network=none.
No project labels, retained network/volume, real daemon socket or retained configuration
entered the experiment. Cached Vector and postgres-meta images were used without pulls.
All containers had read-only roots, dropped capabilities, no-new-privileges, bounded
resources, no privileged mode and no published ports.

The fixture created a synthetic Unix socket in the new volume. The replacement used
a **read-only bind of that exact fixture socket file to /var/run/docker.sock** and
DOCKER_HOST=unix:///var/run/docker.sock. Thus bind mechanics and the production target
path were exercised without granting Vector daemon access. The original TCP branch
was an idle synthetic stub; it never attempted port 2375. Changing the environment
selected the actual Vector binary. Source, sink and container metadata were fictional.

The rehearsal used the same reconciliation algorithm twice, with independently
captured and approved IDs. The second original represented a later CLI recreation;
**Supabase CLI itself was not run**. Each replacement became healthy around 10.1 seconds,
was observed for approximately 16.2 seconds, delivered four synthetic messages and
had zero restarts. These short observations do not satisfy the future ten-minute gate.

A third replacement was deliberately failed after creation and before start. Separate
rollback approval restored the exact original ID, definition, declared aliases and
prior running state. The failed replacement and originals were retained. The rollback
test restored a synthetic TCP stub, not healthy retained log collection.

| Check/group | Passed | Failed | Skipped/not performed |
| --- | ---: | ---: | --- |
| Final offline policy/translation/binding methods | **11** | **0** | 0 |
| Final Windows crypto/ACL/Engine/reconciliation checks | **24** | **0** | 0 |
| Real source/recovery/container/credential-metadata fences | PASS | 0 | 0 |
| Retained mutation/ten-minute health/Analytics delivery | 0 | 0 | Not authorized |
| Actual full-stack CLI recreation | 0 | 0 | Simulated only |
| Physical second-Windows-account DPAPI test | 0 | 0 | No second account used |
| Physical crash during ciphertext write | 0 | 0 | Interruption tested before sealing |
| Frontend/build/application/Auth/provider suites | 0 | 0 | Outside scope |

The 24 checks cover encrypted capture/read-back and canary preservation; overwrite
refusal; target/source rejection before mutation; original preservation; exact delta,
healthy synthetic logging; stopped/detached original; repeat rejection; later creation;
injected partial failure; separate and repeated rollback; interrupted reservation;
tampered ciphertext; extra file principal rejection and exact dummy ACL restoration;
unrelated witness preservation; both retained locks; and plaintext-canary scans.
These are separate from the eleven offline methods; repeated executions are not added.

All **eight** final-run containers are inactive and retained, along with their socket
volume and internal network. No unknown resource was deleted. Across this task's three
attempts, sixteen containers, three volumes and three networks were created; earlier
Step 22.8B resources remain separate and intact. Cleanup means stopping owned processes
and preserving journals/ciphertext, not erasing failed attempts. The deliberately
tampered ciphertext slot is invalid test evidence, not a usable recovery capture.

### Earlier stopped attempts

- **0065fa39:** five synthetic checks passed; exact round-trip comparison rejected
  OomKillDisable null versus false before replacement startup. Read-only diagnosis
  identified that single path. The explicit default translation and a regression
  were added; true and unrelated differences remain fatal. Its old code-hash receipt
  was empty because of Windows path separators in the receipt filter; actual file
  preservation checks still ran. Final receipts use normalized paths.
- **d4c27caf:** five checks passed, then actual Vector rejected the synthetic
  configuration. The new fixture reused a component name for source and sink.
  Globally distinct connected component names and an offline regression corrected
  that test configuration. No retained YAML was involved or changed.

Both stopped attempts retained their original FAIL evidence, stopped owned processes
and passed final retained preservation. No failure was rewritten as success. An early
syntax-check invocation also had shell quoting expansion before its parser command
ran; direct parser invocation succeeded. Final Python/PowerShell/JavaScript syntax
and whitespace checks passed.

Completed evidence:
[combined rehearsal acf64bc3](tests/results/vector_persistent_rehearsal_acf64bc3.json), SHA-256
`26621541bfa467c49deaf38f71022aa333cb1eb71d97c4a7b6847e74a5954a56`;
[synthetic checks](tests/results/vector_repair_disposable_acf64bc3.json), SHA-256
`098a1f42ab4dc5624c8b27c43ebe9d8b2c0e7b6fbb49b9b8b00b2946ac22de9a`.

## Exact retained operations proposed, not authorized

The proposed effective definition delta remains only:

```text
replace DOCKER_HOST=http://host.docker.internal:2375
with    DOCKER_HOST=unix:///var/run/docker.sock

add Type=bind, Source=/var/run/docker.sock,
    Target=/var/run/docker.sock, ReadOnly=true
```

Preserve image, YAML, command, user, logging credentials/settings, labels, health
definition, restart policy, other environment and declared network settings. The
explicit OOM default representation above and Engine-generated runtime identities
must be documented separately; no other difference is accepted.

Before any retained mutation, a separately reviewed retained adapter must:

1. Repeat project/context/cluster/volume, zero-work, six-migration/routing, source,
   artifact and exact current Vector ID/image/YAML/configuration checks. Inventory
   all eleven unaffected definitions/lifecycles and current logging datastore scope.
2. Capture the original retained inspect/create translation and YAML directly into
   a fresh protected DPAPI bundle, privately verify it and produce a concrete plan
   bound to the current source, target, code and artifact hashes. Synthetic captures
   are not substitutes for this real original specification.
3. Obtain new explicit approval covering daemon authority, Vector-only downtime,
   exact operations, expected logging-store effects and rollback. The disabled
   retained adapter must be independently reviewed before it can be enabled.
4. Stop only the approved original ID, rename it to a unique rollback name and detach
   its network configuration. Preserve it stopped, with labels intact. The Engine
   API accepted this stop/rename/detach sequence with Force=false in the tested
   disposable platform; abort rather than force/retry if the retained platform
   rejects it. Do not assume portability from this result.
5. Create the canonical replacement through private IPC with the reviewed body;
   compare the complete resulting definition before starting only that ID. On any
   mismatch, stop acceptance and retain both objects/journals. No automated cleanup,
   database restore or retry is permitted.
6. Run the future acceptance below. Separately approved rollback stops/renames/detaches
   only the replacement, restores the original name and aliases, verifies the original
   definition and restores its prior running state. It preserves failed objects and
   restores the known failing transport rather than promising healthy logging.

The rollback original keeps its project labels. It cannot be silently omitted from
full-stack inventory or CLI stop selection. The existing Google inventory remains
blocked while such an extra project container exists. Any later removal must have
separate exact-ID approval, no volume-removal flag and a retained encrypted capture;
no delete implementation was added here. An alternative ownership/quarantine policy
also requires review. This accounting must precede a future full-stack restart.

## Daemon authority, logging datastore and future acceptance

Direct socket access remains **privileged daemon access**, even read-only. Collection
filters are not authorization. Capability dropping does not constrain Docker API
commands carried over the socket. A production proxy could narrow access, but GET-only
is insufficient because metadata and logs can disclose secrets. No authorization
plugin/proxy or Docker global setting was installed.
[Docker socket security](https://docs.docker.com/engine/security/protect-access/),
[Docker authorization model](https://docs.docker.com/engine/extend/plugins_authorization).

Read-only [logging datastore inspection](tests/results/vector_logging_datastore_inspection_8f08710f.json)
confirmed Analytics DB_HOSTNAME=supabase_db_school-queue-local, database **_supabase**,
schema **_analytics**, with **39 ordinary/partitioned relations** in that schema.
Its PostgreSQL backend URL also targets _supabase on that same local cluster. DSN
credentials, backend configuration rows and log contents were not emitted or read.

Restoring delivery can append operational log events, advance logging identifiers,
update ingestion/source counters and timestamps, and create backend-managed storage
objects as needed. Those effects belong to the logging datastore; they do not justify
an exception for business/Auth/history/security changes in postgres. Exact backend
table/retention behavior was not exercised here and must be inventoried during
retained preparation/acceptance. No real Analytics sink received synthetic events.

The verified 70-table recovery bundle covers **postgres**, not the separate _supabase
database. Its presence in the same volume does not extend logical-dump coverage.
Logging database contents, service configuration/keys and retention therefore need
their own protected recovery decision before approval. This task did not dump,
restore, certify or alter that datastore. A configuration rollback must not erase
new log history to manufacture old-state equality.

Future retained acceptance must require:

- At least **600 continuous seconds** healthy on the existing 9001 check, sampled at
  most 30 seconds apart, with the same replacement ID/start time/restart count and
  no missed/failed samples treated as success.
- Actual Docker log-source/list/event/log operation without source-finished shutdown,
  API/permission errors or an increasing restart count. Synthetic fixture health
  cannot substitute for this real transport observation.
- Private correlation of ordinary operational delivery into the intended Analytics
  sinks/backend: numeric counts, bounded time windows and hashes only in public
  evidence. Startup health alone is insufficient. No private synthetic log injection
  or business fixture is authorized by this plan.
- All eleven other container IDs/configurations/start times/restart counts and
  existing volume identities preserved; full service health without exclusions.
- Exact application/Auth/history/migration/routing/security preservation with only
  the existing narrow Realtime lifecycle policy. No broad schema/database exception.
- Fresh and historical recovery hashes/ACLs intact, Google disabled, Google credential
  store untouched, and existing activation locks/health gates unchanged.

## Final retained preservation

The final 70-table source comparison passed. No new Realtime partition appeared;
two scoped anonymous public subscriptions remained. Allocation advanced **340 to
342** during the final run, compared with 298 in the recovery snapshot. Its scope
checks passed; no cause is attributed. Every other captured row/object/role/privilege
remained exact under the existing classifier, which was not changed.

State remains 39 accounts/39 Auth users/26 identities, 20 terminal tickets, 57 events,
69 replay receipts, 32 audits, seven closed days, four assignments and zero active
tickets. Fixed routing, counter availability and the stale Counter 5 STUDENT fixture
are intact. All 15 application tables retain RLS; browser roles lack queue_private
USAGE; the application publication still contains only counter_state/service_state.

The fresh bundle remains `.local-backups/pre_google_20261017T063856Z_6e3beebe`, bundle
SHA-256 `50164d4afb5083a83044f5ee3df3d13b1b2002ba29ee03143e460c181b915a52`.
It and both historical bundles passed associations/hashes/protected-access checks.
All **50 backup files** retained inventory digest
`9ae20f6cf67e0c894217892abf1fe48e56ad6e6858215a8da23614455d77ac81`.
No backup/restore or recovery-container startup ran.

All **170 captured existing inputs** retained their hashes during the completed run.
Google storage was inspected only by size/timestamps/attributes, which were unchanged;
this is not a ciphertext hash or credential-validity check. No retained record,
provider, grant, RLS, migration, environment file or container configuration changed.

## Files, usage and decision

Created:

- `scripts/Repair-LocalVector.ps1`: default lock-status preview; locked retained
  repair and rollback interfaces.
- `scripts/VectorRepairStorage.ps1`: redirected private DPAPI/ACL/create-new bridge.
- `scripts/vectorRepairCore.mjs`: translation, exact comparison, plan/code/source
  binding, disposable-only Engine adapter and reconciliation/rollback state machine.
- `tests/security/vectorRepair.unit.mjs`: eleven offline methods.
- `tests/security/rehearse_vector_repair.mjs`: 24 synthetic Windows/Engine checks.
- `tests/security/vectorStorageAclProbe.ps1`: tightly scoped dummy ACL-negative probe.
- `tests/security/run_vector_repair.py`: read-only source/recovery/service fences,
  separate evidence identities and exact Docker inventory accounting.
- New sanitized preflight/rehearsal/upstream/datastore evidence, ignored encrypted
  dummy captures/journals, disposable resources and this plan.

Modified only `.gitignore` to add `/.local-vector-repair/`. Prior reports/evidence,
Google activation/credential helpers, classifiers, backup runners, config.toml,
product source, migrations, dependencies and real environment files were retained.
No daemon/context/global setting changed, image was pulled, infrastructure installed,
hosted Supabase contacted, Google enabled, deployment performed, volume/backup deleted,
Git commit or push made.

Safe lock-status preview:

```powershell
powershell.exe -NoProfile -File .\scripts\Repair-LocalVector.ps1 -Preview
```

Completed disposable command (creates a new identity; not a resume or retained repair):

```powershell
python -B tests/security/run_vector_repair.py --rehearse-disposable
```

**The procedural persistence strategy and protected workflow passed the specified
synthetic rehearsal. They are ready for review. Retained execution is not yet ready
for unconditional approval:** its real adapter/startup integration remains locked,
the actual original capture/approval binding has not been created, real collection
and ten-minute delivery acceptance remain unperformed, and logging-database recovery
coverage must be explicitly decided. There is no certified retained repair command
or activation clearance in this task.

Any retained service repair requires a new explicit approval of the concrete retained
plan and daemon authority after those items are resolved. No such approval is
requested as if the disposable evidence alone cleared the remaining gates.

**Stopped after preparation, disposable rehearsal and this engineering plan.**
