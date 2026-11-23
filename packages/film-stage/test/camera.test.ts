import { expect, test } from "bun:test";

import { fovOf, mmOf } from "film-kit/lens";
import * as THREE from "three";

import {
  applyCameraFeel,
  cameraAt,
  cameraKeyOptics,
  cameraMotionSpans,
  EASES,
  inView,
  onScreenRanges,
  resolveFocusDistance,
  SHAKES,
} from "../src/camera";
import { matchedSpanEase } from "../src/camera-pace";

test("a matched camera key carries motion through different easing and span lengths", () => {
  const track = [
    { t: 0, p: [0, 0, 5], l: [0, 0, 0], wave: 0 },
    { t: 1, p: [10, 0, 5], l: [3, 0, 0], wave: 0, motion: "linear", ease: "linear" },
    {
      t: 3,
      p: [28, 0, 5],
      l: [12, 0, 0],
      wave: 0,
      ease: "smooth",
      easeChannels: { aim: [0.48, 0.04, 0.7, 0.96] },
    },
    { t: 4, p: [34, 0, 5], l: [16, 0, 0], wave: 0, ease: "snapOut" },
  ];
  const matched = track.map((key, i) => (i === 1 ? { ...key, matchSpeed: true } : key));
  const sample = (t: number) => cameraAt(t, matched).base;
  const dt = 0.0001;
  const before = sample(1 - dt),
    at = sample(1),
    after = sample(1 + dt);
  for (const field of ["p", "l"] as const) {
    const arriving = at[field].clone().sub(before[field]).divideScalar(dt);
    const leaving = after[field].clone().sub(at[field]).divideScalar(dt);
    expect(arriving.length()).toBeGreaterThan(1);
    expect(arriving.distanceTo(leaving)).toBeLessThan(0.02);
    expect(sample(0)[field].toArray()).toEqual(track[0][field]);
    expect(at[field].toArray()).toEqual(track[1][field]);
    expect(sample(3)[field].toArray()).toEqual(track[2][field]);
    expect(sample(3.4)[field].toArray()).toEqual(cameraAt(3.4, track).base[field].toArray());

    let prev = -Infinity;
    for (let step = 0; step <= 60; step++) {
      const value = sample((step / 60) * 3)[field].x;
      expect(value).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = value;
    }

    const speedAt = (t: number) => (sample(t + dt)[field].x - sample(t - dt)[field].x) / (2 * dt);
    const accelAt = (t: number) => (speedAt(t + 1e-3) - speedAt(t - 1e-3)) / 2e-3;
    for (const spliceT of [2 / 3, 5 / 3]) {
      expect(Math.abs(accelAt(spliceT + 2e-3) - accelAt(spliceT - 2e-3))).toBeLessThan(0.15);
    }
  }
});

test("matching speed handles steep, zero-slope, and negative-slope eases without non-finite values", () => {
  const dt = 0.0001;
  const eases = [
    ["snapOut", "in"],
    ["out", "snapOut"],
    [[0, 1, 1, 0], "in"],
    ["anticipate", "linear"],
    ["linear", "reverse:anticipate"],
  ] as const;
  for (const [e1, e2] of eases) {
    const keys = [
      { t: 0, p: [0, 0, 5], l: [0, 0, 0], fov: 60, fstop: 8, roll: 0, wave: 0.2 },
      {
        t: 1,
        p: [8, 0, 5],
        l: [2, 0, 0],
        fov: 45,
        fstop: 4,
        roll: 0.2,
        wave: 0.6,
        motion: "linear",
        ease: e1,
        matchSpeed: true,
      },
      {
        t: 3,
        p: [20, 0, 5],
        l: [6, 0, 0],
        fov: 30,
        fstop: 2,
        roll: 0.4,
        wave: 1,
        motion: "linear",
        ease: e2,
      },
    ];
    for (let step = 0; step <= 30; step++) {
      const frame = cameraAt((step / 30) * 3, keys);
      expect(frame.p.toArray().every(Number.isFinite)).toBe(true);
      expect(frame.l.toArray().every(Number.isFinite)).toBe(true);
      expect(Number.isFinite(frame.fov)).toBe(true);
      expect(Number.isFinite(frame.fstop)).toBe(true);
      expect(Number.isFinite(frame.roll)).toBe(true);
      expect(Number.isFinite(frame.speed)).toBe(true);
      expect(Number.isFinite(frame.distance)).toBe(true);
    }
    const before = cameraAt(1 - dt, keys).base.p,
      at = cameraAt(1, keys).base.p,
      after = cameraAt(1 + dt, keys).base.p;
    expect(at.toArray()).toEqual([8, 0, 5]);
    const arriving = at.clone().sub(before).divideScalar(dt);
    const leaving = after.clone().sub(at).divideScalar(dt);
    expect(arriving.length()).toBeGreaterThan(1);
    expect(arriving.distanceTo(leaving)).toBeLessThan(0.05);
    if (e1 === "anticipate") expect(cameraAt(0.05, keys).base.p.x).toBeLessThan(0);
  }
});

test("matching speed eases to a stop at a sharp corner without reshaping the path", () => {
  const keys = [
    { t: 0, p: [0, 0, 5], l: [0, 0, 0], ease: "linear", wave: 0 },
    { t: 1, p: [8, 0, 5], l: [0, 0, 0], ease: "linear", motion: "linear", matchSpeed: true },
    { t: 2, p: [8, 0, 9], l: [0, 0, 0], ease: "linear", motion: "linear" },
  ];
  const at = cameraAt(1, keys).base.p;
  const dt = 0.0001;
  expect(cameraAt(1 - dt, keys).base.p.distanceTo(at) / dt).toBeLessThan(0.02);
  expect(cameraAt(1 + dt, keys).base.p.distanceTo(at) / dt).toBeLessThan(0.02);
  expect(cameraAt(0.9, keys).base.p.z).toBe(5);
  expect(cameraAt(1.1, keys).base.p.x).toBe(8);
});

