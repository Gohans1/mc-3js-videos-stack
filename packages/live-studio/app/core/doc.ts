import { equalJson, mergeEdits } from "../../src/merge-edits.mjs";
import { getFile, postJson } from "./net";
import { say, showError } from "./store";

export type SaveState = "busy" | "fail" | "pending" | null;
export interface PendingDoc {
  name: string;
  label: string;
}

export interface Doc<T> {
  readonly data: T | null;
  load: (query?: string, onJson?: (got: unknown) => void) => Promise<Response | null>;
  edit: (change: (d: T) => void) => void;
  preview: (change: (d: T) => void) => void;
  snapshot: () => string;
  restore: (snap: string) => void;
}
export interface Hooks<T> {
  label: string;
  changed: () => void;
  tidy?: (d: T) => void;
  received?: (before: T, after: T) => void;
  saved?: (state: SaveState) => void;
  replaced?: (was: T | null) => void;
}

type SaveLifecycle =
  | { kind: "clean" }
  | { kind: "dirty"; timer: number | null; failed: boolean }
  | { kind: "saving"; dirtyDuringSave: boolean };

interface Side {
  name: string;
  label: string;
  data: () => unknown;
  version: string;
  lifecycle: SaveLifecycle;
  partners: Set<Side>;
  later: (ms?: number) => void;
  load: () => Promise<unknown>;
  saved?: (state: SaveState) => void;
  swap: (snap: string) => string;
  accept: (sent: unknown, data: unknown) => boolean;
  revert: () => void;
  cancelTimer: () => void;
}
const isSaving = (s: Side) => s.lifecycle.kind === "saving";
const isUnsaved = (s: Side) =>
  s.lifecycle.kind === "dirty" || (s.lifecycle.kind === "saving" && s.lifecycle.dirtyDuringSave);
const sides = new Set<Side>();
const pending = new Set<Promise<void>>();
let autoSave = true;
let pendingSnapshot: readonly PendingDoc[] = [];
const pendingListeners = new Set<() => void>();
const emitPending = () => {
  const next: PendingDoc[] = [];
  for (const s of sides) if (isUnsaved(s)) next.push({ name: s.name, label: s.label });
  if (
    next.length === pendingSnapshot.length &&
    next.every(
      (item, i) =>
        item.name === pendingSnapshot[i]?.name && item.label === pendingSnapshot[i]?.label,
    )
  )
    return;
  pendingSnapshot = next;
  for (const fn of pendingListeners) fn();
};
export const subscribePending = (fn: () => void) => {
  pendingListeners.add(fn);
  return () => {
    pendingListeners.delete(fn);
  };
};
export const getPendingSnapshot = () => pendingSnapshot;
export const isAutoSave = () => autoSave;
export const setAutoSave = (on: boolean) => {
  if (autoSave === on) return;
  autoSave = on;
  for (const s of sides) {
    if (s.lifecycle.kind !== "dirty") continue;
    if (autoSave) {
      s.later(0);
    } else {
      s.cancelTimer();
      s.saved?.("pending");
    }
  }
  emitPending();
  for (const fn of pendingListeners) fn();
};

type Entry = { side: Side; snap: string; group: number };
const undos: Entry[] = [],
  redos: Entry[] = [];
let group = 0,
  touched: Set<Side> | null = null;
const mutListeners = new Set<(name: string) => void>();
export const onDocMutated = (fn: (name: string) => void) => {
  mutListeners.add(fn);
  return () => {
    mutListeners.delete(fn);
  };
};
const emitMutated = (name: string) => {
  for (const fn of mutListeners) fn(name);
};
const link = (sides: Iterable<Side>) => {
  const all = [...sides];
  for (const s of all) for (const o of all) if (o !== s) s.partners.add(o);
};
export const together = (run: () => void) => {
  if (touched) {
    run();
    return;
  }
  group++;
  touched = new Set();
  try {
    run();
    link(touched);
  } finally {
    touched = null;
  }
};
const forget = (side: Side) => {
  for (const list of [undos, redos])
    for (let i = list.length - 1; i >= 0; i--) if (list[i].side === side) list.splice(i, 1);
};
const teamOf = (side: Side) => {
  const team = new Set([side]);
  for (const s of team) for (const p of s.partners) team.add(p);
  return [...team];
};

