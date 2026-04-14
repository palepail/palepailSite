// monkeys.constants.ts
// Constants for the Monkeys game component

import { Bullet, Vehicle } from './monkeys.types';

export const CANVAS_WIDTH = 1200;
export const CANVAS_HEIGHT = 720;
export const CANVAS_PADDING = 32;
export const SKY_COLOR = '#87CEEB';

// Terrain
export const TERRAIN_WIDTH = 2400;
export const TERRAIN_HEIGHT = 800;
export const TERRAIN_STRIP_HEIGHT = 500;
export const GRAVITY_STRENGTH = 2;
export const WIND_BULLET_FORCE_SCALE = 0.0000024;
export const WIND_VEHICLE_FORCE_SCALE = 0.0003;
export const WIND_CHANGE_CHANCE = 0.2;
export const TERRAIN_BASE_Y_OFFSET = 380;
export const PLAYER_HOVER_HEIGHT = 10;
export const TERRAIN_SLOPE_SAMPLE_DISTANCE = 10;
export const CRATER_RADIUS = 40;
export const SPAWN_HEIGHT_OFFSET = 900;
export const FALL_THRESHOLD_OFFSET = 100;
export const TERRAIN_COLOR = '#8B4513';
export const MAX_CLIMB_ANGLE = (45 * Math.PI) / 180; // 45 degrees

// Player
export const PLAYER_START_X = 100;
export const PLAYER_START_ANGLE = 45;
export const PLAYER_START_POWER = 0;
export const PLAYER_START_HEALTH = 300;
export const PLAYER_START_MOVEMENT_FUEL = 50;
export const PLAYER_START_FACING = 1;
export const PLAYER_START_TERRAIN_ANGLE = 0;
export const PLAYER_FRICTION = 0.98;
export const PLAYER_AIR_FRICTION = 0.15;
export const KNOCKBACK_VELOCITY_SCALE = 0.45; // calibrated so travel ≈ pushDistance px (AIR_FRICTION × 3)
export const KNOCKBACK_UPWARD_SCALE = 0.3; // upward impulse fraction of push distance
export const PLAYER_RESTITUTION = 0; // no bounce on landing after knockback
export const PLAYER_DENSITY = 0.01;
export const PLAYER_MOVE_SPEED = 1.0;
export const ANGLE_ADJUST_SPEED = 100;
export const MIN_AIM_ANGLE = 25;
export const MAX_AIM_ANGLE = 60;
export const TANK_HALF_HEIGHT = 15;

// Charging system
export const MAX_CHARGE_TIME = 2500; // 1 second for full charge (faster)
export const MIN_POWER = 0;
export const MAX_POWER = 200;
export const BARREL_LENGTH = 53;
export const PROJECTILE_RADIUS = 5;
export const PROJECTILE_FRICTION = 0.01;
export const PROJECTILE_RESTITUTION = 0.8;

// Game physics
export const EXPLOSION_INITIAL_RADIUS = 10;
export const EXPLOSION_MAX_RADIUS = 60;
export const EXPLOSION_LIFETIME_FRAMES = 15;
export const EXPLOSION_EXPANSION_RATE = 4;
export const EXPLOSION_CENTER_COLOR = 'rgba(255, 255, 0, 0.8)';
export const EXPLOSION_MIDDLE_COLOR = 'rgba(255, 165, 0, 0.6)';
export const EXPLOSION_EDGE_COLOR = 'rgba(255, 0, 0, 0)';
export const EXPLOSION_OUTLINE_COLOR = 'rgba(255, 255, 255, 0.5)';
export const EXPLOSION_OUTLINE_WIDTH = 2;

// Vehicle Configurations
export const PLAYER_VEHICLE: Vehicle = {
  name: 'Monkey',
  speed: 100.0,
  power: 200,
  shape: 'tank',
  spritesheet: 'Lupin Composite.png',
  climbAngle: 45,
  fuel: 75,
  health: 300,
  attack: 100,
  minAimAngle: 25,
  maxAimAngle: 60,
  shotDelay: 100,
  sfxWalk: 'walk',
  sfxFire: 'fire',
  bullet: {
    name: 'banana',
    weight: 1,
    damage: 100,
    shape: 'circle',
    explosionShape: 'horizontal_oval',
    explosionRadius: 50,
    craterRadius: 40,
    speed: 20,
    heldItemSprite: 'item_banana',
    overlaySprite: 'overlay_banana',
    sfxImpact: 'explosion',
  },
};

