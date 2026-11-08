import { expect, test } from "bun:test";
import { EASES } from "../src/camera";
import { blackAt } from "../src/fade";

test("no keys: the picture is never dimmed", () => {
  expect(blackAt(undefined, 3)).toBe(0);
  expect(blackAt([], 3)).toBe(0);
});

test("outside the keys the nearest key's level holds", () => {
  const ks = [{ t: 58, black: 0 }, { t: 60, black: 1 }];
  expect(blackAt(ks, 10)).toBe(0);
  expect(blackAt(ks, 60)).toBe(1);
  expect(blackAt(ks, 61)).toBe(1);
});

test("between two keys the later key's ease shapes the change, smooth when it names none", () => {
  const ks = [{ t: 0, black: 1 }, { t: 2, black: 0 }];
  expect(blackAt(ks, 0.5)).toBeCloseTo(1 - EASES.smooth(0.25), 9);
  expect(blackAt([ks[0], { ...ks[1], ease: "linear" }], 0.5)).toBeCloseTo(0.75, 9);
  expect(blackAt([ks[0], { ...ks[1], ease: [0.42, 0, 0.58, 1] }], 1)).toBeCloseTo(0.5, 6);
});

test("a cut's two keys a frame apart switch the level on the cut's own frame", () => {
  const ks = [{ t: 26.999, black: 0 }, { t: 27, black: 1 }, { t: 27.5, black: 0 }];
  expect(blackAt(ks, 27 - 1 / 30)).toBe(0);
  expect(blackAt(ks, 27)).toBe(1);
});
