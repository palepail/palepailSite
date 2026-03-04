// terrablast-game.service.ts
// Service handling core game logic for Terrablast

import { Injectable } from '@angular/core';
import { Player, GameState, Explosion, DamageText } from './terrablast.types';
import * as CONST from './terrablast.constants';

@Injectable({
  providedIn: 'root'
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
  projectile: any = null;
  explosions: Explosion[] = [];
  damageTexts: DamageText[] = [];
  currentState: GameState = GameState.MENU;

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
      health: CONST.PLAYER_START_HEALTH,
      movementFuel: CONST.PLAYER_START_MOVEMENT_FUEL,
      color: '#4ECDC4',
      active: true,
      facing: CONST.PLAYER_START_FACING,
      terrainAngle: CONST.PLAYER_START_TERRAIN_ANGLE,
    };
  }

  initGame() {
    this.generateTerrain();
    this.initPhysics();
    this.initPlayer();
    this.currentState = GameState.PLAYING;
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
    console.log('Terrain generated at x=100:', this.terrain[100]);
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

    // Add collision event for projectile vs player
    this.Events.on(this.engine, 'collisionStart', (event: any) => {
      const pairs = event.pairs;
      for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        if ((pair.bodyA === this.projectile && pair.bodyB === this.player.body) ||
            (pair.bodyB === this.projectile && pair.bodyA === this.player.body)) {
          this.destroyProjectileAt(this.projectile.position);
        }
      }
    });
  }

  private initPlayer() {
    this.player.x = CONST.PLAYER_START_X;
    this.player.y = CONST.CANVAS_HEIGHT - CONST.TERRAIN_BASE_Y_OFFSET - CONST.PLAYER_HOVER_HEIGHT;

    this.player.body = this.Bodies.rectangle(
      this.player.x,
      this.player.y,
      20,
      20,
      {
        friction: CONST.PLAYER_FRICTION,
        frictionAir: CONST.PLAYER_AIR_FRICTION,
        restitution: CONST.PLAYER_RESTITUTION,
        density: CONST.PLAYER_DENSITY
      }
    );
    this.World.add(this.world, this.player.body);
  }

  update() {
    this.handleInput(this.keys);

    // Update player position from physics body
    if (this.player.body) {
      this.player.x = this.player.body.position.x;
      this.player.y = this.player.body.position.y;
    }

    // Update charging
    if (this.isCharging) {
      const chargeTime = Date.now() - this.chargeStartTime;
      const chargeRatio = Math.min(chargeTime / CONST.MAX_CHARGE_TIME, 1);
      this.player.power = CONST.MIN_POWER + (CONST.MAX_POWER - CONST.MIN_POWER) * chargeRatio;
    }

    // Update projectile if exists
    if (this.projectile) {
      this.checkProjectileCollision();
    }

    // Check player collision with terrain
    this.checkPlayerTerrainCollision();

    // Deplete movement fuel if moving
    if (this.player.body && Math.abs(this.player.body.velocity.x) > 0.1) {
      this.player.movementFuel = Math.max(0, this.player.movementFuel - 0.5);
    }

    // Check if player fell off the screen
    this.checkPlayerFall();

    // Update explosions
    this.updateExplosions();

    // Update damage texts
    this.updateDamageTexts();

    // Check for game over
    if (this.player.health <= 0) {
      this.currentState = GameState.GAME_OVER;
    }
  }

  handleInput(keys: { [key: string]: boolean }) {
    if (this.currentState === GameState.PLAYING) {
      const isOnTerrain = this.getTerrainHeightAt(this.player.x) !== -1;

      if (isOnTerrain) {
        if (keys['ArrowLeft'] && this.player.body && this.player.movementFuel > 0) {
          const oldFacing = this.player.facing;
          this.player.facing = -1;
          const targetX = this.player.x - 2.0;
          const hasTerrain = this.getTerrainHeightAt(targetX) !== -1;
          const angle = this.getTerrainAngleAt(targetX);
          const isTurningAround = oldFacing !== this.player.facing;
          if (!hasTerrain || angle <= CONST.MAX_CLIMB_ANGLE || isTurningAround) {
            this.Body.setVelocity(this.player.body, { x: -CONST.PLAYER_MOVE_SPEED, y: this.player.body.velocity.y });
          }
        }
        if (keys['ArrowRight'] && this.player.body && this.player.movementFuel > 0) {
          const oldFacing = this.player.facing;
          this.player.facing = 1;
          const targetX = this.player.x + 2.0;
          const hasTerrain = this.getTerrainHeightAt(targetX) !== -1;
          const isTurningAround = oldFacing !== this.player.facing;
          if (!hasTerrain || this.getTerrainAngleAt(targetX) >= -CONST.MAX_CLIMB_ANGLE || isTurningAround) {
            this.Body.setVelocity(this.player.body, { x: CONST.PLAYER_MOVE_SPEED, y: this.player.body.velocity.y });
          }
        }

        if (keys['ArrowUp']) {
          this.player.angle = Math.min(CONST.MAX_AIM_ANGLE, this.player.angle + CONST.ANGLE_ADJUST_SPEED);
        }
        if (keys['ArrowDown']) {
          this.player.angle = Math.max(CONST.MIN_AIM_ANGLE, this.player.angle - CONST.ANGLE_ADJUST_SPEED);
        }

        if (keys[' '] && !this.projectile && !this.isCharging) {
          this.isCharging = true;
          this.chargeStartTime = Date.now();
          this.player.power = CONST.MIN_POWER;
        }
      }
    }
  }

  getBarrelAngle(): number {
    const baseAngleRad = (this.player.angle * Math.PI) / 180;
    const trueAngleRad = -this.player.terrainAngle + (this.player.facing === -1 ? Math.PI - baseAngleRad : baseAngleRad);
    return trueAngleRad;
  }

  shoot() {
    const angleRad = this.getBarrelAngle();
    const velocity = (this.player.power / 100) * CONST.MAX_PROJECTILE_VELOCITY;
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
    this.isCharging = false;
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

    if (px >= 0 && px < CONST.TERRAIN_WIDTH && terrainLocalY >= 0 && terrainLocalY < this.terrain[px]?.length) {
      if (this.terrain[px] && this.terrain[px][terrainLocalY] === 1) {
        this.createCrater(px, py, CONST.CRATER_RADIUS);
        this.destroyProjectileAt({ x: px, y: py });
        return;
      }
    }

    const checkOffsets = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [offsetX, offsetY] of checkOffsets) {
      const checkX = px + offsetX;
      const checkY = py + offsetY;
      const terrainCheckY = checkY - terrainY;

      if (checkX >= 0 && checkX < CONST.TERRAIN_WIDTH && terrainCheckY >= 0 && terrainCheckY < this.terrain[checkX]?.length) {
        if (this.terrain[checkX] && this.terrain[checkX][terrainCheckY] === 1) {
          this.createCrater(checkX, checkY, CONST.CRATER_RADIUS);
          this.destroyProjectileAt({ x: checkX, y: checkY });
          return;
        }
      }
    }

    if (px < 0 || px > CONST.TERRAIN_WIDTH || py < 0 || py > CONST.CANVAS_HEIGHT) {
      this.destroyProjectileAt(this.projectile.position);
    }
  }

  private createCrater(centerX: number, centerY: number, radius: number) {
    const terrainY = CONST.CANVAS_HEIGHT - CONST.TERRAIN_BASE_Y_OFFSET;

    for (let x = centerX - radius; x < centerX + radius; x++) {
      for (let y = centerY - radius; y < centerY + radius; y++) {
        const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
        if (distance < radius) {
          const terrainLocalY = y - terrainY;
          if (x >= 0 && x < CONST.TERRAIN_WIDTH && terrainLocalY >= 0 && terrainLocalY < this.terrain[x]?.length) {
            this.terrain[x][terrainLocalY] = 0;
          }
        }
      }
    }
  }

  private destroyProjectileAt(position: any) {
    if (this.projectile) {
      this.explosions.push({
        x: position.x,
        y: position.y,
        radius: CONST.EXPLOSION_INITIAL_RADIUS,
        maxRadius: CONST.EXPLOSION_MAX_RADIUS,
        life: CONST.EXPLOSION_LIFETIME_FRAMES,
      });

      const distance = Math.sqrt((position.x - this.player.x) ** 2 + (position.y - this.player.y) ** 2);
      const damage = CONST.EXPLOSION_DAMAGE_MAX * Math.max(0, 1 - distance / CONST.EXPLOSION_DAMAGE_RANGE);
      const actualDamage = damage * 0.5;
      this.player.health -= actualDamage;
      this.player.health = Math.max(0, this.player.health);

      if (actualDamage > 0) {
        this.damageTexts.push({
          x: position.x,
          y: position.y,
          damage: Math.round(actualDamage),
          life: CONST.DAMAGE_TEXT_LIFETIME,
        });
      }

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
      const targetY = terrainHeight - tankHalfHeight;

      this.Body.setPosition(this.player.body, { x: this.player.x, y: targetY });
      this.Body.setVelocity(this.player.body, { x: this.player.body.velocity.x, y: 0 });

      this.player.terrainAngle = terrainAngle;
    }
  }

  private checkPlayerFall() {
    if (this.player.y > CONST.CANVAS_HEIGHT + CONST.FALL_THRESHOLD_OFFSET) {
      this.respawnPlayer();
    }
  }

  private respawnPlayer() {
    this.player.health = CONST.PLAYER_START_HEALTH;
    this.player.movementFuel = CONST.PLAYER_START_MOVEMENT_FUEL;
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

  destroy() {
    if (this.runner) {
      this.Runner.stop(this.runner);
    }
  }
}