import { Component, OnInit, OnDestroy, ElementRef, ViewChild, HostListener } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';

interface GameCell {
  value: number;
  selected: boolean;
  x: number;
  y: number;
}

enum GameState {
  MENU = 'menu',
  PLAYING = 'playing',
  OPTIONS = 'options',
  GAME_OVER = 'game_over',
  CHOOSE_UPGRADE = 'choose_upgrade',
}

interface GameSettings {
  soundEnabled: boolean;
  difficulty: 'easy' | 'normal' | 'hard';
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
    soundEnabled: true,
    difficulty: 'normal',
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
  private readonly ENEMY_ATTACK_DAMAGE = 4;
  private readonly ENEMY_ATTACK_INTERVAL = 4000; // milliseconds

  // Scramble constants
  private readonly SCRAMBLES_PER_LEVEL = 3;
  private readonly SCRAMBLE_ANIMATION_DURATION = 2000; // milliseconds

  // Upgrade constants
  private readonly UPGRADE_MULTIPLIER = 1.15; // 15% increase

  // Scoring constants
  private readonly POINTS_PER_TILE = 10;

  // Target number constants
  private readonly TARGET_BASE = 9;
  private readonly TARGET_RANDOM_MIN = 1;
  private readonly TARGET_RANDOM_MAX = 3;

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

  // Upgrade system
  damageMultiplier = 1.0;

  // Selection state
  isSelecting = false;
  selectionStart = { x: 0, y: 0 };
  selectionEnd = { x: 0, y: 0 };
  selectedSum = 0;

  // Animation state
  enemyAttackTimer = 0;
  lastTime = 0;

  // Scramble system
  scramblesRemaining = 3;
  isScrambling = false;
  scrambleTimer = 0;
  scrambleAnimation: {
    oldPos: { x: number; y: number };
    newPos: { x: number; y: number };
    value: number;
  }[] = [];

