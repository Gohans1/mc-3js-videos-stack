// Eyes that look as if someone is behind them, with no keys. Eyes never glide: they hold still on a point (a fixation)
// and jump to the next (a saccade, ~50 ms), every 0.25 s to a few seconds, exponentially spread ("Eyes Alive", Lee,
// Badler & Badler, SIGGRAPH 2002). A third of the jumps go back to the centre, the rest a few degrees off it. At each
// shift (a time the head starts turning to something new) a saccade fires 60 ms before it, so the eyes get there first
// and the head follows. Keep the target fixed in the world while the head turns and the eyes counter-turn (the
// vestibulo-ocular reflex) and end centred: that part is the caller's aim, which measures the target from the head as it
// is posed now.
//   const eyes = gaze(shifts, filmEnd);
//   const { look, blink } = eyes(t, (f, off) => { const a = target && anglesOf(targetInHeadAxes);
//     return a ? [a[0] + off[0] / 3, a[1] + off[1] / 3] : [off[0], REST_PITCH + off[1]]; })   (demo/main.ts does it on a rig)
// aim(f, off): where fixation f (its start time; look the target up at eyeTime(f, nextKey)) points, degrees
// [to his left, up] from the head's front; anglesOf turns a direction in head axes into that. look is the face's look,
// -1..1 each way (EYE: the degrees at the corner of the eye); blink (0..1) goes with the character's other blinks (max).
// lid: where the upper lids sit, in the same units as look[1]: they follow the eye's pitch about one to one but slower,
// as damped oscillations (Malbouisson et al., IOVS 2005: ~0.4 s down with a small overshoot, ~0.6 s up; Steptoe et al.,
// "Eyelid kinematics for virtual characters", 2010). lidOpen(lid) turns it into how much more open a face's lids are.
// opts.pursuit: spans [from, to] when the target moves (a crawling silverfish). Eyes can glide only then (smooth
// pursuit): ~0.15 s after it starts moving a saccade lands on it, then the eyes slide with it ~0.1 s behind at a gain
// under 1 (0.98 at 10 deg/s down to 0.75 at 60, Schalén 1980), and small catch-up saccades every 0.3-0.6 s take up the
// slip (de Brouwer et al. 2002). aim(f, off, "pursue") must return the target where it is at time f, not at eyeTime.
// opts.think(t) 0..1: thinking, the eyes look away from the target: up 39%, down 29%, to the side 31% of the time
// (cognitive gaze aversions, Andrist, Mutlu & Gleicher 2013); aim(f, off, "avert") adds those offsets in full.
// opts.freeze(t) 0..1 (src/freeze.ts): frozen in fear, the eyes hold on the target: fixations stray much less and shift
// at most every FREEZE.look seconds.
// mean and wander may be functions of time (explore.ts: a new scene is scanned with quick, wide jumps); opts.slow(t)
// stretches each saccade (drowsy.ts: sleepy eyes move slower).
import { BLINKS, lidShut } from "./blinks";
import { FREEZE } from "./freeze";

const SACCADE = 0.05, LEAD = 0.06;
export const PURSUIT = { start: 0.15, lag: 0.1, catchup: [0.3, 0.6] };
const gainOf = (degPerS: number) => Math.min(0.98, Math.max(0.7, 0.98 - 0.0046 * (degPerS - 10)));
// a thinking look-away: up, down or to the side, in degrees [to his left, up]
const avertOf = (i: number): [number, number] => {
  const h = hash(i, 5), s = hash(i, 6) < 0.5 ? -1 : 1, a = hash(i, 7);
  if (hash(i, 8) < 0.2) return [0, 0];
  return h < 0.39 ? [s * (2 + 6 * a), 10 + 8 * a] : h < 0.68 ? [s * (2 + 6 * a), -(8 + 6 * a)] : [s * (12 + 8 * a), -2 + 4 * a];
};
export const EYE = { yaw: 40, pitch: 30 };
export const REST_PITCH = -4.5;

const hash = (n: number, k: number) => { const x = Math.sin(n * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
const offsetOf = (i: number, k = 1): [number, number] => (hash(i, 1) < 0.35 ? [0, 0] : [k * (hash(i, 2) < 0.5 ? -1 : 1) * (3 + 9 * hash(i, 3)), k * (-5 + 8 * hash(i, 4))]);
const smooth = (x: number) => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); };
const clamp1 = (x: number) => Math.max(-1, Math.min(1, x));

