// monkeys.types.ts
// Types and interfaces for the Monkeys game component

export type EntityState =
  | 'idle'
  | 'moving'
  | 'charging'
  | 'shooting'
  | 'hurting'
  | 'pushback'
  | 'falling'
  | 'dead';

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
  turnState: 'turn_start' | 'idle' | 'aiming' | 'bullet_in_flight';
  delay: number;
  targetAngle?: number;
  currentShieldHealth?: number;
  shieldHitAngle?: number;
  entityState: EntityState;
  chargeStartTime?: number;
  shotReleaseStartMs?: number;
  deathAnimStartMs?: number;
  hurtUntilMs?: number;
  prevHealth?: number;
  displayName?: string; // "You" or "Enemy N" — set at game start for combat log
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
  turnState: 'turn_start' | 'assess' | 'aiming' | 'bullet_in_flight';
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
  target?: Player | Enemy;
  currentShieldHealth?: number;
  shieldHitAngle?: number;
  entityState: EntityState;
  shotReleaseStartMs?: number;
  deathAnimStartMs?: number;
  hurtUntilMs?: number;
  prevHealth?: number;
  displayName?: string; // "Enemy N" — set at game start for combat log
}

export enum GameState {
  LOADING = 'loading',
  MENU = 'menu',
  OPTIONS = 'options',
  TERRAIN_TOOL = 'terrain_tool',
  LAYER_TOOL = 'layer_tool',
  SETUP = 'setup',
  PLAYING = 'playing',
  AFTERMATH = 'aftermath',
  PAUSED = 'paused',
  EQUIPMENT_MENU = 'equipment_menu',
  GAME_OVER_DELAY = 'game_over_delay',
  GAME_OVER = 'game_over',
  WIN_DELAY = 'win_delay',
  WIN = 'win',
}

export interface LayerFrameOffset {
  hand: { x: number; y: number };
  fruit: { x: number; y: number };
  overlay: { x: number; y: number };
  aboveFruitSpriteName?: string;
  hideLayers?: string[];
}

export interface FruitConfig {
  scale: number;
  overlayZ: number; // <2 = overlay draws below fruit, >=2 = overlay draws above fruit
}

export interface LayerOffsetData {
  explosionScale: number;
  fruitConfig: Record<string, FruitConfig>;
  frames: Record<string, LayerFrameOffset>;
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
  spriteName?: string; // sprite prefix for animated overlay; undefined falls back to 'explosion'
}

export interface AftermathCallout {
  text: string;
  subtext?: string;
  startMs: number;
}

export interface DamageText {
  x: number;
  y: number;
  damage: number;
  life: number;
  isHeal?: boolean;
}

export type DamageSource = 'explosion' | 'fall';

export interface DamageEvent {
  amount: number;
  source: DamageSource;
  attackerName?: string;
  weaponName?: string;
}

export interface DamageResult {
  actualAmount: number;
  wasKilled: boolean;
  source: DamageSource;
}

export interface CombatLogEntry {
  type: 'damage' | 'fall' | 'miss' | 'pass' | 'timeout';
  attackerName: string;
  targetName: string;
  weaponName: string;
  totalDamage: number;
  wasFatal: boolean;
}

export interface Projectile {
  body?: any; // Matter.js body (for physics mode)
  x: number;
  y: number;
  trajectory?: { x: number; y: number }[]; // Precomputed positions
  trajectoryIndex?: number; // Current index in trajectory
  owner: Player | Enemy;
  bullet: Bullet;
  rootBulletName: string; // top-level weapon name; shared by all child projectiles for log grouping
  spawnTimeMs?: number; // ms timestamp of spawn, used for child projectile timer fuse
  spinRate?: number; // radians per second of constant spin for rendering
  lowSpeedSamples?: number[]; // rolling speed samples for explode_on_low_speed — avoids hang-time false trigger
}

export type BulletModifierType = 'bounce_terrain' | 'bounce_entity' | 'fuse_timer' | 'explode_on_low_speed';

export interface BounceTerrainModifier { type: 'bounce_terrain'; restitution?: number; }
export interface BounceEntityModifier { type: 'bounce_entity'; }
export interface FuseTimerModifier { type: 'fuse_timer'; ms: number; }
export interface ExplodeOnLowSpeedModifier { type: 'explode_on_low_speed'; threshold: number; }

export type BulletModifier = BounceTerrainModifier | BounceEntityModifier | FuseTimerModifier | ExplodeOnLowSpeedModifier;

export interface Bullet {
  name: string;
  weight: number;
  damage: number;
  shape: string;
  explosionShape: string;
  explosionRadius: number;
  craterRadius: number;
  speed: number;
  pushbackMultiplier?: number; // >1 increases knockback, defaults to 1
  sfxImpact?: string; // sfx-bank category to play on impact
  tier?: number; // 1 = primary, 2 = child, 3+ = cascade; default 1
  bulletSprite?: string; // in-flight sprite prefix; defaults to 'bullet'
  rotatesToVelocity?: boolean; // if true, bullet sprite rotates to match its velocity angle
  bulletRotationSpeed?: number; // constant spin in radians/second; added on top of velocity angle if both set
  explosionSprite?: string; // explosion overlay sprite prefix; defaults to 'explosion'
  heldItemSprite?: string; // composite layer: item sprite name shown in hand (e.g. 'item_banana')
  overlaySprite?: string; // composite layer: overlay sprite drawn on top (e.g. 'overlay_banana')
  childBullet?: Bullet; // recursive child definition spawned on impact
  childCount?: number; // how many children to spawn; default 1
  shotgunCount?: number; // fire N physics pellets from the barrel simultaneously (no main trajectory)
  shotgunSpreadRad?: number; // total arc width in radians; each pellet gets a random offset within ±spread/2
  modifiers?: BulletModifier[]; // optional collection of effect modifiers
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
  attack?: number; // base attack power (100 = default); scales bullet.damage as a % multiplier
  lifesteal?: number; // % of damage dealt healed back to player; set by applyEquipmentToVehicle
  weight?: number; // pushback resistance; base 10; higher = less knockback, lower = more
  shieldRadius?: number; // radius of the hit-absorbing shield in px
  shieldHealth?: number; // HP of the shield; depleted by bullet damage, breaks when reaching 0
  aimGuide?: string; // set bonus from Scout set; activates trajectory arc preview
  sfxWalk?: string; // sfx-bank category for movement loop
  sfxFire?: string; // sfx-bank category played when firing
  sfxCharge?: string; // sfx-bank category played while charging
  bulletStyle?: string; // fire mode: 'standard' | 'cluster' | future 'shotgun' | 'salvo'
  voicePack?: string; // VO character pack assigned at game start
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
  shieldHealth?: number; // HP contributed to the entity's shield
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

export interface EquipmentSet {
  id: string;
  name: string;
  bonus?: EquipmentStats;
}
