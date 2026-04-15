import { Injectable } from '@angular/core';
import {
  EquipmentItem,
  EquipmentSet,
  EquipmentSlot,
  EquipmentStats,
  Vehicle,
} from './monkeys.types';
import * as CONST from './monkeys.constants';

@Injectable({
  providedIn: 'root',
})
export class EquipmentService {
  equipped: Record<EquipmentSlot, EquipmentItem | null> = {
    headgear: null,
    torso: null,
    legs: null,
    footwear: null,
    accessory: null,
  };
  equipmentItems: EquipmentItem[] = [];
  equipmentSets: EquipmentSet[] = [];
  private equipmentLoadPromise: Promise<void> | null = null;

  playerName = 'Player';
  selectedVehicleIndex = 0; // index into CONST.SELECTABLE_VEHICLES

  async loadEquipmentData(): Promise<void> {
    if (this.equipmentLoadPromise) return this.equipmentLoadPromise;
    this.equipmentLoadPromise = (async () => {
      try {
        const response = await fetch('assets/monkeys/equipment.json');
        if (!response.ok) return;
        const data = (await response.json()) as { items: EquipmentItem[]; sets: EquipmentSet[] };
        this.equipmentItems = data.items;
        this.equipmentSets = data.sets ?? [];
        this.loadLoadout();
      } catch {
        /* ignore load failure */
      }
    })();
    return this.equipmentLoadPromise;
  }

  getItemsForSlot(slot: EquipmentSlot): EquipmentItem[] {
    return this.equipmentItems.filter((i) => i.slot === slot);
  }

  getEquippedSetBonus(): EquipmentStats | null {
    const slots: EquipmentSlot[] = ['headgear', 'torso', 'legs', 'footwear', 'accessory'];
    const setIds = slots.map((s) => this.equipped[s]?.setId ?? null);
    if (setIds.some((id) => !id)) return null;
    const firstId = setIds[0]!;
    if (!setIds.every((id) => id === firstId)) return null;
    const set = this.equipmentSets.find((s) => s.id === firstId);
    return set?.bonus ?? null;
  }

  saveLoadout(): void {
    const savedEquipped: Record<string, string | null> = {};
    for (const slot of ['headgear', 'torso', 'legs', 'footwear', 'accessory'] as EquipmentSlot[]) {
      savedEquipped[slot] = this.equipped[slot]?.id ?? null;
    }
    localStorage.setItem(
      'monkeys_loadout',
      JSON.stringify({
        playerName: this.playerName,
        equipped: savedEquipped,
        selectedVehicleIndex: this.selectedVehicleIndex,
      }),
    );
  }

