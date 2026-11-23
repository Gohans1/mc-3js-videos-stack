import { BLINKS, lidShut } from "./blinks";
import { FREEZE } from "./freeze";
import { hash } from "./hash";

const SACCADE = 0.05,
  LEAD = 0.06;
export const PURSUIT = { start: 0.15, lag: 0.1, catchup: [0.3, 0.6] };
const gainOf = (degPerS: number) => Math.min(0.98, Math.max(0.7, 0.98 - 0.0046 * (degPerS - 10)));
const avertOf = (i: number): [number, number] => {
  const h = hash(i, 5),
    s = hash(i, 6) < 0.5 ? -1 : 1,
    a = hash(i, 7);
  if (hash(i, 8) < 0.2) return [0, 0];
  return h < 0.39
    ? [s * (2 + 6 * a), 10 + 8 * a]
    : h < 0.68
      ? [s * (2 + 6 * a), -(8 + 6 * a)]
      : [s * (12 + 8 * a), -2 + 4 * a];
};
export const EYE = { yaw: 40, pitch: 30 };
export const REST_PITCH = -4.5;

const offsetOf = (i: number, k = 1): [number, number] =>
  hash(i, 1) < 0.35
    ? [0, 0]
    : [k * (hash(i, 2) < 0.5 ? -1 : 1) * (3 + 9 * hash(i, 3)), k * (-5 + 8 * hash(i, 4))];
const smooth = (x: number) => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * (3 - 2 * u);
};
const clamp1 = (x: number) => Math.max(-1, Math.min(1, x));

type Span = [number, number];
const inSpan = (spans: Span[], t: number, pad = 0) =>
  spans.some(([a, b]) => t >= a && t <= b + pad);
type Num = number | ((t: number) => number);
const at = (x: Num, t: number) => (typeof x === "function" ? x(t) : x);
export function fixations(
  shifts: number[],
  end: number,
  {
    seed = 412,
    mean = 0.75 as Num,
    min = 0.25,
    pursuit = [] as Span[],
    freeze = (_t: number): number => 0,
  } = {},
) {
  let times: number[] = [];
  for (let t = 0, i = 1, kept = -1e9; t < end + 5; i++) {
    if (freeze(t) < 0.5 || t - kept >= FREEZE.look) {
      times.push(t);
      kept = t;
    }
    const m = at(mean, t),
      lo = Math.min(min, 0.8 * m);
    t += lo - (m - lo) * Math.log(1 - hash(i, seed));
  }
  times = times.filter((t) => !inSpan(pursuit, t, PURSUIT.lag));
  pursuit.forEach(([a, b], n) => {
    for (let t = a + PURSUIT.start, i = 0; t <= b; i++) {
      times.push(t);
      t += PURSUIT.catchup[0] + (PURSUIT.catchup[1] - PURSUIT.catchup[0]) * hash(i, 31 + n);
    }
  });
  for (const s of shifts.filter((x) => !inSpan(pursuit, x, PURSUIT.lag))) {
    for (let k = times.length - 1; k > 0; k--)
      if (Math.abs(times[k] - (s - LEAD)) < 0.2) times.splice(k, 1);
    times.push(s - LEAD);
  }
  return times.sort((a, b) => a - b);
}

export const BLINK = BLINKS.down + BLINKS.shut + BLINKS.up;
const blinkChance = (deg: number) => Math.min(1, Math.max(0, (deg - 15) / (33 - 15)));

export const LID = { down: 0.39, up: 0.6, open: 0.45, raise: 0.1 };
const rawStep = (u: number, down: boolean) => {
  if (down) {
    const z = 0.75,
      w = 4 / (z * LID.down),
      wd = w * Math.sqrt(1 - z * z);
    return (
      1 - Math.exp(-z * w * u) * (Math.cos(wd * u) + (z / Math.sqrt(1 - z * z)) * Math.sin(wd * u))
    );
  }
  const w = 6 / LID.up;
  return 1 - Math.exp(-w * u) * (1 + w * u);
};
const lidStep = (u: number, down: boolean) =>
  u <= 0 ? 0 : u >= LID.up ? 1 : rawStep(u, down) / rawStep(LID.up, down);
export const lidOpen = (lid: number) => (lid < 0 ? LID.open * lid : LID.raise * lid);

