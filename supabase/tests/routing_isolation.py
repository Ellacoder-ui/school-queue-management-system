"""Guarded disposable Supabase projects. Never executes a write at port 54322.
CLI output/credentials stay in memory. Every SQL/test phase rechecks Docker identity,
loopback bindings, unique volumes, exact status/config ports and migration hashes.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import time
import tomllib
from urllib.parse import unquote, urlparse
import uuid

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / 'supabase/tests/results'
CLI = ['node', str(ROOT / 'node_modules/supabase/dist/supabase.js')]
ORIGINAL_HASHES = [
 '274141dbab99dbaad959f2343633ee0bd440b240a29b5664ca304e283934d7d7',
 '65c943d4fea282c07e06bab6b759882f7fcec678ddf960869dd60a52db911883',
 '7a4ad627112f0bc3109417bec237b13000e1c06002d536f7c9feab5261eb4883',
 '95bd4918550dddae84672c148c6a616c9d12928b78097a82815a26a35146746e',
 '793a68b375d69044dc4900749867576b5c45a6b4173725191ffbaeb66a2dd31a',
]


def clean_env():
    return {k: v for k, v in os.environ.items() if not k.upper().startswith(('PG', 'SUPABASE_', 'QUEUE_', 'VITE_'))}


def run(command, *, env=None, cwd=ROOT, timeout=180, input=None):
    result = subprocess.run(command, cwd=cwd, env=env or clean_env(), input=input,
                            capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        # Only safe diagnostic lines, never status credentials, SQL values or connection URLs.
        safe = [line for line in (result.stdout + '\n' + result.stderr).splitlines()
                if ('error' in line.lower() or 'failed' in line.lower()) and
                not re.search(r'postgres(?:ql)?://|eyJ|sb_secret_|password|jwt|token|key', line, re.I)]
        print('\n'.join(safe[-4:]), flush=True)
        raise RuntimeError('Local subprocess failed; sensitive diagnostics suppressed')
    return result.stdout


def status(workdir, dbport, apiport):
    local = json.loads(run(CLI + ['status', '--workdir', str(workdir), '--output', 'json']))
    db, api = urlparse(local['DB_URL']), urlparse(local['API_URL'])
    if (db.scheme not in ('postgres', 'postgresql') or db.hostname != '127.0.0.1' or db.port != dbport
            or db.path != '/postgres' or db.username != 'postgres' or not db.password or db.query or db.fragment
            or api.scheme != 'http' or api.hostname != '127.0.0.1' or api.port != apiport
            or api.path not in ('', '/') or api.query or api.fragment or api.username or api.password):
        raise RuntimeError('Exact local status endpoints required')
    return local, db


def sql_env(db, port, read_only=False):
    env = clean_env()
    env.update(PGHOST='127.0.0.1', PGHOSTADDR='127.0.0.1', PGPORT=str(port), PGDATABASE='postgres',
               PGUSER='postgres', PGPASSWORD=unquote(db.password), PGPASSFILE=os.devnull, PGCONNECT_TIMEOUT='5',
               PGOPTIONS='-c statement_timeout=30000 -c lock_timeout=10000' +
               (' -c default_transaction_read_only=on' if read_only else ''))
    return env


def psql_path():
    path = shutil.which('psql') or r'C:\Program Files\PostgreSQL\18\bin\psql.exe'
    if not Path(path).is_file():
        raise RuntimeError('psql required')
    return path


def read_json(env, query):
    text = run([psql_path(), '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1'], env=env,
               input='begin read only; ' + query + '; commit;')
    return json.loads(text.strip().splitlines()[-1])


def fingerprint(env):
    tables = read_json(env, "select jsonb_agg(format('%I.%I',schemaname,tablename) order by schemaname,tablename) "
                      "from pg_tables where schemaname in ('queue_private','queue_display')")
    tables += ['auth.users', 'auth.identities']
    pairs = [f"'{t}',(select coalesce(jsonb_agg(md5(to_jsonb(x)::text) order by md5(to_jsonb(x)::text)),'[]') from {t} x)" for t in tables]
    return read_json(env, 'select jsonb_build_object(' + ','.join(pairs) + ')')


class Isolated:
    def __init__(self, run_id, stage):
        if not re.fullmatch(r'[0-9a-f]{8}', run_id) or stage not in ('upgrade', 'fresh'):
            raise RuntimeError('Invalid isolated identity')
        self.manifest_path = RESULTS / f'routing_isolation_{run_id}.json'
        self.manifest = json.loads(self.manifest_path.read_text(encoding='utf-8'))
        self.entry = self.manifest['projects'][stage]
        self.path = Path(self.entry['workdir']).resolve()
        if not self.path.is_relative_to((ROOT / '.local-routing' / run_id).resolve()):
            raise RuntimeError('Workdir outside isolated workspace')
        cfg = tomllib.loads((self.path / 'supabase/config.toml').read_text(encoding='utf-8'))
        if (cfg['project_id'] != self.entry['project_id'] or cfg['db']['port'] != self.entry['db_port']
                or cfg['api']['port'] != self.entry['api_port'] or cfg['db']['port'] == 54322
                or cfg['api']['port'] == 54321 or 'queue_private' in cfg['api']['schemas']):
            raise RuntimeError('Isolated config mismatch; stopped')
        self.port = cfg['db']['port']

    def save(self):
        self.manifest_path.write_text(json.dumps(self.manifest, indent=2) + '\n', encoding='utf-8')

    def verify(self):
        project = self.entry['project_id']
        containers = json.loads(run(['docker', 'inspect', f'supabase_db_{project}', f'supabase_kong_{project}']))
        volumes = []
        for item, internal, external in zip(containers, ['5432/tcp', '8000/tcp'], [self.port, self.entry['api_port']]):
            if project not in item['Name'] or not item['State']['Running']:
                raise RuntimeError('Wrong/not-running disposable container')
            bindings = item['NetworkSettings']['Ports'].get(internal) or []
            if not bindings or any(b['HostIp'] != '127.0.0.1' or int(b['HostPort']) != external for b in bindings):
                raise RuntimeError('Disposable ports must bind only to loopback')
            for mount in item['Mounts']:
                if mount['Type'] == 'volume':
                    if project not in mount['Name'] or mount['Name'] in self.manifest['retained_volumes']:
                        raise RuntimeError('Volume isolation failed')
                    volumes.append(mount['Name'])
        if not volumes:
            raise RuntimeError('Isolated database volume missing')
        self.entry['verified_volumes'] = volumes
        local, db = status(self.path, self.port, self.entry['api_port'])
        self.entry['verified_loopback'] = True
        self.save()
        return local, sql_env(db, self.port)

    def cli(self, arguments, timeout=180):
        self.verify()
        return run(CLI + arguments + ['--workdir', str(self.path),'--network-id',self.entry['network']], cwd=self.path, timeout=timeout)

    def sql_file(self, filename):
        if filename not in ('synthetic_flexible_routing.sql',):
            raise RuntimeError('Unapproved fixture file')
        _, env = self.verify()
        if self.entry['stage'] != 'upgrade':
            raise RuntimeError('Synthetic legacy fixture only belongs in upgrade stack')
        if read_json(env, 'select count(*) from queue_private.accounts'):
            raise RuntimeError('Synthetic fixture requires empty upgrade application tables')
        run([psql_path(), '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1'], env=env,
            input=(ROOT / 'supabase/tests' / filename).read_text(encoding='utf-8'))


def prepare():
    run_id = uuid.uuid4().hex[:8]
    root_status, root_db = status(ROOT, 54322, 54321)
    retained = fingerprint(sql_env(root_db, 54322, True))
    inventory = json.loads(run(['docker', 'inspect', 'supabase_db_school-queue-local']))[0]
    volumes = [m['Name'] for m in inventory['Mounts'] if m['Type'] == 'volume']
    projects = {}
    for stage, base in [('upgrade', 55320), ('fresh', 56320)]:
        for port in range(base, base+10):
            with socket.socket() as check:
                check.bind(('127.0.0.1', port))
        path = ROOT / '.local-routing' / run_id / stage
        (path / 'supabase/migrations').mkdir(parents=True)
        project = f'sq-routing-{stage}-{run_id}'
        config = f'''project_id = "{project}"
[api]
enabled = true
port = {base+1}
schemas = ["public"]
extra_search_path = ["public","extensions"]
max_rows = 1000
[db]
port = {base+2}
shadow_port = {base}
major_version = 17
[db.seed]
enabled = false
[studio]
enabled = false
port = {base+3}
[inbucket]
enabled = false
port = {base+4}
smtp_port = {base+5}
pop3_port = {base+6}
[analytics]
enabled = false
port = {base+7}
[storage]
enabled = false
[edge_runtime]
enabled = false
[db.pooler]
enabled = false
port = {base+9}
[auth]
enabled = true
site_url = "http://127.0.0.1:5173"
enable_signup = false
'''
        (path / 'supabase/config.toml').write_text(config, encoding='utf-8')
        projects[stage] = {'stage':stage,'project_id':project,'workdir':str(path),'db_port':base+2,
                           'api_port':base+1,'network':'supabase_network_'+project}
    manifest = {'run':run_id,'projects':projects,'retained_volumes':volumes,'retained_fingerprint':retained}
    RESULTS.mkdir(exist_ok=True)
    file = RESULTS / f'routing_isolation_{run_id}.json'
    file.write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    print('Prepared isolated run '+run_id+'; retained fingerprint captured READ ONLY.', flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['prepare','start','recover-platform','validate-fresh','finalize','stop-isolated','bootstrap','expose-api','seed-upgrade','apply-sixth','db-tests','concurrency','api','http','remaining','postflight','verify-retained','stop'])
    parser.add_argument('--run')
    parser.add_argument('--stage',choices=['upgrade','fresh'],default='upgrade')
    args = parser.parse_args()
    files = sorted((ROOT / 'supabase/migrations').glob('*.sql'))
    if [hashlib.sha256(p.read_bytes()).hexdigest() for p in files[:5]] != ORIGINAL_HASHES:
        raise RuntimeError('An original migration differs; stopped')
    if args.action == 'prepare':
        prepare(); return
    isolated = Isolated(args.run, args.stage)
    if args.action == 'start':
        # No application migration files exist during platform startup.
        if list((isolated.path / 'supabase/migrations').glob('*.sql')):
            raise RuntimeError('Start expects empty application migration directory')
        network = subprocess.run(['docker','network','inspect',isolated.entry['network']],capture_output=True,text=True,env=clean_env())
        if network.returncode:
            run(['docker','network','create','--driver','bridge','--opt',
                 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1',isolated.entry['network']])
        else:
            existing = json.loads(network.stdout)[0]
            if existing['Options'].get('com.docker.network.bridge.host_binding_ipv4') != '127.0.0.1':
                raise RuntimeError('Existing isolated network has wrong binding')
        print('Starting '+isolated.entry['project_id']+' with its own loopback network/volumes.',flush=True)
        run(['node',str(ROOT/'supabase/tests/start_loopback_stack.mjs'),str(isolated.path),
             isolated.entry['project_id'],isolated.entry['network']],timeout=600)
        isolated.verify()
        print('Verified isolated project, loopback endpoints and disjoint database volume.',flush=True)
    elif args.action == 'recover-platform':
        if args.stage != 'fresh' or list((isolated.path/'supabase/migrations').glob('*.sql')):
            raise RuntimeError('Recovery only for empty disposable platform startup')
        project=isolated.entry['project_id']
        db=json.loads(run(['docker','inspect','supabase_db_'+project]))[0]
        bindings=db['NetworkSettings']['Ports'].get('5432/tcp') or []
        if (not db['State']['Running'] or not bindings or any(b['HostIp']!='127.0.0.1' or int(b['HostPort'])!=isolated.port for b in bindings)
            or not all(project in m['Name'] and m['Name'] not in isolated.manifest['retained_volumes'] for m in db['Mounts'] if m['Type']=='volume')):
            raise RuntimeError('Disposable recovery target mismatch')
        ids=run(['docker','ps','-aq','--filter','network='+isolated.entry['network']]).split()
        for container_id in ids:
            info=json.loads(run(['docker','inspect',container_id]))[0]
            if info['State']['Status']=='created' and info['Config']['Image'].startswith('public.ecr.aws/supabase/realtime:'):
                if info['Mounts'] or info['HostConfig']['PortBindings'] or info['HostConfig']['Privileged']:
                    raise RuntimeError('Unexpected initializer access')
                run(['docker','start','--attach',container_id],timeout=180)
                if not info['HostConfig']['AutoRemove']:
                    final=json.loads(run(['docker','inspect',container_id]))[0]
                    if final['State']['ExitCode']!=0: raise RuntimeError('Initializer failed')
        run(CLI+['stop','--project-id',project,'--workdir',str(isolated.path)],timeout=180)
        run(['node',str(ROOT/'supabase/tests/start_loopback_stack.mjs'),str(isolated.path),project,isolated.entry['network']],timeout=600)
        isolated.verify()
        print('Recovered only disposable empty-platform initialization; volumes retained.',flush=True)
    elif args.action == 'validate-fresh':
        if args.stage!='fresh': raise RuntimeError('Fresh validation requires fresh project')
        isolated.verify()
        for step in ['bootstrap','expose-api','db-tests','concurrency','api','remaining']:
            print('Isolated fresh validation: '+step,flush=True)
            result=subprocess.run([sys.executable,str(Path(__file__).resolve()),step,'--run',args.run,'--stage','fresh'],cwd=ROOT,env=clean_env(),timeout=360)
            if result.returncode: raise RuntimeError('Stopped at failed isolated phase: '+step)
    elif args.action == 'finalize':
        for step,stage in [('postflight','upgrade'),('postflight','fresh'),('verify-retained','upgrade')]:
            result=subprocess.run([sys.executable,str(Path(__file__).resolve()),step,'--run',args.run,'--stage',stage],cwd=ROOT,env=clean_env(),timeout=120)
            if result.returncode: raise RuntimeError('Final verification stopped: '+step)
    elif args.action == 'stop-isolated':
        for stage in ['upgrade','fresh']:
            result=subprocess.run([sys.executable,str(Path(__file__).resolve()),'stop','--run',args.run,'--stage',stage],cwd=ROOT,env=clean_env(),timeout=180)
            if result.returncode: raise RuntimeError('Disposable shutdown stopped: '+stage)
    elif args.action == 'bootstrap':
        isolated.verify()
        count = 5 if args.stage == 'upgrade' else 6
        for path in files[:count]: shutil.copyfile(path, isolated.path / 'supabase/migrations' / path.name)
        isolated.cli(['migration','up','--local'])
        print(f'Applied {count} migrations only in {isolated.entry["project_id"]}.',flush=True)
    elif args.action == 'seed-upgrade':
        isolated.sql_file('synthetic_flexible_routing.sql')
        _, env = isolated.verify()
        baseline = fingerprint(env)
        isolated.manifest['synthetic_baseline'] = baseline
        isolated.save()
        print('Populated legacy flexible-routing fixture; historical fingerprint captured.',flush=True)
    elif args.action == 'expose-api':
        _, env = isolated.verify()
        config_path = isolated.path / 'supabase/config.toml'
        original = config_path.read_text(encoding='utf-8')
        if 'schemas = ["public"]' not in original:
            raise RuntimeError('Expected bootstrap-only schema exposure')
        # Reload documented in-database PostgREST configuration; no container restart.
        run([psql_path(),'-X','-w','-qAt','-v','ON_ERROR_STOP=1'],env=env,input="begin; alter role authenticator set pgrst.db_schemas='public,queue_api,queue_display'; notify pgrst,'reload config'; notify pgrst,'reload schema'; commit;")
        config_path.write_text(original.replace('schemas = ["public"]','schemas = ["public","queue_api","queue_display"]'),encoding='utf-8')
        isolated.verify()
        print('Exposed only public/queue_api/queue_display in the isolated gateway.',flush=True)
    elif args.action == 'apply-sixth':
        _, env = isolated.verify()
        if args.stage != 'upgrade' or not isolated.manifest.get('synthetic_baseline'):
            raise RuntimeError('Expected populated upgrade fixture')
        shutil.copyfile(files[5],isolated.path / 'supabase/migrations' / files[5].name)
        isolated.cli(['migration','up','--local'])
        after = fingerprint(env)
        for table, rows in isolated.manifest['synthetic_baseline'].items():
            if table in ('queue_private.counter_services','queue_display.counter_state','queue_display.service_state'):
                continue
            if table == 'queue_private.admin_audit_events':
                if not set(rows) <= set(after[table]) or len(after[table]) != len(rows)+1: raise RuntimeError('Audit preservation failed')
            elif rows != after[table]: raise RuntimeError('Synthetic historical rows changed')
        isolated.entry['populated_upgrade_preserved'] = True
        isolated.save()
        print('Sixth migration applied only to synthetic upgrade stack; history/staff/accounts/allocators preserved.',flush=True)
    elif args.action == 'db-tests':
        output = isolated.cli(['db','lint','--local'])
        print(output.strip(),flush=True)
        test_files = ['fixed_routing_test.sql','read_context_test.sql'] + (['queue_test.sql'] if args.stage == 'fresh' else [])
        for name in test_files:
            target = isolated.path / 'supabase/tests/database' / name
            target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(ROOT / 'supabase/tests/database' / name,target)
        output += isolated.cli(['test','db','--local','supabase/tests/database'])
        safe = [line for line in output.splitlines() if line.startswith(('All tests successful','Files=','Result:','No schema errors'))]
        print('\n'.join(safe),flush=True)
        isolated.entry['database_validation'] = safe
        isolated.save()
    elif args.action in ('concurrency','api','http','remaining'):
        local, env = isolated.verify()
        env['PATH'] = str(Path(psql_path()).parent)+os.pathsep+env.get('PATH','')
        env.update(QUEUE_ISOLATED_PROJECT_ID=isolated.entry['project_id'],QUEUE_ISOLATED_DB_PORT=str(isolated.port),
                   QUEUE_E2E_API=local['API_URL'].rstrip('/'),QUEUE_E2E_ANON_KEY=local['ANON_KEY'],
                   QUEUE_E2E_SERVICE_KEY=local['SERVICE_ROLE_KEY'],QUEUE_E2E_PSQL=psql_path(),
                   QUEUE_TEST_DATABASE_URL=local['DB_URL'])
        scripts = {'concurrency':'concurrency.py','api':'api_realtime_security.mjs','http':'fixed_routing_http.mjs','remaining':'remaining_api_validation.mjs'}
        command = [sys.executable if args.action=='concurrency' else 'node',str(ROOT / 'supabase/tests' / scripts[args.action])]
        # Child scripts independently pin the loopback ports and isolated identity.
        result = subprocess.run(command,cwd=ROOT,env=env,timeout=300,capture_output=True,text=True)
        output=result.stdout+'\n'+result.stderr
        for line in output.splitlines():
            if line.startswith(('PASS:','SKIP:','Summary:')): print(line,flush=True)
        counts=re.search(r'Summary: (\d+) passed; (\d+) failed(?:; (\d+) skipped)?',output)
        if counts: passed,failed,skipped=(int(value or 0) for value in counts.groups())
        else:
            total=re.search(r'Ran (\d+) tests?',output)
            passed=int(total.group(1)) if total and result.returncode==0 else 0
            failed=0 if result.returncode==0 else 1
            skipped=0
        evidence={'project':isolated.entry['project_id'],'suite':args.action,'passed':passed,'failed':failed,
                  'skipped':skipped,'exit_code':result.returncode}
        (RESULTS/f'routing_{args.stage}_{args.action}_{args.run}_{int(time.time())}.json').write_text(json.dumps(evidence,indent=2)+'\n',encoding='utf-8')
        if result.returncode: raise RuntimeError('Isolated test suite failed; see sanitized suite evidence')
        if not counts: print(f'{args.action}: {passed} passed; {failed} failed; {skipped} skipped.',flush=True)
    elif args.action == 'postflight':
        local, env=isolated.verify()
        observed=read_json(env,"select jsonb_object_agg(n.nspname||'.'||p.proname,p.prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('queue_api','queue_private','queue_display')")
        expected={}
        for path in files:
            for name,body in re.findall(r'create (?:or replace )?function (queue_\w+\.\w+)\(.*?\bas\s+\$\$(.*?)\$\$;',path.read_text(encoding='utf-8'),re.S): expected[name]=body.strip()
        matches={name:observed.get(name,'').replace('\r\n','\n').strip()==body for name,body in expected.items()}
        if not all(matches.values()): raise RuntimeError('Applied function source differs from migration')
        before=fingerprint(env)
        result=subprocess.run([psql_path(),'-X','-w','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],env=env,capture_output=True,text=True,
            input="begin; delete from queue_private.counter_services where counter_id=(select id from queue_private.counters where number=5); commit;",timeout=30)
        if result.returncode==0 or not re.search(r'ERROR:\s+23514',result.stderr) or fingerprint(env)!=before:
            raise RuntimeError('Commit-time mandatory-route rollback failed; stop')
        evidence=read_json(env,"""select jsonb_build_object('migrations',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations),
          'matrix',(select jsonb_object_agg(c.number,s.code) from queue_private.counter_services x join queue_private.counters c on c.id=x.counter_id join queue_private.services s on s.id=x.service_id),
          'active_tickets',(select count(*) from queue_private.tickets where status in ('WAITING','CALLED')),
          'duplicate_numbers',(select count(*) from (select 1 from queue_private.tickets group by queue_day_id,service_id,sequence_number having count(*)>1)x),
          'quota_violations',(select count(*) from (select 1 from queue_private.tickets where status='SERVED' group by owner_id,queue_day_id,service_id having count(*)>2)x),
          'rls_tables',(select count(*) from pg_tables where schemaname in ('queue_private','queue_display') and rowsecurity),
          'publication',(select jsonb_agg(schemaname||'.'||tablename order by tablename) from pg_publication_tables where pubname='supabase_realtime'))""")
        if any(evidence[k] for k in ['active_tickets','duplicate_numbers','quota_violations']): raise RuntimeError('Postflight correctness violation')
        evidence.update(project=isolated.entry['project_id'],function_bodies_match=matches,commit_time_rejection_rolled_back=True)
        # Scan each local project's known private keys without writing/printing them.
        private_values=[local.get(k) for k in ['SERVICE_ROLE_KEY','SECRET_KEY'] if local.get(k)]
        if any(any(value in path.read_text(encoding='utf-8') for value in private_values) for path in (ROOT/'dist').rglob('*.js')):
            raise RuntimeError('Private key bundle scan failed')
        evidence['isolated_private_key_bundle_scan']='PASS'
        (RESULTS/f'routing_postflight_{args.stage}_{args.run}.json').write_text(json.dumps(evidence,indent=2)+'\n',encoding='utf-8')
        print('Postflight passed: function bodies, six migrations, commit-time rollback, routing, quotas, privacy controls and bundle scan.',flush=True)
    elif args.action == 'verify-retained':
        _, db = status(ROOT,54322,54321)
        readonly=sql_env(db,54322,True)
        if fingerprint(readonly) != isolated.manifest['retained_fingerprint']:
            raise RuntimeError('Retained row fingerprint changed')
        state=read_json(readonly,"""select jsonb_build_object('applied_migrations',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations),
          'accounts',(select count(*) from queue_private.accounts),'tickets',(select count(*) from queue_private.tickets),
          'active_tickets',(select count(*) from queue_private.tickets where status in ('WAITING','CALLED')))""")
        if state['applied_migrations'] != [p.name.split('_')[0] for p in files[:5]]:
            raise RuntimeError('Retained migration history changed')
        isolated.manifest['retained_verified_unchanged'] = True
        isolated.manifest['retained_final_state'] = state
        isolated.manifest['original_five_migration_hashes_verified'] = True
        isolated.save()
        print('Retained database: all original application/display/Auth rows unchanged; read-only access only.',flush=True)
    elif args.action == 'stop':
        isolated.verify()
        run(CLI+['stop','--project-id',isolated.entry['project_id'],'--workdir',str(isolated.path)],timeout=180)
        isolated.entry['stopped_without_deleting_volumes'] = True
        isolated.save()
        print('Stopped only '+isolated.entry['project_id']+'; volumes retained.',flush=True)


if __name__ == '__main__':
    main()