  private loadLoadout(): void {
    const raw = localStorage.getItem('monkeys_loadout');
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as {
        playerName?: string;
        equipped?: Record<string, string | null>;
        selectedVehicleIndex?: number;
      };
      if (typeof data.playerName === 'string' && data.playerName.trim()) {
        this.playerName = data.playerName.trim().slice(0, 12);
      }
      if (
        typeof data.selectedVehicleIndex === 'number' &&
        data.selectedVehicleIndex >= 0 &&
        data.selectedVehicleIndex < CONST.SELECTABLE_VEHICLES.length &&
        !CONST.SELECTABLE_VEHICLES[data.selectedVehicleIndex]?.locked
      ) {
        this.selectedVehicleIndex = data.selectedVehicleIndex;
      }
      if (data.equipped) {
        for (const [slot, id] of Object.entries(data.equipped)) {
          if (!id) continue;
          const item = this.equipmentItems.find((i) => i.id === id) ?? null;
          if (item) (this.equipped as Record<string, EquipmentItem | null>)[slot] = item;
        }
      }
    } catch {
      /* corrupted data, ignore */
    }
  }

  static applyItemStatsToVehicle(vehicle: Vehicle, stats: EquipmentStats): void {
    if (stats.attack) vehicle.bullet.damage *= 1 + stats.attack / 100;
    if (stats.health) vehicle.health += stats.health;
    if (stats.armor) vehicle.armor = 1 - (1 - (vehicle.armor ?? 0)) * (1 - stats.armor / 100);
    if (stats.pushbackMultiplier !== undefined)
      vehicle.bullet.pushbackMultiplier =
        (vehicle.bullet.pushbackMultiplier ?? 1) * stats.pushbackMultiplier;
    if (stats.blastRadius) {
      vehicle.bullet.explosionRadius = Math.max(
        5,
        vehicle.bullet.explosionRadius + stats.blastRadius,
      );
      vehicle.bullet.craterRadius = Math.max(
        5,
        vehicle.bullet.craterRadius + Math.round(stats.blastRadius * 0.8),
      );
      if (vehicle.bullet.childBullet) {
        vehicle.bullet.childBullet.explosionRadius = Math.max(
          5,
          vehicle.bullet.childBullet.explosionRadius + Math.round(stats.blastRadius * 0.5),
        );
        vehicle.bullet.childBullet.craterRadius = Math.max(
          5,
          vehicle.bullet.childBullet.craterRadius + Math.round(stats.blastRadius * 0.4),
        );
      }
    }
    if (stats.fuel) vehicle.fuel = Math.max(10, vehicle.fuel + stats.fuel);
    if (stats.climbAngle) vehicle.climbAngle = Math.max(10, vehicle.climbAngle + stats.climbAngle);
    if (stats.minAimAngle) vehicle.minAimAngle = Math.max(0, vehicle.minAimAngle + stats.minAimAngle);
    if (stats.maxAimAngle) vehicle.maxAimAngle = Math.min(90, vehicle.maxAimAngle + stats.maxAimAngle);
    if (stats.lifesteal) vehicle.lifesteal = (vehicle.lifesteal ?? 0) + stats.lifesteal;
    if (stats.weight) vehicle.weight = (vehicle.weight ?? 10) + stats.weight;
    if (stats.shieldRadius) vehicle.shieldRadius = (vehicle.shieldRadius ?? 0) + stats.shieldRadius;
    if (stats.shieldHealth) vehicle.shieldHealth = (vehicle.shieldHealth ?? 0) + stats.shieldHealth;
  }

  static applySetBonusToVehicle(vehicle: Vehicle, bonus: EquipmentStats): void {
    if (bonus.lifesteal) vehicle.lifesteal = (vehicle.lifesteal ?? 0) + bonus.lifesteal;
    if (bonus.shieldRadius) vehicle.shieldRadius = (vehicle.shieldRadius ?? 0) + bonus.shieldRadius;
    if (bonus.shieldHealth) vehicle.shieldHealth = (vehicle.shieldHealth ?? 0) + bonus.shieldHealth;
    if (bonus.pushbackMultiplier !== undefined)
      vehicle.bullet.pushbackMultiplier =
        (vehicle.bullet.pushbackMultiplier ?? 1) * bonus.pushbackMultiplier;
    if (bonus.aimGuide) vehicle.aimGuide = bonus.aimGuide;
  }

  applyEquipmentToVehicle(vehicle: Vehicle): void {
    // Apply vehicle's base attack scaling before any equipment modifiers
    if (vehicle.attack !== undefined) {
      vehicle.bullet.damage = Math.round((vehicle.bullet.damage * vehicle.attack) / 100);
      if (vehicle.bullet.childBullet) {
        vehicle.bullet.childBullet.damage = Math.round(
          (vehicle.bullet.childBullet.damage * vehicle.attack) / 100,
        );
      }
    }
    for (const item of Object.values(this.equipped)) {
      if (!item?.stats) continue;
      EquipmentService.applyItemStatsToVehicle(vehicle, item.stats);
    }
    const setBonus = this.getEquippedSetBonus();
    if (setBonus) EquipmentService.applySetBonusToVehicle(vehicle, setBonus);
    vehicle.minAimAngle = Math.min(vehicle.minAimAngle, vehicle.maxAimAngle - 5);
  }
}