test("walking bob has no position jump at a matched key", () => {
  const keys = [
    { t: 0, p: [0, 0, 5], l: [0, 0, 0], wave: 0, bob: 1 },
    { t: 1, p: [4, 0, 5], l: [4, 0, 0], wave: 0, bob: 1, ease: "linear", matchSpeed: true },
    { t: 2, p: [8, 0, 5], l: [8, 0, 0], wave: 0, bob: 1, ease: "smooth" },
  ];
  const at = cameraAt(1, keys).p;
  expect(cameraAt(1 - 1e-6, keys).p.distanceTo(at)).toBeLessThan(0.00005);
  expect(cameraAt(1 + 1e-6, keys).p.distanceTo(at)).toBeLessThan(0.00005);
});

test("matching speed aligns curved linear-to-smooth and smooth-to-linear joins without stopping", () => {
  const dt = 0.0001;
  for (const [m1, m2] of [
    ["linear", "smooth"],
    ["smooth", "linear"],
  ] as const) {
    const keys = [
      { t: 0, p: [0, 2, 10], l: [0, 1, 0], wave: 0 },
      { t: 1, p: [5, 2, 5], l: [3, 1, 1], wave: 0, motion: m1, ease: "linear", matchSpeed: true },
      { t: 2, p: [10, 2, 8], l: [7, 1, 0], wave: 0, motion: m2, ease: "smooth" },
    ];
    const before = cameraAt(1 - dt, keys).base,
      at = cameraAt(1, keys).base,
      after = cameraAt(1 + dt, keys).base;
    for (const field of ["p", "l"] as const) {
      const arriving = at[field].clone().sub(before[field]).divideScalar(dt);
      const leaving = after[field].clone().sub(at[field]).divideScalar(dt);
      expect(arriving.length()).toBeGreaterThan(1);
      expect(arriving.distanceTo(leaving)).toBeLessThan(0.03);
    }
  }
  const corner = [
    { t: 0, p: [0, 2, 5], l: [0, 2, 0], wave: 0 },
    {
      t: 1,
      p: [5, 2, 5],
      l: [0, 2, 0],
      wave: 0,
      motion: "linear",
      ease: "linear",
      matchSpeed: true,
    },
    { t: 2, p: [5, 2, 10], l: [0, 2, 0], wave: 0, motion: "smooth", ease: "smooth" },
  ];
  const atCorner = cameraAt(1, corner).base.p;
  expect(cameraAt(1 - dt, corner).base.p.distanceTo(atCorner) / dt).toBeLessThan(0.02);
  expect(cameraAt(1 + dt, corner).base.p.distanceTo(atCorner) / dt).toBeLessThan(0.02);
});

test("matching speed carries velocity through lens, dof, roll, and shake and stops at extrema", () => {
  const dt = 0.0001;
  const monotonic = [
    { t: 0, p: [0, 0, 5], l: [0, 0, 0], fov: 60, roll: 0, fstop: 8, wave: 0.2 },
    {
      t: 1,
      p: [10, 0, 5],
      l: [0, 0, 0],
      fov: 45,
      roll: 0.2,
      fstop: 4,
      wave: 0.6,
      ease: "linear",
      matchSpeed: true,
    },
    { t: 2, p: [20, 0, 5], l: [0, 0, 0], fov: 30, roll: 0.4, fstop: 2, wave: 1.0, ease: "smooth" },
  ];
  const b = cameraAt(1 - dt, monotonic),
    a = cameraAt(1, monotonic),
    c = cameraAt(1 + dt, monotonic);
  const pair = (x: number, y: number, z: number) => [(y - x) / dt, (z - y) / dt] as const;
  for (const [arriving, leaving] of [
    pair(b.fov, a.fov, c.fov),
    pair(b.base.roll, a.base.roll, c.base.roll),
    pair(b.fstop, a.fstop, c.fstop),
    pair(b.sample.wave, a.sample.wave, c.sample.wave),
  ]) {
    expect(Math.abs(arriving)).toBeGreaterThan(0.05);
    expect(Math.abs(arriving - leaving)).toBeLessThan(0.05);
  }

  const extremum = [
    { t: 0, p: [0, 0, 5], l: [0, 0, 0], fov: 60, roll: 0, wave: 0 },
    {
      t: 1,
      p: [10, 0, 5],
      l: [0, 0, 0],
      fov: 45,
      roll: 0.3,
      wave: 0,
      ease: "linear",
      matchSpeed: true,
    },
    { t: 2, p: [20, 0, 5], l: [0, 0, 0], fov: 60, roll: 0, wave: 0, ease: "linear" },
  ];
  const eb = cameraAt(1 - dt, extremum),
    ea = cameraAt(1, extremum),
    ec = cameraAt(1 + dt, extremum);
  expect(Math.abs((ea.fov - eb.fov) / dt)).toBeLessThan(0.05);
  expect(Math.abs((ec.fov - ea.fov) / dt)).toBeLessThan(0.05);
  expect(Math.abs((ea.base.roll - eb.base.roll) / dt)).toBeLessThan(0.01);
  expect(Math.abs((ec.base.roll - ea.base.roll) / dt)).toBeLessThan(0.01);
  for (let u = 0.7; u <= 1.3; u += 0.05) {
    expect(cameraAt(u, extremum).fov).toBeGreaterThanOrEqual(45 - 1e-6);
    expect(cameraAt(u, extremum).base.roll).toBeLessThanOrEqual(0.3 + 1e-6);
  }
});

test("consecutive matched keys and rounded collinear handles carry speed smoothly", () => {
  const dt = 0.0001;
  const chain = [
    { t: 0, p: [0, 0, 5], l: [0, 0, 0], wave: 0 },
    { t: 1, p: [8, 0, 5], l: [2, 0, 0], wave: 0, ease: "linear", matchSpeed: true },
    { t: 2.5, p: [20, 0, 5], l: [6, 0, 0], wave: 0, ease: "smooth", matchSpeed: true },
    { t: 4, p: [30, 0, 5], l: [10, 0, 0], wave: 0, ease: "out" },
  ];
  for (const joinT of [1, 2.5]) {
    const b = cameraAt(joinT - dt, chain).base.p,
      a = cameraAt(joinT, chain).base.p,
      c = cameraAt(joinT + dt, chain).base.p;
    const arriving = a.clone().sub(b).divideScalar(dt);
    const leaving = c.clone().sub(a).divideScalar(dt);
    expect(arriving.length()).toBeGreaterThan(1);
    expect(arriving.distanceTo(leaving)).toBeLessThan(0.03);
  }

  const roundedHandles = [
    { t: 0, p: [0, 0, 5], l: [0, 0, 0], wave: 0 },
    {
      t: 1,
      p: [5, 1, 5],
      l: [0, 0, 0],
      wave: 0,
      ease: "linear",
      matchSpeed: true,
      inHandle: [-0.5, -0.1, 0] as const,
      outHandle: [0.5, 0.101, 0] as const,
    },
    { t: 2, p: [10, 2, 5], l: [0, 0, 0], wave: 0, ease: "smooth" },
  ];
  const rb = cameraAt(1 - dt, roundedHandles).base.p,
    ra = cameraAt(1, roundedHandles).base.p,
    rc = cameraAt(1 + dt, roundedHandles).base.p;
  expect(ra.clone().sub(rb).divideScalar(dt).length()).toBeGreaterThan(1);
  expect(rc.clone().sub(ra).divideScalar(dt).length()).toBeGreaterThan(1);

  const spans = cameraMotionSpans([
    { t: 0, p: [0, 0, 5], l: [0, 0, 0], wave: 0 },
    {
      t: 1,
      p: [10, 0, 5],
      l: [0, 0, 0],
      wave: 0,
      motion: "linear",
      ease: "linear",
      matchSpeed: true,
    },
    { t: 3, p: [28, 0, 5], l: [0, 0, 0], wave: 0, motion: "smooth", ease: "smooth" },
  ]);
  expect(spans).toHaveLength(2);
  const eps = 1e-4;
  const endSpeed =
    ((spans[0].ease(1) - spans[0].ease(1 - eps)) / (eps * (spans[0].to - spans[0].from))) *
    spans[0].length;
  const startSpeed =
    ((spans[1].ease(eps) - spans[1].ease(0)) / (eps * (spans[1].to - spans[1].from))) *
    spans[1].length;
  expect(endSpeed).toBeGreaterThan(1);
  expect(Math.abs(endSpeed - startSpeed)).toBeLessThan(0.02);
});

test("zero, tiny, short, and asymmetric collinear Bézier handles stay smooth or bounded under matchSpeed while corners still brake", () => {
  for (const handle of [
    [0, 0, 0],
    [0.001, 0, 0],
    [0.01, 0, 0],
  ] as const) {
    const keys = [
      { t: 0, p: [0, 0, 5], l: [0, 0, 0], wave: 0 },
      {
        t: 1,
        p: [5, 0, 5],
        l: [0, 0, 0],
        wave: 0,
        motion: "linear",
        ease: "linear",
        matchSpeed: true,
        outHandle: handle,
      },
      { t: 2, p: [10, 0, 5], l: [0, 0, 0], wave: 0, motion: "smooth", ease: "linear" },
    ];
    let maxSpeed = 0;
    for (let step = 1; step <= 200; step++) {
      const t0 = 1 + (step - 1) / 200;
      const t1 = 1 + step / 200;
      const speed = cameraAt(t1, keys).base.p.distanceTo(cameraAt(t0, keys).base.p) / (t1 - t0);
      maxSpeed = Math.max(maxSpeed, speed);
    }
    expect(maxSpeed).toBeGreaterThan(4);
    expect(maxSpeed).toBeLessThan(12);
    const leaveAvg = cameraAt(1.05, keys).base.p.distanceTo(cameraAt(1, keys).base.p) / 0.05;
    expect(Math.abs(leaveAvg - 5)).toBeLessThan(0.5);
  }
  for (const h of [0.2, 0.25, 0.3, 0.4, 0.5]) {
    const keys = [
      { t: 0, p: [0, 0, 5], l: [0, 0, 0], wave: 0 },
      {
        t: 1,
        p: [5, 0, 5],
        l: [0, 0, 0],
        wave: 0,
        motion: "linear",
        ease: "linear",
        matchSpeed: true,
        outHandle: [h, 0, 0] as const,
      },
      { t: 2, p: [10, 0, 5], l: [0, 0, 0], wave: 0, motion: "smooth", ease: "linear" },
    ];
    for (const dt of [1e-4, 1e-3]) {
      const at = cameraAt(1, keys).base.p;
      const arriving = at.distanceTo(cameraAt(1 - dt, keys).base.p) / dt;
      const leaving = cameraAt(1 + dt, keys).base.p.distanceTo(at) / dt;
      expect(arriving).toBeGreaterThan(1);
      expect(Math.abs(arriving - leaving)).toBeLessThan(0.15);
    }
  }
  const asymmetric = [
    { t: 0, p: [0, 0, 5], l: [0, 0, 0], wave: 0 },
    {
      t: 1,
      p: [5, 0, 5],
      l: [0, 0, 0],
      wave: 0,
      motion: "smooth",
      ease: "linear",
      matchSpeed: true,
      inHandle: [-4, 0, 0] as const,
      outHandle: [0.3, 0, 0] as const,
    },
    { t: 2, p: [10, 0, 5], l: [0, 0, 0], wave: 0, motion: "smooth", ease: "linear" },
  ];
  for (const dt of [1e-4, 1e-3]) {
    const asymAt = cameraAt(1, asymmetric).base.p;
    const asymArriving = asymAt.distanceTo(cameraAt(1 - dt, asymmetric).base.p) / dt;
    const asymLeaving = cameraAt(1 + dt, asymmetric).base.p.distanceTo(asymAt) / dt;
    expect(asymArriving).toBeGreaterThan(1);
    expect(Math.abs(asymArriving - asymLeaving)).toBeLessThan(0.15);
  }

  const corner = [
    { t: 0, p: [0, 0, 5], l: [0, 0, 0], wave: 0 },
    {
      t: 1,
      p: [5, 0, 5],
      l: [0, 0, 0],
      wave: 0,
      motion: "linear",
      ease: "linear",
      matchSpeed: true,
      outHandle: [0, 0, 0] as const,
    },
    { t: 2, p: [5, 0, 10], l: [0, 0, 0], wave: 0, motion: "smooth", ease: "linear" },
  ];
  const atCorner = cameraAt(1, corner).base.p;
  expect(cameraAt(0.9999, corner).base.p.distanceTo(atCorner) / 0.0001).toBeLessThan(0.02);
  expect(cameraAt(1.0001, corner).base.p.distanceTo(atCorner) / 0.0001).toBeLessThan(0.02);
});

