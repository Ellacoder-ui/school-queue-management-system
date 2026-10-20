"""Read-only local Auth capability. Inspect payloads stay in captured process memory."""
import json
import os
import subprocess


def auth_totp_enabled(env=None):
    env = os.environ if env is None else env
    if any(env.get(k) for k in ('DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH')):
        raise RuntimeError('MFA capability: Docker override refused.')
    def read(args):
        result = subprocess.run(['docker', *args], env=env, capture_output=True, text=True, timeout=20)
        if result.returncode or len(result.stdout) > 1048576:
            raise RuntimeError('MFA capability unavailable; diagnostics suppressed.')
        return json.loads(result.stdout)
    context = read(['context', 'inspect'])
    if len(context) != 1 or context[0].get('Endpoints', {}).get('docker', {}).get('Host') != 'npipe:////./pipe/dockerDesktopLinuxEngine':
        raise RuntimeError('MFA capability: wrong Docker endpoint.')
    rows = read(['inspect', 'supabase_auth_school-queue-local'])
    if len(rows) != 1:
        raise RuntimeError('MFA capability: ambiguous Auth.')
    item = rows[0]
    labels = item['Config'].get('Labels', {})
    if (item['Name'] != '/supabase_auth_school-queue-local'
            or item['Image'] != 'sha256:1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b'
            or labels.get('com.supabase.cli.project') != 'school-queue-local'
            or labels.get('com.docker.compose.project') != 'school-queue-local'
            or not item['State']['Running'] or item['State'].get('Health', {}).get('Status') != 'healthy'
            or list(item['NetworkSettings']['Networks']) != ['supabase_network_school-queue-local']):
        raise RuntimeError('MFA capability: Auth identity or health mismatch.')
    values = {}
    for entry in item['Config']['Env']:
        key, value = entry.split('=', 1)
        if key in values:
            raise RuntimeError('MFA capability: ambiguous environment.')
        values[key] = value
    return all(values.get(key) == 'true' for key in ('GOTRUE_MFA_TOTP_ENROLL_ENABLED', 'GOTRUE_MFA_TOTP_VERIFY_ENABLED'))
