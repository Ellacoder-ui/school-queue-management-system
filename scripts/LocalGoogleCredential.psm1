# Windows PowerShell 5.1. Preview is default; activation is separately confirmed.
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$script:Workspace = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$script:ExpectedWorkspace = 'C:\Users\Hp\school-queue-management-system'
$script:ClientVariable = 'SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID'
$script:SecretVariable = 'SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET'

function Stop-LCG([string]$Code) { throw [InvalidOperationException]::new($Code) }
function Get-LocalGoogleErrorCode($Record) {
    $message = $Record.Exception.Message
    if ($message -cmatch '^LCG_[A-Z_]+\z') { return $message }
    return 'LCG_OPERATION_REJECTED'
}
function Assert-LCGWorkspace([string]$Path = $script:Workspace) {
    if ([Environment]::OSVersion.Platform -ne 'Win32NT' -or
        $PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -lt 1 -or
        $PSVersionTable.PSEdition -ne 'Desktop' -or
        -not [string]::Equals([IO.Path]::GetFullPath($Path), $script:ExpectedWorkspace, 'OrdinalIgnoreCase') -or
        -not [string]::Equals((Get-Location).ProviderPath, $script:ExpectedWorkspace, 'OrdinalIgnoreCase')) {
        Stop-LCG 'LCG_WORKSPACE'
    }
}
function Get-LCGSid { return [Security.Principal.WindowsIdentity]::GetCurrent().User }
function Get-LCGLocation([string]$SyntheticTestRunId = '') {
    Assert-LCGWorkspace
    if ($SyntheticTestRunId) {
        if ($SyntheticTestRunId -cnotmatch '^[0-9a-f]{8}\z') { Stop-LCG 'LCG_TEST_ID' }
        $directory = Join-Path $script:Workspace ('.local-credential-tests\' + $SyntheticTestRunId)
    } else { $directory = Join-Path $script:Workspace '.local-secrets' }
    return @{ Directory=$directory; File=(Join-Path $directory 'google-local.dpapi'); Synthetic=[bool]$SyntheticTestRunId }
}
function Assert-LCGPath([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path)
    if (-not $full.StartsWith($script:Workspace + '\', [StringComparison]::OrdinalIgnoreCase)) { Stop-LCG 'LCG_STORAGE_PATH' }
    $relative = $full.Substring($script:Workspace.Length)
    if (-not $full.StartsWith($script:Workspace + '\', [StringComparison]::OrdinalIgnoreCase) -or
        $relative -cnotmatch '^\\(\.local-secrets|\.local-credential-tests\\[0-9a-f]{8}(\\[a-z0-9_-]+)?)(\\google-local\.dpapi)?\z') {
        Stop-LCG 'LCG_STORAGE_PATH'
    }
    $cursor = $full
    while ($cursor.Length -ge $script:Workspace.Length) {
        if ([IO.Directory]::Exists($cursor) -or [IO.File]::Exists($cursor)) {
            if ([IO.File]::GetAttributes($cursor) -band [IO.FileAttributes]::ReparsePoint) { Stop-LCG 'LCG_REPARSE_POINT' }
        }
        if ($cursor -eq $script:Workspace) { break }
        $cursor = [IO.Path]::GetDirectoryName($cursor)
    }
}
function New-LCGSecurity([bool]$Directory) {
    if ($Directory) { $acl = [Security.AccessControl.DirectorySecurity]::new() }
    else { $acl = [Security.AccessControl.FileSecurity]::new() }
    $acl.SetOwner((Get-LCGSid))
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($sid in @((Get-LCGSid), [Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
        if ($Directory) {
            $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        } else { $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'Allow') }
        [void]$acl.AddAccessRule($rule)
    }
    return $acl
}
function Assert-LCGSecurity([string]$Path, [bool]$Directory) {
    Assert-LCGPath $Path
    if ($Directory) { $acl = [IO.Directory]::GetAccessControl($Path) }
    else { $acl = [IO.File]::GetAccessControl($Path) }
    $sid = (Get-LCGSid).Value
    if (-not $acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid) {
        Stop-LCG 'LCG_ACL_OWNER_OR_INHERITANCE'
    }
    $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
    $principals = @($rules | ForEach-Object { $_.IdentityReference.Value } | Sort-Object -Unique)
    if ($rules.Count -ne 2 -or $principals.Count -ne 2 -or $sid -notin $principals -or 'S-1-5-18' -notin $principals) {
        Stop-LCG 'LCG_UNSAFE_ACL'
    }
    foreach ($rule in $rules) {
        if ($rule.AccessControlType -ne 'Allow' -or $rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl -or $rule.IsInherited) {
            Stop-LCG 'LCG_UNSAFE_ACL'
        }
    }
}
function New-LCGProcessInfo([string]$FileName, [string[]]$Arguments) {
    # All arguments are fixed local paths/flags, with no shell, quoting or secrets.
    foreach ($argument in $Arguments) {
        if ($argument -cnotmatch '^[A-Za-z0-9_./:\\=-]+\z') { Stop-LCG 'LCG_PROCESS_ARGUMENT' }
    }
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName=$FileName; $info.Arguments=[string]::Join(' ', $Arguments)
    $info.WorkingDirectory=$script:Workspace; $info.UseShellExecute=$false
    $info.CreateNoWindow=$true; $info.WindowStyle='Hidden'
    $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true
    foreach ($name in @($info.EnvironmentVariables.Keys)) {
        if ($name -match '^(PG|SUPABASE_|QUEUE_|VITE_)' -or $name -in @('NODE_OPTIONS','PYTHONPATH','PYTHONSTARTUP')) {
            $info.EnvironmentVariables.Remove($name)
        }
    }
    return $info
}
function Get-LCGExecutable([string]$Name) {
    $command = Get-Command -Name $Name -CommandType Application -ErrorAction Stop | Select-Object -First 1
    return $command.Source
}
function Assert-LCGReadArguments([string]$Kind, [string[]]$Arguments, [string]$Target = '') {
    switch ($Kind) {
        'state' { $expected = @('-B', (Join-Path $script:Workspace 'supabase\tests\google_credential_preflight.py'), '--check') }
        'version' { $expected = @((Join-Path $script:Workspace 'node_modules\supabase\dist\supabase.js'), '--version') }
        'startHelp' { $expected = @((Join-Path $script:Workspace 'node_modules\supabase\dist\supabase.js'), 'start', '--help') }
        'stopHelp' { $expected = @((Join-Path $script:Workspace 'node_modules\supabase\dist\supabase.js'), 'stop', '--help') }
        'ignored' { Assert-LCGPath $Target; $expected = @('-C', $script:Workspace, 'check-ignore', '--', $Target) }
        'tracked' { Assert-LCGPath $Target; $expected = @('-C', $script:Workspace, 'ls-files', '--', $Target) }
        default { Stop-LCG 'LCG_COMMAND' }
    }
    if (($Arguments -join "`n") -cne ($expected -join "`n")) { Stop-LCG 'LCG_COMMAND' }
}
function Invoke-LCGReadProcess([string]$Kind, [string[]]$Arguments, [string]$Target = '') {
    Assert-LCGReadArguments $Kind $Arguments $Target
    $program = if ($Kind -in @('ignored','tracked')) { 'git.exe' } elseif ($Kind -eq 'state') { 'python.exe' } else { 'node.exe' }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = New-LCGProcessInfo (Get-LCGExecutable $program) $Arguments
    try {
        if (-not $process.Start()) { Stop-LCG 'LCG_PROCESS' }
        $outTask=$process.StandardOutput.ReadToEndAsync(); $errTask=$process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(45000)) { $process.Kill(); Stop-LCG 'LCG_PROCESS_TIMEOUT' }
        $stdout=$outTask.Result; $stderr=$errTask.Result
        if ($process.ExitCode -ne 0 -or $stderr.Length -gt 1048576 -or $stdout.Length -gt 1048576) { Stop-LCG 'LCG_READ_ONLY_CHECK' }
        # Never surface raw subprocess stderr or unvalidated output.
        return $stdout
    } finally { $process.Dispose() }
}
function Assert-LCGIgnored([string]$Directory) {
    $candidate=Join-Path $Directory 'google-local.dpapi'
    $null = Invoke-LCGReadProcess 'ignored' @('-C',$script:Workspace,'check-ignore','--',$candidate) $candidate
    $tracked = Invoke-LCGReadProcess 'tracked' @('-C',$script:Workspace,'ls-files','--',$Directory) $Directory
    if ($tracked.Trim()) { Stop-LCG 'LCG_TRACKED_CREDENTIAL' }
}
function Initialize-LocalGoogleDirectory([string]$SyntheticTestRunId = '') {
    $location = Get-LCGLocation $SyntheticTestRunId
    Assert-LCGPath $location.Directory
    Assert-LCGIgnored $location.Directory
    if ([IO.Directory]::Exists($location.Directory)) { Assert-LCGSecurity $location.Directory $true }
    else {
        $null = [IO.Directory]::CreateDirectory($location.Directory)
        [IO.Directory]::SetAccessControl($location.Directory, (New-LCGSecurity $true))
        Assert-LCGSecurity $location.Directory $true
    }
    Assert-LCGStorageInventory $location
    return $location
}
function Assert-LCGStorageInventory($Location) {
    $items=@([IO.Directory]::GetFileSystemEntries($Location.Directory))
    if ($items.Count -gt 1 -or ($items.Count -eq 1 -and
        ($items[0] -cne $Location.File -or -not [IO.File]::Exists($Location.File)))) { Stop-LCG 'LCG_UNEXPECTED_STORAGE_FILE' }
    if ([IO.File]::Exists($Location.File)) { Assert-LCGSecurity $Location.File $false }
}
function Assert-LCGCredentials($Credentials) {
    if ($null -eq $Credentials) { Stop-LCG 'LCG_MISSING_CREDENTIAL' }
    $fields=if ($Credentials -is [Collections.IDictionary]) { @($Credentials.Keys) } else { @($Credentials.PSObject.Properties.Name) }
    if ('ClientId' -notin $fields -or 'ClientSecret' -notin $fields -or
        $Credentials.ClientId -isnot [string] -or $Credentials.ClientSecret -isnot [string] -or
        -not $Credentials.ClientId -or -not $Credentials.ClientSecret) { Stop-LCG 'LCG_MISSING_CREDENTIAL' }
    if ($Credentials.ClientId -cmatch 'env\(' -or $Credentials.ClientSecret -imatch 'env\(') { Stop-LCG 'LCG_UNRESOLVED_ENV' }
    if ($Credentials.ClientId.Length -gt 255 -or $Credentials.ClientId -cnotmatch '^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com\z' -or
        $Credentials.ClientSecret.Length -lt 24 -or $Credentials.ClientSecret.Length -gt 4096 -or
        $Credentials.ClientSecret -cnotmatch '^[\x21-\x7e]+\z') { Stop-LCG 'LCG_CREDENTIAL_FORMAT' }
}
function Get-LCGEntropy([string]$File) {
    return ,([Text.Encoding]::UTF8.GetBytes('SchoolQueue.Google.v1|' + (Get-LCGSid).Value + '|' + $File.ToLowerInvariant()))
}
function Read-LCGCredential($Location) {
    Assert-LCGSecurity $Location.Directory $true
    Assert-LCGStorageInventory $Location
    if (-not [IO.File]::Exists($Location.File)) { Stop-LCG 'LCG_MISSING_FILE' }
    Assert-LCGSecurity $Location.File $false
    $length = ([IO.FileInfo]::new($Location.File)).Length
    if ($length -lt 32 -or $length -gt 65536) { Stop-LCG 'LCG_CIPHERTEXT_SIZE' }
    $clear = $null
    try {
        try { $clear = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($Location.File),
                (Get-LCGEntropy $Location.File), [Security.Cryptography.DataProtectionScope]::CurrentUser) }
        catch { Stop-LCG 'LCG_DECRYPT' }
        try { $value = [Text.Encoding]::UTF8.GetString($clear) | ConvertFrom-Json -ErrorAction Stop }
        catch { Stop-LCG 'LCG_PAYLOAD' }
        $fields = @($value.PSObject.Properties.Name | Sort-Object)
        if (($fields -join ',') -cne 'ClientId,ClientSecret,File,OwnerSid,Project,Synthetic,Version' -or
            $value.Version -ne 1 -or $value.Project -cne 'school-queue-local' -or $value.OwnerSid -cne (Get-LCGSid).Value -or
            $value.File -cne $Location.File -or $value.Synthetic -isnot [bool] -or $value.Synthetic -ne $Location.Synthetic) {
            Stop-LCG 'LCG_PAYLOAD_BINDING'
        }
        Assert-LCGCredentials $value
        return $value
    } finally { if ($null -ne $clear) { [Array]::Clear($clear,0,$clear.Length) } }
}
function Write-LCGCredential($Location, [Security.SecureString]$ClientId, [Security.SecureString]$ClientSecret) {
    Assert-LCGSecurity $Location.Directory $true
    Assert-LCGIgnored $Location.Directory
    if ([IO.File]::Exists($Location.File) -or [IO.Directory]::Exists($Location.File)) { Stop-LCG 'LCG_OVERWRITE_REJECTED' }
    $idPointer=[IntPtr]::Zero; $secretPointer=[IntPtr]::Zero; $bytes=$null
    try {
        $idPointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($ClientId)
        $secretPointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($ClientSecret)
        $value = [ordered]@{Version=1;Project='school-queue-local';OwnerSid=(Get-LCGSid).Value;File=$Location.File;
            Synthetic=$Location.Synthetic;ClientId=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($idPointer);
            ClientSecret=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)}
        Assert-LCGCredentials $value
        $bytes=[Text.Encoding]::UTF8.GetBytes(($value | ConvertTo-Json -Compress))
        $cipher=[Security.Cryptography.ProtectedData]::Protect($bytes,(Get-LCGEntropy $Location.File),[Security.Cryptography.DataProtectionScope]::CurrentUser)
        # Atomic refusal if a file appeared after the existence check.
        $stream=[IO.FileStream]::new($Location.File,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try { $stream.Write($cipher,0,$cipher.Length); $stream.Flush($true) } finally { $stream.Dispose() }
        [IO.File]::SetAccessControl($Location.File,(New-LCGSecurity $false))
        $verified=Read-LCGCredential $Location
        if ($verified.ClientId -cne $value.ClientId -or $verified.ClientSecret -cne $value.ClientSecret) { Stop-LCG 'LCG_ROUND_TRIP' }
    } catch {
        Stop-LCG (Get-LocalGoogleErrorCode $_)
    } finally {
        if ($idPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($idPointer) }
        if ($secretPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer) }
        if ($null -ne $bytes) { [Array]::Clear($bytes,0,$bytes.Length) }
        $value=$null; $verified=$null
    }
}
function Save-LocalGoogleCredential {
    $location=Initialize-LocalGoogleDirectory
    if ([IO.File]::Exists($location.File)) { Stop-LCG 'LCG_OVERWRITE_REJECTED' }
    $id=$null; $secret=$null
    try {
        $id=Read-Host 'Google Web Client ID (masked, local only)' -AsSecureString
        $secret=Read-Host 'Google Client Secret (masked, local only)' -AsSecureString
        Write-LCGCredential $location $id $secret
    } finally {
        if ($null -ne $id) { $id.Dispose() }; if ($null -ne $secret) { $secret.Dispose() }
    }
}
function Assert-LCGPlannedArguments([string]$Operation, [string[]]$Arguments) {
    $cli=Join-Path $script:Workspace 'node_modules\supabase\dist\supabase.js'
    if ($Operation -eq 'start') { $expected=@($cli,'start','--workdir',$script:Workspace,'--network-id','supabase_network_school-queue-local') }
    elseif ($Operation -eq 'stop') { $expected=@($cli,'stop','--project-id','school-queue-local','--workdir',$script:Workspace) }
    else { Stop-LCG 'LCG_PLANNED_COMMAND' }
    if (($expected -join "`n") -cne ($Arguments -join "`n")) { Stop-LCG 'LCG_PLANNED_COMMAND' }
}
function New-LCGStartInfo($Credentials) {
    Assert-LCGCredentials $Credentials
    $arguments=@((Join-Path $script:Workspace 'node_modules\supabase\dist\supabase.js'),'start','--workdir',$script:Workspace,'--network-id','supabase_network_school-queue-local')
    Assert-LCGPlannedArguments 'start' $arguments
    $info=New-LCGProcessInfo (Get-LCGExecutable 'node.exe') $arguments
    $info.EnvironmentVariables[$script:ClientVariable]=$Credentials.ClientId
    $info.EnvironmentVariables[$script:SecretVariable]=$Credentials.ClientSecret
    return $info # Private preview construction; preview never starts it.
}
function Invoke-LocalGoogleAuthPreview([string]$SyntheticTestRunId = '') {
    $location=Get-LCGLocation $SyntheticTestRunId
    Assert-LCGIgnored $location.Directory
    Assert-LCGSecurity $location.Directory $true
    if (-not [IO.File]::Exists($location.File)) { Stop-LCG 'LCG_MISSING_FILE' }
    Assert-LCGSecurity $location.File $false
    $bridge=Join-Path $script:Workspace 'supabase\tests\google_credential_preflight.py'
    $receipt=(Invoke-LCGReadProcess 'state' @('-B',$bridge,'--check')) | ConvertFrom-Json
    if ($receipt.result -cne 'PASS' -or $receipt.mode -cne 'READ_ONLY_PREFLIGHT' -or
        $receipt.project -cne 'school-queue-local' -or $receipt.api -cne 'http://127.0.0.1:54321' -or
        $receipt.database -cne '127.0.0.1:54322/postgres' -or $receipt.google_enabled -ne $false -or
        $receipt.recovery_run -cne '6e3beebe' -or -not $receipt.fresh_and_historical_artifacts_intact) { Stop-LCG 'LCG_PREFLIGHT_RECEIPT' }
    $cli=Join-Path $script:Workspace 'node_modules\supabase\dist\supabase.js'
    if ((Invoke-LCGReadProcess 'version' @($cli,'--version')).Trim() -cne '2.121.0') { Stop-LCG 'LCG_CLI_VERSION' }
    $startHelp=Invoke-LCGReadProcess 'startHelp' @($cli,'start','--help')
    $stopHelp=Invoke-LCGReadProcess 'stopHelp' @($cli,'stop','--help')
    if ($startHelp -notmatch '--network-id' -or $startHelp -notmatch '--workdir' -or
        $stopHelp -notmatch '--project-id' -or $stopHelp -notmatch '--no-backup') { Stop-LCG 'LCG_CLI_HELP' }
    $value=$null; $info=$null
    try {
        $value=Read-LCGCredential $location
        $info=New-LCGStartInfo $value
        # Deliberately no Process.Start or activation implementation here.
        return [pscustomobject]@{Result='PASS';Mode='PREVIEW_ONLY';SyntheticCredentials=$location.Synthetic;
            RecoveryRun='6e3beebe';CliVersion='2.121.0';CredentialValid=$true;ChildEnvironmentPrepared=$true;
            CredentialChildExecuted=$false;ProviderEnabled=$false;ConfigWritten=$false;ServiceRestarted=$false}
    } finally {
        if ($null -ne $info) { $info.EnvironmentVariables.Remove($script:ClientVariable); $info.EnvironmentVariables.Remove($script:SecretVariable) }
        $value=$null; $info=$null
    }
}
Export-ModuleMember -Function Initialize-LocalGoogleDirectory,Save-LocalGoogleCredential,Invoke-LocalGoogleAuthPreview,Get-LocalGoogleErrorCode
. (Join-Path $PSScriptRoot 'LocalGoogleActivation.ps1')
Export-ModuleMember -Function Invoke-LocalGoogleAuthPreparation,Invoke-LocalGoogleAuthActivation
