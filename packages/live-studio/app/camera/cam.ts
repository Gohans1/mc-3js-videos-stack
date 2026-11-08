// The film's camera keys (package.json "live-studio".camTimeline, keys as film-stage/camera.ts reads them), edited by hand on the
// camera row like the sound lanes (doc.ts: undo, saving, an agent's edit wins). The film draws from EDIT.cam, so every change
// puts a fresh copy there and the picture follows at once; its caches are keyed on that array, so it is never edited in place.
// A key's time moves only inside its shot. A cut belongs to the film's SHOTS as much as to the camera, so a cut key moves only
// when the film keeps its shots as data (shots.ts), and then both move together (rollCut), and a shot can be split at the playhead
// or merged with the one before (splitShot, removeKey on a cut), CapCut's Split and its undo.
import { EDIT, toSource } from "film/edit";
import { DURATION, SHOTS_OUT } from "film/scene";
import { createDoc, together } from "../core/doc";
import type { Ease } from "../core/ease";
import { r3, SAME, stamp } from "../core/time";
import { type ShotRow, shotsDoc } from "./shots";
import { S } from "../core/state";
import { get, say, set } from "../core/store";

export type Point = [number, number, number] | Record<string, unknown>; // a world point, or the film's anchor ({"eye": [...]})
export interface CamKey { t: number; p: Point; l: Point; fov?: number; cut?: boolean; ease?: Ease; [k: string]: unknown }

export let keys: CamKey[] = [];
const changed = () => {
  keys = doc.data ?? [];
  (EDIT as Record<string, unknown>).cam = structuredClone(keys);
  S.dirty = true;
  S.finalAt = -1;
  const { camKey: k, camPicks: ps } = get();
  set({ camRev: get().camRev + 1, ...(k !== null && !keys[k] ? { camKey: null } : {}), ...(ps.some((i) => !movable(i)) ? { camPicks: [] } : {}) });
};
const doc = createDoc<CamKey[]>("cam", { label: "camera", changed, saved: (camSaved) => set({ camSaved }), replaced: (was) => { if (was?.length !== keys.length && (get().camKey !== null || get().camPicks.length)) setKey(null); } });
export const { edit, preview, snapshot, restore } = doc;
export const loadCam = async () => { set({ cam: !!(await doc.load()) }); };

// What film-stage/camera.ts gives a key without an ease (core/ease.ts works out how each one spends its span)
export const DEFAULT_EASE = "smooth";
export const holds = (a: CamKey, b: CamKey) => JSON.stringify([a.p, a.l, a.fov]) === JSON.stringify([b.p, b.l, b.fov]);
// The keys a key may move between: its shot's cut (or the film's start) and the next cut, never past its neighbours
export const room = (i: number): [number, number] => [i > 0 ? keys[i - 1].t + SAME : 0, i + 1 < keys.length ? keys[i + 1].t - SAME : Infinity];
export const movable = (i: number) => i > 0 && !keys[i]?.cut;
export const setKey = (i: number | null) => { set(i === null ? { camKey: null, camPicks: [] } : { camKey: i, camPicks: [], side: get().side === "speed" ? "speed" : "cam", shotPick: null, clips: [], clip: null, keyPicks: [], textPicks: [], object: null }); S.dirty = true; };
// Several keys picked at once (a box dragged on the camera row), moved or deleted together. Only keys inside a shot: a shot's
// first key is its cut, which moves by rolling the cut alone
export const pickCamKeys = (is: number[]) => {
  const ok = [...new Set(is)].filter(movable).sort((a, b) => a - b);
  if (ok.length < 2) { setKey(ok[0] ?? null); return; }
  set({ camPicks: ok, camKey: null, side: get().side === "speed" ? "speed" : "cam", shotPick: null, clips: [], clip: null, keyPicks: [], textPicks: [], object: null });
  S.dirty = true;
};
// How far the picked keys may move together: until the first of them meets a key left out
export const groupRoom = (is: number[]): [number, number] => {
  let lo = -Infinity, hi = Infinity;
  for (const i of is) {
    let p = i - 1, n = i + 1;
    while (is.includes(p)) p--;
    while (is.includes(n)) n++;
    lo = Math.max(lo, (p >= 0 ? keys[p].t + SAME : 0) - keys[i].t);
    if (n < keys.length) hi = Math.min(hi, keys[n].t - SAME - keys[i].t);
  }
  return [lo, hi];
};
export const shiftCamKeys = (is: number[], d: number, apply: typeof edit = edit) => apply((ks) => { for (const i of is) ks[i].t = r3(ks[i].t + d); });
// Copies of keys (timeline/clipboard.ts), d seconds later: each lands in whatever shot it falls in, taking the place of a key on
// that frame; one that would land on a cut, the film's first key or past its end is left out. The copies are picked after
export const pasteCamKeys = (items: CamKey[], d: number) => {
  const ok = items.map((k) => ({ ...structuredClone(k), t: r3(k.t + d) })).filter((k) => k.t >= SAME && k.t <= DURATION - SAME && !keys.some((x) => x.cut && Math.abs(x.t - k.t) < SAME));
  if (!ok.length) { say("Nothing pasted: these keyframes would land on a cut or off the film. Move the playhead"); return; }
  edit((ks) => {
    for (const k of ok) {
      delete k.cut;
      const on = ks.findIndex((x, i) => i > 0 && Math.abs(x.t - k.t) < SAME);
      if (on > 0) { ks[on] = k; continue; }
      const i = ks.findIndex((x) => x.t > k.t);
      ks.splice(i < 0 ? ks.length : i, 0, k);
    }
  });
  pickCamKeys(ok.map((k) => keys.findIndex((x, i) => i > 0 && !x.cut && x.t === k.t)));
  say(`${ok.length} keyframe${ok.length > 1 ? "s" : ""} pasted at ${stamp(S.t)}${ok.length < items.length ? `, ${items.length - ok.length} left out (on a cut or off the film)` : ""}`);
};
export const removeCamKeys = (is: number[]) => {
  const ok = is.filter(movable).sort((a, b) => b - a);
  if (!ok.length) return;
  edit((ks) => { for (const i of ok) ks.splice(i, 1); });
  setKey(null);
  say(`${ok.length} keyframes deleted. Ctrl+Z to undo`);
};

