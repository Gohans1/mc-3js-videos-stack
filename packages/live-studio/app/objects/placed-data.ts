import type { Ease } from "../core/ease";
import { engine } from "../core/engine";
import { S } from "../core/state";
import { get, say, set } from "../core/store";
import { transitionSelection } from "../core/selection";
import { FPS, r3, stamp } from "../core/time";
import { files } from "../keys/keys";

export type GizmoMode = "translate" | "rotate" | "scale";
export type TransformMode = GizmoMode;

export interface TargetRow {
  edit: string;
  path: string[];
}
export interface TargetTransform {
  at: number[];
  rot: number[];
  scale: number;
}
export interface TransformBinding {
  row: TargetRow;
  axes: Partial<Record<TransformMode, [boolean, boolean, boolean]>>;
  read(key: Record<string, unknown>): TargetTransform;
  write(key: Record<string, unknown>, value: TargetTransform): void;
}

export interface PlacedKey {
  t: number;
  at: number[];
  rot?: number[];
  scale?: number;
  visible?: boolean;
  ease?: Ease;
  clip?: string;
  rate?: number;
  [k: string]: unknown;
}
export interface PlacedObject {
  what: string;
  properties?: Record<string, string>;
  clip?: string;
  rate?: number;
  keys: PlacedKey[];
}
export type Placed = Record<string, PlacedObject>;

const r1 = (x: number) => Math.round(x * 10) / 10;
export const tools = () => S.tools?.placed ?? null;
export const fileOf = () => {
  const p = tools();
  return p ? files.findIndex((x) => x.edit === p.key) : -1;
};
export const placedData = (): Placed => (files[fileOf()]?.doc.data as Placed | null) ?? {};
export const canPlace = () => fileOf() >= 0;
export const titleOf = (what: string) => what.split(":").at(-1)!.replaceAll("_", " ");

export const edit = (change: (d: Placed) => void) => {
  const f = fileOf();
  if (f < 0) {
    say(
      "This film can't take objects yet: it needs a placed key file (bun run skills get core --ref contract)",
    );
    return false;
  }
  files[f].doc.edit((d) => change(d as Placed));
  return true;
};
const freeName = (base: string) => {
  const taken = placedData();
  if (!taken[base]) return base;
  for (let n = 2; ; n++) if (!taken[`${base} ${n}`]) return `${base} ${n}`;
};

export const select = (name: string | null) =>
  set(transitionSelection({ kind: "object", name }, get().side));

export const setSnap = (on: boolean) => {
  set({ snap: on });
};

// ---------- Adding, removing, renaming
export const addObject = (what: string, at: number[], yaw = 0) => {
  const name = freeName(titleOf(what));
  const ok = edit((d) => {
    d[name] = { what, keys: [{ t: r3(S.t), at: at.map(r3), rot: [0, r1(yaw), 0], scale: 1 }] };
  });
  if (!ok) return;
  select(name);
  say(`${name} added. Drag the arrows to move it`);
};
export const removeObject = (name: string) => {
  if (
    !edit((d) => {
      delete d[name];
    })
  )
    return;
  if (get().object === name) select(null);
  say(`${name} deleted. Ctrl+Z to undo`);
};
export const renameObject = (from: string, to: string): boolean => {
  to = to.trim();
  if (!to || to === from) return false;
  if (placedData()[to]) {
    say(`There's already an object called ${to}`);
    return false;
  }
  // Rebuilt in the same order, so the key rows stay where they were
  edit((d) => {
    const all = Object.entries(d);
    for (const k of Object.keys(d)) delete d[k];
    for (const [k, v] of all) d[k === from ? to : k] = v;
  });
  if (get().object === from) select(to);
  return true;
};

// How an object moves into its key i (components/EasePicker.tsx): a key without an ease moves on mc-assets/placed.ts's
// smoothstep, which the "inout" tile (Ease) draws to within about 1%
export const OBJECT_EASE = "inout";
export const setKeyEase = (name: string, i: number, ease: Ease | undefined) =>
  edit((d) => {
    const k = d[name]?.keys[i];
    if (!k) return;
    if (ease === undefined) delete k.ease;
    else k.ease = ease;
  });
export const placedDoc = {
  snapshot: () => files[fileOf()]?.doc.snapshot() ?? "null",
  restore: (s: string) => files[fileOf()]?.doc.restore(s),
  preview: (name: string, i: number, ease: Ease) =>
    files[fileOf()]?.doc.preview((d) => {
      const k = (d as Placed)[name]?.keys[i];
      if (k) k.ease = ease;
    }),
};

