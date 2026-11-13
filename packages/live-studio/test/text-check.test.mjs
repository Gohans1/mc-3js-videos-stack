// checks/text.mjs: where a line of on-screen text sits and how it reads over the picture, from two frames the page renders
// (with the line and without it); here the frames are drawn by hand
import assert from "node:assert/strict";
import { test } from "node:test";

import { measure, verdict } from "../checks/text.mjs";

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
// a line of "letters": white bars 2 px wide every 8 px, with an optional ring of another colour around each (a stroke)
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

  const none = measure(frame([0, 0, 0]), frame([0, 0, 0]), W, H, WHITE, 20);
  assert.equal(none, null);
  assert.match(verdict({ i: 3, text: "GONE", at: 5, px: 56 }, none).lines[0], /drew nothing/);
});
