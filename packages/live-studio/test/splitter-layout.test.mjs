import { describe, expect, test } from "bun:test";

import {
  clampSplitterLayout,
  fitSplitterValue,
  measureTimelineMin,
  nextEnterToggle,
  parseStoredSize,
  sanitizeStoredSize,
  STAGE_MIN_W,
  stepSplitterArrow,
  wideLayout,
} from "../app/components/splitter-layout";

describe("splitter-layout", () => {
  test("wideLayout keeps left Library and right timeline on wide screens even when not editable", () => {
    expect(wideLayout({ wideScreen: true, editable: false })).toEqual({
      showLibrary: true,
      showDetails: false,
      showSideOnRight: false,
      wideAttr: "2",
    });
    expect(wideLayout({ wideScreen: true, editable: true })).toEqual({
      showLibrary: true,
      showDetails: true,
      showSideOnRight: false,
      wideAttr: "3",
    });
  });

  test("wideLayout falls back to right-column Side on narrow screens even when editable", () => {
    expect(wideLayout({ wideScreen: false, editable: false })).toEqual({
      showLibrary: false,
      showDetails: false,
      showSideOnRight: true,
      wideAttr: undefined,
    });
    expect(wideLayout({ wideScreen: false, editable: true })).toEqual({
      showLibrary: false,
      showDetails: false,
      showSideOnRight: true,
      wideAttr: undefined,
    });
  });

  test("fitSplitterValue opens squeezed pane to min when dragging open", () => {
    expect(fitSplitterValue({ target: 55, current: 45, min: 260, max: 800, fold: true })).toBe(260);
  });

  test("fitSplitterValue folds open pane to 0 below half-min", () => {
    expect(fitSplitterValue({ target: 110, current: 320, min: 260, max: 800, fold: true })).toBe(0);
  });

  test("fitSplitterValue never outputs sub-min positive widths when max < min", () => {
    expect(fitSplitterValue({ target: 200, current: 300, min: 260, max: 210, fold: true })).toBe(
      260,
    );
  });

  test("fitSplitterValue clamps to min when fold is false", () => {
    expect(fitSplitterValue({ target: 100, current: 300, min: 260, max: 500, fold: false })).toBe(
      260,
    );
  });

  test("stepSplitterArrow keeps a folded pane at 0 when pressing shrink arrow", () => {
    expect(stepSplitterArrow({ current: 0, delta: -16, min: 260, max: 800, fold: true })).toBe(0);
  });

  test("stepSplitterArrow opens a folded pane to min when pressing grow arrow", () => {
    expect(stepSplitterArrow({ current: 0, delta: 16, min: 260, max: 800, fold: true })).toBe(260);
  });

  test("stepSplitterArrow clamps open panes cleanly between min and max without folding", () => {
    expect(stepSplitterArrow({ current: 264, delta: -16, min: 260, max: 500, fold: true })).toBe(
      260,
    );
    expect(stepSplitterArrow({ current: 492, delta: 16, min: 260, max: 500, fold: true })).toBe(
      500,
    );
  });

  test("nextEnterToggle avoids caching sub-min visually squeezed widths", () => {
    const folded = nextEnterToggle({ cur: 45, last: 0, min: 260 });
    expect(folded).toEqual({ next: 0, last: 0 });
    expect(nextEnterToggle({ cur: 0, last: folded.last, min: 260 })).toEqual({
      next: null,
      last: 0,
    });
  });

  test("nextEnterToggle restores cached width and clamps when max shrunk below it", () => {
    const folded = nextEnterToggle({ cur: 680, last: 0, min: 142 });
    expect(folded).toEqual({ next: 0, last: 680 });
    expect(nextEnterToggle({ cur: 0, last: folded.last, min: 142, max: 405 })).toEqual({
      next: 405,
      last: 680,
    });
  });

  test("sanitizeStoredSize rejects NaN and clamps sub-min positive values to min", () => {
    expect(sanitizeStoredSize(null, 260)).toBeNull();
    expect(sanitizeStoredSize(0, 260)).toBe(0);
    expect(sanitizeStoredSize(45, 260)).toBe(260);
    expect(sanitizeStoredSize(Number.NaN, 260)).toBeNull();
    expect(sanitizeStoredSize(380, 260)).toBe(380);
  });

  test("sanitizeStoredSize clamps 0 to min when fold is false", () => {
    expect(sanitizeStoredSize(0, 280, false)).toBe(280);
  });

  test("clampSplitterLayout keeps wide=3 Library and Panel widths from crushing Stage", () => {
    const fit = clampSplitterLayout({
      vw: 1440,
      vh: 900,
      wideAttr: "3",
      rawLibW: 900,
      rawSideW: 600,
      rawEditH: null,
      rawReviewW: null,
      editMin: 142,
    });
    expect(fit.libMax).toBeLessThanOrEqual(1440 - 24 - STAGE_MIN_W - 260);
    expect(1440 - 24 - (fit.libW ?? 0) - (fit.sideW ?? 0)).toBeGreaterThanOrEqual(STAGE_MIN_W);
    expect(fit.libW).toBeLessThanOrEqual(fit.libMax);
    expect(fit.sideW).toBeLessThanOrEqual(fit.sideMax);
  });

  test("clampSplitterLayout caps Review width and Timeline height to resized viewport", () => {
    const fit = clampSplitterLayout({
      vw: 1264,
      vh: 625,
      wideAttr: undefined,
      rawLibW: null,
      rawSideW: null,
      rawEditH: 680,
      rawReviewW: 1200,
      editMin: 142,
    });
    expect(fit.editMax).toBe(405);
    expect(fit.editH).toBe(405);
    expect(fit.reviewMax).toBe(1264 - 18 - STAGE_MIN_W);
    expect(fit.reviewW).toBe(fit.reviewMax);
  });

  test("parseStoredSize rejects null and blank/whitespace strings so empty entries never fold panels", () => {
    expect(parseStoredSize(null)).toBeNull();
    expect(parseStoredSize("")).toBeNull();
    expect(parseStoredSize("   ")).toBeNull();
    expect(parseStoredSize("NaN")).toBeNull();
    expect(parseStoredSize("-50")).toBeNull();
    expect(parseStoredSize("0")).toBe(0);
    expect(parseStoredSize("340.6")).toBe(341);
  });

  test("measureTimelineMin falls back to 144 when the timeline element is hidden/folded", () => {
    expect(
      measureTimelineMin({ timelineTop: 0, timelineHeight: 0, tracksTop: 0, fallback: 144 }),
    ).toBe(144);
    expect(
      measureTimelineMin({ timelineTop: 500, timelineHeight: 378, tracksTop: 568, fallback: 144 }),
    ).toBe(144);
    expect(
      measureTimelineMin({ timelineTop: 480, timelineHeight: 378, tracksTop: 552, fallback: 144 }),
    ).toBe(148);
  });

  test("fitSplitterValue handles exact lo/2 boundary, stationary folded drag, and dragging shut", () => {
    expect(fitSplitterValue({ target: 130, current: 260, min: 260, max: 600, fold: true })).toBe(
      260,
    );
    expect(fitSplitterValue({ target: 0, current: 0, min: 260, max: 800, fold: true })).toBe(0);
    expect(fitSplitterValue({ target: 30, current: 45, min: 260, max: 600, fold: true })).toBe(0);
  });

  test("stepSplitterArrow clamps folded fold=false to min and caps nextEnterToggle below min", () => {
    expect(stepSplitterArrow({ current: 0, delta: -16, min: 260, max: 800, fold: false })).toBe(
      260,
    );
    expect(nextEnterToggle({ cur: 260, last: 0, min: 260 })).toEqual({ next: 0, last: 260 });
    expect(nextEnterToggle({ cur: 0, last: 260, min: 260, max: 400 })).toEqual({
      next: 260,
      last: 260,
    });
    expect(nextEnterToggle({ cur: 0, last: 500, min: 260, max: 200 })).toEqual({
      next: 260,
      last: 500,
    });
  });

  test("parseStoredSize and sanitizeStoredSize reject Infinity, negative numbers, and normalize -0", () => {
    expect(parseStoredSize("Infinity")).toBeNull();
    expect(Object.is(parseStoredSize("-0"), 0)).toBe(true);
    expect(sanitizeStoredSize(Number.POSITIVE_INFINITY, 260)).toBeNull();
    expect(sanitizeStoredSize(-10, 260)).toBeNull();
  });

  test("clampSplitterLayout computes 2-column libMax when wide=2", () => {
    const w2 = clampSplitterLayout({
      vw: 1200,
      vh: 900,
      wideAttr: "2",
      rawLibW: 900,
      rawSideW: null,
      rawEditH: null,
      rawReviewW: null,
      editMin: 144,
    });
    expect(w2.libMax).toBe(1200 - 18 - STAGE_MIN_W);
  });

  test("clampSplitterLayout frees full width when wide=3 Side panel is folded", () => {
    const w3FoldSide = clampSplitterLayout({
      vw: 1440,
      vh: 900,
      wideAttr: "3",
      rawLibW: 1100,
      rawSideW: 0,
      rawEditH: 0,
      rawReviewW: 0,
      editMin: 144,
    });
    expect(w3FoldSide.libMax).toBe(1440 - 24 - STAGE_MIN_W);
    expect(w3FoldSide.sideW).toBe(0);
    expect(w3FoldSide.editH).toBe(0);
    expect(w3FoldSide.reviewW).toBe(280);
  });

  test("clampSplitterLayout frees sideMax when wide=3 Library is folded", () => {
    const w3FoldLib = clampSplitterLayout({
      vw: 1440,
      vh: 900,
      wideAttr: "3",
      rawLibW: 0,
      rawSideW: 900,
      rawEditH: null,
      rawReviewW: null,
      editMin: 144,
    });
    expect(w3FoldLib.libW).toBe(0);
    expect(w3FoldLib.sideMax).toBe(Math.min(900, Math.round(1440 * 0.6), 1440 - 24 - STAGE_MIN_W));
  });

  test("clampSplitterLayout enforces min width on narrow desktop and sub-min wide=3 inputs", () => {
    const narrow = clampSplitterLayout({
      vw: 1000,
      vh: 900,
      wideAttr: undefined,
      rawLibW: null,
      rawSideW: 50,
      rawEditH: null,
      rawReviewW: null,
      editMin: 144,
    });
    expect(narrow.sideMax).toBe(Math.min(900, Math.round(1000 * 0.6), 1000 - 18 - STAGE_MIN_W));
    expect(narrow.sideW).toBe(260);

    const subMinWide3 = clampSplitterLayout({
      vw: 1280,
      vh: 900,
      wideAttr: "3",
      rawLibW: 800,
      rawSideW: 50,
      rawEditH: null,
      rawReviewW: null,
      editMin: 144,
    });
    expect(1280 - 24 - (subMinWide3.libW ?? 0) - (subMinWide3.sideW ?? 0)).toBeGreaterThanOrEqual(
      STAGE_MIN_W,
    );
    expect(subMinWide3.sideW).toBe(260);
  });
});
