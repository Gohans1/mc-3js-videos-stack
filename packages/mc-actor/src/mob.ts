// @ts-nocheck
import { AssetLoader, BasicAssetKey, Entities, EntityObject } from "minerender";
// Any of the game's 209 mobs (cow, zombie, silverfish, ...) from MineRender: the game's own model and its sampled vanilla
// clips, lit like the rest of the film, walked along a path of keys. Never build a mob box by box: if one is missing or
// wrong here, fix it here. Data: the vault's mcasset/1.21.11 (bun packages/mc-assets/mobs.ts fills it), served at /mcasset.
//   const cow = await loadMob("cow");  scene.add(cow.g);  each frame: cow.draw(keys, t)
//   keys {scale?, path: [{t, at: [x, y, z], hop?}], clip?, rate?}  hidden before the first key and after the last; between
//   keys it slides, hop lifts it in an arc of that height, it faces where it is going.
//   clip: one of mob.clips (default the first). A "walk..." clip turns with the distance walked, as the game turns its limb
//   swing (4 per block, the clips sampled at 1 per tick) and swings as far as the game would at that speed; any other
//   clip (silverfish "idle") runs on film time, times rate.
import * as THREE from "three";

import { centroidUv } from "./player";

// options: { root, texture: "minecraft:textures/entity/cat/tabby.png", when: ["tamed"], tints: { collar_color: 0xff0000 } }
export async function loadMob(
  name,
  { root = `${location.origin}/mcasset/1.21.11`, texture, when, tints } = {},
) {
  AssetLoader.ROOT = root;
  const key = new BasicAssetKey("minecraft", name);
  const tex = texture ? new BasicAssetKey(...texture.split(":")) : undefined;
  const model = await Entities.getEntity(key, tex, when ? { when } : undefined);
  if (!model)
    throw new Error(
      `MineRender has no mob "${name}" under ${root}: run bun packages/mc-assets/mobs.ts`,
    );
  const mob = new EntityObject(model, tints ? { tints } : {});
  await mob.init();
  // MineRender draws mobs unlit (MeshBasicMaterial); the film's light needs a lit one with the same texture and tint
  const lit = new Map();
  mob.traverse((o) => {
    if (!o.isMesh) return;
    const swap = (m) => {
      if (!lit.has(m))
        lit.set(
          m,
          centroidUv(
            new THREE.MeshLambertMaterial({
              map: m.map,
              color: m.color,
              alphaTest: m.alphaTest,
              transparent: m.transparent,
              side: m.side,
            }),
          ),
        );
      return lit.get(m);
    };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
    o.castShadow = o.receiveShadow = true;
  });
  const clipsByName = (await Entities.getAnimations(key)) ?? {};
  // model units are game pixels; the turn makes its head look down -z, so rotation.y = atan2(-dx, -dz) faces the path
  const body = new THREE.Group();
  body.scale.setScalar(1 / 16);
  body.rotation.y = Math.PI;
  body.add(mob);
  const g = new THREE.Group();
  g.add(body);

  const keyAt = (keys, t) => {
    let i = 0;
    while (i < keys.length - 1 && t >= keys[i + 1].t) i++;
    return i;
  };
  const where = (path, t) => {
    const i = keyAt(path, t),
      a = path[i],
      b = path[Math.min(i + 1, path.length - 1)];
    const x = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
    const p = new THREE.Vector3(...a.at).lerp(new THREE.Vector3(...b.at), x);
    p.y += (b.hop ?? 0) * 4 * x * (1 - x);
    return p;
  };
  // ground distance walked from the first key to t, in steps of a game tick
  const walked = (path, t) => {
    let d = 0;
    for (let s = path[0].t; s < t; s += 0.05) {
      const a = where(path, s),
        b = where(path, Math.min(t, s + 0.05));
      d += Math.hypot(b.x - a.x, b.z - a.z);
    }
    return d;
  };
  let playing = null;
  const draw = (S, t) => {
    const path = S?.path;
    g.visible = !!path?.length && t >= path[0].t && t < path[path.length - 1].t;
    if (!g.visible) return;
    g.scale.setScalar(S.scale ?? 1);
    const p = where(path, t),
      ahead = where(path, t + 0.05);
    g.position.copy(p);
    const dx = ahead.x - p.x,
      dz = ahead.z - p.z;
    if (dx * dx + dz * dz > 1e-8) g.rotation.y = Math.atan2(-dx, -dz);
    const name = S.clip ?? Object.keys(clipsByName)[0];
    const clip = clipsByName[name];
    if (!clip) return;
    if (playing !== name) {
      mob.playAnimation(clip);
      playing = name;
    }
    if (name.startsWith("walk")) {
      mob.setAnimationWeights([Math.min(1, Math.hypot(dx, dz) / 0.05 / 5)]);
      mob.setAnimationTime((walked(path, t) * 4) / 20);
    } else mob.setAnimationTime(t * (S.rate ?? 1));
  };
  // One clip at a given time in seconds, where nothing walks it along a path (mc-assets/placed.ts: mobs dropped in from the studio)
  const animate = (name, time, weight = 1) => {
    const clip = clipsByName[name];
    if (!clip) return;
    if (playing !== name) {
      mob.playAnimation(clip);
      playing = name;
    }
    mob.setAnimationWeights([weight]);
    mob.setAnimationTime(time);
  };
  // The model's own pose again: a one-shot clip that ended open (a chest's "open") must not stay open when the film goes back
  // before the key that started it
  const still = () => {
    if (playing === null) return;
    mob.stopAnimation();
    playing = null;
  };
  return { g, mob, clips: Object.keys(clipsByName), draw, where, animate, still };
}
