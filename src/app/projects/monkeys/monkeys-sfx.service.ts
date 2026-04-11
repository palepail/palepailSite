import { Injectable } from '@angular/core';

interface SfxBankEntry {
  file: string;
  volume: number;
}

interface SfxBankCategory {
  files: SfxBankEntry[];
}

interface SfxBank {
  voiceCharacters?: string[];
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
  private entityBumpAudio = new WeakMap<object, HTMLAudioElement>();

  sfxVolume = 0.5;
  isMuted = false;

  async loadBank(): Promise<void> {
    const resp = await fetch('assets/monkeys/sfx-bank.json');
    if (!resp.ok) throw new Error(`Failed to load sfx-bank.json: ${resp.status}`);
    this.bank = (await resp.json()) as SfxBank;
    const voiceChars = this.bank.voiceCharacters ?? [];
    const isVoiceCategory = (name: string) =>
      voiceChars.some((char) => name.startsWith(char + '_'));
    for (const [catName, cat] of Object.entries(this.bank.categories)) {
      if (isVoiceCategory(catName)) continue;
      for (const entry of cat.files) {
        this.cacheAudio(entry.file);
      }
    }
  }

  async loadVoiceAssets(characters: string[]): Promise<void> {
    if (!this.bank) return;
    const lc = characters.map((c) => c.toLowerCase());
    for (const [catName, cat] of Object.entries(this.bank.categories)) {
      if (!lc.some((char) => catName.startsWith(char + '_'))) continue;
      for (const entry of cat.files) {
        this.cacheAudio(entry.file);
      }
    }
  }

  private cacheAudio(file: string): void {
    if (this.audioCache.has(file)) return;
    const url = this.AUDIO_BASE_PATH + file.split('/').map(encodeURIComponent).join('/');
    const audio = new Audio(url);
    audio.preload = 'auto';
    this.audioCache.set(file, audio);
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

  playVo(entity: object, voicePack: string, event: string): void {
    const categoryKey = `${voicePack}_${event}`;
    if (!this.bank?.categories[categoryKey]) return;
    const entry = this.bank.categories[categoryKey];
    if (!entry || entry.files.length === 0) return;
    const file = entry.files[Math.floor(Math.random() * entry.files.length)];
    const cached = this.audioCache.get(file.file);
    if (!cached) return;

    // For bump VO, stop any currently-playing bump for this entity first
    if (event === 'bump') {
      const prev = this.entityBumpAudio.get(entity);
      if (prev) {
        prev.pause();
        prev.currentTime = 0;
      }
    }

    const clone = cached.cloneNode(true) as HTMLAudioElement;
    clone.volume = Math.min(1, file.volume * this.effectiveVolume);
    clone.play().catch(() => {});

    if (event === 'bump') {
      this.entityBumpAudio.set(entity, clone);
    }
  }
}
