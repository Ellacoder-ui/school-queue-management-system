#requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$RunId)
$ErrorActionPreference='Stop'
try {
    Import-Module (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'scripts\LocalGoogleCredential.psm1') -Force -DisableNameChecking
    $module=Get-Module LocalGoogleCredential
    $result=& $module {
        param($Id)
        $checks=[Collections.Generic.List[object]]::new()
        function Pass($name) { $script:LGATestLastPassed=$name; $checks.Add([pscustomobject]@{Name=$name;Result='PASS'}) }
        function Check($value) { if (-not $value) { throw 'LGA_TEST_ASSERTION' } }
        function Reject($name,[scriptblock]$action) {
            $failed=$false
            try { $null=& $action } catch {
                $failed=$true
                Check (-not $_.ToString().Contains($dummySecret) -and -not $_.ToString().Contains($dummyId))
            }
            Check $failed; Pass $name
        }
        $path=Get-LGAPath $Id; Assert-LGAProtection $Id
        $testId=[Guid]::NewGuid().ToString('N').Substring(0,8)
        $location=Initialize-LocalGoogleDirectory $testId
        $dummyId='000000000000-'+[Guid]::NewGuid().ToString('N')+'.apps.googleusercontent.com'
        $dummySecret='GOCSPX-'+[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
        $sid=[Security.SecureString]::new(); foreach ($c in $dummyId.ToCharArray()) { $sid.AppendChar($c) }; $sid.MakeReadOnly()
        $secret=[Security.SecureString]::new(); foreach ($c in $dummySecret.ToCharArray()) { $secret.AppendChar($c) }; $secret.MakeReadOnly()
        try {
            Reject 'missing-disposable-credential' { Read-LCGCredential $location }
            Write-LCGCredential $location $sid $secret
            $credentials=Read-LCGCredential $location
            Check ($credentials.Synthetic -and $credentials.ClientId -ceq $dummyId -and $credentials.ClientSecret -ceq $dummySecret)
            Pass 'dummy-DPAPI-source-only'
            $cipher=[IO.File]::ReadAllBytes($location.File)
            try {
                [IO.File]::WriteAllBytes($location.File,[byte[]]@(1,2,3))
                Reject 'corrupt-disposable-credential' { Read-LCGCredential $location }
            } finally { [IO.File]::WriteAllBytes($location.File,$cipher) }
            $original=[IO.File]::ReadAllBytes((Join-Path $path 'config.original.toml'))
            $proposed=[IO.File]::ReadAllBytes((Join-Path $path 'config.proposed.toml'))

            # The installed CLI parses/resolves both proposals in isolated workdirs.
            # status is read-only; dummy credentials go only into that CLI child.
            $status=@{}
            foreach ($variant in @('original','proposed')) {
                $arguments=@((Join-Path $script:Workspace 'node_modules\supabase\dist\supabase.js'),'status','--workdir',(Join-Path $path $variant),'--output','json')
                $info=New-LCGProcessInfo (Get-LCGExecutable 'node.exe') $arguments
                $info.EnvironmentVariables[$script:ClientVariable]=$dummyId
                $info.EnvironmentVariables[$script:SecretVariable]=$dummySecret
                $status[$variant]=(Invoke-LGAProcess $info 30000) | ConvertFrom-Json
            }
            Check (($status.original | ConvertTo-Json -Depth 10 -Compress) -ceq ($status.proposed | ConvertTo-Json -Depth 10 -Compress))
            Pass 'pinned-CLI-actual-proposal-schema-and-key-preservation'
            # Postchecks do not receive provider credentials. Certify that this same
            # CLI can read local status with unresolved provider refs, without logging it.
            $info=New-LCGProcessInfo (Get-LCGExecutable 'node.exe') @((Join-Path $script:Workspace 'node_modules\supabase\dist\supabase.js'),'status','--workdir',(Join-Path $path 'proposed'),'--output','json')
            $noCredentialStatus=(Invoke-LGAProcess $info 30000) | ConvertFrom-Json
            Check (($noCredentialStatus | ConvertTo-Json -Depth 10 -Compress) -ceq ($status.original | ConvertTo-Json -Depth 10 -Compress))
            Pass 'postcheck-status-needs-no-provider-secret'

            $testRoot=Join-Path $path ('rehearsal_'+$testId)
            [void][IO.Directory]::CreateDirectory($testRoot)
            $fakeConfig=Join-Path $testRoot 'config.toml'
            $stateFile=Join-Path $testRoot 'simulated-service.json'
            $probe=Join-Path $script:Workspace 'tests\security\activation_child_probe.ps1'
            $events=[Collections.Generic.List[string]]::new()
            function Child($operation,[bool]$failStart=$false,[bool]$noCredentials=$false) {
                $args=@('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$probe,'-StatePath',$stateFile,'-Operation',$operation)
                if ($failStart) { $args+='-FailStart' }
                if ($noCredentials) { $args+='-NoCredentials' }
                $info=New-LCGProcessInfo (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') $args
                if ($operation -eq 'start' -and -not $noCredentials) {
                    $info.EnvironmentVariables[$script:ClientVariable]=$credentials.ClientId
                    $info.EnvironmentVariables[$script:SecretVariable]=$credentials.ClientSecret
                }
                $null=Invoke-LGAProcess $info 15000
                Check (-not $info.EnvironmentVariables.ContainsKey($script:ClientVariable) -and -not $info.EnvironmentVariables.ContainsKey($script:SecretVariable))
            }
            function ResetFixture {
                [IO.File]::WriteAllBytes($fakeConfig,$original)
                [IO.File]::WriteAllText($stateFile,'{"Volume":"disposable-simulated-volume","BusinessRows":39,"Running":true,"Starts":0,"Stops":0}')
                $events.Clear()
            }
            function Steps($failure='', [bool]$rollback=$false) {
                return @{
                    Record={ param($p,$r) $events.Add($p+':'+$r) }.GetNewClosure()
                    Check={ if ($failure -eq 'Check') { throw 'LGA_FAKE_BACKUP_FAILURE' } }.GetNewClosure()
                    Write={ [IO.File]::WriteAllBytes($fakeConfig,$(if($rollback){$original}else{$proposed})) }.GetNewClosure()
                    Stop={ Child 'stop'; if ($failure -eq 'Stop') { throw 'LGA_FAKE_PARTIAL_STOP' } }.GetNewClosure()
                    Volumes={ if ($failure -eq 'Volumes') { throw 'LGA_FAKE_MISSING_VOLUME' } }.GetNewClosure()
                    Start={ Child 'start' ($failure -eq 'Start') $rollback }.GetNewClosure()
                    Verify={ if ($failure -eq 'Verify') { throw 'LGA_FAKE_SETTING_MISMATCH' } }.GetNewClosure()
                    Acceptance={ if ($failure -eq 'Acceptance') { throw 'LGA_FAKE_TEST_FAILURE' } }.GetNewClosure()
                    FinalVerify={ if ($failure -eq 'FinalVerify') { throw 'LGA_FAKE_FINAL_DRIFT' } }.GetNewClosure()
                    Restore={ [IO.File]::WriteAllBytes($fakeConfig,$original) }.GetNewClosure()
                }
            }
            ResetFixture
            $success=Invoke-LGASequence (Steps)
            $state=[IO.File]::ReadAllText($stateFile) | ConvertFrom-Json
            Check ($success.Result -eq 'PASS' -and $state.Starts -eq 1 -and $state.Stops -eq 1 -and $state.Running -and $state.BusinessRows -eq 39)
            Check (($events -join ',') -ceq 'Check:BEGIN,Check:PASS,Write:BEGIN,Write:PASS,Stop:BEGIN,Stop:PASS,Volumes:BEGIN,Volumes:PASS,Start:BEGIN,Start:PASS,Verify:BEGIN,Verify:PASS,Acceptance:BEGIN,Acceptance:PASS,FinalVerify:BEGIN,FinalVerify:PASS,Complete:PASS')
            Pass 'actual-dummy-child-ordered-activation-rehearsal'
            foreach ($failure in @('Check','Stop','Volumes','Start','Verify','Acceptance','FinalVerify')) {
                ResetFixture
                Reject ('fail-closed-'+$failure) { Invoke-LGASequence (Steps $failure) }
                Check ([Convert]::ToBase64String([IO.File]::ReadAllBytes($fakeConfig)) -ceq [Convert]::ToBase64String($original))
                $state=[IO.File]::ReadAllText($stateFile) | ConvertFrom-Json
                Check ($state.Starts -le 1 -and $state.Stops -le 1 -and $state.BusinessRows -eq 39 -and $state.Volume -ceq 'disposable-simulated-volume')
                if ($failure -eq 'Check') { Check ($state.Starts -eq 0 -and $state.Stops -eq 0) }
            }
            Pass 'all-failures-retain-config-data-volume-and-no-automatic-retry'
            ResetFixture; [IO.File]::WriteAllBytes($fakeConfig,$proposed)
            $rolled=Invoke-LGASequence (Steps '' $true) $true
            Check ($rolled.Mode -ceq 'ROLLBACK_VERIFIED' -and [Convert]::ToBase64String([IO.File]::ReadAllBytes($fakeConfig)) -ceq [Convert]::ToBase64String($original))
            Pass 'separately-confirmed-config-only-rollback-rehearsal'
            Reject 'activation-without-approved-plan' { Invoke-LocalGoogleAuthActivation $Id '' }
            Reject 'unsafe-service-command' { Invoke-LGAService 'reset' $credentials }
            Reject 'wrong-run-identity' { Get-LGAPath '../invalid' }
            Reject 'unknown-bridge-operation' { Invoke-LGABridge 'db-reset' $Id }
            Pass 'no-retained-service-or-configuration-mutation-in-rehearsals'
            $assets=@([IO.Directory]::EnumerateFiles((Join-Path $script:Workspace 'dist'),'*.js',[IO.SearchOption]::AllDirectories))
            foreach ($asset in $assets) {
                $text=[IO.File]::ReadAllText($asset)
                Check (-not $text.Contains($dummySecret) -and -not $text.Contains($dummyId))
            }
            foreach ($artifact in @([IO.Directory]::EnumerateFiles($testRoot,'*',[IO.SearchOption]::AllDirectories))) {
                $text=[IO.File]::ReadAllText($artifact)
                Check (-not $text.Contains($dummySecret) -and -not $text.Contains($dummyId))
            }
            Pass 'dummy-console-artifacts-and-existing-frontend-canaries'
            Assert-LGAProtection $Id
            Pass 'proposal-and-rehearsal-NTFS-protection'
            return [pscustomobject]@{Result='PASS';RunId=$Id;Passed=$checks.Count;Failed=0;Checks=$checks;
                RetainedServiceRestarted=$false;RetainedConfigChanged=$false;RealCredentialUsedInRehearsal=$false;
                ActualDockerRestartRehearsal=$false;InstalledCliSchemaProbe=$true;FrontendArtifactsScanned=$assets.Count}
        } finally { $sid.Dispose(); $secret.Dispose(); $credentials=$null; $dummyId=$null; $dummySecret=$null; $status=$null }
    } $RunId
    $result | ConvertTo-Json -Depth 6 -Compress
} catch {
    $last=if ($null -ne $module) { & $module { $script:LGATestLastPassed } } else { 'none' }
    [Console]::Error.WriteLine(([pscustomobject]@{Result='FAIL';Code='LGA_SYNTHETIC_REHEARSAL_STOPPED';LastPassed=$last;
        ExceptionType=$_.Exception.GetType().FullName} | ConvertTo-Json -Compress))
    exit 1
}
