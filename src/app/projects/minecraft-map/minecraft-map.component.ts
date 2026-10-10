import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { DOCUMENT, Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import * as L from 'leaflet';
import { MinecraftMapService } from '../../services/minecraft-map.service';
import {
  DIMENSION_LABELS,
  DimensionId,
  DimensionManifest,
  MapManifest,
  MapMarker,
} from './minecraft-map.types';

const DIMENSION_ORDER: DimensionId[] = ['overworld', 'nether', 'end'];
const DEFAULT_BACKGROUNDS: Record<DimensionId, string> = {
  overworld: '#1b1f24',
  nether: '#2a0f0f',
  end: '#14111f',
};
/** Extra zoom levels past the most detailed render (tiles are upscaled). */
const OVERZOOM_LEVELS = 2;
const LEAFLET_CSS_ID = 'leaflet-css';

type LoadState = 'loading' | 'ready' | 'unpublished' | 'error';

/** Minecraft block coords -> Leaflet CRS.Simple coords (lat = -z so north is up). */
function toLatLng(x: number, z: number): L.LatLngExpression {
  return [-z, x];
}

/** Tile layer that requests uNmINeD-style tile paths from the published map site. */
class MinecraftTileLayer extends L.TileLayer {
  constructor(
    private readonly urlForPath: (path: string) => string,
    private readonly dimension: DimensionId,
    private readonly tilePath: string,
    options: L.TileLayerOptions,
  ) {
    super('', options);
  }

  override getTileUrl(coords: L.Coords): string {
    const path = this.tilePath
      .replace('{z}', String(coords.z))
      .replace('{xd}', String(Math.floor(coords.x / 10)))
      .replace('{yd}', String(Math.floor(coords.y / 10)))
      .replace('{x}', String(coords.x))
      .replace('{y}', String(coords.y));
    return this.urlForPath(`${this.dimension}/${path}`);
  }
}

@Component({
  selector: 'app-minecraft-map',
  templateUrl: './minecraft-map.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './minecraft-map.component.css',
})
export class MinecraftMapComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapContainer', { static: true }) mapContainer!: ElementRef<HTMLDivElement>;

  private readonly mapService = inject(MinecraftMapService);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly document = inject(DOCUMENT);

  readonly dimensionLabels = DIMENSION_LABELS;
  readonly state = signal<LoadState>('loading');
  readonly manifest = signal<MapManifest | null>(null);
  readonly markers = signal<MapMarker[]>([]);
  readonly activeDimension = signal<DimensionId>('overworld');
  readonly cursor = signal<{ x: number; z: number } | null>(null);
  readonly copied = signal(false);

  readonly dimensions = computed(() => {
    const available = this.manifest()?.dimensions ?? {};
    return DIMENSION_ORDER.filter((id) => available[id]);
  });
  readonly visibleMarkers = computed(() =>
    this.markers()
      .filter((m) => m.dimension === this.activeDimension())
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
  readonly updatedAt = computed(() => {
    const value = this.manifest()?.updatedAt;
    return value ? new Date(value).toLocaleString() : null;
  });

  private map?: L.Map;
  private tileLayer?: L.TileLayer;
  private markerLayer = L.layerGroup();
  private resizeObserver?: ResizeObserver;
  private copiedTimer?: ReturnType<typeof setTimeout>;

  async ngAfterViewInit(): Promise<void> {
    this.ensureLeafletCss();

    const [manifest, markers] = await Promise.all([
      this.mapService.getManifest(),
      this.mapService.getMarkers(),
    ]);
    this.manifest.set(manifest);
    if (!manifest || !this.dimensions().length) {
      this.state.set('unpublished');
      return;
    }

    this.markers.set(markers.filter((m) => this.isValidMarker(m)));

    try {
      this.createMap();
    } catch (error) {
      console.error('Failed to create minecraft map:', error);
      this.state.set('error');
      return;
    }

    const params = this.route.snapshot.queryParamMap;
    const requested = params.get('dim') as DimensionId | null;
    const dimension =
      requested && this.dimensions().includes(requested) ? requested : this.dimensions()[0];
    const x = Number(params.get('x'));
    const z = Number(params.get('z'));
    const zoom = Number(params.get('zoom'));
    const hasView = params.has('x') && params.has('z') && Number.isFinite(x + z);

    this.state.set('ready');
    this.showDimension(dimension, hasView ? { x, z, zoom: Number.isFinite(zoom) ? zoom : 0 } : undefined);
  }

  ngOnDestroy(): void {
    clearTimeout(this.copiedTimer);
    this.resizeObserver?.disconnect();
    this.map?.remove();
  }

  selectDimension(dimension: DimensionId): void {
    if (dimension !== this.activeDimension()) this.showDimension(dimension);
  }

  flyToMarker(marker: MapMarker): void {
    if (!this.map) return;
    const dim = this.dimensionManifest(marker.dimension);
    this.map.flyTo(toLatLng(marker.x + 0.5, marker.z + 0.5), dim?.maxZoom ?? 0);
  }

  async copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.document.location.href);
      this.copied.set(true);
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copied.set(false), 2000);
    } catch {
      // Clipboard can be unavailable (insecure context, permissions); the URL bar still has the link.
    }
  }

  private createMap(): void {
    this.map = L.map(this.mapContainer.nativeElement, {
      crs: L.CRS.Simple,
      attributionControl: false,
      zoomSnap: 1,
      maxBoundsViscosity: 0.8,
    });
    this.markerLayer.addTo(this.map);

    // The frame resizes when the places list appears and on window resize; Leaflet must re-measure.
    this.resizeObserver = new ResizeObserver(() => this.map?.invalidateSize());
    this.resizeObserver.observe(this.mapContainer.nativeElement);

    this.map.on('mousemove', (e: L.LeafletMouseEvent) => {
      this.cursor.set({ x: Math.floor(e.latlng.lng), z: Math.floor(-e.latlng.lat) });
    });
    this.map.on('mouseout', () => this.cursor.set(null));
    this.map.on('moveend', () => this.syncUrl());
  }

  private showDimension(
    dimension: DimensionId,
    view?: { x: number; z: number; zoom: number },
  ): void {
    const dim = this.dimensionManifest(dimension);
    if (!this.map || !dim) return;

    this.activeDimension.set(dimension);
    this.tileLayer?.remove();

    const { bounds } = dim;
    const tileBounds = L.latLngBounds(toLatLng(bounds.minX, bounds.minZ), toLatLng(bounds.maxX, bounds.maxZ));
    this.mapContainer.nativeElement.style.background =
      dim.background ?? DEFAULT_BACKGROUNDS[dimension];

    this.map.setMinZoom(dim.minZoom);
    this.map.setMaxZoom(dim.maxZoom + OVERZOOM_LEVELS);
    // Keep markers outside the rendered area reachable.
    const panBounds = tileBounds.pad(0.25);
    for (const { x, z } of this.visibleMarkers()) {
      panBounds.extend(L.latLngBounds(toLatLng(x - 512, z - 512), toLatLng(x + 512, z + 512)));
    }
    this.map.setMaxBounds(panBounds);

    this.tileLayer = new MinecraftTileLayer(
      (path) => this.mapService.objectUrl(path),
      dimension,
      dim.tilePath,
      {
        tileSize: 256,
        minZoom: dim.minZoom,
        maxZoom: dim.maxZoom + OVERZOOM_LEVELS,
        minNativeZoom: dim.minZoom,
        maxNativeZoom: dim.maxZoom,
        bounds: tileBounds,
        noWrap: true,
        keepBuffer: 4,
        className: 'mc-tiles',
      },
    ).addTo(this.map);

    this.renderMarkers();

    if (view) {
      this.map.setView(toLatLng(view.x, view.z), view.zoom);
    } else {
      this.map.fitBounds(tileBounds);
    }
    this.syncUrl();
  }

  private renderMarkers(): void {
    this.markerLayer.clearLayers();
    for (const marker of this.visibleMarkers()) {
      const color = marker.color ?? '#f5c542';
      const icon = L.divIcon({
        className: 'mc-marker',
        html: `<span class="mc-marker-pin" style="background:${this.safeColor(color)}"></span>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });

      const label = this.document.createElement('div');
      const title = this.document.createElement('strong');
      title.textContent = marker.name;
      const coords = this.document.createElement('div');
      coords.className = 'mc-marker-coords';
      coords.textContent = `X ${marker.x}, Z ${marker.z}`;
      label.append(title, coords);
      if (marker.description) {
        const description = this.document.createElement('div');
        description.textContent = marker.description;
        label.append(description);
      }

      L.marker(toLatLng(marker.x + 0.5, marker.z + 0.5), { icon, title: marker.name })
        .bindTooltip(marker.name, { direction: 'top', offset: [0, -8] })
        .bindPopup(label)
        .addTo(this.markerLayer);
    }
  }

  private syncUrl(): void {
    if (!this.map) return;
    const center = this.map.getCenter();
    const params = new URLSearchParams({
      dim: this.activeDimension(),
      x: String(Math.round(center.lng)),
      z: String(Math.round(-center.lat)),
      zoom: String(this.map.getZoom()),
    });
    this.location.replaceState(this.location.path().split('?')[0], params.toString());
  }

  private dimensionManifest(dimension: DimensionId): DimensionManifest | undefined {
    return this.manifest()?.dimensions[dimension];
  }

  private isValidMarker(marker: MapMarker): boolean {
    return (
      typeof marker?.name === 'string' &&
      DIMENSION_ORDER.includes(marker.dimension) &&
      Number.isFinite(marker.x) &&
      Number.isFinite(marker.z)
    );
  }

  /** Only allow simple CSS colors in marker HTML. */
  private safeColor(color: string): string {
    return /^(#[0-9a-f]{3,8}|[a-z]+)$/i.test(color) ? color : '#f5c542';
  }

  /** Leaflet's stylesheet is built as a separate, non-injected bundle (see angular.json). */
  private ensureLeafletCss(): void {
    if (this.document.getElementById(LEAFLET_CSS_ID)) return;
    const link = this.document.createElement('link');
    link.id = LEAFLET_CSS_ID;
    link.rel = 'stylesheet';
    link.href = 'leaflet.css';
    this.document.head.appendChild(link);
  }
}
