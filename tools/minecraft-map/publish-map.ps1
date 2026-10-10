<#
.SYNOPSIS
  Renders the Bedrock world with uNmINeD and publishes the map tiles to Firebase Storage
  for the viewer at https://palepail.com/projects/interactable/minecraft-map.

.DESCRIPTION
  1. Copies the world folder to a snapshot (so the live server's files aren't read mid-write).
  2. Runs `unmined-cli web render` for each dimension.
  3. Scans the rendered tiles to build manifest.json (zoom range, block bounds, tile path).
  4. Syncs tiles, manifest.json and markers.json to gs://<bucket>/minecraft-map/ with gcloud.

  See README.md in this folder for one-time setup and scheduling.

.EXAMPLE
  .\publish-map.ps1 -WorldPath 'C:\bedrock-server\worlds\Bedrock level' -Bucket 'my-project.firebasestorage.app'
#>
[CmdletBinding()]
param(
  # Folder of the world (contains level.dat and db\).
  [Parameter(Mandatory = $true)]
  [string]$WorldPath,

  # Firebase Storage bucket name, same as storageBucket in the site's Firebase config.
  [Parameter(Mandatory = $true)]
  [string]$Bucket,

  # Path to unmined-cli.exe.
  [string]$UnminedCli = 'C:\unmined-cli\unmined-cli.exe',

  # Working folder for the snapshot and rendered output. Keep it between runs.
  [string]$WorkDir = 'C:\minecraft-map',

  [ValidateSet('overworld', 'nether', 'end')]
  [string[]]$Dimensions = @('overworld', 'nether', 'end'),

  # Zoom levels below/above 1 block = 1 pixel.
  [int]$ZoomOut = 6,
  [int]$ZoomIn = 2,

  [ValidateSet('jpeg', 'png', 'webp')]
  [string]$ImageFormat = 'jpeg',

  # Hand-edited place markers, uploaded as-is if present.
  [string]$MarkersFile = (Join-Path $PSScriptRoot 'markers.json'),

  # Display name on the site; defaults to the world's levelname.txt.
  [string]$WorldName
)

$ErrorActionPreference = 'Stop'

# Extra unmined-cli arguments per dimension. Without a top Y the Nether render is
# just the bedrock roof. Check `unmined-cli help web render` if your version rejects these.
$DimensionArgs = @{
  overworld = @()
  nether    = @('--topY=110')
  end       = @()
}

$Destination = "gs://$Bucket/minecraft-map"
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
if (-not (Test-Path (Join-Path $WorldPath 'db'))) {
  throw "WorldPath '$WorldPath' doesn't look like a Bedrock world (no db folder)."
}
if (-not (Test-Path $UnminedCli)) {
  throw "unmined-cli not found at '$UnminedCli'. Download it from https://unmined.net/downloads/"
}
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
  throw 'gcloud not found. Install the Google Cloud CLI and run `gcloud auth login`.'
}
if (-not $WorldName) {
  $levelName = Join-Path $WorldPath 'levelname.txt'
  $WorldName = if (Test-Path $levelName) { (Get-Content $levelName -Raw).Trim() } else { Split-Path $WorldPath -Leaf }
}

$snapshotDir = Join-Path $WorkDir 'snapshot'
$renderRoot = Join-Path $WorkDir 'render'
New-Item -ItemType Directory -Force -Path $snapshotDir, $renderRoot | Out-Null

# --- 1. Snapshot the world ------------------------------------------------------------------
Write-Step "Snapshotting '$WorldPath'"
# LOCK is held open by the running server and isn't needed to read the world.
robocopy $WorldPath $snapshotDir /MIR /R:2 /W:2 /XF LOCK /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) {
  throw "robocopy failed with code $LASTEXITCODE"
}

# --- 2/3. Render each dimension and build the manifest --------------------------------------
$manifestPath = Join-Path $WorkDir 'manifest.json'
$previousManifest = if (Test-Path $manifestPath) { Get-Content $manifestPath -Raw | ConvertFrom-Json } else { $null }
$manifestDimensions = [ordered]@{}
$failed = @()
foreach ($dimension in $Dimensions) {
  $renderDir = Join-Path $renderRoot $dimension
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

    $result = Get-DimensionManifest $renderDir
    $manifestDimensions[$dimension] = $result.entry

    # --- 4a. Upload tiles (only changed files are transferred) ---
    $source = if ($result.tilesRel) { Join-Path $renderDir $result.tilesRel } else { $renderDir }
    $target = if ($result.tilesRel) { "$Destination/$dimension/$($result.tilesRel)" } else { "$Destination/$dimension" }
    Write-Step "Uploading $dimension tiles"
    Invoke-Checked 'gcloud' @(
      'storage', 'rsync', $source, $target,
      '--recursive', '--checksums-only', '--delete-unmatched-destination-objects',
      '--cache-control=public, max-age=3600'
    )
  } catch {
    Write-Warning "Skipping ${dimension}: $_"
    $failed += $dimension
    # Keep the last good render of this dimension on the site.
    if ($previousManifest -and $previousManifest.dimensions.$dimension) {
      $manifestDimensions[$dimension] = $previousManifest.dimensions.$dimension
    }
  }
}

if ($failed.Count -eq $Dimensions.Count) {
  throw 'No dimensions rendered successfully; leaving the published map unchanged.'
}

# --- 4b. Upload manifest and markers --------------------------------------------------------
$manifest = [ordered]@{
  worldName  = $WorldName
  updatedAt  = (Get-Date).ToUniversalTime().ToString('o')
  dimensions = $manifestDimensions
}
[System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 6), $Utf8NoBom)

Write-Step 'Uploading manifest'
Invoke-Checked 'gcloud' @(
  'storage', 'cp', $manifestPath, "$Destination/manifest.json",
  '--cache-control=no-cache', '--content-type=application/json'
)

if (Test-Path $MarkersFile) {
  # Fail early on a typo rather than publishing a file the site can't parse.
  Get-Content $MarkersFile -Raw | ConvertFrom-Json | Out-Null
  Write-Step 'Uploading markers'
  Invoke-Checked 'gcloud' @(
    'storage', 'cp', $MarkersFile, "$Destination/markers.json",
    '--cache-control=no-cache', '--content-type=application/json'
  )
}

if ($failed.Count -gt 0) {
  Write-Step "Done with errors; failed: $($failed -join ', ')"
  exit 1
}
Write-Step 'Done'
