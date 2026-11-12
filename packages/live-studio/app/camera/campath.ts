// What the film's camera does, seen from the free camera (F), as Theatre.js's reference window and Unreal's camera actor show
// it: the film camera at the playhead as a small frustum, its path through the shot as a line through its keys (the same
// centripetal Catmull-Rom film-stage/camera.ts flies) with a dot per key, and the other shots' paths dimmer. Drawn over the picture, through walls.
// Keys anchored to an object ({"eye": [...]}) have no fixed point, so a shot made of them shows no path, only the frustum.
import * as THREE from "three";

import { S } from "../core/state";
import { get } from "../core/store";
import { filmCam } from "../picture/filmcam";
import { keys } from "./cam";

const overlay = new THREE.Scene();
const ghost = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 0.7);
const frustum = new THREE.CameraHelper(ghost);
frustum.setColors(
  new THREE.Color(0xec8b49),
  new THREE.Color(0xec8b49),
  new THREE.Color(0xffffff),
  new THREE.Color(0xec8b49),
  new THREE.Color(0xec8b49),
);
overlay.add(frustum);
const paths = new THREE.Group();
overlay.add(paths);
const NOW = new THREE.LineBasicMaterial({ color: 0xec8b49, depthTest: false });
const OTHER = new THREE.LineBasicMaterial({
  color: 0x8a8a8a,
  transparent: true,
  opacity: 0.45,
  depthTest: false,
});
const DOTS = new THREE.PointsMaterial({
  color: 0xffffff,
  size: 6,
  sizeAttenuation: false,
  depthTest: false,
});

let builtFor: unknown = null,
  posedRev = -1;
const isPoint = (p: unknown): p is [number, number, number] => Array.isArray(p) && p.length === 3;
const build = () => {
  for (const c of paths.children) (c as THREE.Line).geometry.dispose();
  paths.clear();
  let seg: THREE.Vector3[] = [],
    segStart = 0;
  const shotOfNow = (t0: number, t1: number) => S.t >= t0 - 1e-3 && S.t < t1;
  const flush = (t1: number) => {
    if (seg.length >= 2) {
      const pts = new THREE.CatmullRomCurve3(seg, false, "centripetal").getPoints(seg.length * 24);
      const now = shotOfNow(segStart, t1);
      paths.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), now ? NOW : OTHER));
      if (now) paths.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(seg), DOTS));
    }
    seg = [];
  };
  keys.forEach((k, i) => {
    if (k.cut && i > 0) {
      flush(k.t);
      segStart = k.t;
    }
    if (isPoint(k.p)) seg.push(new THREE.Vector3(...k.p));
  });
  flush(Infinity);
};

// After the film draws the free camera's view: the film camera where filmcam.ts last drew it, then the paths and the frustum on top
export const drawCamPath = () => {
  const tools = S.tools,
    f = tools?.free,
    r = (tools as { renderer?: THREE.WebGLRenderer } | null)?.renderer;
  if (!tools || !f?.on || !r || !get().free || !keys.length) return;
  if (filmCam.rev !== posedRev) {
    posedRev = filmCam.rev;
    ghost.position.copy(filmCam.position);
    ghost.quaternion.copy(filmCam.quaternion);
    ghost.fov = filmCam.fov;
    ghost.aspect = filmCam.aspect;
    ghost.updateProjectionMatrix();
    ghost.updateMatrixWorld();
    frustum.update();
  }
  if (builtFor !== `${get().camRev}|${shotNow()}`) {
    builtFor = `${get().camRev}|${shotNow()}`;
    build();
  }
  // Seen from where it stands (the free camera starts there) its lines would only cross the picture
  frustum.visible = tools.camera.position.distanceTo(ghost.position) > 0.3;
  const auto = r.autoClear;
  r.autoClear = false;
  r.clearDepth();
  r.render(overlay, tools.camera);
  r.autoClear = auto;
};
const shotNow = () => keys.reduce((n, k, i) => (k.cut && i > 0 && k.t <= S.t ? n + 1 : n), 0);
