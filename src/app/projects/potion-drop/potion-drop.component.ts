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

interface Potion {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  type: number; // 0-10 (small potion to large potion)
  color: string;
  active: boolean;
}

enum GameState {
  LOADING = 'loading',
  MENU = 'menu',
  PLAYING = 'playing',
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
  selector: 'app-potion-drop',
  imports: [RouterLink, CommonModule, FormsModule],
  templateUrl: './potion-drop.component.html',
  styleUrl: './potion-drop.component.css',
})
export class PotionDropComponent implements OnInit, OnDestroy {
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
  private readonly CANVAS_SIZE = 400;
  private readonly CANVAS_UI_HEIGHT = 100;
  private canvasScale = 1;

  // Potion constants
  private readonly POTION_TYPES = 11;
  private readonly POTION_COLORS = [
    '#FF6B6B', // Small potion
    '#FF8E53', // Medium potion
    '#FFD93D', // Large potion
    '#6BCF7F', // Extra large potion
    '#4ECDC4', // Giant potion
    '#45B7D1', // Mega potion
    '#96CEB4', // Ultra potion
    '#FFEAA7', // Epic potion
    '#DDA0DD', // Legendary potion
    '#98D8C8', // Mythical potion
    '#F7DC6F', // Divine potion
  ];
  private readonly POTION_RADII = [8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48];
  private readonly GRAVITY = 0.3;
  private readonly BOUNCE_DAMPING = 0.7;
  private readonly COLLISION_BUFFER = 2.0; // Match the required separation

  // Container positioning
  private get containerBottom(): number {
    return 70 + (this.CANVAS_SIZE + this.CANVAS_UI_HEIGHT - 70 - 50);
  }

  // Game state
  potions: Potion[] = [];
  nextPotionType = 0;
  score = 0;
  gameOver = false;

  // Drop cooldown
  private lastDropTime = 0;
  private readonly DROP_COOLDOWN = 500; // 0.5 seconds in milliseconds

  // Game over detection
  private gameStartTime = 0;
  private gameOverWarningStartTime = 0;
  private showingGameOverTimer = false;

  // Mouse tracking
  mouseX = this.CANVAS_SIZE / 2; // Default to center
  private ignoreNextMouseUp = false; // Flag to ignore mouse up after starting game

  // Leaderboard
  leaderboardNameInput = '';
  private isLeaderboardInputFocused = false;
  private pendingLeaderboardScore = 0;

  // Button positions
  private readonly MENU_PLAY_BUTTON = { x: this.CANVAS_SIZE / 2, y: 180, width: 200, height: 50 };
  private readonly MENU_LEADERBOARD_BUTTON = {
    x: this.CANVAS_SIZE / 2,
    y: 250,
    width: 200,
    height: 50,
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

  // Animation
  private animationFrameId: number = 0;
  private lastTime = 0;

  constructor(private cdr: ChangeDetectorRef, private leaderboardService: LeaderboardService) {}

  ngOnInit() {
    this.initializeGame();
    this.startGameLoop();
  }

  ngOnDestroy() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
  }

  private initializeGame() {
    this.setupCanvas();
  }

  private setupCanvas() {
    const canvas = this.canvas.nativeElement;
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      const maxCanvasSize = Math.min(window.innerWidth - 32, this.CANVAS_SIZE);
      const scale = maxCanvasSize / this.CANVAS_SIZE;
      this.canvasScale = scale;
      canvas.width = maxCanvasSize;
      canvas.height = (this.CANVAS_SIZE + this.CANVAS_UI_HEIGHT) * scale;
      this.ctx = canvas.getContext('2d')!;
      this.ctx.scale(scale, scale);
    } else {
      this.canvasScale = 1;
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
    if (this.currentState !== GameState.PLAYING) return;

    // Update physics
    this.updatePhysics();

    // Check for merges
    this.checkMerges();

    // Check game over
    this.checkGameOver();

    // Next potion generation is handled in handleGameClick
  }

