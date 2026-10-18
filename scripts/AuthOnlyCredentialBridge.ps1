#requires -Version 5.1
<# Private captured pipes only. Reuse the approved credential implementation.
   Production reads are deliberately unavailable in this rehearsal entry point. #>
$ErrorActionPreference='Stop'
try {
    if($PSVersionTable.PSEdition -ne 'Desktop' -or -not [Console]::IsInputRedirected -or -not [Console]::IsOutputRedirected){throw 'IPC'}
    $builder=[Text.StringBuilder]::new();$buffer=[char[]]::new(1024)
    while(($read=[Console]::In.Read($buffer,0,$buffer.Length)) -gt 0){if($builder.Length+$read -gt 16384){throw 'BOUND'};[void]$builder.Append($buffer,0,$read)}
    $raw=$builder.ToString()
    $request=$raw | ConvertFrom-Json
    if($request.runId -cnotmatch '^[0-9a-f]{8}\z' -or $request.operation -cnotin @('create-dummy','read-dummy','read-production')){throw 'LOCKED'}
    if($request.operation -ceq 'read-production'){throw 'AGO_RETAINED_ACTIVATION_LOCKED'}
    Import-Module (Join-Path $PSScriptRoot 'LocalGoogleCredential.psm1') -Force -DisableNameChecking
    $module=Get-Module LocalGoogleCredential
    $value=& $module {
        param($r)
        $location=if($r.operation -ceq 'read-production'){Get-LCGLocation}else{Initialize-LocalGoogleDirectory $r.runId}
        if($r.operation -ceq 'create-dummy'){
            $id=[Security.SecureString]::new(); $secret=[Security.SecureString]::new()
            try {
                foreach($c in $r.ClientId.ToCharArray()){$id.AppendChar($c)}
                foreach($c in $r.ClientSecret.ToCharArray()){$secret.AppendChar($c)}
                Write-LCGCredential $location $id $secret
            }finally{$id.Dispose();$secret.Dispose()}
        }
        $opened=Read-LCGCredential $location
        return @{ClientId=$opened.ClientId;ClientSecret=$opened.ClientSecret}
    } $request
    [Console]::Out.Write(($value | ConvertTo-Json -Compress))
    $value=$null;$request=$null;$raw=$null
}catch{[Console]::Error.WriteLine('AGO_CREDENTIAL_REJECTED');exit 1}
