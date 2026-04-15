import { Injectable, inject } from '@angular/core';
import { Player, Enemy, Projectile, Explosion, DamageText, FuseTimerModifier, ExplodeOnLowSpeedModifier } from './monkeys.types';
import * as CONST from './monkeys.constants';
import { MonkeysSfxService } from './monkeys-sfx.service';
import { DamageService } from './damage.service';
import { ImpactService } from './impact.service';

@Injectable({
  providedIn: 'root',
})
export class ProjectileService {
  private damageService = inject(DamageService);
  private impactService = inject(ImpactService);

  constructor(private sfxService: MonkeysSfxService) {}

  projectile: Projectile | null = null;
  childProjectiles: Projectile[] = [];
  lastImpactPos: { x: number; y: number } | null = null;

  get explosions() {
    return this.impactService.explosions;
  }

  isProjectileInFlight(): boolean {
    return this.projectile !== null || this.childProjectiles.length > 0;
  }

  get damageTexts(): DamageText[] {
    return this.damageService.damageTexts;
  }

  updateTrajectoryProjectile(
    terrain: number[][],
    physicsService: any,
    player: Player,
    enemies: Enemy[],
    depthTerrain?: number[][],
  ) {
    if (!this.projectile) return;

    // Physics-primary projectile (e.g. apple) — delegate to separate update
    if (this.projectile.body && !this.projectile.trajectory) {
      this.updatePhysicsPrimaryProjectile(terrain, physicsService, player, enemies, depthTerrain);
      return;
    }

    if (
      !this.projectile.trajectory ||
      this.projectile.trajectoryIndex === undefined
    )
      return;

    const index = this.projectile.trajectoryIndex;
    const positions = this.projectile.trajectory;

    if (index >= positions.length) {
      this.destroyTrajectoryProjectile(terrain, player, enemies, physicsService, depthTerrain);
      return;
    }

    // Set position to current trajectory point
    const prevX = this.projectile.x;
    const prevY = this.projectile.y;
    this.projectile.x = positions[index].x;
    this.projectile.y = positions[index].y;

    // Check if projectile went off game area
    if (
      this.projectile.x < -CONST.OFFSCREEN_EXPLODE_MARGIN_X ||
      this.projectile.x > CONST.TERRAIN_WIDTH + CONST.OFFSCREEN_EXPLODE_MARGIN_X ||
      this.projectile.y > CONST.TERRAIN_HEIGHT + CONST.OFFSCREEN_EXPLODE_MARGIN_Y_BOTTOM ||
      this.projectile.y < -CONST.OFFSCREEN_EXPLODE_MARGIN_Y_TOP
    ) {
      this.destroyTrajectoryProjectile(terrain, player, enemies, physicsService, depthTerrain);
      return;
    }

    // Sweep the segment from previous position to current position to catch tunneling
      const terrainY = CONST.CANVAS_HEIGHT - CONST.TERRAIN_BASE_Y_OFFSET;
      const segDx = this.projectile.x - prevX;
      const segDy = this.projectile.y - prevY;
      const segLen = Math.sqrt(segDx * segDx + segDy * segDy);
      const steps = Math.ceil(segLen);
      let hitX = this.projectile.x;
      let hitY = this.projectile.y;
      let terrainHit = false;
      for (let s = 0; s <= steps; s++) {
        const t = steps === 0 ? 1 : s / steps;
        const sx = Math.floor(prevX + segDx * t);
        const sy = Math.floor(prevY + segDy * t);
        const localY = sy - terrainY;
        if (
          sx >= 0 &&
          sx < CONST.TERRAIN_WIDTH &&
          localY >= 0 &&
          localY < terrain[sx]?.length &&
          terrain[sx][localY] === 1
        ) {
          hitX = sx;
          hitY = sy;
          terrainHit = true;
          break;
        }
      }
      if (terrainHit) {
        this.projectile.x = hitX;
        this.projectile.y = hitY;
        this.destroyTrajectoryProjectile(terrain, player, enemies, physicsService, depthTerrain);
        return;
      }

      // Check offset neighbours at current position for near-miss terrain
      const px = Math.floor(this.projectile.x);
      const py = Math.floor(this.projectile.y);
      const terrainLocalY = py - terrainY;

      if (
        px >= 0 &&
        px < CONST.TERRAIN_WIDTH &&
        terrainLocalY >= 0 &&
        terrainLocalY < terrain[px]?.length &&
        terrain[px][terrainLocalY] === 1
      ) {
        this.destroyTrajectoryProjectile(terrain, player, enemies, physicsService, depthTerrain);
        return;
      }

      // Check offsets for collision
      const checkOffsets = [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ];
      let collided = false;
      for (const [offsetX, offsetY] of checkOffsets) {
        const checkX = px + offsetX;
        const checkY = py + offsetY;
        const terrainCheckY = checkY - terrainY;

        if (
          checkX >= 0 &&
          checkX < CONST.TERRAIN_WIDTH &&
          terrainCheckY >= 0 &&
          terrainCheckY < terrain[checkX]?.length &&
          terrain[checkX][terrainCheckY] === 1
        ) {
          collided = true;
          break;
        }
      }
      if (collided) {
        this.destroyTrajectoryProjectile(terrain, player, enemies, physicsService, depthTerrain);
        return;
      }

    // Check shield boundary
    const shieldedEntities: (Player | Enemy)[] = [player, ...enemies];
    for (const entity of shieldedEntities) {
      if (!entity.active) continue;
      const shield = entity.vehicle?.shieldRadius;
      if (!shield || (entity.currentShieldHealth ?? 0) <= 0) continue;
      if ((this.projectile.owner as object) === (entity as object)) continue;
      const sdx = this.projectile.x - entity.x;
      const sdy = this.projectile.y - entity.y;
      const sdist = Math.sqrt(sdx * sdx + sdy * sdy);
      const ownerDist = Math.hypot(
        this.projectile.owner.x - entity.x,
        this.projectile.owner.y - entity.y,
      );
      if (sdist < shield && ownerDist >= shield) {
        const scale = shield / Math.max(sdist, 0.001);
        this.projectile.x = entity.x + sdx * scale;
        this.projectile.y = entity.y + sdy * scale;
        entity.currentShieldHealth = Math.max(0, (entity.currentShieldHealth ?? 0) - this.projectile.bullet.damage);
        entity.shieldHitAngle = Math.atan2(sdy, sdx);
        if ((entity.currentShieldHealth ?? 0) <= 0) {
          this.sfxService.play({ category: 'shield_break' });
        } else {
          this.sfxService.play({ category: this.projectile.bullet.sfxImpact ?? 'explosion' });
        }
        this.destroyTrajectoryProjectile(terrain, player, enemies, physicsService, depthTerrain);
        return;
      }
    }

    // Check collision with entities
    if (this.checkEntityCollisions(this.projectile, player, enemies)) {
      this.destroyTrajectoryProjectile(terrain, player, enemies, physicsService, depthTerrain);
      return;
    }

    // Advance to next position
    this.projectile.trajectoryIndex++;
  }

