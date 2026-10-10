import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { MapManifest, MapMarker } from '../projects/minecraft-map/minecraft-map.types';

@Injectable({ providedIn: 'root' })
export class MinecraftMapService {
  /**
   * The map is published to the project's default Firebase Hosting site by
   * tools/minecraft-map/publish-map.ps1 (Hosting is free on the Spark plan; Storage isn't).
   */
  private readonly baseUrl = `https://${environment.firebase.projectId}.web.app`;

  /** URL of a published map file, e.g. `manifest.json` or `overworld/tiles/...`. */
  objectUrl(path: string): string {
    return `${this.baseUrl}/${path}`;
  }

  async getManifest(): Promise<MapManifest | null> {
    return this.fetchJson<MapManifest>('manifest.json');
  }

  async getMarkers(): Promise<MapMarker[]> {
    const markers = await this.fetchJson<MapMarker[]>('markers.json');
    return Array.isArray(markers) ? markers : [];
  }

  private async fetchJson<T>(path: string): Promise<T | null> {
    try {
      const response = await fetch(this.objectUrl(path), { cache: 'no-store' });
      if (!response.ok) return null;
      return (await response.json()) as T;
    } catch (error) {
      console.error(`Failed to load minecraft map ${path}:`, error);
      return null;
    }
  }
}