test("matched spans preserve distinct authored ease shapes while keeping exact join speed and monotonicity", () => {
  const dt = 0.0001;
  const singleSpan = (ease: unknown) => [
    { t: 0, p: [0, 0, 5], l: [0, 0, 0], wave: 0 },
    {
      t: 1,
      p: [6, 0, 5],
      l: [0, 0, 0],
      wave: 0,
      motion: "linear",
      ease: "linear",
      matchSpeed: true,
    },
    { t: 3, p: [18, 0, 5], l: [0, 0, 0], wave: 0, motion: "linear", ease },
  ];
  const singleSamples = (["out", "inout", "linear", "expo", "snapOut", "anticipate"] as const).map(
    (ease) => {
      const track = singleSpan(ease);
      const before = cameraAt(1 - dt, track).base.p.x;
      const at = cameraAt(1, track).base.p.x;
      const after = cameraAt(1 + dt, track).base.p.x;
      expect(Math.abs((at - before) / dt - (after - at) / dt)).toBeLessThan(0.03);
      return [
        ease,
        cameraAt(1.5, track).base.p.x,
        cameraAt(2.0, track).base.p.x,
        cameraAt(2.5, track).base.p.x,
      ] as const;
    },
  );
  const byName = Object.fromEntries(singleSamples.map(([name, a, mid, b]) => [name, [a, mid, b]]));
  expect(byName.out[1] - byName.expo[1]).toBeGreaterThan(3);
  expect(byName.out[0] - byName.inout[0]).toBeGreaterThan(1);
  expect(byName.snapOut[0] - byName.out[0]).toBeGreaterThan(1.5);
  expect(Math.abs(byName.linear[1] - byName.inout[1])).toBeGreaterThan(0.4);
  expect(Math.abs(byName.anticipate[1] - byName.linear[1])).toBeGreaterThan(1.5);

  const doubleSpan = (ease: unknown) => [
    { t: 0, p: [0, 0, 5], l: [0, 0, 0], wave: 0 },
    {
      t: 1,
      p: [6, 0, 5],
      l: [0, 0, 0],
      wave: 0,
      motion: "linear",
      ease: "linear",
      matchSpeed: true,
    },
    { t: 3, p: [18, 0, 5], l: [0, 0, 0], wave: 0, motion: "linear", ease, matchSpeed: true },
    { t: 4, p: [24, 0, 5], l: [0, 0, 0], wave: 0, motion: "linear", ease: "linear" },
  ];
  const bezA = doubleSpan([0.9, 0, 0.1, 1]);
  const bezB = doubleSpan([0.1, 0, 0.9, 1]);
  const outMid = doubleSpan("out");
  const expoMid = doubleSpan("expo");
  for (const track of [bezA, bezB, outMid, expoMid]) {
    for (const joinT of [1, 3]) {
      const b = cameraAt(joinT - dt, track).base.p.x;
      const a = cameraAt(joinT, track).base.p.x;
      const c = cameraAt(joinT + dt, track).base.p.x;
      expect(Math.abs((a - b) / dt - (c - a) / dt)).toBeLessThan(0.05);
    }
  }
  expect(Math.abs(cameraAt(1.6, bezB).base.p.x - cameraAt(1.6, bezA).base.p.x)).toBeGreaterThan(
    0.8,
  );
  const midSpeed = (track: typeof bezA) =>
    (cameraAt(2 + dt, track).base.p.x - cameraAt(2 - dt, track).base.p.x) / (2 * dt);
  expect(midSpeed(bezA)).toBeGreaterThan(midSpeed(bezB) * 1.5);
  expect(cameraAt(1.6, outMid).base.p.x - cameraAt(1.6, expoMid).base.p.x).toBeGreaterThan(1.5);

  for (const ease of [EASES.inout, EASES.linear, EASES.out]) {
    const curve = matchedSpanEase(ease, 5, 5);
    expect(curve(0)).toBe(0);
    expect(curve(1)).toBe(1);
    expect(Math.abs((curve(1e-5) - curve(0)) / 1e-5 - 5)).toBeLessThan(0.02);
    expect(Math.abs((curve(1) - curve(1 - 1e-5)) / 1e-5 - 5)).toBeLessThan(0.02);
    let prev = -Infinity;
    for (let step = 0; step <= 200; step++) {
      const val = curve(step / 200);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
      expect(val).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = val;
    }
  }
});

