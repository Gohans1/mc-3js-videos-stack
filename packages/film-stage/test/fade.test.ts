import { expect, test } from "bun:test";

import { EASES, expIn, expInOut, expOut, hitPulse, lmix } from "../src/camera";
import { blackAt } from "../src/fade";

test("no keys: the picture is never dimmed", () => {
  expect(blackAt(undefined, 3)).toBe(0);
  expect(blackAt([], 3)).toBe(0);
});

test("outside the keys the nearest key's level holds", () => {
  const ks = [
    { t: 58, black: 0 },
    { t: 60, black: 1 },
  ];
  expect(blackAt(ks, 10)).toBe(0);
  expect(blackAt(ks, 60)).toBe(1);
  expect(blackAt(ks, 61)).toBe(1);
});

test("between two keys the later key's ease shapes the change, smooth when it names none", () => {
  const ks = [
    { t: 0, black: 1 },
    { t: 2, black: 0 },
  ];
  expect(blackAt(ks, 0.5)).toBeCloseTo(1 - EASES.smooth(0.25), 9);
  expect(blackAt([ks[0], { ...ks[1], ease: "linear" }], 0.5)).toBeCloseTo(0.75, 9);
  expect(blackAt([ks[0], { ...ks[1], ease: [0.42, 0, 0.58, 1] }], 1)).toBeCloseTo(0.5, 6);
});

test("a cut's two keys a frame apart switch the level on the cut's own frame", () => {
  const ks = [
    { t: 26.999, black: 0 },
    { t: 27, black: 1 },
    { t: 27.5, black: 0 },
  ];
  expect(blackAt(ks, 27 - 1 / 30)).toBe(0);
  expect(blackAt(ks, 27)).toBe(1);
});

test("Cinetic role-based eases start at 0, end at 1, and follow arrive, reposition, and leave curves", () => {
  for (const [name, fn] of Object.entries(EASES)) {
    expect(fn(0), `${name}(0)`).toBeCloseTo(0, 5);
    expect(fn(1), `${name}(1)`).toBeCloseTo(1, 5);
  }
  // Arrive family: front-loaded deceleration into rest
  for (const k of [
    "snapOut",
    "glideOut",
    "settleOut",
    "softOut",
    "liftOut",
    "jump",
    "xpArrive",
  ] as const) {
    expect(EASES[k](0.3), `${k}(0.3)`).toBeGreaterThan(0.42);
  }
  expect(EASES.jump(0.2)).toBeGreaterThan(EASES.snapOut(0.2));
  expect(EASES.snapOut(0.2)).toBeGreaterThan(EASES.settleOut(0.2));

  // Leave family: accelerates into the cut
  for (const k of ["softIn", "buildIn", "launchIn", "xpLeave"] as const) {
    expect(EASES[k](0.5), `${k}(0.5)`).toBeLessThan(0.36);
  }

  // Reposition family: S-curves, whip build, and anticipation wind-up
  expect(EASES.stdInOut(0.5)).toBeGreaterThan(0.5);
  expect(EASES.strongInOut(0.2)).toBeLessThan(0.2);
  expect(EASES.strongInOut(0.8)).toBeGreaterThan(0.8);
  expect(EASES.whipBuild(0.3)).toBeLessThan(0.15);
  expect(EASES.whipBuild(0.8)).toBeGreaterThan(0.88);
  expect(EASES.anticipate(0.25)).toBeLessThan(0);
  expect(EASES.xpTravel(0.5)).toBeCloseTo(0.5, 5);
});

test("Cinetic math helpers interpolate scale in log space and shape impact pulses", () => {
  expect(expOut(6)(0)).toBe(0);
  expect(expOut(6)(1)).toBe(1);
  expect(expIn(6)(0)).toBe(0);
  expect(expIn(6)(1)).toBe(1);
  expect(expInOut(6)(0.5)).toBeCloseTo(0.5, 6);
  expect(lmix(1, 4, 0.5)).toBeCloseTo(2, 6);
  expect(hitPulse(0)).toBe(0);
  expect(hitPulse(0.18)).toBeGreaterThan(0.7);
  expect(hitPulse(1)).toBeCloseTo(0, 6);
});
