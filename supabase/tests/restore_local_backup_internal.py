"""Restore the pinned local backup via a fenced container Unix socket; never apply SQL to source.

No host port, Docker socket mount, external network, reset, clean restore or migration command.
All diagnostics containing SQL remain inside the protected backup directory.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid

import retained_migration_006 as backup

DIRECTORY = backup.BACKUPS / '20261016T135430Z_46a582fc'
PINNED = {
    'retained_postgres_before_006.dump': ('7df177a07d74617057d1f518e92588fa19de3452c3f1a64c9e26f84b62ac259e', 521959),
    'source_snapshot_manifest.json': ('df786c0e63034692d8416244e4eab5c887dd9cd06b3747026ac0dc254ed7d67f', 845474),
    'roles_without_passwords.sql': ('882a23b88288987a5fdddcc6082fff2bccf8cfd63023692b8b743f6066b6eee3', 6274),
}
EVIDENCE = backup.ROOT / 'supabase/tests/results/retained_backup_internal_restore.json'
OWNER = 'supabase_admin'
DATABASE = 'queue_restore_verify'
SOCKET = '/tmp'
ARTIFACTS = '/var/lib/postgresql/data/recovery_artifacts'
IMAGE = 'public.ecr.aws/supabase/postgres:17.11.0.004'
NO_PASSWORD_FILE = '/proc/self/queue_restore_no_password_file'


def save(value):
    backup.write_json(EVIDENCE, value)


def pinned_artifacts():
    for name, (digest, size) in PINNED.items():
        path = DIRECTORY / name
        if not path.is_file() or path.stat().st_size != size or backup.file_sha256(path) != digest:
            raise RuntimeError('Pinned backup artifact missing or changed: ' + name)
    info = backup.load()['backup']
    if Path(info['directory']).resolve() != DIRECTORY.resolve():
        raise RuntimeError('Recorded backup directory differs from pinned directory')
    for key, name, hash_key in [('archive', 'retained_postgres_before_006.dump', 'sha256'),
                                ('manifest', 'source_snapshot_manifest.json', 'manifest_sha256'),
                                ('roles_file', 'roles_without_passwords.sql', 'roles_sha256')]:
        if Path(info[key]).resolve() != (DIRECTORY / name).resolve() or info[hash_key] != PINNED[name][0]:
            raise RuntimeError('Recorded artifact association differs from pinned backup')
    return backup.verified_manifest(info)


def verify_acl(extra_paths=(),*,directory=None,base_names=None):
    # Read effective NTFS rules, including inherited file rules; reject reparse points.
    sid = re.search(r'S-1-5-[0-9-]+', backup.call(['whoami', '/user', '/fo', 'csv', '/nh']).stdout).group()
    root = DIRECTORY if directory is None else Path(directory)
    if not root.resolve().is_relative_to(backup.BACKUPS.resolve()) or root.resolve()==backup.BACKUPS.resolve():
        raise RuntimeError('Protected artifacts must be inside a backup run directory')
    names = list(PINNED) if base_names is None else list(base_names)
    if any(not re.fullmatch(r'[a-zA-Z0-9_.-]+',name) for name in names):
        raise RuntimeError('Invalid backup ACL artifact name')
    paths = [root] + [root / name for name in names] + list(extra_paths)
    if any(not path.resolve().is_relative_to(root.resolve()) for path in paths):
        raise RuntimeError('ACL check path outside protected backup directory')
    literal_paths = ','.join(backup.literal(str(path)) for path in paths)
    # Direct .NET Framework reads avoid optional PowerShell.Security autoload failure.
    # No permission criterion is relaxed; failed reads must terminate the subprocess.
    command = "$ErrorActionPreference='Stop'; $taskPaths=@(" + literal_paths + "); @($taskPaths | ForEach-Object { $taskAcl=if([IO.Directory]::Exists($_)){[IO.Directory]::GetAccessControl($_)}else{[IO.File]::GetAccessControl($_)}; [pscustomobject]@{path=$_; protected=$taskAcl.AreAccessRulesProtected; reparse=[bool]([IO.File]::GetAttributes($_) -band [IO.FileAttributes]::ReparsePoint); rules=@($taskAcl.Access | ForEach-Object { [pscustomobject]@{sid=$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; type=$_.AccessControlType.ToString()} })} }) | ConvertTo-Json -Depth 5 -Compress"
    rows = json.loads(backup.call(['powershell', '-NoProfile', '-NonInteractive', '-Command', command], label='Protected backup ACL inspection').stdout)
    if len(rows) != len(paths) or not rows[0]['protected']:
        raise RuntimeError('Protected backup directory inheritance differs')
    for row in rows:
        if row['reparse'] or not row['rules'] or any(rule['type'] == 'Allow' and rule['sid'] not in (sid, 'S-1-5-18') for rule in row['rules']):
            raise RuntimeError('Backup artifact has an unauthorized ACL or reparse point')
    if backup.call(['git', 'ls-files', str(root)]).stdout.strip():
        raise RuntimeError('Backup is tracked by Git')
    backup.call(['git', 'check-ignore', str(root)], label='Backup Git exclusion')
    return {'directory_inheritance_removed': True, 'allowed_principals': 'current user and SYSTEM', 'files_checked': len(paths)-1, 'git_ignored': True}


def source_check(manifest):
    _, env, identity = backup.target()
    record = backup.load()
    if identity['migration_sha256'] != manifest['source']['migration_sha256']:
        raise RuntimeError('Migration file checksums differ from backup source')
    with backup.Snapshot(env) as snapshot:
        rows = backup.all_rows(snapshot.query)
        count = backup.compare_rows(manifest['rows'], rows)
        schema = backup.schema_metadata(snapshot.query)
        roles = backup.role_metadata(snapshot.query)
        sequences = backup.sequence_values(snapshot.query)
        catalog = backup.table_catalog(snapshot.query)
        state = backup.state(env, snapshot.query)
        system_identifier = snapshot.query('select to_jsonb(system_identifier::text) from pg_control_system()')
    if schema != manifest['schema'] or roles != manifest['roles'] or sequences != manifest['sequences'] or catalog != manifest['catalog']:
        raise RuntimeError('Source schema, roles, sequences or partition catalog changed')
    if state != manifest['state'] or state['active'] or len(state['versions']) != 5 or state['routes'] != backup.LEGACY:
        raise RuntimeError('Source queue state/history changed')
    if backup.fingerprint(env) != record['baseline_rows'] or backup.security(env) != record['baseline_security']:
        raise RuntimeError('Historical source application/Auth preservation failed')
    if count != 69:
        raise RuntimeError('Source must contain exactly the 69 pinned logical tables')
    return {'tables': count, 'rows': sum(r['count'] for r in rows.values()), 'schema_sections': sorted(schema),
            'roles': len(roles['roles']), 'memberships': len(roles['memberships']), 'sequences': len(sequences), 'state': state, 'identity': identity,
            'system_identifier': system_identifier}


def inspect_docker():
    old = backup.load()['restore_attempt']
    container = json.loads(backup.call(['docker', 'inspect', old['container']]).stdout)[0]
    network = json.loads(backup.call(['docker', 'network', 'inspect', old['network']]).stdout)[0]
    if container['Name'] != '/sq-restore-006-13f0a34b' or [m['Name'] for m in container['Mounts'] if m['Type'] == 'volume'] != ['sq-restore-006-13f0a34b-data']:
        raise RuntimeError('Previous disposable identity differs from report')
    if container['State']['Running'] or not network['Internal'] or network['Driver'] != 'bridge':
        raise RuntimeError('Previous disposable state/network differs from report')
    version = json.loads(backup.call(['docker', 'version', '--format', '{{json .}}']).stdout)
    info = json.loads(backup.call(['docker', 'info', '--format', '{{json .}}']).stdout)
    return {'client': version['Client']['Version'], 'engine': version['Server']['Version'], 'platform': info['OperatingSystem'],
            'previous_container': old['container'], 'previous_container_stopped': True, 'previous_network_internal': True,
            'requested_bindings': container['HostConfig']['PortBindings'], 'stopped_bindings': container['NetworkSettings']['Ports'],
            'previous_running_evidence': backup.load()['restore_diagnosis']['active_bindings'],
            'solution': 'new network-none container, direct Unix socket; no host publication'}


def revalidate():
    if EVIDENCE.exists():
        previous=json.loads(EVIDENCE.read_text(encoding='utf-8'))
        if previous.get('phase')!='stopped-at-acl-serialization-gate' or previous.get('new_destination_created') or previous.get('archive_restored'):
            raise RuntimeError('Internal restore evidence already exists; do not silently overwrite or retry')
        # Preserve the stopped inspection attempt. Independent native ACL inspection
        # established protection; only the inspection transport changed.
        historical=EVIDENCE.with_name('retained_backup_internal_acl_attempt.json')
        if historical.exists(): raise RuntimeError('Stopped ACL evidence must not be overwritten')
        historical.write_bytes(EVIDENCE.read_bytes())
    manifest = pinned_artifacts()
    acl = verify_acl()
    source = source_check(manifest)
    docker = inspect_docker()
    toc = backup.call([backup.pgtool('pg_restore'), '--list', str(DIRECTORY / 'retained_postgres_before_006.dump')], label='Pinned archive readability').stdout
    completeness = backup.archive_completeness(toc, manifest['catalog'], manifest['rows'], manifest['schema']['extensions'])
    if completeness != backup.load()['backup']['archive_completeness']:
        raise RuntimeError('Archive classification differs from the recorded backup')
    prior = backup.EVIDENCE.with_name('retained_backup_validation_before_internal_restore.json')
    if prior.exists():
        raise RuntimeError('Previous failure evidence must not be overwritten')
    prior.write_bytes(backup.EVIDENCE.read_bytes())
    result = {'phase': 'revalidated', 'result': 'PASS', 'artifact_sha256': {name: item[0] for name,item in PINNED.items()},
              'acl': acl, 'source_before': source, 'docker': docker, 'archive_completeness': completeness, 'migration_006_applied': False}
    save(result)
    print('PASS: three pinned artifact hashes/ACLs, complete archive, all 69 source tables/schema/roles/sequences and five-migration legacy state revalidated.', flush=True)


def init_script():
    return backup.isolated_init_script().replace('listen_addresses=*', "listen_addresses=''").replace('cron.database_name=queue_restore_verify', 'cron.database_name=postgres').replace('pg_net.database_name=queue_restore_verify', 'pg_net.database_name=postgres')


class Destination:
    def __init__(self, entry, diagnostic_directory):
        self.entry = entry
        self.diagnostics = diagnostic_directory

    def guard(self, running=True):
        entry = self.entry
        if not re.fullmatch(r'sq-restore-internal-[0-9a-f]{8}', entry['container']) or entry['volume'] != entry['container']+'-data':
            raise RuntimeError('Only explicitly identified new internal restore destinations are accepted')
        c = json.loads(backup.call(['docker', 'inspect', entry['container']], label='Internal destination identity').stdout)[0]
        if (c['Name'] != '/'+entry['container'] or (running and not c['State']['Running']) or c['Config']['Image'] != IMAGE
            or c['Image'] != entry['image_id'] or c['HostConfig']['NetworkMode'] != 'none'
            or list(c['NetworkSettings']['Networks']) != ['none'] or c['HostConfig']['PortBindings']
            or any(value for value in c['NetworkSettings']['Ports'].values())
            or c['HostConfig']['Privileged'] or c['HostConfig'].get('Binds')
            or len(c['Mounts']) != 1 or c['Mounts'][0]['Type'] != 'volume' or c['Mounts'][0]['Name'] != entry['volume']
            or c['Mounts'][0]['Destination'] != '/var/lib/postgresql/data'
            or c['Config']['Labels'].get('school-queue.restore-id') != entry['container']):
            raise RuntimeError('Internal restore isolation identity mismatch')
        if running and self.entry.get('sandbox_id') and c['NetworkSettings']['SandboxID'] != self.entry['sandbox_id']:
            raise RuntimeError('Internal restore network namespace changed')
        return c

    def execute(self, args, *, timeout=120, label='Internal destination command'):
        self.guard()
        # Discard image/inherited libpq defaults. Only a local Unix socket is accepted.
        command = ['docker','exec','--user','postgres',self.entry['container'],'env','-u','PGPASSWORD','-u','PGOPTIONS',
                   '-u','PGSERVICE','-u','PGSERVICEFILE','-u','PGDATABASE','-u','PGHOSTADDR',
                   'PGHOST='+SOCKET,'PGPORT=5432','PGUSER='+OWNER,'PGPASSFILE='+NO_PASSWORD_FILE,'PGCLIENTENCODING=UTF8'] + args
        result = subprocess.run(command, env=backup.clean_env(), cwd=backup.ROOT, capture_output=True, text=True, encoding='utf-8', timeout=timeout)
        if result.stderr:
            name = 'diagnostic_'+uuid.uuid4().hex[:8]+'.txt'
            (self.diagnostics/name).write_text(result.stderr, encoding='utf-8')
        if result.returncode:
            codes = sorted(set(re.findall(r'(?:ERROR|FATAL):\s+([A-Z0-9]{5})\b', result.stderr)))
            raise RuntimeError(label+' failed (exit '+str(result.returncode)+')'+(' [SQLSTATE '+','.join(codes)+']' if codes else '')+'; protected diagnostics retained')
        return result

    def psql(self, database, *, sql=None, file=None, readonly=False, label='Internal SQL', variables=None):
        if database not in ('postgres',DATABASE) or (sql is None) == (file is None):
            raise RuntimeError('Explicit permitted destination database and SQL/file required')
        args=['psql','-X','-w','-qAt','-h',SOCKET,'-p','5432','-U',OWNER,'-d',database,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
        for name,value in (variables or {}).items():
            if name not in ('recovery_target_identifier','recovery_archive_sha256','recovery_manifest_sha256') or not re.fullmatch(r'[0-9a-f]{1,64}',str(value)):
                raise RuntimeError('Unexpected recovery SQL variable')
            args += ['-v',name+'='+str(value)]
        if file:
            if not file.startswith(ARTIFACTS+'/') or '..' in file: raise RuntimeError('Internal SQL file outside private artifact directory')
            args += ['-f',file]
        else:
            if readonly: sql='begin read only; '+backup.CANONICAL_SETTINGS+sql+'; rollback;'
            args += ['-c',sql]
        return self.execute(args,label=label)

    def query(self, sql, database=DATABASE):
        result=self.psql(database,sql=sql,readonly=True,label='Read-only internal verification')
        return json.loads(result.stdout.strip())

    def identity(self, database='postgres'):
        server=self.query("select jsonb_build_object('database',current_database(),'user',current_user,'version',current_setting('server_version'),'data_directory',current_setting('data_directory'),'listen_addresses',current_setting('listen_addresses'),'client_address',inet_client_addr(),'server_address',inet_server_addr(),'system_identifier',(select system_identifier::text from pg_control_system()))",database)
        expected={'database':database,'user':OWNER,'version':'17.11','data_directory':'/var/lib/postgresql/data',
                  'listen_addresses':'','client_address':None,'server_address':None}
        if any(server.get(k)!=v for k,v in expected.items()): raise RuntimeError('Connected internal PostgreSQL identity differs')
        if self.entry.get('system_identifier') and server['system_identifier']!=self.entry['system_identifier']:
            raise RuntimeError('Internal PostgreSQL cluster identifier changed')
        return server

    def copy(self, source, filename):
        self.guard()
        if not re.fullmatch(r'[a-zA-Z0-9_.-]+',filename): raise RuntimeError('Invalid internal artifact filename')
        target=ARTIFACTS+'/'+filename
        backup.call(['docker','cp',str(source),self.entry['container']+':'+target],label='Protected artifact transfer')
        backup.call(['docker','exec',self.entry['container'],'chown','postgres:postgres',target],label='Private copied artifact owner')
        backup.call(['docker','exec',self.entry['container'],'chmod','600',target],label='Private copied artifact permissions')
        digest=self.execute(['sha256sum',target],label='Transferred artifact checksum').stdout.split()[0]
        if digest!=backup.file_sha256(source): raise RuntimeError('Transferred artifact differs from source')
        return target


def prepare_roles(script,existing):
    if re.search(r'\bPASSWORD\b',script,re.I): raise RuntimeError('Role supplement unexpectedly includes passwords')
    def omit(match):
        name=match.group(1)
        name=name[1:-1].replace('""','"') if name.startswith('"') and name.endswith('"') else name
        return '-- Existing bootstrap role CREATE omitted; all ALTER/GRANT retained.' if name in existing else match.group(0)
    return re.sub(r'^CREATE ROLE (.+);$',omit,script,flags=re.M)


def restore(post_archive_hook=None,database_owner='postgres'):
    record=json.loads(EVIDENCE.read_text(encoding='utf-8'))
    if record['phase']!='revalidated' or record['result']!='PASS': raise RuntimeError('Fresh successful internal revalidation required')
    manifest=pinned_artifacts()
    source_check(manifest)
    suffix=uuid.uuid4().hex[:8];name='sq-restore-internal-'+suffix
    image=json.loads(backup.call(['docker','image','inspect',IMAGE]).stdout)[0]
    entry={'project':name,'container':name,'volume':name+'-data','network_mode':'none','published_ports':[],
           'image':IMAGE,'image_id':image['Id'],'database':DATABASE,'socket':SOCKET,'completed':False}
    record.update(phase='destination-preparation',destination=entry)
    save(record)
    for args in [['docker','ps','-a','--filter','name=^/'+name+'$','--format','{{.Names}}'],
                 ['docker','volume','ls','--filter','name=^'+entry['volume']+'$','--format','{{.Name}}']]:
        if backup.call(args).stdout.strip(): raise RuntimeError('New restore identity already exists')
    diagnostic_directory=DIRECTORY/('internal_restore_'+suffix)
    diagnostic_directory.mkdir(exist_ok=False)
    backup.call(['docker','volume','create','--label','school-queue.restore-id='+name,entry['volume']],label='New isolated recovery volume')
    env=backup.clean_env();env.update(POSTGRES_PASSWORD=uuid.uuid4().hex+uuid.uuid4().hex,POSTGRES_USER=OWNER,POSTGRES_DB='postgres',
                                    RECOVERY_PRELOAD=manifest['prerequisites']['settings']['shared_preload_libraries'])
    backup.call(['docker','create','--name',name,'--label','school-queue.restore-id='+name,'--network','none','--entrypoint','/bin/bash',
                 '--mount','type=volume,source='+entry['volume']+',target=/var/lib/postgresql/data',
                 '--env','POSTGRES_PASSWORD','--env','POSTGRES_USER','--env','POSTGRES_DB','--env','RECOVERY_PRELOAD',
                 IMAGE,'-c',init_script()],env=env,label='New network-disabled recovery container')
    destination=Destination(entry,diagnostic_directory)
    destination.guard(running=False)
    backup.call(['docker','start',name],label='Start only new internal restore container')
    destination.guard()
    deadline=time.monotonic()+60
    while time.monotonic()<deadline:
        ready=subprocess.run(['docker','exec','--user','postgres',name,'pg_isready','-q','-h',SOCKET,'-p','5432','-U',OWNER,'-d','postgres'],env=backup.clean_env(),capture_output=True,timeout=10)
        if ready.returncode==0: break
        time.sleep(1)
    else: raise RuntimeError('Internal PostgreSQL Unix socket did not become ready')
    identity=destination.identity()
    if identity['system_identifier']==record['source_before']['system_identifier']:
        raise RuntimeError('Destination cluster identifier equals the retained source')
    entry['system_identifier']=identity['system_identifier']
    entry['sandbox_id']=destination.guard()['NetworkSettings']['SandboxID']
    initial=destination.query("select jsonb_build_object('roles',(select jsonb_agg(rolname order by rolname) from pg_roles where rolname not like 'pg_%'), 'databases',(select jsonb_agg(datname order by datname) from pg_database),'tables',(select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema')))",'postgres')
    if initial!={'roles':[OWNER],'databases':['postgres','template0','template1'],'tables':0}:
        raise RuntimeError('Internal destination is not the expected fresh empty cluster')
    record.update(phase='destination-verified',destination=entry,internal_server=identity)
    save(record)
    print('PASS: fresh network-none container/volume and Unix-socket PostgreSQL identity; zero application tables, no host ports.',flush=True)
    destination.execute(['mkdir','-m','700',ARTIFACTS],label='Private internal artifact directory')
    archive_path=destination.copy(DIRECTORY/'retained_postgres_before_006.dump','retained_postgres_before_006.dump')
    destination.copy(DIRECTORY/'roles_without_passwords.sql','roles_without_passwords.sql')
    existing=destination.query('select jsonb_agg(rolname order by rolname) from pg_roles','postgres')
    role_path=diagnostic_directory/'roles_prepared.sql'
    role_path.write_text(prepare_roles((DIRECTORY/'roles_without_passwords.sql').read_text(encoding='utf-8'),existing),encoding='utf-8')
    internal_roles=destination.copy(role_path,'roles_prepared.sql')
    destination.identity()
    role_result=destination.psql('postgres',file=internal_roles,label='Internal role prerequisites')
    if role_result.stderr.strip(): raise RuntimeError('Role import emitted diagnostics; review protected log')
    if backup.role_metadata(lambda q:destination.query(q,'postgres'))!=manifest['roles']:
        raise RuntimeError('Imported role/membership privileges differ from snapshot')
    restore_database(destination,manifest,record,diagnostic_directory,post_archive_hook,database_owner)


def expected_devnull_warning(logs):
    return bool(logs) and all(text.strip()=='WARNING: password file "/dev/null" is not a plain file' for text in logs)


def resume_role_warning():
    record=json.loads(EVIDENCE.read_text(encoding='utf-8'))
    if record['phase']!='destination-verified' or record.get('failure')!='Role import emitted diagnostics; review protected log':
        raise RuntimeError('Only the inspected pre-database libpq warning checkpoint is resumable')
    folder=DIRECTORY/('internal_restore_'+record['destination']['container'][-8:])
    logs=[path.read_text(encoding='utf-8') for path in folder.glob('diagnostic_*.txt')]
    if not expected_devnull_warning(logs): raise RuntimeError('Unexpected role diagnostic; cannot resume')
    destination=Destination(record['destination'],folder)
    destination.identity()
    manifest=pinned_artifacts()
    source_check(manifest)
    if destination.query('select jsonb_agg(datname order by datname) from pg_database','postgres')!=['postgres','template0','template1']:
        raise RuntimeError('Unknown destination database; no resume')
    if destination.query("select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema')",'postgres')!=0:
        raise RuntimeError('Destination contains application objects; no resume')
    if backup.role_metadata(lambda q:destination.query(q,'postgres'))!=manifest['roles']:
        raise RuntimeError('Imported role prerequisites differ; no resume')
    historical=EVIDENCE.with_name('retained_backup_internal_role_warning.json')
    if historical.exists(): raise RuntimeError('Role-warning evidence must not be overwritten')
    historical.write_bytes(EVIDENCE.read_bytes())
    record.update(result='PASS',phase='roles-imported',role_import_exit=0,
                  reviewed_client_warning={'message':'libpq rejected /dev/null as a non-regular password file',
                  'count':len(logs),'sql_errors':0,'role_privileges_match':True,'resolution':'explicit nonexistent procfs password-file path; Unix socket authentication'},
                  role_diagnostic_attempt_retained=str(historical))
    record.pop('failure',None)
    save(record)
    restore_database(destination,manifest,record,folder)


def restore_database(destination,manifest,record,diagnostic_directory,post_archive_hook=None,database_owner='postgres'):
    entry=destination.entry;name=entry['container']
    db=manifest['prerequisites']['database']
    if db['provider']!='i': raise RuntimeError('Unexpected source locale provider')
    if database_owner not in manifest['roles']['roles']: raise RuntimeError('Database owner must be a captured source role')
    sql='create database '+DATABASE+' template template0 owner '+backup.quote_identifier(database_owner)+' encoding '+backup.literal(db['encoding'])+' locale_provider=icu icu_locale='+backup.literal(db['locale'])+' lc_collate='+backup.literal(db['collate'])+' lc_ctype='+backup.literal(db['ctype'])+';'
    destination.identity()
    destination.psql('postgres',sql=sql,label='Create only new internal verification database')
    destination.identity(DATABASE)
    prerequisites=destination.query("select jsonb_build_object('tables',(select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema')),'extensions',(select jsonb_object_agg(extname,jsonb_build_object('owner',pg_get_userbyid(extowner),'version',extversion)) from pg_extension),'available',(select jsonb_object_agg(name,default_version) from pg_available_extensions),'locale',(select jsonb_build_object('encoding',pg_encoding_to_char(d.encoding),'collate',d.datcollate,'ctype',d.datctype,'provider',d.datlocprovider,'locale',to_jsonb(d)->>'datlocale') from pg_database d where datname=current_database()))")
    expected_extensions=manifest['schema']['extensions']
    if prerequisites['tables']!=0 or prerequisites['extensions']!={'plpgsql':{'owner':OWNER,'version':expected_extensions['plpgsql']['version']}} or prerequisites['locale']!=db:
        raise RuntimeError('Verification template, extension owner or locale differs')
    if any(prerequisites['available'].get(n)!=e['version'] for n,e in expected_extensions.items()):
        raise RuntimeError('Source extension default version unavailable in destination')
    record.update(phase='restore-prepared',roles_verified=True,extension_template_verified=True,locale_verified=True)
    save(record)
    # Use the same pg_restore 18.6 that created/listed the archive. Render a complete
    # single-transaction script, then execute with the image psql through its socket.
    # Neither step opens a host/database network connection or filters archive objects.
    sql_path=diagnostic_directory/'complete_restore.sql'
    result=backup.call([backup.pgtool('pg_restore'),'--exit-on-error','--single-transaction','--file',str(sql_path),str(DIRECTORY/'retained_postgres_before_006.dump')],label='Full archive SQL reconstruction')
    if result.stderr.strip(): raise RuntimeError('pg_restore emitted warnings; stop for review')
    internal_sql=destination.copy(sql_path,'complete_restore.sql')
    destination.identity(DATABASE)
    record.update(phase='archive-restoration',pg_restore_exit=result.returncode,restore_sql_sha256=backup.file_sha256(sql_path))
    save(record)
    result=destination.psql(DATABASE,file=internal_sql,label='Complete internal archive SQL restoration')
    if result.stderr.strip(): raise RuntimeError('Archive SQL restoration emitted diagnostics; stop for review')
    record.update(phase='archive-restored',psql_restore_exit=result.returncode)
    save(record)
    print('PASS: complete archive reconstructed by pg_restore and applied transactionally through the isolated Unix socket; verification follows.',flush=True)
    if post_archive_hook:
        post_archive_hook(destination,manifest,record,diagnostic_directory)
    observed=backup.all_rows(destination.query)
    count=backup.compare_rows(manifest['rows'],observed)
    schema=backup.schema_metadata(destination.query)
    differences={section:len(set(manifest['schema'][section])^set(schema.get(section,{}))) for section in manifest['schema'] if manifest['schema'][section]!=schema.get(section)}
    if differences:
        record['schema_difference_sections']=differences;save(record)
        raise RuntimeError('Restored semantic schema differs: '+','.join(differences))
    if backup.table_catalog(destination.query)!=manifest['catalog']: raise RuntimeError('Restored partition/table catalog differs')
    if backup.role_metadata(destination.query)!=manifest['roles']: raise RuntimeError('Restored global roles differ')
    if backup.sequence_values(destination.query)!=manifest['sequences']: raise RuntimeError('Restored sequence states differ')
    state=backup.state(None,destination.query)
    if state!=manifest['state']: raise RuntimeError('Restored queue state or five-migration history differs')
    source_after=source_check(manifest)
    pinned_artifacts()
    record.update(phase='complete',result='PASS',source_after=source_after,retained_preserved=True,recoverability_verified=True,
                  restored={'tables':count,'rows':sum(r['count'] for r in observed.values()),'schema_sections':sorted(schema),
                  'schema_object_counts':{key:len(value) for key,value in schema.items()},'state':state,'global_roles':True,
                  'sequence_states':True,'partition_catalog':True,'data_fingerprints':True},migration_006_applied=False)
    destination.guard()
    backup.call(['docker','stop',name],timeout=60,label='Stop only completed internal recovery container')
    record['destination'].update(completed=True,stopped_volume_retained=True)
    save(record)
    prior=backup.load()
    prior.update(phase='complete',result='PASS',retained_preserved=True,migration_006_applied=False,
                 internal_restore_evidence=str(EVIDENCE),final_state=source_after['state'])
    for key in ['failure','failed_phase']: prior.pop(key,None)
    prior['backup'].update(recoverability_verified=True,restore_project=name,restore_container=name,restore_volume=entry['volume'],
                          restore_network_mode='none',restore_socket=SOCKET,restore_database=DATABASE,restored_table_data_verified=count,
                          restore_security_matches=True,global_roles_verified=True,sequences_verified=True,
                          restore_container_stopped_volume_retained=True)
    backup.save(prior)
    print('PASS: full restore verified against all 69 tables, schema/security/roles/partitions/sequences and five migrations. Source preserved; 006 unapplied. STOPPED.',flush=True)


def diagnose_schema():
    """Read-only post-failure classification; never repairs missing privileges."""
    record=json.loads(EVIDENCE.read_text(encoding='utf-8'))
    if record.get('phase')!='archive-restored' or record.get('result')!='FAIL':
        raise RuntimeError('Only the stopped restored-schema comparison may be diagnosed')
    _,env,_=backup.target()
    initial=backup.canonical_query(env,"""select jsonb_object_agg(n.nspname,jsonb_build_object(
      'initial_privilege_records',(select count(*) from pg_init_privs i where i.classoid='pg_namespace'::regclass and i.objoid=n.oid),
      'initial_privilege_types',(select jsonb_agg(i.privtype::text) from pg_init_privs i where i.classoid='pg_namespace'::regclass and i.objoid=n.oid),
      'initial_matches_current',coalesce((select bool_and(i.initprivs=n.nspacl) from pg_init_privs i where i.classoid='pg_namespace'::regclass and i.objoid=n.oid),false),
      'extension_member',exists(select 1 from pg_depend dep where dep.classid='pg_namespace'::regclass and dep.objid=n.oid and dep.deptype='e')))
      from pg_namespace n where n.nspname in ('graphql','graphql_public')""")
    folder=DIRECTORY/('internal_restore_'+record['destination']['container'][-8:])
    script=(folder/'complete_restore.sql').read_text(encoding='utf-8')
    toc=backup.call([backup.pgtool('pg_restore'),'--list',str(DIRECTORY/'retained_postgres_before_006.dump')],label='Read-only ACL archive inspection').stdout
    facts={'source_initial_privileges':initial,
           'archive_schema_acl_entries':{name:bool(re.search(r'ACL - SCHEMA '+name+r' ',toc)) for name in ('graphql','graphql_public')},
           'generated_schema_usage_grants':{name:bool(re.search(r'GRANT USAGE ON SCHEMA '+name+r' TO ',script)) for name in ('graphql','graphql_public')}}
    record['privilege_omission_diagnosis']=facts
    record['source_after']=source_check(pinned_artifacts())
    record['retained_preserved']=True
    destination=Destination(record['destination'],folder)
    destination.guard()
    backup.call(['docker','stop',record['destination']['container']],timeout=60,label='Stop only failed internal restore container; preserve restored data')
    record['destination']['stopped_volume_retained']=True
    record['recoverability_verified']=False
    record['phase']='stopped-at-schema-acl-comparison'
    save(record)
    print(json.dumps(facts,indent=2),flush=True)
    print('STOPPED: source preserved; full restored data/volume and all backups retained; schema ACL mismatch remains uncorrected.',flush=True)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('phase',choices=['revalidate','restore','resume-role-warning','diagnose-schema'])
    phase=parser.parse_args().phase
    if phase=='revalidate': revalidate()
    elif phase=='restore': restore()
    elif phase=='resume-role-warning': resume_role_warning()
    else: diagnose_schema()


if __name__=='__main__':
    try: main()
    except Exception as error:
        message=str(error) if isinstance(error,RuntimeError) else 'Internal restore harness failed; raw diagnostics suppressed.'
        if EVIDENCE.exists():
            record=json.loads(EVIDENCE.read_text(encoding='utf-8'))
            record.update(result='FAIL',failure=message,migration_006_applied=False,recoverability_verified=False)
            save(record)
        print('STOP: '+message,flush=True)
        sys.exit(1)
