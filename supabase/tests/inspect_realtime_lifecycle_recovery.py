"""Step 22.8F read-only source/archive diagnosis. No backup/restore/service writes.

Private data and native tool stdout remain in captured memory. Existing encrypted
artifacts are opened only for integrity/offline reconstruction, never rewritten.
"""
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import unittest
import urllib.request
import uuid

import dual_database_recovery as m
import realtime_lifecycle_review as design

SOURCE_FILE = 'realtime_lifecycle_pinned_source_9aab6f3b.json'
SOURCE_SHA = 'b01cfdca8d72c133246b6670b646041fe04f29fbbbad1a3c47222507e518fb7b'
ORIGINS = {
    'b44b72f5': '3b4171c63e4f13592ce34a4742e7c936718380a2640baba399a9c9a82fd9fc58',
    '93426091': 'd88a82e21d383b4177b8c49ed275ad922f648622bb653ef7c7fe34ca0684bf0b',
    '8fa0e0c7': 'fea35fefd265a3973386e9e22558a38c1b450f3c3fe835d48b28739c76beaa0d',
}
DEFAULTS = {'RUN_JANITOR': False, 'JANITOR_RUN_AFTER_IN_MS': 600000,
            'JANITOR_SCHEDULE_TIMER_IN_MS': 14400000, 'JANITOR_SCHEDULE_RANDOMIZE': True,
            'JANITOR_MAX_CHILDREN': 5, 'JANITOR_CHUNK_SIZE': 10, 'JANITOR_CHILDREN_TIMEOUT': 5000}


def open_origin(rid):
    path = m.ROOT / f'supabase/tests/results/postgres_analytics_recovery_{rid}.json'
    m.need(m.backup.file_sha256(path) == ORIGINS[rid], 'RLR_ORIGIN_HASH')
    record = json.loads(path.read_text())
    store = m.EncryptedStore(Path(record['directory'])); store.artifacts = record['artifacts']
    return record, store


def collect_source(items):
    rt = next(x for x in items if x['Name'] == '/supabase_realtime_school-queue-local')
    release = m.checked(['docker', 'exec', 'supabase_realtime_school-queue-local', 'cat', '/app/releases/start_erl.data']).decode().strip()
    m.need((rt['Config']['Image'], rt['Image'], release) == design.PIN, 'RLR_REALTIME_PIN')
    with m.backup.Snapshot(m.source_env('postgres')) as s:
        m.validate_source_identity(m.source_identity(s.query), 'postgres')
        s.raw("set local statement_timeout='20s'; set local lock_timeout='2s';")
        value = m.collect(s.query, 'postgres')
        value['clock'] = s.query('select to_jsonb(clock_timestamp())')
        value['platform'] = s.query(m.recovery.realtime.PLATFORM_SQL)
        bodies = s.query("""select coalesce(jsonb_agg(jsonb_build_object(
          'key',format('%I.%I',n.nspname,p.proname)||'('||pg_get_function_identity_arguments(p.oid)||')',
          'body',p.prosrc,'definition',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'))),'[]')
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname in ('queue_private','queue_api','queue_display') and p.prokind in ('f','p')""")
        audit = s.query("""select coalesce(jsonb_object_agg(name,setting),'{}') from pg_settings
          where name in ('log_statement','log_min_duration_statement','log_duration','logging_collector',
            'track_commit_timestamp','pg_stat_statements.track_utility','pgaudit.log')""")
        stats = []
        ext = value['schema']['extensions'].get('pg_stat_statements')
        if ext:
            relation = m.backup.quote_identifier(ext['schema']) + '.pg_stat_statements'
            stats = s.query("select coalesce(jsonb_agg(jsonb_build_object('role',pg_get_userbyid(userid),'calls',calls,'rows',rows)),'[]') from " + relation +
                " where dbid=(select oid from pg_database where datname=current_database()) and query ~ '^DROP TABLE IF EXISTS realtime[.]messages_2026_10_14[;]?[[:space:]]*$'")
    value['platform'].update(image=rt['Config']['Image'], image_id=rt['Image'], release=release)
    env = dict(entry.split('=', 1) for entry in rt['Config']['Env'])
    configuration = {}
    for key, default in DEFAULTS.items():
        raw = env.get(key)
        if raw is None:
            resolved = default
        elif type(default) is bool:
            m.need(raw in ('true', 'false'), 'RLR_BOOLEAN_CONFIG')
            resolved = raw == 'true'
        else:
            m.need(re.fullmatch(r'[0-9]{1,10}', raw) is not None, 'RLR_INTEGER_CONFIG')
            resolved = int(raw)
        configuration[key] = {'explicit_container_environment': raw is not None, 'value': resolved}
    return value, bodies, {'image': design.PIN[0], 'image_id': design.PIN[1], 'release': release,
                          'configuration_from_environment_and_pinned_defaults': configuration,
                          'in_memory_application_environment_read': False,
                          'audit_settings': audit, 'exact_drop_statement_statistics': stats}


