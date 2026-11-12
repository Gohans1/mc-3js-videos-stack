// Noticing: something appears or moves at the edge of his view and his eyes go to it on their own, ~0.2 s later (a
// reflexive saccade to an abrupt onset, Theeuwes et al. 1998), the head after them, a short look, then back to what he
// was doing. No flinch: that is a startle (src/startle.ts), for a sudden loud cue. Things that appear, move or come at
// him pull the eyes; things going away do not (Franconeri & Simons 2003). The same thing again in the same place pulls
// less each time (capture fades with repeats, Theeuwes 2008: ~28% on the surprise trial when busy, less after).
//   const glance = notice([{ t: 14, at: [x, y, z] }]);   look = glance(t) blended over the look   gaze shifts += glance.shifts
// k: 0..1, how much it stands out and how free his attention is (1: idle and it's sudden; 0.3: busy with something).
import { hash } from "./hash";
export const NOTICE = {
  latency: 0.2,
  turn: 0.25,
  hold: [0.6, 1.1],
  back: 0.45, // s
  repeat: 0.55,
  near: 1,
  memory: 60, // each earlier one within `near` m and `memory` s multiplies the pull by this
};
export const PULL = { onset: 1, moving: 1, looming: 1, receding: 0 };
export type Event = {
  t: number;
  at: [number, number, number];
  k?: number;
  kind?: keyof typeof PULL;
};

// gaze.ts fires the saccade this long before a shift: the head starts after the eyes are there
const EYES_FIRST = 0.06;
const smooth = (x: number) => {
  const u = Math.min(1, Math.max(0, x));
  return u * u * (3 - 2 * u);
};
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function notice(events: Event[], { seed = 5 } = {}) {
  const ev = [...events].sort((a, b) => a.t - b.t);
  const all = ev.map((e, i) => {
    const n = ev
      .slice(0, i)
      .filter((p) => e.t - p.t < NOTICE.memory && dist(p.at, e.at) < NOTICE.near).length;
    const pull = Math.min(1, Math.max(0, e.k ?? 1)) * PULL[e.kind ?? "onset"] * NOTICE.repeat ** n;
    const go = e.t + NOTICE.latency + EYES_FIRST,
      hold = NOTICE.hold[0] + (NOTICE.hold[1] - NOTICE.hold[0]) * hash(i, seed + 1);
    return { ...e, pull, looks: hash(i, seed) < pull, go, off: go + NOTICE.turn + hold };
  });
  const glances = all.filter((g) => g.looks);
  const at = (t: number): { at: [number, number, number]; w: number } | null => {
    for (const g of glances) {
      if (t < g.go || t > g.off + NOTICE.back) continue;
      return {
        at: g.at,
        w: smooth((t - g.go) / NOTICE.turn) * (1 - smooth((t - g.off) / NOTICE.back)),
      };
    }
    return null;
  };
  // the head turns start here: pass them to gaze as shifts so the eyes jump first
  return Object.assign(at, { events: all, shifts: glances.flatMap((g) => [g.go, g.off]) });
}
