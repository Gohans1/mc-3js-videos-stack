// The Lessons tab's state: the repo's lessons/*.md (src/lesson-files.mjs), what the creator is typing into them, and the copy of
// each file they last read, so what the AI changed since shows as a review (changes.ts). As md-phone does it: typing saves by
// itself, a save names the version it was made on and the server refuses it when the AI wrote meanwhile (the creator then
// picks whose words stay), and unsaved words wait on the device through a reload
import { createStore, useStore } from "zustand";

import { lessonTemplate } from "../../src/lesson-template";
import { stored } from "../core/storage";

export type LessonViewMode = "read" | "edit" | "changes";
export type LessonPreferredView = "read" | "edit";

export interface LessonFile {
  path: string;
  tag: string;
  text: string;
}
interface Edit {
  text: string;
  base: string | null; // the version these words were typed on
  saving?: boolean;
  failed?: string;
  conflict?: { tag: string | null; text: string | null }; // the file as the AI left it
}
interface LessonsState {
  dir: string;
  files: LessonFile[];
  loaded: boolean;
  open: string | null;
  preferredView: LessonPreferredView;
  viewByPath: Record<string, LessonViewMode>;
  edits: Record<string, Edit>;
  seen: Record<string, { tag: string; text: string }>;
  pick: { path: string; range: readonly [number, number] } | null; // words to select as the editor opens a new file
}
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
export const readPreferredLessonView = (): LessonPreferredView =>
  stored.get(VIEW) === "edit" ? "edit" : "read";

const omitKey = <T>(record: Record<string, T>, key: string): Record<string, T> => {
  if (!(key in record)) return record;
  const { [key]: _, ...rest } = record;
  return rest;
};

const upsertFile = (files: LessonFile[], next: LessonFile): LessonFile[] =>
  files.some((f) => f.path === next.path)
    ? files.map((f) => (f.path === next.path ? next : f))
    : [...files, next].toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