  private updatePhysics() {
    // console.log('updatePhysics called'); // Uncomment to verify physics updates
    for (const potion of this.potions) {
      if (!potion.active) continue;

      // Apply gravity
      potion.vy += this.GRAVITY;

      // Update position
      potion.x += potion.vx;
      potion.y += potion.vy;
    }

    // Check collisions between potions - multi-pass resolution for perfect rigidity
    let collisionsResolved = true;
    let maxIterations = 20; // Increased from 10 to allow more time for complex resolutions
    let iteration = 0;

    while (collisionsResolved && iteration < maxIterations) {
      collisionsResolved = false;
      iteration++;

      // Only log if there are actually collisions to resolve
      let hasCollisions = false;

      for (let i = 0; i < this.potions.length; i++) {
        for (let j = i + 1; j < this.potions.length; j++) {
          const potion1 = this.potions[i];
          const potion2 = this.potions[j];

          if (!potion1.active || !potion2.active) continue;

          const dx = potion2.x - potion1.x;
          const dy = potion2.y - potion1.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const minDistance = potion1.radius + potion2.radius;
          const collisionDistance = minDistance; // No buffer - detect actual overlaps only

          if (distance < collisionDistance) {
            // Hard collision detected - force separation with safety margin
            const requiredSeparation = minDistance + 2.0; // Ensure 2 units separation
            const overlap = requiredSeparation - distance;

            // Calculate masses (using radius² for 2D area-based mass)
            const mass1 = potion1.radius * potion1.radius;
            const mass2 = potion2.radius * potion2.radius;
            const totalMass = mass1 + mass2;

            // Mass-weighted separation - heavier potions move less
            const separation1Ratio = mass2 / totalMass;
            const separation2Ratio = mass1 / totalMass;

            const separationX1 = (dx / distance) * overlap * separation1Ratio;
            const separationY1 = (dy / distance) * overlap * separation1Ratio;
            const separationX2 = (dx / distance) * overlap * separation2Ratio;
            const separationY2 = (dy / distance) * overlap * separation2Ratio;

            potion1.x -= separationX1;
            potion1.y -= separationY1;
            potion2.x += separationX2;
            potion2.y += separationY2;

            // Apply boundary constraints immediately after collision resolution
            // to prevent potions from being pushed outside boundaries
            this.applyBoundaryConstraintsToPotion(potion1);
            this.applyBoundaryConstraintsToPotion(potion2);

            collisionsResolved = true; // Continue checking for more collisions

            hasCollisions = true;

            // Mass-weighted bounce physics (only on first collision detection)
            if (iteration === 1) {
              const relativeVx = potion2.vx - potion1.vx;
              const relativeVy = potion2.vy - potion1.vy;
              const normalX = dx / distance;
              const normalY = dy / distance;

              const velocityAlongNormal = relativeVx * normalX + relativeVy * normalY;

              if (velocityAlongNormal < 0) {
                // Calculate impulse with mass weighting and additional damping
                const impulse = (2 * velocityAlongNormal * this.BOUNCE_DAMPING) / totalMass;

                potion1.vx += impulse * mass2 * normalX * 0.8; // Additional damping
                potion1.vy += impulse * mass2 * normalY * 0.8;
                potion2.vx -= impulse * mass1 * normalX * 0.8;
                potion2.vy -= impulse * mass1 * normalY * 0.8;
              }
            }
          }
        }
      }

      if (hasCollisions) {
        // Removed debug logging
      }
    }

    // Final pass: Ensure no potions are overlapping (perfect rigidity)
    for (let i = 0; i < this.potions.length; i++) {
      for (let j = i + 1; j < this.potions.length; j++) {
        const potion1 = this.potions[i];
        const potion2 = this.potions[j];

        if (!potion1.active || !potion2.active) continue;

        const dx = potion2.x - potion1.x;
        const dy = potion2.y - potion1.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const minDistance = potion1.radius + potion2.radius;

        // Final hard check - ensure no potions are closer than minimum distance
        if (distance < minDistance) {
          const overlap = (minDistance + 2.0) - distance; // Force 2 units separation
          const separationX = (dx / distance) * (overlap / 2);
          const separationY = (dy / distance) * (overlap / 2);

          potion1.x -= separationX;
          potion1.y -= separationY;
          potion2.x += separationX;
          potion2.y += separationY;
        }
      }
    }

    // Apply boundary constraints again after collision resolution
    for (const potion of this.potions) {
      if (!potion.active) continue;

      // Bounce off container walls
      const containerWidth = 320;
      const containerX = (this.CANVAS_SIZE - containerWidth) / 2;
      const leftBoundary = containerX;
      const rightBoundary = containerX + containerWidth;

      if (potion.x - potion.radius < leftBoundary) {
        potion.x = leftBoundary + potion.radius;
        potion.vx = Math.abs(potion.vx) * this.BOUNCE_DAMPING; // Bounce right
      } else if (potion.x + potion.radius > rightBoundary) {
        potion.x = rightBoundary - potion.radius;
        potion.vx = -Math.abs(potion.vx) * this.BOUNCE_DAMPING; // Bounce left
      }

      // Gentle bounce at bottom (container bottom)
      const cauldronTop = this.containerBottom;
      if (potion.y + potion.radius > cauldronTop) {
        potion.y = cauldronTop - potion.radius;
        potion.vy *= -0.4; // Gentle bounce back with 40% velocity retention
        potion.vx *= 0.9; // Apply friction to horizontal movement
      }
    }

    // Apply settling to prevent jittery small movements
    this.applySettlingToPotions();
  }

