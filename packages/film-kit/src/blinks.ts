// Spontaneous blinks the way a person's come, not on a metronome. The rate follows what he is doing: ~17 a minute at
// rest, ~4.5 while the eyes are busy (reading, tracking, staring at a threat), ~26 talking (Bentivoglio et al. 1997).
// They are held back while something needs watching and come at its breaks instead: 0.4-0.6 s after an action ends,
// a scene changes or a look settles (Nakano et al. 2009; at punctuation in reading, Hall 1945). Gaps between them are
// uneven (a gamma of shape 2 here: some quick pairs, some long stares) and never under `gap`. Each blink closes fast and
// opens slowly: down ~100 ms, shut ~30 ms, up ~220 ms (high-speed video, Kaneko et al. 2008; the down phase is about
// twice as fast as the up, Evinger et al. 1991).
//   const lids = blinks(end, { rate: (t) => (busy(t) ? BLINKS.rate.focus : BLINKS.rate.rest), breaks: [2.4, 7.1] });
//   blink = max(blink, lids(t))   (0 open .. 1 shut, the face's blink);   gaze(..., { blinkedNear: lids.near })
// rate(t): blinks a minute; breaks: times something ends (the blink lands 0.4-0.6 s later, `chance` of the time).
// drowsy(t) 0..1 and asleep spans: sleepy blinks and the lids shut while asleep (drowsy.ts); lids.droop(t) is how much
// openness the face loses between blinks. quiet spans: no blink starts in them (a yawn's own lids close and open the
// eyes: a blink on top would flicker them).
import { drowsyBlink, DROWSY, type BlinkShape } from "./drowsy";
import { hash } from "./hash";

export const BLINKS = {
  rate: { rest: 17, focus: 4.5, talk: 26 }, // a minute
  gap: 0.6, // s, never closer
  after: [0.4, 0.6], // s after a break
  chance: 0.75, // of a blink at a break
  down: 0.1, shut: 0.03, up: 0.22, // s
};

const smooth = (x: number) => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); };

// how shut the lids are u seconds into a blink
export const lidShut = (u: number, { down, shut, up, depth = 1 }: { down: number; shut: number; up: number; depth?: number } = BLINKS) =>
  depth * (u <= 0 || u >= down + shut + up ? 0 : u < down ? smooth(u / down) : u < down + shut ? 1 : 1 - smooth((u - down - shut) / up));

const HZ = 60;
type Span = [number, number];
export function blinks(end: number, { rate = (_t: number) => BLINKS.rate.rest, breaks = [] as number[], seed = 17, drowsy = (_t: number) => 0, asleep = [] as Span[], quiet = [] as Span[] } = {}) {
  const due = breaks.map((b, i) => ({ t: b + BLINKS.after[0] + (BLINKS.after[1] - BLINKS.after[0]) * hash(i, seed + 3), go: hash(i, seed + 4) < BLINKS.chance }))
    .filter((d) => d.go).sort((a, b) => a.t - b.t);
  const sleeping = (t: number) => asleep.some(([a, b]) => t >= a && t < b);
  const sinking = (t: number) => asleep.some(([a]) => a > 0 && t < a && t >= a - 1);
  const times: number[] = [], shapes: BlinkShape[] = [];
  // the rate integrates to a phase; a blink when it passes the next uneven threshold (gamma, shape 2, mean 1)
  const need = (i: number) => -0.5 * (Math.log(1 - hash(i, seed) * 0.999) + Math.log(1 - hash(i, seed + 1) * 0.999));
  let ph = 0, n = 0, free = -1e9, d = 0, th = need(0);
  for (let i = 0; i <= Math.ceil(end * HZ); i++) {
    const t = i / HZ;
    if (sleeping(t)) { ph = 0; free = t + BLINKS.gap; continue; }
    ph += rate(t) / 60 / HZ;
    while (d < due.length && due[d].t < t - 0.5) d++;
    const breakNow = d < due.length && due[d].t <= t;
    if ((ph >= th || breakNow) && t >= free && !sinking(t) && !quiet.some(([a, b]) => t >= a && t < b)) {
      const s = drowsyBlink(BLINKS, drowsy(t), [hash(n, seed + 5), hash(n, seed + 6), hash(n, seed + 7)]);
      times.push(t); shapes.push(s); ph = 0; th = need(++n);
      // never closer than `gap`, and not before this one is open again
      free = t + Math.max(BLINKS.gap, s.down + s.shut + s.up + 0.15);
      if (breakNow) d++;
    }
  }
  // waking: the lids come up at a slow drowsy reopening from the end of each asleep span; dozing off they sink slowly
  // into its start (a span from 0 is already asleep)
  const wakeUp = (b: number) => BLINKS.up * (1 + DROWSY.up * drowsy(b)) * DROWSY.wake;
  const sink = (a: number) => BLINKS.down * (1 + DROWSY.down * drowsy(a)) * DROWSY.sink;
  const lids = (t: number) => {
    if (sleeping(t)) return 1;
    let lo = 0, hi = times.length - 1, v = 0;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (times[m] <= t) lo = m + 1; else hi = m - 1; }
    if (hi >= 0) v = lidShut(t - times[hi], shapes[hi]);
    for (const [a, b] of asleep) {
      if (t >= b && t < b + wakeUp(b)) v = Math.max(v, 1 - smooth((t - b) / wakeUp(b)));
      if (a > 0 && t < a && t >= a - sink(a)) v = Math.max(v, smooth((t - a + sink(a)) / sink(a)));
    }
    return v;
  };
  // a blink started within `within` seconds before t (gaze skips its own blink then, so they never stack)
  const near = (t: number, within = 0.5) => times.some((b) => b <= t && t - b < within);
  const droop = (t: number) => DROWSY.droop * Math.min(1, Math.max(0, drowsy(t)));
  return Object.assign(lids, { times, shapes, near, droop });
}
