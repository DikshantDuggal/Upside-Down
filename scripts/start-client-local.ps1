<#
.SYNOPSIS
  Starts Computer B Offline Client-Local Service (Role 4 / Sync Engine)
  Baseline: UD-IC/1.0
  Port: 4100 (Default)
#>

param (
    [string]$CoordinatorUrl = "http://127.0.0.1:4000",
    [int]$LocalPort = 4100
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path "$ScriptDir\.."

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " UPSIDE-DOWN: STARTING OFFLINE CLIENT SERVICE (COMP B)    " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# Ensure client-local data directory exists
$ClientDataDir = "$ProjectRoot\client-local\data"
if (-not (Test-Path $ClientDataDir)) {
    New-Item -ItemType Directory -Path $ClientDataDir | Out-Null
}

# Create credentials if missing
$DeviceTokenPath = "$ClientDataDir\device-token.txt"
$ReviewerTokenPath = "$ClientDataDir\reviewer-token.txt"

if (-not (Test-Path $DeviceTokenPath)) {
    [System.Guid]::NewGuid().ToString() | Out-File -FilePath $DeviceTokenPath -Encoding ascii -NoNewline
}
if (-not (Test-Path $ReviewerTokenPath)) {
    ("reviewer-" + [System.Guid]::NewGuid().ToString()) | Out-File -FilePath $ReviewerTokenPath -Encoding ascii -NoNewline
}

$env:UD_DEVICE_DB = "$ClientDataDir\device-b.db"
$env:UD_DEVICE_TOKEN_FILE = $DeviceTokenPath
$env:UD_REVIEWER_TOKEN_FILE = $ReviewerTokenPath
$env:UD_COORDINATOR_URL = $CoordinatorUrl
$env:UD_LOCAL_PORT = "$LocalPort"
$env:UD_ALLOWED_ORIGINS = "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4000,http://localhost:4000"

Write-Host "`nService Parameters:" -ForegroundColor Yellow
Write-Host "  -> Coordinator Target:     $CoordinatorUrl" -ForegroundColor White
Write-Host "  -> Local Service Port:     $LocalPort" -ForegroundColor White
Write-Host "  -> Local SQLite Database:  $env:UD_DEVICE_DB" -ForegroundColor White
Write-Host "  -> Allowed Origins:        $env:UD_ALLOWED_ORIGINS" -ForegroundColor White

Write-Host "`nStarting client-local service process..." -ForegroundColor Cyan
Set-Location "$ProjectRoot\client-local"
npm start
