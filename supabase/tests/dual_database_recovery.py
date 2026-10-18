"""Step 22.8E encrypted two-database recovery. No retained mutation interface.

Source connections are loopback/read-only. Sensitive artifacts never use plaintext
host files or arguments. Only newly owned network-none clusters accept writes.
An attempt stops on a required fence change; there is no automatic retry/resume.
"""
import argparse
import base64
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import traceback
import unittest
import uuid

import diagnose_vector_health as base
import inspect_analytics_recovery as analytics
import validate_vector_socket as fences

backup = base.backup
recovery = base.gate.recovery
prior = recovery.prior
internal = prior.internal
privileges = prior.privileges
ROOT = base.ROOT
LIMIT = 64 * 1024 * 1024
PARTS = {'rows', 'catalog', 'schema', 'roles', 'sequences', 'additional_privileges'}
RAW_SETTINGS = """select coalesce(jsonb_agg(jsonb_build_object('role',case when s.setrole=0 then null else pg_get_userbyid(s.setrole) end,
 'settings',to_jsonb(s.setconfig)) order by s.setrole=0,pg_get_userbyid(s.setrole)),'[]') from pg_db_role_setting s
 where s.setdatabase=(select oid from pg_database where datname=current_database())"""


def need(value, code):
    if not value:
        raise RuntimeError(code)


def encoded(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=True, indent=2) + '\n').encode()


def sha(value):
    return hashlib.sha256(value).hexdigest()


def decoded_text(value):
    # Match Python's universal-newline text reads used by the proven tools.
    # Native Windows textual stdout expands LF to CRLF. Decode that transport
    # once for metadata/role/SQL TEXT; never apply this to binary custom archives.
    return value.decode('utf-8').replace('\r\n', '\n')


def command(args, *, data=None, env=None, timeout=180):
    """Private output only. No caller prints stderr/SQL/environment values."""
    result = subprocess.run(args, cwd=ROOT, env=env or backup.clean_env(), input=data,
                            capture_output=True, timeout=timeout)
    need(len(result.stdout) <= LIMIT and len(result.stderr) <= LIMIT, 'DAR_TOOL_OUTPUT_BOUND')
    return result


def checked(args, **kwargs):
    result = command(args, **kwargs)
    need(result.returncode == 0 and not result.stderr.strip(), 'DAR_TOOL_DIAGNOSTICS_STOP')
    return result.stdout


