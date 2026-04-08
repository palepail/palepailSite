import { Injectable } from '@angular/core';

interface SfxBankEntry {
  file: string;
  volume: number;
}

interface SfxBankCategory {
  files: SfxBankEntry[];
}

interface SfxBank {
  categories: Record<string, SfxBankCategory>;
}

export interface SfxRequest {
  category?: string;
  file?: string;
  volume?: number;
}

@Injectable({
  providedIn: 'root',
})
export class MonkeysSfxService {
  private readonly AUDIO_BASE_PATH = 'resources/audio/projects/monkeys/';
  private bank: SfxBank | null = null;
  private audioCache = new Map<string, HTMLAudioElement>();
  private entityWalkAudio = new WeakMap<object, HTMLAudioElement>();

  sfxVolume = 0.5;
  isMuted = false;

  async loadBank(): Promise<void> {
    const resp = await fetch('assets/monkeys/sfx-bank.json');
    if (!resp.ok) throw new Error(`Failed to load sfx-bank.json: ${resp.status}`);
    this.bank = (await resp.json()) as SfxBank;
    for (const cat of Object.values(this.bank.categories)) {
      for (const entry of cat.files) {
        if (!this.audioCache.has(entry.file)) {
          const audio = new Audio(this.AUDIO_BASE_PATH + encodeURIComponent(entry.file));
          audio.preload = 'auto';
          this.audioCache.set(entry.file, audio);
        }
      }
    }
  }

  private get effectiveVolume(): number {
    return this.isMuted ? 0 : this.sfxVolume;
  }

  private resolveEntry(req: SfxRequest): SfxBankEntry | null {
    if (req.file) {
      return { file: req.file, volume: 1.0 };
    }
    if (req.category && this.bank) {
      const cat = this.bank.categories[req.category];
      if (cat && cat.files.length > 0) {
        return cat.files[Math.floor(Math.random() * cat.files.length)];
      }
    }
    return null;
  }

  play(req: SfxRequest): void {
    const entry = this.resolveEntry(req);
    if (!entry) return;
    const cached = this.audioCache.get(entry.file);
    if (!cached) return;
    const clone = cached.cloneNode(true) as HTMLAudioElement;
    clone.volume = Math.min(1, entry.volume * (req.volume ?? 1) * this.effectiveVolume);
    clone.play().catch(() => {});
  }

  ensureWalkLoop(entity: object, req: SfxRequest): void {
    if (this.entityWalkAudio.has(entity)) return;
    const entry = this.resolveEntry(req);
    if (!entry) return;
    const cached = this.audioCache.get(entry.file);
    if (!cached) return;
    const clone = cached.cloneNode(true) as HTMLAudioElement;
    clone.volume = Math.min(1, entry.volume * (req.volume ?? 1) * this.effectiveVolume);
    clone.loop = true;
    clone.play().catch(() => {});
    this.entityWalkAudio.set(entity, clone);
  }

  stopWalkLoop(entity: object): void {
    const audio = this.entityWalkAudio.get(entity);
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      this.entityWalkAudio.delete(entity);
    }
  }

  setVolume(v: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, v));
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
  }
}
