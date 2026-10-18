#requires -Version 5.1
<# Preparation interface only. Retained execution is deliberately unavailable. #>
[CmdletBinding(DefaultParameterSetName='Preview')]
param(
    [Parameter(ParameterSetName='Preview')][switch]$Preview,
    [Parameter(Mandatory=$true,ParameterSetName='Repair')][switch]$Repair,
    [Parameter(Mandatory=$true,ParameterSetName='Rollback')][switch]$Rollback,
    [Parameter(ParameterSetName='Repair')][Parameter(ParameterSetName='Rollback')][string]$RunId,
    [Parameter(ParameterSetName='Repair')][Parameter(ParameterSetName='Rollback')][string]$ApprovedPlanSha256
)
$ErrorActionPreference='Stop'
try {
    if($PSVersionTable.PSEdition -ne 'Desktop'){throw 'VPR_PLATFORM'}
    if($PSCmdlet.ParameterSetName -ne 'Preview'){
        # No approval value or switch bypasses this implementation lock.
        throw 'VPR_RETAINED_EXECUTION_NOT_CERTIFIED'
    }
    [Console]::Out.WriteLine('{"result":"PREVIEW_ONLY","retainedRepairLocked":true,"rollbackLocked":true,"googleActivationUnchanged":true,"credentialContentsAccessed":false}')
}catch{
    [Console]::Error.WriteLine('VPR_RETAINED_EXECUTION_NOT_CERTIFIED')
    exit 1
}
