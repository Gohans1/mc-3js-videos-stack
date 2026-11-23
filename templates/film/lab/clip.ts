// @ts-nocheck
import { canvas, config, done, log, still } from "live-studio/lab";
import { loadSource } from "mc-actor/clips";
import * as THREE from "three";

import { EDIT } from "../src/edit";
import { buildScene } from "../src/scene";

(async () => {
  const cfg = await config();
  const ref = cfg.lab.clip ?? "mixamo/Kneeling_Idle_c9cd9c47";
  const [x, z] = (cfg.lab.at ?? "3,3").split(",").map(Number);
  const { duration } = (await loadSource(ref)).clip;
  const t0 = Number(cfg.lab.t0 ?? 0),
    a = t0 + 1.5,
    b = a + Math.max(duration, 2),
    blend = 0.5,
    at = [x, 0, z];
  const after = { t: b + blend, at: [...at], yaw: 0, pose: "stand", do: "stands again" };
  EDIT.steve.moves = [
    { t: 0, at, yaw: 0, pose: "stand", do: "stands" },
    { t: a - 0.5, at, yaw: 0, pose: "stand", do: "stands" },
    { t: a, at, yaw: 0, clip: ref, blend, do: `plays ${ref}` },
    after,
  ];
  EDIT.steve.hands = [];
  EDIT.steve.look = [];
  const draw = await buildScene(canvas(), cfg.W, cfg.H, true);
  const { end } = draw.tools.clips[ref];
  after.at = [x + end.x, 0, z + end.z];
  after.yaw = end.ry;
  await log(
    `${ref}: ${duration.toFixed(2)} s, played ${a}-${b.toFixed(2)} s; leaves him ${end.x.toFixed(3)} m left, ${end.z.toFixed(3)} m ahead, turned ${end.ry.toFixed(1)} deg`,
  );
  const { free, bones } = draw.tools;
  const fps = Number(cfg.lab.fps ?? 4),
    p = new THREE.Vector3();
  for (let i = 0, t = t0 + 0.5; t <= b + blend + 0.5; i++, t = t0 + 0.5 + i / fps) {
    for (const [view, dir] of [
      ["front", [0, 0, 1]],
      ["left", [1, 0, 0]],
    ]) {
      free.on = false;
      draw(t);
      bones.root.getWorldPosition(p);
      free.on = true;
      free.fov = 45;
      free.p.set(p.x + 2.3 * dir[0], 1.0, p.z + 2.3 * dir[2]);
      free.l.set(p.x, 0.75, p.z);
      draw(t);
      await still(`clip_${String(i).padStart(3, "0")}_${view}.jpg`, canvas());
    }
  }
  await done();
})();
