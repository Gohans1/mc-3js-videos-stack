import { describe, expect, test } from "bun:test";

import { activeStageNotes } from "../app/notes/pinfade";
import {
  compareItemLikelyHasAudio,
  compareLayoutBadge,
  compareReferenceItem,
  compareStageAspect,
  compareVideoUrl,
  composeMatchesStageSpace,
  filmToVideoTime,
  formatCompareAge,
  formatCompareBytes,
  noteCompareAspect,
  noteMatchesStageSpace,
  videoToFilmTime,
} from "../app/picture/compare-video-model";

describe("compare-video-model", () => {
  test("builds cache-busted streaming URL from item path, size, and mtimeMs", () => {
    expect(
      compareVideoUrl({
        path: "renders/reference/v3_sbs.mp4",
        size: 1024,
        mtimeMs: 1700000000000,
      }),
    ).toBe("/api/compare-videos/file?path=renders%2Freference%2Fv3_sbs.mp4&v=1024-1700000000000");
  });

  test("maps film time to video time cleanly for full and windowed clips", () => {
    expect(filmToVideoTime(5.2, 0, 30)).toEqual({ t: 5.2, outside: null });
    expect(filmToVideoTime(1.0, 2.2, 5.0)).toEqual({ t: 0, outside: "before" });
    expect(filmToVideoTime(4.0, 2.2, 5.0)).toEqual({ t: 1.8, outside: null });
    expect(filmToVideoTime(9.5, 2.2, 5.0)).toEqual({ t: 4.99, outside: "after" });
    expect(filmToVideoTime(2.2, 2.2, 0)).toEqual({ t: 0, outside: null });
  });

  test("maps video time back to film time clamped to film duration", () => {
    expect(videoToFilmTime(3.5, 0, 20)).toBe(3.5);
    expect(videoToFilmTime(1.8, 2.2, 20)).toBe(4);
    expect(videoToFilmTime(25, 0, 20)).toBe(19.99);
    expect(videoToFilmTime(-1, 0, 20)).toBe(0);
  });

  test("computes stage aspect from loaded video dimensions or estimated layout fallback", () => {
    const hstackItem = { category: "compare", layout: "hstack" };
    const vstackItem = { category: "compare", layout: "vstack" };
    const singleItem = { category: "render", layout: "single" };

    expect(compareStageAspect(hstackItem, 1444, 1414, "9:16")).toEqual([1444, 1414]);
    const estH = compareStageAspect(hstackItem, 0, 0, "9:16");
    expect(estH[0]).toBeGreaterThan(estH[1] * 0.9);
    const estV = compareStageAspect(vstackItem, 0, 0, "16:9");
    expect(estV[1]).toBeGreaterThan(estV[0]);
    expect(compareStageAspect(singleItem, 0, 0, "9:16")).toEqual([9, 16]);
  });

  test("separates spatial note overlays between Live 3D and Compare Video layouts", () => {
    const liveNote = {};
    const hstackNote = {
      compareVideo: {
        path: "renders/reference/v2_sbs.mp4",
        category: "compare",
        layout: "hstack",
      },
    };
    const vstackNote = {
      compareVideo: {
        path: "renders/reference/v2_sbs.mp4",
        category: "compare",
        layout: "vstack",
      },
    };

    expect(noteMatchesStageSpace(liveNote, false, null)).toBe(true);
    expect(noteMatchesStageSpace(hstackNote, false, null)).toBe(false);
    expect(noteMatchesStageSpace(liveNote, true, hstackNote.compareVideo)).toBe(false);
    expect(noteMatchesStageSpace(hstackNote, true, hstackNote.compareVideo)).toBe(true);
    expect(noteMatchesStageSpace(vstackNote, true, hstackNote.compareVideo)).toBe(false);
  });

  test("uses the export's recorded audio provenance before probing its media", () => {
    expect(
      compareItemLikelyHasAudio({ path: "renders/reference/sbs.mp4", embeddedAudio: "none" }),
    ).toBe(false);
    expect(
      compareItemLikelyHasAudio({ path: "renders/reference/sbs.mp4", embeddedAudio: "ours" }),
    ).toBe(true);
  });

  test("uses a comparison's recorded reference and falls back to the project reference for legacy clips", () => {
    const legacy = { path: "renders/reference/v1_sbs.mp4", category: "compare" };
    const preferred = { path: "references/ref.mp4", category: "reference" };
    const alternate = { path: "references/alternate.mp4", category: "reference" };
    const catalog = [legacy, preferred, alternate];

    expect(compareReferenceItem(legacy, catalog, preferred.path)).toBe(preferred);
    expect(compareReferenceItem(alternate, catalog, preferred.path)).toBe(alternate);
    expect(
      compareReferenceItem({ ...legacy, referencePath: alternate.path }, catalog, preferred.path),
    ).toBe(alternate);
    expect(
      compareReferenceItem(
        { ...legacy, referencePath: "references/missing.mp4" },
        catalog,
        preferred.path,
      ),
    ).toBeNull();
    expect(
      compareReferenceItem({ ...legacy, referencePath: null }, catalog, preferred.path),
    ).toBeNull();
  });

  test("formats layout badges and human-readable file sizes", () => {
    expect(compareLayoutBadge("compare", "hstack")).toBe("REF | OURS");
    expect(compareLayoutBadge("compare", "vstack")).toBe("REF / OURS");
    expect(compareLayoutBadge("render", "single")).toBe("Render");
    expect(compareLayoutBadge("reference", "single")).toBe("Reference");
    expect(formatCompareBytes(512)).toBe("512 B");
    expect(formatCompareBytes(1536 * 1024)).toBe("1.5 MB");
    const now = 1_700_000_000_000;
    expect(formatCompareAge(now - 5_000, now)).toBe("just now");
    expect(formatCompareAge(now - 180_000, now)).toBe("3m ago");
    expect(formatCompareAge(now - 7_200_000, now)).toBe("2h ago");
    expect(formatCompareAge(now - 3 * 86_400_000, now)).toBe("3d ago");
  });

  test("isolates stage pins by coordinate space and moves mismatched notes to frame stack", () => {
    const compareNote = {
      n: {
        id: "cmp1",
        text: "Right panel shadow too dark",
        pin: { x: 0.76, y: 0.42, what: "OURS · right" },
        compareVideo: {
          path: "renders/reference/v3_sbs.mp4",
          category: "compare",
          layout: "hstack",
        },
      },
      t: 5.0,
    };
    const liveNote = {
      n: {
        id: "live1",
        text: "Camera too close",
        pin: { x: 0.5, y: 0.5, what: "Steve.head" },
      },
      t: 5.0,
    };
    const drawnCompare = {
      n: {
        id: "cmp2",
        text: "Arrow across panels",
        marks: [
          {
            kind: "arrow",
            t: 5.0,
            pts: [
              [0.2, 0.5],
              [0.8, 0.5],
            ],
          },
        ],
        compareVideo: {
          path: "renders/reference/v3_sbs.mp4",
          category: "compare",
          layout: "hstack",
        },
      },
      t: 5.0,
    };

    const inCompareHstack = activeStageNotes([compareNote, liveNote, drawnCompare], 5.1, 1, (n) =>
      noteMatchesStageSpace(n, true, compareNote.n.compareVideo),
    );
    expect(inCompareHstack.pins.map((p) => p.id)).toEqual(["cmp1"]);
    expect(inCompareHstack.frame.map((f) => f.id)).toEqual(["live1"]);

    const inLive3d = activeStageNotes([compareNote, liveNote, drawnCompare], 5.1, 1, (n) =>
      noteMatchesStageSpace(n, false, null),
    );
    expect(inLive3d.pins.map((p) => p.id)).toEqual(["live1"]);
    expect(inLive3d.frame.map((f) => f.id)).toEqual(["cmp1", "cmp2"]);
  });

  test("scopes active drafts strictly by video path even when layouts match", () => {
    const v1Draft = {
      compareVideo: { path: "renders/reference/v1_sbs.mp4", category: "compare", layout: "hstack" },
    };
    const liveDraft = {};

    expect(composeMatchesStageSpace(v1Draft, true, "renders/reference/v1_sbs.mp4")).toBe(true);
    expect(composeMatchesStageSpace(v1Draft, true, "renders/reference/v2_sbs.mp4")).toBe(false);
    expect(composeMatchesStageSpace(v1Draft, true, null)).toBe(false);
    expect(composeMatchesStageSpace(v1Draft, false, null)).toBe(false);
    expect(composeMatchesStageSpace(liveDraft, false, null)).toBe(true);
    expect(composeMatchesStageSpace(liveDraft, true, "renders/reference/v1_sbs.mp4")).toBe(false);
  });

  test("resolves noteCompareAspect for hstack and vstack notes and predicts pre-probe silent videos", () => {
    expect(
      noteCompareAspect(
        {
          compareVideo: {
            path: "renders/reference/v1_sbs.mp4",
            category: "compare",
            layout: "vstack",
          },
          context: { view: { canvas: [1280, 1552] } },
        },
        "16:9",
      ),
    ).toEqual([1280, 1552]);

    const fallbackVstack = noteCompareAspect(
      {
        compareVideo: {
          path: "renders/reference/v1_sbs.mp4",
          category: "compare",
          layout: "vstack",
        },
      },
      "16:9",
    );
    expect(fallbackVstack).not.toBeNull();
    expect(fallbackVstack[1]).toBeGreaterThan(fallbackVstack[0]);

    const fallbackHstack = noteCompareAspect(
      {
        compareVideo: {
          path: "renders/reference/v1_sbs.mp4",
          category: "compare",
          layout: "hstack",
        },
      },
      "9:16",
    );
    expect(fallbackHstack).not.toBeNull();
    expect(fallbackHstack[0]).toBeGreaterThan(fallbackHstack[1]);

    expect(
      noteCompareAspect(
        { compareVideo: { path: "renders/draft.mp4", category: "render", layout: "single" } },
        "16:9",
      ),
    ).toBeNull();

    expect(compareItemLikelyHasAudio({ path: "renders/draft_video.mp4" })).toBe(false);
    expect(compareItemLikelyHasAudio({ path: "renders/final_video.mp4" })).toBe(false);
    expect(compareItemLikelyHasAudio({ path: "renders/reference/v1_sbs.mp4" })).toBe(true);
  });
});
