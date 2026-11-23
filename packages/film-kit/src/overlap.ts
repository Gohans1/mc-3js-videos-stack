import { canonical, type Pose, unwrap } from "./pose";

const HZ = 60,
  SUB = 4;
export const LAG: Record<string, number> = { chest: 1, head: 2, uaL: 2, uaR: 2, laL: 3, laR: 3 };

export function overlap(
  poseAt: (t: number) => Pose,
  end: number,
  { lag = LAG, damping = 0.6, amount = 1 } = {},
) {
  const n = Math.ceil(end * HZ) + 2,
    joints = Object.keys(lag);
  const raw = joints.map(() => new Float32Array(n * 3));
  for (let i = 0; i < n; i++) {
    const p = canonical(poseAt(i / HZ));
    joints.forEach((j, k) => {
      const a = (p[j] as number[] | undefined) ?? [0, 0, 0];
      for (let c = 0; c < 3; c++)
        raw[k][i * 3 + c] = i ? unwrap(a[c] ?? 0, raw[k][(i - 1) * 3 + c]) : (a[c] ?? 0);
    });
  }
  const dt = 1 / HZ / SUB;
  const off = joints.map((j, k) => {
    const w = (2 * damping) / (lag[j] / 30),
      x = raw[k],
      o = new Float32Array(n * 3);
    for (let c = 0; c < 3; c++) {
      let y = x[c],
        v = 0;
      for (let i = 0; i < n; i++) {
        const x0 = x[i * 3 + c],
          x1 = x[Math.min(i + 1, n - 1) * 3 + c];
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
    const x = Math.min(Math.max(t * HZ, 0), n - 1.001),
      i = Math.floor(x),
      f = x - i,
      out: Pose = {};
    joints.forEach((j, k) => {
      const o = off[k];
      out[j] = [0, 1, 2].map(
        (c) => amount * (o[i * 3 + c] + (o[(i + 1) * 3 + c] - o[i * 3 + c]) * f),
      );
    });
    return out;
  };
}
