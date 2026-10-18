"""Offline internal-restore fences. No Docker, PostgreSQL, credentials or backups read."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock

import restore_local_backup_internal as restore


class InternalRestoreTests(unittest.TestCase):
    def destination(self):
        entry={'container':'sq-restore-internal-a1234567','volume':'sq-restore-internal-a1234567-data','image_id':'sha256:expected'}
        dest=restore.Destination(entry,Path('not-used'))
        container={'Name':'/'+entry['container'],'State':{'Running':True},'Config':{'Image':restore.IMAGE,'Labels':{'school-queue.restore-id':entry['container']}},
          'Image':entry['image_id'],'HostConfig':{'NetworkMode':'none','PortBindings':{},'Privileged':False,'Binds':None},
          'NetworkSettings':{'Networks':{'none':{}},'Ports':{},'SandboxID':'isolated'},
          'Mounts':[{'Type':'volume','Name':entry['volume'],'Destination':'/var/lib/postgresql/data'}]}
        return dest,container

    def call_result(self,container):
        import json
        return Mock(stdout=json.dumps([container]))

    def test_only_new_disposable_volume_and_network_are_allowed(self):
        dest,container=self.destination()
        with patch.object(restore.backup,'call',return_value=self.call_result(container)):
            self.assertEqual(dest.guard(),container)
        for change in [lambda c:c['Mounts'][0].update(Name='supabase_db_school-queue-local'),
                       lambda c:c['HostConfig'].update(NetworkMode='bridge'),
                       lambda c:c['HostConfig'].update(PortBindings={'5432/tcp':[{'HostPort':'54322'}]}),
                       lambda c:c['HostConfig'].update(Privileged=True),
                       lambda c:c['HostConfig'].update(Binds=['/var/run/docker.sock:/var/run/docker.sock']),
                       lambda c:c['Config']['Labels'].clear(),
                       lambda c:c.update(Image='sha256:wrong')]:
            dest,container=self.destination();change(container)
            with patch.object(restore.backup,'call',return_value=self.call_result(container)):
                with self.assertRaises(RuntimeError): dest.guard()

    def test_retained_container_name_is_never_accepted(self):
        dest,_=self.destination();dest.entry['container']='supabase_db_school-queue-local'
        with self.assertRaises(RuntimeError): dest.guard()

    def test_unix_socket_command_discards_libpq_connection_overrides(self):
        dest,_=self.destination()
        with patch.object(dest,'guard'),patch.object(restore.subprocess,'run',return_value=Mock(returncode=0,stderr='',stdout='{}')) as run:
            dest.psql('postgres',sql='select 1',readonly=True)
        command=run.call_args.args[0]
        self.assertIn('PGHOST=/tmp',command)
        self.assertIn('PGHOSTADDR',command)
        self.assertIn('PGSERVICE',command)
        self.assertIn('PGPASSFILE='+restore.NO_PASSWORD_FILE,command)
        self.assertNotIn('PGPASSFILE=/dev/null',command)
        self.assertIn('begin read only;',command[-1])
        self.assertNotIn('127.0.0.1',str(command))
        self.assertNotIn('54322',str(command))

    def test_unknown_database_and_sql_path_fail_before_execution(self):
        dest,_=self.destination()
        with self.assertRaises(RuntimeError): dest.psql('unreviewed',sql='select 1')
        with self.assertRaises(RuntimeError): dest.psql('postgres',file='/tmp/unreviewed.sql')
        with self.assertRaises(RuntimeError): dest.psql('postgres',file=restore.ARTIFACTS+'/../escape.sql')

    def test_sqlstate_is_preserved_without_printing_raw_sql(self):
        dest,_=self.destination()
        with tempfile.TemporaryDirectory() as directory:
            dest.diagnostics=Path(directory)
            result=Mock(returncode=3,stderr='ERROR: 42501: private diagnostic canary',stdout='')
            with patch.object(dest,'guard'),patch.object(restore.subprocess,'run',return_value=result):
                with self.assertRaisesRegex(RuntimeError,'SQLSTATE 42501') as error: dest.execute(['psql'])
            self.assertNotIn('canary',str(error.exception))
            self.assertEqual(len(list(Path(directory).glob('diagnostic_*.txt'))),1)

    def test_existing_role_creation_only_is_omitted(self):
        sql='CREATE ROLE supabase_admin;\nALTER ROLE supabase_admin SUPERUSER;\nCREATE ROLE student;\nGRANT student TO supabase_admin;\n'
        actual=restore.prepare_roles(sql,['supabase_admin'])
        self.assertNotIn('CREATE ROLE supabase_admin;',actual)
        self.assertIn('ALTER ROLE supabase_admin SUPERUSER;',actual)
        self.assertIn('CREATE ROLE student;',actual)
        self.assertIn('GRANT student TO supabase_admin;',actual)

    def test_password_clauses_are_not_imported(self):
        with self.assertRaises(RuntimeError): restore.prepare_roles("ALTER ROLE example PASSWORD 'private';",[])

    def test_internal_server_never_listens_on_tcp(self):
        script=restore.init_script()
        self.assertNotIn('listen_addresses=*',script)
        self.assertIn("listen_addresses=''",script)
        self.assertIn('test ! -e "$PGDATA/PG_VERSION"',script)

    def test_acl_inspection_uses_native_reads_and_fatal_errors(self):
        import json
        sid='S-1-5-21-123'
        acl=[{'protected':True,'reparse':False,'rules':[{'sid':sid,'type':'Allow'}]}]
        acl += [{'protected':False,'reparse':False,'rules':[{'sid':sid,'type':'Allow'}]} for _ in range(3)]
        def fake(command,**kwargs):
            if command[0]=='whoami': return Mock(stdout=sid)
            if command[0]=='powershell':
                self.assertIn("$ErrorActionPreference='Stop'",command[-1])
                self.assertIn('[IO.Directory]::GetAccessControl',command[-1])
                self.assertNotIn('Get-Acl',command[-1])
                return Mock(stdout=json.dumps(acl))
            return Mock(stdout='')
        with patch.object(restore.backup,'call',side_effect=fake):
            self.assertTrue(restore.verify_acl()['directory_inheritance_removed'])

    def test_only_exact_reviewed_client_warning_can_resume(self):
        warning='WARNING: password file "/dev/null" is not a plain file\n'
        self.assertTrue(restore.expected_devnull_warning([warning,warning]))
        for logs in [[],['ERROR: 42501: denied'],[warning,'WARNING: something else'],[warning+'ERROR: 42501: denied']]:
            self.assertFalse(restore.expected_devnull_warning(logs))


if __name__=='__main__': unittest.main(verbosity=2)