export const lessons = createStore<LessonsState>(() => ({
  dir: "",
  files: [],
  loaded: false,
  open: null,
  preferredView: readPreferredLessonView(),
  viewByPath: {},
  edits: Object.fromEntries(
    Object.entries(readJson<Record<string, Edit>>(DRAFTS, {})).map(([p, e]) => [
      p,
      { text: e.text, base: e.base },
    ]),
  ),
  seen: readJson(SEEN, {}),
  pick: null,
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
const fileOf = (path: string) => get().files.find((f) => f.path === path);
const findExistingLesson = (path: string) => {
  const lower = path.toLowerCase();
  return get().files.find((f) => f.path.toLowerCase() === lower);
};

const timers = new Map<string, ReturnType<typeof setTimeout>>();
let loadSeq = 0;
let saveSeq = 0;
const savedAtSeq = new Map<string, number>();

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
  let got: { dir: string; files: LessonFile[] };
  try {
    const r = await fetch("/api/lessons");
    if (!r.ok || myLoad !== loadSeq) return;
    got = await r.json();
  } catch {
    return;
  }
  if (myLoad !== loadSeq) return;

  // Keep any local file versions saved or deleted after this GET started so stale responses never overwrite newer actions
  const mergedFiles = got.files.flatMap((f) => {
    if ((savedAtSeq.get(f.path) ?? 0) > startSaveSeq) {
      const local = fileOf(f.path);
      return local ? [local] : [];
    }
    return [f];
  });
  for (const local of get().files) {
    if (
      (savedAtSeq.get(local.path) ?? 0) > startSaveSeq &&
      !mergedFiles.some((f) => f.path === local.path)
    ) {
      mergedFiles.push(local);
    }
  }
  mergedFiles.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  // a file never opened here starts as read: only what changes from now on is news
  const seen = { ...get().seen };
  for (const f of mergedFiles) seen[f.path] ??= { tag: f.tag, text: f.text };
  setSeen(seen);

  // words typed on a version the AI has since changed wait for the creator's pick
  const edits = { ...get().edits };
  let editsChanged = false;
  for (const [path, e] of Object.entries(edits)) {
    if ((savedAtSeq.get(path) ?? 0) > startSaveSeq) continue;
    const f = mergedFiles.find((x) => x.path === path);
    if (e.saving || e.conflict || (f?.tag ?? null) === e.base) continue;
    clearTimer(path);
    edits[path] = { ...e, conflict: { tag: f?.tag ?? null, text: f?.text ?? null } };
    editsChanged = true;
  }
  set({ dir: got.dir, files: mergedFiles, loaded: true });
  if (editsChanged) setEdits(edits);

  // words a reload cut off before they were saved, still on the version they were typed on (skip actively debounced or failed edits)
  for (const [path, e] of Object.entries(edits))
    if (!e.conflict && !e.saving && !e.failed && !timers.has(path)) void saveLesson(path);
};

export const typeLesson = (path: string, text: string) => {
  const e = get().edits[path],
    f = fileOf(path);
  setEdits({ ...get().edits, [path]: { ...e, text, base: e ? e.base : (f?.tag ?? null) } });
  clearTimer(path);
  timers.set(
    path,
    setTimeout(() => {
      timers.delete(path);
      void saveLesson(path);
    }, SAVE_AFTER_MS),
  );
};

export const saveLesson = async (path: string): Promise<void> => {
  clearTimer(path);
  const e = get().edits[path];
  if (!e || e.saving || e.conflict) return;
  const sent = e.text;
  setEdits({ ...get().edits, [path]: { ...e, saving: true, failed: undefined } });
  let r: Response | null = null;
  try {
    r = await fetch("/api/lessons", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, text: sent, base: e.base }),
    });
  } catch {}
  const body = (await r?.json().catch(() => null)) ?? {};
  const now = get().edits[path];
  if (!now) return;
  if (r?.ok) {
    const tag = body.tag as string;
    saveSeq += 1;
    savedAtSeq.set(path, saveSeq);
    set({ files: upsertFile(get().files, { path, tag, text: sent }) });
    // the creator's own words are no news to them
    setSeen({ ...get().seen, [path]: { tag, text: sent } });
    const rest = omitKey(get().edits, path);
    if (now.text === sent) setEdits(rest);
    else {
      setEdits({ ...rest, [path]: { text: now.text, base: tag } });
      void saveLesson(path);
    }
  } else if (r?.status === 409)
    setEdits({ ...get().edits, [path]: { ...now, saving: false, conflict: body } });
  else {
    setEdits({
      ...get().edits,
      [path]: {
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
        path,
        setTimeout(() => {
          timers.delete(path);
          void saveLesson(path);
        }, 3000),
      );
  }
};

// The creator's pick after a refused save: their words over the AI's, or the AI's file as it is
export const keepMine = (path: string) => {
  clearTimer(path);
  const e = get().edits[path];
  if (!e?.conflict) return;
  setEdits({ ...get().edits, [path]: { text: e.text, base: e.conflict.tag } });
  void saveLesson(path);
};
export const takeTheirs = (path: string) => {
  clearTimer(path);
  const e = get().edits[path];
  if (!e?.conflict) return;
  const rest = omitKey(get().edits, path);
  setEdits(rest);
  const { tag, text } = e.conflict;
  set({
    files:
      tag === null || text === null
        ? get().files.filter((f) => f.path !== path)
        : get().files.map((f) => (f.path === path ? { path, tag, text } : f)),
  });
};

export const markRead = (path: string) => {
  const f = fileOf(path);
  if (f) setSeen({ ...get().seen, [path]: { tag: f.tag, text: f.text } });
};
export const openLesson = (open: string | null) => set({ open });
export const setLessonView = (path: string, mode: LessonViewMode, remember = true) =>
  set((s) => {
    const persist = remember && (mode === "read" || mode === "edit");
    if (!persist) return { viewByPath: { ...s.viewByPath, [path]: mode } };
    stored.set(VIEW, mode);
    const nextViews = Object.fromEntries(
      Object.entries(s.viewByPath).filter(([, m]) => m === "changes"),
    );
    return { preferredView: mode, viewByPath: { ...nextViews, [path]: mode } };
  });

export type DeleteLessonResult =
  | { removed: true; path: string; restore: () => Promise<boolean> }
  | { removed: false; conflict?: boolean; error?: string };

const deleting = new Set<string>();

export const deleteLesson = async (path: string): Promise<DeleteLessonResult> => {
  if (deleting.has(path)) return { removed: false, error: "delete already in progress" };
  deleting.add(path);
  try {
    clearTimer(path);
    const f = fileOf(path);
    const edit = get().edits[path];
    const snapshot = edit?.text ?? f?.text ?? null;
    const base = edit ? edit.base : (f?.tag ?? null);
    let r: Response | null = null;
    try {
      r = await fetch("/api/lessons", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path, base }),
      });
    } catch {
      return { removed: false, error: "the studio didn't answer" };
    }
    const body = (await r.json().catch(() => null)) ?? {};
    if (r.status === 409) {
      const tag = typeof body.tag === "string" ? body.tag : null;
      const text = typeof body.text === "string" ? body.text : null;
      if (tag !== null && text !== null)
        set({ files: upsertFile(get().files, { path, tag, text }) });
      const currentEdit = get().edits[path];
      if (currentEdit && currentEdit.base !== tag) {
        setEdits({
          ...get().edits,
          [path]: { ...currentEdit, saving: false, conflict: { tag, text } },
        });
      }
      openLesson(path);
      return { removed: false, conflict: true };
    }
    if (!r.ok) {
      return {
        removed: false,
        error: typeof body.error === "string" ? body.error : "could not delete lesson",
      };
    }
    saveSeq += 1;
    savedAtSeq.set(path, saveSeq);
    set((s) => ({
      files: s.files.filter((x) => x.path !== path),
      viewByPath: omitKey(s.viewByPath, path),
      open: s.open === path ? null : s.open,
      pick: s.pick?.path === path ? null : s.pick,
    }));
    setEdits(omitKey(get().edits, path));
    setSeen(omitKey(get().seen, path));
    const restore = async (): Promise<boolean> => {
      if (snapshot === null) return false;
      let res: Response | null = null;
      try {
        res = await fetch("/api/lessons", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path, text: snapshot, base: null }),
        });
      } catch {
        return false;
      }
      if (!res.ok) return false;
      const saved = (await res.json().catch(() => null)) ?? {};
      const tag = typeof saved.tag === "string" ? saved.tag : null;
      if (!tag) return false;
      saveSeq += 1;
      savedAtSeq.set(path, saveSeq);
      set({ files: upsertFile(get().files, { path, tag, text: snapshot }) });
      setSeen({ ...get().seen, [path]: { tag, text: snapshot } });
      openLesson(path);
      return true;
    };
    return { removed: true, path, restore };
  } finally {
    deleting.delete(path);
  }
};

// A new file: lessons/<name>.md in the shape Jev reads (src/lesson-template.ts), its rule heading picked for the first words
export const LESSON_NAME = /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+(?:\.md)?$/;
export const newLesson = (name: string) => {
  const path = `${name.replace(/\.md$/, "")}.md`;
  const existing = findExistingLesson(path);
  if (existing) return openLesson(existing.path);
  const { text, pick } = lessonTemplate(path);
  setEdits({ ...get().edits, [path]: { text, base: null } });
  set({ pick: { path, range: pick } });
  openLesson(path);
  void saveLesson(path);
};
// the editor takes the pick once, as it opens the file
export const takePick = (path: string) => {
  const p = get().pick;
  if (p?.path !== path) return null;
  set({ pick: null });
  return p.range;
};
