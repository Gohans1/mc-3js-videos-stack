import { expect, test } from "bun:test";
import { through } from "../src/curve";
import { anglesOf, EYE, eyeTime, fixations, gaze } from "../src/gaze";
import { overlap } from "../src/overlap";
import { addPose, throughPose, type Pose } from "../src/pose";

const smoothstep = (u: number) => u * u * (3 - 2 * u);

test("through: no neighbours is smoothstep; a key on the way keeps its speed, a turning key stops, nothing overshoots", () => {
  for (const u of [0, 0.3, 0.5, 0.9, 1]) expect(through(null, 2, 6, null, 0, 1, 2, 3, 1 + u)).toBeCloseTo(2 + 4 * smoothstep(u), 12);
  const speed = (vp: number, vn: number) => (through(vp, 2, 6, vn, 0, 1, 2, 3, 1.001) - through(vp, 2, 6, vn, 0, 1, 2, 3, 1)) / 0.001;
  expect(speed(0, 9)).toBeGreaterThan(1); // 0 -> 2 -> 6: moving on through the key at t 1
  expect(Math.abs(speed(4, 9))).toBeLessThan(0.01); // 4 -> 2 -> 6: a trough, it stops there
  expect(Math.abs(speed(2, 9))).toBeLessThan(0.01); // 2, 2: held, it leaves at rest
  for (let t = 1; t <= 2; t += 0.01) { const v = through(0, 2, 6, 6.1, 0, 1, 2, 2.05, t); expect(v).toBeGreaterThanOrEqual(2 - 1e-9); expect(v).toBeLessThanOrEqual(6 + 1e-9); }
});

test("throughPose: per joint and root field, missing joints at rest; addPose adds", () => {
  const A: Pose = { chest: [0, 0, 0], root: { y: 0 } }, B: Pose = { chest: [10, 0, 0], head: [0, 20, 0], root: { y: -0.1 } };
  const mid = throughPose(null, A, B, null, [0, 0, 1, 2], 0.5);
  expect((mid.chest as number[])[0]).toBeCloseTo(5, 12);
  expect((mid.head as number[])[1]).toBeCloseTo(10, 12);
  expect(mid.root!.y).toBeCloseTo(-0.05, 12);
  const sum = addPose(B, { chest: [1, 2, 3], root: { y: 0.1 } });
  expect(sum.chest).toEqual([11, 2, 3]);
  expect(sum.root!.y).toBeCloseTo(0, 12);
});

test("overlap: zero on a still pose, lags a move by about its frames, swings past a stop and settles; legs untouched", () => {
  // the chest and forearm swing 0 -> 60 degrees over 0.3 s at t 1, then hold
  const ramp = (t: number) => 60 * smoothstep(Math.min(1, Math.max(0, (t - 1) / 0.3)));
  const lagOf = overlap((t) => ({ chest: [ramp(t), 0, 0], laR: [ramp(t), 0, 0], ulL: [ramp(t), 0, 0] }), 4);
  const at = (j: string, t: number) => ((lagOf(t)[j] as number[] | undefined) ?? [0])[0];
  expect(at("chest", 0.5)).toBeCloseTo(0, 9);
  expect(at("laR", 1.15)).toBeLessThan(at("chest", 1.15)); // trails behind the pose, the forearm more than the chest
  expect(at("chest", 1.15)).toBeLessThan(0);
  // the lagged forearm crosses the pose's angle at about its 3 frames (0.1 s) behind it
  const lagged = (t: number) => ramp(t) + at("laR", t);
  let cross = 1;
  while (lagged(cross) < 30) cross += 0.001;
  expect(cross - 1.15).toBeGreaterThan(0.07);
  expect(cross - 1.15).toBeLessThan(0.13);
  let peak = 0;
  for (let t = 1.3; t < 2; t += 0.005) peak = Math.max(peak, lagged(t));
  expect(peak).toBeGreaterThan(60.5); // past the stop
  expect(peak).toBeLessThan(66);
  expect(Math.abs(at("laR", 3.5))).toBeLessThan(0.05); // settled
  expect(lagOf(1.15).ulL).toBeUndefined();
  expect((overlap((t) => ({ chest: [ramp(t), 0, 0] }), 4, { amount: 0 })(1.15).chest as number[]).every((x) => x === 0)).toBe(true);
});

test("gaze: fixations hold 0.25 s or more, average about 0.75 s, and one lands 60 ms before each shift", () => {
  const f = fixations([], 600);
  const gaps = f.slice(1).map((t, i) => t - f[i]);
  expect(Math.min(...gaps)).toBeGreaterThanOrEqual(0.25);
  expect(gaps.reduce((a, b) => a + b, 0) / gaps.length).toBeGreaterThan(0.65);
  expect(gaps.reduce((a, b) => a + b, 0) / gaps.length).toBeLessThan(0.85);
  const g = fixations([10, 20], 30);
  expect(g).toContain(10 - 0.06);
  expect(g.filter((t) => Math.abs(t - 9.94) < 0.2)).toEqual([9.94]);
  expect(fixations([10], 30)).toEqual(fixations([10], 30));
});

test("gaze: eyes jump in 50 ms and hold; the aim decides the direction; eyeTime looks to the end of a short turn", () => {
  const eyes = gaze([5], 10);
  const aim = (f: number) => (f >= 4.9 ? [EYE.yaw / 2, 0] as [number, number] : [0, 0] as [number, number]);
  expect(eyes(4.93, aim)[0]).toBe(0);
  expect(eyes(4.94 + 0.025, aim)[0]).toBeCloseTo(0.25, 9);
  expect(eyes(4.94 + 0.05, aim)[0]).toBeCloseTo(0.5, 9);
  expect(eyes(5.1, () => [200, -200])).toEqual([1, -1]);
  expect(eyeTime(4.94, () => 5.4)).toBeCloseTo(5.4, 9);
  expect(eyeTime(4.94, () => 9)).toBeCloseTo(5.5, 9);
  expect(anglesOf([1, 0, 1])![0]).toBeCloseTo(45, 9);
  expect(anglesOf([0, -1, 1])![1]).toBeCloseTo(-45, 9);
  expect(anglesOf([0, -0.3, 0.05])).toBeNull(); // at the nose
  expect(anglesOf([0.5, 0, -1])).toBeNull(); // behind him
});