type GazeOpts = {
  seed?: number;
  mean?: Num;
  min?: number;
  wander?: Num;
  slow?: (t: number) => number;
  blinkedNear?: (t: number) => boolean;
  pursuit?: Span[];
  think?: (t: number) => number;
  freeze?: (t: number) => number;
};
export type Aim = (
  f: number,
  off: [number, number],
  mode?: "pursue" | "avert",
  body?: boolean,
) => [number, number];
export function gaze(shifts: number[], end: number, opts: GazeOpts = {}) {
  const quiet = opts.blinkedNear ?? (() => false),
    pursuit = opts.pursuit ?? [],
    think = opts.think ?? (() => 0);
  const times = fixations(shifts, end, opts);
  const wander = opts.wander ?? 1,
    slow = opts.slow ?? (() => 1),
    frozen = opts.freeze ?? (() => 0);
  const chase = times.map(
    (f) =>
      inSpan(pursuit, f - PURSUIT.start + 1e-6, PURSUIT.lag) &&
      pursuit.some(([a]) => f >= a + PURSUIT.start - 1e-6),
  );
  const eyeOf = (aim: Aim, i: number, t: number, body = false): [number, number] => {
    i = Math.max(0, i);
    const f = times[i];
    if (!chase[i])
      return think(f) > 0.5
        ? aim(f, avertOf(i), "avert", body)
        : aim(f, offsetOf(i, at(wander, f) * (1 - FREEZE.wander * frozen(f))), undefined, body);
    if (body) return aim(f, [0, 0], "pursue", true);
    const L = PURSUIT.lag,
      z: [number, number] = [0, 0],
      base = aim(f - L, z, "pursue"),
      cur = aim(t - L, z, "pursue"),
      back = aim(t - L - 0.05, z, "pursue");
    const g = gainOf(Math.hypot(cur[0] - back[0], cur[1] - back[1]) / 0.05);
    return [base[0] + g * (cur[0] - base[0]), base[1] + g * (cur[1] - base[1])];
  };
  return (
    t: number,
    aim: Aim,
  ): {
    look: [number, number];
    blink: number;
    lid: number;
    pursuing: boolean;
    thinking: boolean;
  } => {
    let lo = 0,
      hi = times.length - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (times[m] <= t) lo = m;
      else hi = m - 1;
    }
    const u = t - times[lo],
      k = smooth(u / (SACCADE * slow(times[lo]))),
      now = eyeOf(aim, lo, t);
    const was = u < SACCADE * 3 ? eyeOf(aim, lo - 1, t) : now;
    let blink = 0;
    for (let i = lo; i > 0 && t - times[i] < BLINK; i--) {
      if (quiet(times[i])) continue;
      const a = eyeOf(aim, i, t, true),
        b = eyeOf(aim, i - 1, t, true);
      const depth = Math.min(
        1,
        Math.max(0, 2 * blinkChance(Math.hypot(a[0] - b[0], a[1] - b[1])) - hash(i, 9)),
      );
      blink = Math.max(blink, depth * lidShut(t - times[i]));
    }
    const y = (i: number) => (i === lo ? now[1] : eyeOf(aim, i, t)[1]) / EYE.pitch;
    let j = lo;
    while (j > 0 && times[j] > t - LID.up) j--;
    let lid = clamp1(y(j)),
      prev = lid;
    for (let i = j + 1; i <= lo; i++) {
      const yi = clamp1(y(i));
      lid += (yi - prev) * lidStep(t - times[i], yi < prev);
      prev = yi;
    }
    return {
      look: [
        clamp1((was[0] + (now[0] - was[0]) * k) / EYE.yaw),
        clamp1((was[1] + (now[1] - was[1]) * k) / EYE.pitch),
      ],
      blink,
      lid,
      pursuing: chase[lo],
      thinking: !chase[lo] && think(times[lo]) > 0.5,
    };
  };
}

export const eyeTime = (f: number, nextKey: (x: number) => number | undefined) => {
  const x = f + LEAD;
  return Math.min(x + 0.5, Math.max(x, nextKey(x) ?? x));
};

export const anglesOf = ([x, y, z]: number[], near = 0.15): [number, number] | null =>
  Math.hypot(x, y, z) < near
    ? null
    : [(Math.atan2(x, z) * 180) / Math.PI, (Math.atan2(y, Math.hypot(x, z)) * 180) / Math.PI];
