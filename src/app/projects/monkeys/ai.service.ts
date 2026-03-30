import { Injectable } from '@angular/core';
import { Player, Enemy } from './monkeys.types';
import * as CONST from './monkeys.constants';
import { PhysicsService } from './physics.service';

@Injectable({
  providedIn: 'root',
})
export class AIService {
  constructor(private physicsService: PhysicsService) {}
  performEnemyAction(enemy: Enemy, player: Player, enemies: Enemy[]) {
    const target: Player | Enemy = this.pickEnemyTarget(enemy, player, enemies);
    switch (enemy.turnState) {
      case 'turn_start':
        // Reset fuel at turn start
        enemy.movementFuel = enemy.vehicle.fuel;
        enemy.angle = enemy.angle || (enemy.vehicle.minAimAngle + enemy.vehicle.maxAimAngle) / 2;
        enemy.forceTerrainClearingShot = false;
        enemy.targetAngle = undefined;
        enemy.targetPower = undefined;
        enemy.reassessCount = 0;
        enemy.turnState = 'assess';
        enemy.assessCounter = CONST.ENEMY_ASSESS_DELAY;
        enemy.stuckCounter = 0;
        enemy.target = target;
        break;

      case 'assess':
        enemy.assessCounter -= 16;
        if (enemy.assessCounter > 0) {
          return;
        }
        // Assess situation and decide action
        const dx = target.x - enemy.x;
        const dy = target.y - enemy.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Set behavior
        if (!enemy.behavior) {
          if (enemy.health < 50) {
            enemy.behavior = 'defensive';
          } else {
            const rand = Math.random();
            enemy.behavior = rand < 0.4 ? 'aggressive' : rand < 0.7 ? 'defensive' : 'flanking';
          }
        }

        // Decide based on distance, fuel, and behavior
        let moveCloserThreshold = 400;
        let moveAwayThreshold = 150;
        if (enemy.behavior === 'aggressive') {
          moveCloserThreshold = 300;
          moveAwayThreshold = 100;
        } else if (enemy.behavior === 'defensive') {
          moveCloserThreshold = 500;
          moveAwayThreshold = 200;
        }

        enemy.reassessCount = (enemy.reassessCount ?? 0) + 1;
        const forceShot = enemy.reassessCount >= 3;

        if (!forceShot && distance > moveCloserThreshold && enemy.movementFuel! > 10) {
          // Too far, move closer or flank
          if (enemy.behavior === 'flanking') {
            enemy.moveDirection =
              Math.abs(dx) > distance * 0.5 ? (dy > 0 ? -1 : 1) : dx > 0 ? 1 : -1; // Perpendicular
          } else {
            enemy.moveDirection = dx > 0 ? 1 : -1; // Toward player
          }
          enemy.movementTimer = 1000 + Math.random() * 1000; // 1-2 seconds
          enemy.turnState = 'moving';
        } else if (!forceShot && distance < moveAwayThreshold && enemy.movementFuel! > 5) {
          // Too close, move away
          enemy.moveDirection = dx > 0 ? -1 : 1; // Away from player
          enemy.movementTimer = 800 + Math.random() * 600; // 0.8-1.4 seconds
          enemy.turnState = 'moving';
        } else {
          // Good distance (or forced after too many reassessments), aim and shoot
          enemy.facing = dx > 0 ? 1 : -1; // Face toward player
          enemy.targetAngle = undefined;
          enemy.targetPower = undefined;
          enemy.turnState = 'aiming';
          enemy.turnTimer = 0;
        }
        break;

      case 'moving':
        if (enemy.lastX === undefined) {
          enemy.lastX = enemy.x;
          enemy.lastY = enemy.y;
        }
        if (enemy.movementTimer! > 0) {
          // Movement logic will be handled in main service
          enemy.movementTimer! -= 16;
        } else {
          // Stop moving and assess again or aim
          enemy.moveDirection = 0;
          enemy.movementTimer = 0;
          // After moving, reassess or go to aiming
          const newDx = target.x - enemy.x;
          const newDistance = Math.abs(newDx);
          const maxReassess = (enemy.reassessCount ?? 0) >= 3;
          if (!maxReassess && (newDistance > 500 || newDistance < 100)) {
            enemy.turnState = 'assess'; // Reassess if still not ideal
          } else {
            enemy.facing = newDx > 0 ? 1 : -1;
            enemy.targetAngle = undefined;
            enemy.targetPower = undefined;
            enemy.turnState = 'aiming';
            enemy.turnTimer = 0;
          }
        }

        // Check for stuck
        const moved = Math.hypot(enemy.x - enemy.lastX!, enemy.y - enemy.lastY!);
        if (moved < 1) {
          enemy.stuckCounter += 16;
        } else {
          enemy.stuckCounter = 0;
        }
        if (enemy.stuckCounter > CONST.ENEMY_STUCK_THRESHOLD) {
          if (enemy.behavior === 'aggressive') {
            this.prepareAggressiveTerrainClearingShot(enemy);
            return;
          }
          enemy.turnState = 'aiming';
          enemy.targetAngle = undefined;
          enemy.targetPower = undefined;
          enemy.turnTimer = 0;
          enemy.stuckCounter = 0;
        }
        enemy.lastX = enemy.x;
        enemy.lastY = enemy.y;
        break;

      case 'aiming':
        if (enemy.targetAngle === undefined) {
          // Calculate precise angle to target
          const dx = target.x - enemy.x;
          const dy = target.y - enemy.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (enemy.forceTerrainClearingShot) {
            let directAngleDeg = (Math.atan2(-dy, dx) * 180) / Math.PI;
            directAngleDeg -= (enemy.terrainAngle * 180) / Math.PI;
            directAngleDeg = ((directAngleDeg % 360) + 360) % 360;

            enemy.facing = dx > 0 ? 1 : -1;

            let relativeAngleDeg = enemy.facing === 1 ? directAngleDeg : 180 - directAngleDeg;
            relativeAngleDeg = Math.max(
              enemy.vehicle.minAimAngle,
              Math.min(enemy.vehicle.maxAimAngle, relativeAngleDeg),
            );

            const maxFallbackPower = Math.max(20, enemy.vehicle.power);
            enemy.targetAngle = relativeAngleDeg;
            if (distance < 200) {
              enemy.targetPower = maxFallbackPower * (0.3 + Math.random() * 0.25);
            } else if (distance < 400) {
              enemy.targetPower = maxFallbackPower * (0.55 + Math.random() * 0.25);
            } else {
              enemy.targetPower = maxFallbackPower * (0.8 + Math.random() * 0.2);
            }

            enemy.forceTerrainClearingShot = false;
            enemy.angle =
              enemy.angle || (enemy.vehicle.minAimAngle + enemy.vehicle.maxAimAngle) / 2;
            enemy.chargeStartTime = Date.now();
            enemy.turnState = 'charging';
            return;
          }

          if (distance <= 50) {
            // Too close: fire a tactical shot instead of skipping turn.
            // Option A: low-power nearby dig shot to create cover.
            // Option B: high-angle shot to improve spacing/angle next turn.
            const maxPower = Math.max(20, enemy.vehicle.power);
            const useDigShot = Math.random() < 0.65;
            if (useDigShot) {
              enemy.facing = dx > 0 ? -1 : 1; // Aim away from player for nearby cover crater.
              enemy.targetAngle = Math.min(
                enemy.vehicle.maxAimAngle,
                enemy.vehicle.minAimAngle +
                  (enemy.vehicle.maxAimAngle - enemy.vehicle.minAimAngle) * 0.8,
              );
              enemy.targetPower = maxPower * (0.1 + Math.random() * 0.1);
            } else {
              enemy.facing = dx > 0 ? 1 : -1; // Keep line to player and lob a high arc.
              enemy.targetAngle = enemy.vehicle.maxAimAngle;
              enemy.targetPower = maxPower * (0.45 + Math.random() * 0.4);
            }

            enemy.angle =
              enemy.angle || (enemy.vehicle.minAimAngle + enemy.vehicle.maxAimAngle) / 2;
            enemy.chargeStartTime = Date.now();
            enemy.turnState = 'charging';
            return;
          }

          const angleRad = Math.atan2(-dy, dx);
          let angleDeg = (angleRad * 180) / Math.PI;

          // Adjust for terrain angle
          angleDeg -= (enemy.terrainAngle * 180) / Math.PI;

          // Normalize to 0-360
          angleDeg = ((angleDeg % 360) + 360) % 360;

          // Determine facing
          if (angleDeg <= 90) {
            enemy.facing = 1;
          } else if (angleDeg <= 180) {
            enemy.facing = -1;
          } else {
            enemy.facing = angleDeg <= 270 ? -1 : 1;
          }

          // Trajectory-based aiming
          let bestHit: { angle: number; power: number; dist: number } | null = null;
          const angleStep = 10; // degrees
          const maxPower = Math.max(20, enemy.vehicle.power);
          const powerStep = Math.max(10, Math.round(maxPower / 10)); // 10 bands up to max power.
          for (
            let relAng = enemy.vehicle.minAimAngle;
            relAng <= enemy.vehicle.maxAimAngle;
            relAng += angleStep
          ) {
            const baseAngleRad = (relAng * Math.PI) / 180;
            const simAngleRad =
              -enemy.terrainAngle + (enemy.facing === -1 ? Math.PI - baseAngleRad : baseAngleRad);
            const barrelEndX = enemy.x + Math.cos(simAngleRad) * CONST.BARREL_LENGTH;
            const barrelEndY = enemy.y - Math.sin(simAngleRad) * CONST.BARREL_LENGTH;
            for (let pow = 20; pow <= maxPower; pow += powerStep) {
              // Note: trajectory simulation will be called from main service
              // For now, assume it's available
              const { positions } = this.physicsService.simulateTrajectory(
                barrelEndX,
                barrelEndY,
                simAngleRad,
                pow,
                enemy.vehicle.bullet,
                this.physicsService.windSpeed,
                this.physicsService.windAngle,
              );
              for (const pos of positions) {
                const distToTarget = Math.hypot(pos.x - target.x, pos.y - target.y);
                if (distToTarget < 50 && (!bestHit || distToTarget < bestHit.dist)) {
                  bestHit = { angle: relAng, power: pow, dist: distToTarget };
                }
              }
            }
          }

          const scatter =
            CONST.DIFFICULTY_SCATTER[this.difficulty] ?? CONST.DIFFICULTY_SCATTER['normal'];
          const angleScatter = (Math.random() * 2 - 1) * scatter.angleDeg;
          const powerScatter = (Math.random() * 2 - 1) * scatter.powerFrac;

          if (bestHit) {
            const maxPower = Math.max(20, enemy.vehicle.power);
            enemy.targetAngle = Math.max(
              enemy.vehicle.minAimAngle,
              Math.min(enemy.vehicle.maxAimAngle, bestHit.angle + angleScatter),
            );
            enemy.targetPower = Math.max(
              10,
              Math.min(maxPower, bestHit.power + powerScatter * maxPower),
            );
          } else {
            // Fallback to old logic
            let relativeAngleDeg: number;
            if (enemy.facing === 1) {
              relativeAngleDeg = angleDeg;
            } else {
              relativeAngleDeg = 180 - angleDeg;
            }
            relativeAngleDeg = Math.max(
              enemy.vehicle.minAimAngle,
              Math.min(enemy.vehicle.maxAimAngle, relativeAngleDeg + angleScatter),
            );
            enemy.targetAngle = relativeAngleDeg;
            const maxFallbackPower = Math.max(20, enemy.vehicle.power);
            if (distance < 200) {
              enemy.targetPower = maxFallbackPower * (0.3 + Math.random() * 0.25);
            } else if (distance < 400) {
              enemy.targetPower = maxFallbackPower * (0.55 + Math.random() * 0.25);
            } else {
              enemy.targetPower = maxFallbackPower * (0.8 + Math.random() * 0.2);
            }
            enemy.targetPower = Math.max(
              10,
              Math.min(maxFallbackPower, enemy.targetPower + powerScatter * maxFallbackPower),
            );
          }

          enemy.angle = enemy.angle || (enemy.vehicle.minAimAngle + enemy.vehicle.maxAimAngle) / 2;
          enemy.chargeStartTime = Date.now();
          enemy.turnState = 'charging';
        }
        break;

      case 'charging':
        // Charging logic handled in main service
        break;

      case 'bullet_in_flight':
        // Handled in main service
        break;

      case 'post_bullet':
        // Handled in main service
        break;
    }
  }

