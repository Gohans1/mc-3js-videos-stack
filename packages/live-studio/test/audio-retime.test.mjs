import assert from "node:assert/strict";
import { test } from "node:test";
import { retime, trimSource, sourceTime } from "../app/sound/retime.ts";
import { beatMarks, reverseBeats } from "../app/sound/beat-marks.ts";

test("audio speed retains the same source region and moves fades and volume keys with the sound", () => {
  const c = { start: 3, rate: 2, gain: -8, gainKeys: [{ t: 0, gain: -8 }, { t: 2, gain: -2 }], fadeIn: 1, fadeOut: .5 };
  const length = retime(c, 4, .5);
  assert.equal(length, 16);
  assert.equal(c.start, 3);
  assert.equal(sourceTime(c, length, 10), 8);
  assert.deepEqual(c.gainKeys, [{ t: 0, gain: -8 }, { t: 8, gain: -2 }]);
  assert.equal(c.fadeIn, 4); assert.equal(c.fadeOut, 2);
});

test("trimming or splitting reversed audio retains exactly the samples that were under those timeline seconds", () => {
  for (const reverse of [false, true]) {
    const original = { start: 3, rate: 2, reverse, gain: 0, gainKeys: [{ t: 0, gain: -20 }, { t: 4, gain: 0 }] };
    const left = structuredClone(original), right = structuredClone(original);
    trimSource(left, 0, 2, 4, 20, false);
    trimSource(right, 2, 4, 4, 20, false);
    for (const t of [.1, .5, 1.5]) {
      assert.equal(sourceTime(left, 2, t), sourceTime(original, 4, t));
      assert.equal(sourceTime(right, 2, t), sourceTime(original, 4, t + 2));
    }
    assert.deepEqual(right.gainKeys, [{ t: -2, gain: -20 }, { t: 2, gain: 0 }]);
  }
});

test("looping source trims wrap in source seconds after speed is applied", () => {
  const c = { start: 3, rate: 2, gain: 0 };
  trimSource(c, 2, 10, 10, 5, true);
  assert.equal(c.start, 2);
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
  assert.deepEqual(beatMarks(c, 3.5), [.5, 2.5]);
  reverseBeats(c, 3.5);
  assert.deepEqual(beatMarks(c, 3.5), [1, 3]);
});
