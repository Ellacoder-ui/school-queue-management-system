# Engineering report: verified database-level recovery bundle

Date: October 16, 2026. Result: **PASS — fresh isolated restoration and complete recorded
database-level integrity checks passed.** The recovery unit is the original archive,
password-free roles, exact schema supplement, separately approved database prerequisites,
and matching PostgreSQL platform. **The archive alone is not certified. Migration 006
remains unapplied.**

## Root cause and exact schema recovery

The source manifest and a fresh unsupplemented restore confirmed exactly eight missing
schema privileges:

| Schema | Grantee | Privilege | Grantor |
| --- | --- | --- | --- |
| graphql and graphql_public | anon | USAGE | supabase_admin |
| graphql and graphql_public | authenticated | USAGE | supabase_admin |
| graphql and graphql_public | service_role | USAGE | supabase_admin |
| graphql and graphql_public | postgres | USAGE WITH GRANT OPTION | supabase_admin |

Each schema has an extension-origin pg_init_privs record equal to its current ACL,
without current extension membership. The original archive has no ACL entry for
either schema. pg_dump calculated no difference from those initial privileges; the
bare destination lacked the platform initialization that supplied them. This was
independent of application migrations, Auth records and queue data. Prior failed
restore evidence remains unchanged in tests/results/retained_backup_internal_restore.json.

The new schema_privileges_recovery_v1.sql is generated from the immutable manifest
and allows only those two schemas, four grantees, USAGE, supabase_admin grantor and
the exact grant-option flags. It checks roles, schema owners and complete initial
ACLs before granting. Controlled SET LOCAL ROLE reproduces the grantor; a transactional
postcondition compares the complete resulting ACLs with the manifest.

The file also binds archive/manifest hashes, rejects the source cluster identifier,
requires the explicitly supplied disposable cluster identifier, and checks the
verification database, restoration role, Unix socket and disabled TCP listening.
A real wrong-cluster test failed with expected SQLSTATE 42501 before any grant,
and metadata remained unchanged. No queue_private grants, PUBLIC grants, RLS changes,
system-catalog writes or pg_init_privs edits were performed.

## Separately approved database prerequisites

Broader inspection added explicit sequence/column/type/database ACL checks. It found
five database grants and two database settings absent from the original archive and
manifest. Before applying them, the user reviewed the proposal and explicitly answered
**“Authorize isolated prerequisite recovery.”**

| Database grantee | Source privileges restored | Grantor / grant option |
| --- | --- | --- |
| dashboard_user | CONNECT, CREATE, TEMPORARY | postgres / none |
| supabase_etl_admin | CREATE | postgres / none |
| supabase_storage_admin | CREATE | postgres / none |

The existing default owner/PUBLIC entries were checked exactly and retained; no new
PUBLIC privilege was granted. A separate database_environment_recovery_v1.sql restores
only the approved entries and the two local database settings. SET LOCAL ROLE postgres
preserves database grantor identity. Database ownership, privileges, connection flags,
tablespace and setting hashes then matched the source.

One setting is sensitive. Its value exists only in the protected proposal/environment
SQL and the isolated database, never in this report, source code, test evidence or
public bundle manifest. No retained or hosted Auth service configuration changed.

## Artifacts and checksums

Protected, Git-ignored directory:

C:\Users\Hp\school-queue-management-system\.local-backups\20261016T135430Z_46a582fc

| Artifact | SHA-256 |
| --- | --- |
| retained_postgres_before_006.dump | 7df177a07d74617057d1f518e92588fa19de3452c3f1a64c9e26f84b62ac259e |
| source_snapshot_manifest.json | df786c0e63034692d8416244e4eab5c887dd9cd06b3747026ac0dc254ed7d67f |
| roles_without_passwords.sql | 882a23b88288987a5fdddcc6082fff2bccf8cfd63023692b8b743f6066b6eee3 |
| schema_privileges_recovery_v1.sql | ff293d31a018deca0bef619d610abc6789044bfd6dd530e9840381079ab00161 |
| database_environment_recovery_v1.sql | 2e01815187ec6d2800098af04bc6b5c2a5eb001df6837137db3cdcd4d9420368 |
| database_environment_proposal_v1.json | 8b8785cc42412f1760cda4542dd21f26e6c10e4645d2ad053636da7464af355e |
| additional_privileges_baseline_v1.json | 057991cb2a02bb6a60d07a7501f54f765c7bdb50e23437eee71b2b6ff476e69f |
| schema_privileges_recovery_v1.json — recovery-order/checksum manifest | d07b80bacdabf46e26ba51b4f38552870ca9043713ac3ea5db191f91c48f71fb |

