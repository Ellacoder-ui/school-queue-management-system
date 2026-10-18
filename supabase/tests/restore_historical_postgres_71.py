"""Step 22.8G: only capsule 93426091, only a new isolated historical clone.

No new source backup, retained mutation, combined-runner bypass or repair path.
The acknowledged live pruning FAIL is separate from exact historical recovery.
Default invocation runs offline tests. --run explicitly creates a new destination.
"""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import re
import shutil
import sys
import traceback
import unittest
import uuid

import dual_database_recovery as m
import inspect_realtime_lifecycle_recovery as inspection

ORIGIN_ID = '93426091'
SNAPSHOT_ID = 'd7f3aa3b'
ORIGIN_DIRECTORY = m.backup.BACKUPS / 'dual_20261018T051715Z_93426091'
ORIGIN_SHA = 'd88a82e21d383b4177b8c49ed275ad922f648622bb653ef7c7fe34ca0684bf0b'
MANIFEST_SHA = '8e6ca9b30ae6bc78df6a374c6559d9a8c33a25cfc4868eaa9089128ebad118b2'
ARCHIVE_SHA = 'd6c831973afee9feddfa59637d5f6eaeb5a6a85e51a43a53844b07f1ceb1a29c'
ASSESSMENT = m.ROOT / 'supabase/tests/results/realtime_lifecycle_recovery_diagnosis_a982ed79.json'
ASSESSMENT_SHA = '57111c843c5f3b98a42c3e46be18fbd46a4d15bb7a879fe7662d52547297865a'
INPUTS = ('pg_manifest.dpapi', 'pg_archive.dpapi', 'pg_roles.dpapi', 'pg_toc.dpapi',
          'pg_environment_source.dpapi', 'pg_schema_sql.dpapi', 'pg_environment_sql.dpapi')
AUTH_KEYS = {'GOTRUE_SITE_URL', 'GOTRUE_URI_ALLOW_LIST', 'GOTRUE_DISABLE_SIGNUP',
             'GOTRUE_EXTERNAL_GOOGLE_ENABLED', 'GOTRUE_EXTERNAL_EMAIL_ENABLED',
             'GOTRUE_MAILER_AUTOCONFIRM', 'GOTRUE_MFA_TOTP_ENROLL_ENABLED', 'GOTRUE_MFA_TOTP_VERIFY_ENABLED'}


def validate_origin(origin):
    m.need(origin.get('run_id') == ORIGIN_ID and Path(origin.get('directory', '')).resolve() == ORIGIN_DIRECTORY.resolve(), 'H71_FIXED_ORIGIN')
    m.eligible_completed_capsule(origin)
    m.need(set(INPUTS) <= set(origin['artifacts']) and all(origin['artifacts'][name]['database'] == 'postgres' for name in INPUTS), 'H71_INPUT_PURPOSE_OR_MISSING')
    m.need(origin['artifacts']['pg_manifest.dpapi']['plain_sha256'] == MANIFEST_SHA and
           origin['artifacts']['pg_archive.dpapi']['plain_sha256'] == ARCHIVE_SHA, 'H71_PINNED_ARTIFACTS')


def validate_manifest(manifest):
    m.need(manifest.get('format') == 3 and manifest.get('run_id') == SNAPSHOT_ID and
           manifest.get('parent_run_id') == ORIGIN_ID and manifest.get('source_database') == 'postgres' and
           manifest.get('project') == m.base.PROJECT and manifest.get('workdir') == str(m.ROOT) and
           manifest.get('source_system_identifier') == m.analytics.CLUSTER and
           manifest.get('client_endpoint') == '127.0.0.1:54322/postgres' and
           manifest.get('archive_filename') == 'retained_postgres_after_006.dump', 'H71_MANIFEST_BINDING')
    captured = manifest['captured']; m.validate_catalog(captured)
    m.need(len(captured['rows']) == 71 and sum(row['count'] for row in captured['rows'].values()) == 824 and
           sum(t['kind'] == 'r' for t in captured['catalog']) == 70 and
           sum(t['is_partition'] for t in captured['catalog']) == 8, 'H71_HISTORICAL_INVENTORY')
    m.need(captured['state']['versions'] == [name.split('_')[0] for name in sorted(manifest['migration_file_sha256'])] and
           len(captured['state']['versions']) == 6 and captured['state']['routes'] == m.backup.CANONICAL and
           captured['state']['active'] == captured['state']['open_days'] == 0, 'H71_HISTORICAL_STATE')


