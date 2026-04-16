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
} from './monkeys.types';
import * as CONST from './monkeys.constants';
import { MonkeysGameService } from './monkeys-game.service';
import { MonkeysSpriteService, SpriteData } from './monkeys-sprite.service';
import { MonkeysAudioService } from './monkeys-audio.service';
import { MonkeysSfxService } from './monkeys-sfx.service';
import { ShieldAnimationService } from './shield-animation.service';
import { CameraController } from './camera-controller';
import { TerrainSpriteAnalyzer } from './terrain-sprite-analyzer';

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
  private readonly ZOMBIE_LAYER_EDITOR_FRUITS = ['zombie_item_banana_bunch', 'zombie_item_corn_stick', 'zombie_item_mushroom'] as const;
  private readonly LUPIN_COMPOSITE = 'Lupin Composite.png';
  private readonly ZOMBIE_COMPOSITE = 'Zombie Lupin Composite.png';
  private readonly COMPOSITE_SHEETS = new Set<string>(['Lupin Composite.png', 'Zombie Lupin Composite.png']);
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

  private readonly MENU_BTN_CX = CONST.CANVAS_WIDTH / 2;
  private readonly MENU_BTN_W = 200;
  private readonly MENU_BTN_H = 50;
  private readonly MENU_BTN_FIRST_Y = 415;
  private readonly MENU_BTN_GAP = 50;
  private readonly MENU_START_BUTTON = this.mkBtn(
    this.MENU_BTN_CX,
    this.MENU_BTN_FIRST_Y,
    this.MENU_BTN_W,
    this.MENU_BTN_H,
  );
  private readonly MENU_LOADOUT_BUTTON = this.mkBtn(
    this.MENU_BTN_CX,
    this.MENU_BTN_FIRST_Y + this.MENU_BTN_GAP,
    this.MENU_BTN_W,
    this.MENU_BTN_H,
  );
  private readonly MENU_OPTIONS_BUTTON = this.mkBtn(
    this.MENU_BTN_CX,
    this.MENU_BTN_FIRST_Y + this.MENU_BTN_GAP * 2,
    this.MENU_BTN_W,
    this.MENU_BTN_H,
  );
  private readonly MENU_TERRAIN_TOOL_BUTTON = this.mkBtn(
    this.MENU_BTN_CX,
    this.MENU_BTN_FIRST_Y + this.MENU_BTN_GAP * 3,
    this.MENU_BTN_W,
    this.MENU_BTN_H,
  );
  private readonly MENU_TOOLS_BUTTON = this.mkBtn(
    this.MENU_BTN_CX,
    this.MENU_BTN_FIRST_Y + this.MENU_BTN_GAP * 4,
    this.MENU_BTN_W,
    this.MENU_BTN_H,
  );
  // Layer offset editor state
  private editorFrameIndex = 0;
  private editorFruitIndex = 0;
  private editorOffsets: LayerOffsetData | null = null;
  private layerToolAllOffsets: Record<string, LayerOffsetData> = {};
  // Hit regions populated each drawLayerTool() frame
  private layerToolBtns: Map<string, { x: number; y: number; w: number; h: number }> = new Map();
  // Top-right corner, beside/above the turn timer digits (timer rightX = CANVAS_WIDTH-20); 24×24 px
  private readonly MUTE_BUTTON = this.mkBtn(CONST.CANVAS_WIDTH - 12, 12, 24, 24);
  private readonly EQUIP_BACK_BUTTON = this.mkBtn(600, 650, 140, 44);
  private readonly OPTIONS_BACK_BUTTON = this.mkBtn(CONST.CANVAS_WIDTH / 2, 590, 200, 50);
  private readonly OPTIONS_DIFFICULTY_EASY_BUTTON = this.mkBtn(
    CONST.CANVAS_WIDTH / 2 - 200,
    280,
    160,
    50,
  );
  private readonly OPTIONS_DIFFICULTY_NORMAL_BUTTON = this.mkBtn(
    CONST.CANVAS_WIDTH / 2,
    280,
    160,
    50,
  );
  private readonly OPTIONS_DIFFICULTY_HARD_BUTTON = this.mkBtn(
    CONST.CANVAS_WIDTH / 2 + 200,
    280,
    160,
    50,
  );
  private readonly SLIDER_TRACK_LEFT = CONST.CANVAS_WIDTH / 2 - 220;
  private readonly SLIDER_TRACK_WIDTH = 440;
  private readonly SLIDER_BG_TRACK_Y = 410;
  private readonly SLIDER_SFX_TRACK_Y = 503;
  private draggingSlider: 'bg' | 'sfx' | null = null;
  private powerMarkerRatio: number | null = null;
  private draggingPowerMarker = false;
  private readonly TERRAIN_TOOL_BACK_BUTTON = this.mkBtn(CONST.CANVAS_WIDTH - 170, 48, 220, 44);
  private readonly TERRAIN_TOOL_RESCAN_BUTTON = this.mkBtn(CONST.CANVAS_WIDTH - 170, 102, 220, 44);
  private readonly TERRAIN_TOOL_COPY_ALL_BUTTON = this.mkBtn(
    CONST.CANVAS_WIDTH - 170,
    156,
    220,
    44,
  );
  private readonly TERRAIN_TOOL_SWITCH_BUTTON = this.mkBtn(CONST.CANVAS_WIDTH - 170, 210, 220, 44);
  private readonly TERRAIN_TOOL_MODE_BUTTON = this.mkBtn(CONST.CANVAS_WIDTH - 170, 264, 220, 44);

  constructor(
    private gameService: MonkeysGameService,
    private spriteService: MonkeysSpriteService,
    private audioService: MonkeysAudioService,
    private sfxService: MonkeysSfxService,
    private shieldAnimService: ShieldAnimationService,
  ) {}

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

  private readonly onWindowBlur = () => { this.audioService.setFocusMuted(true); this.sfxService.setFocusMuted(true); };
  private readonly onWindowFocus = () => { this.audioService.setFocusMuted(false); this.sfxService.setFocusMuted(false); };
  private readonly onVisibilityChange = () => { this.audioService.setFocusMuted(document.hidden); this.sfxService.setFocusMuted(document.hidden); };

  ngAfterViewInit() {
    this.initCanvas();
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
    this.selectedBulletIndex = 0; // reset weapon selection on new game
    // Set up camera follow for player during setup
    this.cameraController.setFollowTarget(this.gameService.player);
    this.cameraController.enableFollow();
    this.setupStartTime = Date.now();
    this.generateBgTreeInstances();
    this.gameOverAnim.animStart = 0;
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
    this.renderFrame();
    // Mute button overlays every screen (terrain dev tools excluded)
    if (
      this.gameService.currentState !== GameState.TERRAIN_TOOL &&
      this.gameService.currentState !== GameState.LAYER_TOOL
    ) {
      this.drawMuteButton();
    }
  }

  private renderFrame() {
    if (this.gameService.currentState === GameState.LOADING) {
      this.drawLoadingScreen();
      return;
    }
    if (this.gameService.currentState === GameState.MENU) {
      this.drawMenu();
      return;
    }
    if (this.gameService.currentState === GameState.EQUIPMENT_MENU) {
      this.drawEquipmentMenu();
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
    if (this.gameService.currentState === GameState.LAYER_TOOL) {
      this.drawLayerTool();
      return;
    }

    if (this.isLoading) {
      this.drawLoadingScreen();
      return;
    }

    this.shieldAnimService.update(this.gameService.player, this.gameService.enemies, this.renderTime);
    this.updateHurtSpriteState();

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
    this.drawParallaxBackground(this.cameraController.camera.x);

    // Draw terrain
    this.drawTerrain();

    // Draw charge bars (behind tanks)
    if (this.gameService.isPlayerTurn() && this.gameService.player.active) {
      this.drawChargeBar(
        this.gameService.player,
        this.gameService.player.maxPower,
        this.powerMarkerRatio ?? undefined,
      );
    }
    for (const enemy of this.gameService.enemies) {
      if (enemy.active && enemy.entityState === 'charging') {
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
    this.drawChildProjectiles();

    // Draw explosions
    this.drawExplosions();

    // Draw damage texts
    this.drawDamageTexts();

    // Draw UI
    this.drawUI();
    this.drawTurnQueue();
    this.drawCombatLog();
  }

  private drawChargeBar(entity: any, maxPower: number, markerRatio?: number) {
    const barWidth = CONST.CHARGE_BAR_WIDTH;
    const barHeight = CONST.CHARGE_BAR_HEIGHT; // 50% shorter (was 60px)
    // Position further behind tank based on facing direction
    const offsetX = entity.facing === 1 ? -CONST.CHARGE_BAR_OFFSET_X : CONST.CHARGE_BAR_OFFSET_X; // Further left of tank when facing right, further right when facing left
    const worldX = entity.x + offsetX;
    const worldY = entity.y - barHeight / 2; // Center vertically on tank
    const screenPos = this.cameraController.worldToScreen(worldX, worldY);
    const barX = screenPos.x;
    const barY = screenPos.y;

    // Background
    this.ctx.fillStyle = CONST.CHARGE_BAR_BACKGROUND_COLOR;
    this.ctx.fillRect(barX, barY, barWidth, barHeight);

    // Charge level (bottom to top)
    const chargeRatio = entity.power / maxPower;
    this.ctx.fillStyle =
      chargeRatio < CONST.CHARGE_BAR_LOW_THRESHOLD
        ? CONST.CHARGE_BAR_LOW_COLOR
        : chargeRatio < CONST.CHARGE_BAR_HIGH_THRESHOLD
          ? CONST.CHARGE_BAR_MID_COLOR
          : CONST.CHARGE_BAR_HIGH_COLOR;
    this.ctx.fillRect(
      barX,
      barY + barHeight * (1 - chargeRatio),
      barWidth,
      barHeight * chargeRatio,
    );

    // Border
    this.ctx.strokeStyle = CONST.CHARGE_BAR_BORDER_COLOR;
    this.ctx.lineWidth = CONST.CHARGE_BAR_BORDER_WIDTH;
    this.ctx.strokeRect(barX, barY, barWidth, barHeight);

    // Target power marker
    if (markerRatio !== undefined) {
      const markerY = barY + barHeight * (1 - markerRatio);
      this.ctx.strokeStyle = '#FF8C00';
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(barX - 5, markerY);
      this.ctx.lineTo(barX + barWidth + 5, markerY);
      this.ctx.stroke();
      const markerPct = Math.round(markerRatio * 100);
      const labelSize = 16;
      // Centre the label on the side away from the player sprite
      const labelCentreX =
        entity.facing === 1
          ? barX - 20 // bar is left of player — label left of bar
          : barX + barWidth + 20; // bar is right of player — label right of bar
      this.drawPowerPercent(markerPct, labelCentreX, markerY - labelSize / 2, '#FF8C00', labelSize);
    }

    // Power percentage
    const pct = Math.round(chargeRatio * 100);
    this.drawPowerPercent(pct, barX + barWidth / 2, barY - this.POWER_PERCENT_SPRITE_SIZE - 6);
    this.ctx.textAlign = 'left'; // Reset text alignment
  }

  private drawTerrain() {
    const terrainY = Math.floor(
      CONST.CANVAS_HEIGHT - CONST.TERRAIN_BASE_Y_OFFSET - this.cameraController.camera.y,
    );
    const startX = Math.max(0, Math.floor(this.cameraController.camera.x));
    const endX = Math.min(
      CONST.TERRAIN_WIDTH,
      Math.ceil(this.cameraController.camera.x + CONST.CANVAS_WIDTH),
    );

    // Ensure offscreen canvas exists at viewport size
    if (
      !this.terrainSpriteCanvas ||
      this.terrainSpriteCanvas.width !== CONST.CANVAS_WIDTH ||
      this.terrainSpriteCanvas.height !== CONST.CANVAS_HEIGHT
    ) {
      this.terrainSpriteCanvas = document.createElement('canvas');
      this.terrainSpriteCanvas.width = CONST.CANVAS_WIDTH;
      this.terrainSpriteCanvas.height = CONST.CANVAS_HEIGHT;
      this.terrainSpriteCtx = this.terrainSpriteCanvas.getContext('2d');
    }

    const offCtx = this.terrainSpriteCtx!;
    offCtx.clearRect(0, 0, CONST.CANVAS_WIDTH, CONST.CANVAS_HEIGHT);

    const terrainSheet = this.spriteService.getSpritesheet(
      this.spriteService.TERRAIN_TOOL_SPRITESHEET,
    );
    if (terrainSheet) {
      // Interior fill first (behind surface pieces)
      this.drawTerrainSpritePlacements(
        offCtx,
        this.gameService.terrainInteriorPlacements,
        terrainSheet,
        terrainY,
      );
      // Bottom shell over interior so underside silhouette is visible
      this.drawTerrainSpritePlacements(
        offCtx,
        this.gameService.terrainBottomPlacements,
        terrainSheet,
        terrainY,
      );
      // Surface shell on top
      this.drawTerrainSpritePlacements(
        offCtx,
        this.gameService.terrainChunkPlacements,
        terrainSheet,
        terrainY,
      );
    }

    // Mask by removing air cells only, so sprite overhang above the collision top remains visible.
    // terrain=0 is air, terrain=1 is solid, terrain=2 is visual-only (bottom sprite overhang).
    offCtx.globalCompositeOperation = 'destination-out';
    offCtx.fillStyle = 'rgba(0,0,0,1)';
    this.scanlineTerrainFill(offCtx, terrainY, startX, endX, 0);
    offCtx.globalCompositeOperation = 'source-over';

    // Brown fallback fill — visible through carved holes where sprites were erased
    this.ctx.fillStyle = CONST.TERRAIN_COLOR;
    this.scanlineTerrainFill(this.ctx, terrainY, startX, endX, 1);

    // Composite masked sprites over the colour fill
    this.ctx.drawImage(this.terrainSpriteCanvas!, 0, 0);

    // Draw depth terrain layer on top — only visible in the ring where main terrain is
    // carved away by a large crater but depth terrain still has solid (smaller crater)
    this.drawDepthTerrainLayer(terrainY, startX, endX);
  }

  private drawDepthTerrainLayer(terrainY: number, startX: number, endX: number): void {
    if (!this.gameService.depthTerrain?.length) return;

    const sheet = this.spriteService.getSpritesheet(this.spriteService.INNER_TERRAIN_SPRITESHEET);
    if (!sheet) return;

    if (
      !this.depthTerrainCanvas ||
      this.depthTerrainCanvas.width !== CONST.CANVAS_WIDTH ||
      this.depthTerrainCanvas.height !== CONST.CANVAS_HEIGHT
    ) {
      this.depthTerrainCanvas = document.createElement('canvas');
      this.depthTerrainCanvas.width = CONST.CANVAS_WIDTH;
      this.depthTerrainCanvas.height = CONST.CANVAS_HEIGHT;
      this.depthTerrainCtx = this.depthTerrainCanvas.getContext('2d');
    }

    const dCtx = this.depthTerrainCtx!;
    dCtx.clearRect(0, 0, CONST.CANVAS_WIDTH, CONST.CANVAS_HEIGHT);

    // Build a 256×256 tile canvas from the chosen inner terrain tile
    const TILE_SIZE = 256;
    const tileIndex = this.gameService.innerTerrainTileIndex;
    const tileCol = tileIndex % 3;
    const tileRow = Math.floor(tileIndex / 3);
    const tileCanvas = document.createElement('canvas');
    tileCanvas.width = TILE_SIZE;
    tileCanvas.height = TILE_SIZE;
    const tileCtx = tileCanvas.getContext('2d')!;
    tileCtx.drawImage(
      sheet,
      tileCol * TILE_SIZE,
      tileRow * TILE_SIZE,
      TILE_SIZE,
      TILE_SIZE,
      0,
      0,
      TILE_SIZE,
      TILE_SIZE,
    );

    // Tile the pattern across the full canvas, offset by camera for parallax-free scroll
    const pattern = dCtx.createPattern(tileCanvas, 'repeat')!;
    const offsetX = -(this.cameraController.camera.x % TILE_SIZE);
    const offsetY = terrainY % TILE_SIZE;
    dCtx.save();
    dCtx.translate(offsetX, offsetY);
    dCtx.fillStyle = pattern;
    dCtx.fillRect(
      -offsetX,
      terrainY - offsetY,
      CONST.CANVAS_WIDTH + TILE_SIZE,
      CONST.TERRAIN_STRIP_HEIGHT + TILE_SIZE,
    );
    dCtx.restore();

    // Mask: only keep pixels where main terrain is carved (=0) AND depth terrain is solid (=1)
    // This reveals the inner texture in the ring between the large and small craters
    dCtx.globalCompositeOperation = 'destination-out';
    dCtx.fillStyle = 'rgba(0,0,0,1)';
    const mainTerrain = this.gameService.terrain;
    const depthTerrain = this.gameService.depthTerrain;
    for (let y = 0; y < CONST.TERRAIN_STRIP_HEIGHT; y++) {
      let segStart = -1;
      for (let x = startX; x < endX; x++) {
        const inRing = (mainTerrain[x]?.[y] ?? 0) === 0 && (depthTerrain[x]?.[y] ?? 0) === 1;
        if (!inRing) {
          if (segStart === -1) segStart = x;
        } else if (segStart !== -1) {
          const sx = Math.floor(segStart - this.cameraController.camera.x);
          const ex = Math.floor(x - this.cameraController.camera.x);
          dCtx.fillRect(sx, terrainY + y, ex - sx, 1);
          segStart = -1;
        }
      }
      if (segStart !== -1) {
        const sx = Math.floor(segStart - this.cameraController.camera.x);
        const ex = Math.floor(endX - this.cameraController.camera.x);
        dCtx.fillRect(sx, terrainY + y, ex - sx, 1);
      }
    }
    dCtx.globalCompositeOperation = 'source-over';

    // Composite onto main canvas (opaque)
    this.ctx.drawImage(this.depthTerrainCanvas, 0, 0);
  }

  private drawTerrainSpritePlacements(
    offCtx: CanvasRenderingContext2D,
    placements: TerrainChunkPlacement[],
    terrainSheet: HTMLCanvasElement | HTMLImageElement,
    terrainY: number,
  ): void {
    for (const placement of placements) {
      const { region, x: worldX, topWorldY } = placement;
      const screenX = Math.floor(worldX - this.cameraController.camera.x);
      const screenY = Math.floor(terrainY + topWorldY);
      if (screenX + region.width < 0 || screenX > CONST.CANVAS_WIDTH) continue;
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

  private scanlineTerrainFill(
    ctx: CanvasRenderingContext2D,
    terrainY: number,
    startX: number,
    endX: number,
    matchValue: number,
  ): void {
    for (let y = 0; y < CONST.TERRAIN_STRIP_HEIGHT; y++) {
      let segmentStart = -1;
      for (let x = startX; x < endX; x++) {
        if (this.gameService.terrain[x]?.[y] === matchValue) {
          if (segmentStart === -1) segmentStart = x;
        } else if (segmentStart !== -1) {
          const sx = Math.floor(segmentStart - this.cameraController.camera.x);
          const ex = Math.floor(x - this.cameraController.camera.x);
          ctx.fillRect(sx, terrainY + y, ex - sx, 1);
          segmentStart = -1;
        }
      }
      if (segmentStart !== -1) {
        const sx = Math.floor(segmentStart - this.cameraController.camera.x);
        const ex = Math.floor(endX - this.cameraController.camera.x);
        ctx.fillRect(sx, terrainY + y, ex - sx, 1);
      }
    }
  }

  private drawPlayer() {
    if (
      this.gameService.player.health <= 0 &&
      !this.isEntityDeathAnimationActive(this.gameService.player)
    ) {
      return;
    }

    const { centerX, centerY } = this.drawTankBase(
      this.gameService.player,
      this.gameService.player.color,
      (cx, cy) => {
        this.drawTankAimingArc(cx, cy);
        this.drawTankAimLines(cx, cy);
      },
      (cx, cy) => {
        // Draw aiming line (behind body)
        if (this.currentState === GameState.PLAYING || this.currentState === GameState.PAUSED) {
          const angleRad = (this.gameService.player.angle * Math.PI) / 180;
          const endX = cx + Math.cos(angleRad) * CONST.AIM_LINE_LENGTH;
          const endY = cy - Math.sin(angleRad) * CONST.AIM_LINE_LENGTH;
          this.ctx.strokeStyle = CONST.AIMING_LINE_COLOR;
          this.ctx.lineWidth = CONST.AIMING_LINE_WIDTH;
          this.ctx.setLineDash(CONST.AIMING_LINE_DASH);
          this.ctx.beginPath();
          this.ctx.moveTo(cx, cy);
          this.ctx.lineTo(endX, endY);
          this.ctx.stroke();
          this.ctx.setLineDash([]);
        }
      },
    );

    this.drawShieldOverlay(this.gameService.player, centerX, centerY);

    // Draw player prediction path when charging (skip for shotgun — pellets fire randomly)
    if (
      this.showPrediction &&
      this.gameService.isCharging &&
      this.gameService.hasAimGuide &&
      !this.gameService.player.vehicle.bullet.shotgunCount
    ) {
      const angleRad = this.gameService.getBarrelAngle();
      const barrelEndX = this.gameService.player.x + Math.cos(angleRad) * CONST.BARREL_LENGTH;
      const barrelEndY = this.gameService.player.y - Math.sin(angleRad) * CONST.BARREL_LENGTH;
      this.drawPredictionPath(
        barrelEndX,
        barrelEndY,
        angleRad,
        this.gameService.player.power,
        this.gameService.player.vehicle.bullet,
        CONST.PREDICTION_PLAYER_COLOR,
      );
    }

    // Draw UI elements (health bar, name label)
    this.drawEntityUI(
      this.gameService.player,
      centerX,
      centerY,
      CONST.TANK_BODY_RADIUS,
      true,
      this.gameService.playerName,
    );
  }

  private drawEnemies() {
    for (const enemy of this.gameService.enemies) {
      if (enemy.active || this.isEntityDeathAnimationActive(enemy)) {
        this.drawEnemy(enemy);
      }
    }
  }

  private drawEnemy(enemy: any) {
    const { centerX, centerY } = this.drawTankBase(enemy, CONST.ENEMY_FALLBACK_COLOR);

    this.drawShieldOverlay(enemy, centerX, centerY);

    // Draw UI elements (health bar, name label)
    const enemyIndex = this.gameService.enemies.indexOf(enemy);
    this.drawEntityUI(
      enemy,
      centerX,
      centerY,
      CONST.TANK_BODY_RADIUS,
      false,
      `Enemy ${enemyIndex + 1}`,
    );

    // Draw prediction path if enabled
    if (this.showPrediction && enemy.entityState === 'charging') {
      const baseAngleRad = (enemy.angle * Math.PI) / 180;
      const angleRad =
        -enemy.terrainAngle + (enemy.facing === -1 ? Math.PI - baseAngleRad : baseAngleRad);
      const barrelLength = CONST.BARREL_LENGTH;
      const barrelEndX = enemy.x + Math.cos(angleRad) * barrelLength;
      const barrelEndY = enemy.y - Math.sin(angleRad) * barrelLength;

      this.drawPredictionPath(
        barrelEndX,
        barrelEndY,
        angleRad,
        enemy.power,
        enemy.vehicle.bullet,
        CONST.PREDICTION_ENEMY_COLOR,
      );
    }
  }

  private drawAllShields() {
    const entities: any[] = [this.gameService.player, ...this.gameService.enemies];
    for (const entity of entities) {
      if (!entity.active && !this.isEntityDeathAnimationActive(entity)) continue;
      const screen = this.cameraController.worldToScreen(entity.x, entity.y);
      this.drawShieldOverlay(entity, screen.x, screen.y);
    }
  }

  private drawShieldOverlay(entity: any, centerX: number, centerY: number) {
    if (this.gameService.currentState === GameState.SETUP) return;
    const now = this.renderTime;
    const drawInfo = this.shieldAnimService.getShieldDrawInfo(entity, now);
    if (!drawInfo) return;
    const { spriteName, rotation } = drawInfo;

    const sprite = this.spriteService.getSprite(spriteName);
    if (!sprite) return;

    const size = (entity.vehicle?.shieldRadius ?? 120) * 2 * 1.15;

    // Draw shield to offscreen canvas, then punch out terrain so it is naturally occluded.
    if (
      !this.shieldMaskCanvas ||
      this.shieldMaskCanvas.width !== CONST.CANVAS_WIDTH ||
      this.shieldMaskCanvas.height !== CONST.CANVAS_HEIGHT
    ) {
      this.shieldMaskCanvas = document.createElement('canvas');
      this.shieldMaskCanvas.width = CONST.CANVAS_WIDTH;
      this.shieldMaskCanvas.height = CONST.CANVAS_HEIGHT;
      this.shieldMaskCtx = this.shieldMaskCanvas.getContext('2d');
    }
    const offCtx = this.shieldMaskCtx!;
    offCtx.clearRect(0, 0, CONST.CANVAS_WIDTH, CONST.CANVAS_HEIGHT);

    offCtx.save();
    if (rotation !== 0) {
      offCtx.translate(centerX, centerY);
      offCtx.rotate(rotation);
      offCtx.translate(-centerX, -centerY);
    }
    offCtx.drawImage(
      sprite.image,
      sprite.x,
      sprite.y,
      sprite.width,
      sprite.height,
      centerX - size / 2,
      centerY - size / 2,
      size,
      size,
    );
    offCtx.restore();

    // Erase shield pixels that fall on solid terrain.
    const terrainY = Math.floor(
      CONST.CANVAS_HEIGHT - CONST.TERRAIN_BASE_Y_OFFSET - this.cameraController.camera.y,
    );
    const startX = Math.max(0, Math.floor(this.cameraController.camera.x));
    const endX = Math.min(
      CONST.TERRAIN_WIDTH,
      Math.ceil(this.cameraController.camera.x + CONST.CANVAS_WIDTH),
    );
    offCtx.globalCompositeOperation = 'destination-out';
    offCtx.fillStyle = 'rgba(0,0,0,1)';
    this.scanlineTerrainFill(offCtx, terrainY, startX, endX, 1);
    offCtx.globalCompositeOperation = 'source-over';

    this.ctx.drawImage(this.shieldMaskCanvas, 0, 0);
  }

  // Shared tank rendering core: transform, shadow, barrel, body, restore.
  // afterFacingFlip: called inside ctx.save() after the facing transform (for aim arc/lines).
  // beforeBody: called inside ctx.save() after the barrel but before the body sprite (for dotted aim line).
  // Returns screen-space centre so callers can draw UI/predictions after the restore.
  private drawTankBase(
    entity: any,
    fallbackColor: string,
    afterFacingFlip?: (cx: number, cy: number) => void,
    beforeBody?: (cx: number, cy: number) => void,
  ): { centerX: number; centerY: number } {
    const screenPos = this.cameraController.worldToScreen(entity.x, entity.y);
    const centerX = screenPos.x;
    const centerY = screenPos.y;
    const bodyRadius = CONST.TANK_BODY_RADIUS;

    this.ctx.save();

    this.ctx.translate(centerX, centerY);
    this.ctx.rotate(entity.terrainAngle);
    this.ctx.translate(-centerX, -centerY);

    if (entity.facing === -1) {
      this.ctx.scale(-1, 1);
      this.ctx.translate(-centerX * 2, 0);
    }

    afterFacingFlip?.(centerX, centerY);

    this.drawTankShadow(centerX, centerY, bodyRadius);
    this.drawCursorBarrel(centerX, centerY, (entity.angle * Math.PI) / 180);

    beforeBody?.(centerX, centerY);

    if (!this.drawEntityBody(entity, fallbackColor, centerX, centerY, bodyRadius)) {
      this.drawTankTracks(centerX, centerY, bodyRadius);
    }

    this.ctx.restore();
    return { centerX, centerY };
  }

  private getCursorFrameIndex(now: number = Date.now()): number {
    const frameDuration = 90;
    return Math.floor(now / frameDuration) % 6;
  }

  private getExplosionFrameIndex(now: number = Date.now()): number {
    return Math.floor(now / this.EXPLOSION_SPRITE_FRAME_DURATION_MS) % this.EXPLOSION_FRAME_COUNT;
  }

  private drawCursorBarrel(centerX: number, centerY: number, angleRad: number) {
    const cursorFrameIndex = this.getCursorFrameIndex(this.renderTime);
    const cursorSprite = this.spriteService.getSprite(`cursor_${cursorFrameIndex}`);

    // Fallback to original barrel shape if cursor sprite isn't loaded yet.
    if (!cursorSprite) {
      this.drawClassicBarrel(centerX, centerY, angleRad);
      return;
    }

    const pivotOffset = CONST.BARREL_LENGTH + 14;
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
    const barrelLength = CONST.BARREL_LENGTH;
    const barrelWidth = CONST.BARREL_WIDTH;

    this.ctx.save();
    this.ctx.translate(centerX, centerY);
    this.ctx.rotate(-angleRad);

    this.ctx.fillStyle = CONST.BARREL_COLOR;
    this.ctx.strokeStyle = CONST.BARREL_STROKE_COLOR;
    this.ctx.lineWidth = CONST.BARREL_STROKE_WIDTH;

    this.ctx.fillRect(0, -barrelWidth / 2, barrelLength, barrelWidth);
    this.ctx.strokeRect(0, -barrelWidth / 2, barrelLength, barrelWidth);

    this.ctx.fillStyle = CONST.BARREL_TIP_COLOR;
    this.ctx.fillRect(
      barrelLength - CONST.BARREL_TIP_LENGTH,
      -barrelWidth / 2 - 1,
      CONST.BARREL_TIP_LENGTH,
      barrelWidth + CONST.BARREL_TIP_EXTRA_HEIGHT,
    );

    this.ctx.restore();
  }

  private drawTankAimingArc(centerX: number, centerY: number) {
    // Draw cannon range arc (before facing flip)
    // Note: Canvas y increases downward, so positive angles go down. Negate angles to make arcs appear above the tank.
    if (
      this.gameService.currentState === GameState.PLAYING ||
      this.gameService.currentState === GameState.PAUSED
    ) {
      const minAngle = (this.gameService.player.vehicle.minAimAngle * Math.PI) / 180;
      const maxAngle = (this.gameService.player.vehicle.maxAimAngle * Math.PI) / 180;

      this.ctx.globalAlpha = 0.55;
      this.ctx.fillStyle = CONST.CANNON_ARC_COLOR; // Yellow transparent
      this.ctx.beginPath();
      this.ctx.moveTo(centerX, centerY);
      this.ctx.arc(centerX, centerY, CONST.CANNON_ARC_RADIUS, -maxAngle, -minAngle);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.globalAlpha = 1.0;

      // Draw grey aim guide 0° to 90°
      this.ctx.globalAlpha = 0.3; // Darker grey
      this.ctx.fillStyle = CONST.AIM_GUIDE_COLOR; // Grey transparent
      this.ctx.beginPath();
      this.ctx.moveTo(centerX, centerY);
      this.ctx.arc(centerX, centerY, CONST.CANNON_ARC_RADIUS, -Math.PI / 2, 0); // -90° to 0°
      this.ctx.closePath();
      this.ctx.fill();
    }
  }

  private drawTankAimLines(centerX: number, centerY: number) {
    // Draw solid lines at 0°, 45°, 90° (after facing flip, so they flip with tank)
    if (
      this.gameService.currentState === GameState.PLAYING ||
      this.gameService.currentState === GameState.PAUSED
    ) {
      this.ctx.globalAlpha = 1.0;
      this.ctx.strokeStyle = CONST.AIM_LINE_COLOR;
      this.ctx.lineWidth = CONST.AIM_LINE_WIDTH;
      const angles = [0, -Math.PI / 4, -Math.PI / 2];
      angles.forEach((angle) => {
        const endX = centerX + Math.cos(-angle) * CONST.AIM_LINE_LENGTH;
        const endY = centerY - Math.sin(-angle) * CONST.AIM_LINE_LENGTH;
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
      true, // dotted preview ignores wind
    );
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([6, 5]);
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
    this.ctx.fillStyle = CONST.TANK_SHADOW_COLOR;
    this.ctx.beginPath();
    this.ctx.ellipse(
      centerX,
      centerY + 2,
      bodyRadius,
      bodyRadius * CONST.TANK_SHADOW_HEIGHT_RATIO,
      0,
      0,
      Math.PI,
      true,
    );
    this.ctx.fill();
  }

  private getMoveFrameIndex(now: number = Date.now()): number {
    const frameDurations = this.MOVE_FRAME_DURATIONS;
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

  private hasEntitySprites(entity: any): boolean {
    return entity?.vehicle?.spritesheet != null;
  }

  private isEntityCharging(entity: any): boolean {
    return entity?.entityState === 'charging';
  }

  private getShootChargeFrameIndex(entity: any, now: number = Date.now()): number | null {
    if (!this.hasEntitySprites(entity) || !this.isEntityCharging(entity)) {
      return null;
    }

    const chargeStartTime = entity.chargeStartTime ?? now;
    const chargeElapsed = Math.max(0, now - chargeStartTime);
    const chargeFrameIndex = Math.floor(chargeElapsed / this.SHOOT_CHARGE_FRAME_DURATION_MS);
    return Math.min(this.SHOOT_CHARGE_FRAME_COUNT - 1, chargeFrameIndex);
  }

  private getShootReleaseFrameIndex(entity: any, now: number = Date.now()): number | null {
    if (!this.hasEntitySprites(entity)) {
      return null;
    }

    const releaseStartTime = entity.shotReleaseStartMs;
    if (releaseStartTime === undefined) {
      return null;
    }

    const releaseFrameCount = this.SHOOT_TOTAL_FRAME_COUNT - this.SHOOT_CHARGE_FRAME_COUNT;
    const releaseElapsed = Math.max(0, now - releaseStartTime);
    const releaseFrameIndex = Math.floor(releaseElapsed / this.SHOOT_RELEASE_FRAME_DURATION_MS);
    if (releaseFrameIndex >= releaseFrameCount) {
      delete entity.shotReleaseStartMs;
      entity.entityState = 'idle';
      return null;
    }

    return this.SHOOT_CHARGE_FRAME_COUNT + releaseFrameIndex;
  }

  private getDeathAnimationState(entity: any, now: number = Date.now()) {
    if (!this.hasEntitySprites(entity)) {
      return null;
    }

    const deathStartTime = entity.deathAnimStartMs;
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
    if (!this.hasEntitySprites(entity)) {
      return false;
    }

    const now = this.renderTime;
    const deathAnimationState = this.getDeathAnimationState(entity, now);
    const spritesheet = entity.vehicle.spritesheet as string;
    const animName = deathAnimationState?.isActive
      ? `death_${deathAnimationState.frameIndex}`
      : entity.entityState === 'hurting'
        ? 'hurt'
        : entity.entityState === 'shooting'
          ? `shoot_${this.getShootReleaseFrameIndex(entity, now) ?? 0}`
          : entity.entityState === 'charging'
            ? `shoot_${this.getShootChargeFrameIndex(entity, now) ?? 0}`
            : entity.entityState === 'moving' ||
                (entity.entityState === 'idle' &&
                  entity.body &&
                  Math.abs(entity.body.velocity.x) > 0.1)
              ? `move_${this.getMoveFrameIndex(now)}`
              : 'idle';

    const isComposite = this.COMPOSITE_SHEETS.has(spritesheet);
    const sprite = this.spriteService.getEntitySprite(animName, spritesheet);

    if (!sprite) {
      return false;
    }

    const spriteSize = bodyRadius * 2 * 1.5;
    const spriteYOffset = -15;

    this.ctx.save();
    this.ctx.translate(centerX, centerY);
    this.ctx.scale(-1, 1);
    if (deathAnimationState?.isActive) {
      this.ctx.globalAlpha = deathAnimationState.alpha;
    }

    if (isComposite) {
      this.drawCompositeLayers(entity, animName, sprite, spriteSize, spriteYOffset);
    } else {
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
    }

    this.ctx.restore();

    return true;
  }

  private drawCompositeLayers(
    entity: any,
    animName: string,
    backSprite: { image: CanvasImageSource; x: number; y: number; width: number; height: number },
    spriteSize: number,
    spriteYOffset: number,
  ): void {
    const entitySheet: string = (entity.vehicle?.spritesheet as string | undefined) ?? this.LUPIN_COMPOSITE;
    const layerOffsets = this.spriteService.getLayerOffsets(entitySheet);
    const frameOffsets: LayerFrameOffset | undefined = layerOffsets?.frames[animName];
    const explosionScaleMultiplier = layerOffsets?.explosionScale ?? 1.0;
    const heldItemSprite = (entity.vehicle?.bullet?.heldItemSprite as string | undefined) ?? null;
    const overlaySpriteName = (entity.vehicle?.bullet?.overlaySprite as string | undefined) ?? null;

    // Layer 1: back
    this.ctx.drawImage(
      backSprite.image,
      backSprite.x,
      backSprite.y,
      backSprite.width,
      backSprite.height,
      -spriteSize / 2,
      -spriteSize / 2 + spriteYOffset,
      spriteSize,
      spriteSize,
    );

    // Fruit config — overlayZ controls whether overlay draws below (<2) or above (>=2) the fruit
    const fruitCfg = heldItemSprite ? (layerOffsets?.fruitConfig[heldItemSprite] ?? null) : null;
    const fruitScale = fruitCfg?.scale ?? 1.0;
    const overlayZ = fruitCfg?.overlayZ ?? 3;

    const drawOverlay = () => {
      if (!overlaySpriteName || frameOffsets?.hideLayers?.includes('overlay')) return;
      const overlaySprite = this.spriteService.getSprite(overlaySpriteName);
      if (!overlaySprite) return;
      const ox = frameOffsets?.overlay.x ?? 0;
      const oy = frameOffsets?.overlay.y ?? 0;
      this.ctx.drawImage(
        overlaySprite.image,
        overlaySprite.x,
        overlaySprite.y,
        overlaySprite.width,
        overlaySprite.height,
        -spriteSize / 2 + ox,
        -spriteSize / 2 + spriteYOffset + oy,
        spriteSize,
        spriteSize,
      );
    };

    // Overlay under fruit (overlayZ < 2, e.g. apple bitten base)
    if (overlayZ < 2) drawOverlay();

    // Layer 2: fruit (positioned by per-frame offset, scaled)
    if (heldItemSprite && !frameOffsets?.hideLayers?.includes('fruit')) {
      const fruitSprite = this.spriteService.getSprite(heldItemSprite);
      if (fruitSprite) {
        const fruitSz = spriteSize * fruitScale;
        const fx = frameOffsets?.fruit.x ?? 0;
        const fy = frameOffsets?.fruit.y ?? 0;
        this.ctx.drawImage(
          fruitSprite.image,
          fruitSprite.x,
          fruitSprite.y,
          fruitSprite.width,
          fruitSprite.height,
          -fruitSz / 2 + fx,
          -fruitSz / 2 + spriteYOffset + fy,
          fruitSz,
          fruitSz,
        );
      }
    }

    // Layer 2.5: above-fruit overlay (e.g. head_eat for shoot_1), drawn on top of fruit, no offset
    const aboveFruitSpriteName = frameOffsets?.aboveFruitSpriteName ?? null;
    if (aboveFruitSpriteName) {
      const aboveFruitSprite = this.spriteService.getSprite(aboveFruitSpriteName);
      if (aboveFruitSprite) {
        this.ctx.drawImage(
          aboveFruitSprite.image,
          aboveFruitSprite.x,
          aboveFruitSprite.y,
          aboveFruitSprite.width,
          aboveFruitSprite.height,
          -spriteSize / 2,
          -spriteSize / 2 + spriteYOffset,
          spriteSize,
          spriteSize,
        );
      }
    }

    // Layer 3: hand
    const handSprite = this.spriteService.getEntitySprite('hand', entitySheet);
    if (handSprite && !frameOffsets?.hideLayers?.includes('hand')) {
      const hx = frameOffsets?.hand.x ?? 0;
      const hy = frameOffsets?.hand.y ?? 0;
      this.ctx.drawImage(
        handSprite.image,
        handSprite.x,
        handSprite.y,
        handSprite.width,
        handSprite.height,
        -spriteSize / 2 + hx,
        -spriteSize / 2 + spriteYOffset + hy,
        spriteSize,
        spriteSize,
      );
    }

    // Overlay on top of fruit (overlayZ >= 2, e.g. banana peel)
    if (overlayZ >= 2) drawOverlay();

    // Layer 4: halo (zombie composite only)
    if (entitySheet === this.ZOMBIE_COMPOSITE && !frameOffsets?.hideLayers?.includes('halo')) {
      const haloSprite = this.spriteService.getSprite('zombie_halo');
      if (haloSprite) {
        const hlx = frameOffsets?.halo?.x ?? 0;
        const hly = frameOffsets?.halo?.y ?? 0;
        this.ctx.drawImage(
          haloSprite.image,
          haloSprite.x,
          haloSprite.y,
          haloSprite.width,
          haloSprite.height,
          -spriteSize / 2 + hlx,
          -spriteSize / 2 + spriteYOffset + hly,
          spriteSize,
          spriteSize,
        );
      }
    }

    // Store explosion scale multiplier on entity for use by drawExplosions
    (entity as any).__explosionScaleMultiplier = explosionScaleMultiplier;
  }

  private updateHurtSpriteState() {
    const now = this.renderTime;
    this.trackEntityDamage(this.gameService.player, now);
    for (const enemy of this.gameService.enemies) {
      this.trackEntityDamage(enemy, now);
    }
  }

  private trackEntityDamage(entity: any, now: number) {
    if (!this.hasEntitySprites(entity)) {
      return;
    }

    const key = entity as object;
    const currentHealth = Number(entity?.health ?? 0);
    const previousHealth = entity.prevHealth;

    if (previousHealth !== undefined && currentHealth < previousHealth) {
      if (currentHealth <= 0) {
        if (entity.deathAnimStartMs === undefined) {
          entity.deathAnimStartMs = now;
        }
      } else {
        entity.hurtUntilMs = now + this.HURT_SPRITE_DURATION_MS;
        entity.entityState = 'hurting';
      }
    }

    // Clear hurting state when the timer has expired
    if (entity.entityState === 'hurting' && (entity.hurtUntilMs ?? 0) <= now) {
      entity.entityState = 'idle';
    }

    entity.prevHealth = currentHealth;
  }

  private drawEntityBody(
    entity: any,
    fallbackColor: string,
    centerX: number,
    centerY: number,
    bodyRadius: number,
  ): boolean {
    if (this.drawEntitySprite(entity, centerX, centerY, bodyRadius)) {
      return true;
    }
    this.ctx.fillStyle = fallbackColor;
    this.ctx.strokeStyle = CONST.TANK_BODY_STROKE_COLOR;
    this.ctx.lineWidth = CONST.TANK_BODY_STROKE_WIDTH;
    this.ctx.beginPath();
    this.ctx.arc(centerX, centerY, bodyRadius, Math.PI, 0, false);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.stroke();
    return false;
  }

  private drawTankTracks(centerX: number, centerY: number, bodyRadius: number) {
    // Draw tank tracks/details - on top
    this.ctx.fillStyle = CONST.TANK_TRACK_COLOR;
    this.ctx.fillRect(
      centerX - bodyRadius + CONST.TANK_TRACK_OFFSET,
      centerY - 3,
      bodyRadius * 2 - 4,
      CONST.TANK_TRACK_HEIGHT,
    );
    this.ctx.strokeRect(
      centerX - bodyRadius + CONST.TANK_TRACK_OFFSET,
      centerY - 3,
      bodyRadius * 2 - 4,
      CONST.TANK_TRACK_HEIGHT,
    );

    // Draw tank tracks (left and right)
    this.ctx.fillStyle = CONST.TANK_TRACK_INNER_COLOR;
    this.ctx.fillRect(
      centerX - bodyRadius + 4,
      centerY - 5,
      CONST.TANK_TRACK_DETAIL_WIDTH,
      CONST.TANK_TRACK_DETAIL_HEIGHT,
    );
    this.ctx.fillRect(centerX + bodyRadius - 7, centerY - 5, 3, 10);
  }

  private drawEntityUI(
    entity: any,
    centerX: number,
    centerY: number,
    bodyRadius: number,
    isPlayer: boolean = false,
    label?: string,
  ) {
    if (!entity || !entity.vehicle || typeof entity.health !== 'number') {
      return;
    }

    if (entity.health <= 0) {
      return;
    }

    // Draw name label: show for everyone when not the player's turn, or when the player is idle
    if (
      label &&
      (!this.gameService.isPlayerTurn() || this.gameService.player.turnState === 'idle')
    ) {
      const labelY = centerY - bodyRadius - 25;
      this.ctx.font = 'bold 13px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'bottom';
      // Dark outline for legibility
      this.ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      this.ctx.lineWidth = 3;
      this.ctx.lineJoin = 'round';
      this.ctx.strokeText(label, centerX, labelY);
      this.ctx.fillStyle = isPlayer ? '#88DDFF' : '#FFAAAA';
      this.ctx.fillText(label, centerX, labelY);
      this.ctx.textBaseline = 'middle';
    }

    // Draw health bar under the tank
    const healthRatio = entity.health / entity.vehicle.health;
    const barWidth = 60;
    const barHeight = 5;
    const barX = centerX - barWidth / 2;
    const barY = centerY + bodyRadius - 5;
    // Background bar
    this.ctx.fillStyle = CONST.HEALTH_BAR_BG_COLOR;
    this.ctx.fillRect(barX, barY, barWidth, barHeight);
    // Health bar
    this.ctx.fillStyle = isPlayer ? CONST.HEALTH_BAR_PLAYER_COLOR : CONST.HEALTH_BAR_ENEMY_COLOR; // Green for player, red for enemies
    this.ctx.fillRect(barX, barY, barWidth * healthRatio, barHeight);

    // Draw angle text to the right of health bar
    const angleDeg = this.gameService.getEntityDisplayedAngle(entity);
    this.drawAngleText(angleDeg, barX + barWidth + 6, barY + barHeight / 2, 18);

    // Draw movement gauge if moving
    if (Math.abs(entity.body.velocity.x) > 0.1) {
      const movementRatio = entity.movementFuel / entity.vehicle.fuel;
      const movementBarY = barY + barHeight + 2;
      // Background
      this.ctx.fillStyle = CONST.HEALTH_BAR_BG_COLOR;
      this.ctx.fillRect(barX, movementBarY, barWidth, barHeight);
      // Movement bar
      this.ctx.fillStyle = CONST.MOVEMENT_BAR_COLOR; // Yellow
      this.ctx.fillRect(barX, movementBarY, barWidth * movementRatio, barHeight);
    }
  }

  private drawBulletAt(
    screenPos: { x: number; y: number },
    bulletSprite: SpriteData | null,
    angle?: number,
  ): void {
    if (bulletSprite) {
      const drawSize = CONST.PROJECTILE_DRAW_RADIUS * this.BULLET_SPRITE_SIZE_MULTIPLIER;
      if (angle !== undefined) {
        this.ctx.save();
        this.ctx.translate(screenPos.x, screenPos.y);
        this.ctx.rotate(angle);
        this.ctx.drawImage(
          bulletSprite.image,
          bulletSprite.x,
          bulletSprite.y,
          bulletSprite.width,
          bulletSprite.height,
          -drawSize / 2,
          -drawSize / 2,
          drawSize,
          drawSize,
        );
        this.ctx.restore();
      } else {
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
      }
    } else {
      this.ctx.fillStyle = CONST.PROJECTILE_COLOR;
      this.ctx.beginPath();
      this.ctx.arc(screenPos.x, screenPos.y, CONST.PROJECTILE_DRAW_RADIUS, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  private drawProjectile() {
    const bulletPrefix = this.gameService.projectile?.bullet.bulletSprite ?? 'bullet';
    const bulletSprite = this.spriteService.getSprite(bulletPrefix);

    if (this.gameService.projectile) {
      let pos: { x: number; y: number };
      if (this.gameService.projectile.body) {
        pos = this.gameService.projectile.body.position;
      } else {
        pos = { x: this.gameService.projectile.x, y: this.gameService.projectile.y };
      }
      let angle: number | undefined;
      if (
        this.gameService.projectile.bullet.rotatesToVelocity &&
        this.gameService.projectile.body?.velocity
      ) {
        const vel = this.gameService.projectile.body.velocity;
        angle = Math.atan2(vel.y, vel.x);
      }
      const rotSpeed = this.gameService.projectile.bullet.bulletRotationSpeed;
      if (rotSpeed) {
        const spinAngle = ((performance.now() * rotSpeed) / 1000) % (2 * Math.PI);
        angle = (angle ?? 0) + spinAngle;
      }
      this.drawBulletAt(this.cameraController.worldToScreen(pos.x, pos.y), bulletSprite, angle);
    } else if (this.gameService.aftermathImpactPos) {
      const impactPos = this.gameService.aftermathImpactPos;
      this.drawBulletAt(
        this.cameraController.worldToScreen(impactPos.x, impactPos.y),
        bulletSprite,
      );
    }
  }

  private drawExplosions() {
    const explosionFrameIndex = this.getExplosionFrameIndex(this.renderTime);

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

      const spritePrefix = explosion.spriteName ?? 'explosion';
      const explosionSprite = this.spriteService.getSprite(
        `${spritePrefix}_${explosionFrameIndex}`,
      );

      if (explosionSprite) {
        const explosionScale =
          spritePrefix === 'explosion'
            ? (this.spriteService.getLayerOffsets(this.LUPIN_COMPOSITE)?.explosionScale ?? 1.0)
            : spritePrefix === 'zombie_explosion'
              ? (this.spriteService.getLayerOffsets(this.ZOMBIE_COMPOSITE)?.explosionScale ?? 1.0)
              : 1.0;
        let spriteWidth = explosion.radius * this.EXPLOSION_SPRITE_SIZE_MULTIPLIER * explosionScale;
        let spriteHeight =
          explosion.radius * this.EXPLOSION_SPRITE_SIZE_MULTIPLIER * explosionScale;

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
      } else {
        // Fallback: gradient circle
        const gradient = this.ctx.createRadialGradient(
          screenPos.x,
          screenPos.y,
          0,
          screenPos.x,
          screenPos.y,
          explosion.radius,
        );
        gradient.addColorStop(0, CONST.EXPLOSION_CENTER_COLOR);
        gradient.addColorStop(0.5, CONST.EXPLOSION_MIDDLE_COLOR);
        gradient.addColorStop(1, CONST.EXPLOSION_EDGE_COLOR);

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
          this.ctx.arc(screenPos.x, screenPos.y, explosion.radius, 0, Math.PI * 2);
        }
        this.ctx.fill();

        this.ctx.strokeStyle = CONST.EXPLOSION_OUTLINE_COLOR;
        this.ctx.lineWidth = CONST.EXPLOSION_OUTLINE_WIDTH;
        this.ctx.stroke();
      }
    }
  }

  private drawChildProjectiles(): void {
    for (const child of this.gameService.childProjectiles) {
      const prefix = child.bullet.bulletSprite ?? 'bullet';
      const sprite = this.spriteService.getSprite(prefix);
      const screenPos = this.cameraController.worldToScreen(child.x, child.y);
      let angle: number | undefined;
      if (child.spinRate !== undefined) {
        const elapsed = (this.renderTime - (child.spawnTimeMs ?? this.renderTime)) / 1000;
        angle = (elapsed * child.spinRate) % (2 * Math.PI);
      }
      this.drawBulletAt(screenPos, sprite, angle);
    }
  }

  private drawSpriteChars(
    text: string,
    map: Record<string, string>,
    startX: number,
    topY: number,
    size: number,
    advance: number,
    tint?: string,
    plainFallback = false,
  ): void {
    let x = startX;
    for (const ch of text) {
      const spriteName = map[ch];
      const sprite = spriteName ? this.spriteService.getSprite(spriteName) : null;
      if (sprite) {
        if (tint) {
          this.ctx.drawImage(this.tintedGlyph(sprite, size, tint), x, topY);
        } else {
          this.ctx.drawImage(
            sprite.image,
            sprite.x,
            sprite.y,
            sprite.width,
            sprite.height,
            x,
            topY,
            size,
            size,
          );
        }
      } else if (plainFallback) {
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.font = `${size}px Arial`;
        this.ctx.textAlign = 'left';
        this.ctx.fillText(ch, x, topY + size);
      }
      x += advance;
    }
  }

  private drawDamageTexts() {
    const size = 28;
    const advance = size * 0.45;
    for (const text of this.gameService.damageTexts) {
      const tint = text.isHeal ? '#22FF55' : CONST.DAMAGE_TEXT_COLOR;
      const screenPos = this.cameraController.worldToScreen(text.x, text.y);
      this.ctx.globalAlpha = text.life / CONST.DAMAGE_TEXT_LIFETIME;
      const damageStr = String(text.damage);
      const totalWidth = (damageStr.length - 1) * advance + size;
      this.drawSpriteChars(
        damageStr,
        this.ANGLE_CHAR_TO_SPRITE,
        screenPos.x - totalWidth / 2,
        screenPos.y - size,
        size,
        advance,
        tint,
      );
    }
    this.ctx.globalAlpha = 1;
  }

  private drawUI() {
    // Draw countdown timer in top right
    if (
      this.gameService.currentState === GameState.PLAYING ||
      this.gameService.currentState === GameState.PAUSED
    ) {
      const now = this.renderTime;
      const remaining = Math.max(0, Math.floor(45 - (now - this.gameService.turnStartTime) / 1000));
      this.drawArenaNumber(String(remaining), CONST.CANVAS_WIDTH - 20, 8, 64);
    }
    if (
      this.gameService.currentState === GameState.PLAYING ||
      this.gameService.currentState === GameState.AFTERMATH ||
      this.gameService.currentState === GameState.PAUSED ||
      this.gameService.currentState === GameState.SETUP
    ) {
      this.drawWindIndicator();
      this.drawWeaponButtons();
    }

    // Draw turn message
    if (this.turnMessage) {
      const FADE = 500;
      const alpha =
        this.messageTimer > 1000
          ? (1500 - this.messageTimer) / FADE // fade in
          : this.messageTimer > FADE
            ? 1 // hold
            : this.messageTimer / FADE; // fade out
      this.ctx.save();
      this.ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      this.drawSpriteTextCentered(this.turnMessage, CONST.CANVAS_HEIGHT / 3 - 54, 70, 0.42);
      this.ctx.restore();
    }

    // Draw pause/game over message
    if (this.gameService.currentState === GameState.PAUSED) {
      this.drawSpriteTextCentered('Paused', CONST.CANVAS_HEIGHT / 3 - 35, 70, 0.42);
    } else if (
      this.gameService.currentState === GameState.GAME_OVER_DELAY ||
      this.gameService.currentState === GameState.GAME_OVER ||
      this.gameService.currentState === GameState.WIN_DELAY ||
      this.gameService.currentState === GameState.WIN
    ) {
      const isWin =
        this.gameService.currentState === GameState.WIN_DELAY ||
        this.gameService.currentState === GameState.WIN;
      // Initialise on first frame
      if (this.gameOverAnim.animStart === 0) {
        this.initBouncingLetterAnim(
          this.gameOverAnim,
          isWin ? this.WIN_LETTERS.length : this.GO_LETTERS.length,
        );
      }
      this.updateBouncingLetterAnim(this.gameOverAnim);
      this.drawBouncingLetterAnim(
        this.gameOverAnim,
        isWin ? this.WIN_LETTERS : this.GO_LETTERS,
        isWin ? this.WIN_TEXT_TINT : undefined,
      );

      if (
        this.gameService.currentState === GameState.GAME_OVER ||
        this.gameService.currentState === GameState.WIN
      ) {
        this.drawSpriteTextCentered(
          'Press R to return',
          CONST.CANVAS_HEIGHT / 3 + this.gameOverAnim.cfg.letterSize / 2 + 16,
          28,
        );
      }
    }
  }

  private drawTurnQueue() {
    const queue = [...this.gameService.turnQueue].sort((a, b) => a.entity.delay - b.entity.delay);
    if (queue.length === 0) return;

    const CHAR_SIZE = 24;
    const ADVANCE = CHAR_SIZE * 0.55;
    const ROW_H = CHAR_SIZE + 7;
    const PAD = 30;
    const PANEL_W = 250;
    const PANEL_H = queue.length * ROW_H + PAD * 2;

    this.drawNineSlicePanel('panel_wood_3_nail', 10, 10, PANEL_W, PANEL_H);

    const currentEntity = this.gameService.getCurrentTurnEntity();

    queue.forEach((turnEntity, index) => {
      const topY = 10 + PAD + index * ROW_H;
      const isCurrent = turnEntity.id === currentEntity?.id;

      const tint = isCurrent
        ? CONST.TURN_QUEUE_CURRENT_COLOR
        : turnEntity.type === 'player'
          ? CONST.TURN_QUEUE_PLAYER_COLOR
          : CONST.TURN_QUEUE_ENEMY_COLOR;

      const rawName =
        turnEntity.type === 'player'
          ? this.gameService.playerName
          : `Enemy ${Number(turnEntity.id.split('_')[1]) + 1}`;
      const timeStr = isCurrent ? '0' : String(Math.round(turnEntity.entity.delay));

      this.drawSpriteChars(
        rawName,
        this.TEXT_CHAR_TO_SPRITE,
        10 + PAD,
        topY,
        CHAR_SIZE,
        ADVANCE,
        tint,
        true,
      );

      const timeWidth = timeStr.length * ADVANCE;
      const timeX = 10 + PANEL_W - PAD - timeWidth;
      this.drawSpriteChars(
        timeStr,
        this.TEXT_CHAR_TO_SPRITE,
        timeX,
        topY,
        CHAR_SIZE,
        ADVANCE,
        tint,
        true,
      );
    });
  }

  private drawCombatLog(): void {
    const CHAR_SIZE = 17;
    const ADVANCE = CHAR_SIZE * 0.53;
    const ROW_H = CHAR_SIZE + 9;
    const PAD_X = 20;
    const PAD_Y = 20;
    const MAX_ROWS = 6;
    const PANEL_W = 380;
    const BTN_W = 28;
    const BTN_H = 20;
    const PANEL_X = 10;
    // Bottom anchor — button always sits here
    const BOTTOM_Y = CONST.CANVAS_HEIGHT - 10;
    const FULL_PANEL_H = MAX_ROWS * ROW_H + PAD_Y * 2;

    const log = this.gameService.combatLog.slice(-MAX_ROWS);

    // Toggle button pinned to bottom-right of max footprint
    const btnCX = PANEL_X + PANEL_W - BTN_W / 2 - 4;
    const btnCY = BOTTOM_Y - BTN_H / 2 - 4;
    this.combatLogToggleBtn = this.mkBtn(btnCX, btnCY, BTN_W, BTN_H);

    if (this.combatLogMinimized) {
      // Just the mini strip
      const MINI_H = BTN_H + 8;
      this.drawNineSlicePanel('panel_wood_2_nail', PANEL_X, BOTTOM_Y - MINI_H, PANEL_W, MINI_H);
    } else {
      // Panel grows from bottom up — height based on actual entry count (min 1 row so panel always visible)
      const rowCount = Math.max(1, log.length);
      const PANEL_H = rowCount * ROW_H + PAD_Y * 2;
      const PANEL_Y = BOTTOM_Y - PANEL_H;
      this.drawNineSlicePanel('panel_wood_2_nail', PANEL_X, PANEL_Y, PANEL_W, PANEL_H);

      for (let i = 0; i < log.length; i++) {
        const entry = log[i];
        const rowTopY = PANEL_Y + PAD_Y + i * ROW_H;

        let text: string;
        let tint: string;

        if (entry.type === 'fall') {
          if (entry.attackerName) {
            text = `${entry.targetName}: pushed off cliff`;
            tint = '#FF8844';
          } else {
            text = `${entry.targetName}: fell off map`;
            tint = '#AAAAAA';
          }
        } else if (entry.type === 'miss') {
          text = `${entry.attackerName}: missed!`;
          tint = '#AAAAAA';
        } else if (entry.type === 'pass') {
          text = `${entry.attackerName}: passed their turn`;
          tint = '#AAAAFF';
        } else if (entry.type === 'timeout') {
          text = `${entry.attackerName}: timed out`;
          tint = '#FFAA44';
        } else {
          const weapon = entry.weaponName.replace(/_/g, ' ');
          text = `${entry.attackerName}: ${entry.totalDamage} > ${entry.targetName} (${weapon})`;
          tint = entry.wasFatal ? '#FF4444' : '#EEEEEE';
        }

        this.drawSpriteChars(
          text,
          this.TEXT_CHAR_TO_SPRITE,
          PANEL_X + PAD_X,
          rowTopY,
          CHAR_SIZE,
          ADVANCE,
          tint,
          true,
        );
      }
    }

    // Draw toggle button on top
    this.ctx.fillStyle = 'rgba(0,0,0,0.45)';
    this.ctx.fillRect(btnCX - BTN_W / 2, btnCY - BTN_H / 2, BTN_W, BTN_H);
    this.ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(btnCX - BTN_W / 2, btnCY - BTN_H / 2, BTN_W, BTN_H);
    this.ctx.fillStyle = '#EEEEEE';
    this.ctx.font = 'bold 14px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(this.combatLogMinimized ? '+' : '\u2212', btnCX, btnCY);
    this.ctx.textBaseline = 'alphabetic';
  }

  private getWeaponBtnRect(index: number): { x: number; y: number; width: number; height: number } {
    const size = this.WEAPON_BTN_SIZE;
    const gap = this.WEAPON_BTN_GAP;
    const margin = this.WEAPON_BTN_MARGIN;
    const count = this.vehicleBulletOptions.length;
    // Rightmost button flush to right margin; buttons grow leftward
    const rightEdge = CONST.CANVAS_WIDTH - margin;
    const cx = rightEdge - size / 2 - (count - 1 - index) * (size + gap);
    const cy = CONST.CANVAS_HEIGHT - margin - size / 2;
    return { x: cx, y: cy, width: size, height: size };
  }

  private drawWeaponButtons(): void {
    const bullets = this.vehicleBulletOptions;
    for (let i = 0; i < bullets.length; i++) {
      const btn = this.getWeaponBtnRect(i);
      const left = btn.x - btn.width / 2;
      const top = btn.y - btn.height / 2;
      const panelName =
        i === this.selectedBulletIndex ? 'panel_brown_light_3d' : 'panel_brown_1_dark';
      this.drawNineSlicePanel(panelName, left, top, btn.width, btn.height);

      // Draw item icon centred inside button
      const iconSize = 80;
      const spriteName = bullets[i].heldItemSprite ?? bullets[i].bulletSprite;
      const sprite = spriteName ? this.spriteService.getSprite(spriteName) : null;
      if (sprite) {
        this.ctx.drawImage(
          sprite.image,
          sprite.x,
          sprite.y,
          sprite.width,
          sprite.height,
          btn.x - iconSize / 2,
          btn.y - iconSize / 2 + 4,
          iconSize,
          iconSize,
        );
      }
    }
  }

  private selectWeapon(index: number): void {
    const options = this.vehicleBulletOptions;
    if (index < 0 || index >= options.length) return;
    this.selectedBulletIndex = index;
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
    if (this.isNameEditing && this.gameService.currentState === GameState.EQUIPMENT_MENU) {
      if (event.key === 'Enter' || event.key === 'Escape') {
        this.isNameEditing = false;
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

  private drawLoadingScreen() {
    const cx = CONST.CANVAS_WIDTH / 2;
    const cy = CONST.CANVAS_HEIGHT / 2;
    const barW = 400;
    const barH = 24;
    const barX = cx - barW / 2;
    const barY = cy + 20;
    const progress = this.spriteService.loadProgress;
    const isGameLoad = this.loadingContext === 'game';

    this.ctx.fillStyle = '#1a1a2e';
    this.ctx.fillRect(0, 0, CONST.CANVAS_WIDTH, CONST.CANVAS_HEIGHT);

    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.font = 'bold 36px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(isGameLoad ? 'Loading Game' : 'Monkeys', cx, cy - 40);

    this.ctx.font = '18px Arial';
    this.ctx.fillStyle = '#AAAAAA';
    this.ctx.fillText(
      isGameLoad ? this.spriteService.loadLabel : this.spriteService.loadLabel,
      cx,
      cy - 10,
    );

    // Bar background
    this.ctx.fillStyle = '#333355';
    this.ctx.beginPath();
    this.ctx.roundRect(barX, barY, barW, barH, barH / 2);
    this.ctx.fill();

    // Bar fill
    this.ctx.fillStyle = isGameLoad ? '#4A90E2' : '#4CAF50';
    this.ctx.beginPath();
    this.ctx.roundRect(barX, barY, barW * Math.max(0.02, progress), barH, barH / 2);
    this.ctx.fill();

    // Percentage
    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.font = '14px Arial';
    this.ctx.fillText(`${Math.round(progress * 100)}%`, cx, barY + barH + 20);
  }

  private generateBgTreeInstances() {
    this.bgTreeInstances = [];
    // tree1 and tree3: 6 instances spread across the world width, parallax layer 0.55
    // world coords span ~0 to TERRAIN_WIDTH; we space them roughly evenly with jitter
    const midInstances: { name: string; count: number; scaleMin: number; scaleMax: number }[] = [
      { name: 'tree1_background', count: 4, scaleMin: 0.55, scaleMax: 0.85 },
      { name: 'tree3_background', count: 3, scaleMin: 0.5, scaleMax: 0.8 },
    ];
    // Use a simple deterministic seeded random so layout is stable each game gen
    let seed = 42;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) & 0xffffffff;
      return (seed >>> 0) / 0xffffffff;
    };

    for (const group of midInstances) {
      const step = (CONST.TERRAIN_WIDTH - 200) / group.count;
      for (let i = 0; i < group.count; i++) {
        const worldX = 100 + i * step + rand() * step * 0.6 - step * 0.3;
        const scale = group.scaleMin + rand() * (group.scaleMax - group.scaleMin);
        this.bgTreeInstances.push({ name: group.name, worldX, scale });
      }
    }

    // tree2: 2 larger foreground instances, parallax 0.80
    const fgStep = CONST.TERRAIN_WIDTH / 3;
    for (let i = 0; i < 2; i++) {
      const worldX = fgStep * (i + 0.6) + rand() * fgStep * 0.5;
      const scale = 0.6 + rand() * 0.25;
      this.bgTreeInstances.push({ name: 'tree2_background', worldX, scale });
    }
  }

  private drawParallaxBackground(cameraX: number) {
    const sheet = this.spriteService.getSpritesheet(this.spriteService.BACKGROUND_TOOL_SPRITESHEET);
    if (!sheet) return;
    const byName = new Map(this.spriteService.getBackgroundSprites().map((s) => [s.name, s]));

    // z=0: sky — full cover, no parallax
    const sky = byName.get('sky_background');
    if (sky) this.drawBgCover(sheet, sky, 1);

    // z=1: mountain — parallax 0.15, tiled so right edge never shows
    const mountain = byName.get('montain_background');
    if (mountain) this.drawBgCoverTiled(sheet, mountain, 1, cameraX * 0.15);

    // z=4: tiled trees band — parallax 0.35
    const trees = byName.get('trees_background');
    if (trees) this.drawBgTiledBottom(sheet, trees, 1, cameraX * 0.35);

    // z=5: scattered tree1 / tree3 instances — parallax 0.55
    const instanceSprites = ['tree1_background', 'tree3_background'];
    for (const inst of this.bgTreeInstances.filter((i) => instanceSprites.includes(i.name))) {
      const meta = byName.get(inst.name);
      if (meta) this.drawBgInstance(sheet, meta, inst.worldX, cameraX * 0.55, inst.scale);
    }

    // z=8: foreground tree2 instances — parallax 0.80
    for (const inst of this.bgTreeInstances.filter((i) => i.name === 'tree2_background')) {
      const meta = byName.get(inst.name);
      if (meta) this.drawBgInstance(sheet, meta, inst.worldX, cameraX * 0.8, inst.scale);
    }
  }

  private drawBgCover(
    sheet: HTMLImageElement | HTMLCanvasElement,
    sprite: BackgroundSpriteMetadata,
    scaleMultiplier: number,
    offsetX = 0,
  ) {
    const scaleX = CONST.CANVAS_WIDTH / sprite.width;
    const scaleY = CONST.CANVAS_HEIGHT / sprite.height;
    const scale = Math.max(scaleX, scaleY) * scaleMultiplier;
    const drawW = sprite.width * scale;
    const drawH = sprite.height * scale;
    const drawX = (CONST.CANVAS_WIDTH - drawW) / 2 - offsetX;
    const drawY = (CONST.CANVAS_HEIGHT - drawH) / 2;
    this.ctx.drawImage(
      sheet,
      sprite.x,
      sprite.y,
      sprite.width,
      sprite.height,
      drawX,
      drawY,
      drawW,
      drawH,
    );
  }

  // Like drawBgCover but tiles horizontally so edges never show during parallax scrolling.
  private drawBgCoverTiled(
    sheet: HTMLImageElement | HTMLCanvasElement,
    sprite: BackgroundSpriteMetadata,
    scaleMultiplier: number,
    offsetX = 0,
  ) {
    const scaleX = CONST.CANVAS_WIDTH / sprite.width;
    const scaleY = CONST.CANVAS_HEIGHT / sprite.height;
    const scale = Math.max(scaleX, scaleY) * scaleMultiplier;
    const drawW = sprite.width * scale;
    const drawH = sprite.height * scale;
    const drawY = (CONST.CANVAS_HEIGHT - drawH) / 2;
    const startX = -((offsetX % drawW) + drawW) % drawW;
    for (let x = startX; x < CONST.CANVAS_WIDTH; x += drawW) {
      this.ctx.drawImage(
        sheet,
        sprite.x,
        sprite.y,
        sprite.width,
        sprite.height,
        x,
        drawY,
        drawW,
        drawH,
      );
    }
  }

  private drawBgTiledBottom(
    sheet: HTMLImageElement | HTMLCanvasElement,
    sprite: BackgroundSpriteMetadata,
    scaleMultiplier: number,
    offsetX = 0,
  ) {
    const drawH = sprite.height * scaleMultiplier;
    const drawW = sprite.width * scaleMultiplier;
    const drawY = CONST.CANVAS_HEIGHT - drawH;
    const startX = -((offsetX % drawW) + drawW) % drawW;
    for (let x = startX; x < CONST.CANVAS_WIDTH; x += drawW) {
      this.ctx.drawImage(
        sheet,
        sprite.x,
        sprite.y,
        sprite.width,
        sprite.height,
        x,
        drawY,
        drawW,
        drawH,
      );
    }
  }

  private drawBgInstance(
    sheet: HTMLImageElement | HTMLCanvasElement,
    sprite: BackgroundSpriteMetadata,
    worldX: number,
    parallaxOffset: number,
    scaleMultiplier: number,
  ) {
    const drawW = sprite.width * scaleMultiplier;
    const drawH = sprite.height * scaleMultiplier;
    const screenX = worldX - parallaxOffset;
    const drawY = CONST.CANVAS_HEIGHT - drawH;
    this.ctx.drawImage(
      sheet,
      sprite.x,
      sprite.y,
      sprite.width,
      sprite.height,
      screenX,
      drawY,
      drawW,
      drawH,
    );
  }

  // ─── Equipment / Loadout screen ──────────────────────────────────────────

  /** Initialise loadoutSlotIndices from currently equipped items when entering the screen. */
  private initLoadoutScreen() {
    for (const slot of this.EQUIPMENT_SLOTS) {
      const items = this.gameService.getItemsForSlot(slot);
      const equippedId = this.gameService.equipped[slot]?.id ?? null;
      const idx = items.findIndex((i) => i.id === equippedId);
      this.loadoutSlotIndices[slot] = idx >= 0 ? idx : 0;
    }
    this.isNameEditing = false;
    this.expandedSlot = null;
  }

  /** Map from slot to the item currently selected in the loadout UI (not necessarily saved). */
  private getLoadoutItem(slot: EquipmentSlot): EquipmentItem | null {
    const items = this.gameService.getItemsForSlot(slot);
    if (items.length === 0) return null;
    const idx = this.loadoutSlotIndices[slot];
    return items[idx] ?? null;
  }

  /** Sum a numeric stat across all currently selected equipment items. */
  private getTotalEquipBonus(stat: keyof EquipmentStats): number {
    let total = 0;
    for (const slot of this.EQUIPMENT_SLOTS) {
      const item = this.getLoadoutItem(slot);
      const val = item?.stats?.[stat];
      if (typeof val === 'number') total += val;
    }
    return total;
  }

  /** Returns the dominant setId across selected loadout slots and how many pieces match it. */
  private getPreviewSetInfo(): { setId: string; count: number } | null {
    const counts = new Map<string, number>();
    for (const slot of this.EQUIPMENT_SLOTS) {
      const id = this.getLoadoutItem(slot)?.setId;
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    let best: { setId: string; count: number } | null = null;
    for (const [setId, count] of counts) {
      if (!best || count > best.count) best = { setId, count };
    }
    return best;
  }

  /** Human-readable lines describing a set's bonus. */
  private getPreviewSetBonusLines(setId: string): string[] {
    const set = this.gameService.equipmentSets.find((s) => s.id === setId);
    if (!set?.bonus) return [];
    const b = set.bonus;
    const lines: string[] = [];
    if (b.lifesteal) lines.push(`Lifesteal ${b.lifesteal}%`);
    if (b.shieldHealth) lines.push(`Shield ${b.shieldHealth} HP`);
    if (b.aimGuide) lines.push('Aim Guide');
    if (b.pushbackMultiplier !== undefined)
      lines.push(
        b.pushbackMultiplier === 0
          ? 'No Knockback'
          : b.pushbackMultiplier < 0
            ? `Vacuum ×${Math.abs(b.pushbackMultiplier)}`
            : `Knockback ×${b.pushbackMultiplier}`,
      );
    return lines;
  }

  private drawEquipmentMenu() {
    // Background
    this.ctx.fillStyle = CONST.SKY_COLOR;
    this.ctx.fillRect(0, 0, CONST.CANVAS_WIDTH, CONST.CANVAS_HEIGHT);
    this.drawParallaxBackground(0);

    // Dark overlay
    this.ctx.fillStyle = 'rgba(20, 8, 2, 0.82)';
    this.ctx.fillRect(0, 0, CONST.CANVAS_WIDTH, CONST.CANVAS_HEIGHT);

    // Page title (sprite text, auto-centred on canvas)
    this.drawSpriteTextCentered('Loadout', 18, 34);

    // Panels
    const panelY = 68;
    const panelH = 634;
    for (const [px, pw] of [
      [18, 366],
      [400, 400],
      [816, 366],
    ] as [number, number][]) {
      this.drawNineSlicePanel('panel_wood_3_nail', px, panelY, pw, panelH);
    }

    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'middle';

    // ── Left panel: vehicle preview + name ──────────────────────────────
    const lCx = 18 + 183; // centre-x of left panel

    // Name section header
    this.ctx.fillStyle = '#FFD700';
    this.ctx.font = 'bold 18px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Name', lCx, 100);

    // Name input box
    const nameBoxX = 38;
    const nameBoxY = 114;
    const nameBoxW = 325;
    const nameBoxH = 34;
    this.ctx.strokeStyle = this.isNameEditing ? '#FFD700' : 'rgba(120,72,30,0.7)';
    this.ctx.lineWidth = this.isNameEditing ? 2 : 1;
    this.ctx.fillStyle = 'rgba(25, 10, 4, 0.85)';
    this.ctx.fillRect(nameBoxX, nameBoxY, nameBoxW, nameBoxH);
    this.ctx.strokeRect(nameBoxX, nameBoxY, nameBoxW, nameBoxH);

    const displayName = this.gameService.playerName;
    const cursorVisible =
      this.isNameEditing &&
      performance.now() % this.CURSOR_BLINK_PERIOD_MS < this.CURSOR_ON_DURATION_MS;
    this.ctx.fillStyle = '#F5DEB3';
    this.ctx.font = 'bold 16px Arial';
    this.ctx.textAlign = 'left';
    this.ctx.fillText(
      displayName + (cursorVisible ? '|' : ''),
      nameBoxX + 10,
      nameBoxY + nameBoxH / 2,
    );

    // Click-to-edit hint
    if (!this.isNameEditing) {
      this.ctx.fillStyle = 'rgba(200,170,120,0.6)';
      this.ctx.font = '13px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.fillText('Click to edit name', lCx, 162);
    }

    // Vehicle section header — shows selected vehicle name
    const selVehicleName =
      CONST.SELECTABLE_VEHICLES[this.gameService.selectedVehicleIndex]?.vehicle.name ?? 'Vehicle';
    this.ctx.fillStyle = '#FFD700';
    this.ctx.font = 'bold 18px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(selVehicleName, lCx, 188);

    this.drawVehicleGrid(18, lCx);

    // ── Middle panel: equipment slots ────────────────────────────────────
    const mLeft = 400;
    const mRight = 800;
    const mCx = (mLeft + mRight) / 2;

    this.ctx.fillStyle = '#FFD700';
    this.ctx.font = 'bold 18px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Equipment', mCx, 102);

    // Slot boxes
    const equipSheet = this.spriteService.getSpritesheet('equipment.png');
    const spriteSize = 32;
    const slotBoxX = 416;
    const slotBoxW = 368;
    const slotBoxH = 50;
    const slotGap = 6;
    const slotStartY = 115;

    for (let si = 0; si < this.EQUIPMENT_SLOTS.length; si++) {
      const slot = this.EQUIPMENT_SLOTS[si];
      const rowY = slotStartY + si * (slotBoxH + slotGap);
      const isExpanded = this.expandedSlot === slot;
      const selItem = this.getLoadoutItem(slot);
      const isNone = !selItem || selItem.id?.startsWith('none_');
      const hasSprite =
        !isNone && selItem?.spriteCol !== undefined && selItem?.spriteRow !== undefined;

      // Box background
      if (isExpanded) {
        this.drawNineSlicePanel('panel_brown_2_3d', slotBoxX, rowY, slotBoxW, slotBoxH);
      } else {
        this.drawNineSlicePanel('panel_wood_2_nail', slotBoxX, rowY, slotBoxW, slotBoxH);
      }

      // Icon box (left side)
      const iconPad = 5;
      const iconBoxSize = slotBoxH - iconPad * 2;
      const iconX = slotBoxX + iconPad;
      const iconY = rowY + iconPad;
      this.ctx.fillStyle = hasSprite ? 'rgba(30,14,4,0.7)' : 'rgba(20,10,2,0.45)';
      this.ctx.strokeStyle = hasSprite ? '#6B3A1F' : '#4A2A10';
      this.ctx.lineWidth = 1;
      this.ctx.fillRect(iconX, iconY, iconBoxSize, iconBoxSize);
      this.ctx.strokeRect(iconX, iconY, iconBoxSize, iconBoxSize);
      if (hasSprite && equipSheet) {
        const sx = selItem!.spriteCol! * spriteSize;
        const sy = selItem!.spriteRow! * spriteSize;
        const pad = 3;
        this.ctx.drawImage(
          equipSheet,
          sx,
          sy,
          spriteSize,
          spriteSize,
          iconX + pad,
          iconY + pad,
          iconBoxSize - pad * 2,
          iconBoxSize - pad * 2,
        );
      }

      // Slot type label + item name
      const textX = slotBoxX + slotBoxH + 4;
      this.ctx.textAlign = 'left';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillStyle = '#C8A06A';
      this.ctx.font = '12px Arial';
      this.ctx.fillText(this.SLOT_LABELS[slot], textX, rowY - slotBoxH);
      this.ctx.fillStyle = isNone ? '#8B6347' : isExpanded ? '#FFE880' : '#F5DEB3';
      this.ctx.font = isNone ? '14px Arial' : 'bold 15px Arial';
      this.ctx.fillText(selItem?.name ?? 'None', textX, rowY + slotBoxH * 0.55);
    }

    // Item picker (shown when a slot is expanded)
    if (this.expandedSlot !== null) {
      const slot = this.expandedSlot;
      const items = this.gameService.getItemsForSlot(slot);
      const pickerY = slotStartY + this.EQUIPMENT_SLOTS.length * (slotBoxH + slotGap) - slotGap + 8;

      // Divider
      this.ctx.strokeStyle = 'rgba(160,82,45,0.6)';
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      this.ctx.moveTo(mLeft + 16, pickerY - 4);
      this.ctx.lineTo(mRight - 16, pickerY - 4);
      this.ctx.stroke();

      // 'Select X' label
      this.ctx.fillStyle = '#DEC68A';
      this.ctx.font = 'bold 14px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(`Select ${this.SLOT_LABELS[slot]}`, mCx, pickerY + 11);

      const CELL_W = 72;
      const CELL_GAP = 12;
      const NAME_H = 14;
      const ROW_GAP = 12;
      const CELLS_PER_ROW = 3;
      const totalPickerW = CELLS_PER_ROW * CELL_W + (CELLS_PER_ROW - 1) * CELL_GAP;
      const pickerStartX = Math.round(mCx - totalPickerW / 2);
      const iconStartY = pickerY + 26;

      for (let ii = 0; ii < items.length; ii++) {
        const item = items[ii];
        const col = ii % CELLS_PER_ROW;
        const row = Math.floor(ii / CELLS_PER_ROW);
        const cx = pickerStartX + col * (CELL_W + CELL_GAP);
        const cy = iconStartY + row * (CELL_W + NAME_H + ROW_GAP);
        const isSelected = this.getLoadoutItem(slot)?.id === item.id;
        const isNoneItem = item.id.startsWith('none_');
        const hasSprite2 =
          !isNoneItem && item.spriteCol !== undefined && item.spriteRow !== undefined;

        // Cell background
        if (isSelected) {
          this.drawNineSlicePanel('panel_brown_2_3d', cx, cy, CELL_W, CELL_W);
        } else {
          this.drawNineSlicePanel('panel_wood_1', cx, cy, CELL_W, CELL_W);
        }

        if (hasSprite2 && equipSheet) {
          const sx = item.spriteCol! * spriteSize;
          const sy = item.spriteRow! * spriteSize;
          const pad = 8;
          this.ctx.drawImage(
            equipSheet,
            sx,
            sy,
            spriteSize,
            spriteSize,
            cx + pad,
            cy + pad,
            CELL_W - pad * 2,
            CELL_W - pad * 2,
          );
        } else {
          this.ctx.fillStyle = '#334455';
          this.ctx.font = '18px Arial';
          this.ctx.textAlign = 'center';
          this.ctx.textBaseline = 'middle';
          this.ctx.fillText('—', cx + CELL_W / 2, cy + CELL_W / 2);
        }

        // Item name
        this.ctx.fillStyle = isSelected ? '#FFE880' : '#C8A06A';
        this.ctx.font = '11px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        const shortName = item.name.length > 10 ? item.name.substring(0, 9) + '\u2026' : item.name;
        this.ctx.fillText(shortName, cx + CELL_W / 2, cy + CELL_W + NAME_H / 2);
      }
    }

    // ── Right panel: stats ───────────────────────────────────────────────
    const rLeft = 816;
    const rRight = 1182;
    const rCx = (rLeft + rRight) / 2;
    const base =
      CONST.SELECTABLE_VEHICLES[this.gameService.selectedVehicleIndex]?.vehicle ??
      CONST.PLAYER_VEHICLE;

    this.ctx.fillStyle = '#FFD700';
    this.ctx.font = 'bold 18px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Stats', rCx, 102);

    const statDefs: { label: string; base: number; bonus: number }[] = [
      {
        label: 'Health',
        base: base.health,
        bonus: this.getTotalEquipBonus('health'),
      },
      { label: 'Armor', base: 0, bonus: this.getTotalEquipBonus('armor') },
      { label: 'Attack', base: base.attack ?? 100, bonus: this.getTotalEquipBonus('attack') },
      {
        label: 'Blast Rad',
        base: base.bullet.explosionRadius,
        bonus: this.getTotalEquipBonus('blastRadius'),
      },
      { label: 'Fuel', base: base.fuel, bonus: this.getTotalEquipBonus('fuel') },
      { label: 'Climb Ang', base: base.climbAngle, bonus: this.getTotalEquipBonus('climbAngle') },
      { label: 'Min Aim', base: base.minAimAngle, bonus: this.getTotalEquipBonus('minAimAngle') },
      { label: 'Max Aim', base: base.maxAimAngle, bonus: this.getTotalEquipBonus('maxAimAngle') },
    ];

    const statStartY = 138;
    const statStepY = 50;
    const statLabelX = rLeft + 21;
    const statValueX = rRight - 21;

    const invertedStats = new Set(['minAimAngle']);

    for (let ri = 0; ri < statDefs.length; ri++) {
      const { label, base: bv, bonus } = statDefs[ri];
      const rowY = statStartY + ri * statStepY;

      this.ctx.fillStyle = '#C8A06A';
      this.ctx.font = '15px Arial';
      this.ctx.textAlign = 'left';
      this.ctx.fillText(label, statLabelX, rowY);

      const baseStr = String(bv);
      const bonusStr = bonus !== 0 ? (bonus > 0 ? `+${bonus}` : String(bonus)) : '';

      // Determine which stat key this row corresponds to
      const statKey = [
        'health',
        'armor',
        'attack',
        'blastRadius',
        'fuel',
        'climbAngle',
        'minAimAngle',
        'maxAimAngle',
      ][ri];
      const inverted = invertedStats.has(statKey);

      this.ctx.textAlign = 'right';
      if (bonus !== 0) {
        // Draw bonus in green/red right-aligned, then base value to its left
        const isGood = inverted ? bonus < 0 : bonus > 0;
        this.ctx.fillStyle = isGood ? '#55EE77' : '#FF6655';
        this.ctx.fillText(bonusStr, statValueX, rowY);
        const bonusWidth = this.ctx.measureText(bonusStr).width + 6;
        this.ctx.fillStyle = '#F5DEB3';
        this.ctx.fillText(baseStr, statValueX - bonusWidth, rowY);
      } else {
        this.ctx.fillStyle = '#F5DEB3';
        this.ctx.fillText(baseStr, statValueX, rowY);
      }
    }

    // ── Set bonus section ────────────────────────────────────────────────
    const setBonusDivY = statStartY + statDefs.length * statStepY + 12;
    this.ctx.strokeStyle = 'rgba(140,80,30,0.5)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(rLeft + 16, setBonusDivY);
    this.ctx.lineTo(rRight - 16, setBonusDivY);
    this.ctx.stroke();

    this.ctx.textAlign = 'center';
    this.ctx.fillStyle = '#C8A06A';
    this.ctx.font = 'bold 12px Arial';
    this.ctx.fillText('SET BONUS', rCx, setBonusDivY + 18);

    const setInfo = this.getPreviewSetInfo();
    const isFullSet = setInfo?.count === this.EQUIPMENT_SLOTS.length;
    const setCountY = setBonusDivY + 40;

    if (setInfo) {
      const setName =
        this.gameService.equipmentSets.find((s) => s.id === setInfo.setId)?.name ?? setInfo.setId;
      this.ctx.fillStyle = isFullSet ? '#55EE77' : '#8B6347';
      this.ctx.font = 'bold 14px Arial';
      this.ctx.fillText(
        `${setInfo.count} / ${this.EQUIPMENT_SLOTS.length}  ${setName}`,
        rCx,
        setCountY,
      );

      const bonusLines = this.getPreviewSetBonusLines(setInfo.setId);
      this.ctx.font = '13px Arial';
      if (!isFullSet) this.ctx.globalAlpha = 0.4;
      for (let li = 0; li < bonusLines.length; li++) {
        this.ctx.fillStyle = isFullSet ? '#55EE77' : '#C8A06A';
        this.ctx.fillText(bonusLines[li], rCx, setCountY + 24 + li * 22);
      }
      this.ctx.globalAlpha = 1;
    } else {
      this.ctx.fillStyle = '#8B6347';
      this.ctx.font = '14px Arial';
      this.ctx.fillText('—', rCx, setCountY);
    }

    // ── Back button ──────────────────────────────────────────────────────
    this.drawButton('Back', this.EQUIP_BACK_BUTTON, '#445', '#667', 'panel_wood_1');
  }

  private drawVehicleGrid(panelLeft: number, panelCx: number) {
    const cellBoxW = 74;
    const cellBoxH = 74;
    const gapX = 10;
    const rowGap = 14;
    const nameH = 16;
    const totalW = 4 * cellBoxW + 3 * gapX;
    const startX = Math.round(panelCx - totalW / 2);
    const gridStartY = 390;
    const rowStride = cellBoxH + nameH + rowGap;

    // ── Selected vehicle preview ─────────────────────────────────────────
    const selEntry = CONST.SELECTABLE_VEHICLES[this.gameService.selectedVehicleIndex];
    const previewSize = 80;
    const previewY = 204;

    const idleSprite = this.spriteService.getEntitySprite(
      'idle',
      selEntry?.vehicle?.spritesheet ?? 'Lupin.png',
    );
    if (idleSprite && !selEntry?.locked) {
      this.ctx.drawImage(
        idleSprite.image,
        idleSprite.x,
        idleSprite.y,
        idleSprite.width,
        idleSprite.height,
        panelCx - previewSize / 2,
        previewY,
        previewSize,
        previewSize,
      );
    }

    // Vehicle description
    if (selEntry?.description) {
      this.ctx.fillStyle = 'rgba(200,170,120,0.75)';
      this.ctx.font = '12px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      // Wrap into two lines of max ~300px
      const maxW = 320;
      const words = selEntry.description.split(' ');
      const lines: string[] = [];
      let current = '';
      for (const word of words) {
        const test = current ? `${current} ${word}` : word;
        if (this.ctx.measureText(test).width > maxW && current) {
          lines.push(current);
          current = word;
        } else {
          current = test;
        }
      }
      if (current) lines.push(current);
      const descY = previewY + previewSize + 10;
      lines.slice(0, 2).forEach((line, i) => {
        this.ctx.fillText(line, panelCx, descY + i * 16);
      });
    }

    // Selector label
    this.ctx.fillStyle = '#DEC68A';
    this.ctx.font = '13px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('Select Vehicle', panelCx, gridStartY - 14);

    for (let i = 0; i < CONST.SELECTABLE_VEHICLES.length; i++) {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const bx = startX + col * (cellBoxW + gapX);
      const by = gridStartY + row * rowStride;
      const entry = CONST.SELECTABLE_VEHICLES[i];
      const isSelected = i === this.gameService.selectedVehicleIndex;
      const isLocked = entry.locked;

      // Box background
      if (isSelected) {
        this.drawNineSlicePanel('panel_brown_2_3d', bx, by, cellBoxW, cellBoxH);
      } else {
        this.drawNineSlicePanel('panel_wood_1', bx, by, cellBoxW, cellBoxH);
      }

      if (!isLocked) {
        const idleSprite = this.spriteService.getEntitySprite(
          'idle',
          entry.vehicle?.spritesheet ?? 'Lupin.png',
        );
        if (idleSprite) {
          const pad = 7;
          this.ctx.drawImage(
            idleSprite.image,
            idleSprite.x,
            idleSprite.y,
            idleSprite.width,
            idleSprite.height,
            bx + pad,
            by + pad,
            cellBoxW - pad * 2,
            cellBoxH - pad * 2,
          );
        }
      } else {
        // Silhouette for locked vehicle
        this.ctx.fillStyle = 'rgba(20,8,2,0.75)';
        this.ctx.fillRect(bx + 2, by + 2, cellBoxW - 4, cellBoxH - 4);
        this.ctx.fillStyle = 'rgba(120,70,30,0.8)';
        this.ctx.font = 'bold 26px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText('?', bx + cellBoxW / 2, by + cellBoxH / 2);
      }

      // Vehicle name below box
      this.ctx.font = isSelected ? 'bold 12px Arial' : '11px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillStyle = isLocked ? 'rgba(100,70,40,0.7)' : isSelected ? '#FFE880' : '#C8A06A';
      this.ctx.fillText(entry.vehicle.name, bx + cellBoxW / 2, by + cellBoxH + 9);
    }
  }

  private drawEquippedIcons(panelLeft: number, panelRight: number) {
    const equipSheet = this.spriteService.getSpritesheet('equipment.png');
    const spriteSize = 32;
    const boxSize = 48;
    const gap = 10;
    const count = this.EQUIPMENT_SLOTS.length;
    const totalW = count * boxSize + (count - 1) * gap;
    const startX = Math.round((panelLeft + panelRight) / 2 - totalW / 2);
    const labelY = 510;
    const iconsY = 526;

    this.ctx.fillStyle = '#DEC68A';
    this.ctx.font = 'bold 13px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Active Gear', (panelLeft + panelRight) / 2, labelY);

    for (let i = 0; i < count; i++) {
      const slot = this.EQUIPMENT_SLOTS[i];
      const item = this.gameService.equipped[slot];
      const hasSprite =
        !!item?.setId && item.spriteCol !== undefined && item.spriteRow !== undefined;
      const bx = startX + i * (boxSize + gap);

      this.ctx.fillStyle = hasSprite ? 'rgba(30,14,4,0.7)' : 'rgba(20,10,2,0.45)';
      this.ctx.strokeStyle = hasSprite ? '#6B3A1F' : '#4A2A10';
      this.ctx.lineWidth = 1;
      this.ctx.fillRect(bx, iconsY, boxSize, boxSize);
      this.ctx.strokeRect(bx, iconsY, boxSize, boxSize);

      if (hasSprite && equipSheet) {
        const sx = item!.spriteCol! * spriteSize;
        const sy = item!.spriteRow! * spriteSize;
        const pad = 4;
        this.ctx.drawImage(
          equipSheet,
          sx,
          sy,
          spriteSize,
          spriteSize,
          bx + pad,
          iconsY + pad,
          boxSize - pad * 2,
          boxSize - pad * 2,
        );
      } else {
        this.ctx.fillStyle = '#4A2A10';
        this.ctx.font = '20px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('—', bx + boxSize / 2, iconsY + boxSize / 2 + 7);
      }

      this.ctx.fillStyle = '#C8A06A';
      this.ctx.font = '11px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(
        this.SLOT_LABELS[slot].substring(0, 4),
        bx + boxSize / 2,
        iconsY + boxSize + 13,
      );
    }
  }

  private cycleSlot(slot: EquipmentSlot, delta: 1 | -1): void {
    const items = this.gameService.getItemsForSlot(slot);
    this.loadoutSlotIndices[slot] =
      (this.loadoutSlotIndices[slot] + delta + items.length) % items.length;
    const selected = items[this.loadoutSlotIndices[slot]];
    this.gameService.equipped[slot] = selected?.id?.startsWith('none_') ? null : (selected ?? null);
  }

  private handleEquipmentMenuClick(x: number, y: number) {
    // Back button
    if (this.isPointInsideButton(x, y, this.EQUIP_BACK_BUTTON)) {
      this.gameService.saveLoadout();
      this.gameService.currentState = GameState.MENU;
      this.isNameEditing = false;
      return;
    }

    // Name box click → start editing
    const nameBoxX = 38;
    const nameBoxY = 114;
    const nameBoxW = 332;
    const nameBoxH = 34;
    if (x >= nameBoxX && x <= nameBoxX + nameBoxW && y >= nameBoxY && y <= nameBoxY + nameBoxH) {
      this.isNameEditing = true;
      return;
    }
    // Click outside name box → stop editing
    this.isNameEditing = false;

    // Vehicle grid clicks
    {
      const cellBoxW = 74;
      const cellBoxH = 74;
      const gapX = 10;
      const rowGap = 14;
      const nameH = 16;
      const totalW = 4 * cellBoxW + 3 * gapX;
      const lCx = 18 + 183;
      const startX = Math.round(lCx - totalW / 2);
      const gridStartY = 390;
      const rowStride = cellBoxH + nameH + rowGap;

      for (let i = 0; i < CONST.SELECTABLE_VEHICLES.length; i++) {
        const col = i % 4;
        const row = Math.floor(i / 4);
        const bx = startX + col * (cellBoxW + gapX);
        const by = gridStartY + row * rowStride;
        if (x >= bx && x <= bx + cellBoxW && y >= by && y <= by + cellBoxH) {
          if (!CONST.SELECTABLE_VEHICLES[i].locked) {
            this.gameService.selectedVehicleIndex = i;
          }
          return;
        }
      }
    }

    // Slot box clicks
    const slotBoxX = 416;
    const slotBoxW = 368;
    const slotBoxH = 50;
    const slotGap = 6;
    const slotStartY = 115;
    for (let si = 0; si < this.EQUIPMENT_SLOTS.length; si++) {
      const slot = this.EQUIPMENT_SLOTS[si];
      const rowY = slotStartY + si * (slotBoxH + slotGap);
      if (x >= slotBoxX && x <= slotBoxX + slotBoxW && y >= rowY && y <= rowY + slotBoxH) {
        this.expandedSlot = this.expandedSlot === slot ? null : slot;
        return;
      }
    }

    // Item picker clicks
    if (this.expandedSlot !== null) {
      const slot = this.expandedSlot;
      const items = this.gameService.getItemsForSlot(slot);
      const pickerY = slotStartY + this.EQUIPMENT_SLOTS.length * (slotBoxH + slotGap) - slotGap + 8;
      const CELL_W = 72;
      const CELL_GAP = 12;
      const NAME_H = 14;
      const ROW_GAP = 12;
      const CELLS_PER_ROW = 3;
      const totalPickerW = CELLS_PER_ROW * CELL_W + (CELLS_PER_ROW - 1) * CELL_GAP;
      const pickerStartX = Math.round((400 + 800) / 2 - totalPickerW / 2);
      const iconStartY = pickerY + 26;

      for (let ii = 0; ii < items.length; ii++) {
        const item = items[ii];
        const col = ii % CELLS_PER_ROW;
        const row = Math.floor(ii / CELLS_PER_ROW);
        const cx = pickerStartX + col * (CELL_W + CELL_GAP);
        const cy = iconStartY + row * (CELL_W + NAME_H + ROW_GAP);
        if (x >= cx && x <= cx + CELL_W && y >= cy && y <= cy + CELL_W + NAME_H) {
          this.loadoutSlotIndices[slot] = ii;
          this.gameService.equipped[slot] = item.id.startsWith('none_') ? null : item;
          this.expandedSlot = null;
          this.gameService.saveLoadout();
          return;
        }
      }
    }
  }

  // ─── Menu ─────────────────────────────────────────────────────────────

  private easeOutBounce(t: number): number {
    const n1 = 7.5625,
      d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) {
      t -= 1.5 / d1;
      return n1 * t * t + 0.75;
    }
    if (t < 2.5 / d1) {
      t -= 2.25 / d1;
      return n1 * t * t + 0.9375;
    }
    t -= 2.625 / d1;
    return n1 * t * t + 0.984375;
  }

  private drawMenuMonkey(): void {
    const now = this.renderTime;
    if (!this.menuMonkeyState) {
      this.menuMonkeyState = {
        startMs: now,
        fruitIndex: Math.floor(Math.random() * this.WEAPON_SPRITES.length),
      };
    }

    const FALL_DURATION = 1500;
    const CX = 600; // center of the menu panel
    const START_Y = -80;
    const END_Y = 340; // monkey feet rest on top of the panel (panel top = 350)
    const MONKEY_SCALE = 1;

    const elapsed = now - this.menuMonkeyState.startMs;
    const t = Math.min(1, elapsed / FALL_DURATION);
    const cy = START_Y + (END_Y - START_Y) * this.easeOutBounce(t);

    const fruitKey = this.WEAPON_SPRITES[this.menuMonkeyState.fruitIndex];
    const fruitToOverlay: Record<string, string> = {
      item_banana: 'overlay_banana',
      item_apple: 'overlay_apple',
      item_peanut: 'overlay_peanut',
    };
    const overlayKey = fruitToOverlay[fruitKey] ?? null;

    const layerOffsets = this.spriteService.getLayerOffsets(this.LUPIN_COMPOSITE);
    const frameName = 'idle';
    const frameOffsets = layerOffsets?.frames[frameName];
    const fruitCfg = layerOffsets?.fruitConfig[fruitKey] ?? null;
    const fruitScale = fruitCfg?.scale ?? 1.0;
    const overlayZ = fruitCfg?.overlayZ ?? 3;

    const backSprite = this.spriteService.getEntitySprite(frameName, this.LUPIN_COMPOSITE);
    const fruitSprite = this.spriteService.getSprite(fruitKey);
    const handSprite = this.spriteService.getEntitySprite('hand', this.LUPIN_COMPOSITE);
    const overlaySprite = overlayKey ? this.spriteService.getSprite(overlayKey) : null;
    if (!backSprite) return;

    const spriteSize = CONST.TANK_BODY_RADIUS * 2 * 1.5; // 81 — matches gameplay
    const spriteYOffset = -15;

    const drawLayer = (
      spr: { image: CanvasImageSource; x: number; y: number; width: number; height: number } | null,
      sz: number,
      ox: number,
      oy: number,
    ) => {
      if (!spr) return;
      this.ctx.drawImage(
        spr.image,
        spr.x,
        spr.y,
        spr.width,
        spr.height,
        -sz / 2 + ox,
        -sz / 2 + spriteYOffset + oy,
        sz,
        sz,
      );
    };

    const drawOverlay = () => {
      if (!overlaySprite || frameOffsets?.hideLayers?.includes('overlay')) return;
      drawLayer(
        overlaySprite,
        spriteSize,
        frameOffsets?.overlay.x ?? 0,
        frameOffsets?.overlay.y ?? 0,
      );
    };

    this.ctx.save();
    this.ctx.translate(CX, cy);
    this.ctx.scale(-MONKEY_SCALE, MONKEY_SCALE); // flip horizontally + scale up

    drawLayer(backSprite, spriteSize, 0, 0);
    if (overlayZ < 2) drawOverlay();
    if (fruitSprite && !frameOffsets?.hideLayers?.includes('fruit')) {
      const fruitSz = spriteSize * fruitScale;
      drawLayer(fruitSprite, fruitSz, frameOffsets?.fruit.x ?? 0, frameOffsets?.fruit.y ?? 0);
    }
    if (handSprite && !frameOffsets?.hideLayers?.includes('hand')) {
      drawLayer(handSprite, spriteSize, frameOffsets?.hand.x ?? 0, frameOffsets?.hand.y ?? 0);
    }
    if (overlayZ >= 2) drawOverlay();

    this.ctx.restore();
  }

  private drawMenu() {
    // Background
    this.ctx.fillStyle = CONST.SKY_COLOR;
    this.ctx.fillRect(0, 0, CONST.CANVAS_WIDTH, CONST.CANVAS_HEIGHT);
    this.drawParallaxBackground(0);

    // Title — animated MONKEYS sprite letters
    if (this.menuTitleAnim.animStart === 0) {
      this.initBouncingLetterAnim(this.menuTitleAnim, this.MT_LETTERS.length);
    }
    this.updateBouncingLetterAnim(this.menuTitleAnim);
    this.drawBouncingLetterAnim(this.menuTitleAnim, this.MT_LETTERS, '#FF6622');

    // Subtitle lines
    this.drawSpriteTextCentered('Inspired By', 165, 32);
    this.drawSpriteTextCentered('GORILLAS Gunbound WORMS', 207, 32);

    // Draw menu monkey (falls in from above, sits on panel)
    this.drawMenuMonkey();

    // Backdrop panel behind buttons
    const devBtnCount = (this.TERRAIN_TOOL_ENABLED ? 1 : 0) + (this.DEV_MODE ? 1 : 0);
    this.drawNineSlicePanel('panel_wood_3_nail', 460, 350, 280, 230 + devBtnCount * 50);

    // Draw buttons
    this.drawButton('Start Game', this.MENU_START_BUTTON, '#4CAF50', '#45a049', 'panel_wood_1');
    this.drawButton('Loadout', this.MENU_LOADOUT_BUTTON, '#E67C22', '#D35400', 'panel_wood_1');
    this.drawButton('Options', this.MENU_OPTIONS_BUTTON, '#2196F3', '#1976D2', 'panel_wood_1');
    if (this.TERRAIN_TOOL_ENABLED) {
      this.drawButton(
        'Terrain Tool',
        this.MENU_TERRAIN_TOOL_BUTTON,
        '#9C6ADE',
        '#7C4DCC',
        'panel_wood_1',
      );
    }
    if (this.DEV_MODE) {
      this.drawButton('Layer Tool', this.MENU_TOOLS_BUTTON, '#E91E63', '#C2185B', 'panel_wood_1');
    }
  }

  private drawOptions() {
    // Background
    this.ctx.fillStyle = CONST.SKY_COLOR;
    this.ctx.fillRect(0, 0, CONST.CANVAS_WIDTH, CONST.CANVAS_HEIGHT);
    this.drawParallaxBackground(0);

    // Backdrop panel behind all options content
    this.drawNineSlicePanel('panel_wood_3_nail', 280, 60, 640, 578);

    // Title
    this.drawSpriteTextCentered('Options', 80, 48);

    // Difficulty label
    this.drawSpriteTextCentered('Difficulty', 185, 36);

    const diff = this.gameService.difficulty;
    const easyActive = diff === 'easy';
    const normalActive = diff === 'normal';
    const hardActive = diff === 'hard';

    this.drawButton(
      'Easy',
      this.OPTIONS_DIFFICULTY_EASY_BUTTON,
      easyActive ? '#66BB6A' : '#388E3C',
      easyActive ? '#81C784' : '#2E7D32',
      easyActive ? 'panel_wood_1' : 'panel_brown_2_dark',
    );
    this.drawButton(
      'Normal',
      this.OPTIONS_DIFFICULTY_NORMAL_BUTTON,
      normalActive ? '#29B6F6' : '#0288D1',
      normalActive ? '#4FC3F7' : '#01579B',
      normalActive ? 'panel_wood_1' : 'panel_brown_2_dark',
    );
    this.drawButton(
      'Hard',
      this.OPTIONS_DIFFICULTY_HARD_BUTTON,
      hardActive ? '#EF5350' : '#C62828',
      hardActive ? '#E57373' : '#B71C1C',
      hardActive ? 'panel_wood_1' : 'panel_brown_2_dark',
    );

    // Back button
    this.drawButton('Back to Menu', this.OPTIONS_BACK_BUTTON, '#FF9800', '#F57C00', 'panel_wood_1');

    // Volume sliders
    this.drawSpriteTextCentered('Volume', 342, 28);
    this.drawVolumeSlider('Background', this.audioService.bgVolume, this.SLIDER_BG_TRACK_Y);
    this.drawVolumeSlider('Effects', this.audioService.sfxVolume, this.SLIDER_SFX_TRACK_Y);
  }

  private drawVolumeSlider(label: string, value: number, trackY: number) {
    const left = this.SLIDER_TRACK_LEFT;
    const width = this.SLIDER_TRACK_WIDTH;
    const thumbX = left + value * width;
    const trackH = 6;
    const thumbR = 12;

    // Label above the track
    this.drawSpriteTextCentered(label, trackY - 44, 22);

    // Track background
    this.ctx.fillStyle = '#444';
    this.ctx.beginPath();
    this.ctx.roundRect(left, trackY - trackH / 2, width, trackH, 3);
    this.ctx.fill();

    // Track fill (left portion)
    this.ctx.fillStyle = '#4FC3F7';
    this.ctx.beginPath();
    this.ctx.roundRect(left, trackY - trackH / 2, thumbX - left, trackH, 3);
    this.ctx.fill();

    // Thumb
    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.beginPath();
    this.ctx.arc(thumbX, trackY, thumbR, 0, Math.PI * 2);
    this.ctx.fill();

    // Percentage label to the right of the track
    this.ctx.fillStyle = '#CCCCCC';
    this.ctx.font = 'bold 16px Arial';
    this.ctx.textAlign = 'left';
    this.ctx.fillText(`${Math.round(value * 100)}%`, left + width + 14, trackY + 6);
  }

  private drawTerrainTool() {
    this.ctx.fillStyle = '#13202B';
    this.ctx.fillRect(0, 0, CONST.CANVAS_WIDTH, CONST.CANVAS_HEIGHT);

    this.ctx.fillStyle = '#FFFFFF';
    this.ctx.font = 'bold 36px Arial';
    this.ctx.textAlign = 'left';
    this.ctx.fillText('Terrain Tool', 24, 48);

    this.ctx.font = '16px Arial';
    this.ctx.fillStyle = '#C7D5E0';
    const activeSheetName =
      this.terrainToolActiveSheet === 'terrain'
        ? this.spriteService.TERRAIN_TOOL_SPRITESHEET
        : this.spriteService.BACKGROUND_TOOL_SPRITESHEET;
    this.ctx.fillText(`Connected-component bounds detection for ${activeSheetName}`, 24, 76);

    this.ctx.fillStyle = '#0E1720';
    this.ctx.fillRect(20, 96, 820, 600);
    this.ctx.fillStyle = '#101A25';
    this.ctx.fillRect(860, 96, 320, 600);

    this.drawButton('Back to Menu', this.TERRAIN_TOOL_BACK_BUTTON, '#FF9800', '#F57C00');
    this.drawButton('Rescan Sheet', this.TERRAIN_TOOL_RESCAN_BUTTON, '#1565C0', '#0D47A1');
    this.drawButton('Copy All Regions', this.TERRAIN_TOOL_COPY_ALL_BUTTON, '#2E7D32', '#1B5E20');
    const switchLabel =
      this.terrainToolActiveSheet === 'terrain' ? 'Switch to Background' : 'Switch to Terrain';
    this.drawButton(switchLabel, this.TERRAIN_TOOL_SWITCH_BUTTON, '#5C5490', '#3D3563');
    const modeLabel = this.terrainToolSimpleMode ? 'Mode: Rectangles' : 'Mode: Detailed';
    this.drawButton(
      modeLabel,
      this.TERRAIN_TOOL_MODE_BUTTON,
      this.terrainToolSimpleMode ? '#37474F' : '#00695C',
      this.terrainToolSimpleMode ? '#263238' : '#004D40',
    );

    if (this.terrainToolCopyStatus && Date.now() < this.terrainToolCopyStatusUntil) {
      this.ctx.fillStyle = '#D8E2EA';
      this.ctx.font = '14px Arial';
      this.ctx.textAlign = 'right';
      this.ctx.fillText(this.terrainToolCopyStatus, CONST.CANVAS_WIDTH - 20, 206);
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
    const spritesheetLabel =
      this.terrainToolActiveSheet === 'terrain'
        ? this.spriteService.TERRAIN_TOOL_SPRITESHEET
        : this.spriteService.BACKGROUND_TOOL_SPRITESHEET;
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

  private openLayerTool(): void {
    const allSaved = this.spriteService.getAllLayerOffsets();
    const defaultFrame = (): LayerFrameOffset => ({
      hand: { x: 0, y: 0 },
      fruit: { x: 0, y: 0 },
      overlay: { x: 0, y: 0 },
    });
    const buildDefault = (fruits: readonly string[]): LayerOffsetData => ({
      explosionScale: 1.0,
      fruitConfig: Object.fromEntries(fruits.map((f) => [f, { scale: 1.0, overlayZ: 3 }])),
      frames: Object.fromEntries([...this.LAYER_EDITOR_FRAMES].map((f) => [f, defaultFrame()])),
    });

    this.layerToolAllOffsets = {
      [this.LUPIN_COMPOSITE]:
        allSaved[this.LUPIN_COMPOSITE] ??
        buildDefault(this.LAYER_EDITOR_FRUITS),
      [this.ZOMBIE_COMPOSITE]:
        allSaved[this.ZOMBIE_COMPOSITE] ??
        buildDefault(this.ZOMBIE_LAYER_EDITOR_FRUITS),
    };
    this.editorOffsets = this.layerToolAllOffsets[this.layerToolSheet];
    this.editorFrameIndex = 0;
    this.editorFruitIndex = 0;
    this.gameService.currentState = GameState.LAYER_TOOL;
  }

  //
  // ─── LAYER TOOL UI ────────────────────────────────────────────────────────────
  //

  private drawLayerTool(): void {
    if (!this.editorOffsets) {
      this.openLayerTool();
    }
    this.layerToolBtns.clear();

    const W = CONST.CANVAS_WIDTH;
    const H = CONST.CANVAS_HEIGHT;

    // Ensure clean transform state regardless of what previous draw functions left behind
    this.ctx.resetTransform();

    // Full canvas clear + left preview area (grey background)
    this.ctx.fillStyle = '#4A4A4A';
    this.ctx.fillRect(0, 0, W, H);

    // Right panel
    this.drawNineSlicePanel('panel_wood_3_nail', 588, 15, 604, 690);

    // ── Preview ──
    const previewCX = 290;
    const previewCY = 360;
    const spriteSize = CONST.TANK_BODY_RADIUS * 2 * 1.5 * 3;
    const spriteYOffset = -15 * 3;
    const scale = 3;
    const frameName = this.LAYER_EDITOR_FRAMES[this.editorFrameIndex];
    const isZombie = this.layerToolSheet === this.ZOMBIE_COMPOSITE;
    const editorFruits = isZombie ? this.ZOMBIE_LAYER_EDITOR_FRUITS : this.LAYER_EDITOR_FRUITS;
    const fruitKey = editorFruits[this.editorFruitIndex];
    const offsets = this.editorOffsets!;
    const frameOffsets = offsets.frames[frameName];
    const fruitCfg = offsets.fruitConfig[fruitKey];
    const fruitScale = fruitCfg?.scale ?? 1.0;
    const overlayZ = fruitCfg?.overlayZ ?? 3;

    const backSprite = this.spriteService.getEntitySprite(frameName, this.layerToolSheet);
    const fruitSprite = this.spriteService.getSprite(fruitKey);
    const handSprite = this.spriteService.getEntitySprite('hand', this.layerToolSheet);

    // Determine overlay based on fruit
    const fruitToOverlay: Record<string, string> = isZombie
      ? {
          zombie_item_banana_bunch: 'zombie_overlay_banana_bunch',
          zombie_item_corn_stick: 'zombie_overlay_corn_stick',
          zombie_item_mushroom: 'zombie_overlay_mushroom',
        }
      : {
          item_banana: 'overlay_banana',
          item_apple: 'overlay_apple',
          item_peanut: 'overlay_peanut',
        };
    const overlaySpriteName = fruitToOverlay[fruitKey] ?? null;
    const overlaySprite = overlaySpriteName
      ? this.spriteService.getSprite(overlaySpriteName)
      : null;

    this.ctx.save();
    try {
      this.ctx.translate(previewCX, previewCY);
      this.ctx.scale(-1, 1); // mirror same as gameplay

      const drawPreviewLayer = (
        spr: {
          image: CanvasImageSource;
          x: number;
          y: number;
          width: number;
          height: number;
        } | null,
        sz: number,
        ox: number,
        oy: number,
      ) => {
        if (!spr) return;
        this.ctx.drawImage(
          spr.image,
          spr.x,
          spr.y,
          spr.width,
          spr.height,
          -sz / 2 + ox,
          -sz / 2 + spriteYOffset + oy,
          sz,
          sz,
        );
      };

      const drawOverlayPreview = () => {
        if (overlaySprite && !frameOffsets?.hideLayers?.includes('overlay')) {
          const ox = (frameOffsets?.overlay.x ?? 0) * scale;
          const oy2 = (frameOffsets?.overlay.y ?? 0) * scale;
          drawPreviewLayer(overlaySprite, spriteSize, ox, oy2);
        }
      };

      // back layer (one frame at a time based on editorFrameIndex)
      drawPreviewLayer(backSprite, spriteSize, 0, 0);

      // overlay under fruit (overlayZ < 2, e.g. apple bitten base)
      if (overlayZ < 2) drawOverlayPreview();

      // fruit layer (for offset alignment reference)
      if (fruitSprite && !frameOffsets?.hideLayers?.includes('fruit')) {
        const fruitSz = spriteSize * fruitScale;
        const fx = (frameOffsets?.fruit.x ?? 0) * scale;
        const fy = (frameOffsets?.fruit.y ?? 0) * scale;
        drawPreviewLayer(fruitSprite, fruitSz, fx, fy);
      }

      // above-fruit overlay (e.g. head_eat), no offset
      const aboveFruitName = frameOffsets?.aboveFruitSpriteName ?? null;
      if (aboveFruitName) {
        const aboveFruitSpr = this.spriteService.getSprite(aboveFruitName);
        drawPreviewLayer(aboveFruitSpr, spriteSize, 0, 0);
      }

      // hand layer (for offset alignment reference)
      if (handSprite && !frameOffsets?.hideLayers?.includes('hand')) {
        const hx = (frameOffsets?.hand.x ?? 0) * scale;
        const hy = (frameOffsets?.hand.y ?? 0) * scale;
        drawPreviewLayer(handSprite, spriteSize, hx, hy);
      }

      // overlay on top of fruit (overlayZ >= 2, e.g. banana peel)
      if (overlayZ >= 2) drawOverlayPreview();

      // halo layer (zombie only)
      if (isZombie && !frameOffsets?.hideLayers?.includes('halo')) {
        const haloSprite = this.spriteService.getSprite('zombie_halo');
        const hlx = (frameOffsets?.halo?.x ?? 0) * scale;
        const hly = (frameOffsets?.halo?.y ?? 0) * scale;
        drawPreviewLayer(haloSprite ?? null, spriteSize, hlx, hly);
      }
    } finally {
      this.ctx.restore();
    }

    // ── Right panel content ──
    const panelCX = 890;
    this.ctx.textAlign = 'center';

    // Spacing constants – compact in zombie mode to fit extra HALO section within 720px canvas
    const NR = isZombie ? 26 : 32;  // nudge/scale row interval
    const SG = isZombie ? 14 : 18;  // HRule → section header gap
    const HG = isZombie ? 18 : 24;  // last row → HRule gap

    // Title
    this.ctx.fillStyle = '#fff';
    this.ctx.font = 'bold 18px Arial';
    this.ctx.fillText('Layer Offset Tool', panelCX, 50);

    // Character selector row
    const charBtnW = 170;
    const charBtnH = 32;
    this.ltDrawFruitBtn('char_lupin', 'Lupin', { x: 780, y: 76, w: charBtnW, h: charBtnH }, !isZombie);
    this.ltDrawFruitBtn('char_zombie', 'Zombie Lupin', { x: 1000, y: 76, w: charBtnW, h: charBtnH }, isZombie);

    // Frame selector row
    const frameY = isZombie ? 112 : 124;
    this.ltDrawBtn('frame_prev', '◀', { x: 720, y: frameY, w: 60, h: 36 });
    this.ltDrawBtn('frame_next', '▶', { x: 1060, y: frameY, w: 60, h: 36 });
    this.ctx.fillStyle = '#fff';
    this.ctx.font = 'bold 15px Arial';
    this.ctx.fillText(frameName, panelCX, frameY + 6);

    let y = frameY + (isZombie ? 22 : 27);
    this.ltHRule(y);

    // ── HAND section ──
    y += SG; this.ltSectionHeader('HAND', y);
    y += NR; this.ltNudgeRow('hand_x', 'X', y, frameOffsets?.hand.x ?? 0, 1, 5);
    y += NR; this.ltNudgeRow('hand_y', 'Y', y, frameOffsets?.hand.y ?? 0, 1, 5);
    y += HG; this.ltHRule(y);

    // ── FRUIT section ──
    y += SG; this.ltSectionHeader('FRUIT', y);
    const fruitNames = isZombie ? ['Bunch', 'Corn', 'Shroom'] : ['Banana', 'Apple', 'Peanut'];
    const fruitBtnW = 110;
    const fruitBtnH = 30;
    y += NR;
    [740, 890, 1040].forEach((bx, i) => {
      this.ltDrawFruitBtn(`fruit_sel_${i}`, fruitNames[i], { x: bx, y, w: fruitBtnW, h: fruitBtnH }, this.editorFruitIndex === i);
    });
    y += NR; this.ltNudgeRow('fruit_x', 'X', y, frameOffsets?.fruit.x ?? 0, 1, 5);
    y += NR; this.ltNudgeRow('fruit_y', 'Y', y, frameOffsets?.fruit.y ?? 0, 1, 5);
    y += NR;
    this.ctx.fillStyle = '#ccc';
    this.ctx.font = 'bold 13px Arial';
    this.ctx.textAlign = 'left';
    this.ctx.fillText('Fruit Scale', 610, y + 5);
    this.ctx.textAlign = 'center';
    this.ltScaleRow('fruit_scale', y, fruitScale, 0.05, 0.2);
    y += HG; this.ltHRule(y);

    // ── OVERLAY section ──
    y += SG; this.ltSectionHeader('OVERLAY', y);
    y += NR; this.ltNudgeRow('overlay_x', 'X', y, frameOffsets?.overlay.x ?? 0, 1, 5);
    y += NR; this.ltNudgeRow('overlay_y', 'Y', y, frameOffsets?.overlay.y ?? 0, 1, 5);

    // ── HALO section (zombie only) ──
    if (isZombie) {
      y += SG; this.ltSectionHeader('HALO', y);
      const haloHidden = frameOffsets?.hideLayers?.includes('halo') ?? false;
      y += NR;
      this.ltDrawFruitBtn('halo_toggle', `${haloHidden ? '☐' : '☑'} Show`,
        { x: panelCX, y, w: 140, h: 26 }, !haloHidden);
      y += NR; this.ltNudgeRow('halo_x', 'X', y, frameOffsets?.halo?.x ?? 0, 1, 5);
      y += NR; this.ltNudgeRow('halo_y', 'Y', y, frameOffsets?.halo?.y ?? 0, 1, 5);
    }

    y += HG; this.ltHRule(y);

    // ── EXPLOSION SCALE ──
    y += SG; this.ltSectionHeader('EXPLOSION SCALE', y);
    y += NR; this.ltScaleRow('exp_scale', y, offsets.explosionScale, 0.05, 0.2);
    y += HG; this.ltHRule(y);

    // ── Action buttons ──
    y += 32; this.ltDrawBtn('copy_json', 'Copy JSON', { x: panelCX, y, w: 200, h: 42 });
    y += 52; this.ltDrawBtn('back', 'Back', { x: panelCX, y, w: 200, h: 42 });
  }

  /** Register a button region and draw it */
  private ltDrawBtn(
    key: string,
    label: string,
    btn: { x: number; y: number; w: number; h: number },
    active = false,
  ): void {
    this.layerToolBtns.set(key, btn);
    const left = btn.x - btn.w / 2;
    const top = btn.y - btn.h / 2;
    this.ctx.fillStyle = active ? '#E67C22' : '#444';
    this.ctx.fillRect(left, top, btn.w, btn.h);
    this.ctx.strokeStyle = active ? '#FF9800' : '#888';
    this.ctx.lineWidth = 1.5;
    this.ctx.strokeRect(left, top, btn.w, btn.h);
    this.ctx.fillStyle = '#fff';
    this.ctx.font = 'bold 14px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(label, btn.x, btn.y);
    this.ctx.textBaseline = 'alphabetic';
  }

  private ltDrawFruitBtn(
    key: string,
    label: string,
    btn: { x: number; y: number; w: number; h: number },
    active: boolean,
  ): void {
    this.ltDrawBtn(key, label, btn, active);
  }

  /** Horizontal rule */
  private ltHRule(y: number): void {
    this.ctx.strokeStyle = '#666';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(600, y);
    this.ctx.lineTo(1182, y);
    this.ctx.stroke();
  }

  /** Section header text */
  private ltSectionHeader(label: string, y: number): void {
    this.ctx.fillStyle = '#FFCC66';
    this.ctx.font = 'bold 13px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(label, 890, y);
  }

  /** Nudge row: label + four buttons (±small, ±big) + value readout */
  private ltNudgeRow(
    id: string,
    label: string,
    cy: number,
    value: number,
    small: number,
    big: number,
  ): void {
    const bW = 62;
    const bH = 28;
    // label
    this.ctx.fillStyle = '#ccc';
    this.ctx.font = 'bold 13px Arial';
    this.ctx.textAlign = 'left';
    this.ctx.fillText(label, 610, cy + 5);
    // buttons: positions relative to center 890
    const xs = [730, 800, 970, 1040];
    const labels = [`«-${big}`, `‹-${small}`, `+${small}›`, `+${big}»`];
    const keys = [`${id}_m${big}`, `${id}_m${small}`, `${id}_p${small}`, `${id}_p${big}`];
    for (let i = 0; i < 4; i++) {
      this.ltDrawBtn(keys[i], labels[i], { x: xs[i], y: cy, w: bW, h: bH });
    }
    // value
    this.ctx.fillStyle = '#fff';
    this.ctx.font = '13px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(String(value), 895, cy + 5);
    this.ctx.textAlign = 'left';
  }

  /** Scale row: ±small, ±big buttons + value readout */
  private ltScaleRow(id: string, cy: number, value: number, small: number, big: number): void {
    const bW = 62;
    const bH = 28;
    const xs = [730, 800, 970, 1040];
    const labels = [`«-${big}`, `‹-${small}`, `+${small}›`, `+${big}»`];
    const keys = [`${id}_m${big}`, `${id}_m${small}`, `${id}_p${small}`, `${id}_p${big}`];
    for (let i = 0; i < 4; i++) {
      this.ltDrawBtn(keys[i], labels[i], { x: xs[i], y: cy, w: bW, h: bH });
    }
    this.ctx.fillStyle = '#fff';
    this.ctx.font = '13px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(value.toFixed(2), 895, cy + 5);
    this.ctx.textAlign = 'left';
  }

  private handleLayerToolClick(x: number, y: number): void {
    if (!this.editorOffsets) return;
    const offsets = this.editorOffsets;
    const frameName = this.LAYER_EDITOR_FRAMES[this.editorFrameIndex];
    const isZombie = this.layerToolSheet === this.ZOMBIE_COMPOSITE;
    const editorFruits = isZombie ? this.ZOMBIE_LAYER_EDITOR_FRUITS : this.LAYER_EDITOR_FRUITS;
    const fruitKey = editorFruits[this.editorFruitIndex];

    const hit = (key: string): boolean => {
      const btn = this.layerToolBtns.get(key);
      if (!btn) return false;
      return (
        x >= btn.x - btn.w / 2 &&
        x <= btn.x + btn.w / 2 &&
        y >= btn.y - btn.h / 2 &&
        y <= btn.y + btn.h / 2
      );
    };

    // Frame navigation
    if (hit('frame_prev')) {
      this.editorFrameIndex =
        (this.editorFrameIndex - 1 + this.LAYER_EDITOR_FRAMES.length) %
        this.LAYER_EDITOR_FRAMES.length;
      return;
    }
    if (hit('frame_next')) {
      this.editorFrameIndex = (this.editorFrameIndex + 1) % this.LAYER_EDITOR_FRAMES.length;
      return;
    }

    // Fruit selector
    for (let i = 0; i < 3; i++) {
      if (hit(`fruit_sel_${i}`)) {
        this.editorFruitIndex = i;
        return;
      }
    }

    // Character selector
    if (hit('char_lupin') && this.layerToolSheet !== this.LUPIN_COMPOSITE) {
      this.layerToolAllOffsets[this.layerToolSheet] = offsets;
      this.layerToolSheet = this.LUPIN_COMPOSITE;
      this.editorOffsets = this.layerToolAllOffsets[this.LUPIN_COMPOSITE];
      this.editorFruitIndex = 0;
      return;
    }
    if (hit('char_zombie') && this.layerToolSheet !== this.ZOMBIE_COMPOSITE) {
      this.layerToolAllOffsets[this.layerToolSheet] = offsets;
      this.layerToolSheet = this.ZOMBIE_COMPOSITE;
      this.editorOffsets = this.layerToolAllOffsets[this.ZOMBIE_COMPOSITE];
      this.editorFruitIndex = 0;
      return;
    }

    // Ensure the current frame has an offsets entry
    if (!offsets.frames[frameName]) {
      offsets.frames[frameName] = {
        hand: { x: 0, y: 0 },
        fruit: { x: 0, y: 0 },
        overlay: { x: 0, y: 0 },
      };
    }
    const frame = offsets.frames[frameName];

    // Halo toggle (zombie only)
    if (hit('halo_toggle') && isZombie) {
      const hideLayers = frame.hideLayers ?? [];
      frame.hideLayers = hideLayers.includes('halo')
        ? hideLayers.filter((l) => l !== 'halo')
        : [...hideLayers, 'halo'];
      return;
    }

    // Helper: apply nudge
    const nudgeAxis = (
      obj: { x: number; y: number },
      axis: 'x' | 'y',
      id: string,
      small: number,
      big: number,
    ) => {
      if (hit(`${id}_m${big}`)) {
        obj[axis] -= big;
        return true;
      }
      if (hit(`${id}_m${small}`)) {
        obj[axis] -= small;
        return true;
      }
      if (hit(`${id}_p${small}`)) {
        obj[axis] += small;
        return true;
      }
      if (hit(`${id}_p${big}`)) {
        obj[axis] += big;
        return true;
      }
      return false;
    };

    if (nudgeAxis(frame.hand, 'x', 'hand_x', 1, 5)) return;
    if (nudgeAxis(frame.hand, 'y', 'hand_y', 1, 5)) return;
    if (nudgeAxis(frame.fruit, 'x', 'fruit_x', 1, 5)) return;
    if (nudgeAxis(frame.fruit, 'y', 'fruit_y', 1, 5)) return;
    if (nudgeAxis(frame.overlay, 'x', 'overlay_x', 1, 5)) return;
    if (nudgeAxis(frame.overlay, 'y', 'overlay_y', 1, 5)) return;
    if (isZombie) {
      if (!frame.halo) frame.halo = { x: 0, y: 0 };
      if (nudgeAxis(frame.halo, 'x', 'halo_x', 1, 5)) return;
      if (nudgeAxis(frame.halo, 'y', 'halo_y', 1, 5)) return;
    }

    // Fruit scale
    const scaleDelta = (id: string, small: number, big: number): number | null => {
      if (hit(`${id}_m${big}`)) return -big;
      if (hit(`${id}_m${small}`)) return -small;
      if (hit(`${id}_p${small}`)) return small;
      if (hit(`${id}_p${big}`)) return big;
      return null;
    };
    const fruitScaleDelta = scaleDelta('fruit_scale', 0.05, 0.2);
    if (fruitScaleDelta !== null) {
      const cfg = offsets.fruitConfig[fruitKey];
      if (cfg) {
        cfg.scale = Math.max(0.1, Math.round((cfg.scale + fruitScaleDelta) * 100) / 100);
      }
      return;
    }
    const expScaleDelta = scaleDelta('exp_scale', 0.05, 0.2);
    if (expScaleDelta !== null) {
      offsets.explosionScale = Math.max(
        0.1,
        Math.round((offsets.explosionScale + expScaleDelta) * 100) / 100,
      );
      return;
    }

    // Copy JSON
    if (hit('copy_json')) {
      this.layerToolAllOffsets[this.layerToolSheet] = offsets;
      void navigator.clipboard.writeText(JSON.stringify(this.layerToolAllOffsets, null, 2));
      return;
    }

    // Back
    if (hit('back')) {
      this.gameService.currentState = GameState.MENU;
      return;
    }
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

    const activeSheetPath =
      this.terrainToolActiveSheet === 'terrain'
        ? this.spriteService.TERRAIN_TOOL_SPRITESHEET
        : this.spriteService.BACKGROUND_TOOL_SPRITESHEET;

    this.terrainToolLoading = true;
    try {
      this.terrainToolImage = await this.spriteService.loadRawSpritesheet(activeSheetPath);
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
      this.terrainToolError = `Failed to load or analyze ${activeSheetPath}`;
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

    if (this.isPointInsideButton(x, y, this.TERRAIN_TOOL_SWITCH_BUTTON)) {
      this.terrainToolActiveSheet =
        this.terrainToolActiveSheet === 'terrain' ? 'background' : 'terrain';
      this.terrainToolImage = null;
      this.terrainToolRegions = [];
      this.terrainToolSelectedRegionId = null;
      void this.openTerrainTool(false);
      return;
    }

    if (this.isPointInsideButton(x, y, this.TERRAIN_TOOL_MODE_BUTTON)) {
      this.terrainToolSimpleMode = !this.terrainToolSimpleMode;
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

    if (selectedRegion && selectedRegion.id === this.terrainToolSelectedRegionId) {
      this.terrainToolSelectedRegionId = null;
    } else {
      this.terrainToolSelectedRegionId = selectedRegion?.id ?? null;
    }
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
    const activeSheetPath =
      this.terrainToolActiveSheet === 'terrain'
        ? this.spriteService.TERRAIN_TOOL_SPRITESHEET
        : this.spriteService.BACKGROUND_TOOL_SPRITESHEET;
    const prefix = this.terrainToolActiveSheet === 'background' ? 'background' : 'terrain';
    return {
      spritesheets: {},
      sprites: this.terrainToolRegions.map((region) => {
        const base = {
          name: `${prefix}_region_${region.id}`,
          spritesheet: activeSheetPath,
          x: region.x,
          y: region.y,
          z: 0,
          width: region.width,
          height: region.height,
        };
        if (this.terrainToolSimpleMode) {
          return base;
        }
        return { ...base, pixelCount: region.pixelCount, outline: region.outline };
      }),
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
    const left = button.x - button.width / 2;
    const right = button.x + button.width / 2;
    const top = button.y - button.height / 2;
    const bottom = button.y + button.height / 2;
    const hit = x >= left && x <= right && y >= top && y <= bottom;
    return hit;
  }

  // ── Bouncing letter animation (shared by menu title and game over) ───────────

  private initBouncingLetterAnim(anim: BouncingLetterAnimState, count: number): void {
    anim.letterY = Array(count).fill(-anim.cfg.letterSize);
    anim.letterVY = Array(count).fill(0);
    anim.animStart = performance.now();
    anim.animLastTs = anim.animStart;
  }

  private updateBouncingLetterAnim(anim: BouncingLetterAnimState): void {
    const { cfg } = anim;
    const now = performance.now();
    const dt = Math.min((now - anim.animLastTs) / 1000, 0.05);
    anim.animLastTs = now;
    const elapsed = now - anim.animStart;
    for (let i = 0; i < anim.letterY.length; i++) {
      if (elapsed - i * cfg.staggerMs <= 0) continue;
      const targetY = cfg.targetYFn(i);
      anim.letterVY[i] += cfg.gravity * dt;
      anim.letterY[i] += anim.letterVY[i] * dt;
      if (anim.letterY[i] >= targetY) {
        anim.letterY[i] = targetY;
        if (Math.abs(anim.letterVY[i]) > cfg.minBounceVY) {
          anim.letterVY[i] = -anim.letterVY[i] * cfg.bounce;
        } else {
          anim.letterVY[i] = 0;
        }
      }
    }
  }

  private drawBouncingLetterAnim(
    anim: BouncingLetterAnimState,
    letters: string[],
    tint?: string,
  ): void {
    const { cfg } = anim;
    const size = cfg.letterSize;
    const advance = size * cfg.advanceRatio;
    const totalWidth = (letters.length - 1) * advance + size;
    const startX = CONST.CANVAS_WIDTH / 2 - totalWidth / 2;
    const elapsed = performance.now() - anim.animStart;
    for (let i = 0; i < letters.length; i++) {
      if (elapsed - i * cfg.staggerMs <= 0) continue;
      const sprite = this.spriteService.getSprite(letters[i]);
      if (!sprite) continue;
      if (tint) {
        this.ctx.drawImage(
          this.tintedGlyph(sprite, size, tint),
          startX + i * advance,
          anim.letterY[i],
        );
      } else {
        this.ctx.drawImage(
          sprite.image,
          sprite.x,
          sprite.y,
          sprite.width,
          sprite.height,
          startX + i * advance,
          anim.letterY[i],
          size,
          size,
        );
      }
    }
  }

  // Tints a sprite glyph with a solid colour, using a cache keyed on spriteName+tint+size.
  private tintedGlyph(sprite: SpriteData, size: number, tint: string): HTMLCanvasElement {
    const key = `${sprite.x}_${sprite.y}_${size}_${tint}`;
    const cached = this.tintCache.get(key);
    if (cached) return cached;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(sprite.image, sprite.x, sprite.y, sprite.width, sprite.height, 0, 0, size, size);
    // Multiply each pixel's RGB by the tint ratio: white → tint, black → black, transparent untouched.
    const tr = parseInt(tint.slice(1, 3), 16);
    const tg = parseInt(tint.slice(3, 5), 16);
    const tb = parseInt(tint.slice(5, 7), 16);
    const imageData = ctx.getImageData(0, 0, size, size);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      d[i] = Math.round((d[i] * tr) / 255);
      d[i + 1] = Math.round((d[i + 1] * tg) / 255);
      d[i + 2] = Math.round((d[i + 2] * tb) / 255);
    }
    ctx.putImageData(imageData, 0, 0);
    this.tintCache.set(key, c);
    return c;
  }

  // Renders a line of text centred horizontally on the canvas.
  private drawSpriteTextCentered(text: string, topY: number, size: number, advanceRatio = 0.55) {
    const advance = size * advanceRatio;
    const startX = CONST.CANVAS_WIDTH / 2 - ((text.length - 1) * advance + size) / 2;
    this.drawSpriteChars(text, this.TEXT_CHAR_TO_SPRITE, startX, topY, size, advance);
  }

  // Draws a power percentage (digits + % symbol) centred on (centreX, topY) using row-2 sprites.
  private drawPowerPercent(
    pct: number,
    centreX: number,
    topY: number,
    tint?: string,
    size = this.POWER_PERCENT_SPRITE_SIZE,
  ) {
    const advance = size * 0.45;
    const pctStr = `${pct}%`;
    const totalWidth = (pctStr.length - 1) * advance + size;
    this.drawSpriteChars(
      pctStr,
      this.ANGLE_CHAR_TO_SPRITE,
      centreX - totalWidth / 2,
      topY,
      size,
      advance,
      tint,
    );
  }

  // Draws an angle value (digits + degree symbol) using row-2 arena sprites, left-aligned.
  private drawAngleText(angleDeg: number, leftX: number, centerY: number, size: number) {
    const advance = size * 0.45;
    this.drawSpriteChars(
      `${angleDeg}°`,
      this.ANGLE_CHAR_TO_SPRITE,
      leftX,
      centerY - size / 2,
      size,
      advance,
    );
  }

  // Draws a string of digits (and '/') right-aligned using arena number sprites.
  // Falls back to plain text for any character without a sprite.
  private drawWindIndicator(): void {
    const targetSpeed = this.gameService.windSpeed;
    const targetAngle = this.gameService.windAngle;
    const now = Date.now();
    const wa = this.windAnim;

    // Detect wind change and kick off a new transition
    const targetFill = targetSpeed / 100;
    if (targetAngle !== wa.toAngle || targetFill !== wa.toFill) {
      wa.fromAngle = wa.displayAngle;
      wa.fromFill = wa.displayFill;
      wa.toAngle = targetAngle;
      wa.toFill = targetFill;
      wa.startTime = now;
    }

    // Step the animation
    const elapsed = now - wa.startTime;
    const t = wa.duration > 0 ? Math.min(1, elapsed / wa.duration) : 1;
    // Ease in-out cubic
    const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    // Interpolate angle via shortest arc
    let angleDiff = wa.toAngle - wa.fromAngle;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    wa.displayAngle = wa.fromAngle + angleDiff * ease;
    wa.displayFill = wa.fromFill + (wa.toFill - wa.fromFill) * ease;

    const cx = CONST.CANVAS_WIDTH / 2;
    const arrowCy = 50;
    const drawW = 90;
    const emptySprite = this.spriteService.getSprite('tank_arrowEmpty');
    const fullSprite = this.spriteService.getSprite('tank_arrowFull');
    if (!emptySprite) return;
    const drawH = Math.round((drawW * emptySprite.height) / emptySprite.width);

    this.ctx.save();
    this.ctx.translate(cx, arrowCy);
    if (wa.displayFill > 0) {
      this.ctx.rotate(wa.displayAngle);
    }

    // Empty arrow as base
    this.ctx.drawImage(
      emptySprite.image,
      emptySprite.x,
      emptySprite.y,
      emptySprite.width,
      emptySprite.height,
      -drawW / 2,
      -drawH / 2,
      drawW,
      drawH,
    );

    // Full arrow clipped behind a wavy boundary — left (tail) side revealed proportional to fill
    if (fullSprite && wa.displayFill > 0) {
      const fillX = -drawW / 2 + drawW * wa.displayFill; // x of the clip boundary
      const waveAmp = 3;
      const waveFreq = 0.06;
      const wavePhase = (now / 400) % (Math.PI * 2);

      this.ctx.save();
      this.ctx.beginPath();
      // Start top-left
      this.ctx.moveTo(-drawW / 2, -drawH / 2);
      // Top edge straight to the wavy boundary
      this.ctx.lineTo(fillX, -drawH / 2);
      // Wavy right edge top to bottom
      const steps = 12;
      for (let i = 0; i <= steps; i++) {
        const fy = -drawH / 2 + (drawH * i) / steps;
        const wx = fillX + Math.sin(fy * waveFreq + wavePhase) * waveAmp;
        this.ctx.lineTo(wx, fy);
      }
      // Bottom edge back to left
      this.ctx.lineTo(-drawW / 2, drawH / 2);
      this.ctx.closePath();
      this.ctx.clip();

      this.ctx.drawImage(
        fullSprite.image,
        fullSprite.x,
        fullSprite.y,
        fullSprite.width,
        fullSprite.height,
        -drawW / 2,
        -drawH / 2,
        drawW,
        drawH,
      );
      this.ctx.restore();
    }

    this.ctx.restore();
  }

  private drawMuteButton(): void {
    const { x, y, width, height } = this.MUTE_BUTTON;
    const left = x - width / 2;
    const top = y - height / 2;
    const r = 6;

    // Background pill
    this.ctx.save();
    this.ctx.globalAlpha = 0.55;
    this.ctx.fillStyle = '#111122';
    this.ctx.beginPath();
    this.ctx.roundRect(left, top, width, height, r);
    this.ctx.fill();
    this.ctx.globalAlpha = 1;

    // Icon
    this.ctx.font = '14px serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(this.audioService.isMuted ? '\uD83D\uDD07' : '\uD83D\uDD0A', x, y);
    this.ctx.textBaseline = 'alphabetic';
    this.ctx.restore();
  }

  private drawArenaNumber(text: string, rightX: number, topY: number, size: number) {
    const advance = size * 0.6; // tighter kerning — glyphs don't fill full cell
    this.drawSpriteChars(
      text,
      this.ARENA_CHAR_TO_SPRITE,
      rightX - text.length * advance,
      topY,
      size,
      advance,
      undefined,
      true,
    );
  }

  /** Creates a button rect centred at (cx, cy). Use with drawButton and isPointInsideButton. */
  private mkBtn(cx: number, cy: number, w: number, h: number) {
    return { x: cx, y: cy, width: w, height: h };
  }

  /** Returns the left/right arrow button rects for equipment slot index si. */
  private equipSlotArrowBtns(si: number) {
    const rowY = 128 + si * 58;
    return {
      left: this.mkBtn(505, rowY + 20, 44, 36),
      right: this.mkBtn(696, rowY + 20, 44, 36),
    };
  }

  private drawButton(
    text: string,
    btn: { x: number; y: number; width: number; height: number },
    color: string,
    hoverColor: string,
    panelName?: string,
  ) {
    const { x, y, width, height } = btn;
    const left = x - width / 2;
    const top = y - height / 2;

    if (panelName) {
      this.drawNineSlicePanel(panelName, left, top, width, height);
    } else {
      // Button background
      this.ctx.fillStyle = color;
      this.ctx.fillRect(left, top, width, height);

      // Button border
      this.ctx.strokeStyle = '#ffffff';
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(left, top, width, height);
    }

    // Button text
    this.ctx.fillStyle = '#ffffff';
    this.ctx.font = 'bold 16px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(text, x, y);
    this.ctx.textBaseline = 'alphabetic';
  }

  private drawNineSlicePanel(
    panelName: string,
    destX: number,
    destY: number,
    destW: number,
    destH: number,
  ): void {
    const panel = this.spriteService.getPanel(panelName);
    if (!panel) return;
    const sheet = this.spriteService.getSpritesheet(panel.spritesheet);
    if (!sheet) return;

    const s = panel.sectionSize;
    const px = panel.x;
    const py = panel.y;

    // prettier-ignore
    const slices: [number, number, number, number, number, number, number, number][] = [
      // [srcX, srcY, srcW, srcH, dstX, dstY, dstW, dstH]
      [px,       py,       s, s, destX,              destY,              s,          s         ], // TL
      [px + s,   py,       s, s, destX + s,          destY,    destW - 2 * s,        s         ], // TC
      [px + 2*s, py,       s, s, destX + destW - s,  destY,              s,          s         ], // TR
      [px,       py + s,   s, s, destX,              destY + s,          s, destH - 2 * s      ], // ML
      [px + s,   py + s,   s, s, destX + s,          destY + s, destW - 2 * s, destH - 2 * s  ], // MC
      [px + 2*s, py + s,   s, s, destX + destW - s,  destY + s,          s, destH - 2 * s      ], // MR
      [px,       py + 2*s, s, s, destX,              destY + destH - s,  s,          s         ], // BL
      [px + s,   py + 2*s, s, s, destX + s,          destY + destH - s, destW - 2 * s, s       ], // BC
      [px + 2*s, py + 2*s, s, s, destX + destW - s,  destY + destH - s,  s,          s         ], // BR
    ];

    for (const [sx, sy, sw, sh, dx, dy, dw, dh] of slices) {
      this.ctx.drawImage(sheet, sx, sy, sw, sh, dx, dy, dw, dh);
    }
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
      this.isPointInsideButton(x, y, this.MUTE_BUTTON)
    ) {
      this.audioService.toggleMute();
      this.sfxService.setMuted(this.audioService.isMuted);
      return;
    }

    if (this.gameService.currentState === GameState.MENU) {
      this.handleMenuClick(x, y);
    } else if (this.gameService.currentState === GameState.EQUIPMENT_MENU) {
      this.handleEquipmentMenuClick(x, y);
    } else if (this.gameService.currentState === GameState.OPTIONS) {
      this.handleOptionsClick(x, y);
    } else if (this.gameService.currentState === GameState.TERRAIN_TOOL) {
      this.handleTerrainToolClick(x, y);
    } else if (this.gameService.currentState === GameState.LAYER_TOOL) {
      this.handleLayerToolClick(x, y);
    } else if (
      this.gameService.currentState === GameState.PLAYING ||
      this.gameService.currentState === GameState.PAUSED ||
      this.gameService.currentState === GameState.AFTERMATH
    ) {
      if (this.isPointInsideButton(x, y, this.combatLogToggleBtn)) {
        this.combatLogMinimized = !this.combatLogMinimized;
        return;
      }
      for (let i = 0; i < this.vehicleBulletOptions.length; i++) {
        if (this.isPointInsideButton(x, y, this.getWeaponBtnRect(i))) {
          this.selectWeapon(i);
          return;
        }
      }
    }
  }

  private handleMenuClick(x: number, y: number) {
    // Check Start Game button
    if (this.isPointInsideButton(x, y, this.MENU_START_BUTTON)) {
      void this.startGame();
      return;
    }

    // Check Loadout button
    if (this.isPointInsideButton(x, y, this.MENU_LOADOUT_BUTTON)) {
      this.initLoadoutScreen();
      this.gameService.currentState = GameState.EQUIPMENT_MENU;
      return;
    }

    // Check Options button
    if (this.isPointInsideButton(x, y, this.MENU_OPTIONS_BUTTON)) {
      this.gameService.currentState = GameState.OPTIONS;
      return;
    }

    if (
      this.TERRAIN_TOOL_ENABLED &&
      this.isPointInsideButton(x, y, this.MENU_TERRAIN_TOOL_BUTTON)
    ) {
      void this.openTerrainTool();
    }

    if (this.DEV_MODE && this.isPointInsideButton(x, y, this.MENU_TOOLS_BUTTON)) {
      this.openLayerTool();
    }
  }

  private handleOptionsClick(x: number, y: number) {
    if (this.isPointInsideButton(x, y, this.OPTIONS_DIFFICULTY_EASY_BUTTON)) {
      this.gameService.difficulty = 'easy';
      this.gameService.saveDifficulty();
      return;
    }
    if (this.isPointInsideButton(x, y, this.OPTIONS_DIFFICULTY_NORMAL_BUTTON)) {
      this.gameService.difficulty = 'normal';
      this.gameService.saveDifficulty();
      return;
    }
    if (this.isPointInsideButton(x, y, this.OPTIONS_DIFFICULTY_HARD_BUTTON)) {
      this.gameService.difficulty = 'hard';
      this.gameService.saveDifficulty();
      return;
    }
    if (this.isPointInsideButton(x, y, this.OPTIONS_BACK_BUTTON)) {
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
