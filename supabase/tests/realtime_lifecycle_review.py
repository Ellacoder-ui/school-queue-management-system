"""Pure Step 22.8F design model. Never permits deletion or changes a classifier.

Exact template matching can identify a retention candidate, not prove its actual
deletion was safe. No live adapter, certificate issuer or mutation channel exists.
"""
from datetime import date, datetime, timedelta, timezone
import re

PIN = ('public.ecr.aws/supabase/realtime:v2.143.4',
       'sha256:35e99d3f1cbba5aa5585e8ac3cf70ecc54909ee4aee0626effed93c60fb41439',
       '16.4.0.4 2.143.4')


def pruning_review(archived_leaf, reviewed_template, observed_at, platform):
    result = {'production_preservation_pass': False, 'deletion_authorized': False,
              'historical_empty_snapshot_is_deletion_time_proof': False}
    if platform != PIN or archived_leaf != reviewed_template:
        return {**result, 'decision': 'REJECT_IDENTITY_OR_EXACT_TEMPLATE'}
    leaf = archived_leaf
    match = re.fullmatch(r'messages_(\d{4}_\d{2}_\d{2})', leaf.get('name', ''))
    try:
        day = datetime.strptime(match[1], '%Y_%m_%d').date() if match else None
        now = datetime.fromisoformat(observed_at)
        if now.tzinfo is None:
            raise ValueError('Unbound clock')
        cutoff = (now.astimezone(timezone.utc) - timedelta(hours=72)).date()
    except (ValueError, TypeError):
        return {**result, 'decision': 'REJECT_NAME_OR_CLOCK'}
    if (day is None or leaf.get('schema') != 'realtime' or leaf.get('parent') != 'realtime.messages'
            or leaf.get('owner') != 'supabase_realtime_admin'
            or leaf.get('start') != day.isoformat()
            or leaf.get('end') != (day + timedelta(days=1)).isoformat()):
        return {**result, 'decision': 'REJECT_ANCESTRY_BOUND_OR_OWNER'}
    if type(leaf.get('count')) is not int or leaf['count'] != 0 or leaf.get('row_hashes') != []:
        return {**result, 'decision': 'REJECT_RETAINED_ROWS_OR_MISSING_EVIDENCE'}
    if day >= cutoff:
        return {**result, 'decision': 'REJECT_WITHIN_RETENTION_WINDOW'}
    return {**result, 'decision': 'RETENTION_CANDIDATE_ONLY_SAFETY_UNPROVEN',
            'requires_separate_review': ['independently verified deletion actor and transaction',
                'empty check and DROP protected against intervening writes in the same transaction',
                'complete archived and pre-drop catalog/security binding',
                'all unrelated rows and metadata exact']}


def historical_review(manifest, archive_sha256, expected_sha256):
    """Archive-only review; deliberately has no live inventory argument."""
    if (not re.fullmatch(r'[0-9a-f]{64}', expected_sha256)
            or archive_sha256 != expected_sha256 or manifest.get('source_database') != 'postgres'
            or not manifest.get('captured', {}).get('catalog')):
        raise ValueError('RLR_HISTORICAL_BINDING')
    return {'historical_tables': len(manifest['captured']['catalog']),
            'eligible_for_separately_authorized_isolated_verification': True,
            'recoverability_verified': False, 'current_inventory_recovery_prerequisite_satisfied': False}
