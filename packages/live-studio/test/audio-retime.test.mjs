import assert from "node:assert/strict";
import { test } from "node:test";

import { beatMarks, reverseBeats } from "../app/sound/beat-marks.ts";
import { retime, retimedLength, sourceRoom, sourceTime, trimSource } from "../app/sound/retime.ts";
import { mapTimeline } from "../src/timing-data.mjs";
import { compileTiming } from "../src/timing.mjs";

test("audio collision checking uses the new end after crossing a film speed boundary", () => {
  const clock = compileTiming(
    {
      speeds: [
        { from: 0, to: 4, rate: 2 },
        { from: 4, to: 10, rate: 0.5 },
      ],
    },
    10,
  );
  const clip = mapTimeline(
    "sound",
    { beds: [], sfx: [{ at: 0, name: "beat", length: 4, rate: 1 }] },
    clock,
  ).sfx[0];
  assert.equal(clip.length, 2);
  assert.equal(retimedLength(clip, clip.length, 0.5, clip.at, clock), 10);
});

test("audio trim limits project the available file region through film speed and freeze", () => {
  const clock = compileTiming(
    { speeds: [{ from: 0, to: 10, rate: 0.5 }], freezes: [{ at: 5, duration: 2 }] },
    10,
  );
  for (const reverse of [false, true]) {
    const original = { at: 3, start: 2, length: 4, rate: 1, reverse };
    const c = mapTimeline("sound", { beds: [], sfx: [original] }, clock).sfx[0];
    assert.deepEqual(
      sourceRoom(c, c.length, 10, c.at, clock),
      reverse ? [clock.outputAt(-1), clock.outputAt(9)] : [clock.outputAt(1), clock.outputAt(11)],
    );
  }
});

test("audio speed retains the same source region and moves fades and volume keys with the sound", () => {
  const c = {
    start: 3,
    rate: 2,
    gain: -8,
    gainKeys: [
      { t: 0, gain: -8 },
      { t: 2, gain: -2 },
    ],
    fadeIn: 1,
    fadeOut: 0.5,
  };
  const length = retime(c, 4, 0.5);
  assert.equal(length, 16);
  assert.equal(c.start, 3);
  assert.equal(sourceTime(c, length, 10), 8);
  assert.deepEqual(c.gainKeys, [
    { t: 0, gain: -8 },
    { t: 8, gain: -2 },
  ]);
  assert.equal(c.fadeIn, 4);
  assert.equal(c.fadeOut, 2);
});

test("trimming or splitting reversed audio retains exactly the samples that were under those timeline seconds", () => {
  for (const reverse of [false, true]) {
    const original = {
      start: 3,
      rate: 2,
      reverse,
      gain: 0,
      gainKeys: [
        { t: 0, gain: -20 },
        { t: 4, gain: 0 },
      ],
    };
    const left = structuredClone(original),
      right = structuredClone(original);
    trimSource(left, 0, 2, 4, 20, false);
    trimSource(right, 2, 4, 4, 20, false);
    for (const t of [0.1, 0.5, 1.5]) {
      assert.equal(sourceTime(left, 2, t), sourceTime(original, 4, t));
      assert.equal(sourceTime(right, 2, t), sourceTime(original, 4, t + 2));
    }
    assert.deepEqual(right.gainKeys, [
      { t: -2, gain: -20 },
      { t: 2, gain: 0 },
    ]);
  }
});

test("looping source trims wrap by the loop period in source seconds after speed is applied", () => {
  // 3 + 2 s at speed 2 is stream second 7; a 5 s file crossfades over 1.25 s, so the stream repeats every 3.75 s past
  // its first fade and second 7 sounds as second 3.25
  const c = { start: 3, rate: 2, gain: 0 };
  trimSource(c, 2, 10, 10, 5, true);
  assert.equal(c.start, 3.25);
  const back = { start: 0.5, gain: 0 };
  trimSource(back, -1, 10, 10, 5, true);
  assert.equal(back.start, 3.25);
});

test("beat markers follow speed, trim and reverse without losing trimmed markers", () => {
  const c = { gain: 0, beats: [0, 4, 8], beatMode: 1, bpm: 60 };
  assert.deepEqual(beatMarks(c, 9), [0, 4, 8]);
  retime(c, 9, 2);
  assert.equal(c.bpm, 120);
  assert.deepEqual(beatMarks(c, 4.5), [0, 2, 4]);
  trimSource(c, 1, 4.5, 4.5, 20, false);
  assert.deepEqual(beatMarks(c, 3.5), [1, 3]);
  reverseBeats(c, 3.5);
  assert.deepEqual(beatMarks(c, 3.5), [0.5, 2.5]);
  reverseBeats(c, 3.5);
  assert.deepEqual(beatMarks(c, 3.5), [1, 3]);
});
