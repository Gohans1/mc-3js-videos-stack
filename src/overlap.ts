// Overlapping action and follow-through with no keys: each upper-body joint chases the pose's own angle on a damped
// spring, so the chest trails the hips by a frame, the head and upper arms by two, the forearms by three, and a part that
// stops swings a little past and settles. The delays are Prokamo's cascade (2-3 frames reads as weight, past 6 as loose);
// a spring rather than a plain delay is Houdini's Secondary Motion (lag plus overshoot). Joints not listed (legs, hips)
// are left alone so planted feet stay planted; hand and head IK go on top of the result, so a hand on a prop stays on it.
// No state between frames: the pose function is run through once (60 samples a second, 4 spring steps each) and the
// result reads the offset (spring minus pose) at any t.
//   const lagOf = overlap((t) => bodyPose(t), filmEnd);   pose = addPose(bodyPose(t), lagOf(t))   (src/pose.ts)
// lag: frames of delay at 30 fps per joint (MCprep player joint names by default); damping 0.6 swings ~10% past a sudden
// stop and less past an eased one; amount scales the whole effect (0 = off).
import { canonical, unwrap, type Pose } from "./pose";

const HZ = 60, SUB = 4;
export const LAG: Record<string, number> = { chest: 1, head: 2, uaL: 2, uaR: 2, laL: 3, laR: 3 };

export function overlap(poseAt: (t: number) => Pose, end: number, { lag = LAG, damping = 0.6, amount = 1 } = {}) {
  const n = Math.ceil(end * HZ) + 2, joints = Object.keys(lag);
  const raw = joints.map(() => new Float32Array(n * 3));
  for (let i = 0; i < n; i++) {
    const p = canonical(poseAt(i / HZ));
    joints.forEach((j, k) => { const a = (p[j] as number[] | undefined) ?? [0, 0, 0]; for (let c = 0; c < 3; c++) raw[k][i * 3 + c] = i ? unwrap(a[c] ?? 0, raw[k][(i - 1) * 3 + c]) : (a[c] ?? 0); });
  }
  const dt = 1 / HZ / SUB;
  const off = joints.map((j, k) => {
    // a damped spring lags a moving target by 2 * damping / omega
    const w = (2 * damping) / (lag[j] / 30), x = raw[k], o = new Float32Array(n * 3);
    for (let c = 0; c < 3; c++) {
      let y = x[c], v = 0;
      for (let i = 0; i < n; i++) {
        const x0 = x[i * 3 + c], x1 = x[Math.min(i + 1, n - 1) * 3 + c];
        o[i * 3 + c] = y - x0;
        for (let s = 0; s < SUB; s++) {
          v += (w * w * (x0 + ((x1 - x0) * s) / SUB - y) - 2 * damping * w * v) * dt;
          y += v * dt;
        }
      }
    }
    return o;
  });
  return (t: number): Pose => {
    const x = Math.min(Math.max(t * HZ, 0), n - 1.001), i = Math.floor(x), f = x - i, out: Pose = {};
    joints.forEach((j, k) => { const o = off[k]; out[j] = [0, 1, 2].map((c) => amount * (o[i * 3 + c] + (o[(i + 1) * 3 + c] - o[i * 3 + c]) * f)); });
    return out;
  };
}