const saveTeam = async (me: Side) => {
  const team = teamOf(me);
  if (team.some(isSaving)) {
    if (!isSaving(me)) me.later();
    return;
  }
  if (team.some((s) => s.data() === null)) return;
  for (const s of team) {
    s.cancelTimer();
    s.lifecycle = { kind: "saving", dirtyDuringSave: false };
    s.partners.clear();
    s.saved?.("busy");
  }
  const one = team.length === 1,
    labels = team.map((s) => s.label).join(" + ");
  const sent = new Map(team.map((s) => [s, s.data()]));
  const failed = () => {
    link(team);
    for (const s of team) {
      s.lifecycle = { kind: "dirty", timer: null, failed: true };
      s.saved?.("fail");
    }
  };
  try {
    const r = one
      ? await postJson(`/api/${me.name}`, { base: me.version, data: sent.get(me) })
      : await postJson("/api/together", {
          files: team.map((s) => ({ name: s.name, base: s.version, data: sent.get(s) })),
        });
    if (r.status === 409) {
      failed();
      showError(
        `Couldn't merge ${labels}: the base version is unavailable. Your unsaved edit is still here; copy it before reloading.`,
      );
      return;
    }
    if (r.status === 400) {
      showError(`Couldn't save ${labels}:\n\n${((await r.json()).problems ?? []).join("\n\n")}`);
      failed();
      return;
    }
    if (!r.ok) throw new Error(String(r.status));
    const got: {
      version?: string;
      versions?: Record<string, string>;
      data?: unknown;
      files?: Record<string, unknown>;
      retained?: string[];
    } = await r.json();
    for (const s of team) {
      s.version = one ? got.version! : got.versions![s.name];
      const resData = one ? got.data : got.files?.[s.name];
      const acceptedDirty = s.accept(sent.get(s), resData !== undefined ? resData : sent.get(s));
      const stillUnsaved =
        acceptedDirty || (s.lifecycle.kind === "saving" && s.lifecycle.dirtyDuringSave);
      s.lifecycle = stillUnsaved ? { kind: "dirty", timer: null, failed: false } : { kind: "clean" };
      s.saved?.(stillUnsaved && !autoSave ? "pending" : null);
    }
    emitPending();
    if (got.retained?.length)
      say(`Kept your edits while merging ${labels}: ${got.retained.join(", ")}`, 6000);
  } catch {
    failed();
    if (autoSave) me.later(3000);
    emitPending();
    return;
  }
  for (const s of team) if (s.lifecycle.kind === "dirty" && autoSave) s.later();
};

const save = (side: Side) => {
  side.cancelTimer();
  if (!isUnsaved(side)) return Promise.resolve();
  const request = saveTeam(side);
  pending.add(request);
  request.then(
    () => pending.delete(request),
    () => pending.delete(request),
  );
  return request;
};
export const flushDocs = async () => {
  for (const side of sides) side.cancelTimer();
  await Promise.all(pending);
  for (const side of sides) if (isUnsaved(side)) await save(side);
  emitPending();
  if ([...sides].some((side) => isUnsaved(side) || isSaving(side)))
    throw new Error(
      "Some edits could not be saved. Resolve the save error before saving or restoring a version.",
    );
};

export const confirmDocs = async (): Promise<boolean> => {
  try {
    await flushDocs();
    return pendingSnapshot.length === 0;
  } catch {
    emitPending();
    return false;
  }
};

export const revertDocs = async () => {
  const dirty = [...sides].filter(isUnsaved);
  for (const s of sides) s.cancelTimer();
  if (!dirty.length) return;
  for (const s of dirty) {
    s.revert();
    emitMutated(s.name);
  }
  emitPending();
  await Promise.all(dirty.map((s) => s.load()));
};

