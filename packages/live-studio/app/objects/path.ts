import type { Placed } from "film/scene";
// The selected object's motion path over the picture, as After Effects and Blender draw one: a line through where it goes, a dot
// per frame (dots close together: slow, far apart: fast, so an ease shows) and a bigger square at each key. Built from the
// film's own poseAt (tools.placed.pathOf), again only when the object or its keys change; drawn with the selection box
// (placed.ts drawGizmo), over the film.
import * as THREE from "three";

const ORANGE = 0xec8b49; // the selection box's and the playhead's
const over = { depthTest: false, depthWrite: false, transparent: true };
const line = new THREE.Line(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: ORANGE, opacity: 0.55, ...over }),
);
const frames = new THREE.Points(
  new THREE.BufferGeometry(),
  new THREE.PointsMaterial({ color: ORANGE, size: 3, sizeAttenuation: false, ...over }),
);
const keys = new THREE.Points(
  new THREE.BufferGeometry(),
  new THREE.PointsMaterial({ color: 0xfffcf0, size: 7, sizeAttenuation: false, ...over }),
);
export const path = new THREE.Group();
path.add(line, frames, keys);
path.renderOrder = -1; // under the box and the gizmo
path.visible = false;

let built = "";
// what: the object's name and the version of its keys; none hides the path
export const showPath = (p: Placed | null, name: string | null, rev: number) => {
  const id = name && p ? `${name}|${rev}` : "";
  if (id === built) return;
  built = id;
  const got = name && p ? p.pathOf(name) : { frames: [], keys: [] };
  // A path that never moves (one key, or every key in one place) is not drawn
  const moves = got.frames.some((v) => v.distanceToSquared(got.frames[0]) > 1e-6);
  path.visible = moves;
  if (!moves) return;
  for (const [o, pts] of [
    [line, got.frames],
    [frames, got.frames],
    [keys, got.keys],
  ] as const) {
    o.geometry.dispose();
    o.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  }
};
