# Minecraft world map

The viewer at `/projects/interactable/minecraft-map` loads map tiles from the Firebase project's
default Hosting site, `https://<projectId>.web.app`. `publish-map.ps1` runs on the Windows machine
hosting the Bedrock server. It snapshots the world, renders it with [uNmINeD](https://unmined.net),
and deploys the tiles, `manifest.json` and `markers.json` with the Firebase CLI. The website never
talks to the Minecraft server itself.

Firebase Hosting is part of the free Spark plan: 10 GB stored and 360 MB transferred per day.
Tiles are ordinary static files served from Google's CDN and cached by browsers. There is no
per-file read quota, only that daily transfer limit (roughly 15,000 tiles a day).

```
https://<projectId>.web.app/
  manifest.json                        world name, last render time, per-dimension zoom/bounds
  markers.json                         named places (optional)
  overworld|nether|end/tiles/zoom.{z}/{x/10}/{y/10}/tile.{x}.{y}.jpeg
```

## One-time setup (on the server)

1. **uNmINeD CLI**: download the Windows CLI from https://unmined.net/downloads/ and extract it.
   The script expects `X:\Programs\Unmined\unmined-cli_0.20.11-dev_win-64bit\unmined-cli.exe`;
   pass `-UnminedCli` if yours is elsewhere (e.g. after updating uNmINeD).
2. **Firebase CLI**: install [Node.js](https://nodejs.org) LTS, then in a new PowerShell window:
   ```powershell
   npm install -g firebase-tools
   firebase login          # the Google account that owns the Firebase project
   ```
3. In the [Firebase console](https://console.firebase.google.com), open the project's
   **Hosting** page and click **Get started** if Hosting isn't set up yet (you can skip the
   CLI steps it shows). Under **Release storage settings**, keep only 2 releases. Old releases
   count toward the 10 GB.

## Publish

```powershell
powershell -ExecutionPolicy Bypass -File X:\Development\palepailSite\tools\minecraft-map\publish-map.ps1
```

With no arguments it renders `E:\Games\Minecraft Bedrock Server\worlds\Bedrock level` and
deploys to the Firebase project in `src/environments/environment.ts` (`projectId`), so run it from
this repo's copy of the script. See the options table to override either.

The first run renders and uploads everything; later runs only upload tiles that changed. When it
prints `Done`, the map is live on palepail.com and on `npm start` locally.

The script keeps the full published site in `C:\minecraft-map\site\`. A Hosting deploy replaces
the whole site, so don't delete that folder. If you do, the next run re-renders and re-uploads
everything.

### Schedule it

Re-render every night at 4 AM (run from an elevated prompt):

```powershell
schtasks /Create /TN "Minecraft map" /SC DAILY /ST 04:00 /RU "$env:USERNAME" /RP `
  /TR "powershell -NoProfile -ExecutionPolicy Bypass -File X:\Development\palepailSite\tools\minecraft-map\publish-map.ps1"
```

The task must run as the user that ran `firebase login`.

## Markers

Copy `markers.example.json` to `markers.json` in this folder and edit it. `dimension` is
`overworld`, `nether` or `end`, and `color` is optional. It is published on every run.

## Options and troubleshooting

| Parameter      | Default                          | Notes                                      |
| -------------- | -------------------------------- | ------------------------------------------ |
| `-WorldPath`   | `E:\Games\Minecraft Bedrock Server\worlds\Bedrock level` |              |
| `-ProjectId`   | `projectId` in `environment.ts`  |                                            |
| `-UnminedCli`  | `X:\Programs\Unmined\unmined-cli_0.20.11-dev_win-64bit\unmined-cli.exe` | |
| `-WorkDir`     | `C:\minecraft-map`               | Snapshot + published site; keep it         |
| `-Dimensions`  | `overworld, nether, end`         | Others stay on the map with their last render |
| `-ZoomOut`     | `6`                              | Levels below 1 block/pixel                 |
| `-ZoomIn`      | `2`                              | Levels above 1 block/pixel                 |
| `-ImageFormat` | `jpeg`                           | `png`/`webp` are sharper but larger        |
| `-WorldName`   | world's `levelname.txt`          | Title shown on the site                    |
| `-HostingSite` | the project ID                   | Only if the default site ID differs        |

- **Nether shows only the bedrock roof / unmined-cli rejects `--topY`:** the Nether is rendered
  from below the roof via `$DimensionArgs` at the top of the script. Check
  `unmined-cli help web render` for your version's flag name and adjust it there.
- **"Unexpected tile layout":** uNmINeD changed its output folder format. The script refuses to
  publish rather than deploy tiles the viewer can't find.
- If one dimension fails, the others are still published and the failed one keeps its last good
  render; the script exits with code 1 so Task Scheduler shows the failure.
- **Map page says "hasn't been published yet":** nothing is deployed yet, or the default Hosting
  site ID isn't the project ID (check the Hosting page; the viewer uses `<projectId>.web.app`).
- **Over the daily transfer limit:** on Spark, Hosting stops serving until the quota resets.
