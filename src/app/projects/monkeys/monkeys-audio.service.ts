import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class MonkeysAudioService {
  private readonly AUDIO_BASE_PATH = 'resources/audio/projects/monkeys/';

  private menuAudio: HTMLAudioElement | null = null;
  private gameAudio: HTMLAudioElement | null = null;

  // Track which track should be playing so we can retry after a blocked autoplay
  private activeTrack: 'menu' | 'game' | 'none' = 'none';

  bgVolume = 0.5;
  sfxVolume = 0.5;
  isMuted = false;
  private focusMuted = false;

  private get effectiveVolume(): number {
    return this.isMuted || this.focusMuted ? 0 : this.bgVolume;
  }

  setFocusMuted(muted: boolean): void {
    this.focusMuted = muted;
    const active =
      this.activeTrack === 'menu'
        ? this.menuAudio
        : this.activeTrack === 'game'
          ? this.gameAudio
          : null;
    if (active) {
      active.volume = this.effectiveVolume;
    }
  }

  private readonly STORAGE_KEY = 'monkeys_options_audio';

  constructor() {
    this.loadOptions();
  }

  saveOptions(): void {
    localStorage.setItem(
      this.STORAGE_KEY,
      JSON.stringify({ bgVolume: this.bgVolume, sfxVolume: this.sfxVolume, isMuted: this.isMuted }),
    );
  }

  loadOptions(): void {
    const raw = localStorage.getItem(this.STORAGE_KEY);
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as { bgVolume?: number; sfxVolume?: number; isMuted?: boolean };
      if (typeof data.bgVolume === 'number')
        this.bgVolume = Math.max(0, Math.min(1, data.bgVolume));
      if (typeof data.sfxVolume === 'number')
        this.sfxVolume = Math.max(0, Math.min(1, data.sfxVolume));
      if (typeof data.isMuted === 'boolean') this.isMuted = data.isMuted;
    } catch {
      // ignore malformed data
    }
  }

  setBgVolume(v: number): void {
    this.bgVolume = Math.max(0, Math.min(1, v));
    const active =
      this.activeTrack === 'menu'
        ? this.menuAudio
        : this.activeTrack === 'game'
          ? this.gameAudio
          : null;
    if (active) {
      active.volume = this.effectiveVolume;
    }
  }

  setSfxVolume(v: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, v));
    // Sound effects not yet implemented; stored for future use.
  }

  toggleMute(): void {
    this.isMuted = !this.isMuted;
    const active =
      this.activeTrack === 'menu'
        ? this.menuAudio
        : this.activeTrack === 'game'
          ? this.gameAudio
          : null;
    if (active) {
      active.volume = this.effectiveVolume;
    }
  }

  loadMenuAudio(): Promise<void> {
    if (this.menuAudio) return Promise.resolve();
    return new Promise((resolve) => {
      const audio = new Audio(this.AUDIO_BASE_PATH + encodeURIComponent('Menu.ogg'));
      audio.loop = true;
      audio.volume = this.bgVolume;
      const onReady = () => {
        this.menuAudio = audio;
        resolve();
      };
      audio.addEventListener('canplaythrough', onReady, { once: true });
      audio.addEventListener(
        'error',
        () => {
          console.warn('[MonkeysAudio] Failed to load Menu.ogg');
          resolve();
        },
        { once: true },
      );
      audio.load();
    });
  }

  loadGameAudio(): Promise<void> {
    if (this.gameAudio) return Promise.resolve();
    // Create and store the element immediately so startGameAudioOnGesture() can call
    // play() synchronously within the same user-gesture tick, before any await.
    const audio = new Audio(this.AUDIO_BASE_PATH + encodeURIComponent('New Road Loop.ogg'));
    audio.loop = true;
    audio.volume = this.bgVolume;
    this.gameAudio = audio;
    return new Promise((resolve) => {
      audio.addEventListener('canplaythrough', () => resolve(), { once: true });
      audio.addEventListener(
        'error',
        () => {
          console.warn('[MonkeysAudio] Failed to load New Road Loop.ogg');
          resolve();
        },
        { once: true },
      );
      audio.load();
    });
  }

  /**
   * Call this synchronously inside the user-gesture handler (before any await)
   * so the browser honours the autoplay policy for game-loop audio.
   */
  startGameAudioOnGesture(): void {
    this.activeTrack = 'game';
    if (this.menuAudio && !this.menuAudio.paused) {
      this.menuAudio.pause();
    }
    if (this.gameAudio) {
      this.gameAudio.volume = this.effectiveVolume;
      this.gameAudio.currentTime = 0;
      this.gameAudio.play().catch(() => {});
    }
  }

  playMenu(): void {
    this.activeTrack = 'menu';
    if (this.gameAudio && !this.gameAudio.paused) {
      this.gameAudio.pause();
    }
    if (this.menuAudio) {
      this.menuAudio.volume = this.effectiveVolume;
      this.menuAudio.currentTime = 0;
      this.menuAudio.play().catch(() => {
        // Autoplay may be blocked until user interacts; unlockAudio() will retry
      });
    }
  }

  playGame(): void {
    this.activeTrack = 'game';
    if (this.menuAudio && !this.menuAudio.paused) {
      this.menuAudio.pause();
    }
    if (this.gameAudio) {
      this.gameAudio.currentTime = 0;
      this.gameAudio.play().catch(() => {
        // Autoplay may be blocked until user interacts; unlockAudio() will retry
      });
    }
  }

  stopAll(): void {
    this.activeTrack = 'none';
    if (this.menuAudio && !this.menuAudio.paused) {
      this.menuAudio.pause();
    }
    if (this.gameAudio && !this.gameAudio.paused) {
      this.gameAudio.pause();
    }
  }

  /** Call on first user interaction to unblock autoplay-gated audio. */
  unlockAudio(): void {
    if (this.activeTrack === 'menu' && this.menuAudio && this.menuAudio.paused) {
      this.menuAudio.play().catch(() => {});
    } else if (this.activeTrack === 'game' && this.gameAudio && this.gameAudio.paused) {
      this.gameAudio.play().catch(() => {});
    }
  }

  destroy(): void {
    this.stopAll();
    if (this.menuAudio) {
      this.menuAudio.src = '';
      this.menuAudio = null;
    }
    if (this.gameAudio) {
      this.gameAudio.src = '';
      this.gameAudio = null;
    }
    this.activeTrack = 'none';
    this.isMuted = false;
    this.focusMuted = false;
  }
}
