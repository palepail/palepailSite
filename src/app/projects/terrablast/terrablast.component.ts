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

interface Player {
  body: any; // Matter.js body
  x: number;
  y: number;
  angle: number;
  power: number;
  health: number;
  color: string;
  active: boolean;
  facing: number; // 1 for right, -1 for left
  terrainAngle: number; // Angle of terrain beneath the tank
}

enum GameState {
  LOADING = 'loading',
  MENU = 'menu',
  PLAYING = 'playing',
  AIMING = 'aiming',
  SHOOTING = 'shooting',
  GAME_OVER = 'game_over',
  LEADERBOARD = 'leaderboard',
  LEADERBOARD_NAME_INPUT = 'leaderboard_name_input',
}

interface GameSettings {
  bgmVolume: number;
  sfxVolume: number;
  difficulty: 'easy' | 'normal' | 'hard';
  muted: boolean;
}

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

  // Game constants
  private readonly CANVAS_WIDTH = 800;
  private readonly CANVAS_HEIGHT = 600;
  private canvasScale = 1;

  // Terrain
  private terrain: number[][] = [];
  private readonly TERRAIN_WIDTH = 800;
  private readonly TERRAIN_HEIGHT = 400;
  private readonly MAX_CLIMB_ANGLE = (50 * Math.PI) / 180; // 50 degrees

  // Player
  player: Player = {
    body: null,
    x: 100,
    y: 0,
    angle: 45,
    power: 50,
    health: 100,
    color: '#4ECDC4',
    active: true,
    facing: 1, // Start facing right
    terrainAngle: 0, // Start level
  };

  // Charging system
  private isCharging = false;
  private chargeStartTime = 0;
  private readonly MAX_CHARGE_TIME = 1000; // 1 second for full charge (faster)
  private readonly MIN_POWER = 20;
  private readonly MAX_POWER = 100;

  // Game physics
  private projectile: any = null;
  private explosions: { x: number; y: number; radius: number; maxRadius: number; life: number }[] = [];

  // Input handling
  private keys: { [key: string]: boolean } = {};
  private mouseX = 0;
  private mouseY = 0;

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
      const maxWidth = Math.min(window.innerWidth - 32, this.CANVAS_WIDTH);
      this.canvasScale = maxWidth / this.CANVAS_WIDTH;
      this.canvas.nativeElement.style.width = `${maxWidth}px`;
      this.canvas.nativeElement.style.height = `${this.CANVAS_HEIGHT * this.canvasScale}px`;
    }
  }

  private generateTerrain() {
    // Create a simple 50-pixel tall terrain strip across the full width, raised by 50 pixels
    this.terrain = [];
    const terrainHeight = 50; // Terrain is 50 pixels tall

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
        newHeights[i] = (smoothed[i - 1] + smoothed[i] * 2 + smoothed[i + 1]) / 4;
      }

      smoothed = newHeights;
    }

    return smoothed;
  }

  private initPhysics() {
    // Initialize Matter.js
    this.engine = this.Engine.create();
    this.world = this.engine.world;
    this.engine.world.gravity.y = 1;

    // Note: Using custom terrain collision instead of physics bodies for destructible terrain

    // Start physics
    this.runner = this.Runner.create();
    this.Runner.run(this.runner, this.engine);
  }

  private createTerrainBodies() {
    // Removed - using custom collision detection for destructible terrain
  }

  private initPlayer() {
    // Find a good spot for the player on the terrain
    this.player.x = 100;
    // Position so the tank sits on the terrain (100 pixels from bottom, raised 50 pixels)
    this.player.y = this.CANVAS_HEIGHT - 100 - 10; // 10 units above terrain surface

    // Create player body (rectangle physics, but visual is semicircle)
    this.player.body = this.Bodies.rectangle(
      this.player.x,
      this.player.y,
      20,
      20,
      {
        friction: 0.98,       // Very high friction for tight controls, minimal sliding
        frictionAir: 0.15,    // Higher air resistance to stop quickly
        restitution: 0.05,    // Very low bounce
        density: 0.01,        // Lighter to respond better to controls
      }
    );

    this.World.add(this.world, this.player.body);
  }

  private getTerrainHeightAt(x: number): number {
    // Get the terrain height at a specific x position
    const terrainX = Math.floor(x);
    const terrainY = this.CANVAS_HEIGHT - 100; // Terrain starts at y=500

    if (terrainX >= 0 && terrainX < this.TERRAIN_WIDTH) {
      // Find the highest terrain pixel at this x position
      for (let y = 0; y < 50; y++) { // Terrain is 50 pixels tall
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
    const sampleDistance = 10;
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
          if (!hasTerrain || this.getTerrainAngleAt(targetX) <= this.MAX_CLIMB_ANGLE || isTurningAround) {
            this.Body.setVelocity(this.player.body, { x: -2.0, y: this.player.body.velocity.y });
          }
        }
        if (this.keys['ArrowRight'] && this.player.body) {
          const oldFacing = this.player.facing;
          this.player.facing = 1; // Face right
          const targetX = this.player.x + 2.0;
          const hasTerrain = this.getTerrainHeightAt(targetX) !== -1;
          const isTurningAround = oldFacing !== this.player.facing;
          if (!hasTerrain || this.getTerrainAngleAt(targetX) >= -this.MAX_CLIMB_ANGLE || isTurningAround) {
            this.Body.setVelocity(this.player.body, { x: 2.0, y: this.player.body.velocity.y });
          }
        }
      }

      // Angle adjustment (up/down arrows) - inverted, clamped to 25-60 degrees
      if (this.keys['ArrowUp']) {
        this.player.angle = Math.min(60, this.player.angle + 2);
      }
      if (this.keys['ArrowDown']) {
        this.player.angle = Math.max(25, this.player.angle - 2);
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
    const baseAngleRad = (this.player.angle * Math.PI) / 180;
    // Adjust angle based on tank facing direction and terrain angle
    const angleRad = -this.player.terrainAngle + (this.player.facing === -1 ? Math.PI - baseAngleRad : baseAngleRad);
    const velocity = (this.player.power / 100) * 20; // Max velocity

    const vx = Math.cos(angleRad) * velocity;
    const vy = -Math.sin(angleRad) * velocity; // Negative because canvas Y increases downward

    this.projectile = this.Bodies.circle(
      this.player.x,
      this.player.y - 10,
      5,
      {
        friction: 0.01,
        restitution: 0.8,
      }
    );

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
    if (px >= 0 && px < this.TERRAIN_WIDTH && terrainLocalY >= 0 && terrainLocalY < this.terrain[px]?.length) {
      if (this.terrain[px] && this.terrain[px][terrainLocalY] === 1) {
        // Hit terrain - create crater
        this.createCrater(px, py, 20);
        this.destroyProjectile();
        return;
      }
    }

    // Check adjacent pixels for more accurate collision
    const checkOffsets = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [offsetX, offsetY] of checkOffsets) {
      const checkX = px + offsetX;
      const checkY = py + offsetY;
      const terrainCheckY = checkY - terrainY;

      if (checkX >= 0 && checkX < this.TERRAIN_WIDTH && terrainCheckY >= 0 && terrainCheckY < this.terrain[checkX]?.length) {
        if (this.terrain[checkX] && this.terrain[checkX][terrainCheckY] === 1) {
          this.createCrater(checkX, checkY, 20);
          this.destroyProjectile();
          return;
        }
      }
    }

    // Remove if out of bounds
    if (px < 0 || px > this.TERRAIN_WIDTH || py < 0 || py > this.CANVAS_HEIGHT) {
      this.destroyProjectile();
    }
  }

  private createCrater(centerX: number, centerY: number, radius: number) {
    const terrainY = this.CANVAS_HEIGHT - 100; // Terrain starts at y=500

    for (let x = centerX - radius; x < centerX + radius; x++) {
      for (let y = centerY - radius; y < centerY + radius; y++) {
        // Convert screen coordinates to terrain array coordinates
        const terrainLocalY = y - terrainY;

        if (x >= 0 && x < this.TERRAIN_WIDTH && terrainLocalY >= 0 && terrainLocalY < this.terrain[x]?.length) {
          const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
          if (distance < radius) {
            this.terrain[x][terrainLocalY] = 0;
          }
        }
      }
    }
    // Update physics bodies (simplified - would need proper terrain body updates)
  }

  private destroyProjectile() {
    if (this.projectile) {
      // Create explosion at projectile position
      this.explosions.push({
        x: this.projectile.position.x,
        y: this.projectile.position.y,
        radius: 5,
        maxRadius: 30,
        life: 15 // frames
      });

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
      const tankHalfHeight = 10; // Half the tank's physics body height
      const targetY = terrainHeight - tankHalfHeight;

      // Only snap to terrain if it's below or at the tank's current position (prevent teleporting to overhangs)
      // Allow small tolerance for physics floating point issues
      if (targetY >= this.player.y - 20) {
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
    if (this.player.y > this.CANVAS_HEIGHT + 50) {
      this.respawnPlayer();
    }
  }

  private respawnPlayer() {
    // Reset player position to starting location
    this.player.x = 100;
    this.player.y = this.CANVAS_HEIGHT - 100 - 10; // 10 units above terrain surface

    // Reset physics body position and velocity
    if (this.player.body) {
      this.Body.setPosition(this.player.body, { x: this.player.x, y: this.player.y });
      this.Body.setVelocity(this.player.body, { x: 0, y: 0 });
      this.Body.setAngle(this.player.body, 0);
    }

    // Reset player properties
    this.player.angle = 45;
    this.player.power = 50;
    this.player.health = 100;
    this.player.facing = 1;
    this.player.terrainAngle = 0;
    this.player.active = true;

    // Reset charging state
    this.isCharging = false;
    this.chargeStartTime = 0;
  }

  private render() {
    // Draw sky (entire background)
    this.ctx.fillStyle = '#87CEEB'; // Sky blue
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

    // Draw UI
    this.drawUI();
  }

  private drawTerrain() {
    // Draw destructible terrain more efficiently by finding solid segments
    this.ctx.fillStyle = '#8B4513'; // Brown color for terrain
    const terrainY = this.CANVAS_HEIGHT - 100; // Terrain starts at y=500

    // Draw terrain in horizontal segments for better performance
    for (let y = 0; y < 50; y++) {
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
    const barWidth = 8;
    const barHeight = 30; // 50% shorter (was 60px)
    // Position further behind tank based on facing direction
    const offsetX = this.player.facing === 1 ? -30 : 30; // Further left of tank when facing right, further right when facing left
    const barX = this.player.x + offsetX;
    const barY = this.player.y - barHeight / 2; // Center vertically on tank

    // Background
    this.ctx.fillStyle = '#333333';
    this.ctx.fillRect(barX, barY, barWidth, barHeight);

    // Charge level (bottom to top)
    const chargeRatio = (this.player.power - this.MIN_POWER) / (this.MAX_POWER - this.MIN_POWER);
    this.ctx.fillStyle = chargeRatio < 0.3 ? '#FF4444' : chargeRatio < 0.7 ? '#FFFF44' : '#44FF44';
    this.ctx.fillRect(barX, barY + barHeight * (1 - chargeRatio), barWidth, barHeight * chargeRatio);

    // Border
    this.ctx.strokeStyle = '#FFFFFF';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(barX, barY, barWidth, barHeight);

    // Power percentage text
    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.font = '10px Arial';
    this.ctx.textAlign = 'center';
    const textX = barX + barWidth / 2;
    const textY = barY - 5;
    this.ctx.fillText(`${Math.round(this.player.power)}%`, textX, textY);
    this.ctx.textAlign = 'left'; // Reset text alignment
  }

  private drawTerrainDetails() {
    // Add some subtle details to make terrain look more natural
    this.ctx.fillStyle = 'rgba(139, 69, 19, 0.4)'; // Semi-transparent brown for details
    const terrainY = this.CANVAS_HEIGHT - 100; // Terrain starts at y=500

    for (let i = 0; i < 30; i++) {
      const x = Math.random() * this.TERRAIN_WIDTH;
      const terrainLocalY = Math.floor(Math.random() * 50); // Random within terrain height

      if (this.terrain[Math.floor(x)] && this.terrain[Math.floor(x)][terrainLocalY] === 1) {
        // Draw small irregular shapes for texture
        const size = Math.random() * 3 + 1;
        this.ctx.fillRect(x - size/2, terrainY + terrainLocalY - size/2, size, size);
      }
    }
  }

  private drawPlayer() {
    const centerX = this.player.x;
    const centerY = this.player.y;
    const bodyRadius = 18;

    // Save context for tank flipping and terrain rotation
    this.ctx.save();

    // Apply terrain rotation first
    this.ctx.translate(centerX, centerY);
    this.ctx.rotate(this.player.terrainAngle);
    this.ctx.translate(-centerX, -centerY);

    // Flip tank based on facing direction
    if (this.player.facing === -1) {
      this.ctx.scale(-1, 1);
      this.ctx.translate(-centerX * 2, 0);
    }

    // Draw tank shadow for depth
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    this.ctx.beginPath();
    this.ctx.ellipse(centerX, centerY + 2, bodyRadius, bodyRadius * 0.3, 0, 0, Math.PI, true);
    this.ctx.fill();

    // Draw barrel (rotates with angle) - behind body
    this.drawTankBarrel(centerX, centerY, bodyRadius);

    // Draw aiming line (behind body)
    if (this.currentState === GameState.PLAYING) {
      const angleRad = (this.player.angle * Math.PI) / 180;
      const lineLength = 40;
      const endX = centerX + Math.cos(angleRad) * lineLength;
      const endY = centerY - Math.sin(angleRad) * lineLength;

      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      this.ctx.lineWidth = 1;
      this.ctx.setLineDash([5, 5]);
      this.ctx.beginPath();
      this.ctx.moveTo(centerX, centerY);
      this.ctx.lineTo(endX, endY);
      this.ctx.stroke();
      this.ctx.setLineDash([]);
    }

    // Draw tank body (semicircle on bottom) - in front of barrel and aiming line
    this.ctx.fillStyle = this.player.color;
    this.ctx.strokeStyle = '#000000';
    this.ctx.lineWidth = 2;

    // Draw semicircle body
    this.ctx.beginPath();
    this.ctx.arc(centerX, centerY, bodyRadius, 0, Math.PI, true); // Semicircle facing up
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.stroke();

    // Draw tank tracks/details - on top
    this.ctx.fillStyle = '#333333';
    this.ctx.fillRect(centerX - bodyRadius + 2, centerY - 3, bodyRadius * 2 - 4, 6);
    this.ctx.strokeRect(centerX - bodyRadius + 2, centerY - 3, bodyRadius * 2 - 4, 6);

    // Draw tank tracks (left and right)
    this.ctx.fillStyle = '#222222';
    this.ctx.fillRect(centerX - bodyRadius + 4, centerY - 5, 3, 10);
    this.ctx.fillRect(centerX + bodyRadius - 7, centerY - 5, 3, 10);

    // Restore context
    this.ctx.restore();
  }

  private drawTankBarrel(centerX: number, centerY: number, bodyRadius: number) {
    const barrelLength = 35;
    const barrelWidth = 5;
    const angleRad = (this.player.angle * Math.PI) / 180;

    // Save context for rotation
    this.ctx.save();

    // Move to tank center and rotate
    this.ctx.translate(centerX, centerY);
    this.ctx.rotate(-angleRad); // Negative to match aiming line direction

    // Draw barrel
    this.ctx.fillStyle = '#666666';
    this.ctx.strokeStyle = '#000000';
    this.ctx.lineWidth = 1;

    // Main barrel rectangle
    this.ctx.fillRect(0, -barrelWidth/2, barrelLength, barrelWidth);
    this.ctx.strokeRect(0, -barrelWidth/2, barrelLength, barrelWidth);

    // Barrel tip accent
    this.ctx.fillStyle = '#444444';
    this.ctx.fillRect(barrelLength - 3, -barrelWidth/2 - 1, 3, barrelWidth + 2);

    // Restore context
    this.ctx.restore();
  }

  private drawProjectile() {
    this.ctx.fillStyle = '#FF0000';
    this.ctx.beginPath();
    this.ctx.arc(
      this.projectile.position.x,
      this.projectile.position.y,
      10, // Increased from 5 to 10
      0,
      Math.PI * 2
    );
    this.ctx.fill();
  }

  private updateExplosions() {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const explosion = this.explosions[i];
      explosion.radius += 2; // Expand
      explosion.life--;

      if (explosion.life <= 0 || explosion.radius >= explosion.maxRadius) {
        this.explosions.splice(i, 1);
      }
    }
  }

  private drawExplosions() {
    for (const explosion of this.explosions) {
      // Create explosion gradient (orange to red)
      const gradient = this.ctx.createRadialGradient(
        explosion.x, explosion.y, 0,
        explosion.x, explosion.y, explosion.radius
      );
      gradient.addColorStop(0, 'rgba(255, 255, 0, 0.8)'); // Yellow center
      gradient.addColorStop(0.5, 'rgba(255, 165, 0, 0.6)'); // Orange middle
      gradient.addColorStop(1, 'rgba(255, 0, 0, 0)'); // Red edge fading to transparent

      this.ctx.fillStyle = gradient;
      this.ctx.beginPath();
      this.ctx.arc(explosion.x, explosion.y, explosion.radius, 0, Math.PI * 2);
      this.ctx.fill();

      // Add explosion outline
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      this.ctx.lineWidth = 2;
      this.ctx.stroke();
    }
  }

  private drawUI() {
    // Draw angle and power
    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.font = '16px Arial';
    this.ctx.fillText(`Angle: ${this.player.angle}°`, 10, 30);
    this.ctx.fillText(`Power: ${this.player.power}%`, 10, 50);
    this.ctx.fillText(`Health: ${this.player.health}`, 10, 70);
    this.ctx.fillText(`Terrain Angle: ${(this.player.terrainAngle * 180 / Math.PI).toFixed(1)}°`, 10, 90);
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