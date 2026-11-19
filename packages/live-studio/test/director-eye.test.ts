import { describe, test } from "bun:test";
import assert from "node:assert/strict";

import {
  analyzeShotPacing,
  buildColorScriptShots,
  extractColorScriptPalette,
  rec709Luma,
  rgbToHex,
} from "../app/picture/color-script.ts";
import {
  clampGhostOpacity,
  cutBoundaryGhostTime,
  DIRECTOR_EYE_HOTKEYS,
  nextGuideMode,
  nextValueCheckMode,
  valueCheckLabel,
} from "../app/picture/director-eye.ts";
import { computeGuideGeometry, PHI_MAJOR, PHI_MINOR } from "../app/picture/guides-math.ts";
import { compileTiming } from "../src/timing.mjs";

const makeSolidRgba = (w: number, h: number, r: number, g: number, b: number, a = 255) => {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = a;
  }
  return out;
};

const makeBlockRgba = (
  w: number,
  h: number,
  colorAt: (x: number, y: number) => [number, number, number, number?],
) => {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a = 255] = colorAt(x, y);
      const o = (y * w + x) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }
  return out;
};

describe("color-script quantization & luminance", () => {
  test("rec709Luma uses ITU-R BT.709 weights (green > red > blue)", () => {
    const lGreen = rec709Luma(0, 255, 0);
    const lRed = rec709Luma(255, 0, 0);
    const lBlue = rec709Luma(0, 0, 255);
    assert.ok(Math.abs(lGreen - 0.7152) < 1e-4);
    assert.ok(Math.abs(lRed - 0.2126) < 1e-4);
    assert.ok(Math.abs(lBlue - 0.0722) < 1e-4);
    assert.ok(lGreen > lRed && lRed > lBlue);
    assert.equal(rec709Luma(0, 0, 0), 0);
    assert.ok(Math.abs(rec709Luma(255, 255, 255) - 1) < 1e-4);
  });

  test("extractColorScriptPalette handles empty and solid images cleanly", () => {
    const empty = extractColorScriptPalette(new Uint8ClampedArray(0), 0, 0);
    assert.deepEqual(empty.swatches, []);
    assert.equal(empty.avgLuma, 0);

    const solid = extractColorScriptPalette(makeSolidRgba(16, 16, 200, 100, 50), 16, 16);
    assert.equal(solid.swatches.length, 1);
    assert.equal(solid.swatches[0].hex, rgbToHex(200, 100, 50));
    assert.ok(Math.abs(solid.swatches[0].weight - 1) < 1e-6);
    assert.ok(Math.abs(solid.avgLuma - rec709Luma(200, 100, 50)) < 1e-4);
    assert.equal(solid.contrast, 0);
  });

  test("extractColorScriptPalette recovers 4 distinct quadrants deterministically", () => {
    const rgba = makeBlockRgba(40, 40, (x, y) => {
      if (x < 20 && y < 20) return [220, 40, 40];
      if (x >= 20 && y < 20) return [40, 200, 60];
      if (x < 20 && y >= 20) return [40, 90, 220];
      return [240, 220, 60];
    });
    const first = extractColorScriptPalette(rgba, 40, 40, 4);
    const second = extractColorScriptPalette(rgba, 40, 40, 4);
    assert.deepEqual(first, second);
    assert.equal(first.swatches.length, 4);
    const hexes = new Set(first.swatches.map((s) => s.hex));
    assert.ok(hexes.has("#dc2828"));
    assert.ok(hexes.has("#28c83c"));
    assert.ok(hexes.has("#285adc"));
    assert.ok(hexes.has("#f0dc3c"));
    const totalWeight = first.swatches.reduce((sum, s) => sum + s.weight, 0);
    assert.ok(Math.abs(totalWeight - 1) < 1e-6);
  });

  test("extractColorScriptPalette preserves minority accent color alongside noisy dominant background", () => {
    // 85% slightly varied dark slate sky, 15% bright amber lantern
    const rgba = makeBlockRgba(40, 40, (x, y) => {
      const idx = y * 40 + x;
      if (idx >= 1360) return [245, 165, 25];
      const jitter = idx % 7;
      return [18 + jitter, 24 + jitter, 40 + jitter];
    });
    const result = extractColorScriptPalette(rgba, 40, 40, 4);
    const hasWarmAccent = result.swatches.some((s) => s.r > 200 && s.g > 130 && s.b < 60);
    assert.ok(
      hasWarmAccent,
      `Expected amber accent in swatches: ${JSON.stringify(result.swatches)}`,
    );
  });
});

