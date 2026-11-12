import { compileTiming, segmentAt } from "./timing.mjs";

const holds = new WeakMap();
const holdRange = (clock, source) => {
  if (!holds.has(clock)) {
    const ranges = new Map();
    for (const s of clock.segments)
      if (s.kind === "freeze") {
        const range = ranges.get(s.sourceFrom) ?? { from: s.from, to: s.to };
        range.to = s.to;
        if (!s.blank) {
          range.contentFrom ??= s.from;
          range.contentTo = s.to;
        }
        ranges.set(s.sourceFrom, range);
      }
    holds.set(clock, ranges);
  }
  return holds.get(clock).get(source);
};
const mapRange = (t, a, b, c, d) => c + (d - c) * (b > a ? (t - a) / (b - a) : 0);

export const remapOutputTime = (before, after, t, edge = "after") => {
  if (before.placements && after.placements) {
    const p = before.placements.find(
      (it) =>
        it.kind === "freeze" &&
        (edge === "before" ? t > it.from && t <= it.to : t >= it.from && t < it.to),
    );
    const moved = p && after.placements.find((it) => it.id === p.id && it.kind === "freeze");
    if (moved) return mapRange(t, p.from, p.to, moved.from, moved.to);
  }
  const held = segmentAt(before, t, edge);
  if (held?.kind === "freeze") {
    const a = holdRange(before, held.sourceFrom),
      b = holdRange(after, held.sourceFrom);
    if (!b) return after.outputAt(held.sourceFrom, edge);
    if (a.contentFrom !== undefined && b.contentFrom !== undefined) {
      if (t < a.contentFrom) return mapRange(t, a.from, a.contentFrom, b.from, b.contentFrom);
      if (t >= a.contentTo) return mapRange(t, a.contentTo, a.to, b.contentTo, b.to);
      return mapRange(t, a.contentFrom, a.contentTo, b.contentFrom, b.contentTo);
    }
    return mapRange(t, a.from, a.to, b.from, b.to);
  }
  return after.outputAt(before.sourceAt(t, edge), edge);
};

// A linkage edit maps the layers' current output through the change in the main track; their original source clock stays intact.
const compose = (layer, before, after) => {
  const outputAt = (t, edge = "after") =>
    remapOutputTime(before, after, layer.outputAt(t, edge), edge);
  const sourceAt = (t, edge = "after") =>
    layer.sourceAt(remapOutputTime(after, before, t, edge), edge);
  const visible = (t) => {
    const primary = before.sourceAt(layer.outputAt(t));
    return layer.visible(t) && (!before.visible(primary) || after.visible(primary));
  };
  const sourceDuration = layer.sourceDuration;
  const boundaries = [
    ...new Set(
      [
        0,
        sourceDuration,
        ...layer.segments.flatMap((s) => [s.sourceFrom, s.sourceTo]),
        ...before.segments
          .filter((s) => s.kind === "freeze")
          .flatMap((s) => [layer.sourceAt(s.from), layer.sourceAt(s.to)]),
        ...[before, after]
          .flatMap((c) => c.segments.flatMap((s) => [s.sourceFrom, s.sourceTo]))
          .flatMap((t) =>
            ["before", "after"].map((edge) => layer.sourceAt(before.outputAt(t, edge), edge)),
          ),
      ].filter((t) => t >= 0 && t <= sourceDuration),
    ),
  ].sort((a, b) => a - b);
  const raw = [];
  const sample = (a, b, from, to, depth = 0) => {
    if (to - from <= 1e-10 || b - a <= 1e-10) return;
    const points = [0.25, 0.5, 0.75].map((u) => ({
      t: a + (b - a) * u,
      expected: from + (to - from) * u,
    }));
    if (depth < 18 && points.some((p) => Math.abs(outputAt(p.t) - p.expected) > 1 / 96000)) {
      const mid = points[1].t,
        at = outputAt(mid);
      sample(a, mid, from, at, depth + 1);
      sample(mid, b, at, to, depth + 1);
    } else {
      const rate = (b - a) / (to - from);
      raw.push({
        kind: "play",
        sourceFrom: a,
        sourceTo: b,
        from,
        to,
        rate0: rate,
        rate1: rate,
        ...(!visible((a + b) / 2) && { blank: true }),
      });
    }
  };
  boundaries.forEach((a, i) => {
    const from = outputAt(a, "before"),
      to = outputAt(a);
    if (
      to - from > 1e-10 &&
      after.segments.every((s) => s.to <= from + 1e-9 || s.from >= to - 1e-9 || s.kind === "freeze")
    ) {
      raw.push({
        kind: "freeze",
        sourceFrom: a,
        sourceTo: a,
        from,
        to,
        ...(!visible(a) && { blank: true }),
      });
    }
    const b = boundaries[i + 1];
    if (b !== undefined) sample(a, b, to, outputAt(b, "before"));
  });
  raw.sort((a, b) => a.from - b.from || a.to - b.to);
  const duration = Math.max(outputAt(sourceDuration), raw.at(-1)?.to ?? 0);
  const segments = [];
  let cursor = 0;
  const fillGap = (from, to) => {
    if (to - from <= 1e-10) return;
    const mid = (from + to) / 2,
      held = segmentAt(after, mid),
      at = sourceAt(mid);
    segments.push({
      kind: "freeze",
      sourceFrom: at,
      sourceTo: at,
      from,
      to,
      ...(held?.blank && { blank: true }),
    });
  };
  for (const s of raw) {
    fillGap(cursor, s.from);
    segments.push(s);
    cursor = Math.max(cursor, s.to);
  }
  fillGap(cursor, duration);
  return {
    sourceDuration,
    duration,
    outputAt,
    sourceAt,
    segments,
    visible: (t) =>
      (segments.some((s) => s.kind === "play" && !s.blank && t >= s.sourceFrom && t < s.sourceTo) ||
        t >= sourceDuration) &&
      visible(t),
  };
};

