export const EXPLORE = {
  last: 2,
  mean: 0.6,
  wander: 2.2,
};

const smooth = (x: number) => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * (3 - 2 * u);
};

export function explore(starts: number[], o = EXPLORE) {
  const amb = (t: number) => {
    let a = 0;
    for (const s of starts) if (t >= s) a = Math.max(a, 1 - smooth((t - s) / o.last));
    return a;
  };
  return Object.assign(amb, {
    mean: (t: number) => 1 + (o.mean - 1) * amb(t),
    wander: (t: number) => 1 + (o.wander - 1) * amb(t),
  });
}
