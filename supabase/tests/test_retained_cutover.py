"""Offline tests for strict retained cutover comparison; never contact a database."""
from copy import deepcopy
import unittest

import apply_retained_migration_006 as cutover


def fixtures():
    before = {key:{} for key in ('functions','constraints','indexes','triggers','schemas','policies','publication')}
    before['functions'][cutover.CONFIGURE] = {'owner':'postgres','acl':[], 'definition':'old'}
    before['functions']['queue_api.issue_ticket(p_service text, p_request_key uuid)'] = {'definition':'unchanged'}
    before['constraints']['queue_private.tickets:tickets_pkey'] = dict(definition='PRIMARY KEY (id)',validated=True,deferrable=False,deferred=False)
    after = deepcopy(before)
    after['functions'][cutover.CONFIGURE]['definition'] = 'new'
    details = {'functions':{},'triggers':{},'constraints':{}}
    for key,(language,definer,volatility,result) in cutover.NEW_FUNCTIONS.items():
        after['functions'][key] = {'owner':'postgres','acl':[dict(grantor='postgres',grantee='postgres',privilege='EXECUTE',grantable=False)],'definition':'new'}
        details['functions'][key] = dict(language=language,definer=definer,volatility=volatility,result=result,config=['search_path=""'])
    for key,definition in cutover.NEW_CONSTRAINTS.items():
        after['constraints'][key] = dict(definition=definition,validated=True,deferrable=False,deferred=False)
        details['constraints'][key] = cutover.expected_constraint(key)
    for key,definition in cutover.NEW_CONSTRAINT_TRIGGERS.items():
        after['constraints'][key] = dict(definition=definition,validated=True,deferrable=True,deferred=True)
        details['constraints'][key] = cutover.expected_constraint(key)
    for key,definition in cutover.NEW_INDEXES.items():
        after['indexes'][key] = dict(definition=definition,valid=True,ready=True)
    for key,(function,trigger_type,deferred) in cutover.NEW_TRIGGERS.items():
        after['triggers'][key] = {'enabled':'O','definition':cutover.expected_trigger_definition(key)}
        details['triggers'][key] = cutover.expected_trigger(key)
    return before,after,details