  destroyTrajectoryProjectile(
    terrain: number[][],
    player: Player,
    enemies: Enemy[],
    physicsService: any,
    depthTerrain?: number[][],
  ) {
    if (!this.projectile) return;

    const explosionX = this.projectile.x;
    const explosionY = this.projectile.y;
    const projectileSnapshot = this.projectile;

    this.sfxService.play({ category: projectileSnapshot.bullet.sfxImpact ?? 'explosion' });

    this.impactService.pushExplosion(explosionX, explosionY, projectileSnapshot.bullet);

    // Create crater first so the knockback wall-check uses post-explosion terrain.
    this.impactService.createCrater(explosionX, explosionY, terrain, projectileSnapshot.bullet);
    if (depthTerrain) {
      const depthScale = 0.45 + Math.random() * 0.35; // 0.45x–0.80x random size
      const offsetX = (Math.random() - 0.5) * 20; // ±10px random offset
      const offsetY = (Math.random() - 0.5) * 20;
      this.impactService.createCrater(
        explosionX + offsetX,
        explosionY + offsetY,
        depthTerrain,
        projectileSnapshot.bullet,
        depthScale,
      );
    }

    this.calculateExplosionDamage(
      explosionX,
      explosionY,
      projectileSnapshot,
      player,
      enemies,
      physicsService,
      terrain,
    );

    this.lastImpactPos = { x: explosionX, y: explosionY };

    // Spawn child projectiles if this bullet has a child tier
    if (projectileSnapshot.bullet.childBullet && (projectileSnapshot.bullet.childCount ?? 0) > 0) {
      this.spawnChildProjectiles(
        explosionX,
        explosionY,
        projectileSnapshot.owner,
        projectileSnapshot.bullet,
        physicsService,
        projectileSnapshot.rootBulletName,
      );
    }

    this.projectile = null;
  }

