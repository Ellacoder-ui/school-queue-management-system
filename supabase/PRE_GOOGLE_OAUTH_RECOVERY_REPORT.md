# Step 22.6: pre-Google OAuth database recovery verification

October 17, 2026. **PASS — the new complete database recovery bundle is VERIFIED
RECOVERABLE under the matching tested PostgreSQL platform.** Actual restoration and
every required comparison passed. The archive alone is not the recovery unit.

Run **6e3beebe**, October 17, **14:38:56–14:40:26 UTC+08:00**. The retained services
were not restarted. Google remains disabled; no migration or business/Auth mutation
was requested or performed.

## Source identity and preflight

| Item | Verified retained value |
| --- | --- |
| Project / workdir | school-queue-local / C:\Users\Hp\school-queue-management-system |
| PostgreSQL / API | 127.0.0.1:54322/postgres / http://127.0.0.1:54321 |
| Server / cluster identifier | PostgreSQL 17.11 / 7696959712798593061 |
| Database container / volume | supabase_db_school-queue-local / supabase_db_school-queue-local |
| Gateway / network | supabase_kong_school-queue-local / supabase_network_school-queue-local |
| Migrations | Exactly 20261016000100 through 20261016000600; all six file hashes unchanged |
| Pending migrations | None; only the six reviewed SQL files exist |
| Permanent routing | 1:TP, 2:SOA, 3:PNEP, 4:REF, 5:ADJ |
| Application security | All 15 application tables retain RLS; browser roles lack queue_private USAGE |
| Application publication | Only queue_display.counter_state and service_state |
| Work | Seven closed days, zero WAITING/CALLED tickets, no open queue day |

Preflight compared the current source to the immutable Step 22.5 evidence and the
reviewed six-version historical baseline using the existing strict Realtime classifier.
It also verified existing recovery artifacts, current roles/permissions, staffing,
Auth settings and platform identities. No unexpected difference was found.
Initial evidence: [read-only inspection](tests/results/local_google_provider_preparation_f93aeb15.json).

The database image is public.ecr.aws/supabase/postgres:17.11.0.004. Its image ID
matches the restoration image recorded below. The new protected manifest also records
the retained Kong, Auth and Realtime image tags/IDs and volume inventory. Auth remains
public.ecr.aws/supabase/gotrue:v2.197.0 and Realtime remains
public.ecr.aws/supabase/realtime:v2.143.4, with their reviewed image IDs.

The actual local Auth settings endpoint reported Google disabled throughout. Site URL
remains http://127.0.0.1:3000 and its additional redirect allowlist remains
https://127.0.0.1:3000. Neither was corrected in this backup task. Config.toml and
effective nonsecret Auth settings were checked unchanged. All source database sessions
used the exact loopback endpoint, read-only libpq defaults and read-only transactions.
Existing host bindings were not reconfigured.

## New protected recovery bundle

Directory, using a UTC timestamp:

`C:\Users\Hp\school-queue-management-system\.local-backups\pre_google_20261017T063856Z_6e3beebe`

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| retained_postgres_after_006.dump | 534,420 | 075b3cb3a433031f3c3a46b54b5a97ce642c4996bcc3d62f87834c61c81d5207 |
| source_snapshot_manifest.json | 883,825 | f769880e6098c435daa3e7bcb40cfad981526c4762e65c4e395e09a7c3af8131 |
| roles_without_passwords.sql | 6,274 | b9aca14540590fd9bfa971a6e2daeab62895dbbef88606fde83284fb56ab8b02 |
| schema_privileges_recovery.sql | 6,295 | c1a6ac1bc0d86b0bf3b932350816af0595b55eef986f6a02b0b13dae387db0d0 |
| database_environment_source.json | 2,447 | 9c86525dd92c3be7a120c8e20b3b077453051126639e434698be8c261a3a44c0 |
| database_environment_recovery.sql | 6,804 | 78f3e986da92c985a9d4ce1d0d67a4bc8ab1956c2498099c9a68d096e30422ec |
| recovery_bundle_manifest.json | 3,138 | 50164d4afb5083a83044f5ee3df3d13b1b2002ba29ee03143e460c181b915a52 |

The directory has NTFS inheritance disabled, with access restricted to the current
Windows user and SYSTEM. The actual process passed a write/read probe. Artifact ACLs,
Git exclusion and untracked status passed. Archives and generated SQL contain sensitive
Auth/private data and are permission-protected, **not encrypted**. No credential,
password hash, JWT value or raw private row appears in this report.

