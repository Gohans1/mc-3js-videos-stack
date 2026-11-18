import { expect, test } from "bun:test";

import { fovOf, mmOf } from "film-kit/lens";
import * as THREE from "three";

import {
  cameraAt,
  cameraKeyOptics,
  onScreenRanges,
  resolveFocusDistance,
  SHAKES,
} from "../src/camera";

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

test("camera anchors resolve for the current draw without caching actor poses across seeks", () => {
  const keys = [
    {
      t: 0,
      p: { target: "Steve.head", offset: [0, 0, 5] },
      l: { target: "Steve.head" },
      wave: 0,
    },
  ];
  const at = (t: number) =>
    cameraAt(t, keys, {
      resolveAnchor: (point) =>
        new THREE.Vector3(t, 1.6, 0).add(new THREE.Vector3().fromArray(point.offset ?? [0, 0, 0])),
    }).base;
  expect(at(3).p.toArray()).toEqual([3, 1.6, 5]);
  expect(at(5).l.toArray()).toEqual([5, 1.6, 0]);
  expect(at(3).p.toArray()).toEqual([3, 1.6, 5]);
});

test("hold and repeated camera positions never drift between their endpoints", () => {
  const key = (t, x) => ({ t, p: [x, 0, 0], l: [x, 0, 4], wave: 0 });
  const keys = [
    key(0, -6),
    key(1, 0),
    key(2, 0),
    { ...key(3, 6), motion: "hold", ease: [0.2, 2, 0.8, 2] },
  ];
  expect(cameraAt(1.5, keys).base.p.x).toBe(0);
  expect(cameraAt(2.75, keys).base.p.x).toBe(0);
  expect(cameraAt(3, keys).base.p.x).toBe(6);
});

test("arc-length camera timing stays monotone and still passes through each key", () => {
  const key = (t, x, z) => ({ t, p: [x, 0, z], l: [0, 1, 4], wave: 0, bob: 1, ease: "linear" });
  const keys = [key(0, 0, 0), key(1, 2, 0), key(4, 3, 4)];
  const first = cameraAt(0.25, keys).distance;
  const half = cameraAt(0.5, keys).distance;
  const boundary = cameraAt(1, keys);
  const decelerating = keys.map((k, i) => (i === 2 ? { ...k, ease: "out" } : k));
  expect(half).toBeCloseTo(first * 2, 5);
  expect(boundary.base.p.toArray()).toEqual([2, 0, 0]);
  expect(cameraAt(3.9, decelerating).distance).toBeGreaterThan(cameraAt(3, decelerating).distance);
  const earlier = cameraAt(2, decelerating).p.toArray();
  cameraAt(3.8, decelerating);
  expect(cameraAt(2, decelerating).p.toArray()).toEqual(earlier);
});

test("camera orbit turns their view around the pivot at constant radius", () => {
  const keys = [
    { t: 0, p: [4, 0, 0], l: [0, 0, 0], wave: 0 },
    { t: 2, p: [0, 0, 4], l: [0, 0, 0], wave: 0, motion: "orbit", ease: "linear" },
  ];
  const pose = cameraAt(1, keys).base;
  expect(pose.p.length()).toBeCloseTo(4, 6);
  expect(pose.p.x).toBeCloseTo(Math.sqrt(8), 5);
  expect(pose.p.z).toBeCloseTo(Math.sqrt(8), 5);
});

test("a sampled camera key keeps authored optics while excluding procedural movement", () => {
  const keys = [
    {
      t: 0,
      p: [0, 1, 5],
      l: [0, 1, 0],
      mm: 35,
      fstop: 0,
      focus: 2,
      handheld: "THE_CLOSEUP",
      roll: 0,
      wave: 1,
      bob: 0.2,
    },
    {
      t: 2,
      p: [1, 1, 5],
      l: [0, 1, 0],
      mm: 85,
      fstop: 2,
      focus: 6,
      handheld: "HANDYCAM_RUN",
      roll: 0.2,
      wave: 0.5,
      bob: 0.8,
      ease: "linear",
    },
  ];
  const frame = cameraAt(1, keys);
  const keyframe = frame.sample;
  expect(keyframe.p).toEqual(frame.base.p.toArray());
  expect(keyframe.l).toEqual(frame.base.l.toArray());
  expect(keyframe.mm).toBeCloseTo(frame.mm, 6);
  expect(keyframe.fstop).toBeCloseTo(4, 6);
  expect(keyframe.roll).toBeCloseTo(0.1, 6);
  expect(keyframe.wave).toBeCloseTo(0.75, 6);
  expect(keyframe.bob).toBeCloseTo(0.5, 6);
  expect(keyframe.handheld.mix.map(({ kind, amount }) => [kind, amount])).toEqual([
    ["THE_CLOSEUP", 0.5],
    ["HANDYCAM_RUN", 0.5],
  ]);
});

test("nearby handheld strengths produce independent poses regardless of cache order", () => {
  const at = (amount: number) =>
    cameraAt(1.34, [
      {
        t: 0,
        p: [0, 0, 5],
        l: [0, 0, 0],
        wave: 0,
        handheld: { kind: "THE_CLOSEUP", amount, move: 0.8275, speed: 1.43, offset: 0.331 },
      },
    ]).p.toArray();
  const low = at(0.41121);
  const high = at(0.41123);
  expect(low).not.toEqual(high);
  expect(at(0.41121)).toEqual(low);
});

test("orbit never crosses its pivot for antipodal camera keys on the depth axis", () => {
  const keys = [
    { t: 0, p: [0, 0, 5], l: [0, 0, 0], wave: 0 },
    { t: 2, p: [0, 0, -5], l: [0, 0, 0], motion: "orbit", ease: "linear", wave: 0 },
  ];
  const { p, l } = cameraAt(1, keys).base;
  expect(p.distanceTo(l)).toBeCloseTo(5, 6);
  expect(p.y).toBeCloseTo(0, 6);
});

test("a moving orbit aims at the pivot used by its position curve", () => {
  const rows = [
    { t: 0, p: [0, 0, 5], l: [0, 0, 0], wave: 0 },
    { t: 2, p: [20, 0, 0], l: [25, 0, 0], motion: "orbit", ease: "linear", wave: 0 },
  ];
  const { p, l } = cameraAt(1, rows).base;
  expect(p.distanceTo(l)).toBeCloseTo(5, 5);
});

test("bob stays idle just before a held section ends", () => {
  const key = (t, x, motion) => ({
    t,
    p: [x, 0, 5],
    l: [0, 0, 0],
    wave: 0,
    bob: 1,
    motion,
    ease: "linear",
  });
  const frame = cameraAt(1.98, [key(0, 0), key(2, 0, "hold"), key(3, 5, "linear")]);
  expect(frame.speed).toBe(0);
  expect(frame.p.toArray()).toEqual(frame.base.p.toArray());
});

test("the authored Anticipate ease backs up along the camera path before moving forward", () => {
  const key = (t, x, ease) => ({ t, p: [x, 0, 5], l: [0, 0, 0], wave: 0, ease });
  const rows = [key(0, 0), key(1, 3), key(2, 6, "anticipate")];
  const backward = cameraAt(1.12, rows);
  expect(backward.base.p.x).toBeLessThan(3);
  expect(backward.distance).toBeGreaterThan(cameraAt(1, rows).distance);
  expect(cameraAt(2, rows).base.p.x).toBe(6);
});

test("camera inspector reads inherited lens, focus and shake from the selected shot", () => {
  const keys = [
    { t: 0, mm: 50, fstop: 2.8, focus: 3, handheld: "THE_CLOSEUP" },
    { t: 1, bob: 0.5 },
    { t: 2, cut: true },
  ];
  expect(cameraKeyOptics(keys, 1)).toMatchObject({ mm: 50, fstop: 2.8, focus: 3, bob: 0.5 });
  expect(cameraKeyOptics(keys, 2)).toMatchObject({ fov: 70, fstop: 0, handheld: false, bob: 0 });
});

test("a world focus point stays on the same surface as the camera moves", () => {
  const focus = { point: [0, 0, -6] as const };
  const resolve = () => null;
  expect(resolveFocusDistance(focus, new THREE.Vector3(0, 0, -2), resolve).distance).toBe(4);
  expect(resolveFocusDistance(focus, new THREE.Vector3(0, 0, -4), resolve).distance).toBe(2);
});

test("camera channels can ease position and focal angle independently", () => {
  const src = [
    { t: 0, p: [0, 0, 0], l: [0, 0, -3], fov: 40, wave: 0 },
    {
      t: 1,
      p: [4, 0, 0],
      l: [4, 0, -3],
      fov: 60,
      wave: 0,
      ease: "linear",
      easeChannels: { lens: [0.42, 0, 1, 1] },
    },
  ];
  const shot = cameraAt(0.25, src);
  expect(shot.base.p.x).toBeCloseTo(1, 4);
  expect(shot.fov).toBeLessThan(43);
});

test("reversed Hold jumps after its first key without changing either endpoint", () => {
  const keys = [
    { t: 0, p: [5, 0, 4], l: [5, 0, 0], fstop: 8, wave: 0 },
    { t: 2, p: [1, 0, 4], l: [1, 0, 0], fstop: 2, motion: "hold", reversePath: true, wave: 0 },
  ];
  expect(cameraAt(0, keys).sample.p[0]).toBe(5);
  expect(cameraAt(1, keys).sample.p[0]).toBe(1);
  expect(cameraAt(1, keys).sample.l[0]).toBe(1);
  expect(cameraAt(1, keys).sample.fstop).toBe(2);
  expect(cameraAt(1, keys).speed).toBe(0);
  expect(cameraAt(2, keys).sample.p[0]).toBe(1);
});

test("reversed antipodal orbit travels back along the same hemisphere", () => {
  const keys = [
    { t: 0, p: [0, 2, -5], l: [0, 2, 0], wave: 0 },
    { t: 2, p: [0, 2, 5], l: [0, 2, 0], wave: 0, motion: "orbit" },
  ];
  const reversed = [
    { ...keys[1], t: 0 },
    { ...keys[0], t: 2, motion: "orbit", reversePath: true },
  ];
  expect(cameraAt(0.6, reversed).base.p.distanceTo(cameraAt(1.4, keys).base.p)).toBeLessThan(1e-6);
});
