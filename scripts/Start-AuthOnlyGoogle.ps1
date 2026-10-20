#requires -Version 5.1
<# Approval-bound Auth-only workflow. Prepare never changes retained services. #>
[CmdletBinding(DefaultParameterSetName='Preview')]
param(
    [Parameter(ParameterSetName='Preview')][switch]$Preview,
    [Parameter(Mandatory=$true,ParameterSetName='Prepare')][switch]$Prepare,
    [Parameter(Mandatory=$true,ParameterSetName='CheckPlan')][switch]$CheckPlan,
    [Parameter(Mandatory=$true,ParameterSetName='Activate')][switch]$Activate,
    [Parameter(Mandatory=$true,ParameterSetName='Rollback')][switch]$Rollback,
    [Parameter(Mandatory=$true,ParameterSetName='CheckPlan')][Parameter(Mandatory=$true,ParameterSetName='Activate')][Parameter(Mandatory=$true,ParameterSetName='Rollback')][ValidatePattern('^[0-9a-f]{8}$')][string]$RunId,
    [Parameter(Mandatory=$true,ParameterSetName='CheckPlan')][Parameter(Mandatory=$true,ParameterSetName='Activate')][Parameter(Mandatory=$true,ParameterSetName='Rollback')][ValidatePattern('^[0-9a-f]{64}$')][string]$ApprovedPlanSha256,
    [Parameter(ParameterSetName='Activate')][switch]$ConfirmAuthOnlyRecreation,
    [Parameter(ParameterSetName='Rollback')][switch]$ConfirmAuthOnlyRollback,
    [Parameter(Mandatory=$true,ParameterSetName='Rollback')][ValidatePattern('^[0-9a-f]{64}$')][string]$ReplacementId,
    [Parameter(Mandatory=$true,ParameterSetName='Rollback')][ValidatePattern('^[0-9a-f]{64}$')][string]$ApprovedRollbackSha256
)
$ErrorActionPreference='Stop'
if ($PSVersionTable.PSEdition -ne 'Desktop') {[Console]::Error.WriteLine('AGO_PLATFORM');exit 1}
if(($Activate -and -not $ConfirmAuthOnlyRecreation) -or ($Rollback -and -not $ConfirmAuthOnlyRollback)){
    [Console]::Error.WriteLine('AGO_EXPLICIT_APPROVAL_REQUIRED');exit 1
}
$arguments=@((Join-Path $PSScriptRoot 'authOnlyCli.mjs'),$PSCmdlet.ParameterSetName.ToLowerInvariant())
if($Activate -or $Rollback -or $CheckPlan){$arguments+=@($RunId,$ApprovedPlanSha256)}
if($Rollback){$arguments+=@($ReplacementId,$ApprovedRollbackSha256)}
if($Activate){$arguments+='confirm-auth-only'}
if($Rollback){$arguments+='confirm-auth-only-rollback'}
& node.exe @arguments
exit $LASTEXITCODE
