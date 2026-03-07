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
  turnState: 'turn_start' | 'idle' | 'aiming' | 'charging' | 'shooting' | 'post_bullet';
  turnTimer: number;
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
  turnState: 'turn_start' | 'idle' | 'aiming' | 'charging' | 'shooting' | 'post_bullet';
  turnTimer: number;
  targetPower: number;
}

export enum GameState {
  LOADING = 'loading',
  MENU = 'menu',
  SETUP = 'setup',
  PLAYING = 'playing',
  AIMING = 'aiming',
  SHOOTING = 'shooting',
  GAME_OVER = 'game_over',
  LEADERBOARD = 'leaderboard',
  LEADERBOARD_NAME_INPUT = 'leaderboard_name_input',
}

export interface TurnEntity {
  id: string;
  type: 'player' | 'enemy';
  entity: Player | Enemy;
  actionTime: number; // Time cost for actions (lower = faster turn)
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
  position: {x: number, y: number};
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
}