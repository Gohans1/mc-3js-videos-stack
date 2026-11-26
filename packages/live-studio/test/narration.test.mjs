import assert from "node:assert/strict";
import { test } from "node:test";

import { narrationLines, seenSound } from "../src/narration.ts";

const lines = [
  {
    text: "one two three",
    s: 1,
    e: 7,
    words: [
      { w: "one", s: 1, e: 2 },
      { w: "two", s: 3, e: 4 },
      { w: "three", s: 6, e: 7 },
    ],
  },
];

test("narration words follow a moved, trimmed and accelerated audio clip", () => {
  const audio = {
    narration: "voice",
    sfx: [{ name: "voice", at: 10, start: 2, length: 2, rate: 2 }],
  };
  const out = narrationLines(lines, audio, 8);
  assert.deepEqual(out, [{ text: "two", s: 10, e: 12, words: [{ w: "two", s: 10.5, e: 11 }] }]);
  assert.equal(lines[0].words[1].s, 3);
});

test("split and duplicated narration clips retain only their own words; mute affects ducking but not subtitle editing", () => {
  const audio = {
    narration: "voice",
    tracks: [{ id: "v", mute: true }],
    sfx: [
      { name: "voice", at: 0, length: 3, track: "v" },
      { name: "voice", at: 10, start: 3, length: 5, track: "v" },
    ],
  };
  const out = narrationLines(lines, audio, 8);
  assert.deepEqual(
    out.map((l) => l.words.map((w) => [w.w, w.s, w.e])),
    [
      [["one", 1, 2]],
      [
        ["two", 10, 11],
        ["three", 13, 14],
      ],
    ],
  );
  assert.deepEqual(narrationLines(lines, audio, 8, true), []);
  assert.deepEqual(narrationLines(lines, { ...audio, sfx: [] }, 8), []);
});

test("what of the sound shows in the picture: where the narration clips put the voice and which tracks are muted", () => {
  const audio = {
    narration: "voice",
    voiceGain: -2,
    beds: [{ name: "rain", from: 0, to: 9, gain: -20 }],
    sfx: [
      { name: "voice", at: 1, start: 0.5, gain: -3, track: "v" },
      { name: "door", at: 4, gain: -6 },
    ],
    tracks: [{ id: "v", mute: true, gain: -4 }],
  };
  assert.deepEqual(JSON.parse(JSON.stringify(seenSound(audio))), {
    beds: [],
    narration: "voice",
    sfx: [{ name: "voice", at: 1, start: 0.5, track: "v" }],
    tracks: [{ id: "v", mute: true }],
  });
});

test("narration projection stops at file EOF with explicit length, rate, start and reverse", () => {
  const audio = {
    narration: "voice",
    sfx: [{ name: "voice", at: 10, start: 2, length: 8, rate: 2 }],
  };
  const projected = narrationLines(lines, audio, 5);
  assert.deepEqual(projected, [
    { text: "two", s: 10, e: 11.5, words: [{ w: "two", s: 10.5, e: 11 }] },
  ]);
  assert.deepEqual(
    narrationLines(lines, { ...audio, sfx: [{ ...audio.sfx[0], reverse: true }] }, 5),
    [{ text: "two", s: 10, e: 11.5, words: [{ w: "two", s: 10.5, e: 11 }] }],
  );
  assert.deepEqual(
    narrationLines(lines, { ...audio, sfx: [{ ...audio.sfx[0], start: 5 }] }, 5),
    [],
  );
});

test("narration keeps an explicit span when the source duration is unknown", () => {
  const audio = { narration: "voice", sfx: [{ name: "voice", at: 0, length: 8 }] };
  assert.deepEqual(narrationLines(lines, audio, 0), lines);
});

test("clip-level muted hides narration from audible ducking while keeping subtitle editing", () => {
  const audio = {
    narration: "voice",
    tracks: [{ id: "v" }],
    sfx: [
      { name: "voice", at: 0, length: 3, track: "v", muted: true },
      { name: "voice", at: 10, start: 3, length: 5, track: "v" },
    ],
  };
  assert.equal(narrationLines(lines, audio, 8).length, 2);
  const audible = narrationLines(lines, audio, 8, true);
  assert.equal(audible.length, 1);
  assert.equal(audible[0].s, 10);
  assert.equal(seenSound(audio).sfx[0].muted, true);
});
