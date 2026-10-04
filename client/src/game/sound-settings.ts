const VOLUME_KEY = "racer-volume";
const MUTED_KEY = "racer-muted";
/** Volume steps the Lobby's slider moves in, in percent. */
export const VOLUME_STEP = 5;
const DEFAULT_VOLUME = 70;

/**
 * The driver's volume and mute choice, kept in localStorage like the other Lobby choices.
 * The Lobby, the race HUD and the M key all change the same settings, and whatever plays
 * sound follows them.
 */
export class SoundSettings {
  private volumePercent: number;
  private isMuted: boolean;
  private readonly listeners = new Set<() => void>();

  constructor() {
    const stored = Number(localStorage.getItem(VOLUME_KEY) ?? Number.NaN);
    this.volumePercent = Number.isFinite(stored) ? clampVolume(stored) : DEFAULT_VOLUME;
    this.isMuted = localStorage.getItem(MUTED_KEY) === "true";
  }

  /** 0 to 100. */
  get volume(): number {
    return this.volumePercent;
  }

  get muted(): boolean {
    return this.isMuted;
  }

  /**
   * The gain the mix plays at: 0 while muted, otherwise the square of the volume, so the
   * slider's lower half isn't all nearly as loud as the top.
   */
  get gain(): number {
    return this.isMuted ? 0 : (this.volumePercent / 100) ** 2;
  }

  setVolume(percent: number): void {
    const volume = clampVolume(percent);
    if (volume === this.volumePercent) return;
    this.volumePercent = volume;
    localStorage.setItem(VOLUME_KEY, String(volume));
    this.changed();
  }

  setMuted(muted: boolean): void {
    if (muted === this.isMuted) return;
    this.isMuted = muted;
    localStorage.setItem(MUTED_KEY, String(muted));
    this.changed();
  }

  toggleMuted(): void {
    this.setMuted(!this.isMuted);
  }

  /** Calls `listener` after every change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }
}

function clampVolume(percent: number): number {
  return Math.max(0, Math.min(100, Math.round(percent / VOLUME_STEP) * VOLUME_STEP));
}
