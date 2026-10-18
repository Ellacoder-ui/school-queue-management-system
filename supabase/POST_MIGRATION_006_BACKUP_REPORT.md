# Engineering report: six-migration database recovery bundle

Date: October 17, 2026. Result: **PASS — VERIFIED RECOVERABLE for the complete recorded
database-level bundle under the tested matching PostgreSQL platform.** A fresh archive
was actually restored into a new isolated cluster. All required comparisons passed.
The archive alone is not certified. No migration was applied or source record changed.

Run identity: **4c79fb00**. Execution: October 17, 00:33:19–00:34:22, UTC+08:00.

## Source identity and preserved baseline

| Item | Verified value |
| --- | --- |
| Project/workdir | school-queue-local / C:\Users\Hp\school-queue-management-system |
| PostgreSQL client endpoint | 127.0.0.1:54322/postgres |
| API | http://127.0.0.1:54321 |
| Server / cluster identifier | PostgreSQL 17.11 / 7696959712798593061 |
| Database container / volume | supabase_db_school-queue-local / supabase_db_school-queue-local |
| Gateway / network | supabase_kong_school-queue-local / supabase_network_school-queue-local |
| Migration history | Exactly 20261016000100 through 20261016000600; 006 recorded once |
| Fixed routing | 1:TP, 2:SOA, 3:PNEP, 4:REF, 5:ADJ |

Fresh read-only preflight matched the completed six-migration postvalidation's table
fingerprints, schema/security metadata, roles, sequences, staffing and routing.
All six SQL-file hashes match the validated copies. Both UNIQUE constraints, three
deferred constraint-trigger records, six trigger definitions/links and all 23
application function bodies remained correct. There were zero active tickets and
no open queue days. The authoritative business date was October 17 with the queue
day not open.

Historical comparison excludes only clock and the clock-derived current_day_closed
field; every queue-day row and other durable state still must match exactly. The
new manifest captures its own current state. No old five-version source-equality
command was used, and no historical evidence was overwritten or reinterpreted.

## New protected recovery artifacts

Directory:

`C:\Users\Hp\school-queue-management-system\.local-backups\post006_20261016T163319Z_4c79fb00`

The timestamp in the directory name is UTC. The local date is October 17.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| retained_postgres_after_006.dump | 530,803 | a265d14fbd85daf52ffefb26754cd893effb2f01bdbec092328ce78b511de80c |
| source_snapshot_manifest.json | 869,670 | 9304c08e1dd66b7867ffcf508acee8968e91b45d01babf4ed59bda5263a8e7a1 |
| roles_without_passwords.sql | 6,274 | 48aeb839a16374f00df55277ca1eab6d666a11eeaf0cd4fc9501918f144e4c06 |
| schema_privileges_recovery.sql | 6,295 | 3f2d86fe78ef43ed0b8c3fbeba3bce0583183e368616a2579c7fffb5dac40cec |
| database_environment_source.json | 2,440 | c68ef99f782b69431d2b2e326a1480fc32e315230e2c5f5e494d136cf50ea2f7 |
| database_environment_recovery.sql | 6,804 | 54f08268e0ace6ce2797e4f2250d51c8f5303328e66a5b7397552df58ea6a63b |
| recovery_bundle_manifest.json | 3,130 | a6b4d717c905b313abc99a62225daf8336684a6a13cf19a608e326a9eee0a5d9 |

The new format-2 source manifest was saved and hashed before pg_dump. It binds source
identity, six migration hashes, exported snapshot and archive filename, with complete
table inventories/counts/fingerprints, partition hierarchy, schema/security definitions,
roles, sequences, routing catalog, additional ACL/settings hashes and prerequisites.

The exporting repeatable-read, read-only transaction remained open throughout pg_dump
and role capture. Independent checks fenced non-MVCC roles/sequences and additional
privileges/settings before and after dumping. Post-dump source comparisons matched
the manifest.

pg_dump, pg_dumpall and pg_restore **18.6** all exited 0 without unexpected diagnostics.
The custom archive includes **69 logical tables, 68 physical TABLE DATA entries, one
storage-free realtime.messages parent and six partition attachments**. Every physical
table has data coverage; no extension-table omission was used. Global role definitions
were captured with --no-role-passwords, and the supplement contains no PASSWORD clause.

Fingerprints use the validated bounded 16-table aggregation and SHA-256 of canonical
UTF-8 JSONB containing a row object and column-ordered SQL-NULL bitmap. Sorted hashes
retain duplicates; empty tables are explicit. Identifiers are safely quoted, output
settings are pinned, and schema ownership/privileges compare by names rather than
cross-cluster catalog OIDs.

