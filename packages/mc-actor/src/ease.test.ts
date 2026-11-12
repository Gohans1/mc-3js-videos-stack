import { expect, test } from "bun:test";

import { walkEase } from "./ease";

const speed = (x: number, dur: number, h = 1e-4) =>
  (walkEase(Math.min(1, x + h), dur) - walkEase(Math.max(0, x - h), dur)) /
  (Math.min(1, x + h) - Math.max(0, x - h));

test("a walk starts and stops at rest, never dead", () => {
  for (const dur of [0.8, 2.5, 6]) {
    expect(walkEase(0, dur)).toBe(0);
    expect(walkEase(1, dur)).toBeCloseTo(1, 12);
    expect(speed(0, dur)).toBeLessThan(0.01);
    expect(speed(1, dur)).toBeLessThan(0.01);
  }
});

test("it only ever goes forward, at one pace between the ramps", () => {
  let last = 0;
  for (let x = 0.001; x <= 1; x += 0.001) {
    const k = walkEase(x, 2.5);
    expect(k).toBeGreaterThanOrEqual(last);
    last = k;
  }
  expect(speed(0.5, 6)).toBeCloseTo(speed(0.7, 6), 6);
});

test("past the last key (no time left to walk) it stays a number", () => {
  expect(walkEase(0, 0)).toBe(0);
  expect(walkEase(1, 0)).toBe(1);
});