test("cameraMotionSpans reports aim and optics motion channels so pure pan and mixed shots stay continuous", () => {
  const purePan = [
    { t: 0, p: [0, 0, 5], l: [0, 0, 0], wave: 0 },
    {
      t: 1,
      p: [0, 0, 5],
      l: [4, 0, 0],
      wave: 0,
      motion: "linear",
      ease: "linear",
      matchSpeed: true,
    },
    { t: 3, p: [0, 0, 5], l: [12, 0, 0], wave: 0, motion: "linear", ease: "smooth" },
  ];
  const panSpans = cameraMotionSpans(purePan);
  expect(panSpans).toHaveLength(2);
  expect(panSpans.map((s) => s.channel)).toEqual(["aim", "aim"]);
  const eps = 1e-4;
  const panEnd = ((panSpans[0].ease(1) - panSpans[0].ease(1 - eps)) / eps) * panSpans[0].length;
  const panStart = ((panSpans[1].ease(eps) - panSpans[1].ease(0)) / eps / 2) * panSpans[1].length;
  expect(panEnd).toBeGreaterThan(1);
  expect(Math.abs(panEnd - panStart)).toBeLessThan(0.05);

  const mixed = [
    { t: 0, p: [0, 0, 5], l: [0, 0, 0], fov: 60, wave: 0 },
    { t: 1, p: [5, 0, 5], l: [0, 0, 0], fov: 60, wave: 0, ease: "linear" },
    { t: 2, p: [5, 0, 5], l: [4, 0, 0], fov: 60, wave: 0, ease: "linear" },
    { t: 3, p: [5, 0, 5], l: [4, 0, 0], fov: 35, wave: 0, ease: "expo" },
  ];
  const mixedSpans = cameraMotionSpans(mixed);
  expect(mixedSpans.map((s) => s.channel)).toEqual(["position", "aim", "lens"]);
  expect(mixedSpans[0].length).toBeCloseTo(5, 4);
  expect(mixedSpans[1].length).toBeCloseTo(4, 4);
  expect(mixedSpans[2].length).toBeCloseTo(Math.abs(Math.log(35 / 60)), 5);
  expect(mixedSpans[2].ease(0.5)).toBeLessThan(0.2);

  const spanBoundarySpeeds = (spans: ReturnType<typeof cameraMotionSpans>) => ({
    endSpeed:
      ((spans[0].ease(1) - spans[0].ease(1 - eps)) / (eps * (spans[0].to - spans[0].from))) *
      spans[0].length,
    startSpeed:
      ((spans[1].ease(eps) - spans[1].ease(0)) / (eps * (spans[1].to - spans[1].from))) *
      spans[1].length,
  });

  const zoomSpans = cameraMotionSpans([
    { t: 0, p: [0, 0, 5], l: [0, 0, 0], fov: 60, wave: 0 },
    { t: 1, p: [0, 0, 5], l: [0, 0, 0], fov: 45, wave: 0, ease: "linear", matchSpeed: true },
    { t: 3, p: [0, 0, 5], l: [0, 0, 0], fov: 20, wave: 0, ease: "smooth" },
  ]);
  expect(zoomSpans.map((s) => s.channel)).toEqual(["lens", "lens"]);
  expect(zoomSpans[0].length).toBeCloseTo(Math.abs(Math.log(45 / 60)), 5);
  expect(zoomSpans[1].length).toBeCloseTo(Math.abs(Math.log(20 / 45)), 5);
  const zoomJoin = spanBoundarySpeeds(zoomSpans);
  expect(zoomJoin.endSpeed).toBeGreaterThan(0.1);
  expect(Math.abs(zoomJoin.endSpeed - zoomJoin.startSpeed)).toBeLessThan(0.02);

  const rollSpans = cameraMotionSpans([
    { t: 0, p: [0, 0, 5], l: [0, 0, 0], roll: 0, wave: 0 },
    { t: 1, p: [0, 0, 5], l: [0, 0, 0], roll: 0.2, wave: 0, ease: "linear", matchSpeed: true },
    { t: 3, p: [0, 0, 5], l: [0, 0, 0], roll: 0.6, wave: 0, ease: "linear" },
  ]);
  expect(rollSpans.map((s) => s.channel)).toEqual(["roll", "roll"]);
  expect(rollSpans[0].length).toBeCloseTo(0.2, 5);
  expect(rollSpans[1].length).toBeCloseTo(0.4, 5);
  const rollJoin = spanBoundarySpeeds(rollSpans);
  expect(rollJoin.endSpeed).toBeGreaterThan(0.1);
  expect(Math.abs(rollJoin.endSpeed - rollJoin.startSpeed)).toBeLessThan(0.02);

  const dofSpans = cameraMotionSpans([
    { t: 0, p: [0, 0, 5], l: [0, 0, 0], fstop: 8, wave: 0 },
    { t: 1, p: [0, 0, 5], l: [0, 0, 0], fstop: 4, wave: 0, ease: "linear", matchSpeed: true },
    { t: 3, p: [0, 0, 5], l: [0, 0, 0], fstop: 2, wave: 0, ease: "smooth" },
  ]);
  expect(dofSpans.map((s) => s.channel)).toEqual(["dof", "dof"]);
  expect(dofSpans[0].length).toBeCloseTo(0.125, 5);
  expect(dofSpans[1].length).toBeCloseTo(0.25, 5);
  const dofJoin = spanBoundarySpeeds(dofSpans);
  expect(dofJoin.endSpeed).toBeGreaterThan(0.05);
  expect(Math.abs(dofJoin.endSpeed - dofJoin.startSpeed)).toBeLessThan(0.02);

  const shakeSpans = cameraMotionSpans([
    { t: 0, p: [0, 0, 5], l: [0, 0, 0], wave: 0.2 },
    { t: 1, p: [0, 0, 5], l: [0, 0, 0], wave: 0.6, ease: "linear", matchSpeed: true },
    { t: 3, p: [0, 0, 5], l: [0, 0, 0], wave: 1.0, ease: "smooth" },
  ]);
  expect(shakeSpans.map((s) => s.channel)).toEqual(["shake", "shake"]);
  expect(shakeSpans[0].length).toBeCloseTo(0.4, 5);
  expect(shakeSpans[1].length).toBeCloseTo(0.4, 5);
  const shakeJoin = spanBoundarySpeeds(shakeSpans);
  expect(shakeJoin.endSpeed).toBeGreaterThan(0.1);
  expect(Math.abs(shakeJoin.endSpeed - shakeJoin.startSpeed)).toBeLessThan(0.02);
});

