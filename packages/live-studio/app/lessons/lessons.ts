// The Lessons tab's state: both this film's and the repo's lessons/*.md (src/lesson-files.mjs), what the creator is typing into them, and the copy of
// each file they last saw, so what the AI changed since stays inspectable as a quick diff (changes.ts). AI edits always apply
// immediately: stale local drafts yield automatically to newer versions on disk, while unsaved edits wait on the device through a reload
import { createStore, useStore } from "zustand";

import { LESSON_TEXT_MAX, lessonPath, lessonTemplate } from "../../src/lesson-template";
import { stored } from "../core/storage";

export type LessonViewMode = "read" | "edit" | "changes";
export type LessonPreferredView = "read" | "edit";
export type LessonScope = "film" | "all";
export type LessonScopeFilter = "both" | LessonScope;

export const lessonKey = (scope: LessonScope, path: string) => `${scope}:${path}`;
export const parseLessonKey = (key: string): { scope: LessonScope; path: string } =>
  key.startsWith("film:")
    ? { scope: "film", path: key.slice(5) }
    : key.startsWith("all:")
      ? { scope: "all", path: key.slice(4) }
      : { scope: "all", path: key };

interface WireLessonFile {
  scope?: LessonScope;
  path: string;
  tag: string;
  text: string;
}

export interface LessonFile {
  key: string;
  scope: LessonScope;
  path: string;
  tag: string;
  text: string;
}
export interface RecoverableLessonDraft {
  path: string;
  text: string;
}

export interface AiNotice {
  id: number;
  key: string;
  scope: LessonScope;
  path: string;
  removed: boolean;
  drafts?: RecoverableLessonDraft[];
}
interface Edit {
  text: string;
  base: string | null; // the version these words were typed on
  saving?: boolean;
  failed?: string;
}
interface LessonsState {
  subTab: "deck" | "inspector";
  inspectorLiveEnabled: boolean;
  foldingTrail: string | null;
  dir: string;
  projectDir: string;
  scopeFilter: LessonScopeFilter;
  files: LessonFile[];
  loaded: boolean;
  loadFailed: boolean;
  folder: string[];
  open: string | null;
  preferredView: LessonPreferredView;
  viewByPath: Record<string, LessonViewMode>;
  edits: Record<string, Edit>;
  seen: Record<string, { tag: string; text: string }>;
  pick: { key: string; range: readonly [number, number] } | null; // words to select as the editor opens a new file
  aiNotice: AiNotice | null;
}
export const lessonTrailKey = ({ folder, open }: Pick<LessonsState, "folder" | "open">) =>
  `${folder.join("/")}\0${open ?? ""}`;

const SEEN = "lessonsSeen",
  DRAFTS = "lessonDrafts",
  VIEW = "lessonView",
  SAVE_AFTER_MS = 700;
const readJson = <T>(key: string, empty: T): T => {
  try {
    return JSON.parse(stored.get(key) ?? "null") ?? empty;
  } catch {
    return empty;
  }
};
const normalizeMapKeys = <T>(record: Record<string, T>): Record<string, T> =>
  Object.fromEntries(
    Object.entries(record).map(([k, v]) => [k.includes(":") ? k : lessonKey("all", k), v]),
  );
export const readPreferredLessonView = (): LessonPreferredView =>
  stored.get(VIEW) === "edit" ? "edit" : "read";

const omitKey = <T>(record: Record<string, T>, key: string): Record<string, T> => {
  if (!(key in record)) return record;
  const { [key]: _, ...rest } = record;
  return rest;
};

const sortFiles = (files: LessonFile[]): LessonFile[] =>
  files.toSorted((a, b) =>
    a.scope !== b.scope
      ? a.scope === "film"
        ? -1
        : 1
      : a.path < b.path
        ? -1
        : a.path > b.path
          ? 1
          : 0,
  );

const normalizeFile = (f: WireLessonFile): LessonFile => {
  const scope: LessonScope = f.scope === "film" ? "film" : "all";
  return { key: lessonKey(scope, f.path), scope, path: f.path, tag: f.tag, text: f.text };
};

