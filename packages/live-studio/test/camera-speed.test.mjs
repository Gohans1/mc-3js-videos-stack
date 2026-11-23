import assert from "node:assert/strict";
import { test } from "node:test";

import {
  analyzeCameraTimeline,
  analyzeKeyFileMotion,
  attributeCamKeySpan,
  cameraSpeed,
  resolveKeyFov,
  sampleCameraSpanSpeed,
  viewVectorAngleDeg,
} from "../src/camera-speed.mjs";
import { compileTiming } from "../src/timing.mjs";

test("films without timing support still show their camera motion", () => {
  assert.ok(Math.abs(cameraSpeed(null, 0, 4, (u) => u, 2) - 0.25) < 1e-7);
});

test("the camera graph stops during Freeze and resumes at the actual film rate", () => {
  const clock = compileTiming(
    { speeds: [{ from: 0, to: 10, rate: 2 }], freezes: [{ at: 2, duration: 3 }] },
    10,
  );
  assert.equal(
    cameraSpeed(clock, 0, 10, (u) => u, 2),
    0,
  );
  assert.ok(Math.abs(cameraSpeed(clock, 0, 10, (u) => u, 5) - 0.2) < 1e-7);
});

test("camera easing composes with the speed ramp in source coordinates", () => {
  const clock = compileTiming(
    {
      speeds: [
        {
          from: 0,
          to: 4,
          curve: [
            [0, 1],
            [1, 3],
          ],
        },
      ],
    },
    4,
  );
  assert.ok(Math.abs(cameraSpeed(clock, 0, 4, (u) => u * u, clock.outputAt(2)) - 0.5) < 1e-6);
});

test("trimming the beginning preserves the remaining eased motion without a cut spike", () => {
  const clock = compileTiming({ cuts: [{ from: 0, to: 5 }] }, 10);
  assert.ok(Math.abs(cameraSpeed(clock, 0, 10, (u) => u * u, 0) - 0.1) < 1e-6);
});

test("sampleCameraSpanSpeed clamps both span endpoints symmetrically so x0 round-trip underflow never drops j = 0 to 0", () => {
  const a = 0.1,
    v = 6.1,
    w = 800,
    from = 2.3,
    to = 3.3;
  const x0 = ((from - a) / v) * w;
  const x1 = ((to - a) / v) * w;
  assert.ok(a + (x0 / w) * v < from, "fixture should round slightly below span start");
  const speed = sampleCameraSpanSpeed(null, a, v, w, x0, x1, from, to, (u) => u);
  assert.ok(speed[0] > 0.9 && Math.abs(speed[0] - 1) < 1e-4, `expected ~1 at j=0, got ${speed[0]}`);
  assert.ok(
    speed[speed.length - 1] > 0.9 && Math.abs(speed[speed.length - 1] - 1) < 1e-4,
    `expected ~1 at j=n, got ${speed[speed.length - 1]}`,
  );
});

test("viewVectorAngleDeg measures exact angle between consecutive p->l directions", () => {
  const angle = viewVectorAngleDeg([0, 1, 0], [0, 1, -5], [0, 1, 0], [5, 1, 0]);
  assert.ok(Math.abs(angle - 90) < 1e-6, `expected 90 deg, got ${angle}`);
  assert.equal(viewVectorAngleDeg([1, 2, 3], [1, 2, 3], [0, 0, 0], [0, 0, -1]), 0);
});

test("resolveKeyFov carries forward fov and converts mm at the given aspect", () => {
  const keys = [
    { t: 0, p: [0, 0, 5], l: [0, 0, 0], mm: 50 },
    { t: 2, p: [0, 0, 5], l: [0, 0, 0] },
    { t: 4, p: [0, 0, 5], l: [0, 0, 0], fov: 35 },
  ];
  const f0 = resolveKeyFov(keys, 0, 16 / 9);
  const f1 = resolveKeyFov(keys, 1, 16 / 9);
  const f2 = resolveKeyFov(keys, 2, 16 / 9);
  const expected = (2 * Math.atan(18 / 50 / (16 / 9)) * 180) / Math.PI;
  assert.ok(
    Math.abs(f0 - expected) < 0.01,
    `expected ~${expected.toFixed(2)} deg for 50mm 16:9, got ${f0}`,
  );
  assert.equal(f1, f0);
  assert.equal(f2, 35);
});

