import { expect, test } from "bun:test";
import { transitionAt, transitionLength, viewTime } from "../src/transitions";

const shots = [{ t: 0 }, { t: 4, transition: { fx: "dissolve", len: 2 } }, { t: 10 }];

test("a transition straddles the cut, without moving the cut or changing film time", () => {
  expect(transitionAt(shots, 14, 2.9)).toBeNull();
  expect(transitionAt(shots, 14, 3)).toMatchObject({ shot: 1, progress: 0, fx: "dissolve" });
  expect(transitionAt(shots, 14, 4)).toMatchObject({ shot: 1, progress: 0.5 });
  expect(transitionAt(shots, 14, 5)).toBeNull();
  expect(shots[1].t).toBe(4);
});

test("long transitions share short shots without overlapping adjacent transitions", () => {
  const short = [{ t: 0 }, { t: 4, transition: { fx: "wipe", len: 20 } }, { t: 5, transition: { fx: "black", len: 20 } }];
  expect(transitionLength(short, 10, 1)).toBe(1);
  expect(transitionLength(short, 10, 2)).toBe(1);
  expect(transitionAt(short, 10, 4.49)?.shot).toBe(1);
  expect(transitionAt(short, 10, 4.5)?.shot).toBe(2);
});

test("each view stays inside its camera shot while the world keeps its actual time", () => {
  expect(viewTime(shots, 14, 0, 4.5)).toBeCloseTo(4 - 1e-6, 8);
  expect(viewTime(shots, 14, 1, 3.5)).toBe(4);
  expect(viewTime(shots, 14, 1, 5)).toBe(5);
});

test("first shots, unknown effects and invalid durations never create a transition", () => {
  for (const transition of [{ fx: "unknown", len: 1 }, { fx: "black", len: -1 }, { fx: "wipe", len: Infinity }]) {
    expect(transitionAt([{ t: 0 }, { t: 4, transition }], 8, 4)).toBeNull();
  }
  expect(transitionAt([{ t: 0, transition: { fx: "black", len: 1 } }], 8, 0)).toBeNull();
});
