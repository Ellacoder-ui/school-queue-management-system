#requires -Version 5.1
<# Private redirected-IPC bridge. Payloads must never be forwarded to a console.
   No Docker, Google credential, or retained service operation exists here. #>
$ErrorActionPreference='Stop'
try {
    if ($PSVersionTable.PSEdition -ne 'Desktop' -or -not [Console]::IsInputRedirected -or -not [Console]::IsOutputRedirected) { throw 'VPR_IPC' }
    Add-Type -AssemblyName System.Security
    $workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
    if ($workspace -cne 'C:\Users\Hp\school-queue-management-system') { throw 'VPR_WORKSPACE' }
    $request=[Console]::In.ReadToEnd()
    if ($request.Length -gt 2097152) { throw 'VPR_INPUT_BOUND' }
    $inputObject=$request | ConvertFrom-Json
    if ($inputObject.operation -cnotin @('initialize','seal','open') -or $inputObject.runId -cnotmatch '^[0-9a-f]{8}\z' -or
        $inputObject.slot -cnotmatch '^[a-z][a-z0-9-]{0,31}\z') { throw 'VPR_INPUT' }
    $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
    $systemSid=[Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    function New-VPRSecurity([bool]$Directory) {
        $acl=if($Directory){[Security.AccessControl.DirectorySecurity]::new()}else{[Security.AccessControl.FileSecurity]::new()}
        $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false)
        foreach($who in @($sid,$systemSid)) {
            $inherit=if($Directory){[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'}else{[Security.AccessControl.InheritanceFlags]::None}
            $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($who,'FullControl',$inherit,'None','Allow'))
        }
        return $acl
    }
    function Assert-VPRPath([string]$Path) {
        if (-not $Path.StartsWith($workspace+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'VPR_PATH' }
        $cursor=$Path
        while ($cursor.Length -ge $workspace.Length) {
            if (([IO.File]::Exists($cursor) -or [IO.Directory]::Exists($cursor)) -and
                ([IO.File]::GetAttributes($cursor) -band [IO.FileAttributes]::ReparsePoint)) { throw 'VPR_REPARSE' }
            if($cursor -eq $workspace){break}; $cursor=[IO.Path]::GetDirectoryName($cursor)
        }
    }
    function Assert-VPRAcl([string]$Path,[bool]$Directory) {
        Assert-VPRPath $Path
        $acl=if($Directory){[IO.Directory]::GetAccessControl($Path)}else{[IO.File]::GetAccessControl($Path)}
        if(-not $acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $sid.Value){throw 'VPR_OWNER'}
        $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
        if($rules.Count -ne 2){throw 'VPR_ACL'}
        $seen=@()
        foreach($rule in $rules){
            if($rule.IsInherited -or $rule.AccessControlType -ne 'Allow' -or $rule.FileSystemRights -ne 'FullControl' -or
                $rule.IdentityReference.Value -notin @($sid.Value,$systemSid.Value)){throw 'VPR_ACL'}
            $seen+=$rule.IdentityReference.Value
        }
        if(@($seen | Sort-Object -Unique).Count -ne 2){throw 'VPR_ACL'}
    }
    $root=Join-Path $workspace '.local-vector-repair'
    $run=Join-Path $root $inputObject.runId
    $directory=Join-Path $run $inputObject.slot
    foreach($path in @($root,$run,$directory)){
        Assert-VPRPath $path
        if(-not [IO.Directory]::Exists($path)){
            if($inputObject.operation -eq 'open'){throw 'VPR_MISSING'}
            [void][IO.Directory]::CreateDirectory($path)
            [IO.Directory]::SetAccessControl($path,(New-VPRSecurity $true))
        }
        Assert-VPRAcl $path $true
    }
    $git=Get-Command git.exe -ErrorAction Stop
    $ignored=& $git.Source -C $workspace check-ignore -- (Join-Path $directory 'payload.dpapi') 2>$null
    if($LASTEXITCODE -ne 0 -or -not $ignored){throw 'VPR_GIT_IGNORE'}
    $tracked=& $git.Source -C $workspace ls-files -- $root 2>$null
    if($LASTEXITCODE -ne 0 -or $tracked){throw 'VPR_GIT_TRACKED'}
    if($inputObject.operation -ceq 'initialize'){
        [Console]::Out.Write('{"result":"PASS","initialized":true}')
        exit 0
    }
    $file=Join-Path $directory 'payload.dpapi'
    $entropy=[Text.Encoding]::UTF8.GetBytes('vector-repair-v1|'+$sid.Value+'|'+$file.ToLowerInvariant())
    $plain=$null; $cipher=$null
    try {
        if($inputObject.operation -ceq 'seal'){
            if(@([IO.Directory]::EnumerateFileSystemEntries($directory)).Count -ne 0){throw 'VPR_EXISTS'}
            if($inputObject.payload -isnot [string] -or $inputObject.payload.Length -gt 1048576){throw 'VPR_PAYLOAD'}
            $envelope=@{version=1;project='school-queue-local';synthetic=$true;owner=$sid.Value;path=$file;run=$inputObject.runId;slot=$inputObject.slot;payload=$inputObject.payload}
            $plain=[Text.Encoding]::UTF8.GetBytes(($envelope | ConvertTo-Json -Depth 10 -Compress))
            $cipher=[Security.Cryptography.ProtectedData]::Protect($plain,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
            $stream=[IO.FileStream]::new($file,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
            try{$stream.Write($cipher,0,$cipher.Length);$stream.Flush($true)}finally{$stream.Dispose()}
            [IO.File]::SetAccessControl($file,(New-VPRSecurity $false))
        }
        if(@([IO.Directory]::EnumerateFileSystemEntries($directory)).Count -ne 1){throw 'VPR_INVENTORY'}
        Assert-VPRAcl $file $false
        $cipher=[IO.File]::ReadAllBytes($file)
        if($cipher.Length -gt 2097152){throw 'VPR_CIPHER_BOUND'}
        if($null -ne $plain){[Array]::Clear($plain,0,$plain.Length)}
        $plain=[Security.Cryptography.ProtectedData]::Unprotect($cipher,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
        $opened=[Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json
        if($opened.version -ne 1 -or $opened.project -cne 'school-queue-local' -or $opened.synthetic -ne $true -or
            $opened.owner -cne $sid.Value -or $opened.path -cne $file -or $opened.run -cne $inputObject.runId -or $opened.slot -cne $inputObject.slot){throw 'VPR_BINDING'}
        if($inputObject.operation -ceq 'seal'){
            if($opened.payload -cne $inputObject.payload){throw 'VPR_READBACK'}
            [Console]::Out.Write('{"result":"PASS","stored":true,"readback":true}')
        }else{
            # This stdout is a private captured pipe, never an operator receipt.
            [Console]::Out.Write((@{result='PASS';payload=$opened.payload} | ConvertTo-Json -Depth 10 -Compress))
        }
    }finally{
        if($null -ne $plain){[Array]::Clear($plain,0,$plain.Length)}
        if($null -ne $cipher){[Array]::Clear($cipher,0,$cipher.Length)}
        [Array]::Clear($entropy,0,$entropy.Length)
        $opened=$null; $request=$null; $inputObject=$null
    }
}catch{
    [Console]::Error.WriteLine('VPR_STORAGE_REJECTED')
    exit 1
}