const upsertFile = (files: LessonFile[], next: LessonFile): LessonFile[] =>
  files.some((f) => f.key === next.key)
    ? files.map((f) => (f.key === next.key ? next : f))
    : sortFiles([...files, next]);

export const lessons = createStore<LessonsState>(() => ({
  subTab: "deck",
  inspectorLiveEnabled: false,
  foldingTrail: null,
  dir: "",
  projectDir: "",
  scopeFilter: "both",
  files: [],
  loaded: false,
  loadFailed: false,
  folder: [],
  open: null,
  preferredView: readPreferredLessonView(),
  viewByPath: {},
  edits: Object.fromEntries(
    Object.entries(normalizeMapKeys(readJson<Record<string, Edit>>(DRAFTS, {}))).map(([p, e]) => [
      p,
      { text: e.text, base: e.base },
    ]),
  ),
  seen: normalizeMapKeys(readJson(SEEN, {})),
  pick: null,
  aiNotice: null,
}));
export const useLessons = <T>(pick: (s: LessonsState) => T) => useStore(lessons, pick);
const get = lessons.getState,
  set = lessons.setState;

const setEdits = (edits: Record<string, Edit>) => {
  set({ edits });
  stored.set(
    DRAFTS,
    JSON.stringify(
      Object.fromEntries(
        Object.entries(edits).map(([p, e]) => [p, { text: e.text, base: e.base }]),
      ),
    ),
  );
};
const setSeen = (seen: LessonsState["seen"]) => {
  set({ seen });
  stored.set(SEEN, JSON.stringify(seen));
};
const fileOf = (key: string) => get().files.find((f) => f.key === key);
export const findExistingLesson = (scope: LessonScope, name: string) => {
  const lower = lessonPath(name).toLowerCase();
  return get().files.find((f) => f.scope === scope && f.path.toLowerCase() === lower);
};

const timers = new Map<string, ReturnType<typeof setTimeout>>();
let loadSeq = 0;
let saveSeq = 0;
let noticeSeq = 0;
const savedAtSeq = new Map<string, number>();

export const dismissAiNotice = () => set({ aiNotice: null });

const adoptExternalVersion = (key: string, tag: string | null, text: string | null) => {
  clearTimer(key);
  const { scope, path } = parseLessonKey(key);
  const edits = get().edits;
  const removed = tag === null || text === null;
  const draft = edits[key];
  const nextEdits = key in edits ? omitKey(edits, key) : edits;
  if (nextEdits !== edits) setEdits(nextEdits);
  if (removed && key in get().seen) setSeen(omitKey(get().seen, key));
  set((s) => {
    const nextFiles = removed
      ? s.files.filter((f) => f.key !== key)
      : upsertFile(s.files, { key, scope, path, tag, text });
    const nextOpen = removed && s.open === key ? null : s.open;
    return {
      files: nextFiles,
      pick: s.pick?.key === key ? null : s.pick,
      open: nextOpen,
      folder: nextOpen
        ? folderOfKey(nextOpen)
        : clampFolder(nextFiles, nextEdits, s.scopeFilter, s.folder),
      aiNotice: {
        id: ++noticeSeq,
        key,
        scope,
        path,
        removed,
        drafts: draft ? [{ path, text: draft.text }] : undefined,
      },
    };
  });
};

const clearTimer = (path: string) => {
  const id = timers.get(path);
  if (id !== undefined) {
    clearTimeout(id);
    timers.delete(path);
  }
};

export const clearLessonTimers = () => {
  for (const id of timers.values()) clearTimeout(id);
  timers.clear();
};

