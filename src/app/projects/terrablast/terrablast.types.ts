// terrablast.types.ts
// Types and interfaces for the Terrablast game component

export interface Player {
  body: any; // Matter.js body
  x: number;
  y: number;
  angle: number;
  power: number;
  maxPower: number;
  health: number;
  movementFuel: number;
  color: string;
  active: boolean;
  facing: number; // 1 for right, -1 for left
  terrainAngle: number; // Angle of terrain beneath the tank
  vehicle: Vehicle;
  turnState: 'turn_start' | 'idle' | 'aiming' | 'charging' | 'bullet_in_flight' | 'post_bullet';
  turnTimer: number;
  delay: number;
}

export interface Enemy {
  body: any; // Matter.js body
  x: number;
  y: number;
  angle: number;
  health: number;
  color: string;
  active: boolean;
  facing: number; // 1 for right, -1 for left
  terrainAngle: number; // Angle of terrain beneath the tank
  vehicle: Vehicle;
  turnState:
    | 'turn_start'
    | 'assess'
    | 'moving'
    | 'aiming'
    | 'charging'
    | 'bullet_in_flight'
    | 'post_bullet';
  turnTimer: number;
  targetPower?: number;
  power: number;
  delay: number;
  stuckCounter: number;
  assessCounter: number;
  chargeStartTime?: number;
  lastX?: number;
  lastY?: number;
  targetAngle?: number;
  movementFuel?: number; // Optional, for enemies if needed
  movementTimer?: number;
  moveDirection?: number;
  behavior?: 'aggressive' | 'defensive' | 'flanking';
}

export enum GameState {
  LOADING = 'loading',
  MENU = 'menu',
  SETUP = 'setup',
  PLAYING = 'playing',
  AIMING = 'aiming',
  BULLET_IN_FLIGHT = 'bullet_in_flight',
  GAME_OVER = 'game_over',
  LEADERBOARD = 'leaderboard',
  LEADERBOARD_NAME_INPUT = 'leaderboard_name_input',
}

export interface TurnEntity {
  id: string;
  type: 'player' | 'enemy';
  entity: Player | Enemy;
  delay: number; // Delay before next turn (lower = faster turn)
  baseDelay: number; // Base delay value
}

export interface GameSettings {
  bgmVolume: number;
  sfxVolume: number;
  difficulty: 'easy' | 'normal' | 'hard';
  muted: boolean;
}

export interface Explosion {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  life: number;
  shape: string;
}

export interface ExplodedProjectile {
  position: { x: number; y: number };
  bullet: Bullet;
  removalTime: number;
  owner: any;
}

export interface DamageText {
  x: number;
  y: number;
  damage: number;
  life: number;
}

export interface Projectile {
  body?: any; // Matter.js body (for physics mode)
  x: number;
  y: number;
  trajectory?: { x: number; y: number }[]; // Precomputed positions
  trajectoryIndex?: number; // Current index in trajectory
  owner: Player | Enemy;
  bullet: Bullet;
}

export interface Bullet {
  damage: number;
  shape: string;
  explosionShape: string;
  explosionRadius: number;
  craterRadius: number;
  speed: number;
}

export interface Vehicle {
  speed: number;
  power: number;
  shape: string;
  climbAngle: number;
  fuel: number;
  health: number;
  minAimAngle: number;
  maxAimAngle: number;
  bullet: Bullet;
  shotDelay: number;
}
