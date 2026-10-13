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

  Player last-seen positions recorded by the "Palepail Last Seen" behavior pack (see
  install-last-seen-pack.ps1) are read from the snapshot, shown as a "Players" marker set and
  published as players.json for the page. -PlayersOnly refreshes just those, skipping the
  conversion and render, so it takes seconds and can be scheduled often.

  BlueMap downloads the Minecraft Java client from Mojang for textures, which requires accepting
  Mojang's EULA and owning Minecraft Java Edition; pass -AcceptMinecraftEula to confirm that.

  See README.md in this folder for one-time setup and scheduling.

.EXAMPLE
  .\publish-map.ps1 -AcceptMinecraftEula
  Uses the defaults below; the project ID comes from the repo's src\environments\environment.ts.

.EXAMPLE
  .\publish-map.ps1 -AcceptMinecraftEula -PlayersOnly
  Updates only the players' last-seen pins and list (needs one full publish first).
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

  # Java 25 or newer (BlueMap 5.28+ requires it).
  [string]$JavaExe = 'java',
  [string]$BlueMapJar = 'X:\Programs\BlueMap\bluemap-5.29-cli.jar',
  [string]$ChunkerJar = 'X:\Programs\Chunker\chunker-cli-1.21.0.jar',

  # Java Edition version the world is converted to and BlueMap renders with. Must be a version
  # both tools support (Chunker: `-f ?` lists JAVA_* formats).
  # Content newer than this (e.g. biomes) is replaced by older equivalents in the conversion.
  [string]$MinecraftVersion = '26.3',

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

  # Leave out Overworld caves below Y 55 (BlueMap's default). Caves are included otherwise, so
  # free-flight can explore underground; that makes the render larger and slower.
  [switch]$HideCaves,

  # Re-render every chunk instead of only changed ones. Happens automatically when a setting that
  # is baked into the tiles (lighting, version, dimension settings) changed since the last run.
  [switch]$ForceRender,

  # Only refresh players' last-seen positions: no conversion or render. Needs a previous full run.
  [switch]$PlayersOnly
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
    sky = '#7dabff'; void = '#000000'; caves = $(if ($HideCaves) { 55 } else { -10000 }); extra = ''
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

# Bedrock's script engine may not have a real clock (Date.now() can return 0), so players are
# time-stamped here: a record that changed since the last run (position or the pack's tick counter,
# which changes on every save) means the player was online in between, so they get the current time.
# Accurate to the interval between runs. A real time from the pack is kept as-is.
function Update-LastSeenTimes($Players) {
  $stateFile = Join-Path $WorkDir 'last-seen-state.json'
  $state = @{}
  if (Test-Path $stateFile) {
    $parsed = Get-Content $stateFile -Raw | ConvertFrom-Json
    foreach ($property in $parsed.PSObject.Properties) { $state[$property.Name] = $property.Value }
  }
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $realClock = 1577836800000 # 2020-01-01; anything earlier didn't come from a working clock
  foreach ($player in $Players) {
    $key = "$($player.dimension)|$($player.x)|$($player.y)|$($player.z)|$($player.tick)"
    $previous = $state[$player.name]
    if ([long]$player.lastSeen -lt $realClock) {
      $player.lastSeen = if ($previous -and $previous.key -eq $key) { [long]$previous.lastSeen } else { $now }
    }
    $state[$player.name] = [ordered]@{ key = $key; lastSeen = [long]$player.lastSeen }
  }
  Write-TextFile $stateFile (ConvertTo-Json -InputObject $state)
}