describe("color-script shots & pacing analysis", () => {
  test("buildColorScriptShots computes durations, midpoint sample times, and proportional widths", () => {
    const shots = buildColorScriptShots(
      [{ t: 0 }, { t: 2 }, { t: 12 }],
      15,
      ["Open", "Establish", "Resolve"],
      30,
    );
    assert.equal(shots.length, 3);
    assert.deepEqual(
      shots.map((s) => [s.index, s.name, s.start, s.end, s.duration]),
      [
        [0, "Open", 0, 2, 2],
        [1, "Establish", 2, 12, 10],
        [2, "Resolve", 12, 15, 3],
      ],
    );
    assert.equal(shots[0].sampleAt, 1);
    assert.equal(shots[1].sampleAt, 7);
    assert.equal(shots[2].sampleAt, 13.5);
    assert.ok(Math.abs(shots[1].widthPct - (10 / 15) * 100) < 1e-4);
  });

  test("analyzeShotPacing flags extra-long holds, flash cuts, and overly uniform runs", () => {
    const shotsWithLongAndFlash = buildColorScriptShots(
      [{ t: 0 }, { t: 2 }, { t: 2.3 }, { t: 4.3 }, { t: 16.3 }],
      18.3,
      [],
      30,
    );
    const summaryA = analyzeShotPacing(shotsWithLongAndFlash);
    assert.ok(summaryA.byShot[1].includes("flash-cut"));
    assert.ok(summaryA.byShot[3].includes("long-hold"));
    assert.equal(summaryA.isSequenceUniform, false);

    const uniformShots = buildColorScriptShots(
      [{ t: 0 }, { t: 2 }, { t: 4 }, { t: 6 }, { t: 8 }],
      10,
      [],
      30,
    );
    const summaryB = analyzeShotPacing(uniformShots);
    assert.equal(summaryB.isSequenceUniform, true);
    assert.ok(summaryB.byShot.every((flags) => flags.includes("uniform")));
  });
});

describe("cut-boundary ghost time math", () => {
  test("handles empty shots, single shot, and Shot 0 gracefully", () => {
    assert.deepEqual(cutBoundaryGhostTime({ shots: [], t: 0, fps: 30 }), {
      available: false,
      reason: "no-cuts",
      currentShot: 0,
    });
    assert.deepEqual(cutBoundaryGhostTime({ shots: [{ t: 0, name: "Only" }], t: 1.5, fps: 30 }), {
      available: false,
      reason: "no-cuts",
      currentShot: 0,
      currentShotName: "Only",
    });
    const onShotZero = cutBoundaryGhostTime({
      shots: [
        { t: 0, name: "Intro" },
        { t: 3, name: "Close" },
      ],
      t: 1.2,
      fps: 30,
    });
    assert.equal(onShotZero.available, false);
    assert.equal(onShotZero.reason, "shot-0");
    assert.equal(onShotZero.currentShot, 0);
  });

  test("computes prevShotEnd = currentShot.start - 1/fps on standard cuts", () => {
    const shots = [
      { t: 0, name: "Wide" },
      { t: 3, name: "Mid" },
      { t: 7.5, name: "CU" },
    ];
    const atShot1 = cutBoundaryGhostTime({ shots, t: 3, fps: 30 });
    assert.equal(atShot1.available, true);
    if (atShot1.available) {
      assert.equal(atShot1.currentShot, 1);
      assert.equal(atShot1.prevShot, 0);
      assert.equal(atShot1.cutAt, 3);
      assert.ok(Math.abs(atShot1.captureAt - (3 - 1 / 30)) < 1e-6);
      assert.equal(atShot1.prevShotName, "Wide");
    }

    const atShot2 = cutBoundaryGhostTime({ shots, t: 8.2, fps: 30 });
    assert.equal(atShot2.available, true);
    if (atShot2.available) {
      assert.equal(atShot2.currentShot, 2);
      assert.equal(atShot2.prevShot, 1);
      assert.ok(Math.abs(atShot2.captureAt - (7.5 - 1 / 30)) < 1e-6);
    }
  });

  test("respects timing clocks with gaps and freezes before a cut", () => {
    // Source 10s; gap at [2.5..3] before cut at output time; freeze at source 5 for 1s
    const clock = compileTiming(
      {
        gaps: [{ from: 2.5, to: 3 }],
        freezes: [{ at: 5, duration: 1 }],
      },
      10,
    );
    const cut1 = clock.outputAt(3, "before"); // 3.0 (where [2.5, 3) is blank)
    const cut2 = clock.outputAt(6, "before"); // includes 1s freeze at 5
    const shots = [
      { t: 0, name: "A" },
      { t: cut1, name: "B" },
      { t: cut2, name: "C" },
    ];

    // Cut 1: [2.5, 3) is a blank gap, so ghost must sample last non-blank frame <= 2.5
    const g1 = cutBoundaryGhostTime({ shots, t: cut1 + 0.1, fps: 30, timingClock: clock });
    assert.equal(g1.available, true);
    if (g1.available) {
      assert.ok(
        g1.captureAt < 2.5,
        `Expected captureAt < 2.5 before blank gap, got ${g1.captureAt}`,
      );
      assert.ok(g1.captureAt >= 2.5 - 1 / 30 - 1e-6);
    }

    // Cut 2: visible before cut2, captures outgoing frame in Shot B
    const g2 = cutBoundaryGhostTime({ shots, t: cut2 + 0.2, fps: 30, timingClock: clock });
    assert.equal(g2.available, true);
    if (g2.available) {
      assert.equal(g2.prevShot, 1);
      assert.ok(g2.captureAt < cut2 && g2.captureAt >= cut1);
    }
  });

  test("skips zero-length removed shot to find nearest preceding visible shot", () => {
    const shots = [
      { t: 0, name: "First" },
      { t: 4, name: "Removed" },
      { t: 4, name: "Next" },
    ];
    const g = cutBoundaryGhostTime({ shots, t: 4.5, fps: 30 });
    assert.equal(g.available, true);
    if (g.available) {
      assert.equal(g.currentShot, 2);
      assert.equal(g.prevShot, 0);
      assert.ok(Math.abs(g.captureAt - (4 - 1 / 30)) < 1e-6);
    }
  });
});

