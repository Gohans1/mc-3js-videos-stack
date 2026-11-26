export const POP = {
  turn: { min: 15, ratio: 4, floor: 1, jump: 90, unit: "°" },
  move: { min: 0.08, ratio: 4, floor: 0.01, unit: " m" },
  face: { min: 0.35, ratio: 4, floor: 0.02, unit: " face px" },
  landmarks: { min: 0.35, ratio: 4, floor: 0.02, unit: " face px" },
};
export const SLIDE = { lift: 0.02, rise: 0.15, far: 0.04, window: 0.5, merge: 0.5 };

const angle = (a, b) => {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const farthest = (a, b) => {
  let most = 0;
  for (let i = 0; i < a.length; i += 2) most = Math.max(most, Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1]));
  return most;
};
const crossesCut = (a, b, cuts) => cuts.some((c) => a < c && c <= b + 1e-9);
const touches = (a, b, windows) => windows.some(([from, to]) => b > from && a < to);
const FLANK_REACH = 3;

const measureOf = (kind) => (kind === "turn" ? angle : kind === "landmarks" ? farthest : dist);
const motionOf = (track, cuts, windows) => {
  const { t, v, kind } = track;
  const measure = measureOf(kind);
  return t.map((s, i) =>
    i && v[i] && v[i - 1] && !crossesCut(t[i - 1], s, cuts) && !touches(t[i - 1], s, windows)
      ? measure(v[i - 1], v[i])
      : null,
  );
};
const flankOf = (motion, from, dir) => {
  for (let k = 0; k < FLANK_REACH; k++) {
    const x = motion[from + dir * k];
    if (x != null) return x;
  }
  return null;
};

export function findPops(tracks, cuts, windows = []) {
  const out = [];
  for (const track of tracks) {
    const rule = POP[track.kind];
    if (!rule) continue;
    const motion = motionOf(track, cuts, windows);
    const steps = motion.map((x, i) =>
      x != null && track.seen[i] && track.seen[i - 1] ? x : null,
    );
    const measure = measureOf(track.kind);
    const popped = new Set();
    const found = [];
    for (const frames of [2, 1])
      for (let i = 1; i + frames <= steps.length; i++) {
        const span = steps.slice(i, i + frames);
        if (span.some((x) => x === null) || popped.has(i) || popped.has(i + frames - 1)) continue;
        const step = Math.max(...span, frames === 1 ? 0 : measure(track.v[i - 1], track.v[i + 1]));
        if (step < rule.min) continue;
        const flanks = [flankOf(motion, i - 1, -1), flankOf(motion, i + frames, 1)];
        const bothSides = flanks.every((f) => f != null);
        const outgrows =
          bothSides &&
          [span[0], span.at(-1)].every(
            (inner, k) => inner > rule.ratio * Math.max(flanks[k], rule.floor),
          );
        if (!outgrows && !(frames === 1 && rule.jump && step >= rule.jump)) continue;
        for (let k = i; k < i + frames; k++) popped.add(k);
        found.push({
          start: i,
          end: i + frames - 1,
          pop: {
            t: track.t[i + frames - 1],
            owner: track.owner,
            part: track.part,
            kind: track.kind,
            frames,
            step,
            around: Math.max(0, ...flanks.filter((f) => f != null)),
            near: [-3, -2, -1, 0, 1, 2, 3].map((k) => steps[i + k] ?? null),
          },
        });
      }
    found.sort((a, b) => a.start - b.start);
    const merged = [];
    for (const next of found) {
      const last = merged.at(-1);
      if (last?.end === next.start - 1) {
        last.pop.frames += next.pop.frames;
        last.pop.step = Math.max(last.pop.step, next.pop.step);
        last.pop.t = next.pop.t;
        last.end = next.end;
      } else merged.push(next);
    }
    out.push(...merged.map((m) => m.pop));
  }
  return out.sort((a, b) => a.t - b.t);
}

