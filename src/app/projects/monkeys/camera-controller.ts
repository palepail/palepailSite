// camera-controller.ts
import * as CONST from './monkeys.constants';
import { GameState } from './monkeys.types';

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
  private readonly PROJECTILE_LERP = 0.05;
  private readonly EXPLODED_LERP = 0.05;
  private readonly RECENTER_LERP = 0.1;
  private readonly CATCHUP_LERP = 0.8;
  private readonly TRACKING_MARGIN = 150;
  private readonly MIN_TRACK_DISTANCE = 100;
  private readonly INACTIVITY_DELAY_MS = 1000;
  private readonly PREDICTION_TIME_S = 0.2;
  private readonly CATCHUP_DISTANCE_THRESHOLD = 150;
  private readonly CAMERA_Y_MIN = -500;
  private readonly CAMERA_Y_MAX = 100;
  private readonly IDLE_MODE_AUTO_FOCUS_MS = 2000;
  private hasLanded = false;
  private landingCounter = 0;
  private panTargetX: number | null = null;
  private panTargetY: number | null = null;
  private isPanning = false;
  private followTarget: any = null;
  public isFollowing = false;
  private isTrackingProjectile = false;
  private lastTrackedType: 'projectile' | 'explosion' | null = null;
  private isIdleMode = false;
  private idleModeActivityTime = Date.now();
  private isLocked = false;

  lock() {
    this.isLocked = true;
  }

  unlock() {
    this.isLocked = false;
    // Treat unlock like a drag-release so timers reset and nothing snaps back.
    this.lastActivityTime = Date.now();
    this.idleModeActivityTime = Date.now();
  }

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
    this.landingCounter = 0;
    this.lastActivityTime = Date.now();
  }

  setFollowTarget(target: any) {
    this.followTarget = target;
  }

  enableFollow() {
    this.isFollowing = true;
  }

  disableFollow() {
    this.isFollowing = false;
  }

  enableIdleMode() {
    if (!this.isIdleMode) {
      this.idleModeActivityTime = Date.now();
    }
    this.isIdleMode = true;
  }

  disableIdleMode() {
    this.isIdleMode = false;
  }

  resetIdleModeActivityTimer() {
    this.idleModeActivityTime = Date.now();
  }

  cancelPan() {
    this.isPanning = false;
    this.panTargetX = null;
    this.panTargetY = null;
  }

  panToEntity(entity: any) {
    if (!entity || !isFinite(entity.x) || !isFinite(entity.y)) return;
    this.panTargetX = entity.x - this.camera.width / 2;
    this.panTargetY = entity.y - this.camera.height * (2 / 3);
    this.panTargetX = Math.max(
      0,
      Math.min(CONST.TERRAIN_WIDTH - this.camera.width, this.panTargetX),
    );
    this.panTargetY = this.clampCameraY(this.panTargetY);
    if (
      Math.abs(this.panTargetX - this.camera.x) > 5 ||
      Math.abs(this.panTargetY - this.camera.y) > 5
    ) {
      this.isPanning = true;
    }
  }

  private getCenterTargets(entityX: number, entityY: number): { targetX: number; targetY: number } {
    const playerCenterX = entityX - this.camera.width / 2;
    const clampedX = Math.max(0, Math.min(CONST.TERRAIN_WIDTH - this.camera.width, playerCenterX));
    const playerCenterY = entityY - this.camera.height * (2 / 3);
    const clampedY = Math.max(
      -this.camera.height,
      Math.min(CONST.TERRAIN_HEIGHT - this.camera.height, playerCenterY),
    );
    return { targetX: clampedX, targetY: clampedY };
  }

  /**
   * Clamps camera Y-axis to defined bounds for manual drag and projectile tracking
   * @param y The Y coordinate to clamp
   * @returns The clamped Y coordinate
   */
  clampCameraY(y: number): number {
    return Math.max(this.CAMERA_Y_MIN, Math.min(this.CAMERA_Y_MAX, y));
  }

  private trackProjectileIfNeeded(
    projectile: any,
    aftermathImpactPos: { x: number; y: number } | null,
    playerX: number,
    playerY: number,
  ): { targetX: number; targetY: number; type: 'projectile' | 'explosion' } | null {
    let trackPos = null;
    if (projectile) {
      trackPos = projectile.position || { x: projectile.x, y: projectile.y };
    } else if (aftermathImpactPos) {
      trackPos = aftermathImpactPos;
    }
    if (!trackPos) return null;

    const distFromPlayer = Math.hypot(trackPos.x - playerX, trackPos.y - playerY);

    if (distFromPlayer > this.MIN_TRACK_DISTANCE || projectile || aftermathImpactPos) {
      if (projectile) {
        let targetX, targetY;
        if (projectile.trajectory && projectile.trajectoryIndex !== undefined) {
          const remainingSteps = projectile.trajectory.length - projectile.trajectoryIndex;
          const stepsAhead = Math.min(remainingSteps * 0.1, 12);
          const futureIndex = Math.min(
            Math.floor(projectile.trajectoryIndex + stepsAhead),
            projectile.trajectory.length - 1,
          );
          const futurePos = projectile.trajectory[futureIndex];
          targetX = futurePos.x - this.camera.width / 2;
          targetY = futurePos.y - this.camera.height / 2;
        } else if (projectile.body) {
          const predictionTime = this.PREDICTION_TIME_S;
          targetX =
            trackPos.x + projectile.body.velocity.x * predictionTime - this.camera.width / 2;
          targetY =
            trackPos.y + projectile.body.velocity.y * predictionTime - this.camera.height / 2;
        } else {
          // no prediction available, just center on current position
          targetX = trackPos.x - this.camera.width / 2;
          targetY = trackPos.y - this.camera.height / 2;
        }
        return { targetX, targetY, type: 'projectile' };
      } else {
        // For impact pos, center without prediction
        const targetX = trackPos.x - this.camera.width / 2;
        const targetY = trackPos.y - this.camera.height * (2 / 3);
        return { targetX, targetY, type: 'explosion' };
      }
    }
    return null;
  }

  private recenterCameraIfNeeded(
    playerX: number,
    playerY: number,
    projectile: any | null,
    isDragging: boolean,
    currentTurnEntity: any,
  ): { targetX: number; targetY: number } | null {
    if (currentTurnEntity?.turnState === 'bullet_in_flight') return null;

    const turnEntityX = currentTurnEntity?.x ?? playerX;
    const turnEntityY = currentTurnEntity?.y ?? playerY;
    const turnEntityCenterX = turnEntityX - this.camera.width / 2;
    const clampedTurnEntityCenterX = Math.max(
      0,
      Math.min(CONST.TERRAIN_WIDTH - this.camera.width, turnEntityCenterX),
    );

    if (
      !projectile &&
      Date.now() - this.lastActivityTime > this.INACTIVITY_DELAY_MS &&
      !isDragging &&
      (Math.abs(this.camera.x - clampedTurnEntityCenterX) > this.RECENTER_DISTANCE_THRESHOLD ||
        Math.abs(this.camera.y - (turnEntityY - this.camera.height * (2 / 3))) >
          this.RECENTER_DISTANCE_THRESHOLD)
    ) {
      return this.getCenterTargets(turnEntityX, turnEntityY);
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
    currentTurnEntity: any,
    aftermathImpactPos: { x: number; y: number } | null,
  ) {
    // When locked only drag is allowed (drag is handled directly in the component).
    if (this.isLocked) return;

    if (!isDragging && this.previousIsDragging) {
      this.lastActivityTime = Date.now();
      this.idleModeActivityTime = Date.now();
    }
    this.previousIsDragging = isDragging;

    if (isDragging) {
      this.idleModeActivityTime = Date.now();
      // Manual camera drag should always override existing pan targets.
      this.cancelPan();
    }

    let targetX = this.camera.x;
    let targetY = this.camera.y;
    let isFollowingFall = false;

    // Follow target if enabled (high priority, but allow manual override)
    if (this.isFollowing && this.followTarget && !isDragging && !projectile && !this.isPanning) {
      const targets = this.getCenterTargets(this.followTarget.x, this.followTarget.y);
      targetX = targets.targetX;
      targetY = targets.targetY;
    }

    // Update activity time
    if (Math.abs(playerVelocityX) > 0.1 || isCharging || isAdjustingAngle || isDragging) {
      this.lastActivityTime = Date.now();
    }

    // Follow player when falling at game start
    if (
      !this.hasLanded &&
      (currentState === GameState.SETUP ||
        currentState === GameState.PLAYING ||
        currentState === GameState.AFTERMATH) &&
      !isDragging &&
      !projectile
    ) {
      const targets = this.getCenterTargets(playerX, playerY);
      targetX = targets.targetX;
      targetY = targets.targetY;
      isFollowingFall = true;
      if (playerBody && playerBody.velocity.y <= 0.1) {
        this.landingCounter++;
        if (this.landingCounter > 10) {
          this.hasLanded = true;
        }
      } else {
        this.landingCounter = 0;
      }
    }

    // Track projectile if needed
    let projectileTargets: {
      targetX: number;
      targetY: number;
      type: 'projectile' | 'explosion';
    } | null = null;

    // Projectile/explosion tracking takes priority over panning, but don't cancel the
    // pending pan — just suppress it until tracking ends so the camera returns to the
    // turn entity once the explosion clears.
    const hasActiveTracking = !!(projectile || aftermathImpactPos);

    // If we have an impact position (aftermath), track it directly
    if (!projectile && aftermathImpactPos) {
      projectileTargets = {
        targetX: aftermathImpactPos.x - this.camera.width / 2,
        targetY: aftermathImpactPos.y - this.camera.height * (2 / 3),
        type: 'explosion',
      };
    } else {
      projectileTargets = this.trackProjectileIfNeeded(
        projectile,
        aftermathImpactPos,
        playerX,
        playerY,
      );
    }

    if (projectileTargets) {
      if (!this.isTrackingProjectile || this.lastTrackedType !== projectileTargets.type) {
        this.isTrackingProjectile = true;
        this.lastTrackedType = projectileTargets.type;
      }
      targetX = projectileTargets.targetX;
      targetY = projectileTargets.targetY;
    } else {
      if (this.isTrackingProjectile) {
        this.isTrackingProjectile = false;
        this.lastTrackedType = null;
      }
    }

    // Pan to entity if panning and no active projectile/explosion tracking
    if (
      this.isPanning &&
      !hasActiveTracking &&
      this.panTargetX !== null &&
      this.panTargetY !== null &&
      isFinite(this.panTargetX) &&
      isFinite(this.panTargetY)
    ) {
      targetX = this.panTargetX;
      targetY = this.panTargetY;
      // Check if close enough
      if (
        Math.abs(this.camera.x - this.panTargetX) < 5 &&
        Math.abs(this.camera.y - this.panTargetY) < 5
      ) {
        this.isPanning = false;
        this.panTargetX = null;
        this.panTargetY = null;
      }
    }

    let shouldAutoFocusInIdleMode = false;
    if (
      this.isIdleMode &&
      !isDragging &&
      !this.isPanning &&
      !projectile &&
      !aftermathImpactPos &&
      Date.now() - this.idleModeActivityTime >= this.IDLE_MODE_AUTO_FOCUS_MS
    ) {
      const focusEntityX = currentTurnEntity?.x ?? playerX;
      const focusEntityY = currentTurnEntity?.y ?? playerY;
      const focusTargets = this.getCenterTargets(focusEntityX, focusEntityY);
      targetX = focusTargets.targetX;
      targetY = focusTargets.targetY;
      shouldAutoFocusInIdleMode = true;
    }

    // Determine if we're currently recentering
    const isRecentering = shouldAutoFocusInIdleMode;

    // Smooth camera movement with variable lerp
    let lerpFactor = this.DEFAULT_LERP; // Default smooth lerp
    if (projectile) {
      lerpFactor = this.PROJECTILE_LERP; // Smooth lerp for projectile tracking
    } else if (aftermathImpactPos) {
      lerpFactor = this.EXPLODED_LERP; // Slower lerp for aftermath impact tracking
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

    // Clamp to world bounds (standardized clamping for consistent behavior)
    this.camera.x = Math.max(0, Math.min(CONST.TERRAIN_WIDTH - this.camera.width, this.camera.x));
    this.camera.y = this.clampCameraY(this.camera.y);
  }

  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    return { x: worldX - this.camera.x, y: worldY - this.camera.y };
  }
}

export { CameraController };
