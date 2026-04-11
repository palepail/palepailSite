import { Injectable } from '@angular/core';
import { Player, Enemy } from './monkeys.types';
import * as CONST from './monkeys.constants';
import { DamageService } from './damage.service';

@Injectable({
  providedIn: 'root',
})
export class CollisionService {
  constructor(private damageService: DamageService) {}

  checkPlayerTerrainCollision(player: Player, terrain: number[][], physicsService: any) {
    if (!player.body) return;

    const terrainHeight = this.getTerrainHeightAt(player.x, terrain);
    if (terrainHeight !== -1) {
      const terrainAngle = this.getTerrainAngleAt(player.x, terrain);
      const tankHalfHeight = CONST.TANK_HALF_HEIGHT;
      const tankBottom = player.body.position.y + tankHalfHeight;
      const GROUNDED_ZONE = 3;

      if (tankBottom > terrainHeight - GROUNDED_ZONE) {
        // Guard: skip snap if terrain surface is above the entity's center (cliff/ledge from wind drift).
        // Override the guard when moving fast (e.g. lateral knockback crossing a crater wall).
        const speed = Math.sqrt(player.body.velocity.x ** 2 + player.body.velocity.y ** 2);
        const isMovingFast = speed > 3;
        const terrainIsClose = terrainHeight >= player.body.position.y - tankHalfHeight;
        if (isMovingFast || terrainIsClose) {
          // Kill downward velocity near/at surface to prevent gravity-snap jitter
          if (player.body.velocity.y > 0) {
            physicsService.Body.setVelocity(player.body, { x: player.body.velocity.x, y: 0 });
          }
          if (tankBottom > terrainHeight) {
            // Player is below terrain surface, reposition to surface
            const targetY = terrainHeight - tankHalfHeight;
            physicsService.Body.setPosition(player.body, { x: player.x, y: targetY });
            player.y = targetY; // keep entity.y in sync so camera doesn't read stale sunken position
          }
        }
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
          const GROUNDED_ZONE = 3;

          enemy.terrainAngle = terrainAngle;
          if (tankBottom > terrainHeight - GROUNDED_ZONE) {
            // Guard: skip snap if terrain surface is above the entity's center (cliff/ledge from wind drift).
            // Override the guard when moving fast (e.g. lateral knockback crossing a crater wall).
            const speed = Math.sqrt(enemy.body.velocity.x ** 2 + enemy.body.velocity.y ** 2);
            const isMovingFast = speed > 3;
            const terrainIsClose = terrainHeight >= enemy.body.position.y - tankHalfHeight;
            if (isMovingFast || terrainIsClose) {
              // Kill downward velocity near/at surface to prevent gravity-snap jitter
              if (enemy.body.velocity.y > 0) {
                physicsService.Body.setVelocity(enemy.body, { x: enemy.body.velocity.x, y: 0 });
              }
              if (tankBottom > terrainHeight) {
                // Enemy is below terrain surface, reposition to surface
                const targetY = terrainHeight - tankHalfHeight;
                physicsService.Body.setPosition(enemy.body, { x: enemy.x, y: targetY });
                enemy.y = targetY; // keep entity.y in sync so camera doesn't read stale sunken position
              }
            }
          }
        }
        // If no terrain at enemy position, let it fall under gravity
      }
    }
  }

  checkEntitiesFall(player: Player, enemies: Enemy[]) {
    // Check player fall
    if (player.y > CONST.CANVAS_HEIGHT + CONST.FALL_THRESHOLD_OFFSET) {
      this.damageService.applyDamage(player, { amount: player.health, source: 'fall' }, 'player');
    }

    // Check enemies fall
    for (const enemy of enemies) {
      if (enemy.active && enemy.y > CONST.CANVAS_HEIGHT + CONST.FALL_THRESHOLD_OFFSET) {
        this.damageService.applyDamage(enemy, { amount: enemy.health, source: 'fall' }, 'enemy');
        // Body removal handled in monkeys-game.service.ts updateEnemies
      }
    }
  }

  /**
   * Returns true if an entity at `entityX` is able to move in `direction` (+1 right, -1 left)
   * based on the forward slope. Shared by moveEntity() and wind-force gating so both systems
   * use identical cliff logic.
   */
  canTraverseSlopeInDirection(entityX: number, direction: number, terrain: number[][]): boolean {
    const lookAheadDist = CONST.TERRAIN_SLOPE_SAMPLE_DISTANCE;
    const lookAheadX = entityX + direction * lookAheadDist;
    const hasTerrain = this.getTerrainHeightAt(lookAheadX, terrain) !== -1;
    const hCurrent = this.getTerrainHeightAt(entityX, terrain);
    const hAhead = this.getTerrainHeightAt(lookAheadX, terrain);
    const forwardAngle =
      hCurrent !== -1 && hAhead !== -1 ? Math.atan((hAhead - hCurrent) / lookAheadDist) : 0;
    return !hasTerrain || forwardAngle >= -CONST.MAX_CLIMB_ANGLE;
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
    const MAX_ANGLE = Math.PI / 4; // 45° — clamp out crater-edge sampling artifacts
    return Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, Math.atan(slope)));
  }
}
