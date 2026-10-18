# Step 22.8B: Vector Unix-socket validation and retained repair readiness

October 17, 2026. **PASS for the completed disposable transport experiment and
preservation checks. Retained repair is NOT cleared for execution.** The Linux
Engine socket exists, and the cached Vector 0.58.0 image successfully consumed
synthetic Docker logs over a separate Unix socket. The pinned Windows Supabase
CLI would recreate the original failing TCP transport. Persistence, the guarded
retained recreation helper and protected rollback rehearsal remain execution gates.

Final run **e6696074**, **23:51:28–23:52:34 UTC+08:00**. No retained container was
stopped, started, restarted, renamed, disconnected or recreated. Google remains
disabled; both activation locks remain intact. No repair approval is implied.

## Verified retained environment

Read-only preflight and final checks independently verified:

| Item | Verified value |
| --- | --- |
| Project/workdir | school-queue-local / C:\Users\Hp\school-queue-management-system |
| Database/API | 127.0.0.1:54322/postgres / http://127.0.0.1:54321 |
| PostgreSQL/cluster | 17.11 / 7696959712798593061 |
| Database container/volume | supabase_db_school-queue-local |
| Gateway/network | supabase_kong_school-queue-local / supabase_network_school-queue-local |
| Migrations | Exactly 001–006; all six validated SQL hashes unchanged |
| Fixed routing | 1:TP, 2:SOA, 3:PNEP, 4:REF, 5:ADJ |
| Work | Zero active tickets, seven closed days, no open day |
| Retained Vector ID | b6d521af4f244e0ab8ede06130d31bf067e9483ed1dd920544759b607cc9bc59 |
| Vector image | public.ecr.aws/supabase/vector:0.58.0-alpine |
| Vector image ID | sha256:5dcf67db0ee378caa87f3395cb9484ebe3e97bb0334d119f2ac33116e00c5773 |
| Original Vector YAML SHA-256 | ce74949a121530bdc91c43ec327b6e0bf746d2acf76b1548385ece2da3a2e1e8 |

Original Config, HostConfig, mounts, image, ID and network endpoint settings were
compared in memory before/after. The other eleven containers also retained their
IDs, start times and restart counts. Vector's existing automatic restart count
advanced **1606 to 1607** during the completed run; it remains unhealthy with its
original TCP endpoint and no mounts. No operator restart was issued.

## Socket availability, permissions and compatibility

A uniquely named probe used the cached postgres-meta image solely for its Node
runtime; its normal service entrypoint never ran. It had network=none, no ports,
no privileges, all capabilities dropped, no-new-privileges, a read-only root
filesystem, bounded resources and one read-only daemon-socket bind. It sent exactly:

```text
GET /_ping
GET /version
```

Both succeeded. The mounted path was a Unix socket owned by **UID/GID 0:0**, mode
**0660**. The probe ran as UID 0. The Engine reported **29.8.2**, API **1.56**,
minimum **1.40**. No real-daemon container listing, inspect, events, logs, exec or
mutation request was made through that socket. Version output was reduced to these
numbers; arbitrary daemon metadata was not saved.

