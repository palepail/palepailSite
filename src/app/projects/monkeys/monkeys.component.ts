import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewInit,
  ElementRef,
  ViewChild,
  HostListener,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';

// Matter.js imports
// @ts-ignore
import * as Matter from 'matter-js';

// Local imports
import { Player, GameState, Explosion, DamageText, TerrainSpriteRegion } from './monkeys.types';
import * as CONST from './monkeys.constants';
import { MonkeysGameService } from './monkeys-game.service';
import { MonkeysSpriteService } from './monkeys-sprite.service';
import { CameraController } from './camera-controller';
import { TerrainSpriteAnalyzer } from './terrain-sprite-analyzer';

// Camera system

@Component({
  selector: 'app-tmonkeys',
  imports: [RouterLink, CommonModule],
  templateUrl: './monkeys.component.html',
  styleUrl: './monkeys.component.css',
})
export class MonkeysComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('gameCanvas', { static: true }) canvas!: ElementRef<HTMLCanvasElement>;
  private ctx!: CanvasRenderingContext2D;
  private terrainSpriteCanvas: HTMLCanvasElement | null = null;
  private terrainSpriteCtx: CanvasRenderingContext2D | null = null;
  private terrainSpriteAnalyzer = new TerrainSpriteAnalyzer();

  // Camera system
  private cameraController = new CameraController();

  // Setup timer
  private setupStartTime: number = 0;

  // Mouse control for camera
  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;

  // Loading flag
  private isLoading = false;

  // Player movement tracking
  private playerMovementStarted = false;

  // Prediction path toggle
  private showPrediction: boolean = true;

  // Turn message
  private turnMessage: string = '';
  private messageTimer: number = 0;
  private previousTurnId: string = '';
  private previousTurnState: string = '';

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
  private readonly TERRAIN_STRIP_HEIGHT = CONST.TERRAIN_STRIP_HEIGHT;
  private readonly DAMAGE_TEXT_LIFETIME = CONST.DAMAGE_TEXT_LIFETIME;
  private readonly DAMAGE_TEXT_FONT = CONST.DAMAGE_TEXT_FONT;
  private readonly EXPLOSION_OUTLINE_WIDTH = CONST.EXPLOSION_OUTLINE_WIDTH;
  private readonly DAMAGE_TEXT_COLOR = CONST.DAMAGE_TEXT_COLOR;
  private readonly EXPLOSION_EDGE_COLOR = CONST.EXPLOSION_EDGE_COLOR;
  private readonly EXPLOSION_OUTLINE_COLOR = CONST.EXPLOSION_OUTLINE_COLOR;
  private readonly EXPLOSION_MIDDLE_COLOR = CONST.EXPLOSION_MIDDLE_COLOR;
  private readonly EXPLOSION_CENTER_COLOR = CONST.EXPLOSION_CENTER_COLOR;
  private readonly EFFECT_SPRITE_FRAME_COUNT = 3;
  private readonly BULLET_SPRITE_FRAME_DURATION_MS = 90;
  private readonly EXPLOSION_SPRITE_FRAME_DURATION_MS = 110;
  private readonly BULLET_SPRITE_SIZE_MULTIPLIER = 5;
  private readonly EXPLOSION_SPRITE_SIZE_MULTIPLIER = 3.3;
  private readonly HURT_SPRITE_DURATION_MS = 300;
  private readonly DEATH_SPRITE_FRAME_DURATION_MS = 100;
  private readonly DEATH_SPRITE_FRAME_COUNT = 3;
  private readonly DEATH_SPRITE_FADE_DURATION_MS = 1000;
  private readonly SHOOT_CHARGE_FRAME_COUNT = 4;
  private readonly SHOOT_TOTAL_FRAME_COUNT = 10;
  private readonly SHOOT_CHARGE_FRAME_DURATION_MS = 150;
  private readonly SHOOT_RELEASE_FRAME_DURATION_MS = 150;
  private readonly TERRAIN_TOOL_ALPHA_THRESHOLD = 96;
  private readonly TERRAIN_TOOL_MINIMUM_PIXEL_COUNT = 24;
  private readonly TERRAIN_TOOL_OUTLINE_POINT_STRIDE = 1;

  // Tracks health deltas so we can trigger the hurt sprite when damage is applied.
  private previousHealthByEntity = new WeakMap<object, number>();
  private hurtSpriteUntilByEntity = new WeakMap<object, number>();
  private deathAnimationStartByEntity = new WeakMap<object, number>();
  private wasChargingByEntity = new WeakMap<object, boolean>();
  private shootReleaseStartByEntity = new WeakMap<object, number>();
  private terrainToolImage: HTMLImageElement | HTMLCanvasElement | null = null;
  private terrainToolRegions: TerrainSpriteRegion[] = [];
  private terrainToolSelectedRegionId: number | null = null;
  private terrainToolLoading = false;
  private terrainToolError = '';
  private terrainToolViewport: {
    x: number;
    y: number;
    width: number;
    height: number;
    scale: number;
  } | null = null;
  private terrainToolCopyStatus = '';
  private terrainToolCopyStatusUntil = 0;

  // Camera y-axis clamping bounds for manual drag
  private readonly CAMERA_Y_MIN = -200;
  private readonly CAMERA_Y_MAX = 200;

  // Menu button constants
  private readonly MENU_START_BUTTON = { x: this.CANVAS_WIDTH / 2, y: 420, width: 200, height: 50 };
  private readonly MENU_OPTIONS_BUTTON = {
    x: this.CANVAS_WIDTH / 2,
    y: 500,
    width: 200,
    height: 50,
  };
  private readonly MENU_TERRAIN_TOOL_BUTTON = {
    x: this.CANVAS_WIDTH / 2,
    y: 580,
    width: 200,
    height: 50,
  };
  private readonly OPTIONS_BACK_BUTTON = {
    x: this.CANVAS_WIDTH / 2,
    y: 300,
    width: 200,
    height: 50,
  };
  private readonly TERRAIN_TOOL_BACK_BUTTON = {
    x: this.CANVAS_WIDTH - 170,
    y: 48,
    width: 220,
    height: 44,
  };
  private readonly TERRAIN_TOOL_RESCAN_BUTTON = {
    x: this.CANVAS_WIDTH - 170,
    y: 102,
    width: 220,
    height: 44,
  };
  private readonly TERRAIN_TOOL_COPY_ALL_BUTTON = {
    x: this.CANVAS_WIDTH - 170,
    y: 156,
    width: 220,
    height: 44,
  };

  constructor(
    private gameService: MonkeysGameService,
    private spriteService: MonkeysSpriteService,
  ) {}

  ngOnInit() {
    this.gameService.currentState = GameState.MENU;
    this.spriteService.loadSprites().catch((error) => {
      console.error('Failed to load sprites:', error);
    });
  }

  ngAfterViewInit() {
    this.initCanvas();
    this.canvas.nativeElement.addEventListener('click', (event) => this.onCanvasClick(event));
    this.renderLoop();
  }

  ngOnDestroy() {
    this.gameService.destroy();
  }

  async startGame() {
    this.gameService.setMatterJS(Matter);
    this.canvas.nativeElement.focus();
    this.gameService.currentState = GameState.LOADING;
    this.isLoading = true;
    try {
      await Promise.all([this.gameService.initGame(), this.spriteService.loadTerrainSpritesheet()]);
    } catch (error) {
      console.error('Failed to start game:', error);
      this.gameService.currentState = GameState.MENU;
      this.isLoading = false;
      return;
    }
    this.isLoading = false;
    this.cameraController.reset();
    // Set up camera follow for player during setup
    this.cameraController.setFollowTarget(this.gameService.player);
    this.cameraController.enableFollow();
    this.setupStartTime = Date.now();
    this.previousHealthByEntity = new WeakMap<object, number>();
    this.hurtSpriteUntilByEntity = new WeakMap<object, number>();
    this.deathAnimationStartByEntity = new WeakMap<object, number>();
    this.wasChargingByEntity = new WeakMap<object, boolean>();
    this.shootReleaseStartByEntity = new WeakMap<object, number>();

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
    if (this.gameService.currentState === GameState.MENU) {
      this.drawMenu();
      return;
    }
    if (this.gameService.currentState === GameState.OPTIONS) {
      this.drawOptions();
      return;
    }
    if (this.gameService.currentState === GameState.TERRAIN_TOOL) {
      this.drawTerrainTool();
      return;
    }

    if (this.isLoading) {
      return;
    }

    this.updateShootSpriteState();
    this.updateHurtSpriteState();

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
      // Force camera pan to the first active turn holder when play begins.
      this.gameService.panToEntity = this.gameService.getCurrentTurnEntity();
    }

    const currentTurn = this.gameService.getCurrentTurnEntity();
    const currentTurnEntity = currentTurn?.entity;

    if (
      this.gameService.currentState === GameState.PLAYING &&
      currentTurnEntity &&
      !this.gameService.projectile &&
      this.gameService.explodedProjectiles.length === 0
    ) {
      this.cameraController.enableIdleMode();
    } else {
      this.cameraController.disableIdleMode();
    }

    if (this.isDragging) {
      this.cameraController.resetIdleModeActivityTimer();
    }

    if (currentTurn) {
      const stateNow = (currentTurn.entity as any).turnState as string;
      const isStateTransition =
        this.previousTurnId === currentTurn.id && this.previousTurnState !== stateNow;
      const shouldRefocusForAction = stateNow === 'moving' || stateNow === 'charging';
      if (isStateTransition && shouldRefocusForAction) {
        this.gameService.panToEntity = currentTurn;
      }
      this.previousTurnState = stateNow;
    }

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
      currentTurnEntity,
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
      if (!this.isDragging) {
        this.cameraController.panToEntity(this.gameService.panToEntity.entity);
        this.gameService.panToEntity = null;
      }
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

    // Update turn message
    if (currentTurn && currentTurn.id !== this.previousTurnId) {
      this.turnMessage = currentTurn.type === 'player' ? "Player's Turn" : "Enemy's Turn";
      this.messageTimer = 500;
      this.previousTurnId = currentTurn.id;
      this.previousTurnState = (currentTurn.entity as any).turnState as string;
      this.playerMovementStarted = false;
      console.log('Turn changed to:', this.turnMessage);
    }
    if (this.messageTimer > 0) {
      this.messageTimer -= 16;
      if (this.messageTimer <= 0) {
        this.turnMessage = '';
      }
    }

    // Draw sky (entire background)
    this.ctx.fillStyle = this.SKY_COLOR; // Sky blue
    this.ctx.fillRect(0, 0, this.CANVAS_WIDTH, this.CANVAS_HEIGHT);

    // Draw terrain
    this.drawTerrain();

    // Draw charge bars (behind tanks)
    if (this.gameService.isCharging) {
      this.drawChargeBar(this.gameService.player, this.gameService.player.maxPower);
    }
    for (const enemy of this.gameService.enemies) {
      if (enemy.active && enemy.turnState === 'charging') {
        this.drawChargeBar(enemy, enemy.vehicle.power);
      }
    }

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

  private drawChargeBar(entity: any, maxPower: number) {
    const barWidth = this.CHARGE_BAR_WIDTH;
    const barHeight = this.CHARGE_BAR_HEIGHT; // 50% shorter (was 60px)
    // Position further behind tank based on facing direction
    const offsetX = entity.facing === 1 ? -this.CHARGE_BAR_OFFSET_X : this.CHARGE_BAR_OFFSET_X; // Further left of tank when facing right, further right when facing left
    const worldX = entity.x + offsetX;
    const worldY = entity.y - barHeight / 2; // Center vertically on tank
    const screenPos = this.cameraController.worldToScreen(worldX, worldY);
    const barX = screenPos.x;
    const barY = screenPos.y;

    // Background
    this.ctx.fillStyle = this.CHARGE_BAR_BACKGROUND_COLOR;
    this.ctx.fillRect(barX, barY, barWidth, barHeight);

    // Charge level (bottom to top)
    const chargeRatio = entity.power / maxPower;
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
    const terrainY = Math.floor(
      this.CANVAS_HEIGHT - CONST.TERRAIN_BASE_Y_OFFSET - this.cameraController.camera.y,
    );
    const startX = Math.max(0, Math.floor(this.cameraController.camera.x));
    const endX = Math.min(
      CONST.TERRAIN_WIDTH,
      Math.ceil(this.cameraController.camera.x + CONST.CANVAS_WIDTH),
    );

    // Ensure offscreen canvas exists at viewport size
    if (
      !this.terrainSpriteCanvas ||
      this.terrainSpriteCanvas.width !== this.CANVAS_WIDTH ||
      this.terrainSpriteCanvas.height !== this.CANVAS_HEIGHT
    ) {
      this.terrainSpriteCanvas = document.createElement('canvas');
      this.terrainSpriteCanvas.width = this.CANVAS_WIDTH;
      this.terrainSpriteCanvas.height = this.CANVAS_HEIGHT;
      this.terrainSpriteCtx = this.terrainSpriteCanvas.getContext('2d');
    }

    const offCtx = this.terrainSpriteCtx!;
    offCtx.clearRect(0, 0, this.CANVAS_WIDTH, this.CANVAS_HEIGHT);

    const terrainSheet = this.spriteService.getSpritesheet(
      this.spriteService.TERRAIN_TOOL_SPRITESHEET,
    );
    if (terrainSheet) {
      // Interior fill first (behind surface pieces)
      for (const placement of this.gameService.terrainInteriorPlacements) {
        const { region, x: worldX, topWorldY } = placement;
        const screenX = Math.floor(worldX - this.cameraController.camera.x);
        const screenY = Math.floor(terrainY + topWorldY);
        if (screenX + region.width < 0 || screenX > this.CANVAS_WIDTH) continue;
        offCtx.drawImage(
          terrainSheet,
          region.x,
          region.y,
          region.width,
          region.height,
          screenX,
          screenY,
          region.width,
          region.height,
        );
      }
      // Bottom shell over interior so underside silhouette is visible
      for (const placement of this.gameService.terrainBottomPlacements) {
        const { region, x: worldX, topWorldY } = placement;
        const screenX = Math.floor(worldX - this.cameraController.camera.x);
        const screenY = Math.floor(terrainY + topWorldY);
        if (screenX + region.width < 0 || screenX > this.CANVAS_WIDTH) continue;
        offCtx.drawImage(
          terrainSheet,
          region.x,
          region.y,
          region.width,
          region.height,
          screenX,
          screenY,
          region.width,
          region.height,
        );
      }
      // Surface shell on top
      for (const placement of this.gameService.terrainChunkPlacements) {
        const { region, x: worldX, topWorldY } = placement;
        const screenX = Math.floor(worldX - this.cameraController.camera.x);
        const screenY = Math.floor(terrainY + topWorldY);
        if (screenX + region.width < 0 || screenX > this.CANVAS_WIDTH) continue;
        offCtx.drawImage(
          terrainSheet,
          region.x,
          region.y,
          region.width,
          region.height,
          screenX,
          screenY,
          region.width,
          region.height,
        );
      }
    }

    // Mask by removing air cells only, so sprite overhang above the collision top remains visible.
    // terrain=0 is air, terrain=1 is solid, terrain=2 is visual-only (bottom sprite overhang).
    offCtx.globalCompositeOperation = 'destination-out';
    offCtx.fillStyle = 'rgba(0,0,0,1)';
    for (let y = 0; y < this.TERRAIN_STRIP_HEIGHT; y++) {
      let segmentStart = -1;
      for (let x = startX; x < endX; x++) {
        if (this.gameService.terrain[x]?.[y] === 0) {
          if (segmentStart === -1) segmentStart = x;
        } else {
          if (segmentStart !== -1) {
            const sx = Math.floor(segmentStart - this.cameraController.camera.x);
            const ex = Math.floor(x - this.cameraController.camera.x);
            offCtx.fillRect(sx, terrainY + y, ex - sx, 1);
            segmentStart = -1;
          }
        }
      }
      if (segmentStart !== -1) {
        const sx = Math.floor(segmentStart - this.cameraController.camera.x);
        const ex = Math.floor(endX - this.cameraController.camera.x);
        offCtx.fillRect(sx, terrainY + y, ex - sx, 1);
      }
    }
    offCtx.globalCompositeOperation = 'source-over';

    // Brown fallback fill — visible through carved holes where sprites were erased
    this.ctx.fillStyle = CONST.TERRAIN_COLOR;
    for (let y = 0; y < this.TERRAIN_STRIP_HEIGHT; y++) {
      let segmentStart = -1;
      for (let x = startX; x < endX; x++) {
        if (this.gameService.terrain[x]?.[y] === 1) {
          if (segmentStart === -1) segmentStart = x;
        } else {
          if (segmentStart !== -1) {
            const sx = Math.floor(segmentStart - this.cameraController.camera.x);
            const ex = Math.floor(x - this.cameraController.camera.x);
            this.ctx.fillRect(sx, terrainY + y, ex - sx, 1);
            segmentStart = -1;
          }
        }
      }
      if (segmentStart !== -1) {
        const sx = Math.floor(segmentStart - this.cameraController.camera.x);
        const ex = Math.floor(endX - this.cameraController.camera.x);
        this.ctx.fillRect(sx, terrainY + y, ex - sx, 1);
      }
    }

    // Composite masked sprites over the colour fill
    this.ctx.drawImage(this.terrainSpriteCanvas!, 0, 0);
  }

  private drawPlayer() {
    if (
      this.gameService.player.health <= 0 &&
      !this.isEntityDeathAnimationActive(this.gameService.player)
    ) {
      return;
    }

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

    // Draw tank body sprite (or fallback shape) in front of barrel and aiming line
    const drewPlayerSprite = this.drawTankBody(
      this.gameService.player,
      centerX,
      centerY,
      bodyRadius,
    );

    // Keep track overlay only when using fallback shape.
    if (!drewPlayerSprite) {
      this.drawTankTracks(centerX, centerY, bodyRadius);
    }

    // Restore context
    this.ctx.restore();

    // Draw player prediction path when charging
    if (this.showPrediction && this.gameService.isCharging) {
      const angleRad = this.gameService.getBarrelAngle();
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

    // Draw UI elements (health and movement bars)
    this.drawEntityUI(this.gameService.player, centerX, centerY, bodyRadius, true);
  }

  private drawEnemies() {
    for (const enemy of this.gameService.enemies) {
      if (enemy.active || this.isEntityDeathAnimationActive(enemy)) {
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

    // Draw tank body sprite (or fallback shape) in front of barrel.
    const drewEnemySprite = this.drawEnemyBody(enemy, centerX, centerY, bodyRadius);

    // Keep track overlay only when using fallback shape.
    if (!drewEnemySprite) {
      this.drawTankTracks(centerX, centerY, bodyRadius);
    }

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
    const angleRad = (this.gameService.player.angle * Math.PI) / 180;
    this.drawCursorBarrel(centerX, centerY, angleRad);
  }

  private getCursorFrameIndex(now: number = Date.now()): number {
    const frameDuration = 90;
    return Math.floor(now / frameDuration) % 6;
  }

  private getBulletFrameIndex(now: number = Date.now()): number {
    return Math.floor(now / this.BULLET_SPRITE_FRAME_DURATION_MS) % this.EFFECT_SPRITE_FRAME_COUNT;
  }

  private getExplosionFrameIndex(now: number = Date.now()): number {
    return (
      Math.floor(now / this.EXPLOSION_SPRITE_FRAME_DURATION_MS) % this.EFFECT_SPRITE_FRAME_COUNT
    );
  }

  private drawCursorBarrel(centerX: number, centerY: number, angleRad: number) {
    const cursorFrameIndex = this.getCursorFrameIndex();
    const cursorSprite = this.spriteService.getSprite(`cursor_${cursorFrameIndex}`);

    // Fallback to original barrel shape if cursor sprite isn't loaded yet.
    if (!cursorSprite) {
      this.drawClassicBarrel(centerX, centerY, angleRad);
      return;
    }

    const pivotOffset = this.BARREL_LENGTH + 14;
    const scale = 0.84;
    const drawWidth = cursorSprite.width * scale;
    const drawHeight = cursorSprite.height * scale;
    const xNudge = -4;
    const yNudge = 0;

    this.ctx.save();
    this.ctx.translate(centerX, centerY);
    this.ctx.rotate(-angleRad);
    this.ctx.translate(pivotOffset + xNudge, yNudge);
    this.ctx.rotate(Math.PI / 2 + (20 * Math.PI) / 180);
    this.ctx.drawImage(
      cursorSprite.image,
      cursorSprite.x,
      cursorSprite.y,
      cursorSprite.width,
      cursorSprite.height,
      -drawWidth / 2,
      -drawHeight / 2,
      drawWidth,
      drawHeight,
    );
    this.ctx.restore();
  }

  private drawClassicBarrel(centerX: number, centerY: number, angleRad: number) {
    const barrelLength = this.BARREL_LENGTH;
    const barrelWidth = this.BARREL_WIDTH;

    this.ctx.save();
    this.ctx.translate(centerX, centerY);
    this.ctx.rotate(-angleRad);

    this.ctx.fillStyle = this.BARREL_COLOR;
    this.ctx.strokeStyle = this.BARREL_STROKE_COLOR;
    this.ctx.lineWidth = this.BARREL_STROKE_WIDTH;

    this.ctx.fillRect(0, -barrelWidth / 2, barrelLength, barrelWidth);
    this.ctx.strokeRect(0, -barrelWidth / 2, barrelLength, barrelWidth);

    this.ctx.fillStyle = this.BARREL_TIP_COLOR;
    this.ctx.fillRect(
      barrelLength - this.BARREL_TIP_LENGTH,
      -barrelWidth / 2 - 1,
      this.BARREL_TIP_LENGTH,
      barrelWidth + this.BARREL_TIP_EXTRA_HEIGHT,
    );

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

  private getMoveFrameIndex(now: number = Date.now()): number {
    const frameDurations = [150, 150, 150, 80];
    const cycleDuration = frameDurations.reduce((a, b) => a + b, 0);
    let t = now % cycleDuration;

    for (let i = 0; i < frameDurations.length; i++) {
      if (t < frameDurations[i]) {
        return i;
      }
      t -= frameDurations[i];
    }

    return 0;
  }

  private usesLupinSprites(entity: any): boolean {
    return entity?.vehicle?.spritesheet === 'Lupin.png';
  }

  private isEntityCharging(entity: any): boolean {
    if (entity === this.gameService.player) {
      return this.gameService.isCharging || entity.turnState === 'charging';
    }
    return entity?.turnState === 'charging';
  }

  private getShootChargeFrameIndex(entity: any, now: number = Date.now()): number | null {
    if (!this.usesLupinSprites(entity) || !this.isEntityCharging(entity)) {
      return null;
    }

    const chargeStartTime =
      entity === this.gameService.player
        ? this.gameService.chargeStartTime
        : (entity.chargeStartTime ?? now);
    const chargeElapsed = Math.max(0, now - chargeStartTime);
    const chargeFrameIndex = Math.floor(chargeElapsed / this.SHOOT_CHARGE_FRAME_DURATION_MS);
    return Math.min(this.SHOOT_CHARGE_FRAME_COUNT - 1, chargeFrameIndex);
  }

  private getShootReleaseFrameIndex(entity: any, now: number = Date.now()): number | null {
    if (!this.usesLupinSprites(entity)) {
      return null;
    }

    const releaseStartTime = this.shootReleaseStartByEntity.get(entity as object);
    if (releaseStartTime === undefined) {
      return null;
    }

    const releaseFrameCount = this.SHOOT_TOTAL_FRAME_COUNT - this.SHOOT_CHARGE_FRAME_COUNT;
    const releaseElapsed = Math.max(0, now - releaseStartTime);
    const releaseFrameIndex = Math.floor(releaseElapsed / this.SHOOT_RELEASE_FRAME_DURATION_MS);
    if (releaseFrameIndex >= releaseFrameCount) {
      this.shootReleaseStartByEntity.delete(entity as object);
      return null;
    }

    return this.SHOOT_CHARGE_FRAME_COUNT + releaseFrameIndex;
  }

  private updateShootSpriteState() {
    const now = Date.now();
    const trackedEntities = [this.gameService.player, ...this.gameService.enemies];

    for (const entity of trackedEntities) {
      if (!this.usesLupinSprites(entity)) {
        continue;
      }

      const key = entity as object;
      const isChargingNow = this.isEntityCharging(entity);
      const wasCharging = this.wasChargingByEntity.get(key) ?? false;

      if (isChargingNow) {
        this.shootReleaseStartByEntity.delete(key);
      } else if (wasCharging) {
        this.shootReleaseStartByEntity.set(key, now);
      }

      this.wasChargingByEntity.set(key, isChargingNow);
    }
  }

  private getDeathAnimationState(entity: any, now: number = Date.now()) {
    if (!this.usesLupinSprites(entity)) {
      return null;
    }

    const deathStartTime = this.deathAnimationStartByEntity.get(entity as object);
    if (deathStartTime === undefined) {
      return null;
    }

    const deathAnimationDuration =
      this.DEATH_SPRITE_FRAME_COUNT * this.DEATH_SPRITE_FRAME_DURATION_MS;
    const elapsed = now - deathStartTime;
    const clampedElapsed = Math.max(0, elapsed);
    const fadeElapsed = Math.max(0, clampedElapsed - deathAnimationDuration);
    const fadeProgress = Math.min(1, fadeElapsed / this.DEATH_SPRITE_FADE_DURATION_MS);
    const frameIndex = Math.min(
      this.DEATH_SPRITE_FRAME_COUNT - 1,
      Math.floor(clampedElapsed / this.DEATH_SPRITE_FRAME_DURATION_MS),
    );

    return {
      frameIndex,
      alpha: 1 - fadeProgress,
      isActive: clampedElapsed < deathAnimationDuration + this.DEATH_SPRITE_FADE_DURATION_MS,
    };
  }

  private isEntityDeathAnimationActive(entity: any, now: number = Date.now()): boolean {
    return this.getDeathAnimationState(entity, now)?.isActive ?? false;
  }

  private drawEntitySprite(
    entity: any,
    centerX: number,
    centerY: number,
    bodyRadius: number,
  ): boolean {
    if (!this.usesLupinSprites(entity)) {
      return false;
    }

    const now = Date.now();
    const deathAnimationState = this.getDeathAnimationState(entity, now);
    const isHurt = (this.hurtSpriteUntilByEntity.get(entity as object) ?? 0) > now;
    const shootReleaseFrameIndex = this.getShootReleaseFrameIndex(entity, now);
    const shootChargeFrameIndex = this.getShootChargeFrameIndex(entity, now);
    const velocityX = entity?.body?.velocity?.x ?? 0;
    const velocityY = entity?.body?.velocity?.y ?? 0;
    const isMoving = Math.hypot(velocityX, velocityY) > 0.1;
    const spriteName = deathAnimationState?.isActive
      ? `monkey_death_${deathAnimationState.frameIndex}`
      : isHurt
        ? 'monkey_hurt'
        : shootReleaseFrameIndex !== null
          ? `monkey_shoot_${shootReleaseFrameIndex}`
          : shootChargeFrameIndex !== null
            ? `monkey_shoot_${shootChargeFrameIndex}`
            : isMoving
              ? `monkey_move_${this.getMoveFrameIndex(now)}`
              : 'monkey_idle';
    const sprite = this.spriteService.getSprite(spriteName);

    if (!sprite) {
      return false;
    }

    const spriteSize = bodyRadius * 2 * 1.5;
    const spriteYOffset = -15;

    // Mirror over the y-axis so sprite facing matches gameplay orientation.
    this.ctx.save();
    this.ctx.translate(centerX, centerY);
    this.ctx.scale(-1, 1);
    if (deathAnimationState?.isActive) {
      this.ctx.globalAlpha = deathAnimationState.alpha;
    }
    this.ctx.drawImage(
      sprite.image,
      sprite.x,
      sprite.y,
      sprite.width,
      sprite.height,
      -spriteSize / 2,
      -spriteSize / 2 + spriteYOffset,
      spriteSize,
      spriteSize,
    );
    this.ctx.restore();

    return true;
  }

  private updateHurtSpriteState() {
    const now = Date.now();
    this.trackEntityDamage(this.gameService.player, now);
    for (const enemy of this.gameService.enemies) {
      this.trackEntityDamage(enemy, now);
    }
  }

  private trackEntityDamage(entity: any, now: number) {
    if (!this.usesLupinSprites(entity)) {
      return;
    }

    const key = entity as object;
    const currentHealth = Number(entity?.health ?? 0);
    const previousHealth = this.previousHealthByEntity.get(key);

    if (previousHealth !== undefined && currentHealth < previousHealth) {
      if (currentHealth <= 0) {
        if (!this.deathAnimationStartByEntity.has(key)) {
          this.deathAnimationStartByEntity.set(key, now);
        }
      } else {
        this.hurtSpriteUntilByEntity.set(key, now + this.HURT_SPRITE_DURATION_MS);
      }
    }

    this.previousHealthByEntity.set(key, currentHealth);
  }

  private drawTankBody(player: any, centerX: number, centerY: number, bodyRadius: number): boolean {
    if (this.drawEntitySprite(player, centerX, centerY, bodyRadius)) {
      return true;
    }

    // Fallback body if sprites are not loaded.
    this.ctx.fillStyle = this.gameService.player.color;
    this.ctx.strokeStyle = this.TANK_BODY_STROKE_COLOR;
    this.ctx.lineWidth = this.TANK_BODY_STROKE_WIDTH;

    this.ctx.beginPath();
    this.ctx.arc(centerX, centerY, bodyRadius, Math.PI, 0, false);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.stroke();
    return false;
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
    if (!entity || !entity.vehicle || typeof entity.health !== 'number') {
      return;
    }

    if (entity.health <= 0) {
      return;
    }

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
    const angleDeg = this.gameService.getEntityDisplayedAngle(entity);
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
    // Use enemy angle for aiming animation
    const angleRad = (enemy.angle * Math.PI) / 180;
    this.drawCursorBarrel(centerX, centerY, angleRad);
  }

  private drawEnemyBody(enemy: any, centerX: number, centerY: number, bodyRadius: number): boolean {
    if (this.drawEntitySprite(enemy, centerX, centerY, bodyRadius)) {
      return true;
    }

    // Fallback body if sprites are not loaded.
    this.ctx.fillStyle = '#FF6B6B';
    this.ctx.strokeStyle = this.TANK_BODY_STROKE_COLOR;
    this.ctx.lineWidth = this.TANK_BODY_STROKE_WIDTH;

    this.ctx.beginPath();
    this.ctx.arc(centerX, centerY, bodyRadius, Math.PI, 0, false);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.stroke();
    return false;
  }

  private drawProjectile() {
    const bulletFrameIndex = this.getBulletFrameIndex();
    const bulletSprite = this.spriteService.getSprite(`bullet_${bulletFrameIndex}`);

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
      if (bulletSprite) {
        const drawSize = this.PROJECTILE_DRAW_RADIUS * this.BULLET_SPRITE_SIZE_MULTIPLIER;
        this.ctx.drawImage(
          bulletSprite.image,
          bulletSprite.x,
          bulletSprite.y,
          bulletSprite.width,
          bulletSprite.height,
          screenPos.x - drawSize / 2,
          screenPos.y - drawSize / 2,
          drawSize,
          drawSize,
        );
      } else {
        this.ctx.fillStyle = this.PROJECTILE_COLOR;
        this.ctx.beginPath();
        this.ctx.arc(screenPos.x, screenPos.y, this.PROJECTILE_DRAW_RADIUS, 0, Math.PI * 2);
        this.ctx.fill();
      }
    } else if (this.gameService.explodedProjectiles.length > 0) {
      const ep = this.gameService.explodedProjectiles[0];
      const screenPos = this.cameraController.worldToScreen(ep.position.x, ep.position.y);
      if (bulletSprite) {
        const drawSize = this.PROJECTILE_DRAW_RADIUS * this.BULLET_SPRITE_SIZE_MULTIPLIER;
        this.ctx.drawImage(
          bulletSprite.image,
          bulletSprite.x,
          bulletSprite.y,
          bulletSprite.width,
          bulletSprite.height,
          screenPos.x - drawSize / 2,
          screenPos.y - drawSize / 2,
          drawSize,
          drawSize,
        );
      } else {
        this.ctx.fillStyle = this.PROJECTILE_COLOR;
        this.ctx.beginPath();
        this.ctx.arc(screenPos.x, screenPos.y, this.PROJECTILE_DRAW_RADIUS, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }
  }

  private drawExplosions() {
    const explosionFrameIndex = this.getExplosionFrameIndex();
    const explosionSprite = this.spriteService.getSprite(`explosion_${explosionFrameIndex}`);

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

      if (explosionSprite) {
        let spriteWidth = explosion.radius * this.EXPLOSION_SPRITE_SIZE_MULTIPLIER;
        let spriteHeight = explosion.radius * this.EXPLOSION_SPRITE_SIZE_MULTIPLIER;

        if (explosion.shape === 'horizontal_oval') {
          spriteWidth *= 1.5;
        } else if (explosion.shape === 'vertical_oval') {
          spriteHeight *= 1.5;
        }

        this.ctx.drawImage(
          explosionSprite.image,
          explosionSprite.x,
          explosionSprite.y,
          explosionSprite.width,
          explosionSprite.height,
          screenPos.x - spriteWidth / 2,
          screenPos.y - spriteHeight / 2,
          spriteWidth,
          spriteHeight,
        );
      }
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

    // Draw turn message
    if (this.turnMessage) {
      this.ctx.fillStyle = '#FFFFFF';
      this.ctx.font = '24px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(this.turnMessage, this.CANVAS_WIDTH / 2, this.CANVAS_HEIGHT / 2);
      this.ctx.textAlign = 'left';
    }

    // Draw pause/game over message
    if (this.gameService.currentState === GameState.PAUSED) {
      this.ctx.fillStyle = '#FFFFFF';
      this.ctx.font = '32px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.fillText('Paused', this.CANVAS_WIDTH / 2, this.CANVAS_HEIGHT / 2);
      this.ctx.textAlign = 'left';
    } else if (
      this.gameService.currentState === GameState.GAME_OVER_DELAY ||
      this.gameService.currentState === GameState.GAME_OVER
    ) {
      this.ctx.fillStyle = '#FFFFFF';
      this.ctx.font = '32px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.fillText('Game Over', this.CANVAS_WIDTH / 2, this.CANVAS_HEIGHT / 2);
      this.ctx.textAlign = 'left';
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

  private renderLoop() {
    if (
      this.gameService.currentState !== GameState.MENU &&
      this.gameService.currentState !== GameState.OPTIONS &&
      this.gameService.currentState !== GameState.TERRAIN_TOOL
    ) {
      this.gameService.update();
    }
    this.render();
    requestAnimationFrame(() => this.renderLoop());
  }

  onKeyDown(event: KeyboardEvent) {
    // Prevent default browser behavior for game controls
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(event.key)) {
      event.preventDefault();
    }
    if (this.gameService.currentState === GameState.GAME_OVER_DELAY) {
      return;
    }
    if (event.key === 'p' || event.key === 'P') {
      this.showPrediction = !this.showPrediction;
      event.preventDefault();
    }
    if (event.key === 'Escape') {
      if (this.gameService.currentState === GameState.TERRAIN_TOOL) {
        this.gameService.currentState = GameState.MENU;
        event.preventDefault();
        return;
      }
      if (this.gameService.currentState === GameState.PLAYING) {
        this.gameService.currentState = GameState.PAUSED;
        this.gameService.pausePhysics();
      } else if (this.gameService.currentState === GameState.PAUSED) {
        this.gameService.currentState = GameState.PLAYING;
        this.gameService.resumePhysics();
      }
      event.preventDefault();
    }
    if (event.key === 'r' || event.key === 'R') {
      if (this.gameService.currentState === GameState.GAME_OVER) {
        this.gameService.currentState = GameState.MENU;
      }
      event.preventDefault();
    }
    this.gameService.keys[event.key] = true;
  }

  onKeyUp(event: KeyboardEvent) {
    if (this.gameService.currentState === GameState.GAME_OVER_DELAY) {
      this.gameService.keys[event.key] = false;
      return;
    }

    // Handle spacebar release for shooting
    if (event.key === ' ') {
      if (this.gameService.isCharging && !this.gameService.projectile) {
        this.gameService.shoot();
      }
      this.gameService.isCharging = false;
    }
    this.gameService.keys[event.key] = false;
  }

  /**
   * Clamps camera Y-axis to defined bounds for manual drag
   * @param y The Y coordinate to clamp
   * @returns The clamped Y coordinate
   */
  private clampCameraY(y: number): number {
    return Math.max(this.CAMERA_Y_MIN, Math.min(this.CAMERA_Y_MAX, y));
  }

  onMouseMove(event: MouseEvent) {
    if (
      this.gameService.currentState === GameState.GAME_OVER_DELAY ||
      this.gameService.currentState === GameState.TERRAIN_TOOL
    ) {
      this.isDragging = false;
      return;
    }

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
      this.cameraController.camera.y = this.clampCameraY(this.cameraController.camera.y);
      this.lastMouseX = event.clientX;
      this.lastMouseY = event.clientY;
    }

    // Edge scrolling removed - only drag works now
  }

  onMouseDown(event: MouseEvent) {
    if (
      this.gameService.currentState === GameState.GAME_OVER_DELAY ||
      this.gameService.currentState === GameState.TERRAIN_TOOL
    ) {
      return;
    }

    this.cameraController.cancelPan();
    this.cameraController.resetIdleModeActivityTimer();
    this.isDragging = true;
    this.lastMouseX = event.clientX;
    this.lastMouseY = event.clientY;
  }

  onMouseUp() {
    if (
      this.gameService.currentState === GameState.GAME_OVER_DELAY ||
      this.gameService.currentState === GameState.TERRAIN_TOOL
    ) {
      this.isDragging = false;
      return;
    }

    this.isDragging = false;
    this.cameraController.lastActivityTime = Date.now();
  }

  @HostListener('window:resize')
  onResize() {
    this.updateCanvasScale();
  }

  private drawMenu() {
    // Background
    this.ctx.fillStyle = this.SKY_COLOR;
    this.ctx.fillRect(0, 0, this.CANVAS_WIDTH, this.CANVAS_HEIGHT);

    // Title
    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.font = 'bold 48px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Monkeys', this.CANVAS_WIDTH / 2, 120);

    // Subtitle
    this.ctx.font = '24px Arial';
    this.ctx.fillText('A physics-based tank battle game', this.CANVAS_WIDTH / 2, 160);

    // Draw idle sprite
    const idleSprite = this.spriteService.getSprite('monkey_idle');
    if (idleSprite) {
      this.ctx.drawImage(
        idleSprite.image,
        idleSprite.x,
        idleSprite.y,
        idleSprite.width,
        idleSprite.height,
        this.CANVAS_WIDTH / 2 - 32, // Center horizontally (64/2 = 32)
        200, // Position below subtitle
        64,
        64,
      );
    }

    // Draw move animation below idle sprite
    const moveFrameIndex = Math.floor(Date.now() / 120) % 4;
    const moveSprite = this.spriteService.getSprite(`monkey_move_${moveFrameIndex}`);
    if (moveSprite) {
      this.ctx.drawImage(
        moveSprite.image,
        moveSprite.x,
        moveSprite.y,
        moveSprite.width,
        moveSprite.height,
        this.CANVAS_WIDTH / 2 - 32,
        280,
        64,
        64,
      );
    }

    // Draw buttons
    this.drawButton(
      'Start Game',
      this.MENU_START_BUTTON.x,
      this.MENU_START_BUTTON.y,
      this.MENU_START_BUTTON.width,
      this.MENU_START_BUTTON.height,
      '#4CAF50',
      '#45a049',
    );
    this.drawButton(
      'Options',
      this.MENU_OPTIONS_BUTTON.x,
      this.MENU_OPTIONS_BUTTON.y,
      this.MENU_OPTIONS_BUTTON.width,
      this.MENU_OPTIONS_BUTTON.height,
      '#2196F3',
      '#1976D2',
    );
    this.drawButton(
      'Terrain Tool',
      this.MENU_TERRAIN_TOOL_BUTTON.x,
      this.MENU_TERRAIN_TOOL_BUTTON.y,
      this.MENU_TERRAIN_TOOL_BUTTON.width,
      this.MENU_TERRAIN_TOOL_BUTTON.height,
      '#9C6ADE',
      '#7C4DCC',
    );
  }

  private drawOptions() {
    // Background
    this.ctx.fillStyle = this.SKY_COLOR;
    this.ctx.fillRect(0, 0, this.CANVAS_WIDTH, this.CANVAS_HEIGHT);

    // Title
    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.font = 'bold 48px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Options', this.CANVAS_WIDTH / 2, 120);

    // Placeholder for options
    this.ctx.font = '24px Arial';
    this.ctx.fillText('Options menu - coming soon!', this.CANVAS_WIDTH / 2, 200);

    // Back button
    this.drawButton(
      'Back to Menu',
      this.OPTIONS_BACK_BUTTON.x,
      this.OPTIONS_BACK_BUTTON.y,
      this.OPTIONS_BACK_BUTTON.width,
      this.OPTIONS_BACK_BUTTON.height,
      '#FF9800',
      '#F57C00',
    );
  }

  private drawTerrainTool() {
    this.ctx.fillStyle = '#13202B';
    this.ctx.fillRect(0, 0, this.CANVAS_WIDTH, this.CANVAS_HEIGHT);

    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.font = 'bold 36px Arial';
    this.ctx.textAlign = 'left';
    this.ctx.fillText('Terrain Tool', 24, 48);

    this.ctx.font = '16px Arial';
    this.ctx.fillStyle = '#C7D5E0';
    this.ctx.fillText('Connected-component bounds detection for Dragon Road (Tiles).png', 24, 76);

    this.ctx.fillStyle = '#0E1720';
    this.ctx.fillRect(20, 96, 820, 600);
    this.ctx.fillStyle = '#101A25';
    this.ctx.fillRect(860, 96, 320, 600);

    this.drawButton(
      'Back to Menu',
      this.TERRAIN_TOOL_BACK_BUTTON.x,
      this.TERRAIN_TOOL_BACK_BUTTON.y,
      this.TERRAIN_TOOL_BACK_BUTTON.width,
      this.TERRAIN_TOOL_BACK_BUTTON.height,
      '#FF9800',
      '#F57C00',
    );
    this.drawButton(
      'Rescan Sheet',
      this.TERRAIN_TOOL_RESCAN_BUTTON.x,
      this.TERRAIN_TOOL_RESCAN_BUTTON.y,
      this.TERRAIN_TOOL_RESCAN_BUTTON.width,
      this.TERRAIN_TOOL_RESCAN_BUTTON.height,
      '#1565C0',
      '#0D47A1',
    );
    this.drawButton(
      'Copy All Regions',
      this.TERRAIN_TOOL_COPY_ALL_BUTTON.x,
      this.TERRAIN_TOOL_COPY_ALL_BUTTON.y,
      this.TERRAIN_TOOL_COPY_ALL_BUTTON.width,
      this.TERRAIN_TOOL_COPY_ALL_BUTTON.height,
      '#2E7D32',
      '#1B5E20',
    );

    if (this.terrainToolCopyStatus && Date.now() < this.terrainToolCopyStatusUntil) {
      this.ctx.fillStyle = '#D8E2EA';
      this.ctx.font = '14px Arial';
      this.ctx.textAlign = 'right';
      this.ctx.fillText(this.terrainToolCopyStatus, this.CANVAS_WIDTH - 20, 206);
      this.ctx.textAlign = 'left';
    }

    if (this.terrainToolLoading) {
      this.terrainToolViewport = null;
      this.ctx.fillStyle = '#FFFFFF';
      this.ctx.font = '24px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.fillText('Loading terrain spritesheet...', 430, 396);
      this.ctx.textAlign = 'left';
      this.drawTerrainToolSidebar();
      return;
    }

    if (this.terrainToolError) {
      this.terrainToolViewport = null;
      this.ctx.fillStyle = '#FF8A80';
      this.ctx.font = '20px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(this.terrainToolError, 430, 396);
      this.ctx.textAlign = 'left';
      this.drawTerrainToolSidebar();
      return;
    }

    if (!this.terrainToolImage) {
      this.terrainToolViewport = null;
      this.ctx.fillStyle = '#FFFFFF';
      this.ctx.font = '20px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.fillText('No terrain sheet loaded.', 430, 396);
      this.ctx.textAlign = 'left';
      this.drawTerrainToolSidebar();
      return;
    }

    const viewport = this.getTerrainToolViewport(this.terrainToolImage);
    this.terrainToolViewport = viewport;

    this.ctx.drawImage(
      this.terrainToolImage,
      viewport.x,
      viewport.y,
      viewport.width,
      viewport.height,
    );

    this.ctx.strokeStyle = '#FFFFFF';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(viewport.x, viewport.y, viewport.width, viewport.height);

    for (const region of this.terrainToolRegions) {
      const isSelected = region.id === this.terrainToolSelectedRegionId;
      const drawX = viewport.x + region.x * viewport.scale;
      const drawY = viewport.y + region.y * viewport.scale;
      const drawWidth = Math.max(1, region.width * viewport.scale);
      const drawHeight = Math.max(1, region.height * viewport.scale);

      if (isSelected) {
        this.ctx.fillStyle = 'rgba(255, 235, 59, 0.18)';
        this.ctx.fillRect(drawX, drawY, drawWidth, drawHeight);
      }

      this.ctx.strokeStyle = isSelected ? '#FFEB3B' : '#4DD0E1';
      this.ctx.lineWidth = isSelected ? 2 : 1;
      this.ctx.strokeRect(drawX, drawY, drawWidth, drawHeight);

      this.ctx.fillStyle = isSelected ? '#FFEB3B' : '#4DD0E1';
      this.ctx.font = '12px Arial';
      this.ctx.fillText(`${region.id}`, drawX + 2, Math.max(12, drawY - 4));
    }

    this.drawTerrainToolSidebar();
  }

  private drawTerrainToolSidebar() {
    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.font = 'bold 20px Arial';
    this.ctx.textAlign = 'left';
    this.ctx.fillText('Sheet Info', 880, 136);

    this.ctx.font = '15px Arial';
    this.ctx.fillStyle = '#D8E2EA';
    const spritesheetLabel = this.spriteService.TERRAIN_TOOL_SPRITESHEET;
    this.ctx.fillText(`File: ${spritesheetLabel}`, 880, 168);

    if (this.terrainToolImage) {
      this.ctx.fillText(
        `Sheet size: ${this.terrainToolImage.width} x ${this.terrainToolImage.height}`,
        880,
        194,
      );
    }
    this.ctx.fillText(`Detected regions: ${this.terrainToolRegions.length}`, 880, 220);
    this.ctx.fillText(`Alpha threshold: ${this.TERRAIN_TOOL_ALPHA_THRESHOLD}`, 880, 246);
    this.ctx.fillText(`Min pixels: ${this.TERRAIN_TOOL_MINIMUM_PIXEL_COUNT}`, 880, 272);
    this.ctx.fillText('Copy All Regions exports detector output as JSON.', 880, 298);

    const selectedRegion = this.getSelectedTerrainToolRegion();
    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.font = 'bold 20px Arial';
    this.ctx.fillText('Selection', 880, 340);

    if (!selectedRegion) {
      this.ctx.fillStyle = '#D8E2EA';
      this.ctx.font = '15px Arial';
      this.ctx.fillText('Click a detected region to inspect it.', 880, 370);
      return;
    }

    this.ctx.fillStyle = '#D8E2EA';
    this.ctx.font = '15px Arial';
    this.ctx.fillText(`Region: ${selectedRegion.id}`, 880, 370);
    this.ctx.fillText(`Bounds: (${selectedRegion.x}, ${selectedRegion.y})`, 880, 396);
    this.ctx.fillText(`Size: ${selectedRegion.width} x ${selectedRegion.height}`, 880, 422);
    this.ctx.fillText(`Solid pixels: ${selectedRegion.pixelCount}`, 880, 448);
    this.ctx.fillText(`Outline samples: ${selectedRegion.outline.length}`, 880, 474);
    this.ctx.fillText('Outline preview', 880, 508);

    this.drawTerrainToolRegionPreview(selectedRegion, 890, 528, 260, 146);
  }

  private drawTerrainToolRegionPreview(
    region: TerrainSpriteRegion,
    x: number,
    y: number,
    maxWidth: number,
    maxHeight: number,
  ) {
    if (!this.terrainToolImage) {
      return;
    }

    this.ctx.fillStyle = '#071019';
    this.ctx.fillRect(x, y, maxWidth, maxHeight);

    const scale = Math.min(maxWidth / region.width, maxHeight / region.height);
    const drawWidth = region.width * scale;
    const drawHeight = region.height * scale;
    const drawX = x + (maxWidth - drawWidth) / 2;
    const drawY = y + (maxHeight - drawHeight) / 2;

    this.ctx.drawImage(
      this.terrainToolImage,
      region.x,
      region.y,
      region.width,
      region.height,
      drawX,
      drawY,
      drawWidth,
      drawHeight,
    );

    const pointSize = Math.max(1, Math.ceil(scale));
    this.ctx.fillStyle = '#FF5252';
    for (const point of region.outline) {
      this.ctx.fillRect(drawX + point.x * scale, drawY + point.y * scale, pointSize, pointSize);
    }

    this.ctx.strokeStyle = '#FFFFFF';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(drawX, drawY, drawWidth, drawHeight);
  }

  private getTerrainToolViewport(image: HTMLImageElement | HTMLCanvasElement) {
    const left = 32;
    const top = 112;
    const maxWidth = 796;
    const maxHeight = 568;
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
    const width = image.width * scale;
    const height = image.height * scale;

    return {
      x: left + (maxWidth - width) / 2,
      y: top + (maxHeight - height) / 2,
      width,
      height,
      scale,
    };
  }

  private getSelectedTerrainToolRegion(): TerrainSpriteRegion | null {
    if (this.terrainToolSelectedRegionId === null) {
      return null;
    }

    return (
      this.terrainToolRegions.find((region) => region.id === this.terrainToolSelectedRegionId) ??
      null
    );
  }

  private async openTerrainTool(forceRescan: boolean = false) {
    this.gameService.currentState = GameState.TERRAIN_TOOL;
    this.terrainToolError = '';

    if (this.terrainToolLoading) {
      return;
    }

    if (this.terrainToolImage && this.terrainToolRegions.length > 0 && !forceRescan) {
      return;
    }

    this.terrainToolLoading = true;
    try {
      this.terrainToolImage = await this.spriteService.loadTerrainSpritesheet();
      this.terrainToolRegions = this.terrainSpriteAnalyzer.analyze(this.terrainToolImage, {
        alphaThreshold: this.TERRAIN_TOOL_ALPHA_THRESHOLD,
        minimumPixelCount: this.TERRAIN_TOOL_MINIMUM_PIXEL_COUNT,
        outlinePointStride: this.TERRAIN_TOOL_OUTLINE_POINT_STRIDE,
      });
      this.terrainToolSelectedRegionId = this.terrainToolRegions[0]?.id ?? null;
      if (forceRescan) {
        this.setTerrainToolCopyStatus('Sheet rescanned.');
      }
    } catch (error) {
      console.error('Failed to open terrain tool:', error);
      this.terrainToolError = 'Failed to load or analyze Dragon Road (Tiles).png';
    } finally {
      this.terrainToolLoading = false;
    }
  }

  private handleTerrainToolClick(x: number, y: number) {
    if (this.isPointInsideButton(x, y, this.TERRAIN_TOOL_BACK_BUTTON)) {
      this.gameService.currentState = GameState.MENU;
      return;
    }

    if (this.isPointInsideButton(x, y, this.TERRAIN_TOOL_RESCAN_BUTTON)) {
      void this.openTerrainTool(true);
      return;
    }

    if (this.isPointInsideButton(x, y, this.TERRAIN_TOOL_COPY_ALL_BUTTON)) {
      void this.copyAllTerrainToolRegions();
      return;
    }

    if (!this.terrainToolViewport) {
      return;
    }

    const viewport = this.terrainToolViewport;
    const isInsideSheet =
      x >= viewport.x &&
      x <= viewport.x + viewport.width &&
      y >= viewport.y &&
      y <= viewport.y + viewport.height;
    if (!isInsideSheet) {
      return;
    }

    const imageX = Math.floor((x - viewport.x) / viewport.scale);
    const imageY = Math.floor((y - viewport.y) / viewport.scale);
    const selectedRegion = this.terrainToolRegions
      .filter(
        (region) =>
          imageX >= region.x &&
          imageX < region.x + region.width &&
          imageY >= region.y &&
          imageY < region.y + region.height,
      )
      .sort((left, right) => left.width * left.height - right.width * right.height)[0];

    this.terrainToolSelectedRegionId = selectedRegion?.id ?? null;
  }

  private async copyAllTerrainToolRegions() {
    if (this.terrainToolRegions.length === 0) {
      this.setTerrainToolCopyStatus('No regions available to copy.');
      return;
    }

    const exportPayload = JSON.stringify(this.buildTerrainToolExportPayload(), null, 2);

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(exportPayload);
      } else {
        this.copyTextWithFallback(exportPayload);
      }
      this.setTerrainToolCopyStatus(`Copied ${this.terrainToolRegions.length} regions.`);
    } catch (error) {
      console.error('Failed to copy terrain tool regions:', error);
      try {
        this.copyTextWithFallback(exportPayload);
        this.setTerrainToolCopyStatus(`Copied ${this.terrainToolRegions.length} regions.`);
      } catch (fallbackError) {
        console.error('Fallback copy also failed:', fallbackError);
        this.setTerrainToolCopyStatus('Copy failed. Clipboard access was blocked.');
      }
    }
  }

  private buildTerrainToolExportPayload() {
    return {
      spritesheets: {},
      sprites: this.terrainToolRegions.map((region) => ({
        name: `terrain_region_${region.id}`,
        spritesheet: this.spriteService.TERRAIN_TOOL_SPRITESHEET,
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
        pixelCount: region.pixelCount,
        outline: region.outline,
      })),
      analysis: {
        alphaThreshold: this.TERRAIN_TOOL_ALPHA_THRESHOLD,
        minimumPixelCount: this.TERRAIN_TOOL_MINIMUM_PIXEL_COUNT,
        regionCount: this.terrainToolRegions.length,
      },
    };
  }

  private copyTextWithFallback(text: string) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    const didCopy = document.execCommand('copy');
    document.body.removeChild(textarea);

    if (!didCopy) {
      throw new Error('document.execCommand(copy) returned false');
    }
  }

  private setTerrainToolCopyStatus(message: string) {
    this.terrainToolCopyStatus = message;
    this.terrainToolCopyStatusUntil = Date.now() + 3000;
  }

  private isPointInsideButton(
    x: number,
    y: number,
    button: { x: number; y: number; width: number; height: number },
  ): boolean {
    return (
      x >= button.x - button.width / 2 &&
      x <= button.x + button.width / 2 &&
      y >= button.y - button.height / 2 &&
      y <= button.y + button.height / 2
    );
  }

  private drawButton(
    text: string,
    x: number,
    y: number,
    width: number,
    height: number,
    color: string,
    hoverColor: string,
  ) {
    // Button background
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x - width / 2, y - height / 2, width, height);

    // Button border
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(x - width / 2, y - height / 2, width, height);

    // Button text
    this.ctx.fillStyle = '#ffffff';
    this.ctx.font = 'bold 16px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(text, x, y + 6);
  }

  private onCanvasClick(event: MouseEvent) {
    const rect = this.canvas.nativeElement.getBoundingClientRect();
    const x = (event.clientX - rect.left) / this.canvasScale;
    const y = (event.clientY - rect.top) / this.canvasScale;

    if (this.gameService.currentState === GameState.MENU) {
      this.handleMenuClick(x, y);
    } else if (this.gameService.currentState === GameState.OPTIONS) {
      this.handleOptionsClick(x, y);
    } else if (this.gameService.currentState === GameState.TERRAIN_TOOL) {
      this.handleTerrainToolClick(x, y);
    }
  }

  private handleMenuClick(x: number, y: number) {
    // Check Start Game button
    if (this.isPointInsideButton(x, y, this.MENU_START_BUTTON)) {
      void this.startGame();
      return;
    }

    // Check Options button
    if (this.isPointInsideButton(x, y, this.MENU_OPTIONS_BUTTON)) {
      this.gameService.currentState = GameState.OPTIONS;
      return;
    }

    if (this.isPointInsideButton(x, y, this.MENU_TERRAIN_TOOL_BUTTON)) {
      void this.openTerrainTool();
    }
  }

  private handleOptionsClick(x: number, y: number) {
    // Check Back button
    if (this.isPointInsideButton(x, y, this.OPTIONS_BACK_BUTTON)) {
      this.gameService.currentState = GameState.MENU;
    }
  }
}
