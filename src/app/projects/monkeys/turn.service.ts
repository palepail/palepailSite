import { Injectable } from '@angular/core';
import { Player, Enemy, TurnEntity } from './monkeys.types';
import * as CONST from './monkeys.constants';

@Injectable({
  providedIn: 'root',
})
export class TurnService {
  _turnQueue: TurnEntity[] = [];
  currentTurnIndex: number = 0;
  turnTime: number = 0; // Current turn timer
  private _turnStartTime: number = 0;
  readonly TIMEOUT_MS = 45000;

  get turnStartTime(): number {
    return this._turnStartTime;
  }

  get turnQueue(): TurnEntity[] {
    return this._turnQueue;
  }

  startTurn() {
    if (this._turnQueue.length > 0) {
      const waited = this._turnQueue[0].entity.delay;
      this._turnQueue.forEach((te) => (te.entity.delay -= waited));
    }
    this._turnStartTime = Date.now();
  }

  areAllEntitiesSettled(entities: (Player | Enemy)[]): boolean {
    return entities.every(
      (e) => e.body && Math.abs(e.body.velocity.x) <= 0.5 && Math.abs(e.body.velocity.y) <= 0.5,
    );
  }

  initTurnQueue(player: Player, enemies: Enemy[]) {
    this._turnQueue = [];

    // Add player to queue
    const playerRandomOffset = (Math.random() - 0.5) * 2 * 0.05 * player.vehicle.speed;
    player.delay = Math.round(100 - player.vehicle.speed + playerRandomOffset);
    this._turnQueue.push({
      id: 'player',
      type: 'player',
      entity: player,
      baseDelay: 100 - player.vehicle.speed,
      delay: player.delay,
    });

    // Add enemies to queue
    enemies.forEach((enemy, index) => {
      const enemyRandomOffset = (Math.random() - 0.5) * 2 * 0.05 * enemy.vehicle.speed;
      enemy.delay = Math.round(100 - enemy.vehicle.speed + enemyRandomOffset);
      this._turnQueue.push({
        id: `enemy_${index}`,
        type: 'enemy',
        entity: enemy,
        baseDelay: 100 - enemy.vehicle.speed,
        delay: enemy.delay,
      });
    });

    // Sort queue by entity.delay (lowest first); preserve insertion order for equal delays (FIFO).
    const initOrder = new Map(this._turnQueue.map((te, i) => [te, i]));
    this._turnQueue.sort((a, b) => a.entity.delay - b.entity.delay || initOrder.get(a)! - initOrder.get(b)!);
    this.currentTurnIndex = 0;
    this.turnTime = 0;
  }

  updateTurnQueue(deltaTime: number = 0) {
    // Remove inactive enemies from queue
    this._turnQueue = this._turnQueue.filter((turnEntity) => {
      if (turnEntity.type === 'enemy') {
        return (turnEntity.entity as Enemy).active;
      }
      return true;
    });

    // If current turn entity was removed, reset to first
    if (this.currentTurnIndex >= this._turnQueue.length) {
      this.currentTurnIndex = 0;
    }

    if (this._turnQueue.length > 0) {
      // entity state transitions are handled in MonkeysGameService.update()
    }
  }

  endTurn(actionCost: number = 100) {
    if (this._turnQueue.length === 0) return;

    // Normalize delays first
    this.startTurn();

    // Then add actionCost to the current entity's delay
    this._turnQueue[0].entity.delay += actionCost;

    // Resort queue by entity.delay; preserve existing queue order for equal delays (FIFO).
    const endOrder = new Map(this._turnQueue.map((te, i) => [te, i]));
    this._turnQueue.sort((a, b) => a.entity.delay - b.entity.delay || endOrder.get(a)! - endOrder.get(b)!);

    // Reset turn time
    this.turnTime = 0;

    // Reset player-specific flags
    if (this.isPlayerTurn()) {
      // Flags will be reset in main service
    }

    // Set next entity's turn state to turn_start
    const nextEntity = this.getCurrentTurnEntity();
    if (nextEntity) {
      const nextEntityObj = nextEntity.entity as any;
      nextEntityObj.turnState = 'turn_start';
    }

    // Clean up projectiles owned by previous entity
    const prevEntity = this._turnQueue[this._turnQueue.length - 1]; // Since resorted, last is previous
    if (prevEntity) {
      // Projectile cleanup will be handled in main service
    }
  }

  getCurrentTurnEntity(): TurnEntity | null {
    if (this._turnQueue.length === 0) return null;
    return this._turnQueue[0];
  }

  isPlayerTurn(): boolean {
    const current = this.getCurrentTurnEntity();
    return current?.type === 'player';
  }
}
