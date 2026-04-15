import { Injectable } from '@angular/core';
import { Player, Enemy } from './monkeys.types';
import * as CONST from './monkeys.constants';

@Injectable({
  providedIn: 'root',
})
export class PhysicsService {
  // Matter.js functions (passed from component)
  public Engine: any;
  public Runner: any;
  public Bodies: any;
  public World: any;
  public Events: any;
  public Body: any;
  public Composite: any;

  // Game state
  private engine: any;
  private _world: any;
  private runner: any;

  get world(): any {
    return this._world;
  }

  // Trajectory cache
  private trajectoryCache: Map<
    string,
    { positions: { x: number; y: number }[]; endReason: string }
  > = new Map();

  windSpeed: number = 0;
  windAngle: number = 0;

  private readonly VEHICLE_NO_COLLISION_GROUP = -1;

  setMatterJS(matter: any) {
    this.Engine = matter.Engine;
    this.Runner = matter.Runner;
    this.Bodies = matter.Bodies;
    this.World = matter.World;
    this.Events = matter.Events;
    this.Body = matter.Body;
    this.Composite = matter.Composite;
  }

  initPhysics() {
    this.engine = this.Engine.create();
    this._world = this.engine.world;
    this.engine.world.gravity.y = CONST.GRAVITY_STRENGTH;
    // Physics is stepped manually via stepPhysics() in the game loop.
    // Using Runner.run (its own rAF tick) caused the engine to advance multiple times
    // between game-loop terrain checks, allowing projectiles to tunnel through terrain.
  }

  stepPhysics(deltaMs: number): void {
    if (!this.engine) return;
    // Always step with the fixed 16.667 ms timestep Matter.js expects.
    // Run multiple steps if the real elapsed time exceeds one frame, and cap
    // at 3 steps so a backgrounded tab can't cause a physics explosion on return.
    const FIXED_STEP = 1000 / 60;
    const steps = Math.min(Math.round(deltaMs / FIXED_STEP), 3);
    for (let i = 0; i < steps; i++) {
      this.Engine.update(this.engine, FIXED_STEP);
    }
  }

  simulateTrajectory(
    startX: number,
    startY: number,
    angleRad: number,
    power: number,
    bullet: any,
    windSpeed = 0,
    windAngle = 0,
    terrain?: number[][],
  ): { positions: { x: number; y: number }[]; endReason: string } {
    const cacheKey = `${startX.toFixed(1)}_${startY.toFixed(1)}_${angleRad.toFixed(3)}_${power.toFixed(1)}_${bullet.name}_${windSpeed.toFixed(0)}_${windAngle.toFixed(2)}_b${bullet.maxBounces ?? 0}`;
    if (this.trajectoryCache.has(cacheKey)) {
      return this.trajectoryCache.get(cacheKey)!;
    }

    const tempEngine = this.Engine.create();
    tempEngine.world.gravity.y = CONST.GRAVITY_STRENGTH;

    const velocity = (power / 100) * bullet.speed;
    const vx = Math.cos(angleRad) * velocity;
    const vy = -Math.sin(angleRad) * velocity;

    const projectile = this.Bodies.circle(startX, startY, CONST.PROJECTILE_RADIUS, {
      friction: CONST.PROJECTILE_FRICTION,
      restitution: CONST.PROJECTILE_RESTITUTION,
      frictionAir: 0,
    });
    this.Body.setVelocity(projectile, { x: vx, y: vy });
    this.World.add(tempEngine.world, projectile);

    const positions: { x: number; y: number }[] = [];
    let endReason = 'timeout';
    const maxSteps = 1000;
    let step = 0;
    let bouncesLeft = bullet.maxBounces ?? 0;
    const terrainBaseY = CONST.CANVAS_HEIGHT - CONST.TERRAIN_BASE_Y_OFFSET;

    while (step < maxSteps) {
      const prevX = projectile.position.x;
      const prevY = projectile.position.y;

      // Record position
      positions.push({ x: prevX, y: prevY });

      // Apply wind force (horizontal only, capped at 75% effective strength)
      this.Body.applyForce(projectile, projectile.position, {
        x: (windSpeed * 0.75 * CONST.WIND_BULLET_FORCE_SCALE * Math.cos(windAngle)) / bullet.weight,
        y: 0,
      });

      // Update simulation
      this.Engine.update(tempEngine, 16.666); // ~60 FPS

      // Terrain bounce / stop detection (only when terrain data is provided)
      if (terrain) {
        const newX = projectile.position.x;
        const newY = projectile.position.y;
        const segDx = newX - prevX;
        const segDy = newY - prevY;
        const segLen = Math.sqrt(segDx * segDx + segDy * segDy);
        const steps = Math.ceil(segLen);
        let terrainHit = false;
        let hitX = newX;
        let hitY = newY;

        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const sx = Math.floor(prevX + segDx * t);
          const sy = Math.floor(prevY + segDy * t);
          const localY = sy - terrainBaseY;
          if (
            sx >= 0 &&
            sx < CONST.TERRAIN_WIDTH &&
            localY >= 0 &&
            localY < (terrain[sx]?.length ?? 0) &&
            terrain[sx][localY] === 1
          ) {
            hitX = sx;
            hitY = sy;
            terrainHit = true;
            break;
          }
        }

        if (terrainHit) {
          if (bouncesLeft > 0) {
            // Find terrain surface at hitX: scan upward
            let surfaceLocalY = Math.floor(hitY - terrainBaseY);
            while (surfaceLocalY > 0 && terrain[Math.floor(hitX)]?.[surfaceLocalY - 1] === 1) {
              surfaceLocalY--;
            }
            const surfaceY = terrainBaseY + surfaceLocalY - CONST.PROJECTILE_RADIUS - 1;
            this.Body.setPosition(projectile, { x: projectile.position.x, y: surfaceY });
            const vel = projectile.velocity;
            // Reflect vertical velocity with restitution, preserve horizontal
            this.Body.setVelocity(projectile, { x: vel.x, y: -Math.abs(vel.y) * 0.7 });
            bouncesLeft--;
          } else {
            // No bounces left — end trajectory here
            positions.push({ x: hitX, y: hitY });
            endReason = 'terrain';
            break;
          }
        }
      }

      step++;
    }

