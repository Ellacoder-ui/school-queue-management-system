"""Verify the already-applied migration 006 and run only fixture-safe regressions.

No migration application, restoration, bootstrap, reset, linked/hosted workflow or
persistent fixture generation exists in this entry point. Previous evidence is immutable.
Inspection uses read-only transactions. Two reviewed pgTAP files roll back all fixtures.
"""
import argparse
from datetime import datetime, timezone
import json
import re
import shutil
import subprocess
import sys
import time

import apply_retained_migration_006 as cutover

ROOT = cutover.ROOT
EVIDENCE = ROOT/'supabase/tests/results/retained_migration_006_postvalidation.json'
HISTORICAL_SHA256 = '74a885340d90f7876948926e84ce9c8048b49629b2abec13fe6ecca9fbebf056'
CLI_TASKS = {
    'lint': ['db','lint','--local'],
    'fixed-routing': ['test','db','--local','supabase/tests/database/fixed_routing_test.sql'],
    'read-context': ['test','db','--local','supabase/tests/database/read_context_test.sql'],
}


def safe_cli_arguments(task):
    cutover.require(task in CLI_TASKS, 'Only the three reviewed lint/rollback-test tasks are permitted')
    return list(CLI_TASKS[task])


def rollback_test_text(text):
    text = re.sub(r'--[^\n]*','',text).strip()
    cutover.require(text.startswith('begin;') and text.endswith('rollback;'), 'Test must have an explicit BEGIN/ROLLBACK envelope')
    cutover.require(len(re.findall(r'^\s*begin\s*;',text,re.M)) == 1 and
                    len(re.findall(r'^\s*rollback\s*;',text,re.M)) == 1 and
                    not re.search(r'\b(?:commit|end\s+transaction|prepare\s+transaction)\s*;',text,re.I),
                    'Test transaction controls could persist fixtures')
    cutover.require(not re.search(r'\b(?:nextval|setval|dblink|lo_import|lo_export)\s*\(',text,re.I),
                    'Unreviewed nontransactional test side effect')


def reviewed_test_files():
    result = {}
    for name in cutover.TEST_FILES:
        path = ROOT/'supabase/tests/database'/name
        validated_copy = ROOT/'.local-routing/b558edf3/fresh/supabase/tests/database'/name
        cutover.require(validated_copy.is_file() and cutover.backup.file_sha256(path) == cutover.backup.file_sha256(validated_copy),
                        'Database test differs from the reviewed isolated copy')
        rollback_test_text(path.read_text(encoding='utf-8'))
        result[name] = {'sha256':cutover.backup.file_sha256(path),'explicit_rollback':True,'matches_isolated_copy':True}
    return result


def historical():
    cutover.require(cutover.backup.file_sha256(cutover.EVIDENCE) == HISTORICAL_SHA256, 'Original stopped cutover evidence changed')
    record = json.loads(cutover.EVIDENCE.read_text(encoding='utf-8'))
    cutover.require(record['result'] == 'FAIL' and record['phase'] == 'postflight' and record['migration_applied'] is True,
                    'Expected historical applied-but-stopped evidence')
    return record


def artifact_check():
    cutover.recovery.verify_bundle()  # Artifact checks only; no old-source equality command.
    cutover.recovery_internal.verify_acl([cutover.recovery.SQL_FILE,cutover.recovery.BUNDLE_FILE,
        cutover.recovery.ENV_FILE,cutover.recovery.PROPOSAL_FILE,cutover.recovery.PRIVILEGE_BASELINE_FILE])
    return {'result':'PASS','bundle_sha256':cutover.backup.file_sha256(cutover.recovery.BUNDLE_FILE),
            'protected_access':True,'pre_cutover_recovery_point_preserved':True,'restore_repeated':False}


def inspect(record):
    original = historical()
    local, env, observed = cutover.capture()
    details = cutover.post_details(env)
    record['postflight'] = cutover.postflight(original['before'],observed,details)
    # No activity after the failed cutover is permitted to become a new baseline silently.
    cutover.exact_snapshot(original['after'],observed,'Post-cutover source baseline')
    record['current'] = observed
    record['details'] = details
    record['recovery_artifacts'] = artifact_check()
    record['reviewed_test_files'] = reviewed_test_files()
    record['historical_result_preserved'] = 'FAIL'
    print('PASS: corrected read-only postflight; six migrations, exact routes, five new constraint records/six triggers, all data and security preserved.',flush=True)
    return local, env, observed


def save(record):
    cutover.backup.write_json(EVIDENCE,record)


def invoke(command, timeout=180):
    return subprocess.run(command,cwd=ROOT,env=cutover.backup.clean_env(),capture_output=True,
                          text=True,encoding='utf-8',timeout=timeout)


def cli_check(task, expected_tests, record, baseline):
    # Explicit task allowlist is the only route into the CLI from this entry point.
    arguments = safe_cli_arguments(task)
    cutover.backup.target()
    reviewed_test_files()
    started = time.monotonic()
    result = invoke(cutover.backup.CLI + arguments + ['--workdir',str(ROOT),'--network-id',cutover.NETWORK])
    output = result.stdout+'\n'+result.stderr
    check = {'check':task,'exit_code':result.returncode,'sqlstates':cutover.sqlstates(output),
             'duration_seconds':round(time.monotonic()-started,3),
             'evidence':[line for line in output.splitlines() if line.startswith(
                 ('All tests successful','Files=','Result:','No schema errors','not ok ','1..'))]}
    record['checks'].append(check)
    save(record)
    # Verify even a failed suite left no fixtures, schema, ACL or sequence changes.
    _,_,after = cutover.capture()
    cutover.exact_snapshot(baseline,after,task+' preservation')
    check['complete_rollback_or_read_only_preservation'] = True
    save(record)
    if expected_tests is None:
        check['result'] = 'PASS' if result.returncode == 0 and 'No schema errors found' in output else 'FAIL'
    else:
        match = re.search(r'Files=\d+, Tests=(\d+)',output)
        good = result.returncode == 0 and match and int(match.group(1)) == expected_tests and 'Result: PASS' in output and not re.search(r'^not ok ',output,re.M)
        check.update(passed=int(match.group(1)) if good else 0,failed=0 if good else 1,skipped=0,result='PASS' if good else 'FAIL')
    save(record)
    cutover.require(check['result'] == 'PASS', task+' failed; raw diagnostics suppressed')
    print('PASS: '+task+(' — '+str(expected_tests)+' pgTAP assertions; complete fixture rollback verified' if expected_tests else ' — no schema errors'),flush=True)


