"""Synthetic-only Step 22.7 checks and read-only retained-source preservation."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'supabase/tests'))
import google_credential_preflight as gate

backup = gate.recovery.backup


def require(condition, code):
    if not condition: raise RuntimeError(code)


def docker_state():
    names = ['supabase_' + kind + '_school-queue-local' for kind in ('db','kong','auth','realtime')]
    items = json.loads(backup.call(['docker','inspect',*names], label='Read-only retained restart fence').stdout)
    states = {item['Name'][1:]: {'id': item['Id'], 'started_at': item['State']['StartedAt'],
                              'running': item['State']['Running'], 'restart_count': item['RestartCount']} for item in items}
    resources = {kind: sorted(backup.call(args, label='Read-only Docker resource inventory').stdout.splitlines()) for kind, args in (
        ('containers',['docker','ps','-aq']), ('volumes',['docker','volume','ls','-q']), ('networks',['docker','network','ls','-q']))}
    return {'retained': states, 'resources_sha256': hashlib.sha256(json.dumps(resources,sort_keys=True).encode()).hexdigest()}


def inputs():
    files = [ROOT/'supabase/config.toml', ROOT/'.gitignore', *sorted((ROOT/'supabase/migrations').glob('*.sql'))]
    files += [p for p in (ROOT/'src').rglob('*') if p.is_file()]
    files += [ROOT/'scripts'/name for name in ('Set-LocalGoogleCredential.ps1','Start-LocalGoogleAuth.ps1','LocalGoogleCredential.psm1')]
    return {str(p.relative_to(ROOT)): backup.file_sha256(p) for p in files}


def run():
    run_id = uuid.uuid4().hex[:8]
    evidence = ROOT / f'supabase/tests/results/local_google_credential_helpers_{run_id}.json'
    record = {'result':'IN_PROGRESS','phase':'read-only-preflight','run_id':run_id,
              'started_at':datetime.now(timezone.utc).isoformat(),'real_google_credentials_handled':False,
              'google_activated':False,'retained_services_restarted':False,'source_writes':False}
    require(not evidence.exists(), 'LCG_EVIDENCE_EXISTS')
    def save(): backup.write_json(evidence, record)
    save()
    try:
        require(not (ROOT/'.local-secrets/google-local.dpapi').exists(), 'LCG_REAL_STORE_PRESENT_STOP')
        record['before'] = gate.check()
        original_docker = docker_state()
        original_tree = gate.recovery.tree_summary(gate.recovery.historical_files(backup.BACKUPS/'__not_excluded__'))
        frozen = inputs()
        record.update(backup_file_tree_before=original_tree, docker_before=original_docker, tested_input_hashes=frozen)
        record['phase']='offline-python-tests'; save()
        result = backup.call([sys.executable,'-B','-m','unittest','discover','-s','supabase/tests','-p','test_google_credential_preflight.py'],
                             label='Offline credential preflight tests')
        match = re.search(r'Ran (\d+) tests', result.stderr)
        require(match is not None and 'OK' in result.stderr, 'LCG_UNIT_SUMMARY')
        record['python_tests']={'passed':int(match[1]),'failed':0,'skipped':0}
        record['phase']='initialize-empty-protected-production-directory'; save()
        backup.call(['powershell','-NoProfile','-NonInteractive','-File',str(ROOT/'scripts/Set-LocalGoogleCredential.ps1'),'-InitializeOnly'],
                    label='Empty protected credential directory initialization')
        require(not (ROOT/'.local-secrets/google-local.dpapi').exists(), 'LCG_PRODUCTION_FILE_CREATED')
        record['phase']='synthetic-storage-tests'; save()
        env=backup.clean_env()
        for key in ('NODE_OPTIONS','PYTHONPATH','PYTHONSTARTUP'): env.pop(key,None)
        result = subprocess.run(['powershell','-NoProfile','-NonInteractive','-File',str(ROOT/'tests/security/Test-LocalGoogleCredential.ps1'),'-RunId',run_id],
                                cwd=ROOT,env=env,capture_output=True,text=True,encoding='utf-8',timeout=90)
        if result.returncode:
            try:
                stopped=json.loads(result.stderr.strip())
                record['synthetic_failure']={k:stopped.get(k) for k in ('Result','Code','LastPassingCheck','RunId','ExceptionType','Frames','CommandCategory')}
            except Exception: record['synthetic_failure']={'Result':'FAIL','Code':'LCG_TEST_OUTPUT_REJECTED'}
            raise RuntimeError('LCG_SYNTHETIC_TEST_FAILED')
        tests=json.loads(result.stdout)
        require(tests['Result']=='PASS' and tests['RunId']==run_id and tests['Failed']==0 and
                tests['RealGoogleCredentialHandled'] is False and tests['ProductionCredentialCreated'] is False and
                tests['ServiceRestarted'] is False, 'LCG_SYNTHETIC_RECEIPT')
        record['synthetic_tests']=tests
        record['phase']='final-read-only-preservation'; save()
        record['after']=gate.check()
        require(docker_state()==original_docker, 'LCG_DOCKER_CHANGED')
        require(gate.recovery.tree_summary(gate.recovery.historical_files(backup.BACKUPS/'__not_excluded__'))==original_tree,
                'LCG_BACKUP_TREE_CHANGED')
        require(inputs()==frozen, 'LCG_TESTED_INPUT_CHANGED')
        require(not (ROOT/'.local-secrets/google-local.dpapi').exists(), 'LCG_PRODUCTION_FILE_CREATED')
        record.update(result='PASS',phase='complete',completed_at=datetime.now(timezone.utc).isoformat(),
                      source_preserved=True,all_existing_backup_files_unchanged=True,docker_resources_unchanged=True,
                      tested_inputs_unchanged=True,production_store_empty=True)
        save()
        print(json.dumps({'result':'PASS','run_id':run_id,'python_methods':record['python_tests']['passed'],
                          'powershell_checks':tests['Passed'],'skipped':len(tests['Skipped']),
                          'evidence':str(evidence.relative_to(ROOT))},indent=2))
    except Exception:
        record.update(result='FAIL',failure='LCG_HELPER_VALIDATION_STOPPED')
        try:
            record['after_failure_read_only']=gate.check()
            record['docker_preserved_after_failure']=(docker_state()==original_docker)
        except Exception: record['failure_preservation_check_unavailable']=True
        save()
        print(json.dumps({'result':'FAIL','phase':record['phase'],'synthetic_failure':record.get('synthetic_failure'),
                          'evidence':str(evidence.relative_to(ROOT))},indent=2))
        sys.exit(1)


if __name__=='__main__': run()
