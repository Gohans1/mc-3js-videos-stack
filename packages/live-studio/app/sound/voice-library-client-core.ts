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

type FullSyncState =
  | { kind: "idle" }
  | { kind: "loading"; promise: Promise<void>; queuedReload: boolean; eventDuringLoad: boolean };

type MetaSyncState =
  | { kind: "idle" }
  | { kind: "loading"; promise: Promise<void>; queued: boolean };

type ClientDataState =
  | { kind: "unloaded" }
  | { kind: "ready" };

export const createVoiceLibraryClient = (deps: VoiceLibraryClientDeps) => {
  let snapshot: VoiceLibraryClientState = INITIAL_VOICE_LIBRARY_STATE;
  let fullSync: FullSyncState = { kind: "idle" };
  let metaSync: MetaSyncState = { kind: "idle" };
  let dataState: ClientDataState = { kind: "unloaded" };
  const getFullSync = (): FullSyncState => fullSync;
  const getMetaSync = (): MetaSyncState => metaSync;
  let deferredRefresh: "none" | "meta" | "full" = "none";
  let activeConsumers = 0;
  let cancelTokenWarm: (() => void) | null = null;
  const subs = new Set<() => void>();

  const emit = () => {
    for (const fn of subs) fn();
  };

  const publish = (base: Omit<VoiceLibraryClientState, "loaded" | "loading">) => {
    const next: VoiceLibraryClientState = {
      ...base,
      loaded: dataState.kind === "ready",
      loading: getFullSync().kind === "loading",
    };
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
    if (fullSync.kind === "loading") {
      if (force) fullSync = { ...fullSync, queuedReload: true };
      return fullSync.promise;
    }
    if (!force && dataState.kind === "ready" && snapshot.status === "ready") {
      return Promise.resolve();
    }
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    fullSync = {
      kind: "loading",
      promise,
      queuedReload: false,
      eventDuringLoad: false,
    };
    publish({
      ...snapshot,
      error: dataState.kind === "ready" ? snapshot.error : null,
    });
    void (async () => {
      let nextPayload: Omit<VoiceLibraryClientState, "loaded" | "loading"> | null = null;
      try {
        const res = await deps
          .fetch("/api/voice/library", { signal: AbortSignal.timeout(FULL_TIMEOUT_MS) })
          .catch(() => null);
        if (!res?.ok) {
          nextPayload = {
            ...snapshot,
            error: snapshot.error ?? "Could not load voice library",
          };
          return;
        }
        const body = (await res.json()) as Partial<VoiceLibraryPayload>;
        dataState = { kind: "ready" };
        if (deferredRefresh === "full") deferredRefresh = "none";
        const voices = Array.isArray(body.voices) ? body.voices : snapshot.voices;
        if (voices.length) deps.registerVoiceNames(voices);
        nextPayload = {
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
        };
      } catch {
        nextPayload = {
          ...snapshot,
          error: snapshot.error ?? "Could not load voice library",
        };
      } finally {
        const finished = getFullSync();
        fullSync = { kind: "idle" };
        if (nextPayload) publish(nextPayload);
        if (finished.kind === "loading") {
          if (finished.queuedReload) {
            void loadVoiceLibrary(true);
          } else if (finished.eventDuringLoad) {
            if (!activeConsumers) {
              if (deferredRefresh === "none") deferredRefresh = "meta";
            } else if (dataState.kind !== "ready") {
              void loadVoiceLibrary(false);
            } else {
              void refreshVoiceLibraryMeta();
            }
          }
        }
        resolve();
      }
    })();
    return promise;
  };

  const refreshVoiceLibraryMeta = (): Promise<void> => {
    if (metaSync.kind === "loading") {
      metaSync = { ...metaSync, queued: true };
      return metaSync.promise;
    }
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    metaSync = {
      kind: "loading",
      promise,
      queued: false,
    };
    void (async () => {
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
        const shouldReload = deferredRefresh === "full" || syncedAtChanged || finishedEmpty;
        if (shouldReload) deferredRefresh = "full";

        publish({
          ...snapshot,
          status: nextStatus,
          syncedAt: shouldReload ? prevSyncedAt : nextSyncedAt,
          totalScanned: meta.totalScanned ?? snapshot.totalScanned,
          totalEnglish: meta.totalEnglish ?? snapshot.totalEnglish,
          totalEnglishV4: meta.totalEnglishV4 ?? snapshot.totalEnglishV4,
          pagesLoaded: meta.pagesLoaded ?? snapshot.pagesLoaded,
          hasKey: meta.hasKey ?? snapshot.hasKey,
          error: meta.error === undefined ? snapshot.error : meta.error,
          truncated: meta.truncated ?? snapshot.truncated,
        });

        if (shouldReload) {
          void loadVoiceLibrary(true);
        }
      } catch {
      } finally {
        const finished = getMetaSync();
        metaSync = { kind: "idle" };
        if (finished.kind === "loading" && finished.queued) {
          void refreshVoiceLibraryMeta();
        }
        resolve();
      }
    })();
    return promise;
  };

  const handleVoiceLibraryEvent = () => {
    if (!activeConsumers) {
      if (fullSync.kind === "loading") {
        fullSync = { ...fullSync, eventDuringLoad: true };
      } else if (dataState.kind === "ready" && deferredRefresh === "none") {
        deferredRefresh = "meta";
      }
      return;
    }
    if (fullSync.kind === "loading") {
      fullSync = { ...fullSync, eventDuringLoad: true };
      return;
    }
    if (dataState.kind !== "ready") {
      void loadVoiceLibrary(false);
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
      publish({
        ...snapshot,
        status: body.status ?? "syncing",
        totalScanned: body.totalScanned ?? snapshot.totalScanned,
        totalEnglish: body.totalEnglish ?? snapshot.totalEnglish,
        totalEnglishV4: body.totalEnglishV4 ?? snapshot.totalEnglishV4,
        pagesLoaded: body.pagesLoaded ?? 0,
        hasKey: body.hasKey ?? true,
        error: body.error ?? null,
        truncated: body.truncated ?? snapshot.truncated,
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
    const pending = deferredRefresh;
    if (pending === "meta") deferredRefresh = "none";
    if (dataState.kind !== "ready") {
      if (fullSync.kind === "idle") {
        void loadVoiceLibrary(false);
      } else if (pending !== "none") {
        fullSync = { ...fullSync, eventDuringLoad: true };
      }
    } else if (pending === "full") {
      void loadVoiceLibrary(true);
    } else if (pending === "meta" || snapshot.status === "syncing") {
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
