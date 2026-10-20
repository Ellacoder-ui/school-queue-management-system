"""Private read-only Auth-only fences. No service, provider, SQL or credential write.

Called only with redirected pipes. Full definitions/rows stay in encrypted private
capture; the caller prints fixed receipts only. No Analytics connection or restore.
"""
import json
import os
import base64
import zlib
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'supabase/tests'))
import dual_database_recovery as m
import inspect_google_activation_minimum as health
import realtime_lifecycle_review as lifecycle

AUTH = '/supabase_auth_school-queue-local'
CANONICAL = {'/supabase_' + kind + '_school-queue-local' for kind in (
    'db', 'auth', 'kong', 'rest', 'realtime', 'storage', 'edge_runtime', 'inbucket', 'studio', 'pg_meta', 'analytics', 'vector')}


def credential_fence():
    return [str(x) for x in m.base.credential_metadata()]


def encode_source(source):
    # Opaque transport through JavaScript preserves PostgreSQL int64 catalog
    # values exactly. Compression is only framing; DPAPI supplies encryption.
    raw = json.dumps(source, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()
    need(len(raw) <= 4 * 1024 * 1024, 'AGO_SOURCE_BOUND')
    return base64.b64encode(zlib.compress(raw)).decode('ascii')


def decode_source(value):
    blob = base64.b64decode(value, validate=True)
    need(len(blob) <= 1024 * 1024, 'AGO_SOURCE_BOUND')
    decoder = zlib.decompressobj()
    raw = decoder.decompress(blob, 4 * 1024 * 1024 + 1)
    need(len(raw) <= 4 * 1024 * 1024 and decoder.eof and not decoder.unused_data and not decoder.unconsumed_tail, 'AGO_SOURCE_BOUND')
    return json.loads(raw)


def need(value, code):
    if not value:
        raise RuntimeError(code)


def discovery():
    ids = set()
    for label in ('com.supabase.cli.project', 'com.docker.compose.project'):
        code, out, _ = m.base.run(['docker', 'ps', '-a', '--no-trunc', '--filter', 'label=' + label + '=school-queue-local', '--format', '{{.ID}}'])
        need(code == 0, 'AGO_DISCOVERY')
        ids.update(out.splitlines())
    code, out, _ = m.base.run(['docker', 'ps', '-a', '--format', '{{.ID}} {{.Names}}', '--no-trunc'])
    need(code == 0, 'AGO_DISCOVERY')
    for line in out.splitlines():
        identifier, name = line.split(' ', 1)
        if name.startswith('supabase_') and (name.endswith('_school-queue-local') or name.startswith('supabase_auth_school-queue-local-')):
            ids.add(identifier)
    need(ids, 'AGO_DISCOVERY')
    return m.base.read_json(['docker', 'inspect', *sorted(ids)])


def capture(connection=None):
    need(not any(os.environ.get(k) for k in ('DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH')), 'AGO_DOCKER_OVERRIDE')
    need(m.checked(['docker', 'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']).decode().strip() ==
         'npipe:////./pipe/dockerDesktopLinuxEngine', 'AGO_CONTEXT_CHANGED')
    items = discovery()
    need(CANONICAL.issubset({x['Name'] for x in items}) and all(
        x['Config']['Labels'].get('com.supabase.cli.project') == 'school-queue-local' and
        x['Config']['Labels'].get('com.docker.compose.project') == 'school-queue-local' for x in items), 'AGO_PROJECT_IDENTITY')
    if connection is None:
        local, env, identity = m.backup.target()
        need(identity['project'] == 'school-queue-local', 'AGO_PROJECT')
        connection = {'env': {k: v for k, v in env.items() if k.startswith('PG')}, 'publicKey': local.get('ANON_KEY') or local.get('PUBLISHABLE_KEY')}
    env = {**m.backup.clean_env(), **connection['env']}
    need(env['PGHOST'] == '127.0.0.1' and str(env['PGPORT']) == '54322' and env['PGDATABASE'] == 'postgres', 'AGO_LOOPBACK')
    rt = next(x for x in items if x['Name'] == '/supabase_realtime_school-queue-local')
    release = m.checked(['docker', 'exec', rt['Id'], 'cat', '/app/releases/start_erl.data']).decode().strip()
    need((rt['Config']['Image'], rt['Image'], release) == lifecycle.PIN, 'AGO_REALTIME_PIN')
    with m.backup.Snapshot(env) as s:
        m.validate_source_identity(m.source_identity(s.query), 'postgres')
        s.raw("set local statement_timeout='20s'; set local lock_timeout='2s';")
        source = m.collect(s.query, 'postgres')
        source['clock'] = s.query('select to_jsonb(clock_timestamp())')
        source['platform'] = s.query(m.recovery.realtime.PLATFORM_SQL)
        need(source['state']['active'] == source['state']['open_days'] == 0, 'AGO_ACTIVE_WORK')
    source['platform'].update(image=rt['Config']['Image'], image_id=rt['Image'], release=release)
    m.fences.assert_locks()  # Preserve the separate full-stack activation locks.
    return {'items': items, 'sourceSnapshot': encode_source(source), 'connection': connection, 'resources': m.fences.resources(),
            # Nanosecond metadata exceeds JavaScript's exact integer range.
            'credential': credential_fence(),
            'dbVolume': m.base.read_json(['docker', 'volume', 'inspect', 'supabase_db_school-queue-local']),
            'backupTree': m.recovery.tree_summary(m.recovery.historical_files(m.backup.BACKUPS / '__none__'))}


def compare(before, now, phase, replacement):
    original = next(x for x in before['items'] if x['Name'] == AUTH)
    changed = phase != 'before'
    expected_ids = {x['Id'] for x in before['items']} | ({replacement} if changed else set())
    need({x['Id'] for x in now['items']} == expected_ids, 'AGO_PROJECT_RESOURCE_DELTA')
    after = {x['Id']: x for x in now['items']}
    for old in before['items']:
        if old['Id'] == original['Id']:
            continue
        new = after[old['Id']]
        need(all(old[k] == new[k] for k in ('Name', 'Config', 'HostConfig', 'Mounts', 'Image')) and
             old['NetworkSettings']['Networks'] == new['NetworkSettings']['Networks'], 'AGO_OTHER_SERVICE_CHANGED')
        if old['Name'] != '/supabase_vector_school-queue-local':
            need(m.base.state(old) == m.base.state(new), 'AGO_OTHER_SERVICE_LIFECYCLE')
    for key in ('credential', 'dbVolume', 'backupTree'):
        need(before[key] == now[key], 'AGO_PROTECTED_INPUT_CHANGED')
    for key in ('networks', 'volumes'):
        need(before['resources'][key] == now['resources'][key], 'AGO_RESOURCE_DELTA')
    need(set(now['resources']['containers']) == set(before['resources']['containers']) | ({replacement} if changed else set()), 'AGO_RESOURCE_DELTA')
    previous_source, current_source = decode_source(before['sourceSnapshot']), decode_source(now['sourceSnapshot'])
    m.recovery.compare_source(previous_source, current_source)
    need(previous_source['ancillary'] == current_source['ancillary'], 'AGO_SOURCE_ANCILLARY_CHANGED')
    if phase == 'before':
        need(m.base.state(original) == m.base.state(after[original['Id']]) and
             all(original[k] == after[original['Id']][k] for k in ('Config', 'HostConfig', 'Mounts', 'NetworkSettings')), 'AGO_ORIGINAL_CHANGED')
    elif phase == 'after':
        old = after[original['Id']]
        need(not old['State']['Running'] and not old['NetworkSettings']['Networks'], 'AGO_ORIGINAL_NOT_PARKED')
    elif phase == 'rollback-after':
        new = after[replacement]
        need(not new['State']['Running'] and not new['NetworkSettings']['Networks'], 'AGO_FAILED_NOT_PARKED')


def health_check(now, expected):
    items = {x['Name']: x for x in now['items']}
    for kind in ('db', 'auth', 'kong', 'rest'):
        item = items['/supabase_' + kind + '_school-queue-local']
        need(item['State']['Running'] and item['State'].get('Health', {}).get('Status', 'not-configured') in ('healthy', 'not-configured'), 'AGO_CORE_HEALTH')
    key = now['connection']['publicKey']
    health.request('/auth/v1/health', key)
    settings = health.request('/auth/v1/settings', key)
    need(settings.get('external', {}).get('google') is expected, 'AGO_PROVIDER_HEALTH')
    health.request('/rest/v1/counter_state?select=counter_label&limit=1', key, projection=True)


def main():
    try:
        need(not sys.stdin.isatty() and not sys.stdout.isatty(), 'AGO_PRIVATE_IPC')
        raw = sys.stdin.buffer.read(4 * 1024 * 1024 + 1)
        need(len(raw) <= 4 * 1024 * 1024, 'AGO_GUARD_BOUND')
        request = json.loads(raw)
        need(request['phase'] in ('capture', 'before', 'after', 'rollback-before', 'rollback-after'), 'AGO_GUARD_PHASE')
        baseline = request.get('baseline')
        now = capture(baseline['connection'] if baseline else None)
        if baseline:
            compare(baseline, now, request['phase'], request.get('replacement'))
        else:
            need(len(now['items']) == 12, 'AGO_SERVICE_COUNT')
        if request['phase'] != 'rollback-before':
            health_check(now, request['phase'] == 'after')
        print(json.dumps({'result': 'PASS', 'capture': now} if not baseline else {'result': 'PASS'}))
        return 0
    except Exception:
        print('AGO_READ_ONLY_GUARD_REJECTED', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
