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
// @ts-ignore
import * as Matter from 'matter-js';

// Local imports
import { Player, GameState, GameSettings, Explosion, DamageText } from './terrablast.types';
import * as CONST from './terrablast.constants';

// Camera system
interface Camera {
  x: number;
  y: number;
  width: number;
  height: number;
}

class CameraController {
  camera: Camera;

  constructor() {
    this.camera = { x: 0, y: 0, width: CONST.CANVAS_WIDTH, height: CONST.CANVAS_HEIGHT };
  }

  update(playerX: number, playerY: number, playerVelocityX: number, isCharging: boolean) {
    // Recenter on player if moving or charging
    if (Math.abs(playerVelocityX) > 0.1 || isCharging) {
      this.camera.x = playerX - this.camera.width / 2;
    }

    // Clamp to world bounds - no vertical scrolling, y always 0
    this.camera.x = Math.max(0, Math.min(CONST.TERRAIN_WIDTH - this.camera.width, this.camera.x));
    this.camera.y = 0; // Fixed, no vertical camera movement
  }

  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    return { x: worldX - this.camera.x, y: worldY - this.camera.y };
  }

  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return { x: screenX + this.camera.x, y: screenY + this.camera.y };
  }
}
import { TerrablastGameService } from './terrablast-game.service';

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

  // Camera system
  private cameraController = new CameraController();

  // Mouse control for camera
  private isDragging = false;
  private lastMouseX = 0;

  // Game state
  get currentState(): GameState {
    return this.gameService.currentState;
  }
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
  private readonly TERRAIN_WIDTH = CONST.TERRAIN_WIDTH;
  private readonly TERRAIN_HEIGHT = CONST.TERRAIN_HEIGHT;
  private readonly TERRAIN_BASE_Y_OFFSET = CONST.TERRAIN_BASE_Y_OFFSET;
  private canvasScale = 1;

  // Input handling
  // keys moved to service
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
  private readonly MIN_POWER = CONST.MIN_POWER;
  private readonly MAX_POWER = CONST.MAX_POWER;
  private readonly TANK_BODY_RADIUS = CONST.TANK_BODY_RADIUS;
  private readonly CANNON_ARC_RADIUS = CONST.CANNON_ARC_RADIUS;
  private readonly CANNON_ARC_COLOR = CONST.CANNON_ARC_COLOR;
  private readonly AIM_GUIDE_COLOR = CONST.AIM_GUIDE_COLOR;
  private readonly AIM_LINE_COLOR = CONST.AIM_LINE_COLOR;
  private readonly AIM_LINE_WIDTH = CONST.AIM_LINE_WIDTH;
  private readonly AIM_GUIDE_ANGLES = CONST.AIM_GUIDE_ANGLES;
  private readonly AIM_LINE_LENGTH = CONST.AIM_LINE_LENGTH;
  private readonly MIN_AIM_ANGLE = CONST.MIN_AIM_ANGLE;
  private readonly MAX_AIM_ANGLE = CONST.MAX_AIM_ANGLE;
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
  private readonly BARREL_LENGTH = CONST.BARREL_LENGTH;
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
  private readonly TERRAIN_DETAIL_SIZE_MAX = CONST.TERRAIN_DETAIL_SIZE_MAX;
  private readonly TERRAIN_DETAIL_SIZE_MIN = CONST.TERRAIN_DETAIL_SIZE_MIN;
  private readonly TERRAIN_DETAIL_COUNT = CONST.TERRAIN_DETAIL_COUNT;
  private readonly TERRAIN_DETAIL_COLOR = CONST.TERRAIN_DETAIL_COLOR;
  private readonly TERRAIN_STRIP_HEIGHT = CONST.TERRAIN_STRIP_HEIGHT;
  private readonly DAMAGE_TEXT_LIFETIME = CONST.DAMAGE_TEXT_LIFETIME;
  private readonly DAMAGE_TEXT_FONT = CONST.DAMAGE_TEXT_FONT;
  private readonly EXPLOSION_OUTLINE_WIDTH = CONST.EXPLOSION_OUTLINE_WIDTH;
  private readonly DAMAGE_TEXT_COLOR = CONST.DAMAGE_TEXT_COLOR;
  private readonly EXPLOSION_EDGE_COLOR = CONST.EXPLOSION_EDGE_COLOR;
  private readonly EXPLOSION_OUTLINE_COLOR = CONST.EXPLOSION_OUTLINE_COLOR;
  private readonly EXPLOSION_MIDDLE_COLOR = CONST.EXPLOSION_MIDDLE_COLOR;
  private readonly EXPLOSION_CENTER_COLOR = CONST.EXPLOSION_CENTER_COLOR;

  constructor(private cdr: ChangeDetectorRef, private gameService: TerrablastGameService) {
    console.log('TerrablastComponent constructor called');
  }

  ngOnInit() {
    console.log('TerrablastComponent ngOnInit called');
    console.log('Matter.js loaded, initializing game');
    this.gameService.setMatterJS(Matter);
    this.initCanvas();
    this.canvas.nativeElement.focus();
    this.gameService.initGame();
    this.gameLoop();

    // Add key listeners
    window.addEventListener('keydown', (event) => {
      this.onKeyDown(event);
    });
    window.addEventListener('keyup', (event) => this.onKeyUp(event));

    // Add mouse listeners for camera control
    this.canvas.nativeElement.addEventListener('mousedown', (event) => this.onMouseDown(event));
    this.canvas.nativeElement.addEventListener('mousemove', (event) => this.onMouseMove(event));
    this.canvas.nativeElement.addEventListener('mouseup', () => this.onMouseUp());
    this.canvas.nativeElement.addEventListener('mouseleave', () => this.onMouseUp());
  }

  ngOnDestroy() {
    this.gameService.destroy();
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





















  private render() {
    // Update camera
    this.cameraController.update(
      this.gameService.player.x,
      this.gameService.player.y,
      this.gameService.player.body ? this.gameService.player.body.velocity.x : 0,
      this.gameService.isCharging
    );

    // Draw sky (entire background)
    this.ctx.fillStyle = this.SKY_COLOR; // Sky blue
    this.ctx.fillRect(0, 0, this.CANVAS_WIDTH, this.CANVAS_HEIGHT);

    // Draw terrain
    this.drawTerrain();

    // Draw charge bar (behind tank)
    if (this.gameService.isCharging) {
      this.drawChargeBar();
    }

    // Draw player
    this.drawPlayer();

    // Draw projectile
    if (this.gameService.projectile) {
      this.drawProjectile();
    }

    // Draw explosions
    this.drawExplosions();

    // Draw damage texts
    this.drawDamageTexts();

    // Draw UI
    this.drawUI();
  }



  private drawChargeBar() {
    const barWidth = this.CHARGE_BAR_WIDTH;
    const barHeight = this.CHARGE_BAR_HEIGHT; // 50% shorter (was 60px)
    // Position further behind tank based on facing direction
    const offsetX = this.gameService.player.facing === 1 ? -this.CHARGE_BAR_OFFSET_X : this.CHARGE_BAR_OFFSET_X; // Further left of tank when facing right, further right when facing left
    const worldX = this.gameService.player.x + offsetX;
    const worldY = this.gameService.player.y - barHeight / 2; // Center vertically on tank
    const screenPos = this.cameraController.worldToScreen(worldX, worldY);
    const barX = screenPos.x;
    const barY = screenPos.y;

    // Background
    this.ctx.fillStyle = this.CHARGE_BAR_BACKGROUND_COLOR;
    this.ctx.fillRect(barX, barY, barWidth, barHeight);

    // Charge level (bottom to top)
    const chargeRatio = this.gameService.player.power / this.gameService.player.maxPower;
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
    this.ctx.fillText(`${Math.round(chargeRatio * 100)}%`, textX, textY);
    this.ctx.textAlign = 'left'; // Reset text alignment
  }

  private drawTerrain() {
    // Draw destructible terrain more efficiently by finding solid segments
    this.ctx.fillStyle = '#8B4513'; // Brown color for terrain
    const terrainY = this.CANVAS_HEIGHT - CONST.TERRAIN_BASE_Y_OFFSET; // Terrain starts at y=500

    // Only draw visible terrain segments
    const startX = Math.max(0, Math.floor(this.cameraController.camera.x));
    const endX = Math.min(CONST.TERRAIN_WIDTH, Math.ceil(this.cameraController.camera.x + CONST.CANVAS_WIDTH));

    // Draw terrain in horizontal segments for better performance
    for (let y = 0; y < this.TERRAIN_STRIP_HEIGHT; y++) {
      let segmentStart = -1;
      for (let x = startX; x < endX; x++) {
        if (this.gameService.terrain[x] && this.gameService.terrain[x][y] === 1) {
          if (segmentStart === -1) {
            segmentStart = x; // Start of solid segment
          }
        } else {
          if (segmentStart !== -1) {
            // End of solid segment, draw it at screen position
            const screenX = x - this.cameraController.camera.x;
            const prevScreenX = segmentStart - this.cameraController.camera.x;
            this.ctx.fillRect(prevScreenX, terrainY + y, screenX - prevScreenX, 1);
            segmentStart = -1;
          }
        }
      }
      // Draw remaining segment if it goes to the end
      if (segmentStart !== -1) {
        const screenX = endX - this.cameraController.camera.x;
        const prevScreenX = segmentStart - this.cameraController.camera.x;
        this.ctx.fillRect(prevScreenX, terrainY + y, screenX - prevScreenX, 1);
      }
    }
  }

  private drawTerrainDetails() {
    // Add some subtle details to make terrain look more natural
    this.ctx.fillStyle = this.TERRAIN_DETAIL_COLOR; // Semi-transparent brown for details
    const terrainY = this.CANVAS_HEIGHT - this.TERRAIN_BASE_Y_OFFSET; // Terrain starts at y=500

    const startX = Math.max(0, Math.floor(this.cameraController.camera.x));
    const endX = Math.min(CONST.TERRAIN_WIDTH, Math.ceil(this.cameraController.camera.x + CONST.CANVAS_WIDTH));

    for (let i = 0; i < this.TERRAIN_DETAIL_COUNT; i++) {
      const x = startX + Math.random() * (endX - startX);
      const terrainLocalY = Math.floor(Math.random() * this.TERRAIN_STRIP_HEIGHT); // Random within terrain height

      if (this.gameService.terrain[Math.floor(x)] && this.gameService.terrain[Math.floor(x)][terrainLocalY] === 1) {
        // Draw small irregular shapes for texture
        const size =
          Math.random() * (this.TERRAIN_DETAIL_SIZE_MAX - this.TERRAIN_DETAIL_SIZE_MIN) +
          this.TERRAIN_DETAIL_SIZE_MIN;
        const screenX = x - this.cameraController.camera.x;
        this.ctx.fillRect(screenX - size / 2, terrainY + terrainLocalY - size / 2, size, size);
      }
    }
  }

  private drawPlayer() {
    const screenPos = this.cameraController.worldToScreen(this.gameService.player.x, this.gameService.player.y);
    const centerX = screenPos.x;
    const centerY = screenPos.y;
    const bodyRadius = this.TANK_BODY_RADIUS;

    // Save context for tank flipping and terrain rotation
    this.ctx.save();

    // Apply terrain rotation first
    this.ctx.translate(centerX, centerY);
    this.ctx.rotate(this.gameService.player.terrainAngle);
    this.ctx.translate(-centerX, -centerY);

    // Draw cannon range arc (before facing flip)
    // Note: Canvas y increases downward, so positive angles go down. Negate angles to make arcs appear above the tank.
    if (this.gameService.currentState === GameState.PLAYING) {
      let minAngle, maxAngle;
      if (this.gameService.player.facing === -1) {
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
      if (this.gameService.player.facing === -1) {
        this.ctx.arc(centerX, centerY, this.CANNON_ARC_RADIUS, -Math.PI, -Math.PI / 2); // -180° to -90°
      } else {
        this.ctx.arc(centerX, centerY, this.CANNON_ARC_RADIUS, -Math.PI / 2, 0); // -90° to 0°
      }
      this.ctx.closePath();
      this.ctx.fill();
    }

    // Flip tank based on facing direction
    if (this.gameService.player.facing === -1) {
      this.ctx.scale(-1, 1);
      this.ctx.translate(-centerX * 2, 0);
    }

    // Draw solid lines at 0°, 45°, 90° (after facing flip, so they flip with tank)
    if (this.gameService.currentState === GameState.PLAYING) {
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
      const angleRad = (this.gameService.player.angle * Math.PI) / 180;
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
    this.ctx.fillStyle = this.gameService.player.color;
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
    const healthRatio = this.gameService.player.health / CONST.PLAYER_START_HEALTH;
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

    // Draw movement gauge if moving
    if (Math.abs(this.gameService.player.body.velocity.x) > 0.1) {
      const movementRatio = this.gameService.player.movementFuel / CONST.PLAYER_START_MOVEMENT_FUEL;
      const movementBarY = barY + barHeight + 2; // Below health bar
      // Background
      this.ctx.fillStyle = '#666666';
      this.ctx.fillRect(barX, movementBarY, barWidth, barHeight);
      // Movement bar
      this.ctx.fillStyle = '#FFFF00'; // Yellow
      this.ctx.fillRect(barX, movementBarY, barWidth * movementRatio, barHeight);
    }
  }

  private drawTankBarrel(centerX: number, centerY: number, bodyRadius: number) {
    const barrelLength = this.BARREL_LENGTH;
    const barrelWidth = this.BARREL_WIDTH;
    const angleRad = (this.gameService.player.angle * Math.PI) / 180;

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
    const screenPos = this.cameraController.worldToScreen(this.gameService.projectile.position.x, this.gameService.projectile.position.y);
    this.ctx.fillStyle = this.PROJECTILE_COLOR;
    this.ctx.beginPath();
    this.ctx.arc(
      screenPos.x,
      screenPos.y,
      this.PROJECTILE_DRAW_RADIUS, // Increased from 5 to 10
      0,
      Math.PI * 2,
    );
    this.ctx.fill();
  }





  private drawExplosions() {
    for (const explosion of this.gameService.explosions) {
      const screenPos = this.cameraController.worldToScreen(explosion.x, explosion.y);
      // Create explosion gradient (orange to red)
      const gradient = this.ctx.createRadialGradient(
        screenPos.x,
        screenPos.y,
        0,
        screenPos.x,
        screenPos.y,
        explosion.radius,
      );
      gradient.addColorStop(0, this.EXPLOSION_CENTER_COLOR); // Yellow center
      gradient.addColorStop(0.5, this.EXPLOSION_MIDDLE_COLOR); // Orange middle
      gradient.addColorStop(1, this.EXPLOSION_EDGE_COLOR); // Red edge fading to transparent

      this.ctx.fillStyle = gradient;
      this.ctx.beginPath();
      this.ctx.arc(screenPos.x, screenPos.y, explosion.radius, 0, Math.PI * 2);
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
    for (const text of this.gameService.damageTexts) {
      const screenPos = this.cameraController.worldToScreen(text.x, text.y);
      const alpha = text.life / this.DAMAGE_TEXT_LIFETIME;
      this.ctx.globalAlpha = alpha;
      this.ctx.fillText(`-${text.damage}`, screenPos.x, screenPos.y);
    }
    this.ctx.globalAlpha = 1; // Reset alpha
    this.ctx.textAlign = 'left'; // Reset text align
  }

  private drawUI() {
    // Draw angle and power
    this.ctx.fillStyle = this.UI_TEXT_COLOR;
    this.ctx.font = this.UI_FONT;
    // Calculate true barrel angle (terrain + turret + facing adjustment)
    const trueAngleRad = this.gameService.getBarrelAngle();
    const trueAngleDeg = ((trueAngleRad * 180) / Math.PI).toFixed(this.UI_ANGLE_DECIMALS);
    this.ctx.fillText(`Angle: ${trueAngleDeg}°`, this.UI_TEXT_X, this.UI_ANGLE_Y);
    this.ctx.fillText(`Power: ${Math.round((this.gameService.player.power / this.gameService.player.maxPower) * 100)}%`, this.UI_TEXT_X, this.UI_POWER_Y);
    this.ctx.fillText(
      `Terrain Angle: ${((this.gameService.player.terrainAngle * 180) / Math.PI).toFixed(1)}°`,
      this.UI_TEXT_X,
      this.UI_TERRAIN_ANGLE_Y,
    );
    this.ctx.fillText(`Health: ${this.gameService.player.health}`, this.UI_TEXT_X, this.UI_HEALTH_Y);
  }



  private gameLoop() {
    this.gameService.update();
    this.render();
    requestAnimationFrame(() => this.gameLoop());
  }

  onKeyDown(event: KeyboardEvent) {
    // Prevent default browser behavior for game controls
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(event.key)) {
      event.preventDefault();
    }
    this.gameService.keys[event.key] = true;
  }

  onKeyUp(event: KeyboardEvent) {
    // Handle spacebar release for shooting
    if (event.key === ' ') {
      if (this.gameService.isCharging && !this.gameService.projectile) {
        this.gameService.shoot();
      }
      this.gameService.isCharging = false;
    }
    this.gameService.keys[event.key] = false;
  }

  @HostListener('window:mousemove', ['$event'])
  onMouseMove(event: MouseEvent) {
    const rect = this.canvas.nativeElement.getBoundingClientRect();
    this.mouseX = (event.clientX - rect.left) / this.canvasScale;
    this.mouseY = (event.clientY - rect.top) / this.canvasScale;

    // Handle camera dragging
    if (this.isDragging) {
      const deltaX = (event.clientX - this.lastMouseX) / this.canvasScale;
      this.cameraController.camera.x -= deltaX * 2; // Increased sensitivity
      this.cameraController.camera.x = Math.max(0, Math.min(CONST.TERRAIN_WIDTH - CONST.CANVAS_WIDTH, this.cameraController.camera.x));
      this.lastMouseX = event.clientX;
    }

    // Edge scrolling removed - only drag works now
  }

  onMouseDown(event: MouseEvent) {
    this.isDragging = true;
    this.lastMouseX = event.clientX;
  }

  onMouseUp() {
    this.isDragging = false;
  }

  @HostListener('window:resize')
  onResize() {
    this.updateCanvasScale();
  }
}
