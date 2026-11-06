// @ts-nocheck
// Lab: one still per clip for checking the catalogue by eye: 8 moments of the clip on Steve (baked as the film does,
// mc-actor/clips), spread evenly from its first to its last frame, each from his front-left at 3/4 over a floor grid (1 m
// squares), framed on his body, so posture, floor contact and hands read at a glance. renders/sheet_<lib>__<clip>.jpg;
// clip-catalog/catalog_review.py captions them with their tags and stacks them into review pages. Many clips per run (one build):
// clip-catalog/catalog_review.sh.
// ENTRY=../../packages/clip-catalog/catalog_sheet.ts LAB_LIB=mixamo LAB_CLIPS=a,b,c bun run render stills
import * as THREE from "three";
import { unzipSync } from "fflate";
import { canvas, config, done, log, still } from "live-studio/lab";
import { loadRig, makePlayer } from "mc-actor/player";
import { loadClip } from "mc-actor/clips";

(async () => {
  const cfg = await config();
  const c = canvas(), W = cfg.W, H = cfg.H;
  const renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  renderer.setScissorTest(true);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1d2024);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 1.8));
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(2, 4, 3);
  scene.add(sun);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x3a3f45 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor, new THREE.GridHelper(40, 40, 0x8899aa, 0x667788));

  const jar = new Uint8Array(await (await fetch("mc/client_assets.zip")).arrayBuffer());
  const SKIN = "assets/minecraft/textures/entity/player/wide/steve.png";
  const skin = URL.createObjectURL(new Blob([unzipSync(jar, { filter: (f) => f.name === SKIN })[SKIN]], { type: "image/png" }));
  const steve = await makePlayer(await loadRig("rig/player.glb"), skin, { glow: 0.03 });
  scene.add(steve.g);
  steve.setPose({});
  steve.g.updateMatrixWorld(true);
  const rootRest = steve.bones.root.getWorldQuaternion(new THREE.Quaternion()).invert();

  const lib = cfg.lab.lib ?? "mixamo", pw = W / 4, ph = H / 2;
  const cam = new THREE.PerspectiveCamera(32, pw / ph, 0.05, 60);
  const box = new THREE.Box3(), DEG = Math.PI / 180, fwd = new THREE.Vector3(), q = new THREE.Quaternion();
  for (const name of cfg.lab.clips.split(",")) {
    try {
      const clip = await loadClip(`${lib}/${name}`, steve, 30);
      const n = clip.frames.length;
      for (let k = 0; k < 8; k++) {
        steve.setPose(clip.frames[Math.round((k * (n - 1)) / 7)]);
        steve.g.updateMatrixWorld(true);
        // from his front-left at 3/4, wherever he faces now (a turn would otherwise show his back)
        fwd.set(0, 0, 1).applyQuaternion(q.copy(steve.bones.root.getWorldQuaternion(q)).multiply(rootRest)).setY(0);
        if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, 1);
        fwd.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
        // framed on his body, the floor under it kept in view: a pose low on the floor fills the panel like a standing one.
        // Box3 reuses a skinned mesh's first boundingBox forever, so it is recomputed for every pose (else a walk leaves frame)
        steve.g.traverse((o) => o.isSkinnedMesh && o.computeBoundingBox());
        box.setFromObject(steve.g);
        box.min.y = Math.min(box.min.y, 0);
        const look = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).length();
        cam.position.copy(look).addScaledVector(fwd, (0.5 * size) / Math.tan((cam.fov / 2) * DEG)).add(new THREE.Vector3(0, 0.25 * size, 0));
        cam.lookAt(look);
        const x = (k % 4) * pw, y = (1 - Math.floor(k / 4)) * ph;
        renderer.setViewport(x, y, pw, ph);
        renderer.setScissor(x, y, pw, ph);
        renderer.render(scene, cam);
      }
      await still(`sheet_${lib}__${name}.jpg`, c);
    } catch (e) {
      await log(`SHEET FAIL ${lib}/${name}: ${e.message ?? e}`);
    }
  }
  await done();
})();
