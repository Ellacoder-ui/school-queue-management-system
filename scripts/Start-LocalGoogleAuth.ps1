#requires -Version 5.1
<# .SYNOPSIS
Preview by default. Preparation writes only protected proposal/rollback files.
Activation and rollback require separate explicit approval of a reviewed plan hash.
#>
[CmdletBinding(DefaultParameterSetName='Preview')]
param(
    [Parameter(ParameterSetName='Preview')][switch]$Preview,
    [Parameter(ParameterSetName='Preview')][string]$SyntheticTestRunId = '',
    [Parameter(Mandatory=$true,ParameterSetName='Prepare')][switch]$Prepare,
    [Parameter(Mandatory=$true,ParameterSetName='Activate')][switch]$Activate,
    [Parameter(Mandatory=$true,ParameterSetName='Rollback')][switch]$Rollback,
    [Parameter(Mandatory=$true,ParameterSetName='Activate')]
    [Parameter(Mandatory=$true,ParameterSetName='Rollback')][string]$RunId,
    [Parameter(Mandatory=$true,ParameterSetName='Activate')]
    [Parameter(Mandatory=$true,ParameterSetName='Rollback')][string]$ApprovedPlanSha256,
    [Parameter(Mandatory=$true,ParameterSetName='Activate')]
    [Parameter(Mandatory=$true,ParameterSetName='Rollback')][switch]$ConfirmRetainedLocalServiceRestart
)
$ErrorActionPreference='Stop'
try {
    Import-Module (Join-Path $PSScriptRoot 'LocalGoogleCredential.psm1') -Force -ErrorAction Stop -DisableNameChecking
    switch ($PSCmdlet.ParameterSetName) {
        'Preview' { Invoke-LocalGoogleAuthPreview -SyntheticTestRunId $SyntheticTestRunId | ConvertTo-Json -Compress }
        'Prepare' { Invoke-LocalGoogleAuthPreparation | ConvertTo-Json -Compress }
        default {
            if (-not $ConfirmRetainedLocalServiceRestart) { throw 'LGA_EXPLICIT_APPROVAL' }
            Invoke-LocalGoogleAuthActivation -RunId $RunId -ApprovedPlan $ApprovedPlanSha256 -Rollback ([bool]$Rollback) | ConvertTo-Json -Compress
        }
    }
} catch {
    [Console]::Error.WriteLine('FAIL: local Google workflow stopped; credentials and subprocess diagnostics suppressed. Review the recorded phase before any retry.')
    exit 1
}
