import { Injectable } from '@angular/core';
import { Player, Enemy, Projectile, Explosion, DamageText } from './monkeys.types';
import * as CONST from './monkeys.constants';

@Injectable({
  providedIn: 'root',
})
export class ProjectileService {
  projectile: Projectile | null = null;
  explosions: Explosion[] = [];
  lastImpactPos: { x: number; y: number } | null = null;
  damageTexts: DamageText[] = [];

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

    this.explosions.push({
      x: explosionX,
      y: explosionY,
      radius: CONST.EXPLOSION_INITIAL_RADIUS,
      maxRadius: CONST.EXPLOSION_MAX_RADIUS,
      life: CONST.EXPLOSION_LIFETIME_FRAMES,
      shape: this.projectile.bullet.explosionShape,
    });

    this.calculateExplosionDamage(
      explosionX,
      explosionY,
      projectileSnapshot,
      player,
      enemies,
      physicsService,
    );

    // Create crater
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

    this.lastImpactPos = { x: explosionX, y: explosionY };
    this.projectile = null;
  }

  calculateExplosionDamage(
    explosionX: number,
    explosionY: number,
    projectile: any,
    player: Player,
    enemies: Enemy[],
    physicsService: any,
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

    // Damage player
    if (player.active) {
      const dx = player.x - explosionX;
      const dy = player.y - explosionY;
      const normalizedDist = Math.sqrt((dx / radiusX) ** 2 + (dy / radiusY) ** 2);
      if (normalizedDist <= 1) {
        const damage = Math.round(maxDamage * (1 - normalizedDist));
        const rawDamage = projectile.owner === player ? damage * 0.5 : damage;
        const actualDamage = Math.round(rawDamage * (1 - (player.vehicle.armor ?? 0)));
        player.health -= actualDamage;
        player.health = Math.max(0, Math.min(player.health, player.vehicle.health));
        this.damageTexts.push({
          x: player.x,
          y: player.y - 30,
          damage: actualDamage,
          life: CONST.DAMAGE_TEXT_LIFETIME,
        });
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
          enemy.health -= damage;
          enemy.health = Math.max(0, Math.min(enemy.health, enemy.vehicle.health));
          this.damageTexts.push({
            x: enemy.x,
            y: enemy.y - 30,
            damage: damage,
            life: CONST.DAMAGE_TEXT_LIFETIME,
          });
          physicsService.applyExplosionKnockback(
            enemy,
            explosionX,
            explosionY,
            projectile,
            radiusX,
            radiusY,
          );
          if (projectile.owner === player && player.vehicle.lifesteal && damage > 0) {
            const heal = Math.round(damage * (player.vehicle.lifesteal / 100));
            if (heal > 0) {
              player.health = Math.min(player.health + heal, player.vehicle.health);
              this.damageTexts.push({
                x: player.x,
                y: player.y - 30,
                damage: heal,
                life: CONST.DAMAGE_TEXT_LIFETIME,
                isHeal: true,
              });
            }
          }
          if (enemy.health <= 0) {
            enemy.active = false;
            enemy.entityState = 'dead';
            if (enemy.body) {
              physicsService.removeBody(enemy.body);
            }
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
    // Check collision with player
    if (player.active) {
      const dx = player.x - projectile.x;
      const dy = player.y - projectile.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < CONST.PROJECTILE_RADIUS + 15) {
        return true;
      }
    }

    // Check collision with enemies
    for (const enemy of enemies) {
      if (enemy.active) {
        const dx = enemy.x - projectile.x;
        const dy = enemy.y - projectile.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < CONST.PROJECTILE_RADIUS + 15) {
          return true;
        }
      }
    }

    return false;
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
    for (let i = this.damageTexts.length - 1; i >= 0; i--) {
      const text = this.damageTexts[i];
      text.y -= CONST.DAMAGE_TEXT_RISE_SPEED;
      text.life--;

      if (text.life <= 0) {
        this.damageTexts.splice(i, 1);
      }
    }
  }
}
