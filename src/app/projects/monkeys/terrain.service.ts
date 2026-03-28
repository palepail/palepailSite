import { Injectable } from '@angular/core';
import { TerrainChunkPlacement, TerrainSpriteMetadata } from './monkeys.types';
import * as CONST from './monkeys.constants';

@Injectable({
  providedIn: 'root',
})
export class TerrainService {
  terrain: number[][] = [];
  terrainChunkPlacements: TerrainChunkPlacement[] = [];
  terrainInteriorPlacements: TerrainChunkPlacement[] = [];
  terrainBottomPlacements: TerrainChunkPlacement[] = [];
  private terrainMetadataById: Map<number, TerrainSpriteMetadata> = new Map();
  private terrainMetadataLoaded = false;

  private readonly TERRAIN_MIN_TOP_Y = 40;
  private readonly TERRAIN_MAX_TOP_Y = CONST.TERRAIN_STRIP_HEIGHT - 120;
  private readonly TERRAIN_MIN_BOTTOM_Y = 180;
  private readonly TERRAIN_MAX_BOTTOM_Y = CONST.TERRAIN_STRIP_HEIGHT - 6;
  private readonly TERRAIN_MIN_THICKNESS = 90;
  private readonly TERRAIN_MAX_THICKNESS = 170;
  private readonly TERRAIN_MAX_CONSECUTIVE_FLATS = 3;

  async loadTerrainMetadata(): Promise<void> {
    if (this.terrainMetadataLoaded) return;

    try {
      const response = await fetch('assets/monkeys/terrain-metadata.json');
      if (!response.ok) return;
      const metadata = (await response.json()) as { sprites: TerrainSpriteMetadata[] };
      for (const sprite of metadata.sprites) {
        this.terrainMetadataById.set(sprite.id, sprite);
      }
      this.terrainMetadataLoaded = true;
    } catch {
      /* ignore load failure */
    }
  }

  generateTerrain(): void {
    this.terrain = Array.from({ length: CONST.TERRAIN_WIDTH }, () =>
      new Array(CONST.TERRAIN_STRIP_HEIGHT).fill(0),
    );

    this.terrainChunkPlacements = this.buildTopChunkPlan();
    this.terrainBottomPlacements = this.buildBottomChunkPlan(
      this.buildBottomProfile(this.terrainChunkPlacements),
    );
    this.terrainInteriorPlacements = this.buildInteriorPlacements(
      this.terrainChunkPlacements,
      this.terrainBottomPlacements,
    );

    this.rasterizeTerrainPlacements(
      this.terrainChunkPlacements,
      this.buildBottomProfile(this.terrainChunkPlacements).profile,
      this.terrainBottomPlacements,
    );
  }

  private buildTopChunkPlan(): TerrainChunkPlacement[] {
    const topFlat = this.getTerrainRegionsByType('top_flat').filter(
      (item) => ![8, 9].includes(item.id),
    );
    const topSlopeUp = this.getTerrainRegionsByType('top_slope_up');
    const topSlopeDown = this.getTerrainRegionsByType('top_slope_down');

    if (topFlat.length === 0 || topSlopeUp.length === 0 || topSlopeDown.length === 0) {
      return this.buildFallbackTerrainPlan();
    }

    const placements: TerrainChunkPlacement[] = [];
    let xCursor = 0;
    let consecutiveFlats = 0;
    let lastSlopeDir: 'flat' | 'up' | 'down' = 'flat';

    while (xCursor < CONST.TERRAIN_WIDTH) {
      const candidatePool = this.buildTopCandidatePool(
        topFlat,
        topSlopeUp,
        topSlopeDown,
        consecutiveFlats,
        this.randomInRange(this.TERRAIN_MIN_TOP_Y, this.TERRAIN_MAX_TOP_Y),
        lastSlopeDir,
      );

      if (candidatePool.length === 0) {
        break;
      }

      const selected = candidatePool[Math.floor(Math.random() * candidatePool.length)];
      placements.push(
        this.createPlacement(
          selected,
          xCursor,
          this.randomInRange(this.TERRAIN_MIN_TOP_Y, this.TERRAIN_MAX_TOP_Y),
        ),
      );

      const delta = selected.topExitY - selected.topEntryY;
      xCursor += selected.width;
      if (selected.pieceType === 'top_flat') {
        consecutiveFlats++;
        lastSlopeDir = 'flat';
      } else {
        consecutiveFlats = 0;
        lastSlopeDir = selected.pieceType === 'top_slope_down' ? 'up' : 'down';
      }
    }
    return placements;
  }

