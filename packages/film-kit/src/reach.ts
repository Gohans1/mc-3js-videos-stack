// A hand that moves like a person's, not a machine's. Three things set a real reach apart from a smoothstep between two
// keys. Its speed is a single bell, fastest in the middle (minimum jerk, Flash & Hogan 1985: s = 10u^3 - 15u^4 + 6u^5).
// It falls a little short and a second, smaller bell finishes it (the primary submovement undershoots, a corrective one
// overlaps its end: Meyer et al. 1988, Elliott et al. 2001; overlapping submovements add up, Flash & Henis 1991). And it
// takes as long as the distance and the size of the thing ask for, not as long as the gap between two keys: Fitts' law,
// time = a + b log2(2 distance / width), so a far or small target takes longer and a short hop is quick.
//   k = reachK(t, keyA.t, keyB.t, { dist })   in place of smooth((t - a.t) / (b.t - a.t)), on a straight or arc path
// With the keys further apart than the reach needs, the hand waits and then goes, arriving on the second key (people
// move at their own speed; the key says when the hand is there). Closer together, it just fills the gap.
// a, b: fitted so a 40 cm reach to an 8 cm thing takes ~0.55 s and a 10 cm hop ~0.35 s (everyday unhurried reaches).
export const REACH = {
  a: 0.2,
  b: 0.1,
  width: 0.08, // s, s per bit, m
  under: 0.08, // the first bell stops this share of the way short
  first: 0.85,
  second: 0.3, // shares of the reach time each bell takes; the second ends it, so they overlap by 0.15
};

export const minJerk = (u: number) => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * x * (10 + x * (-15 + 6 * x));
};
export const fitts = (dist: number, width = REACH.width) =>
  REACH.a + REACH.b * Math.log2(Math.max(1, (2 * dist) / width));

// progress 0..1 of a whole reach, u its own 0..1 time: a main bell to 1 - under, a small one for the rest
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
