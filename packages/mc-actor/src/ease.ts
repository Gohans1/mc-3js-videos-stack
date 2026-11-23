// @ts-nocheck
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const smooth = (x) => {
  const u = clamp01(x);
  return u * u * (3 - 2 * u);
};

export const WALK_START = 1.0,
  WALK_STOP = 0.6;
const ramp = (u) => u * u * u - (u * u * u * u) / 2;
export function walkEase(x, dur) {
  const u = clamp01(x);
  if (!(dur > 0)) return u;
  const a = Math.min(WALK_START, 0.4 * dur) / dur,
    b = Math.min(WALK_STOP, 0.4 * dur) / dur;
  const total = 1 - a / 2 - b / 2;
  if (u < a) return (a * ramp(u / a)) / total;
  if (u > 1 - b) return (total - b * ramp((1 - u) / b)) / total;
  return (a / 2 + u - a) / total;
}
