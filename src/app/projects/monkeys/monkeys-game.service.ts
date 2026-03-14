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
} from './monkeys.types';
import * as CONST from './monkeys.constants';
import { MonkeysSpriteService } from './monkeys-sprite.service';

@Injectable({
  providedIn: 'root',
})
export class MonkeysGameService {
  // Matter.js functions (passed from component)
  public Engine: any;
  public Render: any;
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

  constructor(private spriteService: MonkeysSpriteService) {
    this.player = this.createInitialPlayer();
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

      // Check for terrain collision or off-screen
      // if (projectile.position.y > this.getTerrainHeightAt(projectile.position.x) ||
      //     projectile.position.x < 0 || projectile.position.x > CONST.CANVAS_WIDTH) {
      //   endReason = projectile.position.y > this.getTerrainHeightAt(projectile.position.x) ? 'terrain' : 'offscreen';
      //   break;
      // }

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
    this.Render = matter.Render;
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

    const placements = this.buildTerrainChunkPlan();
    const bottomPlacements = this.buildBottomChunkPlan(placements);
    this.terrainChunkPlacements = placements;
    this.terrainBottomPlacements = bottomPlacements;
    this.rasterizeTerrainPlacements(placements, bottomPlacements);
    this.terrainInteriorPlacements = this.buildInteriorPlacements(placements, bottomPlacements);
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
        lastSlopeDir = selected.pieceType === 'top_slope_up' ? 'up' : 'down';
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
      pool.push(...topSlopeUp, ...topSlopeUp);
    }
    if (canGoDown && lastSlopeDir !== 'down') {
      pool.push(...topSlopeDown, ...topSlopeDown);
    }

    if (pool.length === 0) {
      pool.push(...topFlat);
    }