export const loadLessons = async () => {
  const myLoad = ++loadSeq;
  const startSaveSeq = saveSeq;
  set({ loadFailed: false });
  let got: { dir: string; projectDir?: string; files: WireLessonFile[] };
  try {
    const r = await fetch("/api/lessons");
    if (!r.ok) throw new Error("Could not load lessons");
    if (myLoad !== loadSeq) return;
    got = await r.json();
    if (!Array.isArray(got.files)) throw new Error("Invalid lessons list");
  } catch {
    if (myLoad === loadSeq) set({ loadFailed: true });
    return;
  }
  if (myLoad !== loadSeq) return;

  const incoming = got.files.map(normalizeFile);

  // Keep any local file versions saved or deleted after this GET started so stale responses never overwrite newer actions
  const mergedFiles = incoming.flatMap((f) => {
    if ((savedAtSeq.get(f.key) ?? 0) > startSaveSeq) {
      const local = fileOf(f.key);
      return local ? [local] : [];
    }
    return [f];
  });
  for (const local of get().files) {
    if (
      (savedAtSeq.get(local.key) ?? 0) > startSaveSeq &&
      !mergedFiles.some((f) => f.key === local.key)
    ) {
      mergedFiles.push(local);
    }
  }
  const sorted = sortFiles(mergedFiles);

  // a file never opened here starts as read: only what changes from now on is news
  const activeKeys = new Set(sorted.map((f) => f.key));
  const seen: LessonsState["seen"] = {};
  const liveEdits = get().edits;
  for (const [k, snap] of Object.entries(get().seen)) {
    if (activeKeys.has(k) || k in liveEdits) seen[k] = snap;
  }
  for (const f of sorted) seen[f.key] ??= { tag: f.tag, text: f.text };
  setSeen(seen);

  // words typed on an older version automatically yield to AI changes on disk
  let edits = get().edits;
  let pick = get().pick;
  let open = get().open;
  let aiNotice = get().aiNotice;
  let editsChanged = false;
  const replacedDrafts: RecoverableLessonDraft[] = [];
  for (const [key, e] of Object.entries(edits)) {
    if ((savedAtSeq.get(key) ?? 0) > startSaveSeq) continue;
    const f = sorted.find((x) => x.key === key);
    if (e.saving || (f?.tag ?? null) === e.base) continue;
    clearTimer(key);
    edits = omitKey(edits, key);
    editsChanged = true;
    if (pick?.key === key) pick = null;
    if (!f && open === key) open = null;
    const { scope, path } = parseLessonKey(key);
    replacedDrafts.push({ path, text: e.text });
    aiNotice = { id: ++noticeSeq, key, scope, path, removed: !f, drafts: replacedDrafts };
  }
  if (open && !(open in edits) && !sorted.some((f) => f.key === open)) open = null;
  if (editsChanged) setEdits(edits);
  const nextFolder = open
    ? folderOfKey(open)
    : clampFolder(sorted, edits, get().scopeFilter, get().folder);
  set({
    dir: got.dir,
    projectDir: got.projectDir ?? "",
    files: sorted,
    loaded: true,
    loadFailed: false,
    pick,
    open,
    folder: nextFolder,
    aiNotice,
  });

  // words a reload cut off before they were saved, still on the version they were typed on (skip actively debounced or failed edits)
  for (const [key, e] of Object.entries(edits))
    if (!e.saving && !e.failed && !timers.has(key)) void saveLesson(key);
};

export const typeLesson = (key: string, text: string) => {
  const e = get().edits[key],
    f = fileOf(key);
  setEdits({ ...get().edits, [key]: { ...e, text, base: e ? e.base : (f?.tag ?? null) } });
  clearTimer(key);
  if (text.length > LESSON_TEXT_MAX) return;
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      void saveLesson(key);
    }, SAVE_AFTER_MS),
  );
};

