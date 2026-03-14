// monkeys.constants.ts
// Constants for the Monkeys game component

import { Vehicle } from './monkeys.types';

export const CANVAS_WIDTH = 1200;
export const CANVAS_HEIGHT = 720;
export const CANVAS_PADDING = 32;
export const SKY_COLOR = '#87CEEB';

// Terrain
export const TERRAIN_WIDTH = 2400;
export const TERRAIN_HEIGHT = 800;
export const TERRAIN_STRIP_HEIGHT = 500;
export const TERRAIN_SMOOTHING_WEIGHT = 2;
export const TERRAIN_SMOOTHING_DIVISOR = 4;
export const GRAVITY_STRENGTH = 2;
export const WIND_STRENGTH = 0;
export const TERRAIN_BASE_Y_OFFSET = 380;
export const PLAYER_HOVER_HEIGHT = 10;
export const TERRAIN_SLOPE_SAMPLE_DISTANCE = 10;
export const CRATER_RADIUS = 40;
export const TERRAIN_SNAP_TOLERANCE = 20;
export const SPAWN_HEIGHT_OFFSET = 900;
export const FALL_THRESHOLD_OFFSET = 500;
export const TERRAIN_COLOR = '#8B4513';
export const TERRAIN_DETAIL_COLOR = 'rgba(139, 69, 19, 0.4)';
export const TERRAIN_DETAIL_COUNT = 30;
export const TERRAIN_DETAIL_SIZE_MIN = 1;
export const TERRAIN_DETAIL_SIZE_MAX = 4;
export const MAX_CLIMB_ANGLE = (45 * Math.PI) / 180; // 45 degrees

// Player
export const PLAYER_START_X = 100;
export const PLAYER_START_ANGLE = 45;
export const PLAYER_START_POWER = 0;
export const PLAYER_START_HEALTH = 100;
export const PLAYER_START_MOVEMENT_FUEL = 50;
export const PLAYER_START_FACING = 1;
export const PLAYER_START_TERRAIN_ANGLE = 0;
export const PLAYER_FRICTION = 0.98;
export const PLAYER_AIR_FRICTION = 0.15;
export const PLAYER_RESTITUTION = 0.05;
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
export const MAX_PROJECTILE_VELOCITY = 20;
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
export const EXPLOSION_DAMAGE_MAX = 50;
export const EXPLOSION_DAMAGE_RANGE = 100;

// Vehicle Configurations
export const PLAYER_VEHICLE: Vehicle = {
  speed: 100.0,
  power: 200,
  shape: 'tank',
  spritesheet: 'Lupin.png',
  climbAngle: 45,
  fuel: 75,
  health: 100,
  minAimAngle: 25,
  maxAimAngle: 60,
  shotDelay: 100,
  bullet: {
    damage: 100,
    shape: 'circle',
    explosionShape: 'horizontal_oval',
    explosionRadius: 50,
    craterRadius: 40,
    speed: 20,
  },
};

export const ENEMY_VEHICLE: Vehicle = {
  speed: 95.0,
  power: 200,
  shape: 'enemy_tank',
  spritesheet: 'Lupin.png',
  climbAngle: 45,
  fuel: 75,
  health: 80,
  minAimAngle: 20,
  maxAimAngle: 75,
  shotDelay: 100,
  bullet: {
    damage: 40,
    shape: 'circle',
    explosionShape: 'circle',
    explosionRadius: 40,
    craterRadius: 30,
    speed: 20,
  },
};
export const DAMAGE_TEXT_LIFETIME = 60; // frames
export const DAMAGE_TEXT_RISE_SPEED = 1;
export const DAMAGE_TEXT_FONT = '20px Arial';
export const DAMAGE_TEXT_COLOR = 'red';

// UI and Rendering Constants
export const CHARGE_BAR_WIDTH = 18;
export const CHARGE_BAR_HEIGHT = 68;
export const CHARGE_BAR_OFFSET_X = 70;
export const CHARGE_BAR_BACKGROUND_COLOR = '#333333';
export const CHARGE_BAR_BORDER_COLOR = '#FFFFFF';
export const CHARGE_BAR_BORDER_WIDTH = 1;
export const CHARGE_BAR_FONT = '10px Arial';
export const CHARGE_BAR_TEXT_OFFSET_Y = 8;
export const TANK_BODY_RADIUS = 27;
export const CANNON_ARC_RADIUS = 60;
export const CANNON_ARC_COLOR = '#2f1cff';
export const AIM_GUIDE_COLOR = '#808080';
export const AIM_LINE_COLOR = '#232323';
export const AIM_LINE_WIDTH = 1;
export const AIM_GUIDE_ANGLES = [0, Math.PI / 4, Math.PI / 2];
export const AIM_LINE_LENGTH = 60;
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
export const UI_TEXT_COLOR = '#FFFFFF';
export const UI_FONT = '16px Arial';
export const UI_TEXT_X = 10;
export const UI_ANGLE_Y = 30;
export const UI_POWER_Y = 50;
export const UI_HEALTH_Y = 70;
export const UI_MOVEMENT_Y = 90;
export const UI_TERRAIN_ANGLE_Y = 110;
export const UI_ANGLE_DECIMALS = 1;

// Off-screen explosion margins
export const OFFSCREEN_EXPLODE_MARGIN_X = 200;
export const OFFSCREEN_EXPLODE_MARGIN_Y_BOTTOM = 400;
export const OFFSCREEN_EXPLODE_MARGIN_Y_TOP = 2000;

export const ENEMY_ASSESS_DELAY = 500;
export const ENEMY_STUCK_THRESHOLD = 1000;
