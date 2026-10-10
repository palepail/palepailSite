<#
.SYNOPSIS
  Renders the Bedrock world with uNmINeD and publishes the map tiles to Firebase Hosting
  for the viewer at https://palepail.com/projects/interactable/minecraft-map.

.DESCRIPTION
  1. Copies the world folder to a snapshot (so the live server's files aren't read mid-write).
  2. Runs `unmined-cli web render` for each dimension into <WorkDir>\site\public\<dimension>.
  3. Scans the rendered tiles to build manifest.json (zoom range, block bounds, tile path).
  4. Deploys <WorkDir>\site to https://<HostingSite>.web.app with the Firebase CLI.
     A Hosting deploy replaces the whole site, so the folder always holds every dimension;
     only files that changed are uploaded.

  See README.md in this folder for one-time setup and scheduling.

.EXAMPLE
  .\publish-map.ps1
  Uses the defaults below; the project ID comes from the repo's src\environments\environment.ts.

.EXAMPLE
  .\publish-map.ps1 -WorldPath 'D:\other-server\worlds\My World' -ProjectId 'my-project'
#>
[CmdletBinding()]
param(
  # Folder of the world (contains level.dat and db\).
  [string]$WorldPath = 'E:\Games\Minecraft Bedrock Server\worlds\Bedrock level',

  # Firebase project ID. Defaults to projectId in the repo's src\environments\environment.ts.
  [string]$ProjectId,

  # Hosting site the map is deployed to; defaults to the project ID (the default site).
  # The viewer loads from https://<projectId>.web.app, so only change this together with it.
  [string]$HostingSite,

  # Path to unmined-cli.exe.
  [string]$UnminedCli = 'X:\Programs\Unmined\unmined-cli_0.20.11-dev_win-64bit\unmined-cli.exe',

  # Working folder for the snapshot and the deployed site. Keep it between runs.
  [string]$WorkDir = 'C:\minecraft-map',

  [ValidateSet('overworld', 'nether', 'end')]
  [string[]]$Dimensions = @('overworld', 'nether', 'end'),

  # Zoom levels below/above 1 block = 1 pixel.
  [int]$ZoomOut = 6,
  [int]$ZoomIn = 2,

  # PNG by default: unmined-cli 0.20.11-dev crashes encoding JPEG tiles when no quality is given.
  [ValidateSet('jpeg', 'png', 'webp')]
  [string]$ImageFormat = 'png',

  # Hand-edited place markers, uploaded as-is if present. Defaults to markers.json next to this script.
  [string]$MarkersFile,

  # Display name on the site; defaults to the world's levelname.txt.
  [string]$WorldName
)

$ErrorActionPreference = 'Stop'

# Windows PowerShell 5.1 leaves $PSScriptRoot empty in param defaults, so resolve paths here.
$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $MarkersFile) {
  $MarkersFile = Join-Path $ScriptDir 'markers.json'
}

# Extra unmined-cli arguments per dimension. Without a top Y the Nether render is
# just the bedrock roof. Check `unmined-cli help web render` if your version rejects these.
$DimensionArgs = @{
  overworld = @()
  nether    = @('--topY=110')
  end       = @()
}

$Utf8NoBom = New-Object System.Text.UTF8Encoding $false

function Write-Step([string]$Message) {
  Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $Message"
}

function Invoke-Checked([string]$File, [string[]]$Arguments) {
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$File exited with code $LASTEXITCODE"
  }
}

