import type { Ratio } from "../../src/frame.ts";
import type { GuideMode } from "./director-eye";

export const PHI_MINOR = (3 - Math.sqrt(5)) / 2; // 38.1966...%
export const PHI_MAJOR = (Math.sqrt(5) - 1) / 2; // 61.8034...%

// Clear zone of a 1080x1920 frame across YouTube Shorts and TikTok In-Feed templates
export const PHONE_SAFE_POLYGON: readonly [number, number][] = [
  [120, 288],
  [888, 288],
  [888, 840],
  [780, 840],
  [780, 1248],
  [120, 1248],
];

export interface GuideLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface GuideRect {
  x: number;
  y: number;
  width: number;
  height: number;
  dashed?: boolean;
}

export interface GuideGeometry {
  thirds: GuideLine[];
  phi: GuideLine[];
  diagonalsMain: GuideLine[];
  diagonalsReciprocal: GuideLine[];
  centerCross: GuideLine[];
  safeBoxes: GuideRect[];
  phoneClear: string | null;
}

function gridLines(w: number, h: number, a: number, b: number): GuideLine[] {
  return [
    { x1: w * a, y1: 0, x2: w * a, y2: h },
    { x1: w * b, y1: 0, x2: w * b, y2: h },
    { x1: 0, y1: h * a, x2: w, y2: h * a },
    { x1: 0, y1: h * b, x2: w, y2: h * b },
  ];
}

export function linesToPath(lines: readonly GuideLine[]): string {
  return lines.map((l) => `M${l.x1} ${l.y1}L${l.x2} ${l.y2}`).join("");
}

/**
 * Pure geometry builder for composition guides in frame-space [W, H] matching CSS aspect/letterbox framing.
 */
export function computeGuideGeometry(
  w: number,
  h: number,
  ratio: Ratio,
  mode: GuideMode,
  showSafe: boolean,
): GuideGeometry {
  const thirds = mode === "thirds" || mode === "all" ? gridLines(w, h, 1 / 3, 2 / 3) : [];
  const phi = mode === "phi" || mode === "all" ? gridLines(w, h, PHI_MINOR, PHI_MAJOR) : [];

  let diagonalsMain: GuideLine[] = [];
  let diagonalsReciprocal: GuideLine[] = [];
  if (mode === "diagonals" || mode === "all") {
    // Baroque (ascending left-to-right) and Sinister (descending left-to-right) corner axes
    diagonalsMain = [
      { x1: 0, y1: h, x2: w, y2: 0 },
      { x1: 0, y1: 0, x2: w, y2: h },
    ];
    // Dynamic Symmetry reciprocals: perpendicular to main diagonals from each corner
    const rx = w >= h ? (h * h) / w : w;
    const ry = w >= h ? h : (w * w) / h;
    diagonalsReciprocal = [
      { x1: 0, y1: 0, x2: rx, y2: ry },
      { x1: w, y1: h, x2: w - rx, y2: h - ry },
      { x1: 0, y1: h, x2: rx, y2: h - ry },
      { x1: w, y1: 0, x2: w - rx, y2: ry },
    ];
  }

  const centerCross: GuideLine[] = [
    { x1: w / 2 - 18, y1: h / 2, x2: w / 2 + 18, y2: h / 2 },
    { x1: w / 2, y1: h / 2 - 18, x2: w / 2, y2: h / 2 + 18 },
  ];

  const box = (k: number, dashed = false): GuideRect => ({
    x: (w * (1 - k)) / 2,
    y: (h * (1 - k)) / 2,
    width: w * k,
    height: h * k,
    dashed,
  });

  const safeBoxes = showSafe && ratio !== "9:16" ? [box(0.93, false), box(0.9, true)] : [];
  const phoneClear =
    showSafe && ratio === "9:16"
      ? `M${PHONE_SAFE_POLYGON.map(([x, y]) => `${(x * w) / 1080} ${(y * h) / 1920}`).join("L")}Z`
      : null;

  return {
    thirds,
    phi,
    diagonalsMain,
    diagonalsReciprocal,
    centerCross,
    safeBoxes,
    phoneClear,
  };
}