NTFS inheritance is disabled on the run directory. Only the current Windows user
and SYSTEM have access; artifact files inherit those restricted rules. Write/read
access was tested by the actual process, and Git exclusion/untracked status and
artifact ACLs were verified. These files are permission-protected, **not encrypted**.

## Source-derived recovery supplements

Supplements were regenerated from the new six-version manifest/capture and bound
to the new archive/manifest hashes. No five-version checksum was substituted.
Generation is deterministic and rejects missing/extra/invalid artifact bindings.

The schema supplement restores only the known eight missing USAGE entries on
graphql/graphql_public: anon, authenticated, service_role and postgres, with grant
option only for postgres and supabase_admin as grantor. Before grants, the complete
restored schema difference must be exactly that reviewed gap. It verifies owners,
roles, initial ACLs, expected destination cluster, Unix socket, disabled TCP and
archive/manifest bindings. Supported SET LOCAL ROLE reproduces grantor semantics.

The protected environment source and SQL restore only the reviewed database grants:
dashboard_user CONNECT/CREATE/TEMPORARY, supabase_etl_admin CREATE and
supabase_storage_admin CREATE, with postgres grantor and no grant option. Existing
owner/PUBLIC entries are checked exactly; no new PUBLIC privilege is granted.
The two reviewed local database settings are captured and restored, with exact hash
comparison. Their sensitive value is confined to protected artifacts and the clone.

No unrelated schema grant, queue_private access, RLS relaxation, direct system-catalog
write or pg_init_privs change was used. New runs cannot expand the reviewed privilege
or setting allowlists merely by supplying different checksums.

## Actual isolated restoration

| Item | Independently verified destination |
| --- | --- |
| Project/container | sq-restore-internal-4c79fb00 |
| Separate volume | sq-restore-internal-4c79fb00-data |
| Network / published ports | none / none |
| Connection / database | Docker exec, /tmp Unix socket / queue_restore_verify |
| PostgreSQL | 17.11, TCP listening disabled |
| Image | public.ecr.aws/supabase/postgres:17.11.0.004 |
| Image ID | sha256:6058a6759ab9268cff8ee70641d61f1bd75953316281b76427cf5a6b4db2eafc |
| Destination cluster identifier | 7697304722448076826 |
| Source cluster identifier | 7696959712798593061 |
| Final state | Stopped; complete restored volume retained |

New names/volume absence, labels, image, network namespace, mount and lack of host
ports, host binds or privileged mode were checked before SQL. The retained volume
was never mounted. Before restoration, the destination had only its bootstrap role,
postgres/template databases and zero application tables. Bundled Supabase migrations
were bypassed. The clone has no network route to the source or hosted Supabase.

Password-free roles were restored first, omitting only duplicate CREATE for the
existing bootstrap role while retaining all ALTER/GRANT statements. All 31 roles and
25 memberships matched. A new template0 database was created with owner postgres,
UTF8, ICU en-US and en_US.UTF-8 collation/ctype. Required extension versions and the
bootstrap-owned plpgsql template were verified.

Host pg_restore reconstructed the **entire** archive into single-transaction SQL.
Container psql 17.11 executed it through the fenced socket with ON_ERROR_STOP. No
object filtering, no-owner/no-ACL option, clean restore or migration application was
used. Reconstruction and full archive execution exited 0; both supplement executions
also exited 0 without unexpected warnings/errors.

A real negative target test supplied the source cluster identifier to the schema
supplement. It failed with expected SQLSTATE **42501** before grants, and the complete
schema metadata remained unchanged. Correct destination parameters then applied the
eight grants. Full schema comparison passed before applying the separate database
prerequisites; all explicit ACL/settings comparisons passed afterwards.

The restore order and artifact hashes are recorded in recovery_bundle_manifest.json.
Generated restoration SQL, prepared role SQL and diagnostic files remain protected
under restore_verification/ in the new directory. No restored data or archive was deleted.

## Integrity comparisons and test results

| Check/group | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Existing backup automation methods | 26 | 0 | 0 |
| Existing internal restore/fence methods | 10 | 0 | 0 |
| Existing schema/environment recovery methods | 14 | 0 | 0 |
| New six-version binding/comparison methods | 11 | 0 | 0 |
| Restored logical table comparisons | 69 | 0 | 0 |
| Semantic schema/security sections | 15 | 0 | 0 |
| Additional ACL/database-setting categories | 5 | 0 | 0 |
| Live wrong-cluster rejection/rollback | 1 | 0 | 0 |
| Required backup/restore/preservation gates | PASS | 0 | 0 |

There are **61 final passing offline methods**; repeated runs are not added together.
Table/section checks are reported separately. No mandatory live gate failed or was
skipped. An initial pre-run import check found an unterminated multiline string in
the new runner; it executed no backup/restore operation. After the user's instruction
to continue, quoting was corrected and all 61 methods passed before the live run.
That development error is retained here and not presented as a successful initial check.

