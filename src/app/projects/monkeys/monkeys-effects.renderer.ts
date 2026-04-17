import { SpriteData } from './monkeys-sprite.service';
import {
  MonkeysRenderContext,
  ANGLE_CHAR_TO_SPRITE,
  drawSpriteChars,
  tintedGlyph,
} from './monkeys-render-context';
import * as CONST from './monkeys.constants';

export class MonkeysEffectsRenderer {
  private readonly EXPLOSION_FRAME_COUNT = 6;
  private readonly EXPLOSION_SPRITE_FRAME_DURATION_MS = 110;
  private readonly BULLET_SPRITE_SIZE_MULTIPLIER = 5;
  private readonly EXPLOSION_SPRITE_SIZE_MULTIPLIER = 3.3;

  constructor(private readonly rc: MonkeysRenderContext) {}

  private getExplosionFrameIndex(now: number): number {
    return Math.floor(now / this.EXPLOSION_SPRITE_FRAME_DURATION_MS) % this.EXPLOSION_FRAME_COUNT;
  }

  private getInFlightSpriteName(bullet: {
    bulletStyle?: string;
    bulletSprite?: string;
    overlaySprite?: string;
  }): string {
    const usesOverlay = bullet.bulletStyle === 'cluster' && !!bullet.overlaySprite;
    return (usesOverlay ? bullet.overlaySprite : bullet.bulletSprite) ?? 'bullet';
  }

