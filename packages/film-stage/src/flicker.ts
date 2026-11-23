// @ts-nocheck
import * as THREE from "three";

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
