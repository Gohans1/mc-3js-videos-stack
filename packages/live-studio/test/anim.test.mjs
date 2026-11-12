import assert from "node:assert/strict";
import { test } from "node:test";

import { ANIMS } from "film-stage/animate";

import {
  animBandOnSegment,
  animSlotMetrics,
  applyAnimDuration,
  canLinkSeamPair,
  clampHandleX,
  disambiguateSeamSlot,
  freshAnimSet,
  fxSupportsCurve,
  orderedAnimCategories,
  pickAnimEdge,
  shouldSyncPair,
  syncPairedOption,
  tidyAnimSet,
} from "../app/camera/anim-math.ts";
import { compileTiming, playRanges } from "../src/timing.mjs";

const fxOf = (slot, id) => ANIMS[slot].find((x) => x.id === id);

test("fxSupportsCurve allows 3D moves with black veils (occluderDive, blackDip) while excluding pure fade and loops", () => {
  assert.equal(fxSupportsCurve(fxOf("in", "fade")), false);
  assert.equal(fxSupportsCurve(fxOf("combo", "handheld")), false);
  assert.equal(fxSupportsCurve(fxOf("in", "occluderDive")), true);
  assert.equal(fxSupportsCurve(fxOf("in", "blackDip")), true);
  assert.equal(fxSupportsCurve(fxOf("in", "rush")), true);
});

test("tidyAnimSet strips default values, clamps negative optics, and drops unsupported capabilities", () => {
  assert.deepEqual(
    tidyAnimSet({ fx: "rush", len: 1, k: 1, curve: undefined, flip: false, optics: 1 }),
    { fx: "rush", len: 1 },
  );
  assert.deepEqual(tidyAnimSet({ fx: "rush", len: 1, optics: 0.996 }), { fx: "rush", len: 1 });
  assert.deepEqual(tidyAnimSet({ fx: "rush", len: 1, optics: -0.25 }, fxOf("in", "rush")), {
    fx: "rush",
    len: 1,
    optics: 0,
  });
  // Rush is purely axial (flip: undefined), so flip is stripped when tidied against its metadata
  assert.deepEqual(
    tidyAnimSet({ fx: "rush", len: 1, flip: true, curve: "snap", optics: 0.5 }, fxOf("in", "rush")),
    { fx: "rush", len: 1, curve: "snap", optics: 0.5 },
  );
  // Flash whip supports curve, flip, and optics
  assert.deepEqual(
    tidyAnimSet(
      { fx: "flashCut", len: 0.45, flip: true, curve: "snap", optics: 0.5 },
      fxOf("in", "flashCut"),
    ),
    { fx: "flashCut", len: 0.45, flip: true, curve: "snap", optics: 0.5 },
  );
  // Seam link defaults to true (omitted); seam: false is preserved only on paired presets so unlinking one side persists cleanly
  assert.deepEqual(tidyAnimSet({ fx: "flashCut", len: 0.45, seam: true }, fxOf("in", "flashCut")), {
    fx: "flashCut",
    len: 0.45,
  });
  assert.deepEqual(
    tidyAnimSet({ fx: "flashCut", len: 0.45, seam: false }, fxOf("in", "flashCut")),
    { fx: "flashCut", len: 0.45, seam: false },
  );
  assert.deepEqual(tidyAnimSet({ fx: "push", len: 1, seam: false }, fxOf("in", "push")), {
    fx: "push",
    len: 1,
  });
  assert.equal(shouldSyncPair({ fx: "flashCut", len: 0.45 }, fxOf("in", "flashCut")), true);
  assert.equal(
    shouldSyncPair({ fx: "flashCut", len: 0.45, seam: false }, fxOf("in", "flashCut")),
    false,
  );
  assert.equal(shouldSyncPair({ fx: "push", len: 1 }, fxOf("in", "push")), false);
  // Custom AI draw.anims entries without explicit flip/optics capability flags preserve AI-authored flip and optics
  const customFx = {
    id: "aiCustom",
    title: "AI Custom",
    cat: "Custom",
    tip: "Custom",
    apply: () => {},
  };
  assert.deepEqual(tidyAnimSet({ fx: "aiCustom", len: 0.7, flip: true, optics: 0.45 }, customFx), {
    fx: "aiCustom",
    len: 0.7,
    flip: true,
    optics: 0.45,
  });
  assert.deepEqual(
    tidyAnimSet(
      { fx: "aiCustom", len: 0.7, flip: true, optics: 0.45 },
      { ...customFx, flip: false, optics: false },
    ),
    { fx: "aiCustom", len: 0.7 },
  );
  assert.deepEqual(orderedAnimCategories(ANIMS.in), [
    "All",
    "Favorites",
    "Seam",
    "Move",
    "Zoom",
    "Turn",
    "Lens & Light",
    "Shake",
  ]);
  assert.deepEqual(orderedAnimCategories(ANIMS.combo), [
    "All",
    "Favorites",
    "Move",
    "Zoom",
    "Turn",
    "Lens & Light",
    "Shake",
  ]);
});

