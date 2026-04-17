/**
 * Dev-tools renderer — dynamically imported so it never loads in production paths.
 * Contains the Terrain Tool (sprite region detector) and the Layer Offset Tool.
 */

import { GameState, TerrainSpriteRegion, LayerOffsetData, LayerFrameOffset } from './monkeys.types';
import { MonkeysRenderContext } from './monkeys-render-context';
import { MonkeysUIRenderer, mkBtn, isPointInsideButton } from './monkeys-ui.renderer';
import * as CONST from './monkeys.constants';

// Import the analyzer the same way the component does — type only used at runtime via dynamic import
import { TerrainSpriteAnalyzer } from './terrain-sprite-analyzer';

export class MonkeysDevToolsRenderer {
  // ── Terrain tool state ────────────────────────────────────────────────────
  private terrainToolImage: HTMLImageElement | HTMLCanvasElement | null = null;
  private terrainToolRegions: TerrainSpriteRegion[] = [];
  private terrainToolSelectedRegionId: number | null = null;
  private terrainToolLoading = false;
  private terrainToolError = '';
  private terrainToolViewport: {
    x: number;
    y: number;
    width: number;
    height: number;
    scale: number;
  } | null = null;
  private terrainToolCopyStatus = '';
  private terrainToolCopyStatusUntil = 0;
  private terrainToolActiveSheet: 'terrain' | 'background' = 'terrain';
  private terrainToolSimpleMode = false;
  private readonly terrainSpriteAnalyzer = new TerrainSpriteAnalyzer();

  // ── Layer tool state ──────────────────────────────────────────────────────
  private editorOffsets: LayerOffsetData | null = null;
  private layerToolAllOffsets: Record<string, LayerOffsetData> = {};
  private layerToolSheet = 'Lupin Composite.png';
  private editorFrameIndex = 0;
  private editorFruitIndex = 0;
  private layerToolBtns: Map<string, { x: number; y: number; w: number; h: number }> = new Map();

  // ── Constants ─────────────────────────────────────────────────────────────
  private readonly TERRAIN_TOOL_ALPHA_THRESHOLD = 96;
  private readonly TERRAIN_TOOL_MINIMUM_PIXEL_COUNT = 24;
  private readonly TERRAIN_TOOL_OUTLINE_POINT_STRIDE = 1;

  private readonly LAYER_EDITOR_FRAMES = [
    'idle',
    'move_0',
    'move_1',
    'move_2',
    'move_3',
    'shoot_0',
    'shoot_1',
    'shoot_2',
    'shoot_3',
    'shoot_4',
    'shoot_5',
    'shoot_6',
    'shoot_7',
    'shoot_8',
    'shoot_9',
  ] as const;
  private readonly LAYER_EDITOR_FRUITS = ['item_banana', 'item_apple', 'item_peanut'] as const;
  private readonly ZOMBIE_LAYER_EDITOR_FRUITS = [
    'zombie_item_banana_bunch',
    'zombie_item_corn_stick',
    'zombie_item_mushroom',
  ] as const;

  readonly TERRAIN_TOOL_BACK_BUTTON = mkBtn(CONST.CANVAS_WIDTH - 170, 48, 220, 44);
  readonly TERRAIN_TOOL_RESCAN_BUTTON = mkBtn(CONST.CANVAS_WIDTH - 170, 102, 220, 44);
  readonly TERRAIN_TOOL_COPY_ALL_BUTTON = mkBtn(CONST.CANVAS_WIDTH - 170, 156, 220, 44);
  readonly TERRAIN_TOOL_SWITCH_BUTTON = mkBtn(CONST.CANVAS_WIDTH - 170, 210, 220, 44);
  readonly TERRAIN_TOOL_MODE_BUTTON = mkBtn(CONST.CANVAS_WIDTH - 170, 264, 220, 44);

  constructor(
    private readonly rc: MonkeysRenderContext,
    private readonly ui: MonkeysUIRenderer,
  ) {}

  // ─── Public API ───────────────────────────────────────────────────────────

