// A lane clip's fades as the page plays them (app/sound/envelope.ts) must match the film's mix (scripts/sound/mix.py, ffmpeg
// afade). The expected values were read off ffmpeg itself: a constant signal through the same atrim/afade chain, 1000 samples/s
import assert from "node:assert/strict";
import { test } from "node:test";
import { envelope, envelopePoints } from "../app/sound/envelope.ts";

const near = (a, b) => assert.ok(Math.abs(a - b) < 0.002, `${a} vs ${b}`);
const at = (fi, fo, len) => [0, 0.25, 0.5, 0.75, 0.999].map((u) => envelope(u, fi, fo, len));

test("fades that don't meet: up, flat, down, as ffmpeg makes them", () => {
  [0, 0.5, 1, 0.5, 0.002].forEach((v, i) => near(at(0.5, 0.5, 1)[i], v));
});

test("fades that overlap multiply, as ffmpeg's two afades do", () => {
  [0, 0.312, 0.521, 0.391, 0.002].forEach((v, i) => near(at(0.8, 0.6, 1)[i], v));
});

test("a fade out longer than the clip starts at 0 and never reaches silence", () => {
  [0, 0.703, 0.688, 0.531, 0.376].forEach((v, i) => near(at(0.3, 1.6, 1)[i], v));
});

test("a one-shot without a length has no fade out", () => {
  assert.equal(envelope(5, 0, 0.4), 1);
  assert.equal(envelope(5, 0, 0.4, undefined), 1);
});

test("straight ramps through the points stay on the curve, even where the fades overlap", () => {
  for (const [fi, fo, len, u0] of [[0.8, 0.6, 1, 0], [0.5, 0.5, 1, 0.3], [4, 3, 104, 50], [0.3, 1.6, 1, 0]]) {
    const pts = envelopePoints(u0, len, fi, fo, len);
    assert.equal(pts[0][0], u0);
    assert.equal(pts.at(-1)[0], len);
    for (let u = u0; u <= len; u += len / 997) {
      const k = pts.findIndex(([x]) => x >= u), [x1, y1] = pts[k], [x0, y0] = pts[Math.max(0, k - 1)];
      const line = x1 === x0 ? y1 : y0 + ((y1 - y0) * (u - x0)) / (x1 - x0);
      assert.ok(Math.abs(line - envelope(u, fi, fo, len)) < 0.01, `fi ${fi} fo ${fo} at ${u}`);
    }
  }
});
