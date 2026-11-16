// A note's pin and words on the picture (app/notes/pinfade.ts): shown from its frame, then fading over 3 s of watching, so a
// note passed while playing can be read and is not one frame long
import assert from "node:assert/strict";
import { test } from "node:test";

import { activeStageNotes, NOTE_FADE, pinFade, resolvePinLayout } from "../app/notes/pinfade.ts";

test("full on the note's frame, gone before it", () => {
  assert.equal(pinFade(10, 10), 1);
  assert.equal(pinFade(10, 9), 0);
});

test("fades out over 3 s after it", () => {
  assert.equal(NOTE_FADE, 3);
  assert.ok(Math.abs(pinFade(10, 11.5) - 0.5) < 1e-9);
  assert.equal(pinFade(10, 13.01), 0);
});

test("the fade is in the creator's seconds: at 2x it lasts 6 film seconds", () => {
  assert.ok(Math.abs(pinFade(10, 13, 2) - 0.5) < 1e-9);
  assert.equal(pinFade(10, 16.01, 2), 0);
});

test("activeStageNotes keeps both overlapping pinned notes and whole-frame notes at the same timestamp", () => {
  const open = [
    { n: { id: "d", pin: null, text: "Earlier overlapping note" }, t: 3.5 },
    { n: { id: "a", pin: { x: 0.5, y: 0.5, what: "Steve" }, text: "First note" }, t: 5 },
    { n: { id: "b", pin: { x: 0.5, y: 0.5, what: "Steve" }, text: "Second pinned" }, t: 5 },
    { n: { id: "c", pin: null, text: "Whole frame note" }, t: 5 },
    { n: { id: "e", pin: null, text: "   " }, t: 5 },
    { n: { id: "f", pin: { x: 0.2, y: 0.2, what: "Cam" }, freeCam: true, text: "Free cam" }, t: 5 },
  ];
  const res = activeStageNotes(open, 5, 1);
  assert.deepEqual(
    res.pins.map((x) => [x.id, x.fade]),
    [
      ["a", 1],
      ["b", 1],
    ],
  );
  assert.deepEqual(
    res.frame.map((x) => [x.id, x.fade]),
    [
      ["d", 0.5],
      ["c", 1],
    ],
  );
});

test("resolvePinLayout separates colliding pins and label boxes while staying inside frame bounds", () => {
  const layout = resolvePinLayout(
    [
      { x: 0.5, y: 0.5, labelWidth: 120, labelHeight: 22, dotRadius: 8 },
      { x: 0.5, y: 0.5, labelWidth: 120, labelHeight: 22, dotRadius: 8 },
      { x: 0.52, y: 0.51, labelWidth: 140, labelHeight: 22, dotRadius: 8 },
    ],
    400,
    225,
  );
  assert.equal(layout.length, 3);
  assert.equal(layout[0].dotDx, 0);
  assert.equal(layout[0].dotDy, 0);
  // Colliding dot separates visibly
  assert.ok(Math.hypot(layout[1].dotDx, layout[1].dotDy) >= 12);

  // Compute rendered label rectangles and assert zero pairwise overlap & within [4, box] bounds
  const rects = layout.map((l, idx) => {
    const x = [0.5, 0.5, 0.52][idx] * 400 + l.dotDx;
    const y = [0.5, 0.5, 0.51][idx] * 225 + l.dotDy;
    const w = [120, 120, 140][idx];
    const h = 22;
    const left = x + l.labelX;
    const top = y + l.labelY;
    assert.ok(left >= 4 - 1e-6 && left + w <= 400 - 4 + 1e-6, `label ${idx} inside X`);
    assert.ok(top >= 4 - 1e-6 && top + h <= 225 - 4 + 1e-6, `label ${idx} inside Y`);
    return { left, top, right: left + w, bottom: top + h };
  });
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i],
        b = rects[j];
      const overlaps = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      assert.equal(overlaps, false, `labels ${i} and ${j} must not overlap`);
    }
  }
});

test("resolvePinLayout flips and stacks bottom-edge pins upward within the stage", () => {
  const layout = resolvePinLayout(
    [
      { x: 0.5, y: 0.94, labelWidth: 120, labelHeight: 22, dotRadius: 8 },
      { x: 0.5, y: 0.94, labelWidth: 120, labelHeight: 22, dotRadius: 8 },
    ],
    400,
    225,
  );
  const tops = layout.map((l) => 0.94 * 225 + l.dotDy + l.labelY);
  assert.ok(tops[0] >= 4 && tops[0] + 22 <= 221);
  assert.ok(tops[1] >= 4 && tops[1] + 22 <= 221);
  assert.ok(Math.abs(tops[0] - tops[1]) >= 22);
});

