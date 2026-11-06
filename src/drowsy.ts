// Sleepy eyes, for waking up or nodding off. What changes reliably with drowsiness is the shape of the blinks, not how
// many there are (Caffier et al. 2003: 16.3 a minute alert, 15.8 drowsy; alert blinks ~0.2 s, closing 63 ms, reopening
// 138 ms). Drowsy blinks are longer, mostly because the lids reopen late and slowly (total blink 0.46 s rested, 0.87 s
// after 30 h awake: Ftouni et al. 2013; the reopening is what slows, Johns 2003), some stay shut over half a second (long
// closures), and many don't close all the way (partial blinks, Johns 2003). The lids also sit lower between blinks
// (PERCLOS, the share of time they are mostly closed, is the standard sleepiness measure) and the eyes jump slower
// (saccade peak velocity falls with sleepiness: De Gennaro et al. 2000, Hirvonen et al. 2010).
//   const d = drowsiness([{ t: 0, k: 1 }, { t: 8, k: 0.3 }, { t: 14, k: 0 }]);
//   const lids = blinks(end, { drowsy: d, asleep: [[0, 2.5]] });   open = mood.open - lids.droop(t)
//   gaze(shifts, end, { slow: (t) => 1 + DROWSY.slow * d(t) })
// d(t): 0 wide awake .. 1 barely awake. Eyes and lids only, so it is safe over mocap clips.
export const DROWSY = {
  down: 0.3, up: 1, shut: 0.1, // at full drowsiness: closing x1.3, reopening x2, +0.1 s shut (a blink about twice as long)
  long: 0.25, longShut: [0.5, 1.2], // chance of a long closure, and how long it stays shut (s)
  partial: 0.3, depth: [0.55, 0.85], // chance of a partial blink, and how far it closes
  droop: 0.35, // openness lost between blinks
  slow: 0.6, // saccades this much longer
  wake: 1.5, // the first opening after sleep, times a drowsy reopening
  sink: 3, // dozing off, the lids close this many times slower than a drowsy blink's closing
};

export type BlinkShape = { down: number; shut: number; up: number; depth: number };
// the shape of one blink at drowsiness d; r: three numbers 0..1 that make it this blink (from a hash)
export function drowsyBlink(base: { down: number; shut: number; up: number }, d: number, r: [number, number, number], o = DROWSY): BlinkShape {
  const k = Math.min(1, Math.max(0, d));
  const s: BlinkShape = { down: base.down * (1 + o.down * k), shut: base.shut + o.shut * k, up: base.up * (1 + o.up * k), depth: 1 };
  if (r[0] < o.long * k) s.shut = o.longShut[0] + (o.longShut[1] - o.longShut[0]) * r[1];
  else if (r[0] > 1 - o.partial * k) s.depth = o.depth[0] + (o.depth[1] - o.depth[0]) * r[2];
  return s;
}

const smooth = (x: number) => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); };
// a level from keys { t, k }, eased between them, held before the first and after the last
export function drowsiness(keys: { t: number; k: number }[]) {
  return (t: number) => {
    if (!keys.length) return 0;
    if (t <= keys[0].t) return keys[0].k;
    for (let i = 1; i < keys.length; i++) if (t < keys[i].t) { const a = keys[i - 1], b = keys[i]; return a.k + (b.k - a.k) * smooth((t - a.t) / (b.t - a.t)); }
    return keys[keys.length - 1].k;
  };
}
