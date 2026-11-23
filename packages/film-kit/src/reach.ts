export const REACH = {
  a: 0.2,
  b: 0.1,
  width: 0.08,
  under: 0.08,
  first: 0.85,
  second: 0.3,
};

export const minJerk = (u: number) => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * x * (10 + x * (-15 + 6 * x));
};
export const fitts = (dist: number, width = REACH.width) =>
  REACH.a + REACH.b * Math.log2(Math.max(1, (2 * dist) / width));

export const reachShape = (
  u: number,
  { under = REACH.under, first = REACH.first, second = REACH.second } = {},
) => (1 - under) * minJerk(u / first) + under * minJerk((u - (1 - second)) / second);

export function reachK(
  t: number,
  t0: number,
  t1: number,
  { dist = 0.4, width = REACH.width } = {},
) {
  const gap = t1 - t0;
  if (gap <= 0) return t >= t1 ? 1 : 0;
  const T = Math.min(gap, fitts(dist, width));
  return reachShape((t - (t1 - T)) / T);
}
