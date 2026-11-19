import { describe, expect, test } from "bun:test";

import { keyRows, nestedTimedArrayPaths } from "../src/contract-keys.ts";

describe("nestedTimedArrayPaths", () => {
  test("detects arrays of non-timed objects containing nested timed key arrays or timed objects", () => {
    const doc = {
      thugs: [
        {
          id: "boss",
          moves: [
            { t: 0, at: [0, 0, 0] },
            { t: 2, at: [3, 0, 0] },
          ],
        },
        { id: "guard", moves: [{ t: 1, at: [1, 0, 0] }] },
      ],
    };
    expect(nestedTimedArrayPaths(doc)).toEqual([["thugs"]]);
    // keyRows behavior stays strictly unchanged
    expect(keyRows(doc)).toEqual([]);

    const withTimedObj = {
      props: [{ id: "cup", drop: { t: 2.5, y: 0 } }],
    };
    expect(nestedTimedArrayPaths(withTimedObj)).toEqual([["props"]]);

    const deeplyNested = {
      cast: {
        extras: [{ name: "waiter", track: { walk: [{ t: 0.5 }] } }],
      },
      doors: [{ id: "front", open: { t: 4 } }],
    };
    expect(nestedTimedArrayPaths(deeplyNested)).toEqual([["cast", "extras"], ["doors"]]);

    // Root-level array of actor objects
    const rootList = [{ id: "boss", moves: [{ t: 0 }] }];
    expect(nestedTimedArrayPaths(rootList)).toEqual([[]]);
  });

  test("ignores valid timed key arrays, shots with nested hits, plain data arrays, and broken key lists", () => {
    const valid = {
      moves: [
        { t: 0, at: [0, 0, 0] },
        { t: 3, at: [2, 0, 1] },
      ],
      drop: { t: 1.5, y: 0 },
      shots: [{ t: 0, hits: [{ t: 0.5, amount: 1 }] }],
      coords: [
        [0, 1, 2],
        [3, 4, 5],
      ],
      labels: [{ id: "a", name: "table", pos: [1, 0, 2] }],
      empty: [],
      brokenKeyList: [{ t: 0 }, { missingT: true }],
    };
    expect(nestedTimedArrayPaths(valid)).toEqual([]);
    expect(keyRows(valid)).toEqual([["moves"], ["drop"], ["shots"]]);
    expect(nestedTimedArrayPaths(null)).toEqual([]);
    expect(nestedTimedArrayPaths(42)).toEqual([]);
  });

  test("handles cyclic object graphs safely without throwing", () => {
    const node = { id: "a" };
    node.self = node;
    expect(nestedTimedArrayPaths({ items: [node] })).toEqual([]);
  });
});
