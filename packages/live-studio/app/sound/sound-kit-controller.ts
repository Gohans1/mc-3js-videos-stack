import {
  isSafeSoundId,
  KIT_CATEGORIES,
  type KitCategoryId,
  type KitCategoryMeta,
  TASTE_REASONS,
} from "../../src/sound-kit-classify.mjs";
import type { RecommendResult, SimilarSoundResult } from "../../src/sound-kit-similar.d.mts";
import type {
  KitAbResolveInput,
  KitDecision,
  KitItem,
  KitItemInput,
  KitUseInput,
  SoundKitState,
} from "../../src/sound-kit.d.mts";
import type { ExternalAuditionSource } from "./audition-controller";
import type { ClipRef } from "./slice";
import type { Bed, Lanes, LibraryItem, OneShot } from "./sound";
import { toggleAbSlot } from "./sound-kit-view";
import { inferClipTrackRole, inferTrackRole } from "./tracks";

export type VideoPreviewState =
  | {
      active: false;
      soundId: null;
      mode: null;
      targetLabel: null;
      targetClip: null;
      originalClipName: null;
    }
  | {
      active: true;
      soundId: string;
      mode: "clip";
      targetLabel: string;
      targetClip: ClipRef;
      originalClipName: string | null;
    }
  | {
      active: true;
      soundId: string;
      mode: "playhead";
      targetLabel: string;
      targetClip: null;
      originalClipName: null;
    };

export interface SoundKitSnapshot {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  warning: string | null;
  state: SoundKitState;
  stateRev: number;
  categories: readonly KitCategoryMeta[];
  reasons: readonly string[];
  videoPreview: VideoPreviewState;
  videoPreviewPendingId: string | null;
  loudnessPlayingId: string | null;
  abLoudnessMatch: boolean;
  canUndo: boolean;
  canRedo: boolean;
  lastUndoLabel: string | null;
  lastRedoLabel: string | null;
}

export interface AudioBufferLike {
  duration: number;
  numberOfChannels: number;
  getChannelData: (ch: number) => ArrayLike<number>;
}

export interface BufferSourceLike {
  buffer: AudioBufferLike | null;
  onended: ((...args: never[]) => unknown) | null;
  connect: (dest: never) => unknown;
  disconnect: () => void;
  start: (when?: number, offset?: number) => void;
  stop: () => void;
}

export interface GainNodeLike {
  gain: { value: number };
  connect: (dest: never) => unknown;
  disconnect: () => void;
}

export interface SoundKitControllerDeps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  postJson: (url: string, body: unknown) => Promise<Response>;
  say: (msg: string, ms?: number) => void;
  getLanes: () => Lanes | null;
  getSelectedClip: () => ClipRef | null;
  getPlayhead: () => number;
  getPlaying: () => boolean;
  getDuration: () => number;
  stamp: (sec: number) => string;
  r3: (n: number) => number;
  isEditableSoundClip: (clip: ClipRef | null) => clip is ClipRef;
  span: (clip: ClipRef) => [number, number];
  itemOf: (name: string) => LibraryItem | undefined;
  ensureLibrary?: () => Promise<void>;
  kindOf: (item: LibraryItem) => "bgm" | "sfx" | "mc";
  seconds: (name: string) => number;
  snapshot: () => string;
  preview: (fn: (l: Lanes) => void) => void;
  restore: (snap: string) => void;
  edit: (fn: (l: Lanes) => void) => void;
  addClip: (name: string, at: number) => void;
  decoded: (name: string) => Promise<AudioBufferLike | null>;
  listen: (name: string) => void;
  listening: () => string | null;
  attachExternalAudition?: (src: ExternalAuditionSource) => void;
  releaseExternalAudition?: (src: ExternalAuditionSource, keepTarget?: boolean) => void;
  stopAudition: () => void;
  resumeAudio: () => void;
  getAudio: () => {
    ctx: {
      currentTime?: number;
      createBufferSource: () => BufferSourceLike;
      createGain: () => GainNodeLike;
    };
    master: unknown;
  };
  seek: (sec: number) => void;
  setPlaying: (playing: boolean) => void;
}

const EMPTY_STATE: SoundKitState = {
  version: 1,
  items: {},
  abSlots: [],
  decisions: [],
};

const INACTIVE_PREVIEW: VideoPreviewState = {
  active: false,
  soundId: null,
  mode: null,
  targetLabel: null,
  targetClip: null,
  originalClipName: null,
};

const sameClip = (a: ClipRef | null, b: ClipRef | null): boolean =>
  a === b || (a !== null && b !== null && a.list === b.list && a.i === b.i);

const applyClipSoundReset = (
  target: Bed | OneShot,
  list: "beds" | "sfx",
  name: string,
  narration?: string,
  tryAlts?: readonly string[],
) => {
  target.name = name;
  if (tryAlts?.length) target.try = [...tryAlts];
  else delete target.try;
  delete target.beats;
  delete target.beatMode;
  delete target.bpm;
  delete target.beatSource;
  delete target.start;
  if (list === "sfx") {
    delete (target as OneShot).length;
    if (name !== narration) delete (target as OneShot).dialogue;
  }
};

const analyzeBuffer = (buf: AudioBufferLike): { rmsDb: number; peak: number } => {
  let sum = 0;
  let count = 0;
  let peak = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch += 1) {
    const data = buf.getChannelData(ch);
    const step = Math.max(1, Math.floor(data.length / 24_000));
    for (let i = 0; i < data.length; i += step) {
      const s = data[i] ?? 0;
      const abs = Math.abs(s);
      if (abs > peak) peak = abs;
      sum += s * s;
      count += 1;
    }
  }
  return { rmsDb: 10 * Math.log10(sum / Math.max(1, count) || 1e-12), peak };
};

