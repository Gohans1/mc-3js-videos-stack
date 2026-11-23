import type { Pose } from "./pose";

export type Startle = { t: number; k?: number };
export const STARTLE = {
  onset: { blink: 0.03, head: 0.09, arms: 0.14, trunk: 0.16, legs: 0.2 },
  rise: 0.045,
  decay: [0.1, 0.28],
  blink: [0.12, 0.25],
  orient: 0.42,
  habit: 120,
  fade: 0.55,
};
export const JOLT = {
  head: [14, 0, 0],
  chest: [7, 0, 0],
  body: [4, 0, 0],
  uaL: [-12, 0, -7],
  uaR: [-12, 0, 7],
  laL: [-22, 0, 0],
  laR: [-22, 0, 0],
  sink: 0.035,
};

const pulse = (u: number, rise: number, decay: number) => {
  if (u <= 0) return 0;
  const tp = (Math.log(decay / rise) * rise * decay) / (decay - rise);
  const f = (x: number) => Math.exp(-x / decay) - Math.exp(-x / rise);
  return f(u) / f(tp);
};
const lerp = ([a, b]: number[], k: number) => a + (b - a) * k;
const smooth = (x: number) => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * (3 - 2 * u);
};

export const orientAt = (e: Startle) => e.t + STARTLE.orient;

export function startle(events: Startle[]) {
  const ev = [...events]
    .sort((a, b) => a.t - b.t)
    .map((e, i, all) => {
      const k = Math.min(1, Math.max(0, e.k ?? 1));
      const n = all.slice(0, i).filter((p) => e.t - p.t < STARTLE.habit).length;
      return { t: e.t, k, body: k * STARTLE.fade ** n, head: k * Math.max(0.5, 0.8 ** n) };
    });
  const S = STARTLE.onset;
  const at = (t: number) => {
    const pose: Pose = { root: { y: 0 } };
    const add = (j: keyof typeof JOLT, w: number) => {
      const v = JOLT[j] as number[],
        p = (pose[j] as number[]) ?? [0, 0, 0];
      pose[j] = p.map((x, c) => x + v[c] * w);
    };
    let blink = 0;
    for (const e of ev) {
      const u = t - e.t;
      if (u < 0 || u > 3) continue;
      const decay = lerp(STARTLE.decay, e.k),
        part = (on: number) => pulse(u - on, STARTLE.rise, decay);
      add("head", e.head * part(S.head));
      for (const j of ["uaL", "uaR", "laL", "laR"] as const) add(j, e.body * part(S.arms));
      add("chest", e.body * part(S.trunk));
      add("body", e.body * part(S.trunk));
      pose.root!.y! -= JOLT.sink * e.body * part(S.legs);
      const shut = lerp(STARTLE.blink, e.k),
        b = u - S.blink;
      blink = Math.max(
        blink,
        b < 0
          ? 0
          : b < 0.04
            ? smooth(b / 0.04)
            : b < 0.04 + shut
              ? 1
              : 1 - smooth((b - 0.04 - shut) / 0.12),
      );
    }
    return { pose, blink };
  };
  return Object.assign(at, { events: ev });
}
