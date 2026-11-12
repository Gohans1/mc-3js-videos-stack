// A bed's ducking under the narration as the page plays it (app/sound/duck.ts) must match the film's mix (scripts/sound/mix.py
// duck_expr). The mix's levels were measured with ffmpeg on a 220 Hz sine ducked 12 dB under sealed-room's first four lines:
// -24 dB at rest, -36 dB from each line's first word to its last, ramps of 0.3 s before and 0.8 s after
import assert from "node:assert/strict";
import { test } from "node:test";

import { ATTACK, duckCorners, duckGain, duckWindows, RELEASE } from "../app/sound/duck.ts";

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);
const db = (x) => 20 * Math.log10(x);

test("pauses shorter than attack plus release stay ducked; longer ones come back up", () => {
  assert.deepEqual(
    duckWindows([
      [5, 6],
      [1, 2],
      [2.5, 3],
    ]),
    [
      [1, 3],
      [5, 6],
    ],
  );
  assert.deepEqual(
    duckWindows([
      [0, 1],
      [1 + ATTACK + RELEASE, 3],
    ]),
    [
      [0, 1],
      [2.1, 3],
    ],
  );
});

test("full level away from speech, the whole duck from the first word to the last, straight ramps between", () => {
  const w = duckWindows([
    [4.3, 5.155],
    [9.2, 11.065],
  ]);
  near(duckGain(3, w, 12), 1);
  near(db(duckGain(4.3, w, 12)), -12);
  near(db(duckGain(5.155, w, 12)), -12);
  near(duckGain(4.3 - ATTACK / 2, w, 12), 1 - (1 - 10 ** (-12 / 20)) / 2);
  near(duckGain(5.155 + RELEASE / 4, w, 12), 1 - (1 - 10 ** (-12 / 20)) * 0.75);
  near(duckGain(5.155 + RELEASE, w, 12), 1);
  near(duckGain(7, w, 12), 1);
});

test("the corners inside a clip are where the ramps bend", () => {
  const w = duckWindows([
    [4.3, 5.155],
    [9.2, 11.065],
  ]);
  assert.deepEqual(
    duckCorners(4, 10, w).map((t) => +t.toFixed(3)),
    [4.3, 5.155, 5.955, 8.9, 9.2],
  );
});
