/** Written by `tools/minecraft-map/publish-map.ps1` next to the BlueMap webapp. */
export interface MapInfo {
  worldName?: string;
  updatedAt?: string;
  /** BlueMap map ids that were rendered, e.g. `overworld`, `nether`. */
  maps?: string[];
}