  // Game loop
  private animationFrameId: number = 0;

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
      this.playerHealth = Math.max(0, this.playerHealth - this.ENEMY_ATTACK_DAMAGE);
    }

    // Check win/lose conditions
    if (this.playerHealth <= 0) {
      this.currentState = GameState.GAME_OVER;
    }
    if (this.enemyHealth <= 0) {
      this.nextTarget = this.calculateNextTarget(); // Calculate next target once
      this.currentState = GameState.CHOOSE_UPGRADE; // Go to upgrade choice instead of directly to next level
    }
  }

  private render() {
    // Note: Each render method now sets its own background, so no global clear needed

    switch (this.currentState) {
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

    // Play button
    this.drawButton('Play Game', this.CANVAS_SIZE / 2, 180, 200, 50, '#4CAF50', '#45a049');

    // Options button
    this.drawButton('Options', this.CANVAS_SIZE / 2, 250, 200, 50, '#2196F3', '#1976D2');

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

  private renderOptions() {
    // Background
    this.ctx.fillStyle = this.BACKGROUND_COLOR;
    this.ctx.fillRect(0, 0, this.CANVAS_SIZE, this.CANVAS_SIZE + this.CANVAS_UI_HEIGHT);

    // Title
    this.ctx.fillStyle = '#1976d2';
    this.ctx.font = 'bold 28px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Options', this.CANVAS_SIZE / 2, 60);

    // Sound toggle
    this.drawButton(
      `Sound: ${this.settings.soundEnabled ? 'ON' : 'OFF'}`,
      this.CANVAS_SIZE / 2,
      130,
      180,
      40,
      this.settings.soundEnabled ? '#4CAF50' : '#f44336',
      this.settings.soundEnabled ? '#45a049' : '#d32f2f'
    );

    // Difficulty buttons
    const difficulties = ['easy', 'normal', 'hard'];
    difficulties.forEach((diff, index) => {
      const y = 200 + index * 60;
      const isSelected = this.settings.difficulty === diff;
      this.drawButton(
        diff.charAt(0).toUpperCase() + diff.slice(1),
        this.CANVAS_SIZE / 2,
        y,
        150,
        40,
        isSelected ? '#FF9800' : '#757575',
        isSelected ? '#F57C00' : '#616161'
      );
    });

    // Back button
    this.drawButton(
      'Back to Menu',
      this.CANVAS_SIZE / 2,
      this.CANVAS_SIZE + 30,
      160,
      40,
      '#9C27B0',
      '#7B1FA2'
    );
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

    // Play again button
    this.drawButton('Play Again', this.CANVAS_SIZE / 2, 300, 180, 50, '#4CAF50', '#45a049');

    // Back to menu button
    this.drawButton('Main Menu', this.CANVAS_SIZE / 2, 380, 180, 50, '#2196F3', '#1976D2');
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

    // Health upgrade button
    this.drawButton('Health +15%', this.CANVAS_SIZE / 2, 225, 160, 50, '#FF9800', '#F57C00');

    // Damage upgrade button
    this.drawButton('Damage +15%', this.CANVAS_SIZE / 2, 295, 160, 50, '#FF5722', '#D84315');
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
      this.CANVAS_SIZE + 25,
      'Player',
      this.playerHealth,
      this.MAX_HEALTH,
      '#4CAF50'
    );
    this.drawCharacter(
      this.CANVAS_SIZE - 50,
      this.CANVAS_SIZE + 25,
      'Enemy',
      this.enemyHealth,
      this.ENEMY_MAX_HEALTH,
      '#f44336'
    );

    // Draw scramble button if available (lowered to avoid grid overlap)
    if (this.scramblesRemaining > 0 && !this.isScrambling) {
      this.drawButton(
        'Scramble',
        this.CANVAS_SIZE / 2,
        this.CANVAS_SIZE + 50,
        120,
        35,
        '#FF9800',
        '#F57C00'
      );
    } else if (this.isScrambling) {
      this.drawButton(
        'Scrambling...',
        this.CANVAS_SIZE / 2,
        this.CANVAS_SIZE + 50,
        120,
        35,
        '#757575',
        '#616161'
      );
    }

    // Draw target below scramble button
    this.ctx.fillStyle = '#333';
    this.ctx.font = '18px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(`Target: ${this.targetNumber}`, this.CANVAS_SIZE / 2, this.CANVAS_SIZE + 90);

    // Draw level and scramble info on same line
    this.ctx.font = '14px Arial';
    this.ctx.fillText(
      `Level: ${this.level} | Scrambles: ${this.scramblesRemaining}`,
      this.CANVAS_SIZE / 2,
      this.CANVAS_SIZE + 110
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
    // Simple character representation
    this.ctx.fillStyle = color;
    this.ctx.fillRect(
      x - this.CHARACTER_SIZE / 2,
      y - this.CHARACTER_SIZE / 2,
      this.CHARACTER_SIZE,
      this.CHARACTER_SIZE
    );

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
    // Play button (centered at CANVAS_SIZE/2, 180)
    if (this.isClickInButton(x, y, this.CANVAS_SIZE / 2, 180, 200, 50)) {
      this.startGame();
    }
    // Options button (centered at CANVAS_SIZE/2, 250)
    else if (this.isClickInButton(x, y, this.CANVAS_SIZE / 2, 250, 200, 50)) {
      this.currentState = GameState.OPTIONS;
    }
  }

  private handleGameClick(x: number, y: number) {
    // Don't allow interactions during scrambling
    if (this.isScrambling) {
      return;
    }

    // Check if scramble button was clicked (updated y position)
    if (
      this.scramblesRemaining > 0 &&
      !this.isScrambling &&
      this.isClickInButton(x, y, this.CANVAS_SIZE / 2, this.CANVAS_SIZE + 50, 120, 35)
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
    // Sound toggle (centered at CANVAS_SIZE/2, 130)
    if (this.isClickInButton(x, y, this.CANVAS_SIZE / 2, 130, 180, 40)) {
      this.settings.soundEnabled = !this.settings.soundEnabled;
    }
    // Difficulty buttons
    else if (this.isClickInButton(x, y, this.CANVAS_SIZE / 2, 200, 150, 40)) {
      this.settings.difficulty = 'easy';
    } else if (this.isClickInButton(x, y, this.CANVAS_SIZE / 2, 260, 150, 40)) {
      this.settings.difficulty = 'normal';
    } else if (this.isClickInButton(x, y, this.CANVAS_SIZE / 2, 320, 150, 40)) {
      this.settings.difficulty = 'hard';
    }
    // Back button
    else if (this.isClickInButton(x, y, this.CANVAS_SIZE / 2, this.CANVAS_SIZE + 30, 160, 40)) {
      this.currentState = GameState.MENU;
    }
  }

  private handleGameOverClick(x: number, y: number) {
    // Play again button (matches renderGameOver y=300)
    if (this.isClickInButton(x, y, this.CANVAS_SIZE / 2, 300, 180, 50)) {
      this.startGame();
    }
    // Main menu button (matches renderGameOver y=380)
    else if (this.isClickInButton(x, y, this.CANVAS_SIZE / 2, 380, 180, 50)) {
      this.currentState = GameState.MENU;
    }
  }

  private handleChooseUpgradeClick(x: number, y: number) {
    // Health upgrade button
    if (this.isClickInButton(x, y, this.CANVAS_SIZE / 2, 225, 160, 50)) {
      this.playerHealth = Math.floor(this.playerHealth * this.UPGRADE_MULTIPLIER); // Health upgrade
      this.nextLevel();
    }
    // Damage upgrade button
    else if (this.isClickInButton(x, y, this.CANVAS_SIZE / 2, 295, 160, 50)) {
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

  @HostListener('mousemove', ['$event'])
  onMouseMove(event: MouseEvent) {
    if (this.currentState !== GameState.PLAYING || !this.isSelecting) return;

    const rect = this.canvas.nativeElement.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / this.CELL_SIZE);
    const y = Math.floor((event.clientY - rect.top) / this.CELL_SIZE);

    if (x >= 0 && x < this.GRID_SIZE && y >= 0 && y < this.GRID_SIZE) {
      this.selectionEnd = { x, y };
      this.updateSelection();
    }
  }

  @HostListener('mouseup', ['$event'])
  onMouseUp(event: MouseEvent) {
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
    this.clearSelection();
    this.createGrid();

    // Apply difficulty settings
    this.applyDifficultySettings();

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

    // Clear selection
    this.clearSelection();
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
    this.score = 0;
    this.enemyHealth = this.ENEMY_MAX_HEALTH; // Set to enemy max health
    this.targetNumber = this.nextTarget; // Use the pre-calculated next target
    this.scramblesRemaining = this.SCRAMBLES_PER_LEVEL; // Reset scrambles for new level

    // Reset player health to maximum for new level
    this.applyDifficultySettings();

    this.createGrid();
    this.currentState = GameState.PLAYING; // Return to playing after upgrade choice
  }

  restartGame() {
    this.gameOver();
    this.currentState = GameState.MENU;
  }
}
