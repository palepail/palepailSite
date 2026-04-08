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
  private world: any;
  private runner: any;

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
    this.world = this.engine.world;
    this.engine.world.gravity.y = CONST.GRAVITY_STRENGTH;

    this.runner = this.Runner.create();
    this.Runner.run(this.runner, this.engine);
  }

  simulateTrajectory(
    startX: number,
    startY: number,
    angleRad: number,
    power: number,
    bullet: any,
    windSpeed = 0,
    windAngle = 0,
  ): { positions: { x: number; y: number }[]; endReason: string } {
    const cacheKey = `${startX.toFixed(1)}_${startY.toFixed(1)}_${angleRad.toFixed(3)}_${power.toFixed(1)}_${bullet.name}_${windSpeed.toFixed(0)}_${windAngle.toFixed(2)}`;
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

    while (step < maxSteps) {
      // Record position
      positions.push({ x: projectile.position.x, y: projectile.position.y });

      // Apply wind force (horizontal only, capped at 75% effective strength)
      this.Body.applyForce(projectile, projectile.position, {
        x: (windSpeed * 0.75 * CONST.WIND_BULLET_FORCE_SCALE * Math.cos(windAngle)) / bullet.weight,
        y: 0,
      });

      // Update simulation
      this.Engine.update(tempEngine, 16.666); // ~60 FPS

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

    const fromX = target.x;
    const targetX = Math.max(
      0,
      Math.min(CONST.TERRAIN_WIDTH, target.x + hSign * pushDistance * xFactor),
    );
    // Keep Y unchanged — terrain collision will snap the entity back to the surface next frame.
    this.Body.setPosition(target.body, { x: targetX, y: target.y });
    if (target.body.velocity) {
      this.Body.setVelocity(target.body, {
        x: hSign * pushDistance * xFactor * 0.05,
        y: target.body.velocity.y,
      });
    }
    target.x = targetX;
    target.pushbackFromX = fromX;
    target.pushbackToX = targetX;
    target.pushbackStartMs = Date.now();
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