def compare_live(expected, current):
    try:
        classified = m.recovery.compare_source(expected, current)
    except m.recovery.realtime.PreservationError as error:
        classified = error.evidence
    removed = sorted(set(expected['rows']) - set(current['rows']))
    added = sorted(set(current['rows']) - set(expected['rows']))
    shared = set(expected['rows']) & set(current['rows']) - {m.recovery.realtime.SUBSCRIPTION}
    unequal = sorted(k for k in shared if expected['rows'][k] != current['rows'][k])
    # Names/hashes only. Never trim removed objects and call the full result PASS.
    return {'strict_classifier': classified, 'logical_tables': len(current['rows']),
        'removed_tables': removed, 'added_tables': added, 'unequal_shared_non_subscription_tables': unequal,
        'shared_non_subscription_tables': len(shared),
        'last_snapshot_removed_counts': {k: expected['rows'][k]['count'] for k in removed},
        'schema_sections_equal': {k: expected['schema'][k] == v for k, v in current['schema'].items()},
        'roles_equal': expected['roles'] == current['roles'],
        'additional_acl_settings_equal': expected['additional_privileges'] == current['additional_privileges'],
        'routing_equal': expected['routing'] == current['routing'], 'ancillary_equal': expected['ancillary'] == current['ancillary'],
        'state': current['state'], 'sequences': current['sequences'],
        'subscription_scope': {k: current['platform']['subscriptions'][k] for k in ('count', 'invalid_rows')}}


def leaves(source):
    rows = []
    for entry in source['catalog']:
        if entry['schema'] != 'realtime' or not entry['table'].startswith('messages'):
            continue
        name = entry['table']; key = m.backup.table_key('realtime', name)
        relation = source['schema']['relations']['realtime.' + name]
        rows.append({'name': name, 'catalog': entry, 'rows': source['rows'][key]['count'],
            'row_fingerprint_sha256': m.analytics.digest(source['rows'][key]['rows']),
            'relation_security': relation, 'live_leaf_evidence': source['platform']['leaves'].get(name)})
    return rows


def bounded_logs():
    code, out, err = m.base.run(['docker', 'logs', '--timestamps', '--since', '12h', '--tail', '600', 'supabase_realtime_school-queue-local'])
    m.need(code == 0, 'RLR_LOG_READ')
    lines = (out + '\n' + err).splitlines(); selected = []
    patterns = [('janitor-cleanup-start', 'Janitor starting realtime.messages cleanup'),
                ('janitor-finished', 'Janitor finished'), ('janitor-started', 'Janitor started'),
                ('partition-creation', 'Creating partitions for realtime.messages'),
                ('exact-leaf-drop-text', 'DROP TABLE IF EXISTS realtime.messages_2026_10_14')]
    for line in lines:
        for category, text in patterns:
            if text in line:
                stamp = re.match(r'^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z)', line)
                selected.append({'category': category, 'timestamp': stamp[1] if stamp else None})
                break
    return {'requested_tail': 600, 'requested_since': '12h', 'lines': len(lines),
            'fixed_category_events': selected[:100], 'events_truncated': len(selected) > 100,
            'raw_text_persisted': False, 'establishes_deletion_time_emptiness': False}


def disabled_provider():
    config, _, _ = m.backup.target()
    key = config.get('PUBLISHABLE_KEY') or config.get('ANON_KEY')
    m.need(isinstance(key, str), 'RLR_PUBLIC_KEY_LOOKUP')
    request = urllib.request.Request('http://127.0.0.1:54321/auth/v1/settings', headers={'apikey': key})
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=10) as response:
        settings = json.load(response)
    m.need(settings.get('external', {}).get('google') is False, 'RLR_GOOGLE_CHANGED')
    return {'google_enabled': False, 'real_auth_mutation': False}


