#requires -Version 5.1
<# Step 22.9: implementation/rehearsal only. No retained Engine adapter exists. #>
[CmdletBinding(DefaultParameterSetName='Preview')]
param(
    [Parameter(ParameterSetName='Preview')][switch]$Preview,
    [Parameter(Mandatory=$true,ParameterSetName='Activate')][switch]$Activate,
    [Parameter(Mandatory=$true,ParameterSetName='Rollback')][switch]$Rollback,
    [Parameter(ParameterSetName='Activate')][Parameter(ParameterSetName='Rollback')][string]$RunId,
    [Parameter(ParameterSetName='Activate')][Parameter(ParameterSetName='Rollback')][string]$ApprovedPlanSha256
)
$ErrorActionPreference='Stop'
if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSCmdlet.ParameterSetName -ne 'Preview') {
    [Console]::Error.WriteLine('AGO_RETAINED_ACTIVATION_LOCKED'); exit 1
}
[Console]::Out.WriteLine('{"result":"PREVIEW_ONLY","retainedActivationLocked":true,"rollbackLocked":true,"credentialContentsAccessed":false,"affectedService":"Auth"}')
