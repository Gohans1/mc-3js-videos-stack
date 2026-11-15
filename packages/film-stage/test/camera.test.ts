import { expect, test } from "bun:test";

import { fovOf, mmOf } from "film-kit/lens";
import * as THREE from "three";

import { cameraAt, onScreenRanges, resolveFocusDistance, SHAKES } from "../src/camera";

test("camera module re-exports SHAKES from film-kit cleanly", () => {
  expect(SHAKES.length).toBeGreaterThanOrEqual(9);
  expect(SHAKES).toContain("THE_CLOSEUP");
});

test("mm computes aspect-aware vertical fov while preserving legacy explicit fov", () => {
  const wide = cameraAt(0, [{ t: 0, p: [0, 0, 5], l: [0, 0, 0], mm: 50 }], { aspect: 16 / 9 });
  const tall = cameraAt(0, [{ t: 0, p: [0, 0, 5], l: [0, 0, 0], mm: 50 }], { aspect: 9 / 16 });
  expect(wide.fov).toBeCloseTo(fovOf(50, 16 / 9), 5);
  expect(tall.fov).toBeCloseTo(fovOf(50, 9 / 16), 5);
  expect(wide.mm).toBeCloseTo(50, 5);
  expect(tall.mm).toBeCloseTo(50, 5);
  expect(tall.fov).toBeGreaterThan(wide.fov);

  const legacy = cameraAt(0, [{ t: 0, p: [0, 0, 5], l: [0, 0, 0], fov: 60 }], { aspect: 16 / 9 });
  expect(legacy.fov).toBe(60);
  expect(legacy.mm).toBeCloseTo(mmOf(60, 16 / 9), 5);
});

test("fov interpolates logarithmically (lmix) and respects keyframe ease curves", () => {
  const linearKeys = [
    { t: 0, p: [0, 0, 5], l: [0, 0, 0], mm: 24, ease: "linear" },
    { t: 2, p: [0, 0, 5], l: [0, 0, 0], mm: 96, ease: "linear" },
  ];
  const f0 = fovOf(24, 16 / 9);
  const f1 = fovOf(96, 16 / 9);
  const mid = cameraAt(1, linearKeys, { aspect: 16 / 9 });
  expect(mid.fov).toBeCloseTo(Math.sqrt(f0 * f1), 5);
  expect(mid.fov).not.toBeCloseTo((f0 + f1) / 2, 1);

  const snapKeys = [
    { t: 0, p: [0, 0, 5], l: [0, 0, 0], mm: 24 },
    { t: 2, p: [0, 0, 5], l: [0, 0, 0], mm: 96, ease: "snapOut" },
  ];
  const snapEarly = cameraAt(0.5, snapKeys, { aspect: 16 / 9 });
  const linEarly = cameraAt(0.5, linearKeys, { aspect: 16 / 9 });
  expect(snapEarly.fov).toBeLessThan(linEarly.fov);
});

test("mm, fstop, and focus carry forward within a segment and reset on cut: true", () => {
  const keys = [
    { t: 0, p: [0, 1, 5], l: [0, 1, 0], mm: 85, fstop: 2.0, focus: "Steve.head" },
    { t: 2, p: [1, 1, 5], l: [0, 1, 0] },
    { t: 2.1, cut: true, p: [0, 2, 8], l: [0, 1, 0] },
  ];
  const mid = cameraAt(1, keys, { aspect: 16 / 9 });
  expect(mid.mm).toBeCloseTo(85, 5);
  expect(mid.fstop).toBeCloseTo(2.0, 5);
  expect(mid.focus).toBe("Steve.head");

  const afterCut = cameraAt(2.1, keys, { aspect: 16 / 9 });
  expect(afterCut.fov).toBe(70);
  expect(afterCut.fstop).toBe(0);
  expect(afterCut.focus).toBeUndefined();
});

