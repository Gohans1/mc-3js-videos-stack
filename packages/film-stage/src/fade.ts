// @ts-nocheck
// Fades to and from black: a film's key row [{t, black, ease?}] (0 the picture, 1 all black; the studio's Fade buttons write
// it), drawn over everything else the film draws, so the studio, the drafts and the final video all show it. Like an editor's
// opacity keyframes: between two keys the later key's ease (camera.ts EASES, or a cubic-bezier) shapes the change, and outside
// the keys the nearest one's level holds. How long reads as what: docs/film-grammar.md (Fade đen).
import * as THREE from "three";
import { easeOf } from "./camera";

export const blackAt = (keys, t) => {
  if (!keys?.length) return 0;
  if (t <= keys[0].t) return keys[0].black;
  for (let i = 1; i < keys.length; i++) if (t < keys[i].t) {
    const a = keys[i - 1], b = keys[i];
    return a.black + (b.black - a.black) * easeOf(b.ease)((t - a.t) / (b.t - a.t));
  }
  return keys[keys.length - 1].black;
};

// One black quad over the whole frame at the level asked; call it last in the film's draw
export function makeFade(renderer) {
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  const mat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  scene.add(quad);
  return (level) => {
    if (!(level > 0)) return;
    mat.opacity = Math.min(level, 1);
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(scene, camera);
    renderer.autoClear = auto;
  };
}
