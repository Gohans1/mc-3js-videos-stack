import { hash } from "./hash";
export const SIGH = {
  first: 1.4,
  second: 0.7,
  peak: 2.4,
  hold: 0.25,
  out: 2.2,
  low: -0.3,
  pause: 1,
  rate: { rest: 12, relief: 30 },
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const minJerk = (u: number) => {
  const x = clamp01(u);
  return x * x * x * (10 + x * (-15 + 6 * x));
};

export function sighLungs(u: number, from: number, k = 1, o = SIGH) {
  const a = o.first,
    b = a + o.second,
    c = b + o.hold,
    d = c + o.out,
    top = 1 + (o.peak - 1) * k,
    low = o.low * k;
  if (u < a) return from + (1 - from) * minJerk(u / a);
  if (u < b) return 1 + (top - 1) * minJerk((u - a) / o.second);
  if (u < c) return top;
  if (u < d) return top + (low - top) * (1 - (1 - (u - c) / o.out) ** 2);
  return low * (1 - minJerk((u - d) / o.pause));
}
export const sighLength = (o = SIGH) => o.first + o.second + o.hold + o.out + o.pause;

export function sighTimes(
  end: number,
  rate: (t: number) => number,
  { seed = 9, from = 0, busy = (_t: number): boolean => false } = {},
) {
  const out: { t: number; k: number }[] = [];
  let t = from,
    i = 0;
  for (;;) {
    t += Math.max(20, (-Math.log(1 - 0.999 * hash(i, seed)) * 3600) / Math.max(0.1, rate(t)));
    if (t > end - sighLength()) break;
    if (!busy(t)) out.push({ t, k: 0.7 + 0.3 * hash(i, seed + 1) });
    i++;
  }
  return out;
}
