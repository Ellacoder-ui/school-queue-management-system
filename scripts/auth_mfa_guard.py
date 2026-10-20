"""Read-only MFA-specific identity, source, backup and health fences; private IPC only."""
import json
import sys
import auth_only_guard as g

CURRENT = '565adceacab15cd43c7e00d5cee19345bc34f6ab981b35d5dc2ba4f8cdd4f399'
PARKED = '9f7742bf04e680d82988376411720e3500c9c0c069b0e57de5b7f3dc3ebb4ef6'


def initial_inventory(now):
    canonical = {x['Name']: x for x in now['items'] if x['Name'] in g.CANONICAL}
    extra = [x for x in now['items'] if x['Name'] not in g.CANONICAL]
    g.need(len(now['items']) == 13 and len(canonical) == 12 and canonical[g.AUTH]['Id'] == CURRENT,
           'AMF_PROJECT_IDENTITY')
    g.need(len(extra) == 1 and extra[0]['Id'] == PARKED and
           extra[0]['Name'] == g.AUTH + '-e17c030c-activation-original' and
           not extra[0]['State']['Running'] and not extra[0]['NetworkSettings']['Networks'], 'AMF_PARKED_ORIGINAL')


def flags(now, enabled):
    auth = next(x for x in now['items'] if x['Name'] == g.AUTH)
    pairs = [v.split('=', 1) for v in auth['Config']['Env']]
    g.need(len({k for k, _ in pairs}) == len(pairs), 'AMF_DUPLICATE_ENV')
    env = dict(pairs)
    g.need(env['GOTRUE_EXTERNAL_GOOGLE_ENABLED'] == 'true' and all(
        env[k] == ('true' if enabled else 'false') for k in
        ('GOTRUE_MFA_TOTP_ENROLL_ENABLED', 'GOTRUE_MFA_TOTP_VERIFY_ENABLED')), 'AMF_FLAGS')


def main():
    try:
        g.need(not sys.stdin.isatty() and not sys.stdout.isatty(), 'AMF_PRIVATE_IPC')
        raw = sys.stdin.buffer.read(4194305)
        g.need(len(raw) <= 4194304, 'AMF_BOUND')
        request = json.loads(raw)
        phase = request['phase']
        g.need(phase in ('capture', 'before', 'after', 'rollback-before', 'rollback-after'), 'AMF_PHASE')
        baseline = request.get('baseline')
        g.need((phase == 'capture') == (baseline is None), 'AMF_BASELINE_REQUIRED')
        now = g.capture(baseline['connection'] if baseline else None)
        source = g.decode_source(now['sourceSnapshot'])
        expected_versions = ['20261016000' + str(n) + '00' for n in range(1, 7)]
        files = sorted(p.name.split('_')[0] for p in (g.ROOT / 'supabase/migrations').glob('*.sql'))
        g.need(source['state']['versions'] == files == expected_versions and
               source['state']['routes'] == g.m.backup.CANONICAL, 'AMF_MIGRATIONS_ROUTING')
        initial_inventory(baseline or now)
        if baseline:
            g.compare(baseline, now, phase, request.get('replacement'))
        if phase != 'rollback-before':
            flags(now, phase == 'after')
            g.health_check(now, True)
        env = {**g.m.backup.clean_env(), **now['connection']['env']}
        with g.m.backup.Snapshot(env) as s:
            target = s.query("""select jsonb_build_object('id',u.id,'account',a.id,'role',a.role,'enabled',a.enabled,
              'email',lower(u.email)='eabeso63122@liceo.edu.ph',
              'factors',(select count(*) from auth.mfa_factors f where f.user_id=u.id),
              'binding',(select encode(sha256(convert_to(jsonb_build_object('user_id',u.id,'identity_id',i.id,
                'provider',i.provider,'provider_id',i.provider_id,'subject',i.identity_data->>'sub',
                'email',lower(u.email),'identity_email',lower(i.identity_data->>'email'),
                'email_verified',i.identity_data->>'email_verified')::text,'UTF8')),'hex')
                from auth.identities i where i.user_id=u.id and i.provider='google'),
              'unapplied',to_regclass('queue_private.staff_access_approvals') is null)
              from auth.users u join queue_private.accounts a on a.id=u.id
              where u.id='b7d9aee8-c54d-455f-9913-a4c4dea0d097'""")
        g.need(target == {'id':'b7d9aee8-c54d-455f-9913-a4c4dea0d097', 'account':'b7d9aee8-c54d-455f-9913-a4c4dea0d097',
            'role':'STUDENT','enabled':True,'email':True,'factors':0,
            'binding':'7b236769634b0910b034c035cc1422021f2281be9d6fd77d5c882ffd9ed86bbd','unapplied':True}, 'AMF_SCHOOL_BINDING')
        print(json.dumps({'result': 'PASS', 'capture': now} if not baseline else {'result': 'PASS'}))
        return 0
    except Exception:
        print('AMF_READ_ONLY_GUARD_REJECTED', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