test("attributeCamKeySpan locates the exact key row span while respecting hard cuts", () => {
  const keys = [
    { t: 0, p: [0, 0, 5], l: [0, 0, 0] },
    { t: 2, p: [0, 0, 5], l: [2, 0, 0] },
    { t: 2.001, p: [5, 0, 5], l: [5, 0, 0], cut: true },
    { t: 5, p: [5, 0, 5], l: [5, 2, 0] },
  ];
  const a = attributeCamKeySpan(keys, 1.5);
  assert.deepEqual(a.span, [0, 1]);
  assert.equal(a.keyRow, 1);

  const b = attributeCamKeySpan(keys, 2.5);
  assert.deepEqual(b.span, [2, 3]);
  assert.equal(b.keyRow, 2);
});

test("analyzeCameraTimeline detects fast 50 deg/s pan and fast FOV snap with offending key rows", () => {
  const keys = [
    { t: 0, p: [0, 1, 0], l: [0, 1, -5], fov: 60 },
    { t: 10, p: [0, 1, 0], l: [0, 1, -5], fov: 60 },
    { t: 11, p: [0, 1, 0], l: [5.958767, 1, -4.195498], fov: 60 },
    { t: 12, p: [0, 1, 0], l: [5.958767, 1, -4.195498], fov: 60 },
    { t: 12.1, p: [0, 1, 0], l: [5.958767, 1, -4.195498], fov: 25 },
    { t: 14, p: [0, 1, 0], l: [5.958767, 1, -4.195498], fov: 25 },
  ];
  const res = analyzeCameraTimeline(keys);
  assert.equal(res.posPeak.v, 0);
  assert.ok(res.turnPeak.v >= 50, `expected >= 50 deg/s pan, got ${res.turnPeak.v}`);
  assert.deepEqual(res.turnPeak.span, [1, 2]);
  assert.ok(res.fovPeak.v >= 300, `expected >= 300 deg/s FOV snap, got ${res.fovPeak.v}`);
  assert.deepEqual(res.fovPeak.span, [3, 4]);
  assert.ok(res.fastPans.length >= 1);
  assert.ok(res.fastFovs.length >= 1);
  assert.notEqual(res.status, "pass");
});

test("analyzeKeyFileMotion attributes speed peaks in key files to exact path and row indices", () => {
  const steve = {
    moves: [
      { t: 0, at: [0, 0, 0], yaw: 0 },
      { t: 2, at: [0, 0, 0], yaw: 0 },
      { t: 2.5, at: [5, 0, 0], yaw: 180 },
    ],
  };
  const out = analyzeKeyFileMotion(steve, "src/timeline/steve.json");
  assert.equal(out.tracks.length, 1);
  assert.equal(out.tracks[0].path, "moves");
  assert.equal(out.tracks[0].peakPos.rowFrom, 1);
  assert.equal(out.tracks[0].peakPos.rowTo, 2);
  assert.ok(Math.abs(out.tracks[0].peakPos.v - 10) < 1e-6);
  assert.ok(Math.abs(out.tracks[0].peakRot.v - 360) < 1e-6);
});

test("analyzeCameraTimeline isolates equal-timestamp cut boundaries from evaluator bleed", () => {
  const keys = [
    { t: 0, p: [0, 1, 5], l: [0, 1, 0], fov: 50 },
    { t: 2, p: [0, 1, 5], l: [0, 1, 0], fov: 50 },
    { t: 2, cut: true, p: [20, 5, 20], l: [0, 1, 0], fov: 20 },
    { t: 4, p: [20, 5, 20], l: [0, 1, 0], fov: 20 },
  ];
  const res = analyzeCameraTimeline(keys, {
    evaluator: (t, _a, segKeys) => {
      const slice = segKeys ?? keys;
      let active = slice[0];
      for (const k of slice) if (k.t <= t) active = k;
      return { p: active.p, l: active.l, fov: active.fov };
    },
  });
  assert.equal(res.pops.length, 0);
  assert.equal(res.posPeak.v, 0);
  assert.equal(res.turnPeak.v, 0);
  assert.equal(res.fovPeak.v, 0);
  assert.equal(res.status, "pass");
});

