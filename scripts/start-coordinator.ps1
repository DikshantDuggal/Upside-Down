[CmdletBinding()]
param([int]$Port = 4000, [string]$BindAddress = '127.0.0.1', [string]$DatabasePath)
$ErrorActionPreference = 'Stop'
$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node 24.20+ and reopen PowerShell.' }
if (-not $DatabasePath) { $DatabasePath = Join-Path $env:LOCALAPPDATA 'UpsideDown\coordinator\coordinator.db' }
$env:PORT = [string]$Port
$env:UD_HOST = $BindAddress
$env:UD_DB_PATH = [IO.Path]::GetFullPath($DatabasePath)
$env:UD_ALLOW_LEGACY = '0'
$env:UD_PATCH_COMPLETION_MODE = 'verified_application'
Write-Host "Coordinator: http://${BindAddress}:$Port (authentication required)"
Write-Host "For the full official UI + local sync service, run: npm run dev:all"
Push-Location $ProjectRoot
try { & node --experimental-strip-types server/index.ts; if ($LASTEXITCODE -ne 0) { throw 'Coordinator could not start; check the port and error above. Existing processes were left running.' } }
finally { Pop-Location }
