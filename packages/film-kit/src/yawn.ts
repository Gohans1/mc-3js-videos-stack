import { hash } from "./hash";
import { GASP } from "./idle";

const gaspLength = (k: number) => {
  const m = ([a, b]: number[]) => a + (b - a) * Math.min(1, Math.max(0, k));
  return GASP.start + GASP.inhale + m(GASP.hold) + m(GASP.relief) + GASP.back;
};

export const YAWN = {
  inhale: 2.8,
  acme: 1.8,
  exhale: 1.3,
  pause: 0.8,
  lungs: 2.6,
  neck: 14,
  narrow: 0.45,
  bout: 68,
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const minJerk = (u: number) => {
  const x = clamp01(u);
  return x * x * x * (10 + x * (-15 + 6 * x));
};

export type YawnState = {
  phase: "in" | "acme" | "out" | "pause";
  k: number;
  gape: number;
  lids: number;
  brow: number;
  neck: number;
  lungs: number;
  t0: number;
};
export type Yawns = ((t: number) => YawnState | null) & {
  spans: [number, number][];
  events: { t: number; kind: string }[];
};

export function yawns(
  keys: { t: number; k?: number; tempo?: number }[],
  { gasps = [] as { t: number; k?: number }[], o = YAWN } = {},
): Yawns {
  const frights = gasps.map((g) => [g.t, g.t + gaspLength(g.k ?? 1)]);
  const list = keys
    .map((y) => {
      const s = y.tempo ?? 1,
        k = clamp01(y.k ?? 1);
      const a = y.t + o.inhale * s,
        b = a + o.acme * s,
        c = b + o.exhale * s;
      return { t0: y.t, a, b, c, d: c + o.pause, k, s };
    })
    .filter((y) => !frights.some(([a, b]) => y.t0 < b && a < y.d))
    .sort((x, y) => x.t0 - y.t0);
  const f = (t: number): YawnState | null => {
    const y = list.find((x) => t >= x.t0 && t < x.d);
    if (!y) return null;
    const { k } = y;
    if (t < y.a) {
      const u = (t - y.t0) / (y.a - y.t0);
      return {
        phase: "in",
        k,
        t0: y.t0,
        gape: k * 0.85 * minJerk(u),
        lids: k * o.narrow * minJerk((u - 0.5) / 0.5),
        brow: 0,
        neck: k * 0.6 * o.neck * minJerk(u),
        lungs: 1 + (o.lungs * k - 1) * minJerk(u),
      };
    }
    if (t < y.b) {
      const u = (t - y.a) / (y.b - y.a),
        q = minJerk(u / 0.25);
      return {
        phase: "acme",
        k,
        t0: y.t0,
        gape: k * (0.85 + 0.15 * q),
        lids: k * (o.narrow + (1 - o.narrow) * q),
        brow: k * q,
        neck: k * o.neck * (0.6 + 0.4 * q),
        lungs: o.lungs * k * (1 + 0.04 * u),
      };
    }
    if (t < y.c) {
      const u = (t - y.b) / (y.c - y.b),
        r = 1 - minJerk(u / 0.7);
      return {
        phase: "out",
        k,
        t0: y.t0,
        gape: k * r,
        lids: k * (1 - minJerk(u / 0.6)),
        brow: k * r,
        neck: k * o.neck * r,
        lungs: -0.2 + (o.lungs * k * 1.04 + 0.2) * (1 - minJerk(u / 0.8)),
      };
    }
    return {
      phase: "pause",
      k,
      t0: y.t0,
      gape: 0,
      lids: 0,
      brow: 0,
      neck: 0,
      lungs: -0.2 * (1 - minJerk((t - y.c) / (y.d - y.c))),
    };
  };
  return Object.assign(f, {
    spans: list.map((y) => [y.t0, y.d] as [number, number]),
    events: list.flatMap((y) => [
      { t: y.t0, kind: "yawn-in" },
      { t: y.b, kind: "yawn-out" },
    ]),
  });
}

export function yawnPose(y: YawnState | null) {
  if (!y) return { root: {} };
  return { root: {}, head: [-y.neck, 0, 0], chest: [-0.25 * y.neck, 0, 0] };
}

export function yawnTimes(
  end: number,
  drowsy: (t: number) => number,
  { seed = 5, from = 0, busy = (_t: number): boolean => false } = {},
) {
  const out: { t: number; k: number }[] = [];
  const len = YAWN.inhale + YAWN.acme + YAWN.exhale + YAWN.pause;
  let t = from + 2 + 10 * hash(0, seed),
    i = 1;
  while (t < end - len) {
    const d = drowsy(t);
    if (d > 0.3 && ![0, 1, 2, 3, 4, 5, 6].some((s) => busy(t + s))) {
      out.push({ t, k: 0.7 + 0.3 * hash(i, seed + 1) });
      t += len;
    }
    t += YAWN.bout * (0.6 + 0.8 * hash(i, seed + 2));
    i++;
  }
  return out;
}
