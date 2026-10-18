#requires -Version 5.1
# Dummy encrypted-file ACL mutation for the disposable rehearsal only.
$ErrorActionPreference='Stop'
try {
    if($PSVersionTable.PSEdition -ne 'Desktop'){throw 'VPR_PLATFORM'}
    $request=[Console]::In.ReadToEnd() | ConvertFrom-Json
    if($request.runId -cnotmatch '^[0-9a-f]{8}\z' -or $request.slot -cne 'acl-negative' -or
       $request.operation -cnotin @('weaken','restore')){throw 'VPR_TEST_SCOPE'}
    $workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')).TrimEnd('\')
    if($workspace -cne 'C:\Users\Hp\school-queue-management-system'){throw 'VPR_WORKSPACE'}
    $file=Join-Path $workspace ('.local-vector-repair\'+$request.runId+'\acl-negative\payload.dpapi')
    $cursor=$file
    while($cursor.Length -ge $workspace.Length){
        if([IO.File]::GetAttributes($cursor) -band [IO.FileAttributes]::ReparsePoint){throw 'VPR_REPARSE'}
        if($cursor -eq $workspace){break}; $cursor=[IO.Path]::GetDirectoryName($cursor)
    }
    $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
    if([IO.File]::GetAccessControl($file).GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $sid.Value){throw 'VPR_OWNER'}
    if($request.operation -ceq 'weaken'){
        $acl=[IO.File]::GetAccessControl($file)
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'),'Read','Allow'))
    }else{
        $acl=[Security.AccessControl.FileSecurity]::new(); $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false)
        foreach($who in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))){
            $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($who,'FullControl','Allow'))
        }
    }
    [IO.File]::SetAccessControl($file,$acl)
    [Console]::Out.Write('{"result":"PASS"}')
}catch{[Console]::Error.WriteLine('VPR_DUMMY_ACL_REJECTED');exit 1}
