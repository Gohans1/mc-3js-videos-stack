import { resolveTextItem } from "film-stage/titles-catalog";
import { graphemes, inOutLengths } from "film-stage/titles-text";

import { isTornByReorder, remapOutputTime, timebaseClock } from "./layer-timing.mjs";

export const READ_CPS = 20;
export const READ_MIN = 5 / 6;
export const SIZE_MIN = 36;

export const isRead = (it, tracks, doc = null) => {
  const r = it && (doc || it.preset) ? resolveTextItem(it, doc) : it;
  return (
    (r?.kind ?? "text") === "text" &&
    r.read !== false &&
    !r.hidden &&
    !tracks?.[r.track ?? 0]?.hidden &&
    !!r.text?.trim()
  );
};
export const charsOf = (text) => graphemes(text.replace(/\s*\n\s*/g, " ").trim()).length;
export const pxOf = (it, doc = null) => {
  const r = it && (doc || it.preset) ? resolveTextItem(it, doc) : it;
  return (r.size ?? 56) * (r.scale ?? 1);
};

export const sizeFaults = (scene, ratio = "16:9") => {
  const word = ["size", "scale"].find((k) => scene[k] != null && typeof scene[k] !== "number");
  if (word)
    return [
      `"${word}" is ${JSON.stringify(scene[word])}, not a number: ${word === "size" ? "px at 1080, e.g. 56" : "a factor, e.g. 1.5"}`,
    ];
  const px = pxOf(scene);
  if (!(px > 0))
    return [
      `size ${+px.toFixed(1)} draws no text: a size above 0 (${SIZE_MIN} or more to read on a phone)`,
    ];
  return px < SIZE_MIN
    ? [
        `size ${+px.toFixed(1)} is ${((px / 1080) * 100).toFixed(1)}% of the frame ${ratio === "9:16" ? "width" : "height"}; under ${SIZE_MIN} (3.3%) words are mush on a phone (BBC subtitles: a line is 7-8%): size ${SIZE_MIN} or more`,
      ]
    : [];
};
export const heardInOut = (scene, heard, clock = null) => {
  const io = inOutLengths(scene);
  if (clock) {
    const basis = scene.timebase && timebaseClock(scene.timebase);
    const srcA = basis ? basis.sourceAt(scene.from, "after") : scene.from;
    const srcB = basis ? basis.sourceAt(scene.to, "before") : scene.to;
    if (scene.to > scene.from && srcB > srcA && isTornByReorder(clock, srcA, srcB))
      return { in: io.in, out: io.out };
    const forward = basis ? (t, edge) => remapOutputTime(basis, clock, t, edge) : clock.outputAt;
    return {
      in: io.in > 0 ? Math.max(0, forward(scene.from + io.in, "after") - heard.from) : 0,
      out: io.out > 0 ? Math.max(0, heard.to - forward(scene.to - io.out, "after")) : 0,
    };
  }
  const k = (heard.to - heard.from) / (scene.to - scene.from || 1);
  return {
    in: typeof heard.in?.len === "number" ? heard.in.len : io.in * k,
    out: typeof heard.out?.len === "number" ? heard.out.len : io.out * k,
  };
};
const visibleSpans = (from, to, clock) => {
  const hiCap = clock ? Math.min(to, clock.duration) : to;
  const lo = Math.max(0, from);
  if (!(hiCap > lo)) return [];
  if (!clock?.segments?.length) return [[lo, hiCap]];
  const out = [];
  for (const s of clock.segments) {
    if (s.blank || s.to <= lo || s.from >= hiCap) continue;
    const a = Math.max(lo, s.from),
      b = Math.min(hiCap, s.to);
    if (b > a) {
      const prev = out.at(-1);
      if (prev && prev[1] >= a - 1e-9) prev[1] = Math.max(prev[1], b);
      else out.push([a, b]);
    }
  }
  return out;
};

