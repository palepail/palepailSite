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

interface Potion {
  body: any; // Matter.js body
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
  private readonly POTION_RADII = [13, 17, 21, 26, 33, 42, 52, 66, 85, 108, 137];

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
    this.loadMatterJS().then(() => {
      this.initializeGame();
      this.startGameLoop();
    });
  }

  ngOnDestroy() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    if (this.runner && this.Runner) {
      this.Runner.stop(this.runner);
    }
  }

  private loadMatterJS(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Check if Matter.js is already loaded
      if (typeof Matter !== 'undefined') {
        this.setupMatterFunctions();
        resolve();
        return;
      }

      // Create script element
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js';
      script.onload = () => {
        this.setupMatterFunctions();
        resolve();
      };
      script.onerror = () => reject(new Error('Failed to load Matter.js'));
      document.head.appendChild(script);
    });
  }

  private setupMatterFunctions() {
    const matter = (window as any).Matter;
    this.Engine = matter.Engine;
    this.Render = matter.Render;
    this.Runner = matter.Runner;
    this.Bodies = matter.Bodies;
    this.World = matter.World;
    this.Events = matter.Events;
    this.Body = matter.Body;
    this.Composite = matter.Composite;
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

    // Initialize Matter.js physics engine
    this.engine = this.Engine.create({
      gravity: { x: 0, y: 1 } // Same gravity as fruits-maker
    });
    this.world = this.engine.world;

    // Create boundaries (walls and floor)
    const wallOptions = {
      isStatic: true,
      render: {
        fillStyle: 'rgba(102, 126, 234, 0.3)',
        strokeStyle: 'rgba(102, 126, 234, 0.5)',
        lineWidth: 2
      }
    };

    const containerWidth = 320;
    const containerX = (this.CANVAS_SIZE - containerWidth) / 2;

    // Create boundaries - position them at the container boundaries
    const ground = this.Bodies.rectangle(
      this.CANVAS_SIZE / 2,
      this.containerBottom + 10,
      this.CANVAS_SIZE,
      20,
      wallOptions
    );

    const leftWall = this.Bodies.rectangle(
      containerX - 10,
      (70 + this.containerBottom) / 2,  // Center of container area
      20,
      this.containerBottom - 70,  // Height of container area
      wallOptions
    );

    const rightWall = this.Bodies.rectangle(
      containerX + containerWidth + 10,
      (70 + this.containerBottom) / 2,  // Center of container area
      20,
      this.containerBottom - 70,  // Height of container area
      wallOptions
    );

    // Add boundaries to world
    this.World.add(this.world, [ground, leftWall, rightWall]);

    // Start the physics engine
    this.runner = this.Runner.create();
    this.Runner.run(this.runner, this.engine);

    // Set up collision detection for merging
    this.Events.on(this.engine, 'collisionStart', (event: any) => {
      event.pairs.forEach((pair: any) => {
        const { bodyA, bodyB } = pair;

        // Check if both bodies are potions and same type
        const potionA = this.potions.find(p => p.body === bodyA);
        const potionB = this.potions.find(p => p.body === bodyB);

        if (potionA && potionB && potionA.type === potionB.type && potionA.type < this.POTION_TYPES - 1) {
          // Merge potions
          this.mergePotions(potionA, potionB);
        }
      });
    });

    // Set up input event listeners
    canvas.addEventListener('mousemove', (event) => {
      const rect = canvas.getBoundingClientRect();
      this.mouseX = (event.clientX - rect.left) / this.canvasScale;
    });

    canvas.addEventListener('click', (event) => {
      if (this.currentState === GameState.PLAYING) {
        this.handleGameClick(event);
      } else if (this.currentState === GameState.MENU) {
        this.handleMenuClick(event);
      } else if (this.currentState === GameState.GAME_OVER) {
        this.handleGameOverClick(event);
      } else if (this.currentState === GameState.LEADERBOARD) {
        this.handleLeaderboardClick(event);
      }
    });

    canvas.addEventListener('touchstart', (event) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const touch = event.touches[0];
      this.mouseX = (touch.clientX - rect.left) / this.canvasScale;

      if (this.currentState === GameState.PLAYING) {
        this.handleGameClick(event);
      } else if (this.currentState === GameState.MENU) {
        this.handleMenuClick(event);
      } else if (this.currentState === GameState.GAME_OVER) {
        this.handleGameOverClick(event);
      } else if (this.currentState === GameState.LEADERBOARD) {
        this.handleLeaderboardClick(event);
      }
    });
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
    // Matter.js handles physics automatically - no custom physics needed
    // Just clean up inactive potions from the world
    this.potions = this.potions.filter(potion => {
      if (!potion.active && potion.body) {
        this.World.remove(this.world, potion.body);
        return false;
      }
      return true;
    });
  }





  private createPotion(x: number, y: number, type: number, isStatic: boolean = false): Potion {
    const radius = this.POTION_RADII[type];
    const color = this.POTION_COLORS[type];

    // Create Matter.js body
    const body = this.Bodies.circle(x, y, radius, {
      restitution: 0.3, // Same as fruits-maker
      friction: 0.5,    // Same as fruits-maker
      isStatic: isStatic,
      render: {
        fillStyle: color,
        strokeStyle: 'rgba(255, 255, 255, 0.3)',
        lineWidth: 2
      }
    });

    body.fruitType = type; // Store type on body for collision detection

    // Create potion object
    const potion: Potion = {
      body: body,
      type: type,
      color: color,
      active: true
    };

    // Add to world and potions array
    this.World.add(this.world, body);
    this.potions.push(potion);

    return potion;
  }

  private mergePotions(potionA: Potion, potionB: Potion) {
    // Calculate merge position
    const x = (potionA.body.position.x + potionB.body.position.x) / 2;
    const y = (potionA.body.position.y + potionB.body.position.y) / 2;

    // Remove old potions from world and array
    this.World.remove(this.world, potionA.body);
    this.World.remove(this.world, potionB.body);
    potionA.active = false;
    potionB.active = false;

    // Create new larger potion
    const newType = potionA.type + 1;
    if (newType < this.POTION_TYPES) {
      const newPotion = this.createPotion(x, y, newType, false);
      newPotion.body.fruitType = newType;

      // Add some upward velocity for visual effect (like fruits-maker)
      this.Body.setVelocity(newPotion.body, { x: 0, y: -2 });

      // Add score
      this.score += (newType + 1) * 10;
    }
  }

  private checkMerges() {
    // Merging is now handled by Matter.js collision events
    // This method is kept for compatibility but does nothing
  }

  private checkGameOver() {
    const currentTime = Date.now();

    // Don't check for game over until 0.5 seconds after game start
    if (currentTime - this.gameStartTime < 500) {
      return;
    }

    let potionAboveThreshold = false;
    for (const potion of this.potions) {
      const midpointX = potion.body.position.x;
      const midpointY = potion.body.position.y;
      const containerWidth = 320;
      const containerX = (this.CANVAS_SIZE - containerWidth) / 2;
      // Check if midpoint is outside container (above top, below bottom, left of left wall, or right of right wall)
      if (potion.active && (
        midpointY < 70 || 
        midpointY > this.containerBottom ||
        midpointX < containerX ||
        midpointX > containerX + containerWidth
      )) {
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

      // Show timer after 1 second (showing 3-second countdown)
      if (timeSinceWarning >= 1000 && !this.showingGameOverTimer) {
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
      if (!potion.active) continue;

      this.ctx.fillStyle = potion.color;
      this.ctx.beginPath();
      this.ctx.arc(
        potion.body.position.x,
        potion.body.position.y,
        this.POTION_RADII[potion.type],
        0,
        Math.PI * 2
      );
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

  private handleGameClick(event: MouseEvent | TouchEvent) {
    const currentTime = Date.now();
    if (currentTime - this.lastDropTime < this.DROP_COOLDOWN) {
      return; // Prevent spamming drops
    }
    this.lastDropTime = currentTime;

    // Drop the next potion at the current mouse position
    const containerWidth = 320;
    const containerX = (this.CANVAS_SIZE - containerWidth) / 2;
    const potionRadius = this.POTION_RADII[this.nextPotionType];
    const constrainedX = Math.max(
      containerX + potionRadius,
      Math.min(containerX + containerWidth - potionRadius, this.mouseX)
    );

    // Create and drop the potion
    this.createPotion(constrainedX, 50, this.nextPotionType, false);

    // Generate next potion type
    this.nextPotionType = Math.floor(Math.random() * 5); // 0-4 for variety
  }

  private handleMenuClick(event: MouseEvent | TouchEvent) {
    const rect = this.canvas.nativeElement.getBoundingClientRect();
    const scale = this.canvasScale;
    const clickX = ((event instanceof MouseEvent ? event.clientX : event.touches[0].clientX) - rect.left) / scale;
    const clickY = ((event instanceof MouseEvent ? event.clientY : event.touches[0].clientY) - rect.top) / scale;

    // Check play button
    if (
      clickX >= this.MENU_PLAY_BUTTON.x - this.MENU_PLAY_BUTTON.width / 2 &&
      clickX <= this.MENU_PLAY_BUTTON.x + this.MENU_PLAY_BUTTON.width / 2 &&
      clickY >= this.MENU_PLAY_BUTTON.y - this.MENU_PLAY_BUTTON.height / 2 &&
      clickY <= this.MENU_PLAY_BUTTON.y + this.MENU_PLAY_BUTTON.height / 2
    ) {
      this.startGame();
    }

    // Check leaderboard button
    if (
      clickX >= this.MENU_LEADERBOARD_BUTTON.x - this.MENU_LEADERBOARD_BUTTON.width / 2 &&
      clickX <= this.MENU_LEADERBOARD_BUTTON.x + this.MENU_LEADERBOARD_BUTTON.width / 2 &&
      clickY >= this.MENU_LEADERBOARD_BUTTON.y - this.MENU_LEADERBOARD_BUTTON.height / 2 &&
      clickY <= this.MENU_LEADERBOARD_BUTTON.y + this.MENU_LEADERBOARD_BUTTON.height / 2
    ) {
      this.showLeaderboard();
    }
  }

  private handleGameOverClick(event: MouseEvent | TouchEvent) {
    const rect = this.canvas.nativeElement.getBoundingClientRect();
    const scale = this.canvasScale;
    const clickX = ((event instanceof MouseEvent ? event.clientX : event.touches[0].clientX) - rect.left) / scale;
    const clickY = ((event instanceof MouseEvent ? event.clientY : event.touches[0].clientY) - rect.top) / scale;

    // Check play again button
    if (
      clickX >= this.GAME_OVER_PLAY_AGAIN_BUTTON.x - this.GAME_OVER_PLAY_AGAIN_BUTTON.width / 2 &&
      clickX <= this.GAME_OVER_PLAY_AGAIN_BUTTON.x + this.GAME_OVER_PLAY_AGAIN_BUTTON.width / 2 &&
      clickY >= this.GAME_OVER_PLAY_AGAIN_BUTTON.y - this.GAME_OVER_PLAY_AGAIN_BUTTON.height / 2 &&
      clickY <= this.GAME_OVER_PLAY_AGAIN_BUTTON.y + this.GAME_OVER_PLAY_AGAIN_BUTTON.height / 2
    ) {
      this.startGame();
    }

    // Check main menu button
    if (
      clickX >= this.GAME_OVER_MAIN_MENU_BUTTON.x - this.GAME_OVER_MAIN_MENU_BUTTON.width / 2 &&
      clickX <= this.GAME_OVER_MAIN_MENU_BUTTON.x + this.GAME_OVER_MAIN_MENU_BUTTON.width / 2 &&
      clickY >= this.GAME_OVER_MAIN_MENU_BUTTON.y - this.GAME_OVER_MAIN_MENU_BUTTON.height / 2 &&
      clickY <= this.GAME_OVER_MAIN_MENU_BUTTON.y + this.GAME_OVER_MAIN_MENU_BUTTON.height / 2
    ) {
      this.currentState = GameState.MENU;
    }
  }

  private handleLeaderboardClick(event: MouseEvent | TouchEvent) {
    const rect = this.canvas.nativeElement.getBoundingClientRect();
    const scale = this.canvasScale;
    const clickX = ((event instanceof MouseEvent ? event.clientX : event.touches[0].clientX) - rect.left) / scale;
    const clickY = ((event instanceof MouseEvent ? event.clientY : event.touches[0].clientY) - rect.top) / scale;

    // Check back button
    if (
      clickX >= this.LEADERBOARD_BACK_BUTTON.x - this.LEADERBOARD_BACK_BUTTON.width / 2 &&
      clickX <= this.LEADERBOARD_BACK_BUTTON.x + this.LEADERBOARD_BACK_BUTTON.width / 2 &&
      clickY >= this.LEADERBOARD_BACK_BUTTON.y - this.LEADERBOARD_BACK_BUTTON.height / 2 &&
      clickY <= this.LEADERBOARD_BACK_BUTTON.y + this.LEADERBOARD_BACK_BUTTON.height / 2
    ) {
      this.currentState = GameState.MENU;
    }
  }

  private startGame() {
    // Reset game state
    this.potions = [];
    this.nextPotionType = 0;
    this.score = 0;
    this.gameOver = false;
    this.gameStartTime = Date.now();
    this.gameOverWarningStartTime = 0;
    this.showingGameOverTimer = false;
    this.lastDropTime = 0;

    // Clear Matter.js world
    this.World.clear(this.world, false);
    this.potions = [];

    // Re-add boundaries
    const wallOptions = {
      isStatic: true,
      render: {
        fillStyle: 'rgba(102, 126, 234, 0.3)',
        strokeStyle: 'rgba(102, 126, 234, 0.5)',
        lineWidth: 2
      }
    };

    const containerWidth = 320;
    const containerX = (this.CANVAS_SIZE - containerWidth) / 2;

    const ground = this.Bodies.rectangle(
      this.CANVAS_SIZE / 2,
      this.containerBottom + 10,
      this.CANVAS_SIZE,
      20,
      wallOptions
    );

    const leftWall = this.Bodies.rectangle(
      containerX - 10,
      (70 + this.containerBottom) / 2,  // Center of container area
      20,
      this.containerBottom - 70,  // Height of container area
      wallOptions
    );

    const rightWall = this.Bodies.rectangle(
      containerX + containerWidth + 10,
      (70 + this.containerBottom) / 2,  // Center of container area
      20,
      this.containerBottom - 70,  // Height of container area
      wallOptions
    );

    this.World.add(this.world, [ground, leftWall, rightWall]);

    this.currentState = GameState.PLAYING;
  }

  private showLeaderboard() {
    this.currentState = GameState.LEADERBOARD;
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
