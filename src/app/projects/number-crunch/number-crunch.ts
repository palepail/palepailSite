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
  GAME_OVER = 'game_over'
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
    difficulty: 'normal'
  };

  // Game constants
  private readonly GRID_SIZE = 10;
  private readonly CELL_SIZE = 40;
  private readonly CANVAS_SIZE = this.GRID_SIZE * this.CELL_SIZE;

  // Game state
  grid: GameCell[][] = [];
  targetNumber = 10;
  score = 0;
  level = 1;
  playerHealth = 100;
  enemyHealth = 100;
  timeLeft = 60; // seconds (placeholder, not used)

  // Selection state
  isSelecting = false;
  selectionStart = { x: 0, y: 0 };
  selectionEnd = { x: 0, y: 0 };
  selectedSum = 0;

  // Animation state
  enemyAttackTimer = 0;
  playerAttackTimer = 0;
  lastTime = 0;

  // Scramble system
  scramblesRemaining = 3;
  isScrambling = false;
  scrambleTimer = 0;
  scrambleAnimation: { oldPos: {x: number, y: number}, newPos: {x: number, y: number}, value: number }[] = [];

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
          value: Math.floor(Math.random() * 9) + 1,
          selected: false,
          x,
          y
        };
      }
    }
  }

  private setupCanvas() {
    const canvas = this.canvas.nativeElement;
    canvas.width = this.CANVAS_SIZE;
    canvas.height = this.CANVAS_SIZE + 100; // Extra space for UI
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
      if (this.scrambleTimer >= 2000) { // 2 seconds
        this.finishScrambling();
      }
      return; // Don't update other game logic while scrambling
    }

    // Update enemy attack timer
    this.enemyAttackTimer += deltaTime;
    if (this.enemyAttackTimer >= 2000) { // 2 seconds
      this.enemyAttackTimer = 0;
      this.playerHealth = Math.max(0, this.playerHealth - 2); // Reduced damage from 5 to 2
    }

    // Update player attack timer when score increases
    if (this.score > 0) {
      this.playerAttackTimer += deltaTime;
      if (this.playerAttackTimer >= 1000) { // 1 second
        this.playerAttackTimer = 0;
        this.enemyHealth = Math.max(0, this.enemyHealth - 1);
      }
    }

    // Check win/lose conditions
    if (this.playerHealth <= 0) {
      this.currentState = GameState.GAME_OVER;
    }
    if (this.enemyHealth <= 0) {
      this.nextLevel();
    }
  }

  private render() {
    this.ctx.clearRect(0, 0, this.CANVAS_SIZE, this.CANVAS_SIZE + 100);

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
    }
  }

  private renderGame() {
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
    this.ctx.fillStyle = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
    this.ctx.fillRect(0, 0, this.CANVAS_SIZE, this.CANVAS_SIZE + 100);

    // Title
    this.ctx.fillStyle = '#ffffff';
    this.ctx.font = 'bold 32px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Number Crunch', this.CANVAS_SIZE / 2, 80);

    // Subtitle
    this.ctx.font = '18px Arial';
    this.ctx.fillStyle = '#e0e0e0';
    this.ctx.fillText('Match numbers to defeat enemies!', this.CANVAS_SIZE / 2, 110);

    // Play button
    this.drawButton('Play Game', this.CANVAS_SIZE / 2, 180, 200, 50, '#4CAF50', '#45a049');

    // Options button
    this.drawButton('Options', this.CANVAS_SIZE / 2, 250, 200, 50, '#2196F3', '#1976D2');

    // Instructions
    this.ctx.fillStyle = '#ffffff';
    this.ctx.font = '14px Arial';
    this.ctx.fillText('Click and drag to select rectangular areas', this.CANVAS_SIZE / 2, this.CANVAS_SIZE + 20);
    this.ctx.fillText('Match the target sum to score points!', this.CANVAS_SIZE / 2, this.CANVAS_SIZE + 40);
  }

  private renderOptions() {
    // Background
    this.ctx.fillStyle = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
    this.ctx.fillRect(0, 0, this.CANVAS_SIZE, this.CANVAS_SIZE + 100);

    // Title
    this.ctx.fillStyle = '#ffffff';
    this.ctx.font = 'bold 28px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Options', this.CANVAS_SIZE / 2, 60);

    // Sound toggle
    this.drawButton(
      `Sound: ${this.settings.soundEnabled ? 'ON' : 'OFF'}`,
      this.CANVAS_SIZE / 2, 130, 180, 40,
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
        this.CANVAS_SIZE / 2, y, 150, 40,
        isSelected ? '#FF9800' : '#757575',
        isSelected ? '#F57C00' : '#616161'
      );
    });

    // Back button
    this.drawButton('Back to Menu', this.CANVAS_SIZE / 2, this.CANVAS_SIZE + 30, 160, 40, '#9C27B0', '#7B1FA2');
  }

  private renderGameOver() {
    // Background
    this.ctx.fillStyle = 'linear-gradient(135deg, #f44336 0%, #c62828 100%)';
    this.ctx.fillRect(0, 0, this.CANVAS_SIZE, this.CANVAS_SIZE + 100);

    // Game Over text
    this.ctx.fillStyle = '#ffffff';
    this.ctx.font = 'bold 36px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Game Over!', this.CANVAS_SIZE / 2, 100);

    // Final score
    this.ctx.font = '24px Arial';
    this.ctx.fillText(`Final Score: ${this.score}`, this.CANVAS_SIZE / 2, 140);
    this.ctx.fillText(`Level Reached: ${this.level}`, this.CANVAS_SIZE / 2, 170);

    // Play again button
    this.drawButton('Play Again', this.CANVAS_SIZE / 2, 230, 180, 50, '#4CAF50', '#45a049');

    // Back to menu button
    this.drawButton('Main Menu', this.CANVAS_SIZE / 2, 300, 180, 50, '#2196F3', '#1976D2');
  }

  private drawButton(text: string, x: number, y: number, width: number, height: number, color: string, hoverColor: string) {
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
        const color = cell.selected ? '#4CAF50' : '#ffffff';

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
    const progress = Math.min(this.scrambleTimer / 2000, 1); // 2 seconds animation

    for (const anim of this.scrambleAnimation) {
      // Interpolate position
      const currentX = anim.oldPos.x + (anim.newPos.x - anim.oldPos.x) * progress;
      const currentY = anim.oldPos.y + (anim.newPos.y - anim.oldPos.y) * progress;

      // Draw flying number
      this.ctx.fillStyle = '#333';
      this.ctx.font = '20px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(
        anim.value.toString(),
        currentX,
        currentY + 7
      );
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
    this.drawCharacter(50, this.CANVAS_SIZE + 25, 'Player', this.playerHealth, '#4CAF50');
    this.drawCharacter(this.CANVAS_SIZE - 50, this.CANVAS_SIZE + 25, 'Enemy', this.enemyHealth, '#f44336');

    // Draw scramble button if available (positioned above target, between player and enemy)
    if (this.scramblesRemaining > 0 && !this.isScrambling) {
      this.drawButton('Scramble', this.CANVAS_SIZE / 2, this.CANVAS_SIZE + 30, 120, 35, '#FF9800', '#F57C00');
    } else if (this.isScrambling) {
      this.drawButton('Scrambling...', this.CANVAS_SIZE / 2, this.CANVAS_SIZE + 30, 120, 35, '#757575', '#616161');
    }

    // Draw target and score below scramble button
    this.ctx.fillStyle = '#333';
    this.ctx.font = '18px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(`Target: ${this.targetNumber}`, this.CANVAS_SIZE / 2, this.CANVAS_SIZE + 50);

    this.ctx.font = '14px Arial';
    this.ctx.fillText(`Score: ${this.score} | Level: ${this.level}`, this.CANVAS_SIZE / 2, this.CANVAS_SIZE + 70);

    // Draw scramble info
    this.ctx.fillText(`Scrambles: ${this.scramblesRemaining}`, this.CANVAS_SIZE / 2, this.CANVAS_SIZE + 85);
  }

  private drawCharacter(x: number, y: number, label: string, health: number, color: string) {
    // Simple character representation
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x - 15, y - 15, 30, 30);

    // Health bar
    this.ctx.fillStyle = '#333';
    this.ctx.fillRect(x - 20, y - 25, 40, 5);
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x - 20, y - 25, (health / 100) * 40, 5);

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

    // Check if scramble button was clicked
    if (this.scramblesRemaining > 0 && !this.isScrambling &&
        this.isClickInButton(x, y, this.CANVAS_SIZE / 2, this.CANVAS_SIZE + 30, 120, 35)) {
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
    }
    else if (this.isClickInButton(x, y, this.CANVAS_SIZE / 2, 260, 150, 40)) {
      this.settings.difficulty = 'normal';
    }
    else if (this.isClickInButton(x, y, this.CANVAS_SIZE / 2, 320, 150, 40)) {
      this.settings.difficulty = 'hard';
    }
    // Back button
    else if (this.isClickInButton(x, y, this.CANVAS_SIZE / 2, this.CANVAS_SIZE + 30, 160, 40)) {
      this.currentState = GameState.MENU;
    }
  }

  private handleGameOverClick(x: number, y: number) {
    // Play again button
    if (this.isClickInButton(x, y, this.CANVAS_SIZE / 2, 230, 180, 50)) {
      this.startGame();
    }
    // Main menu button
    else if (this.isClickInButton(x, y, this.CANVAS_SIZE / 2, 300, 180, 50)) {
      this.currentState = GameState.MENU;
    }
  }

  private isClickInButton(clickX: number, clickY: number, buttonX: number, buttonY: number, buttonWidth: number, buttonHeight: number): boolean {
    return clickX >= buttonX - buttonWidth / 2 &&
           clickX <= buttonX + buttonWidth / 2 &&
           clickY >= buttonY - buttonHeight / 2 &&
           clickY <= buttonY + buttonHeight / 2;
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
    this.playerHealth = 100;
    this.enemyHealth = 100;
    this.enemyAttackTimer = 0;
    this.playerAttackTimer = 0;
    this.scramblesRemaining = 3; // Reset scrambles
    this.isScrambling = false;
    this.scrambleTimer = 0;
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
        this.playerHealth = 150; // More health
        break;
      case 'normal':
        this.playerHealth = 100; // Default
        break;
      case 'hard':
        this.playerHealth = 75; // Less health
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
    if (this.currentState !== GameState.PLAYING || this.isScrambling || this.scramblesRemaining <= 0) {
      return;
    }

    this.isScrambling = true;
    this.scrambleTimer = 0;
    this.scramblesRemaining--;

    // Collect all non-zero cells with their positions
    const originalCells: {x: number, y: number, value: number}[] = [];
    for (let y = 0; y < this.GRID_SIZE; y++) {
      for (let x = 0; x < this.GRID_SIZE; x++) {
        if (this.grid[y][x].value !== 0) {
          originalCells.push({x, y, value: this.grid[y][x].value});
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
            oldPos: { x: sourceCell.x * this.CELL_SIZE + this.CELL_SIZE / 2, y: sourceCell.y * this.CELL_SIZE + this.CELL_SIZE / 2 },
            newPos: { x: x * this.CELL_SIZE + this.CELL_SIZE / 2, y: y * this.CELL_SIZE + this.CELL_SIZE / 2 },
            value: sourceCell.value
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
    // Remove matched cells (just set to 0, don't shift)
    const startX = Math.min(this.selectionStart.x, this.selectionEnd.x);
    const startY = Math.min(this.selectionStart.y, this.selectionEnd.y);
    const endX = Math.max(this.selectionStart.x, this.selectionEnd.x);
    const endY = Math.max(this.selectionStart.y, this.selectionEnd.y);

    // Mark cells for removal
    for (let y = startY; y <= endY; y++) {
      for (let x = startX; x <= endX; x++) {
        this.grid[y][x].value = 0; // Mark for removal
      }
    }

    // Update score
    this.score += (endX - startX + 1) * (endY - startY + 1) * 10;

    // Clear selection
    this.clearSelection();
  }

  private gameOver() {
    // Reset game
    this.score = 0;
    this.level = 1;
    this.playerHealth = 100;
    this.enemyHealth = 100;
    this.scramblesRemaining = 3; // Reset scrambles
    this.isScrambling = false;
    this.scrambleTimer = 0;
    this.scrambleAnimation = [];
    this.createGrid();
  }

  private nextLevel() {
    this.level++;
    this.score = 0;
    this.enemyHealth = 100 + (this.level - 1) * 20; // Harder enemies
    this.targetNumber = 10 + this.level; // Harder targets
    this.scramblesRemaining = 3; // Reset scrambles for new level
    this.createGrid();
  }

  restartGame() {
    this.gameOver();
  }
}
