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

  private spriteDefinitions: SpriteDefinition[] = [
    // Idle: row 2 (0-indexed) => y = 2 * 64 = 128, one 64x64 frame at x = 0.
    { name: 'monkey_idle', spritesheet: 'Lupin.png', x: 0, y: 128, width: 64, height: 64 },

    // Move animation: row 0, 4 frames, each 64x64.
    { name: 'monkey_move_0', spritesheet: 'Lupin.png', x: 0,   y: 0, width: 64, height: 64 },
    { name: 'monkey_move_1', spritesheet: 'Lupin.png', x: 64,  y: 0, width: 64, height: 64 },
    { name: 'monkey_move_2', spritesheet: 'Lupin.png', x: 128, y: 0, width: 64, height: 64 },
    { name: 'monkey_move_3', spritesheet: 'Lupin.png', x: 192, y: 0, width: 64, height: 64 },

    // Shoot animation: row 1 (0-indexed), 10 frames, each 64x64.
    { name: 'monkey_shoot_0', spritesheet: 'Lupin.png', x: 0, y: 64, width: 64, height: 64 },
    { name: 'monkey_shoot_1', spritesheet: 'Lupin.png', x: 64, y: 64, width: 64, height: 64 },
    { name: 'monkey_shoot_2', spritesheet: 'Lupin.png', x: 128, y: 64, width: 64, height: 64 },
    { name: 'monkey_shoot_3', spritesheet: 'Lupin.png', x: 192, y: 64, width: 64, height: 64 },
    { name: 'monkey_shoot_4', spritesheet: 'Lupin.png', x: 256, y: 64, width: 64, height: 64 },
    { name: 'monkey_shoot_5', spritesheet: 'Lupin.png', x: 320, y: 64, width: 64, height: 64 },
    { name: 'monkey_shoot_6', spritesheet: 'Lupin.png', x: 384, y: 64, width: 64, height: 64 },
    { name: 'monkey_shoot_7', spritesheet: 'Lupin.png', x: 448, y: 64, width: 64, height: 64 },
    { name: 'monkey_shoot_8', spritesheet: 'Lupin.png', x: 512, y: 64, width: 64, height: 64 },
    { name: 'monkey_shoot_9', spritesheet: 'Lupin.png', x: 576, y: 64, width: 64, height: 64 },

    // Death: row 3, 3 frames, each 64x64.
    { name: 'monkey_death_0', spritesheet: 'Lupin.png', x: 0, y: 192, width: 64, height: 64 },
    { name: 'monkey_death_1', spritesheet: 'Lupin.png', x: 64, y: 192, width: 64, height: 64 },
    { name: 'monkey_death_2', spritesheet: 'Lupin.png', x: 128, y: 192, width: 64, height: 64 },

    // Hurt: row 4, one 64x64 frame.
    { name: 'monkey_hurt', spritesheet: 'Lupin.png', x: 0, y: 256, width: 64, height: 64 },

    // Explosion animation: row 6, 3 frames, each 64x64.
    { name: 'explosion_0', spritesheet: 'Lupin.png', x: 0,   y: 384, width: 64, height: 64 },
    { name: 'explosion_1', spritesheet: 'Lupin.png', x: 64,  y: 384, width: 64, height: 64 },
    { name: 'explosion_2', spritesheet: 'Lupin.png', x: 128, y: 384, width: 64, height: 64 },

    // Bullet animation: row 7, 3 frames, each 64x64.
    { name: 'bullet_0', spritesheet: 'Lupin.png', x: 0,   y: 448, width: 64, height: 64 },
    { name: 'bullet_1', spritesheet: 'Lupin.png', x: 64,  y: 448, width: 64, height: 64 },
    { name: 'bullet_2', spritesheet: 'Lupin.png', x: 128, y: 448, width: 64, height: 64 },

    // Cursors: row 0, 6 frames, each 32x32.
    { name: 'cursor_0', spritesheet: 'Cursors.png', x: 0,   y: 0, width: 32, height: 32 },
    { name: 'cursor_1', spritesheet: 'Cursors.png', x: 32,  y: 0, width: 32, height: 32 },
    { name: 'cursor_2', spritesheet: 'Cursors.png', x: 64,  y: 0, width: 32, height: 32 },
    { name: 'cursor_3', spritesheet: 'Cursors.png', x: 96,  y: 0, width: 32, height: 32 },
    { name: 'cursor_4', spritesheet: 'Cursors.png', x: 128, y: 0, width: 32, height: 32 },
    { name: 'cursor_5', spritesheet: 'Cursors.png', x: 160, y: 0, width: 32, height: 32 },
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
