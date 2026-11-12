import assert from "node:assert/strict";
import { test } from "node:test";

import { compileLayerTiming, remapOutputTime } from "../src/layer-timing.mjs";
import { clipTiming, compileTiming, frameVisible } from "../src/timing.mjs";

test("closing a gap beside a freeze removes that gap without stretching the held content", () => {
  const before = { freezes: [{ at: 5, duration: 2, padBefore: 1 }] };
  const after = { freezes: [{ at: 5, duration: 2 }] };
  const a = compileTiming(before, 12),
    b = compileTiming(after, 12);
  assert.equal(remapOutputTime(a, b, 5.5), 5);
  assert.equal(remapOutputTime(a, b, 6.5), 5.5);
  assert.equal(remapOutputTime(a, b, 8.5), 7.5);
  const layers = compileLayerTiming(
    { ...after, layers: { base: {}, changes: [{ before, after }] } },
    15,
  );
  assert.equal(layers.outputAt(6.5), 5.5);
  assert.equal(layers.sourceAt(5.5), 6.5);
  const segments = clipTiming(layers, 0, 15);
  assert.ok(segments.every((s, i) => i === 0 || Math.abs(s.from - segments[i - 1].to) < 1e-8));
});

test("linkage follows edits at their current timeline position after an earlier unlinked edit", () => {
  const before = { speeds: [{ from: 0, to: 5, rate: 0.5 }] };
  const after = { speeds: [...before.speeds, { from: 5, to: 10, rate: 0.5 }] };
  const unlinked = compileLayerTiming({ ...before, layers: { base: {}, changes: [] } }, 20);
  assert.equal(unlinked.outputAt(8), 8);
  const linked = compileLayerTiming(
    { ...after, layers: { base: {}, changes: [{ before, after }] } },
    20,
  );
  assert.equal(linked.outputAt(8), 8, "an overlay before the edited shot stays put");
  assert.equal(linked.outputAt(12), 14, "the overlay inside that shot follows its new timing");
  assert.equal(linked.outputAt(18), 23);
  assert.equal(linked.sourceAt(14), 12);
});

test("magnet and linkage independently control gap closure and linked layer content", () => {
  for (const magnet of [false, true])
    for (const linkage of [false, true]) {
      const change = { [magnet ? "cuts" : "gaps"]: [{ from: 2, to: 5 }] };
      const clock = compileLayerTiming(
        { ...change, ...(!linkage && { layers: { base: {}, changes: [] } }) },
        10,
      );
      assert.equal(clock.visible(3), !linkage);
      assert.equal(clock.outputAt(8), magnet && linkage ? 5 : 8);
    }
  const before = { gaps: [{ from: 2, to: 5 }] },
    after = { gaps: [...before.gaps, { from: 7, to: 9 }] };
  const clock = compileLayerTiming(
    { ...after, layers: { base: {}, changes: [{ before, after }] } },
    10,
  );
  assert.equal(
    clock.visible(3),
    true,
    "re-enabling linkage does not delete layers beneath an earlier unlinked gap",
  );
  assert.equal(clock.visible(8), false);
  assert.ok(clipTiming(clock, 0, 10).some((s) => s.blank && s.from === 7 && s.to === 9));
});

test("a linked freeze inserts silence on the layer clock and a later cut removes the matching layer span", () => {
  const before = { speeds: [{ from: 0, to: 5, rate: 0.5 }] };
  const frozen = { ...before, freezes: [{ at: 2, duration: 3 }] };
  const after = { ...frozen, cuts: [{ from: 6, to: 8 }] };
  const clock = compileLayerTiming(
    {
      ...after,
      layers: {
        base: {},
        changes: [
          { before, after: frozen },
          { before: frozen, after },
        ],
      },
    },
    20,
  );
  assert.equal(clock.outputAt(4, "before"), 4);
  assert.equal(clock.outputAt(4), 7);
  assert.equal(clock.sourceAt(5), 4);
  assert.equal(clock.visible(12), false);
  assert.equal(clock.outputAt(18), 19);
  assert.ok(
    clipTiming(clock, 0, 20).some((s) => s.kind === "freeze" && s.from === 4 && s.to === 7),
  );
});

test("composed speed curves keep accurate seeks and provide audio segments within one sample", () => {
  const before = {
    speeds: [
      {
        from: 0,
        to: 6,
        curve: [
          [0, 0.5],
          [0.4, 3],
          [1, 1],
        ],
      },
    ],
  };
  const after = {
    speeds: [
      {
        from: 0,
        to: 6,
        curve: [
          [0, 2],
          [0.6, 0.3],
          [1, 2],
        ],
      },
    ],
  };
  const clock = compileLayerTiming(
    { ...after, layers: { base: {}, changes: [{ before, after }] } },
    12,
  );
  for (let t = 0; t < 12; t += 0.037) {
    const out = clock.outputAt(t);
    assert.ok(Math.abs(clock.sourceAt(out) - t) < 1e-8);
    const segment = clock.segments.find((s) => t >= s.sourceFrom && t < s.sourceTo);
    const approximate = segment.from + (t - segment.sourceFrom) / segment.rate0;
    assert.ok(Math.abs(out - approximate) < 1 / 48000);
  }
});

test("reordering main clips keeps composed layer segments sorted in output time and tracks blank gaps", () => {
  const before = {
    main: [
      { id: "a", kind: "clip", sourceFrom: 0, sourceTo: 4 },
      { id: "b", kind: "clip", sourceFrom: 4, sourceTo: 8 },
    ],
  };
  const after = {
    main: [
      { id: "b", kind: "clip", sourceFrom: 4, sourceTo: 8 },
      { id: "g", kind: "gap", duration: 2 },
      { id: "a", kind: "clip", sourceFrom: 0, sourceTo: 4 },
    ],
  };
  const clock = compileLayerTiming(
    { ...after, layers: { base: before, changes: [{ before, after }] } },
    8,
  );
  assert.equal(clock.duration, 10);
  assert.ok(
    clock.segments.every((s, i) => i === 0 || Math.abs(s.from - clock.segments[i - 1].to) < 1e-8),
    "segments form a sorted contiguous output cover",
  );
  assert.equal(clock.outputAt(5), 1);
  assert.equal(clock.outputAt(1), 7);
  assert.equal(clock.sourceAt(1), 5);
  assert.equal(clock.sourceAt(7), 1);
  assert.equal(clock.sourceAt(4, "before"), 8);
  assert.equal(clock.sourceAt(10, "before"), 4);
  assert.equal(frameVisible(clock, 1), true);
  assert.equal(
    frameVisible(clock, 5),
    false,
    "linked gap between reordered clips hides layer output",
  );
  assert.equal(frameVisible(clock, 7), true);
});
