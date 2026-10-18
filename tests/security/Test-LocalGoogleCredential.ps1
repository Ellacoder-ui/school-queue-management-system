#requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-f]{8}$')][string]$RunId)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
try {
    if (Test-Path -LiteralPath (Join-Path $taskRoot '.local-secrets\google-local.dpapi')) { throw 'LCG_PRODUCTION_FILE_PRESENT' }
    Import-Module (Join-Path $taskRoot 'scripts\LocalGoogleCredential.psm1') -Force -DisableNameChecking
    $module=Get-Module LocalGoogleCredential
    $result = & $module {
        param($Id)
        $checks=[Collections.Generic.List[object]]::new()
        function Pass([string]$Name) { $script:SyntheticLastPassed=$Name; $checks.Add([pscustomobject]@{Name=$Name;Result='PASS'}) }
        function Check([bool]$Condition) { if (-not $Condition) { throw 'LCG_TEST_ASSERTION' } }
        function Reject([string]$Name,[scriptblock]$Action) {
            $rejected=$false
            try { $null=& $Action } catch { $rejected=$true }
            Check $rejected; Pass $Name
        }
        function CipherHash([string]$File) {
            $sha=[Security.Cryptography.SHA256]::Create()
            try { return [Convert]::ToBase64String($sha.ComputeHash([IO.File]::ReadAllBytes($File))) }
            finally { $sha.Dispose() }
        }
        $location=Get-LCGLocation $Id
        Check (-not [IO.Directory]::Exists($location.Directory))
        $location=Initialize-LocalGoogleDirectory $Id
        $dummyId='000000000000-'+[Guid]::NewGuid().ToString('N')+'.apps.googleusercontent.com'
        $dummySecret='GOCSPX-'+[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
        # Native .NET avoids optional PowerShell.Security autoload dependencies.
        $secureId=[Security.SecureString]::new(); foreach ($character in $dummyId.ToCharArray()) { $secureId.AppendChar($character) }; $secureId.MakeReadOnly()
        $secureSecret=[Security.SecureString]::new(); foreach ($character in $dummySecret.ToCharArray()) { $secureSecret.AppendChar($character) }; $secureSecret.MakeReadOnly()
        try {
            Reject 'missing-file' { Read-LCGCredential $location }
            Write-LCGCredential $location $secureId $secureSecret
            $read=Read-LCGCredential $location
            Check ($read.ClientId -ceq $dummyId -and $read.ClientSecret -ceq $dummySecret -and $read.Synthetic)
            Pass 'DPAPI-CurrentUser-round-trip'
            Assert-LCGSecurity $location.Directory $true; Assert-LCGSecurity $location.File $false
            Pass 'current-user-and-SYSTEM-protected-access'
            $cipher=[IO.File]::ReadAllBytes($location.File)
            $cipherText=[Text.Encoding]::UTF8.GetString($cipher)
            Check (-not $cipherText.Contains($dummyId) -and -not $cipherText.Contains($dummySecret))
            Pass 'ciphertext-has-no-plaintext-canaries'
            $originalHash=CipherHash $location.File
            Reject 'overwrite-rejected' { Write-LCGCredential $location $secureId $secureSecret }
            Check ((CipherHash $location.File) -ceq $originalHash)
            Pass 'overwrite-preserves-original-bytes'

            $originalAcl=[IO.File]::GetAccessControl($location.File)
            try {
                $badAcl=[IO.File]::GetAccessControl($location.File)
                $badAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
                    [Security.Principal.SecurityIdentifier]::new('S-1-1-0'),'Read','Allow'))
                [IO.File]::SetAccessControl($location.File,$badAcl)
                Reject 'unsafe-file-ACL' { Read-LCGCredential $location }
                Reject 'initialization-rejects-existing-unsafe-file' { Initialize-LocalGoogleDirectory $Id }
            } finally { [IO.File]::SetAccessControl($location.File,(New-LCGSecurity $false)); Assert-LCGSecurity $location.File $false }
            try {
                $badAcl=[IO.File]::GetAccessControl($location.File)
                $badAcl.SetAccessRuleProtection($false,$true)
                [IO.File]::SetAccessControl($location.File,$badAcl)
                Reject 'file-inheritance' { Read-LCGCredential $location }
            } finally { [IO.File]::SetAccessControl($location.File,(New-LCGSecurity $false)); Assert-LCGSecurity $location.File $false }
            $directoryAcl=[IO.Directory]::GetAccessControl($location.Directory)
            try {
                $badAcl=[IO.Directory]::GetAccessControl($location.Directory)
                $badAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
                    [Security.Principal.SecurityIdentifier]::new('S-1-1-0'),'Read','Allow'))
                [IO.Directory]::SetAccessControl($location.Directory,$badAcl)
                Reject 'unsafe-directory-ACL' { Read-LCGCredential $location }
            } finally { [IO.Directory]::SetAccessControl($location.Directory,(New-LCGSecurity $true)); Assert-LCGSecurity $location.Directory $true }
            try {
                $value=Read-LCGCredential $location; $value.OwnerSid='S-1-5-18'
                $bytes=[Text.Encoding]::UTF8.GetBytes(($value | ConvertTo-Json -Compress))
                $forged=[Security.Cryptography.ProtectedData]::Protect($bytes,(Get-LCGEntropy $location.File),[Security.Cryptography.DataProtectionScope]::CurrentUser)
                [IO.File]::WriteAllBytes($location.File,$forged)
                Reject 'owner-binding-mismatch' { Read-LCGCredential $location }
                [Array]::Clear($bytes,0,$bytes.Length)
            } finally { [IO.File]::WriteAllBytes($location.File,$cipher) }
            try {
                $damaged=[byte[]]$cipher.Clone(); $damaged[24]=$damaged[24] -bxor 255
                [IO.File]::WriteAllBytes($location.File,$damaged)
                Reject 'tampered-DPAPI-ciphertext' { Read-LCGCredential $location }
            } finally { [IO.File]::WriteAllBytes($location.File,$cipher) }
            Reject 'wrong-DPAPI-entropy' {
                [Security.Cryptography.ProtectedData]::Unprotect($cipher,[byte[]]@(1,2,3),[Security.Cryptography.DataProtectionScope]::CurrentUser)
            }
            Reject 'missing-credential-fields' { Assert-LCGCredentials @{} }
            Reject 'invalid-client-ID' { Assert-LCGCredentials @{ClientId='invalid';ClientSecret=$dummySecret} }
            Reject 'invalid-client-secret' { Assert-LCGCredentials @{ClientId=$dummyId;ClientSecret='short'} }
            Reject 'trailing-newline-client-ID' { Assert-LCGCredentials @{ClientId=($dummyId+[char]10);ClientSecret=$dummySecret} }
            Reject 'trailing-newline-client-secret' { Assert-LCGCredentials @{ClientId=$dummyId;ClientSecret=($dummySecret+[char]10)} }
            Reject 'control-character-process-argument' { New-LCGProcessInfo 'not-executed.exe' @('--help'+[char]10) }
            Reject 'unresolved-client-reference' { New-LCGStartInfo @{ClientId='env(UNSET_CLIENT)';ClientSecret=$dummySecret} }
            Reject 'unresolved-secret-reference' { New-LCGStartInfo @{ClientId=$dummyId;ClientSecret='env(UNSET_SECRET)'} }
            Reject 'wrong-workspace' { Assert-LCGWorkspace 'C:\another-project' }
            Reject 'outside-storage-path' { Assert-LCGPath 'C:\Users\Hp\outside.dpapi' }
            Reject 'invalid-test-identity' { Get-LCGLocation '..\..\outside' }
            Assert-LCGIgnored $location.Directory; Pass 'Git-ignore-and-untracked-store'
            $unexpected=Join-Path $location.Directory 'unexpected.dpapi'
            try {
                [IO.File]::WriteAllBytes($unexpected,[byte[]]@(1,2,3))
                Reject 'unexpected-existing-artifact' { Initialize-LocalGoogleDirectory $Id }
                Reject 'credential-read-rejects-unexpected-artifact' { Read-LCGCredential $location }
            } finally { [IO.File]::Delete($unexpected) }
            $cli=Join-Path $script:Workspace 'node_modules\supabase\dist\supabase.js'
            foreach ($bad in @('start','stop','db','link')) {
                $badArguments=@($cli,$bad)
                Reject ('read-only-command-denies-'+$bad) { Assert-LCGReadArguments 'startHelp' $badArguments }
            }
            $safeStart=@($cli,'start','--workdir',$script:Workspace,'--network-id','supabase_network_school-queue-local')
            Assert-LCGPlannedArguments 'start' $safeStart
            Pass 'exact-planned-start-specification'
            foreach ($flag in @('--no-backup','--all','--ignore-health-check','--exclude')) {
                Reject ('unsafe-planned-flag-'+$flag.TrimStart('-')) { Assert-LCGPlannedArguments 'start' ($safeStart+@($flag)) }
            }
            Reject 'wrong-planned-network' { Assert-LCGPlannedArguments 'start' @($cli,'start','--workdir',$script:Workspace,'--network-id','other-network') }
            Reject 'unknown-command-kind' { Assert-LCGReadArguments 'activate' @() }
            try { throw ('untrusted diagnostic '+$dummySecret) } catch { $safe=Get-LocalGoogleErrorCode $_ }
            Check ($safe -ceq 'LCG_OPERATION_REJECTED' -and -not $safe.Contains($dummySecret))
            Pass 'diagnostic-redaction'
            $ambientNames=@(('VITE_LCG_TEST_'+$Id),('PG_LCG_TEST_'+$Id),('SUPABASE_LCG_TEST_'+$Id))
            foreach ($name in $ambientNames) { [Environment]::SetEnvironmentVariable($name,'synthetic-ambient-marker','Process') }
            $info=New-LCGStartInfo $read
            Check ($info.EnvironmentVariables[$script:ClientVariable] -ceq $dummyId -and
                $info.EnvironmentVariables[$script:SecretVariable] -ceq $dummySecret -and
                -not $info.Arguments.Contains($dummySecret) -and -not $info.Arguments.Contains($dummyId))
            Pass 'planned-environment-only-no-commandline-values'
            # Test the child environment using a dummy-only probe, NEVER the CLI start spec.
            $info.FileName=Get-LCGExecutable 'powershell.exe'
            $probe=Join-Path $script:Workspace 'tests\security\credential_child_probe.ps1'
            $info.Arguments='-NoProfile -NonInteractive -File '+$probe
            $child=[Diagnostics.Process]::new(); $child.StartInfo=$info
            try {
                Check ($child.Start())
                $childOut=$child.StandardOutput.ReadToEndAsync(); $childErr=$child.StandardError.ReadToEndAsync()
                Check ($child.WaitForExit(15000)); Check ($child.ExitCode -eq 0)
                $out=$childOut.Result; $err=$childErr.Result
                Check (-not $out.Contains($dummySecret) -and -not $out.Contains($dummyId) -and
                    -not $err.Contains($dummySecret) -and -not $err.Contains($dummyId))
                $probeResult=$out | ConvertFrom-Json
                Check ($probeResult.ClientPresent -and $probeResult.SecretPresent -and $probeResult.ViteAbsent -and
                    $probeResult.PgAbsent -and $probeResult.SupabaseVariableCount -eq 2)
                Pass 'actual-dummy-child-environment-and-console-redaction'
                foreach ($name in $ambientNames) { Check ([Environment]::GetEnvironmentVariable($name,'Process') -ceq 'synthetic-ambient-marker') }
                Pass 'parent-environment-unchanged-by-child-injection'
            } finally {
                $child.Dispose(); $info.EnvironmentVariables.Clear()
                foreach ($name in $ambientNames) { [Environment]::SetEnvironmentVariable($name,$null,'Process') }
            }
            $preview=Invoke-LocalGoogleAuthPreview -SyntheticTestRunId $Id
            Check ($preview.Result -ceq 'PASS' -and $preview.Mode -ceq 'PREVIEW_ONLY' -and $preview.SyntheticCredentials -and
                -not $preview.CredentialChildExecuted -and -not $preview.ProviderEnabled -and -not $preview.ServiceRestarted -and -not $preview.ConfigWritten)
            Pass 'full-live-read-only-preview-with-dummy-store'
            $assetCount=0
            foreach ($asset in @(Get-ChildItem -LiteralPath (Join-Path $script:Workspace 'dist') -Recurse -File -ErrorAction Stop)) {
                $content=[Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($asset.FullName))
                Check (-not $content.Contains($dummyId) -and -not $content.Contains($dummySecret)); $assetCount++
            }
            Check ($assetCount -gt 0); Pass 'existing-frontend-assets-canary-scan'
            $summary=[pscustomobject]@{Result='PASS';RunId=$Id;Passed=$checks.Count;Failed=0;
                Skipped=@('Actual separate Windows-account DPAPI/access test: no second user/profile provisioned');
                Checks=@($checks.ToArray());FrontendArtifactsScanned=$assetCount;
                RealGoogleCredentialHandled=$false;ProductionCredentialCreated=$false;ServiceRestarted=$false}
            $json=$summary | ConvertTo-Json -Depth 5 -Compress
            Check (-not $json.Contains($dummyId) -and -not $json.Contains($dummySecret))
            return $json
        } finally {
            $secureId.Dispose(); $secureSecret.Dispose()
            $read=$null; $dummyId=$null; $dummySecret=$null
        }
    } $RunId
    [Console]::WriteLine($result)
} catch {
    $failure=$_
    $frames=@([regex]::Matches($failure.ScriptStackTrace,'at ([A-Za-z0-9_<>-]+), [^\r\n]*: line ([0-9]+)') | ForEach-Object {
        @{Function=$_.Groups[1].Value;Line=[int]$_.Groups[2].Value}
    })
    $exceptionType=$failure.Exception.GetType().Name
    $command='unrecognized-command'
    if ([string]$failure.TargetObject -in @('Get-LCGLocation','Initialize-LocalGoogleDirectory','Check','Pass','Reject','ConvertTo-SecureString','Read-LCGCredential','Invoke-LCGReadProcess')) {
        $command=[string]$failure.TargetObject
    }
    $code=if (Get-Command Get-LocalGoogleErrorCode -ErrorAction SilentlyContinue) { Get-LocalGoogleErrorCode $failure } else { 'LCG_TEST_IMPORT' }
    $last='none'
    if ($null -ne (Get-Module LocalGoogleCredential)) {
        $last=& (Get-Module LocalGoogleCredential) { $v=Get-Variable SyntheticLastPassed -Scope Script -ErrorAction SilentlyContinue; if ($v) { $v.Value } else { 'none' } }
    }
    [Console]::Error.WriteLine((@{Result='FAIL';Code=$code;LastPassingCheck=$last;RunId=$RunId;
        ExceptionType=$exceptionType;Frames=$frames;CommandCategory=$command} | ConvertTo-Json -Depth 4 -Compress))
    exit 1
}