export const nearestKey = (t: number) => keys.reduce((best, k, i) => (Math.abs(k.t - t) < Math.abs(keys[best].t - t) ? i : best), 0);
export const retime = (i: number, t: number) => edit((ks) => { const [a, b] = room(i); ks[i].t = r3(Math.max(a, Math.min(b, t))); });
// fov in degrees, roll in radians (film-stage turns the picture by it), wave the sway's size (1 the film's own)
export const setLens = (i: number, field: "fov" | "roll" | "wave", v: number | undefined) =>
  edit((ks) => { if (v === undefined) delete ks[i][field]; else ks[i][field] = field === "roll" ? Math.round(v * 1e4) / 1e4 : r3(v); });
// The Camera tab's reset: the key draws with the film's own FOV, roll and sway again
export const resetLens = (i: number) => edit((ks) => { delete ks[i].fov; delete ks[i].roll; delete ks[i].wave; });
export const setEase = (i: number, ease: Ease | undefined) => edit((ks) => { if (ease === undefined) delete ks[i].ease; else ks[i].ease = ease; });
// Paste attributes (timeline/attributes.ts): the lens (FOV, roll, sway) and the speed (ease) of key `from`, as it has them (none:
// the film's own), onto keys `to`, one undo step. A shot's first key has no speed, so it takes the lens alone
export const pasteKeyAttrs = (from: CamKey, to: number[], what: ("lens" | "speed")[]) => edit((ks) => {
  for (const i of to) {
    const k = ks[i] as Record<string, unknown> | undefined;
    if (!k) continue;
    if (what.includes("lens")) for (const f of ["fov", "roll", "wave"]) { if (from[f] === undefined) delete k[f]; else k[f] = from[f]; }
    if (what.includes("speed") && movable(i)) { if (from.ease === undefined) delete k.ease; else k.ease = structuredClone(from.ease); }
  }
});
export const removeKey = (i: number) => {
  if (keys[i]?.cut && get().shots) { mergeShot(i); return; }
  if (!movable(i)) { say(i === 0 ? "The film's first keyframe can't be deleted" : "Deleting a cut merges two shots. Ask the AI in a note"); return; }
  edit((ks) => { ks.splice(i, 1); });
  setKey(null);
  say(`Keyframe deleted. Ctrl+Z to undo`);
};
// A still stretch: the same framing again `secs` later (or just before the next key), so the camera rests between the two
export const holdAfter = (i: number, secs = 1) => {
  const k = keys[i], next = keys[i + 1];
  const t = r3(Math.min(k.t + secs, next ? next.t - SAME * 2 : k.t + secs));
  if (t - k.t < SAME * 2) { say("No room before the next keyframe. Move it later first"); return; }
  edit((ks) => { const { ease: _, cut: __, ...pose } = structuredClone(ks[i]); ks.splice(i + 1, 0, { ...pose, t, ease: "linear" }); });
  setKey(i + 1);
  say(`Camera holds ${stamp(k.t)} → ${stamp(t)}. Drag the new keyframe to hold longer`);
};

