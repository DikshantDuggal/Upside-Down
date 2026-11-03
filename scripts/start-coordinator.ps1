<#
.SYNOPSIS
  Starts Computer A Authoritative Coordinator (Role 1 & 2)
  Baseline: UD-IC/1.0
  Port: 4000 (binds to 0.0.0.0 for LAN access)
#>

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path "$ScriptDir\.."

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " UPSIDE-DOWN: STARTING AUTHORITATIVE COORDINATOR (COMP A) " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# Environment configuration
$env:PORT = "4000"
$env:UD_HOST = "0.0.0.0"
$env:UD_DB_PATH = "$ProjectRoot\data\upside_down.db"
$env:UD_WORKSPACE_PATH = "$ProjectRoot"
$env:UD_TEST_COMMAND = "npm test"

# Ensure data directory exists
if (-not (Test-Path "$ProjectRoot\data")) {
    New-Item -ItemType Directory -Path "$ProjectRoot\data" | Out-Null
}

# Check for and clear any lingering process on port 4000
$port4000Conns = Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue
if ($port4000Conns) {
    foreach ($conn in $port4000Conns) {
        $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
        if ($proc -and $proc.ProcessName -like "*node*") {
            Write-Host "Clearing previous Node.js process (PID $($proc.Id)) on port 4000..." -ForegroundColor Yellow
            Stop-Process -Id $proc.Id -Force
            Start-Sleep -Milliseconds 500
        }
    }
}

# Display LAN IP addresses for multi-computer pairing
Write-Host "`nDetecting local IPv4 addresses for Computer B (Arhaan's client-local):" -ForegroundColor Yellow
$ipAddresses = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { 
    $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" 
}
foreach ($ip in $ipAddresses) {
    Write-Host "  -> Coordinator LAN Target: http://$($ip.IPAddress):4000" -ForegroundColor Green
}
Write-Host "  -> Loopback Target:        http://127.0.0.1:4000" -ForegroundColor Green

Write-Host "`nDashboard URLs:" -ForegroundColor Yellow
Write-Host "  -> Live Cockpit (Demo):    http://localhost:4000/" -ForegroundColor White
Write-Host "  -> Capabilities Endpoint:  http://localhost:4000/api/capabilities" -ForegroundColor White
Write-Host "  -> SSE Event Stream:       http://localhost:4000/api/events/stream" -ForegroundColor White

Write-Host "`nStarting server process on port 4000..." -ForegroundColor Cyan
Set-Location $ProjectRoot
npm start
