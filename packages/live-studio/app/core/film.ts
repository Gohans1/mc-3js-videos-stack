import { DURATION, SHOTS_OUT as SHOTS } from "./filmMeta";

export const shotIndex = (x: number) => {
  if (!SHOTS.length || x < SHOTS[0].t) return 0;
  let lo = 0,
    hi = SHOTS.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (x >= SHOTS[mid].t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};
export const shotEnd = (i: number) => SHOTS[i + 1]?.t ?? DURATION;
