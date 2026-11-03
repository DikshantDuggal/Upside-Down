[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$taskRepo = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRepo
try {
  $taskHealth = Invoke-RestMethod 'http://127.0.0.1:5173/__judge/health' -TimeoutSec 2
  if ($taskHealth.kind -eq 'upside-down-local-judge') { Write-Host 'READY: http://127.0.0.1:5173'; return }
} catch {}
if (-not (Test-Path -LiteralPath 'web/dist/index.html')) { npm --prefix web run build; if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' } }
node scripts/judge-local.mjs
