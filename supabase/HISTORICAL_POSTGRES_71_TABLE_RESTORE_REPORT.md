# Step 22.8G: independent historical 71-table PostgreSQL restoration

October 18, 2026. **PASS — historical snapshot d7f3aa3b is independently VERIFIED
RECOVERABLE under the tested matching PostgreSQL platform.** Actual restoration,
all exact comparisons, the wrong-target supplement test and preservation gates passed
in run **8543cd32**, **14:18:26–14:20:24 UTC+08:00**.

**The separate live-source preservation result remains FAIL for the missing October 14
Realtime leaf.** This historical PASS does not certify the current inventory, prove
deletion-time emptiness, establish Analytics recovery or clear Vector/Google execution.
No retained database write, source backup or retained service operation ran.

Evidence: [completed independent restoration](tests/results/historical_postgres_71_restore_8543cd32.json).
SHA-256: `9247624d3091f3a36a4c4f7085c77f74ff89b9b514a7027d4148966e5910bf01`.

## Immutable recovery source and encrypted verification artifacts

| Binding | Verified value |
| --- | --- |
| Historical capsule | .local-backups/dual_20261018T051715Z_93426091 |
| Original backup run / snapshot | 93426091 / d7f3aa3b |
| Original evidence SHA-256 | d88a82e21d383b4177b8c49ed275ad922f648622bb653ef7c7fe34ca0684bf0b |
| Historical source | school-queue-local; 127.0.0.1:54322/postgres |
| Historical cluster | 7696959712798593061 |
| Captured inventory | 71 logical tables; 70 physical TABLE DATA entries; eight attachments |
| Captured logical rows | 824 |
| Application history | Six original migrations, 001–006, with their unchanged file hashes |

The nine recorded valid artifacts in the original run were privately decrypted and
verified against their ciphertext/plaintext sizes and hashes. The pinned manifest,
snapshot identity, database purpose, project/path/endpoint, source images and completed
original dump fences all matched. Missing/corrupted inputs or another capsule cannot
be substituted through the new entry point. Invalid synthetic ciphertext retained from
old negative tests is not included in the original valid-artifact map.

Historical manifest SHA-256, **919,924 plaintext bytes**:
`8e6ca9b30ae6bc78df6a374c6559d9a8c33a25cfc4868eaa9089128ebad118b2`.

Historical custom archive SHA-256, **537,857 plaintext bytes**:
`d6c831973afee9feddfa59637d5f6eaeb5a6a85e51a43a53844b07f1ceb1a29c`.

New protected verification directory:
`C:\Users\Hp\school-queue-management-system\.local-backups\dual_20261018T061826Z_8543cd32`.

Seven immutable input artifacts were privately read and re-encrypted into that new
directory with exactly the same plaintext hashes: manifest, custom archive,
password-free roles, TOC, environment-source proposal and the two source-derived SQL
supplements. Additional encrypted artifacts retain prepared roles, corrected restore
SQL, expected wrong-target diagnostics and the completed verification bundle. These
are verification copies of the historical snapshot, **not a new source backup**.

| New encrypted artifact | Ciphertext bytes | Ciphertext SHA-256 |
| --- | ---: | --- |
| pg_archive.dpapi | 717,622 | c441881482b8b15ec25869f9ba9424cf5239b9669ac60b94c27c19dece67edb9 |
| pg_manifest.dpapi | 1,227,046 | b97d29e54bcdbc4dec710757a3611b99a18ad8a3228c6fd3b51bc6ceb4ec077c |
| pg_bundle.dpapi | 6,006 | e7c324ed116fa95f23362847698835c53a05044052db58205ce1ea2e633b4ccf |

The completed bundle's plaintext SHA-256 is
`1490c47ca1fdf9502ac6a9a0b05b73de02b415efd40fbc878c4c672897b0aa9b`.
All eleven new encrypted artifacts passed private read-back/hash verification.
Per-artifact plaintext/ciphertext identities remain in the completed evidence.

The existing reviewed DPAPI CurrentUser bridge enforced ignored/untracked storage,
current-user ownership, disabled inheritance and exactly current-user/SYSTEM FullControl
for private artifacts, reparse-point/path rejection and create-new writes. No original
artifact was overwritten. Sensitive data, settings and SQL stayed in private memory/
captured pipes until encryption. No plaintext private host staging file, credential
argument or raw diagnostic report was introduced. The public access probe contains no
private data. Provider credential storage was never opened, hashed or decrypted.

## Narrow historical entry point and independent live checks

