// @ts-nocheck
// Props with looks to choose between in the studio (draw.variants). Every look is its own small block-model-renderer
// scene, all built once and all but one hidden, so a switch shows on the very next frame. The first option is the
// film's own; a pick made in the studio ("Chốt") lands in choices.json, which draft and final renders apply too.
// A new prop: a vanilla block model per look in pack/assets/gohans (src/pack.ts), then an entry here.
import * as THREE from "three";
import { createScene } from "block-model-renderer";
import { DESK } from "./world";
import { onScreenRanges } from "./describe";

export const VARIANTS = [
  {
    id: "computer", title: "computer", pos: [DESK.x, 1, DESK.z], properties: { facing: "east" },
    options: [
      { id: "computer", title: "gray office CRT" },
      { id: "computer_beige", title: "beige 90s CRT" },
      { id: "computer_black", title: "black workstation" },
      { id: "computer_steel", title: "steel terminal" },
    ],
  },
];

// sources: what createScene reads blocks from; place(group): scales and seats a block-model-renderer group like the room
export async function buildVariants(sources, place, keysOf, EDIT, aspect) {
  return Promise.all(VARIANTS.map(async (v) => {
    const looks = await Promise.all(v.options.map(async (o) => {
      const s = await createScene(sources, [{ id: `gohans:${o.id}`, pos: v.pos, properties: v.properties }], { lighting: "scene", animate: false });
      place(s.group);
      return s.group;
    }));
    const box = new THREE.Box3(new THREE.Vector3(...v.pos), new THREE.Vector3(v.pos[0] + 1, v.pos[1] + 1, v.pos[2] + 1));
    let pick = 0, ranges = null, rangesFor = null;
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
      // film seconds when the prop is on screen, worked out again whenever the camera keys change
      get ranges() {
        const keys = keysOf(EDIT.cam);
        if (rangesFor !== keys) { ranges = onScreenRanges(box, keys, EDIT.end, aspect); rangesFor = keys; }
        return ranges;
      },
    };
  }));
}
