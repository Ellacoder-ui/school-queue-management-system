"""Read-only Step 22.7 bridge. Emits a nonsecret receipt, never provider credentials.

No restoration, migration, service startup/shutdown or configuration write path.
"""
import argparse
import json
from pathlib import Path
import sys

import pre_google_oauth_recovery as recovery

ROOT = recovery.ROOT
EVIDENCE = ROOT / 'supabase/tests/results/pre_google_oauth_recovery_6e3beebe.json'
EVIDENCE_SHA256 = 'e1cdfd117369f4469b2b74a1f66ad520d664b848e8452b1009e782ec06d78784'
CONFIG_SHA256 = recovery.reference()['config_sha256']


def require(condition, code):
    if not condition:
        raise RuntimeError(code)


def validate_bound_source(manifest, source, checks):
    identity = source['identity']
    require(identity['project'] == 'school-queue-local' and identity['api'] == 'http://127.0.0.1:54321' and
            identity['database_endpoint'] == '127.0.0.1:54322', 'LCG_TARGET')
    require(identity == manifest['source'] and source['system_identifier'] == '7696959712798593061' and
            source['system_identifier'] == manifest['source_system_identifier'], 'LCG_IDENTITY')
    require(identity['docker'][0]['container'] == identity['docker'][0]['volumes'][0] == 'supabase_db_school-queue-local' and
            identity['docker'][0]['networks'] == ['supabase_network_school-queue-local'], 'LCG_VOLUME')
    require(checks['google_provider_enabled'] is False and checks['auth_nonsecret_settings'] == manifest['auth_nonsecret_settings'], 'LCG_AUTH')
    recovery.validate_inventory(source)
    return recovery.compare_source(manifest, source)


def check():
    require(Path.cwd().resolve() == ROOT.resolve() and str(ROOT).lower() ==
            r'C:\Users\Hp\school-queue-management-system'.lower(), 'LCG_WORKSPACE')
    require(recovery.backup.file_sha256(EVIDENCE) == EVIDENCE_SHA256, 'LCG_RECOVERY_EVIDENCE')
    record = json.loads(EVIDENCE.read_text(encoding='utf-8'))
    require(record['result'] == 'PASS' and record['phase'] == 'complete' and record['recoverability_verified'], 'LCG_RECOVERY_STATUS')
    require(recovery.backup.file_sha256(ROOT / 'supabase/config.toml') == CONFIG_SHA256, 'LCG_CONFIG')
    verifier = recovery.Run.__new__(recovery.Run)  # Never invoke the backup/restore constructor/run.
    verifier.id = record['run_id']; verifier.record = record; verifier.directory = Path(record['directory'])
    manifest = verifier.verify_bundle()
    require(len(manifest['rows']) == 70 and manifest['run_id'] == '6e3beebe', 'LCG_RECOVERY_BINDING')
    current, checks = recovery.inspect_source()
    preservation = validate_bound_source(manifest, current, checks)
    require(recovery.service_inventory() == manifest['service_images'], 'LCG_SERVICE_IMAGES')
    _, env, _ = recovery.backup.target()
    with recovery.backup.Snapshot(env) as snapshot:
        require(recovery.prior.routing_metadata(snapshot.query) == manifest['routing'], 'LCG_ROUTING')
        require(recovery.prior.restore_prerequisites(snapshot.query) == manifest['prerequisites'], 'LCG_PREREQUISITES')
    historical = recovery.historical_bundles()
    tree = recovery.tree_summary(recovery.historical_files(verifier.directory))
    require(historical == record['historical_bundles'] and tree == record['historical_file_tree'], 'LCG_HISTORICAL_BUNDLES')
    destination = recovery.internal.Destination(record['destination'], verifier.directory / 'restore_verification')
    require(not destination.guard(running=False)['State']['Running'], 'LCG_RECOVERY_DESTINATION')
    return {'result': 'PASS', 'mode': 'READ_ONLY_PREFLIGHT', 'project': 'school-queue-local',
            'api': 'http://127.0.0.1:54321', 'database': '127.0.0.1:54322/postgres',
            'system_identifier': current['system_identifier'], 'migration_count': 6, 'logical_tables': 70,
            'google_enabled': False, 'active_tickets': 0, 'config_sha256': CONFIG_SHA256,
            'recovery_run': record['run_id'], 'recovery_bundle_sha256': record['bundle']['sha256'],
            'fresh_and_historical_artifacts_intact': True, 'preservation': preservation,
            'retained_service_restart': False, 'source_writes': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', required=True)
    parser.parse_args()
    try:
        print(json.dumps(check(), sort_keys=True))
    except Exception:
        print(json.dumps({'result': 'FAIL', 'code': 'LCG_LOCAL_PREFLIGHT_REJECTED'}))
        sys.exit(1)
