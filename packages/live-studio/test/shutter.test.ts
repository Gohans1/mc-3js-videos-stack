import { expect, test } from "bun:test";

import { apertureSamples, samplesForTurn, shutterBounds, shutterTimes } from "../src/shutter";

test("centred shutter clips at a cut and distributes the surviving samples evenly", () => {
  const before = shutterTimes(0.995, 30, 4, 0, 1, { angle: 360, timing: "center" });
  const after = shutterTimes(1, 30, 4, 1, 2, { angle: 360, timing: "center" });
  expect(before).toHaveLength(4);
  expect(Math.max(...before)).toBeLessThan(1);
  expect(Math.min(...after)).toBeGreaterThan(1);
  expect(before[1] - before[0]).toBeCloseTo(before[3] - before[2], 9);
  expect(after[1] - after[0]).toBeCloseTo(after[3] - after[2], 9);
  expect(shutterTimes(1, 30, 4, 1, 2, { angle: 0, timing: "close" })).toEqual([1]);
});

test("closing shutter honours phase without sampling outside a shot", () => {
  const samples = shutterTimes(1.25, 30, 4, 1, 2, { angle: 180, timing: "close", phase: -0.25 });
  expect(Math.max(...samples)).toBeLessThan(1.25 - 0.25 / 30);
  expect(Math.min(...samples)).toBeGreaterThan(1.25 - 0.75 / 30);
});

test("aperture samples are deterministic and lie inside the pupil", () => {
  const points = apertureSamples(8);
  expect(points).toEqual(apertureSamples(8));
  expect(new Set(points.map((p) => [p?.x, p?.y].join(","))).size).toBe(8);
  expect(points.every((p) => !!p && Math.hypot(p.x, p.y) < 1)).toBe(true);
  expect(apertureSamples(1)).toEqual([undefined]);
});

test("a whip takes shutter samples until one sample's turn moves the picture 12 px at most, and a slow pan keeps its count", () => {
  const facing = (deg: number) => [
    Math.sin((deg * Math.PI) / 180),
    0,
    -Math.cos((deg * Math.PI) / 180),
  ];
  // 20 degrees a frame through a 180 degree shutter is 10 degrees over 8 samples: 1.25 degrees, 48 px of a 50 degree, 1920 px picture
  expect(samplesForTurn(8, facing(0), facing(1.25), 50, 1920)).toBe(32);
  expect(samplesForTurn(8, facing(0), facing(0.1), 50, 1920)).toBe(8);
  expect(samplesForTurn(8, facing(0), facing(30), 50, 1920)).toBe(64);
  expect(samplesForTurn(16, facing(0), facing(0.5), 50, 1920)).toBe(26);
  expect(samplesForTurn(8, facing(0), [Number.NaN, 0, 0], 50, 1920)).toBe(8);
});

// a camera key with cut: true inside a shot cuts the picture too: an open shutter at 10 s must not reach the next camera
test("the shutter stops at a camera key's cut inside a shot, as at a shot's start", () => {
  expect(shutterBounds(10, 0, 20, [], [5, 10.01, 15])).toEqual([5, 10.01]);
  expect(shutterBounds(10.01, 0, 20, [], [5, 10.01, 15])).toEqual([10.01, 15]);
  const [from, to] = shutterBounds(10, 0, 20, [], [10.01]);
  expect(Math.max(...shutterTimes(10, 30, 8, from, to))).toBeLessThan(10.01);
});
