import assert from "node:assert/strict";
import { test } from "node:test";
import { gainAt, gainPoints, normalizationDelta, offsetGain, shiftGainTime, toggleGainKey, writeGain } from "../app/sound/gain.ts";
import { SoundTimeline } from "../src/contract.mjs";

test("volume automation holds endpoints and interpolates in dB, including a seek inside a ramp", () => {
  const c = { gain: -3, gainKeys: [{ t: 1, gain: -20 }, { t: 3, gain: 0 }, { t: 4, gain: -10 }] };
  assert.deepEqual([0, 1, 2, 3, 4, 9].map((t) => gainAt(c, t)), [-20, -20, -10, 0, -10, -10]);
  assert.deepEqual(gainPoints(c, 2, 3.5), [{ t: 2, gain: -10 }, { t: 3, gain: 0 }, { t: 3.5, gain: -5 }]);
  assert.equal(gainAt({ gain: -3 }, 99), -3);
});

test("trimming and splitting preserve the entire volume curve, including a looping bed beyond its source length", () => {
  const original = { gain: -5, gainKeys: [{ t: 0, gain: -20 }, { t: 8, gain: 0 }, { t: 12, gain: -8 }] };
  const right = structuredClone(original);
  shiftGainTime(right, -7);
  for (const t of [0, .5, 1, 2, 5]) assert.equal(gainAt(right, t), gainAt(original, 7 + t));
  shiftGainTime(right, 7);
  assert.deepEqual(right, original);
});

test("the first diamond enables animation, changing volume adds a key, deleting the last key retains its level", () => {
  const c = { gain: -12 };
  toggleGainKey(c, 1);
  writeGain(c, 3, 0);
  assert.equal(gainAt(c, 2), -6);
  writeGain(c, 3.001, -4);
  assert.equal(c.gainKeys.length, 2);
  toggleGainKey(c, 1);
  toggleGainKey(c, 3);
  assert.deepEqual(c, { gain: -4 });
  writeGain(c, 10, -8);
  assert.deepEqual(c, { gain: -8 });
});

test("audio files reject duplicate or unordered volume keys and non-finite levels", () => {
  const parse = (gainKeys) => SoundTimeline.safeParse({ beds: [], sfx: [{ name: "tap", at: 0, gain: 0, gainKeys }] }).success;
  assert.equal(parse([{ t: -2, gain: -20 }, { t: 3, gain: 0 }]), true);
  for (const keys of [[{ t: 0, gain: Infinity }], [{ t: 0, gain: 0 }, { t: 0, gain: 1 }], [{ t: 2, gain: 0 }, { t: 1, gain: 0 }]]) assert.equal(parse(keys), false);
});

test("normalization reaches the loudness target when headroom permits and caps gain before true-peak clipping", () => {
  assert.equal(normalizationDelta(-24, -14, -20), 10);
  assert.equal(normalizationDelta(-24, -14, -3), 2);
  assert.equal(normalizationDelta(-10, -14, 0), -4);
  assert.equal(normalizationDelta(-Infinity, -14, -Infinity), null);
});

test("normalizing an animated clip preserves the differences between its volume keys", () => {
  const c = { gain: -12, gainKeys: [{ t: -1, gain: -20 }, { t: 3, gain: -6 }] };
  offsetGain(c, 4);
  assert.deepEqual(c, { gain: -8, gainKeys: [{ t: -1, gain: -16 }, { t: 3, gain: -2 }] });
});
