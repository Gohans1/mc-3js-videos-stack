// Pure client state controller for /api/voice/library (kept DOM-free for Bun unit tests).
import type {
  SharedVoiceEntry,
  VoiceLibraryPayload,
  VoiceLibraryState,
} from "../../src/voice-library.mjs";

export interface VoiceLibraryClientState extends VoiceLibraryPayload {
  truncated: boolean;
  loaded: boolean;
  loading: boolean;
}

export interface VoiceLibraryClientDeps {
  fetch: typeof fetch;
  say: (msg: string) => void;
  registerVoiceNames: (voices: readonly SharedVoiceEntry[]) => void;
  scheduleIdleBatch: (
    total: number,
    step: (start: number, count: number) => number,
    shouldContinue: () => boolean,
  ) => () => void;
  warmVoiceSearchTokens: (
    voices: readonly SharedVoiceEntry[],
    start: number,
    count: number,
  ) => number;
}

const FULL_TIMEOUT_MS = 15_000;
const META_TIMEOUT_MS = 5_000;
const SYNC_TIMEOUT_MS = 10_000;

export const INITIAL_VOICE_LIBRARY_STATE: VoiceLibraryClientState = {
  status: "idle",
  syncedAt: null,
  totalScanned: 0,
  totalEnglish: 0,
  totalEnglishV4: 0,
  pagesLoaded: 0,
  hasKey: false,
  error: null,
  truncated: false,
  voices: [],
  loaded: false,
  loading: false,
};

export const createVoiceLibraryClient = (deps: VoiceLibraryClientDeps) => {
  let snapshot: VoiceLibraryClientState = INITIAL_VOICE_LIBRARY_STATE;
  let inFlight: Promise<void> | null = null;
  let reloadQueued = false;
  let eventDuringLoad = false;
  let hasServerResponse = false;
  let pendingFullReload = false;
  let metaInFlight: Promise<void> | null = null;
  let metaQueued = false;
  let activeConsumers = 0;
  let dirtyWhileHidden = false;
  let cancelTokenWarm: (() => void) | null = null;
  const subs = new Set<() => void>();

  const emit = () => {
    for (const fn of subs) fn();
  };

  const setSnapshot = (next: VoiceLibraryClientState) => {
    const voicesChanged = next.voices !== snapshot.voices;
    snapshot = next;
    if (voicesChanged) {
      cancelTokenWarm?.();
      const target = next.voices;
      cancelTokenWarm = deps.scheduleIdleBatch(
        target.length,
        (idx, batch) => deps.warmVoiceSearchTokens(target, idx, batch),
        () => snapshot.voices === target,
      );
    }
    emit();
  };

  const loadVoiceLibrary = (force = false): Promise<void> => {
    if (inFlight) {
      if (force) reloadQueued = true;
      return inFlight;
    }
    if (!force && snapshot.loaded && snapshot.status === "ready") {
      return Promise.resolve();
    }
    setSnapshot({
      ...snapshot,
      loading: true,
      error: hasServerResponse ? snapshot.error : null,
    });
    inFlight = (async () => {
      try {
        const res = await deps
          .fetch("/api/voice/library", { signal: AbortSignal.timeout(FULL_TIMEOUT_MS) })
          .catch(() => null);
        if (!res?.ok) {
          setSnapshot({
            ...snapshot,
            loaded: hasServerResponse,
            loading: false,
            error: snapshot.error ?? "Could not load voice library",
          });
          return;
        }
        const body = (await res.json()) as Partial<VoiceLibraryPayload>;
        hasServerResponse = true;
        pendingFullReload = false;
        const voices = Array.isArray(body.voices) ? body.voices : snapshot.voices;
        if (voices.length) deps.registerVoiceNames(voices);
        setSnapshot({
          status: body.status ?? "idle",
          syncedAt: body.syncedAt ?? null,
          totalScanned: body.totalScanned ?? 0,
          totalEnglish: body.totalEnglish ?? voices.length,
          totalEnglishV4: body.totalEnglishV4 ?? 0,
          pagesLoaded: body.pagesLoaded ?? 0,
          hasKey: Boolean(body.hasKey),
          error: body.error ?? null,
          truncated: Boolean(body.truncated),
          voices,
          loaded: true,
          loading: false,
        });
      } catch {
        setSnapshot({
          ...snapshot,
          loaded: hasServerResponse,
          loading: false,
          error: snapshot.error ?? "Could not load voice library",
        });
      } finally {
        inFlight = null;
        const queuedReload = reloadQueued;
        const queuedEvent = eventDuringLoad;
        reloadQueued = false;
        eventDuringLoad = false;
        if (queuedReload) {
          void loadVoiceLibrary(true);
        } else if (queuedEvent) {
          if (!snapshot.loaded) void loadVoiceLibrary(false);
          else void refreshVoiceLibraryMeta();
        }
      }
    })();
    return inFlight;
  };

  const refreshVoiceLibraryMeta = (): Promise<void> => {
    if (metaInFlight) {
      metaQueued = true;
      return metaInFlight;
    }
    metaInFlight = (async () => {
      try {
        const res = await deps
          .fetch("/api/voice/library?meta=1", { signal: AbortSignal.timeout(META_TIMEOUT_MS) })
          .catch(() => null);
        if (!res?.ok) return;
        const meta = (await res.json()) as Partial<VoiceLibraryState>;
        const prevSyncedAt = snapshot.syncedAt;
        const nextSyncedAt = meta.syncedAt === undefined ? prevSyncedAt : meta.syncedAt;
        const nextStatus = meta.status ?? snapshot.status;
        const syncedAtChanged = nextSyncedAt !== null && nextSyncedAt !== prevSyncedAt;
        const finishedEmpty =
          nextStatus === "ready" &&
          snapshot.voices.length === 0 &&
          ((meta.totalEnglish ?? 0) > 0 || (meta.totalEnglishV4 ?? 0) > 0);
        const shouldReload = pendingFullReload || syncedAtChanged || finishedEmpty;
        if (shouldReload) pendingFullReload = true;

        setSnapshot({
          ...snapshot,
          status: nextStatus,
          // Withhold syncedAt update until full GET lands matching voices so transient reload failures can retry.
          syncedAt: shouldReload ? prevSyncedAt : nextSyncedAt,
          totalScanned: meta.totalScanned ?? snapshot.totalScanned,
          totalEnglish: meta.totalEnglish ?? snapshot.totalEnglish,
          totalEnglishV4: meta.totalEnglishV4 ?? snapshot.totalEnglishV4,
          pagesLoaded: meta.pagesLoaded ?? snapshot.pagesLoaded,
          hasKey: meta.hasKey ?? snapshot.hasKey,
          error: meta.error === undefined ? snapshot.error : meta.error,
          truncated: meta.truncated ?? snapshot.truncated,
          loading: false,
        });

        if (shouldReload) {
          void loadVoiceLibrary(true);
        }
      } catch {
        // Keep current cached voices intact if metadata polling hits a transient error.
      } finally {
        metaInFlight = null;
        if (metaQueued) {
          metaQueued = false;
          void refreshVoiceLibraryMeta();
        }
      }
    })();
    return metaInFlight;
  };

  const handleVoiceLibraryEvent = () => {
    if (!activeConsumers) {
      if (snapshot.loaded || inFlight) dirtyWhileHidden = true;
      return;
    }
    if (!snapshot.loaded) {
      if (inFlight) {
        eventDuringLoad = true;
      } else {
        void loadVoiceLibrary(false);
      }
      return;
    }
    void refreshVoiceLibraryMeta();
  };

  const syncVoiceLibraryNow = async (): Promise<boolean> => {
    try {
      const res = await deps.fetch("/api/voice/library/sync", {
        method: "POST",
        signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        deps.say(body.error ?? "Could not start voice sync");
        return false;
      }
      const body = (await res.json()) as Partial<VoiceLibraryState>;
      setSnapshot({
        ...snapshot,
        status: body.status ?? "syncing",
        totalScanned: body.totalScanned ?? snapshot.totalScanned,
        totalEnglish: body.totalEnglish ?? snapshot.totalEnglish,
        totalEnglishV4: body.totalEnglishV4 ?? snapshot.totalEnglishV4,
        pagesLoaded: body.pagesLoaded ?? 0,
        hasKey: body.hasKey ?? true,
        error: body.error ?? null,
        truncated: body.truncated ?? snapshot.truncated,
        loading: false,
      });
      return true;
    } catch {
      deps.say("Could not start voice sync");
      return false;
    }
  };

  const subscribe = (fn: () => void) => {
    subs.add(fn);
    return () => {
      subs.delete(fn);
    };
  };

  const acquireConsumer = (): (() => void) => {
    activeConsumers++;
    const wasDirty = dirtyWhileHidden;
    dirtyWhileHidden = false;
    if (!snapshot.loaded) {
      if (!inFlight) {
        void loadVoiceLibrary(false);
      } else if (wasDirty) {
        eventDuringLoad = true;
      }
    } else if (pendingFullReload) {
      void loadVoiceLibrary(true);
    } else if (wasDirty || snapshot.status === "syncing") {
      void refreshVoiceLibraryMeta();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      activeConsumers = Math.max(0, activeConsumers - 1);
    };
  };

  return {
    getSnapshot: () => snapshot,
    subscribe,
    loadVoiceLibrary,
    handleVoiceLibraryEvent,
    syncVoiceLibraryNow,
    acquireConsumer,
  };
};