type Span = [number, number];
const inSpan = (spans: Span[], t: number, pad = 0) => spans.some(([a, b]) => t >= a && t <= b + pad);
type Num = number | ((t: number) => number);
const at = (x: Num, t: number) => (typeof x === "function" ? x(t) : x);
export function fixations(shifts: number[], end: number, { seed = 412, mean = 0.75 as Num, min = 0.25, pursuit = [] as Span[], freeze = (_t: number): number => 0 } = {}) {
  let times: number[] = [];
  for (let t = 0, i = 1, kept = -1e9; t < end + 5; i++) {
    if (freeze(t) < 0.5 || t - kept >= FREEZE.look) { times.push(t); kept = t; }
    const m = at(mean, t), lo = Math.min(min, 0.8 * m);
    t += lo - (m - lo) * Math.log(1 - hash(i, seed));
  }
  // inside a pursuit the catch-up saccades are the only jumps
  times = times.filter((t) => !inSpan(pursuit, t, PURSUIT.lag));
  pursuit.forEach(([a, b], n) => { for (let t = a + PURSUIT.start, i = 0; t <= b; i++) { times.push(t); t += PURSUIT.catchup[0] + (PURSUIT.catchup[1] - PURSUIT.catchup[0]) * hash(i, 31 + n); } });
  for (const s of shifts.filter((x) => !inSpan(pursuit, x, PURSUIT.lag))) {
    for (let k = times.length - 1; k > 0; k--) if (Math.abs(times[k] - (s - LEAD)) < 0.2) times.splice(k, 1);
    times.push(s - LEAD);
  }
  return times.sort((a, b) => a - b);
}

// Gaze-evoked blinks: a big gaze shift brings a blink that starts with it (Evinger et al. 1994: 97% of shifts over 33
// degrees; rarer below, none here under 15), shaped like any blink (src/blinks.ts lidShut: fast down, slow up). A blink that just
// happened makes the next one unlikely: opts.blinkedNear(t) true (the character's own blinks within half a second
// before t) skips the gaze blink, so the two never stack into a flutter.
export const BLINK = BLINKS.down + BLINKS.shut + BLINKS.up;
const blinkChance = (deg: number) => Math.min(1, Math.max(0, (deg - 15) / (33 - 15)));

// The upper lid's step response to an eye jump of 1, u seconds after it: down underdamped (overshoots ~3%), up critical
export const LID = { down: 0.39, up: 0.6, open: 0.45, raise: 0.1 }; // s, s, openness lost at full down-gaze, gained at full up
const rawStep = (u: number, down: boolean) => {
  if (down) { const z = 0.75, w = 4 / (z * LID.down), wd = w * Math.sqrt(1 - z * z); return 1 - Math.exp(-z * w * u) * (Math.cos(wd * u) + (z / Math.sqrt(1 - z * z)) * Math.sin(wd * u)); }
  const w = 6 / LID.up; return 1 - Math.exp(-w * u) * (1 + w * u);
};
// scaled to land exactly at LID.up seconds, so the lid never pops when the step is dropped
const lidStep = (u: number, down: boolean) => (u <= 0 ? 0 : u >= LID.up ? 1 : rawStep(u, down) / rawStep(LID.up, down));
// how much to add to a face's eye openness for upper lids at `lid` (look units): looking down closes them a lot, up a little
export const lidOpen = (lid: number) => (lid < 0 ? LID.open * lid : LID.raise * lid);