  drawBulletAt(
    ctx: CanvasRenderingContext2D,
    screenPos: { x: number; y: number },
    bulletSprite: SpriteData | null,
    angle?: number,
  ): void {
    if (bulletSprite) {
      const drawSize = CONST.PROJECTILE_DRAW_RADIUS * this.BULLET_SPRITE_SIZE_MULTIPLIER;
      if (angle !== undefined) {
        ctx.save();
        ctx.translate(screenPos.x, screenPos.y);
        ctx.rotate(angle);
        ctx.drawImage(
          bulletSprite.image,
          bulletSprite.x,
          bulletSprite.y,
          bulletSprite.width,
          bulletSprite.height,
          -drawSize / 2,
          -drawSize / 2,
          drawSize,
          drawSize,
        );
        ctx.restore();
      } else {
        ctx.drawImage(
          bulletSprite.image,
          bulletSprite.x,
          bulletSprite.y,
          bulletSprite.width,
          bulletSprite.height,
          screenPos.x - drawSize / 2,
          screenPos.y - drawSize / 2,
          drawSize,
          drawSize,
        );
      }
    } else {
      ctx.fillStyle = CONST.PROJECTILE_COLOR;
      ctx.beginPath();
      ctx.arc(screenPos.x, screenPos.y, CONST.PROJECTILE_DRAW_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawProjectile(): void {
    const { ctx, spriteService, gameService, cameraController, queueDraw } = this.rc;
    const bulletPrefix = this.getInFlightSpriteName(gameService.projectile?.bullet ?? {});
    const bulletSprite = spriteService.getSprite(bulletPrefix);

    if (gameService.projectile) {
      let pos: { x: number; y: number };
      if (gameService.projectile.body) {
        pos = gameService.projectile.body.position;
      } else {
        pos = { x: gameService.projectile.x, y: gameService.projectile.y };
      }
      let angle: number | undefined;
      if (
        gameService.projectile.bullet.rotatesToVelocity &&
        gameService.projectile.body?.velocity
      ) {
        const vel = gameService.projectile.body.velocity;
        angle = Math.atan2(vel.y, vel.x);
      }
      const rotSpeed = gameService.projectile.bullet.bulletRotationSpeed;
      if (rotSpeed) {
        const spinAngle = ((performance.now() * rotSpeed) / 1000) % (2 * Math.PI);
        angle = (angle ?? 0) + spinAngle;
      }
      const screenPos = cameraController.worldToScreen(pos.x, pos.y);
      const angleFinal = angle;
      const bs = bulletSprite;
      queueDraw(CONST.LAYER_PROJECTILE, () => {
        this.drawBulletAt(ctx, screenPos, bs, angleFinal);
      });
    } else if (gameService.aftermathImpactPos) {
      const impactPos = gameService.aftermathImpactPos;
      const screenPos = cameraController.worldToScreen(impactPos.x, impactPos.y);
      const bs = bulletSprite;
      queueDraw(CONST.LAYER_PROJECTILE, () => {
        this.drawBulletAt(ctx, screenPos, bs);
      });
    }
  }

  drawChildProjectiles(): void {
    const { ctx, gameService, spriteService, cameraController, queueDraw, renderTime } = this.rc;
    for (const child of gameService.childProjectiles) {
      const prefix = this.getInFlightSpriteName(child.bullet);
      const sprite = spriteService.getSprite(prefix);
      const screenPos = cameraController.worldToScreen(child.x, child.y);
      let angle: number | undefined;
      if (child.spinRate !== undefined) {
        const elapsed = (renderTime - (child.spawnTimeMs ?? renderTime)) / 1000;
        angle = (elapsed * child.spinRate) % (2 * Math.PI);
      }
      const s = sprite,
        sp = screenPos,
        a = angle;
      queueDraw(CONST.LAYER_PROJECTILE, () => {
        this.drawBulletAt(ctx, sp, s, a);
      });
    }
  }

  drawPlantedMines(): void {
    const { ctx, gameService, spriteService, cameraController, queueDraw } = this.rc;
    for (const mine of gameService.plantedMines) {
      const prefix = mine.bullet.bulletSprite ?? 'bullet';
      const sprite = spriteService.getSprite(prefix);
      const screenPos = cameraController.worldToScreen(mine.x, mine.y);
      const s = sprite,
        sp = screenPos;
      queueDraw(CONST.LAYER_PROJECTILE, () => {
        this.drawBulletAt(ctx, sp, s, Math.PI * 0.083);
      });
    }
  }

  drawExplosions(): void {
    const { ctx, gameService, spriteService, cameraController, queueDraw, renderTime } = this.rc;
    const explosionFrameIndex = this.getExplosionFrameIndex(renderTime);

    for (let i = gameService.explosions.length - 1; i >= 0; i--) {
      const explosion = gameService.explosions[i];
      if (
        !isFinite(explosion.x) ||
        !isFinite(explosion.y) ||
        !isFinite(explosion.radius) ||
        explosion.radius <= 0
      ) {
        gameService.explosions.splice(i, 1);
        continue;
      }
      const screenPos = cameraController.worldToScreen(explosion.x, explosion.y);
      const spritePrefix = explosion.spriteName ?? 'explosion';
      const explosionSprite = spriteService.getSprite(`${spritePrefix}_${explosionFrameIndex}`);

      if (explosionSprite) {
        const explosionScale =
          spritePrefix === 'explosion'
            ? (spriteService.getLayerOffsets(spriteService.LUPIN_COMPOSITE)?.explosionScale ?? 1.0)
            : spritePrefix === 'zombie_explosion'
              ? (spriteService.getLayerOffsets(spriteService.ZOMBIE_COMPOSITE)?.explosionScale ??
                1.0)
              : 1.0;
        let spriteWidth = explosion.radius * this.EXPLOSION_SPRITE_SIZE_MULTIPLIER * explosionScale;
        let spriteHeight =
          explosion.radius * this.EXPLOSION_SPRITE_SIZE_MULTIPLIER * explosionScale;

        if (explosion.shape === 'horizontal_oval') spriteWidth *= 1.5;
        else if (explosion.shape === 'vertical_oval') spriteHeight *= 1.5;

        const es = explosionSprite,
          sx = screenPos.x,
          sy = screenPos.y,
          sw = spriteWidth,
          sh = spriteHeight;
        queueDraw(CONST.LAYER_EXPLOSION, () => {
          ctx.drawImage(
            es.image,
            es.x,
            es.y,
            es.width,
            es.height,
            sx - sw / 2,
            sy - sh / 2,
            sw,
            sh,
          );
        });
      } else {
        const sx = screenPos.x,
          sy = screenPos.y,
          r = explosion.radius,
          shape = explosion.shape;
        queueDraw(CONST.LAYER_EXPLOSION, () => {
          const gradient = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
          gradient.addColorStop(0, CONST.EXPLOSION_CENTER_COLOR);
          gradient.addColorStop(0.5, CONST.EXPLOSION_MIDDLE_COLOR);
          gradient.addColorStop(1, CONST.EXPLOSION_EDGE_COLOR);
          ctx.fillStyle = gradient;
          ctx.beginPath();
          if (shape === 'horizontal_oval') ctx.ellipse(sx, sy, r * 1.5, r, 0, 0, Math.PI * 2);
          else if (shape === 'vertical_oval') ctx.ellipse(sx, sy, r, r * 1.5, 0, 0, Math.PI * 2);
          else ctx.arc(sx, sy, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = CONST.EXPLOSION_OUTLINE_COLOR;
          ctx.lineWidth = CONST.EXPLOSION_OUTLINE_WIDTH;
          ctx.stroke();
        });
      }
    }
  }

  drawPoisonZones(): void {
    const { ctx, gameService, spriteService, cameraController, queueDraw } = this.rc;
    const frameIndex = Math.floor(Date.now() / 100) % 15;
    for (const zone of gameService.poisonZones) {
      const screenPos = cameraController.worldToScreen(zone.x, zone.y);
      const drawWidth = zone.radius * 3;
      const drawHeight = zone.radius * 2;
      const sprite = spriteService.getSprite(`field_poison_${frameIndex}`);
      if (!sprite) continue;
      const s = sprite;
      const sx = screenPos.x + (zone.radius * 0.3) / 2 - drawWidth / 2;
      const sy = screenPos.y - zone.radius / 2 - drawHeight / 2;
      queueDraw(CONST.LAYER_POISON_ZONE, () => {
        ctx.globalAlpha = 0.85;
        ctx.drawImage(s.image, s.x, s.y, s.width, s.height, sx, sy, drawWidth, drawHeight);
      });
    }
  }

  drawDamageTexts(): void {
    const { ctx, gameService, cameraController, queueDraw, tintCache, spriteService } = this.rc;
    const size = 28;
    const advance = size * 0.45;
    for (const text of gameService.damageTexts) {
      const tint = text.isHeal ? '#22FF55' : CONST.DAMAGE_TEXT_COLOR;
      const screenPos = cameraController.worldToScreen(text.x, text.y);
      const alpha = text.life / CONST.DAMAGE_TEXT_LIFETIME;
      const damageStr = String(text.damage);
      const totalWidth = (damageStr.length - 1) * advance + size;
      const drawX = screenPos.x - totalWidth / 2;
      const drawY = screenPos.y - size;
      const str = damageStr,
        t = tint,
        a = alpha;
      queueDraw(CONST.LAYER_DAMAGE_TEXT, () => {
        ctx.globalAlpha = a;
        drawSpriteChars(
          ctx,
          spriteService,
          tintCache,
          str,
          ANGLE_CHAR_TO_SPRITE,
          drawX,
          drawY,
          size,
          advance,
          t,
        );
      });
    }
  }
}
