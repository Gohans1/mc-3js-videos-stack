import { expect, test } from "bun:test";

import * as THREE from "three";

import { clipAt, poseAt, travelled } from "../src/placed-math";

test("poseAt interpolates position, rotation, scale and visibility while supporting a reusable output pose", () => {
  const keys = [
    { t: 1, at: [0, 0, 0], rot: [0, 0, 0], scale: 1, visible: false },
    { t: 3, at: [10, 0, 0], rot: [0, 90, 0], scale: 2, ease: "linear", visible: true },
  ];
  const before = poseAt(keys, 0.5);
  expect(before.visible).toBe(false);
  expect(before.at.toArray()).toEqual([0, 0, 0]);

  const mid = poseAt(keys, 2);
  expect(mid.at.x).toBeCloseTo(5, 6);
  expect(mid.scale).toBeCloseTo(1.5, 6);
  expect(mid.visible).toBe(false);
  // Default calls return independent Vector3/Quaternion instances (safe for pathOf arrays)
  expect(mid.at).not.toBe(before.at);
  expect(mid.q).not.toBe(before.q);

  const end = poseAt(keys, 3);
  expect(end.visible).toBe(true);

  const reuse = { at: new THREE.Vector3(), q: new THREE.Quaternion(), scale: 1, visible: true };
  const r1 = poseAt(keys, 2, reuse);
  expect(r1).toBe(reuse);
  expect(r1.at).toBe(reuse.at);
  expect(r1.at.x).toBeCloseTo(5, 6);
});

test("travelled accumulates completed key spans and partial current span using passed position", () => {
  const keys = [
    { t: 0, at: [0, 0, 0] },
    { t: 2, at: [3, 0, 4], ease: "linear" },
    { t: 4, at: [3, 0, 14], ease: "linear" },
  ];
  expect(travelled(keys, 0)).toBe(0);
  const p = poseAt(keys, 3);
  expect(travelled(keys, 3, p.at)).toBeCloseTo(10, 6);
  expect(travelled(keys, 5)).toBeCloseTo(15, 6);
});

test("clipAt picks the latest keyed clip at or before t or falls back to the object's default clip", () => {
  const obj = {
    clip: "idle",
    rate: 1.2,
    keys: [
      { t: 1, at: [0, 0, 0] },
      { t: 3, at: [1, 0, 0], clip: "walk", rate: 1.5 },
    ],
  };
  expect(clipAt(obj, 2)).toEqual({ clip: "idle", from: 1, rate: 1.2 });
  expect(clipAt(obj, 3.5)).toEqual({ clip: "walk", from: 3, rate: 1.5 });
});