Created `supabase/tests/restore_historical_postgres_71.py`. Its default invocation runs
offline tests only. Its explicit `--run` accepts only the fixed capsule above; it has
no configurable source capsule, retained target, source-backup interface, repair action
or combined-recovery interface. It composes the existing guarded destination, exact
restore and supplement primitives without changing their implementation.

The new verifier compares the restored clone with the historical manifest. Separately,
it checks the live cluster and application/Auth/security state and requires the known
pruning failure's exact named differences to remain unchanged. Unknown live data,
security, identity or deletion differences stop the run. It does not require today's
catalog to equal the historical 71-table catalog merely to test that archive.
The production classifier and existing combined runner/verifier remain unchanged.

Preflight independently checked project/workdir, loopback endpoint, server/cluster,
database/gateway volumes and network membership, reviewed service image IDs, current
Auth settings, disabled Google, six migration files/receipts, routing, zero active
work/no open day, protected historical bundles and execution locks. It also confirmed
the cached restore image, native tool version and sufficient host working capacity.

## New isolated destination and actual reconstruction

| Item | Verified destination |
| --- | --- |
| Container | sq-restore-internal-c01e72bb |
| Container ID | d42859cc5b34fa181517db1de17779d0e2877f5f4c659c695bf10459d1e796ed |
| Fresh volume | sq-restore-internal-c01e72bb-data |
| Volume creation | October 18, 06:19:08 UTC |
| Database | queue_restore_verify |
| PostgreSQL / distinct cluster | 17.11 / 7697888567965552667 |
| Cached image | public.ecr.aws/supabase/postgres:17.11.0.004 |
| Image ID | sha256:6058a6759ab9268cff8ee70641d61f1bd75953316281b76427cf5a6b4db2eafc |
| Network / published ports | none / none |
| Connection / TCP | /tmp Unix socket / disabled |
| Final state | Stopped, exit 0, not OOM-killed; complete volume retained |

Container/volume absence was checked before creation. Before restoration SQL, the
verifier checked actual immutable IDs/labels/image/mounts, new-volume creation metadata,
network namespace, absent ports/TCP and distinct cluster. The initial database had
zero application tables and only the expected bootstrap role/databases. The sole mount
was the new PGDATA volume; no retained volume, host directory, daemon socket or provider
store was mounted. Bundled Supabase initialization was bypassed. No Auth, Analytics,
worker or replication consumer connected to this clone.

The recorded UTF8, ICU en-US, en_US.UTF-8 collation/ctype, preload libraries and extension
availability were prepared and checked. Password-free roles/memberships were imported
first, omitting only the duplicate CREATE of the known bootstrap role while preserving
all ALTER/GRANT statements. The verification database was created from template0 with
owner postgres and the exact recorded locale. Role and locale comparisons passed.

Actual top-level invocation:

```powershell
python -B supabase/tests/restore_historical_postgres_71.py --run
```

This creates a new verification identity/destination; it is not a read-only evidence
viewer or a resume command. Do not rerun it merely to open this completed result.

The executed internal operations used these fixed command forms, with payloads supplied
through private pipes and the exact owned destination checked before SQL:

| Operation | Actual command/options and result |
| --- | --- |
| New destination | docker volume create; docker create --pull=never --network none with the fixed custom initializer; docker start only the new container |
| Archive inventory | pg_restore --list, archive on stdin; exit 0 and complete historical coverage |
| Complete SQL reconstruction | pg_restore --exit-on-error --single-transaction --file=-, archive on stdin; exit 0 |
| SQL application | docker exec -i --user postgres sq-restore-internal-c01e72bb; explicit /tmp socket and queue_restore_verify; psql -X -w -qAt with ON_ERROR_STOP=1; archive SQL on stdin; exit 0 |
| Supplements | Same guarded psql channel, exact archive/manifest/cluster bindings; expected wrong-target rejection then successful schema/environment application |
| Shutdown | docker stop --timeout 20 sq-restore-internal-c01e72bb; verified stopped, exit 0 and retained volume |

Host pg_restore was **18.6**, executable SHA-256
`2b549ba70eff93bf976a1d774fe4837c10dbf63db39ccd6d452f59cf03ace2af`.
Destination PostgreSQL/psql was 17.11. The complete reconstructed script was actually
executed transactionally in that server; compatibility was not inferred from archive
readability alone. No clean, schema/table/data filter, owner/ACL omission, migration or
Realtime exemption was used.

