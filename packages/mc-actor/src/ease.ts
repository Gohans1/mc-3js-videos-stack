// @ts-nocheck
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
// smoothstep on 0..1: eases in and out, flat at both ends
export const smooth = (x) => { const u = clamp01(x); return u * u * (3 - 2 * u); };

// How far along a walk of dur seconds he is at x (0..1 of its time): from standing he reaches his pace over about two steps
// (1 s) and comes to rest over about one (0.6 s), as people start and stop (gait initiation reaches steady speed by the
// 2nd-3rd step: Strutzenberger 2021, Delafontaine 2025), at a constant pace between. His speed rises from 0 and falls back to
// 0 smoothly (a smoothstep speed ramp), so a walk never starts or stops dead; each ramp is at most 40% of a short walk.
export const WALK_START = 1.0, WALK_STOP = 0.6;
const ramp = (u) => u * u * u - (u * u * u * u) / 2; // the distance a smoothstep speed ramp covers by u (0..1), 0.5 at 1
export function walkEase(x, dur) {
  const u = clamp01(x);
  if (!(dur > 0)) return u; // the last key: nothing left to walk
  const a = Math.min(WALK_START, 0.4 * dur) / dur, b = Math.min(WALK_STOP, 0.4 * dur) / dur;
  const total = 1 - a / 2 - b / 2;
  if (u < a) return (a * ramp(u / a)) / total;
  if (u > 1 - b) return (total - b * ramp((1 - u) / b)) / total;
  return (a / 2 + u - a) / total;
}
