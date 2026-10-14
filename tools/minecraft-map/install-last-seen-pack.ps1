<#
.SYNOPSIS
  Installs the "Palepail Last Seen" behavior pack on the Bedrock Dedicated Server and enables it
  for the world. Restart the server afterwards.

.DESCRIPTION
  Copies last-seen-pack\ to <ServerPath>\behavior_packs\palepail-last-seen\ and adds it to
  <ServerPath>\worlds\<WorldName>\world_behavior_packs.json. Safe to re-run after updating the pack.
  The pack only uses the stable Script API; the world doesn't need any experiments.
#>
[CmdletBinding()]
param(
  [string]$ServerPath = 'E:\Games\Minecraft Bedrock Server',
  [string]$WorldName = 'Bedrock level'
)

$ErrorActionPreference = 'Stop'

$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
$packSource = Join-Path $ScriptDir 'last-seen-pack'
$manifest = Get-Content (Join-Path $packSource 'manifest.json') -Raw | ConvertFrom-Json
$packId = $manifest.header.uuid
$packVersion = @($manifest.header.version)

$worldDir = Join-Path (Join-Path $ServerPath 'worlds') $WorldName
if (-not (Test-Path (Join-Path $worldDir 'db'))) {
  throw "World '$worldDir' not found (no db folder). Pass -ServerPath / -WorldName."
}

$packTarget = Join-Path (Join-Path $ServerPath 'behavior_packs') 'palepail-last-seen'
if (Test-Path $packTarget) {
  Remove-Item -Recurse -Force $packTarget
}
Copy-Item -Recurse $packSource $packTarget
Write-Host "Copied pack to $packTarget"

$listFile = Join-Path $worldDir 'world_behavior_packs.json'
$packs = @()
if (Test-Path $listFile) {
  # Windows PowerShell 5.1 emits a parsed JSON array as one object; @($existing) flattens it.
  $existing = Get-Content $listFile -Raw | ConvertFrom-Json
  $packs = @(@($existing) | Where-Object { $_.pack_id -ne $packId })
}
$packs += [pscustomobject]@{ pack_id = $packId; version = $packVersion }
# Written by hand: Windows PowerShell 5.1's ConvertTo-Json can turn the version arrays into
# {"value":[1,0,0],"Count":3}, which Bedrock silently ignores.
$entries = foreach ($pack in $packs) {
  # Repairs entries an earlier run wrote in that broken form.
  if ($null -ne $pack.version.value) { $pack.version = $pack.version.value }
  "  { `"pack_id`": `"$($pack.pack_id)`", `"version`": [$(@($pack.version) -join ', ')] }"
}
$json = "[`n" + ($entries -join ",`n") + "`n]`n"
[System.IO.File]::WriteAllText($listFile, $json, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Enabled it in $listFile`:"
Write-Host $json
Write-Host 'Restart the server to load the pack. Players are recorded from then on.'
