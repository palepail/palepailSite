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

@Injectable({
  providedIn: 'root'
})
export class MonkeysSpriteService {
  private spritesheets: Map<string, HTMLImageElement> = new Map();
  private sprites: Map<string, SpriteData> = new Map();
  private loadedAssets: Map<string, boolean> = new Map();

  // Only load the idle monkey frame for now.
  private spriteDefinitions: SpriteDefinition[] = [
    // Row 2 (0-indexed) => y = 2 * 64 = 128, one 64x64 frame at x = 0.
    { name: 'monkey_idle', spritesheet: 'Lupin.png', x: 0, y: 128, width: 64, height: 64 },
  ];

  constructor() {}

  async loadSprites(): Promise<void> {
    const spritesheetPaths = [...new Set(this.spriteDefinitions.map(def => def.spritesheet))];

    const loadPromises = spritesheetPaths.map(path => this.loadSpritesheet(path));

    try {
      await Promise.all(loadPromises);
      console.log('All sprites loaded successfully');
    } catch (error) {
      console.error('Failed to load some sprites:', error);
    }
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
      img.src = `resources/images/projects/monkeys/${path}`;
    });
  }

  private extractSpritesFromSheet(spritesheetPath: string): void {
    const spritesheet = this.spritesheets.get(spritesheetPath);
    if (!spritesheet) return;

    const relevantSprites = this.spriteDefinitions.filter(def => def.spritesheet === spritesheetPath);

    for (const def of relevantSprites) {
      this.sprites.set(def.name, {
        image: spritesheet,
        x: def.x,
        y: def.y,
        width: def.width,
        height: def.height
      });
    }
  }

  getSprite(name: string): SpriteData | null {
    return this.sprites.get(name) || null;
  }

  isLoaded(): boolean {
    return Array.from(this.loadedAssets.values()).every(loaded => loaded);
  }

  getLoadedSpritesheets(): string[] {
    return Array.from(this.loadedAssets.entries())
      .filter(([_, loaded]) => loaded)
      .map(([path, _]) => path);
  }
}