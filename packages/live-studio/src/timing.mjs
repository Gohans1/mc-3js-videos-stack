import { bisector } from "d3-array";

import { timingPlan } from "./linkage.mjs";
import { compileMainTrack } from "./main-track.mjs";
import { cropSpeedCurve, flattenSpeedCurve } from "./speed-curve.mjs";

const lerp = (a, b, u) => a + (b - a) * u;
const pointIndex = bisector((p) => p[0]).right;
const sourceIndex = bisector((s) => s.sourceTo).right;
const outputIndex = bisector((s) => s.to).right;
const outputLeft = bisector((s) => s.to).left;
const rangeStart = bisector((s) => s.from).left;
const sourceRanges = new WeakMap();

export const visibleSourceRange = (clock, from, to) => {
  if (!sourceRanges.has(clock)) {
    const ranges = [];
    for (const s of [...clock.segments].sort((a, b) => a.sourceFrom - b.sourceFrom))
      if (s.kind === "play" && !s.blank) {
        const last = ranges.at(-1);
        if (last?.to === s.sourceFrom) last.to = s.sourceTo;
        else ranges.push({ from: s.sourceFrom, to: s.sourceTo });
      }
    sourceRanges.set(clock, ranges);
  }
  const ranges = sourceRanges.get(clock),
    first = outputIndex(ranges, from),
    last = rangeStart(ranges, to) - 1;
  return last >= first
    ? [Math.max(from, ranges[first].from), Math.min(to, ranges[last].to)]
    : [from, from];
};

export const segmentAt = (clock, t, edge = "after") =>
  clock.segments[(edge === "before" ? outputLeft : outputIndex)(clock.segments, t)];
export const frameAt = (clock, t) => segmentAt(clock, t)?.frame ?? clock.sourceAt(t);
export const frameVisible = (clock, t) =>
  t >= 0 && t < clock.duration && !segmentAt(clock, t)?.blank;
export const freezesOf = (timing) =>
  timing.main
    ? timing.main.filter((it) => it.kind === "freeze").map((it) => ({ ...it, at: it.frame }))
    : (timing.freezes ?? []);
export const freezeRange = (timing, clock, i) => {
  if (timing.main) {
    const f = clock.placements.filter((it) => it.kind === "freeze")[i];
    return f ? [f.from, f.to] : [0, 0];
  }
  const f = timing.freezes[i];
  const earlier = timing.freezes
    .slice(0, i)
    .filter((other) => other.at === f.at)
    .reduce(
      (sum, other) => sum + other.duration + (other.padBefore ?? 0) + (other.padAfter ?? 0),
      0,
    );
  const from = clock.outputAt(f.at, "before") + earlier + (f.padBefore ?? 0);
  return [from, from + f.duration];
};
export const moveFreeze = (timing, i, start, sourceDuration, ripple) => {
  const f = timing.freezes?.[i];
  if (!f || f.blank) return i;
  const moving = { ...f, frame: f.frame ?? f.at };
  delete moving.padBefore;
  delete moving.padAfter;
  deleteFreeze(timing, i, ripple);
  const clock = compileTiming(timing, sourceDuration),
    t = Math.max(0, Math.min(clock.duration, start));
  moving.at = Math.max(0, Math.min(sourceDuration, clock.sourceAt(t)));
  timing.freezes.push(moving);
  return timing.freezes.length - 1;
};
export const resizeFreeze = (timing, i, duration, ripple, edge = 1) => {
  if (timing.main) {
    const f = timing.main.filter((it) => it.kind === "freeze")[i];
    if (!f) return;
    const at = timing.main.indexOf(f),
      neighbour = timing.main[at + edge],
      gap = neighbour?.kind === "gap" ? neighbour : null;
    const next = Math.max(
        1 / 30,
        ripple ? duration : Math.min(duration, f.duration + (gap?.duration ?? 0)),
      ),
      delta = f.duration - next;
    f.duration = next;
    if (!ripple && delta) {
      if (gap) {
        gap.duration += delta;
        if (gap.duration < 1e-7) timing.main.splice(timing.main.indexOf(gap), 1);
      } else
        timing.main.splice(at + (edge > 0 ? 1 : 0), 0, {
          id: crypto.randomUUID(),
          kind: "gap",
          duration: delta,
        });
    }
    return;
  }
  const f = timing.freezes?.[i];
  if (!f || f.blank) return;
  const pad = edge < 0 ? "padBefore" : "padAfter";
  const next = Math.max(1 / 30, ripple ? duration : Math.min(duration, f.duration + (f[pad] ?? 0)));
  if (!ripple) f[pad] = Math.max(0, (f[pad] ?? 0) + f.duration - next);
  f.duration = next;
};
export const deleteFreeze = (timing, i, ripple) => {
  if (timing.main) {
    const f = timing.main.filter((it) => it.kind === "freeze")[i];
    if (!f) return;
    timing.main.splice(
      timing.main.indexOf(f),
      1,
      ...(ripple ? [] : [{ id: crypto.randomUUID(), kind: "gap", duration: f.duration }]),
    );
    return;
  }
  const f = timing.freezes?.[i];
  if (!f) return;
  if (ripple) timing.freezes.splice(i, 1);
  else
    timing.freezes[i] = {
      at: f.at,
      duration: f.duration + (f.padBefore ?? 0) + (f.padAfter ?? 0),
      blank: true,
    };
};
export const closeTimingGaps = (timing) => {
  if (timing.main) {
    timing.main = timing.main.filter((it) => it.kind !== "gap");
    return;
  }
  timing.cuts = joinRanges([...(timing.cuts ?? []), ...(timing.gaps ?? [])]);
  timing.gaps = [];
  timing.freezes = (timing.freezes ?? [])
    .filter((f) => !f.blank)
    .map(({ padBefore: _before, padAfter: _after, ...f }) => f);
};

