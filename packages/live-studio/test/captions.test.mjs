import assert from "node:assert/strict";
import { test } from "node:test";

import { cues, srt } from "../src/captions.mjs";

// A voice line as voice_map.json holds it: words with their own seconds
const line = (text, s, step = 0.3) => {
  const words = text
    .split(" ")
    .map((w, i) => ({ w, s: s + i * step, e: s + i * step + step * 0.8 }));
  return { s: words[0].s, e: words.at(-1).e, text, words };
};

test("a sentence is a caption of its own, on screen from its first word to its last", () => {
  const c = cues([
    line("He opens his eyes.", 4, 0.5),
    line("Bare concrete on every side.", 8, 0.5),
  ]);
  assert.deepEqual(
    c.map((x) => x.text),
    ["He opens his eyes.", "Bare concrete on every side."],
  );
  assert.equal(c[0].s, 4);
  assert.equal(c[0].e, 4 + 3 * 0.5 + 0.4);
});

test("a long sentence is cut into captions of at most two lines of 42 characters, the lines split near the middle", () => {
  const long =
    "The door has no handle on this side and the only light comes from a small screen bolted to the desk beside the bed.";
  const c = cues([line(long, 0, 0.25)]);
  assert.ok(c.length > 1);
  assert.equal(c.map((x) => x.text.replace("\n", " ")).join(" "), long);
  for (const x of c) {
    const rows = x.text.split("\n");
    assert.ok(rows.length <= 2 && rows.every((r) => r.length <= 42), x.text);
    if (rows.length === 2) assert.ok(Math.abs(rows[0].length - rows[1].length) <= 12, x.text);
  }
});

test("two lines break after a comma, never between 'the' or 'of' and the words they lead", () => {
  assert.equal(
    cues([line("Bolted to the floor, a steel desk, a black screen, one chair.", 0, 0.2)])[0].text,
    "Bolted to the floor, a steel desk,\na black screen, one chair.",
  );
  assert.equal(
    cues([line("and at the far end of the room a heavy steel door.", 0, 0.2)])[0].text,
    "and at the far end\nof the room a heavy steel door.",
  );
});

test("no caption stays up past 7 s, even when its words are slow", () => {
  const c = cues([line("one two three four five six seven", 0, 1.5)]);
  assert.ok(c.length > 1);
  for (const x of c) assert.ok(x.e - x.s <= 7, `${x.s} ${x.e}`);
});

test("a short caption stays 5/6 s to be read, but leaves two frames before the next", () => {
  const c = cues([line("Yes.", 1, 0.2), line("No.", 1.5, 0.2)]);
  assert.equal(c[0].e, 1.5 - 2 / 30);
  const d = cues([line("Yes.", 1, 0.2), line("No.", 5, 0.2)]);
  assert.equal(d[0].e, 1 + 5 / 6);
});

test("times go through the voice edit, so captions follow the voice as it is heard", () => {
  const c = cues([line("He opens his eyes.", 4, 0.5)], (s) => s + 10);
  assert.equal(c[0].s, 14);
});

test("SubRip: numbered from 1, hours and a comma before the milliseconds, a blank line between captions", () => {
  assert.equal(
    srt([
      { s: 3661.5, e: 3662.25, text: "a\nb" },
      { s: 0, e: 1, text: "c" },
    ]),
    "1\n01:01:01,500 --> 01:01:02,250\na\nb\n\n2\n00:00:00,000 --> 00:00:01,000\nc\n",
  );
});
