import assert from "node:assert/strict";
import { test } from "node:test";

import { cameraSpeed } from "../src/camera-speed.mjs";
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