def validate_live_comparison(comparison, accepted_failure):
    # This is an acknowledged, still-failing comparison, not a new pruning rule.
    m.need(comparison['strict_classifier'] == accepted_failure and accepted_failure['result'] == 'FAIL' and
           comparison['removed_tables'] == ['"realtime"."messages_2026_10_14"'] and
           not comparison['unequal_shared_non_subscription_tables'] and
           all(comparison[key] for key in ('roles_equal', 'additional_acl_settings_equal', 'routing_equal', 'ancillary_equal')),
           'H71_UNEXPECTED_LIVE_CHANGE')


def offline():
    sys.path.insert(0, str(m.ROOT / 'tests/frontend'))
    names = ['test_backup_automation', 'test_internal_restore', 'test_schema_privilege_recovery',
             'test_post_migration_backup', 'test_pre_google_recovery', 'test_realtime_preservation',
             'test_dual_database_recovery', 'test_realtime_lifecycle_review', 'test_historical_postgres_71']
    result = unittest.TextTestRunner(stream=io.StringIO()).run(unittest.defaultTestLoader.loadTestsFromNames(names))
    m.need(result.wasSuccessful() and not result.skipped, 'H71_OFFLINE_TESTS')
    return {'passed': result.testsRun, 'failed': 0, 'skipped': 0}


