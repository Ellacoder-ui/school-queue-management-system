"""Final read-only preservation after a stopped validation; never retries tests."""
import argparse
from datetime import datetime, timezone
import json
import re
from run_google_auth import inspect
from run_google_auth_postvalidation import hashes
from realtime_preservation import ROOT, classify

def main(run):
    if not re.fullmatch('[0-9a-f]{8}',run): raise RuntimeError('Invalid evidence identity')
    directory=ROOT/'supabase/tests/results'
    previous=json.loads((directory/f'google_frontend_postvalidation_{run}.json').read_text(encoding='utf-8'))
    if previous['result']!='FAIL': raise RuntimeError('Stopped failure evidence required')
    source,inspection=inspect()
    record={'result':'PASS_READ_ONLY_PRESERVATION_ONLY','stopped_run_result':'FAIL',
        'run_id':run,'checked_at_utc':datetime.now(timezone.utc).isoformat(),
        'preservation':classify(previous['before'],source),'inspection':inspection,
        'source':source,'historical_hashes':hashes(),'tests_retried':False,
        'failure_diagnosis':{'blocked_endpoints':[],'recorded_uncaught_browser_exceptions':0,
            'observed_error':'Browser interception failure',
            'cause':'Unresolved: existing catch discards underlying CDP error and event association',
            'not_whitelisted':True}}
    if record['historical_hashes']!=previous['historical_hashes_before']:
        raise RuntimeError('Historical evidence changed; stop')
    path=directory/f'google_frontend_postvalidation_final_{run}.json'
    with path.open('x',encoding='utf-8') as handle: json.dump(record,handle,indent=2);handle.write('\n')
    print('PASS: final read-only rows/schema/security, historical evidence, protected recovery artifacts and disabled Google. Overall validation remains FAIL.')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--run-id',required=True)
    main(parser.parse_args().run_id)
