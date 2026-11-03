[CmdletBinding()]
param([int]$CoordinatorPort = 4000, [int]$LocalPort = 4100, [int]$WebPort = 5173, [string]$StateDirectory, [switch]$OpenBrowser, [switch]$Reviewer, [switch]$DemoWorkspace)
$ErrorActionPreference = 'Stop'
$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$LaunchArgs = @('scripts/dev-all.mjs', '--coordinator-port', [string]$CoordinatorPort, '--local-port', [string]$LocalPort, '--web-port', [string]$WebPort)
if ($StateDirectory) { $LaunchArgs += @('--state-dir', $StateDirectory) }
if ($Reviewer) { $LaunchArgs += '--reviewer' }
if ($DemoWorkspace) { $LaunchArgs += '--demo-workspace' }
if ($OpenBrowser) { $LaunchArgs += '--open' }
Push-Location $ProjectRoot
try { & node @LaunchArgs; if ($LASTEXITCODE -ne 0) { throw 'Full-stack launch failed. Check the actionable error above.' } }
finally { Pop-Location }
