import { equalJson, mergeEdits } from "../../src/merge-edits.mjs";
// Studio edits merge against their explicit base; conflicting fields keep the person's value.
// Unsaved edits remain recoverable if their base is no longer available.
import { getFile, postJson } from "./net";
import { say, showError } from "./store";

export type SaveState = "busy" | "fail" | "pending" | null;
export interface PendingDoc {
  name: string;
  label: string;
}

export interface Doc<T> {
  readonly data: T | null;
  load: (query?: string, onJson?: (got: unknown) => void) => Promise<Response | null>; // the server's answer, for what else it sent (the sound library)
  edit: (change: (d: T) => void) => void;
  preview: (change: (d: T) => void) => void; // drawn, not kept: a drag's end makes it one edit
  snapshot: () => string;
  restore: (snap: string) => void;
}
export interface Hooks<T> {
  label: string; // what the say lines call it: "audio", "camera"
  changed: () => void; // after every change to data
  tidy?: (d: T) => void; // after every kept edit and every load, before drawing
  received?: (before: T, after: T) => void;
  saved?: (state: SaveState) => void;
  // After undo, redo or a load put other data in (was: what it held): picks kept as places in a list may now point at other
  // things (an undone paste leaves the next clip at its place), so each file drops its picks when its lists changed length
  replaced?: (was: T | null) => void;
}

// One file's saving state, reachable from the others it must be saved with
interface Side {
  name: string;
  label: string;
  data: () => unknown;
  version: string;
  saving: boolean;
  unsaved: boolean;
  partners: Set<Side>; // changed together with this one since the last save
  later: (ms?: number) => void;
  load: () => Promise<unknown>;
  saved?: (state: SaveState) => void;
  swap: (snap: string) => string; // undo/redo: put snap in, give back what it held
  accept: (sent: unknown, data: unknown) => void;
  revert: () => void;
  cancelTimer: () => void;
}
const sides = new Set<Side>();
const pending = new Set<Promise<void>>();
let autoSave = true;
let pendingSnapshot: readonly PendingDoc[] = [];
const pendingListeners = new Set<() => void>();
const emitPending = () => {
  const next: PendingDoc[] = [];
  for (const s of sides) if (s.unsaved) next.push({ name: s.name, label: s.label });
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
    if (!s.unsaved) continue;
    if (autoSave) {
      if (!s.saving) s.later(0);
    } else {
      s.cancelTimer();
      if (!s.saving) s.saved?.("pending");
    }
  }
  emitPending();
  for (const fn of pendingListeners) fn();
};

type Entry = { side: Side; snap: string; group: number };
const undos: Entry[] = [],
  redos: Entry[] = [];
// Edits made inside together() (one drag over keys in two files) are undone, redone and saved as one
let group = 0,
  touched: Set<Side> | null = null;
const mutListeners = new Set<() => void>();
export const onDocMutated = (fn: () => void) => {
  mutListeners.add(fn);
  return () => {
    mutListeners.delete(fn);
  };
};
const emitMutated = () => {
  for (const fn of mutListeners) fn();
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
  if (team.some((s) => s.saving)) {
    me.later();
    return;
  } // one of them is on its way: again once it's back
  if (team.some((s) => s.data() === null)) return;
  for (const s of team) {
    s.saving = true;
    s.unsaved = false;
    s.partners.clear();
    s.saved?.("busy");
  }
  const one = team.length === 1,
    labels = team.map((s) => s.label).join(" + ");
  const sent = new Map(team.map((s) => [s, s.data()]));
  const failed = () => {
    link(team);
    for (const s of team) {
      s.unsaved = true;
      s.saving = false;
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
    // Refused as it stands (the file's schema): the same data would be refused again, so it waits for the next change or undo
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
      s.accept(sent.get(s), resData !== undefined ? resData : sent.get(s));
      s.saving = false;
      s.saved?.(s.unsaved && !autoSave ? "pending" : null);
    }
    emitPending();
    if (got.retained?.length)
      say(`Kept your edits while merging ${labels}: ${got.retained.join(", ")}`, 6000);
  } catch {
    failed();
    if (autoSave) me.later(3000); // a dropped line: tried again when auto-saving
    emitPending();
    return;
  }
  for (const s of team) s.saving = false;
  for (const s of team) if (s.unsaved && autoSave) s.later();
};

const save = (side: Side) => {
  side.cancelTimer();
  if (!side.unsaved) return Promise.resolve();
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
  for (const side of sides) if (side.unsaved) await save(side);
  emitPending();
  if ([...sides].some((side) => side.unsaved || side.saving))
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
  const dirty = [...sides].filter((s) => s.unsaved);
  for (const s of sides) s.cancelTimer();
  if (!dirty.length) return;
  for (const s of dirty) s.revert();
  emitMutated();
  emitPending();
  await Promise.all(dirty.map((s) => s.load()));
};

type Got<T> = { version: string; data: T };