test("matchSpeed carries velocity across orbit-to-orbit, varying-radius orbit-to-linear, curved rail, and omitted-ease scalar keys", () => {
  const dt = 0.0001;
  const orbitChain = [
    { t: 0, p: [4, 0, 0], l: [0, 0, 0], wave: 0 },
    {
      t: 1,
      p: [0, 0, 4],
      l: [0, 0, 0],
      wave: 0,
      motion: "orbit",
      ease: "linear",
      matchSpeed: true,
    },
    { t: 3, p: [-4, 0, 0], l: [0, 0, 0], wave: 0, motion: "orbit", ease: "smooth" },
  ];
  const oBefore = cameraAt(1 - dt, orbitChain).base.p,
    oAt = cameraAt(1, orbitChain).base.p,
    oAfter = cameraAt(1 + dt, orbitChain).base.p;
  const oArriving = oAt.clone().sub(oBefore).divideScalar(dt);
  const oLeaving = oAfter.clone().sub(oAt).divideScalar(dt);
  expect(oArriving.length()).toBeGreaterThan(2);
  expect(oArriving.distanceTo(oLeaving)).toBeLessThan(0.05);
  expect(cameraAt(2, orbitChain).base.p.length()).toBeCloseTo(4, 4);

  const probe = [
    { t: 0, p: [0, 0, 5], l: [0, 0, 0], wave: 0 },
    { t: 1, p: [4, 0, 0], l: [2, 0, 0], wave: 0, motion: "orbit", ease: "linear" },
  ];
  const probeEnd = cameraAt(1, probe).base.p;
  const probeDir = probeEnd
    .clone()
    .sub(cameraAt(1 - 1e-5, probe).base.p)
    .normalize();
  const orbitToLinear = [
    probe[0],
    { ...probe[1], matchSpeed: true },
    {
      t: 3,
      p: probeEnd.clone().addScaledVector(probeDir, 10).toArray() as [number, number, number],
      l: [6, 0, 0] as [number, number, number],
      wave: 0,
      motion: "linear",
      ease: "smooth",
    },
  ];
  const olBefore = cameraAt(1 - dt, orbitToLinear).base,
    olAt = cameraAt(1, orbitToLinear).base,
    olAfter = cameraAt(1 + dt, orbitToLinear).base;
  for (const field of ["p", "l"] as const) {
    const arriving = olAt[field].clone().sub(olBefore[field]).divideScalar(dt);
    const leaving = olAfter[field].clone().sub(olAt[field]).divideScalar(dt);
    expect(arriving.length()).toBeGreaterThan(1);
    expect(arriving.distanceTo(leaving)).toBeLessThan(0.05);
  }

  const rail: readonly [number, number, number][] = [
    [0, 0, 5],
    [3, 0, 2],
    [6, 0, 5],
    [9, 0, 2],
  ];
  for (const [u0, u1, u2] of [
    [0, 0.4, 1],
    [1, 0.5, 0],
  ] as const) {
    const railKeys = [
      { t: 0, p: [0, 0, 5], l: [0, 0, 0], railU: u0, wave: 0 },
      { t: 1, p: [0, 0, 5], l: [0, 0, 0], railU: u1, wave: 0, ease: "linear", matchSpeed: true },
      { t: 3, p: [0, 0, 5], l: [0, 0, 0], railU: u2, wave: 0, ease: "smooth" },
    ];
    const railSpans = cameraMotionSpans(railKeys, -Infinity, Infinity, { rail });
    expect(railSpans.map((s) => s.channel)).toEqual(["position", "position"]);
    expect(railSpans[0].length).toBeGreaterThan(1);
    const rBefore = cameraAt(1 - dt, railKeys, { rail }).base.p,
      rAt = cameraAt(1, railKeys, { rail }).base.p,
      rAfter = cameraAt(1 + dt, railKeys, { rail }).base.p;
    const rArriving = rAt.clone().sub(rBefore).divideScalar(dt);
    const rLeaving = rAfter.clone().sub(rAt).divideScalar(dt);
    expect(rArriving.length()).toBeGreaterThan(1);
    expect(rArriving.distanceTo(rLeaving)).toBeLessThan(0.05);
  }

  const omittedEase = [
    { t: 0, p: [0, 0, 5], l: [0, 0, 0], fov: 60, fstop: 8, roll: 0, wave: 0.2 },
    {
      t: 1,
      p: [0, 0, 5],
      l: [0, 0, 0],
      fov: 45,
      fstop: 4,
      roll: 0.2,
      wave: 0.6,
      matchSpeed: true,
    },
    { t: 3, p: [0, 0, 5], l: [0, 0, 0], fov: 25, fstop: 2, roll: 0.6, wave: 1.0 },
  ];
  const sb = cameraAt(1 - dt, omittedEase),
    sa = cameraAt(1, omittedEase),
    sc = cameraAt(1 + dt, omittedEase);
  for (const [x, y, z] of [
    [sb.fov, sa.fov, sc.fov],
    [sb.base.roll, sa.base.roll, sc.base.roll],
    [sb.fstop, sa.fstop, sc.fstop],
    [sb.sample.wave, sa.sample.wave, sc.sample.wave],
  ]) {
    const arriving = (y - x) / dt;
    const leaving = (z - y) / dt;
    expect(Math.abs(arriving)).toBeGreaterThan(0.05);
    expect(Math.abs(arriving - leaving)).toBeLessThan(0.05);
  }
});

test("hold spans on either side of a key ignore matchSpeed", () => {
  const dt = 0.0001;
  const holdIn = [
    { t: 0, p: [0, 0, 5], l: [0, 0, 0], wave: 0 },
    { t: 1, p: [5, 0, 5], l: [0, 0, 0], wave: 0, motion: "hold", matchSpeed: true },
    { t: 2, p: [10, 0, 5], l: [0, 0, 0], wave: 0, motion: "linear", ease: "linear" },
  ];
  expect(cameraAt(1.25, holdIn).base.p.x).toBeCloseTo(6.25, 5);
  expect(cameraAt(1 + dt, holdIn).base.p.distanceTo(cameraAt(1, holdIn).base.p) / dt).toBeCloseTo(
    5,
    1,
  );

  const holdOut = [
    { t: 0, p: [0, 0, 5], l: [0, 0, 0], wave: 0 },
    {
      t: 1,
      p: [5, 0, 5],
      l: [0, 0, 0],
      wave: 0,
      motion: "linear",
      ease: "linear",
      matchSpeed: true,
    },
    { t: 2, p: [10, 0, 5], l: [0, 0, 0], wave: 0, motion: "hold" },
  ];
  expect(cameraAt(0.75, holdOut).base.p.x).toBeCloseTo(3.75, 5);
  expect(cameraAt(1, holdOut).base.p.distanceTo(cameraAt(1 - dt, holdOut).base.p) / dt).toBeCloseTo(
    5,
    1,
  );
});

