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

  // Sprite definitions - these would be updated based on actual spritesheet layout
  private spriteDefinitions: SpriteDefinition[] = [
    // Tank sprites
    { name: 'tank_body', spritesheet: 'tanks.png', x: 0, y: 0, width: 64, height: 32 },
    { name: 'tank_barrel', spritesheet: 'tanks.png', x: 64, y: 0, width: 32, height: 8 },
    { name: 'tank_track_left', spritesheet: 'tanks.png', x: 0, y: 32, width: 64, height: 8 },
    { name: 'tank_track_right', spritesheet: 'tanks.png', x: 0, y: 40, width: 64, height: 8 },

    // Terrain sprites
    { name: 'terrain_dirt', spritesheet: 'terrain.png', x: 0, y: 0, width: 32, height: 32 },
    { name: 'terrain_grass', spritesheet: 'terrain.png', x: 32, y: 0, width: 32, height: 32 },

    // Projectile sprites
    { name: 'projectile', spritesheet: 'effects.png', x: 0, y: 0, width: 8, height: 8 },

    // Explosion sprites (could be animated frames)
    { name: 'explosion_1', spritesheet: 'effects.png', x: 8, y: 0, width: 32, height: 32 },
    { name: 'explosion_2', spritesheet: 'effects.png', x: 40, y: 0, width: 32, height: 32 },
    { name: 'explosion_3', spritesheet: 'effects.png', x: 72, y: 0, width: 32, height: 32 },

    // UI sprites
    { name: 'health_bar', spritesheet: 'ui.png', x: 0, y: 0, width: 100, height: 10 },
    { name: 'power_bar', spritesheet: 'ui.png', x: 0, y: 10, width: 100, height: 10 },
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
      img.src = `assets/images/projects/monkeys/${path}`;
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