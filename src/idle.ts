// The life a body has between actions, with no keys: one install that adds to any pose function.
//   breath: one breathing layer for every pose, inhale shorter than exhale (about 2:3), the chest rising and the head
//     counter-turning so the eyes stay level, arms and head a beat after the chest (offset up the chain, the AAA idle
//     recipe in AnimSchool / AnimotionX). Rest is ~15 breaths a minute; effort raises rate and depth (to ~40 a minute,
//     panting), and they fall back on a ~25 s time constant (respiration recovery after exercise measures ~28 s).
//     Effort is how hard the body works, not how much it moves: each part's turning speed is weighted by its mass
//     (trunk heavy, arms light, so a walk's arm swing is cheap and flinging the trunk about is hard), smoothed over a
//     second, and effort rises toward that level in ~2 s and falls back in ~25 s, so a steady walk breathes a little
//     faster (~25 a minute) and holds there instead of piling up to panting.
//   sway: standing still, the weight shifts from one leg to the other every ~4 s over ~1.1 s (Reelwright's idle
//     layer): hips slide over the weight leg and tilt, spine and head counter so the head stays over the feet. Needs
//     planted feet (leg IK holding the soles) or the feet slide with the hips.
//   gasps: a fright (src/startle.ts events) takes a sharp breath in, holds it (apnea: a full stop of breathing after a
//     sharp inhale in a jump-scare), then lets it go in a long relief exhale that sinks the chest and drops the shoulders
//     below rest, and breathing starts again from empty, a little faster (Animator Notebook, "Action Analysis: Breathing";
//     Playdead's INSIDE stops the boy's breath on a jump and restarts it with an exhale on landing, Schmid 2016).
//   settle: when a fast move stops (and stays stopped: not a swing turning back), the body gives under its own momentum:
//     the chest dips and the hips sink a little, once, over ~0.9 s, scaled by how fast it was moving.
// Effort, stillness and stops are measured from the pose itself (how fast its joints turn), so nothing is keyed. The pose
// function is run through once (60 samples a second); the result is a pose offset to add (src/pose.ts addPose) before
// hand, head and leg IK.
//   const life = idle((t) => bodyPose(t), filmEnd, { standing: (t) => 1 });   pose = addPose(bodyPose(t), life(t))
// standing(t): 0..1, how much the character stands on both feet (sway and the hips' sink are scaled by it).
import { canonical, unwrap, type Pose } from "./pose";

const HZ = 60;
const UPPER = ["body", "chest", "head", "uaL", "uaR", "laL", "laR"];
// share of the work a degree a second of each part costs (roughly its mass about the hips; the arms swing nearly free)
const MASS: Record<string, number> = { body: 1, chest: 0.8, head: 0.3, uaL: 0.15, uaR: 0.15, laL: 0.08, laR: 0.08 };
const hash = (n: number, k: number) => { const x = Math.sin(n * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
const smooth = (x: number) => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); };
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export const BREATH = { rest: 0.25, hard: 0.67, depth: 1.2, pant: 3.5, recover: 25, rise: 2, work: 160 }; // Hz, Hz, deg, deg, s, s, mass-weighted deg/s that is all-out effort
export const SWAY = { every: 4.2, over: 1.1, hip: 0.035, tilt: 2.5, drop: 0.008 }; // s, s, m, deg, m
export const GASP = { start: 0.05, inhale: 0.3, peak: [1.25, 1.6], hold: [0.8, 2.5], relief: [1.2, 2], sigh: 0.3, back: 0.6, arousal: 0.3 }; // s, s, lungs (1 = a normal breath) weak..full, s, s, lungs below rest, s, effort left after a full one
export const SETTLE = { over: 0.9, chest: 3, sink: 0.012, fast: 400 }; // s, deg, m, deg/s that counts as a full-speed move

export type IdleOpts = { standing?: (t: number) => number; breath?: number; sway?: number; settle?: number; seed?: number; gasps?: { t: number; k?: number }[] };

