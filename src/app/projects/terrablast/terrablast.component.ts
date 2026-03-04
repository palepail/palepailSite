import {
  Component,
  OnInit,
  OnDestroy,
  ElementRef,
  ViewChild,
  HostListener,
  ChangeDetectorRef,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LeaderboardService } from '../../services/leaderboard.service';

// Matter.js imports
declare var Matter: any;

// Local imports
import { Player, GameState, GameSettings, Explosion, DamageText } from './terrablast.types';
import * as CONST from './terrablast.constants';

@Component({
  selector: 'app-terrablast',
  imports: [RouterLink, CommonModule, FormsModule],
  templateUrl: './terrablast.component.html',
  styleUrl: './terrablast.component.css',
})
export class TerrablastComponent implements OnInit, OnDestroy {
  @ViewChild('gameCanvas', { static: true }) canvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('mobileInput') mobileInput!: ElementRef<HTMLInputElement>;
  private ctx!: CanvasRenderingContext2D;

  // Matter.js physics
  private engine: any;
  private world: any;
  private runner: any;
  private matterRender: any;

  // Matter.js functions (loaded dynamically)
  private Engine: any;
  private Render: any;
  private Runner: any;
  private Bodies: any;
  private World: any;
  private Events: any;
  private Body: any;
  private Composite: any;

  // Game state
  currentState: GameState = GameState.MENU;
  settings: GameSettings = {
    bgmVolume: 0.25,
    sfxVolume: 0.35,
    difficulty: 'normal',
    muted: false,
  };

  // Game constants (imported)
  private readonly CANVAS_WIDTH = CONST.CANVAS_WIDTH;
  private readonly CANVAS_HEIGHT = CONST.CANVAS_HEIGHT;
  private readonly CANVAS_PADDING = CONST.CANVAS_PADDING;
  private readonly SKY_COLOR = CONST.SKY_COLOR;
  private canvasScale = 1;

  // Terrain
  private terrain: number[][] = [];
  private readonly TERRAIN_WIDTH = CONST.TERRAIN_WIDTH;
  private readonly TERRAIN_HEIGHT = CONST.TERRAIN_HEIGHT;
  private readonly TERRAIN_STRIP_HEIGHT = CONST.TERRAIN_STRIP_HEIGHT;
  private readonly TERRAIN_SMOOTHING_WEIGHT = CONST.TERRAIN_SMOOTHING_WEIGHT;
  private readonly TERRAIN_SMOOTHING_DIVISOR = CONST.TERRAIN_SMOOTHING_DIVISOR;
  private readonly GRAVITY_STRENGTH = CONST.GRAVITY_STRENGTH;
  private readonly TERRAIN_BASE_Y_OFFSET = CONST.TERRAIN_BASE_Y_OFFSET;
  private readonly PLAYER_HOVER_HEIGHT = CONST.PLAYER_HOVER_HEIGHT;
  private readonly TERRAIN_SLOPE_SAMPLE_DISTANCE = CONST.TERRAIN_SLOPE_SAMPLE_DISTANCE;
  private readonly CRATER_RADIUS = CONST.CRATER_RADIUS;
  private readonly TERRAIN_SNAP_TOLERANCE = CONST.TERRAIN_SNAP_TOLERANCE;
  private readonly FALL_THRESHOLD_OFFSET = CONST.FALL_THRESHOLD_OFFSET;
  private readonly TERRAIN_COLOR = CONST.TERRAIN_COLOR;
  private readonly TERRAIN_DETAIL_COLOR = CONST.TERRAIN_DETAIL_COLOR;
  private readonly TERRAIN_DETAIL_COUNT = CONST.TERRAIN_DETAIL_COUNT;
  private readonly TERRAIN_DETAIL_SIZE_MIN = CONST.TERRAIN_DETAIL_SIZE_MIN;
  private readonly TERRAIN_DETAIL_SIZE_MAX = CONST.TERRAIN_DETAIL_SIZE_MAX;
  private readonly MAX_CLIMB_ANGLE = CONST.MAX_CLIMB_ANGLE; // 50 degrees

  // Player
  private readonly PLAYER_START_X = CONST.PLAYER_START_X;
  private readonly PLAYER_START_ANGLE = CONST.PLAYER_START_ANGLE;
  private readonly PLAYER_START_POWER = CONST.PLAYER_START_POWER;
  private readonly PLAYER_START_HEALTH = CONST.PLAYER_START_HEALTH;
  private readonly PLAYER_START_FACING = CONST.PLAYER_START_FACING;
  private readonly PLAYER_START_TERRAIN_ANGLE = CONST.PLAYER_START_TERRAIN_ANGLE;
  private readonly PLAYER_FRICTION = CONST.PLAYER_FRICTION;
  private readonly PLAYER_AIR_FRICTION = CONST.PLAYER_AIR_FRICTION;
  private readonly PLAYER_RESTITUTION = CONST.PLAYER_RESTITUTION;
  private readonly PLAYER_DENSITY = CONST.PLAYER_DENSITY;
  private readonly PLAYER_MOVE_SPEED = CONST.PLAYER_MOVE_SPEED;
  private readonly ANGLE_ADJUST_SPEED = CONST.ANGLE_ADJUST_SPEED;
  private readonly MIN_AIM_ANGLE = CONST.MIN_AIM_ANGLE;
  private readonly MAX_AIM_ANGLE = CONST.MAX_AIM_ANGLE;
  private readonly TANK_HALF_HEIGHT = CONST.TANK_HALF_HEIGHT;
  player: Player = {
    body: null,
    x: this.PLAYER_START_X,
    y: 0,
    angle: this.PLAYER_START_ANGLE,
    power: this.PLAYER_START_POWER,
    health: this.PLAYER_START_HEALTH,
    color: '#4ECDC4',
    active: true,
    facing: this.PLAYER_START_FACING, // Start facing right
    terrainAngle: this.PLAYER_START_TERRAIN_ANGLE, // Start level
  };

