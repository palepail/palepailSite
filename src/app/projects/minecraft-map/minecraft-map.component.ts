import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MinecraftMapService } from '../../services/minecraft-map.service';
import { MapInfo, PlayerLastSeen } from './minecraft-map.types';

type LoadState = 'loading' | 'ready' | 'unpublished';

const DIMENSION_NAMES: Record<string, string> = {
  overworld: 'Overworld',
  nether: 'Nether',
  end: 'The End',
};

const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

@Component({
  selector: 'app-minecraft-map',
  templateUrl: './minecraft-map.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './minecraft-map.component.css',
})
export class MinecraftMapComponent implements OnInit, OnDestroy {
  private readonly mapService = inject(MinecraftMapService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly viewerUrl = this.mapService.viewerUrl;
  /** The BlueMap webapp, embedded from our own Firebase Hosting site. */
  readonly viewerSrc = signal<SafeResourceUrl>(this.trustedViewerUrl(''));

  readonly state = signal<LoadState>('loading');
  readonly info = signal<MapInfo | null>(null);
  readonly players = signal<PlayerLastSeen[]>([]);
  readonly selectedPlayer = signal<string | null>(null);
  /** Ticks every minute so "last seen" times stay current. */
  private readonly now = signal(Date.now());
  private clock?: ReturnType<typeof setInterval>;

  readonly updatedAt = computed(() => {
    const value = this.info()?.updatedAt;
    return value ? new Date(value).toLocaleString() : null;
  });

  readonly playerRows = computed(() => {
    const now = this.now();
    const rendered = this.info()?.maps ?? [];
    return this.players().map((player) => ({
      player,
      dimension: DIMENSION_NAMES[player.dimension] ?? player.dimension,
      seen: this.formatSeen(new Date(player.lastSeen).getTime(), now),
      seenExact: new Date(player.lastSeen).toLocaleString(),
      // The End (etc.) may not be rendered yet, so there'd be nothing to jump to.
      onMap: rendered.includes(player.dimension),
    }));
  });

  async ngOnInit(): Promise<void> {
    const [info, players] = await Promise.all([
      this.mapService.getMapInfo(),
      this.mapService.getPlayers(),
    ]);
    this.info.set(info);
    this.players.set(players?.players ?? []);
    this.state.set(info?.maps?.length ? 'ready' : 'unpublished');
    this.clock = setInterval(() => this.now.set(Date.now()), 60_000);
  }

  ngOnDestroy(): void {
    clearInterval(this.clock);
  }

  /** Moves the embedded map to the player; BlueMap follows changes to its URL hash. */
  showPlayer(player: PlayerLastSeen): void {
    this.selectedPlayer.set(player.name);
    // BlueMap's address: map:x:y:z:distance:rotation:angle:tilt:ortho:controls
    const hash = [player.dimension, player.x, player.y, player.z, 60, 0, 0.8, 0, 0, 'perspective'];
    this.viewerSrc.set(this.trustedViewerUrl(`#${hash.join(':')}`));
  }

  private trustedViewerUrl(hash: string): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(this.viewerUrl + hash);
  }

  private formatSeen(time: number, now: number): string {
    const elapsed = time - now;
    for (const [unit, ms] of UNITS) {
      if (Math.abs(elapsed) >= ms) return relativeTime.format(Math.round(elapsed / ms), unit);
    }
    return 'just now';
  }
}
