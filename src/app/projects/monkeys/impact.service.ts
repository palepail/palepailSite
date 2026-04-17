import { Injectable } from '@angular/core';
import { Explosion } from './monkeys.types';
import * as CONST from './monkeys.constants';

@Injectable({ providedIn: 'root' })
export class ImpactService {
  explosions: Explosion[] = [];

  pushExplosion(x: number, y: number, bullet: any): void {
    this.explosions.push({
      x,
      y,
      radius: CONST.EXPLOSION_INITIAL_RADIUS,
      maxRadius: CONST.EXPLOSION_MAX_RADIUS,
      life: CONST.EXPLOSION_LIFETIME_FRAMES,
      shape: bullet.explosionShape,
      spriteName: bullet.explosionSprite,
    });
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
              terrain[ix][iy] = 0;
            }
          }
        }
      }
    }
  }

  updateExplosions(): void {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const explosion = this.explosions[i];
      explosion.radius += CONST.EXPLOSION_EXPANSION_RATE;
      explosion.life--;
      if (explosion.life <= 0 || explosion.radius >= explosion.maxRadius) {
        this.explosions.splice(i, 1);
      }
    }
  }
}
