import { Injectable } from '@angular/core';
import {
  EquipmentItem,
  EquipmentSet,
  EquipmentSlot,
  EquipmentStats,
  Vehicle,
} from './monkeys.types';
import * as CONST from './monkeys.constants';

const SLOTS: EquipmentSlot[] = ['headgear', 'torso', 'legs', 'footwear', 'accessory'];

/** Difficulty → how many slots are filled with the chosen set (min/max, inclusive). */
const SLOT_FILL_RANGE: Record<string, [number, number]> = {
  easy: [1, 2],
  normal: [2, 4],
  hard: [3, 5],
};

type Loadout = Record<EquipmentSlot, EquipmentItem | null>;

@Injectable({ providedIn: 'root' })
export class EnemyFactoryService {
  /**
   * Build a random equipment loadout for an enemy.
   *
   * Full set (~20%): all 5 slots filled from one randomly chosen set.
   * Partial set (~80%): N slots from a chosen set (difficulty-gated),
   *   remaining slots filled with a random item from ANY other set or "none".
   */
  buildEnemyLoadout(difficulty: string, items: EquipmentItem[], sets: EquipmentSet[]): Loadout {
    if (!items.length || !sets.length) return this.emptyLoadout();

    const isFullSet = Math.random() < 0.2;
    const chosenSet = sets[Math.floor(Math.random() * sets.length)];

    const shuffledSlots = [...SLOTS].sort(() => Math.random() - 0.5);

    let fillCount: number;
    if (isFullSet) {
      fillCount = SLOTS.length;
    } else {
      const [min, max] = SLOT_FILL_RANGE[difficulty] ?? SLOT_FILL_RANGE['normal'];
      fillCount = min + Math.floor(Math.random() * (max - min + 1));
    }

    const setSlots = new Set(shuffledSlots.slice(0, fillCount));

    const loadout: Loadout = this.emptyLoadout();

    for (const slot of SLOTS) {
      if (setSlots.has(slot)) {
        // Fill from chosen set
        loadout[slot] = items.find((i) => i.slot === slot && i.setId === chosenSet.id) ?? null;
      } else {
        // Random: none-item or any item from a different set
        const candidates = items.filter((i) => i.slot === slot && i.setId !== chosenSet.id);
        if (!candidates.length) continue;
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        // Only assign if it actually has stats (not the bare "None" placeholder) ~50% chance
        loadout[slot] = Math.random() < 0.5 ? pick : (candidates.find((i) => !i.setId) ?? null);
      }
    }

    return loadout;
  }

  /**
   * Apply a loadout (and its set bonus if applicable) to a vehicle in-place.
   * Mirrors MonkeysGameService.applyEquipmentToVehicle but takes explicit args.
   */
  applyLoadoutToVehicle(vehicle: Vehicle, loadout: Loadout, sets: EquipmentSet[]): void {
    for (const item of Object.values(loadout)) {
      if (!item?.stats) continue;
      const s = item.stats;
      if (s.attack) vehicle.bullet.damage += s.attack;
      if (s.health) vehicle.health += s.health;
      if (s.armor) vehicle.armor = 1 - (1 - (vehicle.armor ?? 0)) * (1 - s.armor / 100);
      if (s.pushbackMultiplier !== undefined)
        vehicle.bullet.pushbackMultiplier =
          (vehicle.bullet.pushbackMultiplier ?? 1) * s.pushbackMultiplier;
      if (s.blastRadius) {
        vehicle.bullet.explosionRadius = Math.max(
          5,
          vehicle.bullet.explosionRadius + s.blastRadius,
        );
        vehicle.bullet.craterRadius = Math.max(
          5,
          vehicle.bullet.craterRadius + Math.round(s.blastRadius * 0.8),
        );
      }
      if (s.fuel) vehicle.fuel = Math.max(10, vehicle.fuel + s.fuel);
      if (s.climbAngle) vehicle.climbAngle = Math.max(10, vehicle.climbAngle + s.climbAngle);
      if (s.minAimAngle) vehicle.minAimAngle = Math.max(0, vehicle.minAimAngle + s.minAimAngle);
      if (s.maxAimAngle) vehicle.maxAimAngle = Math.min(90, vehicle.maxAimAngle + s.maxAimAngle);
      if (s.lifesteal) vehicle.lifesteal = (vehicle.lifesteal ?? 0) + s.lifesteal;
      if (s.weight) vehicle.weight = (vehicle.weight ?? 10) + s.weight;
      if (s.shieldRadius) vehicle.shieldRadius = (vehicle.shieldRadius ?? 0) + s.shieldRadius;
      if (s.shieldHealth) vehicle.shieldHealth = (vehicle.shieldHealth ?? 0) + s.shieldHealth;
    }

    // Set bonus — applies only if all 5 slots share the same setId
    const setBonus = this.getLoadoutSetBonus(loadout, sets);
    if (setBonus) {
      this.applySetBonus(vehicle, setBonus);
    }

    vehicle.minAimAngle = Math.min(vehicle.minAimAngle, vehicle.maxAimAngle - 5);
  }

  /**
   * Build a fully equipped vehicle for an enemy, ready to be assigned to Enemy.vehicle.
   */
  buildEnemyVehicle(
    difficulty: string,
    items: EquipmentItem[],
    sets: EquipmentSet[],
  ): { vehicle: Vehicle; loadout: Loadout } {
    // ~35% chance to use Zombie Lupin as the base vehicle
    const useZombie = Math.random() < 0.35;
    const base = useZombie ? CONST.ZOMBIE_LUPIN_VEHICLE : CONST.PLAYER_VEHICLE;
    const vehicle: Vehicle = {
      ...base,
      bullet: {
        ...base.bullet,
        ...(base.bullet.childBullet ? { childBullet: { ...base.bullet.childBullet } } : {}),
      },
    };
    const loadout = this.buildEnemyLoadout(difficulty, items, sets);
    this.applyLoadoutToVehicle(vehicle, loadout, sets);
    return { vehicle, loadout };
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private emptyLoadout(): Loadout {
    return { headgear: null, torso: null, legs: null, footwear: null, accessory: null };
  }

  private getLoadoutSetBonus(loadout: Loadout, sets: EquipmentSet[]): EquipmentStats | null {
    const setIds = SLOTS.map((s) => loadout[s]?.setId ?? null);
    if (setIds.some((id) => !id)) return null;
    const firstId = setIds[0]!;
    if (!setIds.every((id) => id === firstId)) return null;
    return sets.find((s) => s.id === firstId)?.bonus ?? null;
  }

  private applySetBonus(vehicle: Vehicle, bonus: EquipmentStats): void {
    if (bonus.lifesteal) vehicle.lifesteal = (vehicle.lifesteal ?? 0) + bonus.lifesteal;
    if (bonus.shieldRadius) vehicle.shieldRadius = (vehicle.shieldRadius ?? 0) + bonus.shieldRadius;
    if (bonus.shieldHealth) vehicle.shieldHealth = (vehicle.shieldHealth ?? 0) + bonus.shieldHealth;
    if (bonus.pushbackMultiplier !== undefined)
      vehicle.bullet.pushbackMultiplier =
        (vehicle.bullet.pushbackMultiplier ?? 1) * bonus.pushbackMultiplier;
    if (bonus.aimGuide) vehicle.aimGuide = bonus.aimGuide;
  }
}
