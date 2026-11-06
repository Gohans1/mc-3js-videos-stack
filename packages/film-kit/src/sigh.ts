// Sighs: a deep breath the body takes by itself every few minutes, and more often in relief. A sigh starts as a normal
// breath, then, before breathing out, takes a second breath on top of it, two to five times a normal breath in all; a
// long breath out follows and then a short pause (Li et al. 2016 Nature; Ramirez 2014; Current Biology primer 2017). At
// rest people sigh about a dozen times an hour (every ~5 min; 9-10 an hour measured at rest, Bendixen 1964), and more in
// relief: 0.51 a minute after a stressor ends against 0.29 during it (Vlemincx et al. 2009). The let-go drops the
// shoulders and chest below rest, the same relief shape idle.ts uses after a fright.
//   idle(poseAt, end, { sighs: [{ t: 12 }, ...sighTimes(end, (t) => SIGH.rate.rest)] })
//   life.breath(t) === "sigh" while one runs; life.events: the sigh's breath out, for a sound
// Breath only (chest, shoulders), so it rides on top of a mocap clip's body only where idle's breath is on (faded over
// clips, as idle is); over a clip that is a sigh (Mixamo's Sighing_In_Relief) leave it out.
export const SIGH = {
  first: 1.4, // s, the normal breath in
  second: 0.7, // s, the breath on top of it
  peak: 2.4, // lungs at the top, in normal breaths
  hold: 0.25, // s at the top
  out: 2.2, // s, the long breath out
  low: -0.3, // lungs at the bottom of the let-go (shoulders below rest)
  pause: 1, // s of no breath after, then breathing starts again
  rate: { rest: 12, relief: 30 }, // an hour (relief: Vlemincx's 0.51 a minute)
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const minJerk = (u: number) => { const x = clamp01(u); return x * x * x * (10 + x * (-15 + 6 * x)); };

// lungs over one sigh from `from` (where the breath was when it began), in normal-breath units; u in seconds since start
export function sighLungs(u: number, from: number, k = 1, o = SIGH) {
  const a = o.first, b = a + o.second, c = b + o.hold, d = c + o.out, top = 1 + (o.peak - 1) * k, low = o.low * k;
  if (u < a) return from + (1 - from) * minJerk(u / a);
  if (u < b) return 1 + (top - 1) * minJerk((u - a) / o.second);
  if (u < c) return top;
  if (u < d) return top + (low - top) * (1 - (1 - (u - c) / o.out) ** 2);
  return low * (1 - minJerk((u - d) / o.pause));
}
export const sighLength = (o = SIGH) => o.first + o.second + o.hold + o.out + o.pause;

const hash = (n: number, k: number) => { const x = Math.sin(n * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
// sighs that come by themselves: rate(t) an hour (SIGH.rate.rest, .relief), gaps uneven (exponential), never closer
// than 20 s; none while busy(t)
export function sighTimes(end: number, rate: (t: number) => number, { seed = 9, from = 0, busy = (_t: number) => false } = {}) {
  const out: { t: number; k: number }[] = [];
  let t = from, i = 0;
  for (;;) {
    t += Math.max(20, (-Math.log(1 - 0.999 * hash(i, seed)) * 3600) / Math.max(0.1, rate(t)));
    if (t > end - sighLength()) break;
    if (!busy(t)) out.push({ t, k: 0.7 + 0.3 * hash(i, seed + 1) });
    i++;
  }
  return out;
}
