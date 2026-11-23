import type { Pose } from "./pose";

export const WINTER = {
  head: 0.081,
  trunk: 0.497,
  upperArm: 0.028,
  forearmHand: 0.022,
  thigh: 0.1,
  legFoot: 0.061,
};
export const BALANCE = { carry: 0.678, tau: 0.15, max: 0.12 };

const HZ = 60;

export function balance(
  comAt: (t: number) => [number, number],
  end: number,
  { standing = (_t: number): number => 1, tau = BALANCE.tau, max = BALANCE.max } = {},
) {
  const n = Math.ceil(end * HZ) + 2,
    x = new Float32Array(n),
    z = new Float32Array(n);
  const clamp = (v: number) => Math.max(-max, Math.min(max, v));
  let px = 0,
    pz = 0,
    vx = 0,
    vz = 0;
  const w = 1 / tau;
  for (let i = 0; i < n; i++) {
    const t = i / HZ,
      s = Math.min(1, Math.max(0, standing(t))),
      [cx, cz] = comAt(t);
    const gx = clamp((-cx / BALANCE.carry) * s),
      gz = clamp((-cz / BALANCE.carry) * s);
    if (i === 0) {
      px = gx;
      pz = gz;
    }
    for (let k = 0; k < 4; k++) {
      const h = 1 / HZ / 4;
      vx += (w * w * (gx - px) - 2 * w * vx) * h;
      px += vx * h;
      vz += (w * w * (gz - pz) - 2 * w * vz) * h;
      pz += vz * h;
    }
    x[i] = px;
    z[i] = pz;
  }
  const read = (a: Float32Array, t: number) => {
    const u = Math.min(Math.max(t * HZ, 0), n - 1.001),
      i = Math.floor(u);
    return a[i] + (a[i + 1] - a[i]) * (u - i);
  };
  return (t: number): Pose => ({ root: { x: read(x, t), z: read(z, t) } });
}
