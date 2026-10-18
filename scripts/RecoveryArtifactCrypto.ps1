#requires -Version 5.1
<# Private redirected-pipe bridge for new dual-database recovery runs only.
   Never accepts a Google path, plaintext command argument or historical bundle. #>
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$plain=$null; $cipher=$null; $entropy=$null; $data=$null
try {
    if($PSVersionTable.PSEdition -cne 'Desktop' -or -not [Console]::IsInputRedirected -or -not [Console]::IsOutputRedirected){throw 'DAR_CRYPTO_CHANNEL'}
    Add-Type -AssemblyName System.Security
    $request=[Console]::In.ReadToEnd() | ConvertFrom-Json
    $keys=@($request.PSObject.Properties.Name | Sort-Object)
    $expected=if($request.operation -ceq 'protect'){@('operation','directory','artifact','database','data') | Sort-Object}else{@('operation','directory','artifact','database') | Sort-Object}
    if(($keys -join '|') -cne ($expected -join '|') -or $request.operation -cnotin @('protect','open')){throw 'DAR_CRYPTO_REQUEST'}
    $workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
    if($workspace -ine 'C:\Users\Hp\school-queue-management-system'){throw 'DAR_CRYPTO_WORKSPACE'}
    $backupRoot=Join-Path $workspace '.local-backups'
    $directory=[IO.Path]::GetFullPath([string]$request.directory).TrimEnd('\')
    if([IO.Path]::GetDirectoryName($directory) -ine $backupRoot -or [IO.Path]::GetFileName($directory) -cnotmatch '\Adual_\d{8}T\d{6}Z_[0-9a-f]{8}\z' -or
       $request.artifact -cnotmatch '\A[a-z][a-z0-9_-]{0,55}\.dpapi\z' -or $request.database -cnotin @('postgres','_supabase','synthetic')){throw 'DAR_CRYPTO_PATH'}
    $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
    $systemSid=[Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    function Assert-DARPath([string]$value){
        $walk=$value
        while($walk.Length -ge $workspace.Length){
            if([IO.File]::Exists($walk) -or [IO.Directory]::Exists($walk)){
                if([IO.File]::GetAttributes($walk) -band [IO.FileAttributes]::ReparsePoint){throw 'DAR_CRYPTO_REPARSE'}
            }
            if($walk -ieq $workspace){break}
            $walk=[IO.Path]::GetDirectoryName($walk)
        }
    }
    function Assert-DARAcl([string]$value,[bool]$isDirectory){
        $acl=if($isDirectory){[IO.Directory]::GetAccessControl($value)}else{[IO.File]::GetAccessControl($value)}
        if(-not $acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $sid.Value){throw 'DAR_CRYPTO_OWNER_ACL'}
        $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
        if($rules.Count -ne 2){throw 'DAR_CRYPTO_ACL'}
        $seen=@()
        foreach($rule in $rules){
            if($rule.IsInherited -or $rule.AccessControlType -ne 'Allow' -or $rule.FileSystemRights -ne 'FullControl' -or
               $rule.IdentityReference.Value -notin @($sid.Value,$systemSid.Value)){throw 'DAR_CRYPTO_ACL'}
            $seen+=$rule.IdentityReference.Value
        }
        if(@($seen | Sort-Object -Unique).Count -ne 2){throw 'DAR_CRYPTO_ACL'}
    }
    Assert-DARPath $directory
    Assert-DARAcl $directory $true
    $file=Join-Path $directory $request.artifact
    Assert-DARPath $file
    $git=Get-Command git.exe -ErrorAction Stop
    $ignored=& $git.Source -C $workspace check-ignore -- $file 2>$null
    if($LASTEXITCODE -ne 0 -or -not $ignored){throw 'DAR_CRYPTO_GIT'}
    $tracked=& $git.Source -C $workspace ls-files -- $directory 2>$null
    if($LASTEXITCODE -ne 0 -or $tracked){throw 'DAR_CRYPTO_GIT'}
    $entropy=[Text.Encoding]::UTF8.GetBytes('dual-recovery-v1|'+$sid.Value+'|'+$file.ToLowerInvariant()+'|'+$request.database)
    if($request.operation -ceq 'protect'){
        if($request.data -isnot [string] -or $request.data.Length -gt 89478488 -or [IO.File]::Exists($file)){throw 'DAR_CRYPTO_BOUND_EXISTS'}
        $data=[Convert]::FromBase64String($request.data)
        if($data.Length -gt 67108864){throw 'DAR_CRYPTO_BOUND'}
        $envelope=@{version=1;project='school-queue-local';owner=$sid.Value;path=$file;database=$request.database;data=$request.data}
        $plain=[Text.Encoding]::UTF8.GetBytes(($envelope | ConvertTo-Json -Compress))
        $cipher=[Security.Cryptography.ProtectedData]::Protect($plain,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
        $stream=[IO.FileStream]::new($file,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try{$stream.Write($cipher,0,$cipher.Length);$stream.Flush($true)}finally{$stream.Dispose()}
        $acl=[Security.AccessControl.FileSecurity]::new()
        $acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false)
        foreach($principal in @($sid,$systemSid)){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($principal,'FullControl','Allow'))}
        [IO.File]::SetAccessControl($file,$acl)
    }
    Assert-DARAcl $file $false
    $cipher=[IO.File]::ReadAllBytes($file)
    if($cipher.Length -gt 100663296){throw 'DAR_CRYPTO_CIPHER_BOUND'}
    if($null -ne $plain){[Array]::Clear($plain,0,$plain.Length)}
    $plain=[Security.Cryptography.ProtectedData]::Unprotect($cipher,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    $opened=[Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json
    if($opened.version -ne 1 -or $opened.project -cne 'school-queue-local' -or $opened.owner -cne $sid.Value -or
       $opened.path -cne $file -or $opened.database -cne $request.database){throw 'DAR_CRYPTO_BINDING'}
    if($request.operation -ceq 'protect'){
        if($opened.data -cne $request.data){throw 'DAR_CRYPTO_READBACK'}
        [Console]::Out.Write('{"result":"PASS","encrypted":true,"readback":true}')
    }else{
        [Console]::Out.Write((@{result='PASS';data=$opened.data} | ConvertTo-Json -Compress))
    }
}catch{
    [Console]::Error.WriteLine('DAR_CRYPTO_REJECTED')
    exit 1
}finally{
    foreach($buffer in @($plain,$cipher,$entropy,$data)){if($null -ne $buffer){[Array]::Clear($buffer,0,$buffer.Length)}}
    $request=$null;$opened=$null;$envelope=$null
}