  calculateExplosionDamage(
    explosionX: number,
    explosionY: number,
    projectile: any,
    player: Player,
    enemies: Enemy[],
    physicsService: any,
    terrain: number[][],
  ) {
    const maxDamage = projectile.bullet.damage;
    const damageRadius = projectile.bullet.explosionRadius ?? 50;
    let radiusX = damageRadius;
    let radiusY = damageRadius;
    if (projectile.bullet.explosionShape === 'horizontal_oval') {
      radiusX = damageRadius * 1.5;
    } else if (projectile.bullet.explosionShape === 'vertical_oval') {
      radiusY = damageRadius * 1.5;
    }
    // For 'circle', keep as is

    const attackerName = (projectile.owner as Player | Enemy).displayName ?? 'Unknown';
    const weaponName = projectile.rootBulletName;

    // Damage player
    if (player.active) {
      const dx = player.x - explosionX;
      const dy = player.y - explosionY;
      const distToCenter = Math.sqrt(dx * dx + dy * dy);
      const effectiveDist = Math.max(0, distToCenter - CONST.TANK_COLLISION_RADIUS);
      const normalizedDist = Math.sqrt((dx / radiusX) ** 2 + (dy / radiusY) ** 2);
      if (normalizedDist <= 1) {
        const damage = Math.round(maxDamage * Math.max(0, 1 - effectiveDist / radiusX));
        const rawDamage = projectile.owner === player ? damage * 0.5 : damage;
        const actualDamage = Math.round(rawDamage * (1 - (player.vehicle.armor ?? 0)));
        this.damageService.applyDamage(
          player,
          { amount: actualDamage, source: 'explosion', attackerName, weaponName },
          'player',
        );
        physicsService.applyExplosionKnockback(
          player,
          explosionX,
          explosionY,
          projectile,
          radiusX,
          radiusY,
        );
      }
    }

    // Damage enemies
    for (const enemy of enemies) {
      if (enemy.active) {
        const dx = enemy.x - explosionX;
        const dy = enemy.y - explosionY;
        const distToCenter = Math.sqrt(dx * dx + dy * dy);
        const effectiveDist = Math.max(0, distToCenter - CONST.TANK_COLLISION_RADIUS);
        const normalizedDist = Math.sqrt((dx / radiusX) ** 2 + (dy / radiusY) ** 2);
        if (normalizedDist <= 1) {
          const damage = Math.round(
            maxDamage * Math.max(0, 1 - effectiveDist / radiusX) * (1 - (enemy.vehicle.armor ?? 0)),
          );
          const result = this.damageService.applyDamage(
            enemy,
            { amount: damage, source: 'explosion', attackerName, weaponName },
            'enemy',
          );
          physicsService.applyExplosionKnockback(
            enemy,
            explosionX,
            explosionY,
            projectile,
            radiusX,
            radiusY,
          );
          if (projectile.owner === player && player.vehicle.lifesteal && result.actualAmount > 0) {
            const heal = Math.round(result.actualAmount * (player.vehicle.lifesteal / 100));
            if (heal > 0) {
              player.health = Math.min(player.health + heal, player.vehicle.health);
              this.damageService.damageTexts.push({
                x: player.x,
                y: player.y - 30,
                damage: heal,
                life: CONST.DAMAGE_TEXT_LIFETIME,
                isHeal: true,
              });
            }
          }
          if (result.wasKilled && enemy.body) {
            physicsService.removeBody(enemy.body);
          }
        }
      }
    }
  }

  private findChildShieldHit(
    child: Projectile,
    player: Player,
    enemies: Enemy[],
  ): Player | Enemy | null {
    const entities: (Player | Enemy)[] = [player, ...enemies];
    for (const entity of entities) {
      if (!entity.active) continue;
      if ((entity as object) === (child.owner as object)) continue;
      const shield = entity.vehicle?.shieldRadius;
      if (!shield || (entity.currentShieldHealth ?? 0) <= 0) continue;
      const dx = child.x - entity.x;
      const dy = child.y - entity.y;
      if (Math.sqrt(dx * dx + dy * dy) < shield) return entity;
    }
    return null;
  }

  private findEntityCollision(child: Projectile, player: Player, enemies: Enemy[]): Player | Enemy | null {
    const entities: (Player | Enemy)[] = [player, ...enemies];
    for (const entity of entities) {
      if (!entity.active) continue;
      if ((entity as object) === (child.owner as object)) continue;
      const dx = entity.x - child.x;
      const dy = entity.y - child.y;
      if (Math.sqrt(dx * dx + dy * dy) < CONST.PROJECTILE_RADIUS + CONST.TANK_COLLISION_RADIUS) {
        return entity;
      }
    }
    return null;
  }

  checkEntityCollisions(projectile: Projectile, player: Player, enemies: Enemy[]): boolean {
    const entities: (Player | Enemy)[] = [player, ...enemies];

    for (const entity of entities) {
      if (!entity.active) continue;

      const dx = entity.x - projectile.x;
      const dy = entity.y - projectile.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Check direct body hit using gameplay collision radius (tighter than visual TANK_BODY_RADIUS)
      if (distance < CONST.PROJECTILE_RADIUS + CONST.TANK_COLLISION_RADIUS) {
        return true;
      }

      // Check shield hit (skip owner and shields with no health)
      const shield = entity.vehicle?.shieldRadius;
      if (
        shield &&
        (entity.currentShieldHealth ?? 0) > 0 &&
        (entity as object) !== (projectile.owner as object) &&
        distance < shield
      ) {
        return true;
      }
    }

    return false;
  }

