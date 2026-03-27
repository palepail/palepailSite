// monkeys-game.service.ts
// Service handling core game logic for Monkeys

import { Injectable } from '@angular/core';
import {
  Player,
  Enemy,
  GameState,
  Explosion,
  DamageText,
  TurnEntity,
  ExplodedProjectile,
  Projectile,
  TerrainChunkPlacement,
  TerrainSpriteMetadata,
  Vehicle,
  EquipmentItem,
  EquipmentSlot,
} from './monkeys.types';
import * as CONST from './monkeys.constants';
import { MonkeysSpriteService } from './monkeys-sprite.service';

@Injectable({
  providedIn: 'root',
})
export class MonkeysGameService {
  // Matter.js functions (passed from component)
  public Engine: any;
  public Runner: any;
  public Bodies: any;
  public World: any;
  public Events: any;
  public Body: any;
  public Composite: any;

  // Game state
  private engine: any;
  private world: any;
  private runner: any;

  // Game data
  terrain: number[][] = [];
  terrainChunkPlacements: TerrainChunkPlacement[] = [];
  terrainInteriorPlacements: TerrainChunkPlacement[] = [];
  terrainBottomPlacements: TerrainChunkPlacement[] = [];
  player: Player;
  enemies: Enemy[] = [];
  projectile: Projectile | null = null;
  explosions: Explosion[] = [];
  explodedProjectiles: ExplodedProjectile[] = [];
  damageTexts: DamageText[] = [];
  public panToEntity: any = null;
  currentState: GameState = GameState.MENU;
  difficulty: 'easy' | 'normal' | 'hard' = 'normal';

  // Turn-based system
  private _turnQueue: TurnEntity[] = [];
  currentTurnIndex: number = 0;
  turnTime: number = 0; // Current turn timer
  private _turnStartTime: number = 0;
  private lastUpdateTime = Date.now();
  private readonly TIMEOUT_MS = 45000;
  private readonly VEHICLE_NO_COLLISION_GROUP = -1;
  private readonly TERRAIN_MIN_TOP_Y = 40;
  private readonly TERRAIN_MAX_TOP_Y = CONST.TERRAIN_STRIP_HEIGHT - 120;
  private readonly TERRAIN_MIN_BOTTOM_Y = 180;
  private readonly TERRAIN_MAX_BOTTOM_Y = CONST.TERRAIN_STRIP_HEIGHT - 6;
  private readonly TERRAIN_MIN_THICKNESS = 90;
  private readonly TERRAIN_MAX_THICKNESS = 170;
  private readonly TERRAIN_MAX_CONSECUTIVE_FLATS = 3;
  private terrainMetadataById: Map<number, TerrainSpriteMetadata> = new Map();
  private terrainMetadataLoaded = false;

  get turnStartTime(): number {
    return this._turnStartTime;
  }
  // Flags
  isCharging = false;
  chargeStartTime = 0;

  // Trajectory cache
  private trajectoryCache: Map<
    string,
    { positions: { x: number; y: number }[]; endReason: string }
  > = new Map();

  // Input
  keys: { [key: string]: boolean } = {};

  // Game over delay
  private gameOverTimer: number = 0;
  private winTimer: number = 0;

  // Loadout / equipment
  playerName = 'Player';
  equipped: Record<EquipmentSlot, EquipmentItem | null> = {
    headgear: null,
    torso: null,
    legs: null,
    footwear: null,
    accessory: null,
  };
  equipmentItems: EquipmentItem[] = [];
  private equipmentLoadPromise: Promise<void> | null = null;

  constructor(private spriteService: MonkeysSpriteService) {
    this.player = this.createInitialPlayer();
    void this.loadEquipmentData();
  }

  simulateTrajectory(
    startX: number,
    startY: number,
    angleRad: number,
    power: number,
    bullet: any,
  ): { positions: { x: number; y: number }[]; endReason: string } {
    const cacheKey = `${startX.toFixed(1)}_${startY.toFixed(1)}_${angleRad.toFixed(3)}_${power.toFixed(1)}_${bullet.name}`;
    if (this.trajectoryCache.has(cacheKey)) {
      return this.trajectoryCache.get(cacheKey)!;
    }

    const tempEngine = this.Engine.create();
    tempEngine.world.gravity.y = CONST.GRAVITY_STRENGTH;

    const velocity = (power / 100) * bullet.speed;
    const vx = Math.cos(angleRad) * velocity;
    const vy = -Math.sin(angleRad) * velocity;

    const projectile = this.Bodies.circle(startX, startY, CONST.PROJECTILE_RADIUS, {
      friction: CONST.PROJECTILE_FRICTION,
      restitution: CONST.PROJECTILE_RESTITUTION,
      frictionAir: 0,
    });
    this.Body.setVelocity(projectile, { x: vx, y: vy });
    this.World.add(tempEngine.world, projectile);

    const positions: { x: number; y: number }[] = [];
    let endReason = 'timeout';
    const maxSteps = 1000;
    let step = 0;

    while (step < maxSteps) {
      // Record position
      positions.push({ x: projectile.position.x, y: projectile.position.y });

      // Apply wind force
      this.Body.applyForce(projectile, projectile.position, { x: CONST.WIND_STRENGTH, y: 0 });

      // Update simulation
      this.Engine.update(tempEngine, 16.666); // ~60 FPS

      step++;
    }

    // Clean up
    this.World.remove(tempEngine.world, projectile);

    const result = { positions, endReason };
    this.trajectoryCache.set(cacheKey, result);
    return result;
  }

  setMatterJS(matter: any) {
    this.Engine = matter.Engine;
    this.Runner = matter.Runner;
    this.Bodies = matter.Bodies;
    this.World = matter.World;
    this.Events = matter.Events;
    this.Body = matter.Body;
    this.Composite = matter.Composite;
  }

  private createEntity(entity: Player | Enemy, x: number, y: number) {
    entity.x = x;
    entity.y = y;
    entity.terrainAngle = this.getTerrainAngleAt(x);
    entity.body = this.Bodies.rectangle(x, y, 30, 30, {
      friction: CONST.PLAYER_FRICTION,
      frictionAir: CONST.PLAYER_AIR_FRICTION,
      restitution: CONST.PLAYER_RESTITUTION,
      density: CONST.PLAYER_DENSITY,
      collisionFilter: { group: this.VEHICLE_NO_COLLISION_GROUP },
    });
    this.World.add(this.world, entity.body);
  }

  private createInitialPlayer(): Player {
    return {
      body: null,
      x: CONST.PLAYER_START_X,
      y: 0,
      angle: CONST.PLAYER_START_ANGLE,
      power: CONST.PLAYER_START_POWER,
      maxPower: CONST.MAX_POWER,
      health: CONST.PLAYER_START_HEALTH,
      movementFuel: CONST.PLAYER_START_MOVEMENT_FUEL,
      color: '#4ECDC4',
      active: true,
      facing: CONST.PLAYER_START_FACING,
      terrainAngle: CONST.PLAYER_START_TERRAIN_ANGLE,
      vehicle: null as any, // Will be assigned in initPlayer
      turnState: 'turn_start',
      turnTimer: 0,
      delay: 0,
    };
  }

  async initGame() {
    this.gameOverTimer = 0;
    this.winTimer = 0;
    this.trajectoryCache.clear();
    await this.ensureTerrainMetadataLoaded();
    this.generateTerrain();
    this.initPhysics();
    this.initPlayer();
    this.spawnEnemies();
    this.initTurnQueue();
    this.startTurn();
    this.currentState = GameState.SETUP;
  }

  private async ensureTerrainMetadataLoaded(): Promise<void> {
    if (this.terrainMetadataLoaded) {
      return;
    }

    const metadata = await this.spriteService.loadTerrainMetadata();
    this.terrainMetadataById.clear();
    for (const sprite of metadata.sprites) {
      this.terrainMetadataById.set(sprite.id, sprite);
    }
    this.terrainMetadataLoaded = true;
  }