test("scalar channel matching handles numeric focus, non-numeric rack pulls, handheld ramps, and non-collinear wave/bob", () => {
  const dt = 0.0001;
  const numericFocus = [
    { t: 0, p: [0, 0, 5], l: [0, 0, 0], fstop: 2.8, focus: 2, wave: 0 },
    {
      t: 1,
      p: [0, 0, 5],
      l: [0, 0, 0],
      fstop: 2.8,
      focus: 4,
      wave: 0,
      ease: "linear",
      matchSpeed: true,
    },
    { t: 3, p: [0, 0, 5], l: [0, 0, 0], fstop: 2.8, focus: 12, wave: 0, ease: "inout" },
  ];
  const focusAt = (t: number) =>
    resolveFocusDistance(cameraAt(t, numericFocus).focus, new THREE.Vector3(), () => null)
      .distance!;
  const fArrive = (focusAt(1) - focusAt(1 - dt)) / dt;
  const fLeave = (focusAt(1 + dt) - focusAt(1)) / dt;
  expect(fArrive).toBeGreaterThan(1);
  expect(Math.abs(fArrive - fLeave)).toBeLessThan(0.05);

  const targetRack = [
    { t: 0, p: [0, 0, 10], l: [0, 0, 0], fstop: 2.8, focus: "Near", wave: 0 },
    {
      t: 1,
      p: [0, 0, 10],
      l: [0, 0, 0],
      fstop: 2.8,
      focus: "Mid",
      wave: 0,
      ease: "linear",
      matchSpeed: true,
    },
    { t: 2, p: [0, 0, 10], l: [0, 0, 0], fstop: 2.8, focus: "Far", wave: 0, ease: "linear" },
  ];
  const rackBefore = (cameraAt(1 - dt, targetRack).focus as { u: number }).u;
  const rackAfter = (cameraAt(1 + dt, targetRack).focus as { u: number }).u;
  expect((1 - rackBefore) / dt).toBeCloseTo(1, 2);
  expect(rackAfter / dt).toBeCloseTo(1, 2);

  const shakeCorner = [
    { t: 0, p: [0, 0, 5], l: [0, 0, 0], wave: 0, bob: 0 },
    { t: 1, p: [0, 0, 5], l: [0, 0, 0], wave: 1, bob: 0, ease: "linear", matchSpeed: true },
    { t: 2, p: [0, 0, 5], l: [0, 0, 0], wave: 1, bob: 1, ease: "linear" },
  ];
  expect(
    Math.abs(
      (cameraAt(1, shakeCorner).sample.wave - cameraAt(1 - dt, shakeCorner).sample.wave) / dt,
    ),
  ).toBeLessThan(0.02);
  expect(
    Math.abs((cameraAt(1 + dt, shakeCorner).sample.bob - cameraAt(1, shakeCorner).sample.bob) / dt),
  ).toBeLessThan(0.02);

  const handheldRamp = [
    {
      t: 0,
      p: [0, 0, 5],
      l: [0, 0, 0],
      wave: 0,
      bob: 0,
      handheld: { kind: "THE_CLOSEUP", amount: 0.2 },
    },
    {
      t: 1,
      p: [0, 0, 5],
      l: [0, 0, 0],
      wave: 0,
      bob: 0,
      handheld: { kind: "THE_CLOSEUP", amount: 0.6 },
      ease: "linear",
      matchSpeed: true,
    },
    {
      t: 3,
      p: [0, 0, 5],
      l: [0, 0, 0],
      wave: 0,
      bob: 0,
      handheld: { kind: "THE_CLOSEUP", amount: 1.4 },
      ease: "inout",
    },
  ];
  const hhAmt = (t: number) =>
    (cameraAt(t, handheldRamp).sample.handheld as { amount: number }).amount;
  const hhArrive = (hhAmt(1) - hhAmt(1 - dt)) / dt;
  const hhLeave = (hhAmt(1 + dt) - hhAmt(1)) / dt;
  expect(hhArrive).toBeGreaterThan(0.2);
  expect(Math.abs(hhArrive - hhLeave)).toBeLessThan(0.02);

  const handheldMoveRamp = [
    {
      t: 0,
      p: [0, 0, 5],
      l: [0, 0, 0],
      wave: 0,
      bob: 0,
      handheld: { kind: "THE_CLOSEUP", amount: 0.5, move: 0.1 },
    },
    {
      t: 1,
      p: [0, 0, 5],
      l: [0, 0, 0],
      wave: 0,
      bob: 0,
      handheld: { kind: "THE_CLOSEUP", amount: 0.5, move: 0.5 },
      ease: "linear",
      matchSpeed: true,
    },
    {
      t: 3,
      p: [0, 0, 5],
      l: [0, 0, 0],
      wave: 0,
      bob: 0,
      handheld: { kind: "THE_CLOSEUP", amount: 0.5, move: 1.3 },
      ease: "inout",
    },
  ];
  const hhMove = (t: number) =>
    (cameraAt(t, handheldMoveRamp).sample.handheld as { move: number }).move;
  const hhMoveArrive = (hhMove(1) - hhMove(1 - dt)) / dt;
  const hhMoveLeave = (hhMove(1 + dt) - hhMove(1)) / dt;
  expect(hhMoveArrive).toBeGreaterThan(0.2);
  expect(Math.abs(hhMoveArrive - hhMoveLeave)).toBeLessThan(0.02);
});

test("muted keys skip position and inherited optics while leaving cut anchors", () => {
  const keys = [
    { t: 0, p: [0, 1, 5], l: [0, 1, 0], wave: 0, fov: 60 },
    { t: 1, p: [10, 1, 5], l: [0, 1, 0], muted: true, fov: 25 },
    { t: 2, p: [2, 1, 5], l: [0, 1, 0], motion: "linear", ease: "linear" },
    { t: 3, p: [6, 1, 5], l: [0, 1, 0], muted: true, cut: true, wave: 0, fov: 45 },
  ];
  expect(cameraAt(1, keys).p.x).toBe(1);
  expect(cameraAt(2, keys).fov).toBe(60);
  expect(cameraAt(3, keys).p.x).toBe(6);
  expect(cameraAt(3, keys).fov).toBe(45);
});

test("handheld desync shifts sampling and octaves stay deterministic across seeks", () => {
  const sample = (t: number, desync: number, octaves: number) =>
    cameraAt(t, [
      {
        t: 0,
        p: [0, 1, 5],
        l: [0, 1, 0],
        wave: 0,
        handheld: { kind: "THE_CLOSEUP", desync, octaves },
      },
    ]).l.toArray();
  expect(sample(0.2, 0.3, 1)).toEqual(sample(0.5, 0, 1));
  const first = sample(0.2, 0.3, 3);
  expect(first).not.toEqual(sample(0.2, 0.3, 1));
  sample(0.8, 0.3, 3);
  expect(sample(0.2, 0.3, 3)).toEqual(first);
});

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