  // Charging system
  private isCharging = false;
  private chargeStartTime = 0;
  private readonly MAX_CHARGE_TIME = CONST.MAX_CHARGE_TIME; // 1 second for full charge (faster)
  private readonly MIN_POWER = CONST.MIN_POWER;
  private readonly MAX_POWER = CONST.MAX_POWER;
  private readonly MAX_PROJECTILE_VELOCITY = CONST.MAX_PROJECTILE_VELOCITY;
  private readonly BARREL_LENGTH = CONST.BARREL_LENGTH;
  private readonly PROJECTILE_RADIUS = CONST.PROJECTILE_RADIUS;
  private readonly PROJECTILE_FRICTION = CONST.PROJECTILE_FRICTION;
  private readonly PROJECTILE_RESTITUTION = CONST.PROJECTILE_RESTITUTION;

  // Game physics
  private projectile: any = null;
  private readonly EXPLOSION_INITIAL_RADIUS = CONST.EXPLOSION_INITIAL_RADIUS;
  private readonly EXPLOSION_MAX_RADIUS = CONST.EXPLOSION_MAX_RADIUS;
  private readonly EXPLOSION_LIFETIME_FRAMES = CONST.EXPLOSION_LIFETIME_FRAMES;
  private readonly EXPLOSION_EXPANSION_RATE = CONST.EXPLOSION_EXPANSION_RATE;
  private readonly EXPLOSION_CENTER_COLOR = CONST.EXPLOSION_CENTER_COLOR;
  private readonly EXPLOSION_MIDDLE_COLOR = CONST.EXPLOSION_MIDDLE_COLOR;
  private readonly EXPLOSION_EDGE_COLOR = CONST.EXPLOSION_EDGE_COLOR;
  private readonly EXPLOSION_OUTLINE_COLOR = CONST.EXPLOSION_OUTLINE_COLOR;
  private readonly EXPLOSION_OUTLINE_WIDTH = CONST.EXPLOSION_OUTLINE_WIDTH;
  private readonly EXPLOSION_DAMAGE_MAX = CONST.EXPLOSION_DAMAGE_MAX;
  private readonly EXPLOSION_DAMAGE_RANGE = CONST.EXPLOSION_DAMAGE_RANGE;
  private readonly DAMAGE_TEXT_LIFETIME = CONST.DAMAGE_TEXT_LIFETIME; // frames
  private readonly DAMAGE_TEXT_RISE_SPEED = CONST.DAMAGE_TEXT_RISE_SPEED;
  private readonly DAMAGE_TEXT_FONT = CONST.DAMAGE_TEXT_FONT;
  private readonly DAMAGE_TEXT_COLOR = CONST.DAMAGE_TEXT_COLOR;
  private explosions: Explosion[] = [];
  private damageTexts: DamageText[] = [];

  // Input handling
  private keys: { [key: string]: boolean } = {};
  private mouseX = 0;
  private mouseY = 0;

