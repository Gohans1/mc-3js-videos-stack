import type { Pose } from "./pose";

const HZ = 60,
  G = 9.81,
  D = Math.PI / 180;
export const LEAN = { strength: 0.5, max: 8, smooth: 0.25, share: { body: 0.65, chest: 0.35 } };

export type Place = { x: number; z: number; yaw: number };

export function lean(
  path: (t: number) => Place,
  end: number,
  { strength = LEAN.strength, max = LEAN.max, smooth = LEAN.smooth, share = LEAN.share } = {},
) {
  const n = Math.ceil(end * HZ) + 3,
    P = Array.from({ length: n }, (_, i) => path(i / HZ));
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
  const out = (t: number): Pose => {
    const f = at(t, 0),
      l = at(t, 1),
      pose: Pose = {};
    for (const [j, k] of Object.entries(share)) pose[j] = [k * f, 0, -k * l];
    return pose;
  };
  return Object.assign(out, { forward: (t: number) => at(t, 0), left: (t: number) => at(t, 1) });
}
