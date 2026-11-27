import { filmToVideoTime } from "../picture/compare-video-model.ts";

export const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const;

type TimeListener = (filmT: number, duration: number, startSec: number) => void;
type PlayListener = (playing: boolean) => void;

type PlaybackState =
  | { status: "detached"; pendingSeekFilmT: number | null }
  | { status: "loading"; video: HTMLVideoElement; pendingSeekFilmT: number | null }
  | { status: "paused"; video: HTMLVideoElement; videoDuration: number }
  | {
      status: "playing";
      video: HTMLVideoElement;
      videoDuration: number;
      rafId: number;
      pendingSeekFilmT: number | null;
    };

export class LitePlaybackClock {
  private state: PlaybackState = { status: "detached", pendingSeekFilmT: null };
  private startSec = 0;
  private filmDuration = 0;
  private filmT = 0;
  private playbackRate = 1;
  private timeListeners = new Set<TimeListener>();
  private playListeners = new Set<PlayListener>();

  get t(): number {
    return this.filmT;
  }

  get isPlaying(): boolean {
    return this.state.status === "playing";
  }

  get start(): number {
    return this.startSec;
  }

  get duration(): number {
    const videoDuration =
      this.state.status === "paused" || this.state.status === "playing"
        ? this.state.videoDuration
        : 0;
    return videoDuration > 0 ? videoDuration : this.filmDuration;
  }

  get rate(): number {
    return this.playbackRate;
  }

  get element(): HTMLVideoElement | null {
    return this.state.status === "detached" ? null : this.state.video;
  }

  attach(video: HTMLVideoElement | null): void {
    const prev = this.state;
    if (video === null) {
      if (prev.status === "detached") return;
      const wasPlaying = prev.status === "playing";
      if (prev.status === "playing") this.cancelRaf(prev.rafId);
      this.state = { status: "detached", pendingSeekFilmT: null };
      if (wasPlaying) this.emitPlay();
      return;
    }
    if (prev.status !== "detached" && prev.video === video) {
      video.playbackRate = this.playbackRate;
      return;
    }
    const wasPlaying = prev.status === "playing";
    if (prev.status === "playing") this.cancelRaf(prev.rafId);
    const pendingSeekFilmT = prev.status === "detached" ? prev.pendingSeekFilmT : null;
    video.playbackRate = this.playbackRate;
    this.state = { status: "loading", video, pendingSeekFilmT };
    if (wasPlaying) this.emitPlay();
  }

  setRate(rate: number): void {
    const safe = Number.isFinite(rate) && rate > 0 ? rate : 1;
    this.playbackRate = safe;
    if (this.state.status !== "detached") this.state.video.playbackRate = safe;
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
    const prev = this.state;
    const wasPlaying = prev.status === "playing";
    if (prev.status === "playing") this.cancelRaf(prev.rafId);
    const pendingSeekFilmT =
      prev.status === "detached" || prev.status === "loading" || prev.status === "playing"
        ? prev.pendingSeekFilmT
        : null;
    if (prev.status !== "detached") {
      this.state = { status: "loading", video: prev.video, pendingSeekFilmT };
    }
    if (pendingSeekFilmT === null) {
      this.filmT = this.startSec;
    }
    if (wasPlaying) this.emitPlay();
    this.emitTime();
  }

  setFilmDuration(filmDuration: number): void {
    this.filmDuration = Number.isFinite(filmDuration) && filmDuration > 0 ? filmDuration : 0;
    if (this.state.status === "detached" || this.state.status === "loading" || this.state.videoDuration === 0) {
      this.emitTime();
    }
  }

  onLoadedMetadata(video: HTMLVideoElement): void {
    if (this.state.status === "detached" || this.state.video !== video) return;
    video.playbackRate = this.playbackRate;
    const videoDuration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const pendingSeek =
      this.state.status === "loading" || this.state.status === "playing"
        ? this.state.pendingSeekFilmT
        : null;
    if (this.state.status === "playing") {
      this.state = { ...this.state, videoDuration, pendingSeekFilmT: null };
    } else {
      this.state = { status: "paused", video, videoDuration };
    }
    if (pendingSeek !== null) {
      this.seek(pendingSeek);
    } else {
      this.filmT = this.startSec + (video.currentTime || 0);
      this.emitTime();
    }
  }

  onPlay(): void {
    const prev = this.state;
    if (prev.status === "detached") return;
    if (prev.status === "playing") {
      this.ensureRaf();
      return;
    }
    const videoDuration =
      prev.status === "paused"
        ? prev.videoDuration
        : Number.isFinite(prev.video.duration) && prev.video.duration > 0
          ? prev.video.duration
          : 0;
    const pendingSeekFilmT = prev.status === "loading" ? prev.pendingSeekFilmT : null;
    this.state = {
      status: "playing",
      video: prev.video,
      videoDuration,
      rafId: 0,
      pendingSeekFilmT,
    };
    this.emitPlay();
    this.ensureRaf();
  }