  private buildTopCandidatePool(
    topFlat: TerrainSpriteMetadata[],
    topSlopeUp: TerrainSpriteMetadata[],
    topSlopeDown: TerrainSpriteMetadata[],
    consecutiveFlats: number,
    currentTopY: number,
    lastSlopeDir: 'flat' | 'up' | 'down',
  ): TerrainSpriteMetadata[] {
    const shouldForceSlope = consecutiveFlats >= this.TERRAIN_MAX_CONSECUTIVE_FLATS;
    const pool: TerrainSpriteMetadata[] = [];

    if (!shouldForceSlope) {
      pool.push(...topFlat, ...topFlat, ...topFlat);
    }

    const canGoUp = currentTopY > this.TERRAIN_MIN_TOP_Y + 40;
    const canGoDown = currentTopY < this.TERRAIN_MAX_TOP_Y - 40;
    // Prevent consecutive same-direction slopes to keep height change within one interior tile.
    if (canGoUp && lastSlopeDir !== 'up') {
      pool.push(...topSlopeDown, ...topSlopeDown);
    }
    if (canGoDown && lastSlopeDir !== 'down') {
      pool.push(...topSlopeUp, ...topSlopeUp);
    }

    if (pool.length === 0) {
      pool.push(...topFlat);
    }

    return pool;
  }

