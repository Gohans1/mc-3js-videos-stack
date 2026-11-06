// The Cartoon Animation Filter (Wang, Drucker, Agrawala & Cohen, SIGGRAPH 2006): x*(t) = x(t) - A * x''(t) smoothed by a
// Gaussian, i.e. the motion convolved with an inverted Laplacian of Gaussian. Its negative lobes wind each move up the
// other way first (anticipation) and carry it past where it stops (follow-through, exaggeration). One strength knob.
// The authors call it a first cut for non-experts, not a replacement for keyed animation: keep amount low on a realistic
// film. Differences from the paper: sigma is fixed (they adapt it per moment from the dominant frequency of the motion),
// and only the listed joints are filtered (the paper skips only the root's ground-plane translation; legs here are left
// to planted-foot IK).
//   const toon = cartoon((t) => bodyPose(t), filmEnd, { amount: 0.25 });   pose = addPose(bodyPose(t), toon(t))
// amount: A in units of sigma squared (0.25 winds a 0.3 s smoothstep move about 5% back first and carries it ~5% past).
import { canonical, unwrap, type Pose } from "./pose";

const HZ = 60;
export const JOINTS = ["body", "chest", "head", "uaL", "uaR", "laL", "laR"];

export function cartoon(poseAt: (t: number) => Pose, end: number, { amount = 0.25, sigma = 0.12, joints = JOINTS } = {}) {
  const n = Math.ceil(end * HZ) + 2;
  const raw = joints.map(() => new Float32Array(n * 3));
  for (let i = 0; i < n; i++) {
    const p = canonical(poseAt(i / HZ));
    joints.forEach((j, k) => { const a = (p[j] as number[] | undefined) ?? [0, 0, 0]; for (let c = 0; c < 3; c++) raw[k][i * 3 + c] = i ? unwrap(a[c] ?? 0, raw[k][(i - 1) * 3 + c]) : (a[c] ?? 0); });
  }
  // the second derivative of a unit-area Gaussian, sampled; convolving with it is the smoothed acceleration
  const s = sigma * HZ, R = Math.ceil(4 * s), K = new Float64Array(2 * R + 1);
  for (let k = -R; k <= R; k++) K[k + R] = ((k * k) / (s * s) - 1) / (s * s) * Math.exp(-(k * k) / (2 * s * s)) / (Math.sqrt(2 * Math.PI) * s) * HZ * HZ;
  let mean = 0;
  for (const v of K) mean += v;
  mean /= K.length;
  for (let k = 0; k < K.length; k++) K[k] -= mean; // sums to zero, so a held pose gets no offset
  const A = amount * sigma * sigma;
  const off = raw.map((x) => {
    const o = new Float32Array(n * 3);
    for (let c = 0; c < 3; c++) for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let k = -R; k <= R; k++) acc += K[k + R] * x[Math.min(n - 1, Math.max(0, i - k)) * 3 + c];
      o[i * 3 + c] = -A * acc;
    }
    return o;
  });
  return (t: number): Pose => {
    const x = Math.min(Math.max(t * HZ, 0), n - 1.001), i = Math.floor(x), f = x - i, out: Pose = {};
    joints.forEach((j, k) => { const o = off[k]; out[j] = [0, 1, 2].map((c) => o[i * 3 + c] + (o[(i + 1) * 3 + c] - o[i * 3 + c]) * f); });
    return out;
  };
}
