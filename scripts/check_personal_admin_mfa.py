"""Read-only real-enrollment checkpoint. Never selects factor keys, OTPs or JWTs."""
from collections import Counter
from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys
from uuid import uuid4
import auth_only_guard as g
import auth_mfa_guard as mf
from inspect_personal_admin_live import storage, PERSONAL, EXPECTED, AUTH, ROOT
from inspect_personal_admin import SQL


def main():
    baseline_run = 'f7a5d5d9'
    before = json.loads(storage('open', baseline_run)['payload'])
    now = g.capture(before['connection'])
    g.need(next(x for x in now['items'] if x['Name'] == g.AUTH)['Id'] == AUTH, 'PAM_AUTH_CHANGED')
    mf.flags(now, True); g.health_check(now, True)
    old, current = g.decode_source(before['sourceSnapshot']), g.decode_source(now['sourceSnapshot'])
    changed_auth = {name: {'before': old['rows'][name]['count'], 'after': value['count']}
                    for name, value in current['rows'].items() if name.startswith('"auth".') and old['rows'].get(name) != value}
    # Explicitly separate authorized Auth-side-effect observations from queue/security
    # preservation. This is not a blanket PASS for altered private Auth records.
    left, right = deepcopy(old), deepcopy(current)
    for name in set(left['rows']) | set(right['rows']):
        if name.startswith('"auth".'):
            g.need(name in left['rows'] and name in right['rows'], 'PAM_AUTH_INVENTORY_CHANGED')
            right['rows'][name] = left['rows'][name]
    changed_sequences = []
    for name, value in right['sequences'].items():
        if left['sequences'].get(name) != value and (name.startswith('"auth".') or name.startswith('auth.')):
            changed_sequences.append(name); right['sequences'][name] = left['sequences'][name]
    g.m.recovery.compare_source(left, right)
    g.need(left['ancillary'] == right['ancillary'], 'PAM_ANCILLARY_CHANGED')
    env = {**g.m.backup.clean_env(), **now['connection']['env']}
    with g.m.backup.Snapshot(env) as s:
        accounts = s.query(SQL)
        mfa = s.query("""select jsonb_build_object(
          'verified_totp_factors',(select count(*) from auth.mfa_factors where user_id='5c96debb-697f-4cad-805f-92b518e28343' and status='verified' and factor_type='totp'),
          'recent_aal2_sessions',(select count(*) from auth.sessions x join auth.mfa_factors f on f.id=x.factor_id
             where x.user_id='5c96debb-697f-4cad-805f-92b518e28343' and f.user_id=x.user_id and f.status='verified'
             and x.aal='aal2' and (x.not_after is null or x.not_after>clock_timestamp()) and x.updated_at>='2026-10-19T10:22:30Z'),
          'latest_totp_verification',(select max(c.updated_at) from auth.mfa_amr_claims c join auth.sessions x on x.id=c.session_id
             where x.user_id='5c96debb-697f-4cad-805f-92b518e28343' and c.authentication_method='totp'),
          'latest_factor_challenge',(select max(to_jsonb(f)->>'last_challenged_at') from auth.mfa_factors f
             where f.user_id='5c96debb-697f-4cad-805f-92b518e28343' and f.status='verified'))""")
        migration_absent = s.query("select to_jsonb(to_regclass('queue_private.staff_access_approvals') is null)")
    for row in accounts:
        g.need(row['auth_id'] in EXPECTED and (row['email'], row['binding']) == EXPECTED[row['auth_id']] and
               row['account_id'] == row['auth_id'] and row['role'] == 'STUDENT' and row['enabled'] and
               row['assignments'] == row['active_tickets'] == 0, 'PAM_ACCOUNT_CHANGED')
    g.need(len(accounts) == 2 and migration_absent, 'PAM_AUTHORIZATION_CHANGED')
    old_services = {x['Id']: x for x in before['items']}
    g.need(set(old_services) == {x['Id'] for x in now['items']}, 'PAM_SERVICE_INVENTORY')
    for item in now['items']:
        previous = old_services[item['Id']]
        g.need(all(previous[k] == item[k] for k in ('Name', 'Config', 'HostConfig', 'Mounts', 'NetworkSettings', 'Image')), 'PAM_SERVICE_DEFINITION')
        if item['Name'] != '/supabase_vector_school-queue-local':
            g.need(g.m.base.state(previous) == g.m.base.state(item), 'PAM_SERVICE_LIFECYCLE')
    for key in ('credential', 'dbVolume', 'backupTree'):
        g.need(before[key] == now[key], 'PAM_PROTECTED_INPUT_CHANGED')
    result = 'PASS_FACTOR_AND_AAL2_DATABASE_EVIDENCE' if mfa['verified_totp_factors'] == 1 and mfa['recent_aal2_sessions'] >= 1 and mfa['latest_totp_verification'] else 'PENDING_REAL_ENROLLMENT_OR_AAL2'
    run = uuid4().hex[:8]
    report = dict(result=result, observedAt=datetime.now(timezone.utc).isoformat(), accounts=accounts, mfa=mfa,
        queueRolesSecurityAndMigrationsPreserved=True, changedAuthTableCounts=changed_auth, changedAuthSequences=changed_sequences,
        servicesPreserved=True, backups=now['backupTree'], google=True, totp=True, securityMigrationUnapplied=True,
        limitation='Database session/AMR evidence must be paired with the user-confirmed current AAL2 screen. No live browser JWT was read.')
    path = ROOT / f'supabase/tests/results/personal_admin_mfa_{run}.json'
    with path.open('x', encoding='utf-8') as f: json.dump(report, f, indent=2)
    print(json.dumps(report))


if __name__ == '__main__':
    try: main()
    except Exception as error:
        code = str(error) if re.fullmatch(r'(PAM|AGO|AMF)_[A-Z_]+', str(error)) else 'PAM_CHECKPOINT_STOPPED'
        print(json.dumps(dict(result='FAIL_STOPPED', code=code))); sys.exit(1)
