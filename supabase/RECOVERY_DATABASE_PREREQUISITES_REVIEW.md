# Additional database recovery prerequisites — approval review

Status: explicitly approved by the user and validated only in the fresh isolated
database sq-restore-internal-67ff7d8e. Retained source unchanged; migration 006 unapplied.

The approved schema supplement contains only the eight source-manifest grants on
graphql/graphql_public. Broader database-level validation found these source
database privileges and settings absent from both the original manifest and archive.
They cannot be reconstructed by that eight-grant supplement.

| Database grantee | Source privileges | Grantor | Grant option |
| --- | --- | --- | --- |
| dashboard_user | CONNECT, CREATE, TEMPORARY | postgres | No |
| supabase_etl_admin | CREATE | postgres | No |
| supabase_storage_admin | CREATE | postgres | No |

Two database settings also exist: app.settings.jwt_secret and app.settings.jwt_exp.
Values are confined to a protected local proposal; no value is included here.

Proposed authorization: capture these prerequisites in a separate checksummed
recovery artifact, apply only to a newly verified network-disabled disposable
verification database, then compare exact database ACLs/settings and all existing
data/security checks. Preserve the source, original archive/manifest, prior restored
volumes and the eight-grant schema supplement. Do not change any hosted or retained
Auth service, configure Google, deploy or apply migration 006.

Protected proposal: .local-backups/20261016T135430Z_46a582fc/database_environment_proposal_v1.json

SHA-256: 8b8785cc42412f1760cda4542dd21f26e6c10e4645d2ad053636da7464af355e

The proposal contains sensitive local configuration. It is Git ignored and restricted
to the current Windows user and SYSTEM. Do not upload or print its contents.

Separate approval was necessary because the user's instruction, “Grant only the permissions
authorized by the original source manifest,” does not authorize these additional
database-level entries. The user answered “Authorize isolated prerequisite recovery.”
The separate protected environment SQL and its checksum are recorded in
tests/results/schema_privilege_recovery.json. Exact database ACL/settings comparison
passed without extending the eight-grant schema supplement.
