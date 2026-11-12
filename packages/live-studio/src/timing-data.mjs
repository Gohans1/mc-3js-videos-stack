import { isTornByReorder, remapOutputTime, startsOnHold, timebaseClock } from "./layer-timing.mjs";
import { clipTiming } from "./timing.mjs";

const overlaySpan = (clock, basis, a, b) => {
  const forward = basis ? (t, edge) => remapOutputTime(basis, clock, t, edge) : clock.outputAt;
  const srcA = basis ? basis.sourceAt(a, "after") : a,
    srcB = basis ? basis.sourceAt(b, "before") : b;
  const startEdge = startsOnHold(clock, a, forward, srcA) ? "before" : "after";
  const from = forward(a, startEdge);
  if (b > a && srcB > srcA && isTornByReorder(clock, srcA, srcB))
    return { from, to: from + (b - a), startEdge, torn: true };
  return { from, to: forward(b, "before"), startEdge, torn: false };
};

const soundSpan = (clock, a, b) => {
  const from = clock.outputAt(a, "after");
  if (b > a && isTornByReorder(clock, a, b)) return { from, to: from + (b - a), torn: true };
  return { from, to: clock.outputAt(b, "before"), torn: false };
};

export const mapTimeline = (
  name,
  data,
  clock,
  inverse = false,
  previous = null,
  durations = {},
) => {
  if (data === null) return null;
  if (name === "sound" && clock.forClip) {
    const result = structuredClone(data);
    for (const list of ["beds", "sfx"])
      result[list] = data[list].map(
        (clip, i) =>
          mapTimeline(
            name,
            { beds: [], sfx: [], [list]: [clip] },
            clock.forClip(clip, list, data),
            inverse,
            previous && { beds: [], sfx: [], [list]: [previous[list][i]] },
            durations,
          )[list][0],
      );
    return result;
  }
  const out = structuredClone(data),
    time = inverse ? clock.sourceAt : clock.outputAt;
  const keyVisible = (k) =>
    clock.visible(k.t) || (name === "cam" && !k.cut && clock.visible(k.t - 1e-7));
  const keys = (value, before, depth = 0) => {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) {
      if (
        value.every((k) => k && typeof k === "object" && !Array.isArray(k) && Number.isFinite(k.t))
      ) {
        const mapped = value
          .filter((k) => inverse || keyVisible(k))
          .map((k) => {
            const edge = name === "cam" && !k.cut && k.t > 0 ? "before" : "after";
            const meta = k.__timing;
            const t =
              inverse && meta && Math.abs(k.t - meta.output) < 1e-9 ? meta.source : time(k.t, edge);
            const next = { ...k, t };
            if (inverse) delete next.__timing;
            else if (clock.placements) next.__timing = { source: k.t, output: t };
            return next;
          });
        if (inverse && Array.isArray(before))
          mapped.push(...structuredClone(before.filter((k) => !keyVisible(k))));
        return mapped.sort(
          (a, b) =>
            a.t - b.t ||
            (name === "cam"
              ? Number(!!a.cut || a.__timing?.source === 0) -
                Number(!!b.cut || b.__timing?.source === 0)
              : 0),
        );
      }
      return value.map((v, i) => keys(v, before?.[i], depth + 1));
    }
    for (const k of Object.keys(value))
      if (k !== "__timing") value[k] = keys(value[k], before?.[k], depth + 1);
    if (depth > 0 && Number.isFinite(value.t)) {
      const meta = value.__timing;
      const hiddenBefore = inverse && before && Number.isFinite(before.t) && !keyVisible(before);
      const unchanged = meta && Math.abs(value.t - meta.output) < 1e-9;
      const t = inverse
        ? unchanged
          ? meta.source
          : hiddenBefore && Math.abs(value.t - clock.outputAt(before.t, "after")) < 1e-9
            ? before.t
            : time(value.t, "after")
        : time(value.t, "after");
      if (inverse) delete value.__timing;
      else if (clock.placements || !keyVisible(value))
        value.__timing = { source: value.t, output: t };
      value.t = t;
    }
    return value;
  };
  if (name === "cam" || name.startsWith("keys/")) return keys(out, previous);
  if (name === "text" || name === "adjustment") {
    for (const [index, item] of out.items.entries()) {
      const a = item.from,
        b = item.to;
      const basis = item.timebase && timebaseClock(item.timebase);
      const forward = basis ? (t, edge) => remapOutputTime(basis, clock, t, edge) : clock.outputAt;
      const backward = basis ? (t, edge) => remapOutputTime(clock, basis, t, edge) : clock.sourceAt;
      const original = inverse ? item.__timing?.source : null;
      if (!inverse) {
        const span = overlaySpan(clock, basis, a, b);
        item.from = span.from;
        item.to = span.to;
        if (item.in?.len !== undefined)
          item.in.len = span.torn ? item.in.len : forward(a + item.in.len, "after") - item.from;
        if (item.out?.len !== undefined)
          item.out.len = span.torn ? item.out.len : item.to - forward(b - item.out.len, "after");
        item.__timing = { source: structuredClone(data.items[index]) };
        continue;
      }
      const origSpan = original && overlaySpan(clock, basis, original.from, original.to);
      item.from =
        original && Math.abs(a - origSpan.from) < 1e-9 ? original.from : backward(a, "after");
      item.to = original && Math.abs(b - origSpan.to) < 1e-9 ? original.to : backward(b, "before");
      const restore = (t, source, edge = "after") =>
        original && Number.isFinite(source) && Math.abs(t - forward(source, edge)) < 1e-9
          ? source
          : backward(t, edge);
      if (item.in?.len !== undefined) {
        const origIn =
          original?.in?.len !== undefined
            ? origSpan.torn
              ? origSpan.from + original.in.len
              : forward(original.from + original.in.len, "after")
            : NaN;
        item.in.len =
          Number.isFinite(origIn) &&
          Math.abs(a + item.in.len - origIn) < 1e-9 &&
          item.from === original.from
            ? original.in.len
            : restore(a + item.in.len, original?.from + original?.in?.len, "after") - item.from;
      }
      if (item.out?.len !== undefined) {
        const origOut =
          original?.out?.len !== undefined
            ? origSpan.torn
              ? origSpan.to - original.out.len
              : forward(original.to - original.out.len, "after")
            : NaN;
        item.out.len =
          Number.isFinite(origOut) &&
          Math.abs(b - item.out.len - origOut) < 1e-9 &&
          item.to === original.to
            ? original.out.len
            : item.to - restore(b - item.out.len, original?.to - original?.out?.len, "after");
      }
      const input = data.items[index];
      const check = item.to > item.from ? overlaySpan(clock, basis, item.from, item.to) : null;
      const mismatch =
        !check ||
        Math.abs(check.from - a) > 1e-7 ||
        Math.abs(check.to - b) > 1e-7 ||
        (input.in?.len !== undefined &&
          Math.abs(
            (check.torn ? item.in.len : forward(item.from + item.in.len, "after") - check.from) -
              input.in.len,
          ) > 1e-7) ||
        (input.out?.len !== undefined &&
          Math.abs(
            (check.torn ? item.out.len : check.to - forward(item.to - item.out.len, "after")) -
              input.out.len,
          ) > 1e-7);
      // A freeze or reordered seam with no unique source span retains this item's track clock instead of collapsing or inverting.
      if (b > a && mismatch) {
        item.from = a;
        item.to = b;
        if (input.in) item.in = structuredClone(input.in);
        if (input.out) item.out = structuredClone(input.out);
        item.timebase = structuredClone(clock.timebase);
      }
      delete item.__timing;
    }
  }
  if (
    name === "sound" &&
    clock.segments.some(
      (s) =>
        s.blank || s.kind !== "play" || s.rate0 !== 1 || s.rate1 !== 1 || s.from !== s.sourceFrom,
    )
  ) {
    for (const list of ["beds", "sfx"])
      for (const [index, c] of out[list].entries()) {
        const meta = c.__timing,
          original = meta?.source;
        const a = list === "beds" ? c.from : c.at;
        const length =
          list === "beds"
            ? c.to - a
            : (c.length ?? ((durations[c.name] ?? 0) - (c.start ?? 0)) / (c.rate ?? 1));
        const oldFrom = original && (list === "beds" ? original.from : original.at),
          oldTo = original && oldFrom + meta.duration;
        const b = a + Math.max(0, length);
        if (!inverse) {
          const span = soundSpan(clock, a, b);
          const restore = (t) => (span.torn ? span.from + (t - a) : time(t));
          if (c.gainKeys)
            c.gainKeys = c.gainKeys.map((k) => ({ ...k, t: restore(a + k.t) - span.from }));
          if (c.beats) c.beats = c.beats.map((t) => restore(a + t) - span.from);
          if (c.fadeIn !== undefined) c.fadeIn = restore(a + c.fadeIn) - span.from;
          if (c.fadeOut !== undefined) c.fadeOut = span.to - restore(b - c.fadeOut);
          if (list === "beds") {
            c.from = span.from;
            c.to = span.to;
          } else {
            c.at = span.from;
            if (length > 0 || c.length !== undefined) c.length = span.to - span.from;
          }
          const timeline = span.torn
            ? b > a
              ? [
                  {
                    kind: "play",
                    sourceFrom: 0,
                    sourceTo: b - a,
                    from: 0,
                    to: b - a,
                    rate0: 1,
                    rate1: 1,
                  },
                ]
              : []
            : clipTiming(clock, a, b);
          c.__timing = { source: structuredClone(data[list][index]), duration: length, timeline };
          continue;
        }
        const origSpan = original && soundSpan(clock, oldFrom, oldTo);
        const from = original && Math.abs(a - origSpan.from) < 1e-9 ? oldFrom : time(a, "after");
        let to = original && Math.abs(b - origSpan.to) < 1e-9 ? oldTo : time(b, "before");
        const checkSpan = to > from ? soundSpan(clock, from, to) : null;
        const tornOut =
          b > a &&
          (!checkSpan || Math.abs(checkSpan.from - a) > 1e-7 || Math.abs(checkSpan.to - b) > 1e-7);
        if (tornOut) to = from + (b - a);
        const restore = (t, source) => {
          if (original && Number.isFinite(source)) {
            const expected = origSpan.torn
              ? origSpan.from + (source - oldFrom)
              : clock.outputAt(source);
            if (Math.abs(t - expected) < 1e-9) return source;
          }
          return tornOut ? from + (t - a) : time(t, "after");
        };
        if (c.gainKeys)
          c.gainKeys = c.gainKeys.map((k, i) => ({
            ...k,
            t: restore(a + k.t, oldFrom + original?.gainKeys?.[i]?.t) - from,
          }));
        if (c.beats)
          c.beats = c.beats.map((t, i) => restore(a + t, oldFrom + original?.beats?.[i]) - from);
        if (c.fadeIn !== undefined)
          c.fadeIn = restore(a + c.fadeIn, oldFrom + original?.fadeIn) - from;
        if (c.fadeOut !== undefined)
          c.fadeOut = to - restore(b - c.fadeOut, oldTo - original?.fadeOut);
        if (list === "beds") {
          c.from = from;
          c.to = to;
        } else {
          c.at = from;
          if (length > 0 || c.length !== undefined) c.length = to - from;
        }
        delete c.__timing;
        if (!original) continue;
        const ratio = (original.rate ?? 1) / (c.rate ?? 1);
        if (ratio !== 1) {
          if (list === "beds") c.to = from + meta.duration * ratio;
          else c.length = meta.duration * ratio;
          if (c.gainKeys && original.gainKeys)
            c.gainKeys = c.gainKeys.map((k, i) => ({ ...k, t: original.gainKeys[i].t * ratio }));
          if (original.beats) c.beats = original.beats.map((t) => t * ratio);
          if (original.fadeIn !== undefined) c.fadeIn = original.fadeIn * ratio;
          if (original.fadeOut !== undefined) c.fadeOut = original.fadeOut * ratio;
        } else if ((c.start ?? 0) !== (original.start ?? 0) && (from !== oldFrom || to !== oldTo)) {
          c.start =
            (original.start ?? 0) + (c.reverse ? oldTo - to : from - oldFrom) * (c.rate ?? 1);
        }
        if (list === "sfx" && original.length === undefined && from === oldFrom && to === oldTo)
          delete c.length;
      }
  }
  return out;
};

