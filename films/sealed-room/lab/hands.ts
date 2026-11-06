// @ts-nocheck
// Lab: the film's own draw(t) seen from fixed side cameras, to judge hands and arms where the film's cameras hide them:
// renders/hands_<n>_<view>.jpg every 1/LAB_FPS s from LAB_T0 to LAB_T1 (film seconds), views from behind his left and right shoulders
// (the drawer is in front of him, walls close at his sides).
// LAB_T0=91.4 LAB_T1=94.4 LAB_FPS=10 ENTRY=lab/hands.ts bun run render stills
import * as THREE from "three";
import { buildScene } from "../src/scene";
import { canvas, config, done, still } from "live-studio/lab";

(async () => {
  const cfg = await config();
  const t0 = Number(cfg.lab.t0 ?? 84), t1 = Number(cfg.lab.t1 ?? t0 + 2), fps = Number(cfg.lab.fps ?? 10);
  const draw = await buildScene(canvas(), cfg.W, cfg.H, true);
  const { free, bones, objects } = draw.tools;
  const steve = objects.find(([, n]) => n === "Steve")[0];
  const p = new THREE.Vector3(), hd = new THREE.Vector3(), f = new THREE.Vector3(), s = new THREE.Vector3(), r = new THREE.Vector3();
  for (let i = 0, t = t0; t <= t1 + 1e-6; i++, t = t0 + i / fps) {
    free.on = false; draw(t);
    bones.root.getWorldPosition(p);
    bones.head.getWorldPosition(hd); // framed from his head down to his knees, standing or crouched
    f.set(0, 0, 1).applyQuaternion(steve.quaternion); // his forward
    s.set(1, 0, 0).applyQuaternion(steve.quaternion).multiplyScalar(0.8).sub(f).normalize(); // behind his left shoulder
    r.set(-1, 0, 0).applyQuaternion(steve.quaternion).multiplyScalar(0.8).sub(f).normalize();
    for (const [view, dir] of [["left", s], ["right", r]]) {
      free.on = true; free.fov = 50;
      free.p.set(p.x + 1.7 * dir.x, hd.y + 0.5, p.z + 1.7 * dir.z);
      free.l.set(p.x + 0.3 * f.x, hd.y * 0.6, p.z + 0.3 * f.z);
      draw(t);
      await still(`hands_${String(i).padStart(3, "0")}_${view}.jpg`, canvas());
    }
  }
  await done();
})();