  onPause(): void {
    const prev = this.state;
    if (prev.status === "detached") return;
    const wasPlaying = prev.status === "playing";
    const hasPendingSeek =
      (prev.status === "loading" || prev.status === "playing") && prev.pendingSeekFilmT !== null;
    if (prev.status === "playing") {
      this.cancelRaf(prev.rafId);
      this.state =
        prev.pendingSeekFilmT !== null
          ? { status: "loading", video: prev.video, pendingSeekFilmT: prev.pendingSeekFilmT }
          : { status: "paused", video: prev.video, videoDuration: prev.videoDuration };
    }
    if (!hasPendingSeek) {
      this.filmT = this.startSec + (prev.video.currentTime || 0);
      this.emitTime();
    }
    if (wasPlaying) this.emitPlay();
  }

  onSeeked(): void {
    if (this.state.status === "detached") return;
    if (
      (this.state.status === "loading" || this.state.status === "playing") &&
      this.state.pendingSeekFilmT !== null
    ) {
      return;
    }
    this.filmT = this.startSec + (this.state.video.currentTime || 0);
    this.emitTime();
  }

  seek(filmT: number): void {
    const dur =
      this.state.status === "paused" || this.state.status === "playing"
        ? this.state.videoDuration
        : 0;
    const { t: videoT } = filmToVideoTime(filmT, this.startSec, dur);
    this.filmT = this.startSec + videoT;
    this.emitTime();
    if (this.state.status === "detached") {
      this.state = { status: "detached", pendingSeekFilmT: filmT };
      return;
    }
    const video = this.state.video;
    if (video.readyState < 1) {
      this.state =
        this.state.status === "playing"
          ? { ...this.state, pendingSeekFilmT: filmT }
          : { status: "loading", video, pendingSeekFilmT: filmT };
      return;
    }
    if (this.state.status === "loading") {
      this.state = { status: "loading", video, pendingSeekFilmT: null };
    } else if (this.state.status === "playing" && this.state.pendingSeekFilmT !== null) {
      this.state = { ...this.state, pendingSeekFilmT: null };
    }
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
    const prev = this.state;
    const wasPlaying = prev.status === "playing";
    if (prev.status === "playing") this.cancelRaf(prev.rafId);
    this.state =
      prev.status === "detached"
        ? { status: "detached", pendingSeekFilmT: safeT }
        : { status: "loading", video: prev.video, pendingSeekFilmT: safeT };
    this.filmT = safeT;
    if (wasPlaying) this.emitPlay();
    this.emitTime();
  }

  clearPendingSeek(): void {
    if (this.state.status === "detached") {
      this.state = { status: "detached", pendingSeekFilmT: null };
    } else if (this.state.status === "loading") {
      this.state = { status: "loading", video: this.state.video, pendingSeekFilmT: null };
    } else if (this.state.status === "playing" && this.state.pendingSeekFilmT !== null) {
      this.state = { ...this.state, pendingSeekFilmT: null };
    }
  }

  play(): void {
    if (this.state.status === "detached") return;
    const video = this.state.video;
    const videoDuration =
      this.state.status === "paused" || this.state.status === "playing"
        ? this.state.videoDuration
        : 0;
    if (video.ended || (videoDuration > 0 && video.currentTime >= videoDuration - 0.02)) {
      video.currentTime = 0;
    }
    void video.play().catch(() => {});
  }

  pause(): void {
    const prev = this.state;
    if (prev.status === "detached") return;
    const wasPlaying = prev.status === "playing";
    if (prev.status === "playing") {
      this.cancelRaf(prev.rafId);
      this.state =
        prev.pendingSeekFilmT !== null
          ? { status: "loading", video: prev.video, pendingSeekFilmT: prev.pendingSeekFilmT }
          : { status: "paused", video: prev.video, videoDuration: prev.videoDuration };
    }
    prev.video.pause();
    if (wasPlaying) this.emitPlay();
  }

  togglePlay(): void {
    if (this.state.status === "playing" || (this.state.status !== "detached" && !this.state.video.paused)) {
      this.pause();
    } else {
      this.play();
    }
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
    fn(this.isPlaying);
    return () => {
      this.playListeners.delete(fn);
    };
  }

  private emitTime(): void {
    const d = this.duration;
    for (const fn of this.timeListeners) fn(this.filmT, d, this.startSec);
  }

  private emitPlay(): void {
    const playing = this.isPlaying;
    for (const fn of this.playListeners) fn(playing);
  }

  private ensureRaf(): void {
    if (this.state.status !== "playing" || this.state.rafId || typeof requestAnimationFrame !== "function") {
      return;
    }
    const video = this.state.video;
    const step = () => {
      if (this.state.status !== "playing" || this.state.video !== video) return;
      this.state = { ...this.state, rafId: 0 };
      const { videoDuration, pendingSeekFilmT } = this.state;
      if (video.paused || video.ended) {
        this.state =
          pendingSeekFilmT !== null
            ? { status: "loading", video, pendingSeekFilmT }
            : { status: "paused", video, videoDuration };
        this.emitPlay();
        return;
      }
      if (pendingSeekFilmT === null) {
        const next = this.startSec + video.currentTime;
        if (Math.abs(next - this.filmT) > 0.001) {
          this.filmT = next;
          this.emitTime();
        }
      }
      if (this.state.status !== "playing" || this.state.video !== video || this.state.rafId !== 0) {
        return;
      }
      this.state = { ...this.state, rafId: requestAnimationFrame(step) };
    };
    this.state = { ...this.state, rafId: requestAnimationFrame(step) };
  }

  private cancelRaf(rafId: number): void {
    if (rafId && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(rafId);
    }
  }
}

export const playback = new LitePlaybackClock();
