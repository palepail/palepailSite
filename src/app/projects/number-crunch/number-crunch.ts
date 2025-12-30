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
}

interface GameSettings {
  bgmVolume: number; // 0.0 to 1.0
  sfxVolume: number; // 0.0 to 1.0
  difficulty: 'easy' | 'normal' | 'hard';
  muted: boolean;
}

@Component({
  selector: 'app-number-crunch',
  imports: [RouterLink, CommonModule],
  templateUrl: './number-crunch.html',
  styleUrl: './number-crunch.css',
})
export class NumberCrunch implements OnInit, OnDestroy {
  @ViewChild('gameCanvas', { static: true }) canvas!: ElementRef<HTMLCanvasElement>;
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
  private readonly PLAYER_ATTACK_DAMAGE = 10;

  // Scramble constants
  private readonly SCRAMBLES_PER_LEVEL = 3;
  private readonly SCRAMBLE_ANIMATION_DURATION = 2000; // milliseconds

  // Upgrade constants
  private readonly UPGRADE_MULTIPLIER = 1.15; // 15% increase

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

  // Game state
  grid: GameCell[][] = [];
  targetNumber = 10;
  score = 0;
  level = 1;
  playerHealth = this.MAX_HEALTH;
  enemyHealth = this.ENEMY_MAX_HEALTH; // Set to enemy max health
  timeLeft = 60; // seconds (placeholder, not used)
  nextTarget = 0; // Fixed next target for upgrade screen

  // Combat timers
  private enemyAttackTimer = 0;
  private playerAttackTimer = 0;

  // Upgrade system
  damageMultiplier = 1.0;

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

  // Sound effects
  private playerAttackSound1 = new Audio();
  private playerAttackSound2 = new Audio();
  private enemyAttackSound = new Audio();
  private bgmAudio = new Audio();

  // Asset loading system
  private assetsToLoad: { [key: string]: boolean } = {};
  private loadedAssets: { [key: string]: boolean } = {};
  private loadingProgress = 0;

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

  // Button positions and sizes (shared between drawing and click detection)
  private readonly MENU_PLAY_BUTTON = { x: this.CANVAS_SIZE / 2, y: 180, width: 200, height: 50 };
  private readonly MENU_OPTIONS_BUTTON = {
    x: this.CANVAS_SIZE / 2,
    y: 250,
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

  constructor(private cdr: ChangeDetectorRef) {}

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
    });
  }

  private loadBGM(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.bgmAudio.oncanplaythrough = () => {
        this.loadedAssets['bgm'] = true;
        this.updateLoadingProgress();
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

  private startBGM() {
    if (this.loadedAssets['bgm'] && this.bgmAudio) {
      this.updateBGMVolume();
      this.bgmAudio.currentTime = 0;
      this.bgmAudio.play().catch(() => {}); // Ignore play errors
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

  private updateSFXVolume() {
    const volume = this.settings.muted ? 0 : this.settings.sfxVolume;
    if (this.playerAttackSound1) this.playerAttackSound1.volume = volume;
    if (this.playerAttackSound2) this.playerAttackSound2.volume = volume;
    if (this.enemyAttackSound) this.enemyAttackSound.volume = volume;
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

  ngOnDestroy() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
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
    canvas.width = this.CANVAS_SIZE;
    canvas.height = this.CANVAS_SIZE + this.CANVAS_UI_HEIGHT; // Extra space for UI
    this.ctx = canvas.getContext('2d')!;
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
          this.enemyAttackSound
        ) {
          this.enemyAttackSound.currentTime = 0; // Reset to beginning
          this.enemyAttackSound.play().catch(() => {}); // Ignore play errors
        }
      }

      this.playerHealth = Math.max(0, this.playerHealth - this.ENEMY_ATTACK_DAMAGE);
    }

    // Check win/lose conditions
    if (this.playerHealth <= 0) {
      this.currentState = GameState.GAME_OVER;
      this.cdr.detectChanges(); // Force UI update to hide restart button immediately
    }
    if (this.enemyHealth <= 0) {
      this.nextTarget = this.calculateNextTarget(); // Calculate next target once
      this.currentState = GameState.CHOOSE_UPGRADE; // Go to upgrade choice instead of directly to next level
      this.cdr.detectChanges(); // Force UI update
    }
  }

  private render() {
    // Note: Each render method now sets its own background, so no global clear needed

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
    }
  }

  private renderGame() {
    // Background
    this.ctx.fillStyle = this.BACKGROUND_COLOR;
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
    this.ctx.fillText('Match numbers to defeat enemies!', this.CANVAS_SIZE / 2, 110);

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

    // Draw idle animations under the options button
    const characterY = this.MENU_OPTIONS_BUTTON.y + 80; // Position below the options button
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
      this.CANVAS_SIZE + 20
    );
    this.ctx.fillText(
      'Match the target sum to score points!',
      this.CANVAS_SIZE / 2,
      this.CANVAS_SIZE + 40
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

    // Final score
    this.ctx.fillStyle = '#c62828';
    this.ctx.font = '20px Arial';
    this.ctx.fillText(`Final Score: ${this.score}`, this.CANVAS_SIZE / 2, 200);
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

    // Draw buttons
    this.drawButton(
      'Health +15%',
      this.CHOOSE_UPGRADE_HEALTH_BUTTON.x,
      this.CHOOSE_UPGRADE_HEALTH_BUTTON.y,
      this.CHOOSE_UPGRADE_HEALTH_BUTTON.width,
      this.CHOOSE_UPGRADE_HEALTH_BUTTON.height,
      '#FF9800',
      '#F57C00'
    );
    this.drawButton(
      'Damage +15%',
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
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

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
      this.currentState = GameState.OPTIONS;
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
      this.playerHealth = Math.floor(this.playerHealth * this.UPGRADE_MULTIPLIER); // Health upgrade
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
      this.damageMultiplier *= this.UPGRADE_MULTIPLIER; // Damage upgrade
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
    this.nextAttackSprite = 1; // Reset attack alternation
    this.clearSelection();
    this.createGrid();

    // Apply difficulty settings
    this.applyDifficultySettings();

    // Update audio volumes
    this.updateBGMVolume();
    this.updateSFXVolume();

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
      if (this.settings.sfxVolume > 0 && this.loadedAssets['soundEffects']) {
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
}