  spawnShotgunPellets(
    barrelX: number,
    barrelY: number,
    aimAngleRad: number,
    owner: Player | Enemy,
    bullet: any,
    physicsService: any,
    rootBulletName: string = '',
  ): void {
    const pellet = bullet.childBullet;
    if (!pellet) return;
    const count: number = bullet.shotgunCount ?? 1;
    const spread: number = bullet.shotgunSpreadRad ?? 0;
    for (let i = 0; i < count; i++) {
      const deviation = (Math.random() - 0.5) * spread;
      const angleRad = aimAngleRad + deviation;
      // Negate Y because canvas Y increases downward but aimAngleRad uses math convention
      const speed = pellet.speed * (0.85 + Math.random() * 0.3);
      const vx = Math.cos(angleRad) * speed;
      const vy = -Math.sin(angleRad) * speed;

      const body = physicsService.Bodies.circle(barrelX, barrelY, CONST.PROJECTILE_RADIUS, {
        frictionAir: 0.015,
        restitution: 0,
        friction: CONST.PROJECTILE_FRICTION,
      });
      physicsService.Body.setVelocity(body, { x: vx, y: vy });
      physicsService.World.add(physicsService.world, body);

      this.childProjectiles.push({
        body,
        x: barrelX,
        y: barrelY,
        owner,
        bullet: pellet,
        rootBulletName: rootBulletName || bullet.name || '',
        spawnTimeMs: Date.now(),
        spinRate: (Math.random() * 8 + 4) * (Math.random() < 0.5 ? 1 : -1),
      });
    }
  }

  private updatePhysicsPrimaryProjectile(
    terrain: number[][],
    physicsService: any,
    player: Player,
    enemies: Enemy[],
    depthTerrain?: number[][],
  ): void {
    const proj = this.projectile!;
    const body = proj.body!;
    const terrainBaseY = CONST.CANVAS_HEIGHT - CONST.TERRAIN_BASE_Y_OFFSET;

    // Apply wind force
    physicsService.Body.applyForce(body, body.position, {
      x:
        (physicsService.windSpeed *
          0.75 *
          CONST.WIND_BULLET_FORCE_SCALE *
          Math.cos(physicsService.windAngle)) /
        proj.bullet.weight,
      y: 0,
    });

    // Sync world-space position
    proj.x = body.position.x;
    proj.y = body.position.y;

    // Out-of-bounds — destroy
    if (
      proj.x < -CONST.OFFSCREEN_EXPLODE_MARGIN_X ||
      proj.x > CONST.TERRAIN_WIDTH + CONST.OFFSCREEN_EXPLODE_MARGIN_X ||
      proj.y > CONST.TERRAIN_HEIGHT + CONST.OFFSCREEN_EXPLODE_MARGIN_Y_BOTTOM ||
      proj.y < -CONST.OFFSCREEN_EXPLODE_MARGIN_Y_TOP
    ) {
      this.destroyTrajectoryProjectile(terrain, player, enemies, physicsService, depthTerrain);
      return;
    }

    // Explode when speed falls below threshold
    const lowSpeedModifier = proj.bullet.modifiers?.find(m => m.type === 'explode_on_low_speed') as ExplodeOnLowSpeedModifier | undefined;
    if (lowSpeedModifier) {
      const vel = body.velocity;
      const spd = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
      if (spd < lowSpeedModifier.threshold) {
        this.destroyTrajectoryProjectile(terrain, player, enemies, physicsService, depthTerrain);
        return;
      }
    }

    // Shield boundary check — absorb without explosion
    const shieldedTarget = this.findChildShieldHit(proj, player, enemies);
    if (shieldedTarget) {
      const dx = proj.x - shieldedTarget.x;
      const dy = proj.y - shieldedTarget.y;
      shieldedTarget.currentShieldHealth = Math.max(
        0,
        (shieldedTarget.currentShieldHealth ?? 0) - proj.bullet.damage,
      );
      shieldedTarget.shieldHitAngle = Math.atan2(dy, dx);
      if ((shieldedTarget.currentShieldHealth ?? 0) <= 0) {
        this.sfxService.play({ category: 'shield_break' });
      } else {
        this.sfxService.play({ category: proj.bullet.sfxImpact ?? 'explosion' });
      }
      physicsService.World.remove(physicsService.world, body);
      this.projectile = null;
      return;
    }

    // Entity collision — bounce or explode
    const hasBounceEntity = proj.bullet.modifiers?.some(m => m.type === 'bounce_entity') ?? false;
    if (hasBounceEntity) {
      const hitEntity = this.findEntityCollision(proj, player, enemies);
      if (hitEntity) {
        const vel = body.velocity;
        const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
        const dx = proj.x - hitEntity.x;
        const dy = proj.y - hitEntity.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.001);
        const nx = dx / dist;
        const ny = dy / dist;
        const dot = vel.x * nx + vel.y * ny;
        const restitution = 0.6;
        physicsService.Body.setVelocity(body, {
          x: (vel.x - 2 * dot * nx) * restitution,
          y: (vel.y - 2 * dot * ny) * restitution,
        });
        const pushDist = CONST.PROJECTILE_RADIUS + CONST.TANK_COLLISION_RADIUS + 2;
        physicsService.Body.setPosition(body, {
          x: hitEntity.x + nx * pushDist,
          y: hitEntity.y + ny * pushDist,
        });
        const speedRatio = Math.min(1, speed / proj.bullet.speed);
        const armor = hitEntity.vehicle.armor ?? 0;
        const rawDamage = Math.round(proj.bullet.damage * speedRatio * (1 - armor));
        const attackerName = (proj.owner as Player | Enemy).displayName ?? 'Unknown';
        const isPlayer = (hitEntity as object) === (player as object);
        this.damageService.applyDamage(
          hitEntity,
          { amount: rawDamage, source: 'explosion', attackerName, weaponName: proj.rootBulletName },
          isPlayer ? 'player' : 'enemy',
        );
        physicsService.applyExplosionKnockback(
          hitEntity,
          proj.x,
          proj.y,
          proj,
          proj.bullet.explosionRadius,
          proj.bullet.explosionRadius,
        );
        return;
      }
    } else {
      if (this.checkEntityCollisions(proj, player, enemies)) {
        this.destroyTrajectoryProjectile(terrain, player, enemies, physicsService, depthTerrain);
        return;
      }
    }

