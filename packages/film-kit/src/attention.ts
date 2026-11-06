// Attention through the whole upper body, with no keys: when a character looks at something the eyes get there first,
// then the head, then the chest, then the waist, each a beat later and each taking a smaller share of the turn
// (James Benson, "Animation Bootcamp: Tricks of the Trade", GDC 2018: split the attention into eyes, head, chest, each
// arriving at its own time; the shares follow the usual look-at split, head most, spine least). Small looks stay in the
// head and eyes: only the part of a turn past `dead` degrees reaches the trunk.
//   const chain = attention((t) => aim(t), filmEnd);   pose = addPose(pose, chain(t))   before head IK
// aim(t): the turn the head would need from the pose as it is, {down, yaw (to his left), w (0..1 how much he looks)} in
// degrees, or null when he looks at nothing; head IK on top of the result then takes only what the trunk left. Each part
// follows its share on a critically damped spring (no overshoot) that trails by `lag` seconds; the whole thing is baked
// once (60 samples a second) so any t reads it.
import type { Pose } from "./pose";

const HZ = 60, SUB = 4;
export const CHAIN: Record<string, { share: number; lag: number; max: [number, number] }> = {
  chest: { share: 0.25, lag: 0.15, max: [20, 30] }, // share of the turn, seconds behind, [down, yaw] limits in degrees
  body: { share: 0.1, lag: 0.3, max: [10, 15] },
};
export type Aim = { down: number; yaw: number; w: number } | null;

const past = (a: number, dead: number) => Math.sign(a) * Math.max(0, Math.abs(a) - dead);
const clamp = (x: number, m: number) => Math.max(-m, Math.min(m, x));

export function attention(aimAt: (t: number) => Aim, end: number, { chain = CHAIN, dead = 10, amount = 1 } = {}) {
  const n = Math.ceil(end * HZ) + 2, parts = Object.keys(chain);
  const goal = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const a = aimAt(i / HZ);
    if (a) { goal[i * 2] = a.w * past(a.down, dead); goal[i * 2 + 1] = a.w * past(a.yaw, dead); }
  }
  const dt = 1 / HZ / SUB;
  const out = parts.map((j) => {
    const { share, lag, max } = chain[j], w = 2 / lag, o = new Float32Array(n * 2);
    for (let c = 0; c < 2; c++) {
      const target = (i: number) => clamp(share * goal[Math.min(i, n - 1) * 2 + c], max[c]);
      let y = target(0), v = 0;
      for (let i = 0; i < n; i++) {
        o[i * 2 + c] = y;
        const x0 = target(i), x1 = target(i + 1);
        for (let s = 0; s < SUB; s++) { v += (w * w * (x0 + ((x1 - x0) * s) / SUB - y) - 2 * w * v) * dt; y += v * dt; }
      }
    }
    return o;
  });
  return (t: number): Pose => {
    const x = Math.min(Math.max(t * HZ, 0), n - 1.001), i = Math.floor(x), f = x - i, pose: Pose = {};
    parts.forEach((j, k) => { const o = out[k]; pose[j] = [0, 1].map((c) => amount * (o[i * 2 + c] + (o[(i + 1) * 2 + c] - o[i * 2 + c]) * f)).concat(0); });
    return pose;
  };
}
