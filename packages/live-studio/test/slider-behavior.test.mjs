import assert from "node:assert/strict";
import { test } from "node:test";

import { createSliderDrag, quantize, stepDecimals } from "../app/components/Slider.tsx";

test("slider quantizes scientific-notation steps without losing precision", () => {
  assert.equal(stepDecimals(1e-7), 7);
  assert.equal(stepDecimals(2.5e-4), 5);
  assert.equal(quantize(3e-7, 0, 1, 1e-7), 3e-7);
  assert.equal(quantize(5e-6, 1e-6, 1e-5, 2e-6), 5e-6);
});

test("slider commits changed drags once and cancels stationary or interrupted drags", () => {
  const makeTarget = () => {
    let captured = null;
    return {
      el: {
        setPointerCapture(id) {
          captured = id;
        },
        hasPointerCapture(id) {
          return captured === id;
        },
        releasePointerCapture(id) {
          if (captured === id) captured = null;
        },
      },
      isCaptured: () => captured !== null,
    };
  };

  {
    const commits = [];
    let val = 10;
    const d = createSliderDrag({
      getCurrent: () => val,
      onCommit: (v) => commits.push(v),
    });
    const t = makeTarget();
    assert.equal(d.start(t.el, 1, 10), false);
    d.end(t.el, 1);
    assert.deepEqual(commits, []);
    assert.equal(t.isCaptured(), false);
  }

  {
    const commits = [];
    let val = 10;
    const d = createSliderDrag({
      getCurrent: () => val,
      onCommit: (v) => commits.push(v),
    });
    const t = makeTarget();
    assert.equal(d.start(t.el, 1, 42), true);
    val = 42;
    d.end(t.el, 1);
    assert.deepEqual(commits, [42]);
  }

  for (const kind of ["cancel", "lostcapture"]) {
    const commits = [];
    let val = 10;
    const d = createSliderDrag({
      getCurrent: () => val,
      onCommit: (v) => commits.push(v),
    });
    const t = makeTarget();
    d.start(t.el, 2, 10);
    assert.equal(d.move(35), true);
    val = 35;
    if (kind === "lostcapture") t.el.releasePointerCapture(2);
    d.cancel(t.el, 2);
    d.end(t.el, 2);
    assert.deepEqual(commits, []);
    assert.equal(t.isCaptured(), false);
  }

  {
    const commits = [];
    let val = 10;
    const d = createSliderDrag({
      getCurrent: () => val,
      onCommit: (v) => commits.push(v),
    });
    const t = makeTarget();
    d.start(t.el, 3, 10);
    assert.equal(d.move(75), true);
    val = 75;
    assert.equal(d.cancel(t.el, 3), true);
    assert.equal(t.isCaptured(), false);
    d.end(t.el, 3);
    assert.deepEqual(commits, []);
  }
});
