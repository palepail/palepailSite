import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { MapManifest, MapMarker } from '../projects/minecraft-map/minecraft-map.types';

/** Root folder in the Firebase Storage bucket that the publish script uploads to. */
const MAP_ROOT = 'minecraft-map';

@Injectable({ providedIn: 'root' })
export class MinecraftMapService {
  private readonly bucket = environment.firebase.storageBucket;

  /** Public download URL for an object in the map folder (requires the read rule in storage.rules). */
  objectUrl(path: string): string {
    const objectPath = encodeURIComponent(`${MAP_ROOT}/${path}`);
    return `https://firebasestorage.googleapis.com/v0/b/${this.bucket}/o/${objectPath}?alt=media`;
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
