// The life a body has between actions, with no keys: one install that adds to any pose function.
//   breath: one breathing layer for every pose, inhale shorter than exhale (about 2:3), the chest rising and the head
//     counter-turning so the eyes stay level, arms and head a beat after the chest (offset up the chain, the AAA idle
//     recipe in AnimSchool / AnimotionX). Rest is ~15 breaths a minute; effort raises rate and depth (to ~40 a minute,
//     panting), and they fall back on a ~25 s time constant (respiration recovery after exercise measures ~28 s).
//   sway: standing still, the weight shifts from one leg to the other every ~4 s over ~1.1 s (Reelwright's idle
//     layer): hips slide over the weight leg and tilt, spine and head counter so the head stays over the feet. Needs
//     planted feet (leg IK holding the soles) or the feet slide with the hips.
//   settle: when a fast move stops, the body gives under its own momentum: the chest dips and the hips sink a little,
//     once, over ~0.9 s, scaled by how fast it was moving.
// Effort, stillness and stops are measured from the pose itself (how fast its joints turn), so nothing is keyed. The pose
// function is run through once (60 samples a second); the result is a pose offset to add (src/pose.ts addPose) before
// hand, head and leg IK.
//   const life = idle((t) => bodyPose(t), filmEnd, { standing: (t) => 1 });   pose = addPose(bodyPose(t), life(t))
// standing(t): 0..1, how much the character stands on both feet (sway and the hips' sink are scaled by it).
import type { Pose } from "./pose";

const HZ = 60;
const UPPER = ["body", "chest", "head", "uaL", "uaR", "laL", "laR"];
const hash = (n: number, k: number) => { const x = Math.sin(n * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
const smooth = (x: number) => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); };
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export const BREATH = { rest: 0.25, hard: 0.67, depth: 1.2, pant: 3.5, recover: 25, fill: 0.5 }; // Hz, Hz, deg, deg, s, effort per second of full motion
export const SWAY = { every: 4.2, over: 1.1, hip: 0.035, tilt: 2.5, drop: 0.008 }; // s, s, m, deg, m
export const SETTLE = { over: 0.9, chest: 3, sink: 0.012, fast: 400 }; // s, deg, m, deg/s that counts as a full-speed move

export type IdleOpts = { standing?: (t: number) => number; breath?: number; sway?: number; settle?: number; seed?: number };

export function idle(poseAt: (t: number) => Pose, end: number, { standing = () => 0, breath = 1, sway = 1, settle = 1, seed = 7 }: IdleOpts = {}) {
  const n = Math.ceil(end * HZ) + 2;
  // how fast the upper body turns, degrees a second (all its joints together: one fast joint counts in full)
  const act = new Float32Array(n);
  let prev = poseAt(0);
  for (let i = 1; i < n; i++) {
    const p = poseAt(i / HZ);
    let s = 0;
    for (const j of UPPER) { const a = (p[j] as number[] | undefined) ?? [0, 0, 0], b = (prev[j] as number[] | undefined) ?? [0, 0, 0]; for (let c = 0; c < 3; c++) s += ((a[c] ?? 0) - (b[c] ?? 0)) ** 2; }
    act[i] = Math.sqrt(s) * HZ;
    prev = p;
  }
  // effort fills while moving and drains on the recovery time constant; breathing phase integrates its rate
  const effort = new Float32Array(n), phase = new Float64Array(n), still = new Float32Array(n);
  let e = 0, ph = 0, st = 0;
  for (let i = 0; i < n; i++) {
    const a = clamp01(act[i] / SETTLE.fast);
    e = Math.min(1, e + (BREATH.fill * a - e / BREATH.recover) / HZ);
    effort[i] = e;
    phase[i] = ph;
    ph += (BREATH.rest + (BREATH.hard - BREATH.rest) * e) / HZ;
    // still: under 40 deg/s; it takes half a second of stillness to count, and goes at once
    st = act[i] > 40 ? 0 : Math.min(1, st + 2 / HZ);
    still[i] = smooth(st);
  }
  // stops: a move over 120 deg/s that falls under 30 deg/s; its peak speed sizes the settle
  const stops: { t: number; k: number }[] = [];
  let peak = 0;
  for (let i = 0; i < n; i++) {
    peak = Math.max(peak, act[i]);
    if (act[i] < 30 && peak > 120) { stops.push({ t: i / HZ, k: clamp01(peak / SETTLE.fast) }); peak = 0; }
    if (act[i] < 30) peak = 0;
  }
  const read = (arr: ArrayLike<number>, t: number) => { const x = Math.min(Math.max(t * HZ, 0), n - 1.001), i = Math.floor(x); return arr[i] + (arr[i + 1] - arr[i]) * (x - i); };
  // one breath as 0..1: in over the first 40% of the cycle, out over the rest
  const lungs = (p: number) => { const u = p - Math.floor(p); return u < 0.4 ? 0.5 - 0.5 * Math.cos((Math.PI * u) / 0.4) : 0.5 + 0.5 * Math.cos((Math.PI * (u - 0.4)) / 0.6); };
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
    const e = read(effort, t), p = read(phase, t), stand = clamp01(standing(t));
    const amp = breath * (BREATH.depth + BREATH.pant * e);
    const b = lungs(p), late = lungs(p - 0.08);
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
  return Object.assign(life, { effort: (t: number) => read(effort, t), activity: (t: number) => read(act, t), stops, weight: weightAt });
}
