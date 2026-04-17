import { BackgroundSpriteMetadata, TerrainChunkPlacement } from './monkeys.types';
import { MonkeysRenderContext } from './monkeys-render-context';
import * as CONST from './monkeys.constants';

export class MonkeysBackgroundRenderer {
  /** Parallax background tree instances (regenerated each game). */
  bgTreeInstances: { name: string; worldX: number; scale: number }[] = [];

  private terrainSpriteCanvas: HTMLCanvasElement | null = null;
  private terrainSpriteCtx: CanvasRenderingContext2D | null = null;
  private depthTerrainCanvas: HTMLCanvasElement | null = null;
  private depthTerrainCtx: CanvasRenderingContext2D | null = null;

  constructor(private readonly rc: MonkeysRenderContext) {}

  // ─── Public API ───────────────────────────────────────────────────────────

  generateBgTreeInstances(): void {
    this.bgTreeInstances = [];
    const midInstances: { name: string; count: number; scaleMin: number; scaleMax: number }[] = [
      { name: 'tree1_background', count: 4, scaleMin: 0.55, scaleMax: 0.85 },
      { name: 'tree3_background', count: 3, scaleMin: 0.5, scaleMax: 0.8 },
    ];
    let seed = 42;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) & 0xffffffff;
      return (seed >>> 0) / 0xffffffff;
    };
    for (const group of midInstances) {
      const step = (CONST.TERRAIN_WIDTH - 200) / group.count;
      for (let i = 0; i < group.count; i++) {
        const worldX = 100 + i * step + rand() * step * 0.6 - step * 0.3;
        const scale = group.scaleMin + rand() * (group.scaleMax - group.scaleMin);
        this.bgTreeInstances.push({ name: group.name, worldX, scale });
      }
    }
    const fgStep = CONST.TERRAIN_WIDTH / 3;
    for (let i = 0; i < 2; i++) {
      const worldX = fgStep * (i + 0.6) + rand() * fgStep * 0.5;
      const scale = 0.6 + rand() * 0.25;
      this.bgTreeInstances.push({ name: 'tree2_background', worldX, scale });
    }
  }

  drawParallaxBackground(cameraX: number): void {
    const { ctx, spriteService } = this.rc;
    const sheet = spriteService.getSpritesheet(spriteService.BACKGROUND_TOOL_SPRITESHEET);
    if (!sheet) return;
    const byName = new Map(spriteService.getBackgroundSprites().map((s) => [s.name, s]));

    const sky = byName.get('sky_background');
    if (sky) this.drawBgCover(ctx, sheet, sky, 1);

    const mountain = byName.get('montain_background');
    if (mountain) this.drawBgCoverTiled(ctx, sheet, mountain, 1, cameraX * 0.15);

    const trees = byName.get('trees_background');
    if (trees) this.drawBgTiledBottom(ctx, sheet, trees, 1, cameraX * 0.35);
  }

  queueEnvironmentTrees(cameraX: number): void {
    const { spriteService, queueDraw } = this.rc;
    const sheet = spriteService.getSpritesheet(spriteService.BACKGROUND_TOOL_SPRITESHEET);
    if (!sheet) return;
    const byName = new Map(spriteService.getBackgroundSprites().map((s) => [s.name, s]));

    const midNames = ['tree1_background', 'tree3_background'];
    for (const inst of this.bgTreeInstances.filter((i) => midNames.includes(i.name))) {
      const meta = byName.get(inst.name);
      if (!meta) continue;
      const wx = inst.worldX,
        sc = inst.scale,
        off = cameraX * 0.55;
      queueDraw(CONST.LAYER_ENV_TREE_MID, () => {
        this.drawBgInstance(sheet, meta, wx, off, sc);
      });
    }

    for (const inst of this.bgTreeInstances.filter((i) => i.name === 'tree2_background')) {
      const meta = byName.get(inst.name);
      if (!meta) continue;
      const wx = inst.worldX,
        sc = inst.scale,
        off = cameraX * 0.8;
      queueDraw(CONST.LAYER_ENV_TREE_FRONT, () => {
        this.drawBgInstance(sheet, meta, wx, off, sc);
      });
    }
  }

  drawTerrain(): void {
    const { ctx, spriteService, gameService, cameraController, queueDraw } = this.rc;
    const terrainY = Math.floor(
      CONST.CANVAS_HEIGHT - CONST.TERRAIN_BASE_Y_OFFSET - cameraController.camera.y,
    );
    const startX = Math.max(0, Math.floor(cameraController.camera.x));
    const endX = Math.min(
      CONST.TERRAIN_WIDTH,
      Math.ceil(cameraController.camera.x + CONST.CANVAS_WIDTH),
    );

    if (
      !this.terrainSpriteCanvas ||
      this.terrainSpriteCanvas.width !== CONST.CANVAS_WIDTH ||
      this.terrainSpriteCanvas.height !== CONST.CANVAS_HEIGHT
    ) {
      this.terrainSpriteCanvas = document.createElement('canvas');
      this.terrainSpriteCanvas.width = CONST.CANVAS_WIDTH;
      this.terrainSpriteCanvas.height = CONST.CANVAS_HEIGHT;
      this.terrainSpriteCtx = this.terrainSpriteCanvas.getContext('2d');
    }

    const offCtx = this.terrainSpriteCtx!;
    offCtx.clearRect(0, 0, CONST.CANVAS_WIDTH, CONST.CANVAS_HEIGHT);

    const terrainSheet = spriteService.getSpritesheet(spriteService.TERRAIN_TOOL_SPRITESHEET);
    if (terrainSheet) {
      this.drawTerrainSpritePlacements(
        offCtx,
        gameService.terrainInteriorPlacements,
        terrainSheet,
        terrainY,
      );
      this.drawTerrainSpritePlacements(
        offCtx,
        gameService.terrainBottomPlacements,
        terrainSheet,
        terrainY,
      );
      this.drawTerrainSpritePlacements(
        offCtx,
        gameService.terrainChunkPlacements,
        terrainSheet,
        terrainY,
      );
    }

    offCtx.globalCompositeOperation = 'destination-out';
    offCtx.fillStyle = 'rgba(0,0,0,1)';
    this.scanlineTerrainFill(offCtx, terrainY, startX, endX, 0);
    offCtx.globalCompositeOperation = 'source-over';

    const ty = terrainY,
      sx = startX,
      ex = endX;
    const spriteCv = this.terrainSpriteCanvas!;

    queueDraw(CONST.LAYER_TERRAIN_FILL, () => {
      ctx.fillStyle = CONST.TERRAIN_COLOR;
      this.scanlineTerrainFill(ctx, ty, sx, ex, 1);
    });

    queueDraw(CONST.LAYER_TERRAIN_SPRITES, () => {
      ctx.drawImage(spriteCv, 0, 0);
    });

    this.preRenderDepthTerrainLayer(terrainY, startX, endX);
    if (this.depthTerrainCanvas && gameService.depthTerrain?.length) {
      const depthCv = this.depthTerrainCanvas;
      queueDraw(CONST.LAYER_TERRAIN_DEPTH, () => {
        ctx.drawImage(depthCv, 0, 0);
      });
    }
  }

  /** Rasterises terrain by scanline — iterates every cell row and fills contiguous spans. */
  scanlineTerrainFill(
    ctx: CanvasRenderingContext2D,
    terrainY: number,
    startX: number,
    endX: number,
    matchValue: number,
  ): void {
    const { gameService, cameraController } = this.rc;
    for (let y = 0; y < CONST.TERRAIN_STRIP_HEIGHT; y++) {
      let segmentStart = -1;
      for (let x = startX; x < endX; x++) {
        if (gameService.terrain[x]?.[y] === matchValue) {
          if (segmentStart === -1) segmentStart = x;
        } else if (segmentStart !== -1) {
          const sx = Math.floor(segmentStart - cameraController.camera.x);
          const ex = Math.floor(x - cameraController.camera.x);
          ctx.fillRect(sx, terrainY + y, ex - sx, 1);
          segmentStart = -1;
        }
      }
      if (segmentStart !== -1) {
        const sx = Math.floor(segmentStart - cameraController.camera.x);
        const ex = Math.floor(endX - cameraController.camera.x);
        ctx.fillRect(sx, terrainY + y, ex - sx, 1);
      }
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private preRenderDepthTerrainLayer(terrainY: number, startX: number, endX: number): void {
    const { spriteService, gameService, cameraController } = this.rc;
    if (!gameService.depthTerrain?.length) return;

    const sheet = spriteService.getSpritesheet(spriteService.INNER_TERRAIN_SPRITESHEET);
    if (!sheet) return;

    if (
      !this.depthTerrainCanvas ||
      this.depthTerrainCanvas.width !== CONST.CANVAS_WIDTH ||
      this.depthTerrainCanvas.height !== CONST.CANVAS_HEIGHT
    ) {
      this.depthTerrainCanvas = document.createElement('canvas');
      this.depthTerrainCanvas.width = CONST.CANVAS_WIDTH;
      this.depthTerrainCanvas.height = CONST.CANVAS_HEIGHT;
      this.depthTerrainCtx = this.depthTerrainCanvas.getContext('2d');
    }

    const dCtx = this.depthTerrainCtx!;
    dCtx.clearRect(0, 0, CONST.CANVAS_WIDTH, CONST.CANVAS_HEIGHT);

    const TILE_SIZE = 256;
    const tileIndex = gameService.innerTerrainTileIndex;
    const tileCol = tileIndex % 3;
    const tileRow = Math.floor(tileIndex / 3);
    const tileCanvas = document.createElement('canvas');
    tileCanvas.width = TILE_SIZE;
    tileCanvas.height = TILE_SIZE;
    const tileCtx = tileCanvas.getContext('2d')!;
    tileCtx.drawImage(
      sheet,
      tileCol * TILE_SIZE,
      tileRow * TILE_SIZE,
      TILE_SIZE,
      TILE_SIZE,
      0,
      0,
      TILE_SIZE,
      TILE_SIZE,
    );

    const pattern = dCtx.createPattern(tileCanvas, 'repeat')!;
    const offsetX = -(cameraController.camera.x % TILE_SIZE);
    const offsetY = terrainY % TILE_SIZE;
    dCtx.save();
    dCtx.translate(offsetX, offsetY);
    dCtx.fillStyle = pattern;
    dCtx.fillRect(
      -offsetX,
      terrainY - offsetY,
      CONST.CANVAS_WIDTH + TILE_SIZE,
      CONST.TERRAIN_STRIP_HEIGHT + TILE_SIZE,
    );
    dCtx.restore();

    dCtx.globalCompositeOperation = 'destination-out';
    dCtx.fillStyle = 'rgba(0,0,0,1)';
    const mainTerrain = gameService.terrain;
    const depthTerrain = gameService.depthTerrain;
    for (let y = 0; y < CONST.TERRAIN_STRIP_HEIGHT; y++) {
      let segStart = -1;
      for (let x = startX; x < endX; x++) {
        const inRing = (mainTerrain[x]?.[y] ?? 0) === 0 && (depthTerrain[x]?.[y] ?? 0) === 1;
        if (!inRing) {
          if (segStart === -1) segStart = x;
        } else if (segStart !== -1) {
          const sx = Math.floor(segStart - cameraController.camera.x);
          const ex = Math.floor(x - cameraController.camera.x);
          dCtx.fillRect(sx, terrainY + y, ex - sx, 1);
          segStart = -1;
        }
      }
      if (segStart !== -1) {
        const sx = Math.floor(segStart - cameraController.camera.x);
        const ex = Math.floor(endX - cameraController.camera.x);
        dCtx.fillRect(sx, terrainY + y, ex - sx, 1);
      }
    }
    dCtx.globalCompositeOperation = 'source-over';
  }

  private drawTerrainSpritePlacements(
    offCtx: CanvasRenderingContext2D,
    placements: TerrainChunkPlacement[],
    terrainSheet: HTMLCanvasElement | HTMLImageElement,
    terrainY: number,
  ): void {
    const { cameraController } = this.rc;
    for (const placement of placements) {
      const { region, x: worldX, topWorldY } = placement;
      const screenX = Math.floor(worldX - cameraController.camera.x);
      const screenY = Math.floor(terrainY + topWorldY);
      if (screenX + region.width < 0 || screenX > CONST.CANVAS_WIDTH) continue;
      offCtx.drawImage(
        terrainSheet,
        region.x,
        region.y,
        region.width,
        region.height,
        screenX,
        screenY,
        region.width,
        region.height,
      );
    }
  }

  private drawBgCover(
    ctx: CanvasRenderingContext2D,
    sheet: HTMLImageElement | HTMLCanvasElement,
    sprite: BackgroundSpriteMetadata,
    scaleMultiplier: number,
    offsetX = 0,
  ): void {
    const scaleX = CONST.CANVAS_WIDTH / sprite.width;
    const scaleY = CONST.CANVAS_HEIGHT / sprite.height;
    const scale = Math.max(scaleX, scaleY) * scaleMultiplier;
    const drawW = sprite.width * scale;
    const drawH = sprite.height * scale;
    const drawX = (CONST.CANVAS_WIDTH - drawW) / 2 - offsetX;
    const drawY = (CONST.CANVAS_HEIGHT - drawH) / 2;
    ctx.drawImage(
      sheet,
      sprite.x,
      sprite.y,
      sprite.width,
      sprite.height,
      drawX,
      drawY,
      drawW,
      drawH,
    );
  }

  private drawBgCoverTiled(
    ctx: CanvasRenderingContext2D,
    sheet: HTMLImageElement | HTMLCanvasElement,
    sprite: BackgroundSpriteMetadata,
    scaleMultiplier: number,
    offsetX = 0,
  ): void {
    const scaleX = CONST.CANVAS_WIDTH / sprite.width;
    const scaleY = CONST.CANVAS_HEIGHT / sprite.height;
    const scale = Math.max(scaleX, scaleY) * scaleMultiplier;
    const drawW = sprite.width * scale;
    const drawH = sprite.height * scale;
    const drawY = (CONST.CANVAS_HEIGHT - drawH) / 2;
    const startX = -((offsetX % drawW) + drawW) % drawW;
    for (let x = startX; x < CONST.CANVAS_WIDTH; x += drawW) {
      ctx.drawImage(sheet, sprite.x, sprite.y, sprite.width, sprite.height, x, drawY, drawW, drawH);
    }
  }

  private drawBgTiledBottom(
    ctx: CanvasRenderingContext2D,
    sheet: HTMLImageElement | HTMLCanvasElement,
    sprite: BackgroundSpriteMetadata,
    scaleMultiplier: number,
    offsetX = 0,
  ): void {
    const drawH = sprite.height * scaleMultiplier;
    const drawW = sprite.width * scaleMultiplier;
    const drawY = CONST.CANVAS_HEIGHT - drawH;
    const startX = -((offsetX % drawW) + drawW) % drawW;
    for (let x = startX; x < CONST.CANVAS_WIDTH; x += drawW) {
      ctx.drawImage(sheet, sprite.x, sprite.y, sprite.width, sprite.height, x, drawY, drawW, drawH);
    }
  }

  private drawBgInstance(
    sheet: HTMLImageElement | HTMLCanvasElement,
    sprite: BackgroundSpriteMetadata,
    worldX: number,
    parallaxOffset: number,
    scaleMultiplier: number,
  ): void {
    const { ctx } = this.rc;
    const drawW = sprite.width * scaleMultiplier;
    const drawH = sprite.height * scaleMultiplier;
    const screenX = worldX - parallaxOffset;
    const drawY = CONST.CANVAS_HEIGHT - drawH;
    ctx.drawImage(
      sheet,
      sprite.x,
      sprite.y,
      sprite.width,
      sprite.height,
      screenX,
      drawY,
      drawW,
      drawH,
    );
  }
}
