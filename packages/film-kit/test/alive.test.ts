import { expect, test } from "bun:test";

import { BLINKS } from "../src/blinks";
import { cartoon } from "../src/cartoon";
import { through } from "../src/curve";
import { anglesOf, BLINK, EYE, eyeTime, fixations, gaze } from "../src/gaze";
import { idle } from "../src/idle";
import { overlap } from "../src/overlap";
import { addPose, type Pose, throughPose } from "../src/pose";

const smoothstep = (u: number) => u * u * (3 - 2 * u);

test("through: no neighbours is smoothstep; a key on the way keeps its speed, a turning key stops, nothing overshoots", () => {
  for (const u of [0, 0.3, 0.5, 0.9, 1])
    expect(through(null, 2, 6, null, 0, 1, 2, 3, 1 + u)).toBeCloseTo(2 + 4 * smoothstep(u), 12);
  const speed = (vp: number, vn: number) =>
    (through(vp, 2, 6, vn, 0, 1, 2, 3, 1.001) - through(vp, 2, 6, vn, 0, 1, 2, 3, 1)) / 0.001;
  expect(speed(0, 9)).toBeGreaterThan(1); // 0 -> 2 -> 6: moving on through the key at t 1
  expect(Math.abs(speed(4, 9))).toBeLessThan(0.01); // 4 -> 2 -> 6: a trough, it stops there
  expect(Math.abs(speed(2, 9))).toBeLessThan(0.01); // 2, 2: held, it leaves at rest
  for (let t = 1; t <= 2; t += 0.01) {
    const v = through(0, 2, 6, 6.1, 0, 1, 2, 2.05, t);
    expect(v).toBeGreaterThanOrEqual(2 - 1e-9);
    expect(v).toBeLessThanOrEqual(6 + 1e-9);
  }
});

test("throughPose: per joint and root field, missing joints at rest; addPose adds", () => {
  const A: Pose = { chest: [0, 0, 0], root: { y: 0 } },
    B: Pose = { chest: [10, 0, 0], head: [0, 20, 0], root: { y: -0.1 } };
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
  const lagOf = overlap(
    (t) => ({ chest: [ramp(t), 0, 0], laR: [ramp(t), 0, 0], ulL: [ramp(t), 0, 0] }),
    4,
  );
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
  expect(
    (overlap((t) => ({ chest: [ramp(t), 0, 0] }), 4, { amount: 0 })(1.15).chest as number[]).every(
      (x) => x === 0,
    ),
  ).toBe(true);
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
  const aim = (f: number) =>
    f >= 4.9 ? ([EYE.yaw / 2, 0] as [number, number]) : ([0, 0] as [number, number]);
  expect(eyes(4.93, aim).look[0]).toBe(0);
  expect(eyes(4.94 + 0.025, aim).look[0]).toBeCloseTo(0.25, 9);
  expect(eyes(4.94 + 0.05, aim).look[0]).toBeCloseTo(0.5, 9);
  expect(eyes(5.1, () => [200, -200]).look).toEqual([1, -1]);
  expect(eyeTime(4.94, () => 5.4)).toBeCloseTo(5.4, 9);
  expect(eyeTime(4.94, () => 9)).toBeCloseTo(5.5, 9);
  expect(anglesOf([1, 0, 1])![0]).toBeCloseTo(45, 9);
  expect(anglesOf([0, -1, 1])![1]).toBeCloseTo(-45, 9);
  expect(anglesOf([0, -0.1, 0.05])).toBeNull(); // at the nose
  expect(anglesOf([0.5, 0, -1])![0]).toBeGreaterThan(90); // behind him: as far round as the eyes go
});

test("gaze: a jump over 33 degrees always brings a blink that starts with it; under 15 never", () => {
  const f = fixations([], 200),
    eyes = gaze([], 200);
  let bigBlinks = 0,
    smallBlinks = 0;
  for (let i = 1; i < f.length - 1 && f[i] < 190; i++) {
    const turn = (fx: number) => [fx >= f[i] ? 40 : 0, 0] as [number, number];
    const nudge = (fx: number) => [fx >= f[i] ? 10 : 0, 0] as [number, number];
    // shut at the end of the fast down phase, open again after the slow up phase
    if (eyes(f[i] + BLINKS.down + 0.01, turn).blink > 0.9) bigBlinks++;
    if (eyes(f[i] + BLINKS.down + 0.01, nudge).blink > 0) smallBlinks++;
    if (f[i + 1] > f[i] + BLINK + 0.02) expect(eyes(f[i] + BLINK + 0.01, turn).blink).toBe(0);
  }
  expect(bigBlinks).toBe(f.filter((t) => t > 0 && t < 190).length);
  expect(smallBlinks).toBe(0);
  const justBlinked = gaze([], 200, { blinkedNear: () => true });
  expect(justBlinked(f[3] + BLINKS.down, (fx) => [fx >= f[3] ? 40 : 0, 0]).blink).toBe(0);
});

