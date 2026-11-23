import { hash } from "./hash";
export const NOTICE = {
  latency: 0.2,
  turn: 0.25,
  hold: [0.6, 1.1],
  back: 0.45,
  repeat: 0.55,
  near: 1,
  memory: 60,
};
export const PULL = { onset: 1, moving: 1, looming: 1, receding: 0 };
export type Event = {
  t: number;
  at: [number, number, number];
  k?: number;
  kind?: keyof typeof PULL;
};

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
  return Object.assign(at, { events: all, shifts: glances.flatMap((g) => [g.go, g.off]) });
}
