// Single-clip HTML5 Audio audition state machine with async error and race recovery.
export interface AuditionAudioLike {
  src: string;
  paused: boolean;
  duration: number;
  currentTime: number;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, listener: () => void): void;
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

  let auditioning = "";
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
    auditionTick = setTimer(notifyAudition, 80);
  };

  const clearBrokenAudition = (seq: number) => {
    if (seq !== auditionSeq || !auditioning) return;
    stopAuditionTick();
    auditioning = "";
    audio.pause();
    notifyAudition();
    deps.onSoundBump();
    deps.onPlayError("Could not play preview audio");
  };

  const listenUrl = (id: string, url: string) => {
    if (auditioning === id && !audio.paused) {
      auditionSeq++;
      stopAuditionTick();
      auditioning = "";
      audio.pause();
      return;
    }
    const seq = ++auditionSeq;
    auditioning = id;
    audio.src = url;
    try {
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

  const listen = (name: string) => listenUrl(name, `/api/sfx/${encodeURIComponent(name)}.wav`);
  const listening = () => (audio.paused ? "" : auditioning);

  const subscribeAudition = (fn: () => void) => {
    auditionSubs.add(fn);
    return () => {
      auditionSubs.delete(fn);
    };
  };

  const auditionSnapshot = () => auditionRev;

  const auditionProgress = (fallbackSeconds: number) => {
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
    if (auditioning !== id) return;
    const { duration, known } = auditionProgress(fallbackSeconds);
    if (!known) return;
    const maxSeek = Math.max(0, duration - 0.02);
    audio.currentTime = Math.min(maxSeek, Math.max(0, toSeconds));
    notifyAudition();
  };

  audio.addEventListener("ended", () => {
    stopAuditionTick();
    auditioning = "";
    notifyAudition();
    deps.onSoundBump();
  });
  audio.addEventListener("play", () => {
    if (!auditioning) return;
    startAuditionTick();
    notifyAudition();
    deps.onSoundBump();
  });
  audio.addEventListener("pause", () => {
    stopAuditionTick();
    notifyAudition();
    deps.onSoundBump();
  });
  audio.addEventListener("error", () => clearBrokenAudition(auditionSeq));
  audio.addEventListener("timeupdate", notifyAudition);
  audio.addEventListener("loadedmetadata", notifyAudition);

  return {
    listenUrl,
    listen,
    listening,
    subscribeAudition,
    auditionSnapshot,
    auditionProgress,
    seekAudition,
  };
};
