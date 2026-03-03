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
  };

  // Game physics
  private projectile: any = null;
  private isAiming = false;
  private wind = 0;

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
    // Create a simple 50-pixel tall terrain strip across the full width
    this.terrain = [];
    const terrainTop = this.CANVAS_HEIGHT - 50; // 50 pixels from bottom

    // Create terrain array - solid terrain from terrainTop to bottom
    for (let x = 0; x < this.TERRAIN_WIDTH; x++) {
      this.terrain[x] = [];
      for (let y = 0; y < this.TERRAIN_HEIGHT; y++) {
        // Terrain exists from terrainTop to bottom of terrain array
        this.terrain[x][y] = y >= terrainTop ? 1 : 0;
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

    // Create ground
    this.createTerrainBodies();

    // Start physics
    this.runner = this.Runner.create();
    this.Runner.run(this.runner, this.engine);
  }

  private createTerrainBodies() {
    // Create static bodies for the solid terrain strip
    const terrainTop = this.CANVAS_HEIGHT - 50;
    for (let x = 0; x < this.TERRAIN_WIDTH; x += 10) {
      for (let y = terrainTop; y < this.CANVAS_HEIGHT; y += 10) {
        const body = this.Bodies.rectangle(x + 5, y + 5, 10, 10, { isStatic: true });
        this.World.add(this.world, body);
      }
    }
  }

  private initPlayer() {
    // Find a good spot for the player on the terrain
    this.player.x = 100;
    // Position so the tank sits on the terrain (50 pixels from bottom)
    this.player.y = this.CANVAS_HEIGHT - 50 - 10; // 10 units above terrain surface

    // Create player body (rectangle physics, but visual is semicircle)
    this.player.body = this.Bodies.rectangle(
      this.player.x,
      this.player.y,
      20,
      20,
      {
        friction: 0.8,
        restitution: 0.1,
      }
    );

    this.World.add(this.world, this.player.body);
  }

  private findTerrainHeight(x: number): number {
    for (let y = 0; y < this.TERRAIN_HEIGHT; y++) {
      if (this.terrain[Math.floor(x)] && this.terrain[Math.floor(x)][y] === 1) {
        return y;
      }
    }
    return this.TERRAIN_HEIGHT;
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

    // Update projectile if exists
    if (this.projectile) {
      // Check for collisions with terrain
      this.checkProjectileCollision();
    }
  }

  private handleInput() {
    if (this.currentState === GameState.PLAYING) {
      // Tank movement
      if (this.keys['ArrowLeft'] && this.player.body) {
        this.Body.setVelocity(this.player.body, { x: -5, y: this.player.body.velocity.y });
      }
      if (this.keys['ArrowRight'] && this.player.body) {
        this.Body.setVelocity(this.player.body, { x: 5, y: this.player.body.velocity.y });
      }

      // Angle adjustment (up/down arrows) - inverted
      if (this.keys['ArrowUp']) {
        this.player.angle = Math.min(180, this.player.angle + 2);
      }
      if (this.keys['ArrowDown']) {
        this.player.angle = Math.max(0, this.player.angle - 2);
      }

      // Power adjustment (maybe keep as is, or change to other keys)
      // For now, keep power on some other keys or remove it
      // if (this.keys['w']) {
      //   this.player.power = Math.min(100, this.player.power + 1);
      // }
      // if (this.keys['s']) {
      //   this.player.power = Math.max(0, this.player.power - 1);
      // }

      // Shoot
      if (this.keys[' '] && !this.projectile) {
        this.shoot();
      }
    }
  }

  private shoot() {
    const angleRad = (this.player.angle * Math.PI) / 180;
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
  }

  private checkProjectileCollision() {
    // Simple collision detection with terrain
    const px = Math.floor(this.projectile.position.x);
    const py = Math.floor(this.projectile.position.y);

    if (px >= 0 && px < this.TERRAIN_WIDTH && py >= 0 && py < this.TERRAIN_HEIGHT) {
      if (this.terrain[px] && this.terrain[px][py] === 1) {
        // Hit terrain - create crater
        this.createCrater(px, py, 20);
        this.destroyProjectile();
      }
    }

    // Remove if out of bounds
    if (px < 0 || px > this.TERRAIN_WIDTH || py < 0 || py > this.CANVAS_HEIGHT) {
      this.destroyProjectile();
    }
  }

  private createCrater(centerX: number, centerY: number, radius: number) {
    for (let x = centerX - radius; x < centerX + radius; x++) {
      for (let y = centerY - radius; y < centerY + radius; y++) {
        if (x >= 0 && x < this.TERRAIN_WIDTH && y >= 0 && y < this.TERRAIN_HEIGHT) {
          const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
          if (distance < radius) {
            this.terrain[x][y] = 0;
          }
        }
      }
    }
    // Update physics bodies (simplified - would need proper terrain body updates)
  }

  private destroyProjectile() {
    if (this.projectile) {
      this.World.remove(this.world, this.projectile);
      this.projectile = null;
    }
  }

  private render() {
    // Draw sky (entire background)
    this.ctx.fillStyle = '#87CEEB'; // Sky blue
    this.ctx.fillRect(0, 0, this.CANVAS_WIDTH, this.CANVAS_HEIGHT);

    // Draw terrain
    this.drawTerrain();

    // Draw player
    this.drawPlayer();

    // Draw projectile
    if (this.projectile) {
      this.drawProjectile();
    }

    // Draw UI
    this.drawUI();
  }

  private drawTerrain() {
    // Create a gradient for the terrain
    const gradient = this.ctx.createLinearGradient(0, this.CANVAS_HEIGHT - 50, 0, this.CANVAS_HEIGHT);
    gradient.addColorStop(0, '#A0522D');    // Lighter brown at top
    gradient.addColorStop(1, '#654321');   // Darker brown at bottom

    this.ctx.fillStyle = gradient;

    // Draw the solid terrain strip (50 pixels tall, full width)
    this.ctx.fillRect(0, this.CANVAS_HEIGHT - 50, this.CANVAS_WIDTH, 50);

    // Add some texture/detail to make it look more natural
    this.drawTerrainDetails();
  }

  private drawTerrainDetails() {
    // Add some subtle details to make terrain look more natural
    this.ctx.fillStyle = 'rgba(139, 69, 19, 0.4)'; // Semi-transparent brown for details

    for (let i = 0; i < 30; i++) {
      const x = Math.random() * this.TERRAIN_WIDTH;
      const y = Math.random() * this.TERRAIN_HEIGHT;

      if (this.terrain[Math.floor(x)] && this.terrain[Math.floor(x)][Math.floor(y)] === 1) {
        // Draw small irregular shapes for texture
        const size = Math.random() * 3 + 1;
        this.ctx.fillRect(x - size/2, y - size/2, size, size);
      }
    }
  }

  private drawPlayer() {
    const centerX = this.player.x;
    const centerY = this.player.y;
    const bodyRadius = 18;

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
      5,
      0,
      Math.PI * 2
    );
    this.ctx.fill();
  }

  private drawUI() {
    // Draw angle and power
    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.font = '16px Arial';
    this.ctx.fillText(`Angle: ${this.player.angle}°`, 10, 30);
    this.ctx.fillText(`Power: ${this.player.power}%`, 10, 50);
    this.ctx.fillText(`Health: ${this.player.health}`, 10, 70);

    // Draw controls
    this.ctx.fillText('Controls:', 10, 100);
    this.ctx.fillText('↑↓: Aim barrel', 10, 120);
    this.ctx.fillText('←→: Move tank', 10, 140);
    this.ctx.fillText('Space: Shoot', 10, 160);
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent) {
    this.keys[event.key] = true;
  }

  @HostListener('window:keyup', ['$event'])
  onKeyUp(event: KeyboardEvent) {
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