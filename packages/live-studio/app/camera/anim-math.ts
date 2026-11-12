// Pure animation state, clock mapping and timeline handle geometry shared by camera/anim.ts, camera/camrow.ts and tests.
import { ANIM_CATEGORIES, type AnimCurve, ANIMS, fitAnimationLengths } from "film-stage/animate";

import { effectLength, effectSpan } from "../../src/timing-effects.mjs";
import type { TimingClock } from "../../src/timing.mjs";

const BUILTIN_ANIM_IDS = new Set(
  [...ANIMS.in, ...ANIMS.out, ...ANIMS.combo].map((fx) => fx.id as string),
);

export type AnimSlotName = "in" | "out" | "combo";
export interface AnimSetData {
  fx: string;
  len?: number;
  k?: number;
  curve?: AnimCurve;
  flip?: boolean;
  optics?: number;
  seam?: boolean;
}
export type ShotAnimData = Partial<Record<AnimSlotName, AnimSetData>>;
export interface AnimFxMeta {
  id: string;
  len?: number;
  black?: boolean;
  move?: string;
  loop?: string;
  flip?: boolean;
  optics?: boolean;
  pair?: string;
}
export interface PlaySegment {
  sourceFrom: number;
  sourceTo: number;
  from: number;
  to: number;
}
export interface AnimHandleCandidate {
  i: number;
  slot: "in" | "out";
  x: number;
  anchor: number;
  inAnchor?: number;
  outAnchor?: number;
}

export const MIN_ANIM = 0.1;
const r2 = (v: number) => Math.round(v * 100) / 100;

// Loops run off the clock and a pure black fade has no camera travel, so a motion curve only applies outside those two.
export const fxSupportsCurve = (fx: AnimFxMeta | undefined): boolean =>
  Boolean(fx && !fx.loop && !(fx.black && !fx.move));

export const shouldSyncPair = (cur: AnimSetData | undefined, fx: AnimFxMeta | undefined): boolean =>
  Boolean(fx?.pair) && cur?.seam !== false;

export const canLinkSeamPair = (
  cur: AnimSetData | undefined,
  fx: AnimFxMeta | undefined,
  other: AnimSetData | undefined,
  partnerFxId: string | undefined,
): boolean =>
  shouldSyncPair(cur, fx) &&
  Boolean(partnerFxId && other?.fx === partnerFxId && other.seam !== false);

export const orderedAnimCategories = (
  list: readonly { cat: string; pair?: string }[],
): string[] => {
  const present = new Set(list.map((x) => x.cat));
  const canonical = ANIM_CATEGORIES.filter((c) => present.has(c));
  const extra = [...present].filter((c) => !(ANIM_CATEGORIES as readonly string[]).includes(c));
  return [
    "All",
    "Favorites",
    ...(list.some((x) => x.pair) ? ["Seam"] : []),
    ...canonical,
    ...extra,
  ];
};

// Strip defaults (curve undefined, flip false, seam true, k 1, optics 1) and clamp optics to [0..1]; when `fx` is known, also
// drop capabilities the preset cannot express so shots.json never accumulates dead fields.
export const tidyAnimSet = (a: AnimSetData, fx?: AnimFxMeta): AnimSetData => {
  const next: AnimSetData = { ...a };
  const isCustom = Boolean(
    fx && (("apply" in fx && typeof fx.apply === "function") || !BUILTIN_ANIM_IDS.has(fx.id)),
  );
  const canFlip = fx ? (isCustom ? fx.flip !== false : Boolean(fx.flip)) : true;
  const canOptics = fx ? (isCustom ? fx.optics !== false : Boolean(fx.optics)) : true;
  if (next.k !== undefined) {
    const k = r2(next.k);
    if (k === 1) delete next.k;
    else next.k = k;
  }
  if (!next.curve || next.curve === "auto" || (fx && !fxSupportsCurve(fx))) delete next.curve;
  if (!next.flip || !canFlip) delete next.flip;
  if (next.seam !== false || (fx && !fx.pair)) delete next.seam;
  if (next.optics !== undefined) {
    if (!canOptics) delete next.optics;
    else {
      const o = Math.max(0, r2(next.optics));
      if (o >= 1) delete next.optics;
      else next.optics = o;
    }
  }
  return next;
};