    // Clean up
    this.World.remove(tempEngine.world, projectile);

    const result = { positions, endReason };
    this.trajectoryCache.set(cacheKey, result);
    return result;
  }

  clearTrajectoryCache() {
    this.trajectoryCache.clear();
  }

  createEntity(entity: Player | Enemy, x: number, y: number) {
    entity.x = x;
    entity.y = y;
    entity.terrainAngle = 0; // Will be set later
    entity.body = this.Bodies.rectangle(x, y, 30, 30, {
      friction: CONST.PLAYER_FRICTION,
      frictionAir: CONST.PLAYER_AIR_FRICTION,
      restitution: CONST.PLAYER_RESTITUTION,
      density: CONST.PLAYER_DENSITY,
      collisionFilter: { group: this.VEHICLE_NO_COLLISION_GROUP },
    });
    this.World.add(this.world, entity.body);
  }

  updateEntityPhysics(entity: Player | Enemy) {
    if (entity.body) {
      entity.x = entity.body.position.x;
      entity.y = entity.body.position.y;
      // Clamp horizontal position to terrain bounds
      entity.x = Math.max(0, Math.min(CONST.TERRAIN_WIDTH, entity.x));
      this.Body.setPosition(entity.body, { x: entity.x, y: entity.y });
      // Update terrain angle
      // Note: terrainAngle is updated in CollisionService
      // Smoothly interpolate angle toward target
      if (entity.targetAngle !== undefined) {
        const diff = entity.targetAngle - entity.angle;
        entity.angle += diff * 0.1; // 10% interpolation per frame
      }
      // Wind force for vehicles is applied in MonkeysGameService.applyWindToEntity(),
      // which has access to CollisionService for slope-aware gating.
    }
  }

  applyExplosionKnockback(
    target: Player | Enemy,
    explosionX: number,
    explosionY: number,
    projectile: any,
    radiusX: number,
    radiusY: number,
  ) {
    if (!target.body) return;
    const dx = target.x - explosionX;
    const dy = target.y - explosionY;
    const normalizedDist = Math.sqrt((dx / radiusX) ** 2 + (dy / radiusY) ** 2);
    if (normalizedDist > 1) return;
    const maxPushDistance = (projectile.bullet.explosionRadius || Math.max(radiusX, radiusY)) * 0.3;
    const pushMultiplier = projectile.bullet.pushbackMultiplier ?? 1;
    const weightFactor = 10 / Math.max(1, target.vehicle?.weight ?? 10);
    const pushDistance =
      maxPushDistance * (1 - normalizedDist) * Math.abs(pushMultiplier) * weightFactor;
    if (pushDistance <= 0) return;

    // Push is ground-relative: only move the entity horizontally along the terrain.
    // Use the horizontal sign of dx (away from explosion center) scaled by the slope.
    const hSign = (dx !== 0 ? Math.sign(dx) : 0) * (pushMultiplier < 0 ? -1 : 1);

    // Reduce push when being shoved into a steep uphill slope.
    // target.terrainAngle is atan(slope) in radians; positive = terrain rises to the right.
    const slopeInPushDir = hSign * target.terrainAngle;
    let xFactor = 1.0;
    if (slopeInPushDir > 0) {
      const slopeAngleDeg = Math.abs(target.terrainAngle) * (180 / Math.PI);
      // Full push up to 45°; linear falloff from 45°→80°; zero at 80°+
      xFactor = slopeAngleDeg >= 80 ? 0 : Math.max(0, 1 - Math.max(0, slopeAngleDeg - 45) / 35);
    }

    // Apply velocity impulse — terrain collision naturally stops the entity at walls.
    // Small upward component lets the entity crest crater rims instead of burrowing.
    if (target.body.velocity) {
      this.Body.setVelocity(target.body, {
        x: hSign * pushDistance * xFactor * CONST.KNOCKBACK_VELOCITY_SCALE,
        y: -pushDistance * xFactor * CONST.KNOCKBACK_UPWARD_SCALE,
      });
    }
    target.entityState = 'pushback';
  }

  pausePhysics() {
    if (this.runner) {
      // Note: Matter.js Runner doesn't have a direct pause, but we can stop it
      this.Runner.stop(this.runner);
    }
  }

  removeBody(body: any): void {
    if (this.world && body) {
      this.World.remove(this.world, body);
    }
  }

  resumePhysics() {
    if (this.runner) {
      this.Runner.run(this.runner, this.engine);
    }
  }
}
