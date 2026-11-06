// Springs as pure functions of film time. pmndrs/math's spring.update is the exact solution of a damped spring over any
// step (one 0.7 s step lands where 700 steps of 1 ms do), so the state at a key carries to the next key in one step, and
// any t is one more step from the last key before it: no frame-by-frame state, any frame renders on its own.
//   springTrack: a value that springs to each new target and can be kicked (an impact adds velocity).
//   follow: a value that chases a moving target (a prop that lags a hand, a camera that trails a head), baked once.
// smooth is about the time to settle (pmndrs smoothTime); ratio 1 = no overshoot, < 1 bouncy, > 1 sluggish.
import { spring } from "math/time";

export type SpringKey = { t: number; to?: number; kick?: number };
export type SpringOpts = { from?: number; smooth?: number; ratio?: number };
type State = { value: number; velocity: number };

const step = (s: State, target: number, smooth: number, ratio: number, dt: number) => {
  const next = { value: s.value, velocity: s.velocity };
  if (dt > 0) spring.update(next, target, smooth, ratio, dt);
  return next;
};

export function springTrack(input: SpringKey[], { from, smooth = 0.25, ratio = 1 }: SpringOpts = {}) {
  const keys = [...input].sort((a, b) => a.t - b.t);
  if (!keys.length) throw new Error("springTrack: no keys");
  const start = from ?? keys.find((k) => k.to !== undefined)?.to ?? 0;
  // state and target right after each key
  const at: { t: number; s: State; target: number }[] = [];
  let s: State = { value: start, velocity: 0 }, target = start, t0 = keys[0].t;
  for (const k of keys) {
    s = step(s, target, smooth, ratio, k.t - t0);
    if (k.to !== undefined) target = k.to;
    if (k.kick) s = { value: s.value, velocity: s.velocity + k.kick };
    at.push({ t: k.t, s, target });
    t0 = k.t;
  }
  const state = (t: number): State => {
    if (t < at[0].t) return { value: start, velocity: 0 };
    let lo = 0, hi = at.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (at[mid].t <= t) lo = mid; else hi = mid - 1; }
    return step(at[lo].s, at[lo].target, smooth, ratio, t - at[lo].t);
  };
  return Object.assign((t: number) => state(t).value, { vel: (t: number) => state(t).velocity });
}

// target(t) is sampled at hz from `from` to `to` (seconds) and the spring stepped through it once; later calls read the
// baked samples. Before `from` the value is the target's own.
export function follow(target: (t: number) => number, { from, to, hz = 120, smooth = 0.15, ratio = 1 }: { from: number; to: number; hz?: number; smooth?: number; ratio?: number }) {
  const n = Math.ceil((to - from) * hz) + 1, dt = 1 / hz;
  const x = new Float64Array(n), v = new Float64Array(n);
  let s: State = { value: target(from), velocity: 0 };
  for (let i = 0; i < n; i++) {
    if (i) s = step(s, target(from + (i - 1) * dt), smooth, ratio, dt);
    x[i] = s.value; v[i] = s.velocity;
  }
  const read = (arr: Float64Array, t: number) => {
    if (t <= from) return arr === x ? target(t) : 0;
    const f = Math.min((t - from) * hz, n - 1), i = Math.min(Math.floor(f), n - 2), u = f - i;
    return arr[i] + (arr[i + 1] - arr[i]) * u;
  };
  return Object.assign((t: number) => read(x, t), { vel: (t: number) => read(v, t) });
}
