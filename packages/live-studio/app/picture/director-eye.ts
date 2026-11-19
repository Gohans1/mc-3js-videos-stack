import { r3 } from "../core/time";

export const VALUE_CHECK_MODES = ["off", "bw", "silhouette"] as const;
export type ValueCheckMode = (typeof VALUE_CHECK_MODES)[number];

export const GUIDE_MODES = ["thirds", "phi", "diagonals", "all"] as const;
export type GuideMode = (typeof GUIDE_MODES)[number];

export const GHOST_OPACITY = { min: 0.1, max: 0.8, default: 0.35, step: 0.05 } as const;

export const DIRECTOR_EYE_HOTKEYS = {
  valueCheck: "Shift+V",
  ghost: "Shift+O",
  guideMode: "Alt+;",
  mute: "Alt+M",
  blindAudio: "Shift+H",
  colorScript: "Shift+C",
} as const;

export function nextValueCheckMode(current: ValueCheckMode): ValueCheckMode {
  const i = VALUE_CHECK_MODES.indexOf(current);
  return VALUE_CHECK_MODES[(i + 1) % VALUE_CHECK_MODES.length]!;
}

export function valueCheckLabel(mode: ValueCheckMode): string {
  if (mode === "bw") return "VALUE CHECK · B&W (Rec.709)";
  if (mode === "silhouette") return "VALUE CHECK · SILHOUETTE";
  return "";
}

export function nextGuideMode(current: GuideMode): GuideMode {
  const i = GUIDE_MODES.indexOf(current);
  return GUIDE_MODES[(i + 1) % GUIDE_MODES.length]!;
}

export function guideModeLabel(mode: GuideMode): string {
  switch (mode) {
    case "thirds":
      return "Rule of Thirds";
    case "phi":
      return "Golden Ratio (38.2%)";
    case "diagonals":
      return "Baroque / Sinister Diagonals";
    case "all":
      return "All Composition Guides";
  }
}

export function clampGhostOpacity(value: number): number {
  if (!Number.isFinite(value)) return GHOST_OPACITY.default;
  const clamped = Math.max(GHOST_OPACITY.min, Math.min(GHOST_OPACITY.max, value));
  return Math.round(clamped * 20) / 20;
}

export interface ShotBoundaryLike {
  t: number;
  name?: string;
}

export interface TimingSegmentLike {
  kind: string;
  from: number;
  to: number;
  blank?: boolean;
}

export interface TimingClockLike {
  segments: readonly TimingSegmentLike[];
}

export type GhostTarget =
  | {
      available: false;
      reason: "no-cuts" | "shot-0" | "blank-prev-shot";
      currentShot: number;
      currentShotName?: string;
      prevShot?: number;
    }
  | {
      available: true;
      currentShot: number;
      prevShot: number;
      cutAt: number;
      captureAt: number;
      currentShotName?: string;
      prevShotName?: string;
    };

function shotAtTime(shots: readonly ShotBoundaryLike[], t: number): number {
  if (!shots.length || t < shots[0]!.t) return 0;
  let lo = 0;
  let hi = shots.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t >= shots[mid]!.t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Computes the outgoing frame timestamp of the shot immediately preceding the current shot,
 * respecting timing clocks (gaps/freezes) and handling Shot 0 / single-shot / removed-shot cases.
 */
export function cutBoundaryGhostTime({
  shots,
  t,
  fps = 30,
  timingClock,
}: {
  shots: readonly ShotBoundaryLike[];
  t: number;
  fps?: number;
  timingClock?: TimingClockLike | null;
}): GhostTarget {
  if (!shots.length) {
    return { available: false, reason: "no-cuts", currentShot: 0 };
  }
  const currentShot = shotAtTime(shots, t);
  const currentShotName = shots[currentShot]?.name;
  if (shots.length <= 1) {
    return {
      available: false,
      reason: "no-cuts",
      currentShot,
      ...(currentShotName ? { currentShotName } : {}),
    };
  }
  if (currentShot <= 0) {
    return {
      available: false,
      reason: "shot-0",
      currentShot: 0,
      ...(currentShotName ? { currentShotName } : {}),
    };
  }

  const cutAt = shots[currentShot]!.t;
  let prevShot = currentShot - 1;
  while (prevShot >= 0 && shots[prevShot]!.t >= cutAt - 1e-6) {
    prevShot--;
  }
  if (prevShot < 0) {
    return {
      available: false,
      reason: "shot-0",
      currentShot,
      ...(currentShotName ? { currentShotName } : {}),
    };
  }

  const prevStart = shots[prevShot]!.t;
  const prevShotName = shots[prevShot]!.name;
  const frameStep = 1 / Math.max(1, fps);
  const rawCandidate = Math.min(cutAt - 1e-6, Math.max(prevStart, cutAt - frameStep));

  let captureAt = rawCandidate;
  if (timingClock?.segments.length) {
    const segs = timingClock.segments;
    const hit = segs.find((s) => s.from <= rawCandidate && rawCandidate < s.to);
    if (hit && !hit.blank && hit.to > prevStart) {
      const segEnd = Math.min(hit.to, cutAt);
      captureAt = Math.min(segEnd - 1e-6, Math.max(prevStart, hit.from, segEnd - frameStep));
    } else {
      let fallback: TimingSegmentLike | null = null;
      for (let i = segs.length - 1; i >= 0; i--) {
        const s = segs[i]!;
        if (!s.blank && s.from < cutAt && s.to > prevStart) {
          fallback = s;
          break;
        }
      }
      if (!fallback) {
        return {
          available: false,
          reason: "blank-prev-shot",
          currentShot,
          prevShot,
          ...(currentShotName ? { currentShotName } : {}),
        };
      }
      const segEnd = Math.min(fallback.to, cutAt);
      captureAt = Math.min(segEnd - 1e-6, Math.max(prevStart, fallback.from, segEnd - frameStep));
    }
  }

  return {
    available: true,
    currentShot,
    prevShot,
    cutAt: r3(cutAt),
    captureAt,
    ...(currentShotName ? { currentShotName } : {}),
    ...(prevShotName ? { prevShotName } : {}),
  };
}