test("activeStageNotes skips drawn marks notes and scales fade window for non-unit playback rate", () => {
  const { pins, frame } = activeStageNotes(
    [
      {
        t: 1,
        n: {
          id: "pin-scaled",
          text: "Fast playback pin",
          pin: { x: 0.5, y: 0.5, what: "Steve" },
        },
      },
      {
        t: 2,
        n: {
          id: "drawn-skip",
          text: "Drawn arrow must use ink canvas",
          marks: [
            {
              kind: "arrow",
              t: 2,
              pts: [
                [0.1, 0.2],
                [0.4, 0.5],
              ],
            },
          ],
        },
      },
      {
        t: 2,
        n: {
          id: "empty-marks-frame",
          text: "Empty marks renders as whole-frame note",
          marks: [],
        },
      },
    ],
    4,
    2,
  );
  assert.deepEqual(
    pins.map((p) => p.id),
    ["pin-scaled"],
  );
  assert.ok(Math.abs(pins[0].fade - 0.5) < 1e-6);
  assert.deepEqual(
    frame.map((f) => f.id),
    ["empty-marks-frame"],
  );
  assert.ok(Math.abs(frame[0].fade - 2 / 3) < 1e-6);
});

test("resolvePinLayout guards invalid bounds/NaN coords and spreads >13 colliding pins onto outer rings", () => {
  const collapsed = resolvePinLayout(
    [{ x: 0.5, y: 0.5, labelWidth: 100, labelHeight: 20, dotRadius: 8 }],
    0,
    225,
  );
  assert.deepEqual(collapsed, [{ dotDx: 0, dotDy: 0, labelX: 0, labelY: 0, up: false }]);

  const sanitized = resolvePinLayout(
    [{ x: Number.NaN, y: Number.POSITIVE_INFINITY, labelWidth: 90, labelHeight: 20, dotRadius: 8 }],
    400,
    225,
  );
  assert.equal(sanitized.length, 1);
  for (const val of [
    sanitized[0].dotDx,
    sanitized[0].dotDy,
    sanitized[0].labelX,
    sanitized[0].labelY,
  ]) {
    assert.ok(Number.isFinite(val), `expected finite layout value, got ${val}`);
  }
  assert.equal(typeof sanitized[0].up, "boolean");

  const crowded = Array.from({ length: 16 }, () => ({
    x: 0.5,
    y: 0.5,
    labelWidth: 64,
    labelHeight: 18,
    dotRadius: 8,
  }));
  const layout = resolvePinLayout(crowded, 480, 270);
  assert.equal(layout.length, 16);
  assert.equal(layout[0].dotDx, 0);
  assert.equal(layout[0].dotDy, 0);
  assert.ok(
    layout.slice(1).every((l) => Math.hypot(l.dotDx, l.dotDy) >= 12),
    "every colliding pin shifts off origin",
  );
  assert.ok(
    layout.some((l) => Math.hypot(l.dotDx, l.dotDy) >= 28),
    "crowded >13 pins spill into outer findFreeDot rings (r >= 28)",
  );
  for (const l of layout) {
    const left = 240 + l.dotDx + l.labelX;
    const top = 135 + l.dotDy + l.labelY;
    assert.ok(left >= 4 - 1e-6 && left + 64 <= 476 + 1e-6);
    assert.ok(top >= 4 - 1e-6 && top + 18 <= 266 + 1e-6);
  }
});

test("resolvePinLayout avoids overlapping another pin's dot ring and activeStageNotes preserves empty-text pins", () => {
  const layout = resolvePinLayout(
    [
      { x: 0.5, y: 0.45, labelWidth: 120, labelHeight: 22, dotRadius: 8 },
      { x: 0.5, y: 0.52, labelWidth: 120, labelHeight: 22, dotRadius: 8 },
    ],
    400,
    300,
  );
  const dot0 = { x: 0.5 * 400 + layout[0].dotDx, y: 0.45 * 300 + layout[0].dotDy };
  const dot1 = { x: 0.5 * 400 + layout[1].dotDx, y: 0.52 * 300 + layout[1].dotDy };
  const lbl0 = {
    left: dot0.x + layout[0].labelX,
    top: dot0.y + layout[0].labelY,
    right: dot0.x + layout[0].labelX + 120,
    bottom: dot0.y + layout[0].labelY + 22,
  };
  const lbl1 = {
    left: dot1.x + layout[1].labelX,
    top: dot1.y + layout[1].labelY,
    right: dot1.x + layout[1].labelX + 120,
    bottom: dot1.y + layout[1].labelY + 22,
  };
  const touchesDot = (lbl, dot) =>
    lbl.left < dot.x + 8 && lbl.right > dot.x - 8 && lbl.top < dot.y + 8 && lbl.bottom > dot.y - 8;
  assert.equal(touchesDot(lbl0, dot1), false, "pin 0 label must not cover pin 1 dot");
  assert.equal(touchesDot(lbl1, dot0), false, "pin 1 label must not cover pin 0 dot");

  const emptyPinRes = activeStageNotes(
    [{ t: 2, n: { id: "empty-pin", text: "   ", pin: { x: 0.5, y: 0.5, what: "Hero" } } }],
    2,
    1,
  );
  assert.deepEqual(
    emptyPinRes.pins.map((p) => p.id),
    ["empty-pin"],
  );
});
