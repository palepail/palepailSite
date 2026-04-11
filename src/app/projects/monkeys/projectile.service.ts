import { Injectable } from '@angular/core';
import { Player, Enemy, Projectile, Explosion, DamageText } from './monkeys.types';
import * as CONST from './monkeys.constants';
import { MonkeysSfxService } from './monkeys-sfx.service';
import { DamageService } from './damage.service';

@Injectable({
  providedIn: 'root',
})
export class ProjectileService {
  constructor(
    private sfxService: MonkeysSfxService,
    private damageService: DamageService,
  ) {}

  projectile: Projectile | null = null;
  childProjectiles: Projectile[] = [];
  explosions: Explosion[] = [];
  lastImpactPos: { x: number; y: number } | null = null;

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
    if (
      !this.projectile ||
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
        entity.currentShieldHealth = (entity.currentShieldHealth ?? 1) - 1;
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

    this.explosions.push({
      x: explosionX,
      y: explosionY,
      radius: CONST.EXPLOSION_INITIAL_RADIUS,
      maxRadius: CONST.EXPLOSION_MAX_RADIUS,
      life: CONST.EXPLOSION_LIFETIME_FRAMES,
      shape: this.projectile.bullet.explosionShape,
      spriteName: projectileSnapshot.bullet.explosionSprite,
    });

    // Create crater first so the knockback wall-check uses post-explosion terrain.
    this.createCrater(explosionX, explosionY, terrain, projectileSnapshot.bullet);
    if (depthTerrain) {
      const depthScale = 0.45 + Math.random() * 0.35; // 0.45x–0.80x random size
      const offsetX = (Math.random() - 0.5) * 20; // ±10px random offset
      const offsetY = (Math.random() - 0.5) * 20;
      this.createCrater(
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
      const normalizedDist = Math.sqrt((dx / radiusX) ** 2 + (dy / radiusY) ** 2);
      if (normalizedDist <= 1) {
        const damage = Math.round(maxDamage * (1 - normalizedDist));
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
        const normalizedDist = Math.sqrt((dx / radiusX) ** 2 + (dy / radiusY) ** 2);
        if (normalizedDist <= 1) {
          const damage = Math.round(
            maxDamage * (1 - normalizedDist) * (1 - (enemy.vehicle.armor ?? 0)),
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

  createCrater(
    centerX: number,
    centerY: number,
    terrain: number[][],
    bullet: any,
    radiusScale = 1,
  ): void {
    const terrainY = CONST.CANVAS_HEIGHT - CONST.TERRAIN_BASE_Y_OFFSET;
    let craterRadiusX = bullet.craterRadius * radiusScale;
    let craterRadiusY = bullet.craterRadius * radiusScale;
    if (bullet.explosionShape === 'horizontal_oval') {
      craterRadiusX = bullet.craterRadius * 1.5 * radiusScale;
    } else if (bullet.explosionShape === 'vertical_oval') {
      craterRadiusY = bullet.craterRadius * 1.5 * radiusScale;
    }

    for (let x = centerX - craterRadiusX; x < centerX + craterRadiusX; x++) {
      for (let y = centerY - craterRadiusY; y < centerY + craterRadiusY; y++) {
        const dx = x - centerX;
        const dy = y - centerY;
        const normalizedDist = Math.sqrt((dx / craterRadiusX) ** 2 + (dy / craterRadiusY) ** 2);
        if (normalizedDist <= 1) {
          const ix = Math.floor(x);
          const iy = Math.floor(y - terrainY);
          if (ix >= 0 && ix < CONST.TERRAIN_WIDTH && iy >= 0 && iy < CONST.TERRAIN_STRIP_HEIGHT) {
            if (terrain[ix] && terrain[ix][iy] !== 0) {
              terrain[ix][iy] = 0; // Remove terrain (solid and visual-only)
            }
          }
        }
      }
    }
  }

  checkEntityCollisions(projectile: Projectile, player: Player, enemies: Enemy[]): boolean {
    const entities: (Player | Enemy)[] = [player, ...enemies];

    for (const entity of entities) {
      if (!entity.active) continue;

      const dx = entity.x - projectile.x;
      const dy = entity.y - projectile.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Check direct body hit (use actual tank body radius so fast-moving fragments don't skip through)
      if (distance < CONST.PROJECTILE_RADIUS + CONST.TANK_BODY_RADIUS) {
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
    // entity's collision radius (PROJECTILE_RADIUS + TANK_BODY_RADIUS) and don't
    // detonate on the very first update tick.
    const spawnOffsetY = -(CONST.PROJECTILE_RADIUS + CONST.TANK_BODY_RADIUS + 2);
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

      // Timer fuse: explode after 1.8 seconds
      if (Date.now() - (child.spawnTimeMs ?? 0) >= 1800) {
        this.destroyChildProjectile(i, terrain, player, enemies, physicsService, depthTerrain);
        continue;
      }

      // Entity collision check — must run before terrain so rolling fragments can detonate
      if (this.checkEntityCollisions(child, player, enemies)) {
        this.destroyChildProjectile(i, terrain, player, enemies, physicsService, depthTerrain);
        continue;
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
          // Compute what a full bounce would produce
          const restitution = 0.35;
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

    this.explosions.push({
      x: child.x,
      y: child.y,
      radius: CONST.EXPLOSION_INITIAL_RADIUS,
      maxRadius: CONST.EXPLOSION_MAX_RADIUS,
      life: CONST.EXPLOSION_LIFETIME_FRAMES,
      shape: child.bullet.explosionShape,
      spriteName: child.bullet.explosionSprite,
    });

    this.createCrater(child.x, child.y, terrain, child.bullet);
    if (depthTerrain) {
      const depthScale = 0.45 + Math.random() * 0.35;
      const offsetX = (Math.random() - 0.5) * 20;
      const offsetY = (Math.random() - 0.5) * 20;
      this.createCrater(
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
      this.spawnChildProjectiles(child.x, child.y, child.owner, child.bullet, physicsService, child.rootBulletName);
    }

    this.childProjectiles.splice(index, 1);
  }

  updateExplosions() {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const explosion = this.explosions[i];
      explosion.radius += CONST.EXPLOSION_EXPANSION_RATE;
      explosion.life--;

      if (explosion.life <= 0 || explosion.radius >= explosion.maxRadius) {
        this.explosions.splice(i, 1);
      }
    }
  }

  updateDamageTexts() {
    this.damageService.updateDamageTexts();
  }
}
