// @ts-nocheck
// Props with looks to choose between in the studio (draw.variants). Every look is its own small block-model-renderer
// scene, all built once and all but one hidden, so a switch shows on the very next frame. The first option is the
// film's own; a pick made in the studio ("Chốt") lands in choices.json, which draft and final renders apply too.
// A film lists its props: [{id, title, pos: [x, y, z], properties?, ns? (default "gohans"), options: [{id, title}],
// loose?: {suffix, pivot}}] (loose: a part of each look, the `${id}${suffix}` model, built one mesh per cube and hung on
// a pivot so it can move apart). A new look: a vanilla block model per look in the pack (pack.ts), then an option.
import * as THREE from "three";
import { createScene, loadModel, parseBlockstate, prepareAssets, resolveModelData } from "block-model-renderer";

// sources: what createScene reads blocks from; place(group): scales and seats a block-model-renderer group like the room;
// rangesOf(box): a function returning the film seconds the box is on screen (the studio's chip), kept current by the film
export async function buildVariants(list, sources, place, rangesOf) {
  const assets = await prepareAssets(sources);
  return Promise.all(list.map(async (v) => {
    const one = async (id) => {
      const s = await createScene(sources, [{ id: `${v.ns ?? "gohans"}:${id}`, pos: v.pos, properties: v.properties }], { lighting: "scene", animate: false });
      place(s.group);
      return s.group;
    };
    // createScene always merges a block's cubes into one mesh; this builds the block the same way (its blockstate's
    // models, placed at pos in 16ths of a block) but keeps one mesh per cube
    const cubes = async (id) => {
      const block = new THREE.Group();
      for (const m of await parseBlockstate(assets, `${v.ns ?? "gohans"}:${id}`, { data: v.properties ?? {}, pos: v.pos }))
        await loadModel(block, assets, await resolveModelData(assets, m), { display: {}, animate: false, lighting: "scene", mergeElements: false });
      block.position.set(v.pos[0] * 16, v.pos[1] * 16, v.pos[2] * 16);
      const g = new THREE.Group();
      g.add(block);
      place(g);
      g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
      return g;
    };
    const pivot = v.loose ? new THREE.Group() : null;
    if (pivot) pivot.position.set(...v.loose.pivot);
    const looks = await Promise.all(v.options.map(async (o) => {
      const g = await one(o.id);
      if (!pivot) return g;
      const part = await cubes(o.id + v.loose.suffix);
      if (!pivot.parent) { part.parent.add(pivot); pivot.updateMatrixWorld(); }
      pivot.attach(part); // keeps where it was placed, now turning about the pivot
      return { set visible(b) { g.visible = part.visible = b; } };
    }));
    const box = new THREE.Box3(new THREE.Vector3(...v.pos), new THREE.Vector3(v.pos[0] + 1, v.pos[1] + 1, v.pos[2] + 1));
    return Object.assign(asVariant(v, looks, box, rangesOf(box)), { loose: pivot }); // assign, not spread: keeps the getters live
  }));
}

// One prop's looks (one group per option, built already) as a studio variant; also for props that move (a chair he
// carries), whose looks hang under the prop's own group. box: where it stands; ranges(): when it is on screen
export function asVariant(v, looks, box, ranges) {
  let pick = 0;
  const set = (id) => {
    const i = v.options.findIndex((o) => o.id === id);
    if (i < 0) return;
    pick = i;
    looks.forEach((g, j) => { g.visible = j === i; });
  };
  set(v.options[0].id);
  return {
    id: v.id, title: v.title, options: v.options, box, set,
    get pick() { return v.options[pick]; },
    get ranges() { return ranges(); },
  };
}
