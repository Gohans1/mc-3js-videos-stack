// Leaning into acceleration, with no keys: a body that speeds up tips forward, one that brakes tips back and one that
// curves tips into the turn, so its weight stays over its feet (David Rosen, "An Indie Approach to Procedural
// Animation", GDC 2014: "tilt into acceleration"). The full physical angle is atan(a / g); characters read best at a
// fraction of it (0.3-0.7, the Vulkan glTF tutorial's "Physics-Driven Procedural Lean"), smoothed and capped.
//   const tilt = lean((t) => ({ x, z, yaw }), filmEnd);   pose = addPose(pose, tilt(t))
// path(t): where the character stands on the floor (world metres) and which way it faces (degrees, three.js rotation.y:
// 0 faces +z). The path is sampled once (60 a second), its acceleration taken by finite differences, turned into the
// character's own axes and smoothed (a critically damped follower `smooth` seconds behind, so a walk's footfalls don't
// shake it). The tilt goes on the waist and chest, more low than high, as the lean starts at the hips.
import type { Pose } from "./pose";

const HZ = 60,
  G = 9.81,
  D = Math.PI / 180;
export const LEAN = { strength: 0.5, max: 8, smooth: 0.25, share: { body: 0.65, chest: 0.35 } }; // fraction of atan(a/g), degrees, seconds

export type Place = { x: number; z: number; yaw: number };

export function lean(
  path: (t: number) => Place,
  end: number,
  { strength = LEAN.strength, max = LEAN.max, smooth = LEAN.smooth, share = LEAN.share } = {},
) {
  const n = Math.ceil(end * HZ) + 3,
    P = Array.from({ length: n }, (_, i) => path(i / HZ));
  // acceleration in the character's axes: forward (its +z) and to its left (its +x)
  const acc = new Float32Array(n * 2);
  for (let i = 1; i < n - 1; i++) {
    const ax = (P[i + 1].x - 2 * P[i].x + P[i - 1].x) * HZ * HZ,
      az = (P[i + 1].z - 2 * P[i].z + P[i - 1].z) * HZ * HZ;
    const s = Math.sin(P[i].yaw * D),
      c = Math.cos(P[i].yaw * D);
    acc[i * 2] = ax * s + az * c;
    acc[i * 2 + 1] = ax * c - az * s;
  }
  const tilt = new Float32Array(n * 2),
    w = 2 / smooth,
    dt = 1 / HZ / 4;
  for (let k = 0; k < 2; k++) {
    let y = 0,
      v = 0;
    for (let i = 0; i < n; i++) {
      const goal = Math.max(-max, Math.min(max, (strength * Math.atan2(acc[i * 2 + k], G)) / D));
      for (let s = 0; s < 4; s++) {
        v += (w * w * (goal - y) - 2 * w * v) * dt;
        y += v * dt;
      }
      tilt[i * 2 + k] = y;
    }
  }
  const at = (t: number, k: number) => {
    const x = Math.min(Math.max(t * HZ, 0), n - 1.001),
      i = Math.floor(x);
    return tilt[i * 2 + k] + (tilt[(i + 1) * 2 + k] - tilt[i * 2 + k]) * (x - i);
  };
  // forward is +x on a joint; toward his left is -z (a +z turn tips the top to his right)
  const out = (t: number): Pose => {
    const f = at(t, 0),
      l = at(t, 1),
      pose: Pose = {};
    for (const [j, k] of Object.entries(share)) pose[j] = [k * f, 0, -k * l];
    return pose;
  };
  return Object.assign(out, { forward: (t: number) => at(t, 0), left: (t: number) => at(t, 1) });
}