  private applySettlingToPotions() {
    const SETTLING_THRESHOLD = 0.5; // Velocity magnitude threshold for settling
    const SETTLING_DAMPING = 0.85; // Damping factor for gradual velocity reduction
    const MIN_VELOCITY = 0.01; // Minimum velocity before completely stopping

    let settledCount = 0;

    for (const potion of this.potions) {
      if (!potion.active) continue;

      // Calculate velocity magnitude
      const velocityMagnitude = Math.sqrt(potion.vx * potion.vx + potion.vy * potion.vy);

      // Apply settling if velocity is below threshold
      if (velocityMagnitude < SETTLING_THRESHOLD) {
        // Apply exponential damping to gradually reduce velocity
        potion.vx *= SETTLING_DAMPING;
        potion.vy *= SETTLING_DAMPING;

        // Completely stop very small movements to prevent endless tiny oscillations
        if (Math.abs(potion.vx) < MIN_VELOCITY) {
          potion.vx = 0;
        }
        if (Math.abs(potion.vy) < MIN_VELOCITY) {
          potion.vy = 0;
        }

        settledCount++;
      }
    }

    // Log settling activity (only when potions are being settled)
    if (settledCount > 0) {
      console.log(`Settling applied to ${settledCount} potions`);
    }
  }

  private applyBoundaryConstraintsToPotion(potion: Potion) {
    // Bounce off container walls
    const containerWidth = 320;
    const containerX = (this.CANVAS_SIZE - containerWidth) / 2;
    const leftBoundary = containerX;
    const rightBoundary = containerX + containerWidth;

    if (potion.x - potion.radius < leftBoundary) {
      potion.x = leftBoundary + potion.radius;
      potion.vx = Math.abs(potion.vx) * this.BOUNCE_DAMPING; // Bounce right
    } else if (potion.x + potion.radius > rightBoundary) {
      potion.x = rightBoundary - potion.radius;
      potion.vx = -Math.abs(potion.vx) * this.BOUNCE_DAMPING; // Bounce left
    }

    // Gentle bounce at bottom (container bottom)
    const cauldronTop = this.containerBottom;
    if (potion.y + potion.radius > cauldronTop) {
      potion.y = cauldronTop - potion.radius;
      potion.vy *= -0.4; // Gentle bounce back with 40% velocity retention
      potion.vx *= 0.9; // Apply friction to horizontal movement
    }
  }

