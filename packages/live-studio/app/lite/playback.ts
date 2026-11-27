import { filmToVideoTime } from "../picture/compare-video-model.ts";

export const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const;

type TimeListener = (filmT: number, duration: number, startSec: number) => void;
type PlayListener = (playing: boolean) => void;

export class LitePlaybackClock {
  private video: HTMLVideoElement | null = null;
  private startSec = 0;
  private filmDuration = 0;
  private videoDuration = 0;
  private filmT = 0;
  private playbackRate = 1;
  private playing = false;
  private rafId = 0;
  private pendingSeekFilmT: number | null = null;
  private timeListeners = new Set<TimeListener>();
  private playListeners = new Set<PlayListener>();

  get t(): number {
    return this.filmT;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get start(): number {
    return this.startSec;
  }

  get duration(): number {
    return this.videoDuration > 0 ? this.videoDuration : this.filmDuration;
  }

  get rate(): number {
    return this.playbackRate;
  }

  get element(): HTMLVideoElement | null {
    return this.video;
  }

  attach(video: HTMLVideoElement | null): void {
    this.video = video;
    if (video) video.playbackRate = this.playbackRate;
    else this.stopRaf();
  }

  setRate(rate: number): void {
    const safe = Number.isFinite(rate) && rate > 0 ? rate : 1;
    this.playbackRate = safe;
    if (this.video) this.video.playbackRate = safe;
  }

  cycleRate(): number {
    const idx = PLAYBACK_RATES.findIndex((r) => Math.abs(r - this.playbackRate) < 0.01);
    const next = PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length] ?? 1;
    this.setRate(next);
    return next;
  }

  setClip(startSec: number, filmDuration?: number): void {
    this.startSec = Number.isFinite(startSec) && startSec > 0 ? startSec : 0;
    if (filmDuration !== undefined) {
      this.filmDuration = Number.isFinite(filmDuration) && filmDuration > 0 ? filmDuration : 0;
    }
    this.videoDuration = 0;
    if (this.pendingSeekFilmT === null) {
      this.filmT = this.startSec;
    }
    this.emitTime();
  }

  setFilmDuration(filmDuration: number): void {
    this.filmDuration = Number.isFinite(filmDuration) && filmDuration > 0 ? filmDuration : 0;
    if (this.videoDuration === 0) {
      this.emitTime();
    }
  }

  onLoadedMetadata(video: HTMLVideoElement): void {
    if (video !== this.video) return;
    video.playbackRate = this.playbackRate;
    this.videoDuration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    if (this.pendingSeekFilmT !== null) {
      const target = this.pendingSeekFilmT;
      this.pendingSeekFilmT = null;
      this.seek(target);
    } else {
      this.filmT = this.startSec + (video.currentTime || 0);
      this.emitTime();
    }
  }

  onPlay(): void {
    if (!this.playing) {
      this.playing = true;
      this.emitPlay();
    }
    this.startRaf();
  }

  onPause(): void {
    this.stopRaf();
    if (this.video) {
      this.filmT = this.startSec + (this.video.currentTime || 0);
      this.emitTime();
    }
    if (this.playing) {
      this.playing = false;
      this.emitPlay();
    }
  }

  onSeeked(): void {
    if (!this.video) return;
    this.filmT = this.startSec + (this.video.currentTime || 0);
    this.emitTime();
  }

  seek(filmT: number): void {
    const dur = this.videoDuration;
    const { t: videoT } = filmToVideoTime(filmT, this.startSec, dur);
    this.filmT = this.startSec + videoT;
    this.emitTime();
    const video = this.video;
    if (!video) {
      this.pendingSeekFilmT = filmT;
      return;
    }
    if (video.readyState < 1) {
      this.pendingSeekFilmT = filmT;
      return;
    }
    this.pendingSeekFilmT = null;
    if (Math.abs(video.currentTime - videoT) > 0.004) {
      try {
        video.currentTime = videoT;
      } catch {}
    }
  }

  seekLocal(localT: number): void {
    this.seek(this.startSec + Math.max(0, localT));
  }

  seekAfterClipChange(filmT: number): void {
    const safeT = Number.isFinite(filmT) && filmT >= 0 ? filmT : 0;
    this.pendingSeekFilmT = safeT;
    this.filmT = safeT;
    this.emitTime();
  }

  clearPendingSeek(): void {
    this.pendingSeekFilmT = null;
  }

  play(): void {
    const video = this.video;
    if (!video) return;
    if (video.ended || (this.videoDuration > 0 && video.currentTime >= this.videoDuration - 0.02)) {
      video.currentTime = 0;
    }
    void video.play().catch(() => {});
  }

  pause(): void {
    this.video?.pause();
    this.stopRaf();
    if (this.playing) {
      this.playing = false;
      this.emitPlay();
    }
  }

  togglePlay(): void {
    if (this.playing || (this.video && !this.video.paused)) this.pause();
    else this.play();
  }

  subscribeTime(fn: TimeListener): () => void {
    this.timeListeners.add(fn);
    fn(this.filmT, this.duration, this.startSec);
    return () => {
      this.timeListeners.delete(fn);
    };
  }

  subscribePlay(fn: PlayListener): () => void {
    this.playListeners.add(fn);
    fn(this.playing);
    return () => {
      this.playListeners.delete(fn);
    };
  }

  private emitTime(): void {
    const d = this.duration;
    for (const fn of this.timeListeners) fn(this.filmT, d, this.startSec);
  }

  private emitPlay(): void {
    for (const fn of this.playListeners) fn(this.playing);
  }

  private startRaf(): void {
    if (this.rafId || typeof requestAnimationFrame !== "function") return;
    const step = () => {
      this.rafId = 0;
      const video = this.video;
      if (!video || video.paused || video.ended) {
        if (this.playing) {
          this.playing = false;
          this.emitPlay();
        }
        return;
      }
      const next = this.startSec + video.currentTime;
      if (Math.abs(next - this.filmT) > 0.001) {
        this.filmT = next;
        this.emitTime();
      }
      this.rafId = requestAnimationFrame(step);
    };
    this.rafId = requestAnimationFrame(step);
  }

  private stopRaf(): void {
    if (this.rafId && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = 0;
  }
}

export const playback = new LitePlaybackClock();
