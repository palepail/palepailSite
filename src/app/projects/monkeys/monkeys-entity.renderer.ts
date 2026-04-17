import { GameState, LayerFrameOffset } from './monkeys.types';
import {
  MonkeysRenderContext,
  ANGLE_CHAR_TO_SPRITE,
  drawSpriteChars,
  drawAngleText,
} from './monkeys-render-context';
import { MonkeysBackgroundRenderer } from './monkeys-background.renderer';
import * as CONST from './monkeys.constants';

export class MonkeysEntityRenderer {
  private readonly EXPLOSION_FRAME_COUNT = 6;
  private readonly EXPLOSION_SPRITE_FRAME_DURATION_MS = 110;
  private readonly HURT_SPRITE_DURATION_MS = 300;
  private readonly DEATH_SPRITE_FRAME_DURATION_MS = 100;
  private readonly DEATH_SPRITE_FRAME_COUNT = 3;
  private readonly DEATH_SPRITE_FADE_DURATION_MS = 1000;
  private readonly SHOOT_CHARGE_FRAME_COUNT = 4;
  private readonly SHOOT_TOTAL_FRAME_COUNT = 10;
  private readonly SHOOT_CHARGE_FRAME_DURATION_MS = 150;
  private readonly SHOOT_RELEASE_FRAME_DURATION_MS = 150;
  private readonly MOVE_FRAME_DURATIONS = [150, 150, 150, 80] as const;
  private readonly POWER_PERCENT_SPRITE_SIZE = 26;
  private readonly LUPIN_COMPOSITE = 'Lupin Composite.png';
  private readonly ZOMBIE_COMPOSITE = 'Zombie Lupin Composite.png';
  private readonly COMPOSITE_SHEETS = new Set<string>([
    'Lupin Composite.png',
    'Zombie Lupin Composite.png',
  ]);

  private shieldMaskCanvas: HTMLCanvasElement | null = null;
  private shieldMaskCtx: CanvasRenderingContext2D | null = null;

  constructor(
    private readonly rc: MonkeysRenderContext,
    private readonly bg: MonkeysBackgroundRenderer,
  ) {}

  // ─── Public API ───────────────────────────────────────────────────────────

  drawChargeBar(entity: any, maxPower: number, markerRatio?: number): void {
    const { ctx, cameraController, queueDraw } = this.rc;
    const barWidth = CONST.CHARGE_BAR_WIDTH;
    const barHeight = CONST.CHARGE_BAR_HEIGHT;
    const offsetX = entity.facing === 1 ? -CONST.CHARGE_BAR_OFFSET_X : CONST.CHARGE_BAR_OFFSET_X;
    const worldX = entity.x + offsetX;
    const worldY = entity.y - barHeight / 2;
    const screenPos = cameraController.worldToScreen(worldX, worldY);
    const barX = screenPos.x;
    const barY = screenPos.y;
    const chargeRatio = entity.power / maxPower;
    const pct = Math.round(chargeRatio * 100);
    const facing = entity.facing;
    const markerRatioCopy = markerRatio;

    queueDraw(CONST.LAYER_CHARGE_BAR, () => {
      ctx.fillStyle = CONST.CHARGE_BAR_BACKGROUND_COLOR;
      ctx.fillRect(barX, barY, barWidth, barHeight);

      ctx.fillStyle =
        chargeRatio < CONST.CHARGE_BAR_LOW_THRESHOLD
          ? CONST.CHARGE_BAR_LOW_COLOR
          : chargeRatio < CONST.CHARGE_BAR_HIGH_THRESHOLD
            ? CONST.CHARGE_BAR_MID_COLOR
            : CONST.CHARGE_BAR_HIGH_COLOR;
      ctx.fillRect(barX, barY + barHeight * (1 - chargeRatio), barWidth, barHeight * chargeRatio);

      ctx.strokeStyle = CONST.CHARGE_BAR_BORDER_COLOR;
      ctx.lineWidth = CONST.CHARGE_BAR_BORDER_WIDTH;
      ctx.strokeRect(barX, barY, barWidth, barHeight);

      if (markerRatioCopy !== undefined) {
        const markerY = barY + barHeight * (1 - markerRatioCopy);
        ctx.strokeStyle = '#FF8C00';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(barX - 5, markerY);
        ctx.lineTo(barX + barWidth + 5, markerY);
        ctx.stroke();
        const markerPct = Math.round(markerRatioCopy * 100);
        const labelSize = 16;
        const labelCentreX = facing === 1 ? barX - 20 : barX + barWidth + 20;
        this.drawPowerPercent(
          markerPct,
          labelCentreX,
          markerY - labelSize / 2,
          '#FF8C00',
          labelSize,
        );
      }

      this.drawPowerPercent(pct, barX + barWidth / 2, barY - this.POWER_PERCENT_SPRITE_SIZE - 6);
      ctx.textAlign = 'left';
    });
  }