describe("composition guides geometry", () => {
  test("Golden Ratio Phi Grid uses exact 38.2% / 61.8% proportions", () => {
    assert.ok(Math.abs(PHI_MINOR - 0.381966) < 1e-5);
    assert.ok(Math.abs(PHI_MAJOR - 0.618034) < 1e-5);
    const geom = computeGuideGeometry(1600, 900, "16:9", "phi", true);
    assert.equal(geom.thirds.length, 0);
    assert.equal(geom.phi.length, 4);
    assert.ok(Math.abs(geom.phi[0].x1 - 1600 * PHI_MINOR) < 1e-6);
    assert.ok(Math.abs(geom.phi[1].x1 - 1600 * PHI_MAJOR) < 1e-6);
    assert.ok(Math.abs(geom.phi[2].y1 - 900 * PHI_MINOR) < 1e-6);
    assert.ok(Math.abs(geom.phi[3].y1 - 900 * PHI_MAJOR) < 1e-6);
    assert.equal(geom.safeBoxes.length, 2);
  });

  test("Diagonals produce Baroque, Sinister, and orthogonal reciprocal diagonals for 16:9 and 9:16", () => {
    for (const [w, h, ratio] of [
      [1600, 900, "16:9"],
      [900, 1600, "9:16"],
    ] as const) {
      const geom = computeGuideGeometry(w, h, ratio, "diagonals", false);
      assert.equal(geom.safeBoxes.length, 0);
      assert.equal(geom.phoneClear, null);
      assert.equal(geom.diagonalsMain.length, 2);
      assert.equal(geom.diagonalsReciprocal.length, 4);

      const [baroque, sinister] = geom.diagonalsMain;
      // Baroque: bottom-left (0, H) -> top-right (W, 0)
      assert.deepEqual(baroque, { x1: 0, y1: h, x2: w, y2: 0 });
      // Sinister: top-left (0, 0) -> bottom-right (W, H)
      assert.deepEqual(sinister, { x1: 0, y1: 0, x2: w, y2: h });

      // Every reciprocal must be strictly inside [0..W, 0..H] and perpendicular (dot = 0) to one main diagonal
      const bVec = [baroque.x2 - baroque.x1, baroque.y2 - baroque.y1];
      const sVec = [sinister.x2 - sinister.x1, sinister.y2 - sinister.y1];
      for (const r of geom.diagonalsReciprocal) {
        assert.ok(r.x1 >= 0 && r.x1 <= w && r.x2 >= 0 && r.x2 <= w);
        assert.ok(r.y1 >= 0 && r.y1 <= h && r.y2 >= 0 && r.y2 <= h);
        const rVec = [r.x2 - r.x1, r.y2 - r.y1];
        const dotB = Math.abs(rVec[0] * bVec[0] + rVec[1] * bVec[1]);
        const dotS = Math.abs(rVec[0] * sVec[0] + rVec[1] * sVec[1]);
        assert.ok(
          Math.min(dotB, dotS) < 1e-6,
          `Reciprocal not perpendicular: ${JSON.stringify(r)}`,
        );
      }
    }
  });

  test("9:16 portrait mode builds phone safe clear polygon when safe zones enabled", () => {
    const geom = computeGuideGeometry(900, 1600, "9:16", "all", true);
    assert.equal(geom.thirds.length, 4);
    assert.equal(geom.phi.length, 4);
    assert.equal(geom.diagonalsMain.length, 2);
    assert.ok(geom.phoneClear !== null && geom.phoneClear.startsWith("M"));
    assert.equal(geom.safeBoxes.length, 0);
  });
});

