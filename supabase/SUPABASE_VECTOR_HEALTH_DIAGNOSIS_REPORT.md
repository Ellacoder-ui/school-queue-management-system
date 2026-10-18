# Step 22.8A: Supabase Vector health diagnosis and repair plan

October 17, 2026. **Read-only diagnosis completed; the Vector health failure remains
unrepaired.** The confirmed immediate cause is a refused connection to Vector's
configured Docker API endpoint, **http://host.docker.internal:2375**. Its only log
source finishes, Vector exits normally, and its existing restart policy repeats
the cycle. This is a Docker transport problem, not an observed Google Auth or
application-migration failure.

**No container was restarted/recreated by this task.** No configuration, restart
policy, image, volume, database/Auth record, grant or provider setting changed.
Google remains disabled and both activation execution locks remain intact.

## Verified target

| Item | Observed value |
| --- | --- |
| Project / directory | school-queue-local / C:\Users\Hp\school-queue-management-system |
| Vector container | supabase_vector_school-queue-local |
| Container ID | b6d521af4f244e0ab8ede06130d31bf067e9483ed1dd920544759b607cc9bc59 |
| Image | public.ecr.aws/supabase/vector:0.58.0-alpine |
| Image ID | sha256:5dcf67db0ee378caa87f3395cb9484ebe3e97bb0334d119f2ac33116e00c5773 |
| CLI/Compose project labels | Both school-queue-local; CLI workdir matches the project directory |
| Network | supabase_network_school-queue-local; bridge; internal=false |
| Network ID | e1f4c1a26ff768b3ebd984c2e80d570985d0762b775e4edf753570f7dbbf656d |
| Vector mounts | None; no Docker socket, database volume or credential-store mount |
| Entrypoint / startup | sh; startup command runs vector --config /etc/vector/vector.yaml |
| Restart policy | unless-stopped; MaximumRetryCount=0; unchanged |
| Final recorded state | restarting / unhealthy; exit code 0; OOMKilled=false |

The source database remains PostgreSQL 17.11 at **127.0.0.1:54322/postgres**, cluster
**7696959712798593061**, with volume/container supabase_db_school-queue-local.
The API remains **http://127.0.0.1:54321**, gateway supabase_kong_school-queue-local.
Six migrations and their original hashes, permanent routing and application security
were independently verified before diagnostics and again afterwards. No target
identity mismatch occurred.

## Sanitized failure evidence

Initial diagnosis ran **22:55:16–22:55:43 UTC+08:00**, evidence
[cf7c44d1](tests/results/vector_health_diagnosis_cf7c44d1.json). The final startup and
preservation inspection began **23:07:25**, evidence
[1a28749a](tests/results/vector_startup_inspection_1a28749a.json).

Vector's restart count was **1550** in the first capture and **1562** in the final
capture, with the same container ID/configuration. These are ongoing automatic
restarts; no restart command was issued. The previous Step 22.8 observation was 1530.

One observed cycle on October 17, UTC, was:

| Time | Sanitized event |
| --- | --- |
| 15:01:49.506 | Loading configuration |
| 15:01:49.523 | Docker log collection initializes |
| 15:01:49.712 | Vector started; sampled component health checks passed; API server running |
| 15:01:49.720 | Docker-log source: connection refused |
| 15:01:49.720 | All sources finished |
| 15:01:49.721–49.723 | Shutdown; Vector stopped |

