import { FREEZE } from "./freeze";
import { hash } from "./hash";
import { canonical, type Pose, unwrap } from "./pose";
import { SIGH, sighLength, sighLungs } from "./sigh";
import type { Yawns } from "./yawn";

const HZ = 60;
const SIGH_OUT = SIGH.first + SIGH.second + SIGH.hold;
const UPPER = ["body", "chest", "head", "uaL", "uaR", "laL", "laR"];
const MASS: Record<string, number> = {
  body: 1,
  chest: 0.8,
  head: 0.3,
  uaL: 0.15,
  uaR: 0.15,
  laL: 0.08,
  laR: 0.08,
};
const smooth = (x: number) => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * (3 - 2 * u);
};
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export const BREATH = {
  rest: 0.25,
  hard: 0.67,
  depth: 1.2,
  pant: 3.5,
  recover: 25,
  rise: 2,
  work: 160,
};
export const SWAY = { every: 4.2, over: 1.1, hip: 0.035, tilt: 2.5, drop: 0.008 };
export const GASP = {
  start: 0.05,
  inhale: 0.3,
  peak: [1.25, 1.6],
  hold: [0.8, 2.5],
  relief: [1.2, 2],
  sigh: 0.3,
  back: 0.6,
  arousal: 0.3,
};
export const SETTLE = { over: 0.9, chest: 3, sink: 0.012, fast: 400 };

export type IdleOpts = {
  standing?: (t: number) => number;
  breath?: number;
  sway?: number;
  settle?: number;
  seed?: number;
  gasps?: { t: number; k?: number }[];
  sighs?: { t: number; k?: number }[];
  yawns?: Yawns | null;
  freeze?: (t: number) => number;
};