describe("director-eye state helpers & hotkey conflict safety", () => {
  test("cycles value check and guide modes cleanly", () => {
    assert.equal(nextValueCheckMode("off"), "bw");
    assert.equal(nextValueCheckMode("bw"), "silhouette");
    assert.equal(nextValueCheckMode("silhouette"), "off");
    assert.equal(valueCheckLabel("bw"), "VALUE CHECK · B&W (Rec.709)");
    assert.equal(valueCheckLabel("silhouette"), "VALUE CHECK · SILHOUETTE");

    assert.equal(nextGuideMode("thirds"), "phi");
    assert.equal(nextGuideMode("phi"), "diagonals");
    assert.equal(nextGuideMode("diagonals"), "all");
    assert.equal(nextGuideMode("all"), "thirds");
  });

  test("clamps ghost opacity between 10% and 80%", () => {
    assert.equal(clampGhostOpacity(0), 0.1);
    assert.equal(clampGhostOpacity(0.35), 0.35);
    assert.equal(clampGhostOpacity(1.2), 0.8);
    assert.equal(clampGhostOpacity(Number.NaN), 0.35);
  });

  test("director-eye hotkeys are unique, wired into normal and review modes, and do not conflict with flight or existing studio keys", async () => {
    const src = await Bun.file(new URL("../app/shell/useStudioHotkeys.ts", import.meta.url)).text();
    const literalKeys = [...src.matchAll(/hotkey:\s*"([^"]+)"/g)].map((m) => m[1]);
    const eyeEntries = Object.entries(DIRECTOR_EYE_HOTKEYS);
    const eyeHotkeys = eyeEntries.map(([, v]) => v);
    const flightKeys = new Set(["W", "A", "S", "D", "Shift+W", "Shift+A", "Shift+S", "Shift+D"]);

    // All declared Director's Eye hotkeys are distinct
    assert.equal(new Set(eyeHotkeys).size, eyeHotkeys.length);
    // None use flight WASD movement keys or collide with literal hotkeys in useStudioHotkeys.ts
    for (const [name, key] of eyeEntries) {
      assert.equal(flightKeys.has(key), false, `Hotkey ${key} collides with free-cam flight`);
      assert.equal(
        literalKeys.includes(key),
        false,
        `Hotkey ${key} duplicates a literal hotkey in useStudioHotkeys.ts`,
      );
      assert.ok(
        src.includes(`DIRECTOR_EYE_HOTKEYS.${name}`),
        `useStudioHotkeys.ts must register DIRECTOR_EYE_HOTKEYS.${name}`,
      );
    }
    assert.ok(
      src.includes("Object.values(DIRECTOR_EYE_HOTKEYS)"),
      "REVIEW_KEYS must include Director's Eye hotkeys",
    );
    // Blind Audio Escape handler sits before blade/hasPick/review exit
    const blindEscIdx = src.indexOf("set({ blindAudio: false })");
    const bladeEscIdx = src.indexOf("setBlade(false)");
    const reviewEscIdx = src.indexOf("setReview(false)");
    assert.ok(blindEscIdx > 0 && bladeEscIdx > blindEscIdx && reviewEscIdx > blindEscIdx);
  });
});
