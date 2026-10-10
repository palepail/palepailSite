export type DimensionId = 'overworld' | 'nether' | 'end';

export const DIMENSION_LABELS: Record<DimensionId, string> = {
  overworld: 'Overworld',
  nether: 'Nether',
  end: 'The End',
};

/** Block-coordinate bounds of the rendered area (inclusive min, exclusive max). */
export interface BlockBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/**
 * One rendered dimension. Zoom levels follow uNmINeD's convention:
 * 0 = 1 block per pixel, negative = zoomed out, positive = zoomed in.
 */
export interface DimensionManifest {
  minZoom: number;
  maxZoom: number;
  /**
   * Tile path relative to `minecraft-map/<dimension>/`.
   * Placeholders: {z} zoom, {x}/{y} tile index, {xd}/{yd} tile index / 10 (floored).
   */
  tilePath: string;
  bounds: BlockBounds;
  background?: string;
}

/** Written by `tools/minecraft-map/publish-map.ps1` to `minecraft-map/manifest.json`. */
export interface MapManifest {
  worldName?: string;
  updatedAt?: string;
  dimensions: Partial<Record<DimensionId, DimensionManifest>>;
}

/** Hand-edited `markers.json`, uploaded to `minecraft-map/markers.json`. */
export interface MapMarker {
  name: string;
  dimension: DimensionId;
  x: number;
  z: number;
  description?: string;
  color?: string;
}
