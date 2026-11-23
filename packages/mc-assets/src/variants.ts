// @ts-nocheck
import {
  createScene,
  loadModel,
  parseBlockstate,
  prepareAssets,
  resolveModelData,
} from "block-model-renderer";
import * as THREE from "three";

export async function buildVariants(list, sources, place, rangesOf) {
  const assets = await prepareAssets(sources);
  return Promise.all(
    list.map(async (v) => {
      const one = async (id) => {
        const s = await createScene(
          assets,
          [{ id: `${v.ns ?? "gohans"}:${id}`, pos: v.pos, properties: v.properties }],
          { lighting: "scene", animate: false },
        );
        place(s.group);
        return s.group;
      };
      const cubes = async (id) => {
        const block = new THREE.Group();
        for (const m of await parseBlockstate(assets, `${v.ns ?? "gohans"}:${id}`, {
          data: v.properties ?? {},
          pos: v.pos,
        }))
          await loadModel(block, assets, await resolveModelData(assets, m), {
            display: {},
            animate: false,
            lighting: "scene",
            mergeElements: false,
          });
        block.position.set(v.pos[0] * 16, v.pos[1] * 16, v.pos[2] * 16);
        const g = new THREE.Group();
        g.add(block);
        place(g);
        g.traverse((o) => {
          if (o.isMesh) o.castShadow = o.receiveShadow = true;
        });
        return g;
      };
      const pivot = v.loose ? new THREE.Group() : null;
      if (pivot) pivot.position.set(...v.loose.pivot);
      const looks = await Promise.all(
        v.options.map(async (o) => {
          const g = await one(o.id);
          if (!pivot) return g;
          const part = await cubes(o.id + v.loose.suffix);
          if (!pivot.parent) {
            part.parent.add(pivot);
            pivot.updateMatrixWorld();
          }
          pivot.attach(part);
          return {
            set visible(b) {
              g.visible = part.visible = b;
            },
          };
        }),
      );
      const box = new THREE.Box3(
        new THREE.Vector3(...v.pos),
        new THREE.Vector3(v.pos[0] + 1, v.pos[1] + 1, v.pos[2] + 1),
      );
      return Object.assign(asVariant({ off: true, ...v }, looks, box, rangesOf(box)), {
        loose: pivot,
      }); // assign, not spread: keeps the getters live
    }),
  );
}

export function asVariant(v, looks, box, ranges) {
  let pick = 0;
  const set = (id) => {
    const off = v.off && id === "off",
      i = off ? -1 : v.options.findIndex((o) => o.id === id);
    if (i < 0 && !off) return;
    pick = i;
    looks.forEach((g, j) => {
      g.visible = j === i;
    });
  };
  set(v.options[0].id);
  return {
    id: v.id,
    title: v.title,
    options: v.options,
    box,
    set,
    get pick() {
      return v.options[pick] ?? { id: "off", title: "off" };
    },
    get ranges() {
      return ranges();
    },
    off: !!v.off,
  };
}
