export const HANDEYE = {
  lead: 0.5,
  leave: 0.16,
  turn: 0.3,
  dwell: 0.5,
  next: 1.5,
  move: 0.15,
  still: 0.1,
  rest: 0.25,
  slow: 0.3,
  pause: 0.9,
};
export const OUT = { front: 0.25, low: 0.45, high: 1.95, side: 0.6 };
export const isOut = ([x, y, z]: number[]) =>
  z > OUT.front || y < OUT.low || y > OUT.high || Math.abs(x) > OUT.side;

type V3 = [number, number, number];
export type Reach = { start: number; arrive: number; at: V3 };
const HZ = 60;
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function reaches(
  handAt: (t: number) => V3,
  end: number,
  {
    rest = null as V3 | null,
    move = HANDEYE.move,
    still = HANDEYE.still,
    away = isOut,
    spans = null as [number, number][] | null,
  } = {},
): Reach[] {
  const n = Math.ceil(end * HZ),
    P = Array.from({ length: n + 1 }, (_, i) => handAt(i / HZ));
  const v = P.map((p, i) => (i > 0 ? dist(p, P[i - 1]) * HZ : 0));
  const W = Math.round(0.6 * HZ),
    w = Math.round(0.1 * HZ);
  const peakNear = (i: number) => Math.max(...v.slice(Math.max(0, i - W), i + W + 1));
  const lowest = (i: number) => v.slice(Math.max(1, i - w), i + w + 1).every((x) => x >= v[i]);
  const cut = v.map(
    (x, i) => i === 0 || i === n || x < still || (lowest(i) && x < HANDEYE.slow * peakNear(i)),
  );
  const moves: [number, number][] = [];
  let a = 0;
  for (let b = 1; b <= n; b++) {
    if (!cut[b]) continue;
    if (b - a > 1 && Math.max(...v.slice(a + 1, b + 1)) > 2 * still) moves.push([a, b]);
    a = b;
  }
  const dir = ([i, j]: [number, number]) => {
    const d = P[j].map((x, k) => x - P[i][k]),
      l = Math.hypot(...d) || 1;
    return d.map((x) => x / l);
  };
  const merged: [number, number][] = [];
  for (const m of moves) {
    const last = merged[merged.length - 1];
    if (last && (m[0] - last[1]) / HZ < HANDEYE.pause) {
      const small = dist(P[m[0]], P[m[1]]) < move,
        d1 = dir(last),
        d2 = dir(m);
      const same = d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2] > 0.5;
      const next = moves[moves.indexOf(m) + 1];
      if (same || (small && next && (next[0] - m[1]) / HZ < HANDEYE.pause)) {
        last[1] = m[1];
        continue;
      }
    }
    merged.push([...m]);
  }
  const out: Reach[] = [];
  for (const [i, j] of merged) {
    const to = P[j];
    const inside = !spans || spans.some(([s, e]) => i / HZ >= s - 0.7 && i / HZ <= e);
    if (inside && dist(P[i], to) > move && away(to) && !(rest && dist(to, rest) < HANDEYE.rest))
      out.push({ start: i / HZ, arrive: j / HZ, at: to });
  }
  return out;
}

export function handEye(R: Reach[], o = HANDEYE): { t: number; at: V3 | null }[] {
  const keys: { t: number; at: V3 | null }[] = [];
  let on: V3 | null = null,
    free = -1e9,
    pulled = false;
  R.forEach((r, i) => {
    const land = pulled ? free + o.turn : Math.max(r.start - o.lead, free + o.turn);
    keys.push({ t: land - o.turn, at: on }, { t: land, at: r.at });
    on = r.at;
    const leave = r.arrive - o.leave,
      nx = R[i + 1];
    pulled = !!nx && nx.start - o.lead - leave < o.next;
    if (pulled) free = leave;
    else {
      keys.push({ t: r.arrive + o.dwell, at: r.at }, { t: r.arrive + o.dwell + o.turn, at: null });
      on = null;
      free = r.arrive + o.dwell;
    }
  });
  return keys.filter((k, i) => i === 0 || k.t >= keys[i - 1].t);
}
