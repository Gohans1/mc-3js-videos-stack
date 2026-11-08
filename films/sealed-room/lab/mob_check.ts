// @ts-nocheck
// Lab: mc-actor/mob.ts on its own. Logs whether every box faces outward (inward faces light from behind: a dark mob),
// then walks each mob 3 m in 2 s past a side camera: renders/mob_<name>_<n>.jpg, legs should swing with the ground covered.
// ENTRY=lab/mob_check.ts LAB_MOBS=cow,zombie bun run render stills
import * as THREE from "three";
import { loadMob } from "mc-actor/mob";
import { canvas, config, done, log, still } from "live-studio/lab";

(async () => {
  const cfg = await config();
  const c = canvas();
  const renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(cfg.W, cfg.H, false);
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x30343a);
  scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x404040, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(1, 3, 2);
  sun.castShadow = true;
  sun.shadow.normalBias = 0.01;
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4 });
  scene.add(sun);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshLambertMaterial({ color: 0x7a7a7a }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const camera = new THREE.PerspectiveCamera(35, cfg.W / cfg.H, 0.05, 50);
  camera.position.set(0, 1.0, 5);
  camera.lookAt(0, 0.7, 0);

  for (const name of (cfg.lab.mobs ?? "cow,zombie").split(",")) {
    const m = await loadMob(name);
    scene.add(m.g);
    m.g.updateMatrixWorld(true);
    let out = 0, inward = 0;
    m.g.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position, nor = o.geometry.attributes.normal;
      const nm = new THREE.Matrix3().getNormalMatrix(o.matrixWorld), mid = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) mid.add(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
      mid.divideScalar(pos.count);
      for (let f = 0; f < pos.count; f += 4) {
        const fc = new THREE.Vector3();
        for (let k = 0; k < 4; k++) fc.add(new THREE.Vector3().fromBufferAttribute(pos, f + k).applyMatrix4(o.matrixWorld));
        if (new THREE.Vector3().fromBufferAttribute(nor, f).applyMatrix3(nm).dot(fc.divideScalar(4).sub(mid)) >= 0) out++; else inward++;
      }
    });
    log(`${name}: clips ${m.clips.join(", ") || "none"}; ${out} faces out, ${inward} inward`);
    const keys = { path: [{ t: 0, at: [-1.5, 0, 0] }, { t: 2, at: [1.5, 0, 0] }] };
    for (let n = 0; n < 8; n++) {
      m.draw(keys, 0.6 + n * 0.1);
      renderer.render(scene, camera);
      await still(`mob_${name}_${n}.jpg`, c);
    }
    scene.remove(m.g);
  }
  await done();
})();
