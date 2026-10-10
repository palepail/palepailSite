/** Written by `tools/minecraft-map/publish-map.ps1` next to the BlueMap webapp. */
export interface MapInfo {
  worldName?: string;
  updatedAt?: string;
  /** BlueMap map ids that were rendered, e.g. `overworld`, `nether`. */
  maps?: string[];
}

/** One player's last known position, from the server's "Palepail Last Seen" behavior pack. */
export interface PlayerLastSeen {
  name: string;
  /** BlueMap map id: `overworld`, `nether` or `end`. */
  dimension: string;
  x: number;
  y: number;
  z: number;
  /** ISO timestamp. */
  lastSeen: string;
}

/** `players.json`, refreshed on every publish (including `publish-map.ps1 -PlayersOnly`). */
export interface PlayersInfo {
  updatedAt?: string;
  players?: PlayerLastSeen[];
}
