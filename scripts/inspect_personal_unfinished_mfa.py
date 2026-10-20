"""Read-only exact unfinished-factor review. Does not select a key or remove a factor."""
from datetime import datetime, timezone
import json
import re
import sys
from uuid import uuid4
import auth_only_guard as g
import auth_mfa_guard as mf
from inspect_personal_admin_live import AUTH, EXPECTED, PERSONAL, ROOT
from inspect_personal_admin import SQL


def main():
    now = g.capture()
    g.need(next(x for x in now['items'] if x['Name'] == g.AUTH)['Id'] == AUTH, 'UMF_AUTH_CHANGED')
    mf.flags(now, True); g.health_check(now, True)
    with g.m.backup.Snapshot({**g.m.backup.clean_env(), **now['connection']['env']}) as s:
        accounts = s.query(SQL)
        factors = s.query("""select coalesce(jsonb_agg(jsonb_build_object('id',id,'user_id',user_id,
          'type',factor_type,'status',status,'created_at',created_at) order by created_at),'[]')
          from auth.mfa_factors where user_id='5c96debb-697f-4cad-805f-92b518e28343'""")
    g.need(len(accounts) == 2 and len(factors) == 1, 'UMF_FACTOR_INVENTORY_CHANGED')
    for row in accounts:
        g.need(row['auth_id'] in EXPECTED and (row['email'], row['binding']) == EXPECTED[row['auth_id']] and
               row['account_id'] == row['auth_id'] and row['role'] == 'STUDENT' and row['enabled'] and
               row['assignments'] == row['active_tickets'] == 0, 'UMF_ACCOUNT_CHANGED')
    factor = factors[0]
    g.need(factor['user_id'] == PERSONAL and factor['type'] == 'totp' and factor['status'] == 'unverified', 'UMF_NOT_UNFINISHED_TOTP')
    report = dict(result='PASS_READ_ONLY_UNFINISHED_FACTOR_REVIEW', observedAt=datetime.now(timezone.utc).isoformat(),
        account=dict(uuid=PERSONAL, email=EXPECTED[PERSONAL][0], binding=EXPECTED[PERSONAL][1], role='STUDENT', enabled=True),
        factor=factor, verifiedFactors=0, userReportedQrNeverScanned=True, proposedAction='Explicitly remove only this unverified factor using the owning user supported Auth MFA API, then separately start a new enrollment. No automatic action.',
        approval='REQUIRED_BEFORE_RETAINED_UNENROLL', retainedWrites=False, schoolRemainsStudent=True)
    run = uuid4().hex[:8]
    with (ROOT / f'supabase/tests/results/unfinished_mfa_review_{run}.json').open('x', encoding='utf-8') as f: json.dump(report, f, indent=2)
    print(json.dumps(dict(report, evidence=f'supabase/tests/results/unfinished_mfa_review_{run}.json')))


if __name__ == '__main__':
    try: main()
    except Exception as error:
        code = str(error) if re.fullmatch(r'(UMF|AGO|AMF)_[A-Z_]+', str(error)) else 'UMF_READ_ONLY_REVIEW_STOPPED'
        print(json.dumps(dict(result='FAIL_STOPPED', code=code))); sys.exit(1)
