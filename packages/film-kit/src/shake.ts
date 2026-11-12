// Camera shake from hits (a slam, a fall, a blast), after S. Eiserloh, "Juicing Your Cameras With Math" (GDC 2016): each
// hit adds trauma (0..1, capped), trauma falls linearly, the shake is trauma^power times smooth noise, and in 3D it only
// turns the camera (yaw, pitch, roll), never moves it. Noise is pmndrs/math simplex, seeded, so it is pure in t.
//   const shk = shake([{ t: 57.2, amount: 0.6 }], { max: [1.5, 1.5, 2] });  const [yaw, pitch, roll] = shk(t)  (degrees)
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
  // trauma right after each hit
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
