// @ts-nocheck
// What the creator drops into the scene from the studio's Objects library, as Unreal drops an asset from the Content Browser
// into the level: game blocks, the shared props (pack.ts), the mod picks and the game's 209 mobs (mc-actor/mob.ts), each with
// its own key row. The film names the file in package.json ("live-studio".keyFiles {"src/timeline/placed.json": "placed"}):
//   { "<name>": { "what": "block:minecraft:barrel" | "mob:zombie", "properties"?: {facing: "west"}, "clip"?: "walk", "rate"?: 1,
//                 "keys": [{ "t": 3.2, "at": [x, y, z], "rot": [x, y, z], "scale": 1, "visible"?: false, "ease"?: "out",
//                            "clip"?: "open", "rate"?: 1 }] } }
// at is metres (a block's origin is the middle of its bottom face, a mob's its feet), rot degrees in YXZ order (yaw first).
// Between keys it moves as the later key's ease spends the span (film-stage/camera.ts: a named ease or a cubic-bezier [x1, y1,
// x2, y2]; none is a smoothstep, within about 1% of film-stage's "inout") and turns the short way; it holds the first
// key before it and the last after; visible holds from its key on. A mob's clip is keyed like the rest: a key naming one
// starts it there, times rate ("none" stands it still; a one-shot clip such as a chest's "open" holds its last frame); before
// the first such key the object's own clip (default its idle, if any) runs from its first key. A "walk..." clip turns with the
// distance travelled, 4 swings a block as the game does.
//   const placed = await makePlaced(scene, sources, EDIT, "placed");  each frame placed.draw(t);  draw.tools.placed = placed
import * as THREE from "three";
import { createScene, listDirectory, renderBlock } from "block-model-renderer";
import { easeOf } from "film-stage/camera";
import { loadMob } from "mc-actor/mob";

const RAD = Math.PI / 180;
const keyAt = (keys, t) => { let i = 0; while (i < keys.length - 1 && t >= keys[i + 1].t) i++; return i; };
const smooth = (x) => x * x * (3 - 2 * x);
const quat = (rot = [0, 0, 0]) => new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0] * RAD, rot[1] * RAD, rot[2] * RAD, "YXZ"));

// Where a list of keys puts the object at t: position, turn, size, shown
export const poseAt = (keys, t) => {
  const i = keyAt(keys, t), a = keys[i], b = keys[Math.min(i + 1, keys.length - 1)];
  const x = b === a || t <= a.t ? 0 : t >= b.t ? 1 : (t - a.t) / (b.t - a.t), u = (b.ease === undefined ? smooth : easeOf(b.ease))(x);
  const at = new THREE.Vector3(...a.at).lerp(new THREE.Vector3(...b.at), u);
  const q = quat(a.rot).slerp(quat(b.rot), u);
  const scale = THREE.MathUtils.lerp(a.scale ?? 1, b.scale ?? 1, u);
  let visible = true;
  for (const k of keys) if (k.t <= t && k.visible !== undefined) visible = k.visible;
  if (t < keys[0].t && keys[0].visible !== undefined) visible = keys[0].visible;
  return { at, q, scale, visible };
};
// The clip running at t and the second it started: the last key at or before t that names one; else the object's own, from
// its first key
export const clipAt = (o, t) => {
  let k = null;
  for (const x of o.keys) if (x.t <= t && x.clip !== undefined) k = x;
  return k ? { clip: k.clip, from: k.t, rate: k.rate ?? o.rate ?? 1 } : { clip: o.clip, from: o.keys[0].t, rate: o.rate ?? 1 };
};
// Metres travelled along the keys up to t, for a walk clip
const travelled = (keys, t) => {
  let d = 0;
  for (let i = 0; i < keys.length - 1 && keys[i].t < t; i++) {
    const a = new THREE.Vector3(...keys[i].at);
    d += a.distanceTo(t >= keys[i + 1].t ? new THREE.Vector3(...keys[i + 1].at) : poseAt(keys, t).at);
  }
  return d;
};