Docker recorded that process lifetime as approximately **0.46 seconds**, ending with
exit code **0**. Repeated sampled cycles show the same sequence. The existing
`unless-stopped` policy accounts for automatic starts after process exit; changing
that policy would not repair log collection.
[Docker restart policies](https://docs.docker.com/engine/containers/start-containers-automatically/).

The Docker health definition is:

```text
wget --no-verbose --tries=1 --spider http://127.0.0.1:9001/health
```

Interval **10 seconds**, timeout **2 seconds**, retries **3**. The three available
stored results have exit code 1 and connection-refused output. They date from
October 15 and October 17; the latest stored result is 11:56:43 UTC. They are
historical results, not three fresh probes from this task. The current process
usually exits before a new scheduled health probe can run. Its configured API
address is 0.0.0.0:9001, and startup logs show that API briefly starting.

The first log sample was bounded to **120 recent lines / 20 minutes**; follow-up
samples used **100 lines / 10 minutes**. Raw log text, command contents, environment
values outside the transport allowlist, headers and private records were never
written to evidence. A 20-minute Docker event query returned one start/die pair,
with exit code 0. Docker's available event history is limited; this is not a
complete reconstruction of all 1562 restarts.

## Configuration, destinations and dependencies

The container environment contains **DOCKER_HOST=http://host.docker.internal:2375**.
There is no DOCKER_API_VERSION override, Docker TLS-verification setting or Docker
certificate-path setting. No complete environment dump was emitted.

Read-only archive-stream inspection found `/etc/vector/vector.yaml` present:

- **7,631 bytes**, root-owned, mode **0644**.
- SHA-256 **ce74949a121530bdc91c43ec327b6e0bf746d2acf76b1548385ece2da3a2e1e8**.
- API enabled at **0.0.0.0:9001**.
- One **docker_logs** source; no explicit docker_host in the inspected plain source
  fields, so the container's DOCKER_HOST selects the transport.
- Seven HTTP sink definitions, all directed to the local project analytics origin
  **http://supabase_analytics_school-queue-local:4000**. Query strings, paths carrying
  routing details, authentication and headers were omitted.

The file was read into memory through `docker cp ... -`; it was not extracted to a
local raw configuration file. Its hash matched across inspections. The summary
reads a narrow set of ordinary YAML fields; it is not a general YAML validator.
Vector's own successful startup supplies separate evidence that the active file
parsed. No Python package or image was installed.

The pinned Vector implementation uses a source-level docker_host override, then
DOCKER_HOST, and supports a Unix socket transport. The source's initial container
listing needs that Docker connection; a failure there prevents normal collection.
[Vector 0.58 Docker source](https://github.com/vectordotdev/vector/blob/v0.58.0/src/sources/docker_logs/mod.rs),
[0.58 Docker transport helper](https://github.com/vectordotdev/vector/blob/v0.58.0/src/docker.rs).

Analytics remained **healthy**, using public.ecr.aws/supabase/logflare:1.53.0,
image ID **sha256:9d9c8f8c462650b5a99789e1adc6906df85cfb15e2515a8a3b44953893434470**.
Its container ID/start time/restart count were unchanged. Sampled Vector component
health checks passed, consistent with a reachable downstream service; this does
not prove delivery through every configured sink. No analytics restart, authenticated
logging request or synthetic log injection was attempted.

## Root cause and uncertainty

**Confirmed:** the active Vector definition selects the host TCP Docker endpoint
on port 2375, its Docker source receives connection refusals, and the source/process
then terminates. There is no socket mount providing an alternative connection.
The primary missing dependency is a working **Docker API transport for Vector**.

**Strongly supported:** correcting that transport should allow the source to stay
active and make the existing health endpoint persist. The proposed Unix-socket
correction below is consistent with Vector's supported configuration, but was not
tested against a repaired container in this read-only task.

**Unresolved:** why the host TCP endpoint is unavailable, and which earlier creation
path selected it. Docker Desktop settings, firewall rules and the exact historical
creation command were not inspected or changed. A disabled host listener is plausible;
this task does not certify that specific setting as the deeper cause. Persistence
of a corrected definition through CLI recreation also remains unverified.

Other candidate causes were evaluated as follows:

| Candidate | Evidence / conclusion |
| --- | --- |
| Missing/invalid Vector configuration | File exists; Vector parses/starts and enables its API. Not the observed immediate failure. |
| Analytics unavailable | Analytics healthy; sampled component checks pass. No evidence it caused this exit sequence. |
| Image/version mismatch | Exact previously reviewed Vector image ID retained. No API-version rejection appeared in bounded logs. Compatibility after transport repair still needs verification. |
| OOM/resource kill | OOMKilled=false; observed exit code 0; no allocation-failure diagnostic in the sample. No evidence of a current resource-kill cause. |
| Wrong health-check port | Configured API and probe both use 9001. Process lifetime prevents stable probing. |
| Google frontend/provider change | Google disabled, source/configuration unchanged; health failures already recorded on October 15. No causal evidence links Google work to this failure. |

Docker Engine is **29.8.2**, API **1.56**, minimum API **1.40**. Docker Desktop reports
12 CPUs and 8,141,975,552 bytes of VM memory. Vector has no explicit memory/CPU/PID
limit. Its stats sample showed zero active PIDs/memory during restart backoff;
Analytics used approximately 663.8 MiB. These snapshots do not measure all historical
memory pressure. Changing resource limits or forcing a Docker API version is not
supported by the observed failure.
[Docker API compatibility](https://docs.docker.com/reference/api/engine/).

## Minimal proposed repair — separate approval required

Prefer a **Vector-only recreation with the same cached image**, retaining its
configuration, logging destinations, labels, network, health check and restart policy.
The exact proposed definition changes are:

```text
Config.Env:
  replace only DOCKER_HOST=http://host.docker.internal:2375
  with         DOCKER_HOST=unix:///var/run/docker.sock

HostConfig.Mounts:
  add Type=bind, Source=/var/run/docker.sock,
      Target=/var/run/docker.sock, ReadOnly=true
```

No Vector YAML, analytics configuration, Supabase config.toml, image version, database
volume or provider setting needs to change for this candidate repair. The Linux
Engine socket's availability and permission compatibility must first be verified
through an approved disposable probe. Keep the existing Docker Desktop TCP settings
unchanged. No dependency service restart is proposed.

Environment and mount changes require recreation; an ordinary `docker restart`
would reuse the current definition. `docker update` does not provide these changes.
[Docker container update options](https://docs.docker.com/reference/cli/docker/container/update/).

Socket access is a material security change. A read-only bind flag does **not** make
Docker API operations read-only: a process able to use the daemon socket can exercise
its API authority. Review that access explicitly before approving the repair. Vector
must not gain a database-volume mount, published daemon port or privileged mode.
[Docker daemon socket security](https://docs.docker.com/engine/security/protect-access/).

A later repair task should prepare and review a guarded helper before issuing any
service command. Its ordered operations should be:

1. Recheck exact target, zero active work, current source/recovery preservation,
   cached image ID and socket availability. Refuse changed identities.
2. Save the original complete Vector create specification and generated YAML in
   protected rollback storage. They can contain logging secrets; encrypt them and
   never place their contents in arguments, reports or tracked files.
3. After explicit approval, stop **only Vector**. Retain its stopped original
   container under a unique rollback name during validation; detach that old
   container's network endpoint before creating the replacement to avoid alias
   conflicts. Keep all other containers and volumes intact.
4. Create the replacement with the original definition plus only the two reviewed
   changes above. Supply the sensitive definition through the reviewed private
   process/API channel, not an echoed shell command. Start only the replacement.
5. Validate the repair and source preservation. Any cleanup of the old container
   must be separately covered by the repair approval, without a volume-removal flag.
   A retained rollback container with the same project labels must be accounted for
   before the full-stack activation inventory can pass.

The narrow service command at step 3 would be:

```powershell
# FUTURE APPROVAL ONLY — not executed in this diagnosis.
docker stop --timeout 10 supabase_vector_school-queue-local
```

There is deliberately no abbreviated `docker run` recipe that would omit original
settings or expose the embedded logging credentials. The create-spec delta above is
the exact proposed change; a reviewed, guarded recreation helper does not yet exist.
This plan is not permission to run it.

## Validation, rollback and restart implications

After a separately approved repair, require:

- Correct new Vector identity, unchanged image/YAML hash and all original settings
  except the approved transport/mount delta. All eleven other containers must retain
  their IDs/start times/restart counts and volume associations.
- Successful Docker-source communication, sustained log collection, no connection
  refusals/source-finished shutdown loop, healthy 9001 endpoint and no increasing
  restart count. Observe at least ten minutes, covering several former restart cycles.
- Healthy Analytics and protected evidence of normal logging delivery, with no
  secret/raw record output. No synthetic private log or business fixture is needed.
- Exact source migration/routing/business/Auth/security preservation, the same narrow
  Realtime classifier, intact recovery artifacts and Google still disabled.

Restored logging can write new records to Analytics' logging datastore. That expected
logging effect must be explicitly inventoried rather than hidden by a broad data
exception. Existing database recovery excludes other databases/services unless
recorded; inspect the actual logging datastore before making recovery claims about it.

Rollback should stop/isolate only the replacement, restore the retained original
Vector name/network/aliases and original definition, then verify the other services
and source. Keep both definitions and any failed replacement for diagnosis. Do not
restore a database dump, delete a volume or erase logging/Auth history. Rollback would
restore the **known failing pre-repair Vector configuration**, not promise a healthy
logging service.

Before a future full-stack CLI restart, establish that its Vector creation recipe
preserves the corrected transport. A manually repaired container could otherwise be
replaced with the old TCP configuration. This persistence question and a disposable
CLI recreation rehearsal remain acceptance work; no image upgrade, CLI patch or
topology change is approved here.

## Preservation and recovery results

Final source checks passed with the exact six migration receipts/hashes, fixed
**1:TP, 2:SOA, 3:PNEP, 4:REF, 5:ADJ** routing, all captured rows/security metadata,
roles, ACLs and sequences outside the reviewed Realtime scope.

State remains **39 accounts, 39 Auth users, 26 Auth identities, 20 terminal tickets,
57 events, 69 replay receipts, 32 audits, seven closed days and four assignments**.
No active ticket/open day exists. All 15 application tables retain RLS, browser roles
lack queue_private USAGE and the application publication still contains only the
two sanitized display tables. Counter availability and historical staffing, including
the stale Counter 5 STUDENT fixture, are unchanged.

Inventory remains **70 tables**, with no new partition. Scoped anonymous public
subscription counts were two at this diagnosis's initial and final checks; allocation
advanced from **322 to 324**. The preceding Step 22.8 task recorded zero rows and
allocation 320, a separate historical observation. Against the recovery snapshot,
the final comparison is two rows to two and allocation 298 to 324. Their scope checks
passed; no specific background or operator cause is attributed. Every other
row/object/role/privilege remains strict. No historical baseline or classifier was
rewritten.

All **eleven other containers** retained their recorded identities/start times/restart
counts. Docker container/volume/network inventory IDs remained unchanged. Vector's
automatic restart count advanced, but its container definition, image and mounts did
not change. No repair or operator restart command was executed.

The protected Google store was **not opened, hashed, decrypted or imported**. Only
file metadata was inspected: size, write/creation timestamps and attributes were
unchanged. This is not a new credential-validity or byte-for-byte ciphertext test.
No helper preview that decrypts credentials was invoked. Google remains disabled.

The existing five-version, 69-table six-version and fresh 70-table recovery bundles
passed their hash/association/protected-access checks. All **50 backup files** retained
their size/hash inventory digest:

`9ae20f6cf67e0c894217892abf1fe48e56ad6e6858215a8da23614455d77ac81`

The fresh verified bundle remains
`.local-backups/pre_google_20261017T063856Z_6e3beebe`, bundle SHA-256
`50164d4afb5083a83044f5ee3df3d13b1b2002ba29ee03143e460c181b915a52`.
No backup, restore or recovery-container startup ran. No new database backup is
required solely for this read-only diagnosis. Before repair, revalidate the existing
point and capture protected Vector rollback configuration; material durable-state,
schema/platform changes or additional logging-datastore coverage require a reviewed
recovery update.

All **146 previously captured report/evidence/configuration/product inputs** in the
final inspection retained their hashes. The original readiness FAIL report and
evidence remain historical records. Activation code and locks were unchanged.

## Diagnostics, tests and files

**Eleven final synthetic diagnostic privacy/policy tests passed**, with zero failures.
They cover canary redaction, safe version/timestamp categories, credential-bearing
health-command suppression, read-only command rejection, target identity rejection,
URI credential/query removal and narrow configuration/startup summaries. Repeated
executions are not added together. No application/frontend/build, real Google,
repair, container-recreation or post-repair acceptance suite ran.

An early narrow YAML summary defaulted an uninspected header-presence field to false.
That diagnostic metadata was corrected to **not inspected** in the final evidence,
with a regression assertion. Earlier evidence is retained; its default field is not
proof that logging headers are absent. No raw header or credential was exposed.
One direct network read hit sandbox Docker access denial; its approved read-only
retry succeeded. Neither event caused a service/configuration change.

Created only:

- supabase/tests/diagnose_vector_health.py — guarded bounded inspection and preservation.
- supabase/tests/inspect_vector_startup.py — in-memory startup/configuration summaries.
- supabase/tests/test_vector_diagnostics.py — eleven synthetic methods.
- Separate sanitized vector_health_diagnosis/vector_startup_inspection JSON evidence.
- This report.

Raw container definitions, configuration, logs, keys and headers were not persisted.
No existing source/configuration/test/report, dependency, Docker resource or credential
artifact was modified. No hosted Supabase, Google login, migration/reset/push/link,
provider activation/unlock, deployment, volume deletion, commit or push occurred.

Primary evidence:

- [Initial full diagnosis cf7c44d1](tests/results/vector_health_diagnosis_cf7c44d1.json),
  SHA-256 `5aa74fac8a270186f6caf0ad6c3afb386280e43ea4095c24cd7fef35b0cf4654`.
- [Final transport/preservation 1a28749a](tests/results/vector_startup_inspection_1a28749a.json),
  SHA-256 `c60bd55e49db6f2e4376b1637c497d9e7ade7d4e33a113da4c5fae1cb372e0bc`.

**Separate approval is required for any repair or disposable transport probe.**
Google activation rehearsal may resume only after an approved repair is verified,
its recreation persistence is addressed and the requested activation checks are
completed. This diagnosis does not clear that gate or unlock the workflow.

**Stopped after read-only diagnosis, preservation verification and repair planning.**
