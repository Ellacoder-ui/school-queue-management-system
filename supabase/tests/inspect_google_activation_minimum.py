"""Read-only core health/config assessment. No activation or credential intake.

No Analytics, backups, mutations, signal, service commands or config-write path.
Credentials from local CLI status remain private; only HTTP statuses are emitted.
"""
from datetime import datetime, timezone
import hashlib
import json
import re
import urllib.request
import uuid

import dual_database_recovery as m

NAMES = ['supabase_' + kind + '_school-queue-local' for kind in ('db', 'kong', 'auth', 'rest', 'vector')]
ALLOW = {'API_EXTERNAL_URL', 'GOTRUE_API_HOST', 'GOTRUE_API_PORT', 'GOTRUE_SITE_URL', 'GOTRUE_URI_ALLOW_LIST',
         'GOTRUE_EXTERNAL_GOOGLE_ENABLED', 'GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI', 'GOTRUE_DISABLE_SIGNUP',
         'GOTRUE_EXTERNAL_EMAIL_ENABLED', 'GOTRUE_MAILER_AUTOCONFIRM', 'GOTRUE_JWT_EXP',
         'GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED', 'GOTRUE_SECURITY_MANUAL_LINKING_ENABLED'}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def request(path, key, *, projection=False):
    m.need(path in ('/auth/v1/health', '/auth/v1/settings', '/rest/v1/counter_state?select=counter_label&limit=1'), 'GMA_HTTP_PATH')
    headers = {'apikey': key}
    if projection:
        headers.update(Authorization='Bearer ' + key, **{'Accept-Profile': 'queue_display'})
    req = urllib.request.Request('http://127.0.0.1:54321' + path, headers=headers)
    with urllib.request.build_opener(NoRedirect()).open(req, timeout=10) as response:
        data = response.read(1024 * 1024 + 1)
        m.need(response.status == 200 and len(data) <= 1024 * 1024, 'GMA_HTTP_STATUS')
    return json.loads(data)


def main():
    rid = uuid.uuid4().hex[:8]
    path = m.ROOT / f'supabase/tests/results/google_activation_minimum_inspection_{rid}.json'
    record = {'run_id': rid, 'result': 'IN_PROGRESS_READ_ONLY', 'started_at': datetime.now(timezone.utc).isoformat(),
              'credentials_opened': False, 'activation_restart_signal_or_sql_write': False}
    try:
        frozen = m.recovery.immutable_inputs(path)
        frozen.update({str(p.relative_to(m.ROOT)): m.backup.file_sha256(p) for p in (m.ROOT / 'scripts').glob('*') if p.is_file()})
        before = m.analytics.project_items(); resources = m.fences.resources()
        credential = m.base.credential_metadata()
        local, env, identity = m.backup.target()
        items = {x['Name'][1:]: x for x in before}
        auth = items['supabase_auth_school-queue-local']
        m.need(auth['Config']['Image'] == 'public.ecr.aws/supabase/gotrue:v2.197.0', 'GMA_AUTH_IMAGE')
        record['services'] = {name: m.base.state(items[name]) for name in NAMES}
        record['auth_nonsecret_environment'] = {k: v for e in auth['Config']['Env'] for k, _, v in [e.partition('=')] if k in ALLOW}
        record['auth_startup'] = {'entrypoint': auth['Config']['Entrypoint'], 'command': auth['Config']['Cmd'],
            'config_dir_flag_present': any('--config-dir' in str(x) for x in (auth['Config']['Entrypoint'] or []) + (auth['Config']['Cmd'] or [])),
            'mounts': [{'type': x['Type'], 'destination': x['Destination']} for x in auth['Mounts']],
            'network_names': list(auth['NetworkSettings']['Networks']), 'published_ports': bool(auth['HostConfig']['PortBindings']),
            'provider_environment_present': {k: any(e.startswith(k + '=') and bool(e.split('=', 1)[1]) for e in auth['Config']['Env'])
                for k in ('GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID', 'GOTRUE_EXTERNAL_GOOGLE_SECRET')}}
        with m.backup.Snapshot(env) as s:
            ident = m.source_identity(s.query); m.validate_source_identity(ident, 'postgres')
            record['database'] = {'identity': ident, 'select_one': s.query('select to_jsonb(1)'), 'state': m.backup.state(None, s.query),
                'auth_users': s.query('select to_jsonb(count(*)) from auth.users'),
                'auth_migration_count': s.query('select to_jsonb(count(*)) from auth.schema_migrations')}
        key = local.get('ANON_KEY') or local.get('PUBLISHABLE_KEY')
        m.need(isinstance(key, str), 'GMA_PUBLIC_KEY')
        request('/auth/v1/health', key)
        settings = request('/auth/v1/settings', key)
        request('/rest/v1/counter_state?select=counter_label&limit=1', key, projection=True)
        record['http'] = {'auth_health_via_gateway': 200, 'auth_public_settings': 200, 'anonymous_public_projection': 200,
                          'google_enabled': settings.get('external', {}).get('google')}
        m.need(record['http']['google_enabled'] is False, 'GMA_PROVIDER_CHANGED')
        for name in NAMES[:4]:
            m.need(items[name]['State']['Running'] and items[name]['State'].get('Health', {}).get('Status', 'not-configured') in ('healthy', 'not-configured'), 'GMA_CORE_HEALTH')
        m.fences.unchanged_retained(before, m.analytics.project_items())
        m.need(resources == m.fences.resources() and credential == m.base.credential_metadata(), 'GMA_RESOURCE_OR_CREDENTIAL_METADATA_CHANGE')
        m.need(all(m.backup.file_sha256(m.ROOT / p) == h for p, h in frozen.items()), 'GMA_EXISTING_INPUT_CHANGED')
        m.fences.assert_locks()
        record.update(result='PASS_READ_ONLY_CORE_HEALTH_GOOGLE_DISABLED_VECTOR_UNHEALTHY',
            project=identity['project'], migration_hashes=identity['migration_sha256'],
            config_sha256=m.backup.file_sha256(m.ROOT / 'supabase/config.toml'),
            existing_inputs_unchanged=len(frozen), retained_service_definitions_and_resources_unchanged=True,
            google_credential_metadata_only_unchanged=True, activation_locks_unchanged=True)
    except Exception as error:
        code = str(error)
        record.update(result='FAIL_READ_ONLY_INSPECTION', failure=code if re.fullmatch(r'(GMA|DAR|VST)_[A-Z0-9_]+', code) else 'GMA_SANITIZED_STOP')
    record['finished_at'] = datetime.now(timezone.utc).isoformat()
    with path.open('x', encoding='utf-8') as handle:
        json.dump(record, handle, indent=2)
    print(json.dumps({'result': record['result'], 'evidence': path.name, 'sha256': m.backup.file_sha256(path)}))


if __name__ == '__main__':
    main()
