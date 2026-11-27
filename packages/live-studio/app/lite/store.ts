import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";

import {
  compareHitForPoint,
  inferCompareLayout,
  type CompareVideoCatalog,
  type CompareVideoItem,
  type CompareVideoLayout,
  type CompareVideoMeta,
  type NoteCompareSource,
} from "../../src/compare-video-meta.ts";
import { stamp } from "../core/time.ts";
import { compareVideoUrl } from "../picture/compare-video-model.ts";
import { captureNoteMedia, type CapturedNoteMedia, fileToRefJpeg, REFS_MAX } from "./capture.ts";
import { isPhoneViewport } from "./device.ts";
import {
  applyNoteChange,
  buildNotePayload,
  inkSummary,
  isComposeDirty,
  markHitsForCompare,
  noteNumberMap,
  noteState,
  pickDefaultVideoPath,
  shotAtTime,
} from "./model.ts";
import type {
  Compose,
  InkKind,
  LiteBootData,
  LiteFilmMeta,
  Mark,
  Note,
  NoteChange,
  NoteOp,
  NoteStatusFilter,
  OutgoingNote,
  Pin,
  RefPic,
} from "./types.ts";

export interface StorageLike {
  get(key: string): string | null;
  set(key: string, value: string): boolean;
  remove(key: string): void;
}

const createBrowserStorage = (): StorageLike => ({
  get(key) {
    try {
      return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      if (typeof localStorage !== "undefined") localStorage.removeItem(key);
    } catch {}
  },
});

export interface LiteNotice {
  title: string;
  description?: string;
  type?: "success" | "warning" | "error" | "info";
  undo?: () => void;
}

export type CreateCompose = Extract<Compose, { kind: "create" }>;
export type EditCompose = Extract<Compose, { kind: "edit" }>;

export type LiteCatalogState =
  | { status: "loading"; videos: CompareVideoItem[]; canBuild: { ref: string | null; ours: string | null } }
  | { status: "ready"; videos: CompareVideoItem[]; canBuild: { ref: string | null; ours: string | null } }
  | {
      status: "error";
      videos: CompareVideoItem[];
      canBuild: { ref: string | null; ours: string | null };
      error: string;
    };

export type LiteVideoState =
  | { status: "none"; reloadSeq: number }
  | { status: "loading"; path: string; reloadSeq: number }
  | { status: "ready"; path: string; meta: CompareVideoMeta; reloadSeq: number }
  | { status: "error"; path: string; error: string; reloadSeq: number };

export type LiteFlushStatus = "idle" | "flushing" | "backoff";

export type LiteComposeState =
  | { status: "closed" }
  | {
      status: "create-editing";
      compose: CreateCompose;
      draft: string;
      refs: RefPic[];
      inkTool: InkKind | null;
      inkMarks: Mark[];
      inkSaid: string;
    }
  | {
      status: "create-saving";
      compose: CreateCompose;
      draft: string;
      refs: RefPic[];
      inkTool: InkKind | null;
      inkMarks: Mark[];
      inkSaid: string;
    }
  | {
      status: "edit";
      compose: EditCompose;
      draft: string;
    };

export interface LiteState {
  film: LiteFilmMeta;
  catalog: LiteCatalogState;
  video: LiteVideoState;
  refreshing: boolean;
  muted: boolean;
  rate: number;

  notes: Note[];
  noteNumbers: Record<string, number>;
  notesLoaded: boolean;
  noteStatus: NoteStatusFilter;
  flushStatus: LiteFlushStatus;
  replyDrafts: ReadonlyMap<string, string>;

  composeState: LiteComposeState;
  inkRev: number;
  statusPill: string | null;
}

const EMPTY_REFS: readonly RefPic[] = [];
const EMPTY_MARKS: readonly Mark[] = [];

export const liteCatalogVideosOf = (s: LiteState): CompareVideoItem[] => s.catalog.videos;
export const liteCatalogLoadedOf = (s: LiteState): boolean => s.catalog.status !== "loading";
export const liteCatalogErrorOf = (s: LiteState): string | null =>
  s.catalog.status === "error" ? s.catalog.error : null;

export const liteVideoPathOf = (s: LiteState): string | null =>
  s.video.status === "none" ? null : s.video.path;
export const liteVideoMetaOf = (s: LiteState): CompareVideoMeta | null =>
  s.video.status === "ready" ? s.video.meta : null;
export const liteVideoReadyOf = (s: LiteState): boolean => s.video.status === "ready";
export const liteVideoErrorOf = (s: LiteState): string | null =>
  s.video.status === "error" ? s.video.error : null;
export const liteVideoReloadSeqOf = (s: LiteState): number => s.video.reloadSeq;

export const liteComposeOf = (s: LiteState): Compose | null =>
  s.composeState.status === "closed" ? null : s.composeState.compose;
export const liteNoteSavingOf = (s: LiteState): boolean =>
  s.composeState.status === "create-saving";
export const liteDraftOf = (s: LiteState): string =>
  s.composeState.status === "closed" ? "" : s.composeState.draft;
export const liteRefsOf = (s: LiteState): readonly RefPic[] =>
  s.composeState.status === "create-editing" || s.composeState.status === "create-saving"
    ? s.composeState.refs
    : EMPTY_REFS;
export const liteInkToolOf = (s: LiteState): InkKind | null =>
  s.composeState.status === "create-editing" || s.composeState.status === "create-saving"
    ? s.composeState.inkTool
    : null;
export const liteInkMarksOf = (s: LiteState): readonly Mark[] =>
  s.composeState.status === "create-editing" || s.composeState.status === "create-saving"
    ? s.composeState.inkMarks
    : EMPTY_MARKS;
