// A film file the creator edits by hand in the studio (the sound lanes, the camera keys), served at /api/<name>: every change is
// drawn at once, kept for undo and saved a moment later over the version it was made on. Undo is one history for all of them,
// so Ctrl+Z takes back the last edit whichever file it was in. What an agent changed in a file meanwhile always wins: the
// server refuses the save (409), the page loads that version and says so, nothing is written over it.
// Files changed in one go (a cut moved on the camera row: cam.json and shots.json) are saved in one request, all or none, so a
// 409 on one never leaves the other half saved.
// A preview (a drag on its way, a hovered effect) is drawn, never kept: saves and undo take the last kept state, and an agent's
// version arriving meanwhile waits for the preview to end, so a restore can't bring back what the agent replaced.
import { getFile, postJson } from "./net";
import { say, showError } from "./store";

export interface Doc<T> {
  readonly data: T | null;
  load: () => Promise<Response | null>; // the server's answer, for what else it sent (the sound library)
  edit: (change: (d: T) => void) => void;
  preview: (change: (d: T) => void) => void; // drawn, not kept: a drag's end makes it one edit
  snapshot: () => string;
  restore: (snap: string) => void;
}
interface Hooks<T> {
  label: string; // what the say lines call it: "audio", "camera"
  changed: () => void; // after every change to data
  tidy?: (d: T) => void; // after every kept edit and every load, before drawing
  saved?: (state: "busy" | "fail" | null) => void;
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
  saved?: (state: "busy" | "fail" | null) => void;
  swap: (snap: string) => string; // undo/redo: put snap in, give back what it held
}

type Entry = { side: Side; snap: string; group: number };
const undos: Entry[] = [], redos: Entry[] = [];
// Edits made inside together() (one drag over keys in two files) are undone, redone and saved as one
let group = 0, touched: Set<Side> | null = null;
const link = (sides: Iterable<Side>) => { const all = [...sides]; for (const s of all) for (const o of all) if (o !== s) s.partners.add(o); };
export const together = (run: () => void) => {
  if (touched) { run(); return; }
  group++;
  touched = new Set();
  try { run(); link(touched); } finally { touched = null; }
};
const forget = (side: Side) => { for (const list of [undos, redos]) for (let i = list.length - 1; i >= 0; i--) if (list[i].side === side) list.splice(i, 1); };
const teamOf = (side: Side) => {
  const team = new Set([side]);
  for (const s of team) for (const p of s.partners) team.add(p);
  return [...team];
};

const save = async (me: Side) => {
  const team = teamOf(me);
  if (team.some((s) => s.saving)) { me.later(); return; } // one of them is on its way: again once it's back
  if (team.some((s) => s.data() === null)) return;
  for (const s of team) { s.saving = true; s.unsaved = false; s.partners.clear(); s.saved?.("busy"); }
  const one = team.length === 1, labels = team.map((s) => s.label).join(" + ");
  const failed = () => { link(team); for (const s of team) { s.unsaved = true; s.saving = false; s.saved?.("fail"); } };
  try {
    const r = one
      ? await postJson(`/api/${me.name}`, { base: me.version, data: me.data() })
      : await postJson("/api/together", { files: team.map((s) => ({ name: s.name, base: s.version, data: s.data() })) });
    if (r.status === 409) {
      for (const s of team) { s.version = ""; s.saving = false; s.unsaved = false; forget(s); }
      await Promise.all(team.map((s) => s.load()));
      say(`The ${labels} file changed elsewhere (the AI?). Loaded that version; your last change wasn't saved`, 6000);
      for (const s of team) s.saved?.(null);
      return;
    }
    // Refused as it stands (the file's schema): the same data would be refused again, so it waits for the next change or undo
    if (r.status === 400) { showError(`Couldn't save ${labels}:\n\n${((await r.json()).problems ?? []).join("\n\n")}`); failed(); return; }
    if (!r.ok) throw new Error(String(r.status));
    const got: { version?: string; versions?: Record<string, string> } = await r.json();
    for (const s of team) { s.version = one ? got.version! : got.versions![s.name]; s.saved?.(null); }
  } catch {
    failed();
    me.later(3000); // a dropped line: tried again
    return;
  }
  for (const s of team) s.saving = false;
  for (const s of team) if (s.unsaved) s.later();
};

type Got<T> = { version: string; data: T };

export const createDoc = <T>(name: string, hooks: Hooks<T>): Doc<T> => {
  // data is what is drawn, kept (JSON) the last state worth saving. shown: a preview is on, from its first change to the restore
  // or edit that ends it, even while a drag is back where it started and data equals kept
  let data: T | null = null, kept = "null", shown = false, held: Got<T> | null = null, timer = 0;
  const side: Side = {
    name,
    label: hooks.label,
    data: () => JSON.parse(kept),
    version: "",
    saving: false,
    unsaved: false,
    partners: new Set(),
    later: (ms = 300) => { clearTimeout(timer); timer = window.setTimeout(() => save(side), ms); },
    load: () => load(),
    saved: hooks.saved,
    swap: (snap) => { const old = data, was = kept; data = JSON.parse(snap); held = null; shown = false; side.unsaved = true; hooks.tidy?.(data!); kept = JSON.stringify(data); hooks.changed(); hooks.replaced?.(old); side.later(); return was; },
  };
  const take = (got: Got<T>) => {
    if (side.version) forget(side);
    side.version = got.version;
    held = null;
    const old = data;
    data = got.data;
    hooks.tidy?.(data);
    kept = JSON.stringify(data);
    hooks.changed();
    hooks.replaced?.(old);
  };
  const release = () => { if (held && !shown) take(held); };
  const load = async () => {
    const r = await getFile(`/api/${name}`);
    if (!r.ok) return null;
    const got: Got<T> = await r.clone().json();
    if (side.unsaved || side.saving) return r; // our own change is on its way
    if (got.version === side.version) return r; // news of this page's own save, or a reconnect with nothing new
    if (shown) held = got;
    else take(got);
    return r;
  };
  return {
    get data() { return data; },
    load,
    edit: (change: (d: T) => void) => {
      if (!data) return;
      // Made on the version from before an agent's change still held: its save gets the 409, and that version loads
      held = null;
      // An edit never keeps a preview it didn't make, nor a snapshot restored over a version an agent loaded since it was taken
      if (shown || JSON.stringify(data) !== kept) data = JSON.parse(kept);
      shown = false;
      if (touched) touched.add(side);
      else group++;
      undos.push({ side, snap: kept, group });
      if (undos.length > 100) undos.shift();
      redos.length = 0;
      change(data!);
      hooks.tidy?.(data!);
      kept = JSON.stringify(data);
      side.unsaved = true;
      hooks.changed();
      side.later();
    },
    preview: (change: (d: T) => void) => { if (data) { change(data); shown = true; hooks.changed(); } },
    snapshot: () => JSON.stringify(data),
    // Only a preview is taken back: with none on, the snapshot may be older than a version an agent loaded since. A drag
    // redraws its preview right after (same task); with no preview back, a held version loads
    restore: (snap: string) => {
      if (!shown) return;
      shown = false;
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
  while (from[from.length - 1]?.group === g) { const e = from.pop()!; sides.add(e.side); to.push({ side: e.side, snap: e.side.swap(e.snap), group: g }); }
  link(sides);
  say(word);
  return true;
};
export const undo = () => step(undos, redos, "Undone");
export const redo = () => step(redos, undos, "Redone");
export const canUndo = () => undos.length > 0, canRedo = () => redos.length > 0;