  private generateTerrain() {
    this.terrain = [];
    for (let x = 0; x < CONST.TERRAIN_WIDTH; x++) {
      this.terrain[x] = [];
      for (let y = 0; y < CONST.TERRAIN_STRIP_HEIGHT; y++) {
        this.terrain[x][y] = 0; // Air
      }
    }

    const topPlacements = this.buildTerrainChunkPlan();
    const { profile: bottomProfile, chunkTypes, chunkBottomY } = this.buildBottomProfile(topPlacements);
    const bottomPlacements = this.buildBottomChunkPlan(chunkBottomY, chunkTypes);
    this.terrainChunkPlacements = topPlacements;
    this.terrainBottomPlacements = bottomPlacements;
    this.rasterizeTerrainPlacements(topPlacements, bottomProfile, bottomPlacements);
    this.terrainInteriorPlacements = this.buildInteriorPlacements(topPlacements, bottomProfile);
  }

  private buildTerrainChunkPlan(): TerrainChunkPlacement[] {
    const topFlat = this.getTerrainRegionsByType('top_flat');
    const topSlopeUp = this.getTerrainRegionsByType('top_slope_up');
    const topSlopeDown = this.getTerrainRegionsByType('top_slope_down');

    if (topFlat.length === 0 || topSlopeUp.length === 0 || topSlopeDown.length === 0) {
      return this.buildFallbackTerrainPlan();
    }

    const placements: TerrainChunkPlacement[] = [];
    const topStartMin = 80;
    const topStartMax = 140;
    let currentTopY = this.randomInRange(topStartMin, topStartMax);
    let xCursor = 0;
    let consecutiveFlats = 0;
    let lastSlopeDir: 'flat' | 'up' | 'down' = 'flat';

    while (xCursor < CONST.TERRAIN_WIDTH) {
      const candidatePool = this.buildTopCandidatePool(
        topFlat,
        topSlopeUp,
        topSlopeDown,
        consecutiveFlats,
        currentTopY,
        lastSlopeDir,
      );

      if (candidatePool.length === 0) {
        break;
      }

      const selected = candidatePool[Math.floor(Math.random() * candidatePool.length)];
      placements.push(this.createPlacement(selected, xCursor, currentTopY));

      const delta = selected.topExitY - selected.topEntryY;
      currentTopY += delta;
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
    const topTileHeight = 37; // approximate top sprite height
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
      const startSurf = Number.isFinite(topSurfaceProfile[xStart]) ? topSurfaceProfile[xStart] : fallbackSurface;
      const endSurf = Number.isFinite(topSurfaceProfile[xEnd]) ? topSurfaceProfile[xEnd] : fallbackSurface;
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
        profile[x] = Math.round(base + depthPx);
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

  private buildBottomChunkPlan(
    chunkBottomY: number[],
    chunkTypes: ('flat' | 'slope_up' | 'slope_down')[],
  ): TerrainChunkPlacement[] {
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

  private buildInteriorPlacements(
    topPlacements: TerrainChunkPlacement[],
    bottomProfile: number[],
  ): TerrainChunkPlacement[] {
    const interiorRegions = this.getTerrainRegionsByType('interior');
    if (interiorRegions.length === 0) return [];

    const placements: TerrainChunkPlacement[] = [];
    for (const top of topPlacements) {
      const startX = Math.max(0, Math.floor(top.x));
      const endXExclusive = Math.min(CONST.TERRAIN_WIDTH, Math.floor(top.x + top.region.width));

      // Use the shallowest (min) bottom profile value across this chunk's columns
      // so no interior tile extends below the bottom profile at any column.
      let minBottomY = Number.POSITIVE_INFINITY;
      for (let x = startX; x < endXExclusive; x++) {
        minBottomY = Math.min(minBottomY, bottomProfile[x]);
      }
      if (!Number.isFinite(minBottomY)) {
        minBottomY = CONST.TERRAIN_STRIP_HEIGHT;
      }

      const fillStartY = Math.floor(top.topWorldY + top.region.height);
      let y = fillStartY;
      while (y < minBottomY) {
        const region = interiorRegions[Math.floor(Math.random() * interiorRegions.length)];
        const nextY = y + region.height;

        if (nextY <= minBottomY) {
          placements.push({ region, x: top.x, topWorldY: y });
          y = nextY;
          continue;
        }

        // Final interior tile: anchor flush with bottom cutoff so there's
        // no visible gap above the bottom tile. Allow overlap with the
        // previous interior tile (they're solid fill), but don't go above
        // the top tile's lower edge.
        const anchoredY = Math.floor(minBottomY - region.height);
        if (anchoredY >= fillStartY) {
          placements.push({ region, x: top.x, topWorldY: anchoredY });
        }
        break;
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
    return min + Math.random() * (max - min);
  }

  private initPhysics() {
    this.engine = this.Engine.create();
    this.world = this.engine.world;
    this.engine.world.gravity.y = CONST.GRAVITY_STRENGTH;

    this.runner = this.Runner.create();
    this.Runner.run(this.runner, this.engine);
  }

  async loadEquipmentData(): Promise<void> {
    if (this.equipmentLoadPromise) return this.equipmentLoadPromise;
    this.equipmentLoadPromise = (async () => {
      try {
        const response = await fetch('assets/monkeys/equipment.json');
        if (!response.ok) return;
        const data = (await response.json()) as { items: EquipmentItem[] };
        this.equipmentItems = data.items;
        this.loadLoadout();
      } catch {
        /* ignore load failure */
      }
    })();
    return this.equipmentLoadPromise;
  }

  getItemsForSlot(slot: EquipmentSlot): EquipmentItem[] {
    return this.equipmentItems.filter((i) => i.slot === slot);
  }

  saveLoadout(): void {
    const savedEquipped: Record<string, string | null> = {};
    for (const slot of ['headgear', 'torso', 'legs', 'footwear', 'accessory'] as EquipmentSlot[]) {
      savedEquipped[slot] = this.equipped[slot]?.id ?? null;
    }
    localStorage.setItem(
      'monkeys_loadout',
      JSON.stringify({ playerName: this.playerName, equipped: savedEquipped }),
    );
  }

  private loadLoadout(): void {
    const raw = localStorage.getItem('monkeys_loadout');
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as {
        playerName?: string;
        equipped?: Record<string, string | null>;
      };
      if (typeof data.playerName === 'string' && data.playerName.trim()) {
        this.playerName = data.playerName.trim().slice(0, 12);
      }
      if (data.equipped) {
        for (const [slot, id] of Object.entries(data.equipped)) {
          if (!id) continue;
          const item = this.equipmentItems.find((i) => i.id === id) ?? null;
          if (item) (this.equipped as Record<string, EquipmentItem | null>)[slot] = item;
        }
      }
    } catch {
      /* corrupted data, ignore */
    }
  }

  private applyEquipmentToVehicle(vehicle: Vehicle): void {
    for (const item of Object.values(this.equipped)) {
      if (!item?.stats) continue;
      if (item.stats.attack) vehicle.bullet.damage += item.stats.attack;
      if (item.stats.defense) vehicle.health += item.stats.defense;
      if (item.stats.health) vehicle.health += item.stats.health;
      if (item.stats.noPushback) vehicle.bullet.noPushback = true;
      if (item.stats.blastRadius) {
        vehicle.bullet.explosionRadius = Math.max(
          5,
          vehicle.bullet.explosionRadius + item.stats.blastRadius,
        );
        vehicle.bullet.craterRadius = Math.max(
          5,
          vehicle.bullet.craterRadius + Math.round(item.stats.blastRadius * 0.8),
        );
      }
      if (item.stats.fuel) vehicle.fuel = Math.max(10, vehicle.fuel + item.stats.fuel);
      if (item.stats.climbAngle)
        vehicle.climbAngle = Math.max(10, vehicle.climbAngle + item.stats.climbAngle);
      if (item.stats.minAimAngle)
        vehicle.minAimAngle = Math.max(0, vehicle.minAimAngle + item.stats.minAimAngle);
      if (item.stats.maxAimAngle)
        vehicle.maxAimAngle = Math.min(90, vehicle.maxAimAngle + item.stats.maxAimAngle);
    }
    vehicle.minAimAngle = Math.min(vehicle.minAimAngle, vehicle.maxAimAngle - 5);
  }

  private initPlayer() {
    const vehicle: Vehicle = {
      ...CONST.PLAYER_VEHICLE,
      bullet: { ...CONST.PLAYER_VEHICLE.bullet },
    };
    this.applyEquipmentToVehicle(vehicle);
    this.player.vehicle = vehicle;
    this.player.x = Math.random() * (CONST.TERRAIN_WIDTH - 200) + 100;
    this.player.y =
      CONST.CANVAS_HEIGHT -
      CONST.TERRAIN_BASE_Y_OFFSET -
      CONST.PLAYER_HOVER_HEIGHT -
      CONST.SPAWN_HEIGHT_OFFSET;
    this.player.maxPower = this.player.vehicle.power;
    this.player.health = this.player.vehicle.health;
    this.player.movementFuel = this.player.vehicle.fuel;

    this.createEntity(this.player, this.player.x, this.player.y);
  }

  private spawnEnemies() {
    this.enemies = [];
    const numEnemies = 3; // Spawn 3 enemies for now
    for (let i = 0; i < numEnemies; i++) {
      let x: number;
      let attempts = 0;
      do {
        x = Math.random() * (CONST.TERRAIN_WIDTH - 200) + 100;
        attempts++;
        if (attempts > 100) break; // Prevent infinite loop
      } while ([this.player, ...this.enemies].some((entity) => Math.abs(entity.x - x) < 200));
      const terrainHeight = this.getTerrainHeightAt(x);
      const y =
        terrainHeight !== -1
          ? terrainHeight - CONST.TANK_HALF_HEIGHT - CONST.SPAWN_HEIGHT_OFFSET
          : CONST.CANVAS_HEIGHT -
            CONST.TERRAIN_BASE_Y_OFFSET -
            CONST.PLAYER_HOVER_HEIGHT -
            CONST.SPAWN_HEIGHT_OFFSET;

      const enemy: Enemy = {
        body: null,
        x: x,
        y: y,
        angle: (CONST.ENEMY_VEHICLE.minAimAngle + CONST.ENEMY_VEHICLE.maxAimAngle) / 2,
        health: CONST.ENEMY_VEHICLE.health,
        color: '#FF6B6B',
        active: true,
        facing: Math.random() > 0.5 ? 1 : -1,
        terrainAngle: 0, // Will be set in createEntity
        vehicle: CONST.ENEMY_VEHICLE,
        turnState: 'turn_start',
        turnTimer: 0,
        targetPower: 0,
        power: 0,
        delay: 0,
        stuckCounter: 0,
        assessCounter: 0,
        lastX: x,
        lastY: y,
        movementFuel: CONST.ENEMY_VEHICLE.fuel,
      };
      this.createEntity(enemy, x, y);
      this.enemies.push(enemy);
    }
  }

  startTurn() {
    if (this._turnQueue.length > 0) {
      const waited = this._turnQueue[0].entity.delay;
      this._turnQueue.forEach((te) => (te.entity.delay -= waited));
    }
    this._turnStartTime = Date.now();
  }

  areAllEntitiesSettled(): boolean {
    const entities = [this.player, ...this.enemies];
    return entities.every((e) => e.body && Math.abs(e.body.velocity.y) <= 0.5);
  }

  private initTurnQueue() {
    this._turnQueue = [];

    // Add player to queue
    const playerRandomOffset = (Math.random() - 0.5) * 2 * 0.05 * this.player.vehicle.speed;
    this.player.delay = Math.round(100 - this.player.vehicle.speed + playerRandomOffset);
    this._turnQueue.push({
      id: 'player',
      type: 'player',
      entity: this.player,
      baseDelay: 100 - this.player.vehicle.speed,
      delay: this.player.delay,
    });

    // Add enemies to queue
    this.enemies.forEach((enemy, index) => {
      const enemyRandomOffset = (Math.random() - 0.5) * 2 * 0.05 * enemy.vehicle.speed;
      enemy.delay = Math.round(100 - enemy.vehicle.speed + enemyRandomOffset);
      this._turnQueue.push({
        id: `enemy_${index}`,
        type: 'enemy',
        entity: enemy,
        baseDelay: 100 - enemy.vehicle.speed,
        delay: enemy.delay,
      });
    });

    // Sort queue by entity.delay (lowest first)
    this._turnQueue.sort((a, b) => a.entity.delay - b.entity.delay);
    this.currentTurnIndex = 0;
    this.turnTime = 0;
  }

  private updateEnemies() {
    for (const enemy of this.enemies) {
      if (enemy.body && enemy.active) {
        this.updateEntityPhysics(enemy);
        // Kill enemies that have fallen off the map before AI or terrain-snap runs
        if (enemy.y > CONST.CANVAS_HEIGHT + CONST.FALL_THRESHOLD_OFFSET) {
          enemy.health = 0;
          enemy.active = false;
          this.World.remove(this.world, enemy.body);
        }
      }
    }

    // Handle enemy AI turns
    this.handleEnemyTurns();

    this.checkEnemiesTerrainCollision();
  }

  private handleEnemyTurns() {
    if (this.currentState !== GameState.PLAYING) return;

    const currentTurn = this.getCurrentTurnEntity();
    if (!currentTurn || currentTurn.type !== 'enemy') return;

    const enemy = currentTurn.entity as Enemy;
    if (!enemy.active) return;

    // Check for timeout
    if (this.turnTime > this.TIMEOUT_MS) {
      this.endTurn();
      return;
    }

    // Simple enemy AI: aim at player and shoot
    this.performEnemyAction(enemy);
  }

  private handlePlayerTurns() {
    if (this.currentState !== GameState.PLAYING) return;

    const currentTurn = this.getCurrentTurnEntity();
    if (!currentTurn || currentTurn.type !== 'player') return;

    const player = currentTurn.entity as Player;
    if (!player.active) return;

    // Handle player turn states
    this.performPlayerAction(player);
  }

  private moveEntity(entity: Player | Enemy, direction: number): boolean {
    if (entity.movementFuel! <= 0) return false;

    const moveSpeed = CONST.PLAYER_MOVE_SPEED;
    const vx = direction * moveSpeed;
    const targetX = entity.x + vx;
    const hasTerrain = this.getTerrainHeightAt(targetX) !== -1;
    const angle = this.getTerrainAngleAt(targetX);
    const canMove =
      !hasTerrain || (vx < 0 ? angle <= CONST.MAX_CLIMB_ANGLE : angle >= -CONST.MAX_CLIMB_ANGLE);
    if (canMove) {
      this.Body.setVelocity(entity.body, { x: vx, y: entity.body.velocity.y });
      entity.movementFuel! -= 0.5; // Deplete fuel at same rate
      entity.facing = direction;
      return true;
    } else {
      this.Body.setVelocity(entity.body, { x: 0, y: entity.body.velocity.y });
      return false;
    }
  }

  private prepareAggressiveTerrainClearingShot(enemy: Enemy) {
    enemy.moveDirection = 0;
    enemy.movementTimer = 0;
    enemy.targetAngle = undefined;
    enemy.targetPower = undefined;
    enemy.forceTerrainClearingShot = true;
    enemy.turnState = 'aiming';
    enemy.turnTimer = 0;
    enemy.stuckCounter = 0;
  }

  private performCharging(entity: Player | Enemy) {
    const chargeTime =
      Date.now() -
      (entity === this.player ? this.chargeStartTime : (entity as Enemy).chargeStartTime!);
    const chargeRatio = Math.min(chargeTime / CONST.MAX_CHARGE_TIME, 1);
    if (entity === this.player) {
      entity.power = CONST.MIN_POWER + (entity.maxPower - CONST.MIN_POWER) * chargeRatio;
    } else {
      entity.power = chargeRatio * ((entity as Enemy).targetPower || 0);
    }
    if (chargeTime >= CONST.MAX_CHARGE_TIME) {
      if (entity === this.player) {
        this.shoot();
      } else {
        this.enemyShoot(entity as Enemy, entity.power);
      }
      entity.turnState = 'bullet_in_flight';
    }
  }

  private updateEntityPhysics(entity: Player | Enemy) {
    if (entity.body) {
      entity.x = entity.body.position.x;
      entity.y = entity.body.position.y;
      // Clamp horizontal position to terrain bounds
      entity.x = Math.max(0, Math.min(CONST.TERRAIN_WIDTH, entity.x));
      this.Body.setPosition(entity.body, { x: entity.x, y: entity.y });
      // Update terrain angle
      entity.terrainAngle = this.getTerrainAngleAt(entity.x);
      // Smoothly interpolate angle toward target
      if (entity.targetAngle !== undefined) {
        const diff = entity.targetAngle - entity.angle;
        entity.angle += diff * 0.1; // 10% interpolation per frame
      }
    }
  }

  private performPlayerAction(player: Player) {
    // Check for skip
    if (
      this.keys['S'] &&
      player.turnState !== 'bullet_in_flight' &&
      player.turnState !== 'post_bullet'
    ) {
      this.endTurn();
      return;
    }

    switch (player.turnState) {
      case 'turn_start':
        // Check for win condition
        if (
          this.enemies.every((e) => !e.active) &&
          this.currentState !== GameState.WIN_DELAY &&
          this.currentState !== GameState.WIN
        ) {
          this.currentState = GameState.WIN_DELAY;
          this.winTimer = 1.5;
          this.keys = {};
          this.isCharging = false;
          break;
        }
        // Reset fuel at turn start
        player.movementFuel = player.vehicle.fuel;
        player.turnState = 'idle';
        break;

      case 'idle':
        // Player is ready for input - no action needed here
        break;

      case 'aiming':
        // Player is aiming - handled in input
        break;

      case 'charging':
        this.performCharging(player);
        break;

      case 'bullet_in_flight':
        if (!this.projectile && player.turnState === 'bullet_in_flight') {
          player.turnState = 'post_bullet';
          player.turnTimer = 1.0;
        }
        break;

      case 'post_bullet':
        // Timer handled in updateTurnQueue
        break;
    }
  }

  private performEnemyAction(enemy: Enemy) {
    switch (enemy.turnState) {
      case 'turn_start':
        // Reset fuel at turn start
        enemy.movementFuel = enemy.vehicle.fuel;
        enemy.angle = enemy.angle || (enemy.vehicle.minAimAngle + enemy.vehicle.maxAimAngle) / 2;
        enemy.forceTerrainClearingShot = false;
        enemy.targetAngle = undefined;
        enemy.targetPower = undefined;
        enemy.reassessCount = 0;
        enemy.turnState = 'assess';
        enemy.assessCounter = CONST.ENEMY_ASSESS_DELAY;
        enemy.stuckCounter = 0;
        break;

      case 'assess':
        enemy.assessCounter -= 16;
        if (enemy.assessCounter > 0) {
          return;
        }
        // Assess situation and decide action
        const dx = this.player.x - enemy.x;
        const dy = this.player.y - enemy.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Set behavior
        if (!enemy.behavior) {
          if (enemy.health < 50) {
            enemy.behavior = 'defensive';
          } else {
            const rand = Math.random();
            enemy.behavior = rand < 0.4 ? 'aggressive' : rand < 0.7 ? 'defensive' : 'flanking';
          }
        }

        // Decide based on distance, fuel, and behavior
        let moveCloserThreshold = 400;
        let moveAwayThreshold = 150;
        if (enemy.behavior === 'aggressive') {
          moveCloserThreshold = 300;
          moveAwayThreshold = 100;
        } else if (enemy.behavior === 'defensive') {
          moveCloserThreshold = 500;
          moveAwayThreshold = 200;
        }

        enemy.reassessCount = (enemy.reassessCount ?? 0) + 1;
        const forceShot = enemy.reassessCount >= 3;

        if (!forceShot && distance > moveCloserThreshold && enemy.movementFuel! > 10) {
          // Too far, move closer or flank
          if (enemy.behavior === 'flanking') {
            enemy.moveDirection =
              Math.abs(dx) > distance * 0.5 ? (dy > 0 ? -1 : 1) : dx > 0 ? 1 : -1; // Perpendicular
          } else {
            enemy.moveDirection = dx > 0 ? 1 : -1; // Toward player
          }
          enemy.movementTimer = 1000 + Math.random() * 1000; // 1-2 seconds
          enemy.turnState = 'moving';
        } else if (!forceShot && distance < moveAwayThreshold && enemy.movementFuel! > 5) {
          // Too close, move away
          enemy.moveDirection = dx > 0 ? -1 : 1; // Away from player
          enemy.movementTimer = 800 + Math.random() * 600; // 0.8-1.4 seconds
          enemy.turnState = 'moving';
        } else {
          // Good distance (or forced after too many reassessments), aim and shoot
          enemy.facing = dx > 0 ? 1 : -1; // Face toward player
          enemy.targetAngle = undefined;
          enemy.targetPower = undefined;
          enemy.turnState = 'aiming';
          enemy.turnTimer = 0;
        }
        break;

      case 'moving':
        if (enemy.lastX === undefined) {
          enemy.lastX = enemy.x;
          enemy.lastY = enemy.y;
        }
        if (enemy.movementTimer! > 0) {
          const movedThisFrame = this.moveEntity(enemy, enemy.moveDirection!);
          if (!movedThisFrame && enemy.behavior === 'aggressive') {
            this.prepareAggressiveTerrainClearingShot(enemy);
            return;
          }
          enemy.movementTimer! -= 16;
        } else {
          // Stop moving and assess again or aim
          this.Body.setVelocity(enemy.body, { x: 0, y: enemy.body.velocity.y });
          enemy.moveDirection = 0;
          enemy.movementTimer = 0;
          // After moving, reassess or go to aiming
          const newDx = this.player.x - enemy.x;
          const newDistance = Math.abs(newDx);
          const maxReassess = (enemy.reassessCount ?? 0) >= 3;
          if (!maxReassess && (newDistance > 500 || newDistance < 100)) {
            enemy.turnState = 'assess'; // Reassess if still not ideal
          } else {
            enemy.facing = newDx > 0 ? 1 : -1;
            enemy.targetAngle = undefined;
            enemy.targetPower = undefined;
            enemy.turnState = 'aiming';
            enemy.turnTimer = 0;
          }
        }

        // Check for stuck
        const moved = Math.hypot(enemy.x - enemy.lastX!, enemy.y - enemy.lastY!);
        if (moved < 1) {
          enemy.stuckCounter += 16;
        } else {
          enemy.stuckCounter = 0;
        }
        if (enemy.stuckCounter > CONST.ENEMY_STUCK_THRESHOLD) {
          if (enemy.behavior === 'aggressive') {
            this.prepareAggressiveTerrainClearingShot(enemy);
            return;
          }
          enemy.turnState = 'aiming';
          enemy.targetAngle = undefined;
          enemy.targetPower = undefined;
          enemy.turnTimer = 0;
          enemy.stuckCounter = 0;
        }
        enemy.lastX = enemy.x;
        enemy.lastY = enemy.y;
        break;

      case 'aiming':
        if (enemy.targetAngle === undefined) {
          // Calculate precise angle to player
          const dx = this.player.x - enemy.x;
          const dy = this.player.y - enemy.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (enemy.forceTerrainClearingShot) {
            let directAngleDeg = (Math.atan2(-dy, dx) * 180) / Math.PI;
            directAngleDeg -= (enemy.terrainAngle * 180) / Math.PI;
            directAngleDeg = ((directAngleDeg % 360) + 360) % 360;

            enemy.facing = dx > 0 ? 1 : -1;

            let relativeAngleDeg = enemy.facing === 1 ? directAngleDeg : 180 - directAngleDeg;
            relativeAngleDeg = Math.max(
              enemy.vehicle.minAimAngle,
              Math.min(enemy.vehicle.maxAimAngle, relativeAngleDeg),
            );

            const maxFallbackPower = Math.max(20, enemy.vehicle.power);
            enemy.targetAngle = relativeAngleDeg;
            if (distance < 200) {
              enemy.targetPower = maxFallbackPower * (0.3 + Math.random() * 0.25);
            } else if (distance < 400) {
              enemy.targetPower = maxFallbackPower * (0.55 + Math.random() * 0.25);
            } else {
              enemy.targetPower = maxFallbackPower * (0.8 + Math.random() * 0.2);
            }

            enemy.forceTerrainClearingShot = false;
            enemy.angle =
              enemy.angle || (enemy.vehicle.minAimAngle + enemy.vehicle.maxAimAngle) / 2;
            enemy.chargeStartTime = Date.now();
            enemy.turnState = 'charging';
            return;
          }

          if (distance <= 50) {
            // Too close: fire a tactical shot instead of skipping turn.
            // Option A: low-power nearby dig shot to create cover.
            // Option B: high-angle shot to improve spacing/angle next turn.
            const maxPower = Math.max(20, enemy.vehicle.power);
            const useDigShot = Math.random() < 0.65;
            if (useDigShot) {
              enemy.facing = dx > 0 ? -1 : 1; // Aim away from player for nearby cover crater.
              enemy.targetAngle = Math.min(
                enemy.vehicle.maxAimAngle,
                enemy.vehicle.minAimAngle +
                  (enemy.vehicle.maxAimAngle - enemy.vehicle.minAimAngle) * 0.8,
              );
              enemy.targetPower = maxPower * (0.1 + Math.random() * 0.1);
            } else {
              enemy.facing = dx > 0 ? 1 : -1; // Keep line to player and lob a high arc.
              enemy.targetAngle = enemy.vehicle.maxAimAngle;
              enemy.targetPower = maxPower * (0.45 + Math.random() * 0.4);
            }

            enemy.angle =
              enemy.angle || (enemy.vehicle.minAimAngle + enemy.vehicle.maxAimAngle) / 2;
            enemy.chargeStartTime = Date.now();
            enemy.turnState = 'charging';
            return;
          }

          const angleRad = Math.atan2(-dy, dx);
          let angleDeg = (angleRad * 180) / Math.PI;

          // Adjust for terrain angle
          angleDeg -= (enemy.terrainAngle * 180) / Math.PI;

          // Normalize to 0-360
          angleDeg = ((angleDeg % 360) + 360) % 360;

          // Determine facing
          if (angleDeg <= 90) {
            enemy.facing = 1;
          } else if (angleDeg <= 180) {
            enemy.facing = -1;
          } else {
            enemy.facing = angleDeg <= 270 ? -1 : 1;
          }

          // Trajectory-based aiming
          let bestHit: { angle: number; power: number; dist: number } | null = null;
          const angleStep = 10; // degrees
          const maxPower = Math.max(20, enemy.vehicle.power);
          const powerStep = Math.max(10, Math.round(maxPower / 10)); // 10 bands up to max power.
          for (
            let relAng = enemy.vehicle.minAimAngle;
            relAng <= enemy.vehicle.maxAimAngle;
            relAng += angleStep
          ) {
            const baseAngleRad = (relAng * Math.PI) / 180;
            const simAngleRad =
              -enemy.terrainAngle + (enemy.facing === -1 ? Math.PI - baseAngleRad : baseAngleRad);
            const barrelEndX = enemy.x + Math.cos(simAngleRad) * CONST.BARREL_LENGTH;
            const barrelEndY = enemy.y - Math.sin(simAngleRad) * CONST.BARREL_LENGTH;
            for (let pow = 20; pow <= maxPower; pow += powerStep) {
              const { positions } = this.simulateTrajectory(
                barrelEndX,
                barrelEndY,
                simAngleRad,
                pow,
                enemy.vehicle.bullet,
              );
              for (const pos of positions) {
                const distToPlayer = Math.hypot(pos.x - this.player.x, pos.y - this.player.y);
                if (distToPlayer < 50 && (!bestHit || distToPlayer < bestHit.dist)) {
                  bestHit = { angle: relAng, power: pow, dist: distToPlayer };
                }
              }
            }
          }

          const scatter =
            CONST.DIFFICULTY_SCATTER[this.difficulty] ?? CONST.DIFFICULTY_SCATTER['normal'];
          const angleScatter = (Math.random() * 2 - 1) * scatter.angleDeg;
          const powerScatter = (Math.random() * 2 - 1) * scatter.powerFrac;

          if (bestHit) {
            const maxPower = Math.max(20, enemy.vehicle.power);
            enemy.targetAngle = Math.max(
              enemy.vehicle.minAimAngle,
              Math.min(enemy.vehicle.maxAimAngle, bestHit.angle + angleScatter),
            );
            enemy.targetPower = Math.max(
              10,
              Math.min(maxPower, bestHit.power + powerScatter * maxPower),
            );
          } else {
            // Fallback to old logic
            let relativeAngleDeg: number;
            if (enemy.facing === 1) {
              relativeAngleDeg = angleDeg;
            } else {
              relativeAngleDeg = 180 - angleDeg;
            }
            relativeAngleDeg = Math.max(
              enemy.vehicle.minAimAngle,
              Math.min(enemy.vehicle.maxAimAngle, relativeAngleDeg + angleScatter),
            );
            enemy.targetAngle = relativeAngleDeg;
            const maxFallbackPower = Math.max(20, enemy.vehicle.power);
            if (distance < 200) {
              enemy.targetPower = maxFallbackPower * (0.3 + Math.random() * 0.25);
            } else if (distance < 400) {
              enemy.targetPower = maxFallbackPower * (0.55 + Math.random() * 0.25);
            } else {
              enemy.targetPower = maxFallbackPower * (0.8 + Math.random() * 0.2);
            }
            enemy.targetPower = Math.max(
              10,
              Math.min(maxFallbackPower, enemy.targetPower + powerScatter * maxFallbackPower),
            );
          }

          enemy.angle = enemy.angle || (enemy.vehicle.minAimAngle + enemy.vehicle.maxAimAngle) / 2;
          enemy.chargeStartTime = Date.now();
          enemy.turnState = 'charging';
        }
        break;

      case 'charging':
        this.performCharging(enemy);
        break;

      case 'bullet_in_flight':
        if (!this.projectile) {
          enemy.turnState = 'post_bullet';
          enemy.turnTimer = 1.0;
        }
        break;

      case 'post_bullet':
        // Timer handled in updateTurnQueue
        break;
    }
  }

  private enemyShoot(enemy: Enemy, power: number) {
    const baseAngleRad = (enemy.angle * Math.PI) / 180;
    const angleRad =
      -enemy.terrainAngle + (enemy.facing === -1 ? Math.PI - baseAngleRad : baseAngleRad);
    const bullet = enemy.vehicle.bullet;
    const barrelLength = CONST.BARREL_LENGTH;
    const barrelEndX = enemy.x + Math.cos(angleRad) * barrelLength;
    const barrelEndY = enemy.y - Math.sin(angleRad) * barrelLength;

    const { positions } = this.simulateTrajectory(barrelEndX, barrelEndY, angleRad, power, bullet);

    this.projectile = {
      x: barrelEndX,
      y: barrelEndY,
      trajectory: positions,
      trajectoryIndex: 0,
      owner: enemy,
      bullet: bullet,
    };
  }

  getCurrentTurnEntity(): TurnEntity | null {
    if (this._turnQueue.length === 0) return null;
    return this._turnQueue[0];
  }

  isPlayerTurn(): boolean {
    const current = this.getCurrentTurnEntity();
    return current?.type === 'player';
  }

  endTurn(actionCost: number = 100) {
    if (this._turnQueue.length === 0) return;

    // Normalize delays first
    this.startTurn();

    // Then add actionCost to the current entity's delay
    this._turnQueue[0].entity.delay += actionCost;

    // Resort queue by entity.delay
    this._turnQueue.sort((a, b) => a.entity.delay - b.entity.delay);

    // Reset turn time
    this.turnTime = 0;

    // Reset player-specific flags
    if (this.isPlayerTurn()) {
      this.isCharging = false;
      this.chargeStartTime = 0;
    }

    // Set next entity's turn state to turn_start
    const nextEntity = this.getCurrentTurnEntity();
    if (nextEntity) {
      const nextEntityObj = nextEntity.entity as any;
      nextEntityObj.turnState = 'turn_start';
      nextEntityObj.turnTimer = 0;
    }

    // Clean up projectiles owned by previous entity
    const prevEntity = this._turnQueue[this._turnQueue.length - 1]; // Since resorted, last is previous
    if (prevEntity) {
      if (this.projectile && this.projectile.owner === prevEntity.entity) {
        this.destroyTrajectoryProjectile();
      }
      this.explodedProjectiles = this.explodedProjectiles.filter(
        (ep) => ep.owner !== prevEntity.entity,
      );
    }

    this.panToEntity = nextEntity;
  }

  updateTurnQueue(deltaTime: number = 0) {
    // Remove inactive enemies from queue
    this._turnQueue = this._turnQueue.filter((turnEntity) => {
      if (turnEntity.type === 'enemy') {
        return (turnEntity.entity as Enemy).active;
      }
      return true;
    });

    // If current turn entity was removed, reset to first
    if (this.currentTurnIndex >= this._turnQueue.length) {
      this.currentTurnIndex = 0;
    }

    if (this._turnQueue.length > 0) {
      const currentEntity = this._turnQueue[0].entity as any;
      if (currentEntity.turnState === 'post_bullet') {
        currentEntity.turnTimer -= deltaTime;
        if (currentEntity.turnTimer <= 0) {
          this.endTurn(100);
        }
      }
    }
  }

  private calculateExplosionDamage(explosionX: number, explosionY: number, projectile: any) {
    const maxDamage = projectile.bullet.damage;
    const damageRadius = projectile.bullet.explosionRadius ?? 50;
    let radiusX = damageRadius;
    let radiusY = damageRadius;
    if (projectile.bullet.explosionShape === 'horizontal_oval') {
      radiusX = damageRadius * 1.5;
    } else if (projectile.bullet.explosionShape === 'vertical_oval') {
      radiusY = damageRadius * 1.5;
    }
    // For 'circle', keep as is

    // Damage player
    if (this.player.active) {
      const dx = this.player.x - explosionX;
      const dy = this.player.y - explosionY;
      const normalizedDist = Math.sqrt((dx / radiusX) ** 2 + (dy / radiusY) ** 2);
      if (normalizedDist <= 1) {
        const damage = Math.round(maxDamage * (1 - normalizedDist));
        const actualDamage = projectile.owner === this.player ? damage * 0.5 : damage;
        this.player.health -= actualDamage;
        this.player.health = Math.max(0, Math.min(this.player.health, this.player.vehicle.health));
        this.damageTexts.push({
          x: this.player.x,
          y: this.player.y - 30,
          damage: actualDamage,
          life: CONST.DAMAGE_TEXT_LIFETIME,
        });
        this.applyExplosionKnockback(
          this.player,
          explosionX,
          explosionY,
          projectile,
          radiusX,
          radiusY,
        );
      }
    }

    // Damage enemies
    for (const enemy of this.enemies) {
      if (enemy.active) {
        const dx = enemy.x - explosionX;
        const dy = enemy.y - explosionY;
        const normalizedDist = Math.sqrt((dx / radiusX) ** 2 + (dy / radiusY) ** 2);
        if (normalizedDist <= 1) {
          const damage = Math.round(maxDamage * (1 - normalizedDist));
          enemy.health -= damage;
          enemy.health = Math.max(0, Math.min(enemy.health, enemy.vehicle.health));
          this.damageTexts.push({
            x: enemy.x,
            y: enemy.y - 30,
            damage: damage,
            life: CONST.DAMAGE_TEXT_LIFETIME,
          });
          this.applyExplosionKnockback(enemy, explosionX, explosionY, projectile, radiusX, radiusY);
          if (enemy.health <= 0) {
            enemy.active = false;
            if (enemy.body) {
              this.World.remove(this.world, enemy.body);
            }
          }
        }
      }
    }
  }

  update() {
    const now = Date.now();
    const deltaTime = (now - this.lastUpdateTime) / 1000;
    this.lastUpdateTime = now;

    // Check for game over early
    if (
      this.player.health <= 0 &&
      this.currentState !== GameState.GAME_OVER_DELAY &&
      this.currentState !== GameState.GAME_OVER
    ) {
      this.currentState = GameState.GAME_OVER_DELAY;
      this.gameOverTimer = 2.0;
      this.keys = {};
      this.isCharging = false;
    }

    if (this.currentState === GameState.GAME_OVER_DELAY) {
      this.gameOverTimer -= deltaTime;
      if (this.gameOverTimer <= 0) {
        this.currentState = GameState.GAME_OVER;
      }
    }

    if (this.currentState === GameState.WIN_DELAY) {
      this.winTimer -= deltaTime;
      if (this.winTimer <= 0) {
        this.currentState = GameState.WIN;
      }
    }

    // Freeze on game over, win, or pause
    if (
      this.currentState === GameState.GAME_OVER ||
      this.currentState === GameState.WIN ||
      this.currentState === GameState.PAUSED
    ) {
      return;
    }

    this.handleInput(this.keys);

    this.turnTime = now - this._turnStartTime;

    // Update player physics
    this.updateEntityPhysics(this.player);

    // Update enemies
    this.updateEnemies();

    // Handle player turns
    this.handlePlayerTurns();

    // Update projectile if exists
    if (this.projectile) {
      this.updateTrajectoryProjectile();
    }

    // Check player collision with terrain
    this.checkPlayerTerrainCollision();

    // Check if entities fell off the screen
    this.checkEntitiesFall();

    // Update explosions
    this.updateExplosions();

    // Update damage texts
    this.updateDamageTexts();

    // Remove expired exploded projectiles
    this.explodedProjectiles = this.explodedProjectiles.filter((ep) => Date.now() < ep.removalTime);

    // Update turn queue (remove inactive enemies)
    this.updateTurnQueue(deltaTime);

    // Check for turn timeout
    if (
      this.currentState === GameState.PLAYING &&
      this.currentTurnIndex < this._turnQueue.length &&
      Date.now() - this._turnStartTime > this.TIMEOUT_MS
    ) {
      this.endTurn(150);
    }
  }

  handleInput(keys: { [key: string]: boolean }) {
    if (this.currentState === GameState.PLAYING) {
      const isOnTerrain = this.getTerrainHeightAt(this.player.x) !== -1;
      const oldFacing = this.player.facing;

      // Handle facing changes (allowed anytime)
      if (keys['ArrowLeft'] && this.player.facing !== -1) {
        this.player.facing = -1;
      }
      if (keys['ArrowRight'] && this.player.facing !== 1) {
        this.player.facing = 1;
      }

      if (isOnTerrain) {
        if (
          keys['ArrowLeft'] &&
          this.player.body &&
          !this.isCharging &&
          !this.projectile &&
          this.player.turnState === 'idle'
        ) {
          const targetX = this.player.x - 2.0;
          const hasTerrain = this.getTerrainHeightAt(targetX) !== -1;
          const angle = this.getTerrainAngleAt(targetX);
          const isTurningAround = oldFacing !== this.player.facing;
          if (
            this.player.movementFuel > 0 &&
            (!hasTerrain || angle <= CONST.MAX_CLIMB_ANGLE || isTurningAround) &&
            this.isPlayerTurn()
          ) {
            this.moveEntity(this.player, -1);
          } else {
          }
        }
        if (
          keys['ArrowRight'] &&
          this.player.body &&
          !this.isCharging &&
          !this.projectile &&
          this.player.turnState === 'idle'
        ) {
          const targetX = this.player.x + 2.0;
          const hasTerrain = this.getTerrainHeightAt(targetX) !== -1;
          const isTurningAround = oldFacing !== this.player.facing;
          if (
            this.player.movementFuel > 0 &&
            (!hasTerrain ||
              this.getTerrainAngleAt(targetX) >= -CONST.MAX_CLIMB_ANGLE ||
              isTurningAround) &&
            this.isPlayerTurn()
          ) {
            this.moveEntity(this.player, 1);
          } else {
          }
        }

        if (keys['ArrowUp'] && !this.isCharging && !this.projectile) {
          this.player.targetAngle = Math.min(
            CONST.MAX_AIM_ANGLE,
            (this.player.targetAngle ?? this.player.angle) + CONST.ANGLE_ADJUST_SPEED / 400,
          );
        }
        if (keys['ArrowDown'] && !this.isCharging && !this.projectile) {
          this.player.targetAngle = Math.max(
            CONST.MIN_AIM_ANGLE,
            (this.player.targetAngle ?? this.player.angle) - CONST.ANGLE_ADJUST_SPEED / 400,
          );
        }

        if (
          keys[' '] &&
          !this.projectile &&
          !this.isCharging &&
          this.isPlayerTurn() &&
          this.player.turnState === 'idle'
        ) {
          this.isCharging = true;
          this.chargeStartTime = Date.now();
          this.player.power = CONST.MIN_POWER;
          this.player.turnState = 'charging';
        }
      }
    }
  }

  getBarrelAngle(): number {
    const baseAngleRad = (this.player.angle * Math.PI) / 180;
    const trueAngleRad =
      -this.player.terrainAngle +
      (this.player.facing === -1 ? Math.PI - baseAngleRad : baseAngleRad);
    return trueAngleRad;
  }

  public shoot() {
    const angleRad = this.getBarrelAngle();
    const bullet = this.player.vehicle.bullet;
    const barrelLength = CONST.BARREL_LENGTH;
    const barrelEndX = this.player.x + Math.cos(angleRad) * barrelLength;
    const barrelEndY = this.player.y - Math.sin(angleRad) * barrelLength;

    const { positions } = this.simulateTrajectory(
      barrelEndX,
      barrelEndY,
      angleRad,
      this.player.power,
      bullet,
    );

    this.projectile = {
      x: barrelEndX,
      y: barrelEndY,
      trajectory: positions,
      trajectoryIndex: 0,
      owner: this.player,
      bullet: bullet,
    };

    this.isCharging = false;
    this.player.turnState = 'bullet_in_flight';
  }

  private updateTrajectoryProjectile() {
    if (
      !this.projectile ||
      !this.projectile.trajectory ||
      this.projectile.trajectoryIndex === undefined
    )
      return;

    const index = this.projectile.trajectoryIndex;
    const positions = this.projectile.trajectory;

    if (index >= positions.length) {
      this.projectile = null;
      return;
    }

    // Set position to current trajectory point
    this.projectile.x = positions[index].x;
    this.projectile.y = positions[index].y;

    // Check if projectile went off game area
    if (
      this.projectile.x < -CONST.OFFSCREEN_EXPLODE_MARGIN_X ||
      this.projectile.x > CONST.TERRAIN_WIDTH + CONST.OFFSCREEN_EXPLODE_MARGIN_X ||
      this.projectile.y > CONST.TERRAIN_HEIGHT + CONST.OFFSCREEN_EXPLODE_MARGIN_Y_BOTTOM ||
      this.projectile.y < -CONST.OFFSCREEN_EXPLODE_MARGIN_Y_TOP
    ) {
      this.destroyTrajectoryProjectile();
      return;
    }

    // Check terrain collision
    const px = Math.floor(this.projectile.x);
    const py = Math.floor(this.projectile.y);
    const terrainY = CONST.CANVAS_HEIGHT - CONST.TERRAIN_BASE_Y_OFFSET;
    const terrainLocalY = py - terrainY;

    if (
      px >= 0 &&
      px < CONST.TERRAIN_WIDTH &&
      terrainLocalY >= 0 &&
      terrainLocalY < this.terrain[px]?.length &&
      this.terrain[px][terrainLocalY] === 1
    ) {
      this.destroyTrajectoryProjectile();
      return;
    }

    // Check offsets for collision
    const checkOffsets = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];
    let collided = false;
    for (const [offsetX, offsetY] of checkOffsets) {
      const checkX = px + offsetX;
      const checkY = py + offsetY;
      const terrainCheckY = checkY - terrainY;

      if (
        checkX >= 0 &&
        checkX < CONST.TERRAIN_WIDTH &&
        terrainCheckY >= 0 &&
        terrainCheckY < this.terrain[checkX]?.length &&
        this.terrain[checkX][terrainCheckY] === 1
      ) {
        collided = true;
        break;
      }
    }
    if (collided) {
      this.destroyTrajectoryProjectile();
      return;
    }

    // Check collision with entities
    if (this.checkEntityCollisions(this.projectile)) {
      this.destroyTrajectoryProjectile();
      return;
    }

    // Advance to next position
    this.projectile.trajectoryIndex++;
  }

  private destroyTrajectoryProjectile() {
    if (!this.projectile) return;

    this.explosions.push({
      x: this.projectile.x,
      y: this.projectile.y,
      radius: CONST.EXPLOSION_INITIAL_RADIUS,
      maxRadius: CONST.EXPLOSION_MAX_RADIUS,
      life: CONST.EXPLOSION_LIFETIME_FRAMES,
      shape: this.projectile.bullet.explosionShape,
    });

    // Apply damage
    this.calculateExplosionDamage(this.projectile.x, this.projectile.y, this.projectile);

    // Create crater
    this.createCrater(
      this.projectile.x,
      this.projectile.y,
      this.projectile.bullet.craterRadius,
      this.projectile.bullet,
    );

    this.explodedProjectiles.push({
      position: { x: this.projectile.x, y: this.projectile.y },
      bullet: this.projectile.bullet,
      removalTime: Date.now() + 2000,
      owner: this.projectile.owner,
    });

    this.projectile = null;
  }

  private checkEntityCollisions(projectile: Projectile): boolean {
    // Check collision with player
    if (this.player.active) {
      const dx = this.player.x - projectile.x;
      const dy = this.player.y - projectile.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < CONST.PROJECTILE_RADIUS + 15) {
        return true;
      }
    }

    // Check collision with enemies
    for (const enemy of this.enemies) {
      if (enemy.active) {
        const dx = enemy.x - projectile.x;
        const dy = enemy.y - projectile.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < CONST.PROJECTILE_RADIUS + 15) {
          return true;
        }
      }
    }

    return false;
  }

  private applyExplosionKnockback(
    target: Player | Enemy,
    explosionX: number,
    explosionY: number,
    projectile: any,
    radiusX: number,
    radiusY: number,
  ) {
    if (!target.body) return;
    if (projectile.bullet.noPushback) return;
    const dx = target.x - explosionX;
    const dy = target.y - explosionY;
    const normalizedDist = Math.sqrt((dx / radiusX) ** 2 + (dy / radiusY) ** 2);
    if (normalizedDist > 1) return;
    const maxPushDistance = (projectile.bullet.explosionRadius || Math.max(radiusX, radiusY)) * 0.3;
    const pushDistance = maxPushDistance * (1 - normalizedDist);
    if (pushDistance <= 0) return;
    const distance = Math.hypot(dx, dy);
    const dirX = distance > 0.001 ? dx / distance : 0;
    const dirY = distance > 0.001 ? dy / distance : -1;
    const targetX = Math.max(0, Math.min(CONST.TERRAIN_WIDTH, target.x + dirX * pushDistance));
    const targetY = target.y + dirY * pushDistance;
    this.Body.setPosition(target.body, { x: targetX, y: targetY });
    if (target.body.velocity) {
      this.Body.setVelocity(target.body, {
        x: target.body.velocity.x + dirX * pushDistance * 0.05,
        y: target.body.velocity.y + dirY * pushDistance * 0.05,
      });
    }
    target.x = targetX;
    target.y = targetY;
  }

  private createCrater(centerX: number, centerY: number, radius: number, bullet: any): void {
    const terrainY = CONST.CANVAS_HEIGHT - CONST.TERRAIN_BASE_Y_OFFSET;
    let craterRadiusX = radius;
    let craterRadiusY = radius;
    if (bullet.explosionShape === 'horizontal_oval') {
      craterRadiusX = radius * 1.5;
    } else if (bullet.explosionShape === 'vertical_oval') {
      craterRadiusY = radius * 1.5;
    }

    for (let x = centerX - craterRadiusX; x < centerX + craterRadiusX; x++) {
      for (let y = centerY - craterRadiusY; y < centerY + craterRadiusY; y++) {
        const dx = x - centerX;
        const dy = y - centerY;
        const normalizedDist = Math.sqrt((dx / craterRadiusX) ** 2 + (dy / craterRadiusY) ** 2);
        if (normalizedDist <= 1) {
          const ix = Math.floor(x);
          const iy = Math.floor(y - terrainY);
          if (ix >= 0 && ix < CONST.TERRAIN_WIDTH && iy >= 0 && iy < CONST.TERRAIN_STRIP_HEIGHT) {
            if (this.terrain[ix] && this.terrain[ix][iy] !== 0) {
              this.terrain[ix][iy] = 0; // Remove terrain (solid and visual-only)
            }
          }
        }
      }
    }
  }

  private checkPlayerTerrainCollision() {
    if (!this.player.body) return;

    const terrainHeight = this.getTerrainHeightAt(this.player.x);
    if (terrainHeight !== -1) {
      const terrainAngle = this.getTerrainAngleAt(this.player.x);
      const tankHalfHeight = CONST.TANK_HALF_HEIGHT;
      const tankBottom = this.player.body.position.y + tankHalfHeight;

      if (tankBottom > terrainHeight) {
        // Player is below terrain surface, reposition to surface
        const targetY = terrainHeight - tankHalfHeight;
        this.Body.setPosition(this.player.body, { x: this.player.x, y: targetY });
        this.Body.setVelocity(this.player.body, { x: this.player.body.velocity.x, y: 0 });

        this.player.terrainAngle = terrainAngle;
      }
    }
  }

  private checkEnemiesTerrainCollision() {
    for (const enemy of this.enemies) {
      if (enemy.body && enemy.active) {
        const terrainHeight = this.getTerrainHeightAt(enemy.x);
        if (terrainHeight !== -1) {
          const terrainAngle = this.getTerrainAngleAt(enemy.x);
          const tankHalfHeight = CONST.TANK_HALF_HEIGHT;
          const tankBottom = enemy.body.position.y + tankHalfHeight;

          if (tankBottom > terrainHeight) {
            // Enemy is below terrain surface, reposition to surface
            const targetY = terrainHeight - tankHalfHeight;
            this.Body.setPosition(enemy.body, { x: enemy.x, y: targetY });
            this.Body.setVelocity(enemy.body, { x: enemy.body.velocity.x, y: 0 });
          }
          // If enemy is above terrain, let gravity pull it down

          enemy.terrainAngle = terrainAngle;
        }
        // If no terrain at enemy position, let it fall under gravity
      }
    }
  }

  private checkEntitiesFall() {
    // Check player fall
    if (this.player.y > CONST.CANVAS_HEIGHT + CONST.FALL_THRESHOLD_OFFSET) {
      this.player.health = 0;
    }

    // Check enemies fall
    for (const enemy of this.enemies) {
      if (enemy.active && enemy.y > CONST.CANVAS_HEIGHT + CONST.FALL_THRESHOLD_OFFSET) {
        enemy.health = 0;
        enemy.active = false;
        if (enemy.body) {
          this.World.remove(this.world, enemy.body);
        }
      }
    }
  }

  private updateExplosions() {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const explosion = this.explosions[i];
      explosion.radius += CONST.EXPLOSION_EXPANSION_RATE;
      explosion.life--;

      if (explosion.life <= 0 || explosion.radius >= explosion.maxRadius) {
        this.explosions.splice(i, 1);
      }
    }
  }