export const joinRanges = (ranges) => {
  const out = [];
  for (const r of [...ranges].sort((a, b) => a.from - b.from)) {
    const last = out.at(-1);
    if (last && last.to >= r.from) last.to = Math.max(last.to, r.to);
    else out.push({ ...r });
  }
  return out;
};

const speedAt = (effect, source) => {
  if (!effect) return 1;
  if (!effect.curve) return effect.rate ?? 1;
  const u = (source - effect.from) / (effect.to - effect.from),
    points = effect.curve;
  const i = Math.max(0, pointIndex(points, u) - 1),
    a = points[i],
    b = points[i + 1];
  return b ? lerp(a[1], b[1], (u - a[0]) / (b[0] - a[0])) : a[1];
};

export const speedRange = (effect, from, to) => {
  if (!effect.curve) return { from, to, rate: effect.rate ?? 1 };
  return {
    from,
    to,
    ...cropSpeedCurve(
      effect,
      (from - effect.from) / (effect.to - effect.from),
      (to - effect.from) / (effect.to - effect.from),
    ),
  };
};

export const replaceSpeed = (speeds, from, to, value) => {
  const result = speeds.flatMap((s) =>
    s.to <= from || s.from >= to
      ? [s]
      : [
          ...(s.from < from ? [speedRange(s, s.from, from)] : []),
          ...(s.to > to ? [speedRange(s, to, s.to)] : []),
        ],
  );
  if (value && value.rate !== 1) result.push({ from, to, ...value });
  return result.sort((a, b) => a.from - b.from);
};

// Rates vary linearly over source time. Integrating 1/rate gives elapsed output time; its inverse must be used when seeking.
const elapsed = (s, distance) => {
  const k = (s.rate1 - s.rate0) / (s.sourceTo - s.sourceFrom);
  return Math.abs(k) < 1e-10 ? distance / s.rate0 : Math.log1p((k * distance) / s.rate0) / k;
};
const distance = (s, time) => {
  const k = (s.rate1 - s.rate0) / (s.sourceTo - s.sourceFrom);
  return Math.abs(k) < 1e-10 ? time * s.rate0 : (s.rate0 * Math.expm1(k * time)) / k;
};

export const playRanges = (clock, from, to) => {
  const ranges = [];
  for (const s of clock.segments) {
    if (s.kind !== "play" || s.blank) continue;
    const a = Math.max(from, s.sourceFrom),
      b = Math.min(to, s.sourceTo);
    if (b <= a) continue;
    const start = s.from + elapsed(s, a - s.sourceFrom),
      end = s.from + elapsed(s, b - s.sourceFrom),
      last = ranges.at(-1);
    if (last && Math.abs(last.to - start) < 1e-9 && last.sourceTo === a) {
      last.to = end;
      last.sourceTo = b;
    } else ranges.push({ sourceFrom: a, sourceTo: b, from: start, to: end });
  }
  return ranges;
};

