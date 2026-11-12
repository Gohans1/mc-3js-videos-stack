import { expect, test } from "bun:test";

import { BLINKS, blinks } from "../src/blinks";
import { drowsiness, DROWSY } from "../src/drowsy";
import { explore } from "../src/explore";
import { changeTime, EXPRESS, express } from "../src/express";
import { fixations } from "../src/gaze";

test("explore: quick wide looks right after a start, back to the usual after ~2 s, again at the next start", () => {
  const a = explore([0, 10]);
  expect(a(0)).toBe(1);
  expect(a.mean(0)).toBeLessThan(0.7);
  expect(a.wander(0)).toBeGreaterThan(2);
  expect(a(1)).toBeGreaterThan(0.3);
  expect(a(2.01)).toBe(0);
  expect(a.mean(5)).toBe(1);
  expect(a(10.2)).toBeGreaterThan(0.9);
  expect(a(-1)).toBe(0);
  // gaze takes the mean as a function: more fixations in the first 2 s than in a later 2 s
  const f = fixations([], 12, { mean: (t) => 0.75 * a.mean(t) });
  const count = (x: number, y: number) => f.filter((t) => t >= x && t < y).length;
  let early = 0,
    late = 0;
  for (let seed = 1; seed < 40; seed++) {
    const g = fixations([], 12, { seed, mean: (t) => 0.75 * a.mean(t) });
    early += g.filter((t) => t < 2).length;
    late += g.filter((t) => t >= 4 && t < 6).length;
  }
  expect(early).toBeGreaterThan(1.2 * late);
  expect(count(0, 12)).toBeGreaterThan(5);
});

test("drowsy: same blink count, longer blinks that reopen slowly, some long or partial, lids lower; shut while asleep", () => {
  const alert = blinks(600),
    sleepy = blinks(600, { drowsy: () => 1 });
  // the rate barely changes (Caffier 2003)
  expect(Math.abs(sleepy.times.length - alert.times.length) / alert.times.length).toBeLessThan(
    0.25,
  );
  const len = (s: { down: number; shut: number; up: number }) => s.down + s.shut + s.up;
  const normal = sleepy.shapes.filter((s) => s.depth === 1 && s.shut < 0.5);
  expect(len(normal[0]) / len(BLINKS)).toBeGreaterThan(1.8);
  expect(normal[0].up / normal[0].down).toBeGreaterThan(BLINKS.up / BLINKS.down);
  const long = sleepy.shapes.filter((s) => s.shut >= 0.5).length / sleepy.shapes.length,
    part = sleepy.shapes.filter((s) => s.depth < 1).length / sleepy.shapes.length;
  expect(long).toBeGreaterThan(0.1);
  expect(long).toBeLessThan(0.4);
  expect(part).toBeGreaterThan(0.1);
  expect(alert.shapes.every((s) => s.depth === 1 && s.shut === BLINKS.shut)).toBe(true);
  expect(sleepy.droop(3)).toBeCloseTo(DROWSY.droop, 9);
  expect(alert.droop(3)).toBe(0);
  // no blink starts before the last one is open again
  sleepy.times.forEach((t, i) => {
    if (i) expect(t - sleepy.times[i - 1]).toBeGreaterThanOrEqual(len(sleepy.shapes[i - 1]) + 0.1);
  });
  // asleep: shut, then a slow first opening, and no blink inside the span
  const d = drowsiness([
    { t: 0, k: 1 },
    { t: 10, k: 0 },
  ]);
  const w = blinks(20, { drowsy: d, asleep: [[0, 3]] });
  expect(w(1)).toBe(1);
  expect(w(3.1)).toBeGreaterThan(0.8);
  expect(w(3 + 0.9)).toBeLessThan(0.05);
  expect(w.times.every((t) => t >= 3)).toBe(true);
  // dozing off again: the lids sink slowly into the span, no pop
  const z = blinks(20, {
    drowsy: () => 1,
    asleep: [
      [0, 1],
      [6, 7],
    ],
  });
  let pop = 0;
  for (let t = 4; t < 9; t += 1 / 120) pop = Math.max(pop, Math.abs(z(t + 1 / 120) - z(t)));
  expect(pop).toBeLessThan(0.1);
  expect(z(6.5)).toBe(1);
  expect(d(5)).toBeCloseTo(0.5, 6);
  expect(d(12)).toBe(0);
});

test("express: surprise comes fast, sadness slow, leaving slower than coming; fear brows first; a change cut short never pops", () => {
  expect(changeTime("neutral", "surprised")).toBeCloseTo(EXPRESS.onset.surprise, 9);
  expect(changeTime("neutral", "sad")).toBeGreaterThan(changeTime("neutral", "scared"));
  expect(changeTime("sad", "neutral")).toBeGreaterThan(changeTime("neutral", "sad"));
  expect(changeTime("neutral", "sad", undefined, 1.3)).toBeCloseTo(1.3 * EXPRESS.onset.sadness, 9);
  const M = {
    neutral: { y: 0, open: 0.9, smile: 0 },
    scared: { y: 0.7, open: 1, smile: -1 },
    surprised: { y: 0.85, open: 1, smile: 0 },
    sad: { y: 0.2, open: 0.75, smile: -1 },
  };
  const f = express(
    [
      { t: 0, mood: "neutral" },
      { t: 1, mood: "scared" },
      { t: 4, mood: "neutral" },
    ],
    M,
  );
  expect(f(0.5).y).toBe(0);
  f(0.2).open = 0; // the caller changing what it got changes nothing else
  expect(f(0.5).open).toBe(0.9);
  expect(M.neutral.open).toBe(0.9);
  const mid = f(1 + 0.565 * 0.25);
  // a quarter of the way in, the brows have moved more than the eyes
  expect((mid.y as number) / 0.7).toBeGreaterThan(((mid.open as number) - 0.9) / 0.1);
  expect(f(1 + 0.6).y).toBeCloseTo(0.7, 6);
  expect(f(4 + 1.27).smile).toBeCloseTo(0, 6);
  expect(f(4 + 0.5).smile as number).toBeLessThan(-0.5);
  // cut short: surprised for 0.2 s, then sad; the face goes on from where it was
  const g = express(
    [
      { t: 0, mood: "neutral" },
      { t: 1, mood: "surprised" },
      { t: 1.2, mood: "sad" },
    ],
    M,
  );
  let jump = 0;
  for (let t = 0.9; t < 3; t += 1 / 120)
    jump = Math.max(jump, Math.abs((g(t + 1 / 120).y as number) - (g(t).y as number)));
  expect(jump).toBeLessThan(0.05);
  expect(g(1.2 + 1).y).toBeCloseTo(0.2, 6);
  // nested fields (a mood's per-brow L/R) blend too
  const h = express(
    [
      { t: 0, mood: "a" },
      { t: 1, mood: "b" },
    ],
    { a: { L: { y: 0 } }, b: { L: { y: 1 } } },
    { kind: {} },
  );
  expect((h(1 + EXPRESS.calm / 2) as any).L.y).toBeCloseTo(0.5, 6);
});
