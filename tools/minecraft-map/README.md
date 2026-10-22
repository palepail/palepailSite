# Minecraft world map

The page at `/projects/interactable/minecraft-map` embeds a 3D [BlueMap](https://bluemap.bluecolored.de)
of the Bedrock server's world, hosted on the Firebase project's default Hosting site,
`https://<projectId>.web.app`. `publish-map.ps1` builds and deploys it from the server:

1. Snapshots the Bedrock world (so the running server's files aren't read mid-write).
2. Converts the snapshot to a Java Edition world with [Chunker](https://github.com/HiveGamesOSS/Chunker),
   because BlueMap only reads Java worlds.
3. Renders it with the BlueMap CLI into a static copy of BlueMap's web viewer. There's one map per
   dimension that exists, and your `markers.json` becomes a "Places" marker set.
4. Deploys that folder with `firebase deploy --only hosting`.

Map updates never go through git. Running the script updates palepail.com and `npm start`
directly. Firebase Hosting is part of the free Spark plan: 10 GB stored, 360 MB transferred per day.

## One-time setup (on the server)

1. **Java 25** or newer, which BlueMap 5.28+ requires. For example, Temurin 25 from
   https://adoptium.net. Check with `java -version`.
2. **BlueMap CLI**: download `bluemap-5.29-cli.jar` from
   https://github.com/BlueMap-Minecraft/BlueMap/releases to `X:\Programs\BlueMap\`.
3. **Chunker CLI**: download the latest `chunker-cli-<version>.jar` from
   https://github.com/HiveGamesOSS/Chunker/releases to `X:\Programs\Chunker\`. The script
   expects `chunker-cli-1.21.0.jar`; pass `-ChunkerJar` for another version.
4. **Firebase CLI**: install [Node.js](https://nodejs.org) LTS, then:
   ```powershell
   npm install -g firebase-tools
   firebase login          # the Google account that owns the Firebase project
   ```
5. In the [Firebase console](https://console.firebase.google.com), open **Hosting**, click
   **Get started** if needed, and under **Release storage settings** keep only 2 releases.

**Minecraft EULA:** BlueMap downloads the Minecraft Java Edition client from Mojang for block
textures. Passing `-AcceptMinecraftEula` confirms you accept
[Mojang's EULA](https://www.minecraft.net/eula) and own Minecraft Java Edition. PC copies bought
since 2022 include Java ("Java & Bedrock Edition").

## Publish

```powershell
powershell -ExecutionPolicy Bypass -File X:\Development\palepailSite\tools\minecraft-map\publish-map.ps1 -AcceptMinecraftEula
```

It renders `E:\Games\Minecraft Bedrock Server\worlds\Bedrock level` and deploys to the Firebase
project in `src/environments/environment.ts`. Dimensions nobody has visited yet (no data in the
world) are skipped and appear on a later run.

The first render can take a long time on a big world. After that BlueMap only re-renders chunks
that changed, so keep `C:\minecraft-map\` between runs. Chunker doesn't record when chunks
changed, so `read-last-seen\stamp-regions.js` compares each chunk with the previous run (state in
`chunk-stamps.json`) and marks only the changed ones for BlueMap. The log shows "N of M chunks
changed". When a setting that's baked into the
tiles changes (`-AmbientLight`, `-UseLightData`, `-HideCaves`, `-MinecraftVersion`), the script automatically
re-renders everything once.

To go easy on the PC, the publish runs at idle CPU priority on a quarter of the cores, with BlueMap limited to 2 GB of
memory. It also skips the
conversion and render completely when no blocks or biomes changed since the last render, for
example on a day nobody played. Then it only refreshes the players. `read-last-seen\world-hash.js`
does that check, which takes seconds. Pass `-ForceRender` to render anyway.

### Schedule it

Re-render every day at 8 PM. Run this once:

```powershell
powershell -ExecutionPolicy Bypass -File X:\Development\palepailSite\tools\minecraft-map\register-map-task.ps1
```

It registers the **Minecraft map** task. It runs as you while you're logged in, so it uses your
`firebase login`, Java and Node.
Each run's output goes to `C:\minecraft-map\publish.log`. Useful extras:

- Run it now: `Start-ScheduledTask -TaskName 'Minecraft map'`
- Another time: `register-map-task.ps1 -At 09:00`
- Remove it: `Unregister-ScheduledTask -TaskName 'Minecraft map'`

## Markers

Copy `markers.example.json` to `markers.json` in this folder and edit it:

- `dimension` is `overworld`, `nether` or `end`.
- `y` (height) is optional and defaults to 64. In 3D the pin sits at that height, so use the
  in-game Y of the place.
- `description` is optional and shown when the pin is clicked.

## Players (last seen)

The **Palepail Last Seen** behavior pack (`last-seen-pack/`) records each player's name, position,
dimension and time when they join and leave, and every minute while they're online. It uses only
the stable Script API, so the world needs no experiments. It saves the data inside the world as
dynamic properties. On every publish, `read-last-seen/` reads it from the snapshot, using Node.js
and the `leveldb-zlib` package, which the script installs on first use. The publish then:

- adds a **Players** marker set to the map, with pins labelled "name - last seen Oct 10, 14:32";
- writes `players.json`, which the page shows as a list beside the map. Click a name to fly there.

**Install once** (from this folder, then restart the server):

```powershell
powershell -ExecutionPolicy Bypass -File X:\Development\palepailSite\tools\minecraft-map\install-last-seen-pack.ps1
```

It copies the pack to `E:\Games\Minecraft Bedrock Server\behavior_packs\` and enables it in
the world's `world_behavior_packs.json`. Pass `-ServerPath` and `-WorldName` if those differ.
Players appear once they've joined with the pack loaded, and the world has saved, which the server
does every few minutes.

**Keep it fresh:** `-PlayersOnly` re-reads players and updates just the pins and list, with no
conversion or render, so it only takes seconds. To also schedule it every 15 minutes (log:
`C:\minecraft-map\publish-players.log`):

```powershell
powershell -ExecutionPolicy Bypass -File X:\Development\palepailSite\tools\minecraft-map\register-map-task.ps1 -PlayersEveryMinutes 15
```

If the player data can't be read, the map still publishes, without players, and the script
prints a warning.

## Find an item (offline players too)

`/testfor @a[hasitem=...]` only checks players who are online. `read-last-seen\find-item.js` reads
the saved world instead, so it covers everyone who has ever joined. It searches inventories,
ender chests, armour and offhand, including items inside shulker boxes:

```powershell
cd X:\Development\palepailSite\tools\minecraft-map\read-last-seen
node find-item.js enchanted_golden_apple
```

- Add `--containers` to also search chests, barrels, placed shulker boxes, chest minecarts,
  donkeys, item frames and dropped items.
- Any item ID works, e.g. `diamond` or `minecraft:totem_of_undying`.
- Player names come from the Last Seen pack. Players it hasn't recorded show as "Unknown
  player" with their saved position.
- It reads the live world, `E:\Games\Minecraft Bedrock Server\worlds\Bedrock level`, by default.
  To read another world, pass its folder first: `node find-item.js "D:\backup\Bedrock level" diamond`.
  The server can stay running: the script then reads a copy taken on the spot. That copy is as
  current as the world on disk, usually a few seconds behind the game.
- Run `npm ci` here first if the publish script hasn't installed the packages yet.

## Container log (who took what)

The same pack (version 1.1.0 and newer) logs container activity:

- items put into or taken out of chests, barrels, shulker boxes, hoppers, furnaces and other
  containers, with who did it;
- containers broken by a player, and what was in them;
- containers blown up, by what (creeper, TNT...), and what was in them.

Each entry is printed to the server console as `[activity] Alice took 2 enchanted_golden_apple
from chest at overworld 16 64 33`, and saved in the world. The world keeps about the latest 3 MB,
which is tens of thousands of entries. To print it:

```powershell
cd X:\Development\palepailSite\tools\minecraft-map\read-last-seen
node read-activity-log.js
node read-activity-log.js --item enchanted_golden_apple
node read-activity-log.js --player Alice
node read-activity-log.js --near 16,33 --action took
```

`--near x,z,radius` defaults to a 10-block radius. Like `find-item.js`, it reads the live world
(the server can keep running), or the world folder you give it first.

Limits:

- There's no "container changed" event in the stable Script API. The pack checks an opened
  container every half second while the player who opened it stays within 8 blocks. A hopper
  filling or draining a chest while someone has it open is credited to them.
- If two players have the same container open, the entry names both ("Alice or Bob").
- Hoppers and other automatic changes aren't logged when nobody has the container open.
- Ender chests are per-player, so they aren't logged.
- Entries only have a real date if the server's script clock works. Otherwise they show the
  in-game day, and the console line carries the real time. To keep the console, turn on
  `content-log-file-enabled=true` in `server.properties`.

After updating the pack, re-run `install-last-seen-pack.ps1` and restart the server.

## Options

| Parameter              | Default                                                   |
| ---------------------- | --------------------------------------------------------- |
| `-WorldPath`           | `E:\Games\Minecraft Bedrock Server\worlds\Bedrock level`  |
| `-ProjectId`           | `projectId` in `environment.ts`                           |
| `-JavaExe`             | `java` (must be 25+)                                      |
| `-BlueMapJar`          | `X:\Programs\BlueMap\bluemap-5.29-cli.jar`                |
| `-ChunkerJar`          | `X:\Programs\Chunker\chunker-cli-1.21.0.jar`              |
| `-MinecraftVersion`    | `26.3`: the Java version Chunker converts to and BlueMap renders. Use the newest `JAVA_*` that Chunker lists (`-f ?`), or newer biomes and blocks are replaced by older ones |
| `-WorkDir`             | `C:\minecraft-map`                                        |
| `-RenderThreads`       | a quarter of the CPU cores; also caps Chunker's threads   |
| `-BlueMapMemory`       | `2G`: BlueMap's max memory                                |
| `-Priority`            | `Idle`: the publish only uses CPU nothing else wants. `BelowNormal` or `Normal` finish sooner |
| `-ChunkerMemory`       | `4G`                                                      |
| `-AmbientLight`        | `1` (fully lit; see below)                                |
| `-UseLightData`        | off                                                       |
| `-HideCaves`           | off: caves are rendered so free-flight can go underground; on leaves out Overworld caves below Y 55 (smaller, faster render) |
| `-ForceRender`         | off; re-renders everything (automatic after a lighting/version change) |
| `-PlayersOnly`         | off; only refreshes player pins and `players.json` (needs one full publish first) |

## Troubleshooting

- **Lighting / day-night toggle:** Chunker's command line doesn't calculate lighting; it writes
  all-dark light data. With BlueMap's normal settings the map then looks like permanent night.
  The script therefore sets `-AmbientLight 1`, which lights every block fully. Faces are still
  shaded by direction, but there are no shadows, and the day/night slider has little effect.
- **`UnsupportedClassVersionError`:** the `java` being used is older than 25. Install Java 25 or
  pass `-JavaExe 'C:\path\to\jdk-25\bin\java.exe'`.
- **Chunker rejects the format:** run `java -jar <chunker jar> -f ?` to list the `JAVA_*` formats
  it supports, and pass a matching `-MinecraftVersion` (e.g. `JAVA_1_21_11` → `1.21.11`).
- **Map page says "hasn't been published yet":** nothing is deployed yet, or the default Hosting
  site ID isn't the project ID. The page loads `https://<projectId>.web.app/map-info.json`.
- **Gaps in the map where people have been:** `read-last-seen\map-coverage.js` counts the
  generated chunks in a Bedrock world and checks which made it into the converted Java world.
  Run `npm ci` in `read-last-seen\` first if the publish script hasn't installed it yet. Then:
  ```powershell
  cd X:\Development\palepailSite\tools\minecraft-map\read-last-seen
  node map-coverage.js "C:\minecraft-map\snapshot\db" "C:\minecraft-map\java-world" "C:\minecraft-map\bluemap\site\public\maps"
  ```
  It also writes `coverage-<dimension>.png`, one square per chunk with north up: green is
  rendered, orange is converted but not rendered, red is lost in conversion.
  Run it on the live world's `db` too, with the server stopped. Fewer chunks in the snapshot than
  in the live world means the copy missed data. Chunks missing from the Java world point at the
  Chunker conversion. Chunks with status `empty` are skipped by BlueMap.
- **New areas are black from far away but fine up close:** far away, the viewer uses the
  low-detail tiles, and those cover big areas that change in place. First try a hard refresh
  (Ctrl+F5), since your browser may still have the old version. If `publish.log` shows `Failed to
  load tile ... Error skipping PNG metadata`, a low-detail tile file was cut off (for example
  when a render was stopped part-way). BlueMap then rebuilds that tile with only the newly
  rendered chunks. Each publish now checks for cut-off tiles, deletes them, and re-renders
  everything once to rebuild them. The log then shows "Removed N damaged low-detail tile(s)".
- **Over the daily transfer limit:** on Spark, Hosting stops serving until the quota resets.
- The old uNmINeD output in `C:\minecraft-map\site\` is no longer used and can be deleted.
