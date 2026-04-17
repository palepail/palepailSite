import { GameState, EquipmentSlot, EquipmentItem, EquipmentStats } from './monkeys.types';
import {
  MonkeysRenderContext,
  TEXT_CHAR_TO_SPRITE,
  ANGLE_CHAR_TO_SPRITE,
  ARENA_CHAR_TO_SPRITE,
  drawSpriteChars,
  drawSpriteTextCentered,
  tintedGlyph,
} from './monkeys-render-context';
import { MonkeysAudioService } from './monkeys-audio.service';
import { MonkeysBackgroundRenderer } from './monkeys-background.renderer';
import * as CONST from './monkeys.constants';

// Physics config + runtime state for a row of letters that drop in with bounce.
interface BouncingLetterAnimConfig {
  letterSize: number;
  staggerMs: number;
  gravity: number;
  bounce: number;
  minBounceVY: number;
  advanceRatio: number;
  targetYFn: (i: number) => number;
}
interface BouncingLetterAnimState {
  cfg: BouncingLetterAnimConfig;
  letterY: number[];
  letterVY: number[];
  animStart: number;
  animLastTs: number;
}

export class MonkeysUIRenderer {
  // ── Public mutable state accessed by the component's event handlers ──────
  combatLogToggleBtn = { x: 0, y: 0, width: 0, height: 0 };
  selectedBulletIndex = 0;
  isNameEditing = false;
  expandedSlot: EquipmentSlot | null = null;
  loadoutSlotIndices: Record<EquipmentSlot, number> = {
    headgear: 0,
    torso: 0,
    legs: 0,
    footwear: 0,
    accessory: 0,
  };
  combatLogMinimized = false;

  // ── Private animation/menu state ─────────────────────────────────────────
  private menuMonkeyState: { startMs: number; fruitIndex: number } | null = null;

  private menuTitleAnim: BouncingLetterAnimState = {
    cfg: {
      letterSize: 96,
      staggerMs: 130,
      gravity: 1800,
      bounce: 0.38,
      minBounceVY: 50,
      advanceRatio: 0.5,
      targetYFn: (i) => 55 + [4, -8, 10, -5, 8, -10, 3][i],
    },
    letterY: [],
    letterVY: [],
    animStart: 0,
    animLastTs: 0,
  };
  private readonly GO_LETTERS = [
    'arena_G',
    'arena_A',
    'arena_M',
    'arena_E',
    'arena_O',
    'arena_V',
    'arena_E2',
    'arena_R',
  ];
  private readonly WIN_LETTERS = ['text_Y', 'text_O', 'text_U', 'text_W', 'text_I', 'text_N'];
  private readonly WIN_TEXT_TINT = '#FFE700';
  private gameOverAnim: BouncingLetterAnimState = {
    cfg: {
      letterSize: 96,
      staggerMs: 110,
      gravity: 2400,
      bounce: 0.42,
      minBounceVY: 60,
      advanceRatio: 0.62,
      targetYFn: () => CONST.CANVAS_HEIGHT / 3 - 48,
    },
    letterY: [],
    letterVY: [],
    animStart: 0,
    animLastTs: 0,
  };

  private windAnim = {
    displayAngle: 0,
    displayFill: 0,
    fromAngle: 0,
    fromFill: 0,
    toAngle: 0,
    toFill: 0,
    startTime: 0,
    duration: 600,
  };

  // ── Constants ─────────────────────────────────────────────────────────────
  private readonly POWER_PERCENT_SPRITE_SIZE = 26;
  private readonly CURSOR_BLINK_PERIOD_MS = 1000;
  private readonly CURSOR_ON_DURATION_MS = 530;
  private readonly WEAPON_BTN_SIZE = 68;
  private readonly WEAPON_BTN_GAP = 8;
  private readonly WEAPON_BTN_MARGIN = 10;
  private readonly WEAPON_SPRITES = ['item_banana', 'item_apple', 'item_peanut'];

  private readonly MT_LETTERS = [
    'text_M',
    'text_O',
    'text_N',
    'text_K',
    'text_E',
    'text_Y',
    'text_S',
  ];

  private readonly EQUIPMENT_SLOTS: EquipmentSlot[] = [
    'headgear',
    'torso',
    'legs',
    'footwear',
    'accessory',
  ];
  private readonly SLOT_LABELS: Record<EquipmentSlot, string> = {
    headgear: 'Headgear',
    torso: 'Torso',
    legs: 'Legs',
    footwear: 'Footwear',
    accessory: 'Accessory',
  };

  // Button rects (centre-x, centre-y, width, height)
  readonly MUTE_BUTTON = mkBtn(CONST.CANVAS_WIDTH - 12, 12, 24, 24);
  readonly EQUIP_BACK_BUTTON = mkBtn(600, 650, 140, 44);
  readonly OPTIONS_BACK_BUTTON = mkBtn(CONST.CANVAS_WIDTH / 2, 590, 200, 50);
  readonly OPTIONS_DIFFICULTY_EASY_BUTTON = mkBtn(CONST.CANVAS_WIDTH / 2 - 200, 280, 160, 50);
  readonly OPTIONS_DIFFICULTY_NORMAL_BUTTON = mkBtn(CONST.CANVAS_WIDTH / 2, 280, 160, 50);
  readonly OPTIONS_DIFFICULTY_HARD_BUTTON = mkBtn(CONST.CANVAS_WIDTH / 2 + 200, 280, 160, 50);
  readonly SLIDER_TRACK_LEFT = CONST.CANVAS_WIDTH / 2 - 220;
  readonly SLIDER_TRACK_WIDTH = 440;
  readonly SLIDER_BG_TRACK_Y = 410;
  readonly SLIDER_SFX_TRACK_Y = 503;
  readonly MENU_BTN_CX = CONST.CANVAS_WIDTH / 2;
  readonly MENU_BTN_W = 200;
  readonly MENU_BTN_H = 50;
  readonly MENU_BTN_FIRST_Y = 415;
  readonly MENU_BTN_GAP = 50;
  readonly MENU_START_BUTTON = mkBtn(CONST.CANVAS_WIDTH / 2, 415, 200, 50);
  readonly MENU_LOADOUT_BUTTON = mkBtn(CONST.CANVAS_WIDTH / 2, 465, 200, 50);
  readonly MENU_OPTIONS_BUTTON = mkBtn(CONST.CANVAS_WIDTH / 2, 515, 200, 50);
  readonly MENU_TERRAIN_TOOL_BUTTON = mkBtn(CONST.CANVAS_WIDTH / 2, 565, 200, 50);
  readonly MENU_TOOLS_BUTTON = mkBtn(CONST.CANVAS_WIDTH / 2, 615, 200, 50);

  constructor(
    private readonly rc: MonkeysRenderContext,
    private readonly audioService: MonkeysAudioService,
    private readonly bg: MonkeysBackgroundRenderer,
  ) {}

  // ─── Public draw methods ──────────────────────────────────────────────────

