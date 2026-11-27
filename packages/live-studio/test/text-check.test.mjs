import assert from "node:assert/strict";
import { test } from "node:test";

import { measure, summary, verdict } from "../checks/text.mjs";
import { isRead, pxOf } from "../src/readable.mjs";

const W = 200,
  H = 100;
const frame = (rgb) => {
  const f = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) f.set([...rgb, 255], i * 4);
  return f;
};
const paint = (f, x0, y0, x1, y1, rgb) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) f.set([...rgb, 255], (y * W + x) * 4);
};
const line = (bg, x0, ring) => {
  const without = frame(bg),
    withText = frame(bg);
  for (let x = x0; x < x0 + 80; x += 8) {
    if (ring) paint(withText, x - 3, 37, x + 5, 63, ring);
    paint(withText, x, 40, x + 2, 60, [255, 255, 255]);
  }
  return [withText, without];
};
const WHITE = "#FFFFFF";

test("white letters over black read; the box is where they are, in frame fractions", () => {
  const m = measure(...line([0, 0, 0], 60), W, H, WHITE, 20);
  assert.ok(m.contrast > 15, `contrast ${m.contrast}`);
  assert.deepEqual(
    m.box.map((v) => +v.toFixed(2)),
    [0.3, 0.4, 0.67, 0.6],
  );
  const v = verdict({ i: 2, text: "A LINE", at: 12, px: 56 }, m);
  assert.deepEqual(v.faults, []);
});

test("white letters over a white sky are flagged LOW with the fixes; a dark stroke around them makes them read", () => {
  const sky = measure(...line([235, 235, 235], 60), W, H, WHITE, 20);
  const v = verdict({ i: 0, text: "OVER THE SKY", at: 4.5, px: 40 }, sky);
  assert.deepEqual(v.faults, ["LOW"]);
  assert.match(
    v.lines.join("\n"),
    /LOW items\[0\] "OVER THE SKY" at 4\.50[^\n]*needs 4\.5:1[^\n]*stroke/,
  );

  const stroked = measure(...line([235, 235, 235], 60, [0, 0, 0]), W, H, WHITE, 20);
  assert.ok(stroked.contrast > 4.5, `contrast ${stroked.contrast}`);
});

test("text past the 5% graphics-safe margin is OUTSIDE, naming the edge; text that drew nothing says so", () => {
  const edge = measure(...line([0, 0, 0], 4), W, H, WHITE, 20);
  const v = verdict({ i: 1, text: "EDGE", at: 2, px: 56 }, edge);
  assert.deepEqual(v.faults, ["OUTSIDE"]);
  assert.match(v.lines.join("\n"), /OUTSIDE items\[1\] "EDGE"[^\n]*2\.0% from the left edge/);

  const right = measure(...line([0, 0, 0], 110), W, H, WHITE, 20);
  assert.deepEqual(verdict({ i: 4, text: "BUTTONS", at: 1, px: 56 }, right).faults, []);
  const short = verdict({ i: 4, text: "BUTTONS", at: 1, px: 56 }, right, "9:16");
  assert.deepEqual(short.faults, ["OUTSIDE"]);
  assert.match(
    short.lines.join("\n"),
    /OUTSIDE items\[4\] "BUTTONS"[^\n]*8\.0% from the right edge[^\n]*Short[^\n]*10\.0% from the right/,
  );

  const wide = verdict(
    { i: 5, text: "A VERY LONG LINE", at: 3, px: 56 },
    { box: [0.004, 0.4, 0.994, 0.6], contrast: 10 },
  );
  assert.match(wide.lines.join("\n"), /wider than the safe area[^\n]*"\\n"[^\n]*smaller size/);

  const none = measure(frame([0, 0, 0]), frame([0, 0, 0]), W, H, WHITE, 20);
  assert.equal(none, null);
  assert.match(verdict({ i: 3, text: "GONE", at: 5, px: 56 }, none).lines[0], /drew nothing/);
});

test("the summary counts the faults and, when there are some, names the way out for decor", () => {
  assert.match(summary(4, 0).join("\n"), /4 lines read over the picture, 0 at fault/);
  const faulty = summary(4, 2).join("\n");
  assert.match(faulty, /2 at fault/);
  assert.match(faulty, /"read": false/);
});

test("thin dark strokes stay readable over white sky when strokePx tightens halo sampling, and safeArea overrides Shorts margins", () => {
  const without = frame([235, 235, 235]);
  const withText = frame([235, 235, 235]);
  for (let x = 60; x < 140; x += 12) {
    paint(withText, x - 2, 38, x + 4, 62, [0, 0, 0]);
    paint(withText, x, 40, x + 2, 60, [255, 255, 255]);
  }
  const wideHalo = measure(withText, without, W, H, WHITE, 60, 0);
  assert.ok(wideHalo && wideHalo.contrast < 4.5, `expected wide halo < 4.5, got ${wideHalo?.contrast}`);
  const thinStroked = measure(withText, without, W, H, WHITE, 60, 4);
  assert.ok(thinStroked && thinStroked.contrast > 4.5, `expected > 4.5, got ${thinStroked?.contrast}`);

  const lowCaption = { box: [0.25, 0.76, 0.75, 0.805], contrast: 12 };
  assert.deepEqual(verdict({ i: 0, text: "it was strange", at: 1, px: 75 }, lowCaption, "9:16").faults, [
    "OUTSIDE",
  ]);
  assert.deepEqual(
    verdict(
      { i: 0, text: "it was strange", at: 1, px: 75, safeArea: { bottom: 0.18 } },
      lowCaption,
      "9:16",
    ).faults,
    [],
  );
  assert.deepEqual(
    verdict({ i: 0, text: "edge", at: 1, px: 75, safeArea: false }, { box: [0.01, 0.85, 0.99, 0.95], contrast: 12 }, "9:16")
      .faults,
    [],
  );
  assert.equal(pxOf({ kind: "text", preset: "zack-d-films", from: 0, to: 1, text: "hi" }), 75);
  assert.equal(isRead({ preset: "zack-d-films", from: 0, to: 1, text: "hi" }, undefined), true);
});