    return pool;
  }

  private buildBottomChunkPlan(topPlacements: TerrainChunkPlacement[]): TerrainChunkPlacement[] {
    // Build a profile of the deepest top surface Y + one interior tile height
    // as the minimum allowed bottom Y at each x position.
    const minBottomProfile = this.buildMinBottomProfile(topPlacements);

    // Exclude bottom cap-like tiles 8 and 9 from general bottom generation.
    const bottomFlat = this.getTerrainRegionsByType('bottom_flat').filter(
      (item) => ![8, 9].includes(item.id),
    );
    const bottomSlopeUp = this.getTerrainRegionsByType('bottom_slope_up');
    const bottomSlopeDown = this.getTerrainRegionsByType('bottom_slope_down');

    if (bottomSlopeUp.length === 0 || bottomSlopeDown.length === 0) {
      return this.buildFallbackBottomPlan();
    }

    const placements: TerrainChunkPlacement[] = [];
    // Constrain start Y so the tallest bottom sprite fits within the strip.
    const maxSafeStartY = Math.min(265, CONST.TERRAIN_STRIP_HEIGHT - 75);
    let currentBottomY = this.randomInRange(200, maxSafeStartY);
    let xCursor = 0;
    let consecutiveFlats = 0;
    let lastBottomSlopeDir: 'flat' | 'up' | 'down' = 'flat';

    while (xCursor < CONST.TERRAIN_WIDTH) {
      // Ensure bottom Y doesn't go above the top surface + interior.
      const minY = this.getMinBottomYForRange(minBottomProfile, xCursor, 90);
      if (currentBottomY < minY) {
        currentBottomY = minY;
      }

      const topSlope = this.getTopSlopeDirection(topPlacements, xCursor);

      const candidatePool = this.buildBottomCandidatePool(
        bottomFlat,
        bottomSlopeUp,
        bottomSlopeDown,
        consecutiveFlats,
        currentBottomY,
        minBottomProfile,
        xCursor,
        topSlope,
        lastBottomSlopeDir,
      );

      if (candidatePool.length === 0) {
        break;
      }

      const selected = candidatePool[Math.floor(Math.random() * candidatePool.length)];
      const placement = this.createBottomPlacement(selected, xCursor, currentBottomY);
      placements.push(placement);

      const bottomEntry = this.getBottomProfileY(selected, 0);
      const bottomExit = this.getBottomProfileY(selected, 1);
      const delta = bottomExit - bottomEntry;
      currentBottomY += delta;
      xCursor += selected.width;

      if (selected.pieceType === 'bottom_flat') {
        consecutiveFlats++;
        lastBottomSlopeDir = 'flat';
      } else {
        consecutiveFlats = 0;
        lastBottomSlopeDir = selected.pieceType === 'bottom_slope_up' ? 'up' : 'down';
      }
    }

    return placements;
  }

  private buildMinBottomProfile(topPlacements: TerrainChunkPlacement[]): number[] {
    // For each X, find the deepest top surface Y + one interior tile (60px)
    // as the minimum Y the bottom path can reach.
    const interiorHeight = 60;
    const profile = new Array<number>(CONST.TERRAIN_WIDTH).fill(0);
    for (const placement of topPlacements) {
      const startX = Math.max(0, Math.floor(placement.x));
      const endX = Math.min(CONST.TERRAIN_WIDTH, Math.floor(placement.x + placement.region.width));
      for (let x = startX; x < endX; x++) {
        const localX = x - placement.x;
        const t = Math.max(0, Math.min(1, localX / Math.max(1, placement.region.width - 1)));
        const topY =
          placement.topWorldY +
          placement.region.topEntryY +
          (placement.region.topExitY - placement.region.topEntryY) * t;
        const minBottom = Math.floor(topY + placement.region.height + interiorHeight);
        profile[x] = Math.max(profile[x], minBottom);
      }
    }
    return profile;
  }

  private getTopSlopeDirection(
    topPlacements: TerrainChunkPlacement[],
    xCursor: number,
  ): 'flat' | 'up' | 'down' {
    for (const p of topPlacements) {
      if (xCursor >= p.x && xCursor < p.x + p.region.width) {
        if (p.region.pieceType === 'top_slope_up') return 'up';
        if (p.region.pieceType === 'top_slope_down') return 'down';
        return 'flat';
      }
    }
    return 'flat';
  }

  private getMinBottomYForRange(profile: number[], xCursor: number, width: number): number {
    const startX = Math.max(0, Math.floor(xCursor));
    const endX = Math.min(CONST.TERRAIN_WIDTH, Math.floor(xCursor + width));
    let maxMinY = 0;
    for (let x = startX; x < endX; x++) {
      maxMinY = Math.max(maxMinY, profile[x]);
    }
    return maxMinY;
  }

  private buildBottomCandidatePool(
    bottomFlat: TerrainSpriteMetadata[],
    bottomSlopeUp: TerrainSpriteMetadata[],
    bottomSlopeDown: TerrainSpriteMetadata[],
    consecutiveFlats: number,
    currentBottomY: number,
    minBottomProfile: number[],
    xCursor: number,
    topSlope: 'flat' | 'up' | 'down',
    lastSlopeDir: 'flat' | 'up' | 'down',
  ): TerrainSpriteMetadata[] {
    const shouldForceSlope = consecutiveFlats >= this.TERRAIN_MAX_CONSECUTIVE_FLATS;
    const pool: TerrainSpriteMetadata[] = [];

    // Only add sprites whose full visual extent fits within the terrain strip
    // and whose exit Y stays below the top surface.
    const isValid = (sprite: TerrainSpriteMetadata) => {
      const entry = sprite.bottomEntryY ?? 0;
      if (currentBottomY - entry + sprite.height >= CONST.TERRAIN_STRIP_HEIGHT) {
        return false;
      }
      // Check the exit Y stays below top surface + interior.
      const exitY = sprite.bottomExitY ?? entry;
      const exitBottomY = currentBottomY + (exitY - entry);
      const minY = this.getMinBottomYForRange(minBottomProfile, xCursor, sprite.width);
      return exitBottomY >= minY;
    };

    // Reduce flat weight when top is sloping to bias bottom toward matching.
    if (!shouldForceSlope) {
      const validFlats = bottomFlat.filter(isValid);
      const flatWeight = topSlope === 'flat' ? 3 : 1;
      for (let i = 0; i < flatWeight; i++) pool.push(...validFlats);
    }

    const canGoUp = currentBottomY > this.TERRAIN_MIN_BOTTOM_Y + 30;
    const canGoDown = currentBottomY < this.TERRAIN_MAX_BOTTOM_Y - 30;
    // Prevent consecutive same-direction slopes to keep height change within one interior tile.
    if (canGoUp && lastSlopeDir !== 'up') {
      const validUp = bottomSlopeUp.filter(isValid);
      const upWeight = topSlope === 'up' ? 4 : 2;
      for (let i = 0; i < upWeight; i++) pool.push(...validUp);
    }
    if (canGoDown && lastSlopeDir !== 'down') {
      const validDown = bottomSlopeDown.filter(isValid);
      const downWeight = topSlope === 'down' ? 4 : 2;
      for (let i = 0; i < downWeight; i++) pool.push(...validDown);
    }

    if (pool.length === 0) {
      const validFallback = [...bottomFlat, ...bottomSlopeDown].filter(isValid);
      if (validFallback.length > 0) {
        pool.push(...validFallback);
      } else {
        pool.push(...bottomFlat);
      }
    }

    return pool;
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

  private buildBottomShellStartProfile(bottomPlacements: TerrainChunkPlacement[]): number[] {
    const profile = new Array<number>(CONST.TERRAIN_WIDTH).fill(-1);

    for (const placement of bottomPlacements) {
      const startX = Math.max(0, Math.floor(placement.x));
      const endXExclusive = Math.min(
        CONST.TERRAIN_WIDTH,
        Math.floor(placement.x + placement.region.width),
      );
      for (let x = startX; x < endXExclusive; x++) {
        profile[x] = Math.max(profile[x], Math.floor(placement.topWorldY));
      }
    }

    return profile;
  }

  private rasterizeTerrainPlacements(
    topPlacements: TerrainChunkPlacement[],
    bottomPlacements: TerrainChunkPlacement[],
  ): void {
    const topProfile = this.rasterizeBoundaryProfile(topPlacements, 'top');
    const bottomProfile = this.rasterizeBoundaryProfile(bottomPlacements, 'bottom');

    for (let x = 0; x < CONST.TERRAIN_WIDTH; x++) {
      const fallbackTop = Math.floor((this.TERRAIN_MIN_TOP_Y + this.TERRAIN_MAX_TOP_Y) / 2);
      const topY = Number.isFinite(topProfile[x]) ? topProfile[x] : fallbackTop;
      const hasBottomProfile = Number.isFinite(bottomProfile[x]);
      const fallbackBottom = Math.min(this.TERRAIN_MAX_BOTTOM_Y, topY + this.TERRAIN_MIN_THICKNESS);
      const bottomY = hasBottomProfile
        ? Math.min(this.TERRAIN_MAX_BOTTOM_Y, bottomProfile[x])
        : fallbackBottom;

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
    bottomPlacements: TerrainChunkPlacement[],
  ): TerrainChunkPlacement[] {
    const interiorRegions = this.getTerrainRegionsByType('interior');
    if (interiorRegions.length === 0) return [];

    const bottomShellStartProfile = this.buildBottomShellStartProfile(bottomPlacements);

    const placements: TerrainChunkPlacement[] = [];
    for (const top of topPlacements) {
      const startX = Math.max(0, Math.floor(top.x));
      const endXExclusive = Math.min(CONST.TERRAIN_WIDTH, Math.floor(top.x + top.region.width));
      // Use the deepest bottom-shell start in this chunk span to prevent overlap seams.
      let bottomShellStartY = Number.NEGATIVE_INFINITY;
      for (let x = startX; x < endXExclusive; x++) {
        const y = bottomShellStartProfile[x];
        if (y >= 0) {
          bottomShellStartY = Math.max(bottomShellStartY, y);
        }
      }

      if (!Number.isFinite(bottomShellStartY)) {
        bottomShellStartY = CONST.TERRAIN_STRIP_HEIGHT;
      }

      const fillStartY = Math.floor(top.topWorldY + top.region.height);
      let y = fillStartY;
      while (y < bottomShellStartY) {
        const region = interiorRegions[Math.floor(Math.random() * interiorRegions.length)];
        const nextY = y + region.height;

        if (nextY <= bottomShellStartY) {
          placements.push({ region, x: top.x, topWorldY: y });
          y = nextY;
          continue;
        }

        // Final interior tile: anchor flush with bottom shell start to avoid visible horizontal gaps.
        const anchoredY = Math.floor(bottomShellStartY - region.height);
        // Allow overlap with top shell so short spans still receive an interior tile.
        if (anchoredY >= top.topWorldY) {
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

  private initPlayer() {
    this.player.vehicle = CONST.PLAYER_VEHICLE;
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
    return entities.every(
      (e) => e.body && Math.abs(e.body.velocity.y) <= 0.5
    );
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
        console.log('Player turn_start: setting to idle');
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

        console.log(
          `Enemy assess: distance=${distance.toFixed(1)}, fuel=${enemy.movementFuel}, behavior=${enemy.behavior}`,
        );

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
          console.log(`Enemy moving closer, direction=${enemy.moveDirection}`);
        } else if (!forceShot && distance < moveAwayThreshold && enemy.movementFuel! > 5) {
          // Too close, move away
          enemy.moveDirection = dx > 0 ? -1 : 1; // Away from player
          enemy.movementTimer = 800 + Math.random() * 600; // 0.8-1.4 seconds
          enemy.turnState = 'moving';
          console.log(`Enemy moving away, direction=${enemy.moveDirection}`);
        } else {
          // Good distance (or forced after too many reassessments), aim and shoot
          enemy.facing = dx > 0 ? 1 : -1; // Face toward player
          enemy.targetAngle = undefined;
          enemy.targetPower = undefined;
          enemy.turnState = 'aiming';
          enemy.turnTimer = 0;
          console.log(`Enemy aiming, facing=${enemy.facing}${forceShot ? ' (forced)' : ''}`);
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
            console.log('Aggressive enemy movement blocked, switching to terrain-clearing shot');
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
          console.log('Enemy stuck, handling recovery');
          if (enemy.behavior === 'aggressive') {
            console.log('Aggressive enemy stuck, switching to terrain-clearing shot');
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
            console.log(
              `Aggressive terrain-clearing shot: angle=${enemy.targetAngle.toFixed(1)}, power=${enemy.targetPower.toFixed(1)}`,
            );
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

          const scatter = CONST.DIFFICULTY_SCATTER[this.difficulty] ?? CONST.DIFFICULTY_SCATTER['normal'];
          const angleScatter = (Math.random() * 2 - 1) * scatter.angleDeg;
          const powerScatter = (Math.random() * 2 - 1) * scatter.powerFrac;

          if (bestHit) {
            const maxPower = Math.max(20, enemy.vehicle.power);
            enemy.targetAngle = Math.max(
              enemy.vehicle.minAimAngle,
              Math.min(enemy.vehicle.maxAimAngle, bestHit.angle + angleScatter),
            );
            enemy.targetPower = Math.max(10, Math.min(maxPower, bestHit.power + powerScatter * maxPower));
            console.log(
              `Enemy aiming: found hit at angle=${bestHit.angle}, power=${bestHit.power}, dist=${bestHit.dist.toFixed(1)} (scatter ±${scatter.angleDeg}°/±${(scatter.powerFrac*100).toFixed(0)}%)`,
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
            enemy.targetPower = Math.max(10, Math.min(maxFallbackPower, enemy.targetPower + powerScatter * maxFallbackPower));
            console.log(
              `Enemy aiming: fallback angle=${enemy.targetAngle.toFixed(1)}, power=${enemy.targetPower.toFixed(1)}`,
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
    const damageRadius = 50;
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
      console.log(
        'Game over pending: player.health =',
        this.player.health,
        '/',
        this.player.vehicle.health,
        'starting 2s timer',
      );
      this.currentState = GameState.GAME_OVER_DELAY;
      this.gameOverTimer = 2.0;
      this.keys = {};
      this.isCharging = false;
    }

    if (this.currentState === GameState.GAME_OVER_DELAY) {
      this.gameOverTimer -= deltaTime;
      if (this.gameOverTimer <= 0) {
        console.log('Game over timer expired, setting to GAME_OVER');
        this.currentState = GameState.GAME_OVER;
      }
    }

    // Freeze on game over or pause
    if (this.currentState === GameState.GAME_OVER || this.currentState === GameState.PAUSED) {
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
            console.log(
              'Left movement blocked, fuel:',
              this.player.movementFuel,
              'terrain:',
              hasTerrain,
              'angle:',
              angle,
              'isPlayerTurn:',
              this.isPlayerTurn(),
            );
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
            console.log(
              'Right movement blocked, fuel:',
              this.player.movementFuel,
              'terrain:',
              hasTerrain,
              'angle:',
              this.getTerrainAngleAt(targetX),
              'isPlayerTurn:',
              this.isPlayerTurn(),
            );
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
      console.log('Projectile went off game area, exploding');
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
      console.log('Collided with terrain at center, exploding');
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
        console.log('Collided with terrain at offset', offsetX, offsetY, ', exploding');
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
      CONST.CRATER_RADIUS,
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
        console.log('Collided with player, exploding');
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
          console.log('Collided with enemy, exploding');
          return true;
        }
      }
    }

    return false;
  }

  private startCharging() {
    this.isCharging = true;
    this.chargeStartTime = Date.now();
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
      }
    }
  }

  private respawnPlayer() {
    this.player.health = this.player.vehicle.health;
    this.player.movementFuel = this.player.vehicle.fuel;
    this.player.power = CONST.PLAYER_START_POWER;
    this.player.maxPower = this.player.vehicle.power;
    this.player.x = CONST.PLAYER_START_X;
    this.player.y = CONST.CANVAS_HEIGHT - CONST.TERRAIN_BASE_Y_OFFSET - CONST.PLAYER_HOVER_HEIGHT;
    this.player.angle = (this.player.vehicle.minAimAngle + this.player.vehicle.maxAimAngle) / 2;
    this.player.power = CONST.PLAYER_START_POWER;
    this.player.facing = CONST.PLAYER_START_FACING;
    this.player.terrainAngle = CONST.PLAYER_START_TERRAIN_ANGLE;

    if (this.player.body) {
      this.Body.setPosition(this.player.body, { x: this.player.x, y: this.player.y });
      this.Body.setVelocity(this.player.body, { x: 0, y: 0 });
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