All **69 table counts and canonical fingerprints matched**, covering **822 logical
rows**, including Auth users/identities, profiles, accounts, tickets/events, staff,
closed days, numbering allocators, replay/audit records and all six migration receipts.
The parent/leaf partition hierarchy and full table inventory matched.

All recorded security/object comparisons matched:

- 15 schemas, 72 relations, 639 columns and 128 function definitions/owners/ACLs.
- 221 constraints, 195 indexes, 16 user triggers and 27 default-privilege entries.
- Both routing UNIQUE constraints, three type-t deferred constraints and their exact
  links/events/functions, plus the three mutex statement triggers.
- RLS/policies, 14 enum/domain types and ACLs, three sequence definitions/ACLs/states,
  empty column-ACL inventory, all publication definitions/options and five extensions.
- All 31 roles and 25 memberships, including grantors and options; database owner,
  ACLs, connection flags/tablespace and both setting values via exact hashes.

The deliberate verification database name/cluster identity differ. Ownership and
privilege loss were not normalized as harmless. The public queue publication still
contains only counter_state/service_state, all 15 application tables retain RLS and
browser roles lack private schema access.

Python syntax and diff whitespace checks passed. Application pgTAP, HTTP/Realtime,
concurrency, browser/frontend and build suites were not rerun in this backup-only
task; their prior counts are not current recovery-test results.

## Final retained-source and historical-bundle preservation

Final read-only source comparisons matched the **new** manifest's complete rows,
schema/security metadata, roles, sequences, routing, prerequisites and explicit
ACL/database settings. Six migrations remain applied and routing remains 1:TP,
2:SOA, 3:PNEP, 4:REF, 5:ADJ. Final counts remain 39 accounts, 20 terminal tickets,
57 events, 69 replay records, 32 audits, seven closed days, five services/counters
and four staff assignments. No active ticket or source test fixture was created.

Original staff, including Counter 5's deliberately stale STUDENT assignment, counter
availability and historical ticket numbers/events remain unchanged. Source SQL was
read-only; no source grant, RLS, Auth setting, record, container or volume was changed.

The earlier directory `.local-backups/20261016T135430Z_46a582fc` and all eight recorded
five-version recovery artifacts were checked again for exact hashes and protected
access. They are intact and remain a separate verified historical recovery point.
Its source-equality expectations and evidence were not changed. Existing restored
volumes/containers were not replaced, reset or deleted.

## Files and recovery limitations

Created:

- supabase/tests/post_migration_006_backup.py — independent six-version run, snapshot,
  protected bundle, fenced isolated restore, exact comparisons and preservation.
- supabase/tests/test_post_migration_backup.py — eleven offline methods.
- supabase/tests/results/post_migration_006_backup_4c79fb00.json — sanitized completed evidence.
- supabase/POST_MIGRATION_006_BACKUP_REPORT.md — this report.
- The protected artifacts, restore SQL/diagnostics and new stopped container/volume above.

Modified:

- supabase/tests/schema_privilege_recovery.py — explicit validated new-run artifact
  bindings/checksum parameters; historical defaults and generated SQL remain compatible.
- supabase/tests/restore_local_backup_internal.py — explicit protected-directory/filename
  inputs for the existing ACL checker; default historical behavior retained.

No migration, application/frontend, package dependency, environment, prior report/evidence,
Auth provider, source policy/grant or original business data was modified. No hosted
Supabase project, migration command, reset, db push, link, Google configuration,
deployment, Git commit or push was involved.

**VERIFIED RECOVERABLE covers the full six-version database bundle under the matching
image, extension binaries, locale and preload prerequisites in the mapped verification
database.** It does not certify an operating Supabase API/Auth/Realtime/Storage service
deployment. Global role passwords, external provider/JWT/encryption secrets, storage
object files, other databases/templates, infrastructure configuration, WAL/PITR and
replication progress need separate protected recovery procedures. The copied local
database JWT setting requires coordination with future service recovery; its value
must remain private. Source large objects are zero; nonzero objects require additional
verification support.

The exact five extensions and owners were preserved: plpgsql 1.0, pgcrypto 1.3,
uuid-ossp 1.1, pg_stat_statements 1.11 and supabase_vault 0.3.1, owned by supabase_admin.
Auth services and decryption/service connectivity were not tested against this clone.
Docker administrators can access the retained restored volume. Archive/SQL files are
not encrypted. The initializer refuses existing PGDATA; restarting that entry point
is not a recovery/resume procedure. A real target restore needs separate review of
target guards and external service configuration, without restoring over retained data
automatically.

Evidence: [six-version recovery validation](tests/results/post_migration_006_backup_4c79fb00.json).

**Stopped after successful recovery verification. No migration was applied.**