  drawLoadingScreen(loadingContext: 'menu' | 'game'): void {
    const { ctx, spriteService } = this.rc;
    const cx = CONST.CANVAS_WIDTH / 2;
    const cy = CONST.CANVAS_HEIGHT / 2;
    const barW = 400;
    const barH = 24;
    const barX = cx - barW / 2;
    const barY = cy + 20;
    const progress = spriteService.loadProgress;
    const isGameLoad = loadingContext === 'game';

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, CONST.CANVAS_WIDTH, CONST.CANVAS_HEIGHT);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 36px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(isGameLoad ? 'Loading Game' : 'Monkeys', cx, cy - 40);

    ctx.font = '18px Arial';
    ctx.fillStyle = '#AAAAAA';
    ctx.fillText(spriteService.loadLabel, cx, cy - 10);

    ctx.fillStyle = '#333355';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, barH, barH / 2);
    ctx.fill();

    ctx.fillStyle = isGameLoad ? '#4A90E2' : '#4CAF50';
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW * Math.max(0.02, progress), barH, barH / 2);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '14px Arial';
    ctx.fillText(`${Math.round(progress * 100)}%`, cx, barY + barH + 20);
  }

  drawMuteButton(): void {
    const { ctx } = this.rc;
    const { x, y, width, height } = this.MUTE_BUTTON;
    const left = x - width / 2;
    const top = y - height / 2;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#111122';
    ctx.beginPath();
    ctx.roundRect(left, top, width, height, 6);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.font = '14px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.audioService.isMuted ? '\uD83D\uDD07' : '\uD83D\uDD0A', x, y);
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  drawMenu(terrainToolEnabled: boolean, devMode: boolean): void {
    const { ctx } = this.rc;
    ctx.fillStyle = CONST.SKY_COLOR;
    ctx.fillRect(0, 0, CONST.CANVAS_WIDTH, CONST.CANVAS_HEIGHT);
    this.bg.drawParallaxBackground(0);

    if (this.menuTitleAnim.animStart === 0)
      this.initBouncingLetterAnim(this.menuTitleAnim, this.MT_LETTERS.length);
    this.updateBouncingLetterAnim(this.menuTitleAnim);
    this.drawBouncingLetterAnim(this.menuTitleAnim, this.MT_LETTERS, '#FF6622');

    this.drawSpriteTextCentered('Inspired By', 165, 32);
    this.drawSpriteTextCentered('GORILLAS Gunbound WORMS', 207, 32);

    this.drawMenuMonkey();

    const devBtnCount = (terrainToolEnabled ? 1 : 0) + (devMode ? 1 : 0);
    this.drawNineSlicePanel('panel_wood_3_nail', 460, 350, 280, 230 + devBtnCount * 50);

    this.drawButton('Start Game', this.MENU_START_BUTTON, '#4CAF50', '#45a049', 'panel_wood_1');
    this.drawButton('Loadout', this.MENU_LOADOUT_BUTTON, '#E67C22', '#D35400', 'panel_wood_1');
    this.drawButton('Options', this.MENU_OPTIONS_BUTTON, '#2196F3', '#1976D2', 'panel_wood_1');
    if (terrainToolEnabled) {
      this.drawButton(
        'Terrain Tool',
        this.MENU_TERRAIN_TOOL_BUTTON,
        '#9C6ADE',
        '#7C4DCC',
        'panel_wood_1',
      );
    }
    if (devMode) {
      this.drawButton('Layer Tool', this.MENU_TOOLS_BUTTON, '#E91E63', '#C2185B', 'panel_wood_1');
    }
  }

  drawOptions(): void {
    const { ctx, gameService } = this.rc;
    ctx.fillStyle = CONST.SKY_COLOR;
    ctx.fillRect(0, 0, CONST.CANVAS_WIDTH, CONST.CANVAS_HEIGHT);
    this.bg.drawParallaxBackground(0);

    this.drawNineSlicePanel('panel_wood_3_nail', 280, 60, 640, 578);
    this.drawSpriteTextCentered('Options', 80, 48);
    this.drawSpriteTextCentered('Difficulty', 185, 36);

    const diff = gameService.difficulty;
    const easyActive = diff === 'easy',
      normalActive = diff === 'normal',
      hardActive = diff === 'hard';

    this.drawButton(
      'Easy',
      this.OPTIONS_DIFFICULTY_EASY_BUTTON,
      easyActive ? '#66BB6A' : '#388E3C',
      easyActive ? '#81C784' : '#2E7D32',
      easyActive ? 'panel_wood_1' : 'panel_brown_2_dark',
    );
    this.drawButton(
      'Normal',
      this.OPTIONS_DIFFICULTY_NORMAL_BUTTON,
      normalActive ? '#29B6F6' : '#0288D1',
      normalActive ? '#4FC3F7' : '#01579B',
      normalActive ? 'panel_wood_1' : 'panel_brown_2_dark',
    );
    this.drawButton(
      'Hard',
      this.OPTIONS_DIFFICULTY_HARD_BUTTON,
      hardActive ? '#EF5350' : '#C62828',
      hardActive ? '#E57373' : '#B71C1C',
      hardActive ? 'panel_wood_1' : 'panel_brown_2_dark',
    );
    this.drawButton('Back to Menu', this.OPTIONS_BACK_BUTTON, '#FF9800', '#F57C00', 'panel_wood_1');

    this.drawSpriteTextCentered('Volume', 342, 28);
    this.drawVolumeSlider('Background', this.audioService.bgVolume, this.SLIDER_BG_TRACK_Y);
    this.drawVolumeSlider('Effects', this.audioService.sfxVolume, this.SLIDER_SFX_TRACK_Y);
  }

  drawEquipmentMenu(): void {
    const { ctx, gameService, spriteService } = this.rc;
    ctx.fillStyle = CONST.SKY_COLOR;
    ctx.fillRect(0, 0, CONST.CANVAS_WIDTH, CONST.CANVAS_HEIGHT);
    this.bg.drawParallaxBackground(0);

    ctx.fillStyle = 'rgba(20, 8, 2, 0.82)';
    ctx.fillRect(0, 0, CONST.CANVAS_WIDTH, CONST.CANVAS_HEIGHT);

    this.drawSpriteTextCentered('Loadout', 18, 34);

    const panelY = 68,
      panelH = 634;
    for (const [px, pw] of [
      [18, 366],
      [400, 400],
      [816, 366],
    ] as [number, number][]) {
      this.drawNineSlicePanel('panel_wood_3_nail', px, panelY, pw, panelH);
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const lCx = 18 + 183;
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Name', lCx, 100);

    const nameBoxX = 38,
      nameBoxY = 114,
      nameBoxW = 325,
      nameBoxH = 34;
    ctx.strokeStyle = this.isNameEditing ? '#FFD700' : 'rgba(120,72,30,0.7)';
    ctx.lineWidth = this.isNameEditing ? 2 : 1;
    ctx.fillStyle = 'rgba(25, 10, 4, 0.85)';
    ctx.fillRect(nameBoxX, nameBoxY, nameBoxW, nameBoxH);
    ctx.strokeRect(nameBoxX, nameBoxY, nameBoxW, nameBoxH);

    const displayName = gameService.playerName;
    const cursorVisible =
      this.isNameEditing &&
      performance.now() % this.CURSOR_BLINK_PERIOD_MS < this.CURSOR_ON_DURATION_MS;
    ctx.fillStyle = '#F5DEB3';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(displayName + (cursorVisible ? '|' : ''), nameBoxX + 10, nameBoxY + nameBoxH / 2);

    if (!this.isNameEditing) {
      ctx.fillStyle = 'rgba(200,170,120,0.6)';
      ctx.font = '13px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Click to edit name', lCx, 162);
    }

    const selVehicleName =
      CONST.SELECTABLE_VEHICLES[gameService.selectedVehicleIndex]?.vehicle.name ?? 'Vehicle';
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(selVehicleName, lCx, 188);

    this.drawVehicleGrid(18, lCx);

    const mLeft = 400,
      mRight = 800,
      mCx = (mLeft + mRight) / 2;
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Equipment', mCx, 102);

    const equipSheet = spriteService.getSpritesheet(spriteService.EQUIPMENT_SPRITESHEET);
    const spriteSize = 32;
    const slotBoxX = 416,
      slotBoxW = 368,
      slotBoxH = 50,
      slotGap = 6,
      slotStartY = 115;

    for (let si = 0; si < this.EQUIPMENT_SLOTS.length; si++) {
      const slot = this.EQUIPMENT_SLOTS[si];
      const rowY = slotStartY + si * (slotBoxH + slotGap);
      const isExpanded = this.expandedSlot === slot;
      const selItem = this.getLoadoutItem(slot);
      const isNone = !selItem || selItem.id?.startsWith('none_');
      const hasSprite =
        !isNone && selItem?.spriteCol !== undefined && selItem?.spriteRow !== undefined;

      if (isExpanded)
        this.drawNineSlicePanel('panel_brown_2_3d', slotBoxX, rowY, slotBoxW, slotBoxH);
      else this.drawNineSlicePanel('panel_wood_2_nail', slotBoxX, rowY, slotBoxW, slotBoxH);

      const iconPad = 5,
        iconBoxSize = slotBoxH - iconPad * 2;
      const iconX = slotBoxX + iconPad,
        iconY = rowY + iconPad;
      ctx.fillStyle = hasSprite ? 'rgba(30,14,4,0.7)' : 'rgba(20,10,2,0.45)';
      ctx.strokeStyle = hasSprite ? '#6B3A1F' : '#4A2A10';
      ctx.lineWidth = 1;
      ctx.fillRect(iconX, iconY, iconBoxSize, iconBoxSize);
      ctx.strokeRect(iconX, iconY, iconBoxSize, iconBoxSize);
      if (hasSprite && equipSheet) {
        const sx = selItem!.spriteCol! * spriteSize,
          sy = selItem!.spriteRow! * spriteSize;
        const pad = 3;
        ctx.drawImage(
          equipSheet,
          sx,
          sy,
          spriteSize,
          spriteSize,
          iconX + pad,
          iconY + pad,
          iconBoxSize - pad * 2,
          iconBoxSize - pad * 2,
        );
      }

      const textX = slotBoxX + slotBoxH + 4;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#C8A06A';
      ctx.font = '12px Arial';
      ctx.fillText(this.SLOT_LABELS[slot], textX, rowY - slotBoxH);
      ctx.fillStyle = isNone ? '#8B6347' : isExpanded ? '#FFE880' : '#F5DEB3';
      ctx.font = isNone ? '14px Arial' : 'bold 15px Arial';
      ctx.fillText(selItem?.name ?? 'None', textX, rowY + slotBoxH * 0.55);
    }

    if (this.expandedSlot !== null) {
      const slot = this.expandedSlot;
      const items = gameService.getItemsForSlot(slot);
      const pickerY = slotStartY + this.EQUIPMENT_SLOTS.length * (slotBoxH + slotGap) - slotGap + 8;

      ctx.strokeStyle = 'rgba(160,82,45,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(mLeft + 16, pickerY - 4);
      ctx.lineTo(mRight - 16, pickerY - 4);
      ctx.stroke();

      ctx.fillStyle = '#DEC68A';
      ctx.font = 'bold 14px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`Select ${this.SLOT_LABELS[slot]}`, mCx, pickerY + 11);

      const CELL_W = 72,
        CELL_GAP = 12,
        NAME_H = 14,
        ROW_GAP = 12,
        CELLS_PER_ROW = 3;
      const totalPickerW = CELLS_PER_ROW * CELL_W + (CELLS_PER_ROW - 1) * CELL_GAP;
      const pickerStartX = Math.round(mCx - totalPickerW / 2);
      const iconStartY = pickerY + 26;

      for (let ii = 0; ii < items.length; ii++) {
        const item = items[ii];
        const col = ii % CELLS_PER_ROW,
          row = Math.floor(ii / CELLS_PER_ROW);
        const cx = pickerStartX + col * (CELL_W + CELL_GAP);
        const cy = iconStartY + row * (CELL_W + NAME_H + ROW_GAP);
        const isSelected = this.getLoadoutItem(slot)?.id === item.id;
        const isNoneItem = item.id.startsWith('none_');
        const hasSprite2 =
          !isNoneItem && item.spriteCol !== undefined && item.spriteRow !== undefined;

        if (isSelected) this.drawNineSlicePanel('panel_brown_2_3d', cx, cy, CELL_W, CELL_W);
        else this.drawNineSlicePanel('panel_wood_1', cx, cy, CELL_W, CELL_W);

        if (hasSprite2 && equipSheet) {
          const sx = item.spriteCol! * spriteSize,
            sy = item.spriteRow! * spriteSize;
          const pad = 8;
          ctx.drawImage(
            equipSheet,
            sx,
            sy,
            spriteSize,
            spriteSize,
            cx + pad,
            cy + pad,
            CELL_W - pad * 2,
            CELL_W - pad * 2,
          );
        } else {
          ctx.fillStyle = '#334455';
          ctx.font = '18px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('—', cx + CELL_W / 2, cy + CELL_W / 2);
        }

        ctx.fillStyle = isSelected ? '#FFE880' : '#C8A06A';
        ctx.font = '11px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const shortName = item.name.length > 10 ? item.name.substring(0, 9) + '\u2026' : item.name;
        ctx.fillText(shortName, cx + CELL_W / 2, cy + CELL_W + NAME_H / 2);
      }
    }

    const rLeft = 816,
      rRight = 1182,
      rCx = (rLeft + rRight) / 2;
    const base =
      CONST.SELECTABLE_VEHICLES[gameService.selectedVehicleIndex]?.vehicle ?? CONST.PLAYER_VEHICLE;

    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Stats', rCx, 102);

    const statDefs: { label: string; base: number; bonus: number }[] = [
      { label: 'Health', base: base.health, bonus: this.getTotalEquipBonus('health') },
      { label: 'Armor', base: 0, bonus: this.getTotalEquipBonus('armor') },
      { label: 'Attack', base: base.attack ?? 100, bonus: this.getTotalEquipBonus('attack') },
      {
        label: 'Blast Rad',
        base: base.bullet.explosionRadius,
        bonus: this.getTotalEquipBonus('blastRadius'),
      },
      { label: 'Fuel', base: base.fuel, bonus: this.getTotalEquipBonus('fuel') },
      { label: 'Climb Ang', base: base.climbAngle, bonus: this.getTotalEquipBonus('climbAngle') },
      { label: 'Min Aim', base: base.minAimAngle, bonus: this.getTotalEquipBonus('minAimAngle') },
      { label: 'Max Aim', base: base.maxAimAngle, bonus: this.getTotalEquipBonus('maxAimAngle') },
    ];
    const statStartY = 138,
      statStepY = 50;
    const statLabelX = rLeft + 21,
      statValueX = rRight - 21;
    const invertedStats = new Set(['minAimAngle']);

    for (let ri = 0; ri < statDefs.length; ri++) {
      const { label, base: bv, bonus } = statDefs[ri];
      const rowY = statStartY + ri * statStepY;
      ctx.fillStyle = '#C8A06A';
      ctx.font = '15px Arial';
      ctx.textAlign = 'left';
      ctx.fillText(label, statLabelX, rowY);

      const baseStr = String(bv);
      const bonusStr = bonus !== 0 ? (bonus > 0 ? `+${bonus}` : String(bonus)) : '';
      const statKey = [
        'health',
        'armor',
        'attack',
        'blastRadius',
        'fuel',
        'climbAngle',
        'minAimAngle',
        'maxAimAngle',
      ][ri];
      const inverted = invertedStats.has(statKey);

      ctx.textAlign = 'right';
      if (bonus !== 0) {
        const isGood = inverted ? bonus < 0 : bonus > 0;
        ctx.fillStyle = isGood ? '#55EE77' : '#FF6655';
        ctx.fillText(bonusStr, statValueX, rowY);
        const bonusWidth = ctx.measureText(bonusStr).width + 6;
        ctx.fillStyle = '#F5DEB3';
        ctx.fillText(baseStr, statValueX - bonusWidth, rowY);
      } else {
        ctx.fillStyle = '#F5DEB3';
        ctx.fillText(baseStr, statValueX, rowY);
      }
    }

    const setBonusDivY = statStartY + statDefs.length * statStepY + 12;
    ctx.strokeStyle = 'rgba(140,80,30,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rLeft + 16, setBonusDivY);
    ctx.lineTo(rRight - 16, setBonusDivY);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#C8A06A';
    ctx.font = 'bold 12px Arial';
    ctx.fillText('SET BONUS', rCx, setBonusDivY + 18);

    const setInfo = this.getPreviewSetInfo();
    const isFullSet = setInfo?.count === this.EQUIPMENT_SLOTS.length;
    const setCountY = setBonusDivY + 40;
    if (setInfo) {
      const setName =
        gameService.equipmentSets.find((s) => s.id === setInfo.setId)?.name ?? setInfo.setId;
      ctx.fillStyle = isFullSet ? '#55EE77' : '#8B6347';
      ctx.font = 'bold 14px Arial';
      ctx.fillText(`${setInfo.count} / ${this.EQUIPMENT_SLOTS.length}  ${setName}`, rCx, setCountY);
      const bonusLines = this.getPreviewSetBonusLines(setInfo.setId);
      ctx.font = '13px Arial';
      if (!isFullSet) ctx.globalAlpha = 0.4;
      for (let li = 0; li < bonusLines.length; li++) {
        ctx.fillStyle = isFullSet ? '#55EE77' : '#C8A06A';
        ctx.fillText(bonusLines[li], rCx, setCountY + 24 + li * 22);
      }
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = '#8B6347';
      ctx.font = '14px Arial';
      ctx.fillText('—', rCx, setCountY);
    }

    this.drawButton('Back', this.EQUIP_BACK_BUTTON, '#445', '#667', 'panel_wood_1');
  }

  drawUI(turnMessage: string, messageTimer: number): void {
    const { ctx, gameService } = this.rc;
    const state = gameService.currentState;

    if (state === GameState.PLAYING || state === GameState.PAUSED) {
      const now = this.rc.renderTime;
      const remaining = Math.max(0, Math.floor(45 - (now - gameService.turnStartTime) / 1000));
      this.drawArenaNumber(String(remaining), CONST.CANVAS_WIDTH - 20, 8, 64);
    }
    if (
      state === GameState.PLAYING ||
      state === GameState.AFTERMATH ||
      state === GameState.PAUSED ||
      state === GameState.SETUP
    ) {
      this.drawWindIndicator();
      this.drawWeaponButtonsFromService();
    }

    if (turnMessage) {
      const FADE = 500;
      const alpha =
        messageTimer > 1000
          ? (1500 - messageTimer) / FADE
          : messageTimer > FADE
            ? 1
            : messageTimer / FADE;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      this.drawSpriteTextCentered(turnMessage, CONST.CANVAS_HEIGHT / 3 - 54, 70, 0.42);
      ctx.restore();
    }

    if (state === GameState.PAUSED) {
      this.drawSpriteTextCentered('Paused', CONST.CANVAS_HEIGHT / 3 - 35, 70, 0.42);
    } else if (
      state === GameState.GAME_OVER_DELAY ||
      state === GameState.GAME_OVER ||
      state === GameState.WIN_DELAY ||
      state === GameState.WIN
    ) {
      const isWin = state === GameState.WIN_DELAY || state === GameState.WIN;
      if (this.gameOverAnim.animStart === 0) {
        this.initBouncingLetterAnim(
          this.gameOverAnim,
          isWin ? this.WIN_LETTERS.length : this.GO_LETTERS.length,
        );
      }
      this.updateBouncingLetterAnim(this.gameOverAnim);
      this.drawBouncingLetterAnim(
        this.gameOverAnim,
        isWin ? this.WIN_LETTERS : this.GO_LETTERS,
        isWin ? this.WIN_TEXT_TINT : undefined,
      );

      if (state === GameState.GAME_OVER || state === GameState.WIN) {
        this.drawSpriteTextCentered(
          'Press R to return',
          CONST.CANVAS_HEIGHT / 3 + this.gameOverAnim.cfg.letterSize / 2 + 16,
          28,
        );
      }
    }
  }

  drawTurnQueue(): void {
    const { ctx, gameService } = this.rc;
    const queue = [...gameService.turnQueue].sort((a, b) => a.entity.delay - b.entity.delay);
    if (queue.length === 0) return;

    const CHAR_SIZE = 24,
      ADVANCE = CHAR_SIZE * 0.55,
      ROW_H = CHAR_SIZE + 7,
      PAD = 30;
    const PANEL_W = 250,
      PANEL_H = queue.length * ROW_H + PAD * 2;
    this.drawNineSlicePanel('panel_wood_3_nail', 10, 10, PANEL_W, PANEL_H);

    const currentEntity = gameService.getCurrentTurnEntity();
    queue.forEach((turnEntity, index) => {
      const topY = 10 + PAD + index * ROW_H;
      const isCurrent = turnEntity.id === currentEntity?.id;
      const tint = isCurrent
        ? CONST.TURN_QUEUE_CURRENT_COLOR
        : turnEntity.type === 'player'
          ? CONST.TURN_QUEUE_PLAYER_COLOR
          : CONST.TURN_QUEUE_ENEMY_COLOR;

      const rawName =
        turnEntity.type === 'player'
          ? gameService.playerName
          : `Enemy ${Number(turnEntity.id.split('_')[1]) + 1}`;
      const timeStr = isCurrent ? '0' : String(Math.round(turnEntity.entity.delay));

      this.drawSpriteChars(
        rawName,
        TEXT_CHAR_TO_SPRITE,
        10 + PAD,
        topY,
        CHAR_SIZE,
        ADVANCE,
        tint,
        true,
      );
      const timeWidth = timeStr.length * ADVANCE;
      const timeX = 10 + PANEL_W - PAD - timeWidth;
      this.drawSpriteChars(
        timeStr,
        TEXT_CHAR_TO_SPRITE,
        timeX,
        topY,
        CHAR_SIZE,
        ADVANCE,
        tint,
        true,
      );
    });
  }

  drawCombatLog(): void {
    const { ctx, gameService } = this.rc;
    const CHAR_SIZE = 17,
      ADVANCE = CHAR_SIZE * 0.53,
      ROW_H = CHAR_SIZE + 9;
    const PAD_X = 20,
      PAD_Y = 20,
      MAX_ROWS = 6,
      PANEL_W = 380,
      BTN_W = 28,
      BTN_H = 20;
    const PANEL_X = 10,
      BOTTOM_Y = CONST.CANVAS_HEIGHT - 10;

    const log = gameService.combatLog.slice(-MAX_ROWS);
    const btnCX = PANEL_X + PANEL_W - BTN_W / 2 - 4;
    const btnCY = BOTTOM_Y - BTN_H / 2 - 4;
    this.combatLogToggleBtn = mkBtn(btnCX, btnCY, BTN_W, BTN_H);

    if (this.combatLogMinimized) {
      const MINI_H = BTN_H + 8;
      this.drawNineSlicePanel('panel_wood_2_nail', PANEL_X, BOTTOM_Y - MINI_H, PANEL_W, MINI_H);
    } else {
      const rowCount = Math.max(1, log.length);
      const PANEL_H = rowCount * ROW_H + PAD_Y * 2;
      const PANEL_Y = BOTTOM_Y - PANEL_H;
      this.drawNineSlicePanel('panel_wood_2_nail', PANEL_X, PANEL_Y, PANEL_W, PANEL_H);

      for (let i = 0; i < log.length; i++) {
        const entry = log[i];
        const rowTopY = PANEL_Y + PAD_Y + i * ROW_H;
        let text: string, tint: string;

        if (entry.type === 'fall') {
          text = entry.attackerName
            ? `${entry.targetName}: pushed off cliff`
            : `${entry.targetName}: fell off map`;
          tint = entry.attackerName ? '#FF8844' : '#AAAAAA';
        } else if (entry.type === 'miss') {
          text = `${entry.attackerName}: missed!`;
          tint = '#AAAAAA';
        } else if (entry.type === 'pass') {
          text = `${entry.attackerName}: passed their turn`;
          tint = '#AAAAFF';
        } else if (entry.type === 'timeout') {
          text = `${entry.attackerName}: timed out`;
          tint = '#FFAA44';
        } else {
          const weapon = entry.weaponName.replace(/_/g, ' ');
          text = `${entry.attackerName}: ${entry.totalDamage} > ${entry.targetName} (${weapon})`;
          tint = entry.wasFatal ? '#FF4444' : '#EEEEEE';
        }
        this.drawSpriteChars(
          text,
          TEXT_CHAR_TO_SPRITE,
          PANEL_X + PAD_X,
          rowTopY,
          CHAR_SIZE,
          ADVANCE,
          tint,
          true,
        );
      }
    }

    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(btnCX - BTN_W / 2, btnCY - BTN_H / 2, BTN_W, BTN_H);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(btnCX - BTN_W / 2, btnCY - BTN_H / 2, BTN_W, BTN_H);
    ctx.fillStyle = '#EEEEEE';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.combatLogMinimized ? '+' : '\u2212', btnCX, btnCY);
    ctx.textBaseline = 'alphabetic';
  }

  drawWeaponButtons(bullets: any[]): void {
    const { ctx, spriteService } = this.rc;
    for (let i = 0; i < bullets.length; i++) {
      const btn = this.getWeaponBtnRect(i, bullets.length);
      const left = btn.x - btn.width / 2,
        top = btn.y - btn.height / 2;
      const panelName =
        i === this.selectedBulletIndex ? 'panel_brown_light_3d' : 'panel_brown_1_dark';
      this.drawNineSlicePanel(panelName, left, top, btn.width, btn.height);

      const iconSize = 80;
      const spriteName = bullets[i].heldItemSprite ?? bullets[i].bulletSprite;
      const sprite = spriteName ? spriteService.getSprite(spriteName) : null;
      if (sprite) {
        ctx.drawImage(
          sprite.image,
          sprite.x,
          sprite.y,
          sprite.width,
          sprite.height,
          btn.x - iconSize / 2,
          btn.y - iconSize / 2 + 4,
          iconSize,
          iconSize,
        );
      }
    }
  }

  getWeaponBtnRect(
    index: number,
    count: number,
  ): { x: number; y: number; width: number; height: number } {
    const size = this.WEAPON_BTN_SIZE,
      gap = this.WEAPON_BTN_GAP,
      margin = this.WEAPON_BTN_MARGIN;
    const rightEdge = CONST.CANVAS_WIDTH - margin;
    const cx = rightEdge - size / 2 - (count - 1 - index) * (size + gap);
    const cy = CONST.CANVAS_HEIGHT - margin - size / 2;
    return { x: cx, y: cy, width: size, height: size };
  }

  resetGameOverAnim(): void {
    this.gameOverAnim.animStart = 0;
  }

  // ─── Loadout helpers (public, accessed by component for click handlers) ───

  initLoadoutScreen(): void {
    const { gameService } = this.rc;
    for (const slot of this.EQUIPMENT_SLOTS) {
      const items = gameService.getItemsForSlot(slot);
      const equippedId = gameService.equipped[slot]?.id ?? null;
      const idx = items.findIndex((i) => i.id === equippedId);
      this.loadoutSlotIndices[slot] = idx >= 0 ? idx : 0;
    }
    this.isNameEditing = false;
    this.expandedSlot = null;
  }

  handleEquipmentMenuClick(x: number, y: number): void {
    const { gameService } = this.rc;
    if (isPointInsideButton(x, y, this.EQUIP_BACK_BUTTON)) {
      gameService.saveLoadout();
      gameService.currentState = GameState.MENU;
      this.isNameEditing = false;
      return;
    }
    const nameBoxX = 38,
      nameBoxY = 114,
      nameBoxW = 332,
      nameBoxH = 34;
    if (x >= nameBoxX && x <= nameBoxX + nameBoxW && y >= nameBoxY && y <= nameBoxY + nameBoxH) {
      this.isNameEditing = true;
      return;
    }
    this.isNameEditing = false;

    // Vehicle grid
    {
      const cellBoxW = 74,
        cellBoxH = 74,
        gapX = 10,
        rowGap = 14,
        nameH = 16;
      const totalW = 4 * cellBoxW + 3 * gapX;
      const lCx = 18 + 183;
      const startX = Math.round(lCx - totalW / 2);
      const gridStartY = 390;
      const rowStride = cellBoxH + nameH + rowGap;
      for (let i = 0; i < CONST.SELECTABLE_VEHICLES.length; i++) {
        const col = i % 4,
          row = Math.floor(i / 4);
        const bx = startX + col * (cellBoxW + gapX),
          by = gridStartY + row * rowStride;
        if (x >= bx && x <= bx + cellBoxW && y >= by && y <= by + cellBoxH) {
          if (!CONST.SELECTABLE_VEHICLES[i].locked) gameService.selectedVehicleIndex = i;
          return;
        }
      }
    }

    const slotBoxX = 416,
      slotBoxW = 368,
      slotBoxH = 50,
      slotGap = 6,
      slotStartY = 115;
    for (let si = 0; si < this.EQUIPMENT_SLOTS.length; si++) {
      const slot = this.EQUIPMENT_SLOTS[si];
      const rowY = slotStartY + si * (slotBoxH + slotGap);
      if (x >= slotBoxX && x <= slotBoxX + slotBoxW && y >= rowY && y <= rowY + slotBoxH) {
        this.expandedSlot = this.expandedSlot === slot ? null : slot;
        return;
      }
    }

    if (this.expandedSlot !== null) {
      const slot = this.expandedSlot;
      const items = gameService.getItemsForSlot(slot);
      const pickerY = slotStartY + this.EQUIPMENT_SLOTS.length * (slotBoxH + slotGap) - slotGap + 8;
      const CELL_W = 72,
        CELL_GAP = 12,
        NAME_H = 14,
        ROW_GAP = 12,
        CELLS_PER_ROW = 3;
      const totalPickerW = CELLS_PER_ROW * CELL_W + (CELLS_PER_ROW - 1) * CELL_GAP;
      const pickerStartX = Math.round((400 + 800) / 2 - totalPickerW / 2);
      const iconStartY = pickerY + 26;
      for (let ii = 0; ii < items.length; ii++) {
        const item = items[ii];
        const col = ii % CELLS_PER_ROW,
          row = Math.floor(ii / CELLS_PER_ROW);
        const cx = pickerStartX + col * (CELL_W + CELL_GAP),
          cy = iconStartY + row * (CELL_W + NAME_H + ROW_GAP);
        if (x >= cx && x <= cx + CELL_W && y >= cy && y <= cy + CELL_W + NAME_H) {
          this.loadoutSlotIndices[slot] = ii;
          gameService.equipped[slot] = item.id.startsWith('none_') ? null : item;
          this.expandedSlot = null;
          gameService.saveLoadout();
          return;
        }
      }
    }
  }

  // ─── Shared drawing utilities (public for use by other renderers) ─────────

  drawSpriteTextCentered(text: string, topY: number, size: number, advanceRatio = 0.55): void {
    const { ctx, spriteService, tintCache } = this.rc;
    drawSpriteTextCentered(
      ctx,
      spriteService,
      tintCache,
      CONST.CANVAS_WIDTH,
      text,
      topY,
      size,
      advanceRatio,
    );
  }

  drawSpriteChars(
    text: string,
    map: Record<string, string>,
    startX: number,
    topY: number,
    size: number,
    advance: number,
    tint?: string,
    plainFallback = false,
  ): void {
    const { ctx, spriteService, tintCache } = this.rc;
    drawSpriteChars(
      ctx,
      spriteService,
      tintCache,
      text,
      map,
      startX,
      topY,
      size,
      advance,
      tint,
      plainFallback,
    );
  }

  drawNineSlicePanel(
    panelName: string,
    destX: number,
    destY: number,
    destW: number,
    destH: number,
  ): void {
    const { ctx, spriteService } = this.rc;
    const panel = spriteService.getPanel(panelName);
    if (!panel) return;
    const sheet = spriteService.getSpritesheet(panel.spritesheet);
    if (!sheet) return;
    const s = panel.sectionSize,
      px = panel.x,
      py = panel.y;
    // prettier-ignore
    const slices: [number, number, number, number, number, number, number, number][] = [
      [px,       py,       s, s, destX,              destY,              s,             s           ],
      [px + s,   py,       s, s, destX + s,          destY,    destW - 2 * s,            s           ],
      [px + 2*s, py,       s, s, destX + destW - s,  destY,              s,              s           ],
      [px,       py + s,   s, s, destX,              destY + s,          s,   destH - 2 * s          ],
      [px + s,   py + s,   s, s, destX + s,          destY + s, destW - 2 * s, destH - 2 * s        ],
      [px + 2*s, py + s,   s, s, destX + destW - s,  destY + s,          s,   destH - 2 * s          ],
      [px,       py + 2*s, s, s, destX,              destY + destH - s,  s,              s           ],
      [px + s,   py + 2*s, s, s, destX + s,          destY + destH - s, destW - 2 * s,  s            ],
      [px + 2*s, py + 2*s, s, s, destX + destW - s,  destY + destH - s,  s,              s           ],
    ];
    for (const [sx, sy, sw, sh, dx, dy, dw, dh] of slices) {
      ctx.drawImage(sheet, sx, sy, sw, sh, dx, dy, dw, dh);
    }
  }

  drawButton(
    text: string,
    btn: { x: number; y: number; width: number; height: number },
    color: string,
    hoverColor: string,
    panelName?: string,
  ): void {
    const { ctx } = this.rc;
    const { x, y, width, height } = btn;
    const left = x - width / 2,
      top = y - height / 2;
    if (panelName) {
      this.drawNineSlicePanel(panelName, left, top, width, height);
    } else {
      ctx.fillStyle = color;
      ctx.fillRect(left, top, width, height);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(left, top, width, height);
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
    ctx.textBaseline = 'alphabetic';
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private drawMenuMonkey(): void {
    const { ctx, spriteService } = this.rc;
    const now = this.rc.renderTime;
    if (!this.menuMonkeyState) {
      this.menuMonkeyState = {
        startMs: now,
        fruitIndex: Math.floor(Math.random() * this.WEAPON_SPRITES.length),
      };
    }

    const FALL_DURATION = 1500,
      CX = 600,
      START_Y = -80,
      END_Y = 340,
      MONKEY_SCALE = 1;
    const elapsed = now - this.menuMonkeyState.startMs;
    const t = Math.min(1, elapsed / FALL_DURATION);
    const cy = START_Y + (END_Y - START_Y) * this.easeOutBounce(t);

    const fruitKey = this.WEAPON_SPRITES[this.menuMonkeyState.fruitIndex];
    const fruitToOverlay: Record<string, string> = {
      item_banana: 'overlay_banana',
      item_apple: 'overlay_apple',
      item_peanut: 'overlay_peanut',
    };
    const overlayKey = fruitToOverlay[fruitKey] ?? null;
    const layerOffsets = spriteService.getLayerOffsets(spriteService.LUPIN_COMPOSITE);
    const frameName = 'idle';
    const frameOffsets = layerOffsets?.frames[frameName];
    const fruitCfg = layerOffsets?.fruitConfig[fruitKey] ?? null;
    const fruitScale = fruitCfg?.scale ?? 1.0;
    const overlayZ = fruitCfg?.overlayZ ?? 3;

    const backSprite = spriteService.getEntitySprite(frameName, spriteService.LUPIN_COMPOSITE);
    const fruitSprite = spriteService.getSprite(fruitKey);
    const handSprite = spriteService.getEntitySprite('hand', spriteService.LUPIN_COMPOSITE);
    const overlaySprite = overlayKey ? spriteService.getSprite(overlayKey) : null;
    if (!backSprite) return;

    const spriteSize = CONST.TANK_BODY_RADIUS * 2 * 1.5;
    const spriteYOffset = -15;
    const drawLayer = (
      spr: { image: CanvasImageSource; x: number; y: number; width: number; height: number } | null,
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
    const drawOverlay = () => {
      if (!overlaySprite || frameOffsets?.hideLayers?.includes('overlay')) return;
      drawLayer(
        overlaySprite,
        spriteSize,
        frameOffsets?.overlay.x ?? 0,
        frameOffsets?.overlay.y ?? 0,
      );
    };

    ctx.save();
    ctx.translate(CX, cy);
    ctx.scale(-MONKEY_SCALE, MONKEY_SCALE);
    drawLayer(backSprite, spriteSize, 0, 0);
    if (overlayZ < 2) drawOverlay();
    if (fruitSprite && !frameOffsets?.hideLayers?.includes('fruit')) {
      const fruitSz = spriteSize * fruitScale;
      drawLayer(fruitSprite, fruitSz, frameOffsets?.fruit.x ?? 0, frameOffsets?.fruit.y ?? 0);
    }
    if (handSprite && !frameOffsets?.hideLayers?.includes('hand')) {
      drawLayer(handSprite, spriteSize, frameOffsets?.hand.x ?? 0, frameOffsets?.hand.y ?? 0);
    }
    if (overlayZ >= 2) drawOverlay();
    ctx.restore();
  }

  private drawVehicleGrid(panelLeft: number, panelCx: number): void {
    const { ctx, gameService, spriteService } = this.rc;
    const cellBoxW = 74,
      cellBoxH = 74,
      gapX = 10,
      rowGap = 14,
      nameH = 16;
    const totalW = 4 * cellBoxW + 3 * gapX;
    const startX = Math.round(panelCx - totalW / 2);
    const gridStartY = 390;
    const rowStride = cellBoxH + nameH + rowGap;

    const selEntry = CONST.SELECTABLE_VEHICLES[gameService.selectedVehicleIndex];
    const previewSize = 80,
      previewY = 204;
    const idleSprite = spriteService.getEntitySprite(
      'idle',
      selEntry?.vehicle?.spritesheet ?? spriteService.LUPIN_COMPOSITE,
    );
    if (idleSprite && !selEntry?.locked) {
      ctx.drawImage(
        idleSprite.image,
        idleSprite.x,
        idleSprite.y,
        idleSprite.width,
        idleSprite.height,
        panelCx - previewSize / 2,
        previewY,
        previewSize,
        previewSize,
      );
    }

    if (selEntry?.description) {
      ctx.fillStyle = 'rgba(200,170,120,0.75)';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const maxW = 320;
      const words = selEntry.description.split(' ');
      const lines: string[] = [];
      let current = '';
      for (const word of words) {
        const test = current ? `${current} ${word}` : word;
        if (ctx.measureText(test).width > maxW && current) {
          lines.push(current);
          current = word;
        } else current = test;
      }
      if (current) lines.push(current);
      const descY = previewY + previewSize + 10;
      lines.slice(0, 2).forEach((line, i) => ctx.fillText(line, panelCx, descY + i * 16));
    }

    ctx.fillStyle = '#DEC68A';
    ctx.font = '13px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Select Vehicle', panelCx, gridStartY - 14);

    for (let i = 0; i < CONST.SELECTABLE_VEHICLES.length; i++) {
      const col = i % 4,
        row = Math.floor(i / 4);
      const bx = startX + col * (cellBoxW + gapX),
        by = gridStartY + row * rowStride;
      const entry = CONST.SELECTABLE_VEHICLES[i];
      const isSelected = i === gameService.selectedVehicleIndex;
      const isLocked = entry.locked;

      if (isSelected) this.drawNineSlicePanel('panel_brown_2_3d', bx, by, cellBoxW, cellBoxH);
      else this.drawNineSlicePanel('panel_wood_1', bx, by, cellBoxW, cellBoxH);

      if (!isLocked) {
        const spr = spriteService.getEntitySprite(
          'idle',
          entry.vehicle?.spritesheet ?? spriteService.LUPIN_COMPOSITE,
        );
        if (spr) {
          const pad = 7;
          ctx.drawImage(
            spr.image,
            spr.x,
            spr.y,
            spr.width,
            spr.height,
            bx + pad,
            by + pad,
            cellBoxW - pad * 2,
            cellBoxH - pad * 2,
          );
        }
      } else {
        ctx.fillStyle = 'rgba(20,8,2,0.75)';
        ctx.fillRect(bx + 2, by + 2, cellBoxW - 4, cellBoxH - 4);
        ctx.fillStyle = 'rgba(120,70,30,0.8)';
        ctx.font = 'bold 26px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', bx + cellBoxW / 2, by + cellBoxH / 2);
      }

      ctx.font = isSelected ? 'bold 12px Arial' : '11px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isLocked ? 'rgba(100,70,40,0.7)' : isSelected ? '#FFE880' : '#C8A06A';
      ctx.fillText(entry.vehicle.name, bx + cellBoxW / 2, by + cellBoxH + 9);
    }
  }

  private drawVolumeSlider(label: string, value: number, trackY: number): void {
    const { ctx } = this.rc;
    const left = this.SLIDER_TRACK_LEFT,
      width = this.SLIDER_TRACK_WIDTH;
    const thumbX = left + value * width;
    const trackH = 6,
      thumbR = 12;

    this.drawSpriteTextCentered(label, trackY - 44, 22);

    ctx.fillStyle = '#444';
    ctx.beginPath();
    ctx.roundRect(left, trackY - trackH / 2, width, trackH, 3);
    ctx.fill();

    ctx.fillStyle = '#4FC3F7';
    ctx.beginPath();
    ctx.roundRect(left, trackY - trackH / 2, thumbX - left, trackH, 3);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(thumbX, trackY, thumbR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#CCCCCC';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(`${Math.round(value * 100)}%`, left + width + 14, trackY + 6);
  }

  private drawWindIndicator(): void {
    const { ctx, gameService, spriteService } = this.rc;
    const targetSpeed = gameService.windSpeed;
    const targetAngle = gameService.windAngle;
    const now = Date.now();
    const wa = this.windAnim;

    const targetFill = targetSpeed / 100;
    if (targetAngle !== wa.toAngle || targetFill !== wa.toFill) {
      wa.fromAngle = wa.displayAngle;
      wa.fromFill = wa.displayFill;
      wa.toAngle = targetAngle;
      wa.toFill = targetFill;
      wa.startTime = now;
    }

    const elapsed = now - wa.startTime;
    const t = wa.duration > 0 ? Math.min(1, elapsed / wa.duration) : 1;
    const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    let angleDiff = wa.toAngle - wa.fromAngle;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    wa.displayAngle = wa.fromAngle + angleDiff * ease;
    wa.displayFill = wa.fromFill + (wa.toFill - wa.fromFill) * ease;

    const cx = CONST.CANVAS_WIDTH / 2,
      arrowCy = 50,
      drawW = 90;
    const emptySprite = spriteService.getSprite('tank_arrowEmpty');
    const fullSprite = spriteService.getSprite('tank_arrowFull');
    if (!emptySprite) return;
    const drawH = Math.round((drawW * emptySprite.height) / emptySprite.width);

    ctx.save();
    ctx.translate(cx, arrowCy);
    if (wa.displayFill > 0) ctx.rotate(wa.displayAngle);

    ctx.drawImage(
      emptySprite.image,
      emptySprite.x,
      emptySprite.y,
      emptySprite.width,
      emptySprite.height,
      -drawW / 2,
      -drawH / 2,
      drawW,
      drawH,
    );

    if (fullSprite && wa.displayFill > 0) {
      const fillX = -drawW / 2 + drawW * wa.displayFill;
      const waveAmp = 3,
        waveFreq = 0.06,
        wavePhase = (now / 400) % (Math.PI * 2);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-drawW / 2, -drawH / 2);
      ctx.lineTo(fillX, -drawH / 2);
      const steps = 12;
      for (let i = 0; i <= steps; i++) {
        const fy = -drawH / 2 + (drawH * i) / steps;
        const wx = fillX + Math.sin(fy * waveFreq + wavePhase) * waveAmp;
        ctx.lineTo(wx, fy);
      }
      ctx.lineTo(-drawW / 2, drawH / 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(
        fullSprite.image,
        fullSprite.x,
        fullSprite.y,
        fullSprite.width,
        fullSprite.height,
        -drawW / 2,
        -drawH / 2,
        drawW,
        drawH,
      );
      ctx.restore();
    }
    ctx.restore();
  }

  private drawArenaNumber(text: string, rightX: number, topY: number, size: number): void {
    const { ctx, spriteService, tintCache } = this.rc;
    const advance = size * 0.6;
    drawSpriteChars(
      ctx,
      spriteService,
      tintCache,
      text,
      ARENA_CHAR_TO_SPRITE,
      rightX - text.length * advance,
      topY,
      size,
      advance,
      undefined,
      true,
    );
  }

  private drawWeaponButtonsFromService(): void {
    const bullets = this.rc.gameService.player?.vehicle?.bulletOptions ?? CONST.PLAYER_BULLETS;
    this.drawWeaponButtons(bullets);
  }

  // ─── Bouncing letter animation ────────────────────────────────────────────

  private initBouncingLetterAnim(anim: BouncingLetterAnimState, count: number): void {
    anim.letterY = Array(count).fill(-anim.cfg.letterSize);
    anim.letterVY = Array(count).fill(0);
    anim.animStart = performance.now();
    anim.animLastTs = anim.animStart;
  }

  private updateBouncingLetterAnim(anim: BouncingLetterAnimState): void {
    const { cfg } = anim;
    const now = performance.now();
    const dt = Math.min((now - anim.animLastTs) / 1000, 0.05);
    anim.animLastTs = now;
    const elapsed = now - anim.animStart;
    for (let i = 0; i < anim.letterY.length; i++) {
      if (elapsed - i * cfg.staggerMs <= 0) continue;
      const targetY = cfg.targetYFn(i);
      anim.letterVY[i] += cfg.gravity * dt;
      anim.letterY[i] += anim.letterVY[i] * dt;
      if (anim.letterY[i] >= targetY) {
        anim.letterY[i] = targetY;
        if (Math.abs(anim.letterVY[i]) > cfg.minBounceVY)
          anim.letterVY[i] = -anim.letterVY[i] * cfg.bounce;
        else anim.letterVY[i] = 0;
      }
    }
  }

  private drawBouncingLetterAnim(
    anim: BouncingLetterAnimState,
    letters: string[],
    tint?: string,
  ): void {
    const { ctx, spriteService, tintCache } = this.rc;
    const { cfg } = anim;
    const size = cfg.letterSize;
    const advance = size * cfg.advanceRatio;
    const totalWidth = (letters.length - 1) * advance + size;
    const startX = CONST.CANVAS_WIDTH / 2 - totalWidth / 2;
    const elapsed = performance.now() - anim.animStart;
    for (let i = 0; i < letters.length; i++) {
      if (elapsed - i * cfg.staggerMs <= 0) continue;
      const sprite = spriteService.getSprite(letters[i]);
      if (!sprite) continue;
      if (tint) {
        ctx.drawImage(
          tintedGlyph(sprite, size, tint, tintCache),
          startX + i * advance,
          anim.letterY[i],
        );
      } else {
        ctx.drawImage(
          sprite.image,
          sprite.x,
          sprite.y,
          sprite.width,
          sprite.height,
          startX + i * advance,
          anim.letterY[i],
          size,
          size,
        );
      }
    }
  }

  private easeOutBounce(t: number): number {
    const n1 = 7.5625,
      d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) {
      t -= 1.5 / d1;
      return n1 * t * t + 0.75;
    }
    if (t < 2.5 / d1) {
      t -= 2.25 / d1;
      return n1 * t * t + 0.9375;
    }
    t -= 2.625 / d1;
    return n1 * t * t + 0.984375;
  }

  // ─── Equipment loadout helpers ────────────────────────────────────────────

  private getLoadoutItem(slot: EquipmentSlot): EquipmentItem | null {
    const items = this.rc.gameService.getItemsForSlot(slot);
    if (items.length === 0) return null;
    return items[this.loadoutSlotIndices[slot]] ?? null;
  }

  private getTotalEquipBonus(stat: keyof EquipmentStats): number {
    let total = 0;
    for (const slot of this.EQUIPMENT_SLOTS) {
      const val = this.getLoadoutItem(slot)?.stats?.[stat];
      if (typeof val === 'number') total += val;
    }
    return total;
  }

  private getPreviewSetInfo(): { setId: string; count: number } | null {
    const counts = new Map<string, number>();
    for (const slot of this.EQUIPMENT_SLOTS) {
      const id = this.getLoadoutItem(slot)?.setId;
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    let best: { setId: string; count: number } | null = null;
    for (const [setId, count] of counts) {
      if (!best || count > best.count) best = { setId, count };
    }
    return best;
  }

  private getPreviewSetBonusLines(setId: string): string[] {
    const set = this.rc.gameService.equipmentSets.find((s) => s.id === setId);
    if (!set?.bonus) return [];
    const b = set.bonus;
    const lines: string[] = [];
    if (b.lifesteal) lines.push(`Lifesteal ${b.lifesteal}%`);
    if (b.shieldHealth) lines.push(`Shield ${b.shieldHealth} HP`);
    if (b.aimGuide) lines.push('Aim Guide');
    if (b.pushbackMultiplier !== undefined)
      lines.push(
        b.pushbackMultiplier === 0
          ? 'No Knockback'
          : b.pushbackMultiplier < 0
            ? `Vacuum ×${Math.abs(b.pushbackMultiplier)}`
            : `Knockback ×${b.pushbackMultiplier}`,
      );
    return lines;
  }
}

// ─── Module-level utilities ───────────────────────────────────────────────────

export function mkBtn(cx: number, cy: number, w: number, h: number) {
  return { x: cx, y: cy, width: w, height: h };
}

export function isPointInsideButton(
  x: number,
  y: number,
  button: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    x >= button.x - button.width / 2 &&
    x <= button.x + button.width / 2 &&
    y >= button.y - button.height / 2 &&
    y <= button.y + button.height / 2
  );
}
