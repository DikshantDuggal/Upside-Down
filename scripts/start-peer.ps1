[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$CoordinatorUrl, [string]$StateDirectory, [string]$DeviceTokenFile, [int]$LocalPort=4100, [int]$WebPort=5173, [switch]$OpenBrowser)
$ErrorActionPreference='Stop'
$ReleaseRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$Coordinator=[Uri]$CoordinatorUrl
if ($Coordinator.Scheme -notin @('http','https') -or $Coordinator.UserInfo -or $Coordinator.Query -or $Coordinator.Fragment -or $Coordinator.AbsolutePath -ne '/') { throw 'CoordinatorUrl must be an explicit HTTP(S) origin without credentials or extra path.' }
if (-not $StateDirectory) { $StateDirectory=Join-Path $env:LOCALAPPDATA ('UpsideDown\lan-' + $Coordinator.DnsSafeHost.Replace('.','-')) }
if (-not $DeviceTokenFile) { $DeviceTokenFile=Join-Path $StateDirectory 'device.token' }
Push-Location $ReleaseRoot
try {
  if (-not (Test-Path -LiteralPath $DeviceTokenFile)) {
    & node scripts/dev-all.mjs --init-device --state-dir $StateDirectory
    throw "Fresh enrollment is pending at $CoordinatorUrl. Save the newly issued device credential to $DeviceTokenFile. The old local credential will not be used."
  }
  $PeerArgs=@('scripts/dev-all.mjs','--connect',$CoordinatorUrl,'--state-dir',$StateDirectory,'--device-token-file',$DeviceTokenFile,'--local-port',[string]$LocalPort,'--web-port',[string]$WebPort)
  if ($OpenBrowser) { $PeerArgs+='--open' }
  & node @PeerArgs
  if ($LASTEXITCODE -ne 0) { throw 'Peer startup failed; inspect the error above. Existing port owners and data were left intact.' }
} finally { Pop-Location }
