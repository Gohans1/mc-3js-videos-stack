import { describe, test } from "bun:test";
import assert from "node:assert/strict";

import { anyKeyLit, LIT_MS, mergeLitKeys, pruneLitMap } from "../app/activity/lit.ts";

describe("AI note highlight duration and multi-key lookup", () => {
  test("holds highlight well past a brief glance (10-20s) for both cards and folded headers", () => {
    assert.ok(
      LIT_MS >= 10_000 && LIT_MS <= 20_000,
      `Expected LIT_MS in 10-20s range, got ${LIT_MS}`,
    );
  });

  test("mergeLitKeys, pruneLitMap, and anyKeyLit handle renewal, expiry, and aggregate containers", () => {
    const start = mergeLitKeys({}, ["note:n1", "tab:notes"], 1000);
    assert.equal(anyKeyLit(start, ["note:n1"], 1000), true);
    assert.equal(anyKeyLit(start, ["note:n2", "note:n1"], 1000), true);
    assert.equal(anyKeyLit(start, ["note:n2"], 1000), false);
    assert.equal(anyKeyLit(start, [], 1000), false);

    const renewed = mergeLitKeys(start, ["note:n2"], 1000 + LIT_MS - 10);
    assert.equal(renewed["note:n1"], 1000 + LIT_MS);
    assert.equal(renewed["note:n2"], 1000 + 2 * LIT_MS - 10);
    assert.equal(anyKeyLit(renewed, ["note:n1"], 1000 + LIT_MS), false);
    assert.equal(anyKeyLit(renewed, ["note:n2"], 1000 + LIT_MS), true);

    const mid = pruneLitMap(start, 1000 + LIT_MS - 1);
    assert.equal(mid, start);

    const end = pruneLitMap(start, 1000 + LIT_MS);
    assert.deepEqual(end, {});
  });
});
