// Objects the creator drops into the scene (the film's tools.placed, mc-assets/placed.ts), the way Unreal drops an asset from the
// Content Browser into the level: the Objects library adds one where the pointer lets go or in front of the camera, a click on
// the picture selects one (picture/pointer.ts; the right button pins a note), and the gizmo (three's TransformControls) moves, turns and sizes it. As with Unreal's Auto Key, a
// gizmo edit keys the object at the playhead: the key there, or a new one. The objects live in one of the film's key files, so
// undo, saving and an agent's edits are keys.ts and doc.ts's, and each object's keys are an ordinary key row.
import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import type { Ease } from "../core/ease";
import { FPS, r3, stamp } from "../core/time";
import { files } from "../keys/keys";
import { path, showPath } from "./path";
import { setPlaying } from "../playback/transport";
import { S } from "../core/state";
import { get, say, set, studio } from "../core/store";

export interface PlacedKey { t: number; at: number[]; rot?: number[]; scale?: number; visible?: boolean; ease?: Ease; clip?: string; rate?: number; [k: string]: unknown }
export interface PlacedObject { what: string; properties?: Record<string, string>; clip?: string; rate?: number; keys: PlacedKey[] }
type Placed = Record<string, PlacedObject>;

const DEG = 180 / Math.PI;
const r1 = (x: number) => Math.round(x * 10) / 10;
export const tools = () => S.tools?.placed ?? null;
const fileOf = () => { const p = tools(); return p ? files.findIndex((x) => x.edit === p.key) : -1; };
export const placedData = (): Placed => ((files[fileOf()]?.doc.data as Placed | null) ?? {});
export const canPlace = () => fileOf() >= 0;
export const titleOf = (what: string) => what.split(":").at(-1)!.replaceAll("_", " ");

const edit = (change: (d: Placed) => void) => {
  const f = fileOf();
  if (f < 0) { say("This film can't take objects yet: it needs a placed key file (docs/film-contract.md)"); return false; }
  files[f].doc.edit((d) => change(d as Placed));
  return true;
};
const freeName = (base: string) => {
  const taken = placedData();
  if (!taken[base]) return base;
  for (let n = 2; ; n++) if (!taken[`${base} ${n}`]) return `${base} ${n}`;
};

// ---------- Adding, removing, renaming
export const addObject = (what: string, at: number[], yaw = 0) => {
  const name = freeName(titleOf(what));
  const ok = edit((d) => { d[name] = { what, keys: [{ t: r3(S.t), at: at.map(r3), rot: [0, r1(yaw), 0], scale: 1 }] }; });
  if (!ok) return;
  select(name);
  say(`${name} added. Drag the arrows to move it`);
};
export const removeObject = (name: string) => {
  if (!edit((d) => { delete d[name]; })) return;
  if (get().object === name) select(null);
  say(`${name} deleted. Ctrl+Z to undo`);
};
export const renameObject = (from: string, to: string) => {
  to = to.trim();
  if (!to || to === from) return;
  if (placedData()[to]) { say(`There's already an object called ${to}`); return; }
  // Rebuilt in the same order, so the key rows stay where they were
  edit((d) => { const all = Object.entries(d); for (const k of Object.keys(d)) delete d[k]; for (const [k, v] of all) d[k === from ? to : k] = v; });
  if (get().object === from) select(to);
};

// How an object moves into its key i (components/EasePicker.tsx): a key without an ease moves on mc-assets/placed.ts's
// smoothstep, which the "inout" tile (Ease) draws to within about 1%
export const OBJECT_EASE = "inout";
export const setKeyEase = (name: string, i: number, ease: Ease | undefined) => edit((d) => {
  const k = d[name]?.keys[i];
  if (!k) return;
  if (ease === undefined) delete k.ease; else k.ease = ease;
});
export const placedDoc = {
  snapshot: () => files[fileOf()]?.doc.snapshot() ?? "null",
  restore: (s: string) => files[fileOf()]?.doc.restore(s),
  preview: (name: string, i: number, ease: Ease) => files[fileOf()]?.doc.preview((d) => { const k = (d as Placed)[name]?.keys[i]; if (k) k.ease = ease; }),
};

