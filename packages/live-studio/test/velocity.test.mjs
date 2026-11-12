import assert from "node:assert/strict";
import { test } from "node:test";

import { compileTiming } from "../src/timing.mjs";
import { velocityAt, velocityCurve } from "../src/velocity.mjs";

test("velocity ramps preserve clip length and every irregular music beat", () => {
  for (const speed of ["normal", "fast", "veryFast"]) {
    const value = { from: 3, to: 10, beats: [3.4, 4.1, 5.6, 6, 8.5, 9.7], speed, frequency: 2 };
    const curve = velocityCurve(value),
      clock = compileTiming({ speeds: [{ from: 3, to: 10, ...curve }] }, 12);
    assert.ok(Math.abs(clock.duration - 12) < 1e-7);
    for (const at of value.beats) assert.ok(Math.abs(clock.outputAt(at) - at) < 1e-7);
    assert.ok(curve.curve.some(([, rate]) => rate > 1.1));
    assert.ok(curve.curve.every(([, rate]) => rate >= 0.1 && rate <= 10));
  }
});

test("velocity visual accents stay on beats, respect intensity, and end at the clip edge", () => {
  const value = {
    from: 0,
    to: 5,
    beats: [1, 2, 3, 4],
    frequency: 2,
    speed: "normal",
    effect: "flash",
    intensity: 50,
  };
  assert.equal(velocityAt([value], 0.9), null);
  assert.equal(velocityAt([value], 1).amount, 0.5);
  assert.equal(velocityAt([value], 1.5), null);
  assert.equal(velocityAt([{ ...value, enabled: false }], 1), null);
  assert.equal(velocityAt([{ ...value, intensity: 0 }], 1), null);
  assert.equal(velocityAt([value], 5), null);
});

test("Beats 1 accents every fourth beat while retaining the whole clip", () => {
  const value = {
    from: 0,
    to: 6,
    beats: [1, 2, 3, 4, 5],
    frequency: 1,
    speed: "normal",
    effect: "flash",
    intensity: 100,
  };
  assert.equal(velocityAt([value], 2), null);
  assert.equal(velocityAt([value], 5).amount, 1);
  assert.equal(velocityAt([value], 5).beatIndex, 1);
  assert.ok(
    Math.abs(
      compileTiming({ speeds: [{ from: 0, to: 6, ...velocityCurve(value) }] }, 6).duration - 6,
    ) < 1e-7,
  );
});
