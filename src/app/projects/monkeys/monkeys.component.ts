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
import {
  Player,
  GameState,
  Explosion,
  DamageText,
  TerrainSpriteRegion,
  TerrainChunkPlacement,
  BackgroundSpriteMetadata,
  EquipmentSlot,
  EquipmentItem,
  EquipmentStats,
  LayerOffsetData,
  LayerFrameOffset,
  RenderCommand,
} from './monkeys.types';
import * as CONST from './monkeys.constants';
import { MonkeysGameService } from './monkeys-game.service';
import { MonkeysSpriteService, SpriteData } from './monkeys-sprite.service';
import { MonkeysAudioService } from './monkeys-audio.service';
import { MonkeysSfxService } from './monkeys-sfx.service';
import { ShieldAnimationService } from './shield-animation.service';
import { CameraController } from './camera-controller';
import { TerrainSpriteAnalyzer } from './terrain-sprite-analyzer';
import { MonkeysRenderContext } from './monkeys-render-context';
import { MonkeysBackgroundRenderer } from './monkeys-background.renderer';
import { MonkeysEffectsRenderer } from './monkeys-effects.renderer';
import { MonkeysEntityRenderer } from './monkeys-entity.renderer';
import { MonkeysUIRenderer, isPointInsideButton } from './monkeys-ui.renderer';
import { MonkeysDevToolsRenderer } from './monkeys-dev-tools.renderer';

// Camera system