export const compileLayerTiming = (timing, sourceDuration, kind) => {
  const history = timing.layerKinds?.[kind] ?? timing.layers;
  if (!history) return compileTiming(timing, sourceDuration);
  const clock = history.changes.reduce(
    (clock, { before, after }) =>
      compose(clock, compileTiming(before, sourceDuration), compileTiming(after, sourceDuration)),
    compileTiming(history.base, sourceDuration),
  );
  return { ...clock, timebase: { ...structuredClone(history), sourceDuration } };
};

export const startsOnHold = (clock, a, forward = clock.outputAt, sourceA = a) => {
  const before = forward(a, "before"),
    after = forward(a, "after");
  if (!(before < after - 1e-9)) return false;
  return (
    clock.segments.some((s) => s.from < after - 1e-9 && s.to > before + 1e-9) &&
    clock.segments.every(
      (s) =>
        s.to <= before + 1e-9 ||
        s.from >= after - 1e-9 ||
        (s.kind === "freeze" && !s.blank && Math.abs(s.sourceFrom - sourceA) < 1e-7),
    )
  );
};

export const isTornByReorder = (clock, a, b) => {
  if (!(b > a)) return false;
  const tail =
    b > clock.sourceDuration
      ? [
          {
            kind: "play",
            sourceFrom: Math.max(a, clock.sourceDuration),
            sourceTo: b,
            from: clock.duration + Math.max(0, a - clock.sourceDuration),
            to: clock.duration + b - clock.sourceDuration,
          },
        ]
      : [];
  const parts = [
    ...clock.segments.filter(
      (s) => s.kind === "play" && !s.blank && Math.min(b, s.sourceTo) > Math.max(a, s.sourceFrom),
    ),
    ...tail,
  ].sort((p, q) => p.sourceFrom - q.sourceFrom);
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i - 1],
      q = parts[i];
    if (q.from < p.to - 1e-7) return true;
    if (
      q.from > p.to + 1e-7 &&
      clock.segments.some(
        (s) =>
          s.kind === "play" &&
          !s.blank &&
          s.from >= p.to - 1e-7 &&
          s.to <= q.from + 1e-7 &&
          (s.sourceTo <= a + 1e-7 || s.sourceFrom >= b - 1e-7),
      )
    )
      return true;
  }
  return false;
};

const timebases = new WeakMap();
export const timebaseClock = (timebase) => {
  if (!timebases.has(timebase))
    timebases.set(timebase, compileLayerTiming({ layers: timebase }, timebase.sourceDuration));
  return timebases.get(timebase);
};
export const overlayTime = (clock, t, item) => {
  if (item.timebase) {
    const base = timebaseClock(item.timebase);
    const srcA = base.sourceAt(item.from, "after"),
      srcB = base.sourceAt(item.to, "before");
    if (srcB > srcA && isTornByReorder(clock, srcA, srcB))
      return item.from + (t - remapOutputTime(base, clock, item.from, "after"));
    return remapOutputTime(clock, base, t, "before");
  }
  if (isTornByReorder(clock, item.from, item.to)) {
    const edge = startsOnHold(clock, item.from) ? "before" : "after";
    return item.from + (t - clock.outputAt(item.from, edge));
  }
  return clock.sourceAt(t);
};
