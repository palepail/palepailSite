<#
.SYNOPSIS
  Renders the Bedrock world as a 3D BlueMap and publishes it to Firebase Hosting for the viewer at
  https://palepail.com/projects/interactable/minecraft-map.

.DESCRIPTION
  1. Copies the world folder to a snapshot (so the live server's files aren't read mid-write).
  2. Converts the snapshot to a Java Edition world with Chunker (BlueMap only reads Java worlds).
  3. Writes BlueMap's config (one map per dimension that exists, markers from markers.json) and
     renders with the BlueMap CLI into <WorkDir>\bluemap\site\public, BlueMap's static webapp.
  4. Deploys that folder to https://<HostingSite>.web.app with the Firebase CLI. A Hosting deploy
     replaces the whole site; only files that changed are uploaded.

  BlueMap downloads the Minecraft Java client from Mojang for textures, which requires accepting
  Mojang's EULA and owning Minecraft Java Edition; pass -AcceptMinecraftEula to confirm that.

  See README.md in this folder for one-time setup and scheduling.

.EXAMPLE
  .\publish-map.ps1 -AcceptMinecraftEula
  Uses the defaults below; the project ID comes from the repo's src\environments\environment.ts.
#>
[CmdletBinding()]
param(
  # Confirms you accept Mojang's EULA and own Minecraft Java Edition (BlueMap's accept-download).
  [switch]$AcceptMinecraftEula,

  # Folder of the Bedrock world (contains level.dat and db\).
  [string]$WorldPath = 'E:\Games\Minecraft Bedrock Server\worlds\Bedrock level',

  # Firebase project ID. Defaults to projectId in the repo's src\environments\environment.ts.
  [string]$ProjectId,

  # Hosting site the map is deployed to; defaults to the project ID (the default site).
  # The viewer loads from https://<projectId>.web.app, so only change this together with it.
  [string]$HostingSite,

  # Java 25 or newer (BlueMap 5.28 requires it).
  [string]$JavaExe = 'java',
  [string]$BlueMapJar = 'X:\Programs\BlueMap\bluemap-5.28-cli.jar',
  [string]$ChunkerJar = 'X:\Programs\Chunker\chunker-cli-1.21.0.jar',

  # Java Edition version the world is converted to and BlueMap renders with. Must be a version
  # both tools support (Chunker: `-f ?` lists JAVA_* formats).
  [string]$MinecraftVersion = '26.1',

  # Working folder for the snapshot, converted world, BlueMap data and the deployed site.
  # Keep it between runs: BlueMap stores its render state here.
  [string]$WorkDir = 'C:\minecraft-map',

  # Hand-edited place markers. Defaults to markers.json next to this script.
  [string]$MarkersFile,

  # Display name on the site; defaults to the world's levelname.txt.
  [string]$WorldName,

  [int]$RenderThreads = [Math]::Max(1, [Environment]::ProcessorCount - 1),

  # Max heap for the Chunker conversion; raise it for very large worlds.
  [string]$ChunkerMemory = '4G',

  # Brightness every block gets regardless of the world's light data, 0 to 1. Chunker's CLI
  # doesn't calculate lighting (it writes all-dark light data), so anything below 1 renders the
  # map as if it were night. Only lower it if the converted world has real lighting.
  [double]$AmbientLight = 1,

  # Only render chunks that have light data (BlueMap's default).
  [switch]$UseLightData,

  # Re-render every chunk instead of only changed ones. Happens automatically when a setting that
  # is baked into the tiles (lighting, version, dimension settings) changed since the last run.
  [switch]$ForceRender
)

$ErrorActionPreference = 'Stop'

# Windows PowerShell 5.1 leaves $PSScriptRoot empty in param defaults, so resolve paths here.
$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $MarkersFile) {
  $MarkersFile = Join-Path $ScriptDir 'markers.json'
}

# BlueMap map settings per dimension, from BlueMap's generated defaults. `folders` are where the
# dimension's region files live in a Java world: 26.1+ uses dimensions/minecraft/<name>/,
# older versions region/, DIM-1/ and DIM1/.
$Dimensions = [ordered]@{
  overworld = @{
    folders = @('dimensions/minecraft/overworld/region', 'region'); id = 'minecraft:overworld'; name = 'Overworld'; sorting = 0
    sky = '#7dabff'; void = '#000000'; caves = 55; extra = ''
  }
  nether    = @{
    folders = @('dimensions/minecraft/the_nether/region', 'DIM-1/region'); id = 'minecraft:the_nether'; name = 'Nether'; sorting = 100
    sky = '#290000'; void = '#150000'; caves = -10000
    # Hide the bedrock roof so the Nether is visible from above.
    extra = "render-mask: [ {} { subtract: true, min-y: 90, max-y: 127 } ]"
  }
  end       = @{
    folders = @('dimensions/minecraft/the_end/region', 'DIM1/region'); id = 'minecraft:the_end'; name = 'The End'; sorting = 200
    sky = '#080010'; void = '#080010'; caves = -10000; extra = ''
  }
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

function Write-TextFile([string]$Path, [string]$Content) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  [System.IO.File]::WriteAllText($Path, $Content, $Utf8NoBom)
}