// The key on the playhead: on a cut both the shot's last key and the cut sit at that second, and the picture there is the cut's
export const keyAt = (t: number) => keys.findLastIndex((k) => Math.abs(k.t - t) < SAME);
// The key the Camera and Speed tabs show: the one picked on the camera row, else the one on the playhead (-1: none)
export const shownKey = (t: number) => { const k = get().camKey; return k !== null && keys[k] ? k : keyAt(t); };
type View = { p: Point; l: Point; fov: number };
// A new key at t with this framing, keeping the shot's own sway (wave, bob, roll) from the key before it
const insertKey = (t: number, view: View) => {
  const i = keys.findIndex((k) => k.t > t), before = keys[(i < 0 ? keys.length : i) - 1];
  const { t: _, p: __, l: ___, fov: ____, cut: _____, ease: ______, ...sway } = structuredClone(before ?? ({} as CamKey));
  edit((ks) => { ks.splice(i < 0 ? ks.length : i, 0, { t, ...view, ...sway }); });
  setKey(i < 0 ? keys.length - 1 : i);
  say(`Camera keyframe added at ${stamp(t)}. Ctrl+Z to undo`);
};
// The free camera's view (F) as a key at the playhead: it replaces the key on that moment, or goes in between. With `only`, that
// key's framing is replaced, wherever the playhead is
export const saveView = (only?: number) => {
  const f = S.tools?.free;
  if (!f?.on) { say("Turn on Free camera (F) and frame the shot first"); return; }
  const t = r3(S.t), p = f.p.toArray().map(r3) as Point, l = f.l.toArray().map(r3) as Point, fov = Math.round(f.fov * 10) / 10;
  const at = only ?? keyAt(t);
  if (at >= 0) {
    const anchored = !Array.isArray(keys[at].p) || !Array.isArray(keys[at].l);
    edit((ks) => { Object.assign(ks[at], { p, l, fov }); });
    setKey(at);
    say(`Keyframe at ${stamp(keys[at].t)} updated${anchored ? ". It followed an object before; now it's a fixed point" : ""}`, 5000);
    return;
  }
  insertKey(t, { p, l, fov });
};
// CapCut's ◇ on the Camera section: a key at the playhead holding the picture as it is now (the free camera's view when it is on)
export const addKeyHere = () => { if (S.tools?.free.on) saveView(); else if (S.tools) insertKey(r3(S.t), drawnView()); };

// ---------- A cut moved (a roll edit): the shot before ends sooner or later and the one after starts with it; nothing in the film
// moves, only where the picture changes camera. The shot's start in shots.json moves with its cut key (one undo step for both),
// and so does the last key of the shot before when it sits on the cut (its framing held up to the cut, a frame or less before)
const tailOf = (i: number) => (i > 1 && !keys[i - 1].cut && keys[i].t - keys[i - 1].t < SAME * 2 ? i - 1 : -1);
export const shotOfCut = (i: number) => (keys[i]?.cut ? SHOTS_OUT.findIndex((s) => Math.abs(s.t - keys[i].t) < SAME) : -1);
export const rollable = (i: number) => get().shots && shotOfCut(i) > 0;
export const rollRoom = (i: number): [number, number] => {
  const tail = tailOf(i), before = keys[(tail >= 0 ? tail : i) - 1];
  return [before.t + SAME * 3, keys[i + 1] ? keys[i + 1].t - SAME : DURATION - SAME];
};
type Apply<T> = (change: (d: T) => void) => void;
const rollWith = (i: number, t: number, cam: Apply<CamKey[]>, shots: Apply<ShotRow[]>) => {
  const s = shotOfCut(i), tail = tailOf(i), [lo, hi] = rollRoom(i), at = r3(Math.max(lo, Math.min(hi, t))), d = at - keys[i].t;
  cam((ks) => { if (tail >= 0) ks[tail].t = r3(ks[tail].t + d); ks[i].t = at; });
  shots((sh) => { sh[s].t = r3(toSource(at)); });
};
export const rollCut = (i: number, t: number) => together(() => rollWith(i, t, edit, shotsDoc.edit));
export const previewRoll = (i: number, t: number) => rollWith(i, t, preview, shotsDoc.preview);

