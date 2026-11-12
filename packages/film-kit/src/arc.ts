// Hands that travel on arcs: a body moves by turning joints, so a hand swings round its shoulder; a hand target blended
// in a straight line (what keying an IK hand gives) slides like a machine (the "Arcs" principle of Thomas & Johnston's
// twelve; animators fix it with breakdown keys, Animlog / Inspired 3D). Here the in-between is taken round the pivot
// instead: the direction from the pivot turns at an even rate (slerp) while the distance changes linearly, which is the
// path a two-bone arm swinging from the shoulder takes. Same keys, same timing, only the path changes.
//   handTarget = arc(shoulder, keyA, keyB, k)   (k: the blend's own 0..1 progress, eased as before)
// Points are [x, y, z] in any one frame. A move straight away from or through the pivot keeps the straight line; a move
// to the opposite side swings through `bend` (the side to pass, e.g. the character's forward).
type V = number[];
const sub = (a: V, b: V) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a: V) => Math.sqrt(dot(a, a));
const scale = (a: V, k: number) => a.map((x) => x * k);

export function arc(pivot: V, a: V, b: V, k: number, { bend = [0, 0, 1] as V } = {}): V {
  const da = sub(a, pivot),
    db = sub(b, pivot),
    ra = len(da),
    rb = len(db);
  const lerp = () => a.map((x, i) => x + (b[i] - x) * k);
  if (ra < 1e-6 || rb < 1e-6) return lerp();
  const u = scale(da, 1 / ra),
    v = scale(db, 1 / rb);
  const angle = Math.acos(Math.max(-1, Math.min(1, dot(u, v))));
  if (angle < 1e-4) return lerp();
  let axis = cross(u, v);
  if (len(axis) < 1e-6) {
    axis = cross(u, bend);
    if (len(axis) < 1e-6) return lerp();
  }
  axis = scale(axis, 1 / len(axis));
  // Rodrigues: u turned by k * angle about the axis
  const th = k * angle,
    c = Math.cos(th),
    s = Math.sin(th),
    ax = cross(axis, u),
    d = dot(axis, u);
  const dir = [0, 1, 2].map((i) => u[i] * c + ax[i] * s + axis[i] * d * (1 - c));
  const r = ra + (rb - ra) * k;
  return [0, 1, 2].map((i) => pivot[i] + dir[i] * r);
}
