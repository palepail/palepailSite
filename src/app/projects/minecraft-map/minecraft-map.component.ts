import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { MinecraftMapService } from '../../services/minecraft-map.service';
import { MapInfo } from './minecraft-map.types';

type LoadState = 'loading' | 'ready' | 'unpublished';

@Component({
  selector: 'app-minecraft-map',
  templateUrl: './minecraft-map.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './minecraft-map.component.css',
})
export class MinecraftMapComponent implements OnInit {
  private readonly mapService = inject(MinecraftMapService);

  readonly viewerUrl = this.mapService.viewerUrl;
  /** The BlueMap webapp, embedded from our own Firebase Hosting site. */
  readonly safeViewerUrl = inject(DomSanitizer).bypassSecurityTrustResourceUrl(this.viewerUrl);

  readonly state = signal<LoadState>('loading');
  readonly info = signal<MapInfo | null>(null);
  readonly updatedAt = computed(() => {
    const value = this.info()?.updatedAt;
    return value ? new Date(value).toLocaleString() : null;
  });

  async ngOnInit(): Promise<void> {
    const info = await this.mapService.getMapInfo();
    this.info.set(info);
    this.state.set(info?.maps?.length ? 'ready' : 'unpublished');
  }
}
