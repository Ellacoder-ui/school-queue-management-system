"""Step 22.5 read-only inspection. No credentials/settings/restart are written."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
from uuid import uuid4

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tests/frontend'))
from run_google_auth import inspect
from realtime_preservation import classify
import retained_migration_006 as backup

def main():
    source, checks=inspect()
    final_file=ROOT/'supabase/tests/results/google_frontend_final_validation_9d91d12f.json'
    final=json.loads(final_file.read_text(encoding='utf-8'))
    if final['result']!='PASS' or final['phase']!='complete': raise RuntimeError('Completed frontend validation required')
    preservation=classify(final['after'],source)
    container=json.loads(backup.call(['docker','inspect','supabase_auth_school-queue-local'],label='Read-only local Auth identity').stdout)[0]
    allowed={'API_EXTERNAL_URL','GOTRUE_API_EXTERNAL_URL','GOTRUE_SITE_URL','GOTRUE_URI_ALLOW_LIST',
       'GOTRUE_DISABLE_SIGNUP','GOTRUE_EXTERNAL_EMAIL_ENABLED','GOTRUE_MAILER_AUTOCONFIRM',
       'GOTRUE_EXTERNAL_GOOGLE_ENABLED','GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI','GOTRUE_EXTERNAL_GOOGLE_SKIP_NONCE_CHECK',
       'GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED','GOTRUE_SECURITY_MANUAL_LINKING_ENABLED','GOTRUE_JWT_EXP'}
    settings={}; credential_presence={}
    for entry in container['Config']['Env']:
        key,_,value=entry.partition('=')
        if key in allowed: settings[key]=value
        if key in ('GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID','GOTRUE_EXTERNAL_GOOGLE_SECRET'):
            credential_presence[key]=bool(value)
    cli=backup.call(['node',str(ROOT/'node_modules/supabase/dist/supabase.js'),'--version'],label='Pinned local CLI version').stdout.strip()
    result={'result':'PASS_READ_ONLY_LOCAL_INSPECTION','captured_at_utc':datetime.now(timezone.utc).isoformat(),
        'identity':source['identity'],'system_identifier':source['system_identifier'],
        'state':source['state'],'logical_tables':len(source['rows']),
        'partitions':[t for t in source['catalog'] if t['is_partition']],
        'auth_image':container['Config']['Image'],'auth_image_id':container['Image'],
        'auth_nonsecret_settings':settings,'google_credential_fields_present':credential_presence,
        'cli_version':cli,'inspection_checks':checks,'preservation_vs_final_validation':preservation,
        'config_sha256':hashlib.sha256((ROOT/'supabase/config.toml').read_bytes()).hexdigest(),
        'source':source,'google_cloud_console_directly_verified':False,
        'provider_activation_or_restart_executed':False,'source_writes_requested':False}
    path=ROOT/f'supabase/tests/results/local_google_provider_preparation_{uuid4().hex[:8]}.json'
    with path.open('x',encoding='utf-8') as handle: json.dump(result,handle,indent=2);handle.write('\n')
    print(json.dumps({k:result[k] for k in ('result','logical_tables','auth_image','auth_image_id','auth_nonsecret_settings','google_credential_fields_present','cli_version','preservation_vs_final_validation')},indent=2))
    print(str(path.relative_to(ROOT)))

if __name__=='__main__': main()
