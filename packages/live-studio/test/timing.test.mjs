import assert from "node:assert/strict";
import { test } from "node:test";

import { SoundProcess } from "../src/contract.ts";
import { compileLayerTiming } from "../src/layer-timing.mjs";
import {
  clipTiming,
  closeTimingGaps,
  compileTiming,
  deleteFreeze,
  frameVisible,
  freezeRange,
  joinRanges,
  replaceSpeed,
  resizeFreeze,
  speedRange,
  visibleSourceRange,
} from "../src/timing.mjs";
import * as timingAPI from "../src/timing.mjs";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test("main-track shot bodies stop at freeze clips and blank gaps, including speed ramps", () => {
  const clock = compileTiming(
    {
      speeds: [{ from: 0, to: 8, rate: 2 }],
      freezes: [{ at: 4, duration: 3 }],
      gaps: [{ from: 6, to: 7 }],
    },
    10,
  );
  assert.deepEqual(timingAPI.playRanges(clock, 2, 9), [
    { sourceFrom: 2, sourceTo: 4, from: 1, to: 2 },
    { sourceFrom: 4, sourceTo: 6, from: 5, to: 6 },
    { sourceFrom: 7, sourceTo: 9, from: 6.5, to: 8 },
  ]);
});

test("moving a freeze inserts the captured frame at its new position without changing its duration", () => {
  const data = { speeds: [{ from: 0, to: 6, rate: 2 }], freezes: [{ at: 4, duration: 3 }] };
  const index = timingAPI.moveFreeze(data, 0, 8, 12, true);
  const clock = compileTiming(data, 12);
  assert.deepEqual(freezeRange(data, clock, index), [8, 11]);
  assert.equal(timingAPI.frameAt(clock, 9), 4);
  close(clock.sourceAt(11.5), 11.5);
  close(clock.duration, 12);
  close(clock.sourceAt(2.5), 5);
});

test("moving a freeze with the magnet off leaves its original space empty", () => {
  const data = { freezes: [{ at: 2, duration: 3 }] };
  const index = timingAPI.moveFreeze(data, 0, 9, 12, false);
  const clock = compileTiming(data, 12);
  assert.deepEqual(freezeRange(data, clock, index), [9, 12]);
  assert.equal(timingAPI.frameAt(clock, 10), 2);
  assert.equal(frameVisible(clock, 3), false);
  close(clock.duration, 18);
  closeTimingGaps(data);
  const closed = compileTiming(data, 12);
  assert.equal(timingAPI.frameAt(closed, 7), 2);
});

test("adjacent freezes have separate bounds and preserve each captured frame", () => {
  const data = {
    freezes: [
      { at: 2, duration: 3 },
      { at: 7, duration: 2 },
    ],
  };
  const index = timingAPI.moveFreeze(data, 0, 7, 12, true);
  const clock = compileTiming(data, 12);
  assert.deepEqual(freezeRange(data, clock, 0), [7, 9]);
  assert.deepEqual(freezeRange(data, clock, index), [9, 12]);
  assert.equal(timingAPI.frameAt(clock, 8), 7);
  assert.equal(timingAPI.frameAt(clock, 10), 2);
});

test("shot bounds exclude cuts and gaps while preserving the source span across speed ramps and freezes", () => {
  const clock = compileTiming(
    {
      cuts: [
        { from: 0, to: 2 },
        { from: 5, to: 7 },
      ],
      gaps: [{ from: 9, to: 10 }],
      freezes: [{ at: 3, duration: 2 }],
      speeds: [
        {
          from: 2,
          to: 9,
          curve: [
            [0, 0.5],
            [0.5, 3],
            [1, 1],
          ],
        },
      ],
    },
    12,
  );
  assert.deepEqual(visibleSourceRange(clock, 0, 6), [2, 5]);
  assert.deepEqual(visibleSourceRange(clock, 5, 10), [7, 9]);
  assert.deepEqual(visibleSourceRange(clock, 9, 10), [9, 9]);
  assert.deepEqual(visibleSourceRange(clock, 2.5, 11), [2.5, 11]);
  assert.deepEqual(visibleSourceRange(clock, 12, 14), [12, 12]);
});

