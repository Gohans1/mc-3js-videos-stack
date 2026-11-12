// Where a walker looks when nothing else holds his eyes: at the path. The head turns into a bend before the body does
// (eyes first, then the head ~0.2-0.6 s ahead of the trunk, starting ~1.1 m before the corner whatever its angle:
// Grasso et al. 1998, Courtine & Schieppati 2003, Sreenivasa et al. 2008), and the gaze drops to the ground he will reach
// in about 1.5 s (on flat ground about half the time, Matthis, Yates & Hayhoe 2018). On smooth level ground the eyes do
// that drop and the head stays near level, ~5 deg down (Thomas et al. 2020); a head pitched the whole way reads as sad.
//   const ahead = steer(path);   head look = keyedLook(t) ?? ahead(t).head;   eyes aim at ahead(t).at
// path(t): { x, z, speed } in the world (metres, m/s). Both points are `ahead` seconds of walking away, in the direction he
// will be heading `lead` seconds from now: `at` `drop` degrees below his eyes, `head` `headDrop`; w fades them in as he
// speeds up from a standstill.
export const STEER = {
  lead: 0.4,
  ahead: 1.5,
  drop: 20,
  headDrop: 5,
  eye: 1.5,
  walk: [0.2, 0.7],
  near: 1,
}; // s, s, deg, deg, m, m/s, m

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
    // the chord to where he will be in 2*lead seconds runs along his heading at about t + lead
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
