// CapCut's ◁ ◇ ▷ beside a keyed setting (the Object panel's Transform): where the playhead stands among the keys
import assert from "node:assert/strict";
import { test } from "node:test";
import { keyNav } from "../app/keys/keynav.ts";

const HALF = 0.5 / 30;

test("no keys: nothing to jump to, nothing under the playhead", () => {
  assert.deepEqual(keyNav([], 4, HALF), { here: -1, prev: null, next: null });
});

test("between keys the arrows go to the nearest key each side", () => {
  assert.deepEqual(keyNav([1, 3, 8, 12], 5, HALF), { here: -1, prev: 3, next: 8 });
});

test("a key within half a frame of the playhead is the one it is on, and the arrows skip it", () => {
  assert.deepEqual(keyNav([1, 3, 8], 3.01, HALF), { here: 1, prev: 1, next: 8 });
  assert.deepEqual(keyNav([1, 3, 8], 3.02, HALF), { here: -1, prev: 3, next: 8 });
});

test("before the first key and after the last only one arrow has somewhere to go", () => {
  assert.deepEqual(keyNav([2, 6], 0, HALF), { here: -1, prev: null, next: 2 });
  assert.deepEqual(keyNav([2, 6], 9, HALF), { here: -1, prev: 6, next: null });
});

test("keys out of time order still give the nearest ones", () => {
  assert.deepEqual(keyNav([8, 1, 3], 5, HALF), { here: -1, prev: 3, next: 8 });
});