export const createDoc = <T>(name: string, hooks: Hooks<T>): Doc<T> => {
  // data is what is drawn, kept (JSON) the last state worth saving, diskJson the last state confirmed on disk. shown: a preview is on,
  // from its first change to the restore or edit that ends it, even while a drag is back where it started and data equals kept
  const orderedRows = name === "cam" || name === "shots";
  let data: T | null = null,
    kept = "null",
    diskJson = "null",
    shown = false,
    held: Got<T> | null = null,
    restoredPreviewBase: string | null = null,
    timer = 0;
  const side: Side = {
    name,
    label: hooks.label,
    data: () => JSON.parse(kept),
    version: "",
    saving: false,
    unsaved: false,
    partners: new Set(),
    later: (ms = 300) => {
      clearTimeout(timer);
      timer = window.setTimeout(() => save(side), ms);
    },
    load: () => load(),
    saved: hooks.saved,
    cancelTimer: () => clearTimeout(timer),
    accept: (sent, canonical) => {
      const diskCopy = structuredClone(canonical) as T;
      hooks.tidy?.(diskCopy);
      diskJson = JSON.stringify(diskCopy);
      if (equalJson(sent, canonical)) {
        side.unsaved = kept !== diskJson;
        emitPending();
        return;
      }
      const old = data;
      const next = mergeEdits(sent, JSON.parse(kept), canonical, orderedRows).data as T;
      kept = JSON.stringify(next);
      side.unsaved = !equalJson(next, canonical);
      for (const list of [undos, redos])
        for (const entry of list)
          if (entry.side === side)
            entry.snap = JSON.stringify(
              mergeEdits(sent, JSON.parse(entry.snap), canonical, orderedRows).data,
            );
      if (shown) held = { version: side.version, data: next };
      else {
        data = next;
        hooks.tidy?.(data);
        hooks.changed();
        emitMutated();
        hooks.replaced?.(old);
      }
      emitPending();
    },
    swap: (snap) => {
      const old = data,
        was = kept;
      data = JSON.parse(snap);
      held = null;
      shown = false;
      hooks.tidy?.(data!);
      kept = JSON.stringify(data);
      side.unsaved = kept !== diskJson;
      hooks.changed();
      emitMutated();
      hooks.replaced?.(old);
      if (!side.unsaved) {
        side.cancelTimer();
        side.saved?.(null);
      } else if (autoSave) side.later();
      else side.saved?.("pending");
      emitPending();
      return was;
    },
    revert: () => {
      side.cancelTimer();
      if (!side.unsaved || diskJson === "null") return;
      const old = data;
      data = JSON.parse(diskJson) as T;
      held = null;
      shown = false;
      restoredPreviewBase = null;
      hooks.tidy?.(data);
      kept = JSON.stringify(data);
      side.unsaved = false;
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
    held = null;
    restoredPreviewBase = null;
    const old = data,
      before = old !== null && hooks.received ? (JSON.parse(kept) as T) : null;
    data = got.data;
    hooks.tidy?.(data);
    diskJson = kept = JSON.stringify(data);
    side.unsaved = false;
    hooks.changed();
    emitMutated();
    hooks.replaced?.(old);
    if (before !== null && !equalJson(before, data)) hooks.received?.(before, data);
    hooks.saved?.(null);
    emitPending();
  };
  const release = () => {
    if (held && !shown) take(held);
  };
  const load = async (query = "", onJson?: (got: unknown) => void) => {
    const r = await getFile(`/api/${name}${query}`);
    if (!r.ok) return null;
    const got = (await r.json()) as Got<T>;
    onJson?.(got);
    if (side.unsaved || side.saving) return r; // our own change is on its way
    if (got.version === side.version) return r; // news of this page's own save, or a reconnect with nothing new
    if (shown) held = got;
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
      // An edit never keeps a preview it didn't make, nor a snapshot restored over a version an agent loaded since it was taken
      const editBase = restoredPreviewBase;
      restoredPreviewBase = null;
      if (editBase !== null) data = JSON.parse(editBase);
      else if (shown || JSON.stringify(data) !== kept) data = JSON.parse(kept);
      shown = false;
      change(data!);
      hooks.tidy?.(data!);
      if (editBase !== null)
        data = mergeEdits(JSON.parse(editBase), data, JSON.parse(kept), orderedRows).data;
      const next = JSON.stringify(data);
      if (next === kept) {
        hooks.changed();
        release();
        return;
      }
      // The saved base lets the server merge the committed drag with edits made meanwhile.
      held = null;
      if (touched) touched.add(side);
      else group++;
      undos.push({ side, snap: kept, group });
      if (undos.length > 100) undos.shift();
      redos.length = 0;
      kept = next;
      side.unsaved = next !== diskJson;
      hooks.changed();
      emitMutated();
      if (!side.unsaved) {
        side.cancelTimer();
        side.saved?.(null);
      } else if (autoSave) side.later();
      else side.saved?.("pending");
      emitPending();
    },
    preview: (change: (d: T) => void) => {
      if (data) {
        change(data);
        shown = true;
        hooks.changed();
      }
    },
    snapshot: () => JSON.stringify(data),
    // Only a preview is taken back: with none on, the snapshot may be older than a version an agent loaded since. A drag
    // redraws its preview right after (same task); with no preview back, a held version loads
    restore: (snap: string) => {
      if (!shown) return;
      shown = false;
      restoredPreviewBase = snap;
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
