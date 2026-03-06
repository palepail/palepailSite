// camera-controller.ts
import * as CONST from './terrablast.constants';
import { GameState } from './terrablast.types';

interface Camera {
  x: number;
  y: number;
  width: number;
  height: number;
}

class CameraController {
  camera: Camera;
  public lastActivityTime = Date.now();
  private previousIsDragging = false;
  private readonly RECENTER_DISTANCE_THRESHOLD = 10;
  private readonly DEFAULT_LERP = 0.02;
  private readonly PROJECTILE_LERP = 0.06;
  private readonly RECENTER_LERP = 0.1;
  private readonly CATCHUP_LERP = 0.8;
  private readonly TRACKING_MARGIN = 150;
  private readonly MIN_TRACK_DISTANCE = 100;
  private readonly INACTIVITY_DELAY_MS = 1000;
  private readonly PREDICTION_TIME_S = 1.5;
  private readonly CATCHUP_DISTANCE_THRESHOLD = 150;
  private hasLanded = false;
  private panTargetX: number | null = null;
  private panTargetY: number | null = null;
  private isPanning = false;

  constructor() {
    const initialPlayerY =
      CONST.CANVAS_HEIGHT -
      CONST.TERRAIN_BASE_Y_OFFSET -
      CONST.PLAYER_HOVER_HEIGHT -
      CONST.SPAWN_HEIGHT_OFFSET;
    const initialCameraY = initialPlayerY - (CONST.CANVAS_HEIGHT * 2) / 3;
    this.camera = {
      x: 0,
      y: initialCameraY,
      width: CONST.CANVAS_WIDTH,
      height: CONST.CANVAS_HEIGHT,
    };
  }

  reset() {
    this.hasLanded = false;
    this.lastActivityTime = Date.now();
  }

  panToEntity(entity: any) {
    if (!entity || !isFinite(entity.x) || !isFinite(entity.y)) return;
    this.panTargetX = entity.x - this.camera.width / 2;
    this.panTargetY = entity.y - this.camera.height * (2 / 3);
    this.panTargetX = Math.max(0, Math.min(CONST.TERRAIN_WIDTH - this.camera.width, this.panTargetX));
    this.panTargetY = Math.max(-this.camera.height, Math.min(CONST.TERRAIN_HEIGHT - this.camera.height, this.panTargetY));
    this.isPanning = true;
  }

  private getCenterTargets(playerX: number, playerY: number): { targetX: number; targetY: number } {
    const playerCenterX = playerX - this.camera.width / 2;
    const clampedX = Math.max(0, Math.min(CONST.TERRAIN_WIDTH - this.camera.width, playerCenterX));
    const playerCenterY = playerY - this.camera.height * (2 / 3);
    const clampedY = Math.max(
      -this.camera.height,
      Math.min(CONST.TERRAIN_HEIGHT - this.camera.height, playerCenterY),
    );
    return { targetX: clampedX, targetY: clampedY };
  }

  private trackProjectileIfNeeded(
    projectile: any,
    playerX: number,
    playerY: number,
  ): { targetX: number; targetY: number } | null {
    if (!projectile) return null;

    const screenX = projectile.position.x - this.camera.x;
    const screenY = projectile.position.y - this.camera.y;
    const margin = this.TRACKING_MARGIN;
    const distFromPlayer = Math.hypot(
      projectile.position.x - playerX,
      projectile.position.y - playerY,
    );

    if (
      distFromPlayer > this.MIN_TRACK_DISTANCE &&
      (screenX < margin ||
        screenX > this.camera.width - margin ||
        screenY < margin ||
        screenY > this.camera.height - margin)
    ) {
      const predictionTime = this.PREDICTION_TIME_S;
      const targetX =
        projectile.position.x + projectile.velocity.x * predictionTime - this.camera.width / 2;
      const targetY =
        projectile.position.y + projectile.velocity.y * predictionTime - this.camera.height / 2;
      return { targetX, targetY };
    }
    return null;
  }

  private recenterCameraIfNeeded(
    playerX: number,
    playerY: number,
    projectile: any | null,
    isDragging: boolean,
  ): { targetX: number; targetY: number } | null {
    const playerCenterX = playerX - this.camera.width / 2;
    const clampedPlayerCenterX = Math.max(
      0,
      Math.min(CONST.TERRAIN_WIDTH - this.camera.width, playerCenterX),
    );

    if (
      !projectile &&
      Date.now() - this.lastActivityTime > this.INACTIVITY_DELAY_MS &&
      !isDragging &&
      (Math.abs(this.camera.x - clampedPlayerCenterX) > this.RECENTER_DISTANCE_THRESHOLD ||
        Math.abs(this.camera.y - (playerY - this.camera.height * (2 / 3))) >
          this.RECENTER_DISTANCE_THRESHOLD)
    ) {
      return this.getCenterTargets(playerX, playerY);
    }
    return null;
  }

