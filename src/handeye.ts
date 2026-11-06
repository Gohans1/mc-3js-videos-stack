// The eyes lead the hands. Before a hand moves to take or put something, the eyes go to that thing first: they land on
// it ~0.5 s before the hand starts (0.56 s on average making tea, Land et al. 1999), stay while the hand travels, and
// leave just before it arrives (median 0.16 s before contact, Johansson et al. 2001), for the next thing the hands will
// need. The moving hand itself is never looked at. Look-aheads to an object a second or so before it is needed are
// common too (Pelz & Canosa 2001), so a next reach that comes soon pulls the eyes on early.
//   const R = reaches((t) => handInBodyAxes(t), end, { rest });   lookKeys = handEye(R.map(toWorld))
// reaches() finds the reaches in any hand path (keyed IK or a mocap clip's): a move of over `move` metres that ends, by
// stopping or by slowing hard (a button pressed and let go), out where things are reached for: in front of him, low,
// high or wide (OUT, for a 1.8 m figure with his feet at the origin). A hand that goes to his own body (a startle's hands
// to the chest, a scratch of the head) or back to where it hangs is not a reach, and gets no look. A startle's flung
// arms also end out in front, so over mocap pass `spans`: the clips where he takes or touches something (keyed hand
// IK targets are reaches by definition). handEye() turns
// them into look keys ({ t, at }; at null is "no look"), the format film look keys use, for where nothing else is keyed. On a mocap clip the actor's head already does this: give
// the keys to the eyes, and turn the clip's head only by what the eyes can't cover (past ~20 deg the head takes the
// rest, Freedman 2008).
export const HANDEYE = {
  lead: 0.5, leave: 0.16, turn: 0.3, // s: eyes on it before the hand starts, off it before the hand lands, a head turn
  dwell: 0.5, next: 1.5, // s: with nothing next, stay this long after it lands; a next reach this soon pulls the eyes on
  move: 0.15, still: 0.1, rest: 0.25, // m, m/s, m: a reach moves this far, has stopped under this speed, ends this far from the hanging hand
  slow: 0.3, // a move also ends where it slows under this share of its peak speed, at a low point
};
// where a reaching hand ends, in his own axes (x his left, y up, z forward, metres from his feet)
export const OUT = { front: 0.25, low: 0.45, high: 1.95, side: 0.6 };
export const isOut = ([x, y, z]: number[]) => z > OUT.front || y < OUT.low || y > OUT.high || Math.abs(x) > OUT.side;

type V3 = [number, number, number];
export type Reach = { start: number; arrive: number; at: V3 };
const HZ = 60;
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function reaches(handAt: (t: number) => V3, end: number, { rest = null as V3 | null, move = HANDEYE.move, still = HANDEYE.still, away = isOut, spans = null as [number, number][] | null } = {}): Reach[] {
  const n = Math.ceil(end * HZ), P = Array.from({ length: n + 1 }, (_, i) => handAt(i / HZ));
  const v = P.map((p, i) => (i > 0 ? dist(p, P[i - 1]) * HZ : 0));
  const W = Math.round(0.6 * HZ), w = Math.round(0.1 * HZ);
  const peakNear = (i: number) => Math.max(...v.slice(Math.max(0, i - W), i + W + 1));
  const lowest = (i: number) => v.slice(Math.max(1, i - w), i + w + 1).every((x) => x >= v[i]);
  // where one move ends and the next may start: stopped, or a hard slow-down at a speed minimum
  const cut = v.map((x, i) => i === 0 || i === n || x < still || (lowest(i) && x < HANDEYE.slow * peakNear(i)));
  const out: Reach[] = [];
  let a = 0;
  for (let b = 1; b <= n; b++) {
    if (!cut[b]) continue;
    if (b - a > 1 && Math.max(...v.slice(a + 1, b + 1)) > 2 * still) {
      const to = P[b];
      const inside = !spans || spans.some(([s, e]) => a / HZ >= s - 0.7 && a / HZ <= e);
      if (inside && dist(P[a], to) > move && away(to) && !(rest && dist(to, rest) < HANDEYE.rest)) out.push({ start: a / HZ, arrive: b / HZ, at: to });
    }
    a = b;
  }
  return out;
}

export function handEye(R: Reach[], o = HANDEYE): { t: number; at: V3 | null }[] {
  const keys: { t: number; at: V3 | null }[] = [];
  let on: V3 | null = null, free = -1e9, pulled = false; // where the eyes are, when they can move on, straight on to this
  R.forEach((r, i) => {
    // eyes land lead before the hand starts (but not before they are done with the last thing), or, pulled on by a reach
    // that comes soon, as soon as they leave the last one
    const land = pulled ? free + o.turn : Math.max(r.start - o.lead, free + o.turn);
    keys.push({ t: land - o.turn, at: on }, { t: land, at: r.at });
    on = r.at;
    const leave = r.arrive - o.leave, nx = R[i + 1];
    pulled = !!nx && nx.start - o.lead - leave < o.next;
    if (pulled) free = leave;
    else { keys.push({ t: r.arrive + o.dwell, at: r.at }, { t: r.arrive + o.dwell + o.turn, at: null }); on = null; free = r.arrive + o.dwell; }
  });
  // drop keys that went backwards in time when reaches crowd each other
  return keys.filter((k, i) => i === 0 || k.t >= keys[i - 1].t);
}
