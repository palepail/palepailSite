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

interface GameCell {
  value: number;
  selected: boolean;
  x: number;
  y: number;
}

enum GameState {
  LOADING = 'loading',
  MENU = 'menu',
  PLAYING = 'playing',
  OPTIONS = 'options',
  GAME_OVER = 'game_over',
  CHOOSE_UPGRADE = 'choose_upgrade',
  LEADERBOARD = 'leaderboard',
  LEADERBOARD_NAME_INPUT = 'leaderboard_name_input',
}

interface GameSettings {
  bgmVolume: number; // 0.0 to 1.0
  sfxVolume: number; // 0.0 to 1.0
  difficulty: 'easy' | 'normal' | 'hard';
  muted: boolean;
}

@Component({
  selector: 'app-number-crunch',
  imports: [RouterLink, CommonModule, FormsModule],
  templateUrl: './number-crunch.html',
  styleUrl: './number-crunch.css',
})
export class NumberCrunch implements OnInit, OnDestroy {
  @ViewChild('gameCanvas', { static: true }) canvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('mobileInput') mobileInput!: ElementRef<HTMLInputElement>;
  private ctx!: CanvasRenderingContext2D;

  // Game state
  currentState: GameState = GameState.MENU;
  settings: GameSettings = {
    bgmVolume: 0.25,
    sfxVolume: 0.35,
    difficulty: 'normal',
    muted: false,
  };

  // Game constants
  private readonly GRID_SIZE = 10;
  private readonly CELL_SIZE = 40;
  private readonly CANVAS_SIZE = this.GRID_SIZE * this.CELL_SIZE;
  private readonly CANVAS_UI_HEIGHT = 100;

  // Health constants
  private readonly MAX_HEALTH = 100;
  private readonly ENEMY_MAX_HEALTH = 450;
  private readonly EASY_HEALTH = 150;
  private readonly HARD_HEALTH = 75;

  // Combat constants
  private readonly ENEMY_ATTACK_DAMAGE = 8;
  private readonly ENEMY_ATTACK_INTERVAL = 8000; // milliseconds

  // Scramble constants
  private readonly SCRAMBLES_PER_LEVEL = 3;
  private readonly SCRAMBLE_ANIMATION_DURATION = 2000; // milliseconds

  // Scoring constants
  private readonly POINTS_PER_TILE = 10;

  // Target number constants
  private readonly TARGET_BASE = 9;
  private readonly TARGET_RANDOM_MIN = 0;
  private readonly TARGET_RANDOM_MAX = 1;

  // Grid generation constants
  private readonly CELL_VALUE_MIN = 1;
  private readonly CELL_VALUE_MAX = 9;

  // UI constants
  private readonly CHARACTER_SIZE = 30;
  private readonly HEALTH_BAR_WIDTH = 40;
  private readonly GRID_BACKGROUND_COLOR = '#f8f9fa'; // Light gray background for grid cells
  private readonly BACKGROUND_COLOR = '#e3f2fd'; // Light blue-gray background for all screens
  private readonly LOW_HEALTH_BACKGROUND_COLOR = '#fce4ec'; // Pink background for low health

  // Game state
  grid: GameCell[][] = [];
  targetNumber = 10;
  score = 0;
  lastHealthBonus = 0; // Track the last health bonus awarded
  level = 1;
  playerHealth = this.MAX_HEALTH;
  enemyHealth = this.ENEMY_MAX_HEALTH; // Set to enemy max health
  timeLeft = 60; // seconds (placeholder, not used)
  nextTarget = 0; // Fixed next target for upgrade screen
  canvasScale = 1; // Current canvas scale factor for click coordinate adjustment

  // Combat timers
  private enemyAttackTimer = 0;
  private playerAttackTimer = 0;

  // Upgrade system
  damageMultiplier = 1.0;
  damageUpgradeCount = 0; // Track damage upgrades for diminishing returns
  healthUpgradeCount = 0; // Track health upgrades for diminishing returns

  // Selection state
  isSelecting = false;
  selectionStart = { x: 0, y: 0 };
  selectionEnd = { x: 0, y: 0 };
  selectedSum = 0;

  // Animation state
  lastTime = 0;

  // Player sprite animation
  private playerSprite = new Image();
  private animationFrame = 0;
  private animationTimer = 0;
  private readonly ANIMATION_FRAME_TIME = 150; // ms per frame (adjust for desired speed)
  private readonly SPRITE_FRAME_WIDTH = 192; // 192px total width / 8 frames
  private readonly SPRITE_FRAME_HEIGHT = 192; // Full height of sprite sheet
  private readonly SPRITE_SCALE = 0.5; // Scale down to fit character size

  // Enemy sprite animation
  private enemySprite = new Image();
  private enemyAnimationFrame = 0;
  private enemyAnimationTimer = 0;
  private readonly ENEMY_ANIMATION_FRAME_TIME = 150; // ms per frame (same speed as player)
  private readonly ENEMY_TOTAL_FRAMES = 7; // 7 frames for enemy idle animation

  // Enemy attack animation
  private enemyAttackSprite = new Image();
  private isEnemyAttacking = false;
  private enemyAttackAnimationFrame = 0;
  private enemyAttackAnimationTimer = 0;
  private readonly ENEMY_ATTACK_FRAME_TIME = 100; // ms per frame (faster for attack)
  private readonly ENEMY_ATTACK_TOTAL_FRAMES = 6; // 6 frames for enemy attack animation

  // Attack animation sprites
  private attackSprite1 = new Image();
  private attackSprite2 = new Image();
  private isAttacking = false;
  private attackAnimationFrame = 0;
  private attackAnimationTimer = 0;
  private currentAttackSprite = 1; // 1 or 2
  private nextAttackSprite = 1; // Alternates between 1 and 2
  private readonly ATTACK_FRAME_TIME = 100; // ms per frame (faster for attack)
  private readonly ATTACK_TOTAL_FRAMES = 4; // 4 frames per attack animation

  // Running animation sprite (for upgrade screen)
  private runningSprite = new Image();
  private runningAnimationFrame = 0;
  private runningAnimationTimer = 0;
  private readonly RUNNING_FRAME_TIME = 120; // ms per frame (slightly faster than idle)
  private readonly RUNNING_TOTAL_FRAMES = 6; // 6 frames for running animation

  // Leaderboard avatar sprites
  private avatarSprites: HTMLImageElement[] = [new Image(), new Image(), new Image(), new Image()];

  // Sound effects
  private playerAttackSound1 = new Audio();
  private playerAttackSound2 = new Audio();
  private enemyAttackSound = new Audio();
  private scrambleSound = new Audio();
  private playerDeathSound1 = new Audio(); // Grunt Ng 1
  private playerDeathSound2 = new Audio(); // Grunt Oh 3
  private playerDeathSound3 = new Audio(); // Grunt Oof 1
  private playerDeathSound4 = new Audio(); // Grunt Uoe 3
  private enemyDeathSound = new Audio(); // Grunt Ehh 1
  private upgradeSound = new Audio(); // harpsichord_positive_long
  private buttonSound = new Audio(); // Wood Block1
  private bgmAudio = new Audio();

  // Asset loading system
  private assetsToLoad: { [key: string]: boolean } = {};
  private loadedAssets: { [key: string]: boolean } = {};
  private loadingProgress = 0;
  private bgmStarted = false;
  private previousState: GameState = GameState.LOADING;
  private bgmFadeInProgress = false;
  private bgmFadeOutProgress = false;
  private windowHasFocus = true;

  // Scramble system
  scramblesRemaining = 3;
  isScrambling = false;
  scrambleTimer = 0;
  scrambleAnimation: {
    oldPos: { x: number; y: number };
    newPos: { x: number; y: number };
    value: number;
  }[] = [];

  // Slider dragging state
  private isDraggingBGM = false;
  private isDraggingSFX = false;

  // Leaderboard data
  private leaderboardEntries: any[] = [];
  private isLoadingLeaderboard = false;
  private isLeaderboardAvailable = true;

  // Leaderboard name input
  leaderboardNameInput = '';
  private isLeaderboardInputFocused = false;
  private pendingLeaderboardScore = 0;

  // Button positions and sizes (shared between drawing and click detection)
  private readonly MENU_PLAY_BUTTON = { x: this.CANVAS_SIZE / 2, y: 180, width: 200, height: 50 };
  private readonly MENU_OPTIONS_BUTTON = {
    x: this.CANVAS_SIZE / 2,
    y: 250,
    width: 200,
    height: 50,
  };
  private readonly MENU_LEADERBOARD_BUTTON = {
    x: this.CANVAS_SIZE / 2,
    y: 320,
    width: 200,
    height: 50,
  };
  private readonly PLAYING_SCRAMBLE_BUTTON = {
    x: this.CANVAS_SIZE / 2,
    y: this.CANVAS_SIZE + 30,
    width: 120,
    height: 35,
  };
  private readonly OPTIONS_SOUND_BUTTON = {
    x: this.CANVAS_SIZE / 2,
    y: 130,
    width: 180,
    height: 40,
  };
  private readonly OPTIONS_EASY_BUTTON = {
    x: this.CANVAS_SIZE / 2,
    y: 230,
    width: 150,
    height: 40,
  };
  private readonly OPTIONS_NORMAL_BUTTON = {
    x: this.CANVAS_SIZE / 2,
    y: this.OPTIONS_EASY_BUTTON.y + this.OPTIONS_EASY_BUTTON.height + 10,
    width: 150,
    height: 40,
  };
  private readonly OPTIONS_HARD_BUTTON = {
    x: this.CANVAS_SIZE / 2,
    y: this.OPTIONS_NORMAL_BUTTON.y + this.OPTIONS_NORMAL_BUTTON.height + 10,
    width: 150,
    height: 40,
  };
  private readonly OPTIONS_BACK_BUTTON = {
    x: this.CANVAS_SIZE / 2,
    y: this.CANVAS_SIZE + 30,
    width: 160,
    height: 40,
  };
  private readonly LEADERBOARD_BACK_BUTTON = {
    x: this.CANVAS_SIZE / 2,
    y: this.CANVAS_SIZE + 60,
    width: 160,
    height: 40,
  };
  private readonly LEADERBOARD_NAME_SUBMIT_BUTTON = {
    x: this.CANVAS_SIZE / 2 - 100,
    y: 340,
    width: 160,
    height: 45,
  };
  private readonly LEADERBOARD_NAME_SKIP_BUTTON = {
    x: this.CANVAS_SIZE / 2 + 100,
    y: 340,
    width: 160,
    height: 45,
  };
  private readonly GAME_OVER_PLAY_AGAIN_BUTTON = {
    x: this.CANVAS_SIZE / 2,
    y: 300,
    width: 180,
    height: 50,
  };
  private readonly GAME_OVER_MAIN_MENU_BUTTON = {
    x: this.CANVAS_SIZE / 2,
    y: 380,
    width: 180,
    height: 50,
  };
  private readonly CHOOSE_UPGRADE_HEALTH_BUTTON = {
    x: this.CANVAS_SIZE / 2,
    y: 225,
    width: 160,
    height: 50,
  };
  private readonly CHOOSE_UPGRADE_DAMAGE_BUTTON = {
    x: this.CANVAS_SIZE / 2,
    y: 295,
    width: 160,
    height: 50,
  };

  // Game loop
  private animationFrameId: number = 0;

  constructor(private cdr: ChangeDetectorRef, private leaderboardService: LeaderboardService) {}

