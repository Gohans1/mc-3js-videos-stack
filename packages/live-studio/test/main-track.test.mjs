import assert from "node:assert/strict";
import { test } from "node:test";

import { TimingTimeline } from "../src/contract.ts";
import { mapTimeline } from "../src/timing-data.mjs";
import { effectSpan, transitionAvailable } from "../src/timing-effects.mjs";
import { setTiming, timedDraw } from "../src/timing-state.mjs";
import {
  closeTimingGaps,
  compileTiming,
  deleteFreeze,
  frameAt,
  frameVisible,
  freezeRange,
  resizeFreeze,
} from "../src/timing.mjs";

test("editing a surviving camera key does not duplicate the closing key of a removed neighbour", () => {
  const clock = compileTiming(
    {
      main: [
        { id: "a", kind: "clip", sourceFrom: 0, sourceTo: 4 },
        { id: "c", kind: "clip", sourceFrom: 8, sourceTo: 12 },
      ],
    },
    12,
  );
  const source = [
    { t: 0, x: 0 },
    { t: 4, x: 1 },
    { t: 4, cut: true, x: 2 },
    { t: 8, x: 3 },
    { t: 8, cut: true, x: 4 },
    { t: 12, x: 5 },
  ];
  const view = mapTimeline("cam", source, clock);
  view[0].x = 10;
  assert.deepEqual(
    mapTimeline("cam", view, clock, true, source),
    source.map((k, i) => (i ? k : { ...k, x: 10 })),
  );
});

test("a freeze inserted into a reordered clip splits its source range and remains independently resizable and removable", async () => {
  const { insertMainFreeze } = await import("../src/main-track.mjs");
  const timing = {
    main: [
      { id: "b", kind: "clip", sourceFrom: 4, sourceTo: 8 },
      { id: "a", kind: "clip", sourceFrom: 0, sourceTo: 4 },
    ],
  };
  const clock = compileTiming(timing, 8);
  insertMainFreeze(timing, clock, 1, 3);
  assert.deepEqual(
    timing.main.map((it) => it.kind),
    ["clip", "freeze", "clip", "clip"],
  );
  assert.deepEqual(
    timing.main.filter((it) => it.kind === "clip").map((it) => [it.sourceFrom, it.sourceTo]),
    [
      [4, 5],
      [5, 8],
      [0, 4],
    ],
  );
  assert.equal(frameAt(compileTiming(timing, 8), 2), 5);
  assert.deepEqual(freezeRange(timing, compileTiming(timing, 8), 0), [1, 4]);
  resizeFreeze(timing, 0, 2, false);
  assert.deepEqual(freezeRange(timing, compileTiming(timing, 8), 0), [1, 3]);
  assert.equal(compileTiming(timing, 8).duration, 11);
  deleteFreeze(timing, 0, false);
  assert.equal(frameVisible(compileTiming(timing, 8), 2), false);
  closeTimingGaps(timing);
  assert.equal(compileTiming(timing, 8).duration, 8);
});

test("main insert previews use the remaining clips' midpoints; linked clips keep their offset and duration", async () => {
  const { mainDrop, mainShift } = await import("../src/main-track.mjs");
  const timing = {
    main: [
      { id: "a", kind: "clip", sourceFrom: 0, sourceTo: 4 },
      { id: "b", kind: "clip", sourceFrom: 4, sourceTo: 10 },
      { id: "c", kind: "clip", sourceFrom: 10, sourceTo: 12 },
    ],
  };
  const before = compileTiming(timing, 12);
  const moved = mainDrop(timing, 12, timing.main, "b", 7, true);
  assert.deepEqual(
    moved.map((it) => it.id),
    ["a", "c", "b"],
  );
  const after = compileTiming({ main: moved }, 12);
  assert.equal(mainShift(before.placements, after.placements, 5), 2);
  assert.equal(mainShift(before.placements, after.placements, 0), 0);
  assert.equal(mainShift(before.placements, after.placements, 10.5), -6);
});

test("reordering preserves animation spans and disables transitions between separated source neighbours", () => {
  const clock = compileTiming(
    {
      main: [
        { id: "b", kind: "clip", sourceFrom: 4, sourceTo: 8 },
        { id: "c", kind: "clip", sourceFrom: 8, sourceTo: 12 },
        { id: "a", kind: "clip", sourceFrom: 0, sourceTo: 4 },
      ],
    },
    12,
  );
  assert.equal(transitionAvailable(clock, 4), false);
  assert.equal(transitionAvailable(clock, 8), true);
  assert.deepEqual(effectSpan(clock, 4, 0, 1, 1), [0, 1]);
  assert.deepEqual(effectSpan(clock, 4, 1, 0, 1), [11, 12]);
});