export function idle(
  poseAt: (t: number) => Pose,
  end: number,
  {
    standing = () => 0,
    breath = 1,
    sway = 1,
    settle = 1,
    seed = 7,
    gasps = [],
    sighs = [],
    yawns = null,
    freeze = () => 0,
  }: IdleOpts = {},
) {
  const n = Math.ceil(end * HZ) + 2;
  const act = new Float32Array(n),
    work = new Float32Array(n);
  let prev = canonical(poseAt(0));
  for (let i = 1; i < n; i++) {
    const p = canonical(poseAt(i / HZ));
    let s = 0,
      m = 0;
    for (const j of UPPER) {
      const a = (p[j] as number[] | undefined) ?? [0, 0, 0],
        b = (prev[j] as number[] | undefined) ?? [0, 0, 0];
      for (let c = 0; c < 3; c++) {
        const d = unwrap((a[c] ?? 0) - (b[c] ?? 0), 0) ** 2;
        s += d;
        m += MASS[j] ** 2 * d;
      }
    }
    act[i] = Math.sqrt(s) * HZ;
    work[i] = Math.sqrt(m) * HZ;
    prev = p;
  }
  const lungs = (p: number) => {
    const u = p - Math.floor(p);
    return u < 0.4
      ? 0.5 - 0.5 * Math.cos((Math.PI * u) / 0.4)
      : 0.5 + 0.5 * Math.cos((Math.PI * (u - 0.4)) / 0.6);
  };
  const G = GASP,
    mix = ([a, b]: number[], k: number) => a + (b - a) * k;
  type Win = {
    kind: "gasp" | "yawn" | "sigh";
    rank: number;
    k: number;
    t0: number;
    end: number;
    held: number;
    out: number;
    low: number;
    peak: number;
  };
  const all: Win[] = [
    ...gasps.map((g) => {
      const k = clamp01(g.k ?? 1),
        t0 = g.t + G.start,
        held = t0 + G.inhale,
        out = held + mix(G.hold, k),
        low = out + mix(G.relief, k);
      return {
        kind: "gasp" as const,
        rank: 3,
        k,
        t0,
        held,
        out,
        low,
        end: low + G.back,
        peak: mix(G.peak, k),
      };
    }),
    ...(yawns?.spans ?? []).map(([a, b]) => ({
      kind: "yawn" as const,
      rank: 2,
      k: 1,
      t0: a,
      end: b,
      held: 0,
      out: 0,
      low: 0,
      peak: 0,
    })),
    ...sighs.map((g) => ({
      kind: "sigh" as const,
      rank: 1,
      k: clamp01(g.k ?? 1),
      t0: g.t,
      end: g.t + sighLength(),
      held: 0,
      out: 0,
      low: 0,
      peak: 0,
    })),
  ];
  const wins: Win[] = [];
  for (const w of all.sort((a, b) => b.rank - a.rank || a.t0 - b.t0))
    if (!wins.some((x) => w.t0 < x.end && x.t0 < w.end)) wins.push(w);
  wins.sort((a, b) => a.t0 - b.t0);
  const gaspAt = (t: number) => {
    let w: Win | null = null;
    for (const x of wins) if (x.t0 <= t && t < x.end) w = x;
    return w;
  };
  const effort = new Float32Array(n),
    lung = new Float32Array(n),
    still = new Float32Array(n);
  let e = 0,
    ph = 0,
    st = 0,
    level = 0,
    cur: ReturnType<typeof gaspAt> = null,
    from = 0;
  for (let i = 0; i < n; i++) {
    level += (work[i] - level) / HZ;
    const goal = clamp01(level / BREATH.work);
    e += (goal - e) / (goal > e ? BREATH.rise : BREATH.recover) / HZ;
    const t = i / HZ,
      w = gaspAt(t);
    if (w !== cur) {
      if (w) from = i > 0 ? lung[i - 1] : 0;
      else {
        ph = Math.ceil(ph);
        if (cur?.kind === "gasp") e = Math.max(e, G.arousal * cur.k);
      }
      cur = w;
    }
    effort[i] = e;
    if (w?.kind === "sigh") lung[i] = sighLungs(t - w.t0, from, w.k);
    else if (w?.kind === "yawn") {
      const y = yawns!(t);
      lung[i] = (y?.lungs ?? 0) + (from - 1) * (1 - smooth((t - w.t0) / 0.8));
    } else if (w) {
      const s = -G.sigh * w.k;
      lung[i] =
        t < w.held
          ? from + (w.peak - from) * smooth((t - w.t0) / G.inhale)
          : t < w.out
            ? w.peak * (1 - (0.04 * (t - w.held)) / (w.out - w.held))
            : t < w.low
              ? 0.96 * w.peak + (s - 0.96 * w.peak) * (1 - (1 - (t - w.out) / (w.low - w.out)) ** 2)
              : s * (1 - smooth((t - w.low) / G.back));
    } else {
      lung[i] = lungs(ph);
      ph += (BREATH.rest + (BREATH.hard - BREATH.rest) * e) / HZ;
    }
    st = act[i] > 40 ? 0 : Math.min(1, st + 2 / HZ);
    still[i] = smooth(st);
  }
  const stops: { t: number; k: number }[] = [];
  const holds = (i: number) => {
    for (let k = i; k < Math.min(n, i + HZ / 4); k++) if (act[k] > 40) return false;
    return true;
  };
  let peak = 0;
  for (let i = 0; i < n; i++) {
    peak = Math.max(peak, act[i]);
    if (act[i] < 30 && peak > 120 && holds(i)) {
      stops.push({ t: i / HZ, k: clamp01(peak / SETTLE.fast) });
      peak = 0;
    }
    if (act[i] < 30) peak = 0;
  }
  const read = (arr: ArrayLike<number>, t: number) => {
    const x = Math.min(Math.max(t * HZ, 0), n - 1.001),
      i = Math.floor(x);
    return arr[i] + (arr[i + 1] - arr[i]) * (x - i);
  };
  const shifts: { t: number; to: number }[] = [];
  for (let t = 1, i = 0, side = 1; t < end + SWAY.every; i++) {
    side = hash(i, seed) < 0.75 ? -side : side;
    shifts.push({ t, to: side * (0.55 + 0.45 * hash(i, seed + 1)) });
    t += SWAY.every * (0.75 + 0.5 * hash(i, seed + 2));
  }
  const weightAt = (t: number) => {
    let lo = -1;
    for (let i = 0; i < shifts.length && shifts[i].t <= t; i++) lo = i;
    if (lo < 0) return 0;
    const from = lo > 0 ? shifts[lo - 1].to : 0;
    return from + (shifts[lo].to - from) * smooth((t - shifts[lo].t) / SWAY.over);
  };

  const life = (t: number): Pose => {
    const e = read(effort, t),
      stand = clamp01(standing(t));
    const amp = breath * (BREATH.depth + BREATH.pant * e);
    const b = read(lung, t),
      late = read(lung, t - 0.08 / (BREATH.rest + (BREATH.hard - BREATH.rest) * e));
    const out: Pose = {
      root: {},
      body: [-0.4 * e * amp * b, 0, 0],
      chest: [-amp * b, 0, 0],
      head: [0.6 * amp * late, 0, 0],
      uaL: [0, 0, 0.35 * amp * late],
      uaR: [0, 0, -0.35 * amp * late],
    };
    const w = sway * stand * read(still, t) * weightAt(t) * (1 - FREEZE.sway * freeze(t));
    out.root!.x = SWAY.hip * w;
    out.root!.y = -SWAY.drop * Math.abs(w);
    out.root!.rz = SWAY.tilt * w;
    (out.body as number[])[2] -= 0.6 * SWAY.tilt * w;
    (out.chest as number[])[2] -= 0.3 * SWAY.tilt * w;
    (out.head as number[])[2] -= 0.1 * SWAY.tilt * w;
    let dip = 0;
    for (const s of stops) {
      const u = t - s.t;
      if (u > 0 && u < SETTLE.over * 1.5)
        dip +=
          s.k *
          Math.exp(-u / (SETTLE.over * 0.35)) *
          Math.sin(Math.min(Math.PI, (Math.PI * u) / (SETTLE.over * 0.5)));
    }
    dip *= settle;
    (out.chest as number[])[0] += SETTLE.chest * dip;
    out.root!.y -= SETTLE.sink * dip * stand;
    return out;
  };
  const gasp = (t: number) => {
    const w = gaspAt(t);
    return !w || w.kind !== "gasp" ? null : t < w.held ? "in" : t < w.out ? "held" : "relief";
  };
  const breathOf = (t: number) => gaspAt(t)?.kind ?? null;
  const events = wins.flatMap((w) =>
    w.kind === "gasp"
      ? [
          { t: w.t0, kind: "gasp-in" },
          { t: w.out, kind: "relief-out" },
        ]
      : w.kind === "sigh"
        ? [{ t: w.t0 + SIGH_OUT, kind: "sigh-out" }]
        : (yawns?.events ?? []).filter((e) => e.t >= w.t0 && e.t < w.end),
  );
  return Object.assign(life, {
    effort: (t: number) => read(effort, t),
    activity: (t: number) => read(act, t),
    stops,
    weight: weightAt,
    gasp,
    breath: breathOf,
    events,
    windows: wins.map((w) => ({ kind: w.kind, t: w.t0, end: w.end })),
    lungs: (t: number) => read(lung, t),
  });
}
