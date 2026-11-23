export const DROWSY = {
  down: 0.3,
  up: 1,
  shut: 0.1,
  long: 0.25,
  longShut: [0.5, 1.2],
  partial: 0.3,
  depth: [0.55, 0.85],
  droop: 0.35,
  slow: 0.6,
  wake: 1.5,
  sink: 3,
};

export type BlinkShape = { down: number; shut: number; up: number; depth: number };
export function drowsyBlink(
  base: { down: number; shut: number; up: number },
  d: number,
  r: [number, number, number],
  o = DROWSY,
): BlinkShape {
  const k = Math.min(1, Math.max(0, d));
  const s: BlinkShape = {
    down: base.down * (1 + o.down * k),
    shut: base.shut + o.shut * k,
    up: base.up * (1 + o.up * k),
    depth: 1,
  };
  if (r[0] < o.long * k) s.shut = o.longShut[0] + (o.longShut[1] - o.longShut[0]) * r[1];
  else if (r[0] > 1 - o.partial * k) s.depth = o.depth[0] + (o.depth[1] - o.depth[0]) * r[2];
  return s;
}

const smooth = (x: number) => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * (3 - 2 * u);
};
export function drowsiness(keys: { t: number; k: number }[]) {
  return (t: number) => {
    if (!keys.length) return 0;
    if (t <= keys[0].t) return keys[0].k;
    for (let i = 1; i < keys.length; i++)
      if (t < keys[i].t) {
        const a = keys[i - 1],
          b = keys[i];
        return a.k + (b.k - a.k) * smooth((t - a.t) / (b.t - a.t));
      }
    return keys[keys.length - 1].k;
  };
}