test("a smooth speed ramp follows its cubic speed and survives trimming either half", () => {
  const effect = {
    from: 0,
    to: 10,
    curve: [
      [0, 1],
      [1, 4],
    ],
    handles: [[1, 4]],
  };
  const clock = compileTiming({ speeds: [effect] }, 10);
  const rate = (u) => 1 + 3 * (3 * u * u - 2 * u * u * u);
  const n = 100000;
  let reference = 0;
  for (let i = 0; i < n; i++) reference += 10 / n / rate((i + 0.5) / n);
  assert.ok(
    Math.abs(clock.duration - reference) < 1 / 48000,
    `duration ${clock.duration} versus integrated ${reference}`,
  );
  const t = clock.outputAt(2.5),
    h = 1e-5;
  assert.ok(
    Math.abs((clock.sourceAt(t + h) - clock.sourceAt(t - h)) / (2 * h) - rate(0.25)) < 1e-4,
  );
  for (const [a, b] of [
    [0, 2.5],
    [2.5, 7.3],
    [7.3, 10],
  ]) {
    const part = compileTiming({ speeds: [speedRange(effect, a, b)] }, 10);
    assert.ok(
      Math.abs(part.outputAt(b) - part.outputAt(a) - (clock.outputAt(b) - clock.outputAt(a))) <
        1 / 48000,
    );
  }
});

test("changing one half of a split speed ramp preserves the other half's timing", () => {
  const speeds = [
    {
      from: 0,
      to: 10,
      curve: [
        [0, 1],
        [0.5, 2],
        [1, 1],
      ],
    },
  ];
  const before = compileTiming({ speeds }, 12);
  const after = compileTiming({ speeds: replaceSpeed(speeds, 5, 10, { rate: 0.5 }) }, 12);
  for (const t of [0, 1, 3, 5]) close(after.outputAt(t), before.outputAt(t));
  close(after.outputAt(10) - after.outputAt(5), 10);
  assert.deepEqual(speedRange(speeds[0], 0, 5).curve, [
    [0, 1],
    [1, 2],
  ]);
  const reset = compileTiming({ speeds: replaceSpeed(speeds, 2, 8, null) }, 12);
  close(reset.outputAt(8) - reset.outputAt(2), 6);
  close(reset.outputAt(10) - reset.outputAt(8), before.outputAt(10) - before.outputAt(8));
});

test("slowing a five-second shot to eight seconds moves every later source event by three seconds", () => {
  const clock = compileTiming({ speeds: [{ from: 5, to: 10, rate: 5 / 8 }] }, 20);
  close(clock.duration, 23);
  close(clock.outputAt(7.5), 9);
  close(clock.outputAt(12), 15);
  close(clock.sourceAt(15), 12);
  close(clock.sourceAt(9), 7.5);
});

test("a three-second freeze holds the exact source frame and resumes at that frame", () => {
  const clock = compileTiming({ freezes: [{ at: 5, duration: 3 }] }, 10);
  close(clock.duration, 13);
  for (const t of [5, 5.5, 6, 7.99, 8]) close(clock.sourceAt(t), 5);
  close(clock.sourceAt(8.25), 5.25);
  close(clock.outputAt(5, "before"), 5);
  close(clock.outputAt(5, "after"), 8);
});

test("late audio clips keep an exact zero origin after a fractional freeze resize", () => {
  const before = { freezes: [{ at: 15.666666666666666, duration: 3 }] };
  const after = { freezes: [{ at: 15.666666666666666, duration: 2.7333333333333334 }] };
  const clock = compileLayerTiming(
    {
      ...after,
      layers: {
        base: {},
        changes: [
          { before: {}, after: before },
          { before, after },
        ],
      },
    },
    151,
  );
  for (let at = 100; at < 150; at += 0.37) {
    const timeline = clipTiming(clock, at, at + 0.35);
    assert.equal(timeline[0].from, 0);
    assert.ok(
      SoundProcess.safeParse({ name: "fixture", start: 0, duration: 0.35, loop: false, timeline })
        .success,
    );
  }
});

