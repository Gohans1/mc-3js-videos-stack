// Whether the audience can see one thing, frame by frame, from what render/seen.ts measures on the film's own camera:
//   { t, share: part of the frame it covers, hidden: part of it behind something, by: { label: part of it hidden by that },
//     cut: part of it outside the frame, luma: its mean brightness (0-1, as encoded), frameLuma: the whole frame's }
// summarize(name, frames) gives the lines to print and the worst frame of every fault, to be shown.

export const HIDDEN = 0.5; // half of it behind something
export const CUT = 0.25; // a quarter of it outside the frame
export const DARK = 0.05; // mean brightness under this: a silhouette at best
export const LONG = 0.2; // s: shorter faults go by unseen (a prop swinging past)

// runs of frames where test holds, at least LONG long
export function stretches(frames, test, long = LONG) {
  const dt = frames.length > 1 ? frames[1].t - frames[0].t : 0, out = [];
  let start = -1;
  for (let i = 0; i <= frames.length; i++) {
    const on = i < frames.length && test(frames[i]);
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      const run = frames.slice(start, i);
      if (run[run.length - 1].t - run[0].t + dt >= long - 1e-9) out.push(run);
      start = -1;
    }
  }
  return out;
}

const pc = (x) => `${Math.round(x * 100)}%`;
const f = (x) => x.toFixed(2);
const behind = (by) => Object.entries(by ?? {}).filter(([, v]) => v >= 0.05).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${pc(v)}`).join(", ");

export const FAULTS = {
  GONE: { test: (x) => x.share === 0, worst: (x) => 1, say: (x) => (x.alone ? `not seen at all, behind ${behind(x.by) || "something"}` : "not in the frame (or not drawn)") },
  HIDDEN: { test: (x) => x.share > 0 && x.hidden >= HIDDEN, worst: (x) => x.hidden, say: (x) => `${pc(x.hidden)} hidden, behind ${behind(x.by)}` },
  CUT: { test: (x) => x.share > 0 && x.cut >= CUT, worst: (x) => x.cut, say: (x) => `${pc(x.cut)} of it outside the frame` },
  DARK: { test: (x) => x.share > 0 && x.luma < DARK, worst: (x) => -x.luma, say: (x) => `brightness ${f(x.luma)} (frame ${f(x.frameLuma)})` },
};

export function summarize(name, frames) {
  const seen = frames.filter((x) => x.share > 0);
  const mean = (xs, k) => xs.reduce((a, x) => a + x[k], 0) / (xs.length || 1);
  const lines = [
    `${name} ${f(frames[0].t)}-${f(frames[frames.length - 1].t)} s: in view ${pc(seen.length / frames.length)} of the time; size ${seen.length ? `${pc(Math.min(...seen.map((x) => x.share)))}-${pc(Math.max(...seen.map((x) => x.share)))} of the frame, mean ${pc(mean(seen, "share"))}` : "-"}; brightness ${f(mean(seen, "luma"))} against the frame's ${f(mean(frames, "frameLuma"))}`,
  ];
  const worst = [];
  for (const [kind, { test, worst: score, say }] of Object.entries(FAULTS)) {
    for (const run of stretches(frames, test)) {
      const w = run.reduce((a, x) => (score(x) > score(a) ? x : a));
      lines.push(`  ${kind} ${f(run[0].t)}-${f(run[run.length - 1].t)}: worst at ${f(w.t)}, ${say(w)}`);
      worst.push({ kind, t: w.t, say: say(w) });
    }
  }
  if (!worst.length) lines.push("  always in view: never mostly hidden, cut off or too dark");
  return { lines, worst: worst.sort((a, b) => a.t - b.t) };
}
