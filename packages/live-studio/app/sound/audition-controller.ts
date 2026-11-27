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

  type AuditionSession =
    | { kind: "idle" }
    | {
        kind: "element";
        seq: number;
        id: string;
        url: string;
        playing: boolean;
        range?: { from: number; to: number };
        onError?: () => void;
      }
    | { kind: "external"; id: string; source: ExternalAuditionSource; playing: boolean }
    | { kind: "native"; media: Pick<AuditionAudioLike, "pause"> };

  let session: AuditionSession = { kind: "idle" };
  let auditionRev = 0;
  let auditionSeq = 0;
  let auditionTick: unknown = null;
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

  const teardownNonElement = () => {
    if (session.kind === "native") {
      const media = session.media;
      session = { kind: "idle" };
      media.pause();
    } else if (session.kind === "external") {
      const source = session.source;
      session = { kind: "idle" };
      source.stop();
    }
  };

  const updateProgress = () => {
    if (
      session.kind === "element" &&
      session.range &&
      !audio.paused &&
      audio.currentTime >= session.range.to
    ) {
      audio.pause();
      audio.currentTime = session.range.to;
    }
    notifyAudition();
  };

  const clearBrokenAudition = (seq: number) => {
    if (session.kind !== "element" || session.seq !== seq) return;
    const reportError = session.onError;
    session = { kind: "idle" };
    stopAuditionTick();
    audio.pause();
    notifyAudition();
    deps.onSoundBump();
    if (reportError) reportError();
    else deps.onPlayError("Could not play preview audio");
  };

  const listenUrl = (
    id: string,
    url: string,
    range?: { from: number; to: number },
    onError?: () => void,
  ) => {
    teardownNonElement();
    if (session.kind === "element" && session.id === id && !audio.paused) {
      auditionSeq++;
      stopAuditionTick();
      session = { ...session, seq: 0, playing: false };
      audio.pause();
      notifyAudition();
      deps.onSoundBump();
      return;
    }
    const seq = ++auditionSeq;
    const resuming =
      session.kind === "element" &&
      session.id === id &&
      audio.paused &&
      session.url === url &&
      Boolean(audio.src);
    session = {
      kind: "element",
      seq,
      id,
      url,
      playing: false,
      range,
      onError,
    };
    if (!resuming) {
      audio.src = url;
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
    if (session.kind === "external" && session.id === name) {
      session.source.toggle();
      return;
    }
    listenUrl(name, `/api/sfx/${encodeURIComponent(name)}.wav`);
  };
  const listening = () => {
    if (session.kind === "external") return session.source.isPlaying() ? session.id : "";
    if (session.kind === "element") return session.playing && !audio.paused ? session.id : "";
    return "";
  };
  const auditionTarget = () =>
    session.kind === "element" || session.kind === "external" ? session.id : "";

  const attachExternalAudition = (src: ExternalAuditionSource) => {
    if (session.kind === "native") {
      const media = session.media;
      session = { kind: "idle" };
      media.pause();
    } else if (session.kind === "external" && session.source !== src) {
      const prev = session.source;
      session = { kind: "idle" };
      prev.stop();
    }
    auditionSeq++;
    if (!audio.paused) audio.pause();
    try {
      audio.currentTime = 0;
    } catch {}
    const isPlaying = src.isPlaying();
    session = { kind: "external", id: src.id, source: src, playing: isPlaying };
    if (isPlaying) startAuditionTick();
    else stopAuditionTick();
    notifyAudition();
    deps.onSoundBump();
  };

  const releaseExternalAudition = (src: ExternalAuditionSource, keepTarget = false) => {
    if (session.kind !== "external" || session.source !== src) return;
    stopAuditionTick();
    session = keepTarget ? { ...session, playing: false } : { kind: "idle" };
    notifyAudition();
    deps.onSoundBump();
  };

  const stopAudition = () => {
    const prev = session;
    teardownNonElement();
    if (prev.kind === "idle" && audio.paused) return;
    if (prev.kind === "native" && audio.paused) return;
    auditionSeq++;
    stopAuditionTick();
    session = { kind: "idle" };
    audio.pause();
    try {
      audio.currentTime = 0;
    } catch {}
    notifyAudition();
    deps.onSoundBump();
  };
  const playNativeAudition = (media: Pick<AuditionAudioLike, "pause">) => {
    if (session.kind === "native" && session.media === media) return;
    stopAudition();
    session = { kind: "native", media };
  };
  const releaseNativeAudition = (media: Pick<AuditionAudioLike, "pause">) => {
    if (session.kind === "native" && session.media === media) session = { kind: "idle" };
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
    if (session.kind === "external") {
      const extDur =
        Number.isFinite(session.source.duration) && session.source.duration > 0
          ? session.source.duration
          : 0;
      const known = extDur > 0 || fallbackSeconds > 0;
      if (!known) return { at: 0, duration: 1, known: false };
      const duration = extDur > 0 ? extDur : fallbackSeconds;
      const rawAt = session.source.currentTime();
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
    if (auditionTarget() !== id) return;
    const { duration, known } = auditionProgress(fallbackSeconds);
    if (!known) return;
    const maxSeek = Math.max(0, duration - 0.02);
    const clamped = Math.min(maxSeek, Math.max(0, toSeconds));
    if (session.kind === "external") {
      session.source.seek?.(clamped);
      notifyAudition();
      return;
    }
    audio.currentTime = clamped;
    notifyAudition();
  };

  audio.addEventListener("ended", () => {
    if (session.kind !== "element" || session.seq !== auditionSeq) return;
    stopAuditionTick();
    session = { ...session, playing: false };
    audio.currentTime = 0;
    notifyAudition();
    deps.onSoundBump();
  });
  audio.addEventListener("play", () => {
    if (session.kind !== "element" || session.seq !== auditionSeq) return;
    session = { ...session, playing: true };
    startAuditionTick();
    notifyAudition();
    deps.onSoundBump();
  });
  audio.addEventListener("pause", () => {
    if (session.kind !== "element" || session.seq !== auditionSeq) return;
    stopAuditionTick();
    session = { ...session, playing: false };
    notifyAudition();
    deps.onSoundBump();
  });
  audio.addEventListener("error", () => {
    if (session.kind !== "element" || session.seq !== auditionSeq) return;
    clearBrokenAudition(session.seq);
  });
  audio.addEventListener("timeupdate", () => {
    if (session.kind !== "element" || session.seq !== auditionSeq) return;
    updateProgress();
  });
  audio.addEventListener("loadedmetadata", () => {
    if (session.kind !== "element" || session.seq !== auditionSeq) return;
    if (session.range) audio.currentTime = session.range.from;
    notifyAudition();
  });

  return {
    listenUrl,
    listen,
    listening,
    auditionActive: () =>
      session.kind === "native" ||
      (session.kind === "external" && session.source.isPlaying()) ||
      !audio.paused,
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