test("resolveKeyFov resets across cuts and prioritizes mm over fov with default 70", () => {
  const keys = [
    { t: 0, p: [0, 0, 5], l: [0, 0, 0], fov: 40, mm: 50 },
    { t: 2, p: [0, 0, 5], l: [0, 0, 0], cut: true },
  ];
  const expectedMm = (2 * Math.atan(18 / 50 / (16 / 9)) * 180) / Math.PI;
  assert.ok(Math.abs(resolveKeyFov(keys, 0, 16 / 9) - expectedMm) < 1e-6);
  assert.equal(resolveKeyFov(keys, 1, 16 / 9), 70);
});

test("analyzeKeyFileMotion wraps yaw deltas > 360 and descends into placed.json track arrays", () => {
  const spin = analyzeKeyFileMotion({
    moves: [
      { t: 0, at: [0, 0, 0], yaw: 0 },
      { t: 1, at: [0, 0, 0], yaw: 370 },
    ],
  });
  assert.ok(Math.abs(spin.tracks[0].peakRot.v - 10) < 1e-6);

  const placed = [
    {
      what: "mob:cat",
      keys: [
        { t: 0, at: [0, 0, 0] },
        { t: 0.5, at: [4, 0, 0] },
      ],
    },
  ];
  const out = analyzeKeyFileMotion(placed, "src/timeline/placed.json");
  assert.equal(out.tracks.length, 1);
  assert.equal(out.tracks[0].path, "[mob:cat].keys");
  assert.ok(Math.abs(out.tracks[0].peakPos.v - 8) < 1e-6);
});

test("analyzeCameraTimeline flags non-cut equal-t teleports as pops", () => {
  const keys = [
    { t: 0, p: [0, 0, 5], l: [0, 0, 0], fov: 60 },
    { t: 1, p: [0, 0, 5], l: [0, 0, 0], fov: 60 },
    { t: 1, p: [10, 0, 5], l: [10, 0, 0], fov: 60 },
    { t: 2, p: [10, 0, 5], l: [10, 0, 0], fov: 60 },
  ];
  const res = analyzeCameraTimeline(keys);
  const pop = res.pops.find((p) => p.kind === "pos");
  assert.ok(pop, "expected pos pop for non-cut equal-t jump");
  assert.deepEqual(pop.span, [1, 2]);
  assert.equal(res.status, "fail");
});

test("analyzeCameraTimeline measures short <1/30s substeps accurately and keyFiles ignore shots/bites", () => {
  const shortFov = analyzeCameraTimeline([
    { t: 0, p: [0, 0, 5], l: [0, 0, 0], fov: 60 },
    { t: 0.04, p: [0, 0, 5], l: [0, 0, 0], fov: 40 },
  ]);
  assert.ok(shortFov.fovPeak.v >= 499, `expected ~500 deg/s, got ${shortFov.fovPeak.v}`);

  const nonSpatial = analyzeKeyFileMotion(
    [
      { t: 0, what: "intro", size: "WS" },
      { t: 3, what: "mid", size: "CU" },
    ],
    "src/timeline/shots.json",
  );
  assert.equal(nonSpatial.tracks.length, 0);

  const stringAtTrack = analyzeKeyFileMotion(
    [
      { t: 0, at: "elon-head" },
      { t: 2, at: "boss-head" },
    ],
    "src/timeline/focus.json",
  );
  assert.equal(stringAtTrack.tracks.length, 0);

  const fovOnly = analyzeCameraTimeline([
    { t: 0, fov: 60 },
    { t: 1, fov: 30 },
  ]);
  assert.equal(fovOnly.posPeak.v, 0);
  assert.equal(fovOnly.turnPeak.v, 0);
  assert.ok(Math.abs(fovOnly.fovPeak.v - 30) < 1e-6);
});
