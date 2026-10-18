"""Read-only source fence around browser/SDK tests; no application or Auth writes."""
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'supabase/tests'))
from realtime_preservation import capture_current as capture, classify, REALTIME_SEQUENCE

def run_browser(script, pattern):
    before = capture()
    directory=ROOT/'supabase/tests/results'
    previous=set(directory.glob(pattern))
    result=subprocess.run(['node',script],cwd=ROOT)
    after=capture()
    preservation=classify(before,after)
    created=set(directory.glob(pattern))-previous
    if len(created)!=1: raise RuntimeError('Expected exactly one new browser evidence file')
    evidence=created.pop()
    record=json.loads(evidence.read_text(encoding='utf-8'))
    record['source_preservation']=preservation
    evidence.write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
    if result.returncode: raise RuntimeError('Browser suite failed; see its new evidence file')
    return {'evidence':str(evidence.relative_to(ROOT)),'checks':record['checks'],'preservation':preservation}

if __name__ == '__main__':
    run_browser('tests/frontend/publicBoard.browser.mjs','public_board_*.json')
    print('Read-only preservation: PASS, including strictly validated Realtime lifecycle.')
