// How one point moves (a hand, the head, the camera), measured from its world positions sampled evenly in time: the numbers
// an animator reads off a graph editor (speed over time, where each move peaks) and the faults reviewers of generated motion
// count (a one-sample jump; a dead stop from speed, the "robot" stop). Positions in metres, times in seconds.
//   measure([{ t, p: [x, y, z] }, ...], cuts?) gives { speed, peak, moves, pops, stops, cuts }; report(name, samples, m) the
//   lines to print. cuts: the film's cut seconds; a step across one is the picture changing, not the thing moving, so it is
//   left out of the speed and never a pop

export const STILL = 0.05; // m/s: slower than this is at rest
export const POP_STEP = 0.01; // m: a jump counts if one sample step is at least this ...
export const POP_RATIO = 4; // ... and this many times the steps around it
export const STOP_FROM = 0.5; // m/s: slower moves never count as dead stops

const sub = (a, b) => a.map((v, i) => v - b[i]);
const len = (a) => Math.hypot(...a);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

export function measure(samples, cuts = []) {
  const n = samples.length,
    dt = n > 1 ? samples[1].t - samples[0].t : 1;
  const cut = samples.map((s, i) => i > 0 && cuts.some((c) => samples[i - 1].t < c && c <= s.t));
  const step = samples.map((s, i) => (i && !cut[i] ? sub(s.p, samples[i - 1].p) : null));
  const speed = samples.map((_, i) => {
    const near = [step[i], step[i + 1]].filter(Boolean);
    return near.length
      ? len(near.reduce((a, b) => a.map((v, k) => v + b[k])).map((v) => v / near.length / dt))
      : 0;
  });
  let peak = { t: samples[0]?.t ?? 0, v: 0 };
  speed.forEach((v, i) => {
    if (v > peak.v) peak = { t: samples[i].t, v };
  });

  const steps = step.map((d) => (d ? len(d) : 0));
  const pops = [];
  for (let i = 1; i < n; i++) {
    const around = median([...steps.slice(Math.max(1, i - 3), i), ...steps.slice(i + 1, i + 4)]);
    if (steps[i] >= POP_STEP && steps[i] > POP_RATIO * Math.max(around, 0.002))
      pops.push({ t: samples[i].t, step: steps[i], around });
  }

  // a move: a run above STILL; where its speed peaks, as a share of its length, says how it is eased. Its first or last
  // sample step still at half its peak speed or more means it starts or stops dead, with no ease (runs cut by the window
  // edge are not judged)
  const moves = [],
    stops = [],
    stepV = steps.map((s) => s / dt);
  for (let i = 0; i < n;) {
    if (speed[i] < STILL) {
      i++;
      continue;
    }
    let j = i,
      top = i;
    while (j + 1 < n && speed[j + 1] >= STILL) {
      j++;
      if (speed[j] > speed[top]) top = j;
    }
    const from = samples[i].t,
      to = samples[j].t,
      dead = Math.max(STOP_FROM, speed[top] / 2);
    if (i > 0 && i + 1 < n && stepV[i + 1] >= dead)
      stops.push({ t: from, kind: "start", v: stepV[i + 1] });
    if (j + 1 < n && stepV[j] >= dead) stops.push({ t: to, kind: "stop", v: stepV[j] });
    if (to - from >= 0.1)
      moves.push({
        from,
        to,
        peakT: samples[top].t,
        peakV: speed[top],
        peakAt: (samples[top].t - from) / (to - from),
      });
    i = j + 1;
  }
  return {
    speed,
    peak,
    moves,
    pops,
    stops,
    cuts: samples.filter((_, i) => cut[i]).map((s) => s.t),
  };
}

export const easeOf = (peakAt) =>
  peakAt < 0.35
    ? "fast start, slow finish (eases out)"
    : peakAt > 0.65
      ? "slow start, fast finish (eases in)"
      : "even (eases in and out)";

export function report(name, samples, m) {
  const f = (x) => x.toFixed(2);
  const out = [
    `${name} ${f(samples[0].t)}-${f(samples[samples.length - 1].t)} s: peak ${f(m.peak.v)} m/s at ${f(m.peak.t)}, ${m.moves.length} move(s)`,
  ];
  for (const mv of m.moves)
    out.push(
      `  move ${f(mv.from)}-${f(mv.to)}: peak ${f(mv.peakV)} m/s at ${f(mv.peakT)}, ${Math.round(mv.peakAt * 100)}% in: ${easeOf(mv.peakAt)}`,
    );
  for (const p of m.pops)
    out.push(
      `  POP ${f(p.t)}: jumps ${(p.step * 100).toFixed(1)} cm in one sample, the steps around it ${(p.around * 100).toFixed(1)} cm`,
    );
  for (const s of m.stops)
    out.push(
      `  DEAD ${s.kind.toUpperCase()} ${f(s.t)}: ${s.kind === "stop" ? `from ${f(s.v)} m/s to rest` : `from rest to ${f(s.v)} m/s`} in one sample, no ease`,
    );
  if (m.cuts.length) out.push(`  cuts at ${m.cuts.map(f).join(", ")} (left out)`);
  if (!m.pops.length && !m.stops.length) out.push("  no pops, no dead stops");
  return out;
}
