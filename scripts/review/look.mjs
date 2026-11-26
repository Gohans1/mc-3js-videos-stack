export const LOOK = {
  move: 0.015,
  noticed: 0.05,
  subjectShare: 0.01,
  lasting: 1,
  light: 10,
  warmth: 8,
  shallow: 2,
};

const pct = (x) => `${Math.round(Math.abs(x) * 100)}%`;
const angle = (v) => `${Math.round((Math.abs(v) * 180) / Math.PI)}°`;
const secs = (from, to) => `${from.toFixed(2)}–${to.toFixed(2)} s`;
const sum = (xs) => xs.reduce((a, x) => a + x, 0);
const CAMERA_AXES = [
  {
    of: (b) => b.camera.dx,
    word: (v) => (v < 0 ? "pans right" : "pans left"),
    name: "horizontal pan",
  },
  {
    of: (b) => b.camera.dy,
    word: (v) => (v < 0 ? "tilts down" : "tilts up"),
    name: "vertical tilt",
  },
  {
    of: (b) => Math.log(b.camera.zoom),
    word: (v) => (v > 0 ? "pushes in" : "pulls out"),
    name: "zoom",
  },
  {
    of: (b) => ((b.camera.turn ?? 0) * Math.PI) / 180,
    word: (v) => (v < 0 ? "rolls clockwise" : "rolls counterclockwise"),
    name: "roll",
    format: angle,
    unit: "",
  },
];
const heading = (dx, dy) =>
  Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";

const runsOf = (pairs, bin, statusOf) => {
  const runs = [];
  let run = null;
  for (const pair of pairs) {
    const status = pair.ref && pair.ours ? statusOf(pair.ref, pair.ours) : null;
    if (status && run?.status === status && Math.abs(pair.t - run.pairs.at(-1).t - bin) < 1e-6) {
      run.pairs.push(pair);
      continue;
    }
    if (run) runs.push(run);
    run = status ? { status, pairs: [pair] } : null;
  }
  if (run) runs.push(run);
  return runs
    .filter((r) => r.pairs.length * bin >= LOOK.lasting - 1e-9)
    .map((r) => ({ ...r, from: r.pairs[0].t, to: r.pairs.at(-1).t + bin }));
};

const cameraFindings = (pairs, bin) =>
  CAMERA_AXES.flatMap(({ of, word, name, format = pct, unit = " of the frame" }) => {
    const big = (v) => Math.abs(v) >= LOOK.move,
      still = (v) => Math.abs(v) < LOOK.move / 3;
    const statusOf = (r, o) => {
      if (!r.camera || !o.camera) return null;
      const a = of(r),
        b = of(o);
      if (big(a) && big(b) && Math.sign(a) !== Math.sign(b)) return `mirrored/${Math.sign(a)}`;
      if (big(a) && still(b)) return `ours still/${Math.sign(a)}`;
      if (big(b) && still(a)) return `reference still/${Math.sign(b)}`;
      return null;
    };
    return runsOf(pairs, bin, statusOf).flatMap(({ status, pairs: run, from, to }) => {
      const [difference] = status.split("/");
      const r = sum(run.map((p) => of(p.ref))),
        o = sum(run.map((p) => of(p.ours)));
      if (difference !== "mirrored" && Math.abs(difference === "ours still" ? r : o) < LOOK.noticed)
        return [];
      const rest = (key) =>
        run.every((p) => CAMERA_AXES.every((axis) => still(axis.of(p[key]))))
          ? "holds still"
          : `has no ${name}`;
      const say =
        difference === "mirrored"
          ? `reference ${word(r)} ${format(r)}${unit}, ours ${word(o)} ${format(o)}: mirrored`
          : difference === "ours still"
            ? `reference ${word(r)} ${format(r)}${unit}, ours ${rest("ours")}`
            : `reference ${rest("ref")}, ours ${word(o)} ${format(o)}${unit}`;
      return [{ kind: "CAMERA", from, to, say: `${secs(from, to)}: ${say}` }];
    });
  });

const subjectFindings = (pairs, bin) => {
  const measured = (b) =>
    b.subject &&
    b.subject.share >= LOOK.subjectShare &&
    Math.hypot(b.subject.dx, b.subject.dy) >= LOOK.move;
  const statusOf = (r, o) => {
    if (!measured(r) || !measured(o)) return null;
    const cos =
      (r.subject.dx * o.subject.dx + r.subject.dy * o.subject.dy) /
      (Math.hypot(r.subject.dx, r.subject.dy) * Math.hypot(o.subject.dx, o.subject.dy));
    return cos < -0.5
      ? `${heading(r.subject.dx, r.subject.dy)}/${heading(o.subject.dx, o.subject.dy)}`
      : null;
  };
  return runsOf(pairs, bin, statusOf).map(({ pairs: run, from, to }) => {
    const travel = (side) => {
      const dx = sum(run.map((p) => p[side].subject.dx)),
        dy = sum(run.map((p) => p[side].subject.dy));
      return `${heading(dx, dy)} ${pct(Math.hypot(dx, dy))}`;
    };
    return {
      kind: "SUBJECT",
      from,
      to,
      say: `${secs(from, to)}: what moves in the reference goes ${travel("ref")} of the frame, in ours ${travel("ours")}: mirrored`,
    };
  });
};