class HistoricalRun:
    """Compose only reviewed destination operations; do not inherit a backup CLI."""
    def __init__(self):
        self.id = uuid.uuid4().hex[:8]
        self.path = m.ROOT / f'supabase/tests/results/historical_postgres_71_restore_{self.id}.json'
        self.directory = m.backup.BACKUPS / ('dual_' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '_' + self.id)
        m.need(not self.path.exists() and not self.directory.exists(), 'H71_NEW_IDENTITY')
        self.destinations = []; self.owned_volumes = []
        self.store = m.EncryptedStore(self.directory)
        self.record = {'run_id': self.id, 'result': 'IN_PROGRESS_HISTORICAL_RESTORE', 'phase': 'offline-tests',
            'started_at': datetime.now(timezone.utc).isoformat(), 'databases': {},
            'source_backup_run': ORIGIN_ID, 'snapshot_identity': SNAPSHOT_ID, 'origin_evidence_sha256': ORIGIN_SHA,
            'new_source_backup': False, 'retained_writes': False, 'retained_restart': False,
            'google_credential_contents_accessed': False, 'current_inventory_recovery_prerequisites_satisfied': False,
            'retained_vector_execution_authorized': False, 'analytics_recovery_authorized': False}

    def save(self, phase=None):
        if phase: self.record['phase'] = phase
        m.backup.write_json(self.path, self.record)

    def start_destination(self, manifest, prefix):
        return m.Run.start_destination(self, manifest, prefix)

    def supplements(self, dest, manifest, prefix):
        return m.Run.supplements(self, dest, manifest, prefix)

    def stop(self, dest):
        return m.Run.stop(self, dest)

    def live(self, items):
        current, bodies, _ = inspection.collect_source(items)
        comparison = inspection.compare_live(self.manifest['captured'], current)
        validate_live_comparison(comparison, self.known_failure)
        _, _, identity = m.backup.target()
        m.need(identity['migration_sha256'] == self.manifest['migration_file_sha256'] and
               m.recovery.service_inventory() == self.manifest['source_images'] and
               m.backup.file_sha256(m.ROOT / 'supabase/config.toml') == m.base.gate.CONFIG_SHA256 and
               current['state']['active'] == current['state']['open_days'] == 0, 'H71_LIVE_IDENTITY_CONFIG_WORK')
        auth = next(x for x in items if x['Name'] == '/supabase_auth_school-queue-local')
        auth_settings = {key: value for entry in auth['Config']['Env'] for key, _, value in [entry.partition('=')] if key in AUTH_KEYS}
        m.need(auth_settings == self.manifest70['auth_nonsecret_settings'], 'H71_AUTH_SETTINGS')
        inspection.disabled_provider()
        return current, bodies, comparison

    def preflight(self):
        m.need(not any(m.backup.clean_env().get(k) for k in ('DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH')), 'H71_DOCKER_OVERRIDE')
        m.need(m.checked(['docker', 'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']).decode().strip() ==
               'npipe:////./pipe/dockerDesktopLinuxEngine', 'H71_DOCKER_CONTEXT')
        origin, source_store = inspection.open_origin(ORIGIN_ID)
        validate_origin(origin); source_store.verify()
        self.manifest = json.loads(source_store.get('pg_manifest.dpapi', 'postgres')); validate_manifest(self.manifest)
        m.need(m.sha(source_store.get('pg_manifest.dpapi', 'postgres')) == MANIFEST_SHA, 'H71_MANIFEST_HASH')
        m.need(m.backup.file_sha256(ASSESSMENT) == ASSESSMENT_SHA, 'H71_KNOWN_FAILURE_RECEIPT')
        self.known_failure = json.loads(ASSESSMENT.read_text())['postgres_after']['strict_classifier']
        self.manifest70, self.record['historical_bundles'] = m.Run.__new__(m.Run).historical()
        self.services_before = m.analytics.project_items()
        previous = json.loads((m.ROOT / 'supabase/tests/results/postgres_analytics_recovery_8fa0e0c7.json').read_text())
        m.need([m.base.state(x) for x in self.services_before if x['Name'] != '/' + m.base.VECTOR] ==
               [x for x in previous['retained_after'] if x['container'] != m.base.VECTOR], 'H71_PRIOR_SERVICE_LIFECYCLE')
        vector = next(x for x in self.services_before if x['Name'] == '/' + m.base.VECTOR)
        m.need(vector['Id'] == m.fences.VECTOR_ID and m.fences.vector_config_hash() == m.fences.YAML_SHA, 'H71_VECTOR_IDENTITY')
        self.initial_live, bodies, comparison = self.live(self.services_before)
        self.record['live_before'] = comparison
        archive = source_store.get('pg_archive.dpapi', 'postgres')
        m.need(m.sha(archive) == ARCHIVE_SHA, 'H71_ARCHIVE_HASH')
        toc = m.decoded_text(m.checked([m.backup.pgtool('pg_restore'), '--list'], data=archive))
        coverage = m.backup.archive_completeness(toc, self.manifest['captured']['catalog'], self.manifest['captured']['rows'], self.manifest['captured']['schema']['extensions'])
        m.need(coverage['table_data_entries'] == 70 and coverage['partition_attachments'] == 8 and
               not coverage['extension_recreated_empty_tables'], 'H71_ARCHIVE_COVERAGE')
        # Prove this native text transport before a destination or SQL write exists.
        raw = m.checked([m.backup.pgtool('pg_restore'), '--exit-on-error', '--single-transaction', '--file=-'], data=archive)
        decoded = m.decoded_text(raw).encode()
        app = [x for x in bodies if '\n' in x['body']]
        m.need(len(app) == 23 and all(self.manifest['captured']['schema']['functions'][x['key']]['definition'] == x['definition'] for x in bodies)
               and all(x['body'].encode().replace(b'\n', b'\r\n') in raw and x['body'].encode() in decoded for x in app), 'H71_NATIVE_TEXT_MODE')
        self.record['transport_preflight'] = {'native_crt_expansion_confirmed': True, 'exact_multiline_application_bodies': len(app), 'binary_archive_sha256': m.sha(archive)}
        m.need(shutil.disk_usage(m.ROOT).free >= 1536 * 1024 * 1024, 'H71_FREE_SPACE')
        self.resources_before = m.fences.resources(); self.credential_before = m.base.credential_metadata()
        self.old_files = m.recovery.historical_files(self.directory)
        self.frozen = m.recovery.immutable_inputs(self.path)
        self.frozen.update({str(p.relative_to(m.ROOT)): m.backup.file_sha256(p) for p in (m.ROOT / 'scripts').glob('*') if p.is_file()})
        m.fences.assert_locks()
        with m.backup.Snapshot(m.source_env('_supabase')) as s:
            m.validate_source_identity(m.source_identity(s.query), '_supabase')
            self.record['analytics_before_read_only'] = m.analytics_preservation(m.collect(s.query, '_supabase'))
        self.record['original_artifacts_verified'] = len(source_store.artifacts)
        self.record['archive_coverage'] = {k: v for k, v in coverage.items() if k != 'dumped_tables'}
        self.record['tools'] = {tool: {'version': m.checked([m.backup.pgtool(tool), '--version']).decode().strip(),
            'executable_sha256': m.backup.file_sha256(Path(m.backup.pgtool(tool)))} for tool in ('pg_restore',)}
        m.need('18.6' in self.record['tools']['pg_restore']['version'], 'H71_PG_RESTORE_VERSION')
        self.source_store = source_store
        return origin

    def preservation(self):
        after = m.analytics.project_items()
        current, _, comparison = self.live(after)
        self.record['live_after'] = comparison
        within = m.recovery.compare_source(self.initial_live, current)
        m.need(current['ancillary'] == self.initial_live['ancillary'] and current['routing'] == self.initial_live['routing'], 'H71_WITHIN_RUN_ANCILLARY')
        m.fences.unchanged_retained(self.services_before, after)
        m.need(m.base.credential_metadata() == self.credential_before and m.fences.vector_config_hash() == m.fences.YAML_SHA, 'H71_CREDENTIAL_METADATA_OR_VECTOR')
        now = m.fences.resources()
        m.need(set(now['containers']) == set(self.resources_before['containers']) | {d.entry['container_id'] for d in self.destinations}
               and set(now['volumes']) == set(self.resources_before['volumes']) | set(self.owned_volumes)
               and now['networks'] == self.resources_before['networks'], 'H71_RESOURCE_DELTA')
        m.need(m.recovery.historical_files(self.directory) == self.old_files, 'H71_HISTORICAL_FILE_CHANGED')
        m.need(all(m.backup.file_sha256(m.ROOT / p) == h for p, h in self.frozen.items()), 'H71_FROZEN_INPUT_CHANGED')
        m.Run.__new__(m.Run).historical(); self.source_store.verify(); self.store.verify()
        m.fences.assert_locks()
        m.need('VPR_RETAINED_EXECUTION_NOT_CERTIFIED' in (m.ROOT / 'scripts/Repair-LocalVector.ps1').read_text(), 'H71_VECTOR_LOCK')
        with m.backup.Snapshot(m.source_env('_supabase')) as s:
            m.validate_source_identity(m.source_identity(s.query), '_supabase')
            self.record['analytics_after_read_only'] = m.analytics_preservation(m.collect(s.query, '_supabase'))
        self.record['preservation'] = {'within_run_source_comparison': within, 'known_historical_live_comparison': 'FAIL_PRUNING_UNCHANGED',
            'old_backup_files': m.recovery.tree_summary(self.old_files), 'frozen_inputs_unchanged': len(self.frozen),
            'eleven_other_service_definitions_lifecycles_exact': True, 'vector_definition_exact': True,
            'google_store_metadata_only_unchanged': True, 'only_owned_resource_additions': True, 'all_execution_locks_intact': True}

    def run(self):
        ready = False; self.save()
        try:
            self.record['offline'] = offline(); self.save('historical-and-live-preflight')
            origin = self.preflight(); ready = True
            m.backup.secure_directory(self.directory)
            self.record['directory'] = str(self.directory)
            for name in INPUTS:
                self.store.put(name, 'postgres', self.source_store.get(name, 'postgres'))
            self.record['databases']['postgres'] = {key: deepcopy(value) for key, value in origin['databases']['postgres'].items() if key != 'destination'}
            self.record['databases']['postgres'].update(verification_run_id=self.id, historical_snapshot_only=True,
                source_backup_run_id=ORIGIN_ID, source_dump_repeated=False)
            self.save('historical-inputs-privately-copied')
            m.Run.restore(self, self.manifest, 'pg')
            self.preservation()
            self.record.update(result='PASS_HISTORICAL_SNAPSHOT_RECOVERY_VERIFIED', phase='complete',
                historical_snapshot_recoverability_verified=True, live_source_preservation='FAIL_PRUNING_UNCHANGED',
                current_inventory_recovery_prerequisites_satisfied=False)
        except BaseException as error:
            code = str(error)
            self.record.update(result='FAIL_HISTORICAL_RESTORE_STOPPED', failure=code if re.fullmatch(r'(H71|DAR|VST)_[A-Z0-9_]+', code) else 'H71_SANITIZED_STOP',
                failure_exception_type=type(error).__name__, historical_snapshot_recoverability_verified=False,
                failure_code_locations=[{'file': Path(frame.filename).name, 'function': frame.name, 'line': frame.lineno} for frame in traceback.extract_tb(error.__traceback__)])
            for dest in self.destinations:
                try: self.stop(dest)
                except Exception: self.record['owned_destination_stop_requires_review'] = True
            if ready:
                try: self.preservation()
                except Exception: self.record['final_preservation'] = 'FAIL_READ_ONLY_REVIEW_REQUIRED'
        self.record.update(artifacts=deepcopy(self.store.artifacts), owned_volumes=self.owned_volumes, finished_at=datetime.now(timezone.utc).isoformat())
        self.save()
        print(json.dumps({'result': self.record['result'], 'failure': self.record.get('failure'), 'evidence': self.path.relative_to(m.ROOT).as_posix()}))
        return 0 if self.record['result'] == 'PASS_HISTORICAL_SNAPSHOT_RECOVERY_VERIFIED' else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', action='store_true', help='Restore only the fixed historical capsule into one new isolated destination.')
    args = parser.parse_args()
    if args.run:
        sys.exit(HistoricalRun().run())
    print(json.dumps({'result': 'PASS_OFFLINE_ONLY', **offline()}))
