// terrablast-game.service.ts
// Service handling core game logic for Terrablast

import { Injectable } from '@angular/core';
import {
  Player,
  Enemy,
  GameState,
  Explosion,
  DamageText,
  TurnEntity,
  ExplodedProjectile,
} from './terrablast.types';
import * as CONST from './terrablast.constants';

@Injectable({
  providedIn: 'root',
})
export class TerrablastGameService {
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
  projectile: any = null;
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

  // Input
  keys: { [key: string]: boolean } = {};

  constructor() {
    this.player = this.createInitialPlayer();
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
    this.generateTerrain();
    this.initPhysics();
    this.initPlayer();
    this.spawnEnemies();
    this.initTurnQueue();
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

    // Add collision event for projectile vs player and enemies
    this.Events.on(this.engine, 'collisionStart', (event: any) => {
      const pairs = event.pairs;
      for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        // Check projectile vs player
        if (
          (pair.bodyA === this.projectile && pair.bodyB === this.player.body) ||
          (pair.bodyB === this.projectile && pair.bodyA === this.player.body)
        ) {
          this.destroyProjectileAt(this.projectile.position);
        }
        // Check projectile vs enemies
        for (const enemy of this.enemies) {
          if (
            enemy.active &&
            enemy.body &&
            ((pair.bodyA === this.projectile && pair.bodyB === enemy.body) ||
              (pair.bodyB === this.projectile && pair.bodyA === enemy.body))
          ) {
            this.destroyProjectileAt(this.projectile.position);
            break;
          }
        }
      }
    });
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
    this.player.terrainAngle = this.getTerrainAngleAt(this.player.x);

