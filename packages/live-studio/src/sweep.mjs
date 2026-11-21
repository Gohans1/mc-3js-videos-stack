// What bun run sweep ranks: each item { from, to, kind, weight, say }; a heavier weight is looked at first

import { whipAt } from "./ref-cuts.mjs";

const s = (t) => t.toFixed(2);
const whipSaid = (w) => `${w.camera} ${+w.from.toFixed(2)}-${+w.to.toFixed(2)}`;

// The draft's cuts (heard seconds, from its render evidence) against the reference study's cuts, up to the draft's end.
// A reference whip turns either side into a look: a whip transition cuts mid-swing, and a cut detector takes a fast
// move for a cut
export const cutItems = (study, cuts, until) => {
  const near = Math.max(0.05, 1.5 / study.fps);
  const close = (a) => (b) => Math.abs(a - b) <= near;
  const items = [];
  for (const t of cuts.filter((c) => !study.cuts.some(close(c)))) {
    const w = whipAt(study, t);
    items.push(
      w
        ? {
            from: t,
            to: t,
            kind: "cut in a whip",
            weight: 2,
            say: `ours cuts inside the reference's whip (${whipSaid(w)}), which has no cut here: right for a whip transition, a jump if the swing should carry on`,
          }
        : {
            from: t,
            to: t,
            kind: "extra cut",
            weight: 4,
            say: "ours cuts where the reference does not: a jump in the middle of its move",
          },
    );
  }
  for (const t of study.cuts.filter((c) => c <= until + near && !cuts.some(close(c)))) {
    const w = whipAt(study, t);
    items.push(
      w
        ? {
            from: t,
            to: t,
            kind: "cut in a whip",
            weight: 2,
            say: `the reference cuts inside its whip (${whipSaid(w)}) and ours does not: a whip transition, or only a fast move the study took for a cut`,
          }
        : {
            from: t,
            to: t,
            kind: "missing cut",
            weight: 3,
            say: "the reference cuts here and ours does not",
          },
    );
  }
  return items;
};

// Runs of samples (one each step seconds) whose ratio of ours to the reference lies outside [low, high], held at
// least long seconds
export const stretches = (ratios, step, low, high, long) => {
  const runs = [];
  let start = -1;
  for (let i = 0; i <= ratios.length; i++) {
    const out = i < ratios.length && (ratios[i] < low || ratios[i] > high);
    const side = out && (ratios[i] < low ? -1 : 1);
    if (start >= 0 && (!out || side !== (ratios[start] < low ? -1 : 1))) {
      if ((i - start) * step >= long) {
        const part = ratios.slice(start, i);
        runs.push({
          from: start * step,
          to: (i - 1) * step,
          ratio: Math.exp(part.reduce((a, r) => a + Math.log(r), 0) / part.length),
        });
      }
      start = -1;
    }
    if (out && start < 0) start = i;
  }
  return runs;
};

// Laplacian variance of a grey frame: how much fine detail it holds, which blur takes away
export const sharpness = (g, w, h) => {
  let sum = 0,
    sq = 0,
    n = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
      sum += v;
      sq += v * v;
      n++;
    }
  return n ? sq / n - (sum / n) ** 2 : 0;
};

export const mean = (g) => {
  let sum = 0;
  for (const v of g) sum += v;
  return g.length ? sum / g.length : 0;
};

export const median = (xs) => {
  const sorted = xs.toSorted((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 1;
};

// against the last sweep's items: which are new (a Set of these items) and which of those are gone; the same kind
// starting within a tenth of a second is the same item
export const since = (before, items) => {
  if (!before) return { fresh: new Set(), gone: [] };
  const same = (a) => (b) => a.kind === b.kind && Math.abs(a.from - b.from) <= 0.1;
  return {
    fresh: new Set(items.filter((x) => !before.some(same(x)))),
    gone: before.filter((x) => !items.some(same(x))),
  };
};

export const when = (x) => (x.to > x.from ? `${s(x.from)}-${s(x.to)}` : s(x.from));