export const compileTiming = (timing, sourceDuration) => {
  const timebase = { base: timingPlan(timing), changes: [], sourceDuration };
  if (timing.main)
    return {
      ...compileMainTrack(compileTiming({ speeds: timing.speeds }, sourceDuration), timing.main),
      timebase,
    };
  const speeds = (timing.speeds ?? []).map((s) =>
    s.curve ? { ...s, curve: flattenSpeedCurve(s) } : s,
  );
  const freezes = timing.freezes ?? [],
    cuts = timing.cuts ?? [],
    gaps = timing.gaps ?? [];
  const removed = (s) => cuts.some((c) => s >= c.from && s < c.to);
  const blank = (s) => gaps.some((c) => s >= c.from && s < c.to);
  const visible = (s) => !removed(s) && !blank(s);
  const edges = [
    ...new Set(
      [
        0,
        sourceDuration,
        ...speeds.flatMap((s) => [
          s.from,
          s.to,
          ...(s.curve ?? []).map((p) => lerp(s.from, s.to, p[0])),
        ]),
        ...freezes.map((f) => f.at),
        ...cuts.flatMap((c) => [c.from, c.to]),
        ...gaps.flatMap((c) => [c.from, c.to]),
      ].filter((t) => t >= 0 && t <= sourceDuration),
    ),
  ].sort((a, b) => a - b);
  const segments = [];
  let duration = 0;
  edges.forEach((a, i) => {
    if (!removed(a))
      for (const f of freezes.filter((f) => f.at === a)) {
        for (const [span, hidden] of [
          [f.padBefore ?? 0, true],
          [f.duration, f.blank || blank(a)],
          [f.padAfter ?? 0, true],
        ]) {
          if (span <= 0) continue;
          segments.push({
            kind: "freeze",
            sourceFrom: a,
            sourceTo: a,
            from: duration,
            to: duration + span,
            ...(f.frame !== undefined && { frame: f.frame }),
            ...(hidden && { blank: true }),
          });
          duration += span;
        }
      }
    const b = edges[i + 1];
    if (b === undefined || removed((a + b) / 2)) return;
    const effect = speeds.find((s) => a >= s.from && b <= s.to);
    const s = {
      kind: "play",
      sourceFrom: a,
      sourceTo: b,
      from: duration,
      to: duration,
      rate0: speedAt(effect, a),
      rate1: speedAt(effect, b),
      ...(blank(a) && { blank: true }),
    };
    s.to += elapsed(s, b - a);
    duration = s.to;
    segments.push(s);
  });
  const plays = segments.filter((s) => s.kind === "play"),
    holds = new Map();
  for (const s of segments)
    if (s.kind === "freeze") {
      const last = holds.get(s.sourceFrom);
      holds.set(s.sourceFrom, { from: last?.from ?? s.from, to: s.to });
    }
  const sourceAt = (t, edge = "after") => {
    if (t < 0) return t;
    if (t > duration || (t === duration && (edge !== "before" || !segments.length)))
      return sourceDuration + t - duration;
    const s = segments[(edge === "before" ? outputLeft : outputIndex)(segments, t)];
    return s.kind === "freeze" ? s.sourceFrom : s.sourceFrom + distance(s, t - s.from);
  };
  const outputAt = (t, edge = "after") => {
    if (t < 0) return t;
    const hold = holds.get(t);
    if (hold) return edge === "before" ? hold.from : hold.to;
    if (t >= sourceDuration) return duration + t - sourceDuration;
    const s = plays[sourceIndex(plays, t)];
    return s ? s.from + elapsed(s, Math.max(0, t - s.sourceFrom)) : duration;
  };
  return { duration, sourceDuration, segments, sourceAt, outputAt, visible, timebase };
};

export const clipTiming = (clock, from, to) => {
  const at = clock.outputAt(from),
    out = [];
  for (const s of clock.segments) {
    if (s.kind === "freeze") {
      if (s.sourceFrom > from && s.sourceFrom < to)
        out.push({
          ...s,
          sourceFrom: s.sourceFrom - from,
          sourceTo: s.sourceTo - from,
          from: s.from - at,
          to: s.to - at,
        });
      continue;
    }
    const a = Math.max(from, s.sourceFrom),
      b = Math.min(to, s.sourceTo),
      span = s.sourceTo - s.sourceFrom;
    if (b <= a) continue;
    out.push({
      kind: "play",
      ...(s.blank && { blank: true }),
      sourceFrom: a - from,
      sourceTo: b - from,
      from: s.from + elapsed(s, a - s.sourceFrom) - at,
      to: s.from + elapsed(s, b - s.sourceFrom) - at,
      rate0: lerp(s.rate0, s.rate1, (a - s.sourceFrom) / span),
      rate1: lerp(s.rate0, s.rate1, (b - s.sourceFrom) / span),
    });
  }
  if (to > clock.sourceDuration) {
    const a = Math.max(from, clock.sourceDuration);
    out.push({
      kind: "play",
      sourceFrom: a - from,
      sourceTo: to - from,
      from: clock.outputAt(a) - at,
      to: clock.outputAt(to) - at,
      rate0: 1,
      rate1: 1,
    });
  }
  out.forEach((s, i) => {
    s.from = i ? out[i - 1].to : 0;
  });
  return out;
};
