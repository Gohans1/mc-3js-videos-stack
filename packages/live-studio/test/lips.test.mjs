import assert from "node:assert/strict";
import { test } from "node:test";

import { mouthCues } from "../src/lips.ts";

const edit = (more = {}) => ({
  takes: [{ id: "hi", by: "steve" }, { id: "told", by: "alex" }, { id: "narrator" }],
  mouth: {
    takes: [
      {
        id: "hi",
        at: 2,
        cues: [
          [0, "X"],
          [0.5, "D"],
          [1, "X"],
        ],
      },
      { id: "told", at: 4, cues: [[0, "C"]] },
      { id: "narrator", at: 6, cues: [[0, "B"]] },
    ],
  },
  voice: { edits: {}, warp: [] },
  ...more,
});

test("a speaker's mouth gets only the takes it speaks, placed where each take sits in the voice", () => {
  assert.deepEqual(mouthCues(edit(), "steve"), [
    [2, "X"],
    [2.5, "D"],
    [3, "X"],
  ]);
  assert.deepEqual(mouthCues(edit(), "alex"), [[4, "C"]]);
  assert.deepEqual(mouthCues(edit(), "narrator"), []);
});

test("the cues follow the audio file and narration clip, while narrative warp leaves the samples fixed", () => {
  const moved = edit({
    voice: {
      edits: {},
      warp: [
        [0, 0],
        [10, 20],
      ],
    },
    audio: {
      narration: "voice",
      sfx: [{ name: "voice", at: 1, start: 0, track: "v" }],
      tracks: [{ id: "v" }],
    },
  });
  // That warp places narrative anchors; these audio samples play at 3, 3.5, 4.
  assert.deepEqual(mouthCues(moved, "steve"), [
    [3, "X"],
    [3.5, "D"],
    [4, "X"],
  ]);
  // the studio puts a fresh list in EDIT on every change, never edits one in place
  moved.audio = { ...moved.audio, tracks: [{ id: "v", mute: true }] };
  assert.deepEqual(mouthCues(moved, "steve"), []);
});

test("a shape repeated where takes meet is said once", () => {
  const twice = edit({
    takes: [
      { id: "hi", by: "steve" },
      { id: "more", by: "steve" },
    ],
    mouth: {
      takes: [
        {
          id: "hi",
          at: 0,
          cues: [
            [0, "C"],
            [1, "X"],
          ],
        },
        {
          id: "more",
          at: 2,
          cues: [
            [0, "X"],
            [0.2, "D"],
            [0.5, "X"],
          ],
        },
      ],
    },
  });
  assert.deepEqual(mouthCues(twice, "steve"), [
    [0, "C"],
    [1, "X"],
    [2.2, "D"],
    [2.5, "X"],
  ]);
});

test("a narration clip trimmed mid-word shuts the mouth where the clip ends", () => {
  const trimmed = edit({
    voice: {
      edits: {},
      warp: [
        [0, 0],
        [10, 20],
      ],
    },
    audio: { narration: "voice", sfx: [{ name: "voice", at: 1, start: 0, length: 2.75 }] },
  });
  assert.deepEqual(mouthCues(trimmed, "steve"), [
    [3, "X"],
    [3.5, "D"],
    [3.75, "X"],
  ]);
});

test("a film without lip sync data gives a shut mouth, not an error", () => {
  assert.deepEqual(mouthCues({}, "steve"), []);
  assert.deepEqual(mouthCues(edit({ mouth: undefined }), "steve"), []);
});
