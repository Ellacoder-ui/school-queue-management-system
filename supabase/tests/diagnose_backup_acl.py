"""Read-only ACL subprocess diagnostic. No database connection or restore operation."""
import json
import restore_local_backup_internal as restore

original=restore.backup.call
results=[]
def observe(command,**kwargs):
    result=original(command,**kwargs)
    if command[0]=='powershell': results.append(result)
    return result
restore.backup.call=observe
try:
    restore.verify_acl()
except RuntimeError as error:
    print('ACL diagnostic: '+str(error))
finally:
    restore.backup.call=original
for result in results:
    print(json.dumps({'stderr_present':bool(result.stderr),'error_lines':result.stderr.splitlines()[:12]}))
