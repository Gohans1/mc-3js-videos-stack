import assert from "node:assert/strict";
import { test } from "node:test";

import { laneLayout, rowAt } from "../app/sound/lane-layout.ts";

test("audio track heights and drop targets follow beat markers during a drag", () => {
  const clip = { track: "music", beats: [0.5] };
  const lanes = {
    beds: [clip],
    sfx: [
      { track: "effect", beats: [0.25] },
      { track: "plain", beats: [] },
    ],
    tracks: [{ id: "plain" }, { id: "music" }, { id: "effect" }, { id: "music" }],
  };
  const before = laneLayout(lanes);
  assert.deepEqual(
    before.rows.map(({ top, height }) => [top, height]),
    [
      [2, 52],
      [54, 62],
      [116, 62],
      [178, 62],
    ],
  );
  assert.equal(before.rowsByTrack.get("music").index, 1);
  assert.deepEqual(
    [0, 53.9, 54, 115.9, 116, 178, 240].map((y) => rowAt(before.rows, y)),
    [0, 0, 1, 1, 2, 3, 4],
  );
  assert.equal(before.bottom, 240);

  clip.track = "plain";
  const after = laneLayout(lanes);
  assert.deepEqual(
    after.rows.map(({ top, height }) => [top, height]),
    [
      [2, 62],
      [64, 52],
      [116, 62],
      [178, 52],
    ],
  );
  assert.equal(rowAt(after.rows, 54), 0);
  assert.equal(rowAt(after.rows, 230), 4);
});
