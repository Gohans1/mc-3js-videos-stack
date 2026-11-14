import { describe, test } from "bun:test";
import assert from "node:assert/strict";

import { chunkRows, tableSpacers } from "../app/components/virtual-utils.ts";

describe("virtual list & table helpers", () => {
  test("chunkRows groups items by column count without dropping tail items", () => {
    assert.deepEqual(chunkRows([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepEqual(chunkRows([1, 2, 3], 0), [[1], [2], [3]]);
    assert.deepEqual(chunkRows([], 3), []);
  });

  test("tableSpacers computes top and bottom spacer heights from virtual items", () => {
    assert.deepEqual(tableSpacers([], 0), { top: 0, bottom: 0 });
    assert.deepEqual(
      tableSpacers(
        [
          { start: 80, end: 120 },
          { start: 120, end: 165 },
        ],
        400,
      ),
      { top: 80, bottom: 235 },
    );
  });
});