The original three files remain byte-for-byte unchanged: archive 521,959 bytes,
snapshot manifest 845,474 bytes, roles 6,274 bytes. Schema SQL is 6,365 bytes;
environment SQL is 6,864 bytes. Original snapshot identity and all supplemental
associations/checksums were reverified. Generated SQL must match the reviewed generator
exactly; arbitrary substitute SQL or different artifact associations are rejected.

The additional privilege baseline is a separate checksummed capture; the original
manifest was not rewritten to conceal its coverage gap. Source data/schema/roles/
sequence fingerprints matched the original snapshot throughout. Extra privileges
and database settings were captured and rechecked separately against the unchanged
source.

NTFS access remains limited to the current Windows user and SYSTEM. The original
directory has inheritance disabled; artifact files inherit its restricted rules.
Git exclusion/untracked status was checked. Files are permission-protected, not
encrypted. Preserve the entire bundle and its prerequisites.

## Fresh disposable environment and execution

| Item | Verified identity |
| --- | --- |
| Project/container | sq-restore-internal-67ff7d8e |
| New volume | sq-restore-internal-67ff7d8e-data |
| Network / host ports | none / none |
| PostgreSQL socket / database | /tmp / queue_restore_verify |
| Server | PostgreSQL 17.11 |
| Image | public.ecr.aws/supabase/postgres:17.11.0.004 |
| Image ID | sha256:6058a6759ab9268cff8ee70641d61f1bd75953316281b76427cf5a6b4db2eafc |
| New cluster identifier | 7697284734973001755 |
| Retained source identifier | 7696959712798593061 |
| Final state | Stopped; full restored volume retained |

Container name/label, image ID, new volume, isolated namespace, socket, cluster identity
and absence of host mounts/privileged mode were checked before SQL. PostgreSQL does
not listen on TCP. The destination cannot route to the retained database or hosted
Supabase. Previous failed containers/volumes and all archives remain intact.

The fresh cluster initially had no application tables. Password-free role preparation
omitted only duplicate CREATE of the bootstrap role and retained all ALTER/GRANT
statements. Database creation used template0, source owner postgres, UTF8, ICU en-US
and en_US.UTF-8 collation/ctype. Source extension versions/owners and matching binary
prerequisites were verified.

Host pg_restore 18.6 reconstructed the complete custom archive into transactional SQL;
container psql 17.11 executed it through the Unix socket with ON_ERROR_STOP.
Archive reconstruction, full SQL restore, schema supplement and approved prerequisite
restore all exited **0**, without unexpected SQL errors or warnings. No archive
filtering, clean restore, no-owner/no-ACL option, security relaxation or data reset
was used.

## Required restore order

1. Verify original/supplement hashes, protected access, source association and a
   separately identified disposable destination.
2. Prepare matching PostgreSQL image/extensions, bootstrap owner, locale and preload
   prerequisites.
3. Restore password-free global roles/memberships.
4. Create the new verification database from template0 with the source owner/locale.
5. Restore the complete archive transactionally.
6. Verify all data and that the schema gap is exactly the eight approved entries.
7. Apply the schema privilege supplement with the new target cluster identifier and
   pinned archive/manifest hash parameters.
8. Apply the separately approved database prerequisite artifact.
9. Compare all data, schema/security metadata, explicit ACL inventories, settings,
   global roles, sequences, partition hierarchy and migration history.
10. Recheck original-source preservation and artifact hashes, then stop only the
    disposable container and retain its data.

The current runner refuses overwriting completed artifacts/evidence. Repeating a full
restore requires a reviewed fresh run identity; do not restart the initializer on
an existing PGDATA or reset retained data to force a rerun.

## Verification results

| Validation | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Existing backup automation methods | 26 | 0 | 0 |
| Internal restore/fence methods | 10 | 0 | 0 |
| New schema/environment recovery methods | 14 | 0 | 0 |
| Restored logical table comparisons | 69 | 0 | 0 |
| Original semantic schema sections | 15 | 0 | 0 |
| Extra ACL/settings categories | 5 | 0 | 0 |
| Live wrong-cluster rejection and rollback | 1 | 0 | 0 |

There are **50 passing unit methods**; table/section comparisons are reported separately.
All 69 table counts and canonical fingerprints matched, covering 819 rows in this
logical inventory. realtime.messages and all six leaves matched. The empty column-ACL
inventory matched; all three sequence ACLs and fourteen enum/domain ACLs matched.

