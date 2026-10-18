"""Step 22.6: new 70-table recovery proof; source reads only, no provider/restart.

Historical runners/evidence remain immutable. Reuse the tested socket destination,
ACL generators and dump primitives, with a new snapshot and strict restore comparison.
Only source preservation uses the existing narrow Realtime lifecycle classifier.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sys
import uuid

import post_migration_006_backup as prior

ROOT = prior.ROOT
sys.path.insert(0, str(ROOT / 'tests/frontend'))
import realtime_preservation as realtime
from run_google_auth import inspect as inspect_source

backup = prior.backup
internal = prior.internal
privileges = prior.privileges
require = prior.require
REFERENCE = ROOT / 'supabase/tests/results/local_google_provider_preparation_6dd1674f.json'
REFERENCE_SHA256 = '24c6df4dd0b49e5405bb7e7138f37ce5e371f4b13ca7ebec1e541ac58fba003b'
PRIOR_EVIDENCE = ROOT / 'supabase/tests/results/post_migration_006_backup_4c79fb00.json'
SECTIONS = {'rows', 'catalog', 'schema', 'roles', 'sequences', 'state', 'additional_privileges', 'routing'}
FILES = (prior.ARCHIVE, prior.MANIFEST, prior.ROLES, prior.ENVIRONMENT, prior.SCHEMA_SQL, prior.ENVIRONMENT_SQL)


def reference():
    require(backup.file_sha256(REFERENCE) == REFERENCE_SHA256, 'Step 22.5 reference checksum differs')
    value = json.loads(REFERENCE.read_text(encoding='utf-8'))
    require(value['result'] == 'PASS_READ_ONLY_LOCAL_INSPECTION' and value['logical_tables'] == 70,
            'Completed 70-table preparation reference required')
    return value


def validate_inventory(value):
    expected = reference()['source']
    require(len(value['rows']) == 70 and set(value['rows']) == set(expected['rows']), 'Exact reviewed 70-table inventory required')
    require(value['catalog'] == expected['catalog'], 'Reviewed partition/table catalog differs')
    require(value['state']['versions'] == expected['state']['versions'] and len(value['state']['versions']) == 6,
            'Exactly six reviewed migration receipts required')
    require(value['state']['routes'] == backup.CANONICAL and value['state']['active'] == 0 and value['state']['open_days'] == 0,
            'Unsafe routing/queue-work state')
    require(value['state']['rls_count'] == 15 and not value['state']['private_usage'] and
            value['state']['publication'] == realtime.PUBLIC_TABLES, 'Application security boundary differs')
    require(value['state']['counts'] == expected['state']['counts'] and value['state']['assignments'] == expected['state']['assignments'],
            'Historical counts/staffing differ')
    keys = {backup.table_key(t['schema'], t['table']) for t in value['catalog']}
    require(len(keys) == len(value['catalog']) and keys == set(value['rows']), 'Catalog/fingerprint identities differ')
    for table in value['catalog']:
        if table['schema'] == 'realtime' and table['table'].startswith('messages'):
            require(value['rows'][backup.table_key(table['schema'], table['table'])] == {'count': 0, 'rows': []},
                    'Reviewed Realtime message tables must remain empty')


def compare_restored(manifest, observed):
    """No Realtime exemptions on the restored clone: everything must match its snapshot."""
    require(set(observed) == SECTIONS, 'All restored integrity sections required')
    backup.compare_rows(manifest['rows'], observed['rows'])
    for section in SECTIONS - {'rows'}:
        require(manifest[section] == observed[section], 'Restored integrity differs: ' + section)
    validate_inventory(observed)
    prior.validate_routing(observed['routing'])


def compare_source(manifest, observed):
    # Select exact same fields on both sides. The reviewed classifier checks all of
    # them, allowing only proven anonymous subscriptions/allocations/empty daily leaves.
    required = SECTIONS - {'routing'}
    if not required <= set(manifest) or not required | {'clock', 'platform'} <= set(observed):
        raise realtime.PreservationError(['source.missing_preservation_evidence'])
    return realtime.bundle_comparison(manifest, observed)


def service_inventory():
    names = ['supabase_' + kind + '_school-queue-local' for kind in ('db', 'kong', 'auth', 'realtime')]
    items = json.loads(backup.call(['docker', 'inspect', *names], label='Read-only retained service image inventory').stdout)
    result = {}
    for name, item in zip(names, items):
        require(item['Name'] == '/' + name and item['State']['Running'], 'Retained service identity/state differs')
        require(sorted(item['NetworkSettings']['Networks']) == ['supabase_network_school-queue-local'], 'Retained service network differs')
        result[name] = {'image': item['Config']['Image'], 'image_id': item['Image'],
                        'volumes': sorted(m['Name'] for m in item['Mounts'] if m['Type'] == 'volume')}
    expected = reference()
    require(result[names[2]]['image_id'] == expected['auth_image_id'] and result[names[2]]['image'] == expected['auth_image'],
            'Auth image changed from reviewed disabled-provider baseline')
    require(result[names[3]]['image'] == realtime.IMAGE and result[names[3]]['image_id'] == realtime.IMAGE_ID,
            'Realtime image changed')
    require(result[names[0]]['image'] == internal.IMAGE, 'PostgreSQL platform image differs')
    return result


def historical_bundles():
    older = prior.old_bundle()  # Artifacts/ACLs only; no old live-source equality.
    record = json.loads(PRIOR_EVIDENCE.read_text(encoding='utf-8'))
    require(record['result'] == 'PASS' and record['recoverability_verified'] and record['phase'] == 'complete',
            'Verified historical six-version recovery point required')
    verifier = prior.Run.__new__(prior.Run)
    verifier.id = record['run_id']; verifier.record = record; verifier.directory = Path(record['directory'])
    manifest = verifier.verify_bundle()
    require(len(manifest['rows']) == 69, 'Historical recovery inventory changed')
    return {'five_version': older, 'six_version': {'directory': str(verifier.directory),
            'evidence_sha256': backup.file_sha256(PRIOR_EVIDENCE), 'bundle': record['bundle'], 'artifacts': record['artifacts']}}


def historical_files(exclude):
    """Hash every pre-existing backup file; never read its contents into logs."""
    root = backup.BACKUPS.resolve()
    result = {}
    for path in backup.BACKUPS.rglob('*'):
        resolved = path.resolve()
        require(resolved.is_relative_to(root), 'Historical backup path escaped backup root')
        if resolved.is_relative_to(exclude.resolve()) or not path.is_file():
            continue
        result[str(path.relative_to(backup.BACKUPS))] = {'bytes': path.stat().st_size, 'sha256': backup.file_sha256(path)}
    return result


def tree_summary(files):
    return {'files': len(files), 'sha256': hashlib.sha256(json.dumps(files, sort_keys=True).encode('utf-8')).hexdigest()}


def immutable_inputs(exclude):
    paths = list((ROOT / 'supabase').glob('*.md')) + list((ROOT / 'supabase/tests/results').glob('*.json'))
    paths += list((ROOT / 'supabase/migrations').glob('*.sql'))
    paths += list((ROOT / 'supabase/tests').glob('*.py')) + list((ROOT / 'tests/frontend').glob('*.py'))
    paths += [p for p in (ROOT / 'src').rglob('*') if p.is_file()]
    paths += [ROOT / p for p in ('supabase/config.toml', 'package.json', 'package-lock.json', '.gitignore')]
    return {str(p.relative_to(ROOT)): backup.file_sha256(p) for p in sorted(set(paths)) if p != exclude}


class Run(prior.Run):
    # Inherited destination/grant code uses the same reviewed seven artifact names.
    # The new directory, evidence identity and snapshot keep all historical files intact.
    def __init__(self):
        self.id = uuid.uuid4().hex[:8]
        self.evidence = ROOT / f'supabase/tests/results/pre_google_oauth_recovery_{self.id}.json'
        self.directory = backup.BACKUPS / ('pre_google_' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '_' + self.id)
        require(not self.evidence.exists() and not self.directory.exists(), 'New recovery identity already exists')
        self.record = dict(run_id=self.id, result='IN_PROGRESS', phase='source-preflight',
                           started_at=datetime.now(timezone.utc).isoformat(), migration_applied=False,
                           source_writes=False, hosted_contacted=False, retained_restart=False,
                           google_enabled=False, recoverability_verified=False)
        self.destination = None

    def source_compare(self, manifest):
        current, checks = inspect_source()
        require(current['identity'] == manifest['source'] and current['system_identifier'] == manifest['source_system_identifier'],
                'Source project/endpoint/volume/cluster changed')
        classified = compare_source(manifest, current)
        require(service_inventory() == manifest['service_images'], 'Retained service image/volume inventory changed')
        require(checks['auth_nonsecret_settings'] == manifest['auth_nonsecret_settings'] and checks['google_provider_enabled'] is False,
                'Auth provider/settings changed')
        _, env, _ = backup.target()
        with backup.Snapshot(env) as snapshot:
            require(prior.routing_metadata(snapshot.query) == manifest['routing'], 'Source routing constraints/links changed')
            require(prior.restore_prerequisites(snapshot.query) == manifest['prerequisites'], 'Source prerequisites changed')
        self.record['latest_source_preservation'] = classified
        return current

    def verify_bundle(self):
        manifest = super().verify_bundle()
        validate_inventory(manifest)
        prior.validate_routing(manifest['routing'])
        require(manifest['source_system_identifier'] == prior.cutover.SOURCE_IDENTIFIER and
                manifest['preparation_reference_sha256'] == REFERENCE_SHA256, 'New bundle reference/source binding differs')
        return manifest

    def backup(self, env, before):
        backup.secure_directory(self.directory)
        self.acl([self.directory / 'process_access_probe.txt'])
        self.record['directory'] = str(self.directory)
        self.checkpoint('snapshot-capture')
        archive = self.directory / prior.ARCHIVE
        manifest_path = self.directory / prior.MANIFEST
        roles_path = self.directory / prior.ROLES
        services = service_inventory()
        with backup.Snapshot(env) as snapshot:
            exported = snapshot.raw('select pg_export_snapshot();')
            require(re.fullmatch(r'[0-9A-Fa-f-]+', exported) is not None, 'Invalid exported snapshot')
            captured = prior.collect(snapshot.query)
            validate_inventory(captured)
            platform = snapshot.query(realtime.PLATFORM_SQL)
            platform.update({k: before['platform'][k] for k in ('image', 'image_id', 'release')})
            clock = snapshot.query('select to_jsonb(clock_timestamp())')
            compare_source(before, {**captured, 'platform': platform, 'clock': clock})
            prerequisites = prior.restore_prerequisites(snapshot.query)
            require(prerequisites['large_object_count'] == 0, 'Nonzero large objects require additional recovery support')
            raw_settings = snapshot.query("""select coalesce(jsonb_agg(jsonb_build_object(
                'role',case when s.setrole=0 then null else pg_get_userbyid(s.setrole) end,
                'settings',to_jsonb(s.setconfig)) order by s.setrole=0,pg_get_userbyid(s.setrole)),'[]')
                from pg_db_role_setting s where s.setdatabase=(select oid from pg_database where datname=current_database())""")
            manifest = {'format': 2, 'run_id': self.id, 'captured_at_utc': datetime.now(timezone.utc).isoformat(),
                        'source': before['identity'], 'source_system_identifier': before['system_identifier'],
                        'archive_filename': prior.ARCHIVE, 'exported_snapshot': exported,
                        'preparation_reference_sha256': REFERENCE_SHA256, 'prerequisites': prerequisites,
                        'clock': clock, 'platform': platform, 'service_images': services,
                        'auth_nonsecret_settings': self.record['source_auth_settings'], **captured}
            backup.write_json(manifest_path, manifest)
            self.record['manifest'] = {'filename': prior.MANIFEST, 'sha256': backup.file_sha256(manifest_path),
                                       'bytes': manifest_path.stat().st_size}
            self.checkpoint('manifest-saved-before-dump')
            self.non_mvcc_fence(env, manifest)  # Strict even for RT sequence during pg_dump itself.
            result = backup.call([backup.pgtool('pg_dump'), '-w', '--format=custom', '--file', str(archive),
                                  '--snapshot', exported, '--lock-wait-timeout=10s'], env=env, timeout=180,
                                 label='Current 70-table full custom backup')
            require(not result.stderr.strip(), 'pg_dump diagnostics; stop')
            self.record['pg_dump_exit'] = result.returncode
            result = backup.call([backup.pgtool('pg_dumpall'), '-w', '--roles-only', '--no-role-passwords', '--file', str(roles_path)],
                                 env=env, timeout=60, label='Current password-free global role backup')
            require(not result.stderr.strip() and not re.search(r'\bPASSWORD\b', roles_path.read_text(encoding='utf-8'), re.I),
                    'Unexpected role dump diagnostics/password clause')
            self.record['pg_dumpall_exit'] = result.returncode
            self.non_mvcc_fence(env, manifest)
        require(archive.is_file() and archive.stat().st_size > 0, 'Archive missing/empty')
        result = backup.call([backup.pgtool('pg_restore'), '--list', str(archive)], label='Current archive inspection')
        require(not result.stderr.strip(), 'pg_restore list diagnostics; stop')
        complete = backup.archive_completeness(result.stdout, manifest['catalog'], manifest['rows'], manifest['schema']['extensions'])
        require(complete['logical_tables'] == 70 and complete['physical_tables'] == complete['table_data_entries'] == 69 and
                complete['partition_attachments'] == 7 and complete['partitioned_parents'] == ['"realtime"."messages"'] and
                not complete['extension_recreated_empty_tables'], 'Full current table/partition archive coverage required')
        require(not any(re.search(r'ACL - SCHEMA ' + name + r' ', result.stdout) for name in privileges.SCHEMAS),
                'Known schema ACL gap changed; stop')
        prior.write_text(self.directory / 'archive_toc.txt', result.stdout)
        hashes = {name: backup.file_sha256(self.directory / name) for name in (prior.ARCHIVE, prior.MANIFEST, prior.ROLES)}
        proposal = {'authorization': 'Step 22.6 explicit request: source-derived isolated recovery ACL/settings prerequisites',
                    'archive_filename': prior.ARCHIVE, 'source_artifacts': hashes,
                    'source_system_identifier': manifest['source_system_identifier'],
                    'database': manifest['additional_privileges']['database'], 'database_settings': raw_settings}
        backup.write_json(self.directory / prior.ENVIRONMENT, proposal)
        proposal_hash = backup.file_sha256(self.directory / prior.ENVIRONMENT)
        prior.write_text(self.directory / prior.SCHEMA_SQL, privileges.generate_sql(manifest, manifest['source_system_identifier'], source_artifacts=hashes))
        prior.write_text(self.directory / prior.ENVIRONMENT_SQL, privileges.generate_environment_sql(
            proposal, manifest['additional_privileges']['database_settings'], source_artifacts=hashes, proposal_sha256=proposal_hash))
        files = {name: {'sha256': backup.file_sha256(self.directory / name), 'bytes': (self.directory / name).stat().st_size} for name in FILES}
        bundle = {'format': 2, 'run_id': self.id, 'source_system_identifier': manifest['source_system_identifier'],
                  'source_project': backup.PROJECT, 'exported_snapshot': exported, 'versions': manifest['state']['versions'], 'files': files,
                  'restore_order': ['Matching PostgreSQL/image/locale/extensions', 'Password-free global roles', 'Template0 database creation',
                                    'Complete transactional archive restoration', 'Exact gap/data/security verification', 'Schema ACL supplement',
                                    'Source-derived database grants/settings supplement', 'Complete exact source-snapshot/restored comparisons'],
                  'schema_grants': privileges.authorized_grants(manifest), 'database_grants': 5, 'protected_database_settings': 2}
        backup.write_json(self.directory / prior.BUNDLE, bundle)
        self.record['bundle'] = {'filename': prior.BUNDLE, 'sha256': backup.file_sha256(self.directory / prior.BUNDLE),
                                 'bytes': (self.directory / prior.BUNDLE).stat().st_size}
        self.record.update(artifacts=files, archive_completeness=complete,
                           tools={name: backup.call([backup.pgtool(name), '--version']).stdout.strip() for name in ('pg_dump', 'pg_dumpall', 'pg_restore')})
        self.record['acl'] = self.acl([self.directory / name for name in FILES + (prior.BUNDLE, 'archive_toc.txt')])
        self.verify_bundle(); self.source_compare(manifest)
        self.checkpoint('backup-complete')
        print('PASS: fresh protected snapshot/bundle; 70 logical tables, 69 physical data entries and 7 attachments.', flush=True)
        return manifest

    def restore(self, manifest):
        self.verify_bundle(); self.source_compare(manifest)
        dest, folder = self.start_destination(manifest)
        require(dest.entry['image_id'] == manifest['service_images']['supabase_db_school-queue-local']['image_id'],
                'Destination image digest differs from source')
        dest.copy(self.directory / prior.ARCHIVE, prior.ARCHIVE)
        dest.copy(self.directory / prior.ROLES, prior.ROLES)
        existing = dest.query('select jsonb_agg(rolname order by rolname) from pg_roles', 'postgres')
        role_path = folder / 'roles_prepared.sql'
        prior.write_text(role_path, internal.prepare_roles((self.directory / prior.ROLES).read_text(encoding='utf-8'), existing))
        role_sql = dest.copy(role_path, role_path.name)
        result = dest.psql('postgres', file=role_sql, label='Current password-free global role restore')
        require(not result.stderr.strip(), 'Role import diagnostics; stop')
        require(backup.role_metadata(lambda sql: dest.query(sql, 'postgres')) == manifest['roles'], 'Restored roles/memberships differ')
        self.record['roles_restore_exit'] = result.returncode
        db = manifest['prerequisites']['database']; owner = manifest['additional_privileges']['database']['owner']
        require(db['provider'] == 'i' and owner == 'postgres' and owner in manifest['roles']['roles'], 'Reviewed locale/owner required')
        dest.identity()
        dest.psql('postgres', sql='create database ' + internal.DATABASE + ' template template0 owner ' + backup.quote_identifier(owner) +
                  ' encoding ' + backup.literal(db['encoding']) + ' locale_provider=icu icu_locale=' + backup.literal(db['locale']) +
                  ' lc_collate=' + backup.literal(db['collate']) + ' lc_ctype=' + backup.literal(db['ctype']) + ';', label='New verification database creation')
        dest.identity(internal.DATABASE)
        template = dest.query("""select jsonb_build_object('tables',(select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema')),
            'extensions',(select jsonb_object_agg(extname,jsonb_build_object('owner',pg_get_userbyid(extowner),'version',extversion)) from pg_extension),
            'available',(select jsonb_object_agg(name,default_version) from pg_available_extensions))""")
        require(template['tables'] == 0 and template['extensions'] == {'plpgsql': {'owner': internal.OWNER, 'version': '1.0'}},
                'Destination template/extension owner differs')
        require(prior.restore_prerequisites(dest.query) == manifest['prerequisites'], 'Destination database/platform prerequisites differ')
        require(all(template['available'].get(name) == meta['version'] for name, meta in manifest['schema']['extensions'].items()),
                'Required extension version unavailable')
        self.checkpoint('archive-restoration')
        sql_path = folder / 'complete_restore.sql'
        result = backup.call([backup.pgtool('pg_restore'), '--exit-on-error', '--single-transaction', '--file', str(sql_path), str(self.directory / prior.ARCHIVE)],
                             label='Complete current archive SQL reconstruction')
        require(not result.stderr.strip(), 'Archive reconstruction diagnostics; stop')
        self.record['pg_restore_exit'] = result.returncode
        sql = dest.copy(sql_path, sql_path.name); dest.identity(internal.DATABASE)
        result = dest.psql(internal.DATABASE, file=sql, label='Complete current transactional archive restore')
        require(not result.stderr.strip(), 'Archive restoration diagnostics; stop')
        self.record.update(archive_restore_exit=result.returncode, restore_sql_sha256=backup.file_sha256(sql_path))
        self.checkpoint('archive-restored')
        self.apply_supplements(dest, manifest)  # Exact gap/target guards, no unrelated grant.
        restored = prior.collect(dest.query)
        compare_restored(manifest, restored)
        require(dest.query(realtime.PLATFORM_SQL) == {k: manifest['platform'][k] for k in ('subscriptions', 'leaves')},
                'Restored partition privilege/ancestry or subscription scope differs')
        require(prior.restore_prerequisites(dest.query) == manifest['prerequisites'], 'Restored prerequisites differ')
        self.record['restored'] = {'tables': len(restored['rows']), 'logical_rows': sum(r['count'] for r in restored['rows'].values()),
            'counts': {key: row['count'] for key, row in restored['rows'].items()},
            'schema_object_counts': {key: len(value) for key, value in restored['schema'].items()},
            'schema_sections_match': {key: True for key in restored['schema']},
            'additional_privilege_categories_match': {key: True for key in restored['additional_privileges']},
            'routing_constraints_and_links_match': True, 'partition_security_and_ancestry_match': True,
            'roles': len(restored['roles']['roles']), 'memberships': len(restored['roles']['memberships']),
            'sequences': len(restored['sequences']), 'state': restored['state'], 'all_rows_and_catalog_match': True,
            'restored_comparison_exemptions': []}
        self.source_compare(manifest); self.verify_bundle()
        self.acl(list(folder.iterdir()))
        self.checkpoint('full-restore-verified')
        print('PASS: exact restoration of all 70 tables, partitions, roles, schema/security, sequences, settings and six migrations.', flush=True)

    def run(self):
        self.save()
        try:
            frozen = immutable_inputs(self.evidence)
            old = historical_bundles(); tree = historical_files(self.directory)
            before, checks = inspect_source()
            validate_inventory(before)
            require(before['identity'] == reference()['identity'] and before['system_identifier'] == prior.cutover.SOURCE_IDENTIFIER,
                    'Source identity differs from reviewed preparation baseline')
            require(backup.file_sha256(ROOT / 'supabase/config.toml') == reference()['config_sha256'], 'Retained configuration file changed')
            classification = compare_source(reference()['source'], before)
            _, env, identity = backup.target()
            self.record.update(historical_bundles=old, historical_file_tree=tree_summary(tree), source_identity=identity,
                source_system_identifier=before['system_identifier'], source_counts=before['state']['counts'],
                source_auth_settings=checks['auth_nonsecret_settings'], source_preflight=classification,
                preparation_reference_sha256=REFERENCE_SHA256, immutable_input_files=frozen)
            self.checkpoint('source-verified')
            print('PASS: retained identity, six migrations, 70-table security/history, disabled Google and both historical bundles.', flush=True)
            manifest = self.backup(env, before)
            self.restore(manifest)
            observed = self.source_compare(manifest)
            require(len(observed['rows']) == 70, 'A newer source inventory requires another fresh recovery point')
            require(historical_bundles() == old and historical_files(self.directory) == tree, 'Historical recovery artifacts changed')
            require(immutable_inputs(self.evidence) == frozen, 'Historical reports/evidence or application/configuration inputs changed')
            self.stop_destination()
            self.record.update(result='PASS', phase='complete', recoverability_verified=True, source_preserved=True,
                historical_bundles_unchanged=True, historical_file_tree_unchanged=True,
                immutable_input_files_unchanged=True,
                completed_at=datetime.now(timezone.utc).isoformat(), final_state=observed['state'],
                fresh_recovery_prerequisite_satisfied=True)
            self.save()
            print('STOPPED: current database recovery bundle VERIFIED RECOVERABLE; retained services unchanged; fresh clone stopped/data retained.', flush=True)
            print('Evidence: ' + str(self.evidence.relative_to(ROOT)), flush=True)
        except BaseException as error:
            # Never echo an arbitrary OS/SQL exception containing paths, rows or secrets.
            message = str(error) if isinstance(error, RuntimeError) else 'Recovery harness failure; raw diagnostics suppressed'
            self.record.update(result='FAIL', failure=message, recoverability_verified=False, fresh_recovery_prerequisite_satisfied=False)
            try:
                self.stop_destination()
            except Exception:
                self.record['destination_stop_failed'] = True
            self.save()
            print('STOP: ' + message, flush=True)
            print('Evidence: ' + str(self.evidence.relative_to(ROOT)), flush=True)
            raise SystemExit(1) from None


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', action='store_true', required=True)
    parser.parse_args()
    Run().run()
