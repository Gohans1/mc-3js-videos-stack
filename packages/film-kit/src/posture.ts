import { changeTime, KIND } from "./express";
import type { Pose } from "./pose";

type Shape = {
  head?: number[];
  chest?: number[];
  body?: number[];
  uaL?: number[];
  uaR?: number[];
  laL?: number[];
  laR?: number[];
  root?: Record<string, number>;
};
export const POSTURE: {
  shape: Record<string, Shape>;
  amp: Record<string, number>;
  speed: Record<string, number>;
} = {
  shape: {
    sadness: { head: [10, 0, 0], chest: [5, 0, 0], body: [4, 0, 0] },
    joy: { head: [-4, 0, 0], chest: [-2, 0, 0] },
    anger: { head: [3, 0, 0], laL: [-8, 0, 0], laR: [-8, 0, 0] },
    fear: {
      uaL: [5, 0, 0],
      uaR: [5, 0, 0],
      laL: [-10, 0, 0],
      laR: [-10, 0, 0],
      root: { y: -0.02 },
    },
  },
  amp: { sadness: 0.7, joy: 1.25, anger: 1.3, fear: 0.75 },
  speed: { neutral: 1.3, sadness: 0.68, fear: 0.83, joy: 1.31, anger: 1.82 },
};

const minJerk = (u: number) => {
  const x = Math.min(1, Math.max(0, u));
  return x * x * x * (10 + x * (-15 + 6 * x));
};
const JOINTS = ["head", "chest", "body", "uaL", "uaR", "laL", "laR"] as const;

export function posture(
  keys: { t: number; mood: string }[],
  { kind = KIND, k = 1, tempo = 1 } = {},
) {
  const shapeOf = (m: string) => POSTURE.shape[kind[m] ?? ""] ?? {};
  const ampOf = (m: string) => POSTURE.amp[kind[m] ?? ""] ?? 1;
  type S = { v: number[][]; y: number; a: number };
  const target = (m: string): S => {
    const s = shapeOf(m);
    return { v: JOINTS.map((j) => s[j] ?? [0, 0, 0]), y: s.root?.y ?? 0, a: ampOf(m) };
  };
  const mix = (a: S, b: S, u: number): S => ({
    v: a.v.map((x, i) => x.map((c, j) => c + (b.v[i][j] - c) * u)),
    y: a.y + (b.y - a.y) * u,
    a: a.a + (b.a - a.a) * u,
  });
  const from: S[] = [],
    dur: number[] = [];
  const at = (i: number, t: number): S =>
    i === 0
      ? target(keys[0].mood)
      : mix(from[i], target(keys[i].mood), minJerk((t - keys[i].t) / dur[i]));
  keys.forEach((key, i) => {
    dur.push(i === 0 ? 0 : changeTime(keys[i - 1].mood, key.mood, kind, tempo));
    from.push(i === 0 ? target(key.mood) : at(i - 1, key.t));
  });
  const now = (t: number) => {
    if (!keys.length) return null;
    let i = 0;
    while (i < keys.length - 1 && t >= keys[i + 1].t) i++;
    return at(i, t);
  };
  const body = (t: number): Pose => {
    const s = now(t),
      out: Pose = { root: {} };
    if (!s) return out;
    JOINTS.forEach((j, i) => {
      if (s.v[i].some((c) => c !== 0)) out[j] = s.v[i].map((c) => c * k);
    });
    if (s.y) out.root!.y = s.y * k;
    return out;
  };
  return Object.assign(body, { amp: (t: number) => now(t)?.a ?? 1 });
}
