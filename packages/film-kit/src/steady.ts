import { canonical, type Pose, unwrap } from "./pose";

const HZ = 60;
export const STEADY = { pitch: 0.6, roll: 0.4, hold: 0.5, tau: 0.3 };

export function steady(
  poseAt: (t: number) => Pose,
  end: number,
  {
    chain = ["body", "chest"],
    pitch = STEADY.pitch,
    roll = STEADY.roll,
    hold = STEADY.hold,
    tau = STEADY.tau,
  } = {},
) {
  const n = Math.ceil(end * HZ) + 2,
    tilt = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const p = canonical(poseAt(i / HZ));
    let x = p.root?.rx ?? 0,
      z = p.root?.rz ?? 0;
    for (const j of chain) {
      const a = p[j] as number[] | undefined;
      x += a?.[0] ?? 0;
      z += a?.[2] ?? 0;
    }
    tilt[i * 2] = i ? unwrap(x, tilt[(i - 1) * 2]) : x;
    tilt[i * 2 + 1] = i ? unwrap(z, tilt[(i - 1) * 2 + 1]) : z;
  }
  const out = new Float32Array(n * 2),
    w = 2 / tau,
    dt = 1 / HZ;
  for (let c = 0; c < 2; c++) {
    let y = tilt[c],
      v = 0;
    for (let i = 0; i < n; i++) {
      const x = tilt[i * 2 + c],
        fast = x - y;
      out[i * 2 + c] = c === 0 ? -pitch * fast : -(roll * fast + hold * x);
      for (let s = 0; s < 4; s++) {
        v += (w * w * (x - y) - 2 * w * v) * (dt / 4);
        y += v * (dt / 4);
      }
    }
  }
  return (t: number): Pose => {
    const x = Math.min(Math.max(t * HZ, 0), n - 1.001),
      i = Math.floor(x),
      f = x - i;
    const at = (c: number) => out[i * 2 + c] + (out[(i + 1) * 2 + c] - out[i * 2 + c]) * f;
    return { head: [at(0), 0, at(1)] };
  };
}
