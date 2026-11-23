import { hash } from "./hash";
export const TREMOR = {
  forearm: 1.4,
  arm: 0.6,
  fine: [6.3, 7.4, 8.2, 8.9, 9.7, 11.3, 12.6],
  coarse: [5.3, 5.9],
  runs: [0.45, 0.9],
};
const WEIGHT = [0.5, 0.75, 1, 1, 0.8, 0.5, 0.35];

type Pose = Record<string, number[]>;
export function tremor(level: (t: number) => number, { seed = 3 } = {}) {
  const ph = (i: number, k: number) => 2 * Math.PI * hash(i, seed + k);
  const sig = (t: number, f: number, s: number) => {
    let fine = 0,
      wsum = 0;
    TREMOR.fine.forEach((hz, i) => {
      fine += WEIGHT[i] * Math.sin(2 * Math.PI * hz * t + ph(i, s));
      wsum += WEIGHT[i];
    });
    let coarse = 0;
    TREMOR.coarse.forEach((hz, i) => {
      coarse += Math.sin(2 * Math.PI * hz * t + ph(i + 10, s));
    });
    const runs =
      0.65 +
      0.35 *
        Math.sin(2 * Math.PI * TREMOR.runs[0] * t + ph(20, s)) *
        Math.sin(2 * Math.PI * TREMOR.runs[1] * t + ph(21, s));
    return runs * ((fine / wsum) * 1.6 + f * f * 0.5 * coarse);
  };
  return Object.assign(
    (t: number): Pose => {
      const f = Math.min(1, Math.max(0, level(t)));
      if (f <= 0) return {};
      const out: Pose = {};
      ["L", "R"].forEach((sd, h) => {
        const s = 30 * h;
        out[`la${sd}`] = [f * TREMOR.forearm * sig(t, f, s), 0, 0];
        out[`ua${sd}`] = [
          f * TREMOR.arm * sig(t, f, s + 7),
          0,
          f * TREMOR.arm * 0.6 * sig(t, f, s + 13),
        ];
      });
      return out;
    },
    { level },
  );
}
