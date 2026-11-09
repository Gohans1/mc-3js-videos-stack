// The film's key files (package.json "live-studio".keyFiles: Steve's moves, hands, look, face; the props' keys), edited by hand
// on the key rows like the camera keys (doc.ts: undo, saving, an agent's edit wins). Every list of {t, ...} in a file is a row
// (contract.mjs keyRows), so a film needs no setup beyond naming the file and the EDIT key it reads it from. Each change puts a
// fresh copy in EDIT[that key], which the film reads every frame and caches on, so it is never edited in place.
// Keys only move in time between the keys around them: their order is the film's.
import { EDIT } from "film/edit";
import { keyRows, rowAt } from "../../src/contract.mjs";
import { createDoc, type Doc, together } from "../core/doc";
import { getFile } from "../core/net";
import { r3, SAME, stamp } from "../core/time";
import { stored } from "../core/storage";
import { S } from "../core/state";
import { get, say, set } from "../core/store";
import { type KeyRef } from "./slice";

export interface Key { t: number; [k: string]: unknown }
export interface Row { f: number; path: string[]; id: string; label: string }
interface KeyFile { file: string; edit: string; doc: Doc<unknown> }

export let files: KeyFile[] = [];
export let rows: Row[] = [];
export const rowId = (f: number, path: string[]) => `${f}:${path.join(".")}`;
// A list named keys is its owner's own row (placed.json: {"barrel": {what, keys}} reads "barrel")
const labelOf = (path: string[]) => (path.length > 1 && path.at(-1) === "keys" ? path.slice(0, -1) : path).join(".");
export const keysOf = (f: number, path: string[]): Key[] => (rowAt(files[f]?.doc.data, path) as Key[] | undefined) ?? [];
export const keyOf = (r: KeyRef) => keysOf(r.f, r.path)[r.i];
export const sameKey = (a: KeyRef, b: KeyRef) => a.f === b.f && a.i === b.i && a.path.join(".") === b.path.join(".");
export const isPicked = (r: KeyRef) => get().keyPicks.some((p) => sameKey(p, r));
// What a key is called on its row: the first words it carries ("lies awake", "tense", "sitBed")
export const nameOf = (k: Key) => { for (const f of ["do", "mood", "pose", "clip", "title", "text"]) if (typeof k[f] === "string") return k[f] as string; return ""; };
// Two keys in a row that say the same thing: the film holds still between them
export const same = (a: Key, b: Key) => { const { t: _, ...x } = a, { t: __, ...y } = b; return JSON.stringify(x) === JSON.stringify(y); };

// Rows of a file folded away in the heads column stay folded for this viewer
const FOLD = "keysFolded";
let folded = new Set<number>(JSON.parse(stored.get(FOLD) ?? "[]"));
export const isFolded = (f: number) => folded.has(f);
export const fold = (f: number, on: boolean) => { folded = new Set(folded); if (on) folded.add(f); else folded.delete(f); stored.set(FOLD, JSON.stringify([...folded])); bump(); };
// The rows as laid out top to bottom: each file's heading, then its rows unless folded (keys/KeyHeads.tsx draws the same list)
export const HEAD_H = 26, ROW_H = 22;
export type Line = { kind: "file"; f: number; y: number } | { kind: "row"; row: Row; y: number };
export const lines = (): Line[] => {
  const out: Line[] = [];
  let y = 0;
  files.forEach((_, f) => {
    out.push({ kind: "file", f, y }); y += HEAD_H;
    if (!folded.has(f)) for (const row of rowsOf(f)) { out.push({ kind: "row", row, y }); y += ROW_H; }
  });
  return out;
};
// The row of the object selected on the picture (placed.json {name: {keys}}), lit like CapCut lights the clip of what is picked
export const litRow = () => {
  const p = S.tools?.placed, name = get().object, f = p ? files.findIndex((x) => x.edit === p.key) : -1;
  return name && f >= 0 ? rowId(f, [name, "keys"]) : null;
};
export const rowsOf = (f: number) => rows.filter((r) => r.f === f);
// A row's name in the heads column: its last two steps (["typing", "tries"]), a placed object's by its own name
export const labelSteps = (r: Row) => (r.path.length > 1 && r.path.at(-1) === "keys" ? r.path.slice(0, -1) : r.path).slice(-2);
// A key file's name there: the dropped-in objects' file is the Objects tab's, any other its file name in words ("steve.json"
// Steve, "fx.json" FX); the file itself shows on hover
export const fileTitle = (f: number) => {
  if (files[f]?.edit === S.tools?.placed?.key) return "Objects";
  const base = (files[f]?.file.split("/").pop() ?? "").replace(/\.[^.]+$/, "");
  return base.split(/[-_.\s]+|(?<=[a-z])(?=[A-Z])/).filter(Boolean).map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(" ");
};
export const linesHeight = () => { const l = lines(), last = l[l.length - 1]; return last ? last.y + (last.kind === "file" ? HEAD_H : ROW_H) : 0; };