def main():
    rid = uuid.uuid4().hex[:8]
    path = m.ROOT / f'supabase/tests/results/realtime_lifecycle_recovery_diagnosis_{rid}.json'
    record = {'run_id': rid, 'result': 'IN_PROGRESS_READ_ONLY', 'started_at': datetime.now(timezone.utc).isoformat(),
        'retained_mutation': False, 'new_backup': False, 'isolated_restore_executed': False,
        'docker_resource_mutation': False, 'google_credential_contents_accessed': False}
    try:
        source_path = path.parent / SOURCE_FILE
        m.need(m.backup.file_sha256(source_path) == SOURCE_SHA, 'RLR_SOURCE_REVIEW_HASH')
        frozen = m.recovery.immutable_inputs(path)
        for file in ['realtime_lifecycle_review.py', 'test_realtime_lifecycle_review.py', Path(__file__).name, 'review_realtime_partition_sources.py']:
            p = Path(__file__).parent / file; frozen[str(p.relative_to(m.ROOT))] = m.backup.file_sha256(p)
        tree = m.recovery.historical_files(m.backup.BACKUPS / '__none__')
        resources = m.fences.resources(); before = m.analytics.project_items()
        credential = m.base.credential_metadata()
        previous = json.loads((path.parent / 'postgres_analytics_recovery_8fa0e0c7.json').read_text())
        m.need([m.base.state(x) for x in before if x['Name'] != '/' + m.base.VECTOR] ==
               [x for x in previous['retained_after'] if x['container'] != m.base.VECTOR], 'RLR_PRIOR_SERVICE_LIFECYCLE')
        vector = next(x for x in before if x['Name'] == '/' + m.base.VECTOR)
        m.need(vector['Id'] == m.fences.VECTOR_ID, 'RLR_VECTOR_IDENTITY')
        context = m.checked(['docker', 'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']).decode().strip()
        m.need(context == 'npipe:////./pipe/dockerDesktopLinuxEngine', 'RLR_DOCKER_CONTEXT')
        record['pinned_source_review'] = {'file': SOURCE_FILE, 'sha256': SOURCE_SHA}
        origin, store = open_origin('93426091')
        manifest = json.loads(store.get('pg_manifest.dpapi', 'postgres'))
        current, bodies, record['realtime'] = collect_source(before)
        record['postgres_before'] = compare_live(manifest['captured'], current)
        comparison = record['postgres_before']
        m.need(not comparison['unequal_shared_non_subscription_tables'] and comparison['roles_equal'] and
               comparison['additional_acl_settings_equal'] and comparison['routing_equal'] and
               comparison['ancillary_equal'] and current['state']['active'] == current['state']['open_days'] == 0,
               'RLR_UNEXPECTED_RETAINED_STATE_CHANGE')
        migration_files, migration_hashes = m.backup.verify_files()
        record['source_identity'] = {'project': m.base.PROJECT, 'workdir': str(m.ROOT),
            'client_endpoint': '127.0.0.1:54322/postgres', 'cluster': m.analytics.CLUSTER,
            'server': '17.11', 'readonly': True, 'config_sha256': m.backup.file_sha256(m.ROOT / 'supabase/config.toml'),
            'migration_sha256': dict(zip((p.name for p in migration_files), migration_hashes))}
        record['partition_inventory'] = leaves(current)
        record['realtime']['bounded_logs'] = bounded_logs()
        record['encrypted_attempt_integrity'] = {}
        for run in ORIGINS:
            data, capsule = open_origin(run)
            capsule.verify()
            record['encrypted_attempt_integrity'][run] = {'recorded_artifacts_decrypted_and_hash_verified': len(capsule.artifacts),
                'evidence_sha256': ORIGINS[run], 'original_result': data['result'], 'rewritten': False}
        archive = store.get('pg_archive.dpapi', 'postgres'); archive_hash = m.sha(archive)
        toc = m.decoded_text(m.checked([m.backup.pgtool('pg_restore'), '--list'], data=archive))
        coverage = m.backup.archive_completeness(toc, manifest['captured']['catalog'], manifest['captured']['rows'], manifest['captured']['schema']['extensions'])
        raw = m.checked([m.backup.pgtool('pg_restore'), '--exit-on-error', '--single-transaction', '--file=-'], data=archive)
        decoded = m.decoded_text(raw).encode('utf-8')
        m.need(m.sha(archive) == archive_hash, 'RLR_BINARY_CHANGED')
        app = [entry for entry in bodies if '\n' in entry['body']]
        m.need(app and all(manifest['captured']['schema']['functions'][x['key']]['definition'] == x['definition'] for x in bodies), 'RLR_FUNCTION_REFERENCE_CHANGED')
        exact_raw = sum(x['body'].encode() in raw for x in app)
        expanded_raw = sum(x['body'].encode().replace(b'\n', b'\r\n') in raw for x in app)
        exact_decoded = sum(x['body'].encode() in decoded for x in app)
        m.need(exact_decoded == len(app), 'RLR_SQL_BODY_TRANSPORT')
        record['historical_archive_review'] = {**design.historical_review(manifest, archive_hash, store.artifacts['pg_archive.dpapi']['plain_sha256']),
            'archive_plain_bytes': len(archive), 'archive_plain_sha256': archive_hash,
            'coverage': {k: v for k, v in coverage.items() if k != 'dumped_tables'},
            'pg_restore_reconstruction_exit': 0, 'native_raw_sql_sha256': m.sha(raw), 'decoded_sql_sha256': m.sha(decoded),
            'multiline_application_bodies': len(app), 'exact_bodies_raw': exact_raw,
            'crt_expanded_bodies_raw': expanded_raw, 'exact_bodies_decoded': exact_decoded,
            'binary_bytes_unchanged': True, 'sql_executed': False}
        with m.backup.Snapshot(m.source_env('_supabase')) as s:
            m.validate_source_identity(m.source_identity(s.query), '_supabase')
            analytical = m.collect(s.query, '_supabase')
        record['analytics'] = {'tables': len(analytical['rows']), 'rows': sum(x['count'] for x in analytical['rows'].values()),
            'preservation': m.analytics_preservation(analytical), 'backup_or_restore_started': False}
        record['historical_bundles'] = m.Run.__new__(m.Run).historical()[1]
        record['provider'] = disabled_provider()
        suite = unittest.defaultTestLoader.loadTestsFromNames(['test_realtime_lifecycle_review', 'test_dual_database_recovery', 'test_realtime_preservation'])
        tests = unittest.TextTestRunner(stream=io.StringIO()).run(suite)
        m.need(tests.wasSuccessful() and not tests.skipped, 'RLR_REGRESSIONS')
        record['offline_tests'] = {'passed': tests.testsRun, 'failed': 0, 'skipped': 0}
        after = m.analytics.project_items(); m.fences.unchanged_retained(before, after)
        ending, _, _ = collect_source(after)
        record['postgres_after'] = compare_live(manifest['captured'], ending)
        m.need(m.fences.resources() == resources and m.base.credential_metadata() == credential, 'RLR_RESOURCE_OR_CREDENTIAL_METADATA_CHANGE')
        m.need(m.fences.vector_config_hash() == m.fences.YAML_SHA, 'RLR_VECTOR_CHANGED')
        m.need(m.recovery.historical_files(m.backup.BACKUPS / '__none__') == tree, 'RLR_BACKUP_FILE_CHANGED')
        m.need(all(m.backup.file_sha256(m.ROOT / p) == h for p, h in frozen.items()), 'RLR_EXISTING_INPUT_CHANGED')
        for run in ('93426091', '8fa0e0c7'):
            data, capsule = open_origin(run)
            destination = m.PrivateDestination(data['databases']['postgres']['destination'], capsule, 'pg', m.analytics.CLUSTER)
            state = destination.guard(running=False)['State']
            m.need(not state['Running'] and state['ExitCode'] == 0, 'RLR_PARTIAL_CLONE_NOT_STOPPED')
        m.fences.assert_locks()
        lock = (m.ROOT / 'scripts/Repair-LocalVector.ps1').read_text(encoding='utf-8')
        m.need('VPR_RETAINED_EXECUTION_NOT_CERTIFIED' in lock, 'RLR_VECTOR_LOCK')
        record.update(result='READ_ONLY_DIAGNOSIS_COMPLETE_STRICT_PRUNING_FAIL_RETAINED',
            all_existing_backup_files=m.recovery.tree_summary(tree), frozen_inputs_unchanged=len(frozen),
            retained_services_resources_unchanged=True, google_store_metadata_only_unchanged=True,
            partial_clones_still_stopped=True, repair_activation_locks_intact=True,
            recoverability_certified=False, current_inventory_recovery_prerequisites_satisfied=False)
    except Exception as error:
        code = str(error)
        record.update(result='FAIL_READ_ONLY_DIAGNOSIS', failure=code if re.fullmatch(r'(RLR|DAR|VST|VAR)_[A-Z0-9_]+', code) else 'RLR_SANITIZED_STOP',
                      exception_type=type(error).__name__)
    record['finished_at'] = datetime.now(timezone.utc).isoformat()
    with path.open('x', encoding='utf-8') as handle:
        json.dump(record, handle, indent=2)
    print(json.dumps({'result': record['result'], 'evidence': path.name, 'sha256': m.backup.file_sha256(path)}))


if __name__ == '__main__':
    main()