// The key at the playhead (within half a frame), or a new one there copied from the key before it
const keyHere = (o: PlacedObject) => {
  const ks = o.keys, near = ks.findIndex((k) => Math.abs(k.t - S.t) < 0.5 / FPS);
  if (near >= 0) return { k: ks[near], fresh: false };
  const i = ks.findIndex((k) => k.t > S.t), at = i < 0 ? ks.length : i;
  const k = { ...structuredClone(ks[Math.max(0, at - 1)]), t: r3(S.t) };
  delete k.visible; delete k.clip; delete k.rate; // a copied clip would start over here
  ks.splice(at, 0, k);
  return { k, fresh: true };
};
// Keys the object at the playhead with these values (the gizmo's, or typed in the Object panel); the rest stay as they are there
export const setTransform = (name: string, v: { at?: number[]; rot?: number[]; scale?: number }) => {
  const p = tools();
  if (p?.hold === name && !gizmo?.dragging) p.hold = null;
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
const transformOf = (o3: THREE.Object3D) => {
  const e = new THREE.Euler().setFromQuaternion(o3.quaternion, "YXZ");
  return { at: o3.position.toArray(), rot: [e.x, e.y, e.z].map((r) => r * DEG), scale: o3.scale.x };
};
// A value being dragged in the Object panel: drawn as it goes, held off its keys until setTransform saves it
export const previewTransform = (name: string, v: { at?: number[]; rot?: number[]; scale?: number }) => {
  const p = tools(), o3 = p?.objectOf(name);
  if (!p || !o3) return;
  p.hold = name;
  if (v.at) o3.position.fromArray(v.at);
  if (v.rot) o3.quaternion.setFromEuler(new THREE.Euler(...(v.rot.map((r) => r / DEG) as [number, number, number]), "YXZ"));
  if (v.scale !== undefined) o3.scale.setScalar(Math.max(0.01, v.scale));
  S.dirty = true;
};
// What the object is at the playhead, as drawn
export const shownTransform = (name: string) => { const o3 = tools()?.objectOf(name); return o3 ? transformOf(o3) : null; };
// CapCut's ◇: off a key, a new key holding the object where it is drawn there, so nothing moves until a value changes; on a
// key, that key taken out (an object keeps its last one: deleting the object is what takes it out of the film)
export const toggleKey = (name: string) => {
  const o = placedData()[name];
  if (!o) return;
  const i = o.keys.findIndex((k) => Math.abs(k.t - S.t) < 0.5 / FPS);
  if (i < 0) { const v = shownTransform(name); if (v) setTransform(name, v); return; }
  if (o.keys.length === 1) { say(`${name} needs at least one keyframe. To take it out of the film, delete the object`, 4000); return; }
  const t = o.keys[i].t;
  if (edit((d) => { d[name]?.keys.splice(i, 1); })) say(`Keyframe at ${stamp(t)} deleted. Ctrl+Z to undo`);
};
// The mob's clip from the playhead on, keyed like a value under CapCut's ◇: the key here names it (a new key if none), so it
// starts there and runs until a later key names another. A clip set before keys carried clips ran the whole film: it moves
// onto the first key, where it meant to start
const ownClip = (o: PlacedObject) => {
  if (o.clip !== undefined && o.keys[0].clip === undefined) { o.keys[0].clip = o.clip; if (o.rate !== undefined) o.keys[0].rate = o.rate; }
  delete o.clip; delete o.rate;
};
export const setClip = (name: string, clip: string) => {
  let fresh = false;
  edit((d) => { const o = d[name]; if (!o) return; ownClip(o); const h = keyHere(o); fresh = h.fresh; h.k.clip = clip; delete h.k.rate; });
  say(`${name}: ${clip === "none" ? "stands still" : clip} from ${stamp(S.t)}${fresh ? " (keyframe added)" : ""}. Ctrl+Z to undo`, 3000);
};
// The key at the playhead names no clip of its own again: the one before carries on
export const clearClip = (name: string) => edit((d) => {
  const o = d[name];
  if (!o) return;
  ownClip(o);
  const k = o.keys.find((x) => Math.abs(x.t - S.t) < 0.5 / FPS);
  if (k) { delete k.clip; delete k.rate; }
});
// The speed of the clip running at the playhead (clip: its name), on the key that started it, or keyed here if none did
export const startedBy = (o: PlacedObject) => {
  const on = o.keys.filter((x) => x.t <= S.t + 0.5 / FPS);
  return on.filter((x) => x.clip !== undefined).at(-1) ?? (o.clip !== undefined ? (on[0] ?? null) : null); // the object's own: its first key
};
export const setClipRate = (name: string, rate: number, clip: string) => edit((d) => {
  const o = d[name];
  if (!o) return;
  ownClip(o);
  let k = startedBy(o);
  if (!k) { k = keyHere(o).k; k.clip = clip; }
  if (rate === 1) delete k.rate; else k.rate = rate;
});
// CapCut's reset, keyed at the playhead: no turn, size 1. Position has no default to go back to
export const resetTransform = (name: string) => setTransform(name, { rot: [0, 0, 0], scale: 1 });
// Shown from here on, or hidden (a key at the playhead holds it)
export const setVisible =(name: string, on: boolean) => edit((d) => { const o = d[name]; if (o) keyHere(o).k.visible = on; });

// ---------- Selecting and the gizmo
export type GizmoMode = "translate" | "rotate" | "scale";
let gizmo: TransformControls | null = null;
const overlay = new THREE.Scene();
const box = new THREE.BoxHelper(new THREE.Object3D(), 0xec8b49);
box.visible = false;
// What a click would pick, under the mouse
const hoverBox = new THREE.BoxHelper(new THREE.Object3D(), 0xec8b49);
Object.assign(hoverBox.material, { transparent: true, opacity: 0.45 });
hoverBox.visible = false;
overlay.add(path, box, hoverBox);
let hovered: string | null = null;
let lastScale = 1;
const ensureGizmo = () => {
  if (gizmo || !S.tools) return gizmo;
  gizmo = new TransformControls(S.tools.camera, S.el.canvas);
  gizmo.setSize(0.9);
  overlay.add(gizmo.getHelper());
  gizmo.addEventListener("dragging-changed", (e) => {
    const p = tools(), name = get().object, o = gizmo!.object;
    if (!p || !name || !o) return;
    if (e.value) { p.hold = name; lastScale = o.scale.x; if (S.playing) setPlaying(false); return; }
    setTransform(name, transformOf(o));
    p.hold = null;
  });
  // One size for all three axes: whichever axis handle moved sets the other two
  gizmo.addEventListener("objectChange", () => {
    const o = gizmo!.object;
    if (o && gizmo!.getMode() === "scale") {
      const v = [o.scale.x, o.scale.y, o.scale.z], s = v.reduce((a, b) => (Math.abs(b - lastScale) > Math.abs(a - lastScale) ? b : a), lastScale);
      o.scale.setScalar(Math.max(0.05, s));
      lastScale = o.scale.x;
    }
    S.dirty = true;
  });
  gizmo.addEventListener("change", () => { S.dirty = true; });
  applySnap();
  return gizmo;
};
const applySnap = () => {
  if (!gizmo) return;
  const on = get().snap;
  gizmo.setTranslationSnap(on ? 1 / 16 : null); // one game pixel
  gizmo.setRotationSnap(on ? Math.PI / 12 : null); // 15 degrees
  gizmo.setScaleSnap(on ? 1 / 16 : null);
};
export const setSnap = (on: boolean) => { set({ snap: on }); applySnap(); };
export const setGizmo = (mode: GizmoMode) => { set({ gizmo: mode }); gizmo?.setMode(mode); S.dirty = true; };
export const gizmoBusy = () => !!gizmo && (gizmo.dragging || gizmo.axis !== null);

export const select = (name: string | null) => set(name ? { object: name, side: "objects", clips: [], clip: null, camKey: null, camPicks: [], shotPick: null, keyPicks: [], textPicks: [] } : { object: null });

studio.subscribe((s, was) => { if (s.object !== was.object || s.gizmo !== was.gizmo || s.keysRev !== was.keysRev) attach(); });
// Re-points the gizmo whenever the selection or the built objects change (a rename or an undo builds a new one)
export const attach = () => {
  const name = get().object;
  if (name && files.length && !placedData()[name]) { set({ object: null }); return; } // undone, or an agent took it out
  const o = name ? tools()?.objectOf(name) : null;
  box.visible = !!o;
  S.dirty = true;
  if (!o) { gizmo?.detach(); return; }
  const g = ensureGizmo();
  if (!g) return;
  if (g.object !== o) g.attach(o);
  g.setMode(get().gizmo);
};
// The object under the mouse, outlined faintly; the canvas takes the hand cursor over it
export const hover = (name: string | null) => {
  if (name === hovered) return;
  hovered = name;
  if (S.el?.canvas) S.el.canvas.style.cursor = name ? "pointer" : "";
  S.dirty = true;
};
// After the film draws: the selection's box, what the pointer is over and the gizmo, on top of the picture, outside the film's
// own effects and its scene
export const drawGizmo = () => {
  if (!S.tools) return;
  const name = get().object, o = name ? tools()?.objectOf(name) : null, h = hovered && hovered !== name ? tools()?.objectOf(hovered) : null;
  box.visible = !!o; hoverBox.visible = !!h;
  showPath(tools(), o ? name : null, get().keysRev);
  if (!o && !h) return;
  const r = (S.tools as { renderer?: THREE.WebGLRenderer }).renderer;
  if (!r) return;
  if (o) box.setFromObject(o);
  if (h) hoverBox.setFromObject(h);
  const auto = r.autoClear;
  r.autoClear = false;
  r.clearDepth();
  r.render(overlay, S.tools.camera);
  r.autoClear = auto;
};
// What a click on the picture hit, if it is a dropped-in object
export const pickAt = (x: number, y: number) => {
  const p = tools();
  if (!p || !S.tools) return null;
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(x * 2 - 1, 1 - y * 2), S.tools.camera);
  for (const h of ray.intersectObject(p.root, true)) {
    let shown = true;
    for (let c: THREE.Object3D | null = h.object; c; c = c.parent) if (!c.visible) shown = false;
    if (shown) return p.nameOf(h.object);
  }
  return null;
};

