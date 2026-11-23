import { expect, test } from "bun:test";

import { mouthAt } from "../src/player";

const held = (shape: string) => mouthAt([[0, shape]], 10);

test("a shape is whole on its own second, never reached after it (animation may lead the sound, never trail it)", () => {
  const cues = [
    [0, "X"],
    [1, "D"],
  ];
  expect(mouthAt(cues, 1)).toEqual(held("D"));
  expect(mouthAt(cues, 0.5)).toEqual(held("X"));
  const opening = mouthAt(cues, 0.98)[1];
  expect(opening).toBeGreaterThan(0);
  expect(opening).toBeLessThan(held("D")[1]);
});

test("a lip closure as short as Rhubarb writes one (70 ms) is shut on its second and stays shut", () => {
  const cues = [
    [0, "C"],
    [1, "A"],
    [1.07, "D"],
  ];
  expect(mouthAt(cues, 1)).toEqual(held("A"));
  expect(mouthAt(cues, 1.03)[1]).toBe(0);
  expect(mouthAt(cues, 1.07)).toEqual(held("D"));
});

test("before the first cue and with no cues the mouth rests shut", () => {
  expect(mouthAt([], 3)).toEqual(held("X"));
  expect(mouthAt([[2, "D"]], 0)).toEqual(held("X"));
});
