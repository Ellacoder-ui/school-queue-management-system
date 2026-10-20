"""Configure/run the frontend using only local CLI public credentials.

Does not read .env, change production configuration, or print credential values.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
from auth_mfa_capability import auth_totp_enabled
from urllib.parse import urlparse


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--prepare', action='store_true')
    mode.add_argument('--build', action='store_true')
    mode.add_argument('--dev', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    env = {k: v for k, v in os.environ.items() if not k.upper().startswith(('VITE_', 'SUPABASE_', 'PG', 'QUEUE_'))}
    result = subprocess.run(['node', str(root / 'node_modules/supabase/dist/supabase.js'), 'status', '--output', 'json'],
                            cwd=root, env=env, capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise SystemExit('Local CLI status unavailable; raw output suppressed.')
    status = json.loads(result.stdout)
    parsed = urlparse(status.get('API_URL', ''))
    if (parsed.scheme != 'http' or parsed.hostname != '127.0.0.1' or parsed.port != 54321
            or parsed.path not in ('', '/') or parsed.query or parsed.fragment or parsed.username or parsed.password):
        raise SystemExit('Expected local API at 127.0.0.1:54321; nothing configured.')
    public_key = status.get('PUBLISHABLE_KEY') or status.get('ANON_KEY')
    if not public_key or public_key.startswith('sb_secret_'):
        raise SystemExit('Local public key unavailable.')
    env.update(VITE_SUPABASE_URL='http://127.0.0.1:54321', VITE_SUPABASE_PUBLISHABLE_KEY=public_key)
    # Public UX hint only. Auth and database gates remain authoritative.
    try:
        env['VITE_AUTH_MFA_TOTP_ENABLED'] = 'true' if auth_totp_enabled(env) else 'false'
    except Exception:
        env['VITE_AUTH_MFA_TOTP_ENABLED'] = 'false'
        print('Authenticator UI unavailable: local Auth capability could not be verified.', flush=True)
    if args.prepare:
        path = root / '.env.development.local'
        if path.exists():
            raise SystemExit('Development override already exists; it was not overwritten. Use --dev to supply validated local settings in memory.')
        with path.open('x', encoding='utf-8', newline='\n') as handle:
            handle.write('# Local development only; generated from local Supabase CLI status.\n')
            handle.write('VITE_SUPABASE_URL=http://127.0.0.1:54321\n')
            handle.write('VITE_SUPABASE_PUBLISHABLE_KEY=' + public_key + '\n')
        print('Created ignored .env.development.local with local public credentials; values suppressed.')
        return
    npm = shutil.which('npm.cmd') or shutil.which('npm')
    if not npm:
        raise SystemExit('npm required.')
    command = [npm, 'run', 'build'] if args.build else [npm, 'run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173', '--strictPort']
    print('Running frontend against local Supabase with a public key only.', flush=True)
    code = subprocess.run(command, cwd=root, env=env).returncode
    if args.build and code == 0:
        private_values = [status.get(name) for name in ('SERVICE_ROLE_KEY', 'SECRET_KEY') if status.get(name)]
        for path in (root / 'dist').rglob('*.js'):
            built = path.read_text(encoding='utf-8')
            if any(value in built for value in private_values):
                raise SystemExit('Build credential check failed; do not serve this bundle.')
        print('Build credential check: no local service-role/secret key present.', flush=True)
    raise SystemExit(code)


if __name__ == '__main__':
    main()