  private buildBottomProfile(topPlacements: TerrainChunkPlacement[]): {
    profile: number[];
    chunkTypes: ('flat' | 'slope_up' | 'slope_down')[];
    chunkBottomY: number[];
  } {
    const topSurfaceProfile = this.rasterizeBoundaryProfile(topPlacements, 'top');
    const interiorHeight = 60; // one interior tile
    const topTileHeight = 34; // pixels from terrain surface to bottom of flat top sprite (height - topEntryY = 36 - 2)
    const FLAT_BOTTOM_ENTRY_Y = 21; // bottomEntryY of all flat bottom sprites; added to profile so bp.topWorldY lands on an interior tile boundary
    const tileWidth = 90;
    const profile = new Array<number>(CONST.TERRAIN_WIDTH).fill(0);

    // Use top surface + flat tile height as a consistent base so the
    // bottom profile doesn't jump by ~60px under top slope tiles.
    const fallbackSurface = Math.floor((this.TERRAIN_MIN_TOP_Y + this.TERRAIN_MAX_TOP_Y) / 2);

    // Plan depth in tile-sized chunks (90px wide), with depth changing
    // by at most 1 interior tile (60px) per chunk. Direction reversals
    // require at least one flat chunk between them (no ^ or V shapes).
    // +1 extra chunk so the visible last chunk has a real look-ahead for slope detection.
    const numChunks = Math.ceil(CONST.TERRAIN_WIDTH / tileWidth) + 1;
    const minTiles = 2;
    const maxTiles = 5;

    // Generate target depth per segment (in tile units, 3–6 chunks per segment).
    const targetDepths = new Array<number>(numChunks);
    let currentTarget = this.randomInRange(minTiles, maxTiles);
    let segRemaining = this.randomInRange(3, 6);
    for (let i = 0; i < numChunks; i++) {
      segRemaining--;
      if (segRemaining <= 0) {
        currentTarget = this.randomInRange(minTiles, maxTiles);
        segRemaining = this.randomInRange(3, 6);
      }
      targetDepths[i] = currentTarget;
    }

    // Check which chunks have a top surface slope (significant Y change).
    const topSlopeAtChunk = new Array<boolean>(numChunks).fill(false);
    for (let i = 0; i < numChunks; i++) {
      const xStart = Math.min(i * tileWidth, CONST.TERRAIN_WIDTH - 1);
      const xEnd = Math.min((i + 1) * tileWidth, CONST.TERRAIN_WIDTH - 1);
      const startSurf = Number.isFinite(topSurfaceProfile[xStart])
        ? topSurfaceProfile[xStart]
        : fallbackSurface;
      const endSurf = Number.isFinite(topSurfaceProfile[xEnd])
        ? topSurfaceProfile[xEnd]
        : fallbackSurface;
      topSlopeAtChunk[i] = Math.abs(endSurf - startSurf) > 15;
    }

    // Walk chunks toward their target depth, ±1 tile per chunk.
    // Skip depth changes on chunks where the top surface is already sloped
    // to prevent compounding (max ±60 total delta per chunk).
    const chunkDepths = new Array<number>(numChunks);
    const chunkTypes: ('flat' | 'slope_up' | 'slope_down')[] = new Array(numChunks);
    let depth = targetDepths[0];
    let lastDirection = 0; // -1=shallower, 0=flat, +1=deeper

    for (let i = 0; i < numChunks; i++) {
      const diff = targetDepths[i] - depth;
      let direction = 0;
      if (!topSlopeAtChunk[i]) {
        if (diff > 0 && lastDirection !== -1) {
          direction = 1;
        } else if (diff < 0 && lastDirection !== 1) {
          direction = -1;
        }
      }
      depth += direction;
      depth = Math.max(minTiles, depth);
      chunkDepths[i] = depth;
      lastDirection = direction;
    }

    // Fill per-pixel profile using actual top surface at each pixel.
    for (let i = 0; i < numChunks; i++) {
      const xStart = i * tileWidth;
      const xEnd = Math.min(xStart + tileWidth, CONST.TERRAIN_WIDTH);
      const prevDepth = i > 0 ? chunkDepths[i - 1] : chunkDepths[i];
      const currDepth = chunkDepths[i];

      for (let x = xStart; x < xEnd; x++) {
        const surfaceY = Number.isFinite(topSurfaceProfile[x])
          ? topSurfaceProfile[x]
          : fallbackSurface;
        const base = surfaceY + topTileHeight;
        const t = (x - xStart) / tileWidth;
        const depthPx = (prevDepth + t * (currDepth - prevDepth)) * interiorHeight;
        // Add FLAT_BOTTOM_ENTRY_Y so that bp.topWorldY (= profile - bottomEntryY) for flat tiles
        // lands exactly at the interior tile row boundary, giving zero gap/overlap.
        profile[x] = Math.round(base + depthPx) + FLAT_BOTTOM_ENTRY_Y;
      }
    }

    // Derive chunkBottomY and chunkTypes from the actual profile values
    // at chunk boundaries. This accounts for both depth changes AND top
    // surface slope, so tile selection matches what's visually happening.
    const chunkBottomY = new Array<number>(numChunks);
    for (let i = 0; i < numChunks; i++) {
      const x = Math.min(i * tileWidth, CONST.TERRAIN_WIDTH - 1);
      chunkBottomY[i] = profile[x];
    }
    for (let i = 0; i < numChunks; i++) {
      const nextY = i + 1 < numChunks ? chunkBottomY[i + 1] : chunkBottomY[i];
      const delta = nextY - chunkBottomY[i];
      // Round to nearest 60 to ignore ±1 rounding noise
      const rounded = Math.round(delta / interiorHeight) * interiorHeight;
      chunkTypes[i] = rounded > 0 ? 'slope_up' : rounded < 0 ? 'slope_down' : 'flat';
    }

    return { profile, chunkTypes, chunkBottomY };
  }

  private buildBottomChunkPlan({
    chunkBottomY,
    chunkTypes,
  }: {
    chunkBottomY: number[];
    chunkTypes: ('flat' | 'slope_up' | 'slope_down')[];
  }): TerrainChunkPlacement[] {
    const bottomFlat = this.getTerrainRegionsByType('bottom_flat').filter(
      (item) => ![8, 9].includes(item.id),
    );
    const bottomSlopeUp = this.getTerrainRegionsByType('bottom_slope_up');
    const bottomSlopeDown = this.getTerrainRegionsByType('bottom_slope_down');

    if (bottomFlat.length === 0) {
      return this.buildFallbackBottomPlan();
    }

    const placements: TerrainChunkPlacement[] = [];

    for (let i = 0; i < chunkTypes.length; i++) {
      const xCursor = i * 90;
      if (xCursor >= CONST.TERRAIN_WIDTH) break;

      const startY = chunkBottomY[i];
      let selected: TerrainSpriteMetadata;

      if (chunkTypes[i] === 'slope_up' && bottomSlopeDown.length > 0) {
        selected = bottomSlopeDown[Math.floor(Math.random() * bottomSlopeDown.length)];
      } else if (chunkTypes[i] === 'slope_down' && bottomSlopeUp.length > 0) {
        selected = bottomSlopeUp[Math.floor(Math.random() * bottomSlopeUp.length)];
      } else {
        selected = bottomFlat[Math.floor(Math.random() * bottomFlat.length)];
      }

      placements.push(this.createBottomPlacement(selected, xCursor, startY));
    }

    return placements;
  }

