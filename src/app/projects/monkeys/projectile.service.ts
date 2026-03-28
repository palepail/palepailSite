import { Injectable } from '@angular/core';
import {
  Player,
  Enemy,
  Projectile,
  Explosion,
  ExplodedProjectile,
  DamageText,
} from './monkeys.types';
import * as CONST from './monkeys.constants';

@Injectable({
  providedIn: 'root',
})
export class ProjectileService {
  projectile: Projectile | null = null;
  explosions: Explosion[] = [];
  explodedProjectiles: ExplodedProjectile[] = [];
  damageTexts: DamageText[] = [];

  updateTrajectoryProjectile(terrain: number[][], physicsService: any) {
    if (
      !this.projectile ||
      !this.projectile.trajectory ||
      this.projectile.trajectoryIndex === undefined
    )
      return;

    const index = this.projectile.trajectoryIndex;
    const positions = this.projectile.trajectory;

    if (index >= positions.length) {
      this.destroyTrajectoryProjectile(terrain);
      return;
    }

    // Set position to current trajectory point
    this.projectile.x = positions[index].x;
    this.projectile.y = positions[index].y;

    // Check if projectile went off game area
    if (
      this.projectile.x < -CONST.OFFSCREEN_EXPLODE_MARGIN_X ||
      this.projectile.x > CONST.TERRAIN_WIDTH + CONST.OFFSCREEN_EXPLODE_MARGIN_X ||
      this.projectile.y > CONST.TERRAIN_HEIGHT + CONST.OFFSCREEN_EXPLODE_MARGIN_Y_BOTTOM ||
      this.projectile.y < -CONST.OFFSCREEN_EXPLODE_MARGIN_Y_TOP
    ) {
      this.destroyTrajectoryProjectile(terrain);
      return;
    }

    // Check terrain collision
    const px = Math.floor(this.projectile.x);
    const py = Math.floor(this.projectile.y);
    const terrainY = CONST.CANVAS_HEIGHT - CONST.TERRAIN_BASE_Y_OFFSET;
    const terrainLocalY = py - terrainY;

    if (
      px >= 0 &&
      px < CONST.TERRAIN_WIDTH &&
      terrainLocalY >= 0 &&
      terrainLocalY < terrain[px]?.length &&
      terrain[px][terrainLocalY] === 1
    ) {
      this.destroyTrajectoryProjectile(terrain);
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
      this.destroyTrajectoryProjectile(terrain);
      return;
    }

    // Check shield boundary
    // Shield check will be handled in main service

    // Check collision with entities - handled in main service

    // Advance to next position
    this.projectile.trajectoryIndex++;
  }

  destroyTrajectoryProjectile(terrain: number[][]) {
    if (!this.projectile) return;

    this.explosions.push({
      x: this.projectile.x,
      y: this.projectile.y,
      radius: CONST.EXPLOSION_INITIAL_RADIUS,
      maxRadius: CONST.EXPLOSION_MAX_RADIUS,
      life: CONST.EXPLOSION_LIFETIME_FRAMES,
      shape: this.projectile.bullet.explosionShape,
    });

    // Apply damage - handled in main service

    // Create crater
    this.createCrater(this.projectile.x, this.projectile.y, terrain, this.projectile.bullet);

    this.explodedProjectiles.push({
      position: { x: this.projectile.x, y: this.projectile.y },
      bullet: this.projectile.bullet,
      removalTime: Date.now() + 2000,
      owner: this.projectile.owner,
    });

    this.projectile = null;
  }

  calculateExplosionDamage(
    explosionX: number,
    explosionY: number,
    projectile: any,
    player: Player,
    enemies: Enemy[],
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
        // Knockback handled in physics service
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
          // Knockback handled in physics service
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
            if (enemy.body) {
              // Remove body handled in main service
            }
          }
        }
      }
    }
  }

  createCrater(centerX: number, centerY: number, terrain: number[][], bullet: any): void {
    const terrainY = CONST.CANVAS_HEIGHT - CONST.TERRAIN_BASE_Y_OFFSET;
    let craterRadiusX = bullet.craterRadius;
    let craterRadiusY = bullet.craterRadius;
    if (bullet.explosionShape === 'horizontal_oval') {
      craterRadiusX = bullet.craterRadius * 1.5;
    } else if (bullet.explosionShape === 'vertical_oval') {
      craterRadiusY = bullet.craterRadius * 1.5;
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