export const readPace = (scene, heard, end = Infinity, clock = null) => {
  const spans = visibleSpans(heard.from, Math.min(heard.to, end), clock);
  if (clock && !spans.length) return null;
  const io = heardInOut(scene, heard, clock),
    to = Math.min(heard.to, end),
    shown = Math.max(0, to - heard.from),
    inLen = Math.min(shown, io.in);
  const readable = clock
      ? spans.reduce((sum, [a, b]) => {
          const dIn = Math.max(0, Math.min(b, heard.from + io.in) - a);
          const dOut = Math.max(0, b - Math.max(a, heard.to - io.out));
          return sum + Math.max(0, b - a - dIn / 2 - dOut / 2);
        }, 0)
      : Math.max(0, shown - inLen / 2 - Math.max(0, to - (heard.to - io.out)) / 2),
    chars = charsOf(scene.text),
    needs = Math.max(READ_MIN, chars / READ_CPS);
  return { readable, needs, chars, tooBrief: readable < needs - 0.005 };
};

export const PACE = `${READ_CPS} characters a second and at least ${READ_MIN.toFixed(2)} s, Netflix's subtitle pace`;

export const readFaults = (scene, heard, ratio = "16:9", end = Infinity, clock = null) => {
  const pace = readPace(scene, heard, end, clock);
  if (!pace) return [];
  return [
    ...(pace.tooBrief
      ? [
          `readable about ${pace.readable.toFixed(2)} s for ${pace.chars} characters; a reader needs ${pace.needs.toFixed(2)} s (${PACE}): hold it longer, cut words, or a shorter In and Out`,
        ]
      : []),
    ...sizeFaults(scene, ratio),
  ];
};

export const textCheckSample = (h, io, from, to, fps = 30, clock = null) => {
  const spans = visibleSpans(Math.max(h.from, from), Math.min(h.to, to), clock);
  if (!spans.length) return null;
  const fullA = h.from + (io?.in ?? 0),
    fullB = h.to - (io?.out ?? 0);
  let best = null;
  for (const [sLo, sHi] of spans) {
    const cLo = Math.max(sLo, fullA),
      cHi = Math.min(sHi, fullB);
    const pick = cHi > cLo ? [cLo, cHi, 1] : [sLo, sHi, 0];
    if (
      !best ||
      pick[2] > best[2] ||
      (pick[2] === best[2] && pick[1] - pick[0] > best[1] - best[0])
    )
      best = pick;
  }
  const [lo, hi] = best;
  const mid = (lo + hi) / 2;
  let at = Math.round(mid * fps) / fps;
  if (at < lo) at = Math.ceil(lo * fps) / fps;
  if (at >= hi) at = Math.floor((hi - 1e-9) * fps) / fps;
  return at >= lo && at < hi ? at : mid;
};

const planEnd = (plan) =>
  plan && typeof plan === "object"
    ? Math.max(
        0,
        ...(plan.gaps ?? []).map((g) => g?.to ?? (g?.at ?? 0) + (g?.duration ?? 0)),
        ...(plan.freezes ?? []).map((f) => f?.at ?? 0),
        ...(plan.speeds ?? []).map((s) => s?.to ?? 0),
        ...(plan.cuts ?? []).map((c) => c?.to ?? 0),
        ...(plan.main ?? []).map((m) => m?.sourceTo ?? m?.to ?? m?.frame ?? 0),
      )
    : 0;

export const fallbackTimingDuration = (items = [], timing = {}) => {
  const histories = [timing.layers, ...Object.values(timing.layerKinds ?? {})].filter(Boolean);
  const plans = [
    timing,
    ...histories.flatMap((h) =>
      Array.isArray(h) ? h : [h.base, ...(h.changes ?? []).flatMap((c) => [c?.before, c?.after])],
    ),
  ];
  return Math.max(1, ...(items ?? []).map((it) => Number(it?.to) || 0), ...plans.map(planEnd));
};
