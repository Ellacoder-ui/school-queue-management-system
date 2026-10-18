#requires -Version 5.1
<# .SYNOPSIS
Prepare protected storage by default. -Store explicitly opens local masked prompts.
Actual provider credential entry requires separate user approval; never paste into chat.
#>
[CmdletBinding()]
param([switch]$InitializeOnly, [switch]$Store)
$ErrorActionPreference='Stop'
try {
    Import-Module (Join-Path $PSScriptRoot 'LocalGoogleCredential.psm1') -Force -ErrorAction Stop -DisableNameChecking
    if ($Store -and $InitializeOnly) { throw 'LCG_MODE' }
    if ($Store) { Save-LocalGoogleCredential; [Console]::WriteLine('PASS: protected credential stored and verified; no provider change.') }
    else { $null=Initialize-LocalGoogleDirectory; [Console]::WriteLine('PASS: protected directory ready; no credential intake.') }
} catch {
    [Console]::Error.WriteLine('FAIL: credential operation rejected; values suppressed.')
    exit 1
}