def local_check(label, command, record):
    started = time.monotonic()
    result = invoke(command)
    output = result.stdout+'\n'+result.stderr
    check = {'check':label,'exit_code':result.returncode,'duration_seconds':round(time.monotonic()-started,3)}
    record['checks'].append(check)
    save(record)
    if label in ('offline-cutover','structural'):
        match = re.search(r'Ran (\d+) tests?',output)
        good = result.returncode == 0 and match and 'OK' in output
        check.update(result='PASS' if good else 'FAIL',passed=int(match.group(1)) if good else 0,failed=0 if good else 1,skipped=0)
        if label == 'structural': cutover.require(good and int(match.group(1)) == 6, 'Structural migration checks failed')
    elif label == 'frontend-unit':
        counts = {key:int(value) for key,value in re.findall(r'^\s*(?:# |ℹ )?(tests|pass|fail|skipped)\s+(\d+)\s*$',output,re.M)}
        good = result.returncode == 0 and counts.get('pass',0) > 0 and counts.get('fail') == 0
        check.update(result='PASS' if good else 'FAIL',passed=counts.get('pass',0),failed=counts.get('fail',1),skipped=counts.get('skipped',0))
    else:
        good = result.returncode == 0 and 'Build credential check: no local service-role/secret key present.' in output
        check.update(result='PASS' if good else 'FAIL',production_build='PASS' if good else 'FAIL',private_key_scan='PASS' if good else 'FAIL')
    save(record)
    cutover.require(check['result'] == 'PASS', label+' failed; raw diagnostics suppressed')
    print('PASS: '+label,flush=True)


def run(validate):
    cutover.require(not EVIDENCE.exists(), 'New validation evidence already exists; preserve it and review a new run explicitly')
    original_report = ROOT/'supabase/RETAINED_LOCAL_MIGRATION_006_SUCCESS_REPORT.md'
    report_hash = cutover.backup.file_sha256(original_report)
    record = {'result':'IN_PROGRESS','phase':'read-only-postflight','started_at':datetime.now(timezone.utc).isoformat(),
              'project':cutover.backup.PROJECT,'database':'127.0.0.1:54322/postgres','api':'http://127.0.0.1:54321',
              'migration_application_attempted':False,'database_restore_attempted':False,'hosted_contacted':False,
              'historical_evidence_sha256':HISTORICAL_SHA256,'historical_report_sha256':report_hash,'checks':[]}
    save(record)
    try:
        local,env,baseline = inspect(record)
        save(record)
        if validate:
            record['phase'] = 'fixture-safe-regressions'
            local_check('offline-cutover',[sys.executable,'-m','unittest','discover','-s','supabase/tests','-p','test_retained_cutover.py','-v'],record)
            for task,count in [('lint',None),('fixed-routing',44),('read-context',44)]:
                cli_check(task,count,record,baseline)
            local_check('structural',[sys.executable,'supabase/tests/static_check.py'],record)
            record['http'] = cutover.read_http(local,env)
            save(record)
            print('PASS: '+str(record['http']['passed'])+' read-only HTTP authorization/schema checks',flush=True)
            npm = shutil.which('npm.cmd') or shutil.which('npm')
            cutover.require(npm is not None,'npm unavailable')
            local_check('frontend-unit',[npm,'run','test:frontend'],record)
            local_check('frontend-build-and-key-scan',[sys.executable,'scripts/local_frontend.py','--build'],record)
        record['phase'] = 'final-preservation'
        _,final_env,final = cutover.capture()
        cutover.exact_snapshot(baseline,final,'Final postvalidation preservation')
        final_details = cutover.post_details(final_env)
        cutover.postflight(historical()['before'],final,final_details)
        artifact_check()
        reviewed_test_files()
        cutover.require(cutover.backup.file_sha256(original_report) == report_hash,'Historical FAIL report changed')
        record.update(result='PASS',phase='complete',completed_at=datetime.now(timezone.utc).isoformat(),
            regressions_executed=validate,final_preservation=True,no_retained_fixtures=True,
            original_fail_evidence_and_report_unchanged=True,recovery_artifacts_unchanged=True,final_state=final['state'])
        record['excluded_suites'] = ['Legacy fresh-bootstrap pgTAP','Persistent fixture-generating concurrency/API/Realtime/browser suites']
        save(record)
        print('STOPPED: already-applied migration 006 validated; retained data/schema/security and recovery artifacts unchanged; no migration executed.',flush=True)
    except BaseException as error:
        message = str(error) if isinstance(error,RuntimeError) else 'Postvalidation harness failure; raw diagnostics suppressed'
        record.update(result='FAIL',failure=message)
        save(record)
        print('STOP: '+message,flush=True)
        raise SystemExit(1) from None


if __name__=='__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--verify-only',action='store_true')
    mode.add_argument('--validate',action='store_true')
    args = parser.parse_args()
    run(args.validate)