export const liteInkSaidOf = (s: LiteState): string =>
  s.composeState.status === "create-editing" || s.composeState.status === "create-saving"
    ? s.composeState.inkSaid
    : "";

const DEFAULT_FILM: LiteFilmMeta = {
  name: "Studio Lite",
  ratio: "16:9",
  duration: 0,
  shots: [{ t: 0, name: "" }],
};

const UNSENT_NOTES_KEY = "liteUnsentNotes";
const UNSENT_OPS_KEY = "liteUnsentEdits";

export interface CreateLiteControllerOptions {
  fetchFn?: typeof fetch;
  storage?: StorageLike;
  boot?: LiteBootData;
  retryDelayMs?: number;
  statusDurationMs?: number;
  onNotice?: (notice: LiteNotice) => void;
  onSeek?: (t: number, clipChanged: boolean) => void;
}

type FlushRunner =
  | { status: "idle" }
  | { status: "flushing"; token: number; promise: Promise<void> }
  | {
      status: "backoff";
      token: number;
      promise: Promise<void>;
      wake: (abort?: boolean) => void;
    };

export function createLiteController(opts: CreateLiteControllerOptions = {}) {
  const fetchFn = opts.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const storage = opts.storage ?? createBrowserStorage();
  const retryDelayMs = opts.retryDelayMs ?? 3000;
  const statusDurationMs = opts.statusDurationMs ?? 2200;
  let noticeHandler = opts.onNotice ?? (() => {});
  let seekHandler = opts.onSeek ?? (() => {});
  let statusTimer: ReturnType<typeof setTimeout> | null = null;

  const bootFilm: LiteFilmMeta = {
    ...DEFAULT_FILM,
    ...opts.boot?.film,
    shots: opts.boot?.film?.shots?.length ? opts.boot.film.shots : DEFAULT_FILM.shots,
  };

  const store = createStore<LiteState>(() => ({
    film: bootFilm,
    catalog: { status: "loading", videos: [], canBuild: { ref: null, ours: null } },
    video: { status: "none", reloadSeq: 0 },
    refreshing: false,
    muted: false,
    rate: 1,

    notes: [],
    noteNumbers: {},
    notesLoaded: false,
    noteStatus: "all",
    flushStatus: "idle",
    replyDrafts: new Map(),

    composeState: { status: "closed" },
    inkRev: 0,
    statusPill: null,
  }));

  const sayStatus = (message: string) => {
    if (statusTimer) clearTimeout(statusTimer);
    store.setState({ statusPill: message });
    statusTimer = setTimeout(() => {
      statusTimer = null;
      store.setState({ statusPill: null });
    }, statusDurationMs);
  };

  const restoreCreateDraft = (
    was: CreateCompose,
    words: string,
    strokes: Mark[],
    refs: RefPic[],
    prevPath: string | null,
  ) => {
    const cur = store.getState();
    if (cur.composeState.status === "create-saving") return;
    const targetPath = was.compareVideo?.path ?? prevPath;
    const currentPath = liteVideoPathOf(cur);
    const canSwitch = Boolean(targetPath && cur.catalog.videos.some((v) => v.path === targetPath));
    const clipChanged = Boolean(canSwitch && targetPath && currentPath !== targetPath);
    store.setState((s) => ({
      ...(clipChanged && targetPath
        ? {
            video: { status: "loading" as const, path: targetPath, reloadSeq: s.video.reloadSeq },
          }
        : {}),
      composeState: {
        status: "create-editing",
        compose: { ...was, resume: false },
        draft: words,
        refs,
        inkTool: null,
        inkMarks: strokes,
        inkSaid: inkSummary(strokes),
      },
      inkRev: s.inkRev + 1,
    }));
    seekHandler(was.t, clipChanged);
  };

  let cachedUnsentNotes: OutgoingNote[] | null = null;
  let cachedUnsentOps: Record<string, NoteOp[]> | null = null;
  let flushRunner: FlushRunner = { status: "idle" };
  let refreshPromise: Promise<void> | null = null;
  let catalogSeq = 0;
  let appliedCatalogSeq = 0;
  let notesSeq = 0;
  let appliedNotesSeq = 0;

  const readJson = <T>(key: string, empty: T): T => {
    try {
      const raw = storage.get(key);
      return raw ? (JSON.parse(raw) as T) : empty;
    } catch {
      return empty;
    }
  };

  const getUnsentNotes = (): OutgoingNote[] => {
    if (cachedUnsentNotes === null) {
      cachedUnsentNotes = readJson<OutgoingNote[]>(UNSENT_NOTES_KEY, []);
    }
    return cachedUnsentNotes;
  };

  const setUnsentNotes = (list: OutgoingNote[]) => {
    cachedUnsentNotes = list;
    for (const slim of [
      (x: OutgoingNote) => x,
      (x: OutgoingNote) => ({ note: x.note, refs: x.refs, img: x.img, frames: x.frames }),
      (x: OutgoingNote) => ({ note: x.note, refs: x.refs, img: x.img }),
      (x: OutgoingNote) => ({ note: x.note, refs: x.refs }),
      (x: OutgoingNote) => ({ note: x.note }),
    ]) {
      if (storage.set(UNSENT_NOTES_KEY, JSON.stringify(list.map(slim)))) {
        return;
      }
    }
  };

  const getUnsentOps = (): Record<string, NoteOp[]> => {
    if (cachedUnsentOps === null) {
      const raw = readJson<Record<string, NoteOp | NoteOp[]>>(UNSENT_OPS_KEY, {});
      cachedUnsentOps = Object.fromEntries(
        Object.entries(raw).map(([id, op]) => [id, Array.isArray(op) ? op : [op]]),
      );
    }
    return cachedUnsentOps;
  };

  const setUnsentOps = (ops: Record<string, NoteOp[]>) => {
    cachedUnsentOps = ops;
    storage.set(UNSENT_OPS_KEY, JSON.stringify(ops));
  };

  const queueOp = (id: string, op: NoteOp) => {
    const all = getUnsentOps();
    const list = all[id] ?? [];
    const last = list.at(-1);
    const nextList =
      last && "text" in last && "text" in op ? [...list.slice(0, -1), op] : [...list, op];
    setUnsentOps({ ...all, [id]: nextList });
  };

  const dropOp = (id: string, op: NoteOp) => {
    const all = getUnsentOps();
    const sig = JSON.stringify(op);
    const rest = (all[id] ?? []).filter((x, i) => i > 0 || JSON.stringify(x) !== sig);
    if (rest.length) all[id] = rest;
    else delete all[id];
    setUnsentOps(all);
  };

  const activeVideo = (): CompareVideoItem | null => {
    const s = store.getState();
    const path = liteVideoPathOf(s);
    if (!path) return null;
    return s.catalog.videos.find((v) => v.path === path) ?? null;
  };

  const activeLayout = (): CompareVideoLayout => {
    const s = store.getState();
    const item = activeVideo();
    if (!item) return "single";
    if (item.layoutExact) return item.layout;
    if (s.video.status === "ready" && s.video.meta.path === item.path) return s.video.meta.layout;
    return item.layout;
  };

  const activeCompareSource = (): NoteCompareSource | null => {
    const item = activeVideo();
    if (!item) return null;
    return {
      path: item.path,
      category: item.category,
      layout: activeLayout(),
      ...(item.startSec > 0 ? { startSec: item.startSec } : {}),
    };
  };

  const applyClone = (n: Note, op: NoteChange): Note | string => {
    const copy = structuredClone(n);
    const res = applyNoteChange(copy, op);
    return res.ok ? copy : res.why;
  };

  const loadFilm = async (): Promise<LiteFilmMeta> => {
    try {
      const res = await fetchFn("/api/film.json", { cache: "no-store" });
      if (!res.ok) return store.getState().film;
      const data = (await res.json()) as Partial<LiteFilmMeta>;
      const film: LiteFilmMeta = {
        ...DEFAULT_FILM,
        ...data,
        shots: Array.isArray(data.shots) && data.shots.length ? data.shots : DEFAULT_FILM.shots,
      };
      store.setState({ film });
      return film;
    } catch {
      return store.getState().film;
    }
  };

  const loadVideos = async (selectPath?: string): Promise<CompareVideoCatalog | null> => {
    const seq = ++catalogSeq;
    try {
      const res = await fetchFn("/api/compare-videos", { cache: "no-store" });
      if (!res.ok) {
        if (seq < appliedCatalogSeq) return null;
        appliedCatalogSeq = seq;
        store.setState((prev) => ({
          catalog: {
            status: "error",
            videos: prev.catalog.videos,
            canBuild: prev.catalog.canBuild,
            error: `Studio returned HTTP ${res.status}. Tap refresh to retry.`,
          },
        }));
        return null;
      }
      const data = (await res.json()) as CompareVideoCatalog;
      if (seq < appliedCatalogSeq) return null;
      appliedCatalogSeq = seq;

      const prev = store.getState();
      const prevByPath = new Map(prev.catalog.videos.map((v) => [v.path, v]));
      const nextByPath = new Map(data.videos.map((v) => [v.path, v]));
      const currentPath = liteVideoPathOf(prev);
      const keepCurrent = Boolean(currentPath && nextByPath.has(currentPath));
      const nextPath =
        selectPath && nextByPath.has(selectPath)
          ? selectPath
          : keepCurrent
            ? currentPath
            : pickDefaultVideoPath(data);
      const prevItem = currentPath ? prevByPath.get(currentPath) : null;
      const nextItem = nextPath ? nextByPath.get(nextPath) : null;
      const fileChanged =
        nextPath !== currentPath ||
        Boolean(
          prevItem &&
            nextItem &&
            (prevItem.size !== nextItem.size || prevItem.mtimeMs !== nextItem.mtimeMs),
        );

      const needsReload = fileChanged || prev.video.status === "error";
      const nextVideo: LiteVideoState = !nextPath
        ? { status: "none", reloadSeq: needsReload ? prev.video.reloadSeq + 1 : prev.video.reloadSeq }
        : needsReload
          ? { status: "loading", path: nextPath, reloadSeq: prev.video.reloadSeq + 1 }
          : prev.video;

      store.setState({
        catalog: {
          status: "ready",
          videos: data.videos,
          canBuild: data.canBuild ?? { ref: null, ours: null },
        },
        video: nextVideo,
      });
      return data;
    } catch {
      if (seq < appliedCatalogSeq) return null;
      appliedCatalogSeq = seq;
      store.setState((prev) => ({
        catalog: {
          status: "error",
          videos: prev.catalog.videos,
          canBuild: prev.catalog.canBuild,
          error: "Could not load video catalog. Check connection and tap refresh.",
        },
      }));
      return null;
    }
  };

  const loadNotes = async (): Promise<Note[]> => {
    const seq = ++notesSeq;
    const res = await fetchFn("/api/notes", { cache: "no-store" });
    if (!res.ok) throw new Error(`Couldn't load notes (HTTP ${res.status})`);
    const numHeader = res.headers.get("x-note-numbers");
    const serverNotes = (await res.json()) as Note[];
    if (seq < appliedNotesSeq) return store.getState().notes;
    appliedNotesSeq = seq;

    const ops = getUnsentOps();
    const localNotes = store.getState().notes;
    const isDeletedLocally = (id: string) => {
      const list = ops[id] ?? [];
      return (
        list.findLastIndex((o) => "remove" in o) > list.findLastIndex((o) => "restore" in o)
      );
    };
    const restoredLocally = localNotes.filter(
      (n) => ops[n.id]?.some((o) => "restore" in o) && !serverNotes.some((h) => h.id === n.id),
    );
    const merged = [
      ...serverNotes,
      ...getUnsentNotes()
        .map((x) => x.note)
        .filter((n) => !serverNotes.some((h) => h.id === n.id)),
      ...restoredLocally,
    ]
      .filter((n) => !isDeletedLocally(n.id))
      .map((n) =>
        (ops[n.id] ?? []).reduce<Note>((acc, op) => {
          if ("remove" in op || "restore" in op) return acc;
          const next = applyClone(acc, op);
          return typeof next === "string" ? acc : next;
        }, n),
      );

    store.setState({
      notes: merged,
      noteNumbers: noteNumberMap(merged, numHeader),
      notesLoaded: true,
    });
    return merged;
  };

  const isPermanentClientError = (status: number) =>
    status >= 400 && status < 500 && status !== 408 && status !== 429;

  let flushToken = 0;

  const flushNotes = (): Promise<void> => {
    if (flushRunner.status === "flushing") return flushRunner.promise;
    if (flushRunner.status === "backoff") {
      const { token, promise, wake } = flushRunner;
      flushRunner = { status: "flushing", token, promise };
      store.setState({ flushStatus: "flushing" });
      wake(false);
      return promise;
    }
    if (getUnsentNotes().length === 0 && Object.keys(getUnsentOps()).length === 0) {
      return Promise.resolve();
    }

    const token = ++flushToken;
    const isStale = () => flushToken !== token;
    const promise: Promise<void> = Promise.resolve()
      .then(async () => {
        for (
          let list = getUnsentNotes(), ops = Object.entries(getUnsentOps());
          list.length > 0 || ops.length > 0;
          list = getUnsentNotes(), ops = Object.entries(getUnsentOps())
        ) {
          if (isStale()) return;
          store.setState({ flushStatus: "flushing" });
          try {
            if (list.length > 0) {
              const item = list[0]!;
              const res = await fetchFn("/api/notes", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(item),
              });
              if (isStale()) return;
              if (res.status === 413 && (item.strip || item.frames?.length || item.crop)) {
                const slimItem: OutgoingNote = {
                  note: item.note,
                  ...(item.img ? { img: item.img } : {}),
                  ...(item.refs?.length ? { refs: item.refs } : {}),
                };
                setUnsentNotes(
                  getUnsentNotes().map((x) => (x.note.id === item.note.id ? slimItem : x)),
                );
                continue;
              }
              if (isPermanentClientError(res.status)) {
                setUnsentNotes(getUnsentNotes().filter((x) => x.note.id !== item.note.id));
                store.setState((s) => ({
                  notes: s.notes.filter((x) => x.id !== item.note.id),
                }));
                noticeHandler({
                  title:
                    res.status === 413
                      ? "Note was too large to upload. Copy your text before closing."
                      : "Couldn’t save note. Copy your text before closing.",
                  description: item.note.text || undefined,
                  type: "error",
                });
                continue;
              }
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              setUnsentNotes(getUnsentNotes().filter((x) => x.note.id !== item.note.id));
              if (item.img || item.crop || item.refs?.length) {
                store.setState((s) => ({
                  notes: s.notes.map((x) =>
                    x.id === item.note.id
                      ? {
                          ...x,
                          ...(item.img ? { img: `notes/img/${x.id}.jpg` } : {}),
                          ...(item.crop ? { crop: `notes/img/${x.id}_crop.jpg` } : {}),
                          ...(item.refs?.length
                            ? { refs: item.refs.map((_, i) => `notes/img/${x.id}_r${i}.jpg`) }
                            : {}),
                        }
                      : x,
                  ),
                }));
              }
            } else {
              const [id, opList] = ops[0]!;
              const op = opList[0]!;
              const res = await fetchFn(`/api/notes/${id}`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(op),
              });
              if (isStale()) return;
              if (isPermanentClientError(res.status)) {
                dropOp(id, op);
                const words = "again" in op ? op.again : "text" in op ? op.text : undefined;
                noticeHandler({
                  title: words
                    ? "Note update wasn’t sent. Copy your text before closing."
                    : res.status === 409
                      ? "Note changed on disk. Refreshed latest version."
                      : "Couldn’t apply note update. Refreshed latest version.",
                  description: words,
                  type: "error",
                });
                await loadNotes().catch(() => {});
                if (isStale()) return;
                continue;
              }
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              dropOp(id, op);
            }
          } catch {
            if (isStale()) return;
            const aborted = await new Promise<boolean>((resolve) => {
              let settled = false;
              let timer: ReturnType<typeof setTimeout> | undefined;
              const wake = (abort = false) => {
                if (settled) return;
                settled = true;
                if (timer !== undefined) clearTimeout(timer);
                resolve(abort);
              };
              timer = setTimeout(() => wake(false), retryDelayMs);
              flushRunner = { status: "backoff", token, promise, wake };
              store.setState({ flushStatus: "backoff" });
            });
            if (aborted || isStale()) return;
            flushRunner = { status: "flushing", token, promise };
          }
        }
      })
      .finally(() => {
        if (isStale()) return;
        flushRunner = { status: "idle" };
        store.setState({ flushStatus: "idle" });
      });
    flushRunner = { status: "flushing", token, promise };
    store.setState({ flushStatus: "flushing" });
    return promise;
  };

  const whenFlushed = async () => {
    if (flushRunner.status !== "idle") await flushRunner.promise;
  };

  let lifecycleGen = 0;

  const dispose = () => {
    lifecycleGen++;
    if (statusTimer) {
      clearTimeout(statusTimer);
      statusTimer = null;
      store.setState({ statusPill: null });
    }
    if (refreshPromise) {
      refreshPromise = null;
      store.setState({ refreshing: false });
    }
    if (flushRunner.status !== "idle") {
      flushToken++;
      const prev = flushRunner;
      flushRunner = { status: "idle" };
      store.setState({ flushStatus: "idle" });
      if (prev.status === "backoff") prev.wake(true);
    }
  };

  const init = async () => {
    const gen = lifecycleGen;
    await Promise.all([loadFilm(), loadVideos(), loadNotes().catch(() => [])]);
    if (lifecycleGen !== gen) return;
    if (getUnsentNotes().length > 0 || Object.keys(getUnsentOps()).length > 0) {
      void flushNotes();
    }
  };

  const refreshAll = (): Promise<void> => {
    if (refreshPromise) return refreshPromise;
    const gen = lifecycleGen;
    const p: Promise<void> = Promise.resolve()
      .then(async () => {
        if (lifecycleGen !== gen) return;
        const [, videosRes, notesOk] = await Promise.all([
          loadFilm(),
          loadVideos(),
          loadNotes()
            .then(() => true)
            .catch(() => false),
        ]);
        if (lifecycleGen !== gen) return;
        if (!videosRes || !notesOk) {
          noticeHandler({
            title: "Couldn’t refresh studio data",
            description: !videosRes
              ? "Check connection and tap refresh to reload videos."
              : "Couldn’t reach notes. Check connection and retry.",
            type: "warning",
          });
        }
        if (getUnsentNotes().length > 0 || Object.keys(getUnsentOps()).length > 0) {
          void flushNotes();
        }
      })
      .finally(() => {
        if (refreshPromise === p) {
          refreshPromise = null;
          store.setState({ refreshing: false });
        }
      });
    refreshPromise = p;
    store.setState({ refreshing: true });
    return p;
  };

  const selectVideo = (path: string) => {
    const s = store.getState();
    if (s.composeState.status === "create-saving") return;
    if (!s.catalog.videos.some((v) => v.path === path)) return;
    const currentPath = liteVideoPathOf(s);
    if (currentPath === path) {
      if (s.video.status === "error") {
        store.setState({
          video: { status: "loading", path, reloadSeq: s.video.reloadSeq + 1 },
        });
      }
      return;
    }
    const prevPath = currentPath;
    const prevCreate = s.composeState.status === "create-editing" ? s.composeState : null;
    const dirtyCreate = Boolean(
      prevCreate &&
        isComposeDirty(
          prevCreate.compose,
          prevCreate.draft,
          prevCreate.inkMarks.length > 0 || prevCreate.refs.length > 0,
        ),
    );
    const savedWords = prevCreate?.draft ?? "";
    const savedStrokes = prevCreate ? prevCreate.inkMarks.slice() : [];
    const savedRefs = prevCreate ? prevCreate.refs.slice() : [];
    store.setState((cur) => ({
      video: { status: "loading", path, reloadSeq: cur.video.reloadSeq },
      ...(prevCreate
        ? {
            composeState: { status: "closed" as const },
            inkRev: cur.inkRev + 1,
          }
        : {}),
    }));
    if (dirtyCreate && prevCreate) {
      noticeHandler({
        title: "Note discarded on video switch",
        undo: () =>
          restoreCreateDraft(prevCreate.compose, savedWords, savedStrokes, savedRefs, prevPath),
      });
    }
  };

  const onVideoMetadata = (width: number, height: number, duration: number) => {
    const item = activeVideo();
    if (!item) return;
    const s = store.getState();
    const layout = item.layoutExact
      ? item.layout
      : inferCompareLayout(item.category, width, height, s.film.ratio);
    store.setState({
      video: {
        status: "ready",
        path: item.path,
        reloadSeq: s.video.reloadSeq,
        meta: {
          path: item.path,
          width,
          height,
          duration,
          fps: 30,
          hasAudio: true,
          layout,
        },
      },
    });
  };

  const onVideoError = (message: string) => {
    store.setState((s) => {
      if (s.video.status === "none") return s;
      return {
        video: {
          status: "error",
          path: s.video.path,
          error: message,
          reloadSeq: s.video.reloadSeq,
        },
      };
    });
  };

  const setNoteStatus = (noteStatus: NoteStatusFilter) => store.setState({ noteStatus });
  const setMuted = (muted: boolean) => store.setState({ muted });
  const setRate = (rate: number) => store.setState({ rate: Number.isFinite(rate) && rate > 0 ? rate : 1 });

  const setInkTool = (inkTool: InkKind | null) => {
    store.setState((s) => {
      if (s.composeState.status !== "create-editing") return s;
      return {
        composeState: { ...s.composeState, inkTool },
      };
    });
  };

  const setInkMarks = (marks: Mark[]) => {
    store.setState((s) => {
      if (s.composeState.status !== "create-editing") return s;
      return {
        composeState: {
          ...s.composeState,
          inkMarks: marks,
          inkSaid: inkSummary(marks),
        },
        inkRev: s.inkRev + 1,
      };
    });
  };

  const undoInk = (): boolean => {
    const cs = store.getState().composeState;
    if (cs.status !== "create-editing" || !cs.inkMarks.length) return false;
    const next = cs.inkMarks.map((m) => ({
      ...m,
      pts: m.pts.slice(),
      ...(m.ts ? { ts: m.ts.slice() } : {}),
      ...(m.hits ? { hits: m.hits.slice() } : {}),
    }));
    const last = next.at(-1)!;
    if (last.kind === "path" && last.pts.length > 1) {
      last.pts.pop();
      last.ts?.pop();
      last.hits?.pop();
    } else {
      next.pop();
    }
    setInkMarks(next);
    return true;
  };

  const clearInk = () => setInkMarks([]);

  const openCreateNote = (
    pin: Pin | null,
    t: number,
    wasPlaying: boolean,
    opts?: { autoFocus?: boolean },
  ) => {
    const s = store.getState();
    if (s.composeState.status === "create-saving") return;
    const shot = shotAtTime(s.film.shots, s.film.duration, t);
    const compareVideo = activeCompareSource() ?? undefined;
    const prevCreate = s.composeState.status === "create-editing" ? s.composeState : null;
    const effectiveWasPlaying = prevCreate ? prevCreate.compose.wasPlaying : wasPlaying;
    const effectiveResume = prevCreate ? prevCreate.compose.resume : wasPlaying;
    const autoFocus = opts?.autoFocus ?? true;
    const nextCompose: CreateCompose = {
      kind: "create",
      t,
      shot: shot.index,
      shotName: shot.name,
      pin,
      resume: effectiveResume,
      wasPlaying: effectiveWasPlaying,
      autoFocus,
      ...(compareVideo ? { compareVideo } : {}),
    };
    store.setState({
      composeState: {
        status: "create-editing",
        compose: nextCompose,
        draft: prevCreate ? prevCreate.draft : "",
        refs: prevCreate ? prevCreate.refs : [],
        inkTool: prevCreate ? prevCreate.inkTool : null,
        inkMarks: prevCreate ? prevCreate.inkMarks : [],
        inkSaid: prevCreate ? prevCreate.inkSaid : "",
      },
    });
  };

  const openEditNote = (note: Note, wasPlaying: boolean) => {
    const s = store.getState();
    if (s.composeState.status === "create-saving") return;
    const prevPath = liteVideoPathOf(s);
    const prevCreate = s.composeState.status === "create-editing" ? s.composeState : null;
    const words = prevCreate?.draft ?? "";
    const strokes = prevCreate ? prevCreate.inkMarks.slice() : [];
    const refs = prevCreate ? prevCreate.refs.slice() : [];
    const dirtyCreate = Boolean(
      prevCreate &&
        isComposeDirty(prevCreate.compose, words, strokes.length > 0 || refs.length > 0),
    );
    store.setState((cur) => ({
      composeState: {
        status: "edit",
        compose: {
          kind: "edit",
          id: note.id,
          time: stamp(note.t),
          original: note.text,
          t: note.t,
          shot: note.shot,
          shotName: note.shotName ?? "",
          pin: null,
          resume: wasPlaying,
        },
        draft: note.text,
      },
      inkRev: cur.composeState.status === "create-editing" ? cur.inkRev + 1 : cur.inkRev,
    }));
    if (dirtyCreate && prevCreate) {
      noticeHandler({
        title: "Note discarded",
        undo: () => restoreCreateDraft(prevCreate.compose, words, strokes, refs, prevPath),
      });
    }
  };

  const setDraft = (draft: string) => {
    store.setState((s) => {
      if (s.composeState.status !== "create-editing" && s.composeState.status !== "edit") {
        return s;
      }
      return {
        composeState: { ...s.composeState, draft },
      };
    });
  };

  const resetCompose = (): boolean => {
    const cs = store.getState().composeState;
    const resume = cs.status === "closed" ? false : cs.compose.resume;
    store.setState((s) => ({
      composeState: { status: "closed" },
      inkRev: s.inkRev + 1,
    }));
    return resume;
  };

  const closeCompose = (): boolean => {
    if (store.getState().composeState.status === "create-saving") return false;
    return resetCompose();
  };

  const cancelCompose = (): boolean => {
    const s = store.getState();
    const cs = s.composeState;
    if (cs.status === "closed" || cs.status === "create-saving") return false;
    const prevPath = liteVideoPathOf(s);
    if (cs.status === "create-editing") {
      const was = cs.compose;
      const words = cs.draft;
      const strokes = cs.inkMarks.slice();
      const refs = cs.refs.slice();
      const dirty = isComposeDirty(was, words, strokes.length > 0 || refs.length > 0);
      const resume = resetCompose();
      if (dirty) {
        noticeHandler({
          title: "Note discarded",
          undo: () => restoreCreateDraft(was, words, strokes, refs, prevPath),
        });
      }
      return resume;
    }

    const was = cs.compose;
    const words = cs.draft;
    const dirty = isComposeDirty(was, words, false);
    const resume = resetCompose();
    if (dirty) {
      noticeHandler({
        title: `Edit at ${was.time} discarded`,
        undo: () => {
          if (store.getState().composeState.status === "create-saving") return;
          store.setState((cur) => ({
            composeState: {
              status: "edit",
              compose: { ...was, resume: false },
              draft: words,
            },
            inkRev: cur.inkRev + 1,
          }));
          seekHandler(was.t, false);
        },
      });
    }
    return resume;
  };

  const addRefs = async (files: Iterable<File>) => {
    const pictures = [...files].filter((f) => f.type.startsWith("image/"));
    if (!pictures.length) return;
    const s = store.getState();
    if (s.composeState.status !== "create-editing") return;
    const startCompose = s.composeState.compose;
    const room = Math.max(0, REFS_MAX - s.composeState.refs.length);
    if (pictures.length > room) {
      noticeHandler({ title: `${REFS_MAX} pictures at most on one note`, type: "warning" });
    }
    const added: RefPic[] = [];
    for (const file of pictures.slice(0, room)) {
      try {
        const url = await fileToRefJpeg(file);
        added.push({
          id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
          url,
        });
      } catch {
        noticeHandler({ title: `Couldn’t read ${file.name || "that picture"}`, type: "error" });
      }
    }
    if (added.length) {
      store.setState((cur) => {
        if (
          cur.composeState.status !== "create-editing" ||
          cur.composeState.compose !== startCompose
        ) {
          return cur;
        }
        return {
          composeState: {
            ...cur.composeState,
            refs: [...cur.composeState.refs, ...added].slice(0, REFS_MAX),
          },
        };
      });
    }
  };

  const removeRef = (id: string) => {
    const cs = store.getState().composeState;
    if (cs.status !== "create-editing") return;
    const startCompose = cs.compose;
    const idx = cs.refs.findIndex((r) => r.id === id);
    if (idx < 0) return;
    const removed = cs.refs[idx]!;
    store.setState((s) => {
      if (s.composeState.status !== "create-editing") return s;
      return {
        composeState: {
          ...s.composeState,
          refs: s.composeState.refs.filter((r) => r.id !== id),
        },
      };
    });
    noticeHandler({
      title: "Reference picture removed",
      undo: () => {
        store.setState((s) => {
          if (
            s.composeState.status !== "create-editing" ||
            s.composeState.compose !== startCompose
          ) {
            return s;
          }
          const now = s.composeState.refs;
          if (now.some((r) => r.id === removed.id) || now.length >= REFS_MAX) return s;
          const next = now.slice();
          next.splice(Math.min(idx, next.length), 0, removed);
          return {
            composeState: {
              ...s.composeState,
              refs: next,
            },
          };
        });
      },
    });
  };

  const changeNote = (id: string, op: NoteChange, message?: string): boolean => {
    const was = store.getState().notes.find((x) => x.id === id);
    if (!was) return false;
    const next = applyClone(was, op);
    if (typeof next === "string") {
      noticeHandler({ title: next, type: "warning" });
      return false;
    }
    store.setState((s) => ({
      notes: s.notes.map((x) => (x.id === id ? next : x)),
    }));
    queueOp(id, op);
    void flushNotes();
    if (message) sayStatus(message);
    return true;
  };

  const editNoteText = (id: string, words: string) => {
    const trimmed = words.trim();
    const was = store.getState().notes.find((x) => x.id === id);
    if (!was || !trimmed || trimmed === was.text) return;
    changeNote(id, { text: trimmed });
  };

  const removeNote = (note: Note) => {
    const waiting = getUnsentNotes().find((x) => x.note.id === note.id);
    if (waiting) setUnsentNotes(getUnsentNotes().filter((x) => x.note.id !== note.id));
    store.setState((s) => ({
      notes: s.notes.filter((x) => x.id !== note.id),
      ...(s.composeState.status === "edit" && s.composeState.compose.id === note.id
        ? { composeState: { status: "closed" as const } }
        : {}),
    }));
    queueOp(note.id, { remove: true });
    void flushNotes();
    noticeHandler({
      title: `Note at ${note.time} deleted`,
      undo: () => restoreNote(note, waiting),
    });
  };

  const restoreNote = (note: Note, waiting?: OutgoingNote) => {
    store.setState((s) => ({
      notes: s.notes.some((x) => x.id === note.id) ? s.notes : [...s.notes, note],
    }));
    queueOp(note.id, { restore: true, text: note.text });
    if (waiting) setUnsentNotes([...getUnsentNotes(), waiting]);
    void flushNotes();
  };

  const markNoteDone = (note: Note) =>
    changeNote(note.id, { done: true }, `Note at ${stamp(note.t)} marked ready to check`);

  const reopenNote = (note: Note) =>
    changeNote(note.id, { done: false }, `Note at ${stamp(note.t)} moved back to To fix`);

  const approveNote = (note: Note) =>
    changeNote(note.id, { approve: true }, `Approved: note at ${stamp(note.t)}`);

  const answerNote = (note: Note, words: string) =>
    changeNote(note.id, { again: words }, `Sent back to AI: note at ${stamp(note.t)}`);

  const rememberNote = (note: Note, scope: "film" | "all" | null) =>
    changeNote(
      note.id,
      { remember: scope },
      scope
        ? `Remember for ${scope === "all" ? "every film" : "this film"}`
        : "No longer marked to remember",
    );

  const setReplyDraft = (id: string, text: string) => {
    store.setState((s) => {
      const next = new Map(s.replyDrafts);
      if (text) next.set(id, text);
      else next.delete(id);
      return { replyDrafts: next };
    });
  };

  const saveCompose = async (captureOpts?: {
    videoEl?: HTMLVideoElement | null;
    capture?: () => Promise<CapturedNoteMedia>;
  }): Promise<boolean> => {
    const s = store.getState();
    const cs = s.composeState;
    if (cs.status === "closed" || cs.status === "create-saving") return false;
    const body = cs.draft.trim();

    if (cs.status === "edit") {
      const compose = cs.compose;
      if (!body || body === compose.original.trim()) {
        return resetCompose();
      }
      const before = compose.original;
      const existing = s.notes.find((n) => n.id === compose.id);
      if (existing) {
        editNoteText(compose.id, body);
      } else {
        queueOp(compose.id, { restore: true, text: body });
        void flushNotes();
      }
      const resume = resetCompose();
      noticeHandler({
        title: `Note at ${compose.time} updated`,
        undo: () => editNoteText(compose.id, before),
      });
      return resume;
    }

    const compose = cs.compose;
    const marks = cs.inkMarks.slice();
    const refs = cs.refs.map((r) => r.url);
    if (!body && !marks.length && !refs.length) {
      return resetCompose();
    }

    const gen = lifecycleGen;
    store.setState({
      composeState: {
        ...cs,
        status: "create-saving",
      },
    });
    try {
      const liveItem = activeVideo();
      const targetItem =
        (compose.compareVideo?.path
          ? s.catalog.videos.find((v) => v.path === compose.compareVideo!.path)
          : null) ?? liveItem;
      const liveMatchesTarget = Boolean(liveItem && targetItem && liveItem.path === targetItem.path);
      const videoEl = liveMatchesTarget ? (captureOpts?.videoEl ?? null) : null;
      const videoSrc = targetItem ? compareVideoUrl(targetItem) : null;
      const media: CapturedNoteMedia = captureOpts?.capture
        ? await captureOpts.capture()
        : await captureNoteMedia({
            video: videoEl,
            videoSrc,
            startSec: compose.compareVideo?.startSec ?? targetItem?.startSec ?? 0,
            at: compose.t,
            pin: compose.pin,
            marks,
          });

      const rawCompareSource: NoteCompareSource | null =
        compose.compareVideo ?? activeCompareSource();
      let compareSource: NoteCompareSource | null = rawCompareSource;
      let finalPin: Pin | null = compose.pin;
      let finalMarks: Mark[] = marks;
      if (rawCompareSource && !targetItem?.layoutExact && media.dimensions) {
        const inferredLayout = inferCompareLayout(
          rawCompareSource.category,
          media.dimensions[0],
          media.dimensions[1],
          s.film.ratio,
        );
        if (inferredLayout !== rawCompareSource.layout) {
          compareSource = { ...rawCompareSource, layout: inferredLayout };
          if (finalPin) {
            const hit = compareHitForPoint(
              finalPin.x,
              finalPin.y,
              rawCompareSource.category,
              inferredLayout,
            );
            finalPin = { ...finalPin, what: hit.what };
          }
          if (finalMarks.length) {
            finalMarks = finalMarks.map((m) =>
              markHitsForCompare(m, rawCompareSource.category, inferredLayout),
            );
          }
        }
      }
      const videoMeta = liteVideoMetaOf(s);
      const note = buildNotePayload({
        t: compose.t,
        shots: s.film.shots,
        duration: s.film.duration || (videoEl?.duration ?? 0),
        text: body,
        pin: finalPin,
        compareVideo: compareSource,
        marks: finalMarks,
        wasPlaying: compose.wasPlaying,
        rate: s.rate || videoEl?.playbackRate || 1,
        muted: s.muted || Boolean(videoEl?.muted),
        volume: videoEl?.volume ?? 1,
        canvasSize:
          media.dimensions ??
          (videoMeta?.width && videoMeta?.height ? [videoMeta.width, videoMeta.height] : null),
        screenSize:
          typeof window !== "undefined" ? [window.innerWidth, window.innerHeight] : [390, 844],
        phone: isPhoneViewport(),
      });

      const outgoing: OutgoingNote = {
        note,
        img: media.img,
        crop: media.crop,
        strip: media.strip,
        frames: media.frames,
        ...(refs.length ? { refs } : {}),
      };

      setUnsentNotes([...getUnsentNotes(), outgoing]);
      store.setState((cur) => {
        const maxNum = Object.values(cur.noteNumbers).reduce((a, b) => Math.max(a, b), 0);
        return {
          notes: [...cur.notes, note],
          noteNumbers: { ...cur.noteNumbers, [note.id]: maxNum + 1 },
          composeState: { status: "closed" },
          inkRev: cur.inkRev + 1,
        };
      });
      if (lifecycleGen === gen) {
        void flushNotes();
      }
      return compose.resume;
    } catch {
      store.setState((cur) =>
        cur.composeState.status === "create-saving"
          ? { composeState: { ...cur.composeState, status: "create-editing" } }
          : cur,
      );
      if (lifecycleGen === gen) {
        noticeHandler({
          title: "Couldn’t save the note",
          description: "Try saving it again.",
          type: "error",
        });
      }
      return false;
    }
  };

  const setNoticeHandler = (fn: (notice: LiteNotice) => void) => {
    noticeHandler = fn;
  };

  const setSeekHandler = (fn: (t: number, clipChanged: boolean) => void) => {
    seekHandler = fn;
  };

  return {
    store,
    init,
    dispose,
    loadFilm,
    loadVideos,
    loadNotes,
    refreshAll,
    flushNotes,
    whenFlushed,
    getUnsentNotes,
    activeVideo,
    activeLayout,
    activeCompareSource,
    selectVideo,
    onVideoMetadata,
    onVideoError,
    setNoteStatus,
    setMuted,
    setRate,
    setInkTool,
    setInkMarks,
    undoInk,
    clearInk,
    openCreateNote,
    openEditNote,
    setDraft,
    closeCompose,
    cancelCompose,
    addRefs,
    removeRef,
    editNoteText,
    removeNote,
    restoreNote,
    markNoteDone,
    reopenNote,
    approveNote,
    answerNote,
    rememberNote,
    setReplyDraft,
    saveCompose,
    setNoticeHandler,
    setSeekHandler,
    noteState,
  };
}

declare global {
  interface Window {
    __LITE_BOOT?: LiteBootData;
  }
}

export const lite = createLiteController({
  boot: typeof window !== "undefined" ? window.__LITE_BOOT : undefined,
});

export function useLite<T>(selector: (state: LiteState) => T): T {
  return useStore(lite.store, selector);
}
