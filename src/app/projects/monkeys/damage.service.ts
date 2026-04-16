import { Injectable } from '@angular/core';
import {
  Player,
  Enemy,
  DamageText,
  DamageEvent,
  DamageResult,
  CombatLogEntry,
} from './monkeys.types';
import * as CONST from './monkeys.constants';
import { MonkeysSfxService } from './monkeys-sfx.service';

@Injectable({
  providedIn: 'root',
})
export class DamageService {
  constructor(private sfxService: MonkeysSfxService) {}

  damageTexts: DamageText[] = [];
  combatLog: CombatLogEntry[] = [];
  anyDamageAppliedThisTurn = false;
  /** Entities that crossed the 20% health threshold this frame — drained by game service to trigger emotes. */
  lowHealthCrossedEntities: (Player | Enemy)[] = [];

  /** Accumulates all explosion damage for a single turn; flushed to combatLog at aftermath end. */
  private batchAccumulator = new Map<string, CombatLogEntry>();

  applyDamage(
    entity: Player | Enemy,
    event: DamageEvent,
    entityType: 'player' | 'enemy',
  ): DamageResult {
    const prevHealth = entity.health;
    entity.health -= event.amount;
    entity.health = Math.max(0, Math.min(entity.health, entity.vehicle.health));
    const actualAmount = prevHealth - entity.health;

    if (actualAmount > 0) {
      this.damageTexts.push({
        x: entity.x,
        y: entity.y - 30,
        damage: actualAmount,
        life: CONST.DAMAGE_TEXT_LIFETIME,
      });
    }

    const wasKilled = entity.health <= 0;
    const lowThreshold = entity.vehicle.health * 0.2;
    const crossedLowHealthThreshold =
      !wasKilled && prevHealth > lowThreshold && entity.health <= lowThreshold;
    if (crossedLowHealthThreshold) this.lowHealthCrossedEntities.push(entity);

    if (actualAmount > 0 && event.source !== 'poison') {
      this.anyDamageAppliedThisTurn = true;
    }

    // --- Combat log accumulation ---
    if (event.source === 'explosion' && actualAmount > 0 && event.attackerName) {
      const targetName = entity.displayName ?? 'Unknown';
      const key = `${event.attackerName}|${targetName}|${event.weaponName ?? ''}`;
      const existing = this.batchAccumulator.get(key);
      if (existing) {
        existing.totalDamage += actualAmount;
        if (wasKilled) existing.wasFatal = true;
      } else {
        this.batchAccumulator.set(key, {
          type: 'damage',
          attackerName: event.attackerName,
          targetName,
          weaponName: event.weaponName ?? '',
          totalDamage: actualAmount,
          wasFatal: wasKilled,
        });
      }
    }

    if (event.source === 'fall' && actualAmount > 0) {
      // Attribute to last attacker only if they damaged this entity this same turn (still in batch)
      const targetName = entity.displayName ?? 'Unknown';
      const batchEntry = [...this.batchAccumulator.values()].find(
        (e) => e.targetName === targetName,
      );
      const attackerName = batchEntry?.attackerName ?? '';
      this.addToLog({
        type: 'fall',
        attackerName,
        targetName,
        weaponName: '',
        totalDamage: actualAmount,
        wasFatal: wasKilled,
      });
    }

    if (event.source === 'poison' && actualAmount > 0) {
      // Poison is status damage — does NOT set anyDamageAppliedThisTurn (turn continues normally)
      // and logs immediately rather than accumulating in the batch.
      const targetName = entity.displayName ?? 'Unknown';
      this.addToLog({
        type: 'damage',
        attackerName: event.attackerName ?? '',
        targetName,
        weaponName: event.weaponName ?? '',
        totalDamage: actualAmount,
        wasFatal: wasKilled,
      });
    }

    // --- VO ---
    if (entity.vehicle.voicePack) {
      if (wasKilled) {
        // Player death VO is handled by monkeys-game.service (plays 'lose') — skip here to avoid double-playing.
        if (entityType !== 'player') {
          this.sfxService.playVo(
            entity,
            entity.vehicle.voicePack,
            event.source === 'fall' ? 'fall' : 'ochisou',
          );
        }      } else if (actualAmount > 0) {
        this.sfxService.playVo(entity, entity.vehicle.voicePack, 'bump');
      }
    }

    // Mark enemies as dead
    if (wasKilled && entityType === 'enemy') {
      (entity as Enemy).active = false;
      (entity as Enemy).entityState = 'dead';
    }

    return { actualAmount, wasKilled, source: event.source, crossedLowHealthThreshold };
  }

  /** Called at the end of each aftermath — pushes accumulated batch entries to the log. */
  flushBatch(): void {
    for (const entry of this.batchAccumulator.values()) {
      this.addToLog(entry);
    }
    this.batchAccumulator.clear();
    this.anyDamageAppliedThisTurn = false;
  }

  /** Called at game start to wipe the log. */
  resetLog(): void {
    this.combatLog = [];
    this.batchAccumulator.clear();
    this.anyDamageAppliedThisTurn = false;
  }

  addToLog(entry: CombatLogEntry): void {
    this.combatLog.push(entry);
    if (this.combatLog.length > 12) this.combatLog.shift();
  }

  updateDamageTexts(): void {
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
