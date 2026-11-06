// @ts-nocheck
// Lab: a mocap clip played in the film itself (bodyAt, feet.ts foot lock, legTo, the set's light): standing, half a
// second's blend into the clip, the clip (held 2 s at least), its crossfade into standing where it left him, seen from
// his front and his left: renders/clip_<n>_<front|left>.jpg (python ../../packages/clip-catalog/sheet_clip.py: contact sheets). Logs where the
// clip leaves him, for the next key's at and yaw.
// LAB_CLIP=mixamo/Kneeling_Idle_c9cd9c47 ENTRY=lab/clip.ts bun run render stills  (LAB_AT=x,z floor spot, LAB_FPS=4,
// LAB_T0=film second it starts at: the set's light is the film's at that time)
import * as THREE from "three";
import { EDIT } from "../src/edit";
import { buildScene } from "../src/scene";
import { loadSource } from "mc-actor/clips";
import { canvas, config, done, log, still } from "live-studio/lab";

(async () => {
  const cfg = await config();
  const ref = cfg.lab.clip ?? "mixamo/Kneeling_Idle_c9cd9c47";
  const [x, z] = (cfg.lab.at ?? "3,3").split(",").map(Number);
  const { duration } = (await loadSource(ref)).clip; // its length, for the keys; the film loads and bakes it itself
  const t0 = Number(cfg.lab.t0 ?? 0), a = t0 + 1.5, b = a + Math.max(duration, 2), blend = 0.5, at = [x, 0, z];
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
  // the next key where the clip leaves him (his frame turned by the key's yaw, 0 here), set before the first draw bakes the feet
  const { end } = draw.tools.clips[ref];
  after.at = [x + end.x, 0, z + end.z];
  after.yaw = end.ry;
  await log(`${ref}: ${duration.toFixed(2)} s, played ${a}-${b.toFixed(2)} s; leaves him ${end.x.toFixed(3)} m left, ${end.z.toFixed(3)} m ahead, turned ${end.ry.toFixed(1)} deg`);
  const { free, bones } = draw.tools;
  const fps = Number(cfg.lab.fps ?? 4), p = new THREE.Vector3();
  for (let i = 0, t = t0 + 0.5; t <= b + blend + 0.5; i++, t = t0 + 0.5 + i / fps) {
    for (const [view, dir] of [["front", [0, 0, 1]], ["left", [1, 0, 0]]]) {
      free.on = false; draw(t);
      bones.root.getWorldPosition(p);
      free.on = true; free.fov = 45;
      free.p.set(p.x + 2.3 * dir[0], 1.0, p.z + 2.3 * dir[2]);
      free.l.set(p.x, 0.75, p.z);
      draw(t);
      await still(`clip_${String(i).padStart(3, "0")}_${view}.jpg`, canvas());
    }
  }
  await done();
})();
