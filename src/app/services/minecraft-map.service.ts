import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { MapInfo, PlayersInfo } from '../projects/minecraft-map/minecraft-map.types';

@Injectable({ providedIn: 'root' })
export class MinecraftMapService {
  /**
   * The BlueMap webapp is published to the project's default Firebase Hosting site by
   * tools/minecraft-map/publish-map.ps1 (Hosting is free on the Spark plan; Storage isn't).
   */
  readonly viewerUrl = `https://${environment.firebase.projectId}.web.app/`;

  getMapInfo(): Promise<MapInfo | null> {
    return this.fetchJson<MapInfo>('map-info.json');
  }

  getPlayers(): Promise<PlayersInfo | null> {
    return this.fetchJson<PlayersInfo>('players.json');
  }

  private async fetchJson<T>(path: string): Promise<T | null> {
    try {
      const response = await fetch(`${this.viewerUrl}${path}`, { cache: 'no-store' });
      if (!response.ok) return null;
      return (await response.json()) as T;
    } catch (error) {
      console.error(`Failed to load minecraft map ${path}:`, error);
      return null;
    }
  }
}