The reviewed Windows text correction was verified before creating the destination:
all 23 multiline application bodies matched the immutable snapshot references after
reversing the observed native CRT LF expansion once. TOC/roles/SQL text use this decode;
the custom binary archive never does. Its plaintext SHA-256 remained exact. The complete
restore then passed the function-definition comparisons that failed in the old run.

## Source-derived supplements and wrong-target rejection

The unsupplemented clone had to match the exact known prerequisite gaps, with all other
rows/objects/roles/sequences already exact. Only then were the original manifest-bound
supplements eligible. No unrelated difference was whitelisted.

Before any supplemental grant, the verifier supplied the **retained source cluster
identifier** as an intentionally wrong target identifier to SQL running **only on the
guarded clone**. It received expected SQLSTATE **42501**. Complete schema comparison
confirmed no change after rejection. No SQL write was sent to the retained source.

The correctly bound schema supplement restored exactly eight historical USAGE entries
on graphql/graphql_public, preserving supabase_admin grantor and postgres grant option.
The environment supplement restored exactly five reviewed database grants and two
protected database settings, preserving the captured owner/grantors/options and settings
hashes. Their values stayed private. Both successful applications exited zero and
matched their full expected metadata. No RLS relaxation, queue_private browser grant,
direct catalog edit or pg_init_privs rewrite was used.

## Exact historical comparison results

**All 71 table inventories/counts/canonical fingerprints matched: 824 logical rows.**
The complete catalog includes every empty table, the storage-free partitioned parent
and all eight physical daily leaves, October 14–21. All 70 TABLE DATA entries and eight
attachment entries were accounted for. Parent/leaf bounds, ancestry, ownership, ACLs and
index links matched. The `partitions` metadata section contains one ancestry entry per
table; its 71 entries do not mean there are 71 physical partitions.

| Exact schema/security category | Entries matched |
| --- | ---: |
| Schemas / relations / columns | 15 / 74 / 659 |
| Function definitions, owners and ACLs | 128 |
| Constraints / indexes / user triggers | 225 / 199 / 16 |
| Default privileges / policies / enum-domain types | 27 / 2 / 14 |
| Extensions | 5 |
| Publication table entries / publication definitions/options | 10 / 2 |
| Sequence definitions and states | 3 / 3 |
| Cluster roles / memberships | 31 / 25 |

All 15 captured schema/security sections matched, along with catalog, routing
constraint/trigger links, state/migration receipts, roles, additional database/sequence/
column/type ACLs/settings and ancillary-object inventory. Function comparisons include
the exact captured pg_get_functiondef hashes, covering bodies and definitions.
All six application migration receipts, including 006 once, matched. All five extension
versions/schemas/owners matched their snapshot prerequisites.

**There were no operational exemptions on the disconnected clone.** Its two historical
anonymous subscription rows and captured Realtime allocation state were restored
exactly, just like Auth/application/history rows and every other sequence. Historical
subscription rows are not proof of live connections or operational Realtime readiness.
The intentional destination name/cluster/network isolation differ; no final row,
privilege, owner, schema or captured database-setting discrepancy was accepted.

## Separate live-source FAIL and retained preservation

Live preflight and final comparison both found **70 tables**, leaves October 15–21,
with only the historical October 14 leaf missing. The exact known strict classifier
failure is recorded in `live_before` and `live_after`. Deletion-time emptiness remains
unproven; neither this clone nor its restored October 14 leaf changes that finding.
No live partition was recreated, policy changed or historical failure rewritten.

The independent within-run comparison found no new discrepancy under the existing
narrow Realtime scope. That before/after observation is separate from the continuing
historical-live FAIL; it is not a replacement baseline or current recovery approval.
The inherited `databases.postgres.source_preservation` and dump exit/fence fields in
the new evidence describe **the original 93426091 capture**, not a new dump or a passing
current-source comparison.

All 69 shared non-subscription live tables matched the historical source fingerprints.
Retained state remains 39 accounts/39 Auth users/26 identities, 20 terminal tickets,
57 events, 69 replay receipts, 32 audits, seven historical closed days and four staff
assignments. Zero active tickets/open days, fixed routes, counter availability and
Counter 5's stale STUDENT fixture remain intact. Six migrations/file hashes, all 15
application RLS controls, private-schema restrictions and the two-table application
publication remain unchanged. Live anonymous public subscriptions numbered two;
allocation was **408 at both ends**. Other sequences matched. No allocation cause
is attributed.

