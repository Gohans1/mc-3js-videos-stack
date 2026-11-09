import assert from "node:assert/strict";
import { test } from "node:test";
import { narrationLines } from "../src/narration.mjs";

const lines = [{ text: "one two three", s: 1, e: 7, words: [{ w: "one", s: 1, e: 2 }, { w: "two", s: 3, e: 4 }, { w: "three", s: 6, e: 7 }] }];

test("narration words follow a moved, trimmed and accelerated audio clip", () => {
  const audio = { narration: "voice", sfx: [{ name: "voice", at: 10, start: 2, length: 2, rate: 2 }] };
  const out = narrationLines(lines, audio, 8);
  assert.deepEqual(out, [{ text: "two", s: 10, e: 12, words: [{ w: "two", s: 10.5, e: 11 }] }]);
  assert.equal(lines[0].words[1].s, 3);
});

test("split and duplicated narration clips retain only their own words; mute affects ducking but not subtitle editing", () => {
  const audio = { narration: "voice", tracks: [{ id: "v", mute: true }], sfx: [
    { name: "voice", at: 0, length: 3, track: "v" },
    { name: "voice", at: 10, start: 3, length: 5, track: "v" },
  ] };
  const out = narrationLines(lines, audio, 8);
  assert.deepEqual(out.map((l) => l.words.map((w) => [w.w, w.s, w.e])), [[["one", 1, 2]], [["two", 10, 11], ["three", 13, 14]]]);
  assert.deepEqual(narrationLines(lines, audio, 8, true), []);
  assert.deepEqual(narrationLines(lines, { ...audio, sfx: [] }, 8), []);
});
