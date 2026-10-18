"""Offline attacks against actual immutable snapshots; performs no SQL."""
from copy import deepcopy
import json
import unittest
import realtime_preservation as fence

class RealtimePreservationTests(unittest.TestCase):
    def setUp(self):
        self.old=fence.baseline()
        self.current=deepcopy(self.old)
        observed=json.loads((fence.ROOT/'supabase/tests/results/realtime_preservation_inspection.json').read_text())
        for section,changes in observed['schema_differences'].items():
            self.current['schema'][section].update(changes['added'])
        self.current['rows'].update(observed['new_tables'])
        table=deepcopy(next(t for t in self.old['catalog'] if t['table']=='messages_2026_10_19'))
        table['table']='messages_2026_10_20'
        table['bound']="FOR VALUES FROM ('2026-10-20 00:00:00') TO ('2026-10-21 00:00:00')"
        self.current['catalog'].append(table)
        self.current['clock']='2026-10-17T01:00:00+00:00'
        self.current['platform']={'image':fence.IMAGE,'image_id':fence.IMAGE_ID,'release':'16.4.0.4 2.143.4',
            'subscriptions':{'invalid_rows':0,'count':self.current['rows'][fence.SUBSCRIPTION]['count'],'max_id':0},
            'leaves':{}}
        for t in self.current['catalog']:
            if t['schema']=='realtime' and t['is_partition']:
                name=t['table']
                self.current['platform']['leaves'][name]={'browser_access_denied':True,'column_acl_absent':True,
                    'index_parents':{name+'_pkey':'realtime.messages_pkey',name+'_inserted_at_topic_idx':'realtime.messages_inserted_at_topic_index'}}
        self.current['sequences'][fence.REALTIME_SEQUENCE]['last_value']+=5
    def reject(self,part):
        with self.assertRaises(fence.PreservationError) as caught: fence.classify(self.old,self.current)
        self.assertTrue(any(part in issue for issue in caught.exception.evidence['unexpected_changes']))
        return caught.exception.evidence
    def test_actual_empty_platform_addition(self):
        result=fence.classify(self.old,self.current)
        self.assertEqual(result['empty_partition_additions'],['"realtime"."messages_2026_10_20"'])
        self.assertEqual(self.old,fence.baseline())
    def test_wrong_partition_owner(self):
        self.current['schema']['relations']['realtime.messages_2026_10_20']['owner']='postgres'; self.reject('relations')
    def test_wrong_partition_bound(self):
        self.current['schema']['partitions']['realtime.messages_2026_10_20']['bound']='DEFAULT'; self.reject('partitions')
    def test_wrong_partition_parent(self):
        self.current['catalog'][-1]['parents'][0]['schema']='queue_private'; self.reject('catalog')
    def test_far_future_partition(self):
        self.current['catalog'][-1]['table']='messages_2030_01_01'; self.reject('unreviewed')
    def test_unknown_object_visible(self):
        self.current['schema']['functions']['realtime.unreviewed()']={'definition':'canary'}
        evidence=self.reject('unreviewed()'); self.assertNotIn('canary',json.dumps(evidence))
    def test_unexpected_leaf_grant(self):
        self.current['schema']['relations']['realtime.messages_2026_10_20']['acl'].append({'grantee':'anon','privilege':'SELECT'})
        self.reject('acl')
    def test_leaf_rls_change(self):
        self.current['schema']['relations']['realtime.messages_2026_10_20']['rls']=True; self.reject('rls')
    def test_wrong_publication(self):
        self.current['schema']['publication']['supabase_realtime:realtime.messages_2026_10_20']={}; self.reject('publication')
    def test_private_exposure(self):
        self.current['state']['publication'].append('queue_private.tickets'); self.reject('publication')
    def test_auth_and_application_data(self):
        for key in ['"auth"."users"','"queue_private"."tickets"','"queue_display"."counter_state"']:
            with self.subTest(key=key):
                saved=deepcopy(self.current['rows'][key]); self.current['rows'][key]['rows'].append('PRIVATE-ROW-CANARY')
                self.reject(key); self.current['rows'][key]=saved
    def test_migration_history(self):
        self.current['rows']['"supabase_migrations"."schema_migrations"']['count']+=1; self.reject('schema_migrations')
    def test_routing(self):
        self.current['state']['routes']['1']=['SOA']; self.reject('routes')
    def test_subscriptions_do_not_mask_business_change(self):
        self.current['rows'][fence.SUBSCRIPTION]={'count':1,'rows':['volatile']}
        self.current['platform']['subscriptions']['count']=1
        self.current['rows']['"queue_private"."operation_requests"']['count']+=1; self.reject('operation_requests')
    def test_private_or_authenticated_subscription(self):
        self.current['platform']['subscriptions']['invalid_rows']=1; self.reject('subscription_scope')
    def test_missing_live_scope_evidence(self):
        del self.current['platform']; self.reject('platform')
    def test_sequence_regression(self):
        self.current['sequences'][fence.REALTIME_SEQUENCE]['last_value']=0; self.reject('allocation_regression')
    def test_other_sequence(self):
        self.current['sequences']['"auth"."refresh_tokens_id_seq"']['last_value']+=1; self.reject('refresh_tokens')
    def test_nonempty_new_leaf(self):
        self.current['rows']['"realtime"."messages_2026_10_20"']={'count':1,'rows':['message']}; self.reject('messages_2026_10_20')
    def test_existing_partition_deletion(self):
        del self.current['rows']['"realtime"."messages_2026_10_14"']; self.reject('missing')
    def test_index_ancestry(self):
        self.current['platform']['leaves']['messages_2026_10_20']['index_parents']={}; self.reject('ancestry')
    def test_column_and_constraint_changes(self):
        self.current['schema']['columns']['realtime.messages_2026_10_20:private']['default']='true'; self.reject('columns')
        self.current['schema']['constraints']['realtime.messages_2026_10_20:messages_payload_exclusive']['validated']=False
        self.reject('constraints')
    def test_role_and_migration_function_preservation(self):
        self.current['roles']['roles']['anon']['super']=True; self.reject('roles')
        self.current['schema']['functions']['queue_private.unreviewed()']={}; self.reject('functions')
    def test_known_leaf_removal_after_initial_capture(self):
        initial=deepcopy(self.current)
        self.current['catalog']=[t for t in self.current['catalog'] if t['table']!='messages_2026_10_20']
        with self.assertRaises(fence.PreservationError): fence.classify(initial,self.current)

if __name__=='__main__': unittest.main()
