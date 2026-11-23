export const SINK = 1 / 16;
export const TOUCH = 0.01;
export const HOVER = 0.05;
export const STILL = 0.1;
export const LONG = 0.3;

const cm = (d) => `${(Math.abs(d) * 100).toFixed(1)} cm`;
const f = (x) => x.toFixed(2);
const off = (x) => (x.inFrame === false ? " (off screen: the audience never sees it)" : "");

function runs(frames, test, long) {
  const dt = frames.length > 1 ? frames[1].t - frames[0].t : 0,
    out = [];
  let start = -1;
  for (let i = 0; i <= frames.length; i++) {
    const on = i < frames.length && test(frames[i]);
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      const r = frames.slice(start, i);
      if (r[r.length - 1].t - r[0].t + dt >= long - 1e-9) out.push(r);
      start = -1;
    }
  }
  return out;
}

export const FAULTS = {
  SINK: {
    test: (x) => x.d <= -SINK,
    long: 0,
    worst: (x) => -x.d,
    say: (x) => `${x.part} ${cm(x.d)} inside ${x.surface}${off(x)}`,
  },
  HOVER: {
    test: (x) => x.d >= TOUCH && x.d <= HOVER && x.speed < STILL,
    long: LONG,
    worst: (x) => -x.d,
    say: (x) => `${x.part} held ${cm(x.d)} off ${x.surface}, not touching${off(x)}`,
  },
};

export function summarize(name, frames) {
  const near = frames.filter((x) => Number.isFinite(x.d));
  const lines = [
    `${name} ${f(frames[0].t)}-${f(frames[frames.length - 1].t)} s: near a surface ${Math.round((near.length / frames.length) * 100)}% of the time${near.length ? `, deepest ${near.reduce((a, x) => Math.min(a, x.d), Infinity) < 0 ? cm(near.reduce((a, x) => Math.min(a, x.d), 0)) + " inside" : "never inside"}` : ""}`,
  ];
  const worst = [];
  let unseen = 0;
  for (const [kind, { test, long, worst: score, say }] of Object.entries(FAULTS)) {
    for (const r of runs(frames, test, long)) {
      const w = r.reduce((a, x) => (score(x) > score(a) ? x : a));
      if (r.every((x) => x.inFrame === false)) {
        unseen++;
        continue;
      }
      lines.push(`  ${kind} ${f(r[0].t)}-${f(r[r.length - 1].t)}: worst at ${f(w.t)}, ${say(w)}`);
      worst.push({ kind, t: w.t, say: say(w), p: w.p });
    }
  }
  const touches = runs(frames, (x) => Math.abs(x.d) < TOUCH || (x.d < 0 && x.d > -SINK), 0.1);
  for (const r of touches.slice(0, 12))
    lines.push(
      `  touch ${f(r[0].t)}-${f(r[r.length - 1].t)}: ${[...new Set(r.map((x) => `${x.part} on ${x.surface}`))].slice(0, 3).join(", ")}`,
    );
  if (touches.length > 12) lines.push(`  ... ${touches.length - 12} more touches`);
  if (unseen)
    lines.push(
      `  ${unseen} more off screen the whole time (not listed: the audience never sees them)`,
    );
  if (!worst.length) lines.push("  never sinks into anything on screen, never hovers just off it");
  return { lines, worst: worst.sort((a, b) => a.t - b.t) };
}