    this.player.body = this.Bodies.rectangle(this.player.x, this.player.y, 30, 30, {
      friction: CONST.PLAYER_FRICTION,
      frictionAir: CONST.PLAYER_AIR_FRICTION,
      restitution: CONST.PLAYER_RESTITUTION,
      density: CONST.PLAYER_DENSITY,
    });
    this.World.add(this.world, this.player.body);
  }

  private spawnEnemies() {
    this.enemies = [];
    const numEnemies = 3; // Spawn 3 enemies for now
    for (let i = 0; i < numEnemies; i++) {
      const x = Math.random() * (CONST.TERRAIN_WIDTH - 200) + 100;
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
        angle: 0,
        health: CONST.ENEMY_VEHICLE.health,
        color: '#FF6B6B',
        active: true,
        facing: Math.random() > 0.5 ? 1 : -1,
        terrainAngle: this.getTerrainAngleAt(x),
        vehicle: CONST.ENEMY_VEHICLE,
        turnState: 'turn_start',
        turnTimer: 0,
        targetPower: 0,
        power: 0,
        delay: 0,
        movementFuel: CONST.ENEMY_VEHICLE.fuel,
      };
      // Ensure not too close to player
      if (Math.abs(enemy.x - this.player.x) < 200) {
        enemy.x += enemy.x < this.player.x ? -200 : 200;
        enemy.x = Math.max(50, Math.min(CONST.TERRAIN_WIDTH - 50, enemy.x));
        enemy.y =
          this.getTerrainHeightAt(enemy.x) !== -1
            ? this.getTerrainHeightAt(enemy.x) - CONST.TANK_HALF_HEIGHT
            : y;
        enemy.terrainAngle = this.getTerrainAngleAt(enemy.x);
      }
      enemy.body = this.Bodies.rectangle(enemy.x, enemy.y, 30, 30, {
        friction: CONST.PLAYER_FRICTION,
        frictionAir: CONST.PLAYER_AIR_FRICTION,
        restitution: CONST.PLAYER_RESTITUTION,
        density: CONST.PLAYER_DENSITY,
      });
      this.World.add(this.world, enemy.body);
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
        enemy.x = enemy.body.position.x;
        enemy.y = enemy.body.position.y;
        // Update terrain angle
        enemy.terrainAngle = this.getTerrainAngleAt(enemy.x);
        // Smoothly interpolate enemy barrel angle toward target
        if (enemy.targetAngle !== undefined) {
          const diff = enemy.targetAngle - enemy.angle;
          enemy.angle += diff * 0.1; // 10% interpolation per frame
        }
      }
    }

    // Handle enemy AI turns
    this.handleEnemyTurns();

    this.checkEnemiesTerrainCollision();
  }

  private handleEnemyTurns() {
    const currentTurn = this.getCurrentTurnEntity();
    if (!currentTurn || currentTurn.type !== 'enemy') return;

    const enemy = currentTurn.entity as Enemy;
    if (!enemy.active) return;

    // Simple enemy AI: aim at player and shoot
    this.performEnemyAction(enemy);
  }

  private handlePlayerTurns() {
    const currentTurn = this.getCurrentTurnEntity();
    if (!currentTurn || currentTurn.type !== 'player') return;

    const player = currentTurn.entity as Player;
    if (!player.active) return;

    // Handle player turn states
    this.performPlayerAction(player);
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
        // Reset fuel at turn start
        player.movementFuel = player.vehicle.fuel;
        // Wait for turn start (camera panning, etc.)
        player.turnTimer += 16; // Assuming 60fps, ~16ms per frame
        if (player.turnTimer >= 500) {
          // Wait 0.5 seconds for turn start
          player.turnState = 'idle';
          player.turnTimer = 0;
        }
        break;

      case 'idle':
        // Player is ready for input - no action needed here
        break;

      case 'aiming':
        // Player is aiming - handled in input
        break;

      case 'charging':
        // Player is charging - handled in update
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
        // Wait for turn start (camera panning, etc.)
        enemy.turnTimer += 16; // Assuming 60fps, ~16ms per frame
        if (enemy.turnTimer >= 500) {
          // Wait 0.5 seconds for turn start
          enemy.turnState = 'assess';
          enemy.turnTimer = 0;
        }
        break;

      case 'assess':
        // Assess situation and decide action
        const dx = this.player.x - enemy.x;
        const dy = this.player.y - enemy.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Decide based on distance and fuel
        if (distance > 400 && enemy.movementFuel! > 50) {
          // Too far, move closer
          enemy.moveDirection = dx > 0 ? 1 : -1; // Move toward player
          enemy.movementTimer = 1000 + Math.random() * 1000; // 1-2 seconds
          enemy.turnState = 'moving';
        } else if (distance < 150 && enemy.movementFuel! > 30) {
          // Too close, move away
          enemy.moveDirection = dx > 0 ? -1 : 1; // Move away from player
          enemy.movementTimer = 800 + Math.random() * 600; // 0.8-1.4 seconds
          enemy.turnState = 'moving';
        } else {
          // Good distance, aim and shoot
          enemy.facing = dx > 0 ? 1 : -1; // Face toward player
          enemy.turnState = 'aiming';
          enemy.turnTimer = 0;
        }
        break;

      case 'moving':
        if (enemy.movementTimer! > 0 && enemy.movementFuel! > 0) {
          // Apply movement
          const moveSpeed = CONST.PLAYER_MOVE_SPEED;
          const vx = enemy.moveDirection! * moveSpeed;
          this.Body.setVelocity(enemy.body, { x: vx, y: enemy.body.velocity.y });
          enemy.movementTimer! -= 16;
          enemy.movementFuel! -= Math.abs(vx) * 0.01; // Deplete fuel
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

          // Calculate relative angle based on facing
          let relativeAngleDeg = enemy.facing === 1 ? angleDeg : 180 - angleDeg;

          // Clamp to enemy aiming range
          relativeAngleDeg = Math.max(
            enemy.vehicle.minAimAngle,
            Math.min(enemy.vehicle.maxAimAngle, relativeAngleDeg),
          );

          enemy.targetAngle = relativeAngleDeg;
          enemy.angle = enemy.angle || 0; // start from current angle or 0

          // Set target power based on distance
          if (distance < 200) {
            enemy.targetPower = 30 + Math.random() * 20; // Low power for close shots
          } else if (distance < 400) {
            enemy.targetPower = 50 + Math.random() * 30; // Medium power
          } else {
            enemy.targetPower = 70 + Math.random() * 30; // High power for long shots
          }
        }

        enemy.turnTimer += 16;
        // Angle interpolation is now handled in updateEnemies

        if (enemy.turnTimer >= 2500) { // Extended to 2.5s for better aiming
          enemy.angle = enemy.targetAngle;
          enemy.turnState = 'charging';
          enemy.turnTimer = 0;
        }
        break;

      case 'charging':
        // Ramp up power over time for visual feedback
        enemy.turnTimer += 16; // Assuming 60fps, ~16ms per frame
        const chargeRatio = Math.min(enemy.turnTimer / 1500, 1); // Extended to 1.5s
        enemy.power = chargeRatio * enemy.targetPower;
        if (enemy.turnTimer >= 1500) {
          this.enemyShoot(enemy, enemy.targetPower);
          enemy.turnState = 'bullet_in_flight';
        }
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
    const angleRad = -enemy.terrainAngle + (enemy.facing === -1 ? Math.PI - baseAngleRad : baseAngleRad);
    const bullet = enemy.vehicle.bullet;
    const velocity = (power / 100) * bullet.speed;
    const vx = Math.cos(angleRad) * velocity;
    const vy = -Math.sin(angleRad) * velocity;
    const barrelLength = CONST.BARREL_LENGTH;
    const barrelEndX = enemy.x + Math.cos(angleRad) * barrelLength;
    const barrelEndY = enemy.y - Math.sin(angleRad) * barrelLength;

    this.projectile = this.Bodies.circle(barrelEndX, barrelEndY, CONST.PROJECTILE_RADIUS, {
      friction: CONST.PROJECTILE_FRICTION,
      restitution: CONST.PROJECTILE_RESTITUTION,
    });
    this.Body.setVelocity(this.projectile, { x: vx, y: vy });
    this.World.add(this.world, this.projectile);
    this.projectile.owner = enemy;
    this.projectile.bullet = bullet;
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
        this.destroyProjectileAt(this.projectile.position);
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

    this.handleInput(this.keys);

    // Update player position from physics body
    if (this.player.body) {
      this.player.x = this.player.body.position.x;
      this.player.y = this.player.body.position.y;
    }

    // Update enemies
    this.updateEnemies();

    // Handle player turns
    this.handlePlayerTurns();

    // Update charging (only if it's player's turn)
    if (this.isPlayerTurn() && this.isCharging) {
      const chargeTime = Date.now() - this.chargeStartTime;
      const chargeRatio = Math.min(chargeTime / CONST.MAX_CHARGE_TIME, 1);
      this.player.power = CONST.MIN_POWER + (this.player.maxPower - CONST.MIN_POWER) * chargeRatio;
    }

    // Update projectile if exists
    if (this.projectile) {
      this.checkProjectileCollision();
    }

    // Check player collision with terrain
    this.checkPlayerTerrainCollision();

    // Deplete movement fuel if moving (only on player's turn)
    if (this.isPlayerTurn() && this.player.body && Math.abs(this.player.body.velocity.x) > 0.1) {
      this.player.movementFuel = Math.max(0, this.player.movementFuel - 0.5);
    }

    // Check if player fell off the screen
    this.checkPlayerFall();

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

    // Check for game over
    if (this.player.health <= 0) {
      this.currentState = GameState.GAME_OVER;
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
            this.Body.setVelocity(this.player.body, {
              x: -CONST.PLAYER_MOVE_SPEED,
              y: this.player.body.velocity.y,
            });
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
            this.Body.setVelocity(this.player.body, {
              x: CONST.PLAYER_MOVE_SPEED,
              y: this.player.body.velocity.y,
            });
          }
        }

        if (
          keys['ArrowUp'] &&
          !this.isCharging &&
          !this.projectile &&
          this.player.turnState === 'idle'
        ) {
          this.player.angle = Math.min(
            CONST.MAX_AIM_ANGLE,
            this.player.angle + CONST.ANGLE_ADJUST_SPEED / 400,
          );
        }
        if (
          keys['ArrowDown'] &&
          !this.isCharging &&
          !this.projectile &&
          this.player.turnState === 'idle'
        ) {
          this.player.angle = Math.max(
            CONST.MIN_AIM_ANGLE,
            this.player.angle - CONST.ANGLE_ADJUST_SPEED / 400,
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
    const velocity = (this.player.power / 100) * bullet.speed;
    const vx = Math.cos(angleRad) * velocity;
    const vy = -Math.sin(angleRad) * velocity;
    const barrelLength = CONST.BARREL_LENGTH;
    const barrelEndX = this.player.x + Math.cos(angleRad) * barrelLength;
    const barrelEndY = this.player.y - Math.sin(angleRad) * barrelLength;
    this.projectile = this.Bodies.circle(barrelEndX, barrelEndY, CONST.PROJECTILE_RADIUS, {
      friction: CONST.PROJECTILE_FRICTION,
      restitution: CONST.PROJECTILE_RESTITUTION,
    });
    this.Body.setVelocity(this.projectile, { x: vx, y: vy });
    this.World.add(this.world, this.projectile);
    this.projectile.owner = this.player;
    this.projectile.bullet = bullet;
    this.isCharging = false;
    this.player.turnState = 'bullet_in_flight';
  }

  private startCharging() {
    this.isCharging = true;
    this.chargeStartTime = Date.now();
  }

  private checkProjectileCollision() {
    const px = Math.floor(this.projectile.position.x);
    const py = Math.floor(this.projectile.position.y);
    const terrainY = CONST.CANVAS_HEIGHT - CONST.TERRAIN_BASE_Y_OFFSET;
    const terrainLocalY = py - terrainY;

    if (
      px >= 0 &&
      px < CONST.TERRAIN_WIDTH &&
      terrainLocalY >= 0 &&
      terrainLocalY < this.terrain[px]?.length
    ) {
      if (this.terrain[px] && this.terrain[px][terrainLocalY] === 1) {
        this.createCrater(px, py, CONST.CRATER_RADIUS, this.projectile.bullet);
        this.destroyProjectileAt({ x: px, y: py });
        return;
      }
    }

    const checkOffsets = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];
    for (const [offsetX, offsetY] of checkOffsets) {
      const checkX = px + offsetX;
      const checkY = py + offsetY;
      const terrainCheckY = checkY - terrainY;

      if (
        checkX >= 0 &&
        checkX < CONST.TERRAIN_WIDTH &&
        terrainCheckY >= 0 &&
        terrainCheckY < this.terrain[checkX]?.length
      ) {
        if (this.terrain[checkX] && this.terrain[checkX][terrainCheckY] === 1) {
          this.createCrater(checkX, checkY, CONST.CRATER_RADIUS, this.projectile.bullet);
          this.destroyProjectileAt({ x: checkX, y: checkY });
          return;
        }
      }
    }

    // Check collision with enemies
    for (const enemy of this.enemies) {
      if (enemy.active) {
        const dist = Math.hypot(px - enemy.x, py - enemy.y);
        if (dist < 40) {
          // Threshold for collision
          this.destroyProjectileAt({ x: px, y: py });
          return;
        }
      }
    }

    if (px < 0 || px > CONST.TERRAIN_WIDTH || py > CONST.TERRAIN_HEIGHT) {
      this.destroyProjectileAt(this.projectile.position);
    }
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

  private destroyProjectileAt(position: any) {
    if (!isFinite(position.x) || !isFinite(position.y)) return;

    if (this.projectile) {
      this.explosions.push({
        x: position.x,
        y: position.y,
        radius: CONST.EXPLOSION_INITIAL_RADIUS,
        maxRadius: CONST.EXPLOSION_MAX_RADIUS,
        life: CONST.EXPLOSION_LIFETIME_FRAMES,
        shape: this.projectile.bullet.explosionShape,
      });

      // Apply universal explosion damage
      this.calculateExplosionDamage(position.x, position.y, this.projectile);

      // Create crater
      this.createCrater(position.x, position.y, CONST.CRATER_RADIUS, this.projectile.bullet);

      this.explodedProjectiles.push({
        position: { x: position.x, y: position.y },
        bullet: this.projectile.bullet,
        removalTime: Date.now() + 2000,
        owner: this.projectile.owner,
      });

      this.World.remove(this.world, this.projectile);
      this.projectile = null;
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

  private checkPlayerFall() {
    if (this.player.y > CONST.CANVAS_HEIGHT + CONST.FALL_THRESHOLD_OFFSET) {
      this.respawnPlayer();
    }
  }

  private respawnPlayer() {
    this.player.health = this.player.vehicle.health;
    this.player.movementFuel = this.player.vehicle.fuel;
    this.player.power = CONST.PLAYER_START_POWER;
    this.player.maxPower = this.player.vehicle.power;
    this.player.x = CONST.PLAYER_START_X;
    this.player.y = CONST.CANVAS_HEIGHT - CONST.TERRAIN_BASE_Y_OFFSET - CONST.PLAYER_HOVER_HEIGHT;
    this.player.angle = CONST.PLAYER_START_ANGLE;
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

  get turnQueue(): TurnEntity[] {
    return this._turnQueue;
  }

  destroy() {
    if (this.runner) {
      this.Runner.stop(this.runner);
    }
  }
}
