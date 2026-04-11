import { Injectable } from '@angular/core';
import { Player, Enemy, DamageText, DamageEvent, DamageResult } from './monkeys.types';
import * as CONST from './monkeys.constants';
import { MonkeysSfxService } from './monkeys-sfx.service';

@Injectable({
  providedIn: 'root',
})
export class DamageService {
  constructor(private sfxService: MonkeysSfxService) {}

  damageTexts: DamageText[] = [];

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

    if (entity.vehicle.voicePack) {
      if (wasKilled) {
        // Fall death overrides normal death VO
        this.sfxService.playVo(entity, entity.vehicle.voicePack, event.source === 'fall' ? 'fall' : 'ochisou');
      } else if (actualAmount > 0) {
        // Living hit — play bump (single-at-a-time guard is inside playVo)
        this.sfxService.playVo(entity, entity.vehicle.voicePack, 'bump');
      }
    }

    // Mark enemies as dead
    if (wasKilled && entityType === 'enemy') {
      (entity as Enemy).active = false;
      (entity as Enemy).entityState = 'dead';
    }

    return { actualAmount, wasKilled, source: event.source };
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
