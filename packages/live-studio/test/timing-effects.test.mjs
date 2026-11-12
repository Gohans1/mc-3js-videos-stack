import assert from "node:assert/strict";
import { test } from "node:test";

import { effectLength, effectSpan, transitionAvailable } from "../src/timing-effects.mjs";
import { compileTiming } from "../src/timing.mjs";

test("animation lengths display and save in output seconds after a speed change", () => {
  const clock = compileTiming({ speeds: [{ from: 0, to: 5, rate: 2 }] }, 10);
  assert.deepEqual(effectSpan(clock, 0, 0, 1, 1), [0, 0.5]);
  assert.deepEqual(effectSpan(clock, 5, 1, 0, 1), [2, 2.5]);
  assert.ok(Math.abs(effectLength(clock, 0, 0, 1, 1, 5) - 2) < 1e-9);
  assert.ok(Math.abs(effectLength(clock, 5, 1, 0, 0.75, 5) - 1.5) < 1e-9);
});

test("a transition spans unequal output time on either side of a retimed cut", () => {
  const clock = compileTiming({ speeds: [{ from: 0, to: 5, rate: 2 }] }, 10);
  assert.deepEqual(effectSpan(clock, 5, 0.5, 0.5, 2), [2, 3.5]);
  const length = effectLength(clock, 5, 0.5, 0.5, 0.75, 5);
  assert.ok(Math.abs(length - 1) < 1e-9);
  const [from, to] = effectSpan(clock, 5, 0.5, 0.5, length);
  assert.ok(Math.abs(to - from - 0.75) < 1e-9);
});

test("trimmed animation time disappears and transitions touching a removed shot are unavailable", () => {
  for (const key of ["cuts", "gaps"]) {
    const clock = compileTiming({ [key]: [{ from: 0, to: 5 }] }, 15);
    assert.equal(transitionAvailable(clock, 5), false);
    assert.equal(transitionAvailable(clock, 10), true);
    if (key === "cuts") assert.deepEqual(effectSpan(clock, 0, 0, 1, 1), [0, 0]);
  }
});

test("an animation spanning a freeze includes the held frame in its displayed length", () => {
  const clock = compileTiming({ freezes: [{ at: 0.5, duration: 3 }] }, 5);
  assert.deepEqual(effectSpan(clock, 0, 0, 1, 1), [0, 4]);
  assert.ok(Math.abs(effectLength(clock, 0, 0, 1, 4, 5) - 1) < 1e-9);
});
