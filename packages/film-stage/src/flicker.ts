// @ts-nocheck
import * as THREE from "three";

// The lamp's level 0..1 at film time t (edit.json light.flicker): a tired tube. Each 1/rate s slot is seeded: most burn
// steady with a faint buzz, a rare one dips (dip, to between low and 1), fewer drop to floor (out). blackouts [[t, dur]] are
// the story's dips (a rustle, the burst), down to flicker.dark and back, eased 60 ms each way: the dev finds a lamp that
// snaps from full to nothing, or flickers every second, hard to watch.
// L: {flicker: {rate, seed, dip, out, low, floor, dark?}, blackouts?}; the same t gives the same level at any seek
const hash = (n, k = 0) => {
  const x = Math.sin(n * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
};
export const flickerAt = (L, t) => {
  const F = L.flicker;
  if (!F) return 1;
  for (const [at, dur] of L.blackouts ?? [])
    if (t >= at - 0.06 && t < at + dur + 0.06) {
      const k = Math.min(
        THREE.MathUtils.smoothstep(t, at - 0.06, at),
        1 - THREE.MathUtils.smoothstep(t, at + dur, at + dur + 0.06),
      );
      return 1 - (1 - (F.dark ?? F.floor)) * k;
    }
  const n = Math.floor(t * F.rate),
    r = hash(n, F.seed);
  const buzz = 0.93 + 0.07 * Math.sin(t * 2 * Math.PI * 7.3) * Math.sin(t * 2 * Math.PI * 0.61);
  if (r < F.out) return F.floor;
  if (r < F.out + F.dip) return F.low + (1 - F.low) * 0.5 * hash(n, F.seed + 1);
  return buzz;
};
