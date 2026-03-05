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
}

export enum GameState {
  LOADING = 'loading',
  MENU = 'menu',
  PLAYING = 'playing',
  AIMING = 'aiming',
  SHOOTING = 'shooting',
  GAME_OVER = 'game_over',
  LEADERBOARD = 'leaderboard',
  LEADERBOARD_NAME_INPUT = 'leaderboard_name_input',
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
}

export interface DamageText {
  x: number;
  y: number;
  damage: number;
  life: number;
}