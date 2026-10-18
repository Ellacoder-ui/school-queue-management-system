"""Read-only verifier for a checksum-bound completed Step 22.8E reference.

No dump, restore, service start/stop or configuration path. Does not replace or
relax historical 70-table entry points. Google credential contents are not read.
"""
import argparse
import json
from pathlib import Path
import re
import sys
import uuid
from datetime import datetime, timezone

import dual_database_recovery as m


def analytics_reference(value):
    return {'table_count': len(value['catalog']), 'catalog_sha256': m.analytics.digest(value['catalog']),
            'metadata': {k: {'count': len(v), 'sha256': m.analytics.digest(v)} for k, v in value['schema'].items()},
            'roles': {'sha256': m.analytics.digest(value['roles'])},
            'additional': {k: {'count': len(v), 'sha256': m.analytics.digest(v)} for k, v in value['additional_privileges'].items()},
            'sequences': value['sequences'], 'tables': [
                {'identity_sha256': m.analytics.digest(m.backup.table_key(t['schema'], t['table'])), 'table': t['table'],
                 'count': value['rows'][m.backup.table_key(t['schema'], t['table'])]['count'],
                 'sha256': m.analytics.digest(value['rows'][m.backup.table_key(t['schema'], t['table'])]['rows'])}
                for t in value['catalog']]}


def verify(run_id, evidence_sha256):
    m.need(re.fullmatch(r'[0-9a-f]{8}', run_id) and re.fullmatch(r'[0-9a-f]{64}', evidence_sha256), 'DAR_REFERENCE_ARGUMENTS')
    path = m.ROOT / f'supabase/tests/results/postgres_analytics_recovery_{run_id}.json'
    m.need(m.backup.file_sha256(path) == evidence_sha256, 'DAR_REFERENCE_EVIDENCE_HASH')
    record = json.loads(path.read_text())
    m.need(record['run_id'] == run_id and record['result'] == 'PASS_DATABASE_RECOVERY_VERIFIED' and
           set(record['databases']) == {'postgres', '_supabase'} and record['current_inventory_recovery_prerequisites_satisfied'], 'DAR_REFERENCE_NOT_VERIFIED')
    store = m.EncryptedStore(Path(record['directory'])); store.artifacts = record['artifacts']
    store.verify()
    manifests = {}
    for database, prefix in [('postgres', 'pg'), ('_supabase', 'an')]:
        manifest = json.loads(store.get(prefix + '_manifest.dpapi', database))
        bundle = json.loads(store.get(prefix + '_bundle.dpapi', database))
        entry = record['databases'][database]
        m.need(manifest['format'] == bundle['format'] == 3 and manifest['source_database'] == database and
               manifest['source_system_identifier'] == m.analytics.CLUSTER and manifest['project'] == m.base.PROJECT and
               manifest['workdir'] == str(m.ROOT) and manifest['client_endpoint'] == '127.0.0.1:54322/' + database,
               'DAR_REFERENCE_SOURCE_BINDING')
        m.need(bundle['parent_run_id'] == run_id and bundle['run_id'] == manifest['run_id'] == entry['run_id'] and
               bundle['recoverability_verified'] is True and entry['result'] == 'VERIFIED_RECOVERABLE' and entry['no_clone_exemptions'], 'DAR_REFERENCE_BUNDLE_STATUS')
        m.need(all(store.artifacts.get(name) == meta for name, meta in bundle['artifacts'].items()), 'DAR_REFERENCE_ARTIFACT_ASSOCIATION')
        archive = store.get(prefix + '_archive.dpapi', database)
        toc = m.decoded_text(m.checked([m.backup.pgtool('pg_restore'), '--list'], data=archive))
        complete = m.backup.archive_completeness(toc, manifest['captured']['catalog'], manifest['captured']['rows'], manifest['captured']['schema']['extensions'])
        m.need(complete['table_data_entries'] == complete['physical_tables'] and not complete['extension_recreated_empty_tables'], 'DAR_REFERENCE_COVERAGE')
        dest = m.PrivateDestination(entry['destination'], store, prefix, m.analytics.CLUSTER)
        stopped = dest.guard(running=False)
        m.need(not stopped['State']['Running'] and stopped['State']['ExitCode'] == 0, 'DAR_REFERENCE_CLONE_NOT_RETAINED_STOPPED')
        manifests[database] = manifest
    _, old = m.Run.__new__(m.Run).historical()  # Artifact checks only; never constructs/runs a backup.
    source, checks = m.recovery.inspect_source()
    m.need(checks['google_provider_enabled'] is False, 'DAR_REFERENCE_GOOGLE')
    m.need(m.recovery.service_inventory() == manifests['postgres']['source_images'], 'DAR_REFERENCE_SERVICE_IMAGES')
    m.need(source['identity']['migration_sha256'] == manifests['postgres']['migration_file_sha256'], 'DAR_REFERENCE_MIGRATION_HASHES')
    classified = m.recovery.compare_source(manifests['postgres']['captured'], source)
    m.need(source['catalog'] == manifests['postgres']['captured']['catalog'], 'DAR_REFERENCE_NEWER_CURRENT_INVENTORY_REVIEW_REQUIRED')
    with m.backup.Snapshot(m.source_env('postgres')) as snapshot:
        pg = m.collect(snapshot.query, 'postgres')
    m.need(pg['ancillary'] == manifests['postgres']['captured']['ancillary'], 'DAR_REFERENCE_ANCILLARY')
    with m.backup.Snapshot(m.source_env('_supabase')) as snapshot:
        m.validate_source_identity(m.source_identity(snapshot.query), '_supabase')
        current = m.collect(snapshot.query, '_supabase')
    analytical = m.analytics_preservation(current, analytics_reference(manifests['_supabase']['captured']))
    m.fences.assert_locks()
    return {'result': 'PASS_READ_ONLY_CURRENT_RECOVERY_REFERENCE', 'reference_run': run_id, 'reference_evidence_sha256': evidence_sha256,
            'postgres_tables': len(source['rows']), 'analytics_tables': len(current['rows']),
            'postgres_preservation': classified, 'analytics_preservation': analytical,
            'artifacts_decrypted_and_hash_verified': len(store.artifacts), 'both_stopped_clone_identities_verified': True,
            'historical_bundles_verified': True, 'google_enabled': False, 'retained_mutation': False,
            'backup_restore_or_service_operation': False, 'google_credential_contents_accessed': False}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--run-id', required=True)
    p.add_argument('--evidence-sha256', required=True)
    args = p.parse_args()
    result = {'result': 'FAIL_READ_ONLY_REFERENCE', 'checked_at': datetime.now(timezone.utc).isoformat()}
    try: result.update(verify(args.run_id, args.evidence_sha256))
    except Exception as error:
        code = str(error)
        result['failure'] = code if re.fullmatch(r'DAR_[A-Z0-9_]+', code) else 'DAR_REFERENCE_SANITIZED_STOP'
    path = m.ROOT / f'supabase/tests/results/dual_recovery_reference_check_{uuid.uuid4().hex[:8]}.json'
    with path.open('x', encoding='utf-8') as handle: json.dump(result, handle, indent=2)
    print(json.dumps({'result': result['result'], 'evidence': path.relative_to(m.ROOT).as_posix()}))
    sys.exit(0 if result['result'] == 'PASS_READ_ONLY_CURRENT_RECOVERY_REFERENCE' else 1)
