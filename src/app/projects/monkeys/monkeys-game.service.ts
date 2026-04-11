// monkeys-game.service.ts
// Service handling core game logic for Monkeys

import { Injectable } from '@angular/core';
import {
  Player,
  Enemy,
  GameState,
  Explosion,
  DamageText,
  AftermathCallout,
  TurnEntity,
  Projectile,
  TerrainChunkPlacement,
  TerrainSpriteMetadata,
  Vehicle,
  EquipmentItem,
  EquipmentSet,
  EquipmentSlot,
  EquipmentStats,
} from './monkeys.types';
import * as CONST from './monkeys.constants';
import { MonkeysSpriteService } from './monkeys-sprite.service';
import { EnemyFactoryService } from './enemy-factory.service';
import { TerrainService } from './terrain.service';
import { PhysicsService } from './physics.service';
import { AIService } from './ai.service';
import { TurnService } from './turn.service';
import { EquipmentService } from './equipment.service';
import { ProjectileService } from './projectile.service';
import { CollisionService } from './collision.service';
import { MonkeysSfxService } from './monkeys-sfx.service';
import { DamageService } from './damage.service';

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
  player: Player;
  enemies: Enemy[] = [];
  panToEntity: any = null;
  currentState: GameState = GameState.MENU;
  difficulty: 'easy' | 'normal' | 'hard' = 'normal';

  // Turn-based system
  private _turnStartTime: number = 0;
  private lastUpdateTime = Date.now();

  // Flags
  isCharging = false;
  chargeStartTime = 0;
  lastFiredPowerRatio: number | null = null;
  private playerShotThisTurn = false;

  // Aftermath
  private readonly MIN_AFTERMATH_MS = 1500;
  aftermathStartMs = 0;
  aftermathImpactPos: { x: number; y: number } | null = null;
  aftermathCallouts: AftermathCallout[] = [];

  // Input
  keys: { [key: string]: boolean } = {};

  // Game over delay
  private gameOverTimer: number = 0;
  private winTimer: number = 0;

  // Equipment properties (delegated to EquipmentService)
  get playerName(): string {
    return this.equipmentService.playerName;
  }

  set playerName(value: string) {
    this.equipmentService.playerName = value;
  }

  constructor(
    private spriteService: MonkeysSpriteService,
    private enemyFactory: EnemyFactoryService,
    private terrainService: TerrainService,
    private physicsService: PhysicsService,
    private aiService: AIService,
    private turnService: TurnService,
    private equipmentService: EquipmentService,
    private projectileService: ProjectileService,
    private collisionService: CollisionService,
    private sfxService: MonkeysSfxService,
    private damageService: DamageService,
  ) {
    this.player = this.createInitialPlayer();
    void this.equipmentService.loadEquipmentData();
    this.loadDifficulty();
  }

  saveDifficulty(): void {
    localStorage.setItem('monkeys_options_game', JSON.stringify({ difficulty: this.difficulty }));
  }

  private loadDifficulty(): void {
    const raw = localStorage.getItem('monkeys_options_game');
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as { difficulty?: string };
      if (
        data.difficulty === 'easy' ||
        data.difficulty === 'normal' ||
        data.difficulty === 'hard'
      ) {
        this.difficulty = data.difficulty;
      }
    } catch {
      // ignore malformed data
    }
  }

  setMatterJS(matter: any) {
    this.physicsService.setMatterJS(matter);
    // Also set on main service for backward compatibility
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
    entity.terrainAngle = this.collisionService.getTerrainAngleAt(x, this.terrainService.terrain);
    this.physicsService.createEntity(entity, x, y);
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
      delay: 0,
      entityState: 'idle',
    };
  }

  async initGame() {
    this.gameOverTimer = 0;
    this.winTimer = 0;
    this.damageService.resetLog();
    this.physicsService.clearTrajectoryCache();
    await this.terrainService.loadTerrainMetadata();
    this.terrainService.generateTerrain();
    this.physicsService.initPhysics();
    this.rollWind();
    this.initPlayer();
    this.spawnEnemies();
    this.assignVoicePacks();
    this.turnService.initTurnQueue(this.player, this.enemies);
    this.turnService.startTurn();
    this.currentState = GameState.SETUP;
  }

  getItemsForSlot(slot: EquipmentSlot): EquipmentItem[] {
    return this.equipmentService.getItemsForSlot(slot);
  }

  getEquippedSetBonus(): EquipmentStats | null {
    return this.equipmentService.getEquippedSetBonus();
  }

  private initPlayer() {
    const baseVehicle =
      CONST.SELECTABLE_VEHICLES[this.equipmentService.selectedVehicleIndex]?.vehicle ??
      CONST.PLAYER_VEHICLE;
    const vehicle: Vehicle = {
      ...baseVehicle,
      bullet: { ...baseVehicle.bullet },
    };
    this.equipmentService.applyEquipmentToVehicle(vehicle);
    this.player.vehicle = vehicle;
    this.player.displayName = this.playerName || 'You';
    this.player.x = Math.random() * (CONST.TERRAIN_WIDTH - 200) + 100;
    this.player.y =
      CONST.CANVAS_HEIGHT -
      CONST.TERRAIN_BASE_Y_OFFSET -
      CONST.PLAYER_HOVER_HEIGHT -
      CONST.SPAWN_HEIGHT_OFFSET;
    this.player.maxPower = this.player.vehicle.power;
    this.player.health = this.player.vehicle.health;
    this.player.currentShieldHealth = this.player.vehicle.shieldHealth ?? 0;
    this.player.movementFuel = this.player.vehicle.fuel;

    this.createEntity(this.player, this.player.x, this.player.y);
  }

  private assignVoicePacks(): void {
    // Shuffle pack names then assign one per entity (cycles if more entities than packs)
    const packs = [...CONST.VOICE_PACK_NAMES].sort(() => Math.random() - 0.5);
    const allEntities = [this.player, ...this.enemies];
    allEntities.forEach((entity, i) => {
      entity.vehicle.voicePack = packs[i % packs.length];
    });
    const activePacks = [...new Set(allEntities.map((e) => e.vehicle.voicePack!))];
    void this.sfxService.loadVoiceAssets(activePacks);
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
      const terrainHeight = this.collisionService.getTerrainHeightAt(
        x,
        this.terrainService.terrain,
      );
      const y =
        terrainHeight !== -1
          ? terrainHeight - CONST.TANK_HALF_HEIGHT - CONST.SPAWN_HEIGHT_OFFSET
          : CONST.CANVAS_HEIGHT -
            CONST.TERRAIN_BASE_Y_OFFSET -
            CONST.PLAYER_HOVER_HEIGHT -
            CONST.SPAWN_HEIGHT_OFFSET;

      const { vehicle: enemyVehicle } = this.enemyFactory.buildEnemyVehicle(
        this.difficulty,
        this.equipmentService.equipmentItems,
        this.equipmentService.equipmentSets,
      );
      const enemy: Enemy = {
        body: null,
        x: x,
        y: y,
        angle: (enemyVehicle.minAimAngle + enemyVehicle.maxAimAngle) / 2,
        health: enemyVehicle.health,
        color: '#FF6B6B',
        active: true,
        facing: Math.random() > 0.5 ? 1 : -1,
        terrainAngle: 0, // Will be set in createEntity
        vehicle: enemyVehicle,
        turnState: 'turn_start',
        targetPower: 0,
        power: 0,
        delay: 0,
        stuckCounter: 0,
        assessCounter: 0,
        lastX: x,
        lastY: y,
        movementFuel: enemyVehicle.fuel,
        currentShieldHealth: enemyVehicle.shieldHealth ?? 0,
        entityState: 'idle',
      };
      enemy.displayName = `Enemy ${i + 1}`;
      this.createEntity(enemy, x, y);
      this.enemies.push(enemy);
    }
  }

  private updateEnemies() {
    for (const enemy of this.enemies) {
      if (enemy.body && enemy.active) {
        this.physicsService.updateEntityPhysics(enemy);
        this.applyWindToEntity(enemy);
        // Kill enemies that have fallen off the map before AI or terrain-snap runs
        if (enemy.y > CONST.CANVAS_HEIGHT + CONST.FALL_THRESHOLD_OFFSET) {
          this.damageService.applyDamage(enemy, { amount: enemy.health, source: 'fall' }, 'enemy');
          this.physicsService.removeBody(enemy.body);
        }
      }
    }

    this.collisionService.checkEnemiesTerrainCollision(
      this.enemies,
      this.terrainService.terrain,
      this.physicsService,
    );
  }

  private handleTurns() {
    if (this.currentState !== GameState.PLAYING) return;

    const currentTurn = this.getCurrentTurnEntity();
    if (!currentTurn) return;
    const entity = currentTurn.entity;
    if (!entity.active) return;

    if (
      this.turnService.turnTime > this.turnService.TIMEOUT_MS &&
      entity.turnState !== 'bullet_in_flight'
    ) {
      if (currentTurn.type === 'player') {
        this.damageService.addToLog({
          type: 'timeout',
          attackerName: this.player.displayName ?? 'You',
          targetName: '',
          weaponName: '',
          totalDamage: 0,
          wasFatal: false,
        });
      }
      this.endTurn();
      return;
    }

    if (currentTurn.type === 'player') {
      this.performPlayerAction(entity as Player);
    } else {
      this.performEnemyAction(entity as Enemy);
    }
  }

  private performSharedTurnStates(entity: Player | Enemy): boolean {
    if (entity.entityState === 'charging') {
      this.performCharging(entity);
      return true;
    }
    switch (entity.turnState) {
      case 'bullet_in_flight':
        if (!this.projectile && this.projectileService.childProjectiles.length === 0) {
          this.aftermathImpactPos = this.projectileService.lastImpactPos;
          this.aftermathStartMs = Date.now();
          this.aftermathCallouts = [];
          this.currentState = GameState.AFTERMATH;
        }
        return true;
      default:
        return false;
    }
  }

  private moveEntity(entity: Player | Enemy, direction: number): boolean {
    if (entity.movementFuel! <= 0) return false;

    const moveSpeed = CONST.PLAYER_MOVE_SPEED;
    const vx = direction * moveSpeed;

    // Delegate slope check to CollisionService — the single source of truth for cliff traversal.
    const canMove = this.collisionService.canTraverseSlopeInDirection(
      entity.x,
      direction,
      this.terrainService.terrain,
    );

    if (canMove) {
      this.Body.setVelocity(entity.body, { x: vx, y: entity.body.velocity.y });
      entity.movementFuel! -= 0.5;
      entity.facing = direction;
      this.sfxService.ensureWalkLoop(entity, { category: entity.vehicle?.sfxWalk ?? 'walk' });
      return true;
    } else {
      this.Body.setVelocity(entity.body, { x: 0, y: entity.body.velocity.y });
      this.sfxService.stopWalkLoop(entity);
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
    enemy.entityState = 'idle';
    enemy.stuckCounter = 0;
    this.sfxService.stopWalkLoop(enemy);
  }

  private performCharging(entity: Player | Enemy) {
    this.sfxService.stopWalkLoop(entity);
    const chargeTime =
      Date.now() -
      (entity === this.player ? this.chargeStartTime : (entity as Enemy).chargeStartTime!);
    const maxPower = entity === this.player ? entity.maxPower : entity.vehicle.power;
    const chargeRatio = Math.min(chargeTime / CONST.MAX_CHARGE_TIME, 1);
    entity.power = CONST.MIN_POWER + (maxPower - CONST.MIN_POWER) * chargeRatio;

    const shouldFire =
      entity === this.player
        ? chargeTime >= CONST.MAX_CHARGE_TIME
        : entity.power >= ((entity as Enemy).targetPower ?? maxPower);

    if (shouldFire) {
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
      // Transition out of pushback once the body has settled
      if (
        entity.entityState === 'pushback' &&
        Math.abs(entity.body.velocity.x) < 0.5 &&
        Math.abs(entity.body.velocity.y) < 0.5
      ) {
        entity.entityState = 'idle';
      }
      // Update terrain angle
      entity.terrainAngle = this.collisionService.getTerrainAngleAt(
        entity.x,
        this.terrainService.terrain,
      );
      // Smoothly interpolate angle toward target
      if (entity.targetAngle !== undefined) {
        const diff = entity.targetAngle - entity.angle;
        entity.angle += diff * 0.1; // 10% interpolation per frame
      }
    }
  }

  /**
   * Apply wind force to vehicles. Lives here rather than PhysicsService so it can use
   * CollisionService.canTraverseSlopeInDirection() — the same cliff check used by movement.
   */
  private applyWindToEntity(entity: Player | Enemy) {
    if (!entity.body || this.physicsService.windSpeed <= 0) return;
    if (Math.abs(entity.body.velocity.y) <= 1.0) return; // only push airborne entities
    this.Body.applyForce(entity.body, entity.body.position, {
      x:
        (this.physicsService.windSpeed *
          0.75 *
          CONST.WIND_VEHICLE_FORCE_SCALE *
          Math.cos(this.physicsService.windAngle)) /
        (entity.vehicle?.weight ?? 10),
      y: 0,
    });
  }

  private performPlayerAction(player: Player) {
    if (this.performSharedTurnStates(player)) return;

    // Check for skip
    if (this.keys['S']) {
      this.damageService.addToLog({
        type: 'pass',
        attackerName: this.player.displayName ?? 'You',
        targetName: '',
        weaponName: '',
        totalDamage: 0,
        wasFatal: false,
      });
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
          if (this.player.vehicle.voicePack) {
            this.sfxService.playVo(this.player, this.player.vehicle.voicePack, 'win');
          }
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
    }
  }

  private performEnemyAction(enemy: Enemy) {
    if (this.performSharedTurnStates(enemy)) return;

    const target: Player | Enemy = enemy.target ?? this.player;
    if (enemy.entityState === 'moving') {
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
        this.sfxService.stopWalkLoop(enemy);
        // After moving, reassess or go to aiming
        const newDx = target.x - enemy.x;
        const newDistance = Math.abs(newDx);
        const maxReassess = (enemy.reassessCount ?? 0) >= 3;
        if (!maxReassess && (newDistance > 500 || newDistance < 100)) {
          enemy.turnState = 'assess'; // Reassess if still not ideal
          enemy.entityState = 'idle';
        } else {
          enemy.facing = newDx > 0 ? 1 : -1;
          enemy.targetAngle = undefined;
          enemy.targetPower = undefined;
          enemy.turnState = 'aiming';
          enemy.entityState = 'idle';
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
        enemy.entityState = 'idle';
        enemy.targetAngle = undefined;
        enemy.targetPower = undefined;
        enemy.stuckCounter = 0;
        this.sfxService.stopWalkLoop(enemy);
      }
      enemy.lastX = enemy.x;
      enemy.lastY = enemy.y;
      return;
    }
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
        enemy.target = this.pickEnemyTarget(enemy);
        break;

      case 'assess':
        enemy.assessCounter -= 16;
        if (enemy.assessCounter > 0) {
          return;
        }
        // Assess situation and decide action
        const dx = target.x - enemy.x;
        const dy = target.y - enemy.y;
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
          enemy.entityState = 'moving';
        } else if (!forceShot && distance < moveAwayThreshold && enemy.movementFuel! > 5) {
          // Too close, move away
          enemy.moveDirection = dx > 0 ? -1 : 1; // Away from player
          enemy.movementTimer = 800 + Math.random() * 600; // 0.8-1.4 seconds
          enemy.entityState = 'moving';
        } else {
          // Good distance (or forced after too many reassessments), aim and shoot
          enemy.facing = dx > 0 ? 1 : -1; // Face toward player
          enemy.targetAngle = undefined;
          enemy.targetPower = undefined;
          enemy.turnState = 'aiming';
          enemy.entityState = 'idle';
        }
        break;

      case 'aiming':
        if (enemy.targetAngle === undefined) {
          // Calculate precise angle to target
          const dx = target.x - enemy.x;
          const dy = target.y - enemy.y;
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
            enemy.entityState = 'charging';
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
            enemy.entityState = 'charging';
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
              const { positions } = this.physicsService.simulateTrajectory(
                barrelEndX,
                barrelEndY,
                simAngleRad,
                pow,
                enemy.vehicle.bullet,
                this.physicsService.windSpeed,
                this.physicsService.windAngle,
              );
              for (const pos of positions) {
                const distToTarget = Math.hypot(pos.x - target.x, pos.y - target.y);
                if (distToTarget < 50 && (!bestHit || distToTarget < bestHit.dist)) {
                  bestHit = { angle: relAng, power: pow, dist: distToTarget };
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
          enemy.entityState = 'charging';
        }
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

    const { positions } = this.physicsService.simulateTrajectory(
      barrelEndX,
      barrelEndY,
      angleRad,
      power,
      bullet,
      this.physicsService.windSpeed,
      this.physicsService.windAngle,
    );

    this.projectileService.projectile = {
      x: barrelEndX,
      y: barrelEndY,
      trajectory: positions,
      trajectoryIndex: 0,
      owner: enemy,
      bullet: bullet,
      rootBulletName: bullet.name,
    };
    enemy.chargeStartTime = 0;
    enemy.entityState = 'shooting';
    enemy.shotReleaseStartMs = Date.now();
    this.sfxService.play({ category: enemy.vehicle.sfxFire ?? 'fire' });
  }

  private pickEnemyTarget(enemy: Enemy): Player | Enemy {
    const candidates: (Player | Enemy)[] = [
      ...(this.player.active ? [this.player] : []),
      ...this.enemies.filter((e) => e !== enemy && e.active),
    ];
    if (candidates.length === 0) return this.player;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  getCurrentTurnEntity(): TurnEntity | null {
    return this.turnService.getCurrentTurnEntity();
  }

  isPlayerTurn(): boolean {
    const current = this.getCurrentTurnEntity();
    return current?.type === 'player';
  }

  endTurn(actionCost: number = 100) {
    if (this.turnService._turnQueue.length === 0) return;

    // Normalize delays first
    this.turnService.startTurn();

    // Then add actionCost to the current entity's delay
    this.turnService._turnQueue[0].entity.delay += actionCost;

    // Resort queue by entity.delay
    this.turnService._turnQueue.sort((a, b) => a.entity.delay - b.entity.delay);

    if (Math.random() < CONST.WIND_CHANGE_CHANCE) {
      this.rollWind();
      this.sfxService.play({ category: 'wind_gust' });
    }

    // Reset turn time
    this.turnService.turnTime = 0;
    this.playerShotThisTurn = false;

    // Stop any walk loops from the previous turn
    this.sfxService.stopWalkLoop(this.player);
    for (const e of this.enemies) {
      this.sfxService.stopWalkLoop(e);
    }

    // Reset player-specific flags
    if (this.isPlayerTurn()) {
      this.isCharging = false;
      this.chargeStartTime = 0;
      this.keys = {};
    }
    if (this.player.entityState === 'charging' || this.player.entityState === 'shooting') {
      this.player.entityState = 'idle';
    }

    // Set next entity's turn state to turn_start
    const nextEntity = this.getCurrentTurnEntity();
    if (nextEntity) {
      const nextEntityObj = nextEntity.entity as any;
      nextEntityObj.turnState = 'turn_start';
    }

    // Clean up projectiles owned by previous entity
    const prevEntity = this.turnService._turnQueue[this.turnService._turnQueue.length - 1]; // Since resorted, last is previous
    if (prevEntity) {
      if (this.projectile && this.projectile.owner === prevEntity.entity) {
        // destroyTrajectoryProjectile handles damage internally
        this.projectileService.destroyTrajectoryProjectile(
          this.terrainService.terrain,
          this.player,
          this.enemies,
          this.physicsService,
          this.terrainService.depthTerrain,
        );
      }
    }

    this.panToEntity = nextEntity;
  }

  private rollWind(): void {
    const r = Math.random();
    this.physicsService.windSpeed =
      Math.random() < 0.02 ? 76 + Math.round(Math.random() * 24) : Math.round(Math.pow(r, 4) * 75);
    this.physicsService.windAngle = Math.random() * Math.PI * 2;
    this.physicsService.clearTrajectoryCache();
  }

  setWindSpeed(speed: number): void {
    this.physicsService.windSpeed = speed;
    this.physicsService.clearTrajectoryCache();
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
      if (this.player.vehicle.voicePack) {
        this.sfxService.playVo(this.player, this.player.vehicle.voicePack, 'lose');
      }
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

    // AFTERMATH: run physics + effects only, then exit
    if (this.currentState === GameState.AFTERMATH) {
      this.physicsService.updateEntityPhysics(this.player);
      this.updateEnemies();
      this.collisionService.checkPlayerTerrainCollision(
        this.player,
        this.terrainService.terrain,
        this.physicsService,
      );
      this.collisionService.checkEntitiesFall(this.player, this.enemies);
      this.projectileService.updateExplosions();
      this.damageService.updateDamageTexts();
      this.turnService.updateTurnQueue(deltaTime);
      this.handleAftermath();
      return;
    }

    this.handleInput(this.keys);

    this.turnService.turnTime = now - this.turnService.turnStartTime;

    // Update player physics
    this.physicsService.updateEntityPhysics(this.player);
    this.applyWindToEntity(this.player);

    // Update enemies
    this.updateEnemies();

    // Handle turns
    this.handleTurns();

    // Update projectile if exists
    if (this.projectileService.projectile) {
      this.projectileService.updateTrajectoryProjectile(
        this.terrainService.terrain,
        this.physicsService,
        this.player,
        this.enemies,
        this.terrainService.depthTerrain,
      );
    }

    // Update child projectiles (cluster fragments etc.)
    if (this.projectileService.childProjectiles.length > 0) {
      this.projectileService.updateChildProjectiles(
        this.terrainService.terrain,
        this.player,
        this.enemies,
        this.physicsService,
        this.terrainService.depthTerrain,
      );
    }

    // Check player collision with terrain
    this.collisionService.checkPlayerTerrainCollision(
      this.player,
      this.terrainService.terrain,
      this.physicsService,
    );

    // Check if entities fell off the screen
    this.collisionService.checkEntitiesFall(this.player, this.enemies);

    // Update explosions
    this.projectileService.updateExplosions();

    // Update damage texts
    this.damageService.updateDamageTexts();

    // Update turn queue (remove inactive enemies)
    this.turnService.updateTurnQueue(deltaTime);

    // Check for turn timeout
    if (
      this.currentState === GameState.PLAYING &&
      this.turnService.turnTime > this.turnService.TIMEOUT_MS
    ) {
      this.endTurn(150);
    }
  }

  handleInput(keys: { [key: string]: boolean }) {
    if (this.currentState === GameState.PLAYING) {
      const terrainH = this.collisionService.getTerrainHeightAt(
        this.player.x,
        this.terrainService.terrain,
      );
      const isOnTerrain =
        terrainH !== -1 &&
        this.player.body != null &&
        this.player.body.position.y + CONST.TANK_HALF_HEIGHT >= terrainH - 6;
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
          this.player.turnState === 'idle' &&
          this.player.movementFuel > 0 &&
          this.isPlayerTurn()
        ) {
          this.moveEntity(this.player, -1);
        }
        if (
          keys['ArrowRight'] &&
          this.player.body &&
          !this.isCharging &&
          !this.projectile &&
          this.player.turnState === 'idle' &&
          this.player.movementFuel > 0 &&
          this.isPlayerTurn()
        ) {
          this.moveEntity(this.player, 1);
        }

        if (!keys['ArrowLeft'] && !keys['ArrowRight']) {
          this.sfxService.stopWalkLoop(this.player);
        }

        if (keys['ArrowUp'] && !this.isCharging && !this.projectile) {
          this.player.targetAngle = Math.min(
            this.player.vehicle.maxAimAngle,
            (this.player.targetAngle ?? this.player.angle) + CONST.ANGLE_ADJUST_SPEED / 400,
          );
        }
        if (keys['ArrowDown'] && !this.isCharging && !this.projectile) {
          this.player.targetAngle = Math.max(
            this.player.vehicle.minAimAngle,
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
          this.player.chargeStartTime = Date.now();
          this.player.power = CONST.MIN_POWER;
          this.player.entityState = 'charging';
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

    const { positions } = this.physicsService.simulateTrajectory(
      barrelEndX,
      barrelEndY,
      angleRad,
      this.player.power,
      bullet,
      this.physicsService.windSpeed,
      this.physicsService.windAngle,
    );

    this.projectileService.projectile = {
      x: barrelEndX,
      y: barrelEndY,
      trajectory: positions,
      trajectoryIndex: 0,
      owner: this.player,
      bullet: bullet,
      rootBulletName: bullet.name,
    };

    this.lastFiredPowerRatio = this.player.power / this.player.maxPower;
    this.isCharging = false;
    this.player.chargeStartTime = 0;
    this.player.entityState = 'shooting';
    this.player.shotReleaseStartMs = Date.now();
    this.player.turnState = 'bullet_in_flight';
    this.playerShotThisTurn = true;
    this.sfxService.play({ category: this.player.vehicle.sfxFire ?? 'fire' });
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

  get terrainInteriorPlacements() {
    return this.terrainService.terrainInteriorPlacements;
  }

  get terrainBottomPlacements() {
    return this.terrainService.terrainBottomPlacements;
  }

  get terrainChunkPlacements() {
    return this.terrainService.terrainChunkPlacements;
  }

  get terrain() {
    return this.terrainService.terrain;
  }

  get depthTerrain() {
    return this.terrainService.depthTerrain;
  }

  get innerTerrainTileIndex() {
    return this.terrainService.innerTerrainTileIndex;
  }

  get hasAimGuide() {
    return this.projectileService.projectile !== null;
  }

  get windSpeed(): number {
    return this.physicsService.windSpeed;
  }
  get windAngle(): number {
    return this.physicsService.windAngle;
  }

  simulateTrajectory(
    barrelEndX: number,
    barrelEndY: number,
    angleRad: number,
    power: number,
    bullet: any,
  ) {
    return this.physicsService.simulateTrajectory(barrelEndX, barrelEndY, angleRad, power, bullet);
  }

  get turnStartTime() {
    return this.turnService.turnStartTime;
  }

  get turnQueue() {
    return this.turnService.turnQueue;
  }

  get equipped() {
    return this.equipmentService.equipped;
  }

  get equipmentSets() {
    return this.equipmentService.equipmentSets;
  }

  get selectedVehicleIndex(): number {
    return this.equipmentService.selectedVehicleIndex;
  }

  set selectedVehicleIndex(value: number) {
    this.equipmentService.selectedVehicleIndex = value;
  }

  saveLoadout(): void {
    this.equipmentService.saveLoadout();
  }

  pausePhysics() {
    this.physicsService.pausePhysics();
  }

  resumePhysics() {
    this.physicsService.resumePhysics();
  }

  // Getters for properties moved to services
  get projectile() {
    return this.projectileService.projectile;
  }

  get lastImpactPos() {
    return this.projectileService.lastImpactPos;
  }

  get explosions() {
    return this.projectileService.explosions;
  }

  get damageTexts() {
    return this.damageService.damageTexts;
  }

  get combatLog() {
    return this.damageService.combatLog;
  }

  get childProjectiles() {
    return this.projectileService.childProjectiles;
  }

  areAllEntitiesSettled(): boolean {
    return this.turnService.areAllEntitiesSettled([this.player, ...this.enemies]);
  }

  startTurn() {
    this.turnService.startTurn();
  }

  private handleAftermath() {
    const elapsed = Date.now() - this.aftermathStartMs;
    const effectsDone =
      this.projectileService.explosions.length === 0 && this.damageService.damageTexts.length === 0;
    if (effectsDone && elapsed >= this.MIN_AFTERMATH_MS) {
      this.aftermathImpactPos = null;
      this.aftermathCallouts = [];
      this.currentState = GameState.PLAYING;
      if (this.playerShotThisTurn && !this.damageService.anyDamageAppliedThisTurn) {
        this.damageService.addToLog({
          type: 'miss',
          attackerName: this.player.displayName ?? 'You',
          targetName: '',
          weaponName: '',
          totalDamage: 0,
          wasFatal: false,
        });
      }
      this.damageService.flushBatch();
      this.endTurn(100);
    }
  }

  destroy() {
    this.physicsService.pausePhysics();
  }
}
