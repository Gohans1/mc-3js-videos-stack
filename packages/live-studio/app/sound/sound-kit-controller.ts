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

export interface VideoPreviewState {
  active: boolean;
  soundId: string | null;
  mode: "clip" | "playhead" | null;
  targetLabel: string | null;
  targetClip: ClipRef | null;
  originalClipName: string | null;
}

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

  let loadSeq = 0;
  let inflight: Promise<void> | null = null;
  let mutationChain: Promise<unknown> = Promise.resolve();
  let lastStateJson = JSON.stringify(EMPTY_STATE);

  const enqueueMutation = <T>(run: () => Promise<T>): Promise<T> => {
    const next = mutationChain.then(run, run);
    mutationChain = next.catch(() => {});
    return next;
  };

  const applyServerState = (next: SoundKitState) => {
    loadSeq += 1;
    const nextJson = JSON.stringify(next);
    const changed = nextJson !== lastStateJson;
    lastStateJson = nextJson;
    patch({
      state: next,
      stateRev: changed ? snap.stateRev + 1 : snap.stateRev,
      loaded: true,
      loading: false,
      error: null,
      warning: null,
    });
  };

  const reloadSoundKit = async (): Promise<void> => {
    const seq = ++loadSeq;
    patch({ loading: !snap.loaded, error: null });
    try {
      const r = await deps.fetch("/api/sound-kit", { cache: "no-store" });
      if (seq !== loadSeq) return;
      if (!r.ok) {
        patch({
          loading: false,
          error: await readErrorText(r, `Could not load Core Sound Kit (${r.status})`),
        });
        return;
      }
      const body = (await r.json()) as {
        state?: SoundKitState;
        categories?: KitCategoryMeta[];
        reasons?: string[];
        warning?: string;
      };
      if (seq !== loadSeq) return;
      const nextState = body.state ?? EMPTY_STATE;
      const nextJson = JSON.stringify(nextState);
      const changed = nextJson !== lastStateJson;
      lastStateJson = nextJson;
      patch({
        loaded: true,
        loading: false,
        error: null,
        warning: body.warning ?? null,
        state: nextState,
        stateRev: changed ? snap.stateRev + 1 : snap.stateRev,
        categories: body.categories?.length ? body.categories : KIT_CATEGORIES,
        reasons: body.reasons?.length ? body.reasons : TASTE_REASONS,
      });
    } catch {
      if (seq !== loadSeq) return;
      patch({ loading: false, error: "Could not connect to Live Studio for Core Sound Kit" });
    }
  };

  const ensureLoaded = (): Promise<void> => {
    if (snap.loaded) return Promise.resolve();
    if (!inflight) {
      inflight = reloadSoundKit().finally(() => {
        inflight = null;
      });
    }
    return inflight;
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

  const decodedCache = new Map<string, { buf: AudioBufferLike; rmsDb: number; peak: number }>();
  const warming = new Set<string>();
  let cacheEpoch = 0;
  let activeBufferSrc: BufferSourceLike | null = null;
  let activeBufferGain: GainNodeLike | null = null;
  let activeBufferName: string | null = null;
  let activeBufferCached: { buf: AudioBufferLike; rmsDb: number; peak: number } | null = null;
  let activeBufferDuration = 0;
  let activeBufferStartedAt: number | null = null;
  let activeBufferPausedAt = 0;
  let activeExternalHandle: ExternalAuditionSource | null = null;
  let bufferSeq = 0;
  const audioNowSec = () => {
    const t = deps.getAudio().ctx.currentTime;
    return typeof t === "number" && Number.isFinite(t) ? t : performance.now() / 1000;
  };
  const currentBufferTime = () => {
    if (activeBufferStartedAt !== null) {
      return Math.min(activeBufferDuration, Math.max(0, audioNowSec() - activeBufferStartedAt));
    }
    return Math.min(activeBufferDuration, Math.max(0, activeBufferPausedAt));
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

  const teardownBufferNode = () => {
    bufferSeq += 1;
    const src = activeBufferSrc;
    const gain = activeBufferGain;
    activeBufferSrc = null;
    activeBufferGain = null;
    activeBufferStartedAt = null;
    if (src) {
      try {
        src.onended = null;
        src.stop();
      } catch {}
      try {
        src.disconnect();
      } catch {}
    }
    if (gain) {
      try {
        gain.disconnect();
      } catch {}
    }
  };

  const stopMiniStudioBuffer = (keepTarget = false) => {
    teardownBufferNode();
    const prevHandle = activeExternalHandle;
    if (!keepTarget) {
      activeExternalHandle = null;
      activeBufferName = null;
      activeBufferCached = null;
      activeBufferDuration = 0;
      activeBufferPausedAt = 0;
    }
    if (snap.loudnessPlayingId !== null) patch({ loudnessPlayingId: null });
    if (prevHandle) deps.releaseExternalAudition?.(prevHandle, keepTarget);
  };

  const pauseMiniStudioBuffer = () => {
    if (!activeBufferSrc) return;
    activeBufferPausedAt = currentBufferTime();
    teardownBufferNode();
    if (snap.loudnessPlayingId !== null) patch({ loudnessPlayingId: null });
    if (activeExternalHandle) deps.attachExternalAudition?.(activeExternalHandle);
  };

  let videoBaseSnap: string | null = null;
  let videoPreviewApplied = false;
  let videoPreviewSeq = 0;
  let videoTargetClip: ClipRef | null = null;
  let videoOriginalClipName: string | null = null;
  let videoTargetFrom = 0;
  let videoAnchorAt = 0;
  let videoTargetLabel = "";
  let mountedWorkbenches = 0;

  const handleDocMutated = (docName?: string) => {
    if (docName && docName !== "sound") return;
    if (videoPreviewApplied || videoBaseSnap !== null || snap.videoPreviewPendingId !== null) {
      videoPreviewSeq += 1;
      videoBaseSnap = null;
      videoPreviewApplied = false;
      videoTargetClip = null;
      videoOriginalClipName = null;
      if (snap.videoPreview.active || snap.videoPreviewPendingId !== null) {
        patch({ videoPreview: INACTIVE_PREVIEW, videoPreviewPendingId: null });
      }
    }
  };

  const stopVideoPreview = (pauseVideo = false) => {
    videoPreviewSeq += 1;
    if (videoPreviewApplied && videoBaseSnap !== null) {
      deps.restore(videoBaseSnap);
    }
    videoBaseSnap = null;
    videoPreviewApplied = false;
    videoTargetClip = null;
    videoOriginalClipName = null;
    if (snap.videoPreview.active || snap.videoPreviewPendingId !== null) {
      patch({ videoPreview: INACTIVE_PREVIEW, videoPreviewPendingId: null });
    }
    if (pauseVideo && deps.getPlaying()) deps.setPlaying(false);
  };

  const stopVideoPreviewIfTarget = (clip: ClipRef) => {
    if (sameClip(videoTargetClip, clip)) {
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

  const startLoudnessBuffer = (
    name: string,
    cached: { buf: AudioBufferLike; rmsDb: number; peak: number },
    offsetSec: number,
  ) => {
    teardownBufferNode();
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
    activeBufferSrc = src;
    activeBufferGain = gain;
    activeBufferName = name;
    activeBufferCached = cached;
    activeBufferDuration = duration;
    activeBufferPausedAt = clampedOffset;
    activeBufferStartedAt = audioNowSec() - clampedOffset;
    const handle: ExternalAuditionSource =
      activeExternalHandle && activeExternalHandle.id === name
        ? activeExternalHandle
        : {
            id: name,
            duration,
            currentTime: () => currentBufferTime(),
            isPlaying: () => activeBufferSrc !== null && activeBufferName === name,
            toggle: () => {
              if (activeBufferSrc && activeBufferName === name) {
                pauseMiniStudioBuffer();
              } else {
                const live = decodedCache.get(name);
                if (live) startLoudnessBuffer(name, live, activeBufferPausedAt);
                else {
                  stopMiniStudioBuffer(false);
                  deps.listen(name);
                }
              }
            },
            seek: (toSeconds: number) => {
              const target = Math.min(Math.max(0, duration - 0.02), Math.max(0, toSeconds));
              activeBufferPausedAt = target;
              if (activeBufferSrc && activeBufferName === name) {
                const live = decodedCache.get(name) ?? activeBufferCached;
                if (live) startLoudnessBuffer(name, live, target);
              }
            },
            stop: () => {
              if (activeExternalHandle !== handle) return;
              activeExternalHandle = null;
              teardownBufferNode();
              activeBufferName = null;
              activeBufferCached = null;
              activeBufferDuration = 0;
              activeBufferPausedAt = 0;
              if (snap.loudnessPlayingId !== null) patch({ loudnessPlayingId: null });
            },
          };
    handle.duration = duration;
    activeExternalHandle = handle;
    patch({ loudnessPlayingId: name });
    deps.attachExternalAudition?.(handle);
    src.onended = () => {
      try {
        src.disconnect();
      } catch {}
      try {
        gain.disconnect();
      } catch {}
      if (seq === bufferSeq) {
        activeBufferSrc = null;
        activeBufferGain = null;
        activeBufferStartedAt = null;
        activeBufferPausedAt = 0;
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
      if (activeBufferSrc && activeBufferName === name) {
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
      const resumeOffset = !opts?.forcePlay && activeBufferName === name ? activeBufferPausedAt : 0;
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
    if (snap.videoPreview.active && snap.videoPreview.mode && snap.videoPreview.targetLabel) {
      return { mode: snap.videoPreview.mode, label: snap.videoPreview.targetLabel };
    }
    const clip = deps.getSelectedClip();
    if (deps.isEditableSoundClip(clip)) {
      const [from] = deps.span(clip);
      return { mode: "clip", label: `Clip @ ${deps.stamp(from)}` };
    }
    return { mode: "playhead", label: `Playhead @ ${deps.stamp(deps.getPlayhead())}` };
  };

  const captureVideoTarget = (explicitClip?: ClipRef | null) => {
    const candidateClip = explicitClip !== undefined ? explicitClip : deps.getSelectedClip();
    if (deps.isEditableSoundClip(candidateClip)) {
      const curLanes = deps.getLanes();
      const curEntry =
        candidateClip.list === "beds"
          ? curLanes?.beds[candidateClip.i]
          : curLanes?.sfx[candidateClip.i];
      videoTargetClip = { ...candidateClip };
      videoOriginalClipName = curEntry?.name ?? null;
      videoTargetFrom = deps.span(candidateClip)[0];
      videoTargetLabel = `Clip @ ${deps.stamp(videoTargetFrom)}`;
    } else {
      videoTargetClip = null;
      videoOriginalClipName = null;
      const dur = deps.getDuration();
      videoAnchorAt = Math.max(0, Math.min(dur, deps.getPlayhead()));
      videoTargetLabel = `Playhead @ ${deps.stamp(videoAnchorAt)}`;
    }
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
    const targetChanged = videoBaseSnap !== null && !sameClip(videoTargetClip, nextClip);

    if (targetChanged && videoBaseSnap !== null) {
      if (videoPreviewApplied) deps.restore(videoBaseSnap);
      videoBaseSnap = null;
      videoPreviewApplied = false;
      videoTargetClip = null;
      videoOriginalClipName = null;
      if (snap.videoPreview.active) patch({ videoPreview: INACTIVE_PREVIEW });
    }

    if (videoBaseSnap === null) {
      videoBaseSnap = deps.snapshot();
      captureVideoTarget(explicitClip);
    }

    patch({ videoPreviewPendingId: name });
    const buf = await deps.decoded(name);
    if (seq !== videoPreviewSeq || videoBaseSnap === null) {
      if (snap.videoPreviewPendingId === name && seq === videoPreviewSeq) {
        patch({ videoPreviewPendingId: null });
      }
      return false;
    }
    if (!buf) {
      if (!videoPreviewApplied) {
        videoBaseSnap = null;
        videoTargetClip = null;
        videoOriginalClipName = null;
        patch({ videoPreview: INACTIVE_PREVIEW, videoPreviewPendingId: null });
      } else {
        patch({ videoPreviewPendingId: null });
      }
      deps.say(`Could not load audio for ${name}`, 3000);
      return false;
    }

    if (videoPreviewApplied) deps.restore(videoBaseSnap);
    const item = deps.itemOf(name);
    const isBed = item ? deps.kindOf(item) === "bgm" : buf.duration >= 10;
    const duration = deps.getDuration();
    let playFrom = Math.max(0, videoAnchorAt - 0.25);

    deps.preview((l) => {
      if (videoTargetClip) {
        const target =
          videoTargetClip.list === "beds" ? l.beds[videoTargetClip.i] : l.sfx[videoTargetClip.i];
        if (target) {
          applyClipSoundReset(target, videoTargetClip.list, name, l.narration);
          playFrom = Math.max(0, videoTargetFrom - 0.35);
          return;
        }
      }
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
        const clampedFrom = Math.min(Math.max(0, duration - 1), videoAnchorAt);
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
        const clampedAt = Math.min(Math.max(0, duration - 0.35), videoAnchorAt);
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

    videoPreviewApplied = true;
    patch({
      videoPreviewPendingId: null,
      videoPreview: {
        active: true,
        soundId: name,
        mode: videoTargetClip ? "clip" : "playhead",
        targetLabel: videoTargetLabel,
        targetClip: videoTargetClip ? { ...videoTargetClip } : null,
        originalClipName: videoOriginalClipName,
      },
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
    const activePreviewClip = snap.videoPreview.active ? videoTargetClip : null;
    const targetClip =
      explicitClip !== undefined
        ? explicitClip
        : deps.isEditableSoundClip(selectedClip)
          ? selectedClip
          : activePreviewClip;
    const anchorAt = snap.videoPreview.active ? videoAnchorAt : deps.getPlayhead();
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
    const activePreviewClip = snap.videoPreview.active ? videoTargetClip : null;
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