  private checkMerges() {
    for (let i = 0; i < this.potions.length; i++) {
      for (let j = i + 1; j < this.potions.length; j++) {
        const potion1 = this.potions[i];
        const potion2 = this.potions[j];

        if (!potion1.active || !potion2.active) continue;
        if (potion1.type !== potion2.type) continue;

        const dx = potion2.x - potion1.x;
        const dy = potion2.y - potion1.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < potion1.radius + potion2.radius + 2) {
          // Close enough to merge
          // Create new larger potion
          const newType = potion1.type + 1;
          if (newType < this.POTION_TYPES) {
            const newPotion: Potion = {
              x: (potion1.x + potion2.x) / 2,
              y: (potion1.y + potion2.y) / 2,
              vx: (potion1.vx + potion2.vx) / 2,
              vy: (potion1.vy + potion2.vy) / 2 - 2, // Slight upward boost
              radius: this.POTION_RADII[newType],
              type: newType,
              color: this.POTION_COLORS[newType],
              active: true,
            };

            // Remove old potions
            potion1.active = false;
            potion2.active = false;

            // Add new potion
            this.potions.push(newPotion);

            // Add score
            this.score += (newType + 1) * 10;
          }
        }
      }
    }

    // Remove inactive potions
    this.potions = this.potions.filter((potion) => potion.active);
  }

  private checkGameOver() {
    const currentTime = Date.now();

    // Don't check for game over until 0.5 seconds after game start
    if (currentTime - this.gameStartTime < 500) {
      return;
    }

    let potionAboveThreshold = false;
    for (const potion of this.potions) {
      if (potion.y - potion.radius < 50) {
        potionAboveThreshold = true;
        break;
      }
    }

    if (potionAboveThreshold) {
      // Start or continue the warning timer
      if (this.gameOverWarningStartTime === 0) {
        this.gameOverWarningStartTime = currentTime;
      }

      const timeSinceWarning = currentTime - this.gameOverWarningStartTime;

      // Show timer when 1 second remains (3 seconds into the 4-second countdown)
      if (timeSinceWarning >= 3000 && !this.showingGameOverTimer) {
        this.showingGameOverTimer = true;
      }

      // Game over after 4 seconds
      if (timeSinceWarning >= 4000) {
        this.gameOver = true;
        this.currentState = GameState.GAME_OVER;
        this.pendingLeaderboardScore = this.score;
        this.showingGameOverTimer = false;
      }
    } else {
      // Reset warning timer if no potions are above threshold
      this.gameOverWarningStartTime = 0;
      this.showingGameOverTimer = false;
    }
  }

  private render() {
    // Clear canvas
    this.ctx.fillStyle = '#f0f0f0';
    this.ctx.fillRect(0, 0, this.CANVAS_SIZE, this.CANVAS_SIZE + this.CANVAS_UI_HEIGHT);

    switch (this.currentState) {
      case GameState.MENU:
        this.renderMenu();
        break;
      case GameState.PLAYING:
        this.renderGame();
        break;
      case GameState.GAME_OVER:
        this.renderGameOver();
        break;
      case GameState.LEADERBOARD:
        this.renderLeaderboard();
        break;
      case GameState.LEADERBOARD_NAME_INPUT:
        this.renderLeaderboardNameInput();
        break;
    }
  }

  private renderMenu() {
    this.ctx.fillStyle = '#333';
    this.ctx.font = 'bold 32px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Potion Drop', this.CANVAS_SIZE / 2, 80);

    this.ctx.font = '18px Arial';
    this.ctx.fillStyle = '#666';
    this.ctx.fillText('Drop potions and watch them merge!', this.CANVAS_SIZE / 2, 125);

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
      'Leaderboard',
      this.MENU_LEADERBOARD_BUTTON.x,
      this.MENU_LEADERBOARD_BUTTON.y,
      this.MENU_LEADERBOARD_BUTTON.width,
      this.MENU_LEADERBOARD_BUTTON.height,
      '#FF9800',
      '#F57C00'
    );
  }

  private renderGame() {
    this.ctx.fillRect(0, 0, this.CANVAS_SIZE, this.CANVAS_SIZE + this.CANVAS_UI_HEIGHT);

    // Draw cauldron container
    this.drawCauldron();

    // Draw potions
    for (const potion of this.potions) {
      this.ctx.fillStyle = potion.color;
      this.ctx.beginPath();
      this.ctx.arc(potion.x, potion.y, potion.radius, 0, Math.PI * 2);
      this.ctx.fill();

      // Add border
      this.ctx.strokeStyle = '#333';
      this.ctx.lineWidth = 1;
      this.ctx.stroke();
    }

    // Draw mouse-following potion preview (always show next potion)
    if (this.currentState === GameState.PLAYING) {
      const containerWidth = 320;
      const containerX = (this.CANVAS_SIZE - containerWidth) / 2;
      const potionRadius = this.POTION_RADII[this.nextPotionType];
      const constrainedX = Math.max(
        containerX + potionRadius,
        Math.min(containerX + containerWidth - potionRadius, this.mouseX)
      );

      this.ctx.fillStyle = this.POTION_COLORS[this.nextPotionType];
      this.ctx.globalAlpha = 0.7; // Semi-transparent
      this.ctx.beginPath();
      this.ctx.arc(constrainedX, 50, potionRadius, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.strokeStyle = '#666';
      this.ctx.lineWidth = 2;
      this.ctx.stroke();
      this.ctx.globalAlpha = 1.0; // Reset alpha
    }

    // Draw game over warning timer
    if (this.showingGameOverTimer && this.gameOverWarningStartTime > 0) {
      const currentTime = Date.now();
      const timeSinceWarning = currentTime - this.gameOverWarningStartTime;
      const remainingTime = Math.max(0, Math.ceil((4000 - timeSinceWarning) / 1000));

      // Draw warning background
      this.ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
      this.ctx.fillRect(this.CANVAS_SIZE / 2 - 50, this.CANVAS_SIZE / 2 - 30, 100, 60);

      // Draw timer text
      this.ctx.fillStyle = '#FFFFFF';
      this.ctx.font = 'bold 24px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(remainingTime.toString(), this.CANVAS_SIZE / 2, this.CANVAS_SIZE / 2 + 10);

      // Draw warning text
      this.ctx.font = '12px Arial';
      this.ctx.fillText('GAME OVER', this.CANVAS_SIZE / 2, this.CANVAS_SIZE / 2 - 10);
    }

    // Draw next potion preview
    this.ctx.fillStyle = this.POTION_COLORS[this.nextPotionType];
    this.ctx.beginPath();
    this.ctx.arc(
      70,
      this.CANVAS_SIZE + 65,
      this.POTION_RADII[this.nextPotionType] * 0.5,
      0,
      Math.PI * 2
    );
    this.ctx.fill();
    this.ctx.strokeStyle = '#333';
    this.ctx.lineWidth = 1;
    this.ctx.stroke();

    this.ctx.fillStyle = '#333';
    this.ctx.font = '16px Arial';
    this.ctx.textAlign = 'left';
    this.ctx.fillText('Next:', 20, this.CANVAS_SIZE + 70);

    // Draw score
    this.ctx.textAlign = 'right';
    this.ctx.fillText(`Score: ${this.score}`, this.CANVAS_SIZE - 20, this.CANVAS_SIZE + 70);
  }

  private renderGameOver() {
    this.renderGame();

    // Overlay
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    this.ctx.fillRect(0, 0, this.CANVAS_SIZE, this.CANVAS_SIZE + this.CANVAS_UI_HEIGHT);

    this.ctx.fillStyle = '#fff';
    this.ctx.font = 'bold 28px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Game Over!', this.CANVAS_SIZE / 2, 150);

    this.ctx.font = '20px Arial';
    this.ctx.fillText(`Final Score: ${this.score}`, this.CANVAS_SIZE / 2, 190);

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
      '#f44336',
      '#d32f2f'
    );
  }

  private renderLeaderboard() {
    // Similar to Number Crunch leaderboard rendering
    this.ctx.fillStyle = '#333';
    this.ctx.font = 'bold 24px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Leaderboard', this.CANVAS_SIZE / 2, 50);

    this.drawButton(
      'Back',
      this.LEADERBOARD_BACK_BUTTON.x,
      this.LEADERBOARD_BACK_BUTTON.y,
      this.LEADERBOARD_BACK_BUTTON.width,
      this.LEADERBOARD_BACK_BUTTON.height,
      '#f44336',
      '#d32f2f'
    );
  }

  private renderLeaderboardNameInput() {
    // Similar to Number Crunch name input
    this.ctx.fillStyle = '#333';
    this.ctx.font = 'bold 24px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Enter Your Name', this.CANVAS_SIZE / 2, 80);

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

  private drawButton(
    text: string,
    x: number,
    y: number,
    width: number,
    height: number,
    color: string,
    hoverColor: string
  ) {
    // Similar button drawing as Number Crunch
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x - width / 2, y - height / 2, width, height);

    this.ctx.fillStyle = '#fff';
    this.ctx.font = '16px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(text, x, y + 5);
  }

  private drawCauldron() {
    const containerWidth = 320;
    const containerX = (this.CANVAS_SIZE - containerWidth) / 2;
    const containerY = 70; // Start just below drop area
    const containerHeight = this.containerBottom - containerY; // Height to reach container bottom

    // Draw container background
    this.ctx.fillStyle = 'rgba(44, 62, 80, 0.1)';
    this.ctx.fillRect(containerX, containerY, containerWidth, containerHeight);

    // Draw container border
    this.ctx.strokeStyle = '#34495e';
    this.ctx.lineWidth = 3;
    this.ctx.strokeRect(containerX, containerY, containerWidth, containerHeight);

    // Draw container rim/shadow effect
    this.ctx.strokeStyle = '#2c3e50';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(containerX + 2, containerY + 2, containerWidth - 4, containerHeight - 4);
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

  @HostListener('mousedown', ['$event'])
  onMouseDown(event: MouseEvent) {
    const rect = this.canvas.nativeElement.getBoundingClientRect();
    const x = (event.clientX - rect.left) / this.canvasScale;
    const y = (event.clientY - rect.top) / this.canvasScale;

    switch (this.currentState) {
      case GameState.MENU:
        this.handleMenuClick(x, y);
        break;
      case GameState.GAME_OVER:
        this.handleGameOverClick(x, y);
        break;
      case GameState.LEADERBOARD:
        this.handleLeaderboardClick(x, y);
        break;
      case GameState.LEADERBOARD_NAME_INPUT:
        this.handleLeaderboardNameInputClick(x, y);
        break;
      // PLAYING case moved to mouseup
    }
  }

  @HostListener('mouseup', ['$event'])
  onMouseUp(event: MouseEvent) {
    const rect = this.canvas.nativeElement.getBoundingClientRect();
    const x = (event.clientX - rect.left) / this.canvasScale;
    const y = (event.clientY - rect.top) / this.canvasScale;

    switch (this.currentState) {
      case GameState.PLAYING:
        if (this.ignoreNextMouseUp) {
          this.ignoreNextMouseUp = false; // Reset the flag
          return; // Ignore this mouse up event
        }
        this.handleGameClick(x, y);
        break;
    }
  }

  @HostListener('mousemove', ['$event'])
  onMouseMove(event: MouseEvent) {
    const rect = this.canvas.nativeElement.getBoundingClientRect();
    this.mouseX = (event.clientX - rect.left) / this.canvasScale;
  }

  @HostListener('touchstart', ['$event'])
  onTouchStart(event: TouchEvent) {
    if (event.touches.length === 0) return;

    const touch = event.touches[0];
    const rect = this.canvas.nativeElement.getBoundingClientRect();
    const x = (touch.clientX - rect.left) / this.canvasScale;
    const y = (touch.clientY - rect.top) / this.canvasScale;

    event.preventDefault();

    switch (this.currentState) {
      case GameState.MENU:
        this.handleMenuClick(x, y);
        break;
      case GameState.GAME_OVER:
        this.handleGameOverClick(x, y);
        break;
      case GameState.LEADERBOARD:
        this.handleLeaderboardClick(x, y);
        break;
      case GameState.LEADERBOARD_NAME_INPUT:
        this.handleLeaderboardNameInputClick(x, y);
        break;
      // PLAYING case moved to touchend
    }
  }

  @HostListener('touchend', ['$event'])
  onTouchEnd(event: TouchEvent) {
    if (event.changedTouches.length === 0) return;

    const touch = event.changedTouches[0];
    const rect = this.canvas.nativeElement.getBoundingClientRect();
    const x = (touch.clientX - rect.left) / this.canvasScale;
    const y = (touch.clientY - rect.top) / this.canvasScale;

    event.preventDefault();

    switch (this.currentState) {
      case GameState.PLAYING:
        if (this.ignoreNextMouseUp) {
          this.ignoreNextMouseUp = false; // Reset the flag
          return; // Ignore this touch end event
        }
        this.handleGameClick(x, y);
        break;
    }
  }

  @HostListener('touchmove', ['$event'])
  onTouchMove(event: TouchEvent) {
    if (event.touches.length === 0) return;

    const touch = event.touches[0];
    const rect = this.canvas.nativeElement.getBoundingClientRect();
    this.mouseX = (touch.clientX - rect.left) / this.canvasScale;

    event.preventDefault();
  }

  private handleMenuClick(x: number, y: number) {
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
    } else if (
      this.isClickInButton(
        x,
        y,
        this.MENU_LEADERBOARD_BUTTON.x,
        this.MENU_LEADERBOARD_BUTTON.y,
        this.MENU_LEADERBOARD_BUTTON.width,
        this.MENU_LEADERBOARD_BUTTON.height
      )
    ) {
      this.currentState = GameState.LEADERBOARD;
    }
  }

  private handleGameClick(x: number, y: number) {
    if (y < 50) return; // Don't drop in UI area

    // Check cooldown - prevent dropping if not enough time has passed
    const currentTime = Date.now();
    if (currentTime - this.lastDropTime < this.DROP_COOLDOWN) return;

    // Use the current mouse position for dropping
    const dropX = this.mouseX;

    // Constrain x position to container boundaries
    const containerWidth = 320;
    const containerX = (this.CANVAS_SIZE - containerWidth) / 2;
    const potionRadius = this.POTION_RADII[this.nextPotionType];
    const constrainedX = Math.max(
      containerX + potionRadius,
      Math.min(containerX + containerWidth - potionRadius, dropX)
    );

    // Create new potion and add it to the potions array with initial downward velocity
    const newPotion: Potion = {
      x: constrainedX,
      y: 50,
      vx: 0,
      vy: 2, // Give it initial downward velocity so it starts falling immediately
      radius: potionRadius,
      type: this.nextPotionType,
      color: this.POTION_COLORS[this.nextPotionType],
      active: true,
    };

    this.potions.push(newPotion);

    // Update last drop time
    this.lastDropTime = currentTime;

    // Generate next potion type
    this.nextPotionType = Math.floor(Math.random() * 5); // Random potion 0-4
  }

  private handleGameOverClick(x: number, y: number) {
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
    } else if (
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

  private handleLeaderboardClick(x: number, y: number) {
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
      this.currentState = GameState.MENU;
    }
  }

  private handleLeaderboardNameInputClick(x: number, y: number) {
    if (x >= 50 && x <= this.CANVAS_SIZE - 50 && y >= 240 && y <= 280) {
      this.isLeaderboardInputFocused = true;
      if (this.mobileInput) {
        setTimeout(() => {
          this.mobileInput.nativeElement.focus();
        }, 10);
      }
    } else {
      this.isLeaderboardInputFocused = false;
      if (this.mobileInput) {
        this.mobileInput.nativeElement.blur();
      }
    }

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
    } else if (
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

  @HostListener('keydown', ['$event'])
  onKeyDown(event: KeyboardEvent) {
    if (this.currentState === GameState.LEADERBOARD_NAME_INPUT) {
      this.handleLeaderboardNameInputKey(event);
    }
  }

  private handleLeaderboardNameInputKey(event: KeyboardEvent) {
    event.preventDefault();

    if (event.key === 'Enter') {
      this.submitLeaderboardName();
    } else if (event.key === 'Escape') {
      this.skipLeaderboardName();
    } else if (event.key === 'Backspace') {
      this.leaderboardNameInput = this.leaderboardNameInput.slice(0, -1);
    } else if (event.key.length === 1 && this.leaderboardNameInput.length < 10) {
      if (/^[a-zA-Z0-9 ]$/.test(event.key)) {
        this.leaderboardNameInput += event.key;
      }
    }
  }

  private startGame() {
    this.potions = [];
    this.score = 0;
    this.gameOver = false;
    this.nextPotionType = Math.floor(Math.random() * 5);
    this.currentState = GameState.PLAYING;
    this.ignoreNextMouseUp = true; // Ignore the mouse up from the play button click
    this.lastDropTime = 0; // Reset cooldown so player can drop immediately
    this.gameStartTime = Date.now(); // Reset game start time for game over detection
    this.gameOverWarningStartTime = 0; // Reset warning timer
    this.showingGameOverTimer = false; // Reset timer display flag
  }

  private submitLeaderboardName() {
    const name = this.leaderboardNameInput.trim();
    if (name) {
      // Submit to leaderboard (similar to Number Crunch)
      this.leaderboardService.addEntry({
        name: name,
        score: this.pendingLeaderboardScore,
        difficulty: this.settings.difficulty,
        level: 1, // Suika doesn't have levels
        date: new Date(),
      });
    }
    this.currentState = GameState.GAME_OVER;
  }

  private skipLeaderboardName() {
    this.currentState = GameState.GAME_OVER;
  }

  // Mobile input methods (similar to Number Crunch)
  getMobileInputPosition() {
    const canvasRect = this.canvas.nativeElement.getBoundingClientRect();
    return {
      left: -100,
      top: canvasRect.top + this.CANVAS_SIZE / 2,
      width: 1,
      height: 1,
    };
  }

  onMobileInputBeforeInput(event: any) {
    event.preventDefault();

    if (event.inputType === 'insertText' && event.data && this.leaderboardNameInput.length < 10) {
      this.leaderboardNameInput += event.data;
      if (this.mobileInput) {
        const input = this.mobileInput.nativeElement;
        input.value = this.leaderboardNameInput;
        input.setSelectionRange(this.leaderboardNameInput.length, this.leaderboardNameInput.length);
      }
    } else if (event.inputType === 'deleteContentBackward') {
      this.leaderboardNameInput = this.leaderboardNameInput.slice(0, -1);
      if (this.mobileInput) {
        const input = this.mobileInput.nativeElement;
        input.value = this.leaderboardNameInput;
        input.setSelectionRange(this.leaderboardNameInput.length, this.leaderboardNameInput.length);
      }
    }
  }

  public onMobileInputChange(event: any) {
    this.leaderboardNameInput = event.target.value;
    requestAnimationFrame(() => {
      if (this.mobileInput) {
        const input = this.mobileInput.nativeElement;
        input.setSelectionRange(this.leaderboardNameInput.length, this.leaderboardNameInput.length);
      }
    });
  }

  public onMobileInputFocus() {
    this.isLeaderboardInputFocused = true;
    requestAnimationFrame(() => {
      if (this.mobileInput) {
        const input = this.mobileInput.nativeElement;
        input.value = this.leaderboardNameInput;
        input.setSelectionRange(this.leaderboardNameInput.length, this.leaderboardNameInput.length);
      }
    });
  }

  public onMobileInputBlur() {
    this.isLeaderboardInputFocused = false;
  }

  public toggleMute() {
    this.settings.muted = !this.settings.muted;
  }

  public restartGame() {
    this.currentState = GameState.MENU;
  }
}