Complete recorded checks also include:

- 15 schemas, 72 relations, 639 columns, 124 function definitions/owners/ACLs,
  216 constraints, 193 indexes, 10 user triggers and 27 default-privilege entries.
- RLS/policies, types, all publication definitions/options, five installed extension
  versions/schemas/owners, three sequence states, 31 roles and 25 memberships.
- Database owner/ACLs/connection flags/tablespace and the two setting values via
  exact hashes; only the intentional verification-database name differs.
- Auth users/identities, accounts/profiles, tickets/numbers, events, days, allocators,
  staff assignments, administrative audits and idempotency receipts.
- Exactly five application migration versions; migration 006 absent.

One development-time offline test initially found incomplete validation of preexisting
database ACL entries. Full ACL validation was tightened; the test was retained and
passed before restore SQL ran. No live required check failed in the completed run.
Expected SQLSTATE 42501 belongs to the passing negative target test.

Python syntax and diff whitespace checks passed. Prior frontend, pgTAP, HTTP/Realtime,
concurrency and build suites were not rerun or added to these counts; no application
change required them.

## Retained-source preservation

Retained identity: school-queue-local, API http://127.0.0.1:54321,
PostgreSQL 127.0.0.1:54322/postgres, server 17.11,
volume supabase_db_school-queue-local and network supabase_network_school-queue-local.
All source SQL was read-only.

Final state remains 39 accounts, 20 terminal tickets, 57 events, 69 replay records,
31 audits, seven closed days, five services/counters and four staff assignments.
Counters 1/2 still each have SOA+TP; Counters 3/4/5 remain unmapped. Counter 5's stale
STUDENT fixture assignment is unchanged. Zero WAITING/CALLED tickets remain.

All 69 source fingerprints, captured schema metadata, roles, sequences and additional
privileges/settings matched their baselines. All 15 application tables retain RLS;
browser roles lack queue_private usage; the public queue Realtime publication still
contains only counter_state/service_state. No original migration, source record,
Auth credential/provider setting, source ACL, retained container/network or volume
was changed.

## Files and recovery limits

Created:

- supabase/tests/schema_privilege_recovery.py — exact manifest-based generation,
  approved prerequisite handling, protected bundle, fresh restore orchestration and checks.
- supabase/tests/test_schema_privilege_recovery.py — fourteen offline methods.
- supabase/tests/results/schema_privilege_recovery.json — completed sanitized evidence.
- supabase/RECOVERY_DATABASE_PREREQUISITES_REVIEW.md — proposal and explicit approval record.
- Protected SQL/bundle/proposal/additional-baseline artifacts listed above, new restore
  SQL/diagnostics and the new disposable container/volume.

Modified:

- supabase/tests/restore_local_backup_internal.py — optional ACL-check paths, restricted
  recovery parameters, captured database owner and post-archive hook; default behavior retained.
- supabase/tests/results/retained_backup_validation.json — current bundle certification.
- supabase/RETAINED_LOCAL_BACKUP_VALIDATION_REPORT.md — this report.

No application/frontend, dependency, .env, Auth provider, RLS or SQL migration file
changed. No hosted endpoint, reset, db push, link, Google configuration, deployment,
record/volume deletion, Git commit or push occurred.

**VERIFIED RECOVERABLE** applies to the complete recorded database recovery bundle
under the tested matching platform and mapped verification database. It is not a
full Supabase-service or production-readiness certification. Global role passwords,
external Auth/provider/JWT configuration, storage object files, external encryption
keys, Docker/PostgreSQL infrastructure and replication-slot progress need separate
protected recovery procedures. Existing Auth services were not started against this
clone. Source large objects are zero; nonzero objects need additional verification.
The copied local database JWT setting must remain protected and coordinated with any
future service recovery. Docker administrators can access the restored volume.

The backup gate is now satisfied for **separately authorized retained-local migration
006 review**. Before a future cutover, verify the source still matches, refresh backup
evidence if business state changes, repeat zero-active-work/identity/migration checks,
and obtain separate explicit approval. This task did not apply migration 006.

Evidence: [completed schema/prerequisite recovery](tests/results/schema_privilege_recovery.json)
and [summary](tests/results/retained_backup_validation.json).

Read-only artifact/source recheck:

~~~powershell
python supabase/tests/schema_privilege_recovery.py verify
~~~

This command does not repeat the restore or restart a container. **Stopped after
successful recovery validation. Awaiting the next instruction.**