  drawPlayer(showPrediction: boolean): void {
    const { gameService } = this.rc;
    if (gameService.player.health <= 0 && !this.isEntityDeathAnimationActive(gameService.player))
      return;

    const { centerX, centerY } = this.drawTankBase(
      gameService.player,
      gameService.player.color,
      (cx, cy) => {
        this.drawTankAimingArc(cx, cy);
        this.drawTankAimLines(cx, cy);
      },
      (cx, cy) => {
        const state = gameService.currentState;
        if (state === GameState.PLAYING || state === GameState.PAUSED) {
          const angleRad = (gameService.player.angle * Math.PI) / 180;
          const { ctx } = this.rc;
          const endX = cx + Math.cos(angleRad) * CONST.AIM_LINE_LENGTH;
          const endY = cy - Math.sin(angleRad) * CONST.AIM_LINE_LENGTH;
          ctx.strokeStyle = CONST.AIMING_LINE_COLOR;
          ctx.lineWidth = CONST.AIMING_LINE_WIDTH;
          ctx.setLineDash(CONST.AIMING_LINE_DASH);
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(endX, endY);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      },
    );

    this.drawShieldOverlay(gameService.player, centerX, centerY);
    this.drawPoisonTint(gameService.player, centerX, centerY);
    this.drawEntityEmote(gameService.player, centerX, centerY);

    if (
      showPrediction &&
      gameService.isCharging &&
      gameService.hasAimGuide &&
      !gameService.player.vehicle.bullet.shotgunCount
    ) {
      const angleRad = gameService.getBarrelAngle();
      const barrelEndX = gameService.player.x + Math.cos(angleRad) * CONST.BARREL_LENGTH;
      const barrelEndY = gameService.player.y - Math.sin(angleRad) * CONST.BARREL_LENGTH;
      this.drawPredictionPath(
        barrelEndX,
        barrelEndY,
        angleRad,
        gameService.player.power,
        gameService.player.vehicle.bullet,
        CONST.PREDICTION_PLAYER_COLOR,
      );
    }

    this.drawEntityUI(
      gameService.player,
      centerX,
      centerY,
      CONST.TANK_BODY_RADIUS,
      true,
      gameService.playerName,
    );
  }

  drawEnemies(showPrediction: boolean): void {
    const { gameService } = this.rc;
    for (const enemy of gameService.enemies) {
      if (enemy.active || this.isEntityDeathAnimationActive(enemy)) {
        this.drawEnemy(enemy, showPrediction);
      }
    }
  }

  updateHurtSpriteState(): void {
    const { gameService } = this.rc;
    const now = this.rc.renderTime;
    this.trackEntityDamage(gameService.player, now);
    for (const enemy of gameService.enemies) {
      this.trackEntityDamage(enemy, now);
    }
  }

  // ─── Private drawing helpers ──────────────────────────────────────────────

  private drawEnemy(enemy: any, showPrediction: boolean): void {
    const { gameService } = this.rc;
    const { centerX, centerY } = this.drawTankBase(enemy, CONST.ENEMY_FALLBACK_COLOR);

    this.drawShieldOverlay(enemy, centerX, centerY);
    this.drawPoisonTint(enemy, centerX, centerY);
    this.drawEntityEmote(enemy, centerX, centerY);

    const enemyIndex = gameService.enemies.indexOf(enemy);
    this.drawEntityUI(
      enemy,
      centerX,
      centerY,
      CONST.TANK_BODY_RADIUS,
      false,
      `Enemy ${enemyIndex + 1}`,
    );

    if (showPrediction && enemy.entityState === 'charging') {
      const baseAngleRad = (enemy.angle * Math.PI) / 180;
      const angleRad =
        -enemy.terrainAngle + (enemy.facing === -1 ? Math.PI - baseAngleRad : baseAngleRad);
      const barrelEndX = enemy.x + Math.cos(angleRad) * CONST.BARREL_LENGTH;
      const barrelEndY = enemy.y - Math.sin(angleRad) * CONST.BARREL_LENGTH;
      this.drawPredictionPath(
        barrelEndX,
        barrelEndY,
        angleRad,
        enemy.power,
        enemy.vehicle.bullet,
        CONST.PREDICTION_ENEMY_COLOR,
      );
    }
  }

  private drawTankBase(
    entity: any,
    fallbackColor: string,
    afterFacingFlip?: (cx: number, cy: number) => void,
    beforeBody?: (cx: number, cy: number) => void,
  ): { centerX: number; centerY: number } {
    const { ctx, cameraController } = this.rc;
    const screenPos = cameraController.worldToScreen(entity.x, entity.y);
    const centerX = screenPos.x;
    const centerY = screenPos.y;
    const bodyRadius = CONST.TANK_BODY_RADIUS;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(entity.terrainAngle);
    ctx.translate(-centerX, -centerY);

    if (entity.facing === -1) {
      ctx.scale(-1, 1);
      ctx.translate(-centerX * 2, 0);
    }

    afterFacingFlip?.(centerX, centerY);
    this.drawTankShadow(centerX, centerY, bodyRadius);
    this.drawCursorBarrel(centerX, centerY, (entity.angle * Math.PI) / 180);
    beforeBody?.(centerX, centerY);
    this.drawEntityBody(entity, fallbackColor, centerX, centerY, bodyRadius);

    ctx.restore();
    return { centerX, centerY };
  }

  private drawCursorBarrel(centerX: number, centerY: number, angleRad: number): void {
    const { ctx, spriteService, renderTime, queueDraw } = this.rc;
    const cursorFrameIndex = this.getCursorFrameIndex(renderTime);
    const cursorSprite = spriteService.getSprite(`cursor_${cursorFrameIndex}`);
    if (!cursorSprite) return;

    const pivotOffset = CONST.BARREL_LENGTH + 14;
    const scale = 0.84;
    const drawWidth = cursorSprite.width * scale;
    const drawHeight = cursorSprite.height * scale;
    const xNudge = -4;
    const yNudge = 0;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(-angleRad);
    ctx.translate(pivotOffset + xNudge, yNudge);
    ctx.rotate(Math.PI / 2 + (20 * Math.PI) / 180);
    const s = cursorSprite;
    queueDraw(CONST.LAYER_ENTITY_BARREL, () => {
      ctx.drawImage(
        s.image,
        s.x,
        s.y,
        s.width,
        s.height,
        -drawWidth / 2,
        -drawHeight / 2,
        drawWidth,
        drawHeight,
      );
    });
    ctx.restore();
  }

  private drawTankAimingArc(centerX: number, centerY: number): void {
    const { ctx, gameService } = this.rc;
    const state = gameService.currentState;
    if (state !== GameState.PLAYING && state !== GameState.PAUSED) return;

    const minAngle = (gameService.player.vehicle.minAimAngle * Math.PI) / 180;
    const maxAngle = (gameService.player.vehicle.maxAimAngle * Math.PI) / 180;

    ctx.globalAlpha = 0.55;
    ctx.fillStyle = CONST.CANNON_ARC_COLOR;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, CONST.CANNON_ARC_RADIUS, -maxAngle, -minAngle);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1.0;

    ctx.globalAlpha = 0.3;
    ctx.fillStyle = CONST.AIM_GUIDE_COLOR;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, CONST.CANNON_ARC_RADIUS, -Math.PI / 2, 0);
    ctx.closePath();
    ctx.fill();
  }

  private drawTankAimLines(centerX: number, centerY: number): void {
    const { ctx, gameService } = this.rc;
    const state = gameService.currentState;
    if (state !== GameState.PLAYING && state !== GameState.PAUSED) return;

    ctx.globalAlpha = 1.0;
    ctx.strokeStyle = CONST.AIM_LINE_COLOR;
    ctx.lineWidth = CONST.AIM_LINE_WIDTH;
    const angles = [0, -Math.PI / 4, -Math.PI / 2];
    angles.forEach((angle) => {
      const endX = centerX + Math.cos(-angle) * CONST.AIM_LINE_LENGTH;
      const endY = centerY - Math.sin(-angle) * CONST.AIM_LINE_LENGTH;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    });
  }

  private drawTankShadow(centerX: number, centerY: number, bodyRadius: number): void {
    const { ctx, queueDraw } = this.rc;
    const cx = centerX,
      cy = centerY,
      r = bodyRadius;
    queueDraw(CONST.LAYER_ENTITY_SHADOW, () => {
      ctx.fillStyle = CONST.TANK_SHADOW_COLOR;
      ctx.beginPath();
      ctx.ellipse(cx, cy + 2, r, r * CONST.TANK_SHADOW_HEIGHT_RATIO, 0, 0, Math.PI, true);
      ctx.fill();
    });
  }

  private drawShieldOverlay(entity: any, centerX: number, centerY: number): void {
    const {
      ctx,
      gameService,
      spriteService,
      shieldAnimService,
      cameraController,
      renderTime,
      queueDraw,
    } = this.rc;
    if (gameService.currentState === GameState.SETUP) return;
    const drawInfo = shieldAnimService.getShieldDrawInfo(entity, renderTime);
    if (!drawInfo) return;
    const { spriteName, rotation } = drawInfo;
    const sprite = spriteService.getSprite(spriteName);
    if (!sprite) return;

    const size = (entity.vehicle?.shieldRadius ?? 120) * 2 * 1.15;
    const cx = centerX,
      cy = centerY;
    const s = sprite;

    queueDraw(CONST.LAYER_ENTITY_SHIELD, () => {
      if (
        !this.shieldMaskCanvas ||
        this.shieldMaskCanvas.width !== CONST.CANVAS_WIDTH ||
        this.shieldMaskCanvas.height !== CONST.CANVAS_HEIGHT
      ) {
        this.shieldMaskCanvas = document.createElement('canvas');
        this.shieldMaskCanvas.width = CONST.CANVAS_WIDTH;
        this.shieldMaskCanvas.height = CONST.CANVAS_HEIGHT;
        this.shieldMaskCtx = this.shieldMaskCanvas.getContext('2d');
      }
      const offCtx = this.shieldMaskCtx!;
      offCtx.clearRect(0, 0, CONST.CANVAS_WIDTH, CONST.CANVAS_HEIGHT);

      offCtx.save();
      if (rotation !== 0) {
        offCtx.translate(cx, cy);
        offCtx.rotate(rotation);
        offCtx.translate(-cx, -cy);
      }
      offCtx.drawImage(
        s.image,
        s.x,
        s.y,
        s.width,
        s.height,
        cx - size / 2,
        cy - size / 2,
        size,
        size,
      );
      offCtx.restore();

      const terrainY = Math.floor(
        CONST.CANVAS_HEIGHT - CONST.TERRAIN_BASE_Y_OFFSET - cameraController.camera.y,
      );
      const startX = Math.max(0, Math.floor(cameraController.camera.x));
      const endX = Math.min(
        CONST.TERRAIN_WIDTH,
        Math.ceil(cameraController.camera.x + CONST.CANVAS_WIDTH),
      );
      offCtx.globalCompositeOperation = 'destination-out';
      offCtx.fillStyle = 'rgba(0,0,0,1)';
      this.bg.scanlineTerrainFill(offCtx, terrainY, startX, endX, 1);
      offCtx.globalCompositeOperation = 'source-over';

      ctx.drawImage(this.shieldMaskCanvas!, 0, 0);
    });
  }

  private drawPoisonTint(entity: any, centerX: number, centerY: number): void {
    const { ctx, spriteService, queueDraw } = this.rc;
    if (!this.isEntityInPoisonZone(entity)) return;
    const sprite = spriteService.getSprite('poison_vehicle_overlay');
    if (!sprite) return;
    const size = CONST.TANK_BODY_RADIUS * 3;
    const cx = centerX,
      cy = centerY;
    const s = sprite;
    queueDraw(CONST.LAYER_ENTITY_POISON_TINT, () => {
      ctx.globalAlpha = 0.85;
      ctx.drawImage(s.image, s.x, s.y, s.width, s.height, cx - size / 2, cy - size / 2, size, size);
    });
  }

  private drawEntityEmote(entity: any, centerX: number, centerY: number): void {
    const { spriteService, renderTime, queueDraw, ctx } = this.rc;
    const emote = entity.emote;
    if (!emote) return;
    const def = spriteService.getEmoteDefinition(emote.name as string);
    if (!def) return;
    if (emote.nextPlayTime !== undefined && renderTime < emote.nextPlayTime) return;
    const elapsed = renderTime - emote.startTime;
    const frameIndex = Math.floor(elapsed / def.frameDurationMs) % def.frameCount;
    const spriteSuffix =
      emote.name === 'sleep'
        ? entity.facing === 1
          ? 'sleep_right'
          : 'sleep_left'
        : (emote.name as string);
    const sprite = spriteService.getSprite(`emote_${spriteSuffix}_${frameIndex}`);
    if (!sprite) return;

    const size = CONST.EMOTE_DRAW_SIZE;
    const s = sprite;
    const cx = centerX,
      cy = centerY;
    const facing = entity.facing;
    const terrainAngle = entity.terrainAngle;
    const noFlip = def.noFlip;
    const layer =
      emote.zLayer === 'behind' ? CONST.LAYER_ENTITY_EMOTE_BEHIND : CONST.LAYER_ENTITY_EMOTE_FRONT;
    const drawX = cx - size / 3;
    const drawY = cy - size / 2 - 5;

    queueDraw(layer, () => {
      ctx.translate(cx, cy);
      ctx.rotate(terrainAngle);
      ctx.translate(-cx, -cy);
      if (facing === 1) {
        ctx.scale(-1, 1);
        ctx.translate(-cx * 2, 0);
      }
      if (noFlip && facing === -1) {
        ctx.translate(cx, 0);
        ctx.scale(-1, 1);
        ctx.translate(-cx, 0);
      }
      ctx.drawImage(s.image, s.x, s.y, s.width, s.height, drawX, drawY, size, size);
    });
  }

  private drawEntityBody(
    entity: any,
    fallbackColor: string,
    centerX: number,
    centerY: number,
    bodyRadius: number,
  ): boolean {
    const { ctx, queueDraw } = this.rc;
    if (this.drawEntitySprite(entity, centerX, centerY, bodyRadius)) return true;
    const cx = centerX,
      cy = centerY,
      r = bodyRadius;
    const color = fallbackColor;
    queueDraw(CONST.LAYER_ENTITY_BODY, () => {
      ctx.fillStyle = color;
      ctx.strokeStyle = CONST.TANK_BODY_STROKE_COLOR;
      ctx.lineWidth = CONST.TANK_BODY_STROKE_WIDTH;
      ctx.beginPath();
      ctx.arc(cx, cy, r, Math.PI, 0, false);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });
    return false;
  }

  private drawEntitySprite(
    entity: any,
    centerX: number,
    centerY: number,
    bodyRadius: number,
  ): boolean {
    const { ctx, spriteService, renderTime, queueDraw } = this.rc;
    if (!this.hasEntitySprites(entity)) return false;

    const now = renderTime;
    const deathAnimationState = this.getDeathAnimationState(entity, now);
    const spritesheet = entity.vehicle.spritesheet as string;
    const animName = deathAnimationState?.isActive
      ? `death_${deathAnimationState.frameIndex}`
      : entity.entityState === 'hurting'
        ? 'hurt'
        : entity.entityState === 'shooting'
          ? `shoot_${this.getShootReleaseFrameIndex(entity, now) ?? 0}`
          : entity.entityState === 'charging'
            ? `shoot_${this.getShootChargeFrameIndex(entity, now) ?? 0}`
            : entity.entityState === 'moving' ||
                (entity.entityState === 'idle' &&
                  entity.body &&
                  Math.abs(entity.body.velocity.x) > 0.1)
              ? `move_${this.getMoveFrameIndex(now)}`
              : 'idle';

    const isComposite = this.COMPOSITE_SHEETS.has(spritesheet);
    const sprite = spriteService.getEntitySprite(animName, spritesheet);
    if (!sprite) return false;

    const spriteSize = bodyRadius * 2 * 1.5;
    const spriteYOffset = -15;
    const deathAlpha = deathAnimationState?.isActive ? deathAnimationState.alpha : null;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.scale(-1, 1);
    const s = sprite;
    const animN = animName;
    const composite = isComposite;
    queueDraw(CONST.LAYER_ENTITY_BODY, () => {
      if (deathAlpha !== null) ctx.globalAlpha = deathAlpha;
      if (composite) {
        this.drawCompositeLayers(entity, animN, s, spriteSize, spriteYOffset);
      } else {
        ctx.drawImage(
          s.image,
          s.x,
          s.y,
          s.width,
          s.height,
          -spriteSize / 2,
          -spriteSize / 2 + spriteYOffset,
          spriteSize,
          spriteSize,
        );
      }
    });
    ctx.restore();
    return true;
  }

  private drawCompositeLayers(
    entity: any,
    animName: string,
    backSprite: { image: CanvasImageSource; x: number; y: number; width: number; height: number },
    spriteSize: number,
    spriteYOffset: number,
  ): void {
    const { ctx, spriteService } = this.rc;
    const entitySheet: string =
      (entity.vehicle?.spritesheet as string | undefined) ?? this.LUPIN_COMPOSITE;
    const layerOffsets = spriteService.getLayerOffsets(entitySheet);
    const frameOffsets: LayerFrameOffset | undefined = layerOffsets?.frames[animName];
    const explosionScaleMultiplier = layerOffsets?.explosionScale ?? 1.0;
    const heldItemSprite = (entity.vehicle?.bullet?.heldItemSprite as string | undefined) ?? null;
    const overlaySpriteName = (entity.vehicle?.bullet?.overlaySprite as string | undefined) ?? null;

    ctx.drawImage(
      backSprite.image,
      backSprite.x,
      backSprite.y,
      backSprite.width,
      backSprite.height,
      -spriteSize / 2,
      -spriteSize / 2 + spriteYOffset,
      spriteSize,
      spriteSize,
    );

    const fruitCfg = heldItemSprite ? (layerOffsets?.fruitConfig[heldItemSprite] ?? null) : null;
    const fruitScale = fruitCfg?.scale ?? 1.0;
    const overlayZ = fruitCfg?.overlayZ ?? 3;

    const drawOverlay = () => {
      if (!overlaySpriteName || frameOffsets?.hideLayers?.includes('overlay')) return;
      const overlaySprite = spriteService.getSprite(overlaySpriteName);
      if (!overlaySprite) return;
      const ox = frameOffsets?.overlay.x ?? 0;
      const oy = frameOffsets?.overlay.y ?? 0;
      ctx.drawImage(
        overlaySprite.image,
        overlaySprite.x,
        overlaySprite.y,
        overlaySprite.width,
        overlaySprite.height,
        -spriteSize / 2 + ox,
        -spriteSize / 2 + spriteYOffset + oy,
        spriteSize,
        spriteSize,
      );
    };

    if (overlayZ < 2) drawOverlay();

    if (heldItemSprite && !frameOffsets?.hideLayers?.includes('fruit')) {
      const fruitSprite = spriteService.getSprite(heldItemSprite);
      if (fruitSprite) {
        const fruitSz = spriteSize * fruitScale;
        const fx = frameOffsets?.fruit.x ?? 0;
        const fy = frameOffsets?.fruit.y ?? 0;
        ctx.drawImage(
          fruitSprite.image,
          fruitSprite.x,
          fruitSprite.y,
          fruitSprite.width,
          fruitSprite.height,
          -fruitSz / 2 + fx,
          -fruitSz / 2 + spriteYOffset + fy,
          fruitSz,
          fruitSz,
        );
      }
    }

    const aboveFruitSpriteName = frameOffsets?.aboveFruitSpriteName ?? null;
    if (aboveFruitSpriteName) {
      const aboveFruitSprite = spriteService.getSprite(aboveFruitSpriteName);
      if (aboveFruitSprite) {
        ctx.drawImage(
          aboveFruitSprite.image,
          aboveFruitSprite.x,
          aboveFruitSprite.y,
          aboveFruitSprite.width,
          aboveFruitSprite.height,
          -spriteSize / 2,
          -spriteSize / 2 + spriteYOffset,
          spriteSize,
          spriteSize,
        );
      }
    }

    const handSprite = spriteService.getEntitySprite('hand', entitySheet);
    if (handSprite && !frameOffsets?.hideLayers?.includes('hand')) {
      const hx = frameOffsets?.hand.x ?? 0;
      const hy = frameOffsets?.hand.y ?? 0;
      ctx.drawImage(
        handSprite.image,
        handSprite.x,
        handSprite.y,
        handSprite.width,
        handSprite.height,
        -spriteSize / 2 + hx,
        -spriteSize / 2 + spriteYOffset + hy,
        spriteSize,
        spriteSize,
      );
    }

    if (overlayZ >= 2) drawOverlay();

    if (entitySheet === this.ZOMBIE_COMPOSITE && !frameOffsets?.hideLayers?.includes('halo')) {
      const haloSprite = spriteService.getSprite('zombie_halo');
      if (haloSprite) {
        const hlx = frameOffsets?.halo?.x ?? 0;
        const hly = frameOffsets?.halo?.y ?? 0;
        ctx.drawImage(
          haloSprite.image,
          haloSprite.x,
          haloSprite.y,
          haloSprite.width,
          haloSprite.height,
          -spriteSize / 2 + hlx,
          -spriteSize / 2 + spriteYOffset + hly,
          spriteSize,
          spriteSize,
        );
      }
    }

    (entity as any).__explosionScaleMultiplier = explosionScaleMultiplier;
  }

  private drawEntityUI(
    entity: any,
    centerX: number,
    centerY: number,
    bodyRadius: number,
    isPlayer: boolean = false,
    label?: string,
  ): void {
    const { ctx, gameService, spriteService, tintCache, queueDraw } = this.rc;
    if (!entity || !entity.vehicle || typeof entity.health !== 'number') return;
    if (entity.health <= 0) return;

    const cx = centerX,
      cy = centerY,
      r = bodyRadius;
    const showLabel = !!(
      label &&
      (!gameService.isPlayerTurn() || gameService.player.turnState === 'idle')
    );
    const labelY = cy - r - 25;
    const healthRatio = entity.health / entity.vehicle.health;
    const barWidth = 60;
    const barHeight = 5;
    const barX = cx - barWidth / 2;
    const barY = cy + r - 5;
    const angleDeg = gameService.getEntityDisplayedAngle(entity);
    const isMoving = Math.abs(entity.body.velocity.x) > 0.1;
    const movementRatio = isMoving ? entity.movementFuel / entity.vehicle.fuel : 0;
    const lbl = label,
      pl = isPlayer;

    queueDraw(CONST.LAYER_ENTITY_UI, () => {
      if (showLabel && lbl) {
        ctx.font = 'bold 13px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.strokeText(lbl, cx, labelY);
        ctx.fillStyle = pl ? '#88DDFF' : '#FFAAAA';
        ctx.fillText(lbl, cx, labelY);
        ctx.textBaseline = 'middle';
      }

      ctx.fillStyle = CONST.HEALTH_BAR_BG_COLOR;
      ctx.fillRect(barX, barY, barWidth, barHeight);
      ctx.fillStyle = pl ? CONST.HEALTH_BAR_PLAYER_COLOR : CONST.HEALTH_BAR_ENEMY_COLOR;
      ctx.fillRect(barX, barY, barWidth * healthRatio, barHeight);

      drawAngleText(
        ctx,
        spriteService,
        tintCache,
        angleDeg,
        barX + barWidth + 6,
        barY + barHeight / 2,
        18,
      );

      if (isMoving) {
        const movementBarY = barY + barHeight + 2;
        ctx.fillStyle = CONST.HEALTH_BAR_BG_COLOR;
        ctx.fillRect(barX, movementBarY, barWidth, barHeight);
        ctx.fillStyle = CONST.MOVEMENT_BAR_COLOR;
        ctx.fillRect(barX, movementBarY, barWidth * movementRatio, barHeight);
      }
    });
  }

  private drawPredictionPath(
    startX: number,
    startY: number,
    angleRad: number,
    power: number,
    bullet: any,
    color = '#FFFFFF',
  ): void {
    const { ctx, gameService, cameraController } = this.rc;
    const { positions } = gameService.simulateTrajectory(
      startX,
      startY,
      angleRad,
      power,
      bullet,
      true,
    );
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    let started = false;
    for (const pos of positions) {
      const screenPos = cameraController.worldToScreen(pos.x, pos.y);
      if (!started) {
        ctx.moveTo(screenPos.x, screenPos.y);
        started = true;
      } else ctx.lineTo(screenPos.x, screenPos.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawPowerPercent(
    pct: number,
    centreX: number,
    topY: number,
    tint?: string,
    size = this.POWER_PERCENT_SPRITE_SIZE,
  ): void {
    const { ctx, spriteService, tintCache } = this.rc;
    const advance = size * 0.45;
    const pctStr = `${pct}%`;
    const totalWidth = (pctStr.length - 1) * advance + size;
    drawSpriteChars(
      ctx,
      spriteService,
      tintCache,
      pctStr,
      ANGLE_CHAR_TO_SPRITE,
      centreX - totalWidth / 2,
      topY,
      size,
      advance,
      tint,
    );
  }

  // ─── Animation frame helpers ──────────────────────────────────────────────

  private getCursorFrameIndex(now: number): number {
    return Math.floor(now / 90) % 6;
  }

  private getMoveFrameIndex(now: number): number {
    const frameDurations = this.MOVE_FRAME_DURATIONS;
    const cycleDuration = frameDurations.reduce((a, b) => a + b, 0);
    let t = now % cycleDuration;
    for (let i = 0; i < frameDurations.length; i++) {
      if (t < frameDurations[i]) return i;
      t -= frameDurations[i];
    }
    return 0;
  }

  private hasEntitySprites(entity: any): boolean {
    return entity?.vehicle?.spritesheet != null;
  }

  private isEntityCharging(entity: any): boolean {
    return entity?.entityState === 'charging';
  }

  private getShootChargeFrameIndex(entity: any, now: number): number | null {
    if (!this.hasEntitySprites(entity) || !this.isEntityCharging(entity)) return null;
    const chargeStartTime = entity.chargeStartTime ?? now;
    const chargeElapsed = Math.max(0, now - chargeStartTime);
    const chargeFrameIndex = Math.floor(chargeElapsed / this.SHOOT_CHARGE_FRAME_DURATION_MS);
    return Math.min(this.SHOOT_CHARGE_FRAME_COUNT - 1, chargeFrameIndex);
  }

  private getShootReleaseFrameIndex(entity: any, now: number): number | null {
    if (!this.hasEntitySprites(entity)) return null;
    const releaseStartTime = entity.shotReleaseStartMs;
    if (releaseStartTime === undefined) return null;
    const releaseFrameCount = this.SHOOT_TOTAL_FRAME_COUNT - this.SHOOT_CHARGE_FRAME_COUNT;
    const releaseElapsed = Math.max(0, now - releaseStartTime);
    const releaseFrameIndex = Math.floor(releaseElapsed / this.SHOOT_RELEASE_FRAME_DURATION_MS);
    if (releaseFrameIndex >= releaseFrameCount) {
      delete entity.shotReleaseStartMs;
      entity.entityState = 'idle';
      return null;
    }
    return this.SHOOT_CHARGE_FRAME_COUNT + releaseFrameIndex;
  }

  private getDeathAnimationState(entity: any, now: number) {
    if (!this.hasEntitySprites(entity)) return null;
    const deathStartTime = entity.deathAnimStartMs;
    if (deathStartTime === undefined) return null;
    const deathAnimationDuration =
      this.DEATH_SPRITE_FRAME_COUNT * this.DEATH_SPRITE_FRAME_DURATION_MS;
    const elapsed = now - deathStartTime;
    const clampedElapsed = Math.max(0, elapsed);
    const fadeElapsed = Math.max(0, clampedElapsed - deathAnimationDuration);
    const fadeProgress = Math.min(1, fadeElapsed / this.DEATH_SPRITE_FADE_DURATION_MS);
    const frameIndex = Math.min(
      this.DEATH_SPRITE_FRAME_COUNT - 1,
      Math.floor(clampedElapsed / this.DEATH_SPRITE_FRAME_DURATION_MS),
    );
    return {
      frameIndex,
      alpha: 1 - fadeProgress,
      isActive: clampedElapsed < deathAnimationDuration + this.DEATH_SPRITE_FADE_DURATION_MS,
    };
  }

  private isEntityDeathAnimationActive(entity: any, now: number = Date.now()): boolean {
    return this.getDeathAnimationState(entity, now)?.isActive ?? false;
  }

  private isEntityInPoisonZone(entity: any): boolean {
    for (const zone of this.rc.gameService.poisonZones) {
      const dx = entity.x - zone.x;
      const dy = entity.y - zone.y;
      if (Math.sqrt(dx * dx + dy * dy) < zone.radius) return true;
    }
    return false;
  }

  private trackEntityDamage(entity: any, now: number): void {
    if (!this.hasEntitySprites(entity)) return;
    const currentHealth = Number(entity?.health ?? 0);
    const previousHealth = entity.prevHealth;
    if (previousHealth !== undefined && currentHealth < previousHealth) {
      if (currentHealth <= 0) {
        if (entity.deathAnimStartMs === undefined) entity.deathAnimStartMs = now;
      } else {
        entity.hurtUntilMs = now + this.HURT_SPRITE_DURATION_MS;
        entity.entityState = 'hurting';
      }
    }
    if (entity.entityState === 'hurting' && (entity.hurtUntilMs ?? 0) <= now) {
      entity.entityState = 'idle';
    }
    entity.prevHealth = currentHealth;
  }
}