export function findSlides(soles, cuts) {
  const runs = [];
  for (const sole of soles) {
    const { t, seen, support } = sole;
    const dt = t.length > 1 ? t[1] - t[0] : 1;
    const reach = Math.max(1, Math.round(SLIDE.window / dt));
    const planted = t.map((_, i) => {
      const foot = support[i];
      if (!seen[i] || !foot) return false;
      let low = Infinity;
      for (let k = Math.max(0, i - reach); k <= Math.min(t.length - 1, i + reach); k++)
        if (support[k]?.id === foot.id) low = Math.min(low, support[k].height);
      const previous = support[i - 1];
      const rise = previous?.id === foot.id ? Math.abs(foot.height - previous.height) / dt : 0;
      return foot.height <= low + SLIDE.lift && rise < SLIDE.rise;
    });
    let start = -1;
    for (let i = 0; i <= t.length; i++) {
      const on =
        planted[i] &&
        (start < 0 || (support[i].id === support[start].id && !crossesCut(t[i - 1], t[i], cuts)));
      if (on && start < 0) start = i;
      if (on) continue;
      if (start >= 0) {
        let far = 0;
        const { position, scale } = support[start];
        for (let k = start + 1; k < i; k++) {
          const next = support[k].position;
          far = Math.max(
            far,
            Math.hypot(
              (next[0] - position[0]) * scale[0],
              (next[1] - position[1]) * scale[1],
              (next[2] - position[2]) * scale[2],
            ),
          );
        }
        if (far > SLIDE.far)
          runs.push({ owner: sole.owner, part: sole.part, from: t[start], to: t[i - 1], far });
      }
      start = i < t.length && planted[i] ? i : -1;
    }
  }
  runs.sort((a, b) => a.from - b.from);
  const out = [];
  for (const r of runs) {
    const last = out.findLast((s) => s.owner === r.owner);
    if (last && r.from - last.to <= SLIDE.merge) {
      last.to = Math.max(last.to, r.to);
      last.worst = Math.max(last.worst, r.far);
      last.runs++;
      if (!last.parts.includes(r.part)) last.parts.push(r.part);
    } else
      out.push({ owner: r.owner, parts: [r.part], from: r.from, to: r.to, worst: r.far, runs: 1 });
  }
  return out;
}

const fmt = (x) => x.toFixed(2);
const amount = (p) =>
  `${p.kind === "turn" ? Math.round(p.step) : p.step.toFixed(2)}${POP[p.kind].unit}${p.frames > 1 ? ` over ${p.frames} frames` : ""}`;

export function report({ from, to, fps, tracks, owners, pops, slides }) {
  const lines = [
    `pops ${fmt(from)}-${fmt(to)} s at ${fps} fps: ${tracks} tracks on ${owners} owner${owners === 1 ? "" : "s"} (joints, faces, roots, named things, soles)`,
  ];
  const frames = new Map();
  for (const p of pops) {
    const key = `${p.t.toFixed(4)}|${p.owner}`;
    if (!frames.has(key)) frames.set(key, []);
    frames.get(key).push(p);
  }
  for (const group of frames.values()) {
    group.sort((a, b) => b.step / POP[b.kind].min - a.step / POP[a.kind].min);
    const parts = group.slice(0, 4).map((p) => `${p.part} ${amount(p)}`);
    if (group.length > 4) parts.push(`${group.length - 4} more`);
    lines.push(`  POP ${fmt(group[0].t)} ${group[0].owner}: ${parts.join(", ")}`);
  }
  for (const s of slides)
    lines.push(
      `  SLIDE ${fmt(s.from)}-${fmt(s.to)} ${s.owner}: ${s.parts.join("/")} sole slides while planted (${s.runs} step${s.runs === 1 ? "" : "s"}, worst ${(s.worst * 100).toFixed(0)} cm)`,
    );
  if (!frames.size && !slides.length) lines.push("no pops, no planted sole sliding");
  else
    lines.push(
      `ERROR pops: ${frames.size} pop${frames.size === 1 ? "" : "s"}, ${slides.length} slide${slides.length === 1 ? "" : "s"} (renders/pops.json; look: bun run render stills --at <s>, or --check motion:<owner>.<bone>,<from>,<to>)`,
    );
  return lines;
}