test("trimming either freeze edge with the magnet off leaves black space and keeps the next clip fixed", () => {
  const data = { freezes: [{ at: 5, duration: 3 }] };
  resizeFreeze(data, 0, 2.1, false, -1);
  let clock = compileTiming(data, 12);
  close(clock.duration, 15);
  assert.deepEqual(freezeRange(data, clock, 0), [5.9, 8]);
  assert.equal(frameVisible(clock, 5.5), false);
  assert.equal(frameVisible(clock, 6), true);
  resizeFreeze(data, 0, 1.5, false, 1);
  clock = compileTiming(data, 12);
  assert.deepEqual(freezeRange(data, clock, 0), [5.9, 7.4]);
  assert.equal(frameVisible(clock, 7.7), false);
  close(clock.sourceAt(8.5), 5.5);
  resizeFreeze(data, 0, 10, false, 1);
  close(data.freezes[0].duration, 2.1);
  closeTimingGaps(data);
  clock = compileTiming(data, 12);
  close(clock.duration, 14.1);
  assert.deepEqual(freezeRange(data, clock, 0), [5, 7.1]);
});

test("deleting a freeze leaves a gap only when the magnet is off", () => {
  for (const ripple of [true, false]) {
    const data = { freezes: [{ at: 5, duration: 3 }] };
    deleteFreeze(data, 0, ripple);
    const clock = compileTiming(data, 12);
    close(clock.duration, ripple ? 12 : 15);
    assert.equal(frameVisible(clock, 6), ripple);
    closeTimingGaps(data);
    close(compileTiming(data, 12).duration, 12);
  }
});

test("ripple removal skips source content at the cut without changing later movement", () => {
  const clock = compileTiming({ cuts: [{ from: 4, to: 7 }] }, 12);
  close(clock.duration, 9);
  close(clock.sourceAt(4), 7);
  close(clock.sourceAt(4.1), 7.1);
  close(clock.outputAt(9), 6);
  assert.equal(clock.visible(5), false);
  assert.equal(clock.visible(7), true);
});

test("ripple trims that touch an earlier removal close the interval only once", () => {
  const cuts = joinRanges([
    { from: 2, to: 4 },
    { from: 6, to: 7 },
    { from: 3, to: 6 },
  ]);
  assert.deepEqual(cuts, [{ from: 2, to: 7 }]);
  const clock = compileTiming({ cuts, freezes: [{ at: 3, duration: 2 }] }, 10);
  close(clock.duration, 5);
  close(clock.sourceAt(2), 7);
  close(clock.outputAt(8), 3);
});

test("removing main-track content with its magnet off leaves a timed gap", () => {
  const clock = compileTiming({ gaps: [{ from: 2, to: 5 }] }, 10);
  close(clock.duration, 10);
  close(clock.sourceAt(3), 3);
  close(clock.outputAt(8), 8);
  assert.equal(clock.visible(3), false);
  assert.equal(clock.visible(5), true);
  assert.equal(clipTiming(clock, 0, 8).find((s) => s.sourceFrom === 2).blank, true);
});

test("a speed ramp integrates elapsed time and seeking gives the same source frame as continuous playback", () => {
  const clock = compileTiming(
    {
      speeds: [
        {
          from: 0,
          to: 10,
          curve: [
            [0, 1],
            [1, 2],
          ],
        },
      ],
    },
    10,
  );
  close(clock.duration, 10 * Math.log(2));
  close(clock.outputAt(5), 10 * Math.log(1.5));
  for (const s of [0, 0.1, 2, 5, 9.99, 10]) close(clock.sourceAt(clock.outputAt(s)), s);
});

test("unchanged film time is an identity map, including clip tails beyond the picture", () => {
  const clock = compileTiming({}, 10);
  for (const t of [-0.5, 0, 1.5, 10, 12]) {
    close(clock.sourceAt(t), t);
    close(clock.outputAt(t), t);
  }
});

test("a trimmed audio clip gets local playback ranges and silence only for freezes inside it", () => {
  const clock = compileTiming(
    { speeds: [{ from: 5, to: 10, rate: 2 }], freezes: [{ at: 6, duration: 3 }] },
    10,
  );
  const parts = clipTiming(clock, 5, 9);
  assert.deepEqual(parts, [
    { kind: "play", sourceFrom: 0, sourceTo: 1, from: 0, to: 0.5, rate0: 2, rate1: 2 },
    { kind: "freeze", sourceFrom: 1, sourceTo: 1, from: 0.5, to: 3.5 },
    { kind: "play", sourceFrom: 1, sourceTo: 4, from: 3.5, to: 5, rate0: 2, rate1: 2 },
  ]);
  assert.equal(
    clipTiming(clock, 6, 9).some((s) => s.kind === "freeze"),
    false,
  );
});