export const saveLesson = async (key: string): Promise<void> => {
  clearTimer(key);
  const e = get().edits[key];
  if (!e || e.saving || e.text.length > LESSON_TEXT_MAX) return;
  const { scope, path } = parseLessonKey(key);
  const sent = e.text;
  setEdits({ ...get().edits, [key]: { ...e, saving: true, failed: undefined } });
  let r: Response | null = null;
  try {
    r = await fetch("/api/lessons", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope, path, text: sent, base: e.base }),
    });
  } catch {}
  const body = (await r?.json().catch(() => null)) ?? {};
  const now = get().edits[key];
  if (!now) return;
  if (r?.ok) {
    const tag = body.tag as string;
    saveSeq += 1;
    savedAtSeq.set(key, saveSeq);
    set({ files: upsertFile(get().files, { key, scope, path, tag, text: sent }) });
    // the creator's own words are no news to them
    setSeen({ ...get().seen, [key]: { tag, text: sent } });
    const rest = omitKey(get().edits, key);
    if (now.text === sent) setEdits(rest);
    else {
      setEdits({ ...rest, [key]: { text: now.text, base: tag } });
      void saveLesson(key);
    }
  } else if (r?.status === 409) {
    const tag = typeof body.tag === "string" ? body.tag : null;
    const text = typeof body.text === "string" ? body.text : null;
    adoptExternalVersion(key, tag, text);
  } else {
    setEdits({
      ...get().edits,
      [key]: {
        ...now,
        saving: false,
        failed:
          typeof body.error === "string"
            ? body.error
            : body.error
              ? "the studio refused it (too long?)"
              : "the studio didn't answer",
      },
    });
    // a dropped line tries again; a refused name waits for the creator
    if (!body.error)
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          void saveLesson(key);
        }, 3000),
      );
  }
};

const folderOfKey = (key: string): string[] => {
  const { path } = parseLessonKey(key);
  const slash = path.lastIndexOf("/");
  return slash === -1 ? [] : path.slice(0, slash).split("/");
};

const longestValidFolder = (files: readonly LessonFile[], folder: readonly string[]): string[] => {
  for (let len = folder.length; len > 0; len--) {
    const prefix = `${folder.slice(0, len).join("/")}/`;
    if (files.some((f) => f.path.startsWith(prefix))) return folder.slice(0, len);
  }
  return [];
};

const clampFolder = (
  files: readonly LessonFile[],
  edits: Record<string, Edit>,
  scopeFilter: LessonScopeFilter,
  folder: readonly string[],
): string[] => {
  if (folder.length === 0) return [];
  const pool = new Map<string, LessonFile>();
  for (const f of files) {
    if (scopeFilter === "both" || f.scope === scopeFilter) pool.set(f.key, f);
  }
  for (const key of Object.keys(edits)) {
    const { scope, path } = parseLessonKey(key);
    if ((scopeFilter === "both" || scope === scopeFilter) && !pool.has(key)) {
      pool.set(key, { key, scope, path, tag: "", text: "" });
    }
  }
  return longestValidFolder([...pool.values()], folder);
};

export const markRead = (key: string) => {
  const f = fileOf(key);
  if (f) setSeen({ ...get().seen, [key]: { tag: f.tag, text: f.text } });
};
export const openLesson = (open: string | null) =>
  set((s) => ({ open, folder: open ? folderOfKey(open) : s.folder }));
export const openLessonFolder = (folder: string[]) => set({ open: null, folder: [...folder] });
export const setScopeFilter = (scopeFilter: LessonScopeFilter) =>
  set((s) => {
    if (scopeFilter === "both") return { scopeFilter };
    const scoped = s.files.filter((f) => f.scope === scopeFilter);
    const hasOpen =
      s.open !== null &&
      parseLessonKey(s.open).scope === scopeFilter &&
      (scoped.some((f) => f.key === s.open) || s.open in s.edits);
    const nextOpen = hasOpen ? s.open : null;
    const nextFolder = nextOpen
      ? folderOfKey(nextOpen)
      : clampFolder(s.files, s.edits, scopeFilter, s.folder);
    return { scopeFilter, open: nextOpen, folder: nextFolder };
  });
export const setLessonView = (key: string, mode: LessonViewMode, remember = true) =>
  set((s) => {
    const persist = remember && (mode === "read" || mode === "edit");
    if (!persist) return { viewByPath: { ...s.viewByPath, [key]: mode } };
    stored.set(VIEW, mode);
    const nextViews = Object.fromEntries(
      Object.entries(s.viewByPath).filter(([, m]) => m === "changes"),
    );
    return { preferredView: mode, viewByPath: { ...nextViews, [key]: mode } };
  });

