# Dot-sourced only inside LocalGoogleCredential. No automatic service operation.
function Get-LGAPath([string]$RunId) {
    Assert-LCGWorkspace
    if ($RunId -cnotmatch '^[0-9a-f]{8}\z') { Stop-LCG 'LGA_RUN_ID' }
    $path=Join-Path $script:Workspace ('.local-google-activation\'+$RunId)
    $cursor=$path
    while ($cursor.Length -ge $script:Workspace.Length) {
        if ([IO.Directory]::Exists($cursor) -or [IO.File]::Exists($cursor)) {
            if ([IO.File]::GetAttributes($cursor) -band [IO.FileAttributes]::ReparsePoint) { Stop-LCG 'LGA_REPARSE' }
        }
        if ($cursor -eq $script:Workspace) { break }; $cursor=[IO.Path]::GetDirectoryName($cursor)
    }
    return $path
}
function Assert-LGAProtection([string]$RunId) {
    $path=Get-LGAPath $RunId
    if (-not [IO.Directory]::Exists($path)) { Stop-LCG 'LGA_DIRECTORY' }
    $sid=(Get-LCGSid).Value
    $root=[IO.Path]::GetDirectoryName($path)
    $items=@($root,$path)+@([IO.Directory]::EnumerateFileSystemEntries($path,'*',[IO.SearchOption]::AllDirectories))
    foreach ($item in $items) {
        if ([IO.File]::GetAttributes($item) -band [IO.FileAttributes]::ReparsePoint) { Stop-LCG 'LGA_REPARSE' }
        $acl=if ([IO.Directory]::Exists($item)) { [IO.Directory]::GetAccessControl($item) } else { [IO.File]::GetAccessControl($item) }
        if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $sid -or
            ($item -in @($root,$path) -and -not $acl.AreAccessRulesProtected)) { Stop-LCG 'LGA_OWNER' }
        $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
        if ($rules.Count -ne 2) { Stop-LCG 'LGA_ACL' }
        $principals=@($rules | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)
        if ($principals.Count -ne 2 -or $sid -notin $principals -or 'S-1-5-18' -notin $principals) { Stop-LCG 'LGA_ACL' }
        foreach ($rule in $rules) {
            if ($rule.AccessControlType -ne 'Allow' -or $rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl) { Stop-LCG 'LGA_ACL' }
        }
    }
    $git=Get-LCGExecutable 'git.exe'
    $info=New-LCGProcessInfo $git @('-C',$script:Workspace,'check-ignore','--',(Join-Path $path 'plan.json'))
    $null=Invoke-LGAProcess $info 15000
    $info=New-LCGProcessInfo $git @('-C',$script:Workspace,'ls-files','--',$path)
    if ((Invoke-LGAProcess $info 15000).Trim()) { Stop-LCG 'LGA_TRACKED' }
}
function New-LGADirectory([string]$RunId) {
    $path=Get-LGAPath $RunId
    $root=[IO.Path]::GetDirectoryName($path)
    if (-not [IO.Directory]::Exists($root)) {
        [void][IO.Directory]::CreateDirectory($root)
        [IO.Directory]::SetAccessControl($root,(New-LCGSecurity $true))
    }
    if ([IO.Directory]::Exists($path) -or [IO.File]::Exists($path)) { Stop-LCG 'LGA_DIRECTORY_EXISTS' }
    [void][IO.Directory]::CreateDirectory($path)
    [IO.Directory]::SetAccessControl($path,(New-LCGSecurity $true))
    Assert-LGAProtection $RunId
    return $path
}
function Invoke-LGAProcess([Diagnostics.ProcessStartInfo]$Info, [int]$Timeout=180000) {
    $process=[Diagnostics.Process]::new(); $process.StartInfo=$Info
    try {
        if (-not $process.Start()) { Stop-LCG 'LGA_CHILD_START' }
        $outTask=$process.StandardOutput.ReadToEndAsync(); $errTask=$process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($Timeout)) {
            # Kill only this owned child tree. Never leave a detached CLI retry running.
            $killer=New-LCGProcessInfo (Join-Path $env:SystemRoot 'System32\taskkill.exe') @('/PID',[string]$process.Id,'/T','/F')
            $kill=[Diagnostics.Process]::Start($killer)
            try { [void]$kill.WaitForExit(10000) } finally { $kill.Dispose() }
            Stop-LCG 'LGA_CHILD_TIMEOUT_INDETERMINATE'
        }
        $stdout=$outTask.Result; $stderr=$errTask.Result
        if ($process.ExitCode -ne 0 -or $stdout.Length -gt 2097152 -or $stderr.Length -gt 2097152) { Stop-LCG 'LGA_CHILD_FAILED' }
        return $stdout # Private caller validates. Never forward arbitrary CLI diagnostics.
    } finally {
        $Info.EnvironmentVariables.Remove($script:ClientVariable); $Info.EnvironmentVariables.Remove($script:SecretVariable)
        $process.Dispose()
    }
}
function Invoke-LGABridge([string]$Operation,[string]$RunId,[string]$Approved='') {
    if ($Operation -notin @('prepare','arm','write-config','restore-config','volumes','postcheck','rollback-check','acceptance','rollback-arm')) { Stop-LCG 'LGA_OPERATION' }
    $null=Get-LGAPath $RunId
    $arguments=@('-B',(Join-Path $script:Workspace 'supabase\tests\google_activation_workflow.py'),$Operation,'--run-id',$RunId)
    if ($Operation -ne 'prepare') {
        if ($Approved -cnotmatch '^[0-9a-f]{64}\z') { Stop-LCG 'LGA_EXPLICIT_APPROVAL' }
        $arguments+=@('--approved-plan',$Approved)
    }
    Assert-LGAProtection $RunId
    $info=New-LCGProcessInfo (Get-LCGExecutable 'python.exe') $arguments
    $receipt=(Invoke-LGAProcess $info 300000) | ConvertFrom-Json
    if ($receipt.result -cne 'PASS') { Stop-LCG 'LGA_BRIDGE_RECEIPT' }
    return $receipt
}
function Invoke-LGAService([string]$Operation,$Credentials) {
    $cli=Join-Path $script:Workspace 'node_modules\supabase\dist\supabase.js'
    if ($Operation -ceq 'start') { $arguments=@($cli,'start','--workdir',$script:Workspace,'--network-id','supabase_network_school-queue-local') }
    elseif ($Operation -ceq 'stop') { $arguments=@($cli,'stop','--project-id','school-queue-local','--workdir',$script:Workspace) }
    else { Stop-LCG 'LGA_SERVICE_COMMAND' }
    Assert-LCGPlannedArguments $Operation $arguments
    $info=New-LCGProcessInfo (Get-LCGExecutable 'node.exe') $arguments
    if ($Operation -ceq 'start' -and $null -ne $Credentials) {
        Assert-LCGCredentials $Credentials
        $info.EnvironmentVariables[$script:ClientVariable]=$Credentials.ClientId
        $info.EnvironmentVariables[$script:SecretVariable]=$Credentials.ClientSecret
    }
    $null=Invoke-LGAProcess $info 300000
}
function Assert-LGAProviderCredential($Credentials) {
    $info=New-LCGProcessInfo (Get-LCGExecutable 'docker.exe') @('inspect','supabase_auth_school-queue-local')
    $item=@((Invoke-LGAProcess $info 15000) | ConvertFrom-Json)[0]
    $values=@{}
    foreach ($entry in $item.Config.Env) { $parts=$entry.Split(@('='),2); $values[$parts[0]]=$parts[1] }
    if ($values['GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID'] -cne $Credentials.ClientId -or
        $values['GOTRUE_EXTERNAL_GOOGLE_SECRET'] -cne $Credentials.ClientSecret) { Stop-LCG 'LGA_EFFECTIVE_CREDENTIAL' }
    $values=$null; $item=$null
}
function Assert-LGABundleSecretAbsent($Credentials) {
    $files=@([IO.Directory]::EnumerateFiles((Join-Path $script:Workspace 'dist'),'*.js',[IO.SearchOption]::AllDirectories))
    if (-not $files.Count) { Stop-LCG 'LGA_BUILD_MISSING' }
    foreach ($file in $files) {
        $text=[IO.File]::ReadAllText($file)
        if ($text.Contains($Credentials.ClientSecret) -or $text.Contains($Credentials.ClientId)) { Stop-LCG 'LGA_FRONTEND_CREDENTIAL' }
    }
    $text=$null
}
function Invoke-LGASequence($Steps,[bool]$Rollback=$false) {
    # Private dependency boundary: tests supply disposable children; public callers
    # have no injection parameter and always receive the fixed steps below.
    $written=$false
    try {
        foreach ($step in @('Check','Write','Stop','Volumes','Start','Verify','Acceptance','FinalVerify')) {
            & $Steps.Record $step 'BEGIN'
            & $Steps[$step]
            if ($step -eq 'Write') { $written=$true }
            & $Steps.Record $step 'PASS'
        }
        & $Steps.Record 'Complete' 'PASS'
        return [pscustomobject]@{Result='PASS';Mode=$(if($Rollback){'ROLLBACK_VERIFIED'}else{'ACTIVATION_VERIFIED'});RealLoginExecuted=$false}
    } catch {
        # Restore only configuration bytes after a failed activation. Do not retry
        # services or restore a database automatically. Effective state may be mixed.
        $restored=$false
        if ($written -and -not $Rollback) { try { & $Steps.Restore; $restored=$true } catch { } }
        & $Steps.Record $(if($restored){'StoppedConfigRestored'}else{'StoppedReviewRequired'}) 'FAIL'
        throw [InvalidOperationException]::new($(if($restored){'LGA_STOPPED_CONFIG_RESTORED_SERVICES_REQUIRE_REVIEW'}else{'LGA_STOPPED_REVIEW_REQUIRED'}))
    }
}
function Write-LGAEvent([string]$RunId,[string]$Phase,[string]$Result) {
    if ($Phase -notin @('Check','Write','Stop','Volumes','Start','Verify','Acceptance','FinalVerify','Complete','StoppedConfigRestored','StoppedReviewRequired') -or
        $Result -notin @('BEGIN','PASS','FAIL')) { Stop-LCG 'LGA_EVENT' }
    Assert-LGAProtection $RunId
    $file=Join-Path (Get-LGAPath $RunId) 'execution.jsonl'
    $line=[pscustomobject]@{Phase=$Phase;Result=$Result;AtUtc=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Compress
    [IO.File]::AppendAllText($file,$line+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
}
function Invoke-LocalGoogleAuthPreparation {
    $null=Invoke-LocalGoogleAuthPreview
    $value=$null
    try {
        $value=Read-LCGCredential (Get-LCGLocation)
        Assert-LGABundleSecretAbsent $value
    } finally { $value=$null }
    $id=[Guid]::NewGuid().ToString('N').Substring(0,8)
    $null=New-LGADirectory $id
    $receipt=Invoke-LGABridge 'prepare' $id
    $receipt | Add-Member -NotePropertyName ExistingBundleRealCredentialScan -NotePropertyValue 'PASS'
    Assert-LGAProtection $id
    return $receipt
}
function Invoke-LocalGoogleAuthActivation([string]$RunId,[string]$ApprovedPlan,[bool]$Rollback=$false) {
    # Step 22.8 stopped at an existing service-health prerequisite. No activation
    # or rollback execution is certified; there is intentionally no bypass switch.
    Stop-LCG 'LGA_REHEARSAL_NOT_CERTIFIED'
    if ($ApprovedPlan -cnotmatch '^[0-9a-f]{64}\z') { Stop-LCG 'LGA_EXPLICIT_APPROVAL' }
    Assert-LGAProtection $RunId
    $location=Get-LCGLocation
    $value=$null
    try {
        if (-not $Rollback) { $value=Read-LCGCredential $location }
        $steps=@{
            Record={ param($phase,$result) Write-LGAEvent $RunId $phase $result }
            Check={ $null=Invoke-LGABridge $(if($Rollback){'rollback-arm'}else{'arm'}) $RunId $ApprovedPlan }
            Write={ $null=Invoke-LGABridge $(if($Rollback){'restore-config'}else{'write-config'}) $RunId $ApprovedPlan }
            Stop={ Invoke-LGAService 'stop' $null }
            Volumes={ $null=Invoke-LGABridge 'volumes' $RunId $ApprovedPlan }
            Start={ Invoke-LGAService 'start' $value }
            Verify={
                if (-not $Rollback) { Assert-LGAProviderCredential $value }
                $null=Invoke-LGABridge $(if($Rollback){'rollback-check'}else{'postcheck'}) $RunId $ApprovedPlan
            }
            Acceptance={
                $null=Invoke-LGABridge 'acceptance' $RunId $ApprovedPlan
                if (-not $Rollback) { Assert-LGABundleSecretAbsent $value }
            }
            FinalVerify={ $null=Invoke-LGABridge $(if($Rollback){'rollback-check'}else{'postcheck'}) $RunId $ApprovedPlan }
            Restore={ $null=Invoke-LGABridge 'restore-config' $RunId $ApprovedPlan }
        }
        return Invoke-LGASequence $steps $Rollback
    } finally { $value=$null }
}
