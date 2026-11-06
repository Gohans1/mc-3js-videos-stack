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
export const BLINKS = {
  rate: { rest: 17, focus: 4.5, talk: 26 }, // a minute
  gap: 0.6, // s, never closer
  after: [0.4, 0.6], // s after a break
  chance: 0.75, // of a blink at a break
  down: 0.1, shut: 0.03, up: 0.22, // s
};

const hash = (n: number, k: number) => { const x = Math.sin(n * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
const smooth = (x: number) => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); };

// how shut the lids are u seconds into a blink
export const lidShut = (u: number, { down, shut, up } = BLINKS) =>
  u <= 0 || u >= down + shut + up ? 0 : u < down ? smooth(u / down) : u < down + shut ? 1 : 1 - smooth((u - down - shut) / up);

const HZ = 60;
export function blinks(end: number, { rate = (_t: number) => BLINKS.rate.rest, breaks = [] as number[], seed = 17 } = {}) {
  const due = breaks.map((b, i) => ({ t: b + BLINKS.after[0] + (BLINKS.after[1] - BLINKS.after[0]) * hash(i, seed + 3), go: hash(i, seed + 4) < BLINKS.chance }))
    .filter((d) => d.go).sort((a, b) => a.t - b.t);
  const times: number[] = [];
  // the rate integrates to a phase; a blink when it passes the next uneven threshold (gamma, shape 2, mean 1)
  const need = (i: number) => -0.5 * (Math.log(1 - hash(i, seed) * 0.999) + Math.log(1 - hash(i, seed + 1) * 0.999));
  let ph = 0, n = 0, last = -1e9, d = 0, th = need(0);
  for (let i = 0; i <= Math.ceil(end * HZ); i++) {
    const t = i / HZ;
    ph += rate(t) / 60 / HZ;
    while (d < due.length && due[d].t < t - 0.5) d++;
    const breakNow = d < due.length && due[d].t <= t;
    if ((ph >= th || breakNow) && t - last >= BLINKS.gap) {
      times.push(t); last = t; ph = 0; th = need(++n);
      if (breakNow) d++;
    }
  }
  const lids = (t: number) => {
    let lo = 0, hi = times.length - 1, v = 0;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (times[m] <= t) lo = m + 1; else hi = m - 1; }
    for (let k = Math.max(0, hi - 1); k <= hi; k++) v = Math.max(v, lidShut(t - times[k]));
    return v;
  };
  // a blink started within `within` seconds before t (gaze skips its own blink then, so they never stack)
  const near = (t: number, within = 0.5) => times.some((b) => b <= t && t - b < within);
  return Object.assign(lids, { times, near });
}
