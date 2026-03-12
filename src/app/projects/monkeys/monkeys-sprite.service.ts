import { Injectable } from '@angular/core';

export interface SpriteDefinition {
  name: string;
  spritesheet: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpriteData {
  image: HTMLImageElement;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SpriteMetadataDefinition {
  name: string;
  spritesheet: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SpriteMetadataFile {
  spritesheets: Record<string, string>;
  sprites: SpriteMetadataDefinition[];
}

@Injectable({
  providedIn: 'root',
})
export class MonkeysSpriteService {
  private readonly ASSET_BASE_PATH = 'resources/images/projects/monkeys/';
  private readonly METADATA_PATH = 'assets/monkeys/sprite-metadata.json';
  readonly TERRAIN_TOOL_SPRITESHEET = 'Dragon Road (Tiles).png';
  private spritesheets: Map<string, HTMLImageElement> = new Map();
  private sprites: Map<string, SpriteData> = new Map();
  private loadedAssets: Map<string, boolean> = new Map();
  private spriteDefinitions: SpriteDefinition[] = [];
  private metadataLoadPromise: Promise<void> | null = null;

  constructor() {}

  async loadSprites(): Promise<void> {
    await this.ensureSpriteMetadataLoaded();

    const spritesheetPaths = [...new Set(this.spriteDefinitions.map((def) => def.spritesheet))];

    const loadPromises = spritesheetPaths.map((path) => this.loadSpritesheet(path));

    try {
      await Promise.all(loadPromises);
      console.log('All sprites loaded successfully');
    } catch (error) {
      console.error('Failed to load some sprites:', error);
    }
  }

  async loadTerrainSpritesheet(): Promise<HTMLImageElement> {
    return this.loadRawSpritesheet(this.TERRAIN_TOOL_SPRITESHEET);
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

  async loadRawSpritesheet(path: string): Promise<HTMLImageElement> {
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
      img.onload = () => {
        this.spritesheets.set(path, img);
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
      this.sprites.set(def.name, {
        image: spritesheet,
        x: def.x,
        y: def.y,
        width: def.width,
        height: def.height,
      });
    }
  }

  getSprite(name: string): SpriteData | null {
    return this.sprites.get(name) || null;
  }

  getSpritesheet(path: string): HTMLImageElement | null {
    return this.spritesheets.get(path) || null;
  }

  isLoaded(): boolean {
    return Array.from(this.loadedAssets.values()).every((loaded) => loaded);
  }

  getLoadedSpritesheets(): string[] {
    return Array.from(this.loadedAssets.entries())
      .filter(([_, loaded]) => loaded)
      .map(([path, _]) => path);
  }
}