class RetainedCutover(unittest.TestCase):
    def test_exact_reviewed_schema_changes(self):
        cutover.compare_schema(*fixtures())

    def test_existing_function_and_privileges_cannot_change(self):
        for key in ('definition','acl'):
            before,after,details = fixtures()
            if key == 'acl': after['functions'][cutover.CONFIGURE][key] = ['unexpected']
            else: after['functions']['queue_api.issue_ticket(p_service text, p_request_key uuid)'][key] = 'bad'
            with self.assertRaises(RuntimeError): cutover.compare_schema(before,after,details)

    def test_no_additional_or_missing_objects(self):
        for section in ('functions','constraints','indexes','triggers'):
            before,after,details = fixtures()
            after[section]['unrelated'] = {}
            with self.assertRaises(RuntimeError): cutover.compare_schema(before,after,details)
            before,after,details = fixtures()
            after[section].pop(next(iter(after[section])))
            with self.assertRaises(RuntimeError): cutover.compare_schema(before,after,details)

    def test_private_function_and_trigger_controls(self):
        before,after,details = fixtures()
        after['functions']['queue_private.assert_fixed_routing()']['acl'].append(dict(grantee='authenticated'))
        with self.assertRaises(RuntimeError): cutover.compare_schema(before,after,details)
        before,after,details = fixtures()
        details['triggers']['queue_private.counters:fixed_counters_complete']['deferred'] = False
        with self.assertRaises(RuntimeError): cutover.compare_schema(before,after,details)

    def test_append_only_preserves_multiplicity(self):
        original = dict(count=2,rows=['a','a'])
        cutover.compare_append_only(original,dict(count=3,rows=['b','a','a']),'b','test')
        for rows in (['a','b','b'],['a','a'],['a','a','b','c']):
            with self.assertRaises(RuntimeError):
                cutover.compare_append_only(original,dict(count=len(rows),rows=rows),'b','test')

    def test_exact_durable_snapshot_ignores_only_clock(self):
        cutover.exact_snapshot(dict(clock='one',rows=['x']),dict(clock='two',rows=['x']),'test')
        with self.assertRaises(RuntimeError):
            cutover.exact_snapshot(dict(clock='one',rows=['x']),dict(clock='two',rows=['y']),'test')

    def test_sqlstate_is_retained_without_diagnostics(self):
        self.assertEqual(cutover.sqlstates('ERROR: 23514: detail\n(SQLSTATE 55000)\nERROR: 23514:'), ['23514','55000'])

    def test_unrelated_schema_changes_rejected(self):
        before,after,details = fixtures()
        after['schemas']['queue_private'] = {'acl':'bad'}
        with self.assertRaises(RuntimeError): cutover.compare_schema(before,after,details)

    def test_two_exact_unique_constraints_expected(self):
        before,after,details = fixtures()
        expected = {
            'queue_private.counter_services:counter_services_one_service':'UNIQUE (counter_id)',
            'queue_private.counter_services:counter_services_one_counter':'UNIQUE (service_id)',
        }
        self.assertEqual(cutover.NEW_CONSTRAINTS,expected)
        for key,definition in expected.items():
            self.assertEqual(details['constraints'][key]['type'],'u')
            self.assertEqual(after['constraints'][key],dict(definition=definition,validated=True,deferrable=False,deferred=False))
        cutover.compare_schema(before,after,details)

    def test_three_exact_constraint_trigger_records_expected(self):
        before,after,details = fixtures()
        expected = {
            'queue_private.counter_services:fixed_routing_complete',
            'queue_private.counters:fixed_counters_complete',
            'queue_private.services:fixed_services_complete',
        }
        self.assertEqual(set(cutover.NEW_CONSTRAINT_TRIGGERS),expected)
        for key in expected:
            self.assertEqual(details['constraints'][key]['type'],'t')
            self.assertEqual(after['constraints'][key],dict(definition='TRIGGER DEFERRABLE INITIALLY DEFERRED',validated=True,deferrable=True,deferred=True))
            self.assertEqual(details['triggers'][key]['constraint'],key)
        cutover.compare_schema(before,after,details)

    def test_constraint_identity_and_type_are_required(self):
        key = 'queue_private.counters:fixed_counters_complete'
        for field,value in [('schema','public'),('relation','services'),('name','renamed'),('type','u')]:
            with self.subTest(field=field):
                before,after,details = fixtures()
                details['constraints'][key][field] = value
                with self.assertRaises(RuntimeError): cutover.compare_schema(before,after,details)
        before,after,details = fixtures()
        value = after['constraints'].pop(key)
        after['constraints']['queue_private.services:fixed_counters_complete'] = value
        with self.assertRaises(RuntimeError): cutover.compare_schema(before,after,details)

    def test_constraint_deferrability_and_validation_required(self):
        for key in cutover.NEW_CONSTRAINT_TRIGGERS:
            for field in ('deferrable','deferred','validated'):
                for location in ('section','details'):
                    with self.subTest(key=key,field=field,location=location):
                        before,after,details = fixtures()
                        (after if location=='section' else details)['constraints'][key][field] = False
                        with self.assertRaises(RuntimeError): cutover.compare_schema(before,after,details)

    def test_each_missing_constraint_rejected(self):
        for key in set(cutover.NEW_CONSTRAINTS)|set(cutover.NEW_CONSTRAINT_TRIGGERS):
            with self.subTest(key=key):
                before,after,details = fixtures()
                after['constraints'].pop(key)
                with self.assertRaises(RuntimeError): cutover.compare_schema(before,after,details)
                before,after,details = fixtures()
                details['constraints'].pop(key)
                with self.assertRaises(RuntimeError): cutover.compare_schema(before,after,details)

    def test_unexpected_extra_constraint_rejected(self):
        before,after,details = fixtures()
        key = 'queue_private.counters:unexpected'
        after['constraints'][key] = dict(definition='TRIGGER DEFERRABLE INITIALLY DEFERRED',validated=True,deferrable=True,deferred=True)
        details['constraints'][key] = dict(schema='queue_private',relation='counters',name='unexpected',type='t')
        with self.assertRaises(RuntimeError): cutover.compare_schema(before,after,details)

    def test_constraint_definition_alterations_rejected(self):
        for key in set(cutover.NEW_CONSTRAINTS)|set(cutover.NEW_CONSTRAINT_TRIGGERS):
            before,after,details = fixtures()
            after['constraints'][key]['definition'] = 'CHECK (true)'
            details['constraints'][key]['definition'] = 'CHECK (true)'
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                cutover.compare_schema(before,after,details)

    def test_disabled_or_mismatched_trigger_rejected(self):
        key = 'queue_private.counter_services:fixed_routing_complete'
        for value in ('D','R','A'):
            before,after,details = fixtures()
            after['triggers'][key]['enabled'] = value
            with self.subTest(enabled=value), self.assertRaises(RuntimeError): cutover.compare_schema(before,after,details)
        for field,value in [('function','queue_private.refresh_display'),('type',25),('constraint','queue_private.counters:fixed_counters_complete')]:
            before,after,details = fixtures()
            details['triggers'][key][field] = value
            with self.subTest(field=field), self.assertRaises(RuntimeError): cutover.compare_schema(before,after,details)
        before,after,details = fixtures()
        after['triggers'][key]['definition'] += ' WHEN (true)'
        with self.assertRaises(RuntimeError): cutover.compare_schema(before,after,details)

    def test_preexisting_constraints_preserved(self):
        key = 'queue_private.tickets:tickets_pkey'
        before,after,details = fixtures()
        after['constraints'][key]['definition'] = 'PRIMARY KEY (owner_id)'
        with self.assertRaises(RuntimeError): cutover.compare_schema(before,after,details)

    def test_verification_cli_rejects_all_migration_and_restore_tasks(self):
        import validate_retained_migration_006 as verification
        for task in ('apply','migration','migration up','reset','db push','link','restore','bootstrap','concurrency'):
            with self.subTest(task=task), self.assertRaises(RuntimeError):
                verification.safe_cli_arguments(task)
        self.assertEqual(verification.safe_cli_arguments('lint'),['db','lint','--local'])

    def test_verification_rejects_nonrollback_or_nontransactional_test_files(self):
        import validate_retained_migration_006 as verification
        verification.rollback_test_text('-- reviewed\nbegin;\nselect 1;\nrollback;')
        for text in ('select 1;', 'begin;\ncommit;', 'begin;\ncommit;\nbegin;\nrollback;',
                     "begin;\nselect nextval('seq');\nrollback;", 'begin;\nrollback;\nselect 1;'):
            with self.subTest(text=text), self.assertRaises(RuntimeError):
                verification.rollback_test_text(text)


if __name__ == '__main__':
    unittest.main()