const bump = () => { S.dirty = true; set({ keysRev: get().keysRev + 1 }); };
const push = (f: number) => {
  const x = files[f];
  (EDIT as Record<string, unknown>)[x.edit] = structuredClone(x.doc.data);
  S.finalAt = -1; S.dirty = true;
  // Objects dropped in (tools.placed) are built from the file, which takes a moment for a new one: draw again once it stands
  const placed = S.tools?.placed;
  if (placed?.key === x.edit) placed.sync().then(() => { S.dirty = true; set({ keysRev: get().keysRev + 1 }); });
};
// While a drag is held the rows follow the pointer but the film gets the keys only once the pointer rests: a film may rebuild
// a lot per new EDIT object (sealed-room bakes its overlap over the whole film from EDIT.steve, ~0.45 s)
let held = false, idle = 0;
const pending = new Set<number>();
const flush = () => { clearTimeout(idle); for (const f of pending) push(f); pending.clear(); };
export const hold = (on: boolean) => { held = on; if (!on) flush(); };
const changed = (f: number) => {
  if (held) { pending.add(f); clearTimeout(idle); idle = window.setTimeout(flush, 250); } else push(f);
  rows = files.flatMap((y, g) => (y.doc.data ? keyRows(y.doc.data).map((path: string[]) => ({ f: g, path, id: rowId(g, path), label: labelOf(path) })) : []));
  const picks = get().keyPicks, live = picks.filter((p) => keyOf(p));
  if (live.length !== picks.length) set({ keyPicks: live });
  bump();
};

const lengths = (d: unknown) => (d ? keyRows(d).map((p: string[]) => `${p.join(".")}:${(rowAt(d, p) as Key[]).length}`).join() : "");
const replaced = (f: number, was: unknown) => {
  const picks = get().keyPicks;
  if (picks.some((p) => p.f === f) && lengths(was) !== lengths(files[f].doc.data)) set({ keyPicks: picks.filter((p) => p.f !== f) });
};
// On start, and each file again when an agent edits it (the "keys" event names which)
export const loadKeys = async (which?: number) => {
  if (which !== undefined) { await files[which]?.doc.load(); return; }
  if (!files.length) {
    const r = await getFile("/api/keys");
    const list: { file: string; edit: string }[] = r.ok ? await r.json() : [];
    files = list.map((x, f) => ({ ...x, doc: createDoc<unknown>(`keys/${f}`, { label: x.file.split("/").pop()!, changed: () => changed(f), saved: (keysSaved) => set({ keysSaved }), replaced: (was) => replaced(f, was) }) }));
  }
  await Promise.all(files.map((x) => x.doc.load()));
  set({ keyFiles: files.map((x) => x.file) });
};

// Keys of one dropped-in object open that object in the Object tab, its values there at the key (CapCut shows a keyframe's own
// values in the clip's panel); any other pick opens the Keyframes tab
export const pickKeys = (refs: KeyRef[]) => {
  const p = S.tools?.placed, pf = p ? files.findIndex((x) => x.edit === p.key) : -1;
  const own = refs.length > 0 && refs.every((r) => r.f === pf && r.path.length === 2 && r.path[1] === "keys" && r.path[0] === refs[0].path[0]);
  set(refs.length ? { keyPicks: refs, side: own ? "objects" : "keys", clips: [], clip: null, camKey: null, camPicks: [], shotPick: null, textPicks: [], object: own ? refs[0].path[0] : null } : { keyPicks: [], object: null });
  S.dirty = true;
};