const readErrorText = async (r: Response, fallback: string) => {
  try {
    const body = (await r.json()) as { error?: string };
    return body.error || fallback;
  } catch {
    return fallback;
  }
};

export const createSoundKitController = (deps: SoundKitControllerDeps) => {
  let snap: SoundKitSnapshot = {
    loaded: false,
    loading: false,
    error: null,
    warning: null,
    state: EMPTY_STATE,
    stateRev: 0,
    categories: KIT_CATEGORIES,
    reasons: TASTE_REASONS,
    videoPreview: INACTIVE_PREVIEW,
    videoPreviewPendingId: null,
    loudnessPlayingId: null,
    abLoudnessMatch: true,
    canUndo: false,
    canRedo: false,
    lastUndoLabel: null,
    lastRedoLabel: null,
  };

  interface KitHistoryEntry {
    label: string;
    beforeItems: Record<string, KitItem | null>;
    afterItems: Record<string, KitItem | null>;
    beforeAb: string[];
    afterAb: string[];
    beforeDecisions?: KitDecision[];
    afterDecisions?: KitDecision[];
  }
  const MAX_HISTORY = 50;
  const undoStack: KitHistoryEntry[] = [];
  const redoStack: KitHistoryEntry[] = [];
  const ownItemClone = (items: Readonly<Record<string, KitItem>>, id: string): KitItem | null =>
    Object.hasOwn(items, id) ? structuredClone(items[id]!) : null;
  const captureItems = (items: Readonly<Record<string, KitItem>>, ids: readonly string[]) => {
    const out: Record<string, KitItem | null> = {};
    for (const id of ids) out[id] = ownItemClone(items, id);
    return out;
  };
  const syncHistory = () => {
    patch({
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      lastUndoLabel: undoStack.at(-1)?.label ?? null,
      lastRedoLabel: redoStack.at(-1)?.label ?? null,
    });
  };
  const recordHistory = (
    label: string,
    ids: readonly string[],
    beforeState: SoundKitState,
    afterState: SoundKitState,
  ) => {
    const uniqueIds = [...new Set(ids)];
    const beforeItems = captureItems(beforeState.items, uniqueIds);
    const afterItems = captureItems(afterState.items, uniqueIds);
    const beforeAb = [...beforeState.abSlots];
    const afterAb = [...afterState.abSlots];
    const decisionsChanged =
      JSON.stringify(beforeState.decisions) !== JSON.stringify(afterState.decisions);
    if (
      !decisionsChanged &&
      JSON.stringify(beforeItems) === JSON.stringify(afterItems) &&
      JSON.stringify(beforeAb) === JSON.stringify(afterAb)
    ) {
      return;
    }
    undoStack.push({
      label,
      beforeItems,
      afterItems,
      beforeAb,
      afterAb,
      ...(decisionsChanged && {
        beforeDecisions: structuredClone(beforeState.decisions),
        afterDecisions: structuredClone(afterState.decisions),
      }),
    });
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
    syncHistory();
  };
  const itemActionLabel = (input: KitItemInput) => {
    if (input.status === "core") return "Keep";
    if (input.status === "pass") return "Pass";
    if (input.status === "ban") return "Ban";
    if (input.status === "inbox") return "Restore to Inbox";
    if (input.tier !== undefined) return input.tier === 1 ? "Mark Signature" : "Unmark Signature";
    if (input.tags !== undefined) return "Edit tags";
    if (input.note !== undefined) return "Edit note";
    return "Update sound";
  };

  const listeners = new Set<() => void>();
  const emit = () => {
    for (const fn of listeners) fn();
  };
  const patch = (next: Partial<SoundKitSnapshot>) => {
    snap = { ...snap, ...next };
    emit();
  };

  const subscribe = (fn: () => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  };
  const getSnapshot = () => snap;

  type KitLoadState =
    | { status: "idle"; seq: number }
    | { status: "loading"; seq: number; loaded: boolean; promise: Promise<void> }
    | { status: "ready"; seq: number }
    | { status: "error"; seq: number; loaded: boolean; error: string };
  let kitLoad: KitLoadState = { status: "idle", seq: 0 };
  const kitLoadLoaded = (s: KitLoadState): boolean =>
    s.status === "ready" || ((s.status === "loading" || s.status === "error") && s.loaded);
  const projectKitLoad = (
    s: KitLoadState,
  ): Pick<SoundKitSnapshot, "loaded" | "loading" | "error"> => {
    switch (s.status) {
      case "idle":
        return { loaded: false, loading: false, error: null };
      case "loading":
        return { loaded: s.loaded, loading: !s.loaded, error: null };
      case "ready":
        return { loaded: true, loading: false, error: null };
      case "error":
        return { loaded: s.loaded, loading: false, error: s.error };
    }
  };
  const setKitLoad = (next: KitLoadState, extra: Partial<SoundKitSnapshot> = {}) => {
    kitLoad = next;
    patch({ ...projectKitLoad(next), ...extra });
  };
  let mutationChain: Promise<unknown> = Promise.resolve();
  let lastStateJson = JSON.stringify(EMPTY_STATE);

  const enqueueMutation = <T>(run: () => Promise<T>): Promise<T> => {
    const next = mutationChain.then(run, run);
    mutationChain = next.catch(() => {});
    return next;
  };

  const applyServerState = (next: SoundKitState) => {
    const nextJson = JSON.stringify(next);
    const changed = nextJson !== lastStateJson;
    lastStateJson = nextJson;
    setKitLoad(
      { status: "ready", seq: kitLoad.seq + 1 },
      {
        state: next,
        stateRev: changed ? snap.stateRev + 1 : snap.stateRev,
        warning: null,
      },
    );
  };

  const reloadSoundKit = (): Promise<void> => {
    const seq = kitLoad.seq + 1;
    const loaded = kitLoadLoaded(kitLoad);
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    setKitLoad({ status: "loading", seq, loaded, promise });
    void (async () => {
      try {
        const r = await deps.fetch("/api/sound-kit", { cache: "no-store" });
        if (kitLoad.seq !== seq) return;
        if (!r.ok) {
          const error = await readErrorText(r, `Could not load Core Sound Kit (${r.status})`);
          if (kitLoad.seq !== seq) return;
          setKitLoad({ status: "error", seq, loaded, error });
          return;
        }
        const body = (await r.json()) as {
          state?: SoundKitState;
          categories?: KitCategoryMeta[];
          reasons?: string[];
          warning?: string;
        };
        if (kitLoad.seq !== seq) return;
        const nextState = body.state ?? EMPTY_STATE;
        const nextJson = JSON.stringify(nextState);
        const changed = nextJson !== lastStateJson;
        lastStateJson = nextJson;
        setKitLoad(
          { status: "ready", seq },
          {
            warning: body.warning ?? null,
            state: nextState,
            stateRev: changed ? snap.stateRev + 1 : snap.stateRev,
            categories: body.categories?.length ? body.categories : KIT_CATEGORIES,
            reasons: body.reasons?.length ? body.reasons : TASTE_REASONS,
          },
        );
      } catch {
        if (kitLoad.seq !== seq) return;
        setKitLoad({
          status: "error",
          seq,
          loaded,
          error: "Could not connect to Live Studio for Core Sound Kit",
        });
      } finally {
        resolve();
      }
    })();
    return promise;
  };

  const ensureLoaded = (): Promise<void> => {
    if (kitLoadLoaded(kitLoad)) return Promise.resolve();
    if (kitLoad.status === "loading") return kitLoad.promise;
    return reloadSoundKit();
  };

  const saveKitItem = (input: KitItemInput): Promise<SoundKitState | null> =>
    enqueueMutation(async () => {
      const before = snap.state;
      try {
        const r = await deps.postJson("/api/sound-kit/item", input);
        if (!r.ok) {
          deps.say(await readErrorText(r, "Could not save sound kit item"), 4000);
          return null;
        }
        const next = (await r.json()) as SoundKitState;
        applyServerState(next);
        recordHistory(itemActionLabel(input), [input.id], before, next);
        return next;
      } catch {
        deps.say("Could not save sound kit item", 4000);
        return null;
      }
    });

  const batchKitItems = (
    items: KitItemInput[],
    skipExisting = false,
  ): Promise<{ state: SoundKitState; added: number; updated: number; skipped: number } | null> =>
    enqueueMutation(async () => {
      const before = snap.state;
      try {
        const r = await deps.postJson("/api/sound-kit/batch", { items, skipExisting });
        if (!r.ok) {
          deps.say(await readErrorText(r, "Could not update sound kit"), 4000);
          return null;
        }
        const res = (await r.json()) as {
          state: SoundKitState;
          added: number;
          updated: number;
          skipped: number;
        };
        applyServerState(res.state);
        recordHistory(
          `Update ${items.length} sounds`,
          items.map((x) => x.id),
          before,
          res.state,
        );
        return res;
      } catch {
        deps.say("Could not update sound kit", 4000);
        return null;
      }
    });

  const removeKitItem = (id: string): Promise<SoundKitState | null> =>
    enqueueMutation(async () => {
      const before = snap.state;
      try {
        const r = await deps.fetch(`/api/sound-kit/item/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        if (!r.ok) {
          deps.say(await readErrorText(r, "Could not remove sound kit item"), 4000);
          return null;
        }
        const next = (await r.json()) as SoundKitState;
        applyServerState(next);
        recordHistory("Remove from kit", [id], before, next);
        return next;
      } catch {
        deps.say("Could not remove sound kit item", 4000);
        return null;
      }
    });

  const saveKitAb = (slots: string[]): Promise<SoundKitState | null> =>
    enqueueMutation(async () => {
      const before = snap.state;
      try {
        const r = await deps.postJson("/api/sound-kit/ab", { slots });
        if (!r.ok) {
          deps.say(await readErrorText(r, "Could not update A/B tray"), 4000);
          return null;
        }
        const next = (await r.json()) as SoundKitState;
        applyServerState(next);
        recordHistory("Update A/B tray", [], before, next);
        return next;
      } catch {
        deps.say("Could not update A/B tray", 4000);
        return null;
      }
    });

  const toggleKitAbSlot = (id: string): Promise<SoundKitState | null> =>
    enqueueMutation(async () => {
      const before = snap.state;
      const nextSlots = toggleAbSlot(before.abSlots, id);
      try {
        const r = await deps.postJson("/api/sound-kit/ab", { slots: nextSlots });
        if (!r.ok) {
          deps.say(await readErrorText(r, "Could not update A/B tray"), 4000);
          return null;
        }
        const next = (await r.json()) as SoundKitState;
        applyServerState(next);
        recordHistory(
          nextSlots.includes(id) ? "Add to A/B tray" : "Remove from A/B tray",
          [],
          before,
          next,
        );
        return next;
      } catch {
        deps.say("Could not update A/B tray", 4000);
        return null;
      }
    });

  const resolveKitAb = (resolve: KitAbResolveInput): Promise<SoundKitState | null> =>
    enqueueMutation(async () => {
      const before = snap.state;
      try {
        const r = await deps.postJson("/api/sound-kit/ab", { resolve });
        if (!r.ok) {
          deps.say(await readErrorText(r, "Could not record A/B winner"), 4000);
          return null;
        }
        const next = (await r.json()) as SoundKitState;
        applyServerState(next);
        recordHistory(
          "Pick A/B winner",
          [resolve.winner, ...(resolve.rejected ?? [])],
          before,
          next,
        );
        return next;
      } catch {
        deps.say("Could not record A/B winner", 4000);
        return null;
      }
    });

  const applyHistoryTarget = async (
    itemsMap: Record<string, KitItem | null>,
    targetAb: string[],
    decisions?: KitDecision[],
  ): Promise<SoundKitState | null> => {
    const r = await deps.postJson("/api/sound-kit/restore", {
      items: itemsMap,
      abSlots: targetAb,
      ...(decisions !== undefined && { decisions }),
    });
    if (!r.ok) {
      deps.say(await readErrorText(r, "Could not undo/redo kit change"), 4000);
      return null;
    }
    const latest = (await r.json()) as SoundKitState;
    applyServerState(latest);
    return latest;
  };

  const undoKit = (): Promise<SoundKitState | null> =>
    enqueueMutation(async () => {
      const entry = undoStack.pop();
      if (!entry) return null;
      try {
        const next = await applyHistoryTarget(
          entry.beforeItems,
          entry.beforeAb,
          entry.beforeDecisions,
        );
        if (!next) {
          undoStack.push(entry);
          syncHistory();
          return null;
        }
        redoStack.push(entry);
        syncHistory();
        deps.say(`Undid: ${entry.label}`);
        return next;
      } catch {
        undoStack.push(entry);
        syncHistory();
        deps.say("Could not undo kit change", 4000);
        return null;
      }
    });

  const redoKit = (): Promise<SoundKitState | null> =>
    enqueueMutation(async () => {
      const entry = redoStack.pop();
      if (!entry) return null;
      try {
        const next = await applyHistoryTarget(
          entry.afterItems,
          entry.afterAb,
          entry.afterDecisions,
        );
        if (!next) {
          redoStack.push(entry);
          syncHistory();
          return null;
        }
        undoStack.push(entry);
        syncHistory();
        deps.say(`Redid: ${entry.label}`);
        return next;
      } catch {
        redoStack.push(entry);
        syncHistory();
        deps.say("Could not redo kit change", 4000);
        return null;
      }
    });

  const recordKitUse = (input: KitUseInput): Promise<SoundKitState | null> =>
    enqueueMutation(async () => {
      try {
        const r = await deps.postJson("/api/sound-kit/use", input);
        if (!r.ok) return null;
        const next = (await r.json()) as SoundKitState;
        if (Object.hasOwn(next.items, input.id)) applyServerState(next);
        return next;
      } catch {
        return null;
      }
    });

  const fetchSimilarKit = async (
    name: string,
    opts?: { limit?: number; excludeCore?: boolean; signal?: AbortSignal },
  ): Promise<SimilarSoundResult | null> => {
    try {
      const params = new URLSearchParams({ name });
      if (opts?.limit) params.set("limit", String(opts.limit));
      if (opts?.excludeCore) params.set("excludeCore", "1");
      const r = await deps.fetch(`/api/sound-kit/similar?${params.toString()}`, {
        cache: "no-store",
        signal: opts?.signal,
      });
      if (!r.ok) return null;
      return (await r.json()) as SimilarSoundResult;
    } catch {
      return null;
    }
  };

  const fetchRecommendedKit = async (opts?: {
    category?: KitCategoryId | null;
    q?: string;
    top?: number;
    ref?: string;
    recent?: readonly string[];
    signal?: AbortSignal;
  }): Promise<RecommendResult | null> => {
    try {
      const params = new URLSearchParams();
      if (opts?.category) params.set("category", opts.category);
      if (opts?.q) params.set("q", opts.q);
      if (opts?.top) params.set("top", String(opts.top));
      if (opts?.ref) params.set("ref", opts.ref);
      if (opts?.recent?.length) params.set("recent", opts.recent.join(","));
      const r = await deps.fetch(`/api/sound-kit/recommend?${params.toString()}`, {
        cache: "no-store",
        signal: opts?.signal,
      });
      if (!r.ok) return null;
      return (await r.json()) as RecommendResult;
    } catch {
      return null;
    }
  };

  type CachedBuffer = { buf: AudioBufferLike; rmsDb: number; peak: number };
  type BufferPlayback =
    | { kind: "idle" }
    | {
        kind: "playing";
        seq: number;
        name: string;
        cached: CachedBuffer;
        duration: number;
        startedAt: number;
        src: BufferSourceLike;
        gain: GainNodeLike;
        handle: ExternalAuditionSource;
      }
    | {
        kind: "paused";
        name: string;
        cached: CachedBuffer;
        duration: number;
        pausedAt: number;
        handle: ExternalAuditionSource | null;
      };
  type VideoPreviewTarget =
    | { mode: "clip"; clip: ClipRef; originalClipName: string | null; from: number; label: string }
    | { mode: "playhead"; anchorAt: number; label: string };
  type VideoPreviewSession =
    | { kind: "idle" }
    | { kind: "loading"; seq: number; soundId: string; baseSnap: string; target: VideoPreviewTarget }
    | {
        kind: "active";
        seq: number;
        soundId: string;
        baseSnap: string;
        target: VideoPreviewTarget;
        pendingSoundId: string | null;
      };

  const decodedCache = new Map<string, CachedBuffer>();
  const warming = new Set<string>();
  let cacheEpoch = 0;
  let bufferState: BufferPlayback = { kind: "idle" };
  let bufferSeq = 0;
  const audioNowSec = () => {
    const t = deps.getAudio().ctx.currentTime;
    return typeof t === "number" && Number.isFinite(t) ? t : performance.now() / 1000;
  };
  const currentBufferTime = () => {
    if (bufferState.kind === "playing") {
      return Math.min(bufferState.duration, Math.max(0, audioNowSec() - bufferState.startedAt));
    }
    if (bufferState.kind === "paused") {
      return Math.min(bufferState.duration, Math.max(0, bufferState.pausedAt));
    }
    return 0;
  };

  const clearAudioCache = () => {
    cacheEpoch += 1;
    decodedCache.clear();
    warming.clear();
  };

  const warmAbAudio = (slots: readonly string[]) => {
    const epoch = cacheEpoch;
    for (const id of slots.slice(0, 4)) {
      if (decodedCache.has(id) || warming.has(id)) continue;
      warming.add(id);
      void deps
        .decoded(id)
        .then((buf) => {
          if (!buf || epoch !== cacheEpoch) return;
          if (decodedCache.size >= 32) {
            const oldest = decodedCache.keys().next().value;
            if (oldest) decodedCache.delete(oldest);
          }
          const { rmsDb, peak } = analyzeBuffer(buf);
          decodedCache.set(id, { buf, rmsDb, peak });
        })
        .finally(() => {
          if (epoch === cacheEpoch) warming.delete(id);
        });
    }
  };

  const setAbLoudnessMatch = (on: boolean) => {
    patch({ abLoudnessMatch: on });
  };

  const disconnectPlayingNode = (src: BufferSourceLike, gain: GainNodeLike) => {
    try {
      src.onended = null;
      src.stop();
    } catch {}
    try {
      src.disconnect();
    } catch {}
    try {
      gain.disconnect();
    } catch {}
  };

  const stopMiniStudioBuffer = (keepTarget = false) => {
    bufferSeq += 1;
    const prev = bufferState;
    if (prev.kind === "playing") {
      disconnectPlayingNode(prev.src, prev.gain);
    }
    const prevHandle = prev.kind === "idle" ? null : prev.handle;
    if (keepTarget && prev.kind !== "idle") {
      bufferState = {
        kind: "paused",
        name: prev.name,
        cached: prev.cached,
        duration: prev.duration,
        pausedAt: prev.kind === "paused" ? prev.pausedAt : 0,
        handle: prev.handle,
      };
    } else {
      bufferState = { kind: "idle" };
    }
    if (snap.loudnessPlayingId !== null) patch({ loudnessPlayingId: null });
    if (prevHandle) deps.releaseExternalAudition?.(prevHandle, keepTarget);
  };

  const pauseMiniStudioBuffer = () => {
    if (bufferState.kind !== "playing") return;
    const pausedAt = currentBufferTime();
    const { name, cached, duration, handle, src, gain } = bufferState;
    bufferSeq += 1;
    disconnectPlayingNode(src, gain);
    bufferState = { kind: "paused", name, cached, duration, pausedAt, handle };
    if (snap.loudnessPlayingId !== null) patch({ loudnessPlayingId: null });
    deps.attachExternalAudition?.(handle);
  };

  let videoSession: VideoPreviewSession = { kind: "idle" };
  const getVideoSession = (): VideoPreviewSession => videoSession;
  let videoPreviewSeq = 0;
  let mountedWorkbenches = 0;

  const projectVideoSession = (
    s: VideoPreviewSession,
  ): Pick<SoundKitSnapshot, "videoPreview" | "videoPreviewPendingId"> => {
    switch (s.kind) {
      case "idle":
        return { videoPreview: INACTIVE_PREVIEW, videoPreviewPendingId: null };
      case "loading":
        return { videoPreview: INACTIVE_PREVIEW, videoPreviewPendingId: s.soundId };
      case "active":
        return {
          videoPreviewPendingId: s.pendingSoundId,
          videoPreview:
            s.target.mode === "clip"
              ? {
                  active: true,
                  soundId: s.soundId,
                  mode: "clip",
                  targetLabel: s.target.label,
                  targetClip: { ...s.target.clip },
                  originalClipName: s.target.originalClipName,
                }
              : {
                  active: true,
                  soundId: s.soundId,
                  mode: "playhead",
                  targetLabel: s.target.label,
                  targetClip: null,
                  originalClipName: null,
                },
        };
    }
  };

  const setVideoSession = (next: VideoPreviewSession) => {
    videoSession = next;
    patch(projectVideoSession(next));
  };

  const sessionTargetClip = (s: VideoPreviewSession): ClipRef | null =>
    s.kind !== "idle" && s.target.mode === "clip" ? s.target.clip : null;

  const handleDocMutated = (docName?: string) => {
    if (docName && docName !== "sound") return;
    if (videoSession.kind !== "idle") {
      videoPreviewSeq += 1;
      setVideoSession({ kind: "idle" });
    }
  };

  const stopVideoPreview = (pauseVideo = false) => {
    videoPreviewSeq += 1;
    const prev = videoSession;
    if (prev.kind !== "idle") {
      setVideoSession({ kind: "idle" });
    }
    if (prev.kind === "active") {
      deps.restore(prev.baseSnap);
    }
    if (pauseVideo && deps.getPlaying()) deps.setPlaying(false);
  };

  const stopVideoPreviewIfTarget = (clip: ClipRef) => {
    if (sameClip(sessionTargetClip(videoSession), clip)) {
      stopVideoPreview(false);
    }
  };

  const acquireWorkbenchMount = () => {
    mountedWorkbenches += 1;
    return () => {
      mountedWorkbenches = Math.max(0, mountedWorkbenches - 1);
      queueMicrotask(() => {
        if (mountedWorkbenches === 0) {
          stopVideoPreview(false);
        }
      });
    };
  };

  const startLoudnessBuffer = (name: string, cached: CachedBuffer, offsetSec: number) => {
    bufferSeq += 1;
    const existingHandle = bufferState.kind !== "idle" ? bufferState.handle : null;
    if (bufferState.kind === "playing") {
      disconnectPlayingNode(bufferState.src, bufferState.gain);
      bufferState = { kind: "idle" };
    }
    deps.resumeAudio();
    const { ctx, master } = deps.getAudio();
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = cached.buf;
    const targetScale = 10 ** ((-16 - cached.rmsDb) / 20);
    const peakCap = cached.peak > 0 ? 0.95 / cached.peak : 3;
    const scale = Math.min(3, peakCap, Math.max(0.2, targetScale));
    gain.gain.value = scale;
    (src.connect as (d: GainNodeLike) => GainNodeLike)(gain);
    (gain.connect as (d: unknown) => unknown)(master);
    const duration = Math.max(0.01, cached.buf.duration || deps.seconds(name) || 0.01);
    const clampedOffset = Math.min(Math.max(0, duration - 0.02), Math.max(0, offsetSec));
    const seq = ++bufferSeq;
    const handle: ExternalAuditionSource =
      existingHandle && existingHandle.id === name
        ? existingHandle
        : {
            id: name,
            duration,
            currentTime: () => currentBufferTime(),
            isPlaying: () => bufferState.kind === "playing" && bufferState.name === name,
            toggle: () => {
              if (bufferState.kind === "playing" && bufferState.name === name) {
                pauseMiniStudioBuffer();
              } else {
                const live = decodedCache.get(name);
                const offset = bufferState.kind === "paused" ? bufferState.pausedAt : 0;
                if (live) startLoudnessBuffer(name, live, offset);
                else {
                  stopMiniStudioBuffer(false);
                  deps.listen(name);
                }
              }
            },
            seek: (toSeconds: number) => {
              const target = Math.min(Math.max(0, duration - 0.02), Math.max(0, toSeconds));
              if (bufferState.kind === "playing" && bufferState.name === name) {
                const live = decodedCache.get(name) ?? bufferState.cached;
                startLoudnessBuffer(name, live, target);
              } else if (bufferState.kind === "paused" && bufferState.name === name) {
                bufferState = { ...bufferState, pausedAt: target };
              }
            },
            stop: () => {
              if (bufferState.kind === "idle" || bufferState.handle !== handle) return;
              bufferSeq += 1;
              if (bufferState.kind === "playing") {
                disconnectPlayingNode(bufferState.src, bufferState.gain);
              }
              bufferState = { kind: "idle" };
              if (snap.loudnessPlayingId !== null) patch({ loudnessPlayingId: null });
            },
          };
    handle.duration = duration;
    bufferState = {
      kind: "playing",
      seq,
      name,
      cached,
      duration,
      startedAt: audioNowSec() - clampedOffset,
      src,
      gain,
      handle,
    };
    patch({ loudnessPlayingId: name });
    deps.attachExternalAudition?.(handle);
    src.onended = () => {
      try {
        src.disconnect();
      } catch {}
      try {
        gain.disconnect();
      } catch {}
      if (bufferState.kind === "playing" && bufferState.seq === seq) {
        bufferState = {
          kind: "paused",
          name,
          cached,
          duration,
          pausedAt: 0,
          handle,
        };
        patch({ loudnessPlayingId: null });
        deps.releaseExternalAudition?.(handle, true);
      }
    };
    if (clampedOffset > 0) src.start(0, clampedOffset);
    else src.start(0);
  };

  const playKitSound = (name: string, opts?: { forcePlay?: boolean; loudnessMatch?: boolean }) => {
    stopVideoPreview(true);
    const wantLoud = Boolean(opts?.loudnessMatch && snap.abLoudnessMatch);
    const cached = wantLoud ? decodedCache.get(name) : undefined;
    const samePlaying = snap.loudnessPlayingId === name || deps.listening() === name;
    if (samePlaying && !opts?.forcePlay) {
      if (bufferState.kind === "playing" && bufferState.name === name) {
        pauseMiniStudioBuffer();
      } else if (deps.listening() === name) {
        deps.listen(name);
      } else {
        stopMiniStudioBuffer(true);
      }
      return;
    }
    if (cached) {
      if (!deps.attachExternalAudition) {
        deps.stopAudition();
      }
      const resumeOffset =
        !opts?.forcePlay && bufferState.kind === "paused" && bufferState.name === name
          ? bufferState.pausedAt
          : 0;
      startLoudnessBuffer(name, cached, resumeOffset);
      return;
    }

    stopMiniStudioBuffer();
    if (wantLoud) warmAbAudio([name]);
    if (opts?.forcePlay && deps.listening() === name) {
      deps.stopAudition();
      deps.listen(name);
      return;
    }
    deps.listen(name);
  };

  const getVideoTargetSummary = (): { mode: "clip" | "playhead"; label: string } => {
    if (snap.videoPreview.active) {
      return { mode: snap.videoPreview.mode, label: snap.videoPreview.targetLabel };
    }
    const clip = deps.getSelectedClip();
    if (deps.isEditableSoundClip(clip)) {
      const [from] = deps.span(clip);
      return { mode: "clip", label: `Clip @ ${deps.stamp(from)}` };
    }
    return { mode: "playhead", label: `Playhead @ ${deps.stamp(deps.getPlayhead())}` };
  };

  const captureVideoTarget = (explicitClip?: ClipRef | null): VideoPreviewTarget => {
    const candidateClip = explicitClip !== undefined ? explicitClip : deps.getSelectedClip();
    if (deps.isEditableSoundClip(candidateClip)) {
      const curLanes = deps.getLanes();
      const curEntry =
        candidateClip.list === "beds"
          ? curLanes?.beds[candidateClip.i]
          : curLanes?.sfx[candidateClip.i];
      const from = deps.span(candidateClip)[0];
      return {
        mode: "clip",
        clip: { ...candidateClip },
        originalClipName: curEntry?.name ?? null,
        from,
        label: `Clip @ ${deps.stamp(from)}`,
      };
    }
    const dur = deps.getDuration();
    const anchorAt = Math.max(0, Math.min(dur, deps.getPlayhead()));
    return {
      mode: "playhead",
      anchorAt,
      label: `Playhead @ ${deps.stamp(anchorAt)}`,
    };
  };

  const previewSoundInVideo = async (
    name: string,
    explicitClip?: ClipRef | null,
  ): Promise<boolean> => {
    if (!deps.getLanes()) {
      deps.say("Audio timeline is not ready yet; auditioning in Studio");
      playKitSound(name, { forcePlay: true, loudnessMatch: true });
      return false;
    }
    deps.stopAudition();
    stopMiniStudioBuffer();
    const seq = ++videoPreviewSeq;

    const requestedClip = explicitClip !== undefined ? explicitClip : deps.getSelectedClip();
    const nextClip = deps.isEditableSoundClip(requestedClip) ? requestedClip : null;
    const prevClip = sessionTargetClip(videoSession);
    const targetChanged = videoSession.kind !== "idle" && !sameClip(prevClip, nextClip);

    if (targetChanged) {
      const prev = videoSession;
      setVideoSession({ kind: "idle" });
      if (prev.kind === "active") deps.restore(prev.baseSnap);
    }

    if (videoSession.kind === "idle") {
      setVideoSession({
        kind: "loading",
        seq,
        soundId: name,
        baseSnap: deps.snapshot(),
        target: captureVideoTarget(explicitClip),
      });
    } else if (videoSession.kind === "loading") {
      setVideoSession({ ...videoSession, seq, soundId: name });
    } else {
      setVideoSession({ ...videoSession, seq, pendingSoundId: name });
    }

    const buf = await deps.decoded(name);
    const currentSession = getVideoSession();
    if (currentSession.kind === "idle" || currentSession.seq !== seq) {
      return false;
    }
    if (!buf) {
      if (currentSession.kind === "loading") {
        setVideoSession({ kind: "idle" });
      } else {
        setVideoSession({ ...currentSession, pendingSoundId: null });
      }
      deps.say(`Could not load audio for ${name}`, 3000);
      return false;
    }

    const { baseSnap, target } = currentSession;
    if (currentSession.kind === "active") deps.restore(baseSnap);
    const item = deps.itemOf(name);
    const isBed = item ? deps.kindOf(item) === "bgm" : buf.duration >= 10;
    const duration = deps.getDuration();
    const fallbackAnchor = target.mode === "playhead" ? target.anchorAt : target.from;
    let playFrom = Math.max(0, fallbackAnchor - 0.25);

    deps.preview((l) => {
      if (target.mode === "clip") {
        const entry = target.clip.list === "beds" ? l.beds[target.clip.i] : l.sfx[target.clip.i];
        if (entry) {
          applyClipSoundReset(entry, target.clip.list, name, l.narration);
          playFrom = Math.max(0, target.from - 0.35);
          return;
        }
      }
      const anchorAt = target.mode === "playhead" ? target.anchorAt : target.from;
      const targetRole = inferClipTrackRole(
        { name },
        isBed ? "beds" : "sfx",
        item,
        l.narration,
        isBed ? undefined : (item?.seconds ?? buf.duration),
      );
      const roleOfClip = (r: { list: "beds" | "sfx"; i: number }) => {
        const c = r.list === "beds" ? l.beds[r.i] : l.sfx[r.i];
        return inferClipTrackRole(c, r.list, deps.itemOf(c.name), l.narration);
      };
      const effectiveRole = (t: (typeof l.tracks)[number]) =>
        !t.role && t.id.startsWith("bgm") ? "bgm" : inferTrackRole(l, t, roleOfClip);
      const isBgmTrack = (t: (typeof l.tracks)[number]) => effectiveRole(t) === "bgm";
      const isSfxTrack = (t: (typeof l.tracks)[number]) =>
        effectiveRole(t) !== "voice" && !isBgmTrack(t);
      const pickTrack = (wantBed: boolean) =>
        l.tracks.find((t) => !t.lock && !t.mute && effectiveRole(t) === targetRole) ??
        l.tracks.find((t) => !t.lock && !t.mute && (wantBed ? isBgmTrack(t) : isSfxTrack(t))) ??
        l.tracks.find((t) => !t.lock && !t.mute && effectiveRole(t) !== "voice") ??
        l.tracks.find((t) => !t.lock && effectiveRole(t) === targetRole) ??
        l.tracks.find((t) => !t.lock && (wantBed ? isBgmTrack(t) : isSfxTrack(t))) ??
        l.tracks.find((t) => !t.lock && effectiveRole(t) !== "voice") ??
        l.tracks.find((t) => !t.lock && !t.mute) ??
        l.tracks.find((t) => !t.lock) ??
        l.tracks[0];
      const trackId = pickTrack(isBed)?.id;
      if (isBed) {
        const len = Math.min(deps.seconds(name) || buf.duration || 10, 12);
        const clampedFrom = Math.min(Math.max(0, duration - 1), anchorAt);
        const from = deps.r3(clampedFrom);
        const to = deps.r3(Math.min(duration, from + Math.max(1, len)));
        const overlapping = l.beds.filter((b) => b.from < to && b.to > from);
        const bedGain = overlapping[0]?.gain ?? -12;
        const bedDuck = overlapping[0]?.duck ?? 10;
        const overlapTrackId = overlapping[0]?.track;
        const overlapTrackBlocked = overlapTrackId
          ? l.tracks.some((t) => t.id === overlapTrackId && (t.mute || t.lock))
          : true;
        const bedTrack = overlapTrackId && !overlapTrackBlocked ? overlapTrackId : trackId;
        l.beds = l.beds.filter((b) => !(b.from < to && b.to > from));
        playFrom = Math.max(0, from - 0.25);
        l.beds.push({
          name,
          from,
          to,
          gain: bedGain,
          fadeIn: 0.15,
          fadeOut: 0.3,
          duck: bedDuck,
          ...(bedTrack ? { track: bedTrack } : {}),
        });
      } else {
        const clampedAt = Math.min(Math.max(0, duration - 0.35), anchorAt);
        const at = deps.r3(clampedAt);
        playFrom = Math.max(0, at - 0.25);
        const idx = l.sfx.findIndex((s) => s.at > at);
        l.sfx.splice(idx < 0 ? l.sfx.length : idx, 0, {
          at,
          name,
          gain: 0,
          ...(trackId ? { track: trackId } : {}),
        });
      }
    });

    setVideoSession({
      kind: "active",
      seq,
      soundId: name,
      baseSnap,
      target,
      pendingSoundId: null,
    });
    deps.seek(playFrom);
    deps.setPlaying(true);
    return true;
  };

  const applyKitSoundToFilm = async (
    name: string,
    category?: KitCategoryId,
    rejected?: readonly string[],
    explicitClip?: ClipRef | null,
  ) => {
    if (!deps.itemOf(name) && deps.ensureLibrary) {
      try {
        await deps.ensureLibrary();
      } catch {}
    }
    if (!deps.itemOf(name)) {
      deps.say(`"${name}" is not available in this film's sound library`, 3500);
      return null;
    }
    const selectedClip = deps.getSelectedClip();
    const activePreviewClip = snap.videoPreview.active ? sessionTargetClip(videoSession) : null;
    const targetClip =
      explicitClip !== undefined
        ? explicitClip
        : deps.isEditableSoundClip(selectedClip)
          ? selectedClip
          : activePreviewClip;
    const anchorAt =
      videoSession.kind === "active" && videoSession.target.mode === "playhead"
        ? videoSession.target.anchorAt
        : deps.getPlayhead();
    stopVideoPreview(true);
    stopMiniStudioBuffer();
    deps.stopAudition();

    const safeRejected = (rejected ?? []).filter((id) => isSafeSoundId(id)).slice(0, 8);
    if (targetClip && deps.isEditableSoundClip(targetClip)) {
      deps.edit((l) => {
        const target = targetClip.list === "beds" ? l.beds[targetClip.i] : l.sfx[targetClip.i];
        if (!target) return;
        applyClipSoundReset(target, targetClip.list, name, l.narration);
      });
      deps.say(`Swapped clip to ${name}`);
      void recordKitUse({
        id: name,
        ...(category ? { category } : {}),
        ...(safeRejected.length ? { rejected: safeRejected } : {}),
        context: "clip-swap",
      });
      return "swapped" as const;
    }
    deps.addClip(name, anchorAt);
    void recordKitUse({
      id: name,
      ...(category ? { category } : {}),
      ...(safeRejected.length ? { rejected: safeRejected } : {}),
      context: "playhead-drop",
    });
    return "added" as const;
  };

  const saveAbSlotsAsClipTry = async (slots: readonly string[], explicitClip?: ClipRef | null) => {
    const safeCandidates = slots.filter((id) => isSafeSoundId(id));
    if (safeCandidates.some((id) => !deps.itemOf(id)) && deps.ensureLibrary) {
      try {
        await deps.ensureLibrary();
      } catch {}
    }
    const selectedClip = deps.getSelectedClip();
    const activePreviewClip = snap.videoPreview.active ? sessionTargetClip(videoSession) : null;
    const targetClip =
      explicitClip !== undefined
        ? explicitClip
        : deps.isEditableSoundClip(selectedClip)
          ? selectedClip
          : activePreviewClip;
    if (!targetClip || !deps.isEditableSoundClip(targetClip)) {
      deps.say("Select an editable sound clip on the timeline first to attach A/B options", 3500);
      return false;
    }
    const validSlots = safeCandidates.filter((id) => Boolean(deps.itemOf(id)));
    if (validSlots.length < 2) {
      deps.say("Add at least 2 library sounds to the A/B tray first", 3000);
      return false;
    }
    stopVideoPreview(true);
    const primary = validSlots[0]!;
    const alternatives = validSlots.slice(1);
    deps.edit((l) => {
      const target = targetClip.list === "beds" ? l.beds[targetClip.i] : l.sfx[targetClip.i];
      if (!target) return;
      applyClipSoundReset(target, targetClip.list, primary, l.narration, alternatives);
    });
    deps.say(`Attached ${validSlots.length} A/B options to clip — switch live on the video canvas`);
    return true;
  };

  return {
    subscribe,
    getSnapshot,
    reloadSoundKit,
    ensureLoaded,
    saveKitItem,
    batchKitItems,
    removeKitItem,
    saveKitAb,
    toggleKitAbSlot,
    resolveKitAb,
    undoKit,
    redoKit,
    recordKitUse,
    fetchSimilarKit,
    fetchRecommendedKit,
    clearAudioCache,
    warmAbAudio,
    setAbLoudnessMatch,
    stopMiniStudioBuffer,
    playKitSound,
    getVideoTargetSummary,
    handleDocMutated,
    stopVideoPreview,
    stopVideoPreviewIfTarget,
    acquireWorkbenchMount,
    previewSoundInVideo,
    applyKitSoundToFilm,
    saveAbSlotsAsClipTry,
  };
};
