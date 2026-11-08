// The timeline's magnet (app/core/time.ts snapTo), shared by the sound clips, the camera row and the key rows
import assert from "node:assert/strict";
import { test } from "node:test";
import { FPS, SNAP_PX, snapSpan, snapTo } from "../app/core/time.ts";

const perPx = 0.01; // seconds a pixel: SNAP_PX pixels reach 0.07 s

test("a time dropped near a mark lands on the nearest mark within reach", () => {
  assert.equal(snapTo(2.06, [1, 2, 2.1], perPx, false), 2.1);
  assert.equal(snapTo(2.04, [1, 2, 2.1], perPx, false), 2);
  assert.equal(snapTo(2 + SNAP_PX * perPx - 0.001, [2], perPx, false), 2, "just inside the reach");
});

test("out of reach it stays where the pointer put it, on a whole frame for frame keys", () => {
  assert.equal(snapTo(1.513, [1, 2], perPx, false), 1.513);
  assert.equal(snapTo(1.513, [1, 2], perPx, false, true), 45 / FPS);
});

test("Shift (or the magnet off) keeps the exact time, frame keys too", () => {
  assert.equal(snapTo(2.05, [2.1], perPx, true), 2.05);
  assert.equal(snapTo(1.513, [], perPx, true, true), 1.513);
});

test("the reach is in pixels: zoomed out, the same gap snaps", () => {
  assert.equal(snapTo(2.3, [2], perPx, false), 2.3);
  assert.equal(snapTo(2.3, [2], perPx * 10, false), 2);
});

// A clip carried along the row (snapSpan): whichever of its two ends lands in reach sticks, so it meets the clip beside it
test("a carried clip sticks by its start when only its start is in reach", () => {
  assert.equal(snapSpan(2.04, 1, [2], perPx, false), 2);
});

test("a carried clip sticks by its end when only its end is in reach", () => {
  assert.equal(snapSpan(0.96, 1, [2], perPx, false), 1, "its end lands on 2");
});

test("with both ends in reach, the nearer one sticks", () => {
  assert.equal(snapSpan(2.05, 1, [2, 3.03], perPx, false), 2.03, "the end is 0.02 off, the start 0.05");
  assert.equal(snapSpan(2, 1, [2, 3.03], perPx, false), 2, "a start right on a mark stays on it");
});

test("a carried clip out of reach, or with the magnet off, stays where the pointer put it", () => {
  assert.equal(snapSpan(1.5, 1, [1, 3], perPx, false), 1.5);
  assert.equal(snapSpan(2.04, 1, [2], perPx, true), 2.04);
});