const CLUSTER_FRAGMENT: Bullet = {
  name: 'banana_fragment',
  tier: 2,
  weight: 1,
  damage: 30,
  shape: 'circle',
  explosionShape: 'circle',
  explosionRadius: 30,
  craterRadius: 24,
  speed: 18,
  bulletSprite: 'cluster_fragment',
  explosionSprite: 'cluster_explosion',
  sfxImpact: 'explosion',
};

export const ZOMBIE_LUPIN_VEHICLE: Vehicle = {
  name: 'Zombie Monkey',
  speed: 100.0,
  power: 200,
  shape: 'tank',
  spritesheet: 'Zombie Lupin.png',
  climbAngle: 45,
  fuel: 75,
  health: 275,
  attack: 90,
  weight: 8,
  minAimAngle: 25,
  maxAimAngle: 60,
  shotDelay: 100,
  sfxWalk: 'walk',
  sfxFire: 'fire',
  bulletStyle: 'cluster',
  bullet: {
    name: 'banana_bunch',
    tier: 1,
    weight: 1,
    damage: 50,
    shape: 'circle',
    explosionShape: 'circle',
    explosionRadius: 50,
    craterRadius: 40,
    speed: 20,
    bulletSprite: 'cluster_bomb',
    explosionSprite: 'cluster_explosion',
    sfxImpact: 'explosion',
    childCount: 5,
    childBullet: CLUSTER_FRAGMENT,
  },
};

export interface SelectableVehicle {
  vehicle: Vehicle;
  locked: boolean;
  description?: string;
}

// All player-selectable vehicles. Only index 0 (Monkey) is currently unlocked.
export const SELECTABLE_VEHICLES: SelectableVehicle[] = [
  {
    vehicle: PLAYER_VEHICLE,
    locked: false,
    description: 'A balanced fighter with good all-round stats and a reliable blast.',
  },
  {
    vehicle: ZOMBIE_LUPIN_VEHICLE,
    locked: false,
    description: 'A lighter zombie fighter with a cluster bomb—wide area, multiple impacts.',
  },
  {
    vehicle: { ...PLAYER_VEHICLE, bullet: { ...PLAYER_VEHICLE.bullet }, name: '????' },
    locked: true,
  },
  {
    vehicle: { ...PLAYER_VEHICLE, bullet: { ...PLAYER_VEHICLE.bullet }, name: '????' },
    locked: true,
  },
  {
    vehicle: { ...PLAYER_VEHICLE, bullet: { ...PLAYER_VEHICLE.bullet }, name: '????' },
    locked: true,
  },
  {
    vehicle: { ...PLAYER_VEHICLE, bullet: { ...PLAYER_VEHICLE.bullet }, name: '????' },
    locked: true,
  },
  {
    vehicle: { ...PLAYER_VEHICLE, bullet: { ...PLAYER_VEHICLE.bullet }, name: '????' },
    locked: true,
  },
  {
    vehicle: { ...PLAYER_VEHICLE, bullet: { ...PLAYER_VEHICLE.bullet }, name: '????' },
    locked: true,
  },
];

export const DAMAGE_TEXT_LIFETIME = 60; // frames
export const DAMAGE_TEXT_RISE_SPEED = 1;
export const DAMAGE_TEXT_COLOR = '#FF2222';

export const VOICE_PACK_NAMES: string[] = ['aiai', 'gongon', 'jam', 'meemee', 'yanyan'];

