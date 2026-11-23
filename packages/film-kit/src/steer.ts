export const STEER = {
  lead: 0.4,
  ahead: 1.5,
  drop: 20,
  headDrop: 5,
  eye: 1.5,
  walk: [0.2, 0.7],
  near: 1,
};

const smooth = (x: number) => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * (3 - 2 * u);
};
const tan = (deg: number) => Math.tan((deg * Math.PI) / 180);

export function steer(
  path: (t: number) => { x: number; z: number; speed: number },
  opts: Partial<typeof STEER> = {},
) {
  const o = { ...STEER, ...opts };
  return (
    t: number,
  ): { at: [number, number, number]; head: [number, number, number]; w: number } | null => {
    const p = path(t),
      w = smooth((p.speed - o.walk[0]) / (o.walk[1] - o.walk[0]));
    if (w <= 0) return null;
    const q = path(t + 2 * o.lead),
      dx = q.x - p.x,
      dz = q.z - p.z,
      d = Math.hypot(dx, dz);
    if (d < 1e-4) return null;
    const far = Math.max(o.near, p.speed * o.ahead),
      x = p.x + (dx / d) * far,
      z = p.z + (dz / d) * far;
    return {
      at: [x, o.eye - far * tan(o.drop), z],
      head: [x, o.eye - far * tan(o.headDrop), z],
      w,
    };
  };
}