  update(
    playerX: number,
    playerY: number,
    playerVelocityX: number,
    isCharging: boolean,
    projectile: any | null,
    isDragging: boolean,
    isAdjustingAngle: boolean,
    currentState: GameState,
    playerBody: any,
  ) {
    if (!isDragging && this.previousIsDragging) {
      this.lastActivityTime = Date.now();
    }
    this.previousIsDragging = isDragging;
    let targetX = this.camera.x;
    let targetY = this.camera.y;
    let isFollowingFall = false;

    // Update activity time
    if (Math.abs(playerVelocityX) > 0.1 || isCharging || isAdjustingAngle || isDragging) {
      this.lastActivityTime = Date.now();
    }

    // Follow player when falling at game start
    if (!this.hasLanded && currentState === GameState.PLAYING && !isDragging && !projectile) {
      const targets = this.getCenterTargets(playerX, playerY);
      targetX = targets.targetX;
      targetY = targets.targetY;
      isFollowingFall = true;
      if (playerBody && playerBody.velocity.y <= 0.1) {
        this.hasLanded = true;
      }
    }

    // Recenter on player if moving or charging (horizontal only, vertical to default)
    if (Math.abs(playerVelocityX) > 0.1 || isCharging) {
      const targets = this.getCenterTargets(playerX, playerY);
      targetX = targets.targetX;
      targetY = targets.targetY;
    }

    // Pan back to player after delay if inactive
    const recenterTargets = this.recenterCameraIfNeeded(playerX, playerY, projectile, isDragging);
    if (recenterTargets) {
      targetX = recenterTargets.targetX;
      targetY = recenterTargets.targetY;
    }

    // Track projectile if needed
    const projectileTargets = this.trackProjectileIfNeeded(projectile, playerX, playerY);
    if (projectileTargets) {
      targetX = projectileTargets.targetX;
      targetY = projectileTargets.targetY;
    }

    // Pan to entity if panning
    if (this.isPanning && this.panTargetX !== null && this.panTargetY !== null && isFinite(this.panTargetX) && isFinite(this.panTargetY)) {
      targetX = this.panTargetX;
      targetY = this.panTargetY;
      // Check if close enough
      if (Math.abs(this.camera.x - this.panTargetX) < 5 && Math.abs(this.camera.y - this.panTargetY) < 5) {
        this.isPanning = false;
        this.panTargetX = null;
        this.panTargetY = null;
      }
    }

    // Determine if we're currently recentering
    const isRecentering = recenterTargets !== null;

    // Smooth camera movement with variable lerp
    let lerpFactor = this.DEFAULT_LERP; // Default smooth lerp
    if (projectile) {
      lerpFactor = this.PROJECTILE_LERP; // Smooth lerp for projectile tracking
    } else if (this.isPanning) {
      lerpFactor = this.RECENTER_LERP; // Smooth lerp for panning
    } else if (isRecentering) {
      lerpFactor = this.RECENTER_LERP; // Smooth lerp for recentering
    } else if (isFollowingFall) {
      lerpFactor = 0.2; // Smooth follow for fall
    } else if (
      Math.abs(targetX - this.camera.x) > this.CATCHUP_DISTANCE_THRESHOLD ||
      Math.abs(targetY - this.camera.y) > this.CATCHUP_DISTANCE_THRESHOLD
    ) {
      lerpFactor = this.CATCHUP_LERP; // Faster lerp when catching up otherwise
    }
    if (!isFinite(targetX)) targetX = this.camera.x;
    if (!isFinite(targetY)) targetY = this.camera.y;
    this.camera.x += (targetX - this.camera.x) * lerpFactor;
    this.camera.y += (targetY - this.camera.y) * lerpFactor;

    // Clamp to world bounds (allow camera to go above terrain for projectiles)
    this.camera.x = Math.max(0, Math.min(CONST.TERRAIN_WIDTH - this.camera.width, this.camera.x));
    this.camera.y = Math.max(
      -this.camera.height,
      Math.min(CONST.TERRAIN_HEIGHT - this.camera.height, this.camera.y),
    );
  }

  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    return { x: worldX - this.camera.x, y: worldY - this.camera.y };
  }

  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return { x: screenX + this.camera.x, y: screenY + this.camera.y };
  }
}

export { CameraController };