// Physics config + runtime state for a row of letters that drop in with bounce.
interface BouncingLetterAnimConfig {
  letterSize: number;
  staggerMs: number;
  gravity: number;
  bounce: number;
  minBounceVY: number;
  advanceRatio: number;
  targetYFn: (i: number) => number;
}
interface BouncingLetterAnimState {
  cfg: BouncingLetterAnimConfig;
  letterY: number[];
  letterVY: number[];
  animStart: number; // 0 = not yet started
  animLastTs: number;
}

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
  private depthTerrainCanvas: HTMLCanvasElement | null = null;
  private depthTerrainCtx: CanvasRenderingContext2D | null = null;
  private shieldMaskCanvas: HTMLCanvasElement | null = null;
  private shieldMaskCtx: CanvasRenderingContext2D | null = null;
  private terrainSpriteAnalyzer = new TerrainSpriteAnalyzer();
  private renderQueue: RenderCommand[] = [];

  // Camera system
  private cameraController = new CameraController();

  // Parallax background tree instances (generated once per game)
  private bgTreeInstances: { name: string; worldX: number; scale: number }[] = [];

  // Menu title animation (MONKEYS letters drop in on first menu visit)
  private readonly MT_LETTERS = [
    'text_M',
    'text_O',
    'text_N',
    'text_K',
    'text_E',
    'text_Y',
    'text_S',
  ];
  // Menu monkey fall-in animation state
  private menuMonkeyState: { startMs: number; fruitIndex: number } | null = null;

  private menuTitleAnim: BouncingLetterAnimState = {
    cfg: {
      letterSize: 96,
      staggerMs: 130,
      gravity: 1800,
      bounce: 0.38,
      minBounceVY: 50,
      advanceRatio: 0.5,
      targetYFn: (i) => 55 + [4, -8, 10, -5, 8, -10, 3][i],
    },
    letterY: [],
    letterVY: [],
    animStart: 0,
    animLastTs: 0,
  };

  // Game over letter drop animation
  private readonly GO_LETTERS: string[] = [
    'arena_G',
    'arena_A',
    'arena_M',
    'arena_E',
    'arena_O',
    'arena_V',
    'arena_E2',
    'arena_R',
  ];
  private readonly WIN_LETTERS: string[] = [
    'text_Y',
    'text_O',
    'text_U',
    'text_W',
    'text_I',
    'text_N',
  ];
  private readonly WIN_TEXT_TINT = '#FFE700';
  private gameOverAnim: BouncingLetterAnimState = {
    cfg: {
      letterSize: 96,
      staggerMs: 110,
      gravity: 2400,
      bounce: 0.42,
      minBounceVY: 60,
      advanceRatio: 0.62,
      targetYFn: () => CONST.CANVAS_HEIGHT / 3 - 48, // top-third - letterSize/2
    },
    letterY: [],
    letterVY: [],
    animStart: 0,
    animLastTs: 0,
  };

  // Setup timer
  private setupStartTime: number = 0;

  // Mouse control for camera
  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;

  // Loading flag
  private isLoading = false;
  private loadingContext: 'menu' | 'game' = 'menu';

  // State tracking for audio transitions
  private previousGameState: GameState | null = null;

  // Wind indicator animation state
  private windAnim = {
    displayAngle: 0,
    displayFill: 0,
    fromAngle: 0,
    fromFill: 0,
    toAngle: 0,
    toFill: 0,
    startTime: 0,
    duration: 600,
  };

  // Player movement tracking
  private playerMovementStarted = false;

  // Prediction path toggle
  private showPrediction: boolean = true;

  // Combat log
  private combatLogMinimized: boolean = false;
  private combatLogToggleBtn = { x: 0, y: 0, width: 0, height: 0 };

  // Weapon selection (bottom-right buttons)
  private selectedBulletIndex = 0;
  private readonly WEAPON_BTN_SIZE = 68;
  private readonly WEAPON_BTN_GAP = 8;
  private readonly WEAPON_BTN_MARGIN = 10;
  /** Sprites used for the menu monkey animation (always Lupin's weapons). */
  private readonly WEAPON_SPRITES = ['item_banana', 'item_apple', 'item_peanut'];
  /** Bullet options for the currently active player vehicle. */
  private get vehicleBulletOptions(): import('./monkeys.types').Bullet[] {
    return this.gameService.player?.vehicle?.bulletOptions ?? CONST.PLAYER_BULLETS;
  }

  // Turn message
  private turnMessage: string = '';
  private messageTimer: number = 0;
  private previousTurnId: string = '';
  private previousTurnState: string = '';

  // Game state
  get currentState(): GameState {
    return this.gameService.currentState;
  }

  private canvasScale = 1;
  private readonly tintCache = new Map<string, HTMLCanvasElement>();
  private readonly EXPLOSION_FRAME_COUNT = 6;
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
  private readonly TERRAIN_TOOL_ENABLED = true;
  private readonly DEV_MODE = true;
  private readonly LAYER_EDITOR_FRAMES = [
    'idle',
    'move_0',
    'move_1',
    'move_2',
    'move_3',
    'shoot_0',
    'shoot_1',
    'shoot_2',
    'shoot_3',
    'shoot_4',
    'shoot_5',
    'shoot_6',
    'shoot_7',
    'shoot_8',
    'shoot_9',
  ] as const;
  private readonly LAYER_EDITOR_FRUITS = ['item_banana', 'item_apple', 'item_peanut'] as const;
  private readonly ZOMBIE_LAYER_EDITOR_FRUITS = [
    'zombie_item_banana_bunch',
    'zombie_item_corn_stick',
    'zombie_item_mushroom',
  ] as const;
  private readonly LUPIN_COMPOSITE = 'Lupin Composite.png';
  private readonly ZOMBIE_COMPOSITE = 'Zombie Lupin Composite.png';
  private readonly COMPOSITE_SHEETS = new Set<string>([
    'Lupin Composite.png',
    'Zombie Lupin Composite.png',
  ]);
  private layerToolSheet: string = 'Lupin Composite.png';
  private readonly POWER_PERCENT_SPRITE_SIZE = 26;
  private readonly MOVE_FRAME_DURATIONS = [150, 150, 150, 80] as const;
  private readonly CURSOR_BLINK_PERIOD_MS = 1000;
  private readonly CURSOR_ON_DURATION_MS = 530;

  // Sprite name maps for digit/symbol rendering — defined once here rather than per render frame.
  private readonly ANGLE_CHAR_TO_SPRITE: Record<string, string> = {
    '0': 'angle_0',
    '1': 'angle_1',
    '2': 'angle_2',
    '3': 'angle_3',
    '4': 'angle_4',
    '5': 'angle_5',
    '6': 'angle_6',
    '7': 'angle_7',
    '8': 'angle_8',
    '9': 'angle_9',
    '%': 'angle_percent',
    '°': 'angle_degree',
  };

  // Full character → sprite map used by drawSpriteTextCentered and buildQueueCharMap.
  private readonly TEXT_CHAR_TO_SPRITE: Record<string, string> = (() => {
    const m: Record<string, string> = {};
    for (let i = 0; i < 26; i++) {
      m[String.fromCharCode(65 + i)] = `text_${String.fromCharCode(65 + i)}`;
      m[String.fromCharCode(97 + i)] = `text_${String.fromCharCode(97 + i)}`;
    }
    for (let d = 0; d <= 9; d++) m[String(d)] = `arena_${d}`;
    // Math symbols (row 3)
    m['+'] = 'angle_plus';
    m['-'] = 'angle_minus';
    m['×'] = 'angle_multiply';
    m['÷'] = 'angle_divide';
    m['='] = 'angle_equals';
    m['/'] = 'angle_slash';
    m['\\'] = 'angle_backslash';
    m['$'] = 'angle_dollar';
    // Punctuation row
    m['&'] = 'text_ampersand';
    m['('] = 'text_lparen';
    m[')'] = 'text_rparen';
    m['\u300c'] = 'text_jp_open';
    m['\u300d'] = 'text_jp_close';
    m['\u3001'] = 'text_jp_comma';
    m['\u3002'] = 'text_jp_period';
    m[','] = 'text_comma';
    m['.'] = 'text_period';
    m['\u00b7'] = 'text_middledot';
    m['~'] = 'text_tilde';
    m[':'] = 'text_colon';
    m[';'] = 'text_semicolon';
    m['\u02bb'] = 'text_okina';
    m["'"] = 'text_apostrophe';
    m['\u201c'] = 'text_openquote';
    m['\u201d'] = 'text_closequote';
    m['<'] = 'text_lt';
    m['>'] = 'text_gt';
    m['?'] = 'text_question';
    m['!'] = 'text_exclaim';
    m[' '] = '';
    return m;
  })();

  private readonly ARENA_CHAR_TO_SPRITE: Record<string, string> = {
    '0': 'arena_0',
    '1': 'arena_1',
    '2': 'arena_2',
    '3': 'arena_3',
    '4': 'arena_4',
    '5': 'arena_5',
    '6': 'arena_6',
    '7': 'arena_7',
    '8': 'arena_8',
    '9': 'arena_9',
    '/': 'arena_slash',
  };

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
  private terrainToolActiveSheet: 'terrain' | 'background' = 'terrain';
  private terrainToolSimpleMode = false;

  // Equipment / Loadout screen state
  private readonly EQUIPMENT_SLOTS: EquipmentSlot[] = [
    'headgear',
    'torso',
    'legs',
    'footwear',
    'accessory',
  ];
  private readonly SLOT_LABELS: Record<EquipmentSlot, string> = {
    headgear: 'Headgear',
    torso: 'Torso',
    legs: 'Legs',
    footwear: 'Footwear',
    accessory: 'Accessory',
  };
  private loadoutSlotIndices: Record<EquipmentSlot, number> = {
    headgear: 0,
    torso: 0,
    legs: 0,
    footwear: 0,
    accessory: 0,
  };
  private isNameEditing = false;
  private expandedSlot: EquipmentSlot | null = null;
  private frozenTime: number | null = null; // set when paused to freeze sprite animations
  private animationFrameId = 0;

  private get renderTime(): number {
    return this.frozenTime ?? Date.now();
  }


  // Layer offset editor state
  private editorFrameIndex = 0;
  private editorFruitIndex = 0;
  private editorOffsets: LayerOffsetData | null = null;
  private layerToolAllOffsets: Record<string, LayerOffsetData> = {};
  // Hit regions populated each drawLayerTool() frame
  private layerToolBtns: Map<string, { x: number; y: number; w: number; h: number }> = new Map();
  // Top-right corner, beside/above the turn timer digits (timer rightX = CANVAS_WIDTH-20); 24×24 px

  private readonly SLIDER_TRACK_LEFT = CONST.CANVAS_WIDTH / 2 - 220;
  private readonly SLIDER_TRACK_WIDTH = 440;
  private readonly SLIDER_BG_TRACK_Y = 410;
  private readonly SLIDER_SFX_TRACK_Y = 503;
  private draggingSlider: 'bg' | 'sfx' | null = null;
  private powerMarkerRatio: number | null = null;
  private draggingPowerMarker = false;
  private wasCharging = false;


  constructor(
    private gameService: MonkeysGameService,
    private spriteService: MonkeysSpriteService,
    private audioService: MonkeysAudioService,
    private sfxService: MonkeysSfxService,
    private shieldAnimService: ShieldAnimationService,
  ) {}

  // ── Renderer instances (initialized after canvas is ready) ────────────────
  private rc!: MonkeysRenderContext;
  private bg!: MonkeysBackgroundRenderer;
  private effects!: MonkeysEffectsRenderer;
  private entity!: MonkeysEntityRenderer;
  private ui!: MonkeysUIRenderer;
  private devTools!: MonkeysDevToolsRenderer;

  private initRenderers(): void {
    this.rc = {
      ctx: this.ctx,
      renderTime: 0,
      queueDraw: (zIndex: number, fn: () => void) => this.queueDraw(zIndex, fn),
      gameService: this.gameService,
      spriteService: this.spriteService,
      cameraController: this.cameraController,
      shieldAnimService: this.shieldAnimService,
      tintCache: this.tintCache,
    };
    this.bg = new MonkeysBackgroundRenderer(this.rc);
    this.effects = new MonkeysEffectsRenderer(this.rc);
    this.entity = new MonkeysEntityRenderer(this.rc, this.bg);
    this.ui = new MonkeysUIRenderer(this.rc, this.audioService, this.bg);
    this.devTools = new MonkeysDevToolsRenderer(this.rc, this.ui);
  }

  ngOnInit() {
    this.loadingContext = 'menu';
    this.gameService.currentState = GameState.LOADING;
    this.sfxService.setVolume(this.audioService.sfxVolume);
    this.sfxService.setMuted(this.audioService.isMuted);
    Promise.all([
      this.spriteService.loadSprites(),
      this.spriteService
        .loadBackgroundMetadata()
        .then(() =>
          this.spriteService.loadRawSpritesheet(this.spriteService.BACKGROUND_TOOL_SPRITESHEET),
        )
        .catch((err) => console.error('Failed to load background sprites:', err)),
      this.spriteService
        .loadRawSpritesheet('equipment.png')
        .catch((err) => console.warn('Failed to load equipment sprites:', err)),
      this.audioService
        .loadMenuAudio()
        .catch((err) => console.warn('Failed to load menu audio:', err)),
      // Pre-create the game audio element now so it exists when startGame() is clicked
      this.audioService.loadGameAudio().catch(() => {}),
      this.sfxService.loadBank().catch((err) => console.warn('Failed to load SFX bank:', err)),
    ])
      .then(() => {
        this.gameService.currentState = GameState.MENU;
      })
      .catch((error) => {
        console.error('Failed to load sprites:', error);
        this.gameService.currentState = GameState.MENU;
      });
  }

  private readonly onWindowBlur = () => {
    this.audioService.setFocusMuted(true);
    this.sfxService.setFocusMuted(true);
  };
  private readonly onWindowFocus = () => {
    this.audioService.setFocusMuted(false);
    this.sfxService.setFocusMuted(false);
  };
  private readonly onVisibilityChange = () => {
    this.audioService.setFocusMuted(document.hidden);
    this.sfxService.setFocusMuted(document.hidden);
  };

  ngAfterViewInit() {
    this.initCanvas();
    this.initRenderers();
    this.canvas.nativeElement.addEventListener('click', (event) => this.onCanvasClick(event));
    this.canvas.nativeElement.addEventListener('mousedown', (event) =>
      this.onCanvasMouseDown(event),
    );
    this.canvas.nativeElement.addEventListener('mousemove', (event) =>
      this.onCanvasMouseMove(event),
    );
    window.addEventListener('mouseup', () => {
      this.draggingSlider = null;
      this.draggingPowerMarker = false;
    });
    window.addEventListener('keydown', (event) => this.onKeyDown(event));
    window.addEventListener('keyup', (event) => this.onKeyUp(event));
    window.addEventListener('blur', this.onWindowBlur);
    window.addEventListener('focus', this.onWindowFocus);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    // Apply initial focus state in case the page loaded without focus or in a background tab
    this.audioService.setFocusMuted(document.hidden || !document.hasFocus());
    this.sfxService.setFocusMuted(document.hidden || !document.hasFocus());
    this.renderLoop();
  }

  ngOnDestroy() {
    cancelAnimationFrame(this.animationFrameId);
    window.removeEventListener('blur', this.onWindowBlur);
    window.removeEventListener('focus', this.onWindowFocus);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.gameService.destroy();
    this.audioService.destroy();
  }

  async startGame() {
    this.gameService.setMatterJS(Matter);
    this.canvas.nativeElement.focus();
    this.loadingContext = 'game';
    this.gameService.currentState = GameState.LOADING;
    this.isLoading = true;
    // Start game audio synchronously here, within the user-gesture tick, before any await.
    // This is the only reliable way to satisfy browser autoplay policy across async loads.
    this.audioService.startGameAudioOnGesture();
    try {
      await Promise.all([
        this.gameService.initGame(),
        this.spriteService.loadTerrainSpritesheet(),
        this.spriteService.loadInnerTerrainSpritesheet().catch(() => {}),
      ]);
    } catch (error) {
      console.error('Failed to start game:', error);
      this.loadingContext = 'menu';
      this.gameService.currentState = GameState.MENU;
      this.isLoading = false;
      return;
    }
    this.isLoading = false;
    this.cameraController.reset();
    this.ui.selectedBulletIndex = 0; // reset weapon selection on new game
    // Set up camera follow for player during setup
    this.cameraController.setFollowTarget(this.gameService.player);
    this.cameraController.enableFollow();
    this.setupStartTime = Date.now();
    this.bg.generateBgTreeInstances();
    this.ui.resetGameOverAnim();
    this.shieldAnimService.reset();

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
    canvas.width = CONST.CANVAS_WIDTH;
    canvas.height = CONST.CANVAS_HEIGHT;

    // Scale for different screen sizes
    this.updateCanvasScale();
  }

  private updateCanvasScale() {
    const container = this.canvas.nativeElement.parentElement;
    if (container) {
      const maxWidth = Math.min(window.innerWidth - CONST.CANVAS_PADDING, CONST.CANVAS_WIDTH);
      this.canvasScale = maxWidth / CONST.CANVAS_WIDTH;
      this.canvas.nativeElement.style.width = `${maxWidth}px`;
      this.canvas.nativeElement.style.height = `${CONST.CANVAS_HEIGHT * this.canvasScale}px`;
    }
  }

  private render() {
    this.rc.renderTime = this.frozenTime ?? Date.now();
    this.renderFrame();
    // Mute button overlays every screen (terrain dev tools excluded)
    if (
      this.gameService.currentState !== GameState.TERRAIN_TOOL &&
      this.gameService.currentState !== GameState.LAYER_TOOL
    ) {
      this.ui.drawMuteButton();
    }
  }

  private renderFrame() {
    if (this.gameService.currentState === GameState.LOADING) {
      this.ui.drawLoadingScreen(this.loadingContext);
      return;
    }
    if (this.gameService.currentState === GameState.MENU) {
      this.ui.drawMenu(this.TERRAIN_TOOL_ENABLED, this.DEV_MODE);
      return;
    }
    if (this.gameService.currentState === GameState.EQUIPMENT_MENU) {
      this.ui.drawEquipmentMenu();
      return;
    }
    if (this.gameService.currentState === GameState.OPTIONS) {
      this.ui.drawOptions();
      return;
    }
    if (this.gameService.currentState === GameState.TERRAIN_TOOL) {
      this.devTools.drawTerrainTool();
      return;
    }
    if (this.gameService.currentState === GameState.LAYER_TOOL) {
      this.devTools.drawLayerTool();
      return;
    }

    if (this.isLoading) {
      this.ui.drawLoadingScreen(this.loadingContext);
      return;
    }

    this.shieldAnimService.update(
      this.gameService.player,
      this.gameService.enemies,
      this.rc.renderTime,
    );
    this.entity.updateHurtSpriteState();

    // Detect autofire (isCharging went false between frames, e.g. charge held to 100%)
    const nowCharging = this.gameService.isCharging;
    if (this.wasCharging && !nowCharging) {
      this.powerMarkerRatio = this.gameService.lastFiredPowerRatio;
    }
    this.wasCharging = nowCharging;

    // Check if setup is complete: minimum 1s elapsed AND all vehicles have landed
    if (
      this.gameService.currentState === GameState.SETUP &&
      Date.now() - this.setupStartTime >= 1000 &&
      this.gameService.areAllEntitiesSettled()
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
      !this.gameService.isCharging
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
      const isPlayerTurn = currentTurn.type === 'player';
      const shouldRefocusForAction =
        stateNow === 'moving' || (stateNow === 'charging' && !isPlayerTurn);
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
      this.gameService.aftermathImpactPos,
    );

    // Pan to entity if requested
    if (
      this.gameService.panToEntity &&
      this.gameService.panToEntity.entity &&
      isFinite(this.gameService.panToEntity.entity.x) &&
      isFinite(this.gameService.panToEntity.entity.y) &&
      this.gameService.currentState !== GameState.SETUP &&
      this.gameService.currentState !== GameState.PAUSED
    ) {
      if (!this.isDragging) {
        this.cameraController.panToEntity(this.gameService.panToEntity.entity);
        this.gameService.panToEntity = null;
      }
    } else if (this.gameService.panToEntity) {
      this.gameService.panToEntity = null; // Clear invalid request
    }

    // Pan to world position (e.g. planted mine centroid before detonation)
    if (
      this.gameService.panToPosition &&
      !this.isDragging &&
      this.gameService.currentState !== GameState.SETUP &&
      this.gameService.currentState !== GameState.PAUSED
    ) {
      this.cameraController.panToEntity(this.gameService.panToPosition);
      this.gameService.panToPosition = null;
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

    // Update turn message (not during setup phase)
    if (currentTurn && currentTurn.id !== this.previousTurnId) {
      if (this.gameService.currentState !== GameState.SETUP) {
        this.turnMessage = currentTurn.type === 'player' ? "Player's Turn" : "Enemy's Turn";
        this.messageTimer = 1500;
        this.previousTurnId = currentTurn.id;
        this.previousTurnState = (currentTurn.entity as any).turnState as string;
      }
      this.playerMovementStarted = false;
    }
    if (this.messageTimer > 0) {
      this.messageTimer -= 16;
      if (this.messageTimer <= 0) {
        this.turnMessage = '';
      }
    }

    // Draw sky (entire background)
    this.ctx.fillStyle = CONST.SKY_COLOR; // Sky blue
    this.ctx.fillRect(0, 0, CONST.CANVAS_WIDTH, CONST.CANVAS_HEIGHT);
    this.bg.drawParallaxBackground(this.cameraController.camera.x);

    // Reset render queue — all game-world sprite draws below are deferred until flush
    this.renderQueue = [];

    // Terrain is queued at layers 1–3, behind all entities
    this.bg.drawTerrain();
    // Instance trees queued at layers 5 / 8 — appear over terrain, behind all entities
    this.bg.queueEnvironmentTrees(this.cameraController.camera.x);

    // Draw charge bars (behind tanks)
    if (this.gameService.isPlayerTurn() && this.gameService.player.active) {
      this.entity.drawChargeBar(
        this.gameService.player,
        this.gameService.player.maxPower,
        this.powerMarkerRatio ?? undefined,
      );
    }
    for (const enemy of this.gameService.enemies) {
      if (enemy.active && enemy.entityState === 'charging') {
        this.entity.drawChargeBar(enemy, enemy.vehicle.power);
      }
    }

    // Draw player
    this.entity.drawPlayer(this.showPrediction);

    // Draw enemies
    this.entity.drawEnemies(this.showPrediction);

    // Draw poison zones (over entities)
    this.effects.drawPoisonZones();

    // Draw projectile
    if (this.gameService.projectile) {
      this.effects.drawProjectile();
    }
    this.effects.drawChildProjectiles();
    this.effects.drawPlantedMines();
    this.effects.drawExplosions();

    // Draw damage texts
    this.effects.drawDamageTexts();

    // Flush all queued game-world sprite draws in z-index order
    this.flushRenderQueue();

    // Draw UI (naturally on top of all queued sprites)
    this.ui.drawUI(this.turnMessage, this.messageTimer);
    this.ui.drawTurnQueue();
    this.ui.drawCombatLog();
  }

  /** Captures the current canvas transform and adds a draw command to the render queue. */
  private queueDraw(zIndex: number, draw: () => void): void {
    this.renderQueue.push({ zIndex, transform: this.ctx.getTransform(), draw });
  }

  /** Sorts the render queue by z-index and executes all commands, then clears the queue. */
  private flushRenderQueue(): void {
    this.renderQueue.sort((a, b) => a.zIndex - b.zIndex);
    for (const cmd of this.renderQueue) {
      this.ctx.save();
      this.ctx.setTransform(cmd.transform);
      cmd.draw();
      this.ctx.restore();
    }
    this.renderQueue = [];
  }

  private selectWeapon(index: number): void {
    const options = this.vehicleBulletOptions;
    if (index < 0 || index >= options.length) return;
    this.ui.selectedBulletIndex = index;
    this.gameService.player.vehicle.bullet = { ...options[index] };
    this.gameService.clearTrajectoryCache();
  }

  private renderLoop() {
    const currState = this.gameService.currentState;
    if (this.previousGameState !== currState) {
      this.handleStateTransitionAudio(currState);
      this.previousGameState = currState;
    }

    if (
      currState !== GameState.MENU &&
      currState !== GameState.OPTIONS &&
      currState !== GameState.TERRAIN_TOOL &&
      currState !== GameState.LAYER_TOOL &&
      currState !== GameState.EQUIPMENT_MENU
    ) {
      this.gameService.update();
    }
    this.render();
    this.animationFrameId = requestAnimationFrame(() => this.renderLoop());
  }

  private handleStateTransitionAudio(newState: GameState): void {
    if (newState === GameState.MENU) {
      this.loadingContext = 'menu';
      this.audioService.playMenu();
    }
    // Game audio is started synchronously in startGame() — no state-transition hook needed.
  }

  onKeyDown(event: KeyboardEvent) {
    // Prevent default browser behavior for game controls
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(event.key)) {
      event.preventDefault();
    }
    if (
      this.gameService.currentState === GameState.GAME_OVER_DELAY ||
      this.gameService.currentState === GameState.WIN_DELAY
    ) {
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
        this.frozenTime = Date.now();
        this.cameraController.cancelPan();
        this.cameraController.lock();
        this.gameService.panToEntity = null;
      } else if (this.gameService.currentState === GameState.PAUSED) {
        this.gameService.currentState = GameState.PLAYING;
        this.gameService.resumePhysics();
        this.frozenTime = null;
        this.cameraController.unlock();
      }
      event.preventDefault();
    }
    if (event.key === 'r' || event.key === 'R') {
      if (
        this.gameService.currentState === GameState.GAME_OVER ||
        this.gameService.currentState === GameState.WIN
      ) {
        this.gameService.currentState = GameState.MENU;
      }
      event.preventDefault();
    }

    // Name editing in equipment menu
    if (this.ui.isNameEditing && this.gameService.currentState === GameState.EQUIPMENT_MENU) {
      if (event.key === 'Enter' || event.key === 'Escape') {
        this.ui.isNameEditing = false;
      } else if (event.key === 'Backspace') {
        this.gameService.playerName = this.gameService.playerName.slice(0, -1);
      } else if (event.key.length === 1 && this.gameService.playerName.length < 10) {
        const ch = event.key;
        if (/^[a-zA-Z0-9 _-]$/.test(ch)) {
          this.gameService.playerName += ch;
        }
      }
      event.preventDefault();
      return;
    }

    this.gameService.keys[event.key] = true;
  }

  onKeyUp(event: KeyboardEvent) {
    if (
      this.gameService.currentState === GameState.GAME_OVER_DELAY ||
      this.gameService.currentState === GameState.WIN_DELAY
    ) {
      this.gameService.keys[event.key] = false;
      return;
    }

    // Handle spacebar release for shooting
    if (event.key === ' ') {
      if (this.gameService.currentState !== GameState.PAUSED) {
        if (this.gameService.isCharging && !this.gameService.projectile) {
          this.gameService.shoot();
          this.powerMarkerRatio = this.gameService.lastFiredPowerRatio;
        }
        this.gameService.isCharging = false;
      }
    }
    this.gameService.keys[event.key] = false;
  }

  private clampCameraY(y: number): number {
    return this.cameraController.clampCameraY(y);
  }

  private isInteractionBlocked(): boolean {
    const s = this.gameService.currentState;
    return (
      s === GameState.GAME_OVER_DELAY ||
      s === GameState.WIN_DELAY ||
      s === GameState.TERRAIN_TOOL ||
      s === GameState.LOADING ||
      s === GameState.MENU ||
      s === GameState.SETUP
    );
  }

  onMouseMove(event: MouseEvent) {
    if (this.isInteractionBlocked()) {
      this.isDragging = false;
      return;
    }

    // Handle camera dragging
    if (this.isDragging && !this.draggingPowerMarker) {
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
    if (this.isInteractionBlocked()) {
      return;
    }

    this.cameraController.cancelPan();
    this.cameraController.resetIdleModeActivityTimer();
    this.isDragging = true;
    this.lastMouseX = event.clientX;
    this.lastMouseY = event.clientY;
  }

  onMouseUp() {
    if (this.isInteractionBlocked()) {
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

  private getCanvasCoords(event: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.nativeElement.getBoundingClientRect();
    const cs = getComputedStyle(this.canvas.nativeElement);
    const borderLeft = parseFloat(cs.borderLeftWidth) || 0;
    const borderTop = parseFloat(cs.borderTopWidth) || 0;
    const borderRight = parseFloat(cs.borderRightWidth) || 0;
    const borderBottom = parseFloat(cs.borderBottomWidth) || 0;
    const contentWidth = rect.width - borderLeft - borderRight;
    const contentHeight = rect.height - borderTop - borderBottom;
    return {
      x: (event.clientX - rect.left - borderLeft) * (CONST.CANVAS_WIDTH / contentWidth),
      y: (event.clientY - rect.top - borderTop) * (CONST.CANVAS_HEIGHT / contentHeight),
    };
  }

  private onCanvasClick(event: MouseEvent) {
    // Unblock any autoplay-gated audio on the first user gesture
    this.audioService.unlockAudio();

    const { x, y } = this.getCanvasCoords(event);

    // Mute button is active on every screen except terrain tool, layer tool, and loading
    if (
      this.gameService.currentState !== GameState.TERRAIN_TOOL &&
      this.gameService.currentState !== GameState.LAYER_TOOL &&
      this.gameService.currentState !== GameState.LOADING &&
      !this.isLoading &&
      isPointInsideButton(x, y, this.ui.MUTE_BUTTON)
    ) {
      this.audioService.toggleMute();
      this.sfxService.setMuted(this.audioService.isMuted);
      return;
    }

    if (this.gameService.currentState === GameState.MENU) {
      this.handleMenuClick(x, y);
    } else if (this.gameService.currentState === GameState.EQUIPMENT_MENU) {
      this.ui.handleEquipmentMenuClick(x, y);
    } else if (this.gameService.currentState === GameState.OPTIONS) {
      this.handleOptionsClick(x, y);
    } else if (this.gameService.currentState === GameState.TERRAIN_TOOL) {
      this.devTools.handleTerrainToolClick(x, y);
    } else if (this.gameService.currentState === GameState.LAYER_TOOL) {
      this.devTools.handleLayerToolClick(x, y);
    } else if (
      this.gameService.currentState === GameState.PLAYING ||
      this.gameService.currentState === GameState.PAUSED ||
      this.gameService.currentState === GameState.AFTERMATH
    ) {
      if (isPointInsideButton(x, y, this.ui.combatLogToggleBtn)) {
        this.ui.combatLogMinimized = !this.ui.combatLogMinimized;
        return;
      }
      const bullets = this.vehicleBulletOptions;
      for (let i = 0; i < bullets.length; i++) {
        if (isPointInsideButton(x, y, this.ui.getWeaponBtnRect(i, bullets.length))) {
          this.selectWeapon(i);
          return;
        }
      }
    }
  }

  private handleMenuClick(x: number, y: number) {
    // Check Start Game button
    if (isPointInsideButton(x, y, this.ui.MENU_START_BUTTON)) {
      void this.startGame();
      return;
    }

    // Check Loadout button
    if (isPointInsideButton(x, y, this.ui.MENU_LOADOUT_BUTTON)) {
      this.ui.initLoadoutScreen();
      this.gameService.currentState = GameState.EQUIPMENT_MENU;
      return;
    }

    // Check Options button
    if (isPointInsideButton(x, y, this.ui.MENU_OPTIONS_BUTTON)) {
      this.gameService.currentState = GameState.OPTIONS;
      return;
    }

    if (this.TERRAIN_TOOL_ENABLED && isPointInsideButton(x, y, this.ui.MENU_TERRAIN_TOOL_BUTTON)) {
      void this.devTools.openTerrainTool();
    }

    if (this.DEV_MODE && isPointInsideButton(x, y, this.ui.MENU_TOOLS_BUTTON)) {
      this.devTools.openLayerTool();
    }
  }

  private handleOptionsClick(x: number, y: number) {
    if (isPointInsideButton(x, y, this.ui.OPTIONS_DIFFICULTY_EASY_BUTTON)) {
      this.gameService.difficulty = 'easy';
      this.gameService.saveDifficulty();
      return;
    }
    if (isPointInsideButton(x, y, this.ui.OPTIONS_DIFFICULTY_NORMAL_BUTTON)) {
      this.gameService.difficulty = 'normal';
      this.gameService.saveDifficulty();
      return;
    }
    if (isPointInsideButton(x, y, this.ui.OPTIONS_DIFFICULTY_HARD_BUTTON)) {
      this.gameService.difficulty = 'hard';
      this.gameService.saveDifficulty();
      return;
    }
    if (isPointInsideButton(x, y, this.ui.OPTIONS_BACK_BUTTON)) {
      this.gameService.currentState = GameState.MENU;
    }
  }

  private sliderHitTest(x: number, y: number, trackY: number): boolean {
    const left = this.SLIDER_TRACK_LEFT;
    const right = left + this.SLIDER_TRACK_WIDTH;
    return x >= left - 12 && x <= right + 12 && y >= trackY - 16 && y <= trackY + 16;
  }

  private applySliderX(x: number, which: 'bg' | 'sfx') {
    const v = Math.max(0, Math.min(1, (x - this.SLIDER_TRACK_LEFT) / this.SLIDER_TRACK_WIDTH));
    if (which === 'bg') {
      this.audioService.setBgVolume(v);
    } else {
      this.audioService.setSfxVolume(v);
      this.sfxService.setVolume(v);
    }
    this.audioService.saveOptions();
  }

  private onCanvasMouseDown(event: MouseEvent) {
    const { x, y } = this.getCanvasCoords(event);
    if (this.gameService.currentState === GameState.OPTIONS) {
      if (this.sliderHitTest(x, y, this.SLIDER_BG_TRACK_Y)) {
        this.draggingSlider = 'bg';
        this.applySliderX(x, 'bg');
      } else if (this.sliderHitTest(x, y, this.SLIDER_SFX_TRACK_Y)) {
        this.draggingSlider = 'sfx';
        this.applySliderX(x, 'sfx');
      }
      return;
    }
    if (this.gameService.isPlayerTurn() && this.gameService.player.active) {
      const bar = this.getPlayerChargeBarScreenRect();
      if (
        bar &&
        x >= bar.x - 6 &&
        x <= bar.x + bar.width + 6 &&
        y >= bar.y &&
        y <= bar.y + bar.height
      ) {
        this.powerMarkerRatio = Math.max(0, Math.min(1, 1 - (y - bar.y) / bar.height));
        this.draggingPowerMarker = true;
      }
    }
  }

  private onCanvasMouseMove(event: MouseEvent) {
    const { x, y } = this.getCanvasCoords(event);
    if (this.draggingSlider && this.gameService.currentState === GameState.OPTIONS) {
      this.applySliderX(x, this.draggingSlider);
      return;
    }
    if (this.draggingPowerMarker) {
      const bar = this.getPlayerChargeBarScreenRect();
      if (bar) {
        this.powerMarkerRatio = Math.max(0, Math.min(1, 1 - (y - bar.y) / bar.height));
      }
    }
  }

  private getPlayerChargeBarScreenRect(): {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null {
    const p = this.gameService.player;
    if (!p.active) return null;
    const offsetX = p.facing === 1 ? -CONST.CHARGE_BAR_OFFSET_X : CONST.CHARGE_BAR_OFFSET_X;
    const worldX = p.x + offsetX;
    const worldY = p.y - CONST.CHARGE_BAR_HEIGHT / 2;
    const screen = this.cameraController.worldToScreen(worldX, worldY);
    return {
      x: screen.x,
      y: screen.y,
      width: CONST.CHARGE_BAR_WIDTH,
      height: CONST.CHARGE_BAR_HEIGHT,
    };
  }
}