Additional protected files include the archive TOC, access probe and
restore_verification/ SQL/diagnostics. Preserve the entire bundle, including its
source-derived prerequisites and matching platform information.

## Consistent snapshot and archive coverage

The format-2 manifest was saved and hashed **before pg_dump**. It binds the new run,
source identity, migration hashes, exported repeatable-read snapshot and archive
filename. It includes every table fingerprint/catalog entry, partition topology,
schema/security section, roles, sequences, explicit additional ACLs/settings hashes,
exact routing constraint/trigger links, service images and environment prerequisites.
No historical manifest or source baseline was rewritten.

The read-only exporting transaction stayed open through dump and role capture.
Independent before/after checks required exact roles, privileges/settings and sequence
states during dumping, including the Realtime allocation sequence: non-MVCC values
were not assumed to be protected by the exported snapshot.

pg_dump, pg_dumpall and pg_restore were **18.6**. Custom archive creation, password-free
role capture and pg_restore --list all exited **0**, without unexpected diagnostics.
No table/schema filter or data exclusion was used. PostgreSQL documents exported
snapshots and custom archives; this specific 18.6 output was actually restored into
the matching 17.11 image rather than assumed compatible.
[pg_dump reference](https://www.postgresql.org/docs/18/app-pgdump.html).

Archive completeness verified:

- **70 logical tables**, including all application, Auth, Storage, platform and six
  application migration-history rows.
- **69 physical tables and 69 TABLE DATA entries**, including empty physical tables.
- One storage-free parent, realtime.messages, with its DDL/key and all **seven TABLE
  ATTACH entries**, covering October 14–20 daily leaves.
- Complete extension prerequisites; no extension-table data omission was used.

Partitioned parents have no independent table storage. Parent and leaf inventories,
bounds, ancestry and logical fingerprints are still required to match after restore.
[PostgreSQL partitioning](https://www.postgresql.org/docs/17/ddl-partitioning.html).

Fingerprints retain the validated bounded 16-table aggregation. Each row hashes
canonical UTF-8 JSONB containing its row object and column-ordered SQL-NULL bitmap;
sorted hashes preserve duplicate multiplicity. Empty tables explicitly record zero
and an empty hash list. Identifiers are quoted, formatting/search_path are pinned,
and ownership/ACL comparisons resolve role names rather than cross-cluster OIDs.

## Actual independent restoration

| Item | Verified new destination |
| --- | --- |
| Project/container | sq-restore-internal-6e3beebe |
| New volume | sq-restore-internal-6e3beebe-data |
| Network / published ports | none / none |
| PostgreSQL connection | Docker exec, /tmp Unix socket; TCP listening disabled |
| Database | queue_restore_verify |
| Server / cluster identifier | PostgreSQL 17.11 / 7697522720582377498 |
| Image | public.ecr.aws/supabase/postgres:17.11.0.004 |
| Image ID | sha256:6058a6759ab9268cff8ee70641d61f1bd75953316281b76427cf5a6b4db2eafc |
| Final state | Stopped; full restored volume retained |

Names/volume absence were checked before creation. Container name/label, exact image,
new volume mount, network namespace, disabled TCP and distinct cluster identifier
were checked before database operations. There were no host binds, Docker-socket
mount, published ports or privileged mode. The destination initially contained only
the bootstrap role, template/postgres databases and zero application tables. No
retained volume was mounted; the clone had no network route to the source or hosted
Supabase. Bundled platform initialization was bypassed.

Restore order, also recorded in the checksummed bundle manifest:

1. Verify protected artifact hashes, source binding and new destination identity.
2. Prepare the matching PostgreSQL image, preload libraries, UTF8, ICU en-US and
   en_US.UTF-8 collation/ctype; verify extension availability and bootstrap ownership.
3. Import password-free roles/memberships, omitting only duplicate CREATE of the
   existing bootstrap role. Retain all ALTER/GRANT statements.
4. Create the verification database from template0 with source owner postgres/locale.
5. Reconstruct the entire archive with pg_restore --exit-on-error --single-transaction,
   then execute it with container psql 17.11 through the guarded Unix socket,
   ON_ERROR_STOP enabled. No clean/filter/no-owner/no-ACL option was used.
6. Verify all rows and the exact known prerequisite gaps, then apply the bound schema
   and database supplements only in that destination.
7. Compare every captured integrity section exactly, recheck source/artifacts, stop
   only the new disposable container and retain all data.

Archive reconstruction, full SQL execution, role import and both supplements exited
**0** with no unexpected SQL error or warning. SQL-script reconstruction followed by
actual psql execution is a supported pg_restore workflow.
[pg_restore reference](https://www.postgresql.org/docs/18/app-pgrestore.html).

## Exact privilege recovery and comparisons

The manifest-derived schema supplement restored only the known eight USAGE entries
on graphql/graphql_public: anon, authenticated, service_role and postgres, with grant
option only for postgres and grantor supabase_admin. The full unsupplemented difference
had to equal that exact gap. The separate environment artifact restored only the five
reviewed database grants, preserving postgres grantor and existing PUBLIC entries,
plus the two reviewed local database settings. Sensitive setting values remained in
protected artifacts and the clone; comparisons use exact hashes.

The generators retain strict schema/grantee/privilege/setting allowlists and
archive/manifest/target bindings. No unrelated permission, queue_private browser
access, RLS relaxation or direct catalog/pg_init_privs write was used. A live negative
test supplied the source cluster identifier to the supplement and received expected
SQLSTATE **42501** before grants; complete schema metadata confirmed rollback.

All **70 table counts and canonical fingerprints matched**, totaling **824 logical
rows**. The two anonymous public subscription rows are included in that count. Every
restored table, including realtime.subscription, and all sequence states had to match
the snapshot exactly: **there are no Realtime exemptions on the restored clone**.

All recorded object/security comparisons matched:

- 15 schemas, 73 relations, 649 columns and 128 function definitions/owners/ACLs.
- 223 constraints, 197 indexes, 16 user triggers and 27 default-privilege entries.
- Both fixed-routing UNIQUE constraints, three deferred type-t constraint records
  with exact trigger links, and all six routing triggers/functions/events.
- RLS/policies, 14 enum/domain types and ACLs, three sequence definitions/ACLs/states,
  empty column-ACL inventory and both publication definitions/options.
- 31 roles and 25 memberships, including grantors/options; database owner, privileges,
  connection flags, tablespace and settings hashes.
- Parent/all seven leaves, bounds/ancestry, column grants and effective denied browser
  table privileges; source leaf security settings were preserved exactly.
- All five extension versions/schemas/owners: plpgsql 1.0, pgcrypto 1.3, uuid-ossp 1.1,
  pg_stat_statements 1.11 and supabase_vault 0.3.1, owned by supabase_admin.
- Exactly six application migration receipts, with migration 006 present once.

The intentional destination database name, cluster identifier and network/service
configuration differ. Global role passwords are excluded from this recovery unit.
No final row, ownership, privilege, schema or captured database-setting discrepancy
was accepted as an environment difference. The known initial privilege gaps were
repaired through the verified supplements, not whitelisted.

## Tests and checks

| Group | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Existing backup automation methods | 26 | 0 | 0 |
| Existing internal restore/fence methods | 10 | 0 | 0 |
| Existing schema/environment recovery methods | 14 | 0 | 0 |
| Existing six-version binding/comparison methods | 11 | 0 | 0 |
| Existing strict Realtime preservation methods | 24 | 0 | 0 |
| New 70-table recovery methods | 16 | 0 | 0 |
| Restored logical table comparisons | 70 | 0 | 0 |
| Semantic schema/security sections | 15 | 0 | 0 |
| Additional ACL/database-setting categories | 5 | 0 | 0 |
| Live wrong-target rejection/rollback | 1 | 0 | 0 |
| Required backup/restore/source/historical-preservation gates | PASS | 0 | 0 |

There are **101 final passing offline methods**. Table/section comparisons are
separate coverage, not added to that unit-test count. No mandatory live gate failed
or was skipped. Python syntax and whitespace checks passed.

The initial offline run reported one error in a new negative test: missing platform
scope evidence raised KeyError instead of a sanitized preservation exception. The
new wrapper now explicitly rejects missing evidence. All 101 methods passed before
any backup/restore operation. The historical classifier and its security assertions
were not weakened. Repeated executions are not counted twice.

Application pgTAP, HTTP/Realtime/browser acceptance, concurrency, frontend tests and
build were **not run in this backup-only task**. Their earlier results are not new
recovery evidence. No real Google login or provider credential intake occurred.

## Final source and historical artifact preservation

The final source remained at 70 logical tables, with no new partition during the
recovery run. All business/Auth/application/history fingerprints and security metadata
matched. Fixed routing, four staff assignments including Counter 5's stale STUDENT
fixture, counter availability, ticket numbers, allocators, audit/replay records and
six migration receipts remain unchanged.

Final counts: **39 accounts, 39 Auth users, 26 Auth identities, 20 terminal tickets,
57 events, 69 replay records, 32 audits, seven closed days and zero active tickets**.
All 15 application tables retain RLS; the public application publication still has
only the two sanitized display tables. No provider, privilege or Auth setting changed.

Only the previously reviewed Realtime operational scope is allowed when comparing the
running source: anonymous unfiltered public-display subscriptions, nondecreasing
subscription allocation state, and exact reviewed empty daily partition additions.
Every other field remains strict; there is no realtime-schema exclusion. The initial
read-only inspection observed allocation 296; run preflight observed 298. The exported
snapshot and final preservation both recorded **298**, with two scoped subscriptions.
No sequence or table change was observed between that snapshot and final check. No
specific background allocation cause is claimed.

Both historical verified recovery points remain separate and intact:

- Five-version bundle: .local-backups/20261016T135430Z_46a582fc.
- Six-version 69-table bundle: .local-backups/post006_20261016T163319Z_4c79fb00.

Their associations/hashes/ACLs passed before and after. Additionally, **all 38
pre-existing backup files** retained their exact size/hash inventory. The complete
historical file-tree digest remained
bf7e862fb7d6cbd57e4557c6aa0e0ad665f35fe47c912cb6123ffbad383707d0.
All 157 captured existing report/evidence/code/configuration inputs retained their
hashes during execution. No historical snapshot, report or runner was rebased or
overwritten. No source container/network/volume was stopped, reset or replaced.

## Files, limitations and decision

Created:

- tests/pre_google_oauth_recovery.py — independent run identity, strict current
  inventory and exact clone comparison, reusing the tested fenced restore primitives.
- tests/test_pre_google_recovery.py — sixteen offline regression methods.
- tests/results/pre_google_oauth_recovery_6e3beebe.json — completed sanitized evidence.
- tests/results/local_google_provider_preparation_f93aeb15.json — initial read-only check.
- This report, the new protected artifacts and the identified stopped clone/volume.

Paths above are relative to supabase/. No existing application, migration, dependency,
environment/provider setting, policy/grant, recovery artifact or backup runner changed.

**The fresh database recovery prerequisite for Google OAuth activation is satisfied
for the recorded 70-table state.** The recovery unit is the complete bundle and its
matching image/extensions/locale/preload prerequisites. This is not an operational
Supabase API/Auth/Realtime/Storage service or production recovery certification.
Global role passwords, external provider/JWT/encryption secrets, storage object files,
other databases/templates, infrastructure configuration, WAL/PITR and replication
progress require separate protected procedures. Source large objects are zero;
nonzero large objects need additional verification support. Auth services and vault
decryption/service connectivity were not started/tested against this clone. Restored
subscription rows are historical connection metadata, not proof of live readiness.
Docker administrators can access the restored data; local artifacts are not encrypted.

Preserve the stopped volume. Its initializer refuses existing PGDATA and is not a
resume procedure. Any real target restoration needs separate target/configuration
review; never automatically restore over the retained database.

Google client saved-field verification and protected credential preparation remain
their separate gates in the activation plan. This task did not authorize or perform
provider activation/restart. Recheck source identity/state and artifact integrity
before a later approved infrastructure change; later material state requires a new
reviewed recovery point. No migration, reset/push/link, hosted Supabase contact,
administrator promotion, ticket issuance, deployment, backup/volume deletion, Git
commit or push occurred.

Executed live command:

```powershell
python -B supabase/tests/pre_google_oauth_recovery.py --run
```

This command creates a fresh recovery run; it is not a read-only verifier or a resume
command. Do not rerun it merely to open the existing evidence.

Evidence: [completed recovery run](tests/results/pre_google_oauth_recovery_6e3beebe.json).
Evidence SHA-256:
e1cdfd117369f4469b2b74a1f66ad520d664b848e8452b1009e782ec06d78784.

**Stopped after successful recovery verification and report generation. Google
remains disabled. Awaiting the next instruction.**
