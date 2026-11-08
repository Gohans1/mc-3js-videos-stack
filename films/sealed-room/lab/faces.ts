// @ts-nocheck
// Lab: every face (mc-actor FACES, the studio's "Steve's face" chip) at the film's moments LAB_AT (film seconds, comma
// separated), each seen from the shot's own camera and from a close camera before his face:
// renders/face_<face>_<moment>_<shot|close>.jpg
// LAB_AT=30,76.8,85.3 ENTRY=lab/faces.ts bun run render stills
import * as THREE from "three";
import { buildScene } from "../src/scene";
import { canvas, config, done, still } from "live-studio/lab";

(async () => {
  const cfg = await config();
  const at = String(cfg.lab.at ?? "30,76.8,85.3").split(",").map(Number);
  const draw = await buildScene(canvas(), cfg.W, cfg.H, true);
  const { free, bones, objects } = draw.tools;
  const steve = objects.find(([, n]) => n === "Steve")[0];
  const face = draw.variants.find((v) => v.id === "face");
  const hd = new THREE.Vector3(), f = new THREE.Vector3(), q = new THREE.Quaternion();
  for (const o of face.options) {
    face.set(o.id);
    for (const [i, t] of at.entries()) {
      free.on = false; draw(t);
      await still(`face_${o.id}_${i}_shot.jpg`, canvas());
      bones.head.getWorldPosition(hd);
      f.set(0, 0, 1).applyQuaternion(bones.head.getWorldQuaternion(q)); // the head's forward, however he leans
      f.y = Math.max(f.y, -0.3); f.normalize();
      free.on = true; free.fov = 40;
      free.p.copy(hd).addScaledVector(f, 1.1).add(new THREE.Vector3(0, 0.12, 0));
      free.l.copy(hd).add(new THREE.Vector3(0, 0.12, 0));
      draw(t);
      await still(`face_${o.id}_${i}_close.jpg`, canvas());
    }
  }
  await done();
})();