  private buildInteriorPlacements(
    topPlacements: TerrainChunkPlacement[],
    bottomPlacements: TerrainChunkPlacement[],
  ): TerrainChunkPlacement[] {
    const interiorRegions = this.getTerrainRegionsByType('interior');
    if (interiorRegions.length === 0) return [];

    // bottomCutoff = bp.topWorldY (top of bottom sprite). Because the profile now bakes in
    // FLAT_BOTTOM_ENTRY_Y, bp.topWorldY for flat tiles lands exactly on an interior tile row
    // boundary (fillStartY + d*60). For slope_up tiles whose entry bottomEntryY=80, bp.topWorldY
    // is ~60px higher, so Math.floor naturally gives d-1 interior tiles — the slope body
    // substitutes for the interior tile it replaces.
    const bottomCutoffByX = new Map<number, number>();
    for (const bp of bottomPlacements) {
      bottomCutoffByX.set(Math.floor(bp.x), Math.floor(bp.topWorldY));
    }

    const TILE_H = 60; // all interior tiles are exactly 60 px tall
    // TOP_SPRITE_DEPTH: pixels from terrain surface to bottom of a flat top sprite.
    // = height - topEntryY for flat tiles (36 - 2 = 34). Slope sprites are taller but
    // are drawn on top of interior, so any overlap is hidden.
    const TOP_SPRITE_DEPTH = 34;
    const placements: TerrainChunkPlacement[] = [];

    for (const top of topPlacements) {
      const startX = Math.max(0, Math.floor(top.x));
      // Start interior exactly at the bottom edge of the top sprite's solid area so there
      // is zero pixel gap and zero overlap between the top sprite and the first interior tile.
      const fillStartY = top.topWorldY + (top.region.topEntryY ?? 0) + TOP_SPRITE_DEPTH;
      const bottomCutoff = bottomCutoffByX.get(startX) ?? fillStartY + TILE_H;

      // Math.floor ensures we never place a tile that overshoots bp.topWorldY.
      const numTiles = Math.floor((bottomCutoff - fillStartY) / TILE_H);

      for (let i = 0; i < numTiles; i++) {
        const region = interiorRegions[Math.floor(Math.random() * interiorRegions.length)];
        placements.push({ region, x: top.x, topWorldY: fillStartY + i * TILE_H });
      }
    }
    return placements;
  }

  private buildFallbackTerrainPlan(): TerrainChunkPlacement[] {
    const fallbackRegion = this.requireTerrainRegion(11);
    const placements: TerrainChunkPlacement[] = [];
    const flatTopY = Math.floor((this.TERRAIN_MIN_TOP_Y + this.TERRAIN_MAX_TOP_Y) / 2);
    for (let x = 0; x < CONST.TERRAIN_WIDTH; x += fallbackRegion.width) {
      placements.push(this.createPlacement(fallbackRegion, x, flatTopY));
    }
    return placements;
  }

  private buildFallbackBottomPlan(): TerrainChunkPlacement[] {
    const fallbackRegion = this.requireTerrainRegion(13);
    const placements: TerrainChunkPlacement[] = [];
    const flatBottomY = Math.floor((this.TERRAIN_MIN_BOTTOM_Y + this.TERRAIN_MAX_BOTTOM_Y) / 2);
    for (let x = 0; x < CONST.TERRAIN_WIDTH; x += fallbackRegion.width) {
      placements.push(this.createBottomPlacement(fallbackRegion, x, flatBottomY));
    }
    return placements;
  }

  private requireTerrainRegion(id: number): TerrainSpriteMetadata {
    const region = this.terrainMetadataById.get(id);
    if (!region) {
      throw new Error(`Missing terrain metadata for region ${id}`);
    }
    return region;
  }

  private getTerrainRegionsByType(
    type: TerrainSpriteMetadata['pieceType'],
  ): TerrainSpriteMetadata[] {
    return Array.from(this.terrainMetadataById.values())
      .filter((region) => region.pieceType === type)
      .sort((a, b) => a.id - b.id);
  }