  drawTerrainTool(): void {
    const { ctx, gameService, spriteService } = this.rc;
    ctx.fillStyle = '#13202B';
    ctx.fillRect(0, 0, CONST.CANVAS_WIDTH, CONST.CANVAS_HEIGHT);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 36px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('Terrain Tool', 24, 48);
    ctx.font = '16px Arial';
    ctx.fillStyle = '#C7D5E0';
    const activeSheetName =
      this.terrainToolActiveSheet === 'terrain'
        ? spriteService.TERRAIN_TOOL_SPRITESHEET
        : spriteService.BACKGROUND_TOOL_SPRITESHEET;
    ctx.fillText(`Connected-component bounds detection for ${activeSheetName}`, 24, 76);

    ctx.fillStyle = '#0E1720';
    ctx.fillRect(20, 96, 820, 600);
    ctx.fillStyle = '#101A25';
    ctx.fillRect(860, 96, 320, 600);

    this.ui.drawButton('Back to Menu', this.TERRAIN_TOOL_BACK_BUTTON, '#FF9800', '#F57C00');
    this.ui.drawButton('Rescan Sheet', this.TERRAIN_TOOL_RESCAN_BUTTON, '#1565C0', '#0D47A1');
    this.ui.drawButton('Copy All Regions', this.TERRAIN_TOOL_COPY_ALL_BUTTON, '#2E7D32', '#1B5E20');
    const switchLabel =
      this.terrainToolActiveSheet === 'terrain' ? 'Switch to Background' : 'Switch to Terrain';
    this.ui.drawButton(switchLabel, this.TERRAIN_TOOL_SWITCH_BUTTON, '#5C5490', '#3D3563');
    const modeLabel = this.terrainToolSimpleMode ? 'Mode: Rectangles' : 'Mode: Detailed';
    this.ui.drawButton(
      modeLabel,
      this.TERRAIN_TOOL_MODE_BUTTON,
      this.terrainToolSimpleMode ? '#37474F' : '#00695C',
      this.terrainToolSimpleMode ? '#263238' : '#004D40',
    );

    if (this.terrainToolCopyStatus && Date.now() < this.terrainToolCopyStatusUntil) {
      ctx.fillStyle = '#D8E2EA';
      ctx.font = '14px Arial';
      ctx.textAlign = 'right';
      ctx.fillText(this.terrainToolCopyStatus, CONST.CANVAS_WIDTH - 20, 206);
      ctx.textAlign = 'left';
    }

    if (this.terrainToolLoading) {
      this.terrainToolViewport = null;
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '24px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Loading terrain spritesheet...', 430, 396);
      ctx.textAlign = 'left';
      this.drawTerrainToolSidebar();
      return;
    }
    if (this.terrainToolError) {
      this.terrainToolViewport = null;
      ctx.fillStyle = '#FF8A80';
      ctx.font = '20px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(this.terrainToolError, 430, 396);
      ctx.textAlign = 'left';
      this.drawTerrainToolSidebar();
      return;
    }
    if (!this.terrainToolImage) {
      this.terrainToolViewport = null;
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '20px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('No terrain sheet loaded.', 430, 396);
      ctx.textAlign = 'left';
      this.drawTerrainToolSidebar();
      return;
    }

    const viewport = this.getTerrainToolViewport(this.terrainToolImage);
    this.terrainToolViewport = viewport;

    ctx.drawImage(this.terrainToolImage, viewport.x, viewport.y, viewport.width, viewport.height);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1;
    ctx.strokeRect(viewport.x, viewport.y, viewport.width, viewport.height);

    for (const region of this.terrainToolRegions) {
      const isSelected = region.id === this.terrainToolSelectedRegionId;
      const drawX = viewport.x + region.x * viewport.scale;
      const drawY = viewport.y + region.y * viewport.scale;
      const drawWidth = Math.max(1, region.width * viewport.scale);
      const drawHeight = Math.max(1, region.height * viewport.scale);
      if (isSelected) {
        ctx.fillStyle = 'rgba(255, 235, 59, 0.18)';
        ctx.fillRect(drawX, drawY, drawWidth, drawHeight);
      }
      ctx.strokeStyle = isSelected ? '#FFEB3B' : '#4DD0E1';
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.strokeRect(drawX, drawY, drawWidth, drawHeight);
      ctx.fillStyle = isSelected ? '#FFEB3B' : '#4DD0E1';
      ctx.font = '12px Arial';
      ctx.fillText(`${region.id}`, drawX + 2, Math.max(12, drawY - 4));
    }

