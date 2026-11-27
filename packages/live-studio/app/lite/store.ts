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

export interface LiteState {
  film: LiteFilmMeta;
  videos: CompareVideoItem[];
  videosLoaded: boolean;
  canBuild: { ref: string | null; ours: string | null };
  selectedPath: string | null;
  videoMeta: CompareVideoMeta | null;
  videoReady: boolean;
  videoError: string | null;
  videoReloadSeq: number;
  catalogError: string | null;
  refreshing: boolean;
  muted: boolean;
  rate: number;

  notes: Note[];
  noteNumbers: Record<string, number>;
  notesLoaded: boolean;
  noteStatus: NoteStatusFilter;
  saved: "busy" | "fail" | null;
  replyDrafts: ReadonlyMap<string, string>;

  compose: Compose | null;
  noteSaving: boolean;
  draft: string;
  refs: RefPic[];
  inkTool: InkKind | null;
  inkMarks: Mark[];
  inkSaid: string;
  inkRev: number;
  statusPill: string | null;
}

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
    videos: [],
    videosLoaded: false,
    canBuild: { ref: null, ours: null },
    selectedPath: null,
    videoMeta: null,
    videoReady: false,
    videoError: null,
    videoReloadSeq: 0,
    catalogError: null,
    refreshing: false,
    muted: false,
    rate: 1,

    notes: [],
    noteNumbers: {},
    notesLoaded: false,
    noteStatus: "all",
    saved: null,
    replyDrafts: new Map(),

    compose: null,
    noteSaving: false,
    draft: "",
    refs: [],
    inkTool: null,
    inkMarks: [],
    inkSaid: "",
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
    was: Extract<Compose, { kind: "create" }>,
    words: string,
    strokes: Mark[],
    refs: RefPic[],
    prevPath: string | null,
  ) => {
    const targetPath = was.compareVideo?.path ?? prevPath;
    const cur = store.getState();
    const canSwitch = Boolean(targetPath && cur.videos.some((v) => v.path === targetPath));
    const clipChanged = Boolean(canSwitch && cur.selectedPath !== targetPath);
    store.setState((s) => ({
      ...(clipChanged
        ? {
            selectedPath: targetPath,
            videoReady: false,
            videoError: null,
            videoMeta: null,
          }
        : {}),
      compose: { ...was, resume: false },
      draft: words,
      inkMarks: strokes,
      inkSaid: inkSummary(strokes),
      inkRev: s.inkRev + 1,
      refs,
    }));
    seekHandler(was.t, clipChanged);
  };

  let cachedUnsentNotes: OutgoingNote[] | null = null;
  let cachedUnsentOps: Record<string, NoteOp[]> | null = null;
  let flushPromise: Promise<void> | null = null;
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
    if (!s.selectedPath) return null;
    return s.videos.find((v) => v.path === s.selectedPath) ?? null;
  };

  const activeLayout = (): CompareVideoLayout => {
    const s = store.getState();
    const item = activeVideo();
    if (!item) return "single";
    if (item.layoutExact) return item.layout;
    if (s.videoMeta?.path === item.path) return s.videoMeta.layout;
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
    try {
      const res = await fetchFn("/api/compare-videos", { cache: "no-store" });
      if (!res.ok) {
        store.setState({
          videosLoaded: true,
          catalogError: `Studio returned HTTP ${res.status}. Tap refresh to retry.`,
        });
        return null;
      }
      const data = (await res.json()) as CompareVideoCatalog;
      const prev = store.getState();
      const prevByPath = new Map(prev.videos.map((v) => [v.path, v]));
      const nextByPath = new Map(data.videos.map((v) => [v.path, v]));
      const currentPath = prev.selectedPath;
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

      const needsReload = fileChanged || prev.videoError !== null;

      store.setState({
        videos: data.videos,
        videosLoaded: true,
        canBuild: data.canBuild ?? { ref: null, ours: null },
        selectedPath: nextPath,
        catalogError: null,
        ...(needsReload
          ? {
              videoReady: false,
              videoError: null,
              videoMeta: null,
              videoReloadSeq: prev.videoReloadSeq + 1,
            }
          : {}),
      });
      return data;
    } catch {
      store.setState({
        videosLoaded: true,
        catalogError: "Could not load video catalog. Check connection and tap refresh.",
      });
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

  const flushNotes = (): Promise<void> => {
    if (flushPromise) return flushPromise;
    flushPromise = (async () => {
      for (
        let list = getUnsentNotes(), ops = Object.entries(getUnsentOps());
        list.length > 0 || ops.length > 0;
        list = getUnsentNotes(), ops = Object.entries(getUnsentOps())
      ) {
        store.setState({ saved: "busy" });
        try {
          if (list.length > 0) {
            const item = list[0]!;
            const res = await fetchFn("/api/notes", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(item),
            });
            if (res.status === 413 && (item.strip || item.frames?.length || item.crop)) {
              const slimItem: OutgoingNote = {
                note: item.note,
                ...(item.img ? { img: item.img } : {}),
                ...(item.refs?.length ? { refs: item.refs } : {}),
              };
              setUnsentNotes([slimItem, ...getUnsentNotes().slice(1)]);
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
              continue;
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            dropOp(id, op);
          }
        } catch {
          store.setState({ saved: "fail" });
          await new Promise((r) => setTimeout(r, retryDelayMs));
        }
      }
      store.setState({ saved: null });
    })().finally(() => {
      flushPromise = null;
    });
    return flushPromise;
  };

  const whenFlushed = async () => {
    if (flushPromise) await flushPromise;
  };

  const init = async () => {
    await Promise.all([loadFilm(), loadVideos(), loadNotes().catch(() => [])]);
    if (getUnsentNotes().length > 0 || Object.keys(getUnsentOps()).length > 0) {
      void flushNotes();
    }
  };

  const refreshAll = async () => {
    store.setState({ refreshing: true });
    try {
      const [, videosRes, notesOk] = await Promise.all([
        loadFilm(),
        loadVideos(),
        loadNotes()
          .then(() => true)
          .catch(() => false),
      ]);
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
    } finally {
      store.setState({ refreshing: false });
    }
  };

  const selectVideo = (path: string) => {
    const s = store.getState();
    if (s.noteSaving) return;
    if (!s.videos.some((v) => v.path === path)) return;
    if (s.selectedPath === path) {
      if (s.videoError !== null) {
        store.setState({
          videoReady: false,
          videoError: null,
          videoMeta: null,
          videoReloadSeq: s.videoReloadSeq + 1,
        });
      }
      return;
    }
    const prevPath = s.selectedPath;
    const wasCreate = s.compose?.kind === "create" ? s.compose : null;
    const words = s.draft;
    const strokes = s.inkMarks.slice();
    const refs = s.refs.slice();
    const dirtyCreate = Boolean(
      wasCreate && isComposeDirty(wasCreate, words, strokes.length > 0 || refs.length > 0),
    );
    store.setState((cur) => ({
      selectedPath: path,
      videoReady: false,
      videoError: null,
      videoMeta: null,
      ...(wasCreate
        ? {
            compose: null,
            draft: "",
            refs: [],
            inkTool: null,
            inkMarks: [],
            inkSaid: "",
            inkRev: cur.inkRev + 1,
          }
        : {}),
    }));
    if (dirtyCreate && wasCreate) {
      noticeHandler({
        title: "Note discarded on video switch",
        undo: () => restoreCreateDraft(wasCreate, words, strokes, refs, prevPath),
      });
    }
  };

  const onVideoMetadata = (width: number, height: number, duration: number) => {
    const item = activeVideo();
    if (!item) return;
    const layout = item.layoutExact
      ? item.layout
      : inferCompareLayout(item.category, width, height, store.getState().film.ratio);
    store.setState({
      videoReady: true,
      videoError: null,
      videoMeta: {
        path: item.path,
        width,
        height,
        duration,
        fps: 30,
        hasAudio: true,
        layout,
      },
    });
  };

  const onVideoError = (message: string) => {
    store.setState({ videoReady: false, videoError: message });
  };

  const setNoteStatus = (noteStatus: NoteStatusFilter) => store.setState({ noteStatus });
  const setMuted = (muted: boolean) => store.setState({ muted });
  const setRate = (rate: number) => store.setState({ rate: Number.isFinite(rate) && rate > 0 ? rate : 1 });

  const setInkTool = (inkTool: InkKind | null) => {
    if (inkTool !== null && store.getState().compose?.kind === "edit") return;
    store.setState({ inkTool });
  };

  const setInkMarks = (marks: Mark[]) => {
    store.setState((s) => ({
      inkMarks: marks,
      inkSaid: inkSummary(marks),
      inkRev: s.inkRev + 1,
    }));
  };

  const undoInk = (): boolean => {
    const cur = store.getState().inkMarks;
    if (!cur.length) return false;
    const next = cur.map((m) => ({
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
    const shot = shotAtTime(s.film.shots, s.film.duration, t);
    const compareVideo = activeCompareSource() ?? undefined;
    const effectiveWasPlaying = s.compose?.kind === "create" ? s.compose.wasPlaying : wasPlaying;
    const effectiveResume = s.compose?.kind === "create" ? s.compose.resume : wasPlaying;
    const autoFocus = opts?.autoFocus ?? true;
    store.setState({
      compose: {
        kind: "create",
        t,
        shot: shot.index,
        shotName: shot.name,
        pin,
        resume: effectiveResume,
        wasPlaying: effectiveWasPlaying,
        autoFocus,
        ...(compareVideo ? { compareVideo } : {}),
      },
      draft: s.compose?.kind === "create" ? s.draft : "",
    });
  };

  const openEditNote = (note: Note, wasPlaying: boolean) => {
    const s = store.getState();
    if (s.noteSaving) return;
    const prevPath = s.selectedPath;
    const wasCreate = s.compose?.kind === "create" ? s.compose : null;
    const words = s.draft;
    const strokes = s.inkMarks.slice();
    const refs = s.refs.slice();
    const dirtyCreate = Boolean(
      wasCreate && isComposeDirty(wasCreate, words, strokes.length > 0 || refs.length > 0),
    );
    store.setState((cur) => ({
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
      inkTool: null,
      inkMarks: [],
      inkSaid: "",
      inkRev: cur.inkMarks.length > 0 || cur.compose?.kind === "create" ? cur.inkRev + 1 : cur.inkRev,
      refs: [],
    }));
    if (dirtyCreate && wasCreate) {
      noticeHandler({
        title: "Note discarded",
        undo: () => restoreCreateDraft(wasCreate, words, strokes, refs, prevPath),
      });
    }
  };

  const setDraft = (draft: string) => store.setState({ draft });

  const closeCompose = (): boolean => {
    const resume = store.getState().compose?.resume ?? false;
    store.setState((s) => ({
      compose: null,
      draft: "",
      refs: [],
      inkTool: null,
      inkMarks: [],
      inkSaid: "",
      inkRev: s.inkRev + 1,
    }));
    return resume;
  };

  const cancelCompose = (): boolean => {
    const s = store.getState();
    if (s.noteSaving || !s.compose) return false;
    const prevPath = s.selectedPath;
    const was = s.compose;
    const words = s.draft;
    const strokes = s.inkMarks.slice();
    const refs = s.refs.slice();
    const dirty = isComposeDirty(was, words, strokes.length > 0 || refs.length > 0);
    const resume = closeCompose();
    if (dirty) {
      noticeHandler({
        title: was.kind === "edit" ? `Edit at ${was.time} discarded` : "Note discarded",
        undo: () => {
          if (was.kind === "create") {
            restoreCreateDraft(was, words, strokes, refs, prevPath);
            return;
          }
          store.setState((cur) => ({
            compose: { ...was, resume: false },
            draft: words,
            inkMarks: strokes,
            inkSaid: inkSummary(strokes),
            inkRev: cur.inkRev + 1,
            refs,
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
    if (s.compose?.kind !== "create") return;
    const startCompose = s.compose;
    const room = Math.max(0, REFS_MAX - s.refs.length);
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
        if (cur.compose !== startCompose) return cur;
        return { refs: [...cur.refs, ...added].slice(0, REFS_MAX) };
      });
    }
  };

  const removeRef = (id: string) => {
    const cur = store.getState().refs;
    const idx = cur.findIndex((r) => r.id === id);
    if (idx < 0) return;
    const removed = cur[idx]!;
    store.setState({ refs: cur.filter((r) => r.id !== id) });
    noticeHandler({
      title: "Reference picture removed",
      undo: () => {
        const now = store.getState().refs;
        if (now.some((r) => r.id === removed.id) || now.length >= REFS_MAX) return;
        const next = now.slice();
        next.splice(Math.min(idx, next.length), 0, removed);
        store.setState({ refs: next });
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
      ...(s.compose?.kind === "edit" && s.compose.id === note.id ? { compose: null, draft: "" } : {}),
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
    if (s.noteSaving || !s.compose) return false;
    const compose = s.compose;
    const body = s.draft.trim();

    if (compose.kind === "edit") {
      if (!body || body === compose.original.trim()) {
        return closeCompose();
      }
      const before = compose.original;
      const existing = s.notes.find((n) => n.id === compose.id);
      if (existing) {
        editNoteText(compose.id, body);
      } else {
        queueOp(compose.id, { restore: true, text: body });
        void flushNotes();
      }
      const resume = closeCompose();
      noticeHandler({
        title: `Note at ${compose.time} updated`,
        undo: () => editNoteText(compose.id, before),
      });
      return resume;
    }

    const marks = s.inkMarks.slice();
    const refs = s.refs.map((r) => r.url);
    if (!body && !marks.length && !refs.length) {
      return closeCompose();
    }

    store.setState({ noteSaving: true });
    try {
      const liveItem = activeVideo();
      const targetItem =
        (compose.compareVideo?.path
          ? s.videos.find((v) => v.path === compose.compareVideo!.path)
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
          (s.videoMeta?.width && s.videoMeta?.height
            ? [s.videoMeta.width, s.videoMeta.height]
            : null),
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

      const nextNotes = [...store.getState().notes, note];
      const maxNum = Object.values(store.getState().noteNumbers).reduce((a, b) => Math.max(a, b), 0);
      setUnsentNotes([...getUnsentNotes(), outgoing]);
      store.setState({
        notes: nextNotes,
        noteNumbers: { ...store.getState().noteNumbers, [note.id]: maxNum + 1 },
      });
      void flushNotes();
      return closeCompose();
    } catch {
      noticeHandler({
        title: "Couldn’t save the note",
        description: "Try saving it again.",
        type: "error",
      });
      return false;
    } finally {
      store.setState({ noteSaving: false });
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