  private randomInRange(min: number, max: number): number {
    return Math.floor(min + Math.random() * (max - min + 1));
  }

  private createPlacement(
    region: TerrainSpriteMetadata,
    x: number,
    topAtLeft: number,
  ): TerrainChunkPlacement {
    return {
      region,
      x,
      topWorldY: topAtLeft - region.topEntryY,
    };
  }

  private createBottomPlacement(
    region: TerrainSpriteMetadata,
    x: number,
    bottomAtLeft: number,
  ): TerrainChunkPlacement {
    const localBottomEntry = this.getBottomProfileY(region, 0);
    return {
      region,
      x,
      topWorldY: bottomAtLeft - localBottomEntry,
    };
  }

  private getBottomProfileY(region: TerrainSpriteMetadata, t: number): number {
    const clampedT = Math.max(0, Math.min(1, t));
    const defaultBottomY = Math.max(0, region.height - 1);
    const bottomEntryY = region.bottomEntryY ?? defaultBottomY;
    const bottomExitY = region.bottomExitY ?? defaultBottomY;
    return Math.round(bottomEntryY + (bottomExitY - bottomEntryY) * clampedT);
  }

  private rasterizeTerrainPlacements(
    topPlacements: TerrainChunkPlacement[],
    bottomProfile: number[],
    bottomPlacements: TerrainChunkPlacement[],
  ): void {
    const topProfile = this.rasterizeBoundaryProfile(topPlacements, 'top');

    for (let x = 0; x < CONST.TERRAIN_WIDTH; x++) {
      const fallbackTop = Math.floor((this.TERRAIN_MIN_TOP_Y + this.TERRAIN_MAX_TOP_Y) / 2);
      const topY = Number.isFinite(topProfile[x]) ? topProfile[x] : fallbackTop;
      const bottomY = Math.min(this.TERRAIN_MAX_BOTTOM_Y, bottomProfile[x]);

      for (let y = topY; y <= bottomY; y++) {
        if (y >= 0 && y < CONST.TERRAIN_STRIP_HEIGHT) {
          this.terrain[x][y] = 1;
        }
      }
    }

    // Extend terrain grid to cover full visual extent of bottom sprites
    // using value 2 (visual-only) so the destination-out mask doesn't carve
    // into their rendered area, but brown fill and physics ignore them.
    for (const placement of bottomPlacements) {
      const startX = Math.max(0, Math.floor(placement.x));
      const endXExclusive = Math.min(
        CONST.TERRAIN_WIDTH,
        Math.floor(placement.x + placement.region.width),
      );
      const spriteTopY = Math.floor(placement.topWorldY);
      const spriteBottomY = Math.floor(placement.topWorldY + placement.region.height);
      for (let x = startX; x < endXExclusive; x++) {
        for (let y = spriteTopY; y < spriteBottomY; y++) {
          if (y >= 0 && y < CONST.TERRAIN_STRIP_HEIGHT && this.terrain[x][y] === 0) {
            this.terrain[x][y] = 2;
          }
        }
      }
    }
  }

  private rasterizeBoundaryProfile(
    placements: TerrainChunkPlacement[],
    boundary: 'top' | 'bottom',
  ): number[] {
    const profile = new Array<number>(CONST.TERRAIN_WIDTH).fill(NaN);

    for (const placement of placements) {
      const { region } = placement;
      const startX = Math.max(0, Math.floor(placement.x));
      const endXExclusive = Math.min(CONST.TERRAIN_WIDTH, Math.floor(placement.x + region.width));
      if (startX >= endXExclusive) {
        continue;
      }

      const widthDenominator = Math.max(1, region.width - 1);
      for (let x = startX; x < endXExclusive; x++) {
        const localX = x - placement.x;
        const t = Math.max(0, Math.min(1, localX / widthDenominator));
        const localY =
          boundary === 'top'
            ? region.topEntryY + (region.topExitY - region.topEntryY) * t
            : this.getBottomProfileY(region, t);
        const worldY = Math.max(0, Math.floor(placement.topWorldY + localY));

        if (!Number.isFinite(profile[x])) {
          profile[x] = worldY;
        } else if (boundary === 'top') {
          profile[x] = Math.min(profile[x], worldY);
        } else {
          profile[x] = Math.max(profile[x], worldY);
        }
      }
    }

    return profile;
  }
}
