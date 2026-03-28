import { Injectable } from '@angular/core';
import { Player, Enemy } from './monkeys.types';
import * as CONST from './monkeys.constants';

@Injectable({
  providedIn: 'root',
})
export class CollisionService {

  constructor() { }

  checkPlayerTerrainCollision(player: Player, terrain: number[][], physicsService: any) {
    if (!player.body) return;

    const terrainHeight = this.getTerrainHeightAt(player.x, terrain);
    if (terrainHeight !== -1) {
      const terrainAngle = this.getTerrainAngleAt(player.x, terrain);
      const tankHalfHeight = CONST.TANK_HALF_HEIGHT;
      const tankBottom = player.body.position.y + tankHalfHeight;

      if (tankBottom > terrainHeight) {
        // Player is below terrain surface, reposition to surface
        const targetY = terrainHeight - tankHalfHeight;
        physicsService.Body.setPosition(player.body, { x: player.x, y: targetY });
        physicsService.Body.setVelocity(player.body, { x: player.body.velocity.x, y: 0 });

        player.terrainAngle = terrainAngle;
      }
    }
  }

  checkEnemiesTerrainCollision(enemies: Enemy[], terrain: number[][], physicsService: any) {
    for (const enemy of enemies) {
      if (enemy.body && enemy.active) {
        const terrainHeight = this.getTerrainHeightAt(enemy.x, terrain);
        if (terrainHeight !== -1) {
          const terrainAngle = this.getTerrainAngleAt(enemy.x, terrain);
          const tankHalfHeight = CONST.TANK_HALF_HEIGHT;
          const tankBottom = enemy.body.position.y + tankHalfHeight;

          if (tankBottom > terrainHeight) {
            // Enemy is below terrain surface, reposition to surface
            const targetY = terrainHeight - tankHalfHeight;
            physicsService.Body.setPosition(enemy.body, { x: enemy.x, y: targetY });
            physicsService.Body.setVelocity(enemy.body, { x: enemy.body.velocity.x, y: 0 });
          }
          // If enemy is above terrain, let gravity pull it down

          enemy.terrainAngle = terrainAngle;
        }
        // If no terrain at enemy position, let it fall under gravity
      }
    }
  }

  checkEntitiesFall(player: Player, enemies: Enemy[]) {
    // Check player fall
    if (player.y > CONST.CANVAS_HEIGHT + CONST.FALL_THRESHOLD_OFFSET) {
      player.health = 0;
    }

    // Check enemies fall
    for (const enemy of enemies) {
      if (enemy.active && enemy.y > CONST.CANVAS_HEIGHT + CONST.FALL_THRESHOLD_OFFSET) {
        enemy.health = 0;
        enemy.active = false;
        if (enemy.body) {
          // Remove body handled in main service
        }
      }
    }
  }

  getTerrainHeightAt(x: number, terrain: number[][]): number {
    const ix = Math.floor(x);
    if (ix < 0 || ix >= CONST.TERRAIN_WIDTH) return -1;

    for (let y = 0; y < CONST.TERRAIN_STRIP_HEIGHT; y++) {
      if (terrain[ix] && terrain[ix][y] === 1) {
        return CONST.CANVAS_HEIGHT - CONST.TERRAIN_BASE_Y_OFFSET + y;
      }
    }
    return -1;
  }

  getTerrainAngleAt(x: number, terrain: number[][]): number {
    const h1 = this.getTerrainHeightAt(x - CONST.TERRAIN_SLOPE_SAMPLE_DISTANCE, terrain);
    const h2 = this.getTerrainHeightAt(x + CONST.TERRAIN_SLOPE_SAMPLE_DISTANCE, terrain);
    if (h1 === -1 || h2 === -1) return 0;

    const slope = (h2 - h1) / (2 * CONST.TERRAIN_SLOPE_SAMPLE_DISTANCE);
    return Math.atan(slope);
  }
}