    this.drawTerrainToolSidebar();
  }

  drawLayerTool(): void {
    const { ctx, spriteService } = this.rc;
    if (!this.editorOffsets) this.openLayerTool();

    this.layerToolBtns.clear();
    ctx.resetTransform();
    ctx.fillStyle = '#4A4A4A';
    ctx.fillRect(0, 0, CONST.CANVAS_WIDTH, CONST.CANVAS_HEIGHT);
    this.ui.drawNineSlicePanel('panel_wood_3_nail', 588, 15, 604, 690);

    const previewCX = 290,
      previewCY = 360;
    const spriteSize = CONST.TANK_BODY_RADIUS * 2 * 1.5 * 3;
    const spriteYOffset = -15 * 3;
    const scale = 3;
    const frameName = this.LAYER_EDITOR_FRAMES[this.editorFrameIndex];
    const isZombie = this.layerToolSheet === spriteService.ZOMBIE_COMPOSITE;
    const editorFruits = isZombie ? this.ZOMBIE_LAYER_EDITOR_FRUITS : this.LAYER_EDITOR_FRUITS;
    const fruitKey = editorFruits[this.editorFruitIndex];
    const offsets = this.editorOffsets!;
    const frameOffsets = offsets.frames[frameName];
    const fruitCfg = offsets.fruitConfig[fruitKey];
    const fruitScale = fruitCfg?.scale ?? 1.0;
    const overlayZ = fruitCfg?.overlayZ ?? 3;

    const backSprite = spriteService.getEntitySprite(frameName, this.layerToolSheet);
    const fruitSprite = spriteService.getSprite(fruitKey);
    const handSprite = spriteService.getEntitySprite('hand', this.layerToolSheet);
    const fruitToOverlay: Record<string, string> = isZombie
      ? {
          zombie_item_banana_bunch: 'zombie_overlay_banana_bunch',
          zombie_item_corn_stick: 'zombie_overlay_corn_stick',
          zombie_item_mushroom: 'zombie_overlay_mushroom',
        }
      : {
          item_banana: 'overlay_banana',
          item_apple: 'overlay_apple',
          item_peanut: 'overlay_peanut',
        };
    const overlaySpriteName = fruitToOverlay[fruitKey] ?? null;
    const overlaySprite = overlaySpriteName ? spriteService.getSprite(overlaySpriteName) : null;

    ctx.save();
    try {
      ctx.translate(previewCX, previewCY);
      ctx.scale(-1, 1);
      const drawPreviewLayer = (
        spr: {
          image: CanvasImageSource;
          x: number;
          y: number;
          width: number;
          height: number;
        } | null,
        sz: number,
        ox: number,
        oy: number,
      ) => {
        if (!spr) return;
        ctx.drawImage(
          spr.image,
          spr.x,
          spr.y,
          spr.width,
          spr.height,
          -sz / 2 + ox,
          -sz / 2 + spriteYOffset + oy,
          sz,
          sz,
        );
      };
      const drawOverlayPreview = () => {
        if (overlaySprite && !frameOffsets?.hideLayers?.includes('overlay')) {
          const ox = (frameOffsets?.overlay.x ?? 0) * scale;
          const oy = (frameOffsets?.overlay.y ?? 0) * scale;
          drawPreviewLayer(overlaySprite, spriteSize, ox, oy);
        }
      };

      drawPreviewLayer(backSprite, spriteSize, 0, 0);
      if (overlayZ < 2) drawOverlayPreview();
      if (fruitSprite && !frameOffsets?.hideLayers?.includes('fruit')) {
        const fruitSz = spriteSize * fruitScale;
        const fx = (frameOffsets?.fruit.x ?? 0) * scale;
        const fy = (frameOffsets?.fruit.y ?? 0) * scale;
        drawPreviewLayer(fruitSprite, fruitSz, fx, fy);
      }
      const aboveFruitName = frameOffsets?.aboveFruitSpriteName ?? null;
      if (aboveFruitName)
        drawPreviewLayer(spriteService.getSprite(aboveFruitName), spriteSize, 0, 0);
      if (handSprite && !frameOffsets?.hideLayers?.includes('hand')) {
        const hx = (frameOffsets?.hand.x ?? 0) * scale;
        const hy = (frameOffsets?.hand.y ?? 0) * scale;
        drawPreviewLayer(handSprite, spriteSize, hx, hy);
      }
      if (overlayZ >= 2) drawOverlayPreview();
      if (isZombie && !frameOffsets?.hideLayers?.includes('halo')) {
        const haloSprite = spriteService.getSprite('zombie_halo');
        const hlx = (frameOffsets?.halo?.x ?? 0) * scale;
        const hly = (frameOffsets?.halo?.y ?? 0) * scale;
        drawPreviewLayer(haloSprite ?? null, spriteSize, hlx, hly);
      }
    } finally {
      ctx.restore();
    }

    const panelCX = 890;
    ctx.textAlign = 'center';
    const NR = isZombie ? 26 : 32;
    const SG = isZombie ? 14 : 18;
    const HG = isZombie ? 18 : 24;

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px Arial';
    ctx.fillText('Layer Offset Tool', panelCX, 50);

    const charBtnW = 170,
      charBtnH = 32;
    this.ltDrawFruitBtn(
      'char_lupin',
      'Lupin',
      { x: 780, y: 76, w: charBtnW, h: charBtnH },
      !isZombie,
    );
    this.ltDrawFruitBtn(
      'char_zombie',
      'Zombie Lupin',
      { x: 1000, y: 76, w: charBtnW, h: charBtnH },
      isZombie,
    );

    const frameY = isZombie ? 112 : 124;
    this.ltDrawBtn('frame_prev', '◀', { x: 720, y: frameY, w: 60, h: 36 });
    this.ltDrawBtn('frame_next', '▶', { x: 1060, y: frameY, w: 60, h: 36 });
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 15px Arial';
    ctx.fillText(frameName, panelCX, frameY + 6);

    let y = frameY + (isZombie ? 22 : 27);
    this.ltHRule(y);

    y += SG;
    this.ltSectionHeader('HAND', y);
    y += NR;
    this.ltNudgeRow('hand_x', 'X', y, frameOffsets?.hand.x ?? 0, 1, 5);
    y += NR;
    this.ltNudgeRow('hand_y', 'Y', y, frameOffsets?.hand.y ?? 0, 1, 5);
    y += HG;
    this.ltHRule(y);

    y += SG;
    this.ltSectionHeader('FRUIT', y);
    const fruitNames = isZombie ? ['Bunch', 'Corn', 'Shroom'] : ['Banana', 'Apple', 'Peanut'];
    const fruitBtnW = 110,
      fruitBtnH = 30;
    y += NR;
    [740, 890, 1040].forEach((bx, i) => {
      this.ltDrawFruitBtn(
        `fruit_sel_${i}`,
        fruitNames[i],
        { x: bx, y, w: fruitBtnW, h: fruitBtnH },
        this.editorFruitIndex === i,
      );
    });
    y += NR;
    this.ltNudgeRow('fruit_x', 'X', y, frameOffsets?.fruit.x ?? 0, 1, 5);
    y += NR;
    this.ltNudgeRow('fruit_y', 'Y', y, frameOffsets?.fruit.y ?? 0, 1, 5);
    y += NR;
    ctx.fillStyle = '#ccc';
    ctx.font = 'bold 13px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('Fruit Scale', 610, y + 5);
    ctx.textAlign = 'center';
    this.ltScaleRow('fruit_scale', y, fruitScale, 0.05, 0.2);
    y += HG;
    this.ltHRule(y);

    y += SG;
    this.ltSectionHeader('OVERLAY', y);
    y += NR;
    this.ltNudgeRow('overlay_x', 'X', y, frameOffsets?.overlay.x ?? 0, 1, 5);
    y += NR;
    this.ltNudgeRow('overlay_y', 'Y', y, frameOffsets?.overlay.y ?? 0, 1, 5);

    if (isZombie) {
      y += SG;
      this.ltSectionHeader('HALO', y);
      const haloHidden = frameOffsets?.hideLayers?.includes('halo') ?? false;
      y += NR;
      this.ltDrawFruitBtn(
        'halo_toggle',
        `${haloHidden ? '☐' : '☑'} Show`,
        { x: panelCX, y, w: 140, h: 26 },
        !haloHidden,
      );
      y += NR;
      this.ltNudgeRow('halo_x', 'X', y, frameOffsets?.halo?.x ?? 0, 1, 5);
      y += NR;
      this.ltNudgeRow('halo_y', 'Y', y, frameOffsets?.halo?.y ?? 0, 1, 5);
    }

    y += HG;
    this.ltHRule(y);
    y += SG;
    this.ltSectionHeader('EXPLOSION SCALE', y);
    y += NR;
    this.ltScaleRow('exp_scale', y, offsets.explosionScale, 0.05, 0.2);
    y += HG;
    this.ltHRule(y);
    y += 32;
    this.ltDrawBtn('copy_json', 'Copy JSON', { x: panelCX, y, w: 200, h: 42 });
    y += 52;
    this.ltDrawBtn('back', 'Back', { x: panelCX, y, w: 200, h: 42 });
  }

  openLayerTool(): void {
    const { spriteService, gameService } = this.rc;
    const allSaved = spriteService.getAllLayerOffsets();
    const defaultFrame = (): LayerFrameOffset => ({
      hand: { x: 0, y: 0 },
      fruit: { x: 0, y: 0 },
      overlay: { x: 0, y: 0 },
    });
    const buildDefault = (fruits: readonly string[]): LayerOffsetData => ({
      explosionScale: 1.0,
      fruitConfig: Object.fromEntries(fruits.map((f) => [f, { scale: 1.0, overlayZ: 3 }])),
      frames: Object.fromEntries([...this.LAYER_EDITOR_FRAMES].map((f) => [f, defaultFrame()])),
    });
    this.layerToolAllOffsets = {
      [spriteService.LUPIN_COMPOSITE]:
        allSaved[spriteService.LUPIN_COMPOSITE] ?? buildDefault(this.LAYER_EDITOR_FRUITS),
      [spriteService.ZOMBIE_COMPOSITE]:
        allSaved[spriteService.ZOMBIE_COMPOSITE] ?? buildDefault(this.ZOMBIE_LAYER_EDITOR_FRUITS),
    };
    this.editorOffsets = this.layerToolAllOffsets[this.layerToolSheet];
    this.editorFrameIndex = 0;
    this.editorFruitIndex = 0;
    gameService.currentState = GameState.LAYER_TOOL;
  }

  async openTerrainTool(forceRescan = false): Promise<void> {
    const { spriteService, gameService } = this.rc;
    gameService.currentState = GameState.TERRAIN_TOOL;
    this.terrainToolError = '';
    if (this.terrainToolLoading) return;
    if (this.terrainToolImage && this.terrainToolRegions.length > 0 && !forceRescan) return;

    const activeSheetPath =
      this.terrainToolActiveSheet === 'terrain'
        ? spriteService.TERRAIN_TOOL_SPRITESHEET
        : spriteService.BACKGROUND_TOOL_SPRITESHEET;

    this.terrainToolLoading = true;
    try {
      this.terrainToolImage = await spriteService.loadRawSpritesheet(activeSheetPath);
      this.terrainToolRegions = this.terrainSpriteAnalyzer.analyze(this.terrainToolImage, {
        alphaThreshold: this.TERRAIN_TOOL_ALPHA_THRESHOLD,
        minimumPixelCount: this.TERRAIN_TOOL_MINIMUM_PIXEL_COUNT,
        outlinePointStride: this.TERRAIN_TOOL_OUTLINE_POINT_STRIDE,
      });
      this.terrainToolSelectedRegionId = this.terrainToolRegions[0]?.id ?? null;
      if (forceRescan) this.setTerrainToolCopyStatus('Sheet rescanned.');
    } catch (error) {
      console.error('Failed to open terrain tool:', error);
      this.terrainToolError = `Failed to load or analyze ${activeSheetPath}`;
    } finally {
      this.terrainToolLoading = false;
    }
  }

  handleTerrainToolClick(x: number, y: number): void {
    const { gameService } = this.rc;
    if (isPointInsideButton(x, y, this.TERRAIN_TOOL_BACK_BUTTON)) {
      gameService.currentState = GameState.MENU;
      return;
    }
    if (isPointInsideButton(x, y, this.TERRAIN_TOOL_RESCAN_BUTTON)) {
      void this.openTerrainTool(true);
      return;
    }
    if (isPointInsideButton(x, y, this.TERRAIN_TOOL_COPY_ALL_BUTTON)) {
      void this.copyAllTerrainToolRegions();
      return;
    }
    if (isPointInsideButton(x, y, this.TERRAIN_TOOL_SWITCH_BUTTON)) {
      this.terrainToolActiveSheet =
        this.terrainToolActiveSheet === 'terrain' ? 'background' : 'terrain';
      this.terrainToolImage = null;
      this.terrainToolRegions = [];
      this.terrainToolSelectedRegionId = null;
      void this.openTerrainTool(false);
      return;
    }
    if (isPointInsideButton(x, y, this.TERRAIN_TOOL_MODE_BUTTON)) {
      this.terrainToolSimpleMode = !this.terrainToolSimpleMode;
      return;
    }

    const viewport = this.terrainToolViewport;
    if (!viewport) return;
    const isInsideSheet =
      x >= viewport.x &&
      x <= viewport.x + viewport.width &&
      y >= viewport.y &&
      y <= viewport.y + viewport.height;
    if (!isInsideSheet) return;

    const imageX = Math.floor((x - viewport.x) / viewport.scale);
    const imageY = Math.floor((y - viewport.y) / viewport.scale);
    const selectedRegion = this.terrainToolRegions
      .filter(
        (r) => imageX >= r.x && imageX < r.x + r.width && imageY >= r.y && imageY < r.y + r.height,
      )
      .sort((a, b) => a.width * a.height - b.width * b.height)[0];

    if (selectedRegion && selectedRegion.id === this.terrainToolSelectedRegionId) {
      this.terrainToolSelectedRegionId = null;
    } else {
      this.terrainToolSelectedRegionId = selectedRegion?.id ?? null;
    }
  }

  handleLayerToolClick(x: number, y: number): void {
    if (!this.editorOffsets) return;
    const offsets = this.editorOffsets;
    const { gameService, spriteService } = this.rc;
    const frameName = this.LAYER_EDITOR_FRAMES[this.editorFrameIndex];
    const isZombie = this.layerToolSheet === spriteService.ZOMBIE_COMPOSITE;
    const editorFruits = isZombie ? this.ZOMBIE_LAYER_EDITOR_FRUITS : this.LAYER_EDITOR_FRUITS;
    const fruitKey = editorFruits[this.editorFruitIndex];

    const hit = (key: string): boolean => {
      const btn = this.layerToolBtns.get(key);
      if (!btn) return false;
      return (
        x >= btn.x - btn.w / 2 &&
        x <= btn.x + btn.w / 2 &&
        y >= btn.y - btn.h / 2 &&
        y <= btn.y + btn.h / 2
      );
    };

    if (hit('frame_prev')) {
      this.editorFrameIndex =
        (this.editorFrameIndex - 1 + this.LAYER_EDITOR_FRAMES.length) %
        this.LAYER_EDITOR_FRAMES.length;
      return;
    }
    if (hit('frame_next')) {
      this.editorFrameIndex = (this.editorFrameIndex + 1) % this.LAYER_EDITOR_FRAMES.length;
      return;
    }
    for (let i = 0; i < 3; i++) {
      if (hit(`fruit_sel_${i}`)) {
        this.editorFruitIndex = i;
        return;
      }
    }

    if (hit('char_lupin') && this.layerToolSheet !== spriteService.LUPIN_COMPOSITE) {
      this.layerToolAllOffsets[this.layerToolSheet] = offsets;
      this.layerToolSheet = spriteService.LUPIN_COMPOSITE;
      this.editorOffsets = this.layerToolAllOffsets[spriteService.LUPIN_COMPOSITE];
      this.editorFruitIndex = 0;
      return;
    }
    if (hit('char_zombie') && this.layerToolSheet !== spriteService.ZOMBIE_COMPOSITE) {
      this.layerToolAllOffsets[this.layerToolSheet] = offsets;
      this.layerToolSheet = spriteService.ZOMBIE_COMPOSITE;
      this.editorOffsets = this.layerToolAllOffsets[spriteService.ZOMBIE_COMPOSITE];
      this.editorFruitIndex = 0;
      return;
    }

    if (!offsets.frames[frameName]) {
      offsets.frames[frameName] = {
        hand: { x: 0, y: 0 },
        fruit: { x: 0, y: 0 },
        overlay: { x: 0, y: 0 },
      };
    }
    const frame = offsets.frames[frameName];

    if (hit('halo_toggle') && isZombie) {
      const hideLayers = frame.hideLayers ?? [];
      frame.hideLayers = hideLayers.includes('halo')
        ? hideLayers.filter((l) => l !== 'halo')
        : [...hideLayers, 'halo'];
      return;
    }

    const nudgeAxis = (
      obj: { x: number; y: number },
      axis: 'x' | 'y',
      id: string,
      small: number,
      big: number,
    ): boolean => {
      if (hit(`${id}_m${big}`)) {
        obj[axis] -= big;
        return true;
      }
      if (hit(`${id}_m${small}`)) {
        obj[axis] -= small;
        return true;
      }
      if (hit(`${id}_p${small}`)) {
        obj[axis] += small;
        return true;
      }
      if (hit(`${id}_p${big}`)) {
        obj[axis] += big;
        return true;
      }
      return false;
    };

    if (nudgeAxis(frame.hand, 'x', 'hand_x', 1, 5)) return;
    if (nudgeAxis(frame.hand, 'y', 'hand_y', 1, 5)) return;
    if (nudgeAxis(frame.fruit, 'x', 'fruit_x', 1, 5)) return;
    if (nudgeAxis(frame.fruit, 'y', 'fruit_y', 1, 5)) return;
    if (nudgeAxis(frame.overlay, 'x', 'overlay_x', 1, 5)) return;
    if (nudgeAxis(frame.overlay, 'y', 'overlay_y', 1, 5)) return;
    if (isZombie) {
      if (!frame.halo) frame.halo = { x: 0, y: 0 };
      if (nudgeAxis(frame.halo, 'x', 'halo_x', 1, 5)) return;
      if (nudgeAxis(frame.halo, 'y', 'halo_y', 1, 5)) return;
    }

    const scaleDelta = (id: string, small: number, big: number): number | null => {
      if (hit(`${id}_m${big}`)) return -big;
      if (hit(`${id}_m${small}`)) return -small;
      if (hit(`${id}_p${small}`)) return small;
      if (hit(`${id}_p${big}`)) return big;
      return null;
    };
    const fruitScaleDelta = scaleDelta('fruit_scale', 0.05, 0.2);
    if (fruitScaleDelta !== null) {
      const cfg = offsets.fruitConfig[fruitKey];
      if (cfg) cfg.scale = Math.max(0.1, Math.round((cfg.scale + fruitScaleDelta) * 100) / 100);
      return;
    }
    const expScaleDelta = scaleDelta('exp_scale', 0.05, 0.2);
    if (expScaleDelta !== null) {
      offsets.explosionScale = Math.max(
        0.1,
        Math.round((offsets.explosionScale + expScaleDelta) * 100) / 100,
      );
      return;
    }

    if (hit('copy_json')) {
      this.layerToolAllOffsets[this.layerToolSheet] = offsets;
      void navigator.clipboard.writeText(JSON.stringify(this.layerToolAllOffsets, null, 2));
      return;
    }
    if (hit('back')) {
      gameService.currentState = GameState.MENU;
      return;
    }
  }

  async copyAllTerrainToolRegions(): Promise<void> {
    if (this.terrainToolRegions.length === 0) {
      this.setTerrainToolCopyStatus('No regions available to copy.');
      return;
    }
    const exportPayload = JSON.stringify(this.buildTerrainToolExportPayload(), null, 2);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(exportPayload);
      } else {
        this.copyTextWithFallback(exportPayload);
      }
      this.setTerrainToolCopyStatus(`Copied ${this.terrainToolRegions.length} regions.`);
    } catch {
      try {
        this.copyTextWithFallback(exportPayload);
        this.setTerrainToolCopyStatus(`Copied ${this.terrainToolRegions.length} regions.`);
      } catch {
        this.setTerrainToolCopyStatus('Copy failed. Clipboard access was blocked.');
      }
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private drawTerrainToolSidebar(): void {
    const { ctx, spriteService } = this.rc;
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('Sheet Info', 880, 136);
    ctx.font = '15px Arial';
    ctx.fillStyle = '#D8E2EA';
    const sheetLabel =
      this.terrainToolActiveSheet === 'terrain'
        ? spriteService.TERRAIN_TOOL_SPRITESHEET
        : spriteService.BACKGROUND_TOOL_SPRITESHEET;
    ctx.fillText(`File: ${sheetLabel}`, 880, 168);
    if (this.terrainToolImage)
      ctx.fillText(
        `Sheet size: ${this.terrainToolImage.width} x ${this.terrainToolImage.height}`,
        880,
        194,
      );
    ctx.fillText(`Detected regions: ${this.terrainToolRegions.length}`, 880, 220);
    ctx.fillText(`Alpha threshold: ${this.TERRAIN_TOOL_ALPHA_THRESHOLD}`, 880, 246);
    ctx.fillText(`Min pixels: ${this.TERRAIN_TOOL_MINIMUM_PIXEL_COUNT}`, 880, 272);
    ctx.fillText('Copy All Regions exports detector output as JSON.', 880, 298);

    const selectedRegion = this.getSelectedTerrainToolRegion();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 20px Arial';
    ctx.fillText('Selection', 880, 340);
    if (!selectedRegion) {
      ctx.fillStyle = '#D8E2EA';
      ctx.font = '15px Arial';
      ctx.fillText('Click a detected region to inspect it.', 880, 370);
      return;
    }
    ctx.fillStyle = '#D8E2EA';
    ctx.font = '15px Arial';
    ctx.fillText(`Region: ${selectedRegion.id}`, 880, 370);
    ctx.fillText(`Bounds: (${selectedRegion.x}, ${selectedRegion.y})`, 880, 396);
    ctx.fillText(`Size: ${selectedRegion.width} x ${selectedRegion.height}`, 880, 422);
    ctx.fillText(`Solid pixels: ${selectedRegion.pixelCount}`, 880, 448);
    ctx.fillText(`Outline samples: ${selectedRegion.outline.length}`, 880, 474);
    ctx.fillText('Outline preview', 880, 508);
    this.drawTerrainToolRegionPreview(selectedRegion, 890, 528, 260, 146);
  }

  private drawTerrainToolRegionPreview(
    region: TerrainSpriteRegion,
    x: number,
    y: number,
    maxWidth: number,
    maxHeight: number,
  ): void {
    const { ctx } = this.rc;
    if (!this.terrainToolImage) return;
    ctx.fillStyle = '#071019';
    ctx.fillRect(x, y, maxWidth, maxHeight);
    const scale = Math.min(maxWidth / region.width, maxHeight / region.height);
    const drawWidth = region.width * scale,
      drawHeight = region.height * scale;
    const drawX = x + (maxWidth - drawWidth) / 2,
      drawY = y + (maxHeight - drawHeight) / 2;
    ctx.drawImage(
      this.terrainToolImage,
      region.x,
      region.y,
      region.width,
      region.height,
      drawX,
      drawY,
      drawWidth,
      drawHeight,
    );
    const pointSize = Math.max(1, Math.ceil(scale));
    ctx.fillStyle = '#FF5252';
    for (const point of region.outline)
      ctx.fillRect(drawX + point.x * scale, drawY + point.y * scale, pointSize, pointSize);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1;
    ctx.strokeRect(drawX, drawY, drawWidth, drawHeight);
  }

  private getTerrainToolViewport(image: HTMLImageElement | HTMLCanvasElement) {
    const left = 32,
      top = 112,
      maxWidth = 796,
      maxHeight = 568;
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
    const width = image.width * scale,
      height = image.height * scale;
    return {
      x: left + (maxWidth - width) / 2,
      y: top + (maxHeight - height) / 2,
      width,
      height,
      scale,
    };
  }

  private getSelectedTerrainToolRegion(): TerrainSpriteRegion | null {
    if (this.terrainToolSelectedRegionId === null) return null;
    return this.terrainToolRegions.find((r) => r.id === this.terrainToolSelectedRegionId) ?? null;
  }

  private buildTerrainToolExportPayload() {
    const { spriteService } = this.rc;
    const activeSheetPath =
      this.terrainToolActiveSheet === 'terrain'
        ? spriteService.TERRAIN_TOOL_SPRITESHEET
        : spriteService.BACKGROUND_TOOL_SPRITESHEET;
    const prefix = this.terrainToolActiveSheet === 'background' ? 'background' : 'terrain';
    return {
      spritesheets: {},
      sprites: this.terrainToolRegions.map((region) => {
        const base = {
          name: `${prefix}_region_${region.id}`,
          spritesheet: activeSheetPath,
          x: region.x,
          y: region.y,
          z: 0,
          width: region.width,
          height: region.height,
        };
        return this.terrainToolSimpleMode
          ? base
          : { ...base, pixelCount: region.pixelCount, outline: region.outline };
      }),
      analysis: {
        alphaThreshold: this.TERRAIN_TOOL_ALPHA_THRESHOLD,
        minimumPixelCount: this.TERRAIN_TOOL_MINIMUM_PIXEL_COUNT,
        regionCount: this.terrainToolRegions.length,
      },
    };
  }

  private copyTextWithFallback(text: string): void {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const didCopy = document.execCommand('copy');
    document.body.removeChild(textarea);
    if (!didCopy) throw new Error('document.execCommand(copy) returned false');
  }

  private setTerrainToolCopyStatus(message: string): void {
    this.terrainToolCopyStatus = message;
    this.terrainToolCopyStatusUntil = Date.now() + 3000;
  }

  private ltDrawBtn(
    key: string,
    label: string,
    btn: { x: number; y: number; w: number; h: number },
    active = false,
  ): void {
    const { ctx } = this.rc;
    this.layerToolBtns.set(key, btn);
    const left = btn.x - btn.w / 2,
      top = btn.y - btn.h / 2;
    ctx.fillStyle = active ? '#E67C22' : '#444';
    ctx.fillRect(left, top, btn.w, btn.h);
    ctx.strokeStyle = active ? '#FF9800' : '#888';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(left, top, btn.w, btn.h);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, btn.x, btn.y);
    ctx.textBaseline = 'alphabetic';
  }

  private ltDrawFruitBtn(
    key: string,
    label: string,
    btn: { x: number; y: number; w: number; h: number },
    active: boolean,
  ): void {
    this.ltDrawBtn(key, label, btn, active);
  }

  private ltHRule(y: number): void {
    const { ctx } = this.rc;
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(600, y);
    ctx.lineTo(1182, y);
    ctx.stroke();
  }

  private ltSectionHeader(label: string, y: number): void {
    const { ctx } = this.rc;
    ctx.fillStyle = '#FFCC66';
    ctx.font = 'bold 13px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(label, 890, y);
  }

  private ltNudgeRow(
    id: string,
    label: string,
    cy: number,
    value: number,
    small: number,
    big: number,
  ): void {
    const { ctx } = this.rc;
    const bW = 62,
      bH = 28;
    ctx.fillStyle = '#ccc';
    ctx.font = 'bold 13px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(label, 610, cy + 5);
    const xs = [730, 800, 970, 1040];
    const labels = [`«-${big}`, `‹-${small}`, `+${small}›`, `+${big}»`];
    const keys = [`${id}_m${big}`, `${id}_m${small}`, `${id}_p${small}`, `${id}_p${big}`];
    for (let i = 0; i < 4; i++)
      this.ltDrawBtn(keys[i], labels[i], { x: xs[i], y: cy, w: bW, h: bH });
    ctx.fillStyle = '#fff';
    ctx.font = '13px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(String(value), 895, cy + 5);
    ctx.textAlign = 'left';
  }

  private ltScaleRow(id: string, cy: number, value: number, small: number, big: number): void {
    const { ctx } = this.rc;
    const bW = 62,
      bH = 28;
    const xs = [730, 800, 970, 1040];
    const labels = [`«-${big}`, `‹-${small}`, `+${small}›`, `+${big}»`];
    const keys = [`${id}_m${big}`, `${id}_m${small}`, `${id}_p${small}`, `${id}_p${big}`];
    for (let i = 0; i < 4; i++)
      this.ltDrawBtn(keys[i], labels[i], { x: xs[i], y: cy, w: bW, h: bH });
    ctx.fillStyle = '#fff';
    ctx.font = '13px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(value.toFixed(2), 895, cy + 5);
    ctx.textAlign = 'left';
  }
}