test("applyCameraFeel applies wave, bob, and handheld consistently for film and free cameras", () => {
  const baseP = new THREE.Vector3(2, 1.8, 5);
  const baseL = new THREE.Vector3(0, 1.2, 0);

  const zeroP = baseP.clone();
  const zeroL = baseL.clone();
  const zeroOut = applyCameraFeel({
    p: zeroP,
    l: zeroL,
    roll: 0.25,
    t: 1.5,
    wave: 0,
    bob: 0,
    handheld: false,
  });
  expect(zeroP.toArray()).toEqual(baseP.toArray());
  expect(zeroL.toArray()).toEqual(baseL.toArray());
  expect(zeroOut).toMatchObject({ roll: 0.25, handheld: undefined });

  const bobA = baseP.clone();
  const bobB = baseP.clone();
  const resBobA = applyCameraFeel({ p: bobA, l: baseL.clone(), roll: 0, t: 0.5, bob: 1 });
  const resBobB = applyCameraFeel({ p: bobB, l: baseL.clone(), roll: 0, t: 1.1, bob: 1 });
  expect(bobA.distanceTo(baseP)).toBeGreaterThan(1e-4);
  expect(bobA.distanceTo(bobB)).toBeGreaterThan(1e-4);
  expect(Math.abs(resBobA.roll - resBobB.roll)).toBeGreaterThan(1e-5);

  const freeP = baseP.clone();
  const freeL = baseL.clone();
  const hhSpec = { preset: "HANDYCAM_RUN", amount: 1.2, move: 0.8, speed: 1.3, octaves: 2 };
  const freeOut = applyCameraFeel({
    p: freeP,
    l: freeL,
    roll: 0.1,
    t: 1.7,
    wave: 1.5,
    bob: 0,
    handheld: hhSpec,
  });
  const keyed = cameraAt(1.7, [
    {
      t: 0,
      p: baseP.toArray(),
      l: baseL.toArray(),
      roll: 0.1,
      wave: 1.5,
      bob: 0,
      handheld: hhSpec,
    },
    {
      t: 3,
      p: baseP.toArray(),
      l: baseL.toArray(),
      roll: 0.1,
      wave: 1.5,
      bob: 0,
      handheld: hhSpec,
    },
  ]);
  expect(freeOut.handheld).toBe(keyed.handheld);
  expect(freeOut.roll).toBeCloseTo(keyed.roll, 6);
  expect(freeP.distanceTo(keyed.p)).toBeLessThan(1e-6);
  expect(freeL.distanceTo(keyed.l)).toBeLessThan(1e-6);
});

test("inView performs exact convex frustum-AABB intersection for large tele-lens walls and corner misses", () => {
  const cam = new THREE.PerspectiveCamera(15, 16 / 9, 0.5, 50);
  cam.position.set(0, 0, 10);
  cam.lookAt(0, 0, 0);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse),
  );

  const offCenterWall = new THREE.Box3(
    new THREE.Vector3(-10, -10, -5),
    new THREE.Vector3(1000, 1000, -4.5),
  );
  expect(inView(frustum, offCenterWall)).toBe(true);

  const enclosingBox = new THREE.Box3(
    new THREE.Vector3(-100, -100, -100),
    new THREE.Vector3(1000, 1000, 100),
  );
  for (let ix = 0; ix < 2; ix++)
    for (let iy = 0; iy < 2; iy++)
      for (let iz = 0; iz < 2; iz++) {
        expect(
          frustum.containsPoint(
            new THREE.Vector3(
              ix ? enclosingBox.max.x : enclosingBox.min.x,
              iy ? enclosingBox.max.y : enclosingBox.min.y,
              iz ? enclosingBox.max.z : enclosingBox.min.z,
            ),
          ),
        ).toBe(false);
      }
  expect(inView(frustum, enclosingBox)).toBe(true);

  expect(inView(frustum, new THREE.Box3())).toBe(false);

  const behindCamera = new THREE.Box3(new THREE.Vector3(-5, -5, 12), new THREE.Vector3(5, 5, 20));
  expect(inView(frustum, behindCamera)).toBe(false);

  const outsideLeft = new THREE.Box3(new THREE.Vector3(-40, -5, -10), new THREE.Vector3(-12, 5, 5));
  expect(inView(frustum, outsideLeft)).toBe(false);

  const outsideNearCorner = new THREE.Box3(
    new THREE.Vector3(2, 2, 9.6),
    new THREE.Vector3(3, 3, 9.9),
  );
  expect(inView(frustum, outsideNearCorner)).toBe(false);

  const grazingCam = new THREE.PerspectiveCamera(45, 1, 1, 50);
  grazingCam.position.set(0, 0, 0);
  grazingCam.lookAt(1, 0, -1);
  grazingCam.rotateZ(1e-7);
  grazingCam.updateProjectionMatrix();
  grazingCam.updateMatrixWorld();
  const grazingFrustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(
      grazingCam.projectionMatrix,
      grazingCam.matrixWorldInverse,
    ),
  );

  const conservativeFalsePositive = new THREE.Box3(
    new THREE.Vector3(-5, -5, 0),
    new THREE.Vector3(3, 3, 8),
  );
  expect(grazingFrustum.intersectsBox(conservativeFalsePositive)).toBe(true);
  expect(inView(grazingFrustum, conservativeFalsePositive)).toBe(false);

  const p0 = grazingFrustum.planes[0]!;
  const y0 = 12.2;
  const z0 = -10;
  const x0 = -(p0.normal.y * y0 + p0.normal.z * z0 + p0.constant + 5e-7) / p0.normal.x;
  const grazingOutsideBox = new THREE.Box3(
    new THREE.Vector3(x0, y0, z0 - 2),
    new THREE.Vector3(x0 + 6, y0 + 12, z0),
  );
  expect(grazingFrustum.intersectsBox(grazingOutsideBox)).toBe(true);
  expect(inView(grazingFrustum, grazingOutsideBox)).toBe(false);
});