type Got<T> = { version: string; data: T };
type PreviewState<T> =
  | { kind: "live" }
  | { kind: "previewing"; held: Got<T> | null }
  | { kind: "restored"; baseSnap: string; held: Got<T> | null };

export const createDoc = <T>(name: string, hooks: Hooks<T>): Doc<T> => {
  const orderedRows = name === "cam" || name === "shots";
  let data: T | null = null,
    kept = "null",
    diskJson = "null",
    previewState: PreviewState<T> = { kind: "live" };
  const setDirtyFlag = (dirty: boolean) => {
    if (side.lifecycle.kind === "saving") {
      side.lifecycle = { kind: "saving", dirtyDuringSave: dirty };
    } else if (dirty) {
      side.lifecycle =
        side.lifecycle.kind === "dirty"
          ? { ...side.lifecycle, failed: false }
          : { kind: "dirty", timer: null, failed: false };
    } else {
      side.cancelTimer();
      side.lifecycle = { kind: "clean" };
    }
  };
  const side: Side = {
    name,
    label: hooks.label,
    data: () => JSON.parse(kept),
    version: "",
    lifecycle: { kind: "clean" },
    partners: new Set(),
    later: (ms = 300) => {
      side.cancelTimer();
      if (side.lifecycle.kind === "saving") return;
      const timer = window.setTimeout(() => save(side), ms);
      if (side.lifecycle.kind === "dirty") {
        side.lifecycle = { ...side.lifecycle, timer };
      } else {
        side.lifecycle = { kind: "dirty", timer, failed: false };
      }
    },
    load: () => load(),
    saved: hooks.saved,
    cancelTimer: () => {
      if (side.lifecycle.kind === "dirty" && side.lifecycle.timer !== null) {
        clearTimeout(side.lifecycle.timer);
        side.lifecycle = { ...side.lifecycle, timer: null };
      }
    },
    accept: (sent, canonical) => {
      if (equalJson(sent, canonical)) {
        diskJson = JSON.stringify(sent);
        const stillUnsaved = kept !== diskJson;
        setDirtyFlag(stillUnsaved);
        emitPending();
        return stillUnsaved;
      }
      const diskCopy = structuredClone(canonical) as T;
      hooks.tidy?.(diskCopy);
      diskJson = JSON.stringify(diskCopy);
      const old = data;
      const next = mergeEdits(sent, JSON.parse(kept), canonical, orderedRows).data as T;
      kept = JSON.stringify(next);
      const stillUnsaved = !equalJson(next, canonical);
      setDirtyFlag(stillUnsaved);
      for (const list of [undos, redos])
        for (const entry of list)
          if (entry.side === side)
            entry.snap = JSON.stringify(
              mergeEdits(sent, JSON.parse(entry.snap), canonical, orderedRows).data,
            );
      if (previewState.kind === "previewing") {
        previewState = { kind: "previewing", held: { version: side.version, data: next } };
      } else {
        data = next;
        hooks.tidy?.(data);
        hooks.changed();
        emitMutated(name);
        hooks.replaced?.(old);
      }
      emitPending();
      return stillUnsaved;
    },
    swap: (snap) => {
      const old = data,
        was = kept;
      data = JSON.parse(snap);
      previewState = { kind: "live" };
      hooks.tidy?.(data!);
      kept = JSON.stringify(data);
      const dirty = kept !== diskJson;
      setDirtyFlag(dirty);
      hooks.changed();
      emitMutated(name);
      hooks.replaced?.(old);
      if (!dirty) {
        side.cancelTimer();
        side.saved?.(null);
      } else if (autoSave) side.later();
      else side.saved?.("pending");
      emitPending();
      return was;
    },
    revert: () => {
      side.cancelTimer();
      if (!isUnsaved(side) || diskJson === "null") return;
      const old = data;
      data = JSON.parse(diskJson) as T;
      previewState = { kind: "live" };
      hooks.tidy?.(data);
      kept = JSON.stringify(data);
      side.lifecycle =
        side.lifecycle.kind === "saving"
          ? { kind: "saving", dirtyDuringSave: false }
          : { kind: "clean" };
      forget(side);
      hooks.changed();
      hooks.replaced?.(old);
      hooks.saved?.(null);
    },
  };
  sides.add(side);
  const take = (got: Got<T>) => {
    if (side.version && side.version !== got.version) forget(side);
    side.version = got.version;
    previewState = { kind: "live" };
    const old = data,
      before = old !== null && hooks.received ? (JSON.parse(kept) as T) : null;
    data = got.data;
    hooks.tidy?.(data);
    diskJson = kept = JSON.stringify(data);
    side.cancelTimer();
    side.lifecycle = { kind: "clean" };
    hooks.changed();
    emitMutated(name);
    hooks.replaced?.(old);
    if (before !== null && !equalJson(before, data)) hooks.received?.(before, data);
    hooks.saved?.(null);
    emitPending();
  };
  const release = () => {
    if (previewState.kind === "restored" && previewState.held) take(previewState.held);
  };
  const load = async (query = "", onJson?: (got: unknown) => void) => {
    const r = await getFile(`/api/${name}${query}`);
    if (!r.ok) return null;
    const got = (await r.json()) as Got<T>;
    onJson?.(got);
    if (isUnsaved(side) || isSaving(side)) return r;
    if (got.version === side.version) return r;
    if (previewState.kind === "previewing") previewState = { kind: "previewing", held: got };
    else take(got);
    return r;
  };
  return {
    get data() {
      return data;
    },
    load,
    edit: (change: (d: T) => void) => {
      if (!data) return;
      const prevPreview = previewState;
      previewState = { kind: "live" };
      const editBase = prevPreview.kind === "restored" ? prevPreview.baseSnap : null;
      if (editBase !== null) data = JSON.parse(editBase);
      else if (prevPreview.kind === "previewing" || JSON.stringify(data) !== kept)
        data = JSON.parse(kept);
      change(data!);
      hooks.tidy?.(data!);
      if (editBase !== null)
        data = mergeEdits(JSON.parse(editBase), data, JSON.parse(kept), orderedRows).data;
      const next = JSON.stringify(data);
      if (next === kept) {
        hooks.changed();
        if (prevPreview.kind !== "live" && prevPreview.held) take(prevPreview.held);
        return;
      }
      if (touched) touched.add(side);
      else group++;
      undos.push({ side, snap: kept, group });
      if (undos.length > 100) undos.shift();
      redos.length = 0;
      kept = next;
      const dirty = next !== diskJson;
      setDirtyFlag(dirty);
      hooks.changed();
      emitMutated(name);
      if (!dirty) {
        side.cancelTimer();
        side.saved?.(null);
      } else if (autoSave) side.later();
      else side.saved?.("pending");
      emitPending();
    },
    preview: (change: (d: T) => void) => {
      if (data) {
        change(data);
        const held = previewState.kind === "live" ? null : previewState.held;
        previewState = { kind: "previewing", held };
        hooks.changed();
      }
    },
    snapshot: () => JSON.stringify(data),
    restore: (snap: string) => {
      if (previewState.kind !== "previewing") return;
      const held = previewState.held;
      previewState = { kind: "restored", baseSnap: snap, held };
      data = JSON.parse(snap);
      hooks.changed();
      if (held) queueMicrotask(release);
    },
  };
};

const step = (from: Entry[], to: Entry[], word: string) => {
  const g = from[from.length - 1]?.group;
  if (g === undefined) return false;
  const sides = new Set<Side>();
  while (from[from.length - 1]?.group === g) {
    const e = from.pop()!;
    sides.add(e.side);
    to.push({ side: e.side, snap: e.side.swap(e.snap), group: g });
  }
  link(sides);
  say(word);
  return true;
};
export const undo = () => step(undos, redos, "Undone");
export const redo = () => step(redos, undos, "Redone");
export const canUndo = () => undos.length > 0,
  canRedo = () => redos.length > 0;