// a 40-degree chest bend over 0.3 s at t 2, held, then back at t 5
const bend = (t: number) =>
  40 *
  smoothstep(Math.min(1, Math.max(0, (t - 2) / 0.3))) *
  (1 - smoothstep(Math.min(1, Math.max(0, (t - 5) / 0.3))));

test("cartoon: winds up the other way before a move and carries past its stop; nothing on a held pose", () => {
  const toon = cartoon((t) => ({ chest: [bend(t), 0, 0] }), 8);
  const out = (t: number) => bend(t) + (toon(t).chest as number[])[0];
  let low = 0,
    high = 0;
  for (let t = 1.6; t < 2.05; t += 0.005) low = Math.min(low, out(t));
  for (let t = 2.2; t < 2.8; t += 0.005) high = Math.max(high, out(t));
  expect(low).toBeLessThan(-1.2); // anticipation: about 5% back first
  expect(low).toBeGreaterThan(-3);
  expect(high).toBeGreaterThan(41.2); // follow-through about 5% past 40
  expect(high).toBeLessThan(43);
  expect(Math.abs((toon(3.5).chest as number[])[0])).toBeLessThan(0.01);
  expect(Math.abs((toon(0.5).chest as number[])[0])).toBeLessThan(0.01);
  expect(toon(2).ulL).toBeUndefined();
});

test("idle: breathes ~15 a minute at rest and faster, deeper after effort, recovering over tens of seconds", () => {
  // still for 20 s, then 6 s of hard bending (2 Hz), then still
  const pose = (t: number): Pose => ({
    chest: [t > 20 && t < 26 ? 30 * Math.sin(2 * Math.PI * 2 * t) : 0, 0, 0],
  });
  const life = idle(pose, 90, { sway: 0, settle: 0 });
  const breaths = (from: number, to: number) => {
    let n = 0,
      was = (life(from).chest as number[])[0];
    for (let t = from; t < to; t += 1 / 60) {
      const c = (life(t).chest as number[])[0];
      if (was > -0.6 && c <= -0.6) n++;
      was = c;
    }
    return n / ((to - from) / 60);
  };
  const depth = (from: number, to: number) => {
    let m = 0;
    for (let t = from; t < to; t += 1 / 60) m = Math.min(m, (life(t).chest as number[])[0]);
    return -m;
  };
  expect(breaths(4, 20)).toBeGreaterThan(13);
  expect(breaths(4, 20)).toBeLessThan(17);
  expect(breaths(26, 34)).toBeGreaterThan(28);
  expect(depth(26, 34)).toBeGreaterThan(3 * depth(4, 20));
  expect(life.effort(26)).toBeGreaterThan(0.9);
  expect(life.effort(26 + 25)).toBeLessThan(0.45); // one time constant later, about a third left
  expect(life.effort(26 + 25)).toBeGreaterThan(0.25);
});

test("idle: weight shifts only standing still, about every 4 s; a fast stop dips the chest once", () => {
  const pose = (t: number): Pose => ({ chest: [bend(t), 0, 0] });
  const standing = idle(pose, 30, { breath: 0, standing: () => 1 }),
    kneeling = idle(pose, 30, { breath: 0, standing: () => 0 });
  const hip = (t: number) => standing(t).root!.x;
  let flips = 0,
    was = Math.sign(hip(6));
  for (let t = 6; t < 30; t += 0.05) {
    const s = Math.sign(hip(t));
    if (s && s !== was) {
      flips++;
      was = s;
    }
  }
  expect(flips).toBeGreaterThan(2);
  expect(flips).toBeLessThan(8);
  expect(Math.abs(hip(8.2)) + Math.abs(hip(9))).toBeLessThan(1); // sanity: metres, a few cm at most
  expect(Math.max(...[...Array(600)].map((_, i) => Math.abs(hip(i * 0.05))))).toBeLessThanOrEqual(
    0.035 + 1e-9,
  );
  expect(kneeling(12).root!.x).toBe(0);
  expect(Math.abs(standing(2.15).root!.x)).toBe(0); // moving: no sway
  // the stop at ~2.3 s: the chest dips forward and the hips sink, then it is gone within a second and a half
  expect(standing.stops.length).toBe(2);
  let dip = 0;
  for (let t = 2.3; t < 3.2; t += 0.01) dip = Math.max(dip, (standing(t).chest as number[])[0]);
  expect(dip).toBeGreaterThan(0.5);
  expect(dip).toBeLessThan(3.01);
  expect(Math.abs((standing(4).chest as number[])[0])).toBeLessThan(0.01);
});