// wander scales how far fixations stray from the target (Laban's indirect space > 1, direct < 1; src/effort.ts)
type GazeOpts = { seed?: number; mean?: Num; min?: number; wander?: Num; slow?: (t: number) => number; blinkedNear?: (t: number) => boolean; pursuit?: Span[]; think?: (t: number) => number; freeze?: (t: number) => number };
// body: measure from the body's front with the head straight, at time f, instead of from the head as posed now; used to
// size gaze blinks, which must not change while the head turns (an aim that ignores it still works, less steadily)
export type Aim = (f: number, off: [number, number], mode?: "pursue" | "avert", body?: boolean) => [number, number];
export function gaze(shifts: number[], end: number, opts: GazeOpts = {}) {
  const quiet = opts.blinkedNear ?? (() => false), pursuit = opts.pursuit ?? [], think = opts.think ?? (() => 0);
  const times = fixations(shifts, end, opts);
  const wander = opts.wander ?? 1, slow = opts.slow ?? (() => 1), frozen = opts.freeze ?? (() => 0);
  const chase = times.map((f) => inSpan(pursuit, f - PURSUIT.start + 1e-6, PURSUIT.lag) && pursuit.some(([a]) => f >= a + PURSUIT.start - 1e-6));
  // where fixation i points at time t: a held point, or on a pursuit the target sliding on from where the saccade put it
  const eyeOf = (aim: Aim, i: number, t: number, body = false): [number, number] => {
    i = Math.max(0, i);
    const f = times[i];
    if (!chase[i]) return think(f) > 0.5 ? aim(f, avertOf(i), "avert", body) : aim(f, offsetOf(i, at(wander, f) * (1 - FREEZE.wander * frozen(f))), undefined, body);
    if (body) return aim(f, [0, 0], "pursue", true);
    const L = PURSUIT.lag, z: [number, number] = [0, 0], base = aim(f - L, z, "pursue"), cur = aim(t - L, z, "pursue"), back = aim(t - L - 0.05, z, "pursue");
    const g = gainOf(Math.hypot(cur[0] - back[0], cur[1] - back[1]) / 0.05);
    return [base[0] + g * (cur[0] - base[0]), base[1] + g * (cur[1] - base[1])];
  };
  return (t: number, aim: Aim): { look: [number, number]; blink: number; lid: number; pursuing: boolean; thinking: boolean } => {
    let lo = 0, hi = times.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (times[m] <= t) lo = m; else hi = m - 1; }
    const u = t - times[lo], k = smooth(u / (SACCADE * slow(times[lo]))), now = eyeOf(aim, lo, t);
    const was = u < SACCADE * 3 ? eyeOf(aim, lo - 1, t) : now;
    // the jump is measured from the body at the time of each fixation (aim's body), so it holds still while the head
    // turns, and the blink runs its course even when the next fixation comes before it is over. It closes further the
    // bigger the jump (always fully past 33 deg, never under 15); that depth curve is a choice, not measured.
    let blink = 0;
    for (let i = lo; i > 0 && t - times[i] < BLINK; i--) {
      if (quiet(times[i])) continue;
      const a = eyeOf(aim, i, t, true), b = eyeOf(aim, i - 1, t, true);
      const depth = Math.min(1, Math.max(0, 2 * blinkChance(Math.hypot(a[0] - b[0], a[1] - b[1])) - hash(i, 9)));
      blink = Math.max(blink, depth * lidShut(t - times[i]));
    }
    // every eye jump in the last LID.up seconds adds its own lid step (fixations can come faster than the lids settle)
    const y = (i: number) => (i === lo ? now[1] : eyeOf(aim, i, t)[1]) / EYE.pitch;
    let j = lo;
    while (j > 0 && times[j] > t - LID.up) j--;
    let lid = clamp1(y(j)), prev = lid;
    for (let i = j + 1; i <= lo; i++) { const yi = clamp1(y(i)); lid += (yi - prev) * lidStep(t - times[i], yi < prev); prev = yi; }
    return { look: [clamp1((was[0] + (now[0] - was[0]) * k) / EYE.yaw), clamp1((was[1] + (now[1] - was[1]) * k) / EYE.pitch)], blink, lid, pursuing: chase[lo], thinking: !chase[lo] && think(times[lo]) > 0.5 };
  };
}

// The time on the look keys a fixation starting at f looks at: the end of the turn it starts (nextKey(x): the first key
// time after x), at most half a second on
export const eyeTime = (f: number, nextKey: (x: number) => number | undefined) => { const x = f + LEAD; return Math.min(x + 0.5, Math.max(x, nextKey(x) ?? x)); };

// A point from the eyes in the head's own axes (x his left, y up, z forward, metres) as [degrees to his left, degrees up];
// null within `near` of the eyes, where no eye can hold it (aim straight ahead then): film look points meant for the
// neck can sit right at the face (a Minecraft player reads with the page at his nose). A point behind him gives angles
// past 90 degrees, which the look clamps to the corner of the eye: as far round as the eyes go.
export const anglesOf = ([x, y, z]: number[], near = 0.15): [number, number] | null =>
  Math.hypot(x, y, z) < near ? null : [(Math.atan2(x, z) * 180) / Math.PI, (Math.atan2(y, Math.hypot(x, z)) * 180) / Math.PI];