    // Terrain hit check
    const r = CONST.PROJECTILE_RADIUS;
    const tbY = Math.floor(terrainBaseY);
    const isTerrainAt = (wx: number, wy: number): boolean => {
      const col = Math.floor(wx);
      const ly = Math.floor(wy) - tbY;
      return (
        col >= 0 &&
        col < CONST.TERRAIN_WIDTH &&
        ly >= 0 &&
        ly < (terrain[col]?.length ?? 0) &&
        terrain[col][ly] === 1
      );
    };
    const bottomHit = isTerrainAt(proj.x, proj.y + r) || isTerrainAt(proj.x, proj.y);
    const lateralHit = isTerrainAt(proj.x + r, proj.y) || isTerrainAt(proj.x - r, proj.y);
    const terrainHit = bottomHit || lateralHit;

    if (terrainHit) {
      const bounceTerrainMod = proj.bullet.modifiers?.find(m => m.type === 'bounce_terrain') as import('./monkeys.types').BounceTerrainModifier | undefined;
      if (!bounceTerrainMod) {
        this.destroyTrajectoryProjectile(terrain, player, enemies, physicsService, depthTerrain);
        return;
      }
      const px = Math.floor(proj.x);
      const colData = terrain[px];
      let surfaceWorldY = proj.y - r;
      if (colData) {
        for (let ly = 0; ly < colData.length; ly++) {
          if (colData[ly] === 1) { surfaceWorldY = tbY + ly; break; }
        }
      }
      const getSY = (col: number): number => {
        if (col < 0 || col >= CONST.TERRAIN_WIDTH) return surfaceWorldY;
        const cd = terrain[col];
        if (!cd) return surfaceWorldY;
        for (let ly = 0; ly < cd.length; ly++) {
          if (cd[ly] === 1) return tbY + ly;
        }
        return surfaceWorldY;
      };
      const span = 4;
      const slope = (getSY(px + span) - getSY(px - span)) / (span * 2);
      let nx = slope;
      let ny = -1;
      const nLen = Math.sqrt(nx * nx + 1);
      nx /= nLen;
      ny /= nLen;

      const vel = body.velocity;
      const dot = vel.x * nx + vel.y * ny;
      if (dot < 0) {
        const restitution = bounceTerrainMod.restitution ?? 0.35;
        const bouncedVx = (vel.x - 2 * dot * nx) * restitution;
        const bouncedVy = (vel.y - 2 * dot * ny) * restitution;
        const bouncedSpeed = Math.sqrt(bouncedVx * bouncedVx + bouncedVy * bouncedVy);
        if (bouncedSpeed > 1.5) {
          physicsService.Body.setVelocity(body, { x: bouncedVx, y: bouncedVy });
        } else {
          const ROLLING_FRICTION = 0.97;
          physicsService.Body.setVelocity(body, {
            x: (vel.x - dot * nx) * ROLLING_FRICTION,
            y: (vel.y - dot * ny) * ROLLING_FRICTION,
          });
        }
        if (bottomHit) {
          physicsService.Body.setPosition(body, { x: proj.x, y: surfaceWorldY - r - 1 });
        }
      }
    }
  }

  spawnPhysicsPrimaryProjectile(
    barrelX: number,
    barrelY: number,
    aimAngleRad: number,
    owner: Player | Enemy,
    bullet: any,
    physicsService: any,
    rootBulletName: string = '',
    power: number = 200,
  ): void {
    const speed = (power / 100) * bullet.speed;
    const vx = Math.cos(aimAngleRad) * speed;
    const vy = -Math.sin(aimAngleRad) * speed;

    const body = physicsService.Bodies.circle(barrelX, barrelY, CONST.PROJECTILE_RADIUS, {
      frictionAir: 0,
      restitution: 0.75,
      friction: CONST.PROJECTILE_FRICTION,
    });
    physicsService.Body.setVelocity(body, { x: vx, y: vy });
    physicsService.World.add(physicsService.world, body);

    this.projectile = {
      body,
      x: barrelX,
      y: barrelY,
      owner,
      bullet,
      rootBulletName: rootBulletName || bullet.name || '',
      spawnTimeMs: Date.now(),
      spinRate: (Math.random() * 8 + 4) * (Math.random() < 0.5 ? 1 : -1),
    };
  }

  spawnChildProjectiles(
    impactX: number,
    impactY: number,
    owner: Player | Enemy,
    parentBullet: any,
    physicsService: any,
    rootBulletName: string = '',
  ): void {
    const childBullet = parentBullet.childBullet;
    const childCount: number = parentBullet.childCount ?? 1;
    if (!childBullet) return;

    // Spawn fragments raised above the impact point so they start outside the
    // entity's collision radius (PROJECTILE_RADIUS + TANK_COLLISION_RADIUS) and don't
    // detonate on the very first update tick.
    const spawnOffsetY = -(CONST.PROJECTILE_RADIUS + CONST.TANK_COLLISION_RADIUS + 2);
    const spawnY = impactY + spawnOffsetY;

    // Spread childCount angles evenly from -60° to +60° from straight up
    for (let i = 0; i < childCount; i++) {
      const spreadFraction = childCount === 1 ? 0 : i / (childCount - 1) - 0.5;
      const spreadAngleDeg = spreadFraction * 120; // -60° to +60°
      const angleRad = -Math.PI / 2 + (spreadAngleDeg * Math.PI) / 180;

      const speed = childBullet.speed * 0.4;
      const vx = Math.cos(angleRad) * speed;
      const vy = Math.sin(angleRad) * speed;

      const body = physicsService.Bodies.circle(impactX, spawnY, CONST.PROJECTILE_RADIUS, {
        frictionAir: 0,
        restitution: 0,
        friction: CONST.PROJECTILE_FRICTION,
      });
      physicsService.Body.setVelocity(body, { x: vx, y: vy });
      physicsService.World.add(physicsService.world, body);

      this.childProjectiles.push({
        body,
        x: impactX,
        y: spawnY,
        owner,
        bullet: childBullet,
        rootBulletName: rootBulletName || parentBullet.name || '',
        spawnTimeMs: Date.now(),
      });
    }
  }

  updateChildProjectiles(
    terrain: number[][],
    player: Player,
    enemies: Enemy[],
    physicsService: any,
    depthTerrain?: number[][],
  ): void {
    const terrainBaseY = CONST.CANVAS_HEIGHT - CONST.TERRAIN_BASE_Y_OFFSET;

    for (let i = this.childProjectiles.length - 1; i >= 0; i--) {
      const child = this.childProjectiles[i];
      if (!child.body) continue;

      // Apply wind force (mirrors simulateTrajectory wind formula)
      physicsService.Body.applyForce(child.body, child.body.position, {
        x:
          (physicsService.windSpeed *
            0.75 *
            CONST.WIND_BULLET_FORCE_SCALE *
            Math.cos(physicsService.windAngle)) /
          child.bullet.weight,
        y: 0,
      });

      // Sync world-space position
      child.x = child.body.position.x;
      child.y = child.body.position.y;

      // Out-of-bounds check
      if (
        child.x < -CONST.OFFSCREEN_EXPLODE_MARGIN_X ||
        child.x > CONST.TERRAIN_WIDTH + CONST.OFFSCREEN_EXPLODE_MARGIN_X ||
        child.y > CONST.TERRAIN_HEIGHT + CONST.OFFSCREEN_EXPLODE_MARGIN_Y_BOTTOM ||
        child.y < -CONST.OFFSCREEN_EXPLODE_MARGIN_Y_TOP
      ) {
        this.destroyChildProjectile(i, terrain, player, enemies, physicsService, depthTerrain);
        continue;
      }

      // Timer fuse: only explode if bullet has fuse_timer modifier
      const fuseModifier = child.bullet.modifiers?.find(m => m.type === 'fuse_timer') as FuseTimerModifier | undefined;
      if (fuseModifier && Date.now() - (child.spawnTimeMs ?? 0) >= fuseModifier.ms) {
        this.destroyChildProjectile(i, terrain, player, enemies, physicsService, depthTerrain);
        continue;
      }

      // Explode when speed falls below threshold (checked every frame, including while rolling)
      const lowSpeedModifier = child.bullet.modifiers?.find(m => m.type === 'explode_on_low_speed') as ExplodeOnLowSpeedModifier | undefined;
      if (lowSpeedModifier) {
        const vel = child.body.velocity;
        const spd = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
        if (spd < lowSpeedModifier.threshold) {
          this.destroyChildProjectile(i, terrain, player, enemies, physicsService, depthTerrain);
          continue;
        }
      }

      // Shield boundary check — damage shield and absorb child projectile without explosion
      const shieldedTarget = this.findChildShieldHit(child, player, enemies);
      if (shieldedTarget) {
        const dx = child.x - shieldedTarget.x;
        const dy = child.y - shieldedTarget.y;
        shieldedTarget.currentShieldHealth = Math.max(
          0,
          (shieldedTarget.currentShieldHealth ?? 0) - child.bullet.damage,
        );
        shieldedTarget.shieldHitAngle = Math.atan2(dy, dx);
        if ((shieldedTarget.currentShieldHealth ?? 0) <= 0) {
          this.sfxService.play({ category: 'shield_break' });
        } else {
          this.sfxService.play({ category: child.bullet.sfxImpact ?? 'explosion' });
        }
        physicsService.World.remove(physicsService.world, child.body);
        this.childProjectiles.splice(i, 1);
        continue;
      }

      // Entity collision — bounce if modifier, otherwise explode
      const hasBounceEntity = child.bullet.modifiers?.some(m => m.type === 'bounce_entity') ?? false;
      if (hasBounceEntity) {
        const hitEntity = this.findEntityCollision(child, player, enemies);
        if (hitEntity) {
          const vel = child.body.velocity;
          const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
          // Normal: from entity center toward projectile
          const dx = child.x - hitEntity.x;
          const dy = child.y - hitEntity.y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.001);
          const nx = dx / dist;
          const ny = dy / dist;
          // Reflect velocity with restitution
          const dot = vel.x * nx + vel.y * ny;
          const restitution = 0.6;
          physicsService.Body.setVelocity(child.body, {
            x: (vel.x - 2 * dot * nx) * restitution,
            y: (vel.y - 2 * dot * ny) * restitution,
          });
          // Push projectile outside collision radius to prevent re-collision next frame
          const pushDist = CONST.PROJECTILE_RADIUS + CONST.TANK_COLLISION_RADIUS + 2;
          physicsService.Body.setPosition(child.body, {
            x: hitEntity.x + nx * pushDist,
            y: hitEntity.y + ny * pushDist,
          });
          // Speed-scaled damage with armor reduction
          const speedRatio = Math.min(1, speed / child.bullet.speed);
          const armor = hitEntity.vehicle.armor ?? 0;
          const rawDamage = Math.round(child.bullet.damage * speedRatio * (1 - armor));
          const attackerName = (child.owner as Player | Enemy).displayName ?? 'Unknown';
          const isPlayer = (hitEntity as object) === (player as object);
          this.damageService.applyDamage(
            hitEntity,
            { amount: rawDamage, source: 'explosion', attackerName, weaponName: child.rootBulletName },
            isPlayer ? 'player' : 'enemy',
          );
          physicsService.applyExplosionKnockback(
            hitEntity,
            child.x,
            child.y,
            child,
            child.bullet.explosionRadius,
            child.bullet.explosionRadius,
          );
          continue;
        }
      } else {
        // Standard: explode on entity contact
        if (this.checkEntityCollisions(child, player, enemies)) {
          this.destroyChildProjectile(i, terrain, player, enemies, physicsService, depthTerrain);
          continue;
        }
      }

      // Terrain hit check — test bottom edge, center, and lateral edges
      const r = CONST.PROJECTILE_RADIUS;
      const tbY = Math.floor(terrainBaseY);
      const isTerrainAt = (wx: number, wy: number): boolean => {
        const col = Math.floor(wx);
        const ly = Math.floor(wy) - tbY;
        return (
          col >= 0 &&
          col < CONST.TERRAIN_WIDTH &&
          ly >= 0 &&
          ly < (terrain[col]?.length ?? 0) &&
          terrain[col][ly] === 1
        );
      };
      const bottomHit =
        isTerrainAt(child.x, child.y + r) || // bottom edge
        isTerrainAt(child.x, child.y); // center (already embedded)
      const lateralHit =
        isTerrainAt(child.x + r, child.y) || // right edge
        isTerrainAt(child.x - r, child.y); // left edge
      const terrainHit = bottomHit || lateralHit;

      if (terrainHit) {
        const bounceTerrainMod = child.bullet.modifiers?.find(m => m.type === 'bounce_terrain') as import('./monkeys.types').BounceTerrainModifier | undefined;
        if (!bounceTerrainMod) {
          this.destroyChildProjectile(i, terrain, player, enemies, physicsService, depthTerrain);
          continue;
        }
        const px = Math.floor(child.x);

        // Find topmost solid pixel in this column to get the real surface Y
        const colData = terrain[px];
        let surfaceWorldY = child.y - r; // fallback: don't change Y
        if (colData) {
          for (let ly = 0; ly < colData.length; ly++) {
            if (colData[ly] === 1) {
              surfaceWorldY = tbY + ly;
              break;
            }
          }
        }

        // Compute terrain slope from neighbouring columns for proper reflection normal
        const getSY = (col: number): number => {
          if (col < 0 || col >= CONST.TERRAIN_WIDTH) return surfaceWorldY;
          const cd = terrain[col];
          if (!cd) return surfaceWorldY;
          for (let ly = 0; ly < cd.length; ly++) {
            if (cd[ly] === 1) return tbY + ly;
          }
          return surfaceWorldY;
        };
        const span = 4;
        const slope = (getSY(px + span) - getSY(px - span)) / (span * 2);
        // Normal = perpendicular to surface tangent, pointing upward (negative Y in screen coords)
        let nx = slope;
        let ny = -1;
        const nLen = Math.sqrt(nx * nx + 1); // ny² = 1
        nx /= nLen;
        ny /= nLen;

        const vel = child.body.velocity;
        const dot = vel.x * nx + vel.y * ny;

        if (dot < 0) {
          // Compute what a full bounce would produce — restitution from modifier, default 0.35
          const restitution = bounceTerrainMod.restitution ?? 0.35;
          const bouncedVx = (vel.x - 2 * dot * nx) * restitution;
          const bouncedVy = (vel.y - 2 * dot * ny) * restitution;
          const bouncedSpeed = Math.sqrt(bouncedVx * bouncedVx + bouncedVy * bouncedVy);

          if (bouncedSpeed > 1.5) {
            // True bounce — reflect with restitution
            physicsService.Body.setVelocity(child.body, { x: bouncedVx, y: bouncedVy });
          } else {
            // Rolling / resting — zero only the into-surface component, keep tangential.
            // Gravity's tangential projection accumulates each frame, rolling downhill naturally.
            const ROLLING_FRICTION = 0.97;
            physicsService.Body.setVelocity(child.body, {
              x: (vel.x - dot * nx) * ROLLING_FRICTION,
              y: (vel.y - dot * ny) * ROLLING_FRICTION,
            });
          }

          // Only snap to surface on floor contact — lateral cliff-face hits must not
          // reposition Y or the fragment teleports to the cliff top/bottom.
          if (bottomHit) {
            physicsService.Body.setPosition(child.body, {
              x: child.x,
              y: surfaceWorldY - r - 1,
            });
          }
        }
        continue;
      }
    }
  }

  private destroyChildProjectile(
    index: number,
    terrain: number[][],
    player: Player,
    enemies: Enemy[],
    physicsService: any,
    depthTerrain?: number[][],
  ): void {
    const child = this.childProjectiles[index];
    physicsService.World.remove(physicsService.world, child.body);

    this.sfxService.play({ category: child.bullet.sfxImpact ?? 'explosion' });

    this.impactService.pushExplosion(child.x, child.y, child.bullet);

    this.impactService.createCrater(child.x, child.y, terrain, child.bullet);
    if (depthTerrain) {
      const depthScale = 0.45 + Math.random() * 0.35;
      const offsetX = (Math.random() - 0.5) * 20;
      const offsetY = (Math.random() - 0.5) * 20;
      this.impactService.createCrater(
        child.x + offsetX,
        child.y + offsetY,
        depthTerrain,
        child.bullet,
        depthScale,
      );
    }

    this.calculateExplosionDamage(
      child.x,
      child.y,
      child,
      player,
      enemies,
      physicsService,
      terrain,
    );

    // Cascade to next tier if child also has children
    if (child.bullet.childBullet && (child.bullet.childCount ?? 0) > 0) {
      this.spawnChildProjectiles(
        child.x,
        child.y,
        child.owner,
        child.bullet,
        physicsService,
        child.rootBulletName,
      );
    }

    this.childProjectiles.splice(index, 1);
  }

  updateExplosions(): void {
    this.impactService.updateExplosions();
  }

}