test("saved main order drives drawing and key edits preserve each side of a camera cut", () => {
  const timing = {
    main: [
      { id: "b", kind: "clip", sourceFrom: 4, sourceTo: 8 },
      { id: "a", kind: "clip", sourceFrom: 0, sourceTo: 4 },
    ],
  };
  assert.deepEqual(TimingTimeline.parse(timing), timing);
  setTiming(timing, 8);
  assert.equal(timedDraw((t) => t)(1), 5);
  const clock = compileTiming(timing, 8);
  const raw = [
    { t: 0, x: 0 },
    { t: 4, x: 1 },
    { t: 4, cut: true, x: 2 },
    { t: 8, x: 3 },
  ];
  const shown = mapTimeline("cam", raw, clock);
  assert.deepEqual(
    shown.map((k) => [k.t, k.x]),
    [
      [0, 2],
      [4, 3],
      [4, 0],
      [8, 1],
    ],
  );
  shown.find((k) => k.x === 1).x = 10;
  assert.deepEqual(
    mapTimeline("cam", structuredClone(shown), clock, true, raw),
    raw.map((k, i) => (i === 1 ? { ...k, x: 10 } : k)),
  );
  const actor = {
    moves: [
      { t: 0, pose: "idle" },
      { t: 4, pose: "walk" },
      { t: 8, pose: "stop" },
    ],
  };
  assert.deepEqual(
    mapTimeline("keys/0", actor, clock).moves.map((k) => [k.t, k.pose]),
    [
      [0, "walk"],
      [4, "idle"],
      [8, "stop"],
    ],
  );
  setTiming({}, 8);
});

test("reordering main clips preserves their source ranges and the camera, actor and held frame samples", async () => {
  const { compileMainTrack, moveMainItem } = await import("../src/main-track.mjs");
  const source = compileTiming({ speeds: [{ from: 0, to: 4, rate: 2 }] }, 12);
  const items = [
    { id: "a", kind: "clip", sourceFrom: 0, sourceTo: 4 },
    { id: "hold", kind: "freeze", frame: 2, duration: 3 },
    { id: "b", kind: "clip", sourceFrom: 4, sourceTo: 8 },
    { id: "c", kind: "clip", sourceFrom: 8, sourceTo: 12 },
  ];
  const saved = structuredClone(items);
  const moved = moveMainItem(items, "c", "a");
  assert.deepEqual(items, saved);
  assert.deepEqual(
    moved.map((item) => item.id),
    ["c", "a", "hold", "b"],
  );
  assert.deepEqual(
    moved.find((item) => item.id === "c"),
    saved[3],
  );
  const clock = compileMainTrack(source, moved);
  assert.equal(clock.duration, 13);
  const scene = (t) => ({ camera: t * 2, actor: Math.sin(t), light: t % 1 });
  for (const [output, input] of [
    [0.5, 8.5],
    [4.5, 1],
    [6.5, 2],
    [8.9, 2],
    [9.5, 4.5],
  ]) {
    assert.deepEqual(scene(frameAt(clock, output)), scene(input));
  }
  assert.equal(clock.outputAt(1), 4.5);
  assert.equal(clock.outputAt(9), 1);
  assert.equal(clock.outputAt(12, "before"), 4);
  assert.equal(clock.outputAt(13), 14);
});

test("main-track gaps remain explicit and arbitrary seeks do not depend on playback direction", async () => {
  const { compileMainTrack } = await import("../src/main-track.mjs");
  const source = compileTiming(
    {
      speeds: [
        {
          from: 0,
          to: 4,
          curve: [
            [0, 0.5],
            [1, 3],
          ],
        },
      ],
    },
    8,
  );
  const clock = compileMainTrack(source, [
    { id: "b", kind: "clip", sourceFrom: 4, sourceTo: 8 },
    { id: "gap", kind: "gap", duration: 2 },
    { id: "a", kind: "clip", sourceFrom: 0, sourceTo: 4 },
  ]);
  const gap = clock.segments.find((s) => s.blank);
  assert.ok(Math.abs(gap.from - 4) < 1e-9 && Math.abs(gap.to - 6) < 1e-9);
  for (const t of [3.7, 0.1, 2.3, 1.7, 3.7]) {
    const output = clock.outputAt(t);
    assert.ok(output >= 6);
    assert.ok(Math.abs(clock.sourceAt(output) - t) < 1e-9);
  }
});

test("existing speed, cuts, gaps and padded freezes migrate to main clips without changing visible frames", async () => {
  const { createMainItems, compileMainTrack } = await import("../src/main-track.mjs");
  const timing = {
    speeds: [{ from: 0, to: 10, rate: 2 }],
    freezes: [
      { at: 3, frame: 1, duration: 2, padBefore: 1 },
      { at: 7, duration: 1, blank: true },
    ],
    cuts: [{ from: 8, to: 9 }],
    gaps: [{ from: 6, to: 7 }],
  };
  const before = compileTiming(timing, 12);
  const items = createMainItems(timing, 12, [0, 4, 8]);
  assert.equal(new Set(items.map((item) => item.id)).size, items.length);
  const after = compileMainTrack(compileTiming({ speeds: timing.speeds }, 12), items);
  assert.equal(after.duration, before.duration);
  for (let t = 0; t < before.duration; t += 0.071) {
    assert.equal(frameVisible(after, t), frameVisible(before, t));
    if (frameVisible(before, t))
      assert.ok(Math.abs(frameAt(after, t) - frameAt(before, t)) < 1e-8, `frame at ${t}`);
  }
});