test("fstop fade-in from 0 interpolates aperture (1/fstop) instead of passing through f/0.1", () => {
  const keys = [
    { t: 0, p: [0, 0, 5], l: [0, 0, 0], fstop: 0 },
    { t: 2, p: [0, 0, 5], l: [0, 0, 0], fstop: 2.0, ease: "linear" },
  ];
  const mid = cameraAt(1, keys);
  expect(mid.fstop).toBeCloseTo(4.0, 3);
  expect(cameraAt(0, keys).fstop).toBe(0);
  expect(cameraAt(2, keys).fstop).toBeCloseTo(2.0, 5);
});

test("handheld accepts case-insensitive Shakify names and keeps cam.base free of wobble", () => {
  const keys = [{ t: 0, p: [0, 1.5, 6], l: [0, 1.5, 0], wave: 0, bob: 0, handheld: "the_closeup" }];
  const a = cameraAt(0.5, keys);
  const b = cameraAt(1.7, keys);
  expect(a.handheld).toBe("THE_CLOSEUP");
  expect(a.base.p.toArray()).toEqual([0, 1.5, 6]);
  expect(b.base.p.toArray()).toEqual([0, 1.5, 6]);
  expect(a.p.distanceTo(a.base.p)).toBeGreaterThan(1e-4);
  expect(a.p.distanceTo(b.p)).toBeGreaterThan(1e-4);
  // Pure function of t
  expect(cameraAt(0.5, keys).p.toArray()).toEqual(a.p.toArray());

  const zeroed = cameraAt(0.5, [
    {
      t: 0,
      p: [0, 1.5, 6],
      l: [0, 1.5, 0],
      wave: 0,
      bob: 0,
      handheld: { kind: "the_closeup", amount: 0 },
    },
  ]);
  expect(zeroed.handheld).toBeUndefined();
  expect(zeroed.p.distanceTo(zeroed.base.p)).toBe(0);

  const viaPreset = cameraAt(0.5, [
    {
      t: 0,
      p: [0, 1.5, 6],
      l: [0, 1.5, 0],
      wave: 0,
      bob: 0,
      handheld: { preset: "the_closeup", amount: 0.7 },
    },
  ]);
  expect(viaPreset.handheld).toBe("THE_CLOSEUP");
  expect(viaPreset.p.distanceTo(viaPreset.base.p)).toBeGreaterThan(1e-4);

  for (const offVal of ["off", "none", { preset: "none" }]) {
    const offCam = cameraAt(0.5, [
      { t: 0, p: [0, 1.5, 6], l: [0, 1.5, 0], wave: 0, bob: 0, handheld: offVal },
    ]);
    expect(offCam.handheld).toBeUndefined();
    expect(offCam.p.distanceTo(offCam.base.p)).toBe(0);
  }
});

test("resolveFocusDistance handles meters, dot-targets, offsets, missing targets, and rack-focus pulls", () => {
  const camPos = new THREE.Vector3(0, 0, 10);
  const targets: Record<string, THREE.Vector3> = {
    "Steve.head": new THREE.Vector3(0, 1.6, 4),
    Near: new THREE.Vector3(0, 0, 6),
    Far: new THREE.Vector3(0, 0, 0),
  };
  const lookup = (name: string) => targets[name]?.clone() ?? null;

  expect(resolveFocusDistance(4.2, camPos, lookup)).toEqual({ distance: 4.2, label: "4.2m" });

  const steve = resolveFocusDistance("Steve.head", camPos, lookup);
  expect(steve.distance).toBeCloseTo(Math.hypot(1.6, 6), 5);
  expect(steve.label).toBe("Steve.head");

  const offset = resolveFocusDistance({ target: "Near", offset: [0, 0, -2] }, camPos, lookup);
  expect(offset.distance).toBeCloseTo(6, 5);
  expect(offset.label).toBe("Near");

  expect(resolveFocusDistance("Missing", camPos, lookup)).toEqual({});

  const keys = [
    { t: 0, p: [0, 0, 10], l: [0, 0, 0], focus: "Near" },
    { t: 2, p: [0, 0, 10], l: [0, 0, 0], focus: "Far", ease: "linear" },
  ];
  const rackMid = resolveFocusDistance(cameraAt(1, keys).focus, camPos, lookup);
  expect(rackMid.distance).toBeCloseTo(7, 5);
  expect(rackMid.label).toBe("Near->Far");

  // Caller reusing a single mutable scratch Vector3 across targets must not break rack-focus interpolation
  const scratch = new THREE.Vector3();
  const sharedLookup = (name: string) => {
    const v = targets[name];
    return v ? scratch.copy(v) : null;
  };
  const sharedRack = resolveFocusDistance(
    cameraAt(0.5, [
      { t: 0, p: [0, 0, 10], l: [0, 0, 0], focus: "Near" },
      { t: 2, p: [0, 0, 10], l: [0, 0, 0], focus: "Far", ease: "linear" },
    ]).focus,
    camPos,
    sharedLookup,
  );
  expect(sharedRack.distance).toBeCloseTo(5.5, 5);
  expect(sharedRack.label).toBe("Near->Far");
});

