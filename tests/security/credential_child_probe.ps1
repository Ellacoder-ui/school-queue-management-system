# Synthetic test child only. Emits booleans, never values or hashes of credentials.
#requires -Version 5.1
$ErrorActionPreference='Stop'
$client=[Environment]::GetEnvironmentVariable('SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID')
$secret=[Environment]::GetEnvironmentVariable('SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET')
$names=@([Environment]::GetEnvironmentVariables().Keys)
[pscustomobject]@{
    ClientPresent=([bool]$client); SecretPresent=([bool]$secret)
    ViteAbsent=(@($names | Where-Object { $_ -match '^VITE_' }).Count -eq 0)
    PgAbsent=(@($names | Where-Object { $_ -match '^PG' }).Count -eq 0)
    SupabaseVariableCount=@($names | Where-Object { $_ -match '^SUPABASE_' }).Count
} | ConvertTo-Json -Compress
$client=$null; $secret=$null