  // UI and Rendering Constants
  private readonly CHARGE_BAR_WIDTH = CONST.CHARGE_BAR_WIDTH;
  private readonly CHARGE_BAR_HEIGHT = CONST.CHARGE_BAR_HEIGHT;
  private readonly CHARGE_BAR_OFFSET_X = CONST.CHARGE_BAR_OFFSET_X;
  private readonly CHARGE_BAR_BACKGROUND_COLOR = CONST.CHARGE_BAR_BACKGROUND_COLOR;
  private readonly CHARGE_BAR_BORDER_COLOR = CONST.CHARGE_BAR_BORDER_COLOR;
  private readonly CHARGE_BAR_BORDER_WIDTH = CONST.CHARGE_BAR_BORDER_WIDTH;
  private readonly CHARGE_BAR_FONT = CONST.CHARGE_BAR_FONT;
  private readonly CHARGE_BAR_TEXT_OFFSET_Y = CONST.CHARGE_BAR_TEXT_OFFSET_Y;
  private readonly TANK_BODY_RADIUS = CONST.TANK_BODY_RADIUS;
  private readonly CANNON_ARC_RADIUS = CONST.CANNON_ARC_RADIUS;
  private readonly CANNON_ARC_COLOR = CONST.CANNON_ARC_COLOR;
  private readonly AIM_GUIDE_COLOR = CONST.AIM_GUIDE_COLOR;
  private readonly AIM_LINE_COLOR = CONST.AIM_LINE_COLOR;
  private readonly AIM_LINE_WIDTH = CONST.AIM_LINE_WIDTH;
  private readonly AIM_GUIDE_ANGLES = CONST.AIM_GUIDE_ANGLES;
  private readonly AIM_LINE_LENGTH = CONST.AIM_LINE_LENGTH;
  private readonly TANK_SHADOW_COLOR = CONST.TANK_SHADOW_COLOR;
  private readonly TANK_SHADOW_HEIGHT_RATIO = CONST.TANK_SHADOW_HEIGHT_RATIO;
  private readonly AIMING_LINE_COLOR = CONST.AIMING_LINE_COLOR;
  private readonly AIMING_LINE_WIDTH = CONST.AIMING_LINE_WIDTH;
  private readonly AIMING_LINE_DASH = CONST.AIMING_LINE_DASH;
  private readonly TANK_BODY_STROKE_COLOR = CONST.TANK_BODY_STROKE_COLOR;
  private readonly TANK_BODY_STROKE_WIDTH = CONST.TANK_BODY_STROKE_WIDTH;
  private readonly TANK_TRACK_OFFSET = CONST.TANK_TRACK_OFFSET;
  private readonly TANK_TRACK_HEIGHT = CONST.TANK_TRACK_HEIGHT;
  private readonly TANK_TRACK_DETAIL_WIDTH = CONST.TANK_TRACK_DETAIL_WIDTH;
  private readonly TANK_TRACK_DETAIL_HEIGHT = CONST.TANK_TRACK_DETAIL_HEIGHT;
  private readonly BARREL_WIDTH = CONST.BARREL_WIDTH;
  private readonly BARREL_COLOR = CONST.BARREL_COLOR;
  private readonly BARREL_STROKE_COLOR = CONST.BARREL_STROKE_COLOR;
  private readonly BARREL_STROKE_WIDTH = CONST.BARREL_STROKE_WIDTH;
  private readonly BARREL_TIP_COLOR = CONST.BARREL_TIP_COLOR;
  private readonly BARREL_TIP_LENGTH = CONST.BARREL_TIP_LENGTH;
  private readonly BARREL_TIP_EXTRA_HEIGHT = CONST.BARREL_TIP_EXTRA_HEIGHT;
  private readonly PROJECTILE_DRAW_RADIUS = CONST.PROJECTILE_DRAW_RADIUS;
  private readonly PROJECTILE_COLOR = CONST.PROJECTILE_COLOR;
  private readonly UI_TEXT_COLOR = CONST.UI_TEXT_COLOR;
  private readonly UI_FONT = CONST.UI_FONT;
  private readonly UI_TEXT_X = CONST.UI_TEXT_X;
  private readonly UI_ANGLE_Y = CONST.UI_ANGLE_Y;
  private readonly UI_POWER_Y = CONST.UI_POWER_Y;
  private readonly UI_HEALTH_Y = CONST.UI_HEALTH_Y;
  private readonly UI_TERRAIN_ANGLE_Y = CONST.UI_TERRAIN_ANGLE_Y;
  private readonly UI_ANGLE_DECIMALS = CONST.UI_ANGLE_DECIMALS;

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.loadMatterJS().then(() => {
      this.initGame();
    });
  }

  ngOnDestroy() {
    if (this.runner) {
      this.Runner.stop(this.runner);
    }
    if (this.matterRender) {
      this.Render.stop(this.matterRender);
    }
  }

  private async loadMatterJS(): Promise<void> {
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js';
      script.onload = () => {
        this.Engine = (window as any).Matter.Engine;
        this.Render = (window as any).Matter.Render;
        this.Runner = (window as any).Matter.Runner;
        this.Bodies = (window as any).Matter.Bodies;
        this.World = (window as any).Matter.World;
        this.Events = (window as any).Matter.Events;
        this.Body = (window as any).Matter.Body;
        this.Composite = (window as any).Matter.Composite;
        resolve();
      };
      document.head.appendChild(script);
    });
  }

  private initGame() {
    this.initCanvas();
    this.generateTerrain();
    this.initPhysics();
    this.initPlayer();
    this.currentState = GameState.PLAYING;
    this.gameLoop();
  }

  private initCanvas() {
    const canvas = this.canvas.nativeElement;
    this.ctx = canvas.getContext('2d')!;

    // Set canvas size
    canvas.width = this.CANVAS_WIDTH;
    canvas.height = this.CANVAS_HEIGHT;

    // Scale for different screen sizes
    this.updateCanvasScale();
  }

  private updateCanvasScale() {
    const container = this.canvas.nativeElement.parentElement;
    if (container) {
      const maxWidth = Math.min(window.innerWidth - this.CANVAS_PADDING, this.CANVAS_WIDTH);
      this.canvasScale = maxWidth / this.CANVAS_WIDTH;
      this.canvas.nativeElement.style.width = `${maxWidth}px`;
      this.canvas.nativeElement.style.height = `${this.CANVAS_HEIGHT * this.canvasScale}px`;
    }
  }

  private generateTerrain() {
    // Create a simple 50-pixel tall terrain strip across the full width, raised by 50 pixels
    this.terrain = [];
    const terrainHeight = this.TERRAIN_STRIP_HEIGHT; // Terrain is 50 pixels tall

    // Create terrain array - solid terrain for the full height
    for (let x = 0; x < this.TERRAIN_WIDTH; x++) {
      this.terrain[x] = [];
      for (let y = 0; y < terrainHeight; y++) {
        // Terrain exists for the full height
        this.terrain[x][y] = 1;
      }
    }
  }

  private smoothHeights(heights: number[], iterations: number): number[] {
    let smoothed = [...heights];

    for (let iter = 0; iter < iterations; iter++) {
      const newHeights = [...smoothed];

      for (let i = 1; i < heights.length - 1; i++) {
        // Average with neighboring points for smoothing
        newHeights[i] =
          (smoothed[i - 1] + smoothed[i] * this.TERRAIN_SMOOTHING_WEIGHT + smoothed[i + 1]) /
          this.TERRAIN_SMOOTHING_DIVISOR;
      }

      smoothed = newHeights;
    }

    return smoothed;
  }

  private initPhysics() {
    // Initialize Matter.js
    this.engine = this.Engine.create();
    this.world = this.engine.world;
    this.engine.world.gravity.y = this.GRAVITY_STRENGTH;

    // Note: Using custom terrain collision instead of physics bodies for destructible terrain

    // Start physics
    this.runner = this.Runner.create();
    this.Runner.run(this.runner, this.engine);

    // Add collision event for projectile vs player
    this.Events.on(this.engine, 'collisionStart', (event: any) => {
      const pairs = event.pairs;
      for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        if ((pair.bodyA === this.projectile && pair.bodyB === this.player.body) ||
            (pair.bodyB === this.projectile && pair.bodyA === this.player.body)) {
          // Projectile hit player - destroy projectile and apply damage
          this.destroyProjectileAt(this.projectile.position);
        }
      }
    });
  }

  private createTerrainBodies() {
    // Removed - using custom collision detection for destructible terrain
  }

  private initPlayer() {
    // Find a good spot for the player on the terrain
    this.player.x = this.PLAYER_START_X;
    // Position so the tank sits on the terrain (100 pixels from bottom, raised 50 pixels)
    this.player.y = this.CANVAS_HEIGHT - this.TERRAIN_BASE_Y_OFFSET - this.PLAYER_HOVER_HEIGHT; // 10 units above terrain surface

    // Create player body (rectangle physics, but visual is semicircle)
    this.player.body = this.Bodies.rectangle(this.player.x, this.player.y, 20, 20, {
      friction: this.PLAYER_FRICTION, // Very high friction for tight controls, minimal sliding
      frictionAir: this.PLAYER_AIR_FRICTION, // Higher air resistance to stop quickly
      restitution: this.PLAYER_RESTITUTION, // Very low bounce
      density: this.PLAYER_DENSITY, // Lighter to respond better to controls
    });

    this.World.add(this.world, this.player.body);
  }

  private getTerrainHeightAt(x: number): number {
    // Get the terrain height at a specific x position
    const terrainX = Math.floor(x);
    const terrainY = this.CANVAS_HEIGHT - 100; // Terrain starts at y=500

    if (terrainX >= 0 && terrainX < this.TERRAIN_WIDTH) {
      // Find the highest terrain pixel at this x position
      for (let y = 0; y < 50; y++) {
        // Terrain is 50 pixels tall
        if (this.terrain[terrainX] && this.terrain[terrainX][y] === 1) {
          return terrainY + y;
        }
      }
    }

    // If no terrain found, return -1 to indicate no terrain
    return -1;
  }

  private getTerrainAngleAt(x: number): number {
    // Calculate terrain slope by sampling points around x
    const sampleDistance = this.TERRAIN_SLOPE_SAMPLE_DISTANCE;
    const leftHeight = this.getTerrainHeightAt(x - sampleDistance);
    const rightHeight = this.getTerrainHeightAt(x + sampleDistance);
    const centerHeight = this.getTerrainHeightAt(x);

    // Calculate angle based on height difference
    const heightDiff = rightHeight - leftHeight;
    const angle = Math.atan2(heightDiff, sampleDistance * 2);

    return angle;
  }

  private gameLoop = () => {
    this.update();
    this.render();
    requestAnimationFrame(this.gameLoop);
  };

  private update() {
    // Update player position from physics body
    if (this.player.body) {
      this.player.x = this.player.body.position.x;
      this.player.y = this.player.body.position.y;
    }

    // Handle input
    this.handleInput();

    // Update charging
    if (this.isCharging) {
      const chargeTime = Date.now() - this.chargeStartTime;
      const chargeRatio = Math.min(chargeTime / this.MAX_CHARGE_TIME, 1);
      this.player.power = this.MIN_POWER + (this.MAX_POWER - this.MIN_POWER) * chargeRatio;

      // Auto-fire at 100% power
      if (this.player.power >= this.MAX_POWER && !this.projectile) {
        this.shoot();
      }
    }

    // Update projectile if exists
    if (this.projectile) {
      // Check for collisions with terrain
      this.checkProjectileCollision();
    }

    // Check player collision with terrain
    this.checkPlayerTerrainCollision();

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

  private handleInput() {
    if (this.currentState === GameState.PLAYING) {
      // Check if player is on terrain (can move left/right)
      const isOnTerrain = this.getTerrainHeightAt(this.player.x) !== -1;

      // Tank movement and facing - only when on terrain
      if (isOnTerrain) {
        if (this.keys['ArrowLeft'] && this.player.body) {
          const oldFacing = this.player.facing;
          this.player.facing = -1; // Face left
          const targetX = this.player.x - 2.0;
          const hasTerrain = this.getTerrainHeightAt(targetX) !== -1;
          const isTurningAround = oldFacing !== this.player.facing;
          if (
            !hasTerrain ||
            this.getTerrainAngleAt(targetX) <= this.MAX_CLIMB_ANGLE ||
            isTurningAround
          ) {
            this.Body.setVelocity(this.player.body, {
              x: -this.PLAYER_MOVE_SPEED,
              y: this.player.body.velocity.y,
            });
          }
        }
        if (this.keys['ArrowRight'] && this.player.body) {
          const oldFacing = this.player.facing;
          this.player.facing = 1; // Face right
          const targetX = this.player.x + 2.0;
          const hasTerrain = this.getTerrainHeightAt(targetX) !== -1;
          const isTurningAround = oldFacing !== this.player.facing;
          if (
            !hasTerrain ||
            this.getTerrainAngleAt(targetX) >= -this.MAX_CLIMB_ANGLE ||
            isTurningAround
          ) {
            this.Body.setVelocity(this.player.body, {
              x: this.PLAYER_MOVE_SPEED,
              y: this.player.body.velocity.y,
            });
          }
        }
      }

      // Angle adjustment (up/down arrows) - inverted, clamped to 25-60 degrees
      if (this.keys['ArrowUp']) {
        this.player.angle = Math.min(
          this.MAX_AIM_ANGLE,
          this.player.angle + this.ANGLE_ADJUST_SPEED,
        );
      }
      if (this.keys['ArrowDown']) {
        this.player.angle = Math.max(
          this.MIN_AIM_ANGLE,
          this.player.angle - this.ANGLE_ADJUST_SPEED,
        );
      }

      // Shoot (start charging)
      if (this.keys[' '] && !this.projectile && !this.isCharging) {
        this.isCharging = true;
        this.chargeStartTime = Date.now();
        this.player.power = this.MIN_POWER; // Start at minimum power
      }
    }
  }

  private shoot() {
    const angleRad = this.getBarrelAngle();
    const velocity = (this.player.power / 100) * this.MAX_PROJECTILE_VELOCITY; // Max velocity

    const vx = Math.cos(angleRad) * velocity;
    const vy = -Math.sin(angleRad) * velocity; // Negative because canvas Y increases downward

    // Calculate barrel end position
    const barrelLength = this.BARREL_LENGTH;
    const barrelEndX = this.player.x + Math.cos(angleRad) * barrelLength;
    const barrelEndY = this.player.y - Math.sin(angleRad) * barrelLength;

    this.projectile = this.Bodies.circle(barrelEndX, barrelEndY, this.PROJECTILE_RADIUS, {
      friction: this.PROJECTILE_FRICTION,
      restitution: this.PROJECTILE_RESTITUTION,
    });

    this.Body.setVelocity(this.projectile, { x: vx, y: vy });
    this.World.add(this.world, this.projectile);

    // Reset charging state
    this.isCharging = false;
  }

  private checkProjectileCollision() {
    // Simple collision detection with terrain
    const px = Math.floor(this.projectile.position.x);
    const py = Math.floor(this.projectile.position.y);
    const terrainY = this.CANVAS_HEIGHT - 100; // Terrain starts at y=500

    // Convert screen coordinates to terrain array coordinates
    const terrainLocalY = py - terrainY;

    // Check a smaller area around projectile for performance
    if (
      px >= 0 &&
      px < this.TERRAIN_WIDTH &&
      terrainLocalY >= 0 &&
      terrainLocalY < this.terrain[px]?.length
    ) {
      if (this.terrain[px] && this.terrain[px][terrainLocalY] === 1) {
        // Hit terrain - create crater
        this.createCrater(px, py, this.CRATER_RADIUS);
        this.destroyProjectileAt({x: px, y: py});
        return;
      }
    }

    // Check adjacent pixels for more accurate collision
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
        checkX < this.TERRAIN_WIDTH &&
        terrainCheckY >= 0 &&
        terrainCheckY < this.terrain[checkX]?.length
      ) {
        if (this.terrain[checkX] && this.terrain[checkX][terrainCheckY] === 1) {
          this.createCrater(checkX, checkY, this.CRATER_RADIUS);
          this.destroyProjectileAt({x: checkX, y: checkY});
          return;
        }
      }
    }

    // Remove if out of bounds
    if (px < 0 || px > this.TERRAIN_WIDTH || py < 0 || py > this.CANVAS_HEIGHT) {
      this.destroyProjectileAt(this.projectile.position);
    }
  }

  private createCrater(centerX: number, centerY: number, radius: number) {
    const terrainY = this.CANVAS_HEIGHT - 100; // Terrain starts at y=500

    for (let x = centerX - radius; x < centerX + radius; x++) {
      for (let y = centerY - radius; y < centerY + radius; y++) {
        // Convert screen coordinates to terrain array coordinates
        const terrainLocalY = y - terrainY;

        if (
          x >= 0 &&
          x < this.TERRAIN_WIDTH &&
          terrainLocalY >= 0 &&
          terrainLocalY < this.terrain[x]?.length
        ) {
          const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
          if (distance < radius) {
            this.terrain[x][terrainLocalY] = 0;
          }
        }
      }
    }
    // Update physics bodies (simplified - would need proper terrain body updates)
  }

  private destroyProjectileAt(position: any) {
    if (this.projectile) {
      // Create explosion at position
      this.explosions.push({
        x: position.x,
        y: position.y,
        radius: this.EXPLOSION_INITIAL_RADIUS,
        maxRadius: this.EXPLOSION_MAX_RADIUS,
        life: this.EXPLOSION_LIFETIME_FRAMES,
      });

      // Calculate damage to player (self-damage reduced by 50%)
      const distance = Math.sqrt((position.x - this.player.x) ** 2 + (position.y - this.player.y) ** 2);
      const damage = this.EXPLOSION_DAMAGE_MAX * Math.max(0, 1 - distance / this.EXPLOSION_DAMAGE_RANGE);
      const actualDamage = damage * 0.5; // Reduce self-damage by 50%
      this.player.health -= actualDamage;
      this.player.health = Math.max(0, this.player.health);

      // Add damage text if damage was taken
      if (actualDamage > 0) {
        this.damageTexts.push({
          x: position.x,
          y: position.y,
          damage: Math.round(actualDamage),
          life: this.DAMAGE_TEXT_LIFETIME,
        });
      }

      this.World.remove(this.world, this.projectile);
      this.projectile = null;
    }
  }

  private checkPlayerTerrainCollision() {
    if (!this.player.body) return;

    // Get terrain height and angle at player's position
    const terrainHeight = this.getTerrainHeightAt(this.player.x);

    // Only position tank on terrain if terrain actually exists
    if (terrainHeight !== -1) {
      const terrainAngle = this.getTerrainAngleAt(this.player.x);

      // Position tank on terrain surface
      const tankHalfHeight = this.TANK_HALF_HEIGHT; // Half the tank's physics body height
      const targetY = terrainHeight - tankHalfHeight;

      // Only snap to terrain if it's below or at the tank's current position (prevent teleporting to overhangs)
      // Allow small tolerance for physics floating point issues
      if (targetY >= this.player.y - this.TERRAIN_SNAP_TOLERANCE) {
        // Set tank position and rotation
        this.Body.setPosition(this.player.body, { x: this.player.x, y: targetY });
        this.Body.setAngle(this.player.body, terrainAngle);

        // Update player properties to match physics body
        this.player.y = targetY;

        // Store terrain angle for visual rotation
        this.player.terrainAngle = terrainAngle;
      } else {
        // Terrain is above (overhang), let physics handle falling
        this.player.terrainAngle = 0;
      }
    } else {
      // If no terrain exists, let physics handle the tank's position (it will fall)
      this.player.terrainAngle = 0; // Reset terrain angle
    }
  }

  private checkPlayerFall() {
    if (!this.player.body) return;

    // If player falls below the bottom of the screen, respawn
    if (this.player.y > this.CANVAS_HEIGHT + this.FALL_THRESHOLD_OFFSET) {
      this.respawnPlayer();
    }
  }

  private respawnPlayer() {
    // Reset player position to starting location
    this.player.x = this.PLAYER_START_X;
    this.player.y = this.CANVAS_HEIGHT - this.TERRAIN_BASE_Y_OFFSET - this.PLAYER_HOVER_HEIGHT; // 10 units above terrain surface

    // Reset physics body position and velocity
    if (this.player.body) {
      this.Body.setPosition(this.player.body, { x: this.player.x, y: this.player.y });
      this.Body.setVelocity(this.player.body, { x: 0, y: 0 });
      this.Body.setAngle(this.player.body, 0);
    }

    // Reset player properties
    this.player.angle = this.PLAYER_START_ANGLE;
    this.player.power = this.PLAYER_START_POWER;
    this.player.health = this.PLAYER_START_HEALTH;
    this.player.facing = this.PLAYER_START_FACING;
    this.player.terrainAngle = this.PLAYER_START_TERRAIN_ANGLE;
    this.player.active = true;

    // Reset charging state
    this.isCharging = false;
    this.chargeStartTime = 0;
  }

  private render() {
    // Draw sky (entire background)
    this.ctx.fillStyle = this.SKY_COLOR; // Sky blue
    this.ctx.fillRect(0, 0, this.CANVAS_WIDTH, this.CANVAS_HEIGHT);

    // Draw terrain
    this.drawTerrain();

    // Draw charge bar (behind tank)
    if (this.isCharging) {
      this.drawChargeBar();
    }

    // Draw player
    this.drawPlayer();

    // Draw projectile
    if (this.projectile) {
      this.drawProjectile();
    }

    // Draw explosions
    this.drawExplosions();

    // Draw damage texts
    this.drawDamageTexts();

    // Draw UI
    this.drawUI();
  }

  private drawTerrain() {
    // Draw destructible terrain more efficiently by finding solid segments
    this.ctx.fillStyle = this.TERRAIN_COLOR; // Brown color for terrain
    const terrainY = this.CANVAS_HEIGHT - this.TERRAIN_BASE_Y_OFFSET; // Terrain starts at y=500

    // Draw terrain in horizontal segments for better performance
    for (let y = 0; y < this.TERRAIN_STRIP_HEIGHT; y++) {
      let startX = -1;
      for (let x = 0; x < this.TERRAIN_WIDTH; x++) {
        if (this.terrain[x] && this.terrain[x][y] === 1) {
          if (startX === -1) {
            startX = x; // Start of solid segment
          }
        } else {
          if (startX !== -1) {
            // End of solid segment, draw it
            this.ctx.fillRect(startX, terrainY + y, x - startX, 1);
            startX = -1;
          }
        }
      }
      // Draw remaining segment if it goes to the end
      if (startX !== -1) {
        this.ctx.fillRect(startX, terrainY + y, this.TERRAIN_WIDTH - startX, 1);
      }
    }

    // Add some texture/detail to make it look more natural
    this.drawTerrainDetails();
  }

  private drawChargeBar() {
    const barWidth = this.CHARGE_BAR_WIDTH;
    const barHeight = this.CHARGE_BAR_HEIGHT; // 50% shorter (was 60px)
    // Position further behind tank based on facing direction
    const offsetX = this.player.facing === 1 ? -this.CHARGE_BAR_OFFSET_X : this.CHARGE_BAR_OFFSET_X; // Further left of tank when facing right, further right when facing left
    const barX = this.player.x + offsetX;
    const barY = this.player.y - barHeight / 2; // Center vertically on tank

    // Background
    this.ctx.fillStyle = this.CHARGE_BAR_BACKGROUND_COLOR;
    this.ctx.fillRect(barX, barY, barWidth, barHeight);

    // Charge level (bottom to top)
    const chargeRatio = (this.player.power - this.MIN_POWER) / (this.MAX_POWER - this.MIN_POWER);
    this.ctx.fillStyle = chargeRatio < 0.3 ? '#FF4444' : chargeRatio < 0.7 ? '#FFFF44' : '#44FF44';
    this.ctx.fillRect(
      barX,
      barY + barHeight * (1 - chargeRatio),
      barWidth,
      barHeight * chargeRatio,
    );

    // Border
    this.ctx.strokeStyle = this.CHARGE_BAR_BORDER_COLOR;
    this.ctx.lineWidth = this.CHARGE_BAR_BORDER_WIDTH;
    this.ctx.strokeRect(barX, barY, barWidth, barHeight);

    // Power percentage text
    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.font = this.CHARGE_BAR_FONT;
    this.ctx.textAlign = 'center';
    const textX = barX + barWidth / 2;
    const textY = barY - this.CHARGE_BAR_TEXT_OFFSET_Y;
    this.ctx.fillText(`${Math.round(this.player.power)}%`, textX, textY);
    this.ctx.textAlign = 'left'; // Reset text alignment
  }

  private drawTerrainDetails() {
    // Add some subtle details to make terrain look more natural
    this.ctx.fillStyle = this.TERRAIN_DETAIL_COLOR; // Semi-transparent brown for details
    const terrainY = this.CANVAS_HEIGHT - this.TERRAIN_BASE_Y_OFFSET; // Terrain starts at y=500

    for (let i = 0; i < this.TERRAIN_DETAIL_COUNT; i++) {
      const x = Math.random() * this.TERRAIN_WIDTH;
      const terrainLocalY = Math.floor(Math.random() * this.TERRAIN_STRIP_HEIGHT); // Random within terrain height

      if (this.terrain[Math.floor(x)] && this.terrain[Math.floor(x)][terrainLocalY] === 1) {
        // Draw small irregular shapes for texture
        const size =
          Math.random() * (this.TERRAIN_DETAIL_SIZE_MAX - this.TERRAIN_DETAIL_SIZE_MIN) +
          this.TERRAIN_DETAIL_SIZE_MIN;
        this.ctx.fillRect(x - size / 2, terrainY + terrainLocalY - size / 2, size, size);
      }
    }
  }

  private drawPlayer() {
    const centerX = this.player.x;
    const centerY = this.player.y;
    const bodyRadius = this.TANK_BODY_RADIUS;

    // Save context for tank flipping and terrain rotation
    this.ctx.save();

    // Apply terrain rotation first
    this.ctx.translate(centerX, centerY);
    this.ctx.rotate(this.player.terrainAngle);
    this.ctx.translate(-centerX, -centerY);

    // Draw cannon range arc (before facing flip)
    // Note: Canvas y increases downward, so positive angles go down. Negate angles to make arcs appear above the tank.
    if (this.currentState === GameState.PLAYING) {
      let minAngle, maxAngle;
      if (this.player.facing === -1) {
        minAngle = Math.PI - (this.MAX_AIM_ANGLE * Math.PI) / 180; // 120°
        maxAngle = Math.PI - (this.MIN_AIM_ANGLE * Math.PI) / 180; // 155°
      } else {
        minAngle = (this.MIN_AIM_ANGLE * Math.PI) / 180;
        maxAngle = (this.MAX_AIM_ANGLE * Math.PI) / 180;
      }
      this.ctx.globalAlpha = 0.2;
      this.ctx.fillStyle = this.CANNON_ARC_COLOR; // Yellow transparent
      this.ctx.beginPath();
      this.ctx.moveTo(centerX, centerY);
      this.ctx.arc(centerX, centerY, this.CANNON_ARC_RADIUS, -maxAngle, -minAngle);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.globalAlpha = 1.0;

      // Draw grey aim guide 0° to 90°
      this.ctx.globalAlpha = 0.2; // Darker grey
      this.ctx.fillStyle = this.AIM_GUIDE_COLOR; // Grey transparent
      this.ctx.beginPath();
      this.ctx.moveTo(centerX, centerY);
      if (this.player.facing === -1) {
        this.ctx.arc(centerX, centerY, this.CANNON_ARC_RADIUS, -Math.PI, -Math.PI / 2); // -180° to -90°
      } else {
        this.ctx.arc(centerX, centerY, this.CANNON_ARC_RADIUS, -Math.PI / 2, 0); // -90° to 0°
      }
      this.ctx.closePath();
      this.ctx.fill();
    }

    // Flip tank based on facing direction
    if (this.player.facing === -1) {
      this.ctx.scale(-1, 1);
      this.ctx.translate(-centerX * 2, 0);
    }

    // Draw solid lines at 0°, 45°, 90° (after facing flip, so they flip with tank)
    if (this.currentState === GameState.PLAYING) {
      this.ctx.globalAlpha = 1.0;
      this.ctx.strokeStyle = this.AIM_LINE_COLOR;
      this.ctx.lineWidth = this.AIM_LINE_WIDTH;
      const angles = [0, -Math.PI / 4, -Math.PI / 2];
      angles.forEach((angle) => {
        const endX = centerX + Math.cos(-angle) * this.AIM_LINE_LENGTH;
        const endY = centerY - Math.sin(-angle) * this.AIM_LINE_LENGTH;
        this.ctx.beginPath();
        this.ctx.moveTo(centerX, centerY);
        this.ctx.lineTo(endX, endY);
        this.ctx.stroke();
      });
    }

    // Draw tank shadow for depth
    this.ctx.fillStyle = this.TANK_SHADOW_COLOR;
    this.ctx.beginPath();
    this.ctx.ellipse(
      centerX,
      centerY + 2,
      bodyRadius,
      bodyRadius * this.TANK_SHADOW_HEIGHT_RATIO,
      0,
      0,
      Math.PI,
      true,
    );
    this.ctx.fill();

    // Draw barrel (rotates with angle) - behind body
    this.drawTankBarrel(centerX, centerY, bodyRadius);

    // Draw aiming line (behind body)
    if (this.currentState === GameState.PLAYING) {
      const angleRad = (this.player.angle * Math.PI) / 180;
      const lineLength = this.AIM_LINE_LENGTH;
      const endX = centerX + Math.cos(angleRad) * lineLength;
      const endY = centerY - Math.sin(angleRad) * lineLength;

      this.ctx.strokeStyle = this.AIMING_LINE_COLOR;
      this.ctx.lineWidth = this.AIMING_LINE_WIDTH;
      this.ctx.setLineDash(this.AIMING_LINE_DASH);
      this.ctx.beginPath();
      this.ctx.moveTo(centerX, centerY);
      this.ctx.lineTo(endX, endY);
      this.ctx.stroke();
      this.ctx.setLineDash([]);
    }

    // Draw tank body (semicircle on bottom) - in front of barrel and aiming line
    this.ctx.fillStyle = this.player.color;
    this.ctx.strokeStyle = this.TANK_BODY_STROKE_COLOR;
    this.ctx.lineWidth = this.TANK_BODY_STROKE_WIDTH;

    // Draw semicircle body
    this.ctx.beginPath();
    this.ctx.arc(centerX, centerY, bodyRadius, 0, Math.PI, true); // Semicircle facing up
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.stroke();

    // Draw tank tracks/details - on top
    this.ctx.fillStyle = '#333333';
    this.ctx.fillRect(
      centerX - bodyRadius + this.TANK_TRACK_OFFSET,
      centerY - 3,
      bodyRadius * 2 - 4,
      this.TANK_TRACK_HEIGHT,
    );
    this.ctx.strokeRect(
      centerX - bodyRadius + this.TANK_TRACK_OFFSET,
      centerY - 3,
      bodyRadius * 2 - 4,
      this.TANK_TRACK_HEIGHT,
    );

    // Draw tank tracks (left and right)
    this.ctx.fillStyle = '#222222';
    this.ctx.fillRect(
      centerX - bodyRadius + 4,
      centerY - 5,
      this.TANK_TRACK_DETAIL_WIDTH,
      this.TANK_TRACK_DETAIL_HEIGHT,
    );
    this.ctx.fillRect(centerX + bodyRadius - 7, centerY - 5, 3, 10);

    // Restore context
    this.ctx.restore();

    // Draw health bar under the tank
    const healthRatio = this.player.health / 100; // Assuming max health is 100
    const barWidth = 60;
    const barHeight = 5;
    const barX = centerX - barWidth / 2;
    const barY = centerY + bodyRadius - 5; // Even closer to the tank
    // Background bar
    this.ctx.fillStyle = '#666666';
    this.ctx.fillRect(barX, barY, barWidth, barHeight);
    // Health bar
    this.ctx.fillStyle = '#00FF00'; // Green
    this.ctx.fillRect(barX, barY, barWidth * healthRatio, barHeight);
  }

  private drawTankBarrel(centerX: number, centerY: number, bodyRadius: number) {
    const barrelLength = this.BARREL_LENGTH;
    const barrelWidth = this.BARREL_WIDTH;
    const angleRad = (this.player.angle * Math.PI) / 180;

    // Save context for rotation
    this.ctx.save();

    // Move to tank center and rotate
    this.ctx.translate(centerX, centerY);
    this.ctx.rotate(-angleRad); // Negative to match aiming line direction

    // Draw barrel
    this.ctx.fillStyle = this.BARREL_COLOR;
    this.ctx.strokeStyle = this.BARREL_STROKE_COLOR;
    this.ctx.lineWidth = this.BARREL_STROKE_WIDTH;

    // Main barrel rectangle
    this.ctx.fillRect(0, -barrelWidth / 2, barrelLength, barrelWidth);
    this.ctx.strokeRect(0, -barrelWidth / 2, barrelLength, barrelWidth);

    // Barrel tip accent
    this.ctx.fillStyle = this.BARREL_TIP_COLOR;
    this.ctx.fillRect(
      barrelLength - this.BARREL_TIP_LENGTH,
      -barrelWidth / 2 - 1,
      this.BARREL_TIP_LENGTH,
      barrelWidth + this.BARREL_TIP_EXTRA_HEIGHT,
    );

    // Restore context
    this.ctx.restore();
  }

  private drawProjectile() {
    this.ctx.fillStyle = this.PROJECTILE_COLOR;
    this.ctx.beginPath();
    this.ctx.arc(
      this.projectile.position.x,
      this.projectile.position.y,
      this.PROJECTILE_DRAW_RADIUS, // Increased from 5 to 10
      0,
      Math.PI * 2,
    );
    this.ctx.fill();
  }

  private updateExplosions() {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const explosion = this.explosions[i];
      explosion.radius += this.EXPLOSION_EXPANSION_RATE; // Expand
      explosion.life--;

      if (explosion.life <= 0 || explosion.radius >= explosion.maxRadius) {
        this.explosions.splice(i, 1);
      }
    }
  }

  private updateDamageTexts() {
    for (let i = this.damageTexts.length - 1; i >= 0; i--) {
      const text = this.damageTexts[i];
      text.y -= this.DAMAGE_TEXT_RISE_SPEED; // Rise up
      text.life--;

      if (text.life <= 0) {
        this.damageTexts.splice(i, 1);
      }
    }
  }

  private drawExplosions() {
    for (const explosion of this.explosions) {
      // Create explosion gradient (orange to red)
      const gradient = this.ctx.createRadialGradient(
        explosion.x,
        explosion.y,
        0,
        explosion.x,
        explosion.y,
        explosion.radius,
      );
      gradient.addColorStop(0, this.EXPLOSION_CENTER_COLOR); // Yellow center
      gradient.addColorStop(0.5, this.EXPLOSION_MIDDLE_COLOR); // Orange middle
      gradient.addColorStop(1, this.EXPLOSION_EDGE_COLOR); // Red edge fading to transparent

      this.ctx.fillStyle = gradient;
      this.ctx.beginPath();
      this.ctx.arc(explosion.x, explosion.y, explosion.radius, 0, Math.PI * 2);
      this.ctx.fill();

      // Add explosion outline
      this.ctx.strokeStyle = this.EXPLOSION_OUTLINE_COLOR;
      this.ctx.lineWidth = this.EXPLOSION_OUTLINE_WIDTH;
      this.ctx.stroke();
    }
  }

  private drawDamageTexts() {
    this.ctx.fillStyle = this.DAMAGE_TEXT_COLOR;
    this.ctx.font = this.DAMAGE_TEXT_FONT;
    this.ctx.textAlign = 'center';
    for (const text of this.damageTexts) {
      const alpha = text.life / this.DAMAGE_TEXT_LIFETIME;
      this.ctx.globalAlpha = alpha;
      this.ctx.fillText(`-${text.damage}`, text.x, text.y);
    }
    this.ctx.globalAlpha = 1; // Reset alpha
    this.ctx.textAlign = 'left'; // Reset text align
  }

  private drawUI() {
    // Draw angle and power
    this.ctx.fillStyle = this.UI_TEXT_COLOR;
    this.ctx.font = this.UI_FONT;
    // Calculate true barrel angle (terrain + turret + facing adjustment)
    const trueAngleRad = this.getBarrelAngle();
    const trueAngleDeg = ((trueAngleRad * 180) / Math.PI).toFixed(this.UI_ANGLE_DECIMALS);
    this.ctx.fillText(`Angle: ${trueAngleDeg}°`, this.UI_TEXT_X, this.UI_ANGLE_Y);
    this.ctx.fillText(`Power: ${this.player.power}%`, this.UI_TEXT_X, this.UI_POWER_Y);
    this.ctx.fillText(
      `Terrain Angle: ${((this.player.terrainAngle * 180) / Math.PI).toFixed(1)}°`,
      this.UI_TEXT_X,
      this.UI_TERRAIN_ANGLE_Y,
    );
  }

  private getBarrelAngle(): number {
    const baseAngleRad = (this.player.angle * Math.PI) / 180;
    const trueAngleRad =
      -this.player.terrainAngle +
      (this.player.facing === -1 ? Math.PI - baseAngleRad : baseAngleRad);
    return trueAngleRad;
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent) {
    // Prevent default browser behavior for game controls
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(event.key)) {
      event.preventDefault();
    }
    this.keys[event.key] = true;
  }

  @HostListener('window:keyup', ['$event'])
  onKeyUp(event: KeyboardEvent) {
    // Handle spacebar release for shooting
    if (event.key === ' ') {
      if (this.isCharging && !this.projectile) {
        this.shoot();
      }
      this.isCharging = false;
    }
    this.keys[event.key] = false;
  }

  @HostListener('window:mousemove', ['$event'])
  onMouseMove(event: MouseEvent) {
    const rect = this.canvas.nativeElement.getBoundingClientRect();
    this.mouseX = (event.clientX - rect.left) / this.canvasScale;
    this.mouseY = (event.clientY - rect.top) / this.canvasScale;
  }

  @HostListener('window:resize')
  onResize() {
    this.updateCanvasScale();
  }
}
