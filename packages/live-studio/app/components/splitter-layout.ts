export const STAGE_MIN_W = 360;
export const LIB_MIN = 260;
export const SIDE_MIN = 260;
export const REVIEW_MIN = 280;
export const EDIT_MIN = 144;
const SIDE_ABS_MAX = 900;

export const isDesktopViewport = (vw: number, vh: number) =>
  !(vh <= 520 || vw <= 559 || (vw <= 820 && vh >= 521));

export interface WideLayout {
  showLibrary: boolean;
  showDetails: boolean;
  showSideOnRight: boolean;
  wideAttr: "2" | "3" | undefined;
}

export function wideLayout({
  wideScreen,
  editable,
}: {
  wideScreen: boolean;
  editable: boolean;
}): WideLayout {
  if (!wideScreen) {
    return {
      showLibrary: false,
      showDetails: false,
      showSideOnRight: true,
      wideAttr: undefined,
    };
  }
  return {
    showLibrary: true,
    showDetails: editable,
    showSideOnRight: false,
    wideAttr: editable ? "3" : "2",
  };
}

export function fitSplitterValue({
  target,
  current,
  min,
  max,
  fold,
}: {
  target: number;
  current: number;
  min: number;
  max: number;
  fold: boolean;
}): number {
  const lo = Math.round(min);
  const hi = Math.max(lo, Math.round(max));
  if (fold && target < lo / 2) {
    return target > current ? lo : 0;
  }
  return Math.round(Math.min(hi, Math.max(lo, target)));
}

export function stepSplitterArrow({
  current,
  delta,
  min,
  max,
  fold,
}: {
  current: number;
  delta: number;
  min: number;
  max: number;
  fold: boolean;
}): number {
  const lo = Math.round(min);
  const hi = Math.max(lo, Math.round(max));
  if (fold && current === 0) {
    return delta > 0 ? lo : 0;
  }
  return fitSplitterValue({ target: current + delta, current, min: lo, max: hi, fold: false });
}

export function nextEnterToggle({
  cur,
  last,
  min,
  max,
}: {
  cur: number;
  last: number;
  min: number;
  max?: number;
}) {
  const lo = Math.round(min);
  if (cur > 0) {
    return { next: 0, last: cur >= lo ? Math.round(cur) : 0 };
  }
  if (last < lo) return { next: null, last };
  const hi = max !== undefined ? Math.max(lo, Math.round(max)) : last;
  return { next: Math.min(hi, last), last };
}

export function parseStoredSize(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  const r = Math.round(n);
  return r === 0 ? 0 : r;
}

export function measureTimelineMin({
  timelineTop,
  timelineHeight,
  tracksTop,
  rowHeight = 64,
  paddingBottom = 12,
  fallback = EDIT_MIN,
}: {
  timelineTop: number;
  timelineHeight: number;
  tracksTop: number;
  rowHeight?: number;
  paddingBottom?: number;
  fallback?: number;
}): number {
  if (timelineHeight <= 0) return fallback;
  return tracksTop - timelineTop + rowHeight + paddingBottom;
}

export function sanitizeStoredSize(value: number | null, min: number, fold = true): number | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  const lo = Math.round(min);
  if (value === 0) return fold ? 0 : lo;
  return value < lo ? lo : Math.round(value);
}

const clampStored = (raw: number | null, min: number, max: number) =>
  raw === null || raw === 0 ? raw : Math.max(min, Math.min(max, Math.round(raw)));

export function clampSplitterLayout({
  vw,
  vh,
  wideAttr,
  rawLibW,
  rawSideW,
  rawEditH,
  rawReviewW,
  editMin,
}: {
  vw: number;
  vh: number;
  wideAttr: "2" | "3" | undefined;
  rawLibW: number | null;
  rawSideW: number | null;
  rawEditH: number | null;
  rawReviewW: number | null;
  editMin: number;
}) {
  const sideMinReserve = wideAttr === "3" && rawSideW !== 0 ? SIDE_MIN : 0;
  const libFirstMax =
    wideAttr === "3"
      ? Math.max(LIB_MIN, Math.round(vw - 24 - STAGE_MIN_W - sideMinReserve))
      : Math.max(LIB_MIN, Math.round(vw - 18 - STAGE_MIN_W));
  const effLibW = rawLibW === 0 ? 0 : Math.max(LIB_MIN, Math.min(rawLibW ?? 400, libFirstMax));

  const sideCapByWidth =
    wideAttr === "3"
      ? Math.max(SIDE_MIN, Math.round(vw - 24 - STAGE_MIN_W - effLibW))
      : Math.max(SIDE_MIN, Math.round(vw - 18 - STAGE_MIN_W));
  const sideMax = Math.min(SIDE_ABS_MAX, Math.round(vw * 0.6), sideCapByWidth);
  const effSideW =
    wideAttr !== "3"
      ? 0
      : rawSideW === 0
        ? 0
        : Math.max(SIDE_MIN, Math.min(rawSideW ?? 340, sideMax));

  const libMax =
    wideAttr === "3"
      ? Math.max(LIB_MIN, Math.round(vw - 24 - STAGE_MIN_W - effSideW))
      : libFirstMax;
  const reviewMax = Math.max(REVIEW_MIN, Math.round(vw - 18 - STAGE_MIN_W));
  const loEdit = Math.round(editMin);
  const editMax = Math.max(loEdit, Math.round(vh - 220));

  return {
    libMax,
    sideMax,
    reviewMax,
    editMax,
    libW: clampStored(rawLibW, LIB_MIN, libMax),
    sideW: clampStored(rawSideW, SIDE_MIN, sideMax),
    reviewW:
      rawReviewW === null
        ? null
        : Math.max(REVIEW_MIN, Math.min(reviewMax, Math.round(rawReviewW))),
    editH: clampStored(rawEditH, loEdit, editMax),
  };
}
