import { simplex2d } from "math/noise";

export type Hit = { t: number; amount: number };
export type ShakeOpts = {
  decay?: number;
  power?: number;
  freq?: number;
  max?: [number, number, number];
  seed?: number;
};

export function shake(
  input: Hit[],
  { decay = 1, power = 2, freq = 14, max = [2, 2, 1.5], seed = 1 }: ShakeOpts = {},
) {
  const hits = [...input].sort((a, b) => a.t - b.t);
  const noise = simplex2d.create(seed);
  const after: number[] = [];
  hits.forEach((h, i) => {
    const prev = i ? Math.max(0, after[i - 1] - decay * (h.t - hits[i - 1].t)) : 0;
    after.push(Math.min(1, prev + h.amount));
  });
  const trauma = (t: number) => {
    let i = -1;
    while (i + 1 < hits.length && hits[i + 1].t <= t) i++;
    return i < 0 ? 0 : Math.max(0, after[i] - decay * (t - hits[i].t));
  };
  const shk = (t: number): [number, number, number] => {
    const k = trauma(t) ** power;
    return [0, 1, 2].map((c) =>
      k ? max[c] * k * simplex2d.sample(noise, t * freq, c * 37.1 + 0.5) : 0,
    ) as [number, number, number];
  };
  return Object.assign(shk, { trauma });
}
