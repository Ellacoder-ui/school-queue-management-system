"""Read-only reconciliation after the owner also enrolled a replacement.

Never sends Auth mutations. Recover the deleted factor's UUID from server audit
metadata only if its canonical preimage matches the explicitly approved hash.
Full factor UUIDs remain private; reports contain suffixes and booleans only.
"""
import json
import sys
import uuid
from datetime import datetime, timezone

import observeApprovedMfaCleanup as observer

ROOT=observer.ROOT
TARGET=observer.TARGET
db=observer.db
need=observer.need
digest=observer.digest
PHASE='initial'


def main():
    global PHASE
    PHASE='reviewed-code'
    observer.code_fence()
    _,env,_=db.target()
    with db.Snapshot(env) as s:
        PHASE='audit-bound-id'
        # Reconstruct the reviewed canonical object using audit IDs and the exact
        # approved timestamps. Email text/suffix never determines the selected ID.
        matched=s.query(f"""with candidates as (
          select distinct (payload::jsonb->'traits'->>'factor_id')::uuid as id
          from auth.audit_log_entries where payload::jsonb->>'actor_id'='{TARGET}'
          and payload::jsonb->'traits'->>'factor_id' ~* '^[0-9a-f]{{8}}-[0-9a-f]{{4}}-[0-9a-f]{{4}}-[0-9a-f]{{4}}-[0-9a-f]{{12}}$'),
          bound as (select id from candidates where encode(sha256(convert_to(jsonb_build_object(
            'user_id','{TARGET}'::uuid,'factor_id',id,'type','totp','status','unverified',
            'created_at','2026-10-19T12:28:07.613277+00:00'::timestamptz,
            'updated_at','2026-10-19T12:28:07.613277+00:00'::timestamptz)::text,'UTF8')),'hex')='{observer.FACTOR_BINDING}')
          select jsonb_build_object('count',count(*),'ids',jsonb_agg(id)) from bound""")
        need(matched['count']==1 and len(matched['ids'])==1,'EXACT_REVIEWED_ID_RECOVERY')
        factor_id=str(uuid.UUID(matched['ids'][0]))
        need(factor_id.endswith('c1fc9a6f'),'APPROVED_BINDING_SUFFIX')
    PHASE='current-read-only-snapshot'
    current=observer.snapshot(factor_id)
    with db.Snapshot(env) as s:
        PHASE='new-factor-and-audit'
        inventory=s.query(f"""select jsonb_build_object('globalCount',(select count(*) from auth.mfa_factors),
          'targetCount',count(*),'verifiedTotp',count(*) filter(where factor_type='totp' and status='verified'),
          'inventory',coalesce(jsonb_agg(jsonb_build_object('suffix',right(id::text,8),'type',factor_type,'status',status,
            'ownerMatches',user_id='{TARGET}'::uuid,'isReviewedOldId',id='{factor_id}'::uuid,
            'createdAfterPreaction',created_at>'2026-10-19T20:32:14.004150+00:00'::timestamptz,
            'bindingSha256',{observer.factor_expression()} ) order by id),'[]'),
          'aal2SessionsWithVerifiedFactor',(select count(*) from auth.sessions z join auth.mfa_factors f on f.id=z.factor_id and f.user_id=z.user_id where z.user_id='{TARGET}' and z.aal='aal2' and f.factor_type='totp' and f.status='verified'))
          from auth.mfa_factors f where user_id='{TARGET}'""")
        old_audit=s.query(f"""select jsonb_build_object('count',count(*),'categories',jsonb_agg(payload::jsonb->>'action'),
          'allBoundToOwner',bool_and(payload::jsonb->>'actor_id'='{TARGET}'),
          'allUnverified',bool_and(payload::jsonb->'traits'->>'factor_status'='unverified'),
          'afterPreaction',bool_and(created_at>'2026-10-19T20:32:14.004150+00:00'::timestamptz))
          from auth.audit_log_entries where payload::jsonb->'traits'->>'factor_id'='{factor_id}'
          and payload::jsonb->>'action' ilike '%unenroll%'""")
        audit_delta=s.query("""select jsonb_build_object('count',count(*),
          'unenrollCount',count(*) filter(where payload::jsonb->>'action' ilike '%unenroll%'),
          'categories',coalesce(jsonb_agg(distinct payload::jsonb->>'action'),'[]'),
          'allBoundToOwner',coalesce(bool_and(payload::jsonb->>'actor_id'='5c96debb-697f-4cad-805f-92b518e28343'),true))
          from auth.audit_log_entries where created_at>'2026-10-19T20:32:14.004150+00:00'::timestamptz""")
        prior=json.loads((ROOT/'tests/integration/results/unverified_mfa_closeout.json').read_text())
        existing_audit_hash=s.query("""select to_jsonb(md5(coalesce(string_agg(md5(to_jsonb(x)::text),'' order by md5(to_jsonb(x)::text)),''))) from auth.audit_log_entries x where created_at<='2026-10-19T20:19:03.375907+00:00'::timestamptz""")
        school=s.query("""select jsonb_build_object('schoolStudent',(select role='STUDENT' and enabled from queue_private.accounts where id='b7d9aee8-c54d-455f-9913-a4c4dea0d097'),
          'otherReviewedStudent',(select role='STUDENT' and enabled from queue_private.accounts where id='91a77243-319e-470b-a826-4c61bcfe87ae'),
          '007Absent',to_regclass('queue_private.staff_access_approvals') is null,
          '012Absent',to_regprocedure('queue_api.add_verified_staff(uuid,text,text,text,uuid,uuid)') is null)""")
    PHASE='reviewed-id-absence'
    need(not current['factors']['selectedPresent'] and current['factors']['selectedChallenges']==current['factors']['selectedSessions']==0,'OLD_FACTOR_NOT_ABSENT')
    need(old_audit['count']==1 and old_audit['allBoundToOwner'] and old_audit['allUnverified'] and old_audit['afterPreaction'],'UNENROLL_AUDIT')
    need(inventory['targetCount']==inventory['verifiedTotp']==1 and all(x['ownerMatches'] and not x['isReviewedOldId'] and x['createdAfterPreaction'] for x in inventory['inventory']),'NEW_ENROLLMENT_REVIEW')
    need(inventory['aal2SessionsWithVerifiedFactor']>=1,'SERVER_AAL2')
    PHASE='application-preservation'
    app_preserved=all(current['hashes'].get(k)==v for k,v in prior['tableFingerprints'].items() if k.startswith('queue_'))
    migration_preserved=all(current['hashes'][k]==prior['tableFingerprints'][k] for k in ('auth.schema_migrations','supabase_migrations.schema_migrations'))
    security_preserved=current['security']==prior['securitySha256']
    need(app_preserved and migration_preserved and security_preserved and all(school.values()) and audit_delta['allBoundToOwner'],'APP_SECURITY_PRESERVATION')
    # Historical baseline provides independent definition/lifecycle hashes. Its
    # closeout enumerates later owned resources, so only services are compared.
    PHASE='service-preservation'
    old_services=json.loads((ROOT/'.local-browser/admin-live-mfa/baseline.json').read_text())['services']
    now_services=current['service']['services']
    services_preserved=len(old_services)==len(now_services) and all(x['id']==y['id'] and x['definition']==y['definition'] and ('vector' in x['name'] or x==y) for x,y in zip(old_services,now_services))
    need(services_preserved,'RETAINED_SERVICES')
    out={'observedAt':datetime.now(timezone.utc).isoformat(),'result':'REVIEWED_OLD_FACTOR_ABSENCE_VERIFIED_OWNER_REENROLLED',
      'readOnly':True,'observerMutationIssued':False,'approvedFactorBindingSha256':observer.FACTOR_BINDING,
      'oldFactorIdRecoveredPrivatelyFromMatchingAuditBinding':True,'oldFactorSuffix':'c1fc9a6f',
      'oldFactorAbsent':True,'oldFactorChallengesAndSessions':0,'ownerAccount':current['account'],
      'inventory':inventory,'oldFactorUnenrollAudit':old_audit,'newAuthAudit':audit_delta,
      'existingAuditRowsPreserved':existing_audit_hash==prior['tableFingerprints']['auth.audit_log_entries'],
      'applicationTablesPreservedAgainstPreparedCloseout':app_preserved,'migrationsPreserved':migration_preserved,
      'securityAndFunctionsPreserved':security_preserved,'servicesPreservedAgainstHistoricalBaseline':services_preserved,
      'studentAccountsAndUnappliedProposals':school,'health':current['health'],'counts':current['state']['counts'],
      'queueAssignments':current['state']['assignments'],'routes':current['state']['routes'],
      'expectedZeroFactorPostconditionMet':False,'strictObserverResult':'FAIL_STOPPED_AFTER_OWNER_REENROLLMENT',
      'limitation':'Strict observer did not persist its final snapshot after the changed factor/challenge state; no complete immediate before/after hash comparison is claimed for other-factor or unrelated Auth/session rows. Application/security hashes use the prepared closeout; pre-action checks separately passed.',
      'noOtherFactorUnenrollAuditFound':old_audit['count']==audit_delta['unenrollCount']==1,
      'currentAuthFingerprints':{k:v for k,v in current['hashes'].items() if k.startswith('auth.')},
      'plannedCleanupSequenceStopped':True,'furtherEnrollmentOrMutationAttempted':False}
    with (ROOT/'tests/integration/results/approved_mfa_cleanup_42e0cfcf_reconciliation.json').open('x') as output:json.dump(out,output,indent=2)
    print(json.dumps(out))


if __name__=='__main__':
    try:main()
    except Exception:
        print(json.dumps({'result':'FAIL_STOPPED_READ_ONLY_RECONCILIATION','phase':PHASE,'detail':'Private diagnostics suppressed; no Auth mutation attempted.'}));sys.exit(1)