export type DeleteLessonResult =
  | { removed: true; path: string; restore: () => Promise<boolean> }
  | { removed: false; conflict?: boolean; missing?: boolean; error?: string };

const deleting = new Set<string>();

export const deleteLesson = async (
  key: string,
  onBeforeRemove?: () => void,
): Promise<DeleteLessonResult> => {
  if (deleting.has(key)) return { removed: false, error: "delete already in progress" };
  deleting.add(key);
  try {
    clearTimer(key);
    const f = fileOf(key);
    const { scope, path } = f ?? parseLessonKey(key);
    const edit = get().edits[key];
    const snapshot = edit?.text ?? f?.text ?? null;
    const base = edit ? edit.base : (f?.tag ?? null);
    let r: Response | null = null;
    try {
      r = await fetch("/api/lessons", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope, path, base }),
      });
    } catch {
      return { removed: false, error: "the studio didn't answer" };
    }
    const body = (await r.json().catch(() => null)) ?? {};
    if (r.status === 409) {
      const tag = typeof body.tag === "string" ? body.tag : null;
      const text = typeof body.text === "string" ? body.text : null;
      adoptExternalVersion(key, tag, text);
      if (tag !== null && text !== null) openLesson(key);
      return { removed: false, conflict: true };
    }
    if (!r.ok) {
      return {
        removed: false,
        error: typeof body.error === "string" ? body.error : "could not delete lesson",
      };
    }
    saveSeq += 1;
    savedAtSeq.set(key, saveSeq);
    onBeforeRemove?.();
    if (body.missing === true) {
      adoptExternalVersion(key, null, null);
      return { removed: false, missing: true };
    }
    const nextEdits = omitKey(get().edits, key);
    set((s) => {
      const nextFiles = s.files.filter((x) => x.key !== key);
      const nextOpen = s.open === key ? null : s.open;
      return {
        files: nextFiles,
        viewByPath: omitKey(s.viewByPath, key),
        open: nextOpen,
        folder: nextOpen
          ? folderOfKey(nextOpen)
          : clampFolder(nextFiles, nextEdits, s.scopeFilter, s.folder),
        pick: s.pick?.key === key ? null : s.pick,
      };
    });
    setEdits(nextEdits);
    setSeen(omitKey(get().seen, key));
    const restore = async (): Promise<boolean> => {
      if (snapshot === null) return false;
      let res: Response | null = null;
      try {
        res = await fetch("/api/lessons", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scope, path, text: snapshot, base: null }),
        });
      } catch {
        return false;
      }
      if (!res.ok) return false;
      const saved = (await res.json().catch(() => null)) ?? {};
      const tag = typeof saved.tag === "string" ? saved.tag : null;
      if (!tag) return false;
      saveSeq += 1;
      savedAtSeq.set(key, saveSeq);
      set({ files: upsertFile(get().files, { key, scope, path, tag, text: snapshot }) });
      setSeen({ ...get().seen, [key]: { tag, text: snapshot } });
      openLesson(key);
      return true;
    };
    return { removed: true, path, restore };
  } finally {
    deleting.delete(key);
  }
};

// A new file: lessons/<name>.md in this film or every film (src/lesson-template.ts), its rule heading picked for the first words
export const LESSON_NAME = /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+(?:\.md)?$/;
export const newLesson = (name: string, scope: LessonScope = "film") => {
  const path = lessonPath(name);
  const existing = findExistingLesson(scope, name);
  if (existing) return openLesson(existing.key);
  const key = lessonKey(scope, path);
  const { text, pick } = lessonTemplate(path);
  setEdits({ ...get().edits, [key]: { text, base: null } });
  set({ pick: { key, range: pick } });
  openLesson(key);
  void saveLesson(key);
};
// the editor takes the pick once, as it opens the file
export const takePick = (key: string) => {
  const p = get().pick;
  if (p?.key !== key) return null;
  set({ pick: null });
  return p.range;
};
