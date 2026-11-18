import assert from "node:assert/strict";
import { test } from "node:test";

import { curveMonotoneX, line } from "d3-shape";

import { bisector, bisectRight } from "../src/bisect.mjs";
import {
  cropSpeedCurve,
  flattenSpeedCurve,
  sampleSpeedCurve,
  smoothSpeedCurve,
} from "../src/speed-curve.mjs";

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("bisector left/right and bisectRight match D3 insertion bounds on sorted values and duplicates", () => {
  const byX = bisector((d) => d.x);
  const items = [{ x: 1 }, { x: 2 }, { x: 2 }, { x: 5 }];
  assert.equal(byX.left(items, 2), 1);
  assert.equal(byX.right(items, 2), 3);
  assert.equal(byX.left(items, 0), 0);
  assert.equal(byX.right(items, 9), 4);
  assert.equal(bisectRight([10, 20, 20, 30], 20), 3);
  assert.equal(bisectRight([10, 20, 20, 30], 15), 1);
});

test("smoothSpeedCurve, sampleSpeedCurve, cropSpeedCurve and flattenSpeedCurve stay consistent across linear and Bézier curves", () => {
  // Without handles: sampleSpeedCurve is linear and flattenSpeedCurve returns curve directly
  const linear = {
    curve: [
      [0, 1],
      [0.5, 3],
      [1, 1],
    ],
  };
  close(sampleSpeedCurve(linear, 0.25), 2);
  close(sampleSpeedCurve(linear, 0.75), 2);
  assert.equal(flattenSpeedCurve(linear), linear.curve);

  // With monotone handles: preserves endpoints, crops subranges consistently, and flattens densely
  const smoothed = smoothSpeedCurve([
    [0, 1],
    [0.25, 2],
    [0.75, 0.5],
    [1, 1.5],
  ]);
  assert.equal(smoothed.curve.length, 4);
  assert.equal(smoothed.handles.length, 3);
  close(sampleSpeedCurve(smoothed, 0), 1);
  close(sampleSpeedCurve(smoothed, 1), 1.5);

  const cropped = cropSpeedCurve(smoothed, 0.25, 0.75);
  close(cropped.curve[0][0], 0);
  close(cropped.curve[cropped.curve.length - 1][0], 1);
  close(sampleSpeedCurve(cropped, 0.5), sampleSpeedCurve(smoothed, 0.5), 1e-6);

  const flat = flattenSpeedCurve(smoothed);
  assert.ok(flat.length > smoothed.curve.length);
  close(flat[0][0], 0);
  close(flat[flat.length - 1][0], 1);
  close(flat[flat.length - 1][1], 1.5);
});

test("smoothSpeedCurve matches d3 curveMonotoneX handles and handles duplicates or degenerate curves", () => {
  const d3Handles = (pts) => {
    const out = [];
    line()
      .curve(curveMonotoneX)
      .context({
        moveTo() {},
        lineTo() {},
        bezierCurveTo(_x1, y1, _x2, y2) {
          out.push([y1, y2]);
        },
        closePath() {},
      })(pts);
    return out;
  };

  for (const pts of [
    [
      [0, 1],
      [0.15, 2.8],
      [0.45, 0.4],
      [0.8, 2.2],
      [1, 1.5],
    ],
    [
      [0, 2],
      [0.3, 2],
      [0.7, 0.8],
      [1, 0.8],
    ],
  ]) {
    const got = smoothSpeedCurve(pts);
    const want = d3Handles(pts);
    assert.equal(got.handles.length, want.length);
    for (let i = 0; i < want.length; i++) {
      close(got.handles[i][0], want[i][0], 1e-12);
      close(got.handles[i][1], want[i][1], 1e-12);
    }
  }
  const twoPt = smoothSpeedCurve([
    [0, 1],
    [1, 2.5],
  ]);
  assert.equal(twoPt.handles.length, 1);
  close(twoPt.handles[0][0], 1.5, 1e-12);
  close(twoPt.handles[0][1], 2.0, 1e-12);

  // Consecutive duplicate (x, y) points must be compacted so handles stay aligned with segments
  const dup = smoothSpeedCurve([
    [0, 1],
    [0.5, 2],
    [0.5, 2],
    [1, 1],
  ]);
  assert.deepEqual(dup.curve, [
    [0, 1],
    [0.5, 2],
    [1, 1],
  ]);
  assert.equal(dup.handles.length, 2);
  assert.ok(Number.isFinite(sampleSpeedCurve(dup, 0.75)));

  // Vertical step (duplicate x with distinct y) must not divide by zero -> NaN
  const verticalStep = {
    curve: [
      [0, 1],
      [0.5, 2],
      [0.5, 4],
      [1, 3],
    ],
  };
  assert.ok(Number.isFinite(sampleSpeedCurve(verticalStep, 0.5)));

  // Degenerate curves (< 2 points)
  assert.deepEqual(smoothSpeedCurve([]), { curve: [], handles: [] });
  assert.deepEqual(smoothSpeedCurve([[0.4, 2.5]]), { curve: [[0.4, 2.5]], handles: [] });
  assert.equal(sampleSpeedCurve({ curve: [[0.4, 2.5]] }, 0.9), 2.5);
  assert.equal(sampleSpeedCurve({ curve: [] }, 0.5), 1);
});
