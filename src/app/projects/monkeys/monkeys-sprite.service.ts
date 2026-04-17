import { Injectable } from '@angular/core';
import {
  BackgroundMetadataFile,
  BackgroundSpriteMetadata,
  LayerOffsetData,
  LayerOffsetsMap,
} from './monkeys.types';

export interface SpriteDefinition {
  name: string;
  spritesheet: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpriteData {
  image: HTMLImageElement | HTMLCanvasElement;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PanelDefinition {
  name: string;
  spritesheet: string;
  x: number;
  y: number;
  sectionSize: number;
}

interface SpriteMetadataFile {
  spritesheets: Record<string, string>;
  sprites: SpriteDefinition[];
  panels?: Array<{ name: string; spritesheet: string; x: number; y: number; sectionSize: number }>;
  emoteDefinitions?: Record<
    string,
    { frameCount: number; frameDurationMs: number; noFlip?: boolean }
  >;
}

@Injectable({
  providedIn: 'root',
})
export class MonkeysSpriteService {
  private readonly ASSET_BASE_PATH = 'resources/images/projects/monkeys/';
  private readonly METADATA_PATH = 'assets/monkeys/sprite-metadata.json';
  private readonly TERRAIN_METADATA_PATH = 'assets/monkeys/terrain-metadata.json';
  private readonly BACKGROUND_METADATA_PATH = 'assets/monkeys/background-metadata.json';
  private readonly LAYER_OFFSETS_PATH = 'assets/monkeys/layer-offsets.json';
  readonly TERRAIN_TOOL_SPRITESHEET = 'Dragon Road (Tiles).png';
  readonly BACKGROUND_TOOL_SPRITESHEET = 'Mushroom Shrine (Background).png';
  readonly INNER_TERRAIN_SPRITESHEET = 'InnerTerrain.png';
  private spritesheets: Map<string, HTMLImageElement | HTMLCanvasElement> = new Map();
  private sprites: Map<string, SpriteData> = new Map();
  private panelDefinitions: Map<string, PanelDefinition> = new Map();
  private loadedAssets: Map<string, boolean> = new Map();
  private spriteDefinitions: SpriteDefinition[] = [];
  private emoteDefinitions: Record<
    string,
    { frameCount: number; frameDurationMs: number; noFlip?: boolean }
  > = {};
  private metadataLoadPromise: Promise<void> | null = null;
  private backgroundMetadataPromise: Promise<BackgroundMetadataFile> | null = null;
  private backgroundMetadataCache: BackgroundMetadataFile | null = null;
  private layerOffsetsMap: LayerOffsetsMap = {};

  loadProgress = 0; // 0–1
  loadLabel = 'Loading...';

  constructor() {}

  async loadSprites(): Promise<void> {
    this.loadProgress = 0;
    this.loadLabel = 'Loading sprite metadata...';
    await this.ensureSpriteMetadataLoaded();

    const spritePaths = this.spriteDefinitions.map((def) => def.spritesheet);
    const panelPaths = Array.from(this.panelDefinitions.values()).map((p) => p.spritesheet);
    const spritesheetPaths = [...new Set([...spritePaths, ...panelPaths])];
    const total = spritesheetPaths.length;
    let done = 0;

    const loadPromises = spritesheetPaths.map(async (path) => {
      await this.loadSpritesheet(path);
      done++;
      this.loadProgress = done / total;
      this.loadLabel = `Loading sprites... (${done}/${total})`;
    });

    try {
      await Promise.all(loadPromises);
      await this.loadLayerOffsets();
      this.loadProgress = 1;
      this.loadLabel = 'Done';
      console.log('All sprites loaded successfully');
    } catch (error) {
      console.error('Failed to load some sprites:', error);
    }
  }

  async loadTerrainSpritesheet(): Promise<HTMLImageElement | HTMLCanvasElement> {
    this.loadProgress = 0;
    this.loadLabel = 'Loading terrain...';
    const result = await this.loadRawSpritesheet(this.TERRAIN_TOOL_SPRITESHEET);
    this.loadProgress = 1;
    this.loadLabel = 'Done';
    return result;
  }

  async loadInnerTerrainSpritesheet(): Promise<HTMLImageElement | HTMLCanvasElement> {
    return this.loadRawSpritesheet(this.INNER_TERRAIN_SPRITESHEET);
  }

  async loadBackgroundMetadata(): Promise<BackgroundMetadataFile> {
    if (this.backgroundMetadataCache) {
      return this.backgroundMetadataCache;
    }

    if (!this.backgroundMetadataPromise) {
      this.backgroundMetadataPromise = this.fetchBackgroundMetadata().catch((error) => {
        this.backgroundMetadataPromise = null;
        throw error;
      });
    }

    const metadata = await this.backgroundMetadataPromise;
    this.backgroundMetadataCache = metadata;
    return metadata;
  }

  getBackgroundSprites(): BackgroundSpriteMetadata[] {
    return this.backgroundMetadataCache?.sprites ?? [];
  }

  private async ensureSpriteMetadataLoaded(): Promise<void> {
    if (this.spriteDefinitions.length > 0) {
      return;
    }

    if (!this.metadataLoadPromise) {
      this.metadataLoadPromise = this.loadSpriteMetadata().catch((error) => {
        this.metadataLoadPromise = null;
        throw error;
      });
    }

    return this.metadataLoadPromise;
  }

  private async loadSpriteMetadata(): Promise<void> {
    const response = await fetch(this.METADATA_PATH);
    if (!response.ok) {
      throw new Error(`Failed to load sprite metadata from ${this.METADATA_PATH}`);
    }

    const metadata = (await response.json()) as SpriteMetadataFile;
    this.spriteDefinitions = metadata.sprites.map((definition) => ({
      ...definition,
      spritesheet: this.resolveSpritesheetPath(definition.spritesheet, metadata.spritesheets),
    }));
    for (const p of metadata.panels ?? []) {
      this.panelDefinitions.set(p.name, {
        ...p,
        spritesheet: this.resolveSpritesheetPath(p.spritesheet, metadata.spritesheets),
      });
    }
    this.emoteDefinitions = metadata.emoteDefinitions ?? {};
  }

  private resolveSpritesheetPath(
    spritesheetKey: string,
    spritesheets: Record<string, string>,
  ): string {
    const resolvedSpritesheet = spritesheets[spritesheetKey] ?? spritesheetKey;
    if (!resolvedSpritesheet) {
      throw new Error(`Unknown spritesheet reference: ${spritesheetKey}`);
    }

    return resolvedSpritesheet;
  }

  private async fetchBackgroundMetadata(): Promise<BackgroundMetadataFile> {
    const response = await fetch(this.BACKGROUND_METADATA_PATH);
    if (!response.ok) {
      throw new Error(`Failed to load background metadata from ${this.BACKGROUND_METADATA_PATH}`);
    }
    const metadata = (await response.json()) as BackgroundMetadataFile;
    metadata.sprites = [...metadata.sprites].sort((a, b) => a.z - b.z);
    return metadata;
  }

  private extractRegionId(name: string): number {
    const match = /terrain_region_(\d+)/.exec(name);
    if (!match) {
      return -1;
    }
    return Number.parseInt(match[1], 10);
  }

  async loadRawSpritesheet(path: string): Promise<HTMLImageElement | HTMLCanvasElement> {
    const existingSpritesheet = this.spritesheets.get(path);
    if (existingSpritesheet) {
      return existingSpritesheet;
    }

    await this.loadSpritesheet(path);
    const loadedSpritesheet = this.spritesheets.get(path);
    if (!loadedSpritesheet) {
      throw new Error(`Spritesheet was not available after load: ${path}`);
    }

    return loadedSpritesheet;
  }

  private async loadSpritesheet(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = async () => {
        console.log(
          `Spritesheet loaded: ${path}, complete: ${img.complete}, naturalWidth: ${img.naturalWidth}`,
        );
        if (img.decode) {
          await img.decode();
          console.log(`Spritesheet decoded: ${path}`);
        }
        // Create a canvas with the fully decoded image to ensure complete drawing
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx!.drawImage(img, 0, 0);
        this.spritesheets.set(path, canvas);
        this.loadedAssets.set(path, true);
        this.extractSpritesFromSheet(path);
        resolve();
      };
      img.onerror = () => {
        console.error(`Failed to load spritesheet: ${path}`);
        this.loadedAssets.set(path, false);
        reject(new Error(`Failed to load ${path}`));
      };
      img.src = `${this.ASSET_BASE_PATH}${path}`;
    });
  }

