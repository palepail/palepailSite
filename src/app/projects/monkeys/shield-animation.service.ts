import { Injectable } from '@angular/core';

type ShieldState = 'idle' | 'damage' | 'break';

export interface ShieldDrawInfo {
  spriteName: string;
  rotation: number;
}

const SHIELD_IDLE_FRAME_MS = 80;
const SHIELD_IDLE_FRAMES = 14;
const SHIELD_IDLE_HOLD_MS = 3000;
const SHIELD_DAMAGE_FRAME_MS = 60;
const SHIELD_DAMAGE_FRAMES = 6;
const SHIELD_BREAK_FRAME_MS = 80;
const SHIELD_BREAK_FRAMES = 8;

@Injectable({ providedIn: 'root' })
export class ShieldAnimationService {
  private stateByEntity = new WeakMap<object, ShieldState>();
  private animStartByEntity = new WeakMap<object, number>();
  private idleStartByEntity = new WeakMap<object, number>();
  private prevHealthByEntity = new WeakMap<object, number>();

  reset(): void {
    this.stateByEntity = new WeakMap();
    this.animStartByEntity = new WeakMap();
    this.idleStartByEntity = new WeakMap();
    this.prevHealthByEntity = new WeakMap();
  }

  update(player: any, enemies: any[], now: number): void {
    this.trackEntity(player, now);
    for (const enemy of enemies) {
      this.trackEntity(enemy, now);
    }
  }

  /** Returns draw info for the shield overlay, or null if nothing should be drawn. */
  getShieldDrawInfo(entity: any, now: number): ShieldDrawInfo | null {
    const key = entity as object;
    const currentShield = entity.currentShieldHealth ?? 0;
    const state = this.stateByEntity.get(key) ?? 'idle';
    const animStart = this.animStartByEntity.get(key) ?? 0;

    if (state === 'break') {
      const frame = Math.floor((now - animStart) / SHIELD_BREAK_FRAME_MS);
      if (frame >= SHIELD_BREAK_FRAMES) {
        this.stateByEntity.delete(key);
        return null;
      }
      return { spriteName: `shield_break_${frame}`, rotation: entity.shieldHitAngle ?? 0 };
    }

    if (state === 'damage') {
      const frame = Math.floor((now - animStart) / SHIELD_DAMAGE_FRAME_MS);
      if (frame >= SHIELD_DAMAGE_FRAMES) {
        this.stateByEntity.set(key, 'idle');
        this.idleStartByEntity.set(key, now);
        if (currentShield <= 0) return null;
        return { spriteName: `shield_idle_${this.getIdleFrame(now, now)}`, rotation: 0 };
      }
      return { spriteName: `shield_damage_${frame}`, rotation: entity.shieldHitAngle ?? 0 };
    }

    // idle state
    if (currentShield <= 0) return null;
    if (!this.idleStartByEntity.has(key)) {
      this.idleStartByEntity.set(key, now);
    }
    const idleStart = this.idleStartByEntity.get(key)!;
    return { spriteName: `shield_idle_${this.getIdleFrame(now, idleStart)}`, rotation: 0 };
  }

  private trackEntity(entity: any, now: number): void {
    const key = entity as object;
    const current = entity.currentShieldHealth ?? 0;
    const prev = this.prevHealthByEntity.get(key);
    if (prev !== undefined && current < prev) {
      this.stateByEntity.set(key, current <= 0 ? 'break' : 'damage');
      this.animStartByEntity.set(key, now);
    }
    this.prevHealthByEntity.set(key, current);
  }

  private getIdleFrame(now: number, idleStart: number): number {
    const cycleDuration = SHIELD_IDLE_FRAMES * SHIELD_IDLE_FRAME_MS + SHIELD_IDLE_HOLD_MS;
    const pos = (now - idleStart) % cycleDuration;
    return pos < SHIELD_IDLE_FRAMES * SHIELD_IDLE_FRAME_MS
      ? Math.floor(pos / SHIELD_IDLE_FRAME_MS)
      : SHIELD_IDLE_FRAMES - 1;
  }
}