// Where a drop at (x, y) on the picture lands: the surface under it, else 3 m in front of the camera; facing the camera
export const dropPoint = (x: number, y: number, hitWorld?: number[]) => {
  const cam = S.tools!.camera;
  const at = hitWorld ? new THREE.Vector3(...hitWorld) : (() => {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(x * 2 - 1, 1 - y * 2), cam);
    return ray.ray.at(3, new THREE.Vector3());
  })();
  if (get().snap) at.set(Math.round(at.x * 16) / 16, Math.round(at.y * 16) / 16, Math.round(at.z * 16) / 16);
  const to = cam.position.clone().sub(at);
  return { at: at.toArray(), yaw: Math.atan2(-to.x, -to.z) * DEG };
};

// The library's drag: a ghost follows the pointer, and letting go over the picture drops the object on what lies under it
export const startObjectCarry = (what: string, e: PointerEvent, look: (x: number, y: number) => { world?: number[] }) => {
  const ghost = document.createElement("div"), name = titleOf(what);
  ghost.className = "carry";
  document.body.append(ghost);
  const over = (ev: PointerEvent) => {
    const r = S.el.canvas.getBoundingClientRect();
    const x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
    return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
  };
  const move = (ev: PointerEvent) => {
    ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 8}px)`;
    const o = over(ev);
    ghost.toggleAttribute("data-over", !!o);
    ghost.textContent = o ? `${name} → drop here` : `${name}: drop it on the picture`;
  };
  const end = (ev: PointerEvent) => {
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", end);
    removeEventListener("pointercancel", end);
    ghost.remove();
    const o = ev.type === "pointerup" ? over(ev) : null;
    if (!o) return;
    const p = dropPoint(o.x, o.y, look(o.x, o.y).world);
    addObject(what, p.at, what.startsWith("mob:") ? p.yaw : 0);
  };
  addEventListener("pointermove", move);
  addEventListener("pointerup", end);
  addEventListener("pointercancel", end);
  move(e);
};
// The + button: the middle of the picture
export const addInFront = (what: string, look: (x: number, y: number) => { world?: number[] }) => {
  const p = dropPoint(0.5, 0.6, look(0.5, 0.6).world);
  addObject(what, p.at, what.startsWith("mob:") ? p.yaw : 0);
};
