"""Offline structural checks only. Does not parse or execute PostgreSQL SQL."""
from pathlib import Path
import ast
import re
import tomllib
import unittest

ROOT = Path(__file__).resolve().parents[1]


class MigrationStructure(unittest.TestCase):
    def setUp(self):
        self.files = sorted((ROOT / 'migrations').glob('*.sql'))
        self.sql = '\n'.join(p.read_text(encoding='utf-8') for p in self.files)

    def test_order_and_transactions(self):
        self.assertEqual([p.name for p in self.files], [
            '20261016000100_queue_tables.sql',
            '20261016000200_queue_operations.sql',
            '20261016000300_queue_administration.sql',
            '20261016000400_queue_seed_security.sql',
            '20261016000500_queue_read_context.sql',
            '20261016000600_fixed_counter_routing.sql',
        ])
        for path in self.files:
            text = re.sub(r'--[^\n]*', '', path.read_text(encoding='utf-8')).strip()
            self.assertTrue(text.startswith('begin;'), path.name)
            self.assertTrue(text.endswith('commit;'), path.name)
            self.assertEqual(text.count('$$') % 2, 0, path.name)

    def test_api_grants_cover_defined_names(self):
        definitions = set(re.findall(r'create function queue_api\.(\w+)\(', self.sql))
        security = '\n'.join(re.findall(r'grant execute on function .*? to authenticated;', self.sql, re.S))
        granted = set(re.findall(r'queue_api\.(\w+)\(', security))
        self.assertEqual(definitions, granted)
        self.assertIn('from public,anon,authenticated,service_role', self.sql)

    def test_schema_exposure(self):
        config = tomllib.loads((ROOT / 'config.toml').read_text(encoding='utf-8'))
        self.assertNotIn('queue_private', config['api']['schemas'])
        self.assertTrue({'queue_api', 'queue_display'} <= set(config['api']['schemas']))

    def test_definers_search_path(self):
        for match in re.finditer(r'create (?:or replace )?function .*?\$\$', self.sql, re.S):
            header = match.group()
            if 'security definer' in header:
                self.assertIn("set search_path = ''", header)

    def test_no_destructive_ddl(self):
        self.assertNotRegex(self.sql.lower(), r'\b(drop|truncate)\s+(table|schema|database)\b')
        self.assertIn('create unique index one_active_ticket', self.sql)
        self.assertIn('create unique index one_called_per_counter', self.sql)

    def test_python_syntax(self):
        ast.parse((ROOT / 'tests' / 'concurrency.py').read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main()