  private prepareAggressiveTerrainClearingShot(enemy: Enemy) {
    enemy.moveDirection = 0;
    enemy.movementTimer = 0;
    enemy.targetAngle = undefined;
    enemy.targetPower = undefined;
    enemy.forceTerrainClearingShot = true;
    enemy.turnState = 'aiming';
    enemy.turnTimer = 0;
    enemy.stuckCounter = 0;
  }

  private pickEnemyTarget(enemy: Enemy, player: Player, enemies: Enemy[]): Player | Enemy {
    const candidates: (Player | Enemy)[] = [
      ...(player.active ? [player] : []),
      ...enemies.filter((e) => e !== enemy && e.active),
    ];
    if (candidates.length === 0) return player;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  enemyShoot(enemy: Enemy, power: number) {
    const baseAngleRad = (enemy.angle * Math.PI) / 180;
    const angleRad =
      -enemy.terrainAngle + (enemy.facing === -1 ? Math.PI - baseAngleRad : baseAngleRad);
    const bullet = enemy.vehicle.bullet;
    const barrelLength = CONST.BARREL_LENGTH;
    const barrelEndX = enemy.x + Math.cos(angleRad) * barrelLength;
    const barrelEndY = enemy.y - Math.sin(angleRad) * barrelLength;

    // Trajectory simulation will be handled by physics service
    const { positions } = this.simulateTrajectory(barrelEndX, barrelEndY, angleRad, power, bullet);

    // Return the projectile data to be set in main service
    return {
      x: barrelEndX,
      y: barrelEndY,
      trajectory: positions,
      trajectoryIndex: 0,
      owner: enemy,
      bullet: bullet,
    };
  }

  private simulateTrajectory(
    startX: number,
    startY: number,
    angleRad: number,
    power: number,
    bullet: any,
  ) {
    // This will need to be injected or called from physics service
    // For now, placeholder
    return { positions: [], endReason: 'placeholder' };
  }

  // Set difficulty for scatter
  difficulty: 'easy' | 'normal' | 'hard' = 'normal';
}
