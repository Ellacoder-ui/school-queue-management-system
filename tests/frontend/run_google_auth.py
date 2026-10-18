"""Read-only six-version/recovery fence; OAuth tests must mock all Auth writes."""
import argparse
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
from urllib.request import Request, build_opener, HTTPRedirectHandler
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'supabase/tests'))
import post_migration_006_backup as recovery
import retained_migration_006 as backup
from run_public_board import capture, run_browser
from realtime_preservation import bundle_comparison, classify

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): raise RuntimeError('Local Auth settings redirect rejected')

def inspect():
    source = capture()
    record = json.loads((ROOT / 'supabase/tests/results/post_migration_006_backup_4c79fb00.json').read_text())
    assert record['result'] == 'PASS' and record['recoverability_verified'] and record['phase'] == 'complete'
    verifier = recovery.Run.__new__(recovery.Run)
    verifier.id = record['run_id']; verifier.record = record; verifier.directory = Path(record['directory'])
    manifest = verifier.verify_bundle()  # Artifact hashes/association/ACLs only; never restores.
    bundle_check=bundle_comparison(manifest,source)
    local, env, _ = backup.target()
    with backup.Snapshot(env) as snapshot:
        trigger = snapshot.query("select to_jsonb(pg_get_triggerdef(oid,true)) from pg_trigger where tgname='queue_account_created' and tgrelid='auth.users'::regclass")
        assert trigger == 'CREATE TRIGGER queue_account_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION queue_private.provision_account()'
    auth = json.loads(backup.call(['docker','inspect','supabase_auth_school-queue-local'], label='Read-only Auth settings inspection').stdout)[0]
    allow = {'GOTRUE_SITE_URL','GOTRUE_URI_ALLOW_LIST','GOTRUE_DISABLE_SIGNUP','GOTRUE_EXTERNAL_GOOGLE_ENABLED','GOTRUE_EXTERNAL_EMAIL_ENABLED',
             'GOTRUE_MAILER_AUTOCONFIRM','GOTRUE_MFA_TOTP_ENROLL_ENABLED','GOTRUE_MFA_TOTP_VERIFY_ENABLED'}
    settings = {key:value for entry in auth['Config']['Env'] for key,_,value in [entry.partition('=')] if key in allow}
    public_key=local.get('PUBLISHABLE_KEY') or local['ANON_KEY']
    request=Request('http://127.0.0.1:54321/auth/v1/settings',headers={'apikey':public_key})
    with build_opener(NoRedirect()).open(request,timeout=10) as response: availability=json.load(response)
    assert availability['external']['google'] is False, 'Google provider unexpectedly enabled; stop'
    return source, {'result':'PASS','project':'school-queue-local','database':'127.0.0.1:54322/postgres','api':'http://127.0.0.1:54321',
        'six_migrations_and_file_hashes_verified':True,'provisioning_trigger_verified':True,'logical_tables':len(source['rows']),
        'recovery_artifacts_verified':True,'recovery_bundle_sha256':record['bundle']['sha256'],
        'auth_nonsecret_settings':settings,'google_provider_enabled':False,
        'recovery_baseline_classification':bundle_check,'source_application_auth_writes':False}

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--inspect', action='store_true')
    args = parser.parse_args()
    before, evidence = inspect()
    if args.inspect:
        path = ROOT / ('supabase/tests/results/google_auth_frontend_inspection_'+uuid4().hex[:8]+'.json')
        with path.open('x',encoding='utf-8') as handle: json.dump(evidence,handle,indent=2); handle.write('\n')
        print('PASS: read-only six-migration, provisioning and protected recovery-artifact inspection.')
        raise SystemExit(0)
    run_browser('tests/frontend/googleOAuth.browser.mjs','google_oauth_frontend_*.json')
    after, final = inspect()
    classify(before,after)
    assert evidence['auth_nonsecret_settings']==final['auth_nonsecret_settings'], 'Auth configuration changed'
    print('PASS: scoped platform lifecycle and exact application/Auth/recovery-artifact preservation.')