// Every change to keys of one or more files: one undo step, whichever files it touched
const editRefs = (refs: KeyRef[], change: (r: KeyRef, ks: Key[]) => void) => together(() => {
  for (const f of new Set(refs.map((r) => r.f))) files[f].doc.edit((data) => { for (const r of refs.filter((x) => x.f === f)) change(r, rowAt(data, r.path) as Key[]); });
});
// How far the picked keys may move together: none passes a key of its row that stays, or goes before 0
export const room = (refs: KeyRef[]): [number, number] => {
  let lo = -Infinity, hi = Infinity;
  for (const r of refs) {
    const ks = keysOf(r.f, r.path), t = ks[r.i].t;
    lo = Math.max(lo, -t);
    for (let j = r.i - 1; j >= 0; j--) if (!refs.some((p) => sameKey(p, { ...r, i: j }))) { lo = Math.max(lo, ks[j].t - t); break; }
    for (let j = r.i + 1; j < ks.length; j++) if (!refs.some((p) => sameKey(p, { ...r, i: j }))) { hi = Math.min(hi, ks[j].t - t); break; }
  }
  return [lo, hi];
};
export const shift = (refs: KeyRef[], d: number, change = editRefs) => {
  const [lo, hi] = room(refs), by = Math.max(lo, Math.min(hi, d));
  change(refs, (r, ks) => { ks[r.i].t = r3(ks[r.i].t + by); });
  return by;
};
export const preview = (refs: KeyRef[], change: (r: KeyRef, ks: Key[]) => void) => {
  for (const f of new Set(refs.map((r) => r.f))) files[f].doc.preview((data) => { for (const r of refs.filter((x) => x.f === f)) change(r, rowAt(data, r.path) as Key[]); });
};
// Copies of keys (timeline/clipboard.ts), d seconds later, each on the row it came from while that row is there, taking the
// place of a key on that frame; picked after. One undo step across files
export type CopiedKey = { f: number; path: string[]; k: Key };
export const pasteKeys = (items: CopiedKey[], d: number) => {
  const live = items.filter((x) => rows.some((r) => r.f === x.f && r.path.join(".") === x.path.join("."))).map((x) => ({ ...x, k: { ...structuredClone(x.k), t: r3(Math.max(0, x.k.t + d)) } }));
  if (!live.length) { say("Nothing pasted: the rows these keys came from are gone"); return; }
  together(() => {
    for (const f of new Set(live.map((x) => x.f))) files[f].doc.edit((data) => {
      for (const { path, k } of live.filter((x) => x.f === f)) {
        const ks = rowAt(data, path) as Key[], on = ks.findIndex((x) => Math.abs(x.t - k.t) < SAME);
        if (on >= 0) { ks[on] = k; continue; }
        const i = ks.findIndex((x) => x.t > k.t);
        ks.splice(i < 0 ? ks.length : i, 0, k);
      }
    });
  });
  pickKeys(live.map(({ f, path, k }) => ({ f, path, i: keysOf(f, path).findIndex((x) => x.t === k.t) })).filter((r) => r.i >= 0));
  say(`${live.length} key${live.length > 1 ? "s" : ""} pasted at ${stamp(S.t)}`);
};
export const snapshot = () => files.map((x) => x.doc.snapshot());
export const restore = (snaps: string[]) => snaps.forEach((s, f) => files[f].doc.restore(s));
export const editKeys = editRefs;

// undefined takes the field off the key (only offered for fields some keys of the row go without)
export const setField = (r: KeyRef, field: string, v: unknown) => editRefs([r], (x, ks) => { if (v === undefined) delete ks[x.i][field]; else ks[x.i][field] = v; });
export const removeKeys = (refs: KeyRef[]) => {
  if (!refs.length) return;
  // From the back of each row, so the places still to remove don't move
  editRefs([...refs].sort((a, b) => b.i - a.i), (r, ks) => { ks.splice(r.i, 1); });
  pickKeys([]);
  say(`${refs.length === 1 ? "Keyframe" : `${refs.length} keyframes`} deleted. Ctrl+Z to undo`);
};
// A copy of the row's state at t (the key before it, or the first), keyed at t: from here the row can change without the rest moving
export const addKeyAt = (f: number, path: string[], t: number) => {
  const ks = keysOf(f, path), at = ks.findIndex((k) => k.t > t), from = ks[(at < 0 ? ks.length : at) - 1] ?? ks[0];
  if (!from) return;
  const i = at < 0 ? ks.length : at;
  editRefs([{ f, path, i }], (_, list) => { list.splice(i, 0, { ...structuredClone(from), t: r3(t) }); });
  pickKeys([{ f, path, i }]);
  say(`Keyframe added to ${path.join(".")} at ${stamp(t)}, copied from the one before`);
};
