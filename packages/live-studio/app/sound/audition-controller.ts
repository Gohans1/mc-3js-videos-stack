export interface AuditionAudioLike {
  src: string;
  paused: boolean;
  duration: number;
  currentTime: number;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, listener: () => void): void;
}

export interface ExternalAuditionSource {
  id: string;
  duration: number;
  currentTime(): number;
  isPlaying(): boolean;
  toggle(): void;
  seek?(toSeconds: number): void;
  stop(): void;
}

export interface AuditionControllerDeps {
  audio: AuditionAudioLike;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  onSoundBump: () => void;
  onPlayError: (message: string) => void;
}

export const createAuditionController = (deps: AuditionControllerDeps) => {
  const { audio } = deps;
  const setTimer = deps.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms));
  const clearTimer =
    deps.clearInterval ??
    ((handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>));

  let target = "";
  let playing = false;
  let auditionRev = 0;
  let auditionSeq = 0;
  let audioOwnedSeq = 0;
  let loadedUrl = "";
  let auditionTick: unknown = null;
  let activeRange: { from: number; to: number } | undefined;
  let onAuditionError: (() => void) | undefined;
  let nativeMedia: Pick<AuditionAudioLike, "pause"> | null = null;
  let external: ExternalAuditionSource | null = null;
  const stopNative = () => {
    const previous = nativeMedia;
    nativeMedia = null;
    previous?.pause();
  };
  const stopExternal = () => {
    const previous = external;
    external = null;
    previous?.stop();
  };
  const auditionSubs = new Set<() => void>();

  const notifyAudition = () => {
    auditionRev++;
    for (const fn of auditionSubs) fn();
  };

  const stopAuditionTick = () => {
    if (auditionTick !== null) {
      clearTimer(auditionTick);
      auditionTick = null;
    }
  };

  const startAuditionTick = () => {
    stopAuditionTick();
    auditionTick = setTimer(updateProgress, 80);
  };
  const updateProgress = () => {
    if (!external && activeRange && !audio.paused && audio.currentTime >= activeRange.to) {
      audio.pause();
      audio.currentTime = activeRange.to;
    }
    notifyAudition();
  };

  const clearBrokenAudition = (seq: number) => {
    if (external || seq !== auditionSeq || !target) return;
    audioOwnedSeq = 0;
    loadedUrl = "";
    stopAuditionTick();
    playing = false;
    target = "";
    activeRange = undefined;
    audio.pause();
    notifyAudition();
    deps.onSoundBump();
    const reportError = onAuditionError;
    onAuditionError = undefined;
    if (reportError) reportError();
    else deps.onPlayError("Could not play preview audio");
  };

  const listenUrl = (
    id: string,
    url: string,
    range?: { from: number; to: number },
    onError?: () => void,
  ) => {
    stopNative();
    const hadExternal = external !== null;
    stopExternal();
    if (!hadExternal && target === id && !audio.paused) {
      auditionSeq++;
      audioOwnedSeq = 0;
      stopAuditionTick();
      playing = false;
      audio.pause();
      notifyAudition();
      deps.onSoundBump();
      return;
    }
    const seq = ++auditionSeq;
    audioOwnedSeq = seq;
    const resuming =
      !hadExternal && target === id && audio.paused && loadedUrl === url && Boolean(audio.src);
    target = id;
    activeRange = range;
    onAuditionError = onError;
    if (!resuming) {
      audio.src = url;
      loadedUrl = url;
    }
    try {
      if (range && (!resuming || audio.currentTime < range.from || audio.currentTime >= range.to)) {
        try {
          audio.currentTime = range.from;
        } catch {}
      }
      const pending = audio.play();
      if (pending && typeof pending.catch === "function") {
        void pending.catch((err: unknown) => {
          if ((err as { name?: string } | null)?.name === "AbortError") return;
          clearBrokenAudition(seq);
        });
      }
    } catch (err) {
      if ((err as { name?: string } | null)?.name !== "AbortError") {
        clearBrokenAudition(seq);
      }
    }
  };

  const listen = (name: string) => {
    if (external && external.id === name) {
      external.toggle();
      return;
    }
    listenUrl(name, `/api/sfx/${encodeURIComponent(name)}.wav`);
  };
  const listening = () =>
    external ? (external.isPlaying() ? target : "") : playing && !audio.paused ? target : "";
  const auditionTarget = () => target;

  const attachExternalAudition = (src: ExternalAuditionSource) => {
    stopNative();
    if (external && external !== src) external.stop();
    auditionSeq++;
    audioOwnedSeq = 0;
    loadedUrl = "";
    if (!audio.paused) audio.pause();
    try {
      audio.currentTime = 0;
    } catch {}
    activeRange = undefined;
    onAuditionError = undefined;
    external = src;
    target = src.id;
    playing = src.isPlaying();
    if (playing) startAuditionTick();
    else stopAuditionTick();
    notifyAudition();
    deps.onSoundBump();
  };

  const releaseExternalAudition = (src: ExternalAuditionSource, keepTarget = false) => {
    if (external !== src) return;
    stopAuditionTick();
    playing = false;
    if (!keepTarget) {
      external = null;
      target = "";
    }
    notifyAudition();
    deps.onSoundBump();
  };

  const stopAudition = () => {
    stopNative();
    const hadExternal = external !== null;
    stopExternal();
    if (!target && audio.paused && !hadExternal) return;
    auditionSeq++;
    audioOwnedSeq = 0;
    loadedUrl = "";
    stopAuditionTick();
    playing = false;
    target = "";
    activeRange = undefined;
    audio.pause();
    try {
      audio.currentTime = 0;
    } catch {}
    onAuditionError = undefined;
    notifyAudition();
    deps.onSoundBump();
  };
  const playNativeAudition = (media: Pick<AuditionAudioLike, "pause">) => {
    if (nativeMedia === media) return;
    stopAudition();
    nativeMedia = media;
  };
  const releaseNativeAudition = (media: Pick<AuditionAudioLike, "pause">) => {
    if (nativeMedia === media) nativeMedia = null;
    media.pause();
  };

  const subscribeAudition = (fn: () => void) => {
    auditionSubs.add(fn);
    return () => {
      auditionSubs.delete(fn);
    };
  };

  const auditionSnapshot = () => auditionRev;

  const auditionProgress = (fallbackSeconds: number) => {
    if (external) {
      const extDur =
        Number.isFinite(external.duration) && external.duration > 0 ? external.duration : 0;
      const known = extDur > 0 || fallbackSeconds > 0;
      if (!known) return { at: 0, duration: 1, known: false };
      const duration = extDur > 0 ? extDur : fallbackSeconds;
      const rawAt = external.currentTime();
      const at = Number.isFinite(rawAt)
        ? Math.min(Math.max(0.01, duration), Math.max(0, rawAt))
        : 0;
      return { at, duration: Math.max(0.01, duration), known: true };
    }
    const liveDur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    const known = liveDur > 0 || fallbackSeconds > 0;
    if (!known) return { at: 0, duration: 1, known: false };
    const duration = liveDur > 0 ? liveDur : fallbackSeconds;
    const at = Number.isFinite(audio.currentTime)
      ? Math.min(Math.max(0.01, duration), Math.max(0, audio.currentTime))
      : 0;
    return { at, duration: Math.max(0.01, duration), known: true };
  };

  const seekAudition = (id: string, toSeconds: number, fallbackSeconds: number) => {
    if (target !== id) return;
    const { duration, known } = auditionProgress(fallbackSeconds);
    if (!known) return;
    const maxSeek = Math.max(0, duration - 0.02);
    const clamped = Math.min(maxSeek, Math.max(0, toSeconds));
    if (external) {
      external.seek?.(clamped);
      notifyAudition();
      return;
    }
    audio.currentTime = clamped;
    notifyAudition();
  };

  audio.addEventListener("ended", () => {
    if (external || audioOwnedSeq !== auditionSeq) return;
    stopAuditionTick();
    playing = false;
    audio.currentTime = 0;
    notifyAudition();
    deps.onSoundBump();
  });
  audio.addEventListener("play", () => {
    if (external || audioOwnedSeq !== auditionSeq || !target) return;
    playing = true;
    startAuditionTick();
    notifyAudition();
    deps.onSoundBump();
  });
  audio.addEventListener("pause", () => {
    if (external || audioOwnedSeq !== auditionSeq) return;
    stopAuditionTick();
    playing = false;
    notifyAudition();
    deps.onSoundBump();
  });
  audio.addEventListener("error", () => {
    if (external || audioOwnedSeq !== auditionSeq) return;
    clearBrokenAudition(audioOwnedSeq);
  });
  audio.addEventListener("timeupdate", () => {
    if (external || audioOwnedSeq !== auditionSeq) return;
    updateProgress();
  });
  audio.addEventListener("loadedmetadata", () => {
    if (external || audioOwnedSeq !== auditionSeq) return;
    if (activeRange) audio.currentTime = activeRange.from;
    notifyAudition();
  });

  return {
    listenUrl,
    listen,
    listening,
    auditionActive: () => Boolean(nativeMedia || external?.isPlaying() || !audio.paused),
    auditionTarget,
    attachExternalAudition,
    releaseExternalAudition,
    stopAudition,
    playNativeAudition,
    releaseNativeAudition,
    subscribeAudition,
    auditionSnapshot,
    auditionProgress,
    seekAudition,
  };
};
