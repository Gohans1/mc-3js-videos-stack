import assert from "node:assert/strict";
import { test } from "node:test";

import { cameraSpeed, sampleCameraSpanSpeed } from "../src/camera-speed.mjs";
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
