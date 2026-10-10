# Minecraft world map

The viewer at `/projects/interactable/minecraft-map` shows map tiles from the Firebase Storage
bucket under `minecraft-map/`. `publish-map.ps1` runs on the Windows machine hosting the Bedrock
server. It snapshots the world, renders it with [uNmINeD](https://unmined.net), and uploads the
tiles, `manifest.json` and `markers.json`. The website never talks to the Minecraft server itself.

```
minecraft-map/
  manifest.json                       world name, last render time, per-dimension zoom/bounds
  markers.json                        named places (optional)
  overworld|nether|end/tiles/zoom.{z}/{x/10}/{y/10}/tile.{x}.{y}.jpeg
```

## One-time setup

### Firebase (from this repo, any machine)

Cloud Storage for Firebase requires the Blaze (pay-as-you-go) plan. A small world's tiles stay
well within the free usage.

1. In the Firebase console, open **Storage** and create the default bucket if it doesn't exist.
   Its name is the `storageBucket` value in the site's Firebase config.
2. Deploy the read-only rules: `firebase deploy --only storage`
   (this replaces any rules set in the console; `storage.rules` only opens `minecraft-map/`).
3. Allow the site to fetch the JSON files cross-origin:
   `gcloud storage buckets update gs://<bucket> --cors-file=tools/minecraft-map/cors.json`

### Windows server

1. Download **uNmINeD CLI** for Windows from https://unmined.net/downloads/ and extract it, e.g.
   to `C:\unmined-cli\`.
2. Install the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install), then sign in with
   the Google account that owns the Firebase project:
   ```powershell
   gcloud auth login
   gcloud config set project <firebase-project-id>
   ```
3. Copy `publish-map.ps1` to the server, e.g. `C:\minecraft-map\`. Optionally create
   `markers.json` next to it (see below).
4. Run it once by hand to check everything works:
   ```powershell
   powershell -ExecutionPolicy Bypass -File C:\minecraft-map\publish-map.ps1 `
     -WorldPath 'C:\bedrock-server\worlds\Bedrock level' `
     -Bucket '<project>.firebasestorage.app'
   ```
   The first upload takes a while; later runs only upload tiles that changed.

### Schedule it

Re-render every night at 4 AM (run from an elevated prompt, adjust paths):

```powershell
schtasks /Create /TN "Minecraft map" /SC DAILY /ST 04:00 /RU "$env:USERNAME" /RP `
  /TR "powershell -NoProfile -ExecutionPolicy Bypass -File C:\minecraft-map\publish-map.ps1 -WorldPath 'C:\bedrock-server\worlds\Bedrock level' -Bucket '<project>.firebasestorage.app'"
```

The task must run as the user that ran `gcloud auth login`.

## Markers

`markers.json` is a list of places; `dimension` is `overworld`, `nether` or `end`, and
`color` is optional. See `markers.example.json`. It is uploaded on every run, so edit it and
re-run the script (or upload it alone with
`gcloud storage cp markers.json gs://<bucket>/minecraft-map/markers.json --cache-control=no-cache`).

## Options and troubleshooting

| Parameter      | Default                          | Notes                                      |
| -------------- | -------------------------------- | ------------------------------------------ |
| `-UnminedCli`  | `C:\unmined-cli\unmined-cli.exe` |                                            |
| `-WorkDir`     | `C:\minecraft-map`               | Snapshot + render output; keep it          |
| `-Dimensions`  | `overworld, nether, end`         |                                            |
| `-ZoomOut`     | `6`                              | Levels below 1 block/pixel                 |
| `-ZoomIn`      | `2`                              | Levels above 1 block/pixel                 |
| `-ImageFormat` | `jpeg`                           | `png`/`webp` are sharper but larger        |
| `-WorldName`   | world's `levelname.txt`          | Title shown on the site                    |

- **Nether shows only the bedrock roof / unmined-cli rejects `--topY`:** the Nether is rendered
  from below the roof via `$DimensionArgs` at the top of the script. Check
  `unmined-cli help web render` for your version's flag name and adjust it there.
- **"Unexpected tile layout":** uNmINeD changed its output folder format. The script refuses to
  publish rather than upload tiles the viewer can't find.
- If one dimension fails, the others are still published and the failed one keeps its last good
  render on the site; the script exits with code 1 so Task Scheduler shows the failure.
- The map page says "hasn't been published yet" until `manifest.json` exists in the bucket.
