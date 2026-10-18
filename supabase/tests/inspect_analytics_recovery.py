"""Step 22.8D read-only assessment. No dump, restore, service or credential path.

Private rows/defaults/settings are reduced in memory to counts and digests. The
existing postgres recovery gate remains strict and is never rebased by this tool.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import re
import subprocess
import sys
import uuid

import diagnose_vector_health as base
import validate_vector_socket as fences
import schema_privilege_recovery as privileges

ROOT = base.ROOT
CLUSTER = '7696959712798593061'
SCOPE = "n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp_%'"


def need(value, code):
    if not value:
        raise RuntimeError(code)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def validate_identity(identity):
    # The server sees its bridge address; libpq is pinned to host loopback below.
    need(identity['database'] == '_supabase' and identity['cluster'] == CLUSTER and
         identity['version_num'] == 170011 and identity['read_only'] == 'on' and
         identity['recovery'] is False, 'VAR_DATABASE_IDENTITY')


def alias(name):
    # Log table suffixes identify sources, not useful public report labels.
    return 'log_events_<source-' + digest(name)[:12] + '>' if name.startswith('log_events_') else name


def validate_discovery(items, compose_ids, canonical_names):
    # A Compose-only extra or a canonically named but unlabeled project object
    # must not disappear from the stricter twelve-container review downstream.
    need(len(compose_ids) == len(set(compose_ids)) and set(compose_ids) == {x['Id'] for x in items}, 'VAR_PROJECT_DISCOVERY')
    need(set(canonical_names) == {x['Name'].lstrip('/') for x in items}, 'VAR_PROJECT_DISCOVERY')


def project_items():
    items = base.project_items()
    code, output, _ = base.run(['docker', 'ps', '-a', '--no-trunc', '--filter',
        'label=com.docker.compose.project=' + base.PROJECT, '--format', '{{.ID}}'])
    need(code == 0, 'VAR_PROJECT_DISCOVERY')
    compose_ids = output.splitlines()
    code, output, _ = base.run(['docker', 'ps', '-a', '--format', '{{.Names}}'])
    need(code == 0, 'VAR_PROJECT_DISCOVERY')
    canonical = [name for name in output.splitlines() if name.startswith('supabase_') and name.endswith('_' + base.PROJECT)]
    validate_discovery(items, compose_ids, canonical)
    return items


def capture():
    _, env, _ = base.backup.target()
    need(env.get('PGHOST') == '127.0.0.1' and str(env.get('PGPORT')) == '54322', 'VAR_LOOPBACK')
    env['PGDATABASE'] = '_supabase'
    with base.backup.Snapshot(env) as s:
        s.raw("set local statement_timeout='20s'; set local lock_timeout='2s';")
        q = s.query
        identity = q("""select jsonb_build_object('database',current_database(),
          'cluster',(select system_identifier::text from pg_control_system()),
          'version_num',current_setting('server_version_num')::int,
          'read_only',current_setting('transaction_read_only'),'recovery',pg_is_in_recovery(),
          'database_bytes',pg_database_size(current_database()),'encoding',pg_encoding_to_char(d.encoding),
          'collation',d.datcollate,'ctype',d.datctype,'locale_provider',d.datlocprovider::text,
          'locale',coalesce(to_jsonb(d)->>'datlocale',to_jsonb(d)->>'daticulocale'))
          from pg_database d where datname=current_database()""")
        validate_identity(identity)
        catalog = base.backup.table_catalog(q)
        need(catalog and all(t['kind'] != 'f' for t in catalog), 'VAR_EXTERNAL_TABLE_REVIEW')
        relations = q("""select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,
          'kind',c.relkind::text,'owner',pg_get_userbyid(c.relowner),'persistence',c.relpersistence::text,
          'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'partition',c.relispartition,
          'heap_bytes',pg_relation_size(c.oid),'total_bytes',pg_total_relation_size(c.oid),
          'index_bytes',pg_indexes_size(c.oid)) order by n.nspname,c.relname),'[]')
          from pg_class c join pg_namespace n on n.oid=c.relnamespace where """ + SCOPE + " and c.relkind in ('r','p','m')")
        need(sum(x['total_bytes'] for x in relations) <= 32 * 1024 * 1024, 'VAR_READ_BUDGET')
        raw_rows = base.backup.all_rows(q)
        rows = {k: {'count': v['count'], 'sha256': digest(v['rows'])} for k, v in raw_rows.items()}
        metadata = base.backup.schema_metadata(q)
        roles = base.backup.role_metadata(q)
        extra = privileges.additional_privileges(q)
        sequences = base.backup.sequence_values(q)
        dependencies = q("""select jsonb_build_object(
          'large_objects',(select count(*) from pg_largeobject_metadata),
          'foreign_servers',(select count(*) from pg_foreign_server),
          'foreign_wrappers',(select count(*) from pg_foreign_data_wrapper),
          'foreign_tables',(select count(*) from pg_foreign_table),
          'subscriptions',(select count(*) from pg_subscription where subdbid=(select oid from pg_database where datname=current_database())),
          'replication_slots',(select count(*) from pg_replication_slots where database=current_database()),
          'materialized_views',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema') and c.relkind='m'),
          'prepared_transactions',(select count(*) from pg_prepared_xacts where database=current_database()),
          'server_version',current_setting('server_version'),
          'preload_hash',encode(sha256(convert_to(current_setting('shared_preload_libraries'),'UTF8')),'hex'))""")
        # Slot progress is infrastructure state, not included in pg_dump. Never
        # call peek/get changes, advance a slot or emit connection/query text.
        replication = q("""select coalesce(jsonb_agg(jsonb_build_object(
          'name_sha256',encode(sha256(convert_to(r.slot_name,'UTF8')),'hex'),
          'type',r.slot_type,'plugin',r.plugin,'temporary',r.temporary,'active',r.active,
          'wal_status',r.wal_status,'failover',r.failover,
          'confirmed_flush_lsn_sha256',encode(sha256(convert_to(coalesce(r.confirmed_flush_lsn::text,''),'UTF8')),'hex'),
          'holder_application_sha256',encode(sha256(convert_to(coalesce(a.application_name,''),'UTF8')),'hex'),
          'holder_role',a.usename) order by r.slot_name),'[]')
          from pg_replication_slots r left join pg_stat_activity a on a.pid=r.active_pid where r.database=current_database()""")
        settings = q("""select coalesce(jsonb_agg(jsonb_build_object('role',case when r.setrole=0 then '<all>' else pg_get_userbyid(r.setrole) end,
          'name',split_part(setting,'=',1),'value_sha256',encode(sha256(convert_to(substring(setting from position('=' in setting)+1),'UTF8')),'hex'))
          order by r.setrole,split_part(setting,'=',1)),'[]') from pg_db_role_setting r cross join lateral unnest(r.setconfig) setting
          where r.setdatabase=(select oid from pg_database where datname=current_database())""")
        access = q("""select jsonb_object_agg(role,access) from (select role,jsonb_build_object(
          'schema_usage',has_schema_privilege(role,'_analytics','USAGE'),
          'table_select_count',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
             where n.nspname='_analytics' and c.relkind in ('r','p') and has_table_privilege(role,c.oid,'SELECT')),
          'table_write_count',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
             where n.nspname='_analytics' and c.relkind in ('r','p') and has_table_privilege(role,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE')))
          access from unnest(array['anon','authenticated','service_role']) role) x""")
        # Counts only; no Oban arguments, errors, node identifiers or log payloads.
        jobs = q("select coalesce(jsonb_object_agg(state,total),'{}') from (select state::text,count(*) total from _analytics.oban_jobs group by state) x")
        public_tables = []
        for t in relations:
            key = base.backup.table_key(t['schema'], t['table'])
            public_tables.append({**t, 'table': alias(t['table']), 'identity_sha256': digest(key), **rows[key]})
        receipt = {
            'identity': identity, 'client_endpoint': '127.0.0.1:54322/_supabase',
            'schemas': sorted(metadata['schemas']), 'tables': public_tables,
            'table_count': len(catalog), 'row_count': sum(v['count'] for v in rows.values()),
            'catalog_sha256': digest(catalog),
            'metadata': {k: {'count': len(v), 'sha256': digest(v)} for k, v in metadata.items()},
            'extensions': metadata['extensions'], 'database_privileges': extra['database'],
            'additional': {k: {'count': len(v), 'sha256': digest(v)} for k, v in extra.items()},
            'roles': {'count': len(roles['roles']), 'memberships': len(roles['memberships']), 'sha256': digest(roles)},
            'sequences': sequences, 'settings': settings, 'dependencies': dependencies,
            'replication_slots': replication, 'publications': metadata['publication_options'],
            'publication_member_identities': sorted(digest(k) for k in metadata['publication']),
            'browser_roles': access, 'job_state_counts': jobs,
            'schema_privileges': metadata['schemas'],
            'schema_owners': sorted(set(v['owner'] for v in metadata['schemas'].values())),
            'row_payloads_emitted': False,
        }
        # Private comparison state never written; output has aggregate row digests.
        return receipt, {'rows': rows, 'catalog': catalog, 'metadata': metadata, 'roles': roles, 'extra': extra, 'sequences': sequences}


def compare(before, after):
    changed = []
    labels = {base.backup.table_key(t['schema'], t['table']): t['schema'] + '.' + alias(t['table'])
              for t in before['catalog'] + after['catalog']}
    for k in sorted(set(before['rows']) | set(after['rows'])):
        if before['rows'].get(k) != after['rows'].get(k):
            changed.append({'table': labels[k], 'table_identity_sha256': digest(k), 'before': before['rows'].get(k), 'after': after['rows'].get(k)})
    return {'changed_tables': changed, 'catalog_equal': before['catalog'] == after['catalog'],
            'schema_security_equal': before['metadata'] == after['metadata'], 'roles_equal': before['roles'] == after['roles'],
            'additional_privileges_settings_equal': before['extra'] == after['extra'],
            'sequences_equal': before['sequences'] == after['sequences']}


def review(items, assessment, source_receipt):
    """Send sensitive inspect JSON only into a private pipe; return hashes/design.

    The child has no Docker adapter or mutations. This does not capture a retained
    rollback bundle, approve a change or validate a physical socket anew.
    """
    code, names, _ = base.run(['docker', 'volume', 'ls', '--format', '{{.Name}}'])
    need(code == 0 and names.splitlines(), 'VAR_VOLUME_LIST')
    volumes = base.read_json(['docker', 'volume', 'inspect', *sorted(names.splitlines())])
    volume_receipts = [{'Name': v['Name'], 'CreatedAt': v['CreatedAt'], 'definitionSha256': digest(v)} for v in volumes]
    paths = ['scripts/vectorRetainedReview.mjs', 'tests/security/review_retained_vector.mjs',
             'scripts/vectorRepairCore.mjs', 'scripts/VectorRepairStorage.ps1', 'scripts/Repair-LocalVector.ps1',
             'scripts/Start-LocalGoogleAuth.ps1', 'scripts/LocalGoogleActivation.ps1',
             'supabase/tests/inspect_analytics_recovery.py']
    hashes = {p: base.backup.file_sha256(ROOT / p) for p in paths}
    payload = {'identity': {'project': base.PROJECT, 'workdir': str(ROOT), 'endpoint': '127.0.0.1:54322',
        'cluster': CLUSTER, 'context': 'npipe:////./pipe/dockerDesktopLinuxEngine'},
        'reference': items, 'current': project_items(), 'referenceVolumes': volume_receipts,
        'currentVolumes': [{'Name': v['Name'], 'CreatedAt': v['CreatedAt'], 'definitionSha256': digest(v)}
                           for v in base.read_json(['docker', 'volume', 'inspect', *sorted(names.splitlines())])],
        'yamlSha256': fences.vector_config_hash(), 'sourceReceiptSha256': digest(source_receipt),
        'codeSha256': digest(hashes), 'assessment': assessment}
    context = subprocess.run(['docker', 'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'],
                             cwd=ROOT, env=base.backup.clean_env(), capture_output=True, timeout=15)
    need(context.returncode == 0 and context.stdout.decode().strip() == payload['identity']['context'], 'VAR_CONTEXT')
    child = subprocess.run(['node', 'tests/security/review_retained_vector.mjs'], cwd=ROOT,
                           env=base.backup.clean_env(), input=json.dumps(payload), text=True,
                           encoding='utf-8', capture_output=True, timeout=20)
    if child.returncode:
        need(False, child.stderr if re.fullmatch(r'VAR_[A-Z_]+', child.stderr) else 'VAR_LOCKED_REVIEW_STOPPED')
    value = json.loads(child.stdout)
    need(value['receipt']['result'] == 'LOCKED_REVIEW_VALID', 'VAR_REVIEW_RECEIPT')
    return {**value, 'codeHashes': hashes, 'volumeCount': len(volumes), 'originalCaptureCreated': False}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--inspect', action='store_true', required=True)
    p.parse_args()
    rid = uuid.uuid4().hex[:8]
    path = ROOT / f'supabase/tests/results/vector_analytics_assessment_{rid}.json'
    need(not path.exists(), 'VAR_EVIDENCE_EXISTS')
    record = {'run_id': rid, 'result': 'IN_PROGRESS', 'started_at': datetime.now(timezone.utc).isoformat(),
              'new_backup_or_restore': False, 'retained_mutation': False, 'google_credential_contents_accessed': False}
    frozen = base.immutable_inputs()
    for name in ['supabase/tests/inspect_analytics_recovery.py', 'scripts/vectorRetainedReview.mjs',
                 'tests/security/review_retained_vector.mjs', 'tests/security/vectorRetainedReview.unit.mjs']:
        frozen[name] = base.backup.file_sha256(ROOT / name)
    before = None
    try:
        need(not any(base.backup.clean_env().get(k) for k in ('DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH')), 'VAR_CONTEXT_OVERRIDE')
        record['postgres_before'] = base.gate.check()
        before = project_items()
        vector = next(x for x in before if x['Name'] == '/' + base.VECTOR)
        base.validate_vector(vector)
        need(vector['Id'] == fences.VECTOR_ID and fences.vector_config_hash() == fences.YAML_SHA, 'VAR_VECTOR_IDENTITY')
        credential = base.credential_metadata()
        inventory = fences.resources()
        tree = base.gate.recovery.tree_summary(base.gate.recovery.historical_files(base.backup.BACKUPS / '__none__'))
        record['retained_before'] = [base.state(x) for x in before]
        record['analytics_before'], private_before = capture()
        record['analytics_after'], private_after = capture()
        record['analytics_comparison'] = compare(private_before, private_after)
        # Live job/lease data may change. Never turn that into a clone exemption.
        need(all(v for k, v in record['analytics_comparison'].items() if k not in ('changed_tables', 'sequences_equal')), 'VAR_ANALYTICS_METADATA_CHANGED')
        record['locked_retained_review'] = review(before, record['analytics_after'], record['postgres_before'])
        record['result'] = 'PASS_READ_ONLY_ASSESSMENT'
    except Exception as e:
        code = str(e)
        record.update(result='FAIL_STOPPED', failure=code if re.fullmatch(r'VAR_[A-Z_]+', code) else 'VAR_SANITIZED_STOP')
    finally:
        if before is not None:
            try:
                record['postgres_after'] = base.gate.check()
                after = project_items()
                fences.unchanged_retained(before, after)
                need(fences.resources() == inventory, 'VAR_DOCKER_INVENTORY')
                need(base.credential_metadata() == credential, 'VAR_CREDENTIAL_METADATA')
                need(fences.vector_config_hash() == fences.YAML_SHA, 'VAR_YAML')
                need(base.gate.recovery.tree_summary(base.gate.recovery.historical_files(base.backup.BACKUPS / '__none__')) == tree, 'VAR_BACKUP_TREE')
                need(all(base.backup.file_sha256(ROOT / name) == value for name, value in frozen.items()), 'VAR_HISTORICAL_INPUT')
                fences.assert_locks()
                record['retained_after'] = [base.state(x) for x in after]
                record['preservation'] = {'all_eleven_lifecycles_and_definitions': True, 'vector_definition': True,
                    'docker_inventory': True, 'google_metadata_only': True, 'backup_tree': tree,
                    'historical_input_count': len(frozen), 'historical_hashes_equal': True, 'activation_locks': True}
            except Exception:
                record.update(result='FAIL_STOPPED', preservation_failure='VAR_FINAL_PRESERVATION_STOP')
        record['finished_at'] = datetime.now(timezone.utc).isoformat()
        base.backup.write_json(path, record)
    print(json.dumps({'result': record['result'], 'evidence': path.relative_to(ROOT).as_posix()}))
    return 0 if record['result'] == 'PASS_READ_ONLY_ASSESSMENT' else 1


if __name__ == '__main__':
    sys.exit(main())
