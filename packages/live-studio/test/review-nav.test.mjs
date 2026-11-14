import { describe, test } from "bun:test";
import assert from "node:assert/strict";

import {
  nextReviewNeighborId,
  pickSnapshotSource,
  replyStaysInList,
  stepReviewPickId,
} from "../app/notes/review-nav.ts";

describe("review-nav", () => {
  test("stepReviewPickId navigates sequentially forward and backward without wrapping", () => {
    const ids = ["a", "b", "c"];
    assert.equal(stepReviewPickId(ids, "a", 1), "b");
    assert.equal(stepReviewPickId(ids, "b", 1), "c");
    assert.equal(stepReviewPickId(ids, "c", 1), null);
    assert.equal(stepReviewPickId(ids, "b", -1), "a");
    assert.equal(stepReviewPickId(ids, "a", -1), null);
  });

  test("stepReviewPickId starts from index 0 when currentId is missing or null", () => {
    const ids = ["a", "b", "c"];
    assert.equal(stepReviewPickId(ids, null, 1), "b");
    assert.equal(stepReviewPickId(ids, "missing", 1), "b");
    assert.equal(stepReviewPickId(ids, null, -1), null);
    assert.equal(stepReviewPickId(["only"], null, 1), null);
    assert.equal(stepReviewPickId([], null, 1), null);
  });

  test("nextReviewNeighborId selects following note, falling back to previous, then null", () => {
    assert.equal(nextReviewNeighborId(["a", "b", "c"], "a"), "b");
    assert.equal(nextReviewNeighborId(["a", "b", "c"], "b"), "c");
    assert.equal(nextReviewNeighborId(["a", "b", "c"], "c"), "b");
    assert.equal(nextReviewNeighborId(["only"], "only"), null);
    assert.equal(nextReviewNeighborId([], "only"), null);
  });

  test("replyStaysInList keeps open notes selected while answered/reopened notes advance", () => {
    assert.equal(replyStaysInList("open"), true);
    assert.equal(replyStaysInList("fix"), false);
    assert.equal(replyStaysInList("ask"), false);
    assert.equal(replyStaysInList("done"), false);
  });

  test("pickSnapshotSource avoids stale final canvas across timestamps and skips unloaded renderers", () => {
    assert.equal(
      pickSnapshotSource({ at: 12, playhead: 12, finalAt: 12, hasFinal: true, hasRender: true }),
      "final",
    );
    assert.equal(
      pickSnapshotSource({ at: 5, playhead: 12, finalAt: 12, hasFinal: true, hasRender: true }),
      "render",
    );
    assert.equal(
      pickSnapshotSource({ at: 12, playhead: 12, finalAt: 4, hasFinal: true, hasRender: true }),
      "render",
    );
    assert.equal(
      pickSnapshotSource({ at: 12, playhead: 12, finalAt: -1, hasFinal: false, hasRender: false }),
      null,
    );
  });

  test("pickSnapshotSource matches final canvas across FPS frame-snapped seek timestamps", () => {
    const snapped = Math.round(26.42 * 30) / 30;
    assert.equal(
      pickSnapshotSource({
        at: 26.42,
        playhead: snapped,
        finalAt: snapped,
        hasFinal: true,
        hasRender: true,
      }),
      "final",
    );
    const nextFrame = Math.round(26.47 * 30) / 30;
    assert.equal(
      pickSnapshotSource({
        at: 26.42,
        playhead: nextFrame,
        finalAt: nextFrame,
        hasFinal: true,
        hasRender: true,
      }),
      "render",
    );
  });
});