  // Asset loading functions
  private loadPlayerSprite(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.playerSprite.onload = () => {
        this.loadedAssets['playerSprite'] = true;
        this.updateLoadingProgress();
        resolve();
      };
      this.playerSprite.onerror = () => {
        reject(new Error('Failed to load player sprite'));
      };
      this.playerSprite.src = 'resources/images/projects/numberCrunch/Warrior_Idle.png';
    });
  }

  private loadAttackSprites(): Promise<void> {
    return new Promise((resolve, reject) => {
      let loadedCount = 0;
      const totalSprites = 2;

      const checkComplete = () => {
        loadedCount++;
        if (loadedCount === totalSprites) {
          this.loadedAssets['attackSprites'] = true;
          this.updateLoadingProgress();
          resolve();
        }
      };

      const handleError = () => {
        reject(new Error('Failed to load attack sprites'));
      };

      this.attackSprite1.onload = checkComplete;
      this.attackSprite1.onerror = handleError;
      this.attackSprite1.src = 'resources/images/projects/numberCrunch/Warrior_Attack1.png';

      this.attackSprite2.onload = checkComplete;
      this.attackSprite2.onerror = handleError;
      this.attackSprite2.src = 'resources/images/projects/numberCrunch/Warrior_Attack2.png';
    });
  }

  private loadEnemyAttackSprite(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.enemyAttackSprite.onload = () => {
        this.loadedAssets['enemyAttackSprite'] = true;
        this.updateLoadingProgress();
        resolve();
      };
      this.enemyAttackSprite.onerror = () => {
        reject(new Error('Failed to load enemy attack sprite'));
      };
      this.enemyAttackSprite.src = 'resources/images/projects/numberCrunch/Goblin_Red_Attack.png';
    });
  }

  private loadEnemySprite(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.enemySprite.onload = () => {
        this.loadedAssets['enemySprite'] = true;
        this.updateLoadingProgress();
        resolve();
      };
      this.enemySprite.onerror = () => {
        reject(new Error('Failed to load enemy sprite'));
      };
      this.enemySprite.src = 'resources/images/projects/numberCrunch/Goblin_Red_Idle.png';
    });
  }

  private loadRunningSprite(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.runningSprite.onload = () => {
        this.loadedAssets['runningSprite'] = true;
        this.updateLoadingProgress();
        resolve();
      };
      this.runningSprite.onerror = () => {
        reject(new Error('Failed to load running sprite'));
      };
      this.runningSprite.src = 'resources/images/projects/numberCrunch/Warrior_Run.png';
    });
  }

  private loadAvatarSprites(): Promise<void> {
    return new Promise((resolve, reject) => {
      let loadedCount = 0;
      const totalAvatars = 4;

      const checkComplete = () => {
        loadedCount++;
        if (loadedCount === totalAvatars) {
          this.loadedAssets['avatarSprites'] = true;
          this.updateLoadingProgress();
          resolve();
        }
      };

      const handleError = () => {
        reject(new Error('Failed to load avatar sprites'));
      };

      // Load avatars: 01, 02, 03, 05 (skipping 04)
      const avatarFiles = ['01', '02', '03', '05'];
      for (let i = 0; i < 4; i++) {
        this.avatarSprites[i].onload = checkComplete;
        this.avatarSprites[i].onerror = handleError;
        this.avatarSprites[
          i
        ].src = `resources/images/projects/numberCrunch/Avatars_${avatarFiles[i]}.png`;
      }
    });
  }

  private loadSoundEffects(): Promise<void> {
    return new Promise((resolve, reject) => {
      let loadedCount = 0;
      const totalSounds = 3;

      const checkComplete = () => {
        loadedCount++;
        if (loadedCount === totalSounds) {
          this.loadedAssets['soundEffects'] = true;
          this.updateLoadingProgress();
          resolve();
        }
      };

      const handleError = () => {
        reject(new Error('Failed to load sound effects'));
      };

      // Player attack sounds
      this.playerAttackSound1.oncanplaythrough = checkComplete;
      this.playerAttackSound1.onerror = handleError;
      this.playerAttackSound1.src = 'resources/audio/projects/numberCrunch/Sword Attack 2.wav';

      this.playerAttackSound2.oncanplaythrough = checkComplete;
      this.playerAttackSound2.onerror = handleError;
      this.playerAttackSound2.src = 'resources/audio/projects/numberCrunch/Sword Attack 3.wav';

      // Enemy attack sound
      this.enemyAttackSound.oncanplaythrough = checkComplete;
      this.enemyAttackSound.onerror = handleError;
      this.enemyAttackSound.src = 'resources/audio/projects/numberCrunch/Torch Attack Strike 1.wav';

      // Scramble sound
      this.scrambleSound.oncanplaythrough = checkComplete;
      this.scrambleSound.onerror = handleError;
      this.scrambleSound.src = 'resources/audio/projects/numberCrunch/Collect_Special_3.ogg';

      // Player death sounds
      this.playerDeathSound1.oncanplaythrough = checkComplete;
      this.playerDeathSound1.onerror = handleError;
      this.playerDeathSound1.src = 'resources/audio/projects/numberCrunch/Grunt Ng 1.wav';

      this.playerDeathSound2.oncanplaythrough = checkComplete;
      this.playerDeathSound2.onerror = handleError;
      this.playerDeathSound2.src = 'resources/audio/projects/numberCrunch/Grunt Oh 3.wav';

      this.playerDeathSound3.oncanplaythrough = checkComplete;
      this.playerDeathSound3.onerror = handleError;
      this.playerDeathSound3.src = 'resources/audio/projects/numberCrunch/Grunt Oof 1.wav';

      this.playerDeathSound4.oncanplaythrough = checkComplete;
      this.playerDeathSound4.onerror = handleError;
      this.playerDeathSound4.src = 'resources/audio/projects/numberCrunch/Grunt Uoe 3.wav';

      // Enemy death sound
      this.enemyDeathSound.oncanplaythrough = checkComplete;
      this.enemyDeathSound.onerror = handleError;
      this.enemyDeathSound.src = 'resources/audio/projects/numberCrunch/Grunt Ehh 1.wav';

      // Upgrade screen sound
      this.upgradeSound.oncanplaythrough = checkComplete;
      this.upgradeSound.onerror = handleError;
      this.upgradeSound.src = 'resources/audio/projects/numberCrunch/harpsichord_positive_long.wav';

      // Button sound effect
      this.buttonSound.oncanplaythrough = checkComplete;
      this.buttonSound.onerror = handleError;
      this.buttonSound.src = 'resources/audio/projects/numberCrunch/Wood Block1.ogg';
    });
  }

  private loadBGM(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.bgmAudio.oncanplaythrough = () => {
        this.loadedAssets['bgm'] = true;
        this.updateLoadingProgress();
        // Start BGM automatically when loaded
        this.startBGMAutomatically();
        resolve();
      };
      this.bgmAudio.onerror = () => {
        reject(new Error('Failed to load BGM'));
      };
      this.bgmAudio.src = 'resources/audio/projects/numberCrunch/4. Ballad of Ashenwood.ogg';
      this.bgmAudio.loop = true; // Loop the BGM
    });
  }

  private updateLoadingProgress() {
    const totalAssets = Object.keys(this.assetsToLoad).length;
    const loadedCount = Object.values(this.loadedAssets).filter((loaded) => loaded).length;
    this.loadingProgress = totalAssets > 0 ? (loadedCount / totalAssets) * 100 : 100;
  }

  private playButtonSound() {
    if (this.buttonSound && !this.settings.muted && this.windowHasFocus) {
      this.buttonSound.currentTime = 0; // Reset to beginning
      this.buttonSound.volume = this.settings.sfxVolume;
      this.buttonSound.play().catch(() => {}); // Ignore play errors
    }
  }

  private startBGM() {
    if (this.loadedAssets['bgm'] && this.bgmAudio) {
      this.updateBGMVolume();
      this.bgmAudio.currentTime = 0;
      this.bgmAudio.play().catch(() => {
        // If play fails, it will be retried on next user interaction
      });
    }
  }

  private startBGMAutomatically() {
    if (!this.bgmStarted && this.loadedAssets['bgm'] && this.bgmAudio) {
      this.startBGM();
      this.bgmStarted = true;
    }
  }

  private stopBGM() {
    if (this.bgmAudio) {
      this.bgmAudio.pause();
      this.bgmAudio.currentTime = 0;
    }
  }

  private updateBGMVolume() {
    if (this.bgmAudio) {
      this.bgmAudio.volume = this.settings.muted ? 0 : this.settings.bgmVolume;
    }
  }

  private updateBGMVolumeForState() {
    if (this.bgmAudio) {
      // Detect state transitions
      const stateChanged = this.previousState !== this.currentState;
      this.previousState = this.currentState;

      // Determine target volume
      const shouldBeMuted = this.currentState === GameState.MENU || this.settings.muted;
      const targetVolume = shouldBeMuted ? 0 : this.settings.bgmVolume;

      // Handle fade transitions
      if (stateChanged) {
        if (this.currentState === GameState.PLAYING && this.previousState === GameState.MENU) {
          // Fade in when starting game
          this.startBGMFade(targetVolume, 'in');
        } else if (
          this.currentState === GameState.MENU &&
          this.previousState === GameState.PLAYING
        ) {
          // Fade out when returning to menu
          this.startBGMFade(0, 'out');
        } else {
          // Immediate change for other transitions
          this.bgmAudio.volume = targetVolume;
          this.bgmFadeInProgress = false;
          this.bgmFadeOutProgress = false;
        }
      } else {
        // Continue ongoing fades
        this.continueBGMFade();
      }
    }
  }

  private startBGMFade(targetVolume: number, direction: 'in' | 'out') {
    if (direction === 'in') {
      this.bgmFadeInProgress = true;
      this.bgmFadeOutProgress = false;
    } else {
      this.bgmFadeOutProgress = true;
      this.bgmFadeInProgress = false;
    }
    this.bgmFadeTarget = targetVolume;
    this.bgmFadeStartVolume = this.bgmAudio!.volume;
    this.bgmFadeProgress = 0;
  }

  private bgmFadeTarget = 0;
  private bgmFadeStartVolume = 0;
  private bgmFadeProgress = 0;

  private continueBGMFade() {
    if (!this.bgmAudio) return;

    if (this.bgmFadeInProgress || this.bgmFadeOutProgress) {
      this.bgmFadeProgress += 0.02; // Adjust fade speed here (higher = faster)

      if (this.bgmFadeProgress >= 1) {
        // Fade complete
        this.bgmAudio.volume = this.bgmFadeTarget;
        this.bgmFadeInProgress = false;
        this.bgmFadeOutProgress = false;
      } else {
        // Interpolate volume
        const t = this.easeInOutQuad(this.bgmFadeProgress);
        this.bgmAudio.volume =
          this.bgmFadeStartVolume + (this.bgmFadeTarget - this.bgmFadeStartVolume) * t;
      }
    }
  }

  private easeInOutQuad(t: number): number {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  private updateSFXVolume() {
    const volume = this.settings.muted ? 0 : this.settings.sfxVolume;
    if (this.playerAttackSound1) this.playerAttackSound1.volume = volume;
    if (this.playerAttackSound2) this.playerAttackSound2.volume = volume;
    if (this.enemyAttackSound) this.enemyAttackSound.volume = volume;
    if (this.scrambleSound) this.scrambleSound.volume = volume / 2;
    if (this.playerDeathSound1) this.playerDeathSound1.volume = volume * 1.3;
    if (this.playerDeathSound2) this.playerDeathSound2.volume = volume * 1.3;
    if (this.playerDeathSound3) this.playerDeathSound3.volume = volume * 1.3;
    if (this.playerDeathSound4) this.playerDeathSound4.volume = volume * 1.3;
    if (this.enemyDeathSound) this.enemyDeathSound.volume = volume * 1.3;
    if (this.upgradeSound) this.upgradeSound.volume = volume;
  }

  private async loadAllAssets(): Promise<void> {
    // Register assets to load
    this.assetsToLoad['playerSprite'] = false;
    this.loadedAssets['playerSprite'] = false;
    this.assetsToLoad['attackSprites'] = false;
    this.loadedAssets['attackSprites'] = false;
    this.assetsToLoad['enemySprite'] = false;
    this.loadedAssets['enemySprite'] = false;
    this.assetsToLoad['enemyAttackSprite'] = false;
    this.loadedAssets['enemyAttackSprite'] = false;
    this.assetsToLoad['runningSprite'] = false;
    this.loadedAssets['runningSprite'] = false;
    this.assetsToLoad['avatarSprites'] = false;
    this.loadedAssets['avatarSprites'] = false;
    this.assetsToLoad['soundEffects'] = false;
    this.loadedAssets['soundEffects'] = false;
    this.assetsToLoad['bgm'] = false;
    this.loadedAssets['bgm'] = false;

    // Load all assets
    try {
      await Promise.all([
        this.loadPlayerSprite(),
        this.loadAttackSprites(),
        this.loadEnemySprite(),
        this.loadEnemyAttackSprite(),
        this.loadRunningSprite(),
        this.loadAvatarSprites(),
        this.loadSoundEffects(),
        this.loadBGM(),
      ]);
      // Add more asset loading calls here as needed
    } catch (error) {
      console.error('Failed to load assets:', error);
      // Continue with game even if assets fail to load
    }
  }

  ngOnInit() {
    // Start in loading state
    this.currentState = GameState.LOADING;

    this.initializeGame();
    this.startGameLoop();

    // Add visibility change listener to handle screen off/on
    document.addEventListener('visibilitychange', this.handleVisibilityChange.bind(this));

    // Add window focus/blur listeners to pause BGM when window loses focus
    window.addEventListener('focus', this.handleWindowFocus.bind(this));
    window.addEventListener('blur', this.handleWindowBlur.bind(this));
    window.addEventListener('resize', this.handleWindowResize.bind(this));

    // Load assets asynchronously
    this.loadAllAssets()
      .then(() => {
        // Assets loaded, start BGM and transition to menu
        this.startBGM();
        this.currentState = GameState.MENU;
      })
      .catch(() => {
        // If loading fails, still start the game
        this.currentState = GameState.MENU;
      });
  }

  private handleVisibilityChange() {
    if (document.hidden) {
      // Page is hidden (screen off), pause BGM
      if (this.bgmAudio && !this.bgmAudio.paused) {
        this.bgmAudio.pause();
      }
    } else {
      // Page is visible again, resume BGM if it was playing and not muted
      if (this.bgmAudio && this.bgmAudio.paused && !this.settings.muted) {
        this.bgmAudio.play().catch(() => {}); // Ignore play errors
      }
    }
  }

  private handleWindowFocus() {
    this.windowHasFocus = true;
    // Window regained focus, resume BGM if it was playing and not muted
    if (this.bgmAudio && this.bgmAudio.paused && !this.settings.muted) {
      this.bgmAudio.play().catch(() => {}); // Ignore play errors
    }
  }

  private handleWindowBlur() {
    this.windowHasFocus = false;
    // Window lost focus, pause BGM and all currently playing SFX
    if (this.bgmAudio && !this.bgmAudio.paused) {
      this.bgmAudio.pause();
    }

    // Pause all SFX that might be playing
    this.pauseAllSFX();
  }

  private handleWindowResize() {
    // Recalculate canvas size on window resize
    if (this.canvas) {
      this.setupCanvas();
    }
  }

  private pauseAllSFX() {
    // Pause any currently playing sound effects
    if (this.playerAttackSound1 && !this.playerAttackSound1.paused) {
      this.playerAttackSound1.pause();
    }
    if (this.playerAttackSound2 && !this.playerAttackSound2.paused) {
      this.playerAttackSound2.pause();
    }
    if (this.enemyAttackSound && !this.enemyAttackSound.paused) {
      this.enemyAttackSound.pause();
    }
    if (this.scrambleSound && !this.scrambleSound.paused) {
      this.scrambleSound.pause();
    }
    if (this.playerDeathSound1 && !this.playerDeathSound1.paused) {
      this.playerDeathSound1.pause();
    }
    if (this.playerDeathSound2 && !this.playerDeathSound2.paused) {
      this.playerDeathSound2.pause();
    }
    if (this.playerDeathSound3 && !this.playerDeathSound3.paused) {
      this.playerDeathSound3.pause();
    }
    if (this.playerDeathSound4 && !this.playerDeathSound4.paused) {
      this.playerDeathSound4.pause();
    }
    if (this.enemyDeathSound && !this.enemyDeathSound.paused) {
      this.enemyDeathSound.pause();
    }
    if (this.upgradeSound && !this.upgradeSound.paused) {
      this.upgradeSound.pause();
    }
    if (this.buttonSound && !this.buttonSound.paused) {
      this.buttonSound.pause();
    }
  }

  ngOnDestroy() {
    // Remove visibility change listener
    document.removeEventListener('visibilitychange', this.handleVisibilityChange.bind(this));

    // Remove window focus/blur listeners
    window.removeEventListener('focus', this.handleWindowFocus.bind(this));
    window.removeEventListener('blur', this.handleWindowBlur.bind(this));
    window.removeEventListener('resize', this.handleWindowResize.bind(this));

    // Stop game loop
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }

    // Stop all sounds
    if (this.bgmAudio) {
      this.bgmAudio.pause();
      this.bgmAudio.currentTime = 0;
    }
    if (this.playerAttackSound1) {
      this.playerAttackSound1.pause();
      this.playerAttackSound1.currentTime = 0;
    }
    if (this.playerAttackSound2) {
      this.playerAttackSound2.pause();
      this.playerAttackSound2.currentTime = 0;
    }
    if (this.enemyAttackSound) {
      this.enemyAttackSound.pause();
      this.enemyAttackSound.currentTime = 0;
    }
    if (this.scrambleSound) {
      this.scrambleSound.pause();
      this.scrambleSound.currentTime = 0;
    }
    if (this.playerDeathSound1) {
      this.playerDeathSound1.pause();
      this.playerDeathSound1.currentTime = 0;
    }
    if (this.playerDeathSound2) {
      this.playerDeathSound2.pause();
      this.playerDeathSound2.currentTime = 0;
    }
    if (this.playerDeathSound3) {
      this.playerDeathSound3.pause();
      this.playerDeathSound3.currentTime = 0;
    }
    if (this.playerDeathSound4) {
      this.playerDeathSound4.pause();
      this.playerDeathSound4.currentTime = 0;
    }
    if (this.enemyDeathSound) {
      this.enemyDeathSound.pause();
      this.enemyDeathSound.currentTime = 0;
    }
    if (this.upgradeSound) {
      this.upgradeSound.pause();
      this.upgradeSound.currentTime = 0;
    }
    if (this.buttonSound) {
      this.buttonSound.pause();
      this.buttonSound.currentTime = 0;
    }
  }

  private initializeGame() {
    this.createGrid();
    this.setupCanvas();
  }

  private createGrid() {
    this.grid = [];
    for (let y = 0; y < this.GRID_SIZE; y++) {
      this.grid[y] = [];
      for (let x = 0; x < this.GRID_SIZE; x++) {
        this.grid[y][x] = {
          value:
            Math.floor(Math.random() * (this.CELL_VALUE_MAX - this.CELL_VALUE_MIN + 1)) +
            this.CELL_VALUE_MIN,
          selected: false,
          x,
          y,
        };
      }
    }
  }

  private setupCanvas() {
    const canvas = this.canvas.nativeElement;

    // Check if we're on mobile and adjust canvas size accordingly
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      // On mobile, make canvas responsive to fit screen
      const maxCanvasSize = Math.min(window.innerWidth - 32, this.CANVAS_SIZE); // 32px for padding
      const scale = maxCanvasSize / this.CANVAS_SIZE;
      this.canvasScale = scale; // Store scale factor for click coordinate adjustment
      canvas.width = maxCanvasSize;
      canvas.height = (this.CANVAS_SIZE + this.CANVAS_UI_HEIGHT) * scale;
      // Scale the drawing context to maintain aspect ratio
      this.ctx = canvas.getContext('2d')!;
      this.ctx.scale(scale, scale);
    } else {
      // Desktop: use full size
      this.canvasScale = 1; // Reset scale factor
      canvas.width = this.CANVAS_SIZE;
      canvas.height = this.CANVAS_SIZE + this.CANVAS_UI_HEIGHT;
      this.ctx = canvas.getContext('2d')!;
    }
  }

  private startGameLoop() {
    const gameLoop = (currentTime: number) => {
      const deltaTime = currentTime - this.lastTime;
      this.lastTime = currentTime;

      this.update(deltaTime);
      this.render();

      this.animationFrameId = requestAnimationFrame(gameLoop);
    };

    this.animationFrameId = requestAnimationFrame(gameLoop);
  }

  private update(deltaTime: number) {
    // Update BGM volume based on current state
    this.updateBGMVolumeForState();

    // Update all animations - they should run continuously for smooth visuals
    // Update player idle animation
    this.animationTimer += deltaTime;
    if (this.animationTimer >= this.ANIMATION_FRAME_TIME) {
      this.animationTimer = 0;
      this.animationFrame = (this.animationFrame + 1) % 8; // 8 frames total
    }

    // Update enemy idle animation
    this.enemyAnimationTimer += deltaTime;
    if (this.enemyAnimationTimer >= this.ENEMY_ANIMATION_FRAME_TIME) {
      this.enemyAnimationTimer = 0;
      this.enemyAnimationFrame = (this.enemyAnimationFrame + 1) % this.ENEMY_TOTAL_FRAMES; // 7 frames total
    }

    // Update attack animation (completion logic runs on all screens)
    if (this.isAttacking) {
      this.attackAnimationTimer += deltaTime;
      if (this.attackAnimationTimer >= this.ATTACK_FRAME_TIME) {
        this.attackAnimationTimer = 0;
        this.attackAnimationFrame++;

        // Check if attack animation is complete
        if (this.attackAnimationFrame >= this.ATTACK_TOTAL_FRAMES) {
          this.isAttacking = false;
          this.attackAnimationFrame = 0;
          // Reset to idle animation
          this.animationFrame = 0;
          this.animationTimer = 0;
        }
      }
    }

    // Update enemy attack animation (completion logic runs on all screens)
    if (this.isEnemyAttacking) {
      this.enemyAttackAnimationTimer += deltaTime;
      if (this.enemyAttackAnimationTimer >= this.ENEMY_ATTACK_FRAME_TIME) {
        this.enemyAttackAnimationTimer = 0;
        this.enemyAttackAnimationFrame++;

        // Check if enemy attack animation is complete
        if (this.enemyAttackAnimationFrame >= this.ENEMY_ATTACK_TOTAL_FRAMES) {
          this.isEnemyAttacking = false;
          this.enemyAttackAnimationFrame = 0;
          // Reset to idle animation
          this.enemyAnimationFrame = 0;
          this.enemyAnimationTimer = 0;
        }
      }
    }

    // Update running animation (for upgrade screen) - runs on all screens
    this.runningAnimationTimer += deltaTime;
    if (this.runningAnimationTimer >= this.RUNNING_FRAME_TIME) {
      this.runningAnimationTimer = 0;
      this.runningAnimationFrame = (this.runningAnimationFrame + 1) % this.RUNNING_TOTAL_FRAMES; // 6 frames total
    }

    if (this.currentState !== GameState.PLAYING) return;

    // Handle scrambling animation
    if (this.isScrambling) {
      this.scrambleTimer += deltaTime;
      if (this.scrambleTimer >= this.SCRAMBLE_ANIMATION_DURATION) {
        // Animation duration
        this.finishScrambling();
      }
      return; // Don't update other game logic while scrambling
    }

    // Update enemy attack timer
    this.enemyAttackTimer += deltaTime;
    if (this.enemyAttackTimer >= this.ENEMY_ATTACK_INTERVAL) {
      // Attack interval
      this.enemyAttackTimer = 0;

      // Trigger enemy attack animation
      if (this.loadedAssets['enemyAttackSprite'] && !this.isEnemyAttacking) {
        this.isEnemyAttacking = true;
        this.enemyAttackAnimationFrame = 0;
        this.enemyAttackAnimationTimer = 0;

        // Play enemy attack sound effect
        if (
          this.settings.sfxVolume > 0 &&
          this.loadedAssets['soundEffects'] &&
          this.enemyAttackSound &&
          this.windowHasFocus &&
          !this.settings.muted
        ) {
          this.enemyAttackSound.currentTime = 0; // Reset to beginning
          this.enemyAttackSound.play().catch(() => {}); // Ignore play errors
        }
      }

      this.playerHealth = Math.max(0, this.playerHealth - this.ENEMY_ATTACK_DAMAGE);
    }

    // Check win/lose conditions
    if (this.playerHealth <= 0) {
      // Play random player death sound
      const deathSounds = [
        this.playerDeathSound1,
        this.playerDeathSound2,
        this.playerDeathSound3,
        this.playerDeathSound4,
      ];
      const randomSound = deathSounds[Math.floor(Math.random() * deathSounds.length)];
      if (randomSound && this.windowHasFocus && !this.settings.muted) {
        randomSound.currentTime = 0; // Reset to beginning
        randomSound.play().catch(() => {}); // Ignore play errors
      }
      this.currentState = GameState.GAME_OVER;
      this.cdr.detectChanges(); // Force UI update to hide restart button immediately
      this.handleGameOverLeaderboard();
    }
    if (this.enemyHealth <= 0) {
      // Play enemy death sound
      if (this.enemyDeathSound && this.windowHasFocus && !this.settings.muted) {
        this.enemyDeathSound.currentTime = 0; // Reset to beginning
        this.enemyDeathSound.play().catch(() => {}); // Ignore play errors
      }

      // Calculate health bonus for remaining health
      const healthPercentage = this.playerHealth / this.MAX_HEALTH;
      const healthBonus = Math.floor(this.score * healthPercentage * 0.5); // 50% of current score as bonus
      this.score += healthBonus;
      this.lastHealthBonus = healthBonus;

      this.nextTarget = this.calculateNextTarget(); // Calculate next target once
      this.currentState = GameState.CHOOSE_UPGRADE; // Go to upgrade choice instead of directly to next level
      this.cdr.detectChanges(); // Force UI update

      // Play upgrade screen sound
      if (this.upgradeSound && this.windowHasFocus && !this.settings.muted) {
        this.upgradeSound.currentTime = 0; // Reset to beginning
        this.upgradeSound.play().catch(() => {}); // Ignore play errors
      }
    }
  }

  private render() {
    // Note: Each render method now sets its own background, so no global clear needed

    // Ensure BGM is playing for all game states (except loading)
    if (
      this.currentState !== GameState.LOADING &&
      this.bgmAudio &&
      this.bgmAudio.paused &&
      !this.settings.muted
    ) {
      this.bgmAudio.play().catch(() => {
        // If play fails, it will be retried on next render
      });
    }

    switch (this.currentState) {
      case GameState.LOADING:
        this.renderLoading();
        break;
      case GameState.MENU:
        this.renderMenu();
        break;
      case GameState.PLAYING:
        this.renderGame();
        break;
      case GameState.OPTIONS:
        this.renderOptions();
        break;
      case GameState.GAME_OVER:
        this.renderGameOver();
        break;
      case GameState.CHOOSE_UPGRADE:
        this.renderChooseUpgrade();
        break;
      case GameState.LEADERBOARD:
        this.renderLeaderboard();
        break;
      case GameState.LEADERBOARD_NAME_INPUT:
        this.renderLeaderboardNameInput();
        break;
    }
  }

  private renderGame() {
    // Background - change to pink when health is at 20% or lower
    const backgroundColor =
      this.playerHealth <= 20 ? this.LOW_HEALTH_BACKGROUND_COLOR : this.BACKGROUND_COLOR;
    this.ctx.fillStyle = backgroundColor;
    this.ctx.fillRect(0, 0, this.CANVAS_SIZE, this.CANVAS_SIZE + this.CANVAS_UI_HEIGHT);

    // Draw grid
    this.drawGrid();

    // Draw scramble animation
    if (this.isScrambling && this.scrambleAnimation.length > 0) {
      this.drawScrambleAnimation();
    }

    // Draw selection
    if (this.isSelecting) {
      this.drawSelection();
    }

    // Draw UI
    this.drawUI();
  }

  private renderMenu() {
    // Background
    this.ctx.fillStyle = this.BACKGROUND_COLOR;
    this.ctx.fillRect(0, 0, this.CANVAS_SIZE, this.CANVAS_SIZE + this.CANVAS_UI_HEIGHT);

    // Title
    this.ctx.fillStyle = '#1976d2';
    this.ctx.font = 'bold 32px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Number Crunch', this.CANVAS_SIZE / 2, 80);

    // Subtitle
    this.ctx.font = '18px Arial';
    this.ctx.fillStyle = '#424242';
    this.ctx.fillText('Match numbers to defeat enemies!', this.CANVAS_SIZE / 2, 125);

    // Draw buttons
    this.drawButton(
      'Play Game',
      this.MENU_PLAY_BUTTON.x,
      this.MENU_PLAY_BUTTON.y,
      this.MENU_PLAY_BUTTON.width,
      this.MENU_PLAY_BUTTON.height,
      '#4CAF50',
      '#45a049'
    );
    this.drawButton(
      'Options',
      this.MENU_OPTIONS_BUTTON.x,
      this.MENU_OPTIONS_BUTTON.y,
      this.MENU_OPTIONS_BUTTON.width,
      this.MENU_OPTIONS_BUTTON.height,
      '#2196F3',
      '#1976D2'
    );
    this.drawButton(
      'Leaderboard',
      this.MENU_LEADERBOARD_BUTTON.x,
      this.MENU_LEADERBOARD_BUTTON.y,
      this.MENU_LEADERBOARD_BUTTON.width,
      this.MENU_LEADERBOARD_BUTTON.height,
      '#FF9800',
      '#F57C00'
    );

    // Draw idle animations under the leaderboard button
    const characterY = this.MENU_LEADERBOARD_BUTTON.y + 80; // Position below the leaderboard button
    const playerX = this.CANVAS_SIZE / 2 - 40; // Left side, closer to center
    const enemyX = this.CANVAS_SIZE / 2 + 40; // Right side, closer to center

    // Draw player idle animation
    if (this.loadedAssets['playerSprite'] && this.playerSprite && this.playerSprite.complete) {
      const frameWidth = this.SPRITE_FRAME_WIDTH;
      const frameHeight = this.SPRITE_FRAME_HEIGHT;
      const scaledWidth = frameWidth * this.SPRITE_SCALE;
      const scaledHeight = frameHeight * this.SPRITE_SCALE;

      this.ctx.drawImage(
        this.playerSprite,
        this.animationFrame * frameWidth, // source x
        0, // source y (idle animation is at top)
        frameWidth, // source width
        frameHeight, // source height
        playerX - scaledWidth / 2, // destination x (centered)
        characterY - scaledHeight / 2, // destination y (centered)
        scaledWidth, // destination width
        scaledHeight // destination height
      );
    }

    // Draw enemy idle animation (flipped horizontally)
    if (this.loadedAssets['enemySprite'] && this.enemySprite && this.enemySprite.complete) {
      const frameWidth = this.SPRITE_FRAME_WIDTH;
      const frameHeight = this.SPRITE_FRAME_HEIGHT;
      const scaledWidth = frameWidth * this.SPRITE_SCALE;
      const scaledHeight = frameHeight * this.SPRITE_SCALE;

      // Save context for flipping
      this.ctx.save();

      // Flip horizontally for enemy (faces left)
      this.ctx.scale(-1, 1);
      this.ctx.drawImage(
        this.enemySprite,
        this.enemyAnimationFrame * frameWidth, // source x
        0, // source y (idle animation is at top)
        frameWidth, // source width
        frameHeight, // source height
        -enemyX - scaledWidth / 2, // destination x (flipped, so negate x and adjust)
        characterY - scaledHeight / 2, // destination y (centered)
        scaledWidth, // destination width
        scaledHeight // destination height
      );

      // Restore context
      this.ctx.restore();
    }

    // Instructions
    this.ctx.fillStyle = '#424242';
    this.ctx.font = '14px Arial';
    this.ctx.fillText(
      'Click and drag to select rectangular areas',
      this.CANVAS_SIZE / 2,
      this.CANVAS_SIZE + 50
    );
    this.ctx.fillText(
      'Match the target sum to score points!',
      this.CANVAS_SIZE / 2,
      this.CANVAS_SIZE + 70
    );
  }

  private renderLoading() {
    // Background
    this.ctx.fillStyle = this.BACKGROUND_COLOR;
    this.ctx.fillRect(0, 0, this.CANVAS_SIZE, this.CANVAS_SIZE + this.CANVAS_UI_HEIGHT);

    // Loading text
    this.ctx.fillStyle = '#1976d2';
    this.ctx.font = 'bold 28px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Loading...', this.CANVAS_SIZE / 2, this.CANVAS_SIZE / 2 - 20);

    // Progress bar background
    this.ctx.fillStyle = '#e0e0e0';
    this.ctx.fillRect(this.CANVAS_SIZE / 2 - 100, this.CANVAS_SIZE / 2 + 10, 200, 20);

    // Progress bar fill
    this.ctx.fillStyle = '#4CAF50';
    this.ctx.fillRect(
      this.CANVAS_SIZE / 2 - 100,
      this.CANVAS_SIZE / 2 + 10,
      (this.loadingProgress / 100) * 200,
      20
    );

    // Progress text
    this.ctx.fillStyle = '#333';
    this.ctx.font = '16px Arial';
    this.ctx.fillText(
      `${Math.round(this.loadingProgress)}%`,
      this.CANVAS_SIZE / 2,
      this.CANVAS_SIZE / 2 + 45
    );
  }

  private renderOptions() {
    // Background
    this.ctx.fillStyle = this.BACKGROUND_COLOR;
    this.ctx.fillRect(0, 0, this.CANVAS_SIZE, this.CANVAS_SIZE + this.CANVAS_UI_HEIGHT);

    // Title
    this.ctx.fillStyle = '#1976d2';
    this.ctx.font = 'bold 28px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Options', this.CANVAS_SIZE / 2, 60);

    // Draw volume sliders
    this.drawSlider('BGM Volume', this.CANVAS_SIZE / 2, 120, 200, 20, this.settings.bgmVolume);
    this.drawSlider('SFX Volume', this.CANVAS_SIZE / 2, 180, 200, 20, this.settings.sfxVolume);

    // Draw difficulty buttons
    this.drawButton(
      'Easy',
      this.OPTIONS_EASY_BUTTON.x,
      this.OPTIONS_EASY_BUTTON.y,
      this.OPTIONS_EASY_BUTTON.width,
      this.OPTIONS_EASY_BUTTON.height,
      this.settings.difficulty === 'easy' ? '#FF9800' : '#757575',
      this.settings.difficulty === 'easy' ? '#F57C00' : '#616161'
    );
    this.drawButton(
      'Normal',
      this.OPTIONS_NORMAL_BUTTON.x,
      this.OPTIONS_NORMAL_BUTTON.y,
      this.OPTIONS_NORMAL_BUTTON.width,
      this.OPTIONS_NORMAL_BUTTON.height,
      this.settings.difficulty === 'normal' ? '#FF9800' : '#757575',
      this.settings.difficulty === 'normal' ? '#F57C00' : '#616161'
    );
    this.drawButton(
      'Hard',
      this.OPTIONS_HARD_BUTTON.x,
      this.OPTIONS_HARD_BUTTON.y,
      this.OPTIONS_HARD_BUTTON.width,
      this.OPTIONS_HARD_BUTTON.height,
      this.settings.difficulty === 'hard' ? '#FF9800' : '#757575',
      this.settings.difficulty === 'hard' ? '#F57C00' : '#616161'
    );
    this.drawButton(
      'Back to Menu',
      this.OPTIONS_BACK_BUTTON.x,
      this.OPTIONS_BACK_BUTTON.y,
      this.OPTIONS_BACK_BUTTON.width,
      this.OPTIONS_BACK_BUTTON.height,
      '#9C27B0',
      '#7B1FA2'
    );
  }

  private drawButton(
    text: string,
    x: number,
    y: number,
    width: number,
    height: number,
    color: string,
    hoverColor: string
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

  private drawSlider(
    label: string,
    x: number,
    y: number,
    width: number,
    height: number,
    value: number,
    min: number = 0,
    max: number = 1
  ) {
    // Slider track
    this.ctx.fillStyle = '#e0e0e0';
    this.ctx.fillRect(x - width / 2, y - height / 2, width, height);

    // Slider fill
    const fillWidth = (value / max) * width;
    this.ctx.fillStyle = '#4CAF50';
    this.ctx.fillRect(x - width / 2, y - height / 2, fillWidth, height);

    // Slider handle
    const handleX = x - width / 2 + fillWidth;
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(handleX - 5, y - height / 2 - 5, 10, height + 10);
    this.ctx.strokeStyle = '#333';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(handleX - 5, y - height / 2 - 5, 10, height + 10);

    // Label
    this.ctx.fillStyle = '#333';
    this.ctx.font = '16px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(`${label}: ${Math.round(value * 100)}%`, x, y - 25);
  }

  private renderGameOver() {
    // Background
    this.ctx.fillStyle = this.BACKGROUND_COLOR;
    this.ctx.fillRect(0, 0, this.CANVAS_SIZE, this.CANVAS_SIZE + this.CANVAS_UI_HEIGHT);

    // Game Over text - larger and more prominent
    this.ctx.fillStyle = '#c62828';
    this.ctx.font = 'bold 48px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('GAME OVER', this.CANVAS_SIZE / 2, 120);

    // Subtitle
    this.ctx.font = '24px Arial';
    this.ctx.fillStyle = '#c62828';
    this.ctx.fillText('Better luck next time!', this.CANVAS_SIZE / 2, 160);

    // Final score with difficulty multiplier
    const difficultyMultiplier = this.getDifficultyMultiplier();
    const finalScore = Math.round(this.score * difficultyMultiplier);
    this.ctx.fillStyle = '#c62828';
    this.ctx.font = '20px Arial';
    this.ctx.fillText(`Final Score: ${finalScore}`, this.CANVAS_SIZE / 2, 200);
    this.ctx.fillText(`Level Reached: ${this.level}`, this.CANVAS_SIZE / 2, 230);

    // Draw buttons
    this.drawButton(
      'Play Again',
      this.GAME_OVER_PLAY_AGAIN_BUTTON.x,
      this.GAME_OVER_PLAY_AGAIN_BUTTON.y,
      this.GAME_OVER_PLAY_AGAIN_BUTTON.width,
      this.GAME_OVER_PLAY_AGAIN_BUTTON.height,
      '#4CAF50',
      '#45a049'
    );
    this.drawButton(
      'Main Menu',
      this.GAME_OVER_MAIN_MENU_BUTTON.x,
      this.GAME_OVER_MAIN_MENU_BUTTON.y,
      this.GAME_OVER_MAIN_MENU_BUTTON.width,
      this.GAME_OVER_MAIN_MENU_BUTTON.height,
      '#2196F3',
      '#1976D2'
    );
  }

  private async handleGameOverLeaderboard() {
    const difficultyMultiplier = this.getDifficultyMultiplier();
    const finalScore = Math.round(this.score * difficultyMultiplier);

    try {
      const topEntries = await this.leaderboardService.getTopEntries(10);
      const qualifies =
        topEntries.length < 10 || finalScore > (topEntries[topEntries.length - 1]?.score || 0);

      if (qualifies) {
        // Store the score and show name input popup
        this.pendingLeaderboardScore = finalScore;
        this.leaderboardNameInput = '';
        this.isLeaderboardInputFocused = true; // Auto-focus the input
        this.currentState = GameState.LEADERBOARD_NAME_INPUT;
      }
    } catch (error) {
      console.error('Error handling leaderboard:', error);
    }
  }

  private renderChooseUpgrade() {
    // Background - use consistent light blue
    this.ctx.fillStyle = this.BACKGROUND_COLOR;
    this.ctx.fillRect(0, 0, this.CANVAS_SIZE, this.CANVAS_SIZE + this.CANVAS_UI_HEIGHT);

    // Victory text - dark blue for readability
    this.ctx.fillStyle = '#1976d2';
    this.ctx.font = 'bold 32px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Level Complete!', this.CANVAS_SIZE / 2, 80);

    // Level and target info - show NEXT level and target
    this.ctx.font = '20px Arial';
    this.ctx.fillStyle = '#424242';
    const nextLevel = this.level + 1;
    this.ctx.fillText(`Next Level: ${nextLevel}`, this.CANVAS_SIZE / 2, 110);
    this.ctx.fillText(`Next Target: ${this.nextTarget}`, this.CANVAS_SIZE / 2, 135);

    // Upgrade choice text
    this.ctx.font = '18px Arial';
    this.ctx.fillStyle = '#424242';
    this.ctx.fillText('Choose your upgrade:', this.CANVAS_SIZE / 2, 165);

    // Calculate health upgrade percentage with diminishing returns
    const healthBaseMultiplier = 1.15;
    const healthDiminishingFactor = 0.03; // 1% reduction per upgrade (slower)
    const healthMinMultiplier = 1.05;
    const healthEffectiveMultiplier = Math.max(
      healthMinMultiplier,
      healthBaseMultiplier * (1 - healthDiminishingFactor * this.healthUpgradeCount)
    );
    const healthPercent = Math.round((healthEffectiveMultiplier - 1) * 100);

    // Draw buttons
    this.drawButton(
      `Health +${healthPercent}%`,
      this.CHOOSE_UPGRADE_HEALTH_BUTTON.x,
      this.CHOOSE_UPGRADE_HEALTH_BUTTON.y,
      this.CHOOSE_UPGRADE_HEALTH_BUTTON.width,
      this.CHOOSE_UPGRADE_HEALTH_BUTTON.height,
      '#FF9800',
      '#F57C00'
    );
    // Calculate damage upgrade percentage with diminishing returns
    const baseMultiplier = 1.15;
    const diminishingFactor = 0.03; // 1% reduction per upgrade (slower)
    const minMultiplier = 1.05;
    const effectiveMultiplier = Math.max(
      minMultiplier,
      baseMultiplier * (1 - diminishingFactor * this.damageUpgradeCount)
    );
    const damagePercent = Math.round((effectiveMultiplier - 1) * 100);

    this.drawButton(
      `Damage +${damagePercent}%`,
      this.CHOOSE_UPGRADE_DAMAGE_BUTTON.x,
      this.CHOOSE_UPGRADE_DAMAGE_BUTTON.y,
      this.CHOOSE_UPGRADE_DAMAGE_BUTTON.width,
      this.CHOOSE_UPGRADE_DAMAGE_BUTTON.height,
      '#FF5722',
      '#D84315'
    );

    // Draw running animation at bottom center
    if (this.loadedAssets['runningSprite'] && this.runningSprite.complete) {
      const frameWidth = this.SPRITE_FRAME_WIDTH;
      const frameHeight = this.SPRITE_FRAME_HEIGHT;
      const scaledWidth = frameWidth * this.SPRITE_SCALE;
      const scaledHeight = frameHeight * this.SPRITE_SCALE;

      this.ctx.drawImage(
        this.runningSprite,
        this.runningAnimationFrame * frameWidth, // source x
        0, // source y
        frameWidth, // source width
        frameHeight, // source height
        this.CANVAS_SIZE / 2 - scaledWidth / 2, // destination x (centered)
        (this.CHOOSE_UPGRADE_DAMAGE_BUTTON.y +
          this.CHOOSE_UPGRADE_DAMAGE_BUTTON.height / 2 +
          (this.CANVAS_SIZE + this.CANVAS_UI_HEIGHT)) /
          2 -
          scaledHeight / 2, // destination y (halfway between bottom of last button and bottom of screen)
        scaledWidth, // destination width
        scaledHeight // destination height
      );
    }
  }

  private getAvatarIndex(date: any): number {
    // Handle Firestore Timestamp objects
    let dateObj: Date;
    if (date && typeof date.toDate === 'function') {
      // Firestore Timestamp
      dateObj = date.toDate();
    } else if (date instanceof Date) {
      // JavaScript Date
      dateObj = date;
    } else {
      // Fallback to current date if invalid
      dateObj = new Date();
    }

    // Ensure we have a valid date
    if (isNaN(dateObj.getTime())) {
      dateObj = new Date();
    }

    // Create a simple hash from the date string to ensure consistent avatar assignment
    const dateString = dateObj.toISOString();
    let hash = 0;
    for (let i = 0; i < dateString.length; i++) {
      hash = (hash << 5) - hash + dateString.charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash) % 4; // Return 0-3 for the 4 avatars
  }

  private async loadLeaderboard() {
    this.isLoadingLeaderboard = true;
    try {
      // Check if leaderboard is available
      this.isLeaderboardAvailable = await this.leaderboardService.isAvailable();
      if (this.isLeaderboardAvailable) {
        this.leaderboardEntries = await this.leaderboardService.getTopEntries(10);
      } else {
        this.leaderboardEntries = [];
      }
    } catch (error) {
      console.warn('Leaderboard unavailable:', error);
      this.isLeaderboardAvailable = false;
      this.leaderboardEntries = [];
    } finally {
      this.isLoadingLeaderboard = false;
    }
  }

  private renderLeaderboard() {
    // Background
    this.ctx.fillStyle = this.BACKGROUND_COLOR;
    this.ctx.fillRect(0, 0, this.CANVAS_SIZE, this.CANVAS_SIZE + this.CANVAS_UI_HEIGHT);

    // Title
    this.ctx.fillStyle = '#1976d2';
    this.ctx.font = 'bold 32px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Leaderboard', this.CANVAS_SIZE / 2, 40);

    // Back button - always available
    this.drawButton(
      'Back to Menu',
      this.LEADERBOARD_BACK_BUTTON.x,
      this.LEADERBOARD_BACK_BUTTON.y,
      this.LEADERBOARD_BACK_BUTTON.width,
      this.LEADERBOARD_BACK_BUTTON.height,
      '#2196F3',
      '#1976D2'
    );

    if (this.isLoadingLeaderboard) {
      this.ctx.fillStyle = '#424242';
      this.ctx.font = '20px Arial';
      this.ctx.fillText('Loading...', this.CANVAS_SIZE / 2, 100);
      return;
    }

    if (!this.isLeaderboardAvailable) {
      this.ctx.fillStyle = '#ff6b6b';
      this.ctx.font = '18px Arial';
      this.ctx.fillText('Leaderboard Unavailable', this.CANVAS_SIZE / 2, 100);
      this.ctx.fillStyle = '#666';
      this.ctx.font = '14px Arial';
      this.ctx.fillText('Please disable ad blocker', this.CANVAS_SIZE / 2, 125);
      this.ctx.fillText('or privacy extensions', this.CANVAS_SIZE / 2, 145);
      return;
    }

    if (this.leaderboardEntries.length === 0) {
      this.ctx.fillStyle = '#424242';
      this.ctx.font = '20px Arial';
      this.ctx.fillText('No scores yet!', this.CANVAS_SIZE / 2, 100);
      this.ctx.fillText('Be the first to play!', this.CANVAS_SIZE / 2, 130);
    } else {
      // Headers
      this.ctx.fillStyle = '#333';
      this.ctx.font = 'bold 16px Arial';
      this.ctx.textAlign = 'left';
      this.ctx.fillText('Rank', 60, 80);
      this.ctx.fillText('Name', 100, 80);
      this.ctx.fillText('Score', 200, 80);
      this.ctx.fillText('Lvl', 280, 80);
      this.ctx.fillText('Diff', 320, 80);

      // Entries
      this.ctx.font = '16px Arial';
      this.leaderboardEntries.forEach((entry, index) => {
        const y = 110 + index * 35;
        const avatarIndex = this.getAvatarIndex(entry.date);

        // Draw avatar
        if (
          this.loadedAssets['avatarSprites'] &&
          this.avatarSprites[avatarIndex] &&
          this.avatarSprites[avatarIndex].complete
        ) {
          this.ctx.drawImage(this.avatarSprites[avatarIndex], 30, y - 20, 30, 30);
        }

        this.ctx.fillStyle = index < 3 ? '#FF9800' : '#424242'; // Gold for top 3
        this.ctx.fillText(`${index + 1}`, 60, y);
        this.ctx.fillText(entry.name || 'Anonymous', 100, y);
        this.ctx.fillText(entry.score?.toString() || '0', 200, y);
        this.ctx.fillText(entry.level?.toString() || '1', 280, y);
        this.ctx.fillText(entry.difficulty || 'normal', 320, y);
      });
    }
  }

  private handleLeaderboardClick(x: number, y: number) {
    // Back button
    if (
      this.isClickInButton(
        x,
        y,
        this.LEADERBOARD_BACK_BUTTON.x,
        this.LEADERBOARD_BACK_BUTTON.y,
        this.LEADERBOARD_BACK_BUTTON.width,
        this.LEADERBOARD_BACK_BUTTON.height
      )
    ) {
      this.playButtonSound();
      this.currentState = GameState.MENU;
    }
  }

  private renderLeaderboardNameInput() {
    // Background - use the same background as other screens
    this.ctx.fillStyle = this.BACKGROUND_COLOR;
    this.ctx.fillRect(0, 0, this.CANVAS_SIZE, this.CANVAS_SIZE + this.CANVAS_UI_HEIGHT);

    // No overlay needed since we're using the full background

    // Title
    this.ctx.fillStyle = '#1976d2';
    this.ctx.font = 'bold 28px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Congratulations!', this.CANVAS_SIZE / 2, 80);
    this.ctx.fillText('Welcome to the', this.CANVAS_SIZE / 2, 110);
    this.ctx.fillText('Leaderboard!', this.CANVAS_SIZE / 2, 140);

    // Subtitle
    this.ctx.fillStyle = '#333';
    this.ctx.font = '20px Arial';
    this.ctx.fillText('What is your Name:', this.CANVAS_SIZE / 2, 200);

    // Input field background
    this.ctx.fillStyle = '#f5f5f5';
    this.ctx.fillRect(50, 240, this.CANVAS_SIZE - 100, 40);
    this.ctx.strokeStyle = this.isLeaderboardInputFocused ? '#2196F3' : '#ccc';
    this.ctx.lineWidth = this.isLeaderboardInputFocused ? 2 : 1;
    this.ctx.strokeRect(50, 240, this.CANVAS_SIZE - 100, 40);

    // Input text
    this.ctx.fillStyle = '#333';
    this.ctx.font = '18px Arial';
    this.ctx.textAlign = 'left';
    const displayText = this.leaderboardNameInput || 'Type your name here...';
    this.ctx.fillText(displayText, 60, 265);

    // Character counter
    this.ctx.fillStyle = '#666';
    this.ctx.font = '14px Arial';
    this.ctx.textAlign = 'right';
    this.ctx.fillText(`${this.leaderboardNameInput.length}/10`, this.CANVAS_SIZE - 60, 285);

    // Draw buttons
    this.drawButton(
      'Submit',
      this.LEADERBOARD_NAME_SUBMIT_BUTTON.x,
      this.LEADERBOARD_NAME_SUBMIT_BUTTON.y,
      this.LEADERBOARD_NAME_SUBMIT_BUTTON.width,
      this.LEADERBOARD_NAME_SUBMIT_BUTTON.height,
      '#4CAF50',
      '#45a049'
    );
    this.drawButton(
      'Skip',
      this.LEADERBOARD_NAME_SKIP_BUTTON.x,
      this.LEADERBOARD_NAME_SKIP_BUTTON.y,
      this.LEADERBOARD_NAME_SKIP_BUTTON.width,
      this.LEADERBOARD_NAME_SKIP_BUTTON.height,
      '#f44336',
      '#d32f2f'
    );
  }

  private handleLeaderboardNameInputClick(x: number, y: number) {
    // Check if clicking on input field (focus it)
    if (x >= 50 && x <= this.CANVAS_SIZE - 50 && y >= 240 && y <= 280) {
      this.isLeaderboardInputFocused = true;
      // Focus the mobile input for virtual keyboard
      if (this.mobileInput) {
        setTimeout(() => {
          this.mobileInput.nativeElement.focus();
        }, 10);
      }
      return;
    }

    // Clicking elsewhere defocuses the input
    this.isLeaderboardInputFocused = false;
    // Blur the mobile input
    if (this.mobileInput) {
      this.mobileInput.nativeElement.blur();
    }

    // Submit button
    if (
      this.isClickInButton(
        x,
        y,
        this.LEADERBOARD_NAME_SUBMIT_BUTTON.x,
        this.LEADERBOARD_NAME_SUBMIT_BUTTON.y,
        this.LEADERBOARD_NAME_SUBMIT_BUTTON.width,
        this.LEADERBOARD_NAME_SUBMIT_BUTTON.height
      )
    ) {
      this.submitLeaderboardName();
    }
    // Skip button
    else if (
      this.isClickInButton(
        x,
        y,
        this.LEADERBOARD_NAME_SKIP_BUTTON.x,
        this.LEADERBOARD_NAME_SKIP_BUTTON.y,
        this.LEADERBOARD_NAME_SKIP_BUTTON.width,
        this.LEADERBOARD_NAME_SKIP_BUTTON.height
      )
    ) {
      this.skipLeaderboardName();
    }
  }

  private handleLeaderboardNameInputKey(event: KeyboardEvent) {
    event.preventDefault(); // Prevent default browser behavior

    if (event.key === 'Enter') {
      this.submitLeaderboardName();
    } else if (event.key === 'Escape') {
      this.skipLeaderboardName();
    } else if (event.key === 'Backspace') {
      this.leaderboardNameInput = this.leaderboardNameInput.slice(0, -1);
    } else if (event.key.length === 1 && this.leaderboardNameInput.length < 10) {
      // Only allow alphanumeric characters and spaces
      if (/^[a-zA-Z0-9 ]$/.test(event.key)) {
        this.leaderboardNameInput += event.key;
      }
    }
  }

  private containsProfanity(name: string): boolean {
    // Basic profanity filter - common offensive words
    const profanityList = [
      'fuck',
      'shit',
      'damn',
      'bitch',
      'asshole',
      'bastard',
      'cunt',
      'dick',
      'pussy',
      'cock',
      'fag',
      'faggot',
      'nigger',
      'nigga',
      'chink',
      'gook',
      'spic',
      'wetback',
      'kike',
      'heeb',
      'crap',
      'piss',
      'tits',
      'boobs',
      'slut',
      'whore',
      'cum',
      'jizz',
      'wank',
      'twat',
    ];

    const lowerName = name.toLowerCase();
    return profanityList.some((word) => lowerName.includes(word));
  }

  private async submitLeaderboardName() {
    const name = this.leaderboardNameInput.trim();
    if (name && !this.containsProfanity(name)) {
      try {
        await this.leaderboardService.addEntry({
          name: name,
          score: this.pendingLeaderboardScore,
          difficulty: this.settings.difficulty,
          level: this.level,
          date: new Date(),
        });
      } catch (error) {
        console.error('Error submitting leaderboard entry:', error);
      }
    }
    this.currentState = GameState.GAME_OVER;
  }

  private skipLeaderboardName() {
    this.currentState = GameState.GAME_OVER;
  }

  private drawGrid() {
    for (let y = 0; y < this.GRID_SIZE; y++) {
      for (let x = 0; x < this.GRID_SIZE; x++) {
        const cell = this.grid[y][x];
        const color = cell.selected ? '#4CAF50' : this.GRID_BACKGROUND_COLOR;

        this.ctx.fillStyle = color;
        this.ctx.fillRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);

        this.ctx.strokeStyle = '#ddd';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(x * this.CELL_SIZE, y * this.CELL_SIZE, this.CELL_SIZE, this.CELL_SIZE);

        // Draw number (skip if value is 0, or if scrambling)
        if (cell.value !== 0 && !this.isScrambling) {
          this.ctx.fillStyle = '#333';
          this.ctx.font = '20px Arial';
          this.ctx.textAlign = 'center';
          this.ctx.fillText(
            cell.value.toString(),
            x * this.CELL_SIZE + this.CELL_SIZE / 2,
            y * this.CELL_SIZE + this.CELL_SIZE / 2 + 7
          );
        }
      }
    }
  }

  private drawScrambleAnimation() {
    const progress = Math.min(this.scrambleTimer / this.SCRAMBLE_ANIMATION_DURATION, 1); // Animation duration

    for (const anim of this.scrambleAnimation) {
      // Interpolate position
      const currentX = anim.oldPos.x + (anim.newPos.x - anim.oldPos.x) * progress;
      const currentY = anim.oldPos.y + (anim.newPos.y - anim.oldPos.y) * progress;

      // Draw flying number
      this.ctx.fillStyle = '#333';
      this.ctx.font = '20px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(anim.value.toString(), currentX, currentY + 7);
    }
  }

  private drawSelection() {
    const startX = Math.min(this.selectionStart.x, this.selectionEnd.x);
    const startY = Math.min(this.selectionStart.y, this.selectionEnd.y);
    const endX = Math.max(this.selectionStart.x, this.selectionEnd.x);
    const endY = Math.max(this.selectionStart.y, this.selectionEnd.y);

    this.ctx.fillStyle = 'rgba(76, 175, 80, 0.3)';
    this.ctx.fillRect(
      startX * this.CELL_SIZE,
      startY * this.CELL_SIZE,
      (endX - startX + 1) * this.CELL_SIZE,
      (endY - startY + 1) * this.CELL_SIZE
    );

    this.ctx.strokeStyle = '#4CAF50';
    this.ctx.lineWidth = 3;
    this.ctx.strokeRect(
      startX * this.CELL_SIZE,
      startY * this.CELL_SIZE,
      (endX - startX + 1) * this.CELL_SIZE,
      (endY - startY + 1) * this.CELL_SIZE
    );
  }

  private drawUI() {
    // Draw characters at bottom
    this.drawCharacter(
      50,
      this.CANVAS_SIZE + 50,
      'Player',
      this.playerHealth,
      this.MAX_HEALTH,
      '#4CAF50'
    );
    this.drawCharacter(
      this.CANVAS_SIZE - 50,
      this.CANVAS_SIZE + 50,
      'Enemy',
      this.enemyHealth,
      this.ENEMY_MAX_HEALTH,
      '#f44336'
    );

    // Draw buttons
    if (this.scramblesRemaining > 0 && !this.isScrambling) {
      this.drawButton(
        'Scramble',
        this.PLAYING_SCRAMBLE_BUTTON.x,
        this.PLAYING_SCRAMBLE_BUTTON.y,
        this.PLAYING_SCRAMBLE_BUTTON.width,
        this.PLAYING_SCRAMBLE_BUTTON.height,
        '#FF9800',
        '#F57C00'
      );
    } else if (this.isScrambling) {
      this.drawButton(
        'Scrambling...',
        this.PLAYING_SCRAMBLE_BUTTON.x,
        this.PLAYING_SCRAMBLE_BUTTON.y,
        this.PLAYING_SCRAMBLE_BUTTON.width,
        this.PLAYING_SCRAMBLE_BUTTON.height,
        '#757575',
        '#616161'
      );
    }

    // Draw target below scramble button
    this.ctx.fillStyle = '#333';
    this.ctx.font = '18px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(`Target: ${this.targetNumber}`, this.CANVAS_SIZE / 2, this.CANVAS_SIZE + 75);

    // Draw level and scramble info on same line
    this.ctx.font = '14px Arial';
    this.ctx.fillText(
      `Level: ${this.level} | Scrambles: ${this.scramblesRemaining}`,
      this.CANVAS_SIZE / 2,
      this.CANVAS_SIZE + 95
    );
  }

  private drawCharacter(
    x: number,
    y: number,
    label: string,
    health: number,
    maxHealth: number,
    color: string
  ) {
    // Draw player with sprite animation if sprite is loaded, otherwise draw rectangle
    if (label === 'Player') {
      const frameWidth = this.SPRITE_FRAME_WIDTH;
      const frameHeight = this.SPRITE_FRAME_HEIGHT;
      const scaledWidth = frameWidth * this.SPRITE_SCALE;
      const scaledHeight = frameHeight * this.SPRITE_SCALE;

      // Check if attacking and attack sprites are loaded
      if (this.isAttacking && this.loadedAssets['attackSprites']) {
        const attackSprite =
          this.currentAttackSprite === 1 ? this.attackSprite1 : this.attackSprite2;
        if (attackSprite && attackSprite.complete) {
          this.ctx.drawImage(
            attackSprite,
            this.attackAnimationFrame * frameWidth, // source x
            0, // source y
            frameWidth, // source width
            frameHeight, // source height
            x - scaledWidth / 2, // destination x (centered)
            y - scaledHeight / 2, // destination y (centered)
            scaledWidth, // destination width
            scaledHeight // destination height
          );
        } else {
          // Fallback to rectangle if attack sprite not available
          this.ctx.fillStyle = color;
          this.ctx.fillRect(
            x - this.CHARACTER_SIZE / 2,
            y - this.CHARACTER_SIZE / 2,
            this.CHARACTER_SIZE,
            this.CHARACTER_SIZE
          );
        }
      } else if (this.playerSprite && this.playerSprite.complete) {
        // Draw idle animation
        this.ctx.drawImage(
          this.playerSprite,
          this.animationFrame * frameWidth, // source x
          0, // source y (idle animation is at top)
          frameWidth, // source width
          frameHeight, // source height
          x - scaledWidth / 2, // destination x (centered)
          y - scaledHeight / 2, // destination y (centered)
          scaledWidth, // destination width
          scaledHeight // destination height
        );
      } else {
        // Fallback to rectangle if no sprites available
        this.ctx.fillStyle = color;
        this.ctx.fillRect(
          x - this.CHARACTER_SIZE / 2,
          y - this.CHARACTER_SIZE / 2,
          this.CHARACTER_SIZE,
          this.CHARACTER_SIZE
        );
      }
    } else {
      // Draw enemy with sprite animation if sprite is loaded, otherwise draw rectangle
      const frameWidth = this.SPRITE_FRAME_WIDTH;
      const frameHeight = this.SPRITE_FRAME_HEIGHT;
      const scaledWidth = frameWidth * this.SPRITE_SCALE;
      const scaledHeight = frameHeight * this.SPRITE_SCALE;

      // Check if enemy is attacking and attack sprite is loaded
      if (this.isEnemyAttacking && this.loadedAssets['enemyAttackSprite']) {
        if (this.enemyAttackSprite && this.enemyAttackSprite.complete) {
          // Save context for flipping
          this.ctx.save();

          // Flip horizontally for enemy (faces left)
          this.ctx.scale(-1, 1);
          this.ctx.drawImage(
            this.enemyAttackSprite,
            this.enemyAttackAnimationFrame * frameWidth, // source x
            0, // source y
            frameWidth, // source width
            frameHeight, // source height
            -x - scaledWidth / 2, // destination x (flipped, so negate x and adjust)
            y - scaledHeight / 2, // destination y (centered)
            scaledWidth, // destination width
            scaledHeight // destination height
          );

          // Restore context
          this.ctx.restore();
        } else {
          // Fallback to rectangle if attack sprite not available
          this.ctx.fillStyle = color;
          this.ctx.fillRect(
            x - this.CHARACTER_SIZE / 2,
            y - this.CHARACTER_SIZE / 2,
            this.CHARACTER_SIZE,
            this.CHARACTER_SIZE
          );
        }
      } else if (this.enemySprite && this.enemySprite.complete) {
        // Save context for flipping
        this.ctx.save();

        // Flip horizontally for enemy (faces left)
        this.ctx.scale(-1, 1);
        this.ctx.drawImage(
          this.enemySprite,
          this.enemyAnimationFrame * frameWidth, // source x
          0, // source y (idle animation is at top)
          frameWidth, // source width
          frameHeight, // source height
          -x - scaledWidth / 2, // destination x (flipped, so negate x and adjust)
          y - scaledHeight / 2, // destination y (centered)
          scaledWidth, // destination width
          scaledHeight // destination height
        );

        // Restore context
        this.ctx.restore();
      } else {
        // Fallback to rectangle if no sprites available
        this.ctx.fillStyle = color;
        this.ctx.fillRect(
          x - this.CHARACTER_SIZE / 2,
          y - this.CHARACTER_SIZE / 2,
          this.CHARACTER_SIZE,
          this.CHARACTER_SIZE
        );
      }
    }

    // Health bar
    this.ctx.fillStyle = '#333';
    this.ctx.fillRect(x - this.HEALTH_BAR_WIDTH / 2, y - 25, this.HEALTH_BAR_WIDTH, 5);
    this.ctx.fillStyle = color;
    this.ctx.fillRect(
      x - this.HEALTH_BAR_WIDTH / 2,
      y - 25,
      (health / maxHealth) * this.HEALTH_BAR_WIDTH,
      5
    );

    // Label
    this.ctx.fillStyle = '#333';
    this.ctx.font = '12px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(label, x, y + 25);
  }

  @HostListener('mousedown', ['$event'])
  onMouseDown(event: MouseEvent) {
    const rect = this.canvas.nativeElement.getBoundingClientRect();
    // Adjust click coordinates for canvas scaling
    const x = (event.clientX - rect.left) / this.canvasScale;
    const y = (event.clientY - rect.top) / this.canvasScale;

    switch (this.currentState) {
      case GameState.MENU:
        this.handleMenuClick(x, y);
        break;
      case GameState.PLAYING:
        this.handleGameClick(x, y);
        break;
      case GameState.OPTIONS:
        this.handleOptionsClick(x, y);
        break;
      case GameState.GAME_OVER:
        this.handleGameOverClick(x, y);
        break;
      case GameState.CHOOSE_UPGRADE:
        this.handleChooseUpgradeClick(x, y);
        break;
      case GameState.LEADERBOARD:
        this.handleLeaderboardClick(x, y);
        break;
      case GameState.LEADERBOARD_NAME_INPUT:
        this.handleLeaderboardNameInputClick(x, y);
        break;
    }
  }

  @HostListener('keydown', ['$event'])
  onKeyDown(event: KeyboardEvent) {
    if (this.currentState === GameState.LEADERBOARD_NAME_INPUT) {
      this.handleLeaderboardNameInputKey(event);
    }
  }

  private handleMenuClick(x: number, y: number) {
    // Play button
    if (
      this.isClickInButton(
        x,
        y,
        this.MENU_PLAY_BUTTON.x,
        this.MENU_PLAY_BUTTON.y,
        this.MENU_PLAY_BUTTON.width,
        this.MENU_PLAY_BUTTON.height
      )
    ) {
      this.playButtonSound();
      this.startGame();
    }
    // Options button
    else if (
      this.isClickInButton(
        x,
        y,
        this.MENU_OPTIONS_BUTTON.x,
        this.MENU_OPTIONS_BUTTON.y,
        this.MENU_OPTIONS_BUTTON.width,
        this.MENU_OPTIONS_BUTTON.height
      )
    ) {
      this.playButtonSound();
      this.currentState = GameState.OPTIONS;
    }
    // Leaderboard button
    else if (
      this.isClickInButton(
        x,
        y,
        this.MENU_LEADERBOARD_BUTTON.x,
        this.MENU_LEADERBOARD_BUTTON.y,
        this.MENU_LEADERBOARD_BUTTON.width,
        this.MENU_LEADERBOARD_BUTTON.height
      )
    ) {
      this.playButtonSound();
      this.currentState = GameState.LEADERBOARD;
      this.loadLeaderboard();
    }
  }

  private handleGameClick(x: number, y: number) {
    // Don't allow interactions during scrambling
    if (this.isScrambling) {
      return;
    }

    // Check if scramble button was clicked
    if (
      this.scramblesRemaining > 0 &&
      !this.isScrambling &&
      this.isClickInButton(
        x,
        y,
        this.PLAYING_SCRAMBLE_BUTTON.x,
        this.PLAYING_SCRAMBLE_BUTTON.y,
        this.PLAYING_SCRAMBLE_BUTTON.width,
        this.PLAYING_SCRAMBLE_BUTTON.height
      )
    ) {
      this.scrambleBoard();
      return;
    }

    const gridX = Math.floor(x / this.CELL_SIZE);
    const gridY = Math.floor(y / this.CELL_SIZE);

    if (gridX >= 0 && gridX < this.GRID_SIZE && gridY >= 0 && gridY < this.GRID_SIZE) {
      this.isSelecting = true;
      this.selectionStart = { x: gridX, y: gridY };
      this.selectionEnd = { x: gridX, y: gridY };
      this.updateSelection();
    }
  }

  private handleOptionsClick(x: number, y: number) {
    // BGM slider
    if (this.isClickInSlider(x, y, this.CANVAS_SIZE / 2, 120, 200, 20)) {
      this.isDraggingBGM = true;
      const sliderX = this.CANVAS_SIZE / 2 - 100;
      const relativeX = x - sliderX;
      this.settings.bgmVolume = Math.max(0, Math.min(1, relativeX / 200));
      this.updateBGMVolume();
    }
    // SFX slider
    else if (this.isClickInSlider(x, y, this.CANVAS_SIZE / 2, 180, 200, 20)) {
      this.isDraggingSFX = true;
      const sliderX = this.CANVAS_SIZE / 2 - 100;
      const relativeX = x - sliderX;
      this.settings.sfxVolume = Math.max(0, Math.min(1, relativeX / 200));
      this.updateSFXVolume();
    }
    // Difficulty buttons
    else if (
      this.isClickInButton(
        x,
        y,
        this.OPTIONS_EASY_BUTTON.x,
        this.OPTIONS_EASY_BUTTON.y,
        this.OPTIONS_EASY_BUTTON.width,
        this.OPTIONS_EASY_BUTTON.height
      )
    ) {
      this.playButtonSound();
      this.settings.difficulty = 'easy';
    } else if (
      this.isClickInButton(
        x,
        y,
        this.OPTIONS_NORMAL_BUTTON.x,
        this.OPTIONS_NORMAL_BUTTON.y,
        this.OPTIONS_NORMAL_BUTTON.width,
        this.OPTIONS_NORMAL_BUTTON.height
      )
    ) {
      this.playButtonSound();
      this.settings.difficulty = 'normal';
    } else if (
      this.isClickInButton(
        x,
        y,
        this.OPTIONS_HARD_BUTTON.x,
        this.OPTIONS_HARD_BUTTON.y,
        this.OPTIONS_HARD_BUTTON.width,
        this.OPTIONS_HARD_BUTTON.height
      )
    ) {
      this.playButtonSound();
      this.settings.difficulty = 'hard';
    }
    // Back button
    else if (
      this.isClickInButton(
        x,
        y,
        this.OPTIONS_BACK_BUTTON.x,
        this.OPTIONS_BACK_BUTTON.y,
        this.OPTIONS_BACK_BUTTON.width,
        this.OPTIONS_BACK_BUTTON.height
      )
    ) {
      this.playButtonSound();
      this.currentState = GameState.MENU;
    }
  }

  private handleGameOverClick(x: number, y: number) {
    // Play again button
    if (
      this.isClickInButton(
        x,
        y,
        this.GAME_OVER_PLAY_AGAIN_BUTTON.x,
        this.GAME_OVER_PLAY_AGAIN_BUTTON.y,
        this.GAME_OVER_PLAY_AGAIN_BUTTON.width,
        this.GAME_OVER_PLAY_AGAIN_BUTTON.height
      )
    ) {
      this.playButtonSound();
      this.startGame();
    }
    // Main menu button
    else if (
      this.isClickInButton(
        x,
        y,
        this.GAME_OVER_MAIN_MENU_BUTTON.x,
        this.GAME_OVER_MAIN_MENU_BUTTON.y,
        this.GAME_OVER_MAIN_MENU_BUTTON.width,
        this.GAME_OVER_MAIN_MENU_BUTTON.height
      )
    ) {
      this.playButtonSound();
      this.currentState = GameState.MENU;
    }
  }

  private handleChooseUpgradeClick(x: number, y: number) {
    // Health upgrade button
    if (
      this.isClickInButton(
        x,
        y,
        this.CHOOSE_UPGRADE_HEALTH_BUTTON.x,
        this.CHOOSE_UPGRADE_HEALTH_BUTTON.y,
        this.CHOOSE_UPGRADE_HEALTH_BUTTON.width,
        this.CHOOSE_UPGRADE_HEALTH_BUTTON.height
      )
    ) {
      this.playButtonSound();
      // Health upgrade with diminishing returns
      this.healthUpgradeCount++;
      const baseMultiplier = 1.15; // 15% base increase
      const diminishingFactor = 0.01; // 1% reduction per upgrade (slower)
      const minMultiplier = 1.05; // 5% minimum increase
      const effectiveMultiplier = Math.max(
        minMultiplier,
        baseMultiplier * (1 - diminishingFactor * (this.healthUpgradeCount - 1))
      );
      this.playerHealth = Math.floor(this.playerHealth * effectiveMultiplier);
      this.nextLevel();
    }
    // Damage upgrade button
    else if (
      this.isClickInButton(
        x,
        y,
        this.CHOOSE_UPGRADE_DAMAGE_BUTTON.x,
        this.CHOOSE_UPGRADE_DAMAGE_BUTTON.y,
        this.CHOOSE_UPGRADE_DAMAGE_BUTTON.width,
        this.CHOOSE_UPGRADE_DAMAGE_BUTTON.height
      )
    ) {
      this.playButtonSound();
      // Damage upgrade with diminishing returns
      this.damageUpgradeCount++;
      const baseMultiplier = 1.15; // 15% base increase
      const diminishingFactor = 0.01; // 1% reduction per upgrade (slower)
      const minMultiplier = 1.05; // 5% minimum increase
      const effectiveMultiplier = Math.max(
        minMultiplier,
        baseMultiplier * (1 - diminishingFactor * (this.damageUpgradeCount - 1))
      );
      this.damageMultiplier *= effectiveMultiplier;
      this.nextLevel();
    }
  }

  private isClickInButton(
    clickX: number,
    clickY: number,
    buttonX: number,
    buttonY: number,
    buttonWidth: number,
    buttonHeight: number
  ): boolean {
    return (
      clickX >= buttonX - buttonWidth / 2 &&
      clickX <= buttonX + buttonWidth / 2 &&
      clickY >= buttonY - buttonHeight / 2 &&
      clickY <= buttonY + buttonHeight / 2
    );
  }

  private isClickInSlider(
    clickX: number,
    clickY: number,
    sliderX: number,
    sliderY: number,
    sliderWidth: number,
    sliderHeight: number
  ): boolean {
    return (
      clickX >= sliderX - sliderWidth / 2 &&
      clickX <= sliderX + sliderWidth / 2 &&
      clickY >= sliderY - sliderHeight / 2 - 10 && // Extra padding for handle
      clickY <= sliderY + sliderHeight / 2 + 10
    );
  }

  @HostListener('mousemove', ['$event'])
  onMouseMove(event: MouseEvent) {
    const rect = this.canvas.nativeElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Handle slider dragging in options menu
    if (this.currentState === GameState.OPTIONS) {
      if (this.isDraggingBGM) {
        const sliderX = this.CANVAS_SIZE / 2 - 100;
        const relativeX = x - sliderX;
        this.settings.bgmVolume = Math.max(0, Math.min(1, relativeX / 200));
        this.updateBGMVolume();
      } else if (this.isDraggingSFX) {
        const sliderX = this.CANVAS_SIZE / 2 - 100;
        const relativeX = x - sliderX;
        this.settings.sfxVolume = Math.max(0, Math.min(1, relativeX / 200));
        this.updateSFXVolume();
      }
      return;
    }

    // Handle grid selection in playing state
    if (this.currentState !== GameState.PLAYING || !this.isSelecting) return;

    const gridX = Math.floor(x / this.CELL_SIZE);
    const gridY = Math.floor(y / this.CELL_SIZE);

    if (gridX >= 0 && gridX < this.GRID_SIZE && gridY >= 0 && gridY < this.GRID_SIZE) {
      this.selectionEnd = { x: gridX, y: gridY };
      this.updateSelection();
    }
  }

  @HostListener('mouseup', ['$event'])
  onMouseUp(event: MouseEvent) {
    // Stop slider dragging and play test sound for SFX slider
    const wasDraggingSFX = this.isDraggingSFX;
    this.isDraggingBGM = false;
    this.isDraggingSFX = false;

    // Play test sound when SFX slider is released
    if (wasDraggingSFX && this.playerAttackSound1) {
      this.playerAttackSound1.currentTime = 0; // Reset to beginning
      this.playerAttackSound1.volume = this.settings.sfxVolume;
      this.playerAttackSound1.play().catch(() => {}); // Ignore play errors
    }

    if (this.currentState !== GameState.PLAYING) return;
    if (!this.isSelecting) return;

    this.isSelecting = false;

    // Check if selection matches target
    if (this.selectedSum === this.targetNumber) {
      this.processMatch();
    } else {
      // Clear selection
      this.clearSelection();
    }
  }

  @HostListener('touchstart', ['$event'])
  onTouchStart(event: TouchEvent) {
    if (event.touches.length === 0) return;

    const touch = event.touches[0];
    const rect = this.canvas.nativeElement.getBoundingClientRect();
    // Adjust touch coordinates for canvas scaling
    const x = (touch.clientX - rect.left) / this.canvasScale;
    const y = (touch.clientY - rect.top) / this.canvasScale;

    // Only prevent default if touch is on the canvas (not on buttons)
    if (
      x >= 0 &&
      x <= this.CANVAS_SIZE &&
      y >= 0 &&
      y <= this.CANVAS_SIZE + this.CANVAS_UI_HEIGHT
    ) {
      event.preventDefault(); // Prevent scrolling only when touching canvas
    }

    switch (this.currentState) {
      case GameState.MENU:
        this.handleMenuClick(x, y);
        break;
      case GameState.PLAYING:
        this.handleGameClick(x, y);
        break;
      case GameState.OPTIONS:
        this.handleOptionsClick(x, y);
        break;
      case GameState.GAME_OVER:
        this.handleGameOverClick(x, y);
        break;
      case GameState.CHOOSE_UPGRADE:
        this.handleChooseUpgradeClick(x, y);
        break;
      case GameState.LEADERBOARD:
        this.handleLeaderboardClick(x, y);
        break;
      case GameState.LEADERBOARD_NAME_INPUT:
        this.handleLeaderboardNameInputClick(x, y);
        break;
    }
  }

  @HostListener('touchmove', ['$event'])
  onTouchMove(event: TouchEvent) {
    if (event.touches.length === 0) return;

    const touch = event.touches[0];
    const rect = this.canvas.nativeElement.getBoundingClientRect();
    // Adjust touch coordinates for canvas scaling
    const x = (touch.clientX - rect.left) / this.canvasScale;
    const y = (touch.clientY - rect.top) / this.canvasScale;

    // Only prevent default if touch is on the canvas
    if (
      x >= 0 &&
      x <= this.CANVAS_SIZE &&
      y >= 0 &&
      y <= this.CANVAS_SIZE + this.CANVAS_UI_HEIGHT
    ) {
      event.preventDefault(); // Prevent scrolling only when touching canvas
    }

    // Handle slider dragging in options menu
    if (this.currentState === GameState.OPTIONS) {
      if (this.isDraggingBGM) {
        const sliderX = this.CANVAS_SIZE / 2 - 100;
        const relativeX = x - sliderX;
        this.settings.bgmVolume = Math.max(0, Math.min(1, relativeX / 200));
        this.updateBGMVolume();
      } else if (this.isDraggingSFX) {
        const sliderX = this.CANVAS_SIZE / 2 - 100;
        const relativeX = x - sliderX;
        this.settings.sfxVolume = Math.max(0, Math.min(1, relativeX / 200));
        this.updateSFXVolume();
      }
      return;
    }

    // Handle grid selection in playing state
    if (this.currentState !== GameState.PLAYING || !this.isSelecting) return;

    const gridX = Math.floor(x / this.CELL_SIZE);
    const gridY = Math.floor(y / this.CELL_SIZE);

    if (gridX >= 0 && gridX < this.GRID_SIZE && gridY >= 0 && gridY < this.GRID_SIZE) {
      this.selectionEnd = { x: gridX, y: gridY };
      this.updateSelection();
    }
  }

  @HostListener('touchend', ['$event'])
  onTouchEnd(event: TouchEvent) {
    // Stop slider dragging and play test sound for SFX slider
    const wasDraggingSFX = this.isDraggingSFX;
    this.isDraggingBGM = false;
    this.isDraggingSFX = false;

    // Play test sound when SFX slider is released
    if (wasDraggingSFX && this.playerAttackSound1) {
      this.playerAttackSound1.currentTime = 0; // Reset to beginning
      this.playerAttackSound1.volume = this.settings.sfxVolume;
      this.playerAttackSound1.play().catch(() => {}); // Ignore play errors
    }

    if (this.currentState !== GameState.PLAYING) return;
    if (!this.isSelecting) return;

    this.isSelecting = false;

    // Check if selection matches target
    if (this.selectedSum === this.targetNumber) {
      this.processMatch();
    } else {
      // Clear selection
      this.clearSelection();
    }
  }

  private startGame() {
    // Reset game state
    this.score = 0;
    this.level = 1;
    this.targetNumber = 10; // Reset target to initial value
    this.playerHealth = this.MAX_HEALTH;
    this.enemyHealth = this.ENEMY_MAX_HEALTH; // Set to enemy max health
    this.enemyAttackTimer = 0;
    this.scramblesRemaining = this.SCRAMBLES_PER_LEVEL; // Reset scrambles
    this.isScrambling = false;
    this.scrambleTimer = 0;
    this.damageMultiplier = 1.0; // Reset damage multiplier
    this.damageUpgradeCount = 0; // Reset damage upgrade counter
    this.healthUpgradeCount = 0; // Reset health upgrade counter
    this.nextAttackSprite = 1; // Reset attack alternation
    this.clearSelection();
    this.createGrid();

    // Apply difficulty settings
    this.applyDifficultySettings();

    // Update audio volumes
    this.updateBGMVolume();
    this.updateSFXVolume();

    // Start BGM when game begins (if not already playing)
    if (this.bgmAudio && this.bgmAudio.paused) {
      this.startBGM();
    }

    // Start playing
    this.currentState = GameState.PLAYING;
  }

  private applyDifficultySettings() {
    switch (this.settings.difficulty) {
      case 'easy':
        this.playerHealth = this.EASY_HEALTH; // More health
        break;
      case 'normal':
        this.playerHealth = this.MAX_HEALTH; // Default
        break;
      case 'hard':
        this.playerHealth = this.HARD_HEALTH; // Less health
        break;
    }
  }

  private getDifficultyMultiplier(): number {
    switch (this.settings.difficulty) {
      case 'easy':
        return 0.75;
      case 'normal':
        return 1.0;
      case 'hard':
        return 1.25;
      default:
        return 1.0; // Default to normal
    }
  }

  private updateSelection() {
    // Clear previous selection
    this.clearSelection();

    const startX = Math.min(this.selectionStart.x, this.selectionEnd.x);
    const startY = Math.min(this.selectionStart.y, this.selectionEnd.y);
    const endX = Math.max(this.selectionStart.x, this.selectionEnd.x);
    const endY = Math.max(this.selectionStart.y, this.selectionEnd.y);

    this.selectedSum = 0;

    for (let y = startY; y <= endY; y++) {
      for (let x = startX; x <= endX; x++) {
        this.grid[y][x].selected = true;
        this.selectedSum += this.grid[y][x].value;
      }
    }
  }

  private clearSelection() {
    for (let y = 0; y < this.GRID_SIZE; y++) {
      for (let x = 0; x < this.GRID_SIZE; x++) {
        this.grid[y][x].selected = false;
      }
    }
    this.selectedSum = 0;
  }

  scrambleBoard() {
    if (
      this.currentState !== GameState.PLAYING ||
      this.isScrambling ||
      this.scramblesRemaining <= 0
    ) {
      return;
    }

    // Play scramble sound effect
    if (this.scrambleSound && this.windowHasFocus && !this.settings.muted) {
      this.scrambleSound.currentTime = 0; // Reset to beginning
      this.scrambleSound.play().catch(() => {}); // Ignore play errors
    }

    this.isScrambling = true;
    this.scrambleTimer = 0;
    this.scramblesRemaining--;

    // Collect all non-zero cells with their positions
    const originalCells: { x: number; y: number; value: number }[] = [];
    for (let y = 0; y < this.GRID_SIZE; y++) {
      for (let x = 0; x < this.GRID_SIZE; x++) {
        if (this.grid[y][x].value !== 0) {
          originalCells.push({ x, y, value: this.grid[y][x].value });
        }
      }
    }

    // Create shuffled assignment: each position gets a value from originalCells
    const shuffledIndices: number[] = [];
    for (let i = 0; i < originalCells.length; i++) {
      shuffledIndices.push(i);
    }
    for (let i = shuffledIndices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledIndices[i], shuffledIndices[j]] = [shuffledIndices[j], shuffledIndices[i]];
    }

    // Create animation data
    this.scrambleAnimation = [];
    let cellIndex = 0;
    for (let y = 0; y < this.GRID_SIZE; y++) {
      for (let x = 0; x < this.GRID_SIZE; x++) {
        if (this.grid[y][x].value !== 0) {
          // This grid position gets the value from originalCells[shuffledIndices[cellIndex]]
          const sourceCell = originalCells[shuffledIndices[cellIndex]];

          this.scrambleAnimation.push({
            oldPos: {
              x: sourceCell.x * this.CELL_SIZE + this.CELL_SIZE / 2,
              y: sourceCell.y * this.CELL_SIZE + this.CELL_SIZE / 2,
            },
            newPos: {
              x: x * this.CELL_SIZE + this.CELL_SIZE / 2,
              y: y * this.CELL_SIZE + this.CELL_SIZE / 2,
            },
            value: sourceCell.value,
          });

          this.grid[y][x].value = sourceCell.value;
          cellIndex++;
        }
      }
    }
  }

  private finishScrambling() {
    this.isScrambling = false;
    this.scrambleTimer = 0;
    this.scrambleAnimation = [];
  }

  private processMatch() {
    // Calculate proper bounds (same as updateSelection)
    const startX = Math.min(this.selectionStart.x, this.selectionEnd.x);
    const startY = Math.min(this.selectionStart.y, this.selectionEnd.y);
    const endX = Math.max(this.selectionStart.x, this.selectionEnd.x);
    const endY = Math.max(this.selectionStart.y, this.selectionEnd.y);

    // Count tiles with values using correct bounds
    let tilesWithValues = 0;
    for (let y = startY; y <= endY; y++) {
      for (let x = startX; x <= endX; x++) {
        if (this.grid[y][x].value !== 0) {
          tilesWithValues++;
        }
      }
    }

    // Mark cells for removal using correct bounds
    for (let y = startY; y <= endY; y++) {
      for (let x = startX; x <= endX; x++) {
        this.grid[y][x].value = 0; // Mark for removal
      }
    }

    // Calculate score earned from this match
    const scoreEarned = tilesWithValues * this.POINTS_PER_TILE * this.damageMultiplier;

    // Update total score
    this.score += scoreEarned;

    // Deal damage to enemy proportional to score earned
    const damageDealt = tilesWithValues * this.POINTS_PER_TILE * this.damageMultiplier;
    this.enemyHealth = Math.max(0, this.enemyHealth - damageDealt);

    // Trigger attack animation
    this.triggerAttackAnimation();

    // Clear selection
    this.clearSelection();
  }

  private triggerAttackAnimation() {
    if (this.loadedAssets['attackSprites'] && !this.isAttacking) {
      this.isAttacking = true;
      this.attackAnimationFrame = 0;
      this.attackAnimationTimer = 0;
      // Alternate between attack 1 and 2
      this.currentAttackSprite = this.nextAttackSprite;
      this.nextAttackSprite = this.nextAttackSprite === 1 ? 2 : 1;

      // Play attack sound effect
      if (
        this.settings.sfxVolume > 0 &&
        this.loadedAssets['soundEffects'] &&
        this.windowHasFocus &&
        !this.settings.muted
      ) {
        if (this.currentAttackSprite === 1 && this.playerAttackSound1) {
          this.playerAttackSound1.currentTime = 0; // Reset to beginning
          this.playerAttackSound1.play().catch(() => {}); // Ignore play errors
        } else if (this.currentAttackSprite === 2 && this.playerAttackSound2) {
          this.playerAttackSound2.currentTime = 0; // Reset to beginning
          this.playerAttackSound2.play().catch(() => {}); // Ignore play errors
        }
      }
    }
  }

  private gameOver() {
    // Reset game
    this.score = 0;
    this.lastHealthBonus = 0;
    this.level = 1;
    this.targetNumber = 10; // Reset target to initial value
    this.playerHealth = this.MAX_HEALTH;
    this.enemyHealth = this.ENEMY_MAX_HEALTH; // Set to enemy max health
    this.scramblesRemaining = this.SCRAMBLES_PER_LEVEL; // Reset scrambles
    this.isScrambling = false;
    this.scrambleTimer = 0;
    this.scrambleAnimation = [];
    this.damageMultiplier = 1.0; // Reset damage multiplier
    this.createGrid();
  }

  private calculateNextTarget(): number {
    const nextLevel = this.level + 1;
    return (
      this.TARGET_BASE +
      nextLevel +
      (Math.floor(Math.random() * (this.TARGET_RANDOM_MAX - this.TARGET_RANDOM_MIN + 1)) +
        this.TARGET_RANDOM_MIN)
    );
  }

  private nextLevel() {
    this.level++;
    this.enemyHealth = this.ENEMY_MAX_HEALTH; // Set to enemy max health
    this.targetNumber = this.nextTarget; // Use the pre-calculated next target
    this.scramblesRemaining = this.SCRAMBLES_PER_LEVEL; // Reset scrambles for new level
    this.nextAttackSprite = 1; // Reset attack alternation for new level

    // Reset player health to maximum for new level
    this.applyDifficultySettings();

    this.createGrid();
    this.currentState = GameState.PLAYING; // Return to playing after upgrade choice
  }

  restartGame() {
    this.gameOver();
    this.currentState = GameState.MENU;
  }

  toggleMute() {
    this.settings.muted = !this.settings.muted;
    this.updateBGMVolume();
    this.updateSFXVolume();
    this.cdr.markForCheck();
  }

  // Mobile input methods for virtual keyboard support
  getMobileInputPosition() {
    // Position the input off-screen to trigger virtual keyboard while canvas displays input
    return {
      left: -100,
      top: -100,
      width: 1,
      height: 1,
    };
  }

  onMobileInputChange(event: any) {
    // Update the canvas display when mobile input changes
    this.leaderboardNameInput = event.target.value;
  }

  onMobileInputFocus() {
    this.isLeaderboardInputFocused = true;
  }

  onMobileInputBlur() {
    this.isLeaderboardInputFocused = false;
  }
}
