import { MonkeysGameService } from './monkeys-game.service';
import { MonkeysSpriteService, SpriteData } from './monkeys-sprite.service';
import { ShieldAnimationService } from './shield-animation.service';
import { CameraController } from './camera-controller';

/** Shared context passed to all renderer classes each frame. */
export interface MonkeysRenderContext {
  ctx: CanvasRenderingContext2D;
  /** Current render timestamp (frozen when paused). Updated by the component before each frame. */
  renderTime: number;
  queueDraw(zIndex: number, fn: () => void): void;
  gameService: MonkeysGameService;
  spriteService: MonkeysSpriteService;
  cameraController: CameraController;
  shieldAnimService: ShieldAnimationService;
  tintCache: Map<string, HTMLCanvasElement>;
}

// ─── Shared sprite character maps ────────────────────────────────────────────

export const ANGLE_CHAR_TO_SPRITE: Record<string, string> = {
  '0': 'angle_0',
  '1': 'angle_1',
  '2': 'angle_2',
  '3': 'angle_3',
  '4': 'angle_4',
  '5': 'angle_5',
  '6': 'angle_6',
  '7': 'angle_7',
  '8': 'angle_8',
  '9': 'angle_9',
  '%': 'angle_percent',
  '°': 'angle_degree',
};

export const TEXT_CHAR_TO_SPRITE: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (let i = 0; i < 26; i++) {
    m[String.fromCharCode(65 + i)] = `text_${String.fromCharCode(65 + i)}`;
    m[String.fromCharCode(97 + i)] = `text_${String.fromCharCode(97 + i)}`;
  }
  for (let d = 0; d <= 9; d++) m[String(d)] = `arena_${d}`;
  m['+'] = 'angle_plus';
  m['-'] = 'angle_minus';
  m['×'] = 'angle_multiply';
  m['÷'] = 'angle_divide';
  m['='] = 'angle_equals';
  m['/'] = 'angle_slash';
  m['\\'] = 'angle_backslash';
  m['$'] = 'angle_dollar';
  m['&'] = 'text_ampersand';
  m['('] = 'text_lparen';
  m[')'] = 'text_rparen';
  m['\u300c'] = 'text_jp_open';
  m['\u300d'] = 'text_jp_close';
  m['\u3001'] = 'text_jp_comma';
  m['\u3002'] = 'text_jp_period';
  m[','] = 'text_comma';
  m['.'] = 'text_period';
  m['\u00b7'] = 'text_middledot';
  m['~'] = 'text_tilde';
  m[':'] = 'text_colon';
  m[';'] = 'text_semicolon';
  m['\u02bb'] = 'text_okina';
  m["'"] = 'text_apostrophe';
  m['\u201c'] = 'text_openquote';
  m['\u201d'] = 'text_closequote';
  m['<'] = 'text_lt';
  m['>'] = 'text_gt';
  m['?'] = 'text_question';
  m['!'] = 'text_exclaim';
  m[' '] = '';
  return m;
})();

export const ARENA_CHAR_TO_SPRITE: Record<string, string> = {
  '0': 'arena_0',
  '1': 'arena_1',
  '2': 'arena_2',
  '3': 'arena_3',
  '4': 'arena_4',
  '5': 'arena_5',
  '6': 'arena_6',
  '7': 'arena_7',
  '8': 'arena_8',
  '9': 'arena_9',
  '/': 'arena_slash',
};

// ─── Shared drawing utilities ─────────────────────────────────────────────────

/** Tints a sprite glyph with a solid colour using per-pixel RGB multiplication. Cached. */
export function tintedGlyph(
  sprite: SpriteData,
  size: number,
  tint: string,
  tintCache: Map<string, HTMLCanvasElement>,
): HTMLCanvasElement {
  const key = `${sprite.x}_${sprite.y}_${size}_${tint}`;
  const cached = tintCache.get(key);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(sprite.image, sprite.x, sprite.y, sprite.width, sprite.height, 0, 0, size, size);
  const tr = parseInt(tint.slice(1, 3), 16);
  const tg = parseInt(tint.slice(3, 5), 16);
  const tb = parseInt(tint.slice(5, 7), 16);
  const imageData = ctx.getImageData(0, 0, size, size);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    d[i] = Math.round((d[i] * tr) / 255);
    d[i + 1] = Math.round((d[i + 1] * tg) / 255);
    d[i + 2] = Math.round((d[i + 2] * tb) / 255);
  }
  ctx.putImageData(imageData, 0, 0);
  tintCache.set(key, c);
  return c;
}

/** Renders a sequence of sprite glyphs, one per character. */
export function drawSpriteChars(
  ctx: CanvasRenderingContext2D,
  spriteService: MonkeysSpriteService,
  tintCache: Map<string, HTMLCanvasElement>,
  text: string,
  map: Record<string, string>,
  startX: number,
  topY: number,
  size: number,
  advance: number,
  tint?: string,
  plainFallback = false,
): void {
  let x = startX;
  for (const ch of text) {
    const spriteName = map[ch];
    const sprite = spriteName ? spriteService.getSprite(spriteName) : null;
    if (sprite) {
      if (tint) {
        ctx.drawImage(tintedGlyph(sprite, size, tint, tintCache), x, topY);
      } else {
        ctx.drawImage(
          sprite.image,
          sprite.x,
          sprite.y,
          sprite.width,
          sprite.height,
          x,
          topY,
          size,
          size,
        );
      }
    } else if (plainFallback) {
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `${size}px Arial`;
      ctx.textAlign = 'left';
      ctx.fillText(ch, x, topY + size);
    }
    x += advance;
  }
}

/** Draws angle value sprite glyphs left-aligned. */
export function drawAngleText(
  ctx: CanvasRenderingContext2D,
  spriteService: MonkeysSpriteService,
  tintCache: Map<string, HTMLCanvasElement>,
  angleDeg: number,
  leftX: number,
  centerY: number,
  size: number,
): void {
  const advance = size * 0.45;
  drawSpriteChars(
    ctx,
    spriteService,
    tintCache,
    `${angleDeg}°`,
    ANGLE_CHAR_TO_SPRITE,
    leftX,
    centerY - size / 2,
    size,
    advance,
  );
}

/** Renders a line of sprite text centred on the canvas. */
export function drawSpriteTextCentered(
  ctx: CanvasRenderingContext2D,
  spriteService: MonkeysSpriteService,
  tintCache: Map<string, HTMLCanvasElement>,
  canvasWidth: number,
  text: string,
  topY: number,
  size: number,
  advanceRatio = 0.55,
): void {
  const advance = size * advanceRatio;
  const startX = canvasWidth / 2 - ((text.length - 1) * advance + size) / 2;
  drawSpriteChars(
    ctx,
    spriteService,
    tintCache,
    text,
    TEXT_CHAR_TO_SPRITE,
    startX,
    topY,
    size,
    advance,
  );
}
