import { bisector } from "d3-array";

import { clipTiming, compileTiming, freezeRange, playRanges } from "./timing.mjs";

const outputIndex = bisector((s) => s.to).right;
const outputLeft = bisector((s) => s.to).left;
const sourceIndex = bisector((s) => s.sourceTo);

export const createMainItems = (timing, sourceDuration, cuts) => {
  if (timing.main) return structuredClone(timing.main);
  const clock = compileTiming(timing, sourceDuration),
    placed = [];
  for (const [i, from] of cuts.entries())
    for (const span of playRanges(clock, from, cuts[i + 1] ?? sourceDuration)) {
      placed.push({
        at: span.from,
        item: {
          id: crypto.randomUUID(),
          kind: "clip",
          sourceFrom: span.sourceFrom,
          sourceTo: span.sourceTo,
        },
      });
    }
  for (const [i, f] of (timing.freezes ?? []).entries()) {
    if (f.blank || !clock.visible(f.at)) continue;
    const [from] = freezeRange(timing, clock, i);
    placed.push({
      at: from,
      item: {
        id: crypto.randomUUID(),
        kind: "freeze",
        frame: f.frame ?? f.at,
        duration: f.duration,
      },
    });
  }
  for (const s of clock.segments)
    if (s.blank)
      placed.push({
        at: s.from,
        item: { id: crypto.randomUUID(), kind: "gap", duration: s.to - s.from },
      });
  return placed.sort((a, b) => a.at - b.at).map(({ item }) => item);
};

// OTIO ordered Clip/Gap ranges; Filmcraft moves placements without rewriting source motion.
export const moveMainItem = (items, id, beforeId = null) => {
  const item = items.find((item) => item.id === id);
  if (!item) throw new Error("Main-track clip not found");
  if (id === beforeId) return structuredClone(items);
  const rest = items.filter((item) => item.id !== id);
  const index = beforeId === null ? rest.length : rest.findIndex((item) => item.id === beforeId);
  if (index < 0) throw new Error("Main-track destination not found");
  return structuredClone([...rest.slice(0, index), item, ...rest.slice(index)]);
};

export const mainShift = (before, after, start) => {
  const anchor = before.find((p) => p.kind !== "gap" && start >= p.from && start < p.to);
  const moved = anchor && after.find((p) => p.id === anchor.id);
  return moved ? moved.from - anchor.from : 0;
};

export const mainDrop = (timing, sourceDuration, items, id, at, ripple) => {
  const placed = compileTiming({ speeds: timing.speeds, main: items }, sourceDuration).placements;
  const moving = placed.find((p) => p.id === id);
  if (!moving) return null;
  const rest = items.filter((it) => it.id !== id);
  if (ripple) {
    const targets = compileTiming({ speeds: timing.speeds, main: rest }, sourceDuration).placements;
    return moveMainItem(items, id, targets.find((p) => at < (p.from + p.to) / 2)?.id ?? null);
  }
  const start = Math.max(0, at),
    length = moving.to - moving.from;
  const base = items.map((it) =>
    it.id === id ? { id: crypto.randomUUID(), kind: "gap", duration: length } : it,
  );
  const clock = compileTiming({ speeds: timing.speeds, main: base }, sourceDuration);
  const gap = clock.placements.find(
    (p) => p.kind === "gap" && start >= p.from - 1e-7 && start + length <= p.to + 1e-7,
  );
  const item = items.find((it) => it.id === id);
  if (gap)
    return base.flatMap((it) =>
      it.id !== gap.id
        ? [it]
        : [
            ...(start > gap.from + 1e-7
              ? [{ id: crypto.randomUUID(), kind: "gap", duration: start - gap.from }]
              : []),
            item,
            ...(start + length < gap.to - 1e-7
              ? [{ id: crypto.randomUUID(), kind: "gap", duration: gap.to - start - length }]
              : []),
          ],
    );
  if (start < clock.duration - 1e-7) return null;
  return [
    ...base,
    ...(start > clock.duration
      ? [{ id: crypto.randomUUID(), kind: "gap", duration: start - clock.duration }]
      : []),
    item,
  ];
};

export const insertMainFreeze = (timing, clock, at, duration) => {
  const p = clock.placements.find((p) => at >= p.from && at < p.to);
  if (!p || p.kind === "gap") return;
  const frame = clock.sourceAt(at),
    hold = { id: crypto.randomUUID(), kind: "freeze", frame, duration };
  if (p.kind === "freeze") {
    timing.main.splice(timing.main.findIndex((it) => it.id === p.id) + 1, 0, hold);
    return;
  }
  timing.main = timing.main.flatMap((it) =>
    it.id !== p.id
      ? [it]
      : [
          ...(frame > p.sourceFrom ? [{ ...it, sourceTo: frame }] : []),
          hold,
          ...(frame < p.sourceTo ? [{ ...it, id: crypto.randomUUID(), sourceFrom: frame }] : []),
        ],
  );
};

export const compileMainTrack = (source, items) => {
  if (source.segments.some((s) => s.kind !== "play"))
    throw new Error("Frame holds must be main-track items, not source-clock effects");
  const segments = [],
    placements = [];
  let duration = 0;
  for (const item of items) {
    const from = duration;
    if (item.kind === "clip") {
      const parts = clipTiming(source, item.sourceFrom, item.sourceTo);
      for (const s of parts)
        segments.push({
          ...s,
          sourceFrom: item.sourceFrom + s.sourceFrom,
          sourceTo: item.sourceFrom + s.sourceTo,
          from: from + s.from,
          to: from + s.to,
        });
      duration += parts.at(-1)?.to ?? 0;
    } else {
      const frame = item.kind === "freeze" ? item.frame : 0;
      segments.push({
        kind: "freeze",
        sourceFrom: frame,
        sourceTo: frame,
        frame,
        from,
        to: from + item.duration,
        ...(item.kind === "gap" && { blank: true }),
      });
      duration += item.duration;
    }
    placements.push({ ...item, from, to: duration });
  }
  const plays = segments.filter((s) => s.kind === "play").sort((a, b) => a.sourceTo - b.sourceTo);
  const sourceAt = (t, edge = "after") => {
    if (t < 0) return t;
    if (t > duration || (t === duration && (edge !== "before" || !segments.length)))
      return source.sourceDuration + t - duration;
    const s = segments[(edge === "before" ? outputLeft : outputIndex)(segments, t)];
    return s.kind === "freeze"
      ? s.sourceFrom
      : source.sourceAt(source.outputAt(s.sourceFrom) + t - s.from);
  };
  const outputAt = (t, edge = "after") => {
    if (t < 0) return t;
    if (t > source.sourceDuration || (t === source.sourceDuration && edge !== "before"))
      return duration + t - source.sourceDuration;
    const s = plays[sourceIndex[edge === "before" ? "left" : "right"](plays, t)];
    return s
      ? s.from + source.outputAt(Math.max(s.sourceFrom, t), edge) - source.outputAt(s.sourceFrom)
      : duration;
  };
  return {
    sourceDuration: source.sourceDuration,
    duration,
    segments,
    placements,
    sourceAt,
    outputAt,
    visible: (t) =>
      t >= source.sourceDuration ||
      plays.some((s) => !s.blank && t >= s.sourceFrom && t < s.sourceTo),
  };
};
