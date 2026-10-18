# Disposable simulated service process. Never invokes Docker, Supabase or a network.
#requires -Version 5.1
[CmdletBinding()]
param([string]$StatePath,[ValidateSet('stop','start')][string]$Operation,[switch]$FailStart,[switch]$NoCredentials)
$ErrorActionPreference='Stop'
try {
    $root=[IO.Path]::GetFullPath((Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
    $full=[IO.Path]::GetFullPath($StatePath)
    if (-not $full.StartsWith((Join-Path $root '.local-google-activation\'),[StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($full) -cne 'simulated-service.json') { throw 'SIMULATED_PATH' }
    $state=[IO.File]::ReadAllText($full) | ConvertFrom-Json
    if ($state.Volume -cne 'disposable-simulated-volume' -or $state.BusinessRows -ne 39) { throw 'SIMULATED_VOLUME' }
    if ($Operation -eq 'stop') { $state.Running=$false; $state.Stops++ }
    else {
        $names=@([Environment]::GetEnvironmentVariables().Keys)
        $id=[Environment]::GetEnvironmentVariable('SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID')
        $secret=[Environment]::GetEnvironmentVariable('SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET')
        if ($NoCredentials) { if ($id -or $secret) { throw 'SIMULATED_UNEXPECTED_CREDENTIAL' } }
        elseif (-not $id -or -not $secret -or @($names | Where-Object { $_ -match '^SUPABASE_' }).Count -ne 2 -or
                @($names | Where-Object { $_ -match '^(VITE_|PG)' }).Count) { throw 'SIMULATED_CHILD_ENV' }
        if ($FailStart) {
            # Deliberately noisy dummy-only child; parent must suppress all output.
            [Console]::Error.WriteLine($secret)
            exit 7
        }
        $state.Running=$true; $state.Starts++
    }
    [IO.File]::WriteAllText($full,($state | ConvertTo-Json -Compress))
    [pscustomobject]@{Result='PASS';SimulatedOnly=$true;BusinessRowsUnchanged=($state.BusinessRows -eq 39)} | ConvertTo-Json -Compress
} catch { [Console]::Error.WriteLine('SIMULATED_CHILD_REJECTED'); exit 1 }