// UI and Rendering Constants
export const CHARGE_BAR_WIDTH = 18;
export const CHARGE_BAR_HEIGHT = 68;
export const CHARGE_BAR_OFFSET_X = 70;
export const CHARGE_BAR_BACKGROUND_COLOR = '#333333';
export const CHARGE_BAR_BORDER_COLOR = '#FFFFFF';
export const CHARGE_BAR_BORDER_WIDTH = 1;
// Charge bar level thresholds and colours
export const CHARGE_BAR_LOW_THRESHOLD = 0.3;
export const CHARGE_BAR_HIGH_THRESHOLD = 0.7;
export const CHARGE_BAR_LOW_COLOR = '#FF4444';
export const CHARGE_BAR_MID_COLOR = '#FFFF44';
export const CHARGE_BAR_HIGH_COLOR = '#44FF44';
// Health / movement bar
export const HEALTH_BAR_BG_COLOR = '#666666';
export const HEALTH_BAR_PLAYER_COLOR = '#00FF00';
export const HEALTH_BAR_ENEMY_COLOR = '#FF0000';
export const MOVEMENT_BAR_COLOR = '#FFFF00';
// Turn queue
export const TURN_QUEUE_BG_COLOR = 'rgba(0, 0, 0, 0.7)';
export const TURN_QUEUE_CURRENT_COLOR = '#FFFF00';
export const TURN_QUEUE_PLAYER_COLOR = '#00FF00';
export const TURN_QUEUE_ENEMY_COLOR = '#FF0000';
// Tank tracks (fallback)
export const TANK_TRACK_COLOR = '#333333';
export const TANK_TRACK_INNER_COLOR = '#222222';
// Prediction paths
export const PREDICTION_PLAYER_COLOR = '#0000FF';
export const PREDICTION_ENEMY_COLOR = '#FF0000';
// Enemy fallback body colour
export const ENEMY_FALLBACK_COLOR = '#FF6B6B';
export const TANK_BODY_RADIUS = 27;
export const TANK_COLLISION_RADIUS = 22; // gameplay hitbox radius (trims sprite dead space); smaller than TANK_BODY_RADIUS which is used for rendering
export const CANNON_ARC_RADIUS = 72;
export const CANNON_ARC_COLOR = '#00ff44';
export const AIM_GUIDE_COLOR = '#666666';
export const AIM_LINE_COLOR = '#424242';
export const AIM_LINE_WIDTH = 1.5;
export const AIM_GUIDE_ANGLES = [0, Math.PI / 4, Math.PI / 2];
export const AIM_LINE_LENGTH = 72;
export const TANK_SHADOW_COLOR = 'rgba(0, 0, 0, 0.2)';
export const TANK_SHADOW_HEIGHT_RATIO = 0.3;
export const AIMING_LINE_COLOR = 'rgba(255, 255, 255, 0.7)';
export const AIMING_LINE_WIDTH = 1;
export const AIMING_LINE_DASH = [5, 5];
export const TANK_BODY_STROKE_COLOR = '#000000';
export const TANK_BODY_STROKE_WIDTH = 2;
export const TANK_TRACK_OFFSET = 3;
export const TANK_TRACK_HEIGHT = 9;
export const TANK_TRACK_DETAIL_WIDTH = 5;
export const TANK_TRACK_DETAIL_HEIGHT = 15;
export const BARREL_WIDTH = 8;
export const BARREL_COLOR = '#666666';
export const BARREL_STROKE_COLOR = '#000000';
export const BARREL_STROKE_WIDTH = 1;
export const BARREL_TIP_COLOR = '#444444';
export const BARREL_TIP_LENGTH = 5;
export const BARREL_TIP_EXTRA_HEIGHT = 3;
export const PROJECTILE_DRAW_RADIUS = 15;
export const PROJECTILE_COLOR = '#FF0000';

// Off-screen explosion margins
export const OFFSCREEN_EXPLODE_MARGIN_X = 200;
export const OFFSCREEN_EXPLODE_MARGIN_Y_BOTTOM = 400;
export const OFFSCREEN_EXPLODE_MARGIN_Y_TOP = 2000;

export const ENEMY_ASSESS_DELAY = 500;
export const ENEMY_STUCK_THRESHOLD = 1000;

// Difficulty scatter — angle (degrees) and power (fraction of maxPower) applied as ± random offset
export const DIFFICULTY_SCATTER: Record<string, { angleDeg: number; powerFrac: number }> = {
  easy: { angleDeg: 12, powerFrac: 0.18 },
  normal: { angleDeg: 6, powerFrac: 0.1 },
  hard: { angleDeg: 2, powerFrac: 0.04 },
};