# Builds the manifest entry for one rendered dimension by scanning its tile files.
# Expects uNmINeD's layout: <tilesRoot>\zoom.<z>\<floor(x/10)>\<floor(y/10)>\tile.<x>.<y>.<ext>
function Get-DimensionManifest([string]$RenderDir) {
  $zoomDir = Get-ChildItem -Path $RenderDir -Directory -Recurse |
    Where-Object { $_.Name -match '^zoom\.-?\d+$' } |
    Select-Object -First 1
  if (-not $zoomDir) {
    throw "No zoom.* tile folders found under $RenderDir"
  }
  $tilesRoot = $zoomDir.Parent.FullName
  $tilesRel = $tilesRoot.Substring($RenderDir.TrimEnd('\', '/').Length).Trim('\', '/').Replace('\', '/')

  $zoomLevels = @()
  $bounds = $null
  $extension = $null
  $zoomDirs = Get-ChildItem -Path $tilesRoot -Directory |
    Where-Object { $_.Name -match '^zoom\.-?\d+$' } |
    Sort-Object { [int]($_.Name.Substring(5)) }
  foreach ($dir in $zoomDirs) {
    $z = [int]($dir.Name.Substring(5))
    $zoomLevels += $z
    $blocksPerTile = 256 / [Math]::Pow(2, $z)
    $minX = [double]::MaxValue; $minY = [double]::MaxValue
    $maxX = [double]::MinValue; $maxY = [double]::MinValue

    foreach ($file in Get-ChildItem -Path $dir.FullName -File -Recurse) {
      if ($file.Name -notmatch '^tile\.(-?\d+)\.(-?\d+)\.(\w+)$') { continue }
      $x = [int]$Matches[1]; $y = [int]$Matches[2]; $extension = $Matches[3]

      $expected = [System.IO.Path]::Combine($dir.FullName, [Math]::Floor($x / 10), [Math]::Floor($y / 10), $file.Name)
      if ($file.FullName -ne $expected) {
        throw "Unexpected tile layout: $($file.FullName) (expected $expected). The uNmINeD output format may have changed; update tilePath handling in this script."
      }

      if ($x -lt $minX) { $minX = $x }; if ($x -gt $maxX) { $maxX = $x }
      if ($y -lt $minY) { $minY = $y }; if ($y -gt $maxY) { $maxY = $y }
    }

    # Levels are visited from least to most detailed; the most detailed gives the tightest bounds.
    if ($minX -ne [double]::MaxValue) {
      $bounds = [ordered]@{
        minX = [int]($minX * $blocksPerTile)
        minZ = [int]($minY * $blocksPerTile)
        maxX = [int](($maxX + 1) * $blocksPerTile)
        maxZ = [int](($maxY + 1) * $blocksPerTile)
      }
    }
  }
  if (-not $bounds) {
    throw "No tiles found under $tilesRoot"
  }

  $prefix = if ($tilesRel) { "$tilesRel/" } else { '' }
  return [ordered]@{
    tilesRel = $tilesRel
    entry    = [ordered]@{
      minZoom  = [int]($zoomLevels | Measure-Object -Minimum).Minimum
      maxZoom  = [int]($zoomLevels | Measure-Object -Maximum).Maximum
      tilePath = "${prefix}zoom.{z}/{xd}/{yd}/tile.{x}.{y}.$extension"
      bounds   = $bounds
    }
  }
}

# --- Preflight ------------------------------------------------------------------------------
if (-not $ProjectId) {
  $envFile = [System.IO.Path]::GetFullPath(
    [System.IO.Path]::Combine($ScriptDir, '..', '..', 'src', 'environments', 'environment.ts'))
  if ((Test-Path $envFile) -and ((Get-Content $envFile -Raw) -match 'projectId\s*:\s*[''"]([^''"]+)[''"]')) {
    $ProjectId = $Matches[1]
  } else {
    throw "No -ProjectId given and no projectId found in $envFile."
  }
}
if (-not $HostingSite) {
  $HostingSite = $ProjectId
}
if (-not (Test-Path (Join-Path $WorldPath 'db'))) {
  throw "WorldPath '$WorldPath' doesn't look like a Bedrock world (no db folder)."
}
if (-not (Test-Path $UnminedCli)) {
  throw "unmined-cli not found at '$UnminedCli'. Download it from https://unmined.net/downloads/"
}
if (-not (Get-Command firebase -ErrorAction SilentlyContinue)) {
  throw 'firebase not found. Install Node.js, then `npm install -g firebase-tools` and `firebase login`.'
}
if (-not $WorldName) {
  $levelName = Join-Path $WorldPath 'levelname.txt'
  $WorldName = if (Test-Path $levelName) { (Get-Content $levelName -Raw).Trim() } else { Split-Path $WorldPath -Leaf }
}

$snapshotDir = Join-Path $WorkDir 'snapshot'
$siteDir = Join-Path $WorkDir 'site'
$publicDir = Join-Path $siteDir 'public'
New-Item -ItemType Directory -Force -Path $snapshotDir, $publicDir | Out-Null

# --- 1. Snapshot the world ------------------------------------------------------------------
Write-Step "Snapshotting '$WorldPath'"
# LOCK is held open by the running server and isn't needed to read the world.
robocopy $WorldPath $snapshotDir /MIR /R:2 /W:2 /XF LOCK /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) {
  throw "robocopy failed with code $LASTEXITCODE"
}

# --- 2/3. Render each dimension and build the manifest --------------------------------------
$manifestPath = Join-Path $publicDir 'manifest.json'
$manifestDimensions = [ordered]@{}
# Start from the last published entries: dimensions that fail or aren't rendered this run keep
# their previous tiles (still in the site folder) and stay on the map.
if (Test-Path $manifestPath) {
  $previous = (Get-Content $manifestPath -Raw | ConvertFrom-Json).dimensions
  foreach ($property in $previous.PSObject.Properties) {
    if (Test-Path (Join-Path $publicDir $property.Name)) {
      $manifestDimensions[$property.Name] = $property.Value
    }
  }
}
$failed = @()
foreach ($dimension in $Dimensions) {
  $renderDir = Join-Path $publicDir $dimension
  try {
    Write-Step "Rendering $dimension"
    $unminedArgs = @(
      'web', 'render',
      "--world=$snapshotDir",
      "--output=$renderDir",
      "--dimension=$dimension",
      "--imageformat=$ImageFormat",
      "--zoomout=$ZoomOut",
      "--zoomin=$ZoomIn"
    ) + $DimensionArgs[$dimension]
    Invoke-Checked $UnminedCli $unminedArgs

    $manifestDimensions[$dimension] = (Get-DimensionManifest $renderDir).entry
  } catch {
    Write-Warning "Skipping ${dimension}: $_"
    $failed += $dimension
  }
}

if ($failed.Count -eq $Dimensions.Count) {
  throw 'No dimensions rendered successfully; leaving the published map unchanged.'
}

# --- 4. Write manifest, markers and Hosting config, then deploy ----------------------------
$manifest = [ordered]@{
  worldName  = $WorldName
  updatedAt  = (Get-Date).ToUniversalTime().ToString('o')
  dimensions = $manifestDimensions
}
[System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 6), $Utf8NoBom)