test("freshAnimSet carries options across preset switches only when the new preset supports them", () => {
  const fromFlash = { fx: "flashCut", len: 0.8, k: 1.5, curve: "snap", flip: true, optics: 0.4 };
  // Switching to Slide right keeps curve, flip, k, len, and drops optics
  assert.deepEqual(
    freshAnimSet({
      cur: fromFlash,
      from: fromFlash,
      slot: "in",
      id: "slideR",
      fx: fxOf("in", "slideR"),
      maxSourceLen: 3,
    }),
    { fx: "slideR", len: 0.8, k: 1.5, curve: "snap", flip: true },
  );
  // Switching to Zoom in drops flip and optics, keeps curve
  assert.deepEqual(
    freshAnimSet({
      cur: fromFlash,
      from: fromFlash,
      slot: "in",
      id: "zoomIn",
      fx: fxOf("in", "zoomIn"),
      maxSourceLen: 3,
    }),
    { fx: "zoomIn", len: 0.8, k: 1.5, curve: "snap" },
  );
  // Switching to Fade in drops curve, flip, and optics
  assert.deepEqual(
    freshAnimSet({
      cur: fromFlash,
      from: fromFlash,
      slot: "in",
      id: "fade",
      fx: fxOf("in", "fade"),
      maxSourceLen: 3,
    }),
    { fx: "fade", len: 0.8, k: 1.5 },
  );
  // Switching to Occluder dive (in) keeps curve and optics, drops flip (only out has yaw arc)
  assert.deepEqual(
    freshAnimSet({
      cur: fromFlash,
      from: fromFlash,
      slot: "in",
      id: "occluderDive",
      fx: fxOf("in", "occluderDive"),
      maxSourceLen: 3,
    }),
    { fx: "occluderDive", len: 0.8, k: 1.5, curve: "snap", optics: 0.4 },
  );
});

test("syncPairedOption propagates curve, flip and optics across paired cuts without writing unsupported fields", () => {
  // occluderDive Out supports flip, occluderDive In does not: syncing flip from Out leaves In without dead flip:true
  const partnerIn = { fx: "occluderDive", len: 0.65 };
  assert.deepEqual(
    syncPairedOption(
      partnerIn,
      { curve: "smooth", flip: true, optics: 0.6 },
      fxOf("in", "occluderDive"),
    ),
    { fx: "occluderDive", len: 0.65, curve: "smooth", optics: 0.6 },
  );
  // flashCut Out <-> In both support curve, flip, optics
  assert.deepEqual(
    syncPairedOption(
      { fx: "flashCut", len: 0.45 },
      { curve: "snap", flip: true, optics: 0.55 },
      fxOf("in", "flashCut"),
    ),
    { fx: "flashCut", len: 0.45, curve: "snap", flip: true, optics: 0.55 },
  );
  // canLinkSeamPair requires both sides to be on the paired preset AND neither side to have seam:false
  assert.equal(
    canLinkSeamPair({ fx: "flashCut" }, fxOf("out", "flashCut"), { fx: "flashCut" }, "flashCut"),
    true,
  );
  assert.equal(
    canLinkSeamPair(
      { fx: "flashCut", seam: false },
      fxOf("out", "flashCut"),
      { fx: "flashCut" },
      "flashCut",
    ),
    false,
  );
  assert.equal(
    canLinkSeamPair(
      { fx: "flashCut" },
      fxOf("out", "flashCut"),
      { fx: "flashCut", seam: false },
      "flashCut",
    ),
    false,
  );
  assert.equal(
    canLinkSeamPair({ fx: "flashCut" }, fxOf("out", "flashCut"), { fx: "push" }, "flashCut"),
    false,
  );
});

