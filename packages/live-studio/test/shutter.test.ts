import { expect, test } from "bun:test";

import { apertureSamples, shutterTimes } from "../src/shutter";

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