// ---------- Split and merge (CapCut's Split, B). Splitting at the playhead changes nothing on screen: the first half keeps its move
// up to a key a millisecond before the cut (the film's own tails sit there too), and the second half starts on the same picture,
// from the free camera's view when it is on. The new shot copies the old one's fields (how the film draws it). Merging is the
// reverse: the cut, its tail and the shot go, and the camera glides from one shot's keys into the other's
const TAIL = 0.001;
// The film's own draw with the free camera off, for its camera alone: no overlays (picture/render.ts) on a frame nobody sees
const drawnView = (): View => {
  const f = S.tools!.free, was = f.on;
  f.on = false;
  S.render!(S.t);
  const v = { p: S.tools!.camera.position.toArray().map(r3) as Point, l: S.tools!.look.toArray().map(r3) as Point, fov: Math.round(S.tools!.camera.fov * 10) / 10 };
  f.on = was;
  S.dirty = true;
  return v;
};
// The new half's name: "Hall (2)", and splitting "Hall (2)" again gives "Hall (3)", never "Hall (2) (2)" or a name taken
const secondName = (name: string, shots: ShotRow[]) => {
  const base = name.replace(/ \(\d+\)$/, ""), taken = new Set(shots.map((x) => x.name));
  let n = 2;
  while (taken.has(`${base} (${n})`)) n++;
  return `${base} (${n})`;
};
export const splitShot = () => {
  if (!get().shots) { say("This film keeps its shots in code: ask the AI in a note to split one"); return; }
  const t = r3(S.t), s = SHOTS_OUT.findLastIndex((x) => x.t <= t + SAME);
  if (t < SAME * 3 || t > DURATION - SAME * 3 || keys.some((k) => k.cut && Math.abs(k.t - t) < SAME * 3) || Math.abs(SHOTS_OUT[s].t - t) < SAME * 3) { say("A shot starts or ends here already. Move the playhead"); return; }
  const f = S.tools!.free, here = drawnView();
  const next = f.on ? { p: f.p.toArray().map(r3) as Point, l: f.l.toArray().map(r3) as Point, fov: Math.round(f.fov * 10) / 10 } : here;
  const i = keys.findIndex((k) => k.t > t), at = i < 0 ? keys.length : i, before = keys[at - 1];
  const anchored = !Array.isArray(before.p) || !Array.isArray(before.l);
  const { t: _, p: __, l: ___, fov: ____, cut: _____, ease: ______, ...sway } = structuredClone(before);
  together(() => {
    edit((ks) => { ks.splice(at, 0, { ...sway, t: r3(t - TAIL), ...here }, { ...sway, t, ...next, cut: true }); });
    shotsDoc.edit((sh) => { const { t: _t, name, ...rest } = sh[s]; sh.splice(s + 1, 0, { ...structuredClone(rest), t: r3(toSource(t)), name: secondName(name ?? `Shot ${s}`, sh) }); });
  });
  setKey(at + 1);
  say(`Shot ${s} split at ${stamp(t)}.${f.on ? "" : " Frame the new shot: Free camera (F), then Use current view."}${anchored ? " Its new keys are fixed points: they don't follow an object." : ""}`, 6000);
};
const mergeShot = (i: number) => {
  const s = shotOfCut(i), tail = tailOf(i);
  if (s <= 0) { say("This cut has no shot of its own in shots.json. Ask the AI in a note"); return; }
  together(() => {
    edit((ks) => { ks.splice(i, 1); if (tail >= 0) ks.splice(tail, 1); });
    shotsDoc.edit((sh) => { sh.splice(s, 1); });
  });
  setKey(null);
  say(`Shots ${s - 1} and ${s} merged. Ctrl+Z to undo`);
};