  private updateDamageTexts() {
    for (let i = this.damageTexts.length - 1; i >= 0; i--) {
      const text = this.damageTexts[i];
      text.y -= CONST.DAMAGE_TEXT_RISE_SPEED;
      text.life--;

      if (text.life <= 0) {
        this.damageTexts.splice(i, 1);
      }
    }
  }

  getTerrainHeightAt(x: number): number {
    const ix = Math.floor(x);
    if (ix < 0 || ix >= CONST.TERRAIN_WIDTH) return -1;

    for (let y = 0; y < CONST.TERRAIN_STRIP_HEIGHT; y++) {
      if (this.terrain[ix] && this.terrain[ix][y] === 1) {
        return CONST.CANVAS_HEIGHT - CONST.TERRAIN_BASE_Y_OFFSET + y;
      }
    }
    return -1;
  }

  getTerrainAngleAt(x: number): number {
    const h1 = this.getTerrainHeightAt(x - CONST.TERRAIN_SLOPE_SAMPLE_DISTANCE);
    const h2 = this.getTerrainHeightAt(x + CONST.TERRAIN_SLOPE_SAMPLE_DISTANCE);
    if (h1 === -1 || h2 === -1) return 0;

    const slope = (h2 - h1) / (2 * CONST.TERRAIN_SLOPE_SAMPLE_DISTANCE);
    return Math.atan(slope);
  }

  getEntityDisplayedAngle(entity: Player | Enemy): number {
    const baseAngleRad = (entity.angle * Math.PI) / 180;
    const trueAngleRad =
      -entity.terrainAngle + (entity.facing === -1 ? Math.PI - baseAngleRad : baseAngleRad);
    let trueAngleDeg = (trueAngleRad * 180) / Math.PI;
    if (entity.facing === -1) {
      trueAngleDeg = 180 - trueAngleDeg;
    }
    return Math.round(trueAngleDeg);
  }

  get turnQueue(): TurnEntity[] {
    return this._turnQueue;
  }

  pausePhysics() {
    if (this.runner) {
      this.Runner.stop(this.runner);
    }
  }

  resumePhysics() {
    if (this.runner) {
      this.Runner.run(this.runner, this.engine);
    }
  }

  destroy() {
    if (this.runner) {
      this.Runner.stop(this.runner);
    }
  }
}