All eleven non-Vector services retained their identities, definitions, start times and
restart counts. Original Vector retained its ID/image/YAML/failing TCP definition and
known automatic restart loop; it was not repaired or operator-restarted. The Docker
inventory changed only by the exact new container and volume; existing networks and
all prior disposable/recovery resources were preserved.

Google remained disabled with unchanged nonsecret Auth settings. Credential-store
metadata was unchanged; its contents were never opened, hashed, decrypted or imported.
Vector/Google execution locks remained intact. **All 259 frozen input hashes** matched.

All **81 pre-existing backup files** retained their size/hash inventory digest:
`385138f0c3da32fca227d8511d527d679a96899e43d65cd8ec5142ad63f5a8f4`.
All three older verified recovery bundles again passed association/hash/protected-access
checks. The original 93426091 capsule and earlier failed clone/evidence were preserved;
their historical FAIL records were not converted into PASS. This report and the new
8543cd32 evidence provide the separate completed verification.

Read-only `_supabase` checks observed ongoing jobs/leases: the job sequence advanced
2,113 to 2,115, with job counts 1,011 then 1,012 and one peer at each observation.
Other compared Analytics rows/security/roles/settings matched the existing narrow
observation checks. No specific worker invocation is attributed. No Analytics dump,
restore, worker stop or operational fixture ran; Analytics recoverability remains
unverified and requires separate authorization.

## Tests, scope and recovery limits

| Check/group | Passed | Failed | Skipped/not performed |
| --- | ---: | ---: | --- |
| Existing recovery/preservation offline methods | 123 | 0 | 0 |
| Existing lifecycle/transport review methods | 17 | 0 | 0 |
| New historical-only security/binding methods | 14 | 0 | 0 |
| Actual historical table comparisons | 71 | 0 | 0 |
| Exact schema/security sections | 15 | 0 | 0 |
| Live wrong-target rejection and rollback check | 1 | 0 | 0 |
| Artifact, destination, source/service preservation and shutdown gates | PASS | 0 | 0 |
| Known historical-live pruning comparison | — | FAIL retained | Expected separate finding |
| Analytics backup/restore, new source backup, repair/provider acceptance | 0 | — | Outside authorization |

There are **154 final passing offline methods**, not 154 plus every repeated run.
Live table/section comparisons are separate coverage. The expected 42501 rejection is
a passing negative test. No mandatory historical recovery gate failed or was skipped.
Python syntax/new-file whitespace and Git diff whitespace checks passed. No second
Windows-user DPAPI, physical crash, frontend/build or operational service recovery
acceptance was claimed or newly run.

Created `supabase/tests/restore_historical_postgres_71.py` and
`supabase/tests/test_historical_postgres_71.py`, completed sanitized evidence, the new
protected verification directory, the identified stopped destination/volume and this
report. Existing combined recovery entry points, classifier, crypto/supplement/destination
implementations, old manifests/reports/evidence, product source, migrations, configuration,
dependencies, real environment files and credential/activation/repair helpers were retained.

The recovery unit is the complete bound historical capsule, prerequisites and new
verification evidence—not the archive alone. DPAPI is CurrentUser/profile/path-bound;
portable recovery after Windows profile/machine loss is not certified. Managed
plaintext exists in private process memory. Restored PGDATA in the retained Docker
volume is not encrypted by the artifact bridge and is accessible to Docker administrators.

Logical restoration does not recover global role passwords, external service credentials,
JWT/encryption/signing keys outside captured database settings, infrastructure configuration,
Storage object files, other databases/templates, WAL/PITR or replication-slot/consumer
continuity. This clone ran no Supabase/Auth/Analytics services; authentication, vault
decryption and service connectivity were not tested. No full operational or production
Supabase recovery claim follows from this database-level result.

**Historical snapshot recoverability: VERIFIED. Current-inventory recovery prerequisite:
NOT SATISFIED. Live-source pruning preservation: FAIL unchanged. Analytics recovery:
separate, unperformed work. Vector repair and Google activation: still locked.**
The new container is stopped and its volume/evidence must be preserved. Its initializer
refuses existing PGDATA; this report is not a resume or retained-target restore procedure.
Any later Analytics recovery, source backup, retained restoration, cleanup, Vector repair
or Google activation requires its own applicable authorization.

No retained SQL write, retained service stop/restart, live partition creation, provider
change, repair unlock, hosted Supabase contact, image pull, dependency installation,
backup/container/volume deletion, deployment, Git commit or push occurred.

**Stopped after successful isolated historical restoration, exact verification and
report generation.**