$markersTarget = Join-Path $publicDir 'markers.json'
if (Test-Path $MarkersFile) {
  # Fail early on a typo rather than publishing a file the site can't parse.
  Get-Content $MarkersFile -Raw | ConvertFrom-Json | Out-Null
  Copy-Item $MarkersFile $markersTarget -Force
} elseif (Test-Path $markersTarget) {
  Remove-Item $markersTarget
}

# The viewer on palepail.com fetches the JSON files cross-origin; tiles are plain <img> loads.
$hostingConfig = [ordered]@{
  hosting = [ordered]@{
    site    = $HostingSite
    public  = 'public'
    ignore  = @('**/.*')
    headers = @(
      [ordered]@{
        source  = '**/*.json'
        headers = @(
          [ordered]@{ key = 'Access-Control-Allow-Origin'; value = '*' },
          [ordered]@{ key = 'Cache-Control'; value = 'no-cache' }
        )
      },
      [ordered]@{
        source  = '**/tiles/**'
        headers = @([ordered]@{ key = 'Cache-Control'; value = 'public, max-age=3600' })
      }
    )
  }
}
[System.IO.File]::WriteAllText((Join-Path $siteDir 'firebase.json'), ($hostingConfig | ConvertTo-Json -Depth 8), $Utf8NoBom)

Write-Step "Deploying to https://$HostingSite.web.app"
Push-Location $siteDir
try {
  Invoke-Checked 'firebase' @(
    'deploy', '--only', 'hosting', '--project', $ProjectId, '--non-interactive',
    '--message', "Map render $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
  )
} finally {
  Pop-Location
}

if ($failed.Count -gt 0) {
  Write-Step "Done with errors; failed: $($failed -join ', ')"
  exit 1
}
Write-Step 'Done'