# Reads the players recorded by the last-seen behavior pack from a Bedrock world's db folder.
# Returns an empty list (with a warning) rather than failing the publish.
function Get-LastSeenPlayers([string]$DbPath) {
  $readerDir = Join-Path $ScriptDir 'read-last-seen'
  try {
    $installed = @('leveldb-zlib', 'prismarine-nbt') | Where-Object { Test-Path (Join-Path $readerDir "node_modules\$_") }
    if ($installed.Count -lt 2) {
      Write-Step 'Installing the last-seen reader and map tools (first run only)'
      Push-Location $readerDir
      # Out-Host: anything a function outputs becomes part of its return value.
      try { Invoke-Checked 'npm' @('ci', '--omit=dev', '--no-audit', '--no-fund') | Out-Host } finally { Pop-Location }
    }
    $output = & node (Join-Path $readerDir 'read-last-seen.js') $DbPath
    if ($LASTEXITCODE -ne 0) {
      throw "read-last-seen exited with code $LASTEXITCODE"
    }
    # Windows PowerShell 5.1's ConvertFrom-Json emits a JSON array as one object; assigning it
    # first and then wrapping with @() gives a flat list in both 5.1 and 7.
    $parsed = ($output -join "`n") | ConvertFrom-Json
    $players = @(@($parsed) | Where-Object { $_.name })
    Update-LastSeenTimes $players
    Write-Step "Found $($players.Count) player(s) with a last-seen position"
    return , $players
  } catch {
    Write-Warning "Couldn't read player last-seen data; publishing without it. $_"
    return , @()
  }
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
foreach ($jar in @($BlueMapJar) + @(if (-not $PlayersOnly) { $ChunkerJar })) {
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
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'node not found. Install Node.js (it is also needed for the Firebase CLI).'
}
$markers = @()
if (Test-Path $MarkersFile) {
  # Fail early on a typo rather than publishing a broken config.
  $parsed = Get-Content $MarkersFile -Raw | ConvertFrom-Json
  $markers = @($parsed)  # see Get-LastSeenPlayers for why this isn't one pipeline
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

# Only one publish at a time: two BlueMap processes writing the same tiles corrupt them. The lock
# is an exclusively opened file that Windows releases when this process exits, even on a crash.
try {
  $publishLock = [System.IO.File]::Open((Join-Path $WorkDir 'publish.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
} catch {
  if ($PlayersOnly) {
    Write-Step 'Another publish is running; skipping this players update.'
    exit 0
  }
  throw "Another publish is already running ($(Join-Path $WorkDir 'publish.lock') is in use). Wait for it to finish."
}

# --- 1. Snapshot the world ------------------------------------------------------------------
Write-Step "Snapshotting '$WorldPath'"
# LOCK is held open by the running server and isn't needed to read the world.
robocopy $WorldPath $snapshotDir /MIR /R:2 /W:2 /XF LOCK /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) {
  throw "robocopy failed with code $LASTEXITCODE"
}

$players = Get-LastSeenPlayers (Join-Path $snapshotDir 'db')
$mapInfoPath = Join-Path $publicDir 'map-info.json'

if ($PlayersOnly) {
  # Reuse the maps from the last full publish.
  if (-not (Test-Path $mapInfoPath)) {
    throw '-PlayersOnly needs a previous full publish (no map-info.json yet). Run without it first.'
  }
  $maps = @((Get-Content $mapInfoPath -Raw | ConvertFrom-Json).maps)
} else {
  # --- 2. Convert to Java Edition -------------------------------------------------------------
  $chunkerFormat = 'JAVA_' + $MinecraftVersion.Replace('.', '_')
  Write-Step "Converting to Java Edition ($chunkerFormat) with Chunker"
  if (Test-Path $javaWorldDir) {
    Remove-Item -Recurse -Force $javaWorldDir
  }
  Invoke-Checked $JavaExe @(
    "-Xmx$ChunkerMemory", '-jar', $ChunkerJar,
    '-i', $snapshotDir, '-o', $javaWorldDir, '-f', $chunkerFormat
  )

  # Chunker leaves every chunk's "last modified" time at 0, so BlueMap would never re-render
  # anything after the first render. Stamp chunks whose data changed since the last run with the
  # current time; if that fails, fall back to re-rendering everything.
  Write-Step 'Marking changed chunks for BlueMap'
  $stampScript = Join-Path $ScriptDir 'read-last-seen\stamp-regions.js'
  $stampOutput = & node $stampScript $javaWorldDir (Join-Path $WorkDir 'chunk-stamps.json')
  if ($LASTEXITCODE -eq 0) {
    Write-Step ($stampOutput -join ' ')
  } else {
    Write-Warning "Couldn't mark changed chunks (stamp-regions exited with $LASTEXITCODE); re-rendering everything."
    $ForceRender = $true
  }

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
}

# --- 3. Configure and render BlueMap --------------------------------------------------------
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
  $mapPlayers = @($players | Where-Object { $_.dimension -eq $map })
  $playerLines = for ($i = 0; $i -lt $mapPlayers.Count; $i++) {
    $player = $mapPlayers[$i]
    $seen = [DateTimeOffset]::FromUnixTimeMilliseconds([long]$player.lastSeen).ToLocalTime().ToString('MMM d, HH:mm', [Globalization.CultureInfo]::InvariantCulture)
    $label = "$($player.name) - last seen $seen"
    "      player$($i): { type: ""poi"", label: $(ConvertTo-Hocon $label), detail: $(ConvertTo-Hocon ([System.Net.WebUtility]::HtmlEncode($label))), icon: ""assets/steve.png"", anchor: { x: 24, y: 24 }, position: { x: $($player.x), y: $($player.y), z: $($player.z) } }"
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
  players: {
    label: "Players"
    toggleable: true
    default-hidden: false
    sorting: 1
    markers: {
$($playerLines -join "`n")
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
if ($PlayersOnly) {
  Write-Step 'Updating map markers'
  Invoke-Checked $JavaExe @('-jar', $BlueMapJar, '-c', $configDir, '--markers')
} else {
  $blueMapArgs = @('-jar', $BlueMapJar, '-c', $configDir, '-v', $MinecraftVersion, '-g', '-s', '-r', '--markers')
  if ($ForceRender -or $renderSettings -ne $previousRenderSettings) {
    Write-Step 'Render settings changed (or -ForceRender); re-rendering everything'
    $blueMapArgs += '-f'
  }

  Write-Step "Rendering $($maps -join ', ') with BlueMap (Minecraft $MinecraftVersion)"
  Invoke-Checked $JavaExe $blueMapArgs
  Write-TextFile $renderSettingsFile $renderSettings
}

# The webapp polls live player positions; there are none on a static site.
foreach ($map in $maps) {
  Write-TextFile (Join-Path $publicDir "maps\$map\live\players.json") '{"players":[]}'
}

# --- 4. Deploy ------------------------------------------------------------------------------
if (-not $PlayersOnly) {
  $mapInfo = [ordered]@{
    worldName = $WorldName
    updatedAt = (Get-Date).ToUniversalTime().ToString('o')
    maps      = $maps
  }
  Write-TextFile $mapInfoPath ($mapInfo | ConvertTo-Json)
}

$playersInfo = [ordered]@{
  updatedAt = (Get-Date).ToUniversalTime().ToString('o')
  players   = @($players | ForEach-Object {
    [ordered]@{
      name      = $_.name
      dimension = $_.dimension
      x         = $_.x
      y         = $_.y
      z         = $_.z
      lastSeen  = [DateTimeOffset]::FromUnixTimeMilliseconds([long]$_.lastSeen).ToString('o')
    }
  })
}
# -InputObject keeps a one-element list as a JSON array on Windows PowerShell 5.1.
Write-TextFile (Join-Path $publicDir 'players.json') (ConvertTo-Json -InputObject $playersInfo -Depth 4)

$hostingConfig = [ordered]@{
  hosting = [ordered]@{
    site    = $HostingSite
    public  = 'public'
    ignore  = @('**/.*', 'sql.php', '**/*.map')
    headers = @(
      # map-info.json and players.json are fetched cross-origin by the page on palepail.com.
      [ordered]@{
        source  = '/@(map-info|players).json'
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
    '--message', "$(if ($PlayersOnly) { 'Players update' } else { 'Map render' }) $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
  )
} finally {
  Pop-Location
}
Write-Step 'Done'
