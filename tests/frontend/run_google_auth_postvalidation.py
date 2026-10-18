"""New evidence only; no migration, real Auth write, restore or provider setup."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
from uuid import uuid4

from run_google_auth import inspect, NoRedirect
from run_public_board import run_browser
from realtime_preservation import ROOT, classify, PreservationError
import retained_migration_006 as backup
from urllib.request import Request, build_opener

HISTORICAL=[
 'supabase/GOOGLE_AUTH_FRONTEND_PHASE_REPORT.md',
 'supabase/POST_MIGRATION_006_BACKUP_REPORT.md',
 'supabase/tests/results/google_auth_frontend_postflight.json',
 'supabase/tests/results/google_oauth_frontend_1f7dca31.json',
 'supabase/tests/results/retained_migration_006_postvalidation.json',
 'supabase/tests/results/post_migration_006_backup_4c79fb00.json',
 'supabase/GOOGLE_AUTH_FRONTEND_POSTVALIDATION_REPORT.md',
 'supabase/tests/results/public_board_46bba6cd.json',
 'supabase/tests/results/google_frontend_postvalidation_66bd264d.json',
 'supabase/tests/results/google_frontend_postvalidation_final_66bd264d.json',
 'supabase/tests/results/public_board_2c75acab.json',
 'supabase/tests/results/google_frontend_final_validation_a58e9ab0.json',
 'supabase/tests/results/google_oauth_frontend_1a8ed6e5.json',
 'supabase/tests/results/google_frontend_final_validation_ac3ae692.json',
 'supabase/tests/results/google_oauth_frontend_d35e7f7a.json',
 'supabase/tests/results/google_oauth_frontend_324abcc5.json',
 'supabase/tests/results/public_board_c12e09b7.json']

def hashes(): return {name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in HISTORICAL}

def tested_code_hashes():
    files=list((ROOT/'src').rglob('*'))+list((ROOT/'supabase/migrations').glob('*.sql'))
    files += [ROOT/name for name in ['package.json','package-lock.json','supabase/config.toml',
        'supabase/tests/headless_local_browser.mjs','supabase/tests/cdp_errors.mjs',
        'tests/frontend/browserInterception.mjs','tests/frontend/browserInterception.unit.mjs',
        'tests/frontend/startTestVite.mjs',
        'tests/frontend/publicBoard.browser.mjs','tests/frontend/googleOAuth.browser.mjs',
        'tests/frontend/realtime_preservation.py','tests/frontend/run_google_auth_postvalidation.py']]
    return {str(path.relative_to(ROOT)):hashlib.sha256(path.read_bytes()).hexdigest() for path in files if path.is_file()}

def command(arguments, passed_text, label):
    process=subprocess.run(arguments,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',timeout=180)
    if process.returncode or passed_text not in process.stdout+process.stderr:
        raise RuntimeError(label+' failed; raw diagnostics suppressed')
    print('PASS: '+label,flush=True)

def profile_checks():
    from urllib.error import HTTPError
    local,_,_=backup.target()
    key=local.get('PUBLISHABLE_KEY') or local['ANON_KEY']
    observations=[]
    for profile,table in [('realtime','messages_2026_10_20'),('queue_private','tickets')]:
        request=Request('http://127.0.0.1:54321/rest/v1/'+table+'?select=*&limit=0',
            headers={'apikey':key,'Accept-Profile':profile})
        try:
            with build_opener(NoRedirect()).open(request,timeout=10) as response:
                raise RuntimeError('Unexpected exposed REST schema; stop')
        except HTTPError as error:
            payload=json.load(error)
            if error.code!=406 or payload.get('code')!='PGRST106': raise RuntimeError('Unexpected REST schema boundary')
            observations.append({'profile':profile,'status':error.code,'code':payload['code']})
    return observations

def main():
    identity=uuid4().hex[:8]
    evidence=ROOT/f'supabase/tests/results/google_frontend_final_validation_{identity}.json'
    record={'run_id':identity,'started_at_utc':datetime.now(timezone.utc).isoformat(),
        'result':'RUNNING','phase':'preflight','application_auth_sql_writes_requested':False,
        'real_google_login':False,'historical_hashes_before':hashes(),'tested_code_hashes_before':tested_code_hashes()}
    def save(): backup.write_json(evidence,record)
    if evidence.exists(): raise RuntimeError('New evidence identity required')
    save()
    try:
        before,inspection=inspect()
        record['preflight']=inspection
        record['before']=before
        record['public_private_schema_denials']=profile_checks()
        record['phase']='regression'; save()
        command(['node','--test','--test-reporter=tap','tests/frontend/browserInterception.unit.mjs'],
            '# pass 15','15 interception policy/lifecycle methods')
        record['interception_tests']={'passed':15,'failed':0,'skipped':0}; save()
        command(['python','-m','unittest','discover','-s','tests/frontend','-p','test_realtime_preservation.py'],
            'Ran 24 tests','24 strict lifecycle regression methods')
        record['classification_tests']={'passed':24,'failed':0,'skipped':0}; save()
        command(['npm.cmd','run','test:frontend'],'pass 85','85 frontend tests')
        record['frontend_tests']={'passed':85,'failed':0,'skipped':0}; save()
        record['oauth_browser']=run_browser('tests/frontend/googleOAuth.browser.mjs','google_oauth_frontend_*.json'); save()
        record['after_oauth_preservation']=classify(before,inspect()[0]); save()
        record['public_board_browser']=run_browser('tests/frontend/publicBoard.browser.mjs','public_board_*.json'); save()
        record['after_board_preservation']=classify(before,inspect()[0]); save()
        command(['python','scripts/local_frontend.py','--build'],'Build credential check: no local service-role/secret key present.',
            'Production build / known-private-key scan')
        record['build_and_known_private_key_scan']='PASS'
        record['phase']='final-preservation'; save()
        after,final=inspect()
        record['after']=after
        record['preservation']=classify(before,after)
        if inspection['auth_nonsecret_settings']!=final['auth_nonsecret_settings']:
            raise PreservationError(['auth.configuration_changed'])
        record['final_inspection']=final
        record['historical_hashes_after']=hashes()
        if record['historical_hashes_before']!=record['historical_hashes_after']:
            raise PreservationError(['historical_evidence_changed'])
        record['tested_code_hashes_after']=tested_code_hashes()
        if record['tested_code_hashes_before']!=record['tested_code_hashes_after']:
            raise PreservationError(['tested_code_changed_during_validation'])
        record.update(result='PASS',phase='complete',completed_at_utc=datetime.now(timezone.utc).isoformat())
        save(); print('PASS: '+str(evidence.relative_to(ROOT)),flush=True)
    except BaseException as error:
        record['result']='FAIL'
        record['failure']=error.evidence if isinstance(error,PreservationError) else {'type':type(error).__name__,'message':str(error)}
        save()
        raise

if __name__=='__main__': main()
