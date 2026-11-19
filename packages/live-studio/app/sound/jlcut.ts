export const DEFAULT_JL_CUT_SEC = 0.75;
const EDGE_SNAP_WINDOW_SEC = 3.0;
const EPS = 1e-4;

export interface ShotCutOverlap {
  cuts: number[];
  jLead: { cut: number; amount: number } | null;
  lTrail: { cut: number; amount: number } | null;
}

export function shotCutOverlaps(
  from: number,
  to: number,
  cutTimes: readonly number[],
): ShotCutOverlap {
  const cuts = cutTimes.filter((t) => t > from + 0.015 && t < to - 0.015).sort((a, b) => a - b);
  if (cuts.length === 0) return { cuts, jLead: null, lTrail: null };

  const first = cuts[0];
  const last = cuts[cuts.length - 1];
  if (first === last) {
    const leftSide = first - from;
    const rightSide = to - first;
    if (leftSide <= rightSide && leftSide > 0.015 && leftSide <= EDGE_SNAP_WINDOW_SEC) {
      return { cuts, jLead: { cut: first, amount: leftSide }, lTrail: null };
    }
    if (rightSide < leftSide && rightSide > 0.015 && rightSide <= EDGE_SNAP_WINDOW_SEC) {
      return { cuts, jLead: null, lTrail: { cut: last, amount: rightSide } };
    }
    return { cuts, jLead: null, lTrail: null };
  }
  const jLead =
    first - from > 0.015 && first - from <= Math.min(EDGE_SNAP_WINDOW_SEC, cuts[1] - first)
      ? { cut: first, amount: first - from }
      : null;
  const lTrail =
    to - last > 0.015 && to - last <= Math.min(EDGE_SNAP_WINDOW_SEC, last - cuts[cuts.length - 2])
      ? { cut: last, amount: to - last }
      : null;

  return { cuts, jLead, lTrail };
}

export interface CutAdjustBounds {
  from: number;
  to: number;
  prevEnd: number;
  nextStart: number;
  minFrom: number;
  maxTo: number;
  minLength: number;
  cutTimes: readonly number[];
  leadSec?: number;
  trailSec?: number;
}

export interface CutAdjustResult {
  target: number;
  changed: boolean;
  blockedBy?: "neighbour" | "source" | "cut";
}

export function computeJCutStart(bounds: CutAdjustBounds): CutAdjustResult {
  const lead = bounds.leadSec ?? DEFAULT_JL_CUT_SEC;
  const nearCut = bounds.cutTimes.find((t) => Math.abs(t - bounds.from) <= 0.12);
  if (nearCut === undefined || nearCut >= bounds.to - EPS)
    return { target: bounds.from, changed: false, blockedBy: "cut" };
  const desired = nearCut - lead;
  const floorByNeighbour = Math.max(0, bounds.prevEnd);
  const floorBySource = Math.max(0, bounds.minFrom);
  const hardFloor = Math.max(floorByNeighbour, floorBySource);
  const clamped = Math.min(bounds.to - bounds.minLength, Math.max(hardFloor, desired));
  if (bounds.from - clamped <= EPS || clamped >= nearCut - EPS) {
    return {
      target: bounds.from,
      changed: false,
      blockedBy: floorBySource >= floorByNeighbour ? "source" : "neighbour",
    };
  }
  return { target: clamped, changed: true };
}

export function computeLCutEnd(bounds: CutAdjustBounds): CutAdjustResult {
  const trail = bounds.trailSec ?? DEFAULT_JL_CUT_SEC;
  const nearCut = bounds.cutTimes.find((t) => Math.abs(t - bounds.to) <= 0.12);
  if (nearCut === undefined || nearCut <= bounds.from + EPS)
    return { target: bounds.to, changed: false, blockedBy: "cut" };
  const desired = nearCut + trail;
  const ceilByNeighbour = bounds.nextStart;
  const ceilBySource = bounds.maxTo;
  const hardCeil = Math.min(ceilByNeighbour, ceilBySource);
  const clamped = Math.max(bounds.from + bounds.minLength, Math.min(hardCeil, desired));
  if (clamped - bounds.to <= EPS || clamped <= nearCut + EPS) {
    return {
      target: bounds.to,
      changed: false,
      blockedBy: ceilBySource <= ceilByNeighbour ? "source" : "neighbour",
    };
  }
  return { target: clamped, changed: true };
}
