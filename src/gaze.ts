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
const SACCADE = 0.05, LEAD = 0.06;
export const EYE = { yaw: 40, pitch: 30 };
export const REST_PITCH = -4.5;

const hash = (n: number, k: number) => { const x = Math.sin(n * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
const offsetOf = (i: number, k = 1): [number, number] => (hash(i, 1) < 0.35 ? [0, 0] : [k * (hash(i, 2) < 0.5 ? -1 : 1) * (3 + 9 * hash(i, 3)), k * (-5 + 8 * hash(i, 4))]);
const smooth = (x: number) => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); };
const clamp1 = (x: number) => Math.max(-1, Math.min(1, x));

export function fixations(shifts: number[], end: number, { seed = 412, mean = 0.75, min = 0.25 } = {}) {
  const times: number[] = [];
  for (let t = 0, i = 1; t < end + 5; i++) { times.push(t); t += min - (mean - min) * Math.log(1 - hash(i, seed)); }
  for (const s of shifts) {
    for (let k = times.length - 1; k > 0; k--) if (Math.abs(times[k] - (s - LEAD)) < 0.2) times.splice(k, 1);
    times.push(s - LEAD);
  }
  return times.sort((a, b) => a - b);
}

// Gaze-evoked blinks: a big gaze shift brings a blink that starts with it (Evinger et al. 1994: 97% of shifts over 33
// degrees; rarer below, none here under 15). BLINK seconds long, its lid 0..1 as sin over that time. A blink that just
// happened makes the next one unlikely: opts.blinkedNear(t) true (the character's own blinks within half a second
// before t) skips the gaze blink, so the two never stack into a flutter.
export const BLINK = 0.15;
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
type GazeOpts = { seed?: number; mean?: number; min?: number; wander?: number; blinkedNear?: (t: number) => boolean };
export function gaze(shifts: number[], end: number, opts: GazeOpts = {}) {
  const quiet = opts.blinkedNear ?? (() => false);
  const times = fixations(shifts, end, opts);
  const wander = opts.wander ?? 1;
  const aimOf = (aim: (f: number, off: [number, number]) => [number, number], i: number) => aim(times[Math.max(0, i)], offsetOf(Math.max(0, i), wander));
  return (t: number, aim: (f: number, off: [number, number]) => [number, number]): { look: [number, number]; blink: number; lid: number } => {
    let lo = 0, hi = times.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (times[m] <= t) lo = m; else hi = m - 1; }
    const u = t - times[lo], k = smooth(u / SACCADE), now = aimOf(aim, lo);
    const was = u < BLINK ? aimOf(aim, lo - 1) : now;
    const jump = Math.hypot(now[0] - was[0], now[1] - was[1]);
    const blink = u < BLINK && lo > 0 && hash(lo, 9) < blinkChance(jump) && !quiet(times[lo]) ? Math.sin((Math.PI * u) / BLINK) : 0;
    // every eye jump in the last LID.up seconds adds its own lid step (fixations can come faster than the lids settle)
    const y = (i: number) => (i === lo ? now[1] : aimOf(aim, i)[1]) / EYE.pitch;
    let j = lo;
    while (j > 0 && times[j] > t - LID.up) j--;
    let lid = clamp1(y(j)), prev = lid;
    for (let i = j + 1; i <= lo; i++) { const yi = clamp1(y(i)); lid += (yi - prev) * lidStep(t - times[i], yi < prev); prev = yi; }
    return { look: [clamp1((was[0] + (now[0] - was[0]) * k) / EYE.yaw), clamp1((was[1] + (now[1] - was[1]) * k) / EYE.pitch)], blink, lid };
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