export const freshAnimSet = ({
  cur,
  from,
  slot,
  id,
  fx,
  maxSourceLen,
}: {
  cur?: AnimSetData;
  from?: AnimSetData;
  slot: AnimSlotName;
  id: string;
  fx?: AnimFxMeta;
  maxSourceLen: number;
}): AnimSetData => {
  const base: AnimSetData = {
    fx: id,
    ...(cur?.k !== undefined ? { k: cur.k } : {}),
    ...(from?.curve ? { curve: from.curve } : {}),
    ...(from?.flip ? { flip: true } : {}),
    ...(from?.optics !== undefined ? { optics: from.optics } : {}),
    ...(cur?.seam === false ? { seam: false } : {}),
  };
  if (slot !== "combo") {
    const want = cur?.len ?? fx?.len ?? 0.5;
    base.len = Math.max(MIN_ANIM, r2(Math.min(want, Math.max(MIN_ANIM, maxSourceLen))));
  }
  return tidyAnimSet(base, fx);
};

export const syncPairedOption = (
  other: AnimSetData,
  patch: Partial<Pick<AnimSetData, "curve" | "flip" | "optics">>,
  otherFx?: AnimFxMeta,
): AnimSetData => tidyAnimSet({ ...other, ...patch }, otherFx);

const spanOfSlot = (
  clock: TimingClock | null,
  shotSource: [number, number],
  slot: "in" | "out",
  srcLen: number,
): [number, number] => {
  if (srcLen <= 0)
    return slot === "in" ? [shotSource[0], shotSource[0]] : [shotSource[1], shotSource[1]];
  if (!clock)
    return slot === "in"
      ? [shotSource[0], shotSource[0] + srcLen]
      : [shotSource[1] - srcLen, shotSource[1]];
  return slot === "in"
    ? (effectSpan(clock, shotSource[0], 0, 1, srcLen) as [number, number])
    : (effectSpan(clock, shotSource[1], 1, 0, srcLen) as [number, number]);
};

export interface AnimSlotMetrics {
  srcIn: number;
  srcOut: number;
  maxSrcIn: number;
  maxSrcOut: number;
  inSpan: [number, number];
  outSpan: [number, number];
  inLen: number;
  outLen: number;
  inRoom: number;
  outRoom: number;
}

export const animSlotMetrics = (
  shotSource: [number, number],
  clock: TimingClock | null,
  an: ShotAnimData,
  defaultInLen = 0.5,
  defaultOutLen = 0.5,
): AnimSlotMetrics => {
  const rawSpan = Math.max(0, shotSource[1] - shotSource[0]);
  const rawIn = an.in ? (an.in.len ?? defaultInLen) : 0;
  const rawOut = an.out ? (an.out.len ?? defaultOutLen) : 0;
  const [srcIn, srcOut] = fitAnimationLengths(rawIn, rawOut, rawSpan);
  const maxSrcIn = Math.max(MIN_ANIM, rawSpan - srcOut);
  const maxSrcOut = Math.max(MIN_ANIM, rawSpan - srcIn);
  const inSpan = spanOfSlot(clock, shotSource, "in", srcIn);
  const outSpan = spanOfSlot(clock, shotSource, "out", srcOut);
  const inMaxSpan = spanOfSlot(clock, shotSource, "in", maxSrcIn);
  const outMaxSpan = spanOfSlot(clock, shotSource, "out", maxSrcOut);
  return {
    srcIn,
    srcOut,
    maxSrcIn,
    maxSrcOut,
    inSpan,
    outSpan,
    inLen: an.in ? r2(Math.max(0, inSpan[1] - inSpan[0])) : 0,
    outLen: an.out ? r2(Math.max(0, outSpan[1] - outSpan[0])) : 0,
    inRoom: Math.max(MIN_ANIM, r2(Math.max(0, inMaxSpan[1] - inMaxSpan[0]))),
    outRoom: Math.max(MIN_ANIM, r2(Math.max(0, outMaxSpan[1] - outMaxSpan[0]))),
  };
};

export const applyAnimDuration = (
  shotSource: [number, number],
  clock: TimingClock | null,
  an: ShotAnimData,
  slot: "in" | "out",
  wantOutputSeconds: number,
  defaultInLen = 0.5,
  defaultOutLen = 0.5,
): ShotAnimData => {
  const cur = an[slot];
  if (!cur) return an;
  const m = animSlotMetrics(shotSource, clock, an, defaultInLen, defaultOutLen);
  const maxSrc = slot === "in" ? m.maxSrcIn : m.maxSrcOut;
  const clampedOut = Math.max(
    MIN_ANIM,
    Math.min(slot === "in" ? m.inRoom : m.outRoom, wantOutputSeconds),
  );
  const srcLen = clock
    ? Math.max(
        MIN_ANIM,
        r2(
          effectLength(
            clock,
            slot === "in" ? shotSource[0] : shotSource[1],
            slot === "in" ? 0 : 1,
            slot === "in" ? 1 : 0,
            clampedOut,
            maxSrc,
          ),
        ),
      )
    : Math.max(MIN_ANIM, r2(Math.min(clampedOut, maxSrc)));
  const next: ShotAnimData = { ...an, [slot]: { ...cur, len: srcLen } };
  // If both slots previously overlapped (e.g. 3s + 3s fitted to 2s + 2s on a 4s shot), pin the other slot at its displayed
  // fitted length so shrinking this slot does not make the other slot suddenly expand into the freed space.
  const otherSlot = slot === "in" ? "out" : "in";
  const other = an[otherSlot];
  const rawSpan = Math.max(0, shotSource[1] - shotSource[0]);
  if (other) {
    const otherRaw = other.len ?? (otherSlot === "in" ? defaultInLen : defaultOutLen);
    const otherShown = otherSlot === "in" ? m.srcIn : m.srcOut;
    if (otherRaw > rawSpan - srcLen + 1e-6) {
      next[otherSlot] = {
        ...other,
        len: Math.max(MIN_ANIM, r2(Math.min(otherShown, Math.max(MIN_ANIM, rawSpan - srcLen)))),
      };
    }
  }
  return next;
};