test("onScreenRanges respects mm lens sizing via aspect", () => {
  const box = new THREE.Box3(new THREE.Vector3(2.8, -0.5, -0.5), new THREE.Vector3(3.2, 0.5, 0.5));
  // At 5m away, x=3m is inside 24mm wide view (~73.7deg HFOV) but outside 85mm telephoto view (~23.9deg HFOV)
  const wide = onScreenRanges(box, [{ t: 0, p: [0, 0, 5], l: [0, 0, 0], mm: 24 }], 1, 16 / 9);
  const tele = onScreenRanges(box, [{ t: 0, p: [0, 0, 5], l: [0, 0, 0], mm: 85 }], 1, 16 / 9);
  expect(wide.length).toBe(1);
  expect(tele.length).toBe(0);
});

test("mm takes precedence over fov on the same key while later fov-only keys still override carried mm", () => {
  const mixed = [
    { t: 0, p: [0, 1, 5], l: [0, 1, 0], mm: 85, fov: 60 },
    { t: 2, p: [0, 1, 5], l: [0, 1, 0], fov: 30 },
  ];
  const atZero = cameraAt(0, mixed, { aspect: 16 / 9 });
  expect(atZero.fov).toBeCloseTo(fovOf(85, 16 / 9), 5);
  const atTwo = cameraAt(2, mixed, { aspect: 16 / 9 });
  expect(atTwo.fov).toBeCloseTo(30, 5);
});

test("coincident timestamps never produce NaN and handheld speed changes crossfade smoothly across u=0.5", () => {
  const dupeKeys = [
    { t: 0, p: [0, 1, 5], l: [0, 1, 0], mm: 35 },
    { t: 2, p: [1, 1, 5], l: [0, 1, 0], mm: 50 },
    { t: 2, p: [2, 1, 5], l: [0, 1, 0], mm: 85 },
    { t: 4, p: [4, 1, 5], l: [0, 1, 0], mm: 50 },
  ];
  for (const t of [0, 1, 2, 2.001, 3, 4]) {
    const out = cameraAt(t, dupeKeys, { aspect: 16 / 9 });
    expect(out.p.toArray().every(Number.isFinite)).toBe(true);
    expect(out.l.toArray().every(Number.isFinite)).toBe(true);
    expect(Number.isFinite(out.fov)).toBe(true);
    expect(Number.isFinite(out.roll)).toBe(true);
  }

  const speedKeys = [
    {
      t: 0,
      p: [0, 1.5, 6],
      l: [0, 1.5, 0],
      wave: 0,
      bob: 0,
      handheld: { kind: "the_closeup", amount: 0.8, speed: 0.5, offset: 0 },
    },
    {
      t: 2,
      p: [0, 1.5, 6],
      l: [0, 1.5, 0],
      wave: 0,
      bob: 0,
      handheld: { kind: "the_closeup", amount: 0.8, speed: 2.3, offset: 1.7 },
      ease: "linear",
    },
  ];
  const beforeHalf = cameraAt(0.99, speedKeys);
  const atHalf = cameraAt(1.0, speedKeys);
  const afterHalf = cameraAt(1.01, speedKeys);
  expect(beforeHalf.p.distanceTo(atHalf.p)).toBeLessThan(0.02);
  expect(atHalf.p.distanceTo(afterHalf.p)).toBeLessThan(0.02);
  expect(Math.abs(afterHalf.roll - atHalf.roll)).toBeLessThan(0.02);
});
