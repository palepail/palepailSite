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
} from './monkeys.types';
import * as CONST from './monkeys.constants';

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
  player: Player;
  enemies: Enemy[] = [];
  projectile: Projectile | null = null;
  explosions: Explosion[] = [];
  explodedProjectiles: ExplodedProjectile[] = [];
  damageTexts: DamageText[] = [];
  public panToEntity: any = null;
  currentState: GameState = GameState.MENU;

  // Turn-based system
  private _turnQueue: TurnEntity[] = [];
  currentTurnIndex: number = 0;
  turnTime: number = 0; // Current turn timer
  private _turnStartTime: number = 0;
  private lastUpdateTime = Date.now();
  private readonly TIMEOUT_MS = 45000;

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
  private gameOverPending: boolean = false;
  private gameOverTimer: number = 0;

  constructor() {
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

  initGame() {
    this.gameOverPending = false;
    this.gameOverTimer = 0;
    this.trajectoryCache.clear();
    this.generateTerrain();
    this.initPhysics();
    this.initPlayer();
    this.spawnEnemies();
    this.initTurnQueue();
    this.startTurn();
    this.currentState = GameState.SETUP;
  }

  private generateTerrain() {
    this.terrain = [];
    for (let x = 0; x < CONST.TERRAIN_WIDTH; x++) {
      this.terrain[x] = [];
      for (let y = 0; y < CONST.TERRAIN_STRIP_HEIGHT; y++) {
        this.terrain[x][y] = 0; // Air
      }
    }

    // Generate base terrain
    let currentHeight = CONST.TERRAIN_STRIP_HEIGHT / 2;
    for (let x = 0; x < CONST.TERRAIN_WIDTH; x++) {
      // Random walk for terrain height
      currentHeight += (Math.random() - 0.5) * 2;
      currentHeight = Math.max(20, Math.min(CONST.TERRAIN_STRIP_HEIGHT - 20, currentHeight));

      // Fill terrain from currentHeight to bottom
      for (let y = Math.floor(currentHeight); y < CONST.TERRAIN_STRIP_HEIGHT; y++) {
        this.terrain[x][y] = 1; // Terrain
      }
    }

    // Smooth terrain
    this.smoothTerrain();
  }

  private smoothTerrain() {
    for (let pass = 0; pass < 6; pass++) {
      for (let x = 1; x < CONST.TERRAIN_WIDTH - 1; x++) {
        let total = 0;
        let count = 0;
        for (let dx = -1; dx <= 1; dx++) {
          const sampleX = x + dx;
          if (sampleX >= 0 && sampleX < CONST.TERRAIN_WIDTH) {
            const height = this.getTerrainHeightAt(sampleX);
            if (height !== -1) {
              const localHeight = height - (CONST.CANVAS_HEIGHT - CONST.TERRAIN_BASE_Y_OFFSET);
              total += localHeight;
              count++;
            }
          }
        }
        if (count > 0) {
          const smoothedHeight = total / count;
          // Clear old terrain
          for (let y = 0; y < CONST.TERRAIN_STRIP_HEIGHT; y++) {
            this.terrain[x][y] = y >= smoothedHeight ? 1 : 0;
          }
        }
      }
    }
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

  private moveEntity(entity: Player | Enemy, direction: number) {
    if (entity.movementFuel! <= 0) return;

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
    } else {
      this.Body.setVelocity(entity.body, { x: 0, y: entity.body.velocity.y });
    }
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
        const oldAngle = entity.angle;
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

        if (distance > moveCloserThreshold && enemy.movementFuel! > 10) {
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
        } else if (distance < moveAwayThreshold && enemy.movementFuel! > 5) {
          // Too close, move away
          enemy.moveDirection = dx > 0 ? -1 : 1; // Away from player
          enemy.movementTimer = 800 + Math.random() * 600; // 0.8-1.4 seconds
          enemy.turnState = 'moving';
          console.log(`Enemy moving away, direction=${enemy.moveDirection}`);
        } else {
          // Good distance, aim and shoot
          enemy.facing = dx > 0 ? 1 : -1; // Face toward player
          enemy.targetAngle = undefined;
          enemy.targetPower = undefined;
          enemy.turnState = 'aiming';
          enemy.turnTimer = 0;
          console.log(`Enemy aiming, facing=${enemy.facing}`);
        }
        break;

      case 'moving':
        if (enemy.lastX === undefined) {
          enemy.lastX = enemy.x;
          enemy.lastY = enemy.y;
        }
        if (enemy.movementTimer! > 0) {
          this.moveEntity(enemy, enemy.moveDirection!);
          enemy.movementTimer! -= 16;
        } else {
          // Stop moving and assess again or aim
          this.Body.setVelocity(enemy.body, { x: 0, y: enemy.body.velocity.y });
          enemy.moveDirection = 0;
          enemy.movementTimer = 0;
          // After moving, reassess or go to aiming
          const newDx = this.player.x - enemy.x;
          const newDistance = Math.abs(newDx);
          if (newDistance > 500 || newDistance < 100) {
            enemy.turnState = 'assess'; // Reassess if still not ideal
          } else {
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
        if (!enemy.targetAngle) {
          // Calculate precise angle to player
          const dx = this.player.x - enemy.x;
          const dy = this.player.y - enemy.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance <= 50) {
            // Too close, skip turn
            this.endTurn(100);
            enemy.turnState = 'assess';
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
          const powerStep = 20; // power units
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
            for (let pow = 20; pow <= 100; pow += powerStep) {
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

          if (bestHit) {
            enemy.targetAngle = bestHit.angle;
            enemy.targetPower = bestHit.power;
            console.log(
              `Enemy aiming: found hit at angle=${bestHit.angle}, power=${bestHit.power}, dist=${bestHit.dist.toFixed(1)}`,
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
              Math.min(enemy.vehicle.maxAimAngle, relativeAngleDeg),
            );
            enemy.targetAngle = relativeAngleDeg;
            if (distance < 200) {
              enemy.targetPower = 30 + Math.random() * 20;
            } else if (distance < 400) {
              enemy.targetPower = 50 + Math.random() * 30;
            } else {
              enemy.targetPower = 70 + Math.random() * 30;
            }
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
      if (nextEntity.type === 'player') {
        (nextEntity.entity as Player).turnState = 'turn_start';
        (nextEntity.entity as Player).turnTimer = 0;
      } else {
        (nextEntity.entity as Enemy).turnState = 'turn_start';
        (nextEntity.entity as Enemy).turnTimer = 0;
      }
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
      if (this._turnQueue[0].type === 'player') {
        const player = this._turnQueue[0].entity as Player;
        if (player.turnState === 'post_bullet') {
          player.turnTimer -= deltaTime;
          if (player.turnTimer <= 0) {
            this.endTurn(100);
          }
        }
      } else if (this._turnQueue[0].type === 'enemy') {
        const enemy = this._turnQueue[0].entity as Enemy;
        if (enemy.turnState === 'post_bullet') {
          enemy.turnTimer -= deltaTime;
          if (enemy.turnTimer <= 0) {
            this.endTurn(100);
          }
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
    if (this.player.health <= 0 && !this.gameOverPending) {
      console.log(
        'Game over pending: player.health =',
        this.player.health,
        '/',
        this.player.vehicle.health,
        'starting 2s timer',
      );
      this.gameOverPending = true;
      this.gameOverTimer = 2.0;
    }

    if (this.gameOverPending) {
      this.gameOverTimer -= deltaTime;
      if (this.gameOverTimer <= 0) {
        console.log('Game over timer expired, setting to GAME_OVER');
        this.currentState = GameState.GAME_OVER;
        this.gameOverPending = false;
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
    const expired = this.explodedProjectiles.filter((ep) => Date.now() >= ep.removalTime);
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

        if (
          keys['ArrowUp'] &&
          !this.isCharging &&
          !this.projectile
        ) {
          const oldTarget = this.player.targetAngle ?? this.player.angle;
          this.player.targetAngle = Math.min(
            CONST.MAX_AIM_ANGLE,
            (this.player.targetAngle ?? this.player.angle) + CONST.ANGLE_ADJUST_SPEED / 400,
          );
        }
        if (
          keys['ArrowDown'] &&
          !this.isCharging &&
          !this.projectile
        ) {
          const oldTarget = this.player.targetAngle ?? this.player.angle;
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
            if (this.terrain[ix] && this.terrain[ix][iy] === 1) {
              this.terrain[ix][iy] = 0; // Remove terrain
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
