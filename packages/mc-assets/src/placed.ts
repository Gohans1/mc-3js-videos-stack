// @ts-nocheck
import { createScene, listDirectory, renderBlock } from "block-model-renderer";
import { loadMob } from "mc-actor/mob";
import * as THREE from "three";

import { clipAt, poseAt, travelled } from "./placed-math";

export { clipAt, poseAt, travelled };
const framePose = { at: new THREE.Vector3(), q: new THREE.Quaternion(), scale: 1, visible: true };

export async function makePlaced(scene, sources, EDIT, key = "placed") {
  const root = new THREE.Group();
  root.name = "placed";
  scene.add(root);
  const built = new Map();
  const data = () => EDIT[key] ?? {};

  const buildBlock = async (id, properties) => {
    const s = await createScene(
      sources,
      [{ id, pos: [0, 0, 0], ...(properties && { properties }) }],
      { lighting: "scene", animate: false },
    );
    if (!s) throw new Error(`block-model-renderer has no block "${id}"`);
    s.group.scale.setScalar(1 / 16);
    s.group.position.set(0, 0.5, 0); // a block at pos 0 spans -8..8 px: this stands it on its origin
    s.group.traverse((o) => {
      if (o.isMesh) o.castShadow = o.receiveShadow = true;
    });
    return s.group;
  };
  const build = async (name, o) => {
    const holder = new THREE.Group();
    holder.name = name;
    holder.userData.placed = name;
    let mob = null;
    const [kind, ...rest] = o.what.split(":"),
      id = rest.join(":");
    if (kind === "mob") {
      mob = await loadMob(id);
      holder.add(mob.g);
    } else holder.add(await buildBlock(id, o.properties));
    return { what: o.what, props: JSON.stringify(o.properties ?? null), holder, mob };
  };

  let running = Promise.resolve(),
    seen = null;
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
          if (data()[name]) {
            built.set(name, b);
            root.add(b.holder);
          }
        } catch (e) {
          console.warn(`placed "${name}": ${e.message}`);
        }
      }
    });
    return running;
  };
  await sync();

  const placed = {
    key,
    root,
    hold: null,
    sync,
    draw(t) {
      if (data() !== seen) sync();
      const all = data();
      for (const [name, b] of built) {
        const o = all[name];
        if (!o?.keys?.length) {
          b.holder.visible = false;
          continue;
        }
        if (name === placed.hold) continue;
        const p = poseAt(o.keys, t, framePose);
        b.holder.visible = p.visible;
        b.holder.position.copy(p.at);
        b.holder.quaternion.copy(p.q);
        b.holder.scale.setScalar(p.scale);
        if (b.mob) {
          const run = clipAt(o, t),
            clip = run.clip ?? b.mob.clips.find((c) => /idle/i.test(c));
          if (!clip || !b.mob.clips.includes(clip)) b.mob.still();
          else
            b.mob.animate(
              clip,
              clip.startsWith("walk")
                ? (travelled(o.keys, t, p.at) * 4) / 20
                : Math.max(0, t - run.from) * run.rate,
            );
        }
      }
    },
    objectOf: (name) => built.get(name)?.holder ?? null,
    nameOf(o) {
      for (let c = o; c; c = c.parent)
        if (c.userData?.placed && built.get(c.userData.placed)?.holder === c)
          return c.userData.placed;
      return null;
    },
    clipsOf: (name) => built.get(name)?.mob?.clips ?? [],
    clipAt: (name, t) => (data()[name]?.keys?.length ? clipAt(data()[name], t) : null),
    pathOf(name, fps = 30) {
      const keys = data()[name]?.keys;
      if (!keys?.length) return { frames: [], keys: [] };
      const frames = [],
        last = keys[keys.length - 1].t;
      for (let f = 0; keys[0].t + f / fps <= last + 1e-6; f++)
        frames.push(root.localToWorld(poseAt(keys, keys[0].t + f / fps).at));
      return { frames, keys: keys.map((k) => root.localToWorld(new THREE.Vector3(...k.at))) };
    },
    async catalog() {
      const out = [];
      const spaces = (await listDirectory("assets", sources)).filter((ns) => !ns.includes("."));
      for (const ns of spaces) {
        for (const f of await listDirectory(`assets/${ns}/blockstates`, sources)) {
          if (!f.endsWith(".json")) continue;
          const id = f.slice(0, -5);
          if (
            ns === "minecraft" &&
            /^(air|cave_air|void_air|structure_void|light|barrier|moving_piston|piston_head)$/.test(
              id,
            )
          )
            continue;
          out.push({
            what: `block:${ns}:${id}`,
            kind: ns === "minecraft" ? "block" : "custom",
            title: `${id.replaceAll("_", " ")}${ns === "minecraft" ? "" : ` (${ns})`}`,
          });
        }
      }
      const r = await fetch(
        `${location.origin}/mcasset/1.21.11/entity-models/minecraft/_list.json`,
      ).catch(() => null);
      if (r?.ok)
        for (const f of (await r.json()).files ?? [])
          if (f.endsWith(".json"))
            out.push({
              what: `mob:${f.slice(0, -5)}`,
              kind: "mob",
              title: f.slice(0, -5).replaceAll("_", " "),
            });
      return out;
    },
    async icon(what, size = 64) {
      const [kind, ...rest] = what.split(":");
      if (kind !== "block") return null;
      const c = await renderBlock({
        id: rest.join(":"),
        assets: sources,
        width: size,
        height: size,
      });
      return c?.toDataURL?.() ?? null;
    },
  };
  return placed;
}
