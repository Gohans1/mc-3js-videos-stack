import assert from "node:assert/strict";
import { test } from "node:test";

import { curveMonotoneX, line } from "d3-shape";

import { bisector, bisectRight } from "../src/bisect.mjs";
import {
  buildSpeedCurve,
  cropSpeedCurve,
  cutRatesAt,
  flattenSpeedCurve,
  moveSpeedPoint,
  pointInRate,
  pointOutRate,
  remapSpeedCutsOnInsert,
  remapSpeedCutsOnRemove,
  sampleSpeedCurve,
  smoothSpeedCurve,
  toggleSpeedCut,
} from "../src/speed-curve.mjs";
import { compileTiming } from "../src/timing.mjs";

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

test("buildSpeedCurve, toggleSpeedCut, moveSpeedPoint (left/right halves) and compileTiming support discontinuous splits without neighbor pull", () => {
  const pts = [
    [0, 1],
    [0.25, 2.5],
    [0.5, 1],
    [0.75, 0.4],
    [1, 1],
  ];
  const smooth = buildSpeedCurve(pts);
  assert.equal(smooth.cuts, undefined);

  // Cutting interior vertex 2 detaches left half & right half without shifting the existing curve
  const broken = toggleSpeedCut(smooth, 2);
  assert.deepEqual(broken.cuts, { 2: [1, 1] });
  assert.deepEqual(broken.handles, smooth.handles);

  // Moving just the incoming (left) half changes only the left run and disconnects incoming/outgoing rates
  const leftPulled = moveSpeedPoint(broken, 2, [0.5, 3.5], "left");
  assert.deepEqual(cutRatesAt(leftPulled, 2), [3.5, 1]);
  assert.equal(pointInRate(leftPulled, 2), 3.5);
  assert.equal(pointOutRate(leftPulled, 2), 1);
  assert.deepEqual(leftPulled.handles.slice(2), broken.handles.slice(2));

  // Moving vertex 3 in run [2..4] must leave left half & run [0..2] handles byte-identical
  const movedRight = moveSpeedPoint(leftPulled, 3, [0.75, 4.5], "both");
  assert.deepEqual(cutRatesAt(movedRight, 2), [3.5, 1]);
  assert.deepEqual(movedRight.handles.slice(0, 2), leftPulled.handles.slice(0, 2));
  assert.notDeepEqual(movedRight.handles[2], leftPulled.handles[2]);

  // Moving outgoing half on a linked point auto-splits just that side cleanly
  const autoSplitOut = moveSpeedPoint(smooth, 2, [0.5, 2.4], "right");
  assert.deepEqual(cutRatesAt(autoSplitOut, 2), [1, 2.4]);
  assert.deepEqual(autoSplitOut.handles.slice(0, 2), smooth.handles.slice(0, 2));

  // Endpoints cannot be cut
  assert.deepEqual(toggleSpeedCut(broken, 0), broken);
  assert.deepEqual(toggleSpeedCut(broken, pts.length - 1), broken);

  // Reconnecting merges back cleanly and removes cuts entry
  const rejoined = toggleSpeedCut(leftPulled, 2, "left");
  assert.equal(rejoined.cuts, undefined);
  close(rejoined.curve[2][1], 3.5);

  // Discontinuous step curve flattens with both boundary rates and compiles exact step playback
  const stepped = {
    curve: [
      [0, 2],
      [0.5, 2],
      [1, 1],
    ],
    cuts: { 1: [2, 0.5] },
  };
  const flatStep = flattenSpeedCurve(stepped);
  assert.deepEqual(flatStep, [
    [0, 2],
    [0.5, 2],
    [0.5, 0.5],
    [1, 1],
  ]);
  const clock = compileTiming({ speeds: [{ from: 0, to: 10, ...stepped }] }, 10);
  const segLeft = clock.segments.find((s) => s.sourceFrom === 0 && s.sourceTo === 5);
  const segRight = clock.segments.find((s) => s.sourceFrom === 5 && s.sourceTo === 10);
  close(segLeft.rate1, 2);
  close(segRight.rate0, 0.5);

  // Non-dyadic shot spans (IEEE-754 ULP boundary drift on (b - from)/(to - from)) must keep before/after rates exact
  const ulpStep = {
    curve: [
      [0, 1],
      [0.25, 1],
      [1, 1],
    ],
    cuts: { 1: [4, 0.25] },
  };
  const ulpClock1 = compileTiming({ speeds: [{ from: 0.1, to: 1.4, ...ulpStep }] }, 2);
  close(ulpClock1.segments.find((s) => Math.abs(s.sourceTo - 0.425) < 1e-9).rate1, 4);
  close(ulpClock1.segments.find((s) => Math.abs(s.sourceFrom - 0.425) < 1e-9).rate0, 0.25);
  const ulpStep2 = {
    curve: [
      [0, 1],
      [0.1, 1],
      [1, 1],
    ],
    cuts: { 1: [3.5, 0.4] },
  };
  const ulpClock2 = compileTiming({ speeds: [{ from: 0, to: 13.7, ...ulpStep2 }] }, 13.7);
  close(ulpClock2.segments.find((s) => Math.abs(s.sourceTo - 1.37) < 1e-9).rate1, 3.5);
  close(ulpClock2.segments.find((s) => Math.abs(s.sourceFrom - 1.37) < 1e-9).rate0, 0.4);

  // Cut entries remap cleanly on insert, remove, and crop
  assert.deepEqual(remapSpeedCutsOnInsert({ 2: [2, 0.5], 3: [1, 1] }, 2, 6), {
    3: [2, 0.5],
    4: [1, 1],
  });
  assert.deepEqual(remapSpeedCutsOnRemove({ 1: [1.5, 0.8], 3: [2, 0.5] }, 2, 4), {
    1: [1.5, 0.8],
    2: [2, 0.5],
  });
  const cropped = cropSpeedCurve(leftPulled, 0.25, 0.75);
  assert.deepEqual(cropped.cuts, { 1: [3.5, 1] });
  close(cropped.curve[1][1], 2.25);
});