// Intersection of an In/Out animation with one visible play segment on the camera row, plus where its inner trim handle sits.
export const animBandOnSegment = (
  shotSource: [number, number],
  clock: TimingClock | null,
  m: AnimSlotMetrics,
  seg: PlaySegment,
  slot: "in" | "out",
): { from: number; to: number; handleAt: number | null } | null => {
  const srcLen = slot === "in" ? m.srcIn : m.srcOut;
  if (srcLen <= 0) return null;
  const bandFromSrc = slot === "in" ? shotSource[0] : shotSource[1] - srcLen;
  const bandToSrc = slot === "in" ? shotSource[0] + srcLen : shotSource[1];
  const aSrc = Math.max(bandFromSrc, seg.sourceFrom);
  const bSrc = Math.min(bandToSrc, seg.sourceTo);
  if (bSrc <= aSrc + 1e-7) return null;
  const from = clock ? clock.outputAt(aSrc, "after") : aSrc;
  const to = clock ? clock.outputAt(bSrc, "before") : bSrc;
  const innerSrc = slot === "in" ? bandToSrc : bandFromSrc;
  const onThisSeg = innerSrc >= seg.sourceFrom - 1e-6 && innerSrc <= seg.sourceTo + 1e-6;
  return { from, to, handleAt: onThisSeg ? (slot === "in" ? to : from) : null };
};

export const clampHandleX = (hx: number, x0: number, x1: number, barWidth = 3): number =>
  Math.min(Math.max(x0, x1 - barWidth), Math.max(x0, hx - barWidth / 2));

export const disambiguateSeamSlot = (dx: number): "in" | "out" => (dx < 0 ? "in" : "out");

export const pickAnimEdge = (
  handles: AnimHandleCandidate[],
  x: number,
  reach: number,
  activeShots: ReadonlySet<number>,
  pickedShot: number | null,
  hoverShot: number,
): (AnimHandleCandidate & { seam: boolean }) | null => {
  // Group active handles by shot so colliding In/Out handles on the same shot can be disambiguated cleanly.
  const byShot = new Map<number, { in?: AnimHandleCandidate; out?: AnimHandleCandidate }>();
  for (const h of handles) {
    if (!activeShots.has(h.i)) continue;
    const entry = byShot.get(h.i) ?? {};
    entry[h.slot] = h;
    byShot.set(h.i, entry);
  }
  let best: (AnimHandleCandidate & { seam: boolean }) | null = null;
  let bestDist = reach + 1e-9;
  let bestRank = -1;
  for (const [i, pair] of byShot) {
    const rank = i === pickedShot ? 2 : i === hoverShot ? 1 : 0;
    if (pair.in && pair.out && Math.abs(pair.in.x - pair.out.x) <= 2) {
      const mid = (pair.in.x + pair.out.x) / 2;
      const dist = Math.abs(mid - x);
      if (dist < bestDist - 1e-6 || (Math.abs(dist - bestDist) <= 1e-6 && rank > bestRank)) {
        const seam = Math.abs(x - mid) <= 0.5;
        const chosen = x <= mid ? pair.in : pair.out;
        bestDist = dist;
        bestRank = rank;
        best = { ...chosen, inAnchor: pair.in.anchor, outAnchor: pair.out.anchor, seam };
      }
      continue;
    }
    for (const slot of ["in", "out"] as const) {
      const h = pair[slot];
      if (!h) continue;
      const dist = Math.abs(h.x - x);
      if (dist < bestDist - 1e-6 || (Math.abs(dist - bestDist) <= 1e-6 && rank > bestRank)) {
        bestDist = dist;
        bestRank = rank;
        best = { ...h, seam: false };
      }
    }
  }
  return best;
};