# HOCON strings: forward slashes avoid backslash escapes; quotes are escaped.
function ConvertTo-Hocon([string]$Value) {
  return '"' + $Value.Replace('\', '/').Replace('"', '\"') + '"'
}

# --- Preflight ------------------------------------------------------------------------------
if (-not $AcceptMinecraftEula) {
  throw @'
BlueMap downloads the Minecraft Java Edition client from Mojang for block textures.
Re-run with -AcceptMinecraftEula to confirm you accept Mojang's EULA
(https://www.minecraft.net/eula) and own Minecraft Java Edition.
'@
}
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
foreach ($jar in @($BlueMapJar, $ChunkerJar)) {
  if (-not (Test-Path $jar)) {
    throw "'$jar' not found. See README.md for where to download BlueMap and Chunker."
  }
}
if (-not (Get-Command $JavaExe -ErrorAction SilentlyContinue)) {
  throw "Java not found ('$JavaExe'). Install Java 25 or newer, or pass -JavaExe."
}
# `java -version` writes to stderr, which PowerShell 5.1 turns into an error under 'Stop'.
$ErrorActionPreference = 'Continue'
$javaVersion = & $JavaExe -version 2>&1 | ForEach-Object { "$_" }
$ErrorActionPreference = 'Stop'
if (($javaVersion -join ' ') -match 'version "(\d+)' -and [int]$Matches[1] -lt 25) {
  throw "BlueMap needs Java 25 or newer; '$JavaExe' is Java $($Matches[1]). Install Java 25 or pass -JavaExe."
}
if (-not (Get-Command firebase -ErrorAction SilentlyContinue)) {
  throw 'firebase not found. Install Node.js, then `npm install -g firebase-tools` and `firebase login`.'
}
$markers = @()
if (Test-Path $MarkersFile) {
  # Fail early on a typo rather than publishing a broken config.
  $markers = @(Get-Content $MarkersFile -Raw | ConvertFrom-Json)
}
if (-not $WorldName) {
  $levelName = Join-Path $WorldPath 'levelname.txt'
  $WorldName = if (Test-Path $levelName) { (Get-Content $levelName -Raw).Trim() } else { Split-Path $WorldPath -Leaf }
}

$snapshotDir = Join-Path $WorkDir 'snapshot'
$javaWorldDir = Join-Path $WorkDir 'java-world'
$blueMapDir = Join-Path $WorkDir 'bluemap'
$configDir = Join-Path $blueMapDir 'config'
$siteDir = Join-Path $blueMapDir 'site'
$publicDir = Join-Path $siteDir 'public'
New-Item -ItemType Directory -Force -Path $snapshotDir, $publicDir | Out-Null

# --- 1. Snapshot the world ------------------------------------------------------------------
Write-Step "Snapshotting '$WorldPath'"
# LOCK is held open by the running server and isn't needed to read the world.
robocopy $WorldPath $snapshotDir /MIR /R:2 /W:2 /XF LOCK /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) {
  throw "robocopy failed with code $LASTEXITCODE"
}

# --- 2. Convert to Java Edition ---------------------------------------------------------------
$chunkerFormat = 'JAVA_' + $MinecraftVersion.Replace('.', '_')
Write-Step "Converting to Java Edition ($chunkerFormat) with Chunker"
if (Test-Path $javaWorldDir) {
  Remove-Item -Recurse -Force $javaWorldDir
}
Invoke-Checked $JavaExe @(
  "-Xmx$ChunkerMemory", '-jar', $ChunkerJar,
  '-i', $snapshotDir, '-o', $javaWorldDir, '-f', $chunkerFormat
)

# --- 3. Configure and render BlueMap --------------------------------------------------------
$maps = @($Dimensions.Keys | Where-Object {
  $dimension = $Dimensions[$_]
  @($dimension.folders | Where-Object { Test-Path (Join-Path $javaWorldDir $_) }).Count -gt 0
})
if ($maps.Count -eq 0) {
  $found = Get-ChildItem -Path $javaWorldDir -Directory -Recurse -Depth 3 -ErrorAction SilentlyContinue |
    ForEach-Object { $_.FullName.Substring($javaWorldDir.Length) }
  throw "Chunker produced no region folders in '$javaWorldDir'. Folders found:`n$($found -join "`n")"
}
$skipped = @($Dimensions.Keys | Where-Object { $maps -notcontains $_ })
if ($skipped.Count -gt 0) {
  Write-Step "No data for $($skipped -join ', ') yet (nobody has been there); skipping."
}

Write-TextFile (Join-Path $configDir 'core.conf') @"
accept-download: true
data: $(ConvertTo-Hocon (Join-Path $blueMapDir 'data'))
render-thread-count: $RenderThreads
scan-for-mod-resources: false
metrics: false
log: { file: $(ConvertTo-Hocon (Join-Path $blueMapDir 'data\logs\debug.log')), append: false }
"@
Write-TextFile (Join-Path $configDir 'webapp.conf') @"
enabled: true
webroot: $(ConvertTo-Hocon $publicDir)
update-settings-file: true
use-cookies: false
# Tiles are served gzip-compressed as plain files; the webapp decompresses them itself.
client-decompression: true
"@
Write-TextFile (Join-Path $configDir 'webserver.conf') "enabled: false`n"
Write-TextFile (Join-Path $configDir 'storages\file.conf') @"
storage-type: file
root: $(ConvertTo-Hocon (Join-Path $publicDir 'maps'))
compression: gzip
"@

# Regenerate map configs so a removed dimension or marker doesn't linger.
$mapsConfigDir = Join-Path $configDir 'maps'
if (Test-Path $mapsConfigDir) {
  Remove-Item -Recurse -Force $mapsConfigDir
}
foreach ($map in $maps) {
  $dim = $Dimensions[$map]
  $mapMarkers = @($markers | Where-Object { $_.dimension -eq $map })
  $markerLines = for ($i = 0; $i -lt $mapMarkers.Count; $i++) {
    $marker = $mapMarkers[$i]
    $y = if ($null -ne $marker.y) { $marker.y } else { 64 }
    # BlueMap shows `detail` as HTML; encode it so markers.json stays plain text.
    $detail = if ($marker.description) { ", detail: $(ConvertTo-Hocon ([System.Net.WebUtility]::HtmlEncode($marker.description)))" } else { '' }
    "      marker$($i): { type: ""poi"", label: $(ConvertTo-Hocon $marker.name), position: { x: $($marker.x), y: $y, z: $($marker.z) }$detail }"
  }
  Write-TextFile (Join-Path $mapsConfigDir "$map.conf") @"
world: $(ConvertTo-Hocon $javaWorldDir)
dimension: "$($dim.id)"
name: "$($dim.name)"
sorting: $($dim.sorting)
start-pos: { x: 0, z: 0 }
sky-color: "$($dim.sky)"
void-color: "$($dim.void)"
ambient-light: $AmbientLight
remove-caves-below-y: $($dim.caves)
ignore-missing-light-data: $((-not $UseLightData).ToString().ToLower())
$($dim.extra)
storage: "file"
marker-sets: {
  places: {
    label: "Places"
    toggleable: true
    default-hidden: false
    markers: {
$($markerLines -join "`n")
    }
  }
}
"@
}

# BlueMap only re-renders chunks that changed, but lighting is baked into the low-detail tiles,
# so a changed render setting needs a full re-render or distant areas keep the old look.
$renderSettings = "version=$MinecraftVersion ambient=$AmbientLight lightData=$UseLightData " +
  (($maps | ForEach-Object { "$_[$($Dimensions[$_].caves)|$($Dimensions[$_].extra)]" }) -join ' ')
$renderSettingsFile = Join-Path $blueMapDir 'render-settings.txt'
$previousRenderSettings = if (Test-Path $renderSettingsFile) { (Get-Content $renderSettingsFile -Raw).Trim() } else { '' }
$blueMapArgs = @('-jar', $BlueMapJar, '-c', $configDir, '-v', $MinecraftVersion, '-g', '-s', '-r', '--markers')
if ($ForceRender -or $renderSettings -ne $previousRenderSettings) {
  Write-Step 'Render settings changed (or -ForceRender); re-rendering everything'
  $blueMapArgs += '-f'
}

Write-Step "Rendering $($maps -join ', ') with BlueMap (Minecraft $MinecraftVersion)"
Invoke-Checked $JavaExe $blueMapArgs
Write-TextFile $renderSettingsFile $renderSettings

# The webapp polls live player positions; there are none on a static site.
foreach ($map in $maps) {
  Write-TextFile (Join-Path $publicDir "maps\$map\live\players.json") '{"players":[]}'
}

# --- 4. Deploy ------------------------------------------------------------------------------
$mapInfo = [ordered]@{
  worldName = $WorldName
  updatedAt = (Get-Date).ToUniversalTime().ToString('o')
  maps      = $maps
}
Write-TextFile (Join-Path $publicDir 'map-info.json') ($mapInfo | ConvertTo-Json)

$hostingConfig = [ordered]@{
  hosting = [ordered]@{
    site    = $HostingSite
    public  = 'public'
    ignore  = @('**/.*', 'sql.php', '**/*.map')
    headers = @(
      # map-info.json is fetched cross-origin by the page on palepail.com.
      [ordered]@{
        source  = '/map-info.json'
        headers = @([ordered]@{ key = 'Access-Control-Allow-Origin'; value = '*' })
      },
      # Settings, markers and map metadata change on every render.
      [ordered]@{
        source  = '**/*.@(json|json.gz)'
        headers = @([ordered]@{ key = 'Cache-Control'; value = 'no-cache' })
      },
      [ordered]@{
        source  = 'maps/*/tiles/**'
        headers = @([ordered]@{ key = 'Cache-Control'; value = 'public, max-age=3600' })
      }
    )
  }
}
Write-TextFile (Join-Path $siteDir 'firebase.json') ($hostingConfig | ConvertTo-Json -Depth 8)

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
Write-Step 'Done'