class EncryptedStore:
    def __init__(self, directory):
        self.directory = directory
        self.artifacts = {}

    def crypto(self, operation, name, database, content=None):
        need(re.fullmatch(r'[a-z][a-z0-9_-]{0,55}\.dpapi', name) is not None, 'DAR_ARTIFACT_NAME')
        need(database in ('postgres', '_supabase', 'synthetic'), 'DAR_DATABASE')
        request = {'operation': operation, 'directory': str(self.directory), 'artifact': name, 'database': database}
        if content is not None:
            need(isinstance(content, bytes) and len(content) <= LIMIT, 'DAR_PLAINTEXT_BOUND')
            request['data'] = base64.b64encode(content).decode('ascii')
        result = command(['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                          '-File', str(ROOT / 'scripts/RecoveryArtifactCrypto.ps1')], data=json.dumps(request).encode(), timeout=60)
        need(result.returncode == 0 and not result.stderr.strip(), 'DAR_CRYPTO_REJECTED')
        response = json.loads(result.stdout)
        need(response.get('result') == 'PASS', 'DAR_CRYPTO_RECEIPT')
        return response

    def put(self, name, database, content):
        need(name not in self.artifacts and not (self.directory / name).exists(), 'DAR_ARTIFACT_EXISTS')
        self.crypto('protect', name, database, content)
        path = self.directory / name
        meta = {'database': database, 'cipher_bytes': path.stat().st_size, 'cipher_sha256': backup.file_sha256(path),
                'plain_bytes': len(content), 'plain_sha256': sha(content)}
        self.artifacts[name] = meta
        need(self.get(name, database) == content, 'DAR_PRIVATE_READBACK')
        return meta

    def get(self, name, database):
        meta = self.artifacts[name]
        need(meta['database'] == database, 'DAR_CIPHER_BINDING')
        content = base64.b64decode(self.crypto('open', name, database)['data'], validate=True)
        need(backup.file_sha256(self.directory / name) == meta['cipher_sha256'], 'DAR_CIPHER_BINDING')
        need(len(content) == meta['plain_bytes'] and sha(content) == meta['plain_sha256'], 'DAR_PLAIN_BINDING')
        return content

    def verify(self):
        for name, meta in self.artifacts.items():
            self.get(name, meta['database'])


def validate_catalog(value):
    keys = {backup.table_key(t['schema'], t['table']) for t in value['catalog']}
    need(keys and len(keys) == len(value['catalog']) and keys == set(value['rows']), 'DAR_CATALOG_COVERAGE')
    need(all(t['kind'] in ('r', 'p') for t in value['catalog']), 'DAR_EXTERNAL_TABLE')
    for t in value['catalog']:
        if t['kind'] == 'p':
            need(t['partition_key'] and all(x['schema'] == t['schema'] for x in t['parents']), 'DAR_PARENT')
        if t['is_partition']:
            need(len(t['parents']) == 1 and t['bound'] and
                 backup.table_key(t['parents'][0]['schema'], t['parents'][0]['table']) in keys, 'DAR_PARTITION')


def collect(query, database):
    need(database in ('postgres', '_supabase'), 'DAR_DATABASE')
    if database == 'postgres':
        value = prior.collect(query)
    else:
        value = {'rows': backup.all_rows(query), 'catalog': backup.table_catalog(query),
                 'schema': backup.schema_metadata(query), 'roles': backup.role_metadata(query),
                 'sequences': backup.sequence_values(query), 'additional_privileges': privileges.additional_privileges(query)}
    validate_catalog(value)
    ancillary = query("""select jsonb_build_object(
      'foreign_servers',(select count(*) from pg_foreign_server),
      'foreign_wrappers',(select count(*) from pg_foreign_data_wrapper),
      'materialized_views',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='m' and n.nspname not in ('pg_catalog','information_schema')),
      'subscriptions',(select count(*) from pg_subscription where subdbid=(select oid from pg_database where datname=current_database())),
      'event_triggers',(select coalesce(jsonb_object_agg(e.evtname,jsonb_build_object('event',e.evtevent,'owner',pg_get_userbyid(e.evtowner),
        'function',e.evtfoid::regprocedure::text,'enabled',e.evtenabled,'tags',e.evttags)),'{}') from pg_event_trigger e))""")
    need(all(ancillary[k] == 0 for k in ('foreign_servers', 'foreign_wrappers', 'materialized_views', 'subscriptions')), 'DAR_EXTERNAL_RECOVERY_SUPPORT_REQUIRED')
    value['ancillary'] = ancillary
    return value


def exact_restore(manifest, observed):
    expected = manifest['captured']
    need(set(expected) == set(observed), 'DAR_CLONE_SECTIONS')
    validate_catalog(observed)
    for key in expected:
        need(expected[key] == observed[key], 'DAR_CLONE_' + key.upper())


def fence_values(query):
    return {'roles': backup.role_metadata(query), 'sequences': backup.sequence_values(query),
            'additional_privileges': privileges.additional_privileges(query)}


def assert_fence(expected, observed):
    for key in ('roles', 'sequences', 'additional_privileges'):
        need(expected[key] == observed[key], 'DAR_NON_MVCC_' + key.upper())


def eligible_completed_capsule(origin):
    need(origin['result'] == 'FAIL_STOPPED' and origin['failure'] == 'DAR_TOOL_DIAGNOSTICS_STOP' and
         origin['phase'] == 'backup-complete-postgres' and set(origin['databases']) == {'postgres'}, 'DAR_IMPORT_FAILURE_SCOPE')
    entry = origin['databases']['postgres']
    need(entry['result'] == 'BACKUP_CREATED_RESTORE_PENDING' and entry['non_mvcc_fence'] == 'PASS_STRICT' and
         entry['manifest_saved_before_dump'] and entry['pg_dump_exit'] == entry['pg_dumpall_exit'] == 0,
         'DAR_IMPORT_DUMP_FENCE')


def source_env(database):
    need(database in ('postgres', '_supabase'), 'DAR_DATABASE')
    _, env, _ = backup.target()
    need(env['PGHOST'] == '127.0.0.1' and str(env['PGPORT']) == '54322', 'DAR_LOOPBACK')
    env['PGDATABASE'] = database
    return env


def validate_source_identity(identity, database):
    need(database in ('postgres', '_supabase') and identity == {'database': database, 'cluster': analytics.CLUSTER, 'version': '17.11', 'readonly': 'on', 'recovery': False}, 'DAR_SOURCE_IDENTITY')


def source_identity(query):
    return query("select jsonb_build_object('database',current_database(),'cluster',(select system_identifier::text from pg_control_system()),'version',current_setting('server_version'),'readonly',current_setting('transaction_read_only'),'recovery',pg_is_in_recovery())")


def analytics_preservation(current, reference=None):
    baseline = reference or json.loads((ROOT / 'supabase/tests/results/vector_analytics_assessment_f93ecba4.json').read_text())['analytics_after']
    need(len(current['catalog']) == baseline['table_count'] and
         analytics.digest(current['catalog']) == baseline['catalog_sha256'], 'DAR_ANALYTICS_CATALOG_CHANGED')
    need({k: {'count': len(v), 'sha256': analytics.digest(v)} for k, v in current['schema'].items()} == baseline['metadata'], 'DAR_ANALYTICS_SECURITY_CHANGED')
    need(analytics.digest(current['roles']) == baseline['roles']['sha256'], 'DAR_ANALYTICS_ROLES_CHANGED')
    need({k: {'count': len(v), 'sha256': analytics.digest(v)} for k, v in current['additional_privileges'].items()} == baseline['additional'], 'DAR_ANALYTICS_ACL_SETTINGS_CHANGED')
    table_rows = {analytics.digest(k): (k, v) for k, v in current['rows'].items()}
    changed = []
    for table in baseline['tables']:
        key, row = table_rows[table['identity_sha256']]
        if row['count'] != table['count'] or analytics.digest(row['rows']) != table['sha256']:
            need(table['table'] in ('oban_jobs', 'oban_peers'), 'DAR_ANALYTICS_UNREVIEWED_ROW_CHANGE')
            changed.append({'table': table['table'], 'before_count': table['count'], 'after_count': row['count']})
    for key, previous in baseline['sequences'].items():
        now = current['sequences'][key]
        if key == '"_analytics"."oban_jobs_id_seq"':
            need(now['is_called'] and now['last_value'] >= previous['last_value'], 'DAR_ANALYTICS_SEQUENCE_REGRESSION')
        else:
            need(now == previous, 'DAR_ANALYTICS_UNREVIEWED_SEQUENCE')
    return {'narrow_operational_row_changes': changed, 'other_rows_security_roles_settings_exact': True,
            'job_sequence': current['sequences']['"_analytics"."oban_jobs_id_seq"']}


class PrivateDestination(internal.Destination):
    def __init__(self, entry, store, prefix, source_cluster):
        super().__init__(entry, store.directory)
        self.store = store; self.prefix = prefix; self.source_cluster = source_cluster; self.serial = 0

    def psql(self, database, *, sql=None, file=None, readonly=False, label='SQL', variables=None):
        need(database in ('postgres', internal.DATABASE) and sql is not None and file is None, 'DAR_DEST_SQL_CHANNEL')
        self.guard()
        self.serial += 1
        args = ['docker', 'exec', '-i', '--user', 'postgres', self.entry['container'], 'env', '-u', 'PGPASSWORD', '-u', 'PGOPTIONS',
                '-u', 'PGSERVICE', '-u', 'PGSERVICEFILE', '-u', 'PGDATABASE', '-u', 'PGHOSTADDR',
                'PGHOST=' + internal.SOCKET, 'PGPORT=5432', 'PGUSER=' + internal.OWNER,
                'PGPASSFILE=' + internal.NO_PASSWORD_FILE, 'PGCLIENTENCODING=UTF8',
                'psql', '-X', '-w', '-qAt', '-h', internal.SOCKET, '-p', '5432', '-U', internal.OWNER,
                '-d', database, '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']
        for name, value in (variables or {}).items():
            need(name in ('recovery_target_identifier', 'recovery_archive_sha256', 'recovery_manifest_sha256') and
                 re.fullmatch(r'[0-9a-f]{1,64}', str(value)), 'DAR_DEST_VARIABLE')
            args += ['-v', name + '=' + str(value)]
        if isinstance(sql, bytes):
            need(not readonly, 'DAR_DEST_BYTES_MODE')
            payload = sql
        else:
            if readonly: sql = 'begin read only; ' + backup.CANONICAL_SETTINGS + sql + '; rollback;'
            payload = sql.encode()
        result = command(args, data=payload)
        if result.stderr.strip() or result.returncode:
            self.store.put(f'{self.prefix}_diagnostic_{self.serial}.dpapi', self.entry['source_database'], result.stdout + b'\n' + result.stderr)
            states = sorted(set(re.findall(rb'(?:ERROR|FATAL):\s+([A-Z0-9]{5})\b', result.stderr)))
            raise RuntimeError('DAR_DEST_SQL_STOP' + ('_' + b'_'.join(states).decode() if states else ''))
        return subprocess.CompletedProcess(args=[], returncode=0, stdout=result.stdout.decode('utf-8'), stderr='')

    def guard(self, running=True):
        item = super().guard(running)
        need(not self.entry.get('container_id') or item['Id'] == self.entry['container_id'], 'DAR_DEST_CONTAINER_CHANGED')
        volume = json.loads(backup.call(['docker', 'volume', 'inspect', self.entry['volume']]).stdout)[0]
        need(volume['Labels'].get('school-queue.restore-id') == self.entry['container'], 'DAR_DEST_VOLUME_LABEL')
        if self.entry.get('volume_created_at'):
            need(volume['CreatedAt'] == self.entry['volume_created_at'], 'DAR_DEST_VOLUME_CHANGED')
        return item

    def identity(self, database='postgres'):
        result = super().identity(database)
        need(result['system_identifier'] != self.source_cluster, 'DAR_DEST_SOURCE_CLUSTER')
        return result


class Run:
    def __init__(self):
        self.id = uuid.uuid4().hex[:8]
        self.path = ROOT / f'supabase/tests/results/postgres_analytics_recovery_{self.id}.json'
        self.directory = backup.BACKUPS / ('dual_' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '_' + self.id)
        need(not self.path.exists() and not self.directory.exists(), 'DAR_NEW_IDENTITY')
        self.record = {'run_id': self.id, 'result': 'IN_PROGRESS', 'phase': 'offline-tests',
                       'started_at': datetime.now(timezone.utc).isoformat(), 'databases': {},
                       'retained_writes': False, 'retained_restart': False, 'google_credential_contents_accessed': False}
        self.destinations = []
        self.owned_volumes = []
        self.store = EncryptedStore(self.directory)

    def save(self, phase=None):
        if phase: self.record['phase'] = phase
        backup.write_json(self.path, self.record)

    def offline(self):
        sys.path.insert(0, str(ROOT / 'tests/frontend'))
        suite = unittest.defaultTestLoader.loadTestsFromNames(['test_backup_automation', 'test_internal_restore',
            'test_schema_privilege_recovery', 'test_post_migration_backup', 'test_pre_google_recovery',
            'test_realtime_preservation', 'test_dual_database_recovery'])
        output = io.StringIO()
        result = unittest.TextTestRunner(stream=output).run(suite)
        need(result.wasSuccessful() and not result.skipped, 'DAR_OFFLINE_TESTS')
        self.record['offline'] = {'passed': result.testsRun, 'failed': 0, 'skipped': 0}

    def historical(self):
        record = json.loads(base.gate.EVIDENCE.read_text())
        need(backup.file_sha256(base.gate.EVIDENCE) == base.gate.EVIDENCE_SHA256 and record['result'] == 'PASS', 'DAR_HISTORICAL_EVIDENCE')
        verifier = recovery.Run.__new__(recovery.Run)
        verifier.id = record['run_id']; verifier.record = record; verifier.directory = Path(record['directory'])
        manifest = verifier.verify_bundle()
        return manifest, {'fresh_70_bundle_sha256': record['bundle']['sha256'], 'older': recovery.historical_bundles()}

    def main_source(self):
        source, checks = recovery.inspect_source()
        need(source['identity'] == recovery.reference()['identity'] and source['system_identifier'] == analytics.CLUSTER, 'DAR_MAIN_IDENTITY')
        need(backup.file_sha256(ROOT / 'supabase/config.toml') == base.gate.CONFIG_SHA256 and not checks['google_provider_enabled'], 'DAR_PROVIDER_CONFIG')
        need(source['state']['versions'] == [p.split('_')[0] for p in sorted(source['identity']['migration_sha256'])] and
             len(source['state']['versions']) == 6 and source['state']['routes'] == backup.CANONICAL and
             source['state']['active'] == source['state']['open_days'] == 0, 'DAR_MAIN_WORK_HISTORY')
        need(checks['auth_nonsecret_settings'] == self.manifest70['auth_nonsecret_settings'], 'DAR_AUTH_SETTINGS')
        classified = recovery.compare_source(self.manifest70, source)
        return source, checks, classified

    def crypto_tests(self):
        canary = ('SYNTHETIC_DAR_' + uuid.uuid4().hex).encode()
        name = 'synthetic_crypto.dpapi'
        self.store.put(name, 'synthetic', canary)
        checks = ['same-user-encrypted-readback-and-exact-ACL']
        for attempt, label in [(lambda: self.store.crypto('protect', name, 'synthetic', canary), 'atomic-overwrite-refusal'),
                               (lambda: self.store.crypto('open', name, 'postgres'), 'wrong-purpose-refusal'),
                               (lambda: self.store.crypto('open', '../google-local.dpapi', 'synthetic'), 'outside-path-refusal')]:
            try: attempt()
            except RuntimeError: checks.append(label)
            else: raise RuntimeError('DAR_CRYPTO_NEGATIVE_ACCEPTED')
        content = bytearray((self.directory / name).read_bytes()); content[-1] ^= 1
        (self.directory / name).write_bytes(content)
        try: self.store.crypto('open', name, 'synthetic')
        except RuntimeError: checks.append('tampered-ciphertext-refusal')
        else: raise RuntimeError('DAR_CRYPTO_NEGATIVE_ACCEPTED')
        del self.store.artifacts[name]  # Invalid SYNTHETIC file retained, never part of a recovery bundle.
        need(all(canary not in p.read_bytes() for p in self.directory.iterdir() if p.is_file()), 'DAR_SYNTHETIC_CANARY_LEAK')
        checks.append('no-plaintext-canary-in-files')
        large = (b'SYNTHETIC_RECOVERY_PAYLOAD\x00' * 90000)
        self.store.put('synthetic_large_crypto.dpapi', 'synthetic', large)
        checks.append('multi-megabyte-binary-readback')
        self.record['crypto_checks'] = {'passed': len(checks), 'failed': 0, 'checks': checks,
                                        'invalid_synthetic_cipher_retained': name, 'physical_second_user': 'not_performed'}

    def capture_backup(self, database, prefix):
        entry = {'run_id': uuid.uuid4().hex[:8], 'result': 'IN_PROGRESS', 'database': database}
        self.record['databases'][database] = entry
        self.save('snapshot-' + database)
        env = source_env(database)
        with backup.Snapshot(env) as independent:
            validate_source_identity(source_identity(independent.query), database)
            pre_capture_fence = fence_values(independent.query)
        with backup.Snapshot(env) as snapshot:
            validate_source_identity(source_identity(snapshot.query), database)
            captured = collect(snapshot.query, database)
            assert_fence(pre_capture_fence, captured)
            if database == '_supabase': entry['source_preservation'] = analytics_preservation(captured)
            else:
                platform = snapshot.query(recovery.realtime.PLATFORM_SQL)
                platform.update({k: self.initial_source['platform'][k] for k in ('image', 'image_id', 'release')})
                entry['source_preservation'] = recovery.compare_source(self.initial_source, {**captured, 'clock': snapshot.query('select to_jsonb(clock_timestamp())'), 'platform': platform})
            prereq = prior.restore_prerequisites(snapshot.query)
            need(prereq['large_object_count'] == 0, 'DAR_LARGE_OBJECT_SUPPORT_REQUIRED')
            raw_settings = snapshot.query(RAW_SETTINGS)
            exported = snapshot.raw('select pg_export_snapshot();')
            need(re.fullmatch(r'[0-9A-Fa-f-]+', exported), 'DAR_SNAPSHOT_ID')
            manifest = {'format': 3, 'run_id': entry['run_id'], 'parent_run_id': self.id, 'source_database': database,
                        'project': base.PROJECT, 'workdir': str(ROOT),
                        'source_system_identifier': analytics.CLUSTER, 'client_endpoint': '127.0.0.1:54322/' + database,
                        'migration_file_sha256': self.initial_source['identity']['migration_sha256'],
                        'captured_at_utc': datetime.now(timezone.utc).isoformat(), 'exported_snapshot': exported,
                        'archive_filename': prior.ARCHIVE if database == 'postgres' else 'complete_analytics.dump',
                        'captured': captured, 'prerequisites': prereq, 'database_settings_private': raw_settings,
                        'source_images': self.record['source_images'], 'tested_code_sha256': self.code_hashes}
            manifest_bytes = encoded(manifest)
            self.store.put(prefix + '_manifest.dpapi', database, manifest_bytes)
            entry['manifest_saved_before_dump'] = True
            entry['manifest_plain_sha256'] = sha(manifest_bytes)
            self.save('manifest-saved-before-dump-' + database)
            with backup.Snapshot(env) as independent:
                assert_fence(captured, fence_values(independent.query))
            entry['non_mvcc_fence'] = 'PASS_PRE_CAPTURE_AND_PRE_DUMP_ONLY'
            archive = checked([backup.pgtool('pg_dump'), '-w', '-h', '127.0.0.1', '-p', '54322', '-d', database,
                               '--format=custom', '--snapshot', exported, '--lock-wait-timeout=10s'], env=env)
            # Keep the same exporting transaction open for role capture.
            roles = checked([backup.pgtool('pg_dumpall'), '-w', '--roles-only', '--no-role-passwords'], env=env)
            need(not re.search(rb'\bPASSWORD\b', roles, re.I), 'DAR_ROLE_PASSWORD_CLAUSE')
            with backup.Snapshot(env) as independent:
                assert_fence(captured, fence_values(independent.query))
            entry['non_mvcc_fence'] = 'PASS_STRICT_PRE_CAPTURE_PRE_AND_POST_DUMP'
        self.save('dump-fences-passed-' + database)
        need(archive[:5] == b'PGDMP', 'DAR_ARCHIVE_FORMAT')
        self.store.put(prefix + '_archive.dpapi', database, archive)
        self.store.put(prefix + '_roles.dpapi', database, roles)
        toc = decoded_text(checked([backup.pgtool('pg_restore'), '--list'], data=archive))
        complete = backup.archive_completeness(toc, captured['catalog'], captured['rows'], captured['schema']['extensions'])
        need(complete['table_data_entries'] == complete['physical_tables'] and not complete['extension_recreated_empty_tables'], 'DAR_ARCHIVE_PHYSICAL_COVERAGE')
        self.store.put(prefix + '_toc.dpapi', database, toc.encode())
        if database == 'postgres':
            logical_manifest = {**captured, 'archive_filename': prior.ARCHIVE, 'source_system_identifier': analytics.CLUSTER}
            bindings = {prior.ARCHIVE: sha(archive), prior.MANIFEST: sha(manifest_bytes), prior.ROLES: sha(roles)}
            proposal = {'archive_filename': prior.ARCHIVE, 'source_artifacts': bindings,
                        'source_system_identifier': analytics.CLUSTER, 'database': captured['additional_privileges']['database'],
                        'database_settings': raw_settings}
            proposal_bytes = encoded(proposal)
            self.store.put(prefix + '_environment_source.dpapi', database, proposal_bytes)
            self.store.put(prefix + '_schema_sql.dpapi', database, privileges.generate_sql(logical_manifest, analytics.CLUSTER, source_artifacts=bindings).encode())
            self.store.put(prefix + '_environment_sql.dpapi', database, privileges.generate_environment_sql(
                proposal, captured['additional_privileges']['database_settings'], source_artifacts=bindings, proposal_sha256=sha(proposal_bytes)).encode())
        entry.update(result='BACKUP_CREATED_RESTORE_PENDING', archive_completeness={k: v for k, v in complete.items() if k != 'dumped_tables'},
                     snapshot_tables=len(captured['rows']), logical_rows=sum(r['count'] for r in captured['rows'].values()),
                     non_mvcc_fence='PASS_STRICT', roles_passwords_excluded=True, pg_dump_exit=0, pg_dumpall_exit=0, pg_restore_list_exit=0)
        self.save('backup-complete-' + database)
        return manifest

    def start_destination(self, manifest, prefix):
        name = 'sq-restore-internal-' + uuid.uuid4().hex[:8]
        image = json.loads(backup.call(['docker', 'image', 'inspect', internal.IMAGE]).stdout)[0]
        need(image['Id'] == 'sha256:6058a6759ab9268cff8ee70641d61f1bd75953316281b76427cf5a6b4db2eafc', 'DAR_IMAGE')
        entry = {'project': name, 'container': name, 'volume': name + '-data', 'image': internal.IMAGE, 'image_id': image['Id'],
                 'database': internal.DATABASE, 'source_database': manifest['source_database'], 'socket': internal.SOCKET,
                 'network_mode': 'none', 'published_ports': []}
        need(not backup.call(['docker', 'ps', '-a', '--filter', 'name=^/' + name + '$', '--format', '{{.ID}}']).stdout.strip(), 'DAR_DEST_EXISTS')
        need(not backup.call(['docker', 'volume', 'ls', '--filter', 'name=^' + entry['volume'] + '$', '--format', '{{.Name}}']).stdout.strip(), 'DAR_DEST_VOLUME_EXISTS')
        backup.call(['docker', 'volume', 'create', '--label', 'school-queue.restore-id=' + name, entry['volume']])
        self.owned_volumes.append(entry['volume'])
        volume = json.loads(backup.call(['docker', 'volume', 'inspect', entry['volume']]).stdout)[0]
        entry['volume_created_at'] = volume['CreatedAt']
        env = backup.clean_env()
        env.update(POSTGRES_PASSWORD=uuid.uuid4().hex + uuid.uuid4().hex, POSTGRES_USER=internal.OWNER,
                   POSTGRES_DB='postgres', RECOVERY_PRELOAD=manifest['prerequisites']['settings']['shared_preload_libraries'])
        backup.call(['docker', 'create', '--pull=never', '--name', name, '--label', 'school-queue.restore-id=' + name,
            '--network', 'none', '--entrypoint', '/bin/bash', '--mount', 'type=volume,source=' + entry['volume'] + ',target=/var/lib/postgresql/data',
            '--env', 'POSTGRES_PASSWORD', '--env', 'POSTGRES_USER', '--env', 'POSTGRES_DB', '--env', 'RECOVERY_PRELOAD',
            internal.IMAGE, '-c', internal.init_script()], env=env)
        dest = PrivateDestination(entry, self.store, prefix, analytics.CLUSTER)
        self.destinations.append(dest)
        self.record['databases'][manifest['source_database']]['destination'] = entry
        entry['container_id'] = dest.guard(running=False)['Id']
        backup.call(['docker', 'start', name])
        start = time.monotonic()
        while time.monotonic() - start < 60:
            test = command(['docker', 'exec', '--user', 'postgres', name, 'pg_isready', '-q', '-h', internal.SOCKET, '-p', '5432', '-U', internal.OWNER, '-d', 'postgres'])
            if test.returncode == 0: break
            time.sleep(1)
        else: raise RuntimeError('DAR_DEST_START_TIMEOUT')
        identity = dest.identity()
        entry.update(system_identifier=identity['system_identifier'], sandbox_id=dest.guard()['NetworkSettings']['SandboxID'])
        need(all(d is dest or d.entry.get('system_identifier') != entry['system_identifier'] for d in self.destinations), 'DAR_DEST_DUPLICATE_CLUSTER')
        initial = dest.query("select jsonb_build_object('roles',(select jsonb_agg(rolname order by rolname) from pg_roles where rolname not like 'pg_%'),'databases',(select jsonb_agg(datname order by datname) from pg_database),'tables',(select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema')))", 'postgres')
        need(initial == {'roles': [internal.OWNER], 'databases': ['postgres', 'template0', 'template1'], 'tables': 0}, 'DAR_DEST_NOT_EMPTY')
        self.record['databases'][manifest['source_database']]['destination_initial'] = identity
        return dest

    def import_complete_postgres(self, source_run, evidence_sha256):
        """New verification identity for a completed, immutable backup capsule.

        Never resumes an attempt, repeats a source dump or accepts a failed fence.
        Only the known pre-execution output-selection failure is eligible.
        """
        need(re.fullmatch(r'[0-9a-f]{8}', source_run) and re.fullmatch(r'[0-9a-f]{64}', evidence_sha256), 'DAR_IMPORT_IDENTITY')
        path = ROOT / f'supabase/tests/results/postgres_analytics_recovery_{source_run}.json'
        need(backup.file_sha256(path) == evidence_sha256, 'DAR_IMPORT_EVIDENCE_HASH')
        origin = json.loads(path.read_text())
        eligible_completed_capsule(origin)
        old_entry = origin['databases']['postgres']
        old = EncryptedStore(Path(origin['directory'])); old.artifacts = origin['artifacts']
        manifest = json.loads(old.get('pg_manifest.dpapi', 'postgres'))
        need(manifest['source_database'] == 'postgres' and manifest['source_system_identifier'] == analytics.CLUSTER and
             manifest['project'] == base.PROJECT and manifest['workdir'] == str(ROOT) and
             manifest['migration_file_sha256'] == self.initial_source['identity']['migration_sha256'], 'DAR_IMPORT_SOURCE')
        need(manifest['captured']['catalog'] == self.initial_source['catalog'], 'DAR_IMPORT_INVENTORY_NO_LONGER_CURRENT')
        recovery.compare_source(manifest['captured'], self.initial_source)
        archive = old.get('pg_archive.dpapi', 'postgres')
        toc = decoded_text(checked([backup.pgtool('pg_restore'), '--list'], data=archive))
        coverage = backup.archive_completeness(toc, manifest['captured']['catalog'], manifest['captured']['rows'], manifest['captured']['schema']['extensions'])
        need(coverage['table_data_entries'] == coverage['physical_tables'] and not coverage['extension_recreated_empty_tables'], 'DAR_IMPORT_COVERAGE')
        names = ['pg_manifest.dpapi', 'pg_archive.dpapi', 'pg_roles.dpapi', 'pg_toc.dpapi',
                 'pg_environment_source.dpapi', 'pg_schema_sql.dpapi', 'pg_environment_sql.dpapi']
        for name in names: self.store.put(name, 'postgres', old.get(name, 'postgres'))
        self.record['databases']['postgres'] = {k: deepcopy(v) for k, v in old_entry.items() if k != 'destination'}
        self.record['databases']['postgres'].update(source_backup_run_id=source_run, verification_run_id=self.id,
            source_evidence_sha256=evidence_sha256, original_failure_unchanged=True, source_dump_repeated=False)
        self.save('completed-postgres-capsule-imported')
        return manifest

    def restore(self, manifest, prefix):
        database = manifest['source_database']; entry = self.record['databases'][database]
        self.store.verify()
        dest = self.start_destination(manifest, prefix)
        existing = dest.query('select jsonb_agg(rolname order by rolname) from pg_roles', 'postgres')
        roles = internal.prepare_roles(decoded_text(self.store.get(prefix + '_roles.dpapi', database)), existing)
        self.store.put(prefix + '_roles_prepared.dpapi', database, roles.encode())
        dest.psql('postgres', sql=roles)
        need(backup.role_metadata(lambda q: dest.query(q, 'postgres')) == manifest['captured']['roles'], 'DAR_DEST_ROLES')
        db = manifest['prerequisites']['database']
        owner = manifest['captured']['additional_privileges']['database']['owner']
        need(db['provider'] == 'i' and owner == 'postgres', 'DAR_DB_PREREQUISITES')
        dest.psql('postgres', sql='create database ' + internal.DATABASE + ' template template0 owner ' + backup.quote_identifier(owner) +
                  ' encoding ' + backup.literal(db['encoding']) + ' locale_provider=icu icu_locale=' + backup.literal(db['locale']) +
                  ' lc_collate=' + backup.literal(db['collate']) + ' lc_ctype=' + backup.literal(db['ctype']) + ';')
        dest.identity(internal.DATABASE)
        need(prior.restore_prerequisites(dest.query)['database'] == db, 'DAR_DEST_LOCALE')
        template = dest.query("select jsonb_build_object('tables',(select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema')),'extensions',(select jsonb_object_agg(extname,jsonb_build_object('owner',pg_get_userbyid(extowner),'version',extversion)) from pg_extension),'available',(select jsonb_object_agg(name,default_version) from pg_available_extensions))")
        need(template['tables'] == 0 and template['extensions'] == {'plpgsql': {'owner': internal.OWNER, 'version': '1.0'}}, 'DAR_DEST_TEMPLATE')
        need(all(template['available'].get(k) == v['version'] for k, v in manifest['captured']['schema']['extensions'].items()), 'DAR_EXTENSION_BINARIES')
        archive = self.store.get(prefix + '_archive.dpapi', database)
        sql = decoded_text(checked([backup.pgtool('pg_restore'), '--exit-on-error', '--single-transaction', '--file=-'], data=archive)).encode('utf-8')
        self.store.put(prefix + '_restore_sql.dpapi', database, sql)
        self.save('archive-restore-' + database)
        dest.identity(internal.DATABASE)
        dest.psql(internal.DATABASE, sql=sql)
        if database == 'postgres': self.supplements(dest, manifest, prefix)
        restored = collect(dest.query, database)
        exact_restore(manifest, restored)
        entry.update(result='VERIFIED_RECOVERABLE', pg_restore_exit=0, psql_archive_exit=0,
                     exact_table_comparisons=len(restored['rows']), exact_logical_rows=sum(v['count'] for v in restored['rows'].values()),
                     exact_schema_sections={k: len(v) for k, v in restored['schema'].items()}, roles=len(restored['roles']['roles']),
                     memberships=len(restored['roles']['memberships']), exact_sequence_comparisons=len(restored['sequences']),
                     all_security_and_database_settings_exact=True, no_clone_exemptions=True)
        bundle = {'format': 3, 'run_id': entry['run_id'], 'parent_run_id': self.id, 'database': database,
                  'destination': deepcopy(dest.entry), 'source_cluster': analytics.CLUSTER,
                  'artifacts': {k: deepcopy(v) for k, v in self.store.artifacts.items() if v['database'] == database},
                  'recoverability_verified': True, 'limitations': ['DPAPI CurrentUser/profile/path dependency',
                      'No role passwords or external service keys', 'No operational service/slot/WAL/PITR certification']}
        entry['bundle'] = self.store.put(prefix + '_bundle.dpapi', database, encoded(bundle))
        self.stop(dest)
        self.save('restore-verified-' + database)

    def supplements(self, dest, manifest, prefix):
        expected = manifest['captured']; before = collect(dest.query, 'postgres')
        privileges.validate_known_gap({**expected}, before['schema'])
        for key in set(expected) - {'schema', 'additional_privileges'}:
            need(before[key] == expected[key], 'DAR_PRE_SUPPLEMENT_' + key.upper())
        proposal = json.loads(self.store.get(prefix + '_environment_source.dpapi', 'postgres'))
        extra = before['additional_privileges']
        need(all(extra[k] == expected['additional_privileges'][k] for k in ('sequence_acls', 'column_acls', 'type_acls')) and
             extra['database'] == privileges.database_before(proposal) and extra['database_settings'] == [], 'DAR_PRE_SUPPLEMENT_ACL')
        variables = {'recovery_target_identifier': dest.entry['system_identifier'],
                     'recovery_archive_sha256': self.store.artifacts[prefix + '_archive.dpapi']['plain_sha256'],
                     'recovery_manifest_sha256': self.store.artifacts[prefix + '_manifest.dpapi']['plain_sha256']}
        schema_sql = self.store.get(prefix + '_schema_sql.dpapi', 'postgres')
        try: dest.psql(internal.DATABASE, sql=schema_sql, variables={**variables, 'recovery_target_identifier': analytics.CLUSTER})
        except RuntimeError as error: need(str(error) == 'DAR_DEST_SQL_STOP_42501', 'DAR_NEGATIVE_TARGET_SQLSTATE')
        else: raise RuntimeError('DAR_NEGATIVE_TARGET_ACCEPTED')
        need(backup.schema_metadata(dest.query) == before['schema'], 'DAR_NEGATIVE_TARGET_ROLLBACK')
        dest.psql(internal.DATABASE, sql=schema_sql, variables=variables)
        need(backup.schema_metadata(dest.query) == expected['schema'], 'DAR_SCHEMA_SUPPLEMENT')
        dest.psql(internal.DATABASE, sql=self.store.get(prefix + '_environment_sql.dpapi', 'postgres'), variables=variables)
        need(privileges.additional_privileges(dest.query) == expected['additional_privileges'], 'DAR_ENV_SUPPLEMENT')
        self.record['databases']['postgres']['supplements'] = {'schema_grants': 8, 'database_grants': 5,
            'protected_settings': 2, 'wrong_source_target': 'PASS_42501_NO_SCHEMA_CHANGE'}

    def stop(self, dest):
        item = dest.guard(running=False)
        if item['State']['Running']: backup.call(['docker', 'stop', '--timeout', '20', dest.entry['container']], timeout=45)
        stopped = dest.guard(running=False)
        need(not stopped['State']['Running'] and stopped['State']['ExitCode'] == 0 and not stopped['State']['OOMKilled'], 'DAR_DEST_STOP_FAILED')
        dest.entry.update(stopped=True, volume_retained=True)

    def preservation(self):
        current, _, classified = self.main_source()
        self.record['source_after'] = classified
        self.record['current_postgres_tables'] = len(current['rows'])
        self.record['postgres_snapshot_inventory_is_current'] = not hasattr(self, 'pg_snapshot_catalog') or current['catalog'] == self.pg_snapshot_catalog
        with backup.Snapshot(source_env('_supabase')) as s:
            observed = collect(s.query, '_supabase')
        self.record['analytics_after'] = analytics_preservation(observed)
        after = analytics.project_items()
        fences.unchanged_retained(self.services_before, after)
        need(base.credential_metadata() == self.credential_before and fences.vector_config_hash() == fences.YAML_SHA, 'DAR_CREDENTIAL_METADATA_OR_VECTOR')
        now = fences.resources()
        need(set(now['containers']) == set(self.resources_before['containers']) | {d.entry['container_id'] for d in self.destinations}, 'DAR_RESOURCE_CONTAINER_DELTA')
        need(set(now['volumes']) == set(self.resources_before['volumes']) | set(self.owned_volumes), 'DAR_RESOURCE_VOLUME_DELTA')
        need(now['networks'] == self.resources_before['networks'], 'DAR_RESOURCE_NETWORK_DELTA')
        need(recovery.historical_files(self.directory) == self.historical_files, 'DAR_HISTORICAL_BACKUP_CHANGED')
        need(all(backup.file_sha256(ROOT / p) == h for p, h in self.frozen.items()), 'DAR_EXISTING_INPUT_CHANGED')
        fences.assert_locks()
        self.record['retained_after'] = [base.state(x) for x in after]
        self.record['preservation'] = {'eleven_other_service_definitions_lifecycles_exact': True, 'vector_definition_exact': True,
            'google_metadata_only_unchanged': True, 'historical_backup_tree': recovery.tree_summary(self.historical_files),
            'existing_inputs_unchanged': len(self.frozen), 'owned_resource_delta_only': True, 'all_execution_locks_intact': True}

    def run(self, selftest=False, imported_postgres=None):
        self.save()
        ready = False
        try:
            self.offline()
            need(not any(backup.clean_env().get(k) for k in ('DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH')), 'DAR_DOCKER_OVERRIDE')
            need(checked(['docker', 'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']).decode().strip() ==
                 'npipe:////./pipe/dockerDesktopLinuxEngine', 'DAR_DOCKER_CONTEXT')
            self.manifest70, self.record['historical_bundles'] = self.historical()
            self.initial_source, checks, classified = self.main_source()
            self.record['source_before'] = classified
            self.record['source_images'] = recovery.service_inventory()
            self.services_before = analytics.project_items()
            reference_services = json.loads((ROOT / 'supabase/tests/results/vector_analytics_assessment_f93ecba4.json').read_text())['retained_after']
            need([base.state(x) for x in self.services_before if x['Name'] != '/' + base.VECTOR] ==
                 [x for x in reference_services if x['container'] != base.VECTOR], 'DAR_OTHER_SERVICE_REFERENCE_CHANGED')
            vector = next(x for x in self.services_before if x['Name'] == '/' + base.VECTOR)
            need(vector['Id'] == fences.VECTOR_ID and fences.vector_config_hash() == fences.YAML_SHA, 'DAR_VECTOR_IDENTITY')
            self.record['retained_before'] = [base.state(x) for x in self.services_before]
            self.credential_before = base.credential_metadata()
            self.resources_before = fences.resources()
            self.historical_files = recovery.historical_files(self.directory)
            self.frozen = recovery.immutable_inputs(self.path)
            self.frozen.update({str(p.relative_to(ROOT)): backup.file_sha256(p) for p in (ROOT / 'scripts').glob('*') if p.is_file()})
            self.code_hashes = {str(p.relative_to(ROOT)): backup.file_sha256(p) for p in [Path(__file__), ROOT / 'scripts/RecoveryArtifactCrypto.ps1', ROOT / 'supabase/tests/test_dual_database_recovery.py']}
            self.frozen.update(self.code_hashes)
            need(shutil.disk_usage(ROOT).free >= 1536 * 1024 * 1024, 'DAR_HOST_FREE_SPACE')
            fences.assert_locks()
            with backup.Snapshot(source_env('_supabase')) as s:
                self.record['analytics_before'] = analytics_preservation(collect(s.query, '_supabase'))
            ready = True
            backup.secure_directory(self.directory)
            self.record['directory'] = str(self.directory)
            self.crypto_tests()
            self.record['tools'] = {tool: checked([backup.pgtool(tool), '--version']).decode().strip() for tool in ('pg_dump', 'pg_dumpall', 'pg_restore')}
            if not selftest:
                for database, prefix in [('postgres', 'pg'), ('_supabase', 'an')]:
                    manifest = self.import_complete_postgres(*imported_postgres) if database == 'postgres' and imported_postgres else self.capture_backup(database, prefix)
                    if database == 'postgres': self.pg_snapshot_catalog = manifest['captured']['catalog']
                    self.restore(manifest, prefix)
            self.preservation()
            self.store.verify()
            self.record['artifacts'] = deepcopy(self.store.artifacts)
            self.record.update(result='PASS_SYNTHETIC_CRYPTO_ONLY' if selftest else 'PASS_DATABASE_RECOVERY_VERIFIED', phase='complete',
                current_inventory_recovery_prerequisites_satisfied=not selftest and self.record['postgres_snapshot_inventory_is_current'], retained_vector_execution_authorized=False)
        except BaseException as error:
            code = str(error)
            self.record.update(result='FAIL_STOPPED', failure=code if re.fullmatch(r'DAR_[A-Z0-9_]+', code) else 'DAR_SANITIZED_STOP',
                               current_inventory_recovery_prerequisites_satisfied=False)
            self.record['failure_exception_type'] = type(error).__name__
            self.record['failure_code_locations'] = [{'file': Path(f.filename).name, 'function': f.name, 'line': f.lineno}
                                                      for f in traceback.extract_tb(error.__traceback__)]
            # Only new owned destinations may be stopped. No source retry or restore.
            for dest in self.destinations:
                try: self.stop(dest)
                except Exception: self.record['owned_destination_stop_requires_review'] = True
            if ready:
                try: self.preservation()
                except Exception: self.record['final_preservation'] = 'FAIL_READ_ONLY_REVIEW_REQUIRED'
            self.record['artifacts'] = deepcopy(self.store.artifacts)
        self.record['finished_at'] = datetime.now(timezone.utc).isoformat()
        self.save()
        print(json.dumps({'result': self.record['result'], 'failure': self.record.get('failure'), 'evidence': self.path.relative_to(ROOT).as_posix()}))
        return 0 if self.record['result'] in ('PASS_DATABASE_RECOVERY_VERIFIED', 'PASS_SYNTHETIC_CRYPTO_ONLY') else 1


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument('--run', action='store_true')
    mode.add_argument('--selftest', action='store_true')
    p.add_argument('--use-complete-postgres')
    p.add_argument('--source-evidence-sha256')
    args = p.parse_args()
    need(bool(args.use_complete_postgres) == bool(args.source_evidence_sha256) and not (args.selftest and args.use_complete_postgres), 'DAR_ARGUMENT_SCOPE')
    imported = (args.use_complete_postgres, args.source_evidence_sha256) if args.use_complete_postgres else None
    sys.exit(Run().run(selftest=args.selftest, imported_postgres=imported))