test("animSlotMetrics & applyAnimDuration fit overlapping In+Out proportionally and map 2x speed & freezes via timingClock", () => {
  // 1) Overlapping In (3s) + Out (3s) on a 4s untimed shot fit proportionally to 2s + 2s (no phantom gap, no 0.1s lock)
  const overlapAnim = { in: { fx: "push", len: 3 }, out: { fx: "push", len: 3 } };
  const mOverlap = animSlotMetrics([2, 6], null, overlapAnim, 1, 1);
  assert.equal(mOverlap.inLen, 2);
  assert.equal(mOverlap.outLen, 2);
  assert.equal(mOverlap.inRoom, 2);
  assert.equal(mOverlap.outRoom, 2);
  // Shrinking In to 1.2s keeps Out parked at its displayed 2.0s instead of letting Out spring out to 2.8s
  const shrunk = applyAnimDuration([2, 6], null, overlapAnim, "in", 1.2, 1, 1);
  assert.equal(shrunk.in.len, 1.2);
  assert.equal(shrunk.out.len, 2);

  // 2) 2x speed shot (source 0..4s -> output 0..2s): stored source len 1.0s displays as 0.5s on timeline, and dragging to 0.75s saves source len 1.5s
  const fastClock = compileTiming({ speeds: [{ from: 0, to: 4, rate: 2 }] }, 8);
  const fastAnim = { in: { fx: "push", len: 1 }, out: { fx: "push", len: 1 } };
  const mFast = animSlotMetrics([0, 4], fastClock, fastAnim, 1, 1);
  assert.equal(mFast.inLen, 0.5);
  assert.equal(mFast.outLen, 0.5);
  assert.equal(mFast.inRoom, 1.5);
  const savedFast = applyAnimDuration([0, 4], fastClock, fastAnim, "in", 0.75, 1, 1);
  assert.equal(savedFast.in.len, 1.5);

  // 3) Freeze inside an In animation (at 0.5s for 3s on a 5s shot, in.len = 1.5s source -> finishes on second play segment at output 4.5s)
  const freezeClock = compileTiming({ freezes: [{ at: 0.5, duration: 3 }] }, 5);
  const freezeAnim = { in: { fx: "push", len: 1.5 } };
  const mFreeze = animSlotMetrics([0, 5], freezeClock, freezeAnim, 1, 1);
  assert.equal(mFreeze.inLen, 4.5);
  const segs = playRanges(freezeClock, 0, 5);
  assert.equal(segs.length, 2);
  const seg0 = animBandOnSegment([0, 5], freezeClock, mFreeze, segs[0], "in");
  const seg1 = animBandOnSegment([0, 5], freezeClock, mFreeze, segs[1], "in");
  assert.deepEqual(seg0, { from: 0, to: 0.5, handleAt: null });
  assert.deepEqual(seg1, { from: 3.5, to: 4.5, handleAt: 4.5 });
});

test("pickAnimEdge ignores inactive shots, resolves meeting In/Out handles by side or drag direction, and clampHandleX stays inside clip", () => {
  const handles = [
    { i: 0, slot: "out", x: 100, anchor: 2 }, // unselected neighboring shot near cut
    { i: 1, slot: "in", x: 200, anchor: 2 },
    { i: 1, slot: "out", x: 200, anchor: 6 }, // In and Out meet at x = 200 on picked shot 1
  ];
  const active = new Set([1]);
  // Clicking near x = 101 does NOT grab shot 0's invisible handle because shot 0 is neither picked nor hovered
  assert.equal(pickAnimEdge(handles, 101, 6, active, 1, -1), null);
  // Approaching seam x = 200 from the left (198) grabs In; from the right (202) grabs Out
  assert.equal(pickAnimEdge(handles, 198, 6, active, 1, 1)?.slot, "in");
  assert.equal(pickAnimEdge(handles, 202, 6, active, 1, 1)?.slot, "out");
  // Clicking dead on seam x = 200 marks seam: true, and first drag motion disambiguates left -> in, right -> out
  const deadOn = pickAnimEdge(handles, 200, 6, active, 1, 1);
  assert.equal(deadOn?.seam, true);
  assert.equal(disambiguateSeamSlot(-3), "in");
  assert.equal(disambiguateSeamSlot(3), "out");

  // 3px handle stays completely inside [x0, x1] at 0% and 100% duration
  assert.equal(clampHandleX(10, 10, 90), 10);
  assert.equal(clampHandleX(90, 10, 90), 87);
  assert.equal(clampHandleX(50, 10, 90), 48.5);
});