const medianOf = (xs) => {
  const sorted = xs.toSorted((a, b) => a - b),
    mid = sorted.length / 2;
  return sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const meanOf = (bins, of) =>
  sum(bins.map((b) => of(b) * b.frames)) / sum(bins.map((b) => b.frames));

const lightFindings = (ref, ours) => {
  const out = [];
  const L = [meanOf(ref, (b) => b.light.L), meanOf(ours, (b) => b.light.L)];
  const b = [meanOf(ref, (x) => x.light.b), meanOf(ours, (x) => x.light.b)];
  if (Math.abs(L[1] - L[0]) >= LOOK.light)
    out.push({
      kind: "LIGHT",
      say: `ours is ${L[1] > L[0] ? "brighter" : "darker"} by ${Math.round(Math.abs(L[1] - L[0]))} L* (${Math.round(L[1])} against ${Math.round(L[0])})`,
    });
  if (Math.abs(b[1] - b[0]) >= LOOK.warmth)
    out.push({
      kind: "WARMTH",
      say: `ours is ${b[1] > b[0] ? "warmer" : "cooler"} by ${Math.round(Math.abs(b[1] - b[0]))} b* (${Math.round(b[1])} against ${Math.round(b[0])})`,
    });
  return out;
};

const focusFindings = (ref, ours) => {
  const depth = (bins) => {
    const known = bins.filter((b) => b.focus);
    return known.length
      ? medianOf(known.map((b) => b.focus.top)) /
          Math.max(medianOf(known.map((b) => b.focus.centre)), 1e-6)
      : null;
  };
  const r = depth(ref),
    o = depth(ours);
  if (r === null || o === null) return [];
  const shallow = (d) => d >= LOOK.shallow;
  if (shallow(r) === shallow(o)) return [];
  const say = shallow(r)
    ? `the reference's top third is ${r.toFixed(1)}x blurrier than its centre (shallow focus), ours ${o.toFixed(1)}x`
    : `our top third is ${o.toFixed(1)}x blurrier than its centre (shallow focus), the reference's ${r.toFixed(1)}x`;
  return [{ kind: "FOCUS", say }];
};

const fittedMotion = (bins, from, bin, scale) => {
  const start = from * scale;
  const end = (from + bin) * scale;
  let camera = { dx: 0, dy: 0, zoom: 1, turn: 0 };
  let subject = { dx: 0, dy: 0, share: 0 };
  const first = Math.floor((start + 1e-9) / bin);
  const past = Math.ceil((end - 1e-9) / bin);
  for (let i = first; i < past; i++) {
    const sample = bins.get(i);
    if (!sample) return null;
    const weight = (Math.min(end, (i + 1) * bin) - Math.max(start, i * bin)) / bin;
    if (camera && sample.camera) {
      camera.dx += sample.camera.dx * weight;
      camera.dy += sample.camera.dy * weight;
      camera.zoom *= sample.camera.zoom ** weight;
      camera.turn += (sample.camera.turn ?? 0) * weight;
    } else camera = null;
    if (subject && sample.subject) {
      subject.dx += sample.subject.dx * weight;
      subject.dy += sample.subject.dy * weight;
      subject.share += (sample.subject.share * weight) / scale;
    } else subject = null;
  }
  return { camera, subject };
};

export function compareLooks(shots, { bin, scale = 1, ref, ours }) {
  const key = (t) => Math.round(t / bin);
  const inSpan = (bins, from, to) =>
    bins.filter((b) => b && b.t >= from - 1e-9 && b.t + bin <= to + 1e-9);
  return shots.map(({ from, to }) => {
    const refBins = inSpan(ref, from, to),
      ourBins = inSpan(ours, from * scale, to * scale);
    if (!refBins.length || !ourBins.length)
      return {
        from,
        to,
        findings: [],
        skipped: `no frames measured in ${refBins.length ? "ours" : "the reference"}`,
      };
    const oursAt = new Map(ourBins.map((b) => [key(b.t), b]));
    const pairs = refBins.map((r) => ({
      t: r.t,
      ref: r,
      ours: scale === 1 ? (oursAt.get(key(r.t)) ?? null) : fittedMotion(oursAt, r.t, bin, scale),
    }));
    return {
      from,
      to,
      findings: [
        ...[...cameraFindings(pairs, bin), ...subjectFindings(pairs, bin)].sort(
          (a, b) => a.from - b.from,
        ),
        ...lightFindings(refBins, ourBins),
        ...focusFindings(refBins, ourBins),
      ],
    };
  });
}

export function lookLines(compared) {
  const lines = [
    "## Look per shot",
    "",
    "Camera move and what moves in the frame, compared every half second at the same moment and listed when they disagree for a second or more; brightness, warmth (CIELAB means) and how much more blurred the top third's edges are than the centre's (medians over the shot), per shot. Samples crossing shot boundaries are left out, as are camera estimates without enough tracking evidence. compare.json look has every number.",
    "",
  ];
  compared.forEach((c, k) => {
    const head = `- shot ${k + 1} ${secs(c.from, c.to)}: `;
    if (c.skipped) lines.push(`${head}${c.skipped}`);
    else if (c.findings.length)
      lines.push(`${head}${c.findings.map((f) => `${f.kind} ${f.say}`).join("; ")}`);
  });
  const flagged = compared.filter((c) => c.findings.length).length;
  lines.push("", `Look differences flagged in ${flagged} of ${compared.length} shots`);
  return lines;
}