export function idle(poseAt: (t: number) => Pose, end: number, { standing = () => 0, breath = 1, sway = 1, settle = 1, seed = 7, gasps = [] }: IdleOpts = {}) {
  const n = Math.ceil(end * HZ) + 2;
  // how fast the upper body turns, degrees a second (all its joints together: one fast joint counts in full)
  const act = new Float32Array(n), work = new Float32Array(n);
  let prev = canonical(poseAt(0));
  for (let i = 1; i < n; i++) {
    const p = canonical(poseAt(i / HZ));
    let s = 0, m = 0;
    for (const j of UPPER) {
      const a = (p[j] as number[] | undefined) ?? [0, 0, 0], b = (prev[j] as number[] | undefined) ?? [0, 0, 0];
      for (let c = 0; c < 3; c++) { const d = unwrap((a[c] ?? 0) - (b[c] ?? 0), 0) ** 2; s += d; m += MASS[j] ** 2 * d; }
    }
    act[i] = Math.sqrt(s) * HZ;
    work[i] = Math.sqrt(m) * HZ;
    prev = p;
  }
  // one breath as 0..1: in over the first 40% of the cycle, out over the rest
  const lungs = (p: number) => { const u = p - Math.floor(p); return u < 0.4 ? 0.5 - 0.5 * Math.cos((Math.PI * u) / 0.4) : 0.5 + 0.5 * Math.cos((Math.PI * (u - 0.4)) / 0.6); };
  // each gasp's window: in, held, let go, back to empty
  const G = GASP, mix = ([a, b]: number[], k: number) => a + (b - a) * k;
  const wins = gasps.map((g) => {
    const k = clamp01(g.k ?? 1), t0 = g.t + G.start, held = t0 + G.inhale, out = held + mix(G.hold, k), low = out + mix(G.relief, k);
    return { k, t0, held, out, low, end: low + G.back, peak: mix(G.peak, k) };
  }).sort((a, b) => a.t0 - b.t0);
  const gaspAt = (t: number) => { let w = null; for (const x of wins) if (x.t0 <= t && t < x.end) w = x; return w; };
  // effort heads for the work level (averaged over a second): up in `rise` seconds, back down in `recover`; the lungs
  // follow a phase that integrates the breathing rate, frozen through a gasp, which restarts it on an empty breath
  const effort = new Float32Array(n), lung = new Float32Array(n), still = new Float32Array(n);
  let e = 0, ph = 0, st = 0, level = 0, cur: ReturnType<typeof gaspAt> = null, from = 0;
  for (let i = 0; i < n; i++) {
    level += (work[i] - level) / HZ;
    const goal = clamp01(level / BREATH.work);
    e += ((goal - e) / (goal > e ? BREATH.rise : BREATH.recover)) / HZ;
    const t = i / HZ, w = gaspAt(t);
    if (w !== cur) {
      if (w) from = i > 0 ? lung[i - 1] : 0;
      else { ph = Math.ceil(ph); e = Math.max(e, G.arousal * (cur?.k ?? 0)); }
      cur = w;
    }
    effort[i] = e;
    if (w) {
      const s = -G.sigh * w.k;
      lung[i] = t < w.held ? from + (w.peak - from) * smooth((t - w.t0) / G.inhale)
        : t < w.out ? w.peak * (1 - 0.04 * (t - w.held) / (w.out - w.held))
        : t < w.low ? 0.96 * w.peak + (s - 0.96 * w.peak) * (1 - (1 - (t - w.out) / (w.low - w.out)) ** 2)
        : s * (1 - smooth((t - w.low) / G.back));
    } else {
      lung[i] = lungs(ph);
      ph += (BREATH.rest + (BREATH.hard - BREATH.rest) * e) / HZ;
    }
    // still: under 40 deg/s; it takes half a second of stillness to count, and goes at once
    st = act[i] > 40 ? 0 : Math.min(1, st + 2 / HZ);
    still[i] = smooth(st);
  }
  // stops: a move over 120 deg/s that falls under 30 deg/s and stays under 40 for a quarter second (a swing turning back
  // also passes through zero: a walk's arms would dip the chest every stride); its peak speed sizes the settle
  const stops: { t: number; k: number }[] = [];
  const holds = (i: number) => { for (let k = i; k < Math.min(n, i + HZ / 4); k++) if (act[k] > 40) return false; return true; };
  let peak = 0;
  for (let i = 0; i < n; i++) {
    peak = Math.max(peak, act[i]);
    if (act[i] < 30 && peak > 120 && holds(i)) { stops.push({ t: i / HZ, k: clamp01(peak / SETTLE.fast) }); peak = 0; }
    if (act[i] < 30) peak = 0;
  }
  const read = (arr: ArrayLike<number>, t: number) => { const x = Math.min(Math.max(t * HZ, 0), n - 1.001), i = Math.floor(x); return arr[i] + (arr[i + 1] - arr[i]) * (x - i); };
  // weight shifts: each starts at a seeded time ~every 4 s, goes to a side (mostly the other one) by 55-100%
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
    const e = read(effort, t), stand = clamp01(standing(t));
    const amp = breath * (BREATH.depth + BREATH.pant * e);
    // arms and head a beat after the chest: 8% of a breath
    const b = read(lung, t), late = read(lung, t - 0.08 / (BREATH.rest + (BREATH.hard - BREATH.rest) * e));
    const out: Pose = {
      root: {},
      body: [-0.4 * e * amp * b, 0, 0],
      chest: [-amp * b, 0, 0],
      head: [0.6 * amp * late, 0, 0],
      uaL: [0, 0, 0.35 * amp * late],
      uaR: [0, 0, -0.35 * amp * late],
    };
    // sway: + puts the weight on his left leg (hips to his left, the left hip up)
    const w = sway * stand * read(still, t) * weightAt(t);
    // (rz > 0 lifts his left side; the counter-bends add back to zero, so the head ends level). The weight leg is already
    // straight, so the hips drop as much as its side rises (and the free knee bends): otherwise that sole leaves the floor
    out.root!.x = SWAY.hip * w;
    out.root!.y = -SWAY.drop * Math.abs(w);
    out.root!.rz = SWAY.tilt * w;
    (out.body as number[])[2] -= 0.6 * SWAY.tilt * w;
    (out.chest as number[])[2] -= 0.3 * SWAY.tilt * w;
    (out.head as number[])[2] -= 0.1 * SWAY.tilt * w;
    // settle: a damped dip after each stop
    let dip = 0;
    for (const s of stops) { const u = t - s.t; if (u > 0 && u < SETTLE.over * 1.5) dip += s.k * Math.exp(-u / (SETTLE.over * 0.35)) * Math.sin(Math.min(Math.PI, (Math.PI * u) / (SETTLE.over * 0.5))); }
    dip *= settle;
    (out.chest as number[])[0] += SETTLE.chest * dip;
    out.root!.y -= SETTLE.sink * dip * stand;
    return out;
  };
  // what the breath is doing at t: "in" (the gasp), "held", "relief", or null (breathing)
  const gasp = (t: number) => { const w = gaspAt(t); return !w ? null : t < w.held ? "in" : t < w.out ? "held" : "relief"; };
  return Object.assign(life, { effort: (t: number) => read(effort, t), activity: (t: number) => read(act, t), stops, weight: weightAt, gasp, lungs: (t: number) => read(lung, t) });
}
