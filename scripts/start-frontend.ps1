<#
.SYNOPSIS
  Starts Official Team Frontend (Role 3 / Guragam's Dashboard)
  Port: 5173 (Vite dev server)
  Proxies:
    /local -> http://127.0.0.1:4100 (client-local)
    /api   -> http://127.0.0.1:4100 (client-local read cache & proxy)
#>

param (
    [string]$LocalServiceUrl = "http://127.0.0.1:4100",
    [string]$ApiTargetUrl = "http://127.0.0.1:4100"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path "$ScriptDir\.."

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " UPSIDE-DOWN: STARTING OFFICIAL FRONTEND DASHBOARD (VITE) " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$env:UD_LOCAL_TARGET = $LocalServiceUrl
$env:UD_API_TARGET = $ApiTargetUrl

Write-Host "`nTarget Configuration:" -ForegroundColor Yellow
Write-Host "  -> Local Service Target:  $LocalServiceUrl" -ForegroundColor White
Write-Host "  -> API Proxy Target:      $ApiTargetUrl" -ForegroundColor White
Write-Host "  -> Frontend URL:          http://localhost:5173/" -ForegroundColor Green

Write-Host "`nStarting Vite development server..." -ForegroundColor Cyan
Set-Location "$ProjectRoot\web"
npm run dev