Retained Vector has no configured user override, and the cached image has no USER
override: its existing runtime is root. The successful root probe and separate
root-owned 0660 fixture establish compatible filesystem permissions. The actual
Vector binary successfully used its Unix client against that fixture. This supports
the proposed transport's technical viability without granting Vector access to
retained logs during this task. The pinned Vector implementation supports Unix
sockets and HTTPS/TLS, with source-level docker_host taking precedence over
DOCKER_HOST. [Vector 0.58 transport implementation](https://github.com/vectordotdev/vector/blob/v0.58.0/src/docker.rs).

**Limitation:** the real Engine's container/log/event endpoints were deliberately
not exercised by Vector. The fixture does not certify complete real-daemon API
behavior, production log parsing, Analytics delivery or sustained retained health.
All four observed fixture requests were unversioned; no numbered API negotiation
is claimed. Future retained acceptance must verify those remaining behaviors.

## Security and narrower alternatives

A read-only bind controls filesystem changes, not the API operations carried over
a socket. Direct socket access grants daemon authority, including the ability to
control other containers and access their data. Dropping capabilities and using
no-new-privileges do not remove that daemon authority. The probe's restriction came
from its reviewed fixed program, not from a daemon authorization boundary.
[Docker daemon socket security](https://docs.docker.com/engine/security/protect-access/).

Giving the unmodified Docker-log source the real socket would not provide a strong
test boundary: it lists containers and can inspect metadata and read logs.
include_containers uses prefix matching and is a collection filter, not access
control. The fixture therefore held no daemon socket and could not forward any
request. [Vector Docker source](https://github.com/vectordotdev/vector/blob/v0.58.0/src/sources/docker_logs/mod.rs),
[filter documentation](https://vector.dev/docs/reference/configuration/sources/docker_logs/).

A separate authenticated, authorization-enforcing proxy could narrow access to
specific list/inspect/events/log operations and exact project objects. A blanket
GET-only proxy is insufficient: inspect and logs can themselves expose secrets.
Such a proxy requires reviewed filtering, event scoping, response handling,
credentials, availability and separate deployment ownership. It was not installed
or certified here. The test fixture is not a production proxy.

Vector's supported HTTPS/mTLS transport can authenticate and encrypt a connection,
but certificates alone do not restrict daemon API authority. A suitable daemon
authorization layer would still be needed for narrower privileges. No existing
supported per-project authorization boundary was established. No TCP listener,
Docker Desktop setting, firewall rule, image or dependency was changed. There is
no approved DOCKER_HOST shortcut that makes this Windows CLI persist the repair.

## Disposable experiment

The completed run created only:

| Resource | Name |
| --- | --- |
| Fixed real-socket probe | sq-vector-socket-e6696074-probe |
| Synthetic Docker API fixture | sq-vector-socket-e6696074-fixture |
| Cached Vector test process | sq-vector-socket-e6696074-vector |
| Separate socket volume | sq-vector-socket-e6696074-socket |

All containers used network=none and unique experiment labels, with no Supabase
project labels or retained network/volume membership. The fixture and Vector shared
only the new socket volume; Vector mounted it read-only. Neither received the real
daemon socket, database files, credential store or logging credentials. All three
had read-only root filesystems, dropped capabilities and bounded CPU/memory/PIDs.
The synthetic Vector configuration was generated in memory and written into its
temporary filesystem at startup. No retained YAML or environment was copied into
the test definitions or persisted locally.

The fixture supplied one fictional container and framed synthetic stdout messages.
Only fixed read endpoints for that synthetic ID were available. Other IDs, mutation
methods, encoded paths, unknown endpoints and unknown/duplicate query keys were
denied. Standard encoded Docker filter values were accepted without forwarding
them anywhere. No production source or database fixture was introduced.

Vector made one list, one inspect, one event-stream and one log-stream request.
It received **ten synthetic events** during **45.9 seconds**, became healthy at the
10.2-second sample and stayed healthy through subsequent samples. Restart count
remained zero. There were zero denied fixture requests and no WARN/ERROR diagnostic
in the bounded Vector log sample. Raw synthetic output was inspected in memory;
evidence records counts and fixed categories rather than event bodies.

The final probe exited normally; the owned Vector and fixture were stopped and
retained. No test process is running. Across all attempts, **ten disposable
containers** and **three socket volumes** remain: nine containers exited, and the
first probe was never started. No network was created or resource deleted. Each
run rejected any Docker inventory delta beyond its own exact resource IDs/names.

## Tests and earlier stopped attempts

| Check/group | Passed | Failed | Skipped/not performed |
| --- | ---: | ---: | --- |
| Final Python preservation/ownership methods | 10 | 0 | 0 |
| Final Node fixture security methods | 6 | 0 | 0 |
| Fixed real Engine socket probe | PASS | 0 | 0 |
| Final synthetic Vector Unix-source/health/delivery experiment | PASS | 0 | 0 |
| Final source/service/recovery/credential-metadata/lock preservation | PASS | 0 | 0 |
| Retained repair and ten-minute health acceptance | 0 | 0 | Not authorized |
| Real Vector-to-Engine collection and Analytics delivery | 0 | 0 | Deliberately isolated |
| Full-stack CLI recreation and persistence rehearsal | 0 | 0 | Not performed |
| Application/frontend/build/Google login suites | 0 | 0 | Outside scope |

There are **16 final passing offline methods**; repetitions are not added together.
They reject retained identifiers, mutation endpoints, unsafe resource deltas,
changed retained definitions/networks/lifecycles, anonymous image volumes and invalid
run identities. They also cover encoded filters, unknown queries and strict API
evidence, including unversioned requests. Existing activation locks are checked.

Historical stopped evidence remains unchanged:

- **bc506280:** script staging into a read-only root failed before the probe ran.
  A separate bounded staging diagnosis confirmed the read-only-filesystem error.
  Startup now receives public synthetic code directly; filesystem protection stays
  enabled. Its old summary named a planned socket volume that was never created;
  the latest runner records actual volume creation separately.
- **a702b21f:** the real probe passed, then the fixture rejected the source's initial
  request. Review found that its guard incorrectly rejected percent encoding in
  ordinary filter query values. That regression was repaired while retaining the
  exact endpoint/method/container restrictions. The individual rejected request
  was not saved, so its raw query cannot be retrospectively reconstructed.
- **a752818f:** health and synthetic delivery succeeded, but the new checker required
  a numbered API prefix. This image sent unversioned requests. The corrected checker
  requires complete counted evidence for that representation, and still rejects
  missing evidence or incompatible numbered versions. Two offline cases cover it.

All three attempts stopped their owned processes and passed final retained-source
preservation. No historical failure was overwritten or reclassified as PASS.
The new result belongs only to the complete e6696074 run. Python/JavaScript syntax
and whitespace checks passed. No frontend or recovery-test counts were reused.

## Persistence through Supabase CLI recreation

The installed package is **2.121.0**. Read-only context inspection returned
**npipe:////./pipe/dockerDesktopLinuxEngine**. The official pinned builder resolves
an explicit DOCKER_HOST first, then the Docker context, then the platform default.
Its **npipe branch sets http://host.docker.internal:2375 and adds no socket mount**.
Thus a manual container repair does not survive ordinary recreation under this
unchanged context. This conclusion follows from the pinned source and current
context; retained CLI start/stop was not executed.
[Pinned Vector builder](https://github.com/supabase/cli/blob/v2.121.0/apps/cli/src/commands/start/services/vector.service.ts).

Merely injecting unix:///var/run/docker.sock into Windows CLI is not a reviewed fix.
Its Unix branch calculates the destination from the Windows platform default; the
official unit case expects a Windows named-pipe destination, rather than the Linux
container path needed here. It also affects the CLI's daemon selection. Neither
that override nor a global context change was applied.
[Pinned branch tests](https://github.com/supabase/cli/blob/v2.121.0/apps/cli/src/commands/start/services/vector.service.unit.test.ts).

Before any future full-stack restart, choose and separately review a repeatable
creation method: for example, an upstream-corrected supported CLI recipe, or a
guarded Vector-only post-creation step integrated into the approved restart workflow.
A Linux/WSL CLI execution path would need its own path, project, key, volume and
image-preservation review. None is certified by this experiment. No CLI patch,
wrapper bypass or health-check exclusion was added. The next disposable persistence
rehearsal must prove the final Vector environment/mounts and all-service health.

Source URLs/checksums and the context observation are recorded in
[the CLI source review](tests/results/vector_socket_cli_source_review.json).

## Exact proposed retained change and protected rollback procedure

The candidate definition delta remains exactly:

```text
Config.Env: replace only
  DOCKER_HOST=http://host.docker.internal:2375
with
  DOCKER_HOST=unix:///var/run/docker.sock

HostConfig.Mounts: add only
  Type=bind, Source=/var/run/docker.sock,
  Target=/var/run/docker.sock, ReadOnly=true
```

Preserve the exact image ID, generated YAML/hash, entrypoint/command, user,
environment entries, project/workdir labels, logging settings, health check,
restart policy, limits, ports and declared network aliases/settings. ID and normal
Engine-assigned runtime identifiers necessarily change on recreation; any other
definition delta must fail. Preserve the original complete inspect response as
well as an explicitly reviewed Engine-create translation: inspect JSON itself is
not a directly reusable create request.

**This is a prepared procedure, not an implemented or authorized mutation helper.**
No rollback secret/configuration capture was created in this task. A later helper
must be reviewed and rehearsed with disposable specifications before retained use:

1. Repeat exact target ID, image, YAML, project labels, network and source/recovery
   gates, including zero active work, six migrations, routing and Google disabled.
   Freeze all eleven other service definitions/lifecycles, retained volumes and
   network identity. Reject unexpected labels, pending changes or socket ownership.
2. Create a fresh ignored rollback directory with no reparse points, disabled NTFS
   inheritance and exactly current-user/SYSTEM access. Capture the full original
   inspect/create specification, generated YAML, network aliases/IPAM information,
   image ID and volume inventory directly in memory. Encrypt them with DPAPI
   CurrentUser and purpose/path/project/owner binding before disk writes. Use atomic
   create-new files, verify ACLs and a private decrypt/read-back, and bind ciphertext
   hashes to the reviewed proposal. Do not read the Google credential store.
3. Privately inventory Analytics' actual datastore, expected logging writes and
   recovery coverage. Restored log delivery can persist new logging records; the
   postgres database bundle does not certify other databases/service datastores.
   Do not treat those writes as an unlimited application-data exception.
4. Require new explicit approval of the exact Vector-only recreation, daemon-socket
   authority, proposal/code hashes, rollback plan and any agreed logging-store
   effects. There is no authorized execution command or approval hash here.
5. Recheck immediately before mutation. Stop only the exact original Vector ID
   with a bounded timeout, rename it to a fresh rollback name, and detach only its
   endpoint from the project network. Retain the original container intact and
   stopped. Its unless-stopped policy must not be used to allow it to auto-run.
   Retain its labels; identify it by both immutable ID and approved rollback name.
6. Create the replacement under the canonical name using the reviewed original
   definition plus only the delta above. Use a private in-process Engine channel
   or captured stdin body for sensitive create data, never secret command arguments,
   raw stdout or tracked files. Preserve the original declared aliases; do not copy
   generated endpoint IDs as if they were configuration. Inspect the complete
   resulting definition and all other services before starting only the new ID.
7. Observe at least **ten continuous minutes**, sampling at most 30 seconds apart:
   healthy existing 9001 probe, stable start/restart count, active Docker source,
   no connection-refused/source-finished loop, healthy Analytics and protected
   evidence of normal delivery. Require exact durable application/Auth/security,
   migrations/routes/volumes and eleven-service preservation, intact recovery
   artifacts, disabled Google and unchanged activation locks. The 45.9-second
   disposable result does not satisfy this future ten-minute gate.
8. Stop on any mismatch. Do not automatically repeat service commands or restore a
   database dump. With separately approved rollback, stop/isolate only the failed
   replacement, retain it under a new diagnostic name, restore the original name
   and exact network aliases/settings, and start only the original ID. Recheck all
   preservation gates. This restores the known failing TCP definition, not a
   promise of healthy logging. Keep diagnostic and encrypted rollback artifacts.

A renamed original still carries the project label and would be discovered by
full-stack inventory and CLI stop. While retained, the repair verifier must allow
exactly that stopped, network-detached rollback ID in addition to the canonical
replacement and must reject any other extra project container. The existing Google
activation inventory must remain blocked until this is explicitly resolved. Later
cleanup requires separate approval to remove only that stopped container without
volume-removal flags, or another explicitly reviewed ownership plan. Do not silently
ignore it, strip its project labels or broaden the existing inventory allowlist.

## Final source, credential and recovery preservation

Final source inspection still matched all application/Auth/history fingerprints,
schema/security metadata, roles, settings and sequences outside the existing narrow
Realtime policy. No new partition appeared: inventory remains **70 tables**. There
were two scoped anonymous public subscriptions at both ends; subscription allocation
was **332 at both ends** of the final run, compared with 298 in the recovery snapshot.
No allocation cause is attributed, and no baseline or classifier was rewritten.

The retained counts remain 39 accounts/39 Auth users/26 identities, 20 terminal
tickets, 57 events, 69 replay receipts, 32 audits, seven closed days and four staff
assignments. Counter availability and Counter 5's stale STUDENT fixture remain
intact. All 15 application tables retain RLS; browser roles lack queue_private
USAGE; the application publication contains only the two sanitized display tables.

The fresh recovery bundle remains
`.local-backups/pre_google_20261017T063856Z_6e3beebe`, bundle SHA-256
`50164d4afb5083a83044f5ee3df3d13b1b2002ba29ee03143e460c181b915a52`.
Its generated supplements, associations, protected access and stopped restore
destination passed again, together with the two older verified bundles. All **50
backup files** retained their size/hash inventory digest:
`9ae20f6cf67e0c894217892abf1fe48e56ad6e6858215a8da23614455d77ac81`.
No backup/restore ran, and no recovery volume was started or deleted.

All **157 recorded existing report/evidence/configuration/product/test inputs**
retained their hashes during the final run. The Google store was checked by file
metadata only: size, timestamps and attributes stayed unchanged. It was never opened,
hashed, decrypted or imported. This is not a new credential-validity claim.

## Files, evidence and decision

Created:

- `tests/validate_vector_socket.py`: disposable ownership/isolation, exact inventory
  accounting, fixed real probe, synthetic experiment and preservation orchestration.
- `tests/vector_socket_fixture.mjs`: fixed two-GET probe and disconnected synthetic
  Unix Docker API fixture; `tests/vector_socket_fixture.test.mjs`: six policy methods.
- `tests/test_vector_socket.py`: ten offline preservation/security methods.
- New sanitized run/source-review/staging-diagnosis JSON and this report.
- The uniquely labeled inactive disposable containers/volumes recorded above.

Paths above are relative to supabase/. No existing helper, classifier, product file,
config.toml, migration, report, evidence, environment setting or credential artifact
was modified. No retained Docker resource, database/Auth record, RLS/grant or Google
provider setting changed. No image was pulled, dependency installed, hosted Supabase
contacted, activation unlocked, deployment performed, volume deleted, commit or push
made. Public official sources were fetched read-only from GitHub.

Completed evidence:
[vector_socket_validation_e6696074.json](tests/results/vector_socket_validation_e6696074.json).
SHA-256: `23c8f7751b59a14c6074626b87458aba0f75b46fb3e4b425cb4937a73deffc0e`.

**The Unix transport candidate is technically viable within the measured scope.
The retained repair is ready for design review, not execution approval.** Resolve
the persistent creation recipe and implement/rehearse the protected repair/rollback
helper and logging-store checks before requesting approval to change retained Vector.
The full-stack Google activation workflow remains blocked. Any retained repair
requires a new explicit approval covering its daemon authority and exact operations.

**Stopped after disposable validation, preservation verification and this report.**