  private extractSpritesFromSheet(spritesheetPath: string): void {
    const spritesheet = this.spritesheets.get(spritesheetPath);
    if (!spritesheet) return;

    const relevantSprites = this.spriteDefinitions.filter(
      (def) => def.spritesheet === spritesheetPath,
    );

    for (const def of relevantSprites) {
      const data: SpriteData = {
        image: spritesheet,
        x: def.x,
        y: def.y,
        width: def.width,
        height: def.height,
      };
      this.sprites.set(def.name, data);
      this.sprites.set(`${spritesheetPath}:${def.name}`, data);
    }
  }

  private async loadLayerOffsets(): Promise<void> {
    try {
      const response = await fetch(this.LAYER_OFFSETS_PATH);
      if (!response.ok) {
        console.warn(`Layer offsets not found at ${this.LAYER_OFFSETS_PATH}`);
        return;
      }
      this.layerOffsetsMap = (await response.json()) as LayerOffsetsMap;
    } catch (error) {
      console.warn('Failed to load layer offsets:', error);
    }
  }

  getLayerOffsets(spritesheet: string): LayerOffsetData | null {
    return this.layerOffsetsMap[spritesheet] ?? null;
  }

  getAllLayerOffsets(): LayerOffsetsMap {
    return this.layerOffsetsMap;
  }

  getSprite(name: string): SpriteData | null {
    return this.sprites.get(name) || null;
  }

  getEmoteDefinition(
    name: string,
  ): { frameCount: number; frameDurationMs: number; noFlip?: boolean } | null {
    return this.emoteDefinitions[name] ?? null;
  }

  getEntitySprite(animName: string, spritesheet: string): SpriteData | null {
    return this.sprites.get(`${spritesheet}:${animName}`) || null;
  }

  getPanel(name: string): PanelDefinition | null {
    return this.panelDefinitions.get(name) ?? null;
  }

  getSpritesheet(path: string): HTMLImageElement | HTMLCanvasElement | null {
    return this.spritesheets.get(path) || null;
  }
}