// The key at the playhead (within half a frame), or a new one there copied from the key before it
const keyHere = (o: PlacedObject) => {
  const ks = o.keys,
    near = ks.findIndex((k) => Math.abs(k.t - S.t) < 0.5 / FPS);
  if (near >= 0) return { k: ks[near], fresh: false };
  const i = ks.findIndex((k) => k.t > S.t),
    at = i < 0 ? ks.length : i;
  const k = { ...structuredClone(ks[Math.max(0, at - 1)]), t: r3(S.t) };
  delete k.visible;
  delete k.clip;
  delete k.rate; // a copied clip would start over here
  ks.splice(at, 0, k);
  return { k, fresh: true };
};
// Keys the object at the playhead with these values (the gizmo's, or typed in the Object panel); the rest stay as they are there
export const setTransform = (
  name: string,
  v: { at?: number[]; rot?: number[]; scale?: number },
) => {
  const p = tools();
  if (p?.hold === name && !engine.isGizmoDragging()) p.hold = null;
  let fresh = false;
  edit((d) => {
    const o = d[name];
    if (!o) return;
    const h = keyHere(o);
    fresh = h.fresh;
    if (v.at) h.k.at = v.at.map(r3);
    if (v.rot) h.k.rot = v.rot.map(r1);
    if (v.scale !== undefined) h.k.scale = r3(Math.max(0.01, v.scale));
  });
  if (fresh) say(`Keyframe added to ${name} at ${stamp(S.t)}`, 2500);
};
// CapCut's ◇: off a key, a new key holding the object where it is drawn there, so nothing moves until a value changes; on a
// key, that key taken out (an object keeps its last one: deleting the object is what takes it out of the film)
export const toggleKey = (name: string) => {
  const o = placedData()[name];
  if (!o) return;
  const i = o.keys.findIndex((k) => Math.abs(k.t - S.t) < 0.5 / FPS);
  if (i < 0) {
    const v = engine.shownTransform(name);
    if (v) setTransform(name, v);
    return;
  }
  if (o.keys.length === 1) {
    say(`${name} needs at least one keyframe. To take it out of the film, delete the object`, 4000);
    return;
  }
  const t = o.keys[i].t;
  if (
    edit((d) => {
      d[name]?.keys.splice(i, 1);
    })
  )
    say(`Keyframe at ${stamp(t)} deleted. Ctrl+Z to undo`);
};
// The mob's clip from the playhead on, keyed like a value under CapCut's ◇: the key here names it (a new key if none), so it
// starts there and runs until a later key names another. A clip set before keys carried clips ran the whole film: it moves
// onto the first key, where it meant to start
const ownClip = (o: PlacedObject) => {
  if (o.clip !== undefined && o.keys[0].clip === undefined) {
    o.keys[0].clip = o.clip;
    if (o.rate !== undefined) o.keys[0].rate = o.rate;
  }
  delete o.clip;
  delete o.rate;
};
export const setClip = (name: string, clip: string) => {
  let fresh = false;
  edit((d) => {
    const o = d[name];
    if (!o) return;
    ownClip(o);
    const h = keyHere(o);
    fresh = h.fresh;
    h.k.clip = clip;
    delete h.k.rate;
  });
  say(
    `${name}: ${clip === "none" ? "stands still" : clip} from ${stamp(S.t)}${fresh ? " (keyframe added)" : ""}. Ctrl+Z to undo`,
    3000,
  );
};
// The key at the playhead names no clip of its own again: the one before carries on
export const clearClip = (name: string) =>
  edit((d) => {
    const o = d[name];
    if (!o) return;
    ownClip(o);
    const k = o.keys.find((x) => Math.abs(x.t - S.t) < 0.5 / FPS);
    if (k) {
      delete k.clip;
      delete k.rate;
    }
  });
// The speed of the clip running at the playhead (clip: its name), on the key that started it, or keyed here if none did
export const startedBy = (o: PlacedObject) => {
  const on = o.keys.filter((x) => x.t <= S.t + 0.5 / FPS);
  return (
    on.filter((x) => x.clip !== undefined).at(-1) ?? (o.clip !== undefined ? (on[0] ?? null) : null)
  ); // the object's own: its first key
};
export const setClipRate = (name: string, rate: number, clip: string) =>
  edit((d) => {
    const o = d[name];
    if (!o) return;
    ownClip(o);
    let k = startedBy(o);
    if (!k) {
      k = keyHere(o).k;
      k.clip = clip;
    }
    if (rate === 1) delete k.rate;
    else k.rate = rate;
  });
// CapCut's reset, keyed at the playhead: no turn, size 1. Position has no default to go back to
export const resetTransform = (name: string) => setTransform(name, { rot: [0, 0, 0], scale: 1 });
// Shown from here on, or hidden (a key at the playhead holds it)
export const setVisible = (name: string, on: boolean) =>
  edit((d) => {
    const o = d[name];
    if (o) keyHere(o).k.visible = on;
  });