export const mapVoice = (lines, clock) => {
  const ranges = [];
  for (const s of [
    ...clock.segments,
    {
      kind: "play",
      sourceFrom: clock.sourceDuration,
      sourceTo: Infinity,
      from: clock.duration,
      to: Infinity,
    },
  ]) {
    if (s.kind !== "play" || s.blank) continue;
    const last = ranges.at(-1);
    if (
      last &&
      Math.abs(last.sourceTo - s.sourceFrom) < 1e-9 &&
      Math.abs(last.to - s.from) < 1e-9
    ) {
      last.sourceTo = s.sourceTo;
      last.to = s.to;
    } else ranges.push({ ...s });
  }
  return lines
    .flatMap((l) =>
      ranges.flatMap((r) => {
        const a = Math.max(l.s, r.sourceFrom),
          b = Math.min(l.e, r.sourceTo);
        if (b <= a) return [];
        const words = l.words
          .filter((w) => w.e > a && w.s < b)
          .map((w) => ({
            ...w,
            s: clock.outputAt(Math.max(w.s, a)),
            e: clock.outputAt(Math.min(w.e, b), "before"),
          }));
        return [
          {
            ...l,
            s: clock.outputAt(a),
            e: clock.outputAt(b, "before"),
            words,
            ...(words.length && { text: words.map((w) => w.w).join(" ") }),
            ...(Number.isFinite(r.to) && { until: r.to }),
          },
        ];
      }),
    )
    .sort((a, b) => a.s - b.s || a.e - b.e);
};