export async function makePlaced(scene, sources, EDIT, key = "placed") {
  const root = new THREE.Group();
  root.name = "placed";
  scene.add(root);
  const built = new Map(); // name -> { what, holder, mob? }
  const data = () => EDIT[key] ?? {};

  const buildBlock = async (id, properties) => {
    const s = await createScene(sources, [{ id, pos: [0, 0, 0], ...(properties && { properties }) }], { lighting: "scene", animate: false });
    if (!s) throw new Error(`block-model-renderer has no block "${id}"`);
    s.group.scale.setScalar(1 / 16);
    s.group.position.set(0, 0.5, 0); // a block at pos 0 spans -8..8 px: this stands it on its origin
    s.group.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    return s.group;
  };
  const build = async (name, o) => {
    const holder = new THREE.Group();
    holder.name = name;
    holder.userData.placed = name;
    let mob = null;
    const [kind, ...rest] = o.what.split(":"), id = rest.join(":");
    if (kind === "mob") { mob = await loadMob(id); holder.add(mob.g); }
    else holder.add(await buildBlock(id, o.properties));
    return { what: o.what, props: JSON.stringify(o.properties ?? null), holder, mob };
  };

  // Builds what is new or changed in the file and drops what left it; the studio awaits it after each edit, then redraws
  let running = Promise.resolve(), seen = null;
  const sync = () => {
    const now = data();
    if (now === seen) return running;
    seen = now;
    running = running.then(async () => {
      const want = data();
      for (const [name, b] of built) {
        const o = want[name];
        if (o && o.what === b.what && JSON.stringify(o.properties ?? null) === b.props) continue;
        root.remove(b.holder);
        built.delete(name);
      }
      for (const [name, o] of Object.entries(want)) {
        if (built.has(name) || !o?.what || !o.keys?.length) continue;
        try {
          const b = await build(name, o);
          if (data()[name]) { built.set(name, b); root.add(b.holder); }
        } catch (e) { console.warn(`placed "${name}": ${e.message}`); }
      }
    });
    return running;
  };
  await sync();

  const placed = {
    key,
    root,
    hold: null, // the name the studio's gizmo is dragging: drawn by the gizmo, not by its keys
    sync,
    draw(t) {
      if (data() !== seen) sync();
      const all = data();
      for (const [name, b] of built) {
        const o = all[name];
        if (!o?.keys?.length) { b.holder.visible = false; continue; }
        if (name === placed.hold) continue;
        const p = poseAt(o.keys, t);
        b.holder.visible = p.visible;
        b.holder.position.copy(p.at);
        b.holder.quaternion.copy(p.q);
        b.holder.scale.setScalar(p.scale);
        if (b.mob) {
          const run = clipAt(o, t), clip = run.clip ?? b.mob.clips.find((c) => /idle/i.test(c));
          if (!clip || !b.mob.clips.includes(clip)) b.mob.still();
          else b.mob.animate(clip, clip.startsWith("walk") ? (travelled(o.keys, t) * 4) / 20 : Math.max(0, t - run.from) * run.rate);
        }
      }
    },
    objectOf: (name) => built.get(name)?.holder ?? null,
    nameOf(o) { for (let c = o; c; c = c.parent) if (c.userData?.placed && built.get(c.userData.placed)?.holder === c) return c.userData.placed; return null; },
    clipsOf: (name) => built.get(name)?.mob?.clips ?? [],
    clipAt: (name, t) => (data()[name]?.keys?.length ? clipAt(data()[name], t) : null),
    // Where the object goes from its first key to its last, in world space: a point per frame and one per key, for the studio's
    // motion path
    pathOf(name, fps = 30) {
      const keys = data()[name]?.keys;
      if (!keys?.length) return { frames: [], keys: [] };
      const frames = [], last = keys[keys.length - 1].t;
      for (let f = 0; keys[0].t + f / fps <= last + 1e-6; f++) frames.push(root.localToWorld(poseAt(keys, keys[0].t + f / fps).at));
      return { frames, keys: keys.map((k) => root.localToWorld(new THREE.Vector3(...k.at))) };
    },
    // Everything that can be dropped in: [{what, kind, title}]; kind "block" and "mob" are the game's own, "custom" every
    // other namespace (the shared gohans:* props, the mod picks)
    async catalog() {
      const out = [];
      const spaces = (await listDirectory("assets", sources)).filter((ns) => !ns.includes("."));
      for (const ns of spaces) {
        for (const f of await listDirectory(`assets/${ns}/blockstates`, sources)) {
          if (!f.endsWith(".json")) continue;
          const id = f.slice(0, -5);
          if (ns === "minecraft" && /^(air|cave_air|void_air|structure_void|light|barrier|moving_piston|piston_head)$/.test(id)) continue;
          out.push({ what: `block:${ns}:${id}`, kind: ns === "minecraft" ? "block" : "custom", title: `${id.replaceAll("_", " ")}${ns === "minecraft" ? "" : ` (${ns})`}` });
        }
      }
      const r = await fetch(`${location.origin}/mcasset/1.21.11/entity-models/minecraft/_list.json`).catch(() => null);
      if (r?.ok) for (const f of (await r.json()).files ?? []) if (f.endsWith(".json")) out.push({ what: `mob:${f.slice(0, -5)}`, kind: "mob", title: f.slice(0, -5).replaceAll("_", " ") });
      return out;
    },
    // A small picture of a block for the library row (game-style item view), null for a mob
    async icon(what, size = 64) {
      const [kind, ...rest] = what.split(":");
      if (kind !== "block") return null;
      const c = await renderBlock({ id: rest.join(":"), assets: sources, width: size, height: size });
      return c?.toDataURL?.() ?? null;
    },
  };
  return placed;
}
