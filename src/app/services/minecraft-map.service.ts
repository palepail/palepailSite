import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { MapInfo } from '../projects/minecraft-map/minecraft-map.types';

@Injectable({ providedIn: 'root' })
export class MinecraftMapService {
  /**
   * The BlueMap webapp is published to the project's default Firebase Hosting site by
   * tools/minecraft-map/publish-map.ps1 (Hosting is free on the Spark plan; Storage isn't).
   */
  readonly viewerUrl = `https://${environment.firebase.projectId}.web.app/`;

  async getMapInfo(): Promise<MapInfo | null> {
    try {
      const response = await fetch(`${this.viewerUrl}map-info.json`, { cache: 'no-store' });
      if (!response.ok) return null;
      return (await response.json()) as MapInfo;
    } catch (error) {
      console.error('Failed to load minecraft map info:', error);
      return null;
    }
  }
}
