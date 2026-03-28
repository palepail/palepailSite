// monkeys.types.ts
// Types and interfaces for the Monkeys game component

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
  targetAngle?: number;
  currentShieldHealth?: number;
  shieldHitAngle?: number;
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
  forceTerrainClearingShot?: boolean;
  reassessCount?: number;
  currentShieldHealth?: number;
}

export enum GameState {
  LOADING = 'loading',
  MENU = 'menu',
  OPTIONS = 'options',
  TERRAIN_TOOL = 'terrain_tool',
  SETUP = 'setup',
  PLAYING = 'playing',
  PAUSED = 'paused',
  AIMING = 'aiming',
  BULLET_IN_FLIGHT = 'bullet_in_flight',
  EQUIPMENT_MENU = 'equipment_menu',
  GAME_OVER_DELAY = 'game_over_delay',
  GAME_OVER = 'game_over',
  WIN_DELAY = 'win_delay',
  WIN = 'win',
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

export interface TerrainSpritePoint {
  x: number;
  y: number;
}

export interface TerrainSpriteRegion {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  pixelCount: number;
  outline: TerrainSpritePoint[];
}

export type TerrainPieceType =
  | 'interior'
  | 'top_flat'
  | 'top_slope_up'
  | 'top_slope_down'
  | 'top_cap_left'
  | 'top_cap_right'
  | 'side_left'
  | 'side_right'
  | 'bottom_flat'
  | 'bottom_slope_up'
  | 'bottom_slope_down';

export interface TerrainSpriteMetadata {
  id: number;
  name: string;
  spritesheet: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pieceType: TerrainPieceType;
  topEntryY: number;
  topExitY: number;
  bottomEntryY?: number;
  bottomExitY?: number;
  fillToBottom?: boolean;
  allowedNextIds?: number[];
}

export interface TerrainMetadataFile {
  spritesheet: string;
  sprites: TerrainSpriteMetadata[];
  analysis?: {
    alphaThreshold: number;
    minimumPixelCount: number;
    regionCount: number;
  };
}

export interface TerrainChunkPlacement {
  region: TerrainSpriteMetadata;
  x: number;
  topWorldY: number;
}

export interface BackgroundSpriteMetadata {
  name: string;
  spritesheet: string;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
}

export interface BackgroundMetadataFile {
  spritesheets: Record<string, string>;
  sprites: BackgroundSpriteMetadata[];
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
  isHeal?: boolean;
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
  pushbackMultiplier?: number; // >1 increases knockback, defaults to 1
}

export interface Vehicle {
  name: string;
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
  spritesheet: string;
  armor?: number; // computed DR multiplier (0–1); set by applyEquipmentToVehicle, never set directly
  lifesteal?: number; // % of damage dealt healed back to player; set by applyEquipmentToVehicle
  weight?: number; // pushback resistance; base 10; higher = less knockback, lower = more
  shieldRadius?: number; // radius of the hit-absorbing shield in px
  shieldHealth?: number; // number of hits the shield can absorb before breaking
}

export type EquipmentSlot = 'headgear' | 'torso' | 'legs' | 'footwear' | 'accessory';

export interface EquipmentStats {
  attack?: number; // bonus to bullet.damage
  health?: number; // bonus to vehicle.health
  armor?: number; // integer % DR, e.g. 10 = 10%; stacks multiplicatively, can never reach 100%
  blastRadius?: number; // bonus to bullet.explosionRadius (craterRadius scales 0.8×)
  pushbackMultiplier?: number; // multiplier applied to blast knockback distance (stacks additively; 0 = no pushback)
  fuel?: number; // bonus to vehicle.fuel
  climbAngle?: number; // bonus to vehicle.climbAngle (degrees)
  minAimAngle?: number; // modifier to vehicle.minAimAngle (negative = wider range)
  maxAimAngle?: number; // modifier to vehicle.maxAimAngle (positive = wider range)
  lifesteal?: number; // % of damage dealt restored as health (e.g. 20 = 20%)
  weight?: number; // modifier to vehicle.weight (hidden stat)
  shieldRadius?: number; // radius of hit-absorbing shield in px
  shieldHealth?: number; // number of incoming hits the shield can absorb
  // Accessory abilities — stored but not yet implemented
  aimGuide?: 'extended' | 'full';
}

export interface EquipmentItem {
  id: string;
  name: string;
  slot: EquipmentSlot;
  stats: EquipmentStats;
  setId?: string;
  description?: string;
  spriteCol?: number;
  spriteRow?: number;
}
