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

// Matter.js imports
// @ts-ignore
import * as Matter from 'matter-js';

// Local imports
import { Player, GameState, Explosion, DamageText } from './terrablast.types';
import * as CONST from './terrablast.constants';
import { TerrablastGameService } from './terrablast-game.service';
import { CameraController } from './camera-controller';

// Camera system

@Component({
  selector: 'app-terrablast',
  imports: [RouterLink, CommonModule],
  templateUrl: './terrablast.component.html',
  styleUrl: './terrablast.component.css',
})
export class TerrablastComponent implements OnInit, OnDestroy {
  @ViewChild('gameCanvas', { static: true }) canvas!: ElementRef<HTMLCanvasElement>;
  private ctx!: CanvasRenderingContext2D;

  // Camera system
  private cameraController = new CameraController();

  // Setup timer
  private setupStartTime: number = 0;

  // Mouse control for camera
  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;

  // Player movement tracking
  private playerMovementStarted = false;

  // Prediction path toggle
  private showPrediction: boolean = true;

  // Game state
  get currentState(): GameState {
    return this.gameService.currentState;
  }

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
  private readonly PROJECTILE_RADIUS = CONST.PROJECTILE_RADIUS;
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

  constructor(
    private cdr: ChangeDetectorRef,
    private gameService: TerrablastGameService,
  ) {}

  ngOnInit() {
    this.gameService.setMatterJS(Matter);
    this.initCanvas();
    this.canvas.nativeElement.focus();
    this.gameService.initGame();
    this.cameraController.reset();
    // Set up camera follow for player during setup
    this.cameraController.setFollowTarget(this.gameService.player);
    this.cameraController.enableFollow();
    this.setupStartTime = Date.now();
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
    // Check if setup is complete (3 seconds)
    if (
      this.gameService.currentState === GameState.SETUP &&
      Date.now() - this.setupStartTime >= 3000
    ) {
      this.gameService.currentState = GameState.PLAYING;
      // Disable camera follow when setup is done
      this.cameraController.disableFollow();
      // Normalize initial delays
      this.gameService.startTurn();
    }

    // Reset player movement flag
    this.playerMovementStarted = false;

    // Update camera
    this.cameraController.update(
      this.gameService.player.x,
      this.gameService.player.y,
      this.gameService.player.body ? this.gameService.player.body.velocity.x : 0,
      this.gameService.isCharging,
      this.gameService.projectile,
      this.isDragging,
      this.gameService.keys['ArrowUp'] || this.gameService.keys['ArrowDown'],
      this.gameService.currentState,
      this.gameService.player.body,
      this.gameService.getCurrentTurnEntity()?.entity,
      this.gameService.explodedProjectiles,
    );

    // Pan to entity if requested
    if (
      this.gameService.panToEntity &&
      this.gameService.panToEntity.entity &&
      isFinite(this.gameService.panToEntity.entity.x) &&
      isFinite(this.gameService.panToEntity.entity.y) &&
      this.gameService.currentState !== GameState.SETUP
    ) {
      this.cameraController.panToEntity(this.gameService.panToEntity.entity);
      this.gameService.panToEntity = null;
    } else if (this.gameService.panToEntity) {
      this.gameService.panToEntity = null; // Clear invalid request
    }

    // Pan to player when they start moving
    if (
      this.gameService.isPlayerTurn() &&
      !this.playerMovementStarted &&
      this.gameService.player.body &&
      Math.abs(this.gameService.player.body.velocity.x) > 0.1
    ) {
      this.playerMovementStarted = true;
      this.cameraController.panToEntity(this.gameService.player);
    }

    // Draw sky (entire background)
    this.ctx.fillStyle = this.SKY_COLOR; // Sky blue
    this.ctx.fillRect(0, 0, this.CANVAS_WIDTH, this.CANVAS_HEIGHT);

    // Draw terrain
    this.drawTerrain();

    // Draw charge bar (behind tank)
    if (this.gameService.isCharging) {
      this.drawChargeBar();
    }

    // Draw enemy charge bars (behind tanks)
    this.drawEnemyChargeBars();

    // Draw player
    this.drawPlayer();

    // Draw enemies
    this.drawEnemies();

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
    this.drawTurnQueue();
  }

  private drawChargeBar() {
    const barWidth = this.CHARGE_BAR_WIDTH;
    const barHeight = this.CHARGE_BAR_HEIGHT; // 50% shorter (was 60px)
    // Position further behind tank based on facing direction
    const offsetX =
      this.gameService.player.facing === 1 ? -this.CHARGE_BAR_OFFSET_X : this.CHARGE_BAR_OFFSET_X; // Further left of tank when facing right, further right when facing left
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

  private drawEnemyChargeBars() {
    for (const enemy of this.gameService.enemies) {
      if (enemy.active && enemy.turnState === 'charging') {
        this.drawEnemyChargeBar(enemy);
      }
    }
  }

  private drawEnemyChargeBar(enemy: any) {
    const barWidth = this.CHARGE_BAR_WIDTH;
    const barHeight = this.CHARGE_BAR_HEIGHT;
    // Position further behind tank based on facing direction
    const offsetX = enemy.facing === 1 ? -this.CHARGE_BAR_OFFSET_X : this.CHARGE_BAR_OFFSET_X; // Further left of tank when facing right, further right when facing left
    const worldX = enemy.x + offsetX;
    const worldY = enemy.y - barHeight / 2; // Center vertically on tank
    const screenPos = this.cameraController.worldToScreen(worldX, worldY);
    const barX = screenPos.x;
    const barY = screenPos.y;

    // Background
    this.ctx.fillStyle = this.CHARGE_BAR_BACKGROUND_COLOR;
    this.ctx.fillRect(barX, barY, barWidth, barHeight);

    // Charge level (bottom to top)
    const chargeRatio = enemy.power / enemy.targetPower;
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
    const terrainY = Math.floor(
      this.CANVAS_HEIGHT - CONST.TERRAIN_BASE_Y_OFFSET - this.cameraController.camera.y,
    ); // Terrain starts at y=500, adjusted for camera

    // Only draw visible terrain segments
    const startX = Math.max(0, Math.floor(this.cameraController.camera.x));
    const endX = Math.min(
      CONST.TERRAIN_WIDTH,
      Math.ceil(this.cameraController.camera.x + CONST.CANVAS_WIDTH),
    );

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
            const screenX = Math.floor(x - this.cameraController.camera.x);
            const prevScreenX = Math.floor(segmentStart - this.cameraController.camera.x);
            this.ctx.fillRect(prevScreenX, terrainY + y, screenX - prevScreenX, 1);
            segmentStart = -1;
          }
        }
      }
      // Draw remaining segment if it goes to the end
      if (segmentStart !== -1) {
        const screenX = Math.floor(endX - this.cameraController.camera.x);
        const prevScreenX = Math.floor(segmentStart - this.cameraController.camera.x);
        this.ctx.fillRect(prevScreenX, terrainY + y, screenX - prevScreenX, 1);
      }
    }
  }

  private drawTerrainDetails() {
    // Add some subtle details to make terrain look more natural
    this.ctx.fillStyle = this.TERRAIN_DETAIL_COLOR; // Semi-transparent brown for details
    const terrainY = this.CANVAS_HEIGHT - this.TERRAIN_BASE_Y_OFFSET; // Terrain starts at y=500

    const startX = Math.max(0, Math.floor(this.cameraController.camera.x));
    const endX = Math.min(
      CONST.TERRAIN_WIDTH,
      Math.ceil(this.cameraController.camera.x + CONST.CANVAS_WIDTH),
    );

    for (let i = 0; i < this.TERRAIN_DETAIL_COUNT; i++) {
      const x = startX + Math.random() * (endX - startX);
      const terrainLocalY = Math.floor(Math.random() * this.TERRAIN_STRIP_HEIGHT); // Random within terrain height

      if (
        this.gameService.terrain[Math.floor(x)] &&
        this.gameService.terrain[Math.floor(x)][terrainLocalY] === 1
      ) {
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
    const screenPos = this.cameraController.worldToScreen(
      this.gameService.player.x,
      this.gameService.player.y,
    );
    const centerX = screenPos.x;
    const centerY = screenPos.y;
    const bodyRadius = this.TANK_BODY_RADIUS;

    // Save context for tank flipping and terrain rotation
    this.ctx.save();

    // Apply terrain rotation first
    this.ctx.translate(centerX, centerY);
    this.ctx.rotate(this.gameService.player.terrainAngle);
    this.ctx.translate(-centerX, -centerY);

    // Flip tank based on facing direction
    if (this.gameService.player.facing === -1) {
      this.ctx.scale(-1, 1);
      this.ctx.translate(-centerX * 2, 0);
    }

    // Draw cannon range arc (after facing flip, so it flips with tank)
    this.drawTankAimingArc(centerX, centerY);

    // Draw aim lines (after facing flip, so they flip with tank)
    this.drawTankAimLines(centerX, centerY);

    // Draw tank shadow for depth
    this.drawTankShadow(centerX, centerY, bodyRadius);

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

    // Draw player prediction path when charging
    if (this.showPrediction && this.gameService.isCharging) {
      const angleRad = (this.gameService.player.angle * Math.PI) / 180;
      const barrelEndX = this.gameService.player.x + Math.cos(angleRad) * this.BARREL_LENGTH;
      const barrelEndY = this.gameService.player.y - Math.sin(angleRad) * this.BARREL_LENGTH;
      this.drawPredictionPath(
        barrelEndX,
        barrelEndY,
        angleRad,
        this.gameService.player.power,
        this.gameService.player.vehicle.bullet,
        '#0000FF',
      );
    }

    // Draw tank body (semicircle on bottom) - in front of barrel and aiming line
    this.drawTankBody(centerX, centerY, bodyRadius);

    // Draw tank tracks/details - on top
    this.drawTankTracks(centerX, centerY, bodyRadius);

    // Restore context
    this.ctx.restore();

    // Draw UI elements (health and movement bars)
    this.drawEntityUI(this.gameService.player, centerX, centerY, bodyRadius, true);
  }

  private drawEnemies() {
    for (const enemy of this.gameService.enemies) {
      if (enemy.active) {
        this.drawEnemy(enemy);
      }
    }
  }

  private drawEnemy(enemy: any) {
    const screenPos = this.cameraController.worldToScreen(enemy.x, enemy.y);
    const centerX = screenPos.x;
    const centerY = screenPos.y;
    const bodyRadius = this.TANK_BODY_RADIUS;

    // Save context for tank flipping and terrain rotation
    this.ctx.save();

    // Apply terrain rotation first
    this.ctx.translate(centerX, centerY);
    this.ctx.rotate(enemy.terrainAngle);
    this.ctx.translate(-centerX, -centerY);

    // Flip tank based on facing direction
    if (enemy.facing === -1) {
      this.ctx.scale(-1, 1);
      this.ctx.translate(-centerX * 2, 0);
    }

    // Draw tank shadow for depth
    this.drawTankShadow(centerX, centerY, bodyRadius);

    // Draw barrel (fixed angle for enemies) - behind body
    this.drawEnemyBarrel(centerX, centerY, bodyRadius, enemy);

    // Draw tank body (semicircle on bottom) - in front of barrel
    this.drawEnemyBody(centerX, centerY, bodyRadius);

    // Draw tank tracks/details - on top
    this.drawTankTracks(centerX, centerY, bodyRadius);

    // Restore context
    this.ctx.restore();

    // Draw UI elements (health bar)
    this.drawEntityUI(enemy, centerX, centerY, bodyRadius, false);

    // Draw prediction path if enabled
    if (this.showPrediction && enemy.turnState === 'charging') {
      const baseAngleRad = (enemy.angle * Math.PI) / 180;
      const angleRad =
        -enemy.terrainAngle + (enemy.facing === -1 ? Math.PI - baseAngleRad : baseAngleRad);
      const barrelLength = this.BARREL_LENGTH;
      const barrelEndX = enemy.x + Math.cos(angleRad) * barrelLength;
      const barrelEndY = enemy.y - Math.sin(angleRad) * barrelLength;

      this.drawPredictionPath(
        barrelEndX,
        barrelEndY,
        angleRad,
        enemy.power,
        enemy.vehicle.bullet,
        '#FF0000',
      );
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

  private drawTankAimingArc(centerX: number, centerY: number) {
    // Draw cannon range arc (before facing flip)
    // Note: Canvas y increases downward, so positive angles go down. Negate angles to make arcs appear above the tank.
    if (this.gameService.currentState === GameState.PLAYING) {
      const minAngle = (this.MIN_AIM_ANGLE * Math.PI) / 180;
      const maxAngle = (this.MAX_AIM_ANGLE * Math.PI) / 180;

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
      this.ctx.arc(centerX, centerY, this.CANNON_ARC_RADIUS, -Math.PI / 2, 0); // -90° to 0°
      this.ctx.closePath();
      this.ctx.fill();
    }
  }

  private drawTankAimLines(centerX: number, centerY: number) {
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
  }

  private drawPredictionPath(
    startX: number,
    startY: number,
    angleRad: number,
    power: number,
    bullet: any,
    color: string = '#FFFFFF',
  ) {
    const { positions } = this.gameService.simulateTrajectory(
      startX,
      startY,
      angleRad,
      power,
      bullet,
    );
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([5, 5]);
    this.ctx.beginPath();
    let started = false;
    for (const pos of positions) {
      const screenPos = this.cameraController.worldToScreen(pos.x, pos.y);
      if (!started) {
        this.ctx.moveTo(screenPos.x, screenPos.y);
        started = true;
      } else {
        this.ctx.lineTo(screenPos.x, screenPos.y);
      }
    }
    this.ctx.stroke();
    this.ctx.setLineDash([]);
  }

  private drawTankShadow(centerX: number, centerY: number, bodyRadius: number) {
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
  }

  private drawTankBody(centerX: number, centerY: number, bodyRadius: number) {
    // Draw tank body (semicircle on bottom) - in front of barrel and aiming line
    this.ctx.fillStyle = this.gameService.player.color;
    this.ctx.strokeStyle = this.TANK_BODY_STROKE_COLOR;
    this.ctx.lineWidth = this.TANK_BODY_STROKE_WIDTH;

    // Draw semicircle body
    this.ctx.beginPath();
    this.ctx.arc(centerX, centerY, bodyRadius, Math.PI, 0, false); // Lower semicircle
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.stroke();
  }

  private drawTankTracks(centerX: number, centerY: number, bodyRadius: number) {
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
  }

  private drawEntityUI(
    entity: any,
    centerX: number,
    centerY: number,
    bodyRadius: number,
    isPlayer: boolean = false,
  ) {
    // Draw health bar under the tank
    const healthRatio = entity.health / entity.vehicle.health;
    const barWidth = 60;
    const barHeight = 5;
    const barX = centerX - barWidth / 2;
    const barY = centerY + bodyRadius - 5;
    // Background bar
    this.ctx.fillStyle = '#666666';
    this.ctx.fillRect(barX, barY, barWidth, barHeight);
    // Health bar
    this.ctx.fillStyle = isPlayer ? '#00FF00' : '#FF0000'; // Green for player, red for enemies
    this.ctx.fillRect(barX, barY, barWidth * healthRatio, barHeight);

    // Draw angle text to the right of health bar
    this.ctx.fillStyle = this.UI_TEXT_COLOR;
    this.ctx.font = '12px Arial'; // Smaller font for angle display
    this.ctx.textAlign = 'left';
    const angleDeg = Math.round(entity.angle); // Relative angle
    this.ctx.fillText(`${angleDeg}°`, barX + barWidth + 10, barY + barHeight / 2 + 4);

    // Draw movement gauge if moving
    if (Math.abs(entity.body.velocity.x) > 0.1) {
      const movementRatio = entity.movementFuel / entity.vehicle.fuel;
      const movementBarY = barY + barHeight + 2; // Below health bar
      // Background
      this.ctx.fillStyle = '#666666';
      this.ctx.fillRect(barX, movementBarY, barWidth, barHeight);
      // Movement bar
      this.ctx.fillStyle = '#FFFF00'; // Yellow
      this.ctx.fillRect(barX, movementBarY, barWidth * movementRatio, barHeight);
    }
  }

  private drawEnemyBarrel(centerX: number, centerY: number, bodyRadius: number, enemy: any) {
    const barrelLength = this.BARREL_LENGTH;
    const barrelWidth = this.BARREL_WIDTH;
    // Use enemy angle for aiming animation
    const angleRad = (enemy.angle * Math.PI) / 180;

    // Save context for rotation
    this.ctx.save();

    // Move to tank center and rotate
    this.ctx.translate(centerX, centerY);
    this.ctx.rotate(-angleRad);

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

  private drawEnemyBody(centerX: number, centerY: number, bodyRadius: number) {
    // Draw tank body (semicircle on bottom) - in front of barrel
    this.ctx.fillStyle = '#FF6B6B'; // Enemy color
    this.ctx.strokeStyle = this.TANK_BODY_STROKE_COLOR;
    this.ctx.lineWidth = this.TANK_BODY_STROKE_WIDTH;

    // Draw semicircle body
    this.ctx.beginPath();
    this.ctx.arc(centerX, centerY, bodyRadius, Math.PI, 0, false); // Lower semicircle
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.stroke();
  }

  private drawProjectile() {
    if (this.gameService.projectile) {
      let pos: { x: number; y: number };
      if (this.gameService.projectile.body) {
        // Legacy physics projectile
        pos = this.gameService.projectile.body.position;
      } else {
        // Trajectory projectile
        pos = { x: this.gameService.projectile.x, y: this.gameService.projectile.y };
      }
      const screenPos = this.cameraController.worldToScreen(pos.x, pos.y);
      this.ctx.fillStyle = this.PROJECTILE_COLOR;
      this.ctx.beginPath();
      this.ctx.arc(screenPos.x, screenPos.y, this.PROJECTILE_DRAW_RADIUS, 0, Math.PI * 2);
      this.ctx.fill();
    } else if (this.gameService.explodedProjectiles.length > 0) {
      const ep = this.gameService.explodedProjectiles[0];
      const screenPos = this.cameraController.worldToScreen(ep.position.x, ep.position.y);
      this.ctx.fillStyle = this.PROJECTILE_COLOR;
      this.ctx.beginPath();
      this.ctx.arc(screenPos.x, screenPos.y, this.PROJECTILE_DRAW_RADIUS, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  private drawExplosions() {
    for (let i = this.gameService.explosions.length - 1; i >= 0; i--) {
      const explosion = this.gameService.explosions[i];
      if (
        !isFinite(explosion.x) ||
        !isFinite(explosion.y) ||
        !isFinite(explosion.radius) ||
        explosion.radius <= 0
      ) {
        this.gameService.explosions.splice(i, 1);
        continue;
      }
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
      if (explosion.shape === 'horizontal_oval') {
        this.ctx.ellipse(
          screenPos.x,
          screenPos.y,
          explosion.radius * 1.5,
          explosion.radius,
          0,
          0,
          Math.PI * 2,
        );
      } else if (explosion.shape === 'vertical_oval') {
        this.ctx.ellipse(
          screenPos.x,
          screenPos.y,
          explosion.radius,
          explosion.radius * 1.5,
          0,
          0,
          Math.PI * 2,
        );
      } else {
        // 'circle' or default
        this.ctx.arc(screenPos.x, screenPos.y, explosion.radius, 0, Math.PI * 2);
      }
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
    // Draw countdown timer in top right
    if (this.gameService.currentState === GameState.PLAYING) {
      const remaining = Math.max(
        0,
        Math.floor(45 - (Date.now() - this.gameService.turnStartTime) / 1000),
      );
      this.ctx.fillStyle = '#FFFFFF';
      this.ctx.font = '20px Arial';
      this.ctx.textAlign = 'right';
      this.ctx.fillText(`Time: ${remaining}s`, this.CANVAS_WIDTH - 20, 30);
      this.ctx.textAlign = 'left'; // Reset
    }
  }

  private drawTurnQueue() {
    const queue = [...this.gameService.turnQueue].sort((a, b) => a.entity.delay - b.entity.delay);
    if (queue.length === 0) return;

    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    this.ctx.fillRect(10, 10, 200, queue.length * 25 + 10);

    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.font = '14px Arial';
    this.ctx.textAlign = 'left';

    const currentEntity = this.gameService.getCurrentTurnEntity();

    queue.forEach((turnEntity, index) => {
      const y = 30 + index * 25;
      const isCurrent = turnEntity.id === currentEntity?.id;

      if (isCurrent) {
        this.ctx.fillStyle = '#FFFF00'; // Yellow for current turn
      } else if (turnEntity.type === 'player') {
        this.ctx.fillStyle = '#00FF00'; // Green for player
      } else {
        this.ctx.fillStyle = '#FF0000'; // Red for enemies
      }

      const name = turnEntity.type === 'player' ? 'Player' : `Enemy ${turnEntity.id.split('_')[1]}`;
      const timeStr = isCurrent ? '0' : Math.round(turnEntity.entity.delay);

      this.ctx.fillText(`${name}: ${timeStr}`, 20, y);
    });

    this.ctx.textAlign = 'left'; // Reset text alignment
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
    if (event.key === 'p' || event.key === 'P') {
      this.showPrediction = !this.showPrediction;
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
    // Handle camera dragging
    if (this.isDragging) {
      const deltaX = (event.clientX - this.lastMouseX) / this.canvasScale;
      const deltaY = (event.clientY - this.lastMouseY) / this.canvasScale;
      this.cameraController.camera.x -= deltaX * 2; // Increased sensitivity
      this.cameraController.camera.y -= deltaY * 2;
      // Clamp horizontal
      this.cameraController.camera.x = Math.max(
        0,
        Math.min(CONST.TERRAIN_WIDTH - CONST.CANVAS_WIDTH, this.cameraController.camera.x),
      );
      // Clamp vertical for manual drag (limited range)
      this.cameraController.camera.y = Math.max(
        -200,
        Math.min(200, this.cameraController.camera.y),
      );
      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;
    }

    // Edge scrolling removed - only drag works now
  }

  onMouseDown(event: MouseEvent) {
    this.isDragging = true;
    this.lastMouseX = event.clientX;
    this.lastMouseY = event.clientY;
  }

  onMouseUp() {
    this.isDragging = false;
    this.cameraController.lastActivityTime = Date.now();
  }

  @HostListener('window:resize')
  onResize() {
    this.updateCanvasScale();
  }
}
