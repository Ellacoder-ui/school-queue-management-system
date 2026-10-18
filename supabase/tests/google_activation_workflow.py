"""Controlled local activation support. Preparation is read-only to retained services.

Provider credentials are never accepted by this Python process. Service execution
belongs only to the explicitly confirmed PowerShell workflow, not this module.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tomllib
from urllib.request import Request, build_opener

import google_credential_preflight as gate

ROOT = gate.ROOT
backup = gate.recovery.backup
require = gate.require
PROJECT = 'school-queue-local'
NETWORK = 'supabase_network_' + PROJECT
CONFIG = ROOT / 'supabase/config.toml'
STORAGE = ROOT / '.local-google-activation'
# Mandatory stop: the retained Vector container failed the full health gate.
# A later reviewed task must complete rehearsals before enabling mutation entry points.
ACTIVATION_IMPLEMENTATION_CERTIFIED = False
AUTH_BLOCK = '''[auth]
enabled = true
site_url = "http://127.0.0.1:5173"
additional_redirect_urls = ["http://127.0.0.1:5173/auth/callback"]
enable_signup = true
enable_anonymous_sign_ins = false
enable_manual_linking = false

[auth.external.google]
enabled = true
client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"
secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET)"
redirect_uri = "http://127.0.0.1:54321/auth/v1/callback"
skip_nonce_check = false
email_optional = false
'''
AUTH_CHANGES = {
    'GOTRUE_SITE_URL': 'http://127.0.0.1:5173',
    'GOTRUE_URI_ALLOW_LIST': 'http://127.0.0.1:5173/auth/callback',
    'GOTRUE_EXTERNAL_GOOGLE_ENABLED': 'true',
    'GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI': 'http://127.0.0.1:54321/auth/v1/callback',
    'GOTRUE_EXTERNAL_GOOGLE_SKIP_NONCE_CHECK': 'false',
    'GOTRUE_EXTERNAL_GOOGLE_EMAIL_OPTIONAL': 'false',
}
PROVIDER_KEYS = {'GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID', 'GOTRUE_EXTERNAL_GOOGLE_SECRET'}


def digest(value):
    if not isinstance(value, bytes):
        value = json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
    return hashlib.sha256(value).hexdigest()


def directory(run_id):
    require(re.fullmatch('[0-9a-f]{8}', run_id) is not None, 'LGA_RUN_ID')
    path = STORAGE / run_id
    require(path.resolve() == path.absolute() and not path.is_symlink(), 'LGA_PATH')
    return path


def candidate(original):
    require(digest(original) == gate.CONFIG_SHA256, 'LGA_ORIGINAL_CONFIG')
    before = tomllib.loads(original.decode('utf-8'))
    require('auth' not in before, 'LGA_EXISTING_AUTH_SECTION')
    proposed = original.rstrip() + b'\n\n' + AUTH_BLOCK.encode()
    validate_config(original, proposed)
    return proposed


def validate_config(original, proposed):
    try:
        before = tomllib.loads(original.decode('utf-8'))
        after = tomllib.loads(proposed.decode('utf-8'))
    except Exception:
        raise RuntimeError('LGA_TOML') from None
    require('auth' not in before, 'LGA_EXISTING_AUTH_SECTION')
    require(after.pop('auth', None) == tomllib.loads(AUTH_BLOCK)['auth'] and after == before,
            'LGA_UNRELATED_CONFIG_CHANGE')
    require(before['project_id'] == PROJECT and before['db']['port'] == 54322 and
            before['api']['port'] == 54321 and before['api']['schemas'] == ['public', 'queue_api', 'queue_display'] and
            before['db']['seed']['enabled'] is False, 'LGA_TARGET_CONFIG')


def services():
    names = backup.call(['docker', 'ps', '-a', '--filter', 'label=com.supabase.cli.project=' + PROJECT,
                         '--format', '{{.Names}}'], label='Read-only project service list').stdout.splitlines()
    require(names and len(names) == len(set(names)) and all(re.fullmatch('supabase_[a-z0-9_-]+_' + PROJECT, n) for n in names),
            'LGA_SERVICE_SCOPE')
    items = json.loads(backup.call(['docker', 'inspect', *sorted(names)], label='Read-only full project service inventory').stdout)
    result = {}
    for item in items:
        name = item['Name'][1:]
        require(item['Config']['Labels'].get('com.supabase.cli.project') == PROJECT and
                sorted(item['NetworkSettings']['Networks']) == [NETWORK] and item['State']['Running'] and
                not item['HostConfig']['Privileged'], 'LGA_SERVICE_IDENTITY')
        require(item['State'].get('Health', {}).get('Status', 'healthy') == 'healthy', 'LGA_SERVICE_HEALTH')
        env = dict(entry.split('=', 1) for entry in item['Config']['Env'])
        require(len(env) == len(item['Config']['Env']), 'LGA_DUPLICATE_ENV')
        # No environment values are persisted, even in the protected baseline.
        result[name] = {
            'id': item['Id'], 'image': item['Config']['Image'], 'image_id': item['Image'],
            'started_at': item['State']['StartedAt'], 'restart_count': item['RestartCount'],
            'ports': item['HostConfig']['PortBindings'], 'networks': sorted(item['NetworkSettings']['Networks']),
            'active_ports': item['NetworkSettings']['Ports'],
            'mounts': [{k: m.get(k) for k in ('Type', 'Name', 'Source', 'Destination', 'RW')} for m in item['Mounts']],
            'environment': {k: digest(v.encode()) for k, v in env.items()},
        }
    require({'supabase_' + kind + '_' + PROJECT for kind in ('db', 'kong', 'auth', 'realtime')} <= set(result), 'LGA_REQUIRED_SERVICES')
    return result


def compare_services(before, after, enabled):
    require(set(before) == set(after), 'LGA_SERVICE_SET')
    for name, old in before.items():
        new = after[name]
        for key in ('image', 'image_id', 'ports', 'active_ports', 'networks', 'mounts'):
            require(new[key] == old[key], 'LGA_SERVICE_' + key.upper())
        expected = dict(old['environment'])
        actual = dict(new['environment'])
        if name == 'supabase_auth_' + PROJECT and enabled:
            for key, value in AUTH_CHANGES.items():
                expected[key] = digest(value.encode())
            for key in PROVIDER_KEYS:
                require(key in actual, 'LGA_PROVIDER_ENV_MISSING')
                actual.pop(key)
                expected.pop(key, None)
        require(expected == actual, 'LGA_UNRELATED_SERVICE_ENV')


def validate_volumes(expected, actual):
    require(expected == actual and any(v['Name'] == 'supabase_db_' + PROJECT for v in actual), 'LGA_VOLUME_IDENTITY')


def volumes(service_set):
    names = sorted({m['Name'] for s in service_set.values() for m in s['mounts'] if m['Type'] == 'volume'})
    require('supabase_db_' + PROJECT in names, 'LGA_DATABASE_VOLUME')
    raw = json.loads(backup.call(['docker', 'volume', 'inspect', *names], label='Read-only retained volume identity').stdout)
    return sorted([{k: v.get(k) for k in ('Name', 'Driver', 'Mountpoint', 'CreatedAt', 'Labels', 'Options', 'Scope')}
                   for v in raw], key=lambda v: v['Name'])


def inputs():
    paths = list((ROOT / 'scripts').glob('LocalGoogle*.ps*')) + [ROOT / 'scripts/Start-LocalGoogleAuth.ps1']
    paths += [ROOT / 'supabase/tests/google_activation_workflow.py', ROOT / 'supabase/tests/google_credential_preflight.py']
    paths += [ROOT / 'node_modules/supabase/dist/supabase.js', ROOT / 'node_modules/@supabase/cli-windows-x64/bin/supabase.exe']
    paths += list((ROOT / 'supabase/migrations').glob('*.sql'))
    paths += [ROOT / n for n in ('package.json', 'package-lock.json', '.gitignore')]
    # Dotenv overrides take precedence in the pinned CLI. Freeze their identity and
    # reject Supabase/provider overrides rather than inheriting hidden alternatives.
    for parent in (ROOT, ROOT / 'supabase'):
        for path in parent.glob('.env*'):
            if not path.is_file() or path.name == '.env.example': continue
            require(not re.search(r'^\s*(?:export\s+)?(?:SUPABASE_|GOTRUE_|PG)[A-Za-z0-9_]*\s*=',
                                  path.read_text(encoding='utf-8-sig'), re.M), 'LGA_DOTENV_OVERRIDE')
            paths.append(path)
    return {str(p.relative_to(ROOT)): backup.file_sha256(p) for p in paths}


def write_new(path, data):
    with path.open('xb') as handle:
        handle.write(data)


def write_json_new(path, data):
    write_new(path, (json.dumps(data, sort_keys=True, indent=2) + '\n').encode())


def prepare(run_id):
    path = directory(run_id)
    require(path.is_dir() and not list(path.iterdir()), 'LGA_FRESH_PROTECTED_DIRECTORY')
    receipt = gate.check()
    original = CONFIG.read_bytes()
    proposed = candidate(original)
    current, _ = gate.recovery.inspect_source()
    service_set = services()
    baseline = {'source': current, 'services': service_set, 'volumes': volumes(service_set)}
    write_new(path / 'config.original.toml', original)
    write_new(path / 'config.proposed.toml', proposed)
    # Read-only CLI schema probes use an isolated workdir with this project ID.
    for name, content in [('original', original), ('proposed', proposed)]:
        work = path / name / 'supabase'
        work.mkdir(parents=True)
        write_new(work / 'config.toml', content)
    write_json_new(path / 'baseline.json', baseline)
    plan = {'format': 1, 'run_id': run_id, 'project': PROJECT, 'workspace': str(ROOT),
            'created_at': datetime.now(timezone.utc).isoformat(), 'cli_version': '2.121.0',
            'config_original_sha256': digest(original), 'config_proposed_sha256': digest(proposed),
            'baseline_sha256': backup.file_sha256(path / 'baseline.json'), 'tested_inputs': inputs(),
            'credential_ciphertext_sha256': backup.file_sha256(ROOT / '.local-secrets/google-local.dpapi'),
            'recovery_run': receipt['recovery_run'], 'recovery_bundle_sha256': receipt['recovery_bundle_sha256'],
            'services': sorted(service_set), 'volume_names': [v['Name'] for v in baseline['volumes']],
            'stop': ['node', str(ROOT / 'node_modules/supabase/dist/supabase.js'), 'stop', '--project-id', PROJECT, '--workdir', str(ROOT)],
            'start': ['node', str(ROOT / 'node_modules/supabase/dist/supabase.js'), 'start', '--workdir', str(ROOT), '--network-id', NETWORK]}
    write_json_new(path / 'plan.json', plan)
    return {'result': 'PASS', 'mode': 'PREPARED_ONLY', 'run_id': run_id,
            'plan_sha256': backup.file_sha256(path / 'plan.json'), 'retained_services_changed': False}


def load_plan(run_id, approved):
    path = directory(run_id)
    require(re.fullmatch('[a-f0-9]{64}', approved) is not None and
            backup.file_sha256(path / 'plan.json') == approved, 'LGA_EXPLICIT_APPROVAL')
    plan = json.loads((path / 'plan.json').read_text())
    require(plan['format'] == 1 and plan['run_id'] == run_id and plan['project'] == PROJECT and
            plan['workspace'] == str(ROOT) and plan['tested_inputs'] == inputs(), 'LGA_REVIEWED_CODE_CHANGED')
    for file, key in [('config.original.toml', 'config_original_sha256'), ('config.proposed.toml', 'config_proposed_sha256'),
                      ('baseline.json', 'baseline_sha256')]:
        require(backup.file_sha256(path / file) == plan[key], 'LGA_REVIEWED_ARTIFACT_CHANGED')
    require(backup.file_sha256(ROOT / '.local-secrets/google-local.dpapi') == plan['credential_ciphertext_sha256'], 'LGA_CREDENTIAL_CHANGED')
    validate_config((path / 'config.original.toml').read_bytes(), (path / 'config.proposed.toml').read_bytes())
    return path, plan, json.loads((path / 'baseline.json').read_text())


def pre_apply(path, plan, baseline):
    require(not (path / 'activation.json').exists(), 'LGA_ALREADY_ATTEMPTED')
    require(digest(CONFIG.read_bytes()) == plan['config_original_sha256'], 'LGA_LIVE_CONFIG')
    receipt = gate.check()  # Actual backup/source verification immediately before any stop.
    now = services()
    require(now == baseline['services'], 'LGA_SERVICES_CHANGED_SINCE_REVIEW')
    validate_volumes(baseline['volumes'], volumes(now))
    require(receipt['recovery_bundle_sha256'] == plan['recovery_bundle_sha256'], 'LGA_RECOVERY_BINDING')
    gate.recovery.realtime.classify(baseline['source'], gate.recovery.inspect_source()[0])
    write_json_new(path / 'activation.json', {'result': 'ARMED', 'phase': 'armed', 'plan_sha256': backup.file_sha256(path / 'plan.json')})


def config_write(path, plan, original=False):
    expected = plan['config_original_sha256' if not original else 'config_proposed_sha256']
    current = digest(CONFIG.read_bytes())
    if original and current == plan['config_original_sha256']:
        return  # A failure may already have restored the exact original bytes.
    require(current == expected, 'LGA_CONFIG_CONCURRENT_CHANGE')
    require((path / 'activation.json').is_file(), 'LGA_NOT_ARMED')
    data = (path / ('config.original.toml' if original else 'config.proposed.toml')).read_bytes()
    pending = CONFIG.with_name('config.google-' + plan['run_id'] + '.pending')
    write_new(pending, data)
    require(digest(CONFIG.read_bytes()) == expected and not CONFIG.is_symlink(), 'LGA_CONFIG_CONCURRENT_CHANGE')
    os.replace(pending, CONFIG)  # Atomic configuration replacement; original bytes remain protected.


def recovery_artifacts():
    require(backup.file_sha256(gate.EVIDENCE) == gate.EVIDENCE_SHA256, 'LGA_RECOVERY_EVIDENCE')
    record = json.loads(gate.EVIDENCE.read_text())
    verifier = gate.recovery.Run.__new__(gate.recovery.Run)
    verifier.id = record['run_id']; verifier.record = record; verifier.directory = Path(record['directory'])
    verifier.verify_bundle(); gate.recovery.historical_bundles()


def rollback_arm(path, plan, baseline):
    require((path / 'activation.json').exists(), 'LGA_NO_ACTIVATION_ATTEMPT')
    require(digest(CONFIG.read_bytes()) in (plan['config_original_sha256'], plan['config_proposed_sha256']), 'LGA_CONFIG_CONCURRENT_CHANGE')
    recovery_artifacts()
    validate_volumes(baseline['volumes'], volumes(baseline['services']))
    # Stop may remove/recreate containers, but must never target an unknown service.
    names = backup.call(['docker', 'ps', '-a', '--filter', 'label=com.supabase.cli.project=' + PROJECT,
                         '--format', '{{.Names}}'], label='Read-only rollback scope').stdout.splitlines()
    require(set(names) <= set(baseline['services']), 'LGA_ROLLBACK_UNKNOWN_CONTAINER')
    if names:
        items = json.loads(backup.call(['docker', 'inspect', *names], label='Read-only partial rollback identities').stdout)
        for item in items:
            old = baseline['services'][item['Name'][1:]]
            require(item['Image'] == old['image_id'] and item['Config']['Image'] == old['image'] and
                    item['Config']['Labels'].get('com.supabase.cli.project') == PROJECT, 'LGA_ROLLBACK_IMAGE')


def acceptance(path, plan, baseline):
    """Future postactivation only; no real OAuth request/user creation is allowed."""
    require((path / 'activation.json').exists(), 'LGA_NOT_ARMED')
    commands = [
        ['node', '--test', '--test-reporter=tap', 'tests/frontend/browserInterception.unit.mjs'],
        [sys.executable, '-B', '-m', 'unittest', 'discover', '-s', 'tests/frontend', '-p', 'test_realtime_preservation.py'],
        ['npm.cmd', 'run', 'test:frontend'],
    ]
    for command in commands:
        backup.call(command, timeout=180, label='Postactivation offline frontend/security suite')
    from run_public_board import run_browser
    oauth = run_browser('tests/frontend/googleOAuth.browser.mjs', 'google_oauth_frontend_*.json')
    board = run_browser('tests/frontend/publicBoard.browser.mjs', 'public_board_*.json')
    from run_google_auth_postvalidation import profile_checks
    denials = profile_checks()
    backup.call([sys.executable, 'scripts/local_frontend.py', '--build'], timeout=180, label='Postactivation public-only frontend build/scan')
    write_json_new(path / ('acceptance_' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '.json'),
                   {'result': 'PASS', 'oauth_mocked': oauth, 'public_board': board, 'schema_denials': denials,
                    'real_oauth_executed': False})


def postcheck(path, plan, baseline, enabled):
    require(digest(CONFIG.read_bytes()) == plan['config_proposed_sha256' if enabled else 'config_original_sha256'], 'LGA_CONFIG_POSTCHECK')
    now = services()
    validate_volumes(baseline['volumes'], volumes(now))
    compare_services(baseline['services'], now, enabled)
    source = gate.recovery.realtime.capture_current()
    require(source['system_identifier'] == '7696959712798593061', 'LGA_CLUSTER')
    preservation = gate.recovery.realtime.classify(baseline['source'], source)
    gate.recovery.validate_inventory(source)
    local, _, _ = backup.target()
    request = Request('http://127.0.0.1:54321/auth/v1/settings', headers={'apikey': local.get('PUBLISHABLE_KEY') or local['ANON_KEY']})
    from run_google_auth import NoRedirect
    with build_opener(NoRedirect()).open(request, timeout=10) as response:
        require(json.load(response)['external']['google'] is enabled, 'LGA_PUBLIC_PROVIDER_STATUS')
    # Original verified artifacts are rechecked without the preactivation-only live Auth assertion.
    recovery_artifacts()
    return {'result': 'PASS', 'phase': 'provider-settings-and-preservation', 'google_enabled': enabled,
            'preservation': preservation, 'real_login_executed': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['prepare', 'arm', 'write-config', 'restore-config', 'volumes', 'postcheck', 'rollback-check', 'rollback-arm', 'acceptance'])
    parser.add_argument('--run-id', required=True)
    parser.add_argument('--approved-plan', default='')
    args = parser.parse_args()
    try:
        require(Path.cwd().resolve() == ROOT, 'LGA_WORKSPACE')
        if args.operation == 'prepare':
            result = prepare(args.run_id)
        else:
            require(ACTIVATION_IMPLEMENTATION_CERTIFIED, 'LGA_REHEARSAL_NOT_CERTIFIED')
            path, plan, baseline = load_plan(args.run_id, args.approved_plan)
            if args.operation == 'arm': pre_apply(path, plan, baseline)
            elif args.operation == 'write-config': config_write(path, plan)
            elif args.operation == 'restore-config': config_write(path, plan, original=True)
            elif args.operation == 'volumes': validate_volumes(baseline['volumes'], volumes(baseline['services']))
            elif args.operation == 'rollback-arm': rollback_arm(path, plan, baseline)
            elif args.operation == 'acceptance': acceptance(path, plan, baseline)
            else:
                result = postcheck(path, plan, baseline, args.operation == 'postcheck')
                print(json.dumps(result)); return 0
            result = {'result': 'PASS', 'operation': args.operation}
        print(json.dumps(result)); return 0
    except Exception:
        print(json.dumps({'result': 'FAIL', 'code': 'LGA_WORKFLOW_GATE_REJECTED'})); return 1


if __name__ == '__main__': sys.exit(main())
