import { expect, test } from "bun:test";
import { phaseOf, typed } from "../src/titles";

test("an item is on screen from its start up to, not at, its end", () => {
  const it = { from: 2, to: 5 };
  expect(phaseOf(it, 1.99)).toBeNull();
  expect(phaseOf(it, 2)).toEqual({ in: 1, out: 1 });
  expect(phaseOf(it, 5)).toBeNull();
});

test("its In runs over the first len seconds and its Out over the last", () => {
  const it = { from: 2, to: 5, in: { fx: "fade", len: 1 }, out: { fx: "fade", len: 0.5 } };
  expect(phaseOf(it, 2.5)).toEqual({ in: 0.5, out: 1 });
  expect(phaseOf(it, 4)).toEqual({ in: 1, out: 1 });
  expect(phaseOf(it, 4.75)!.out).toBeCloseTo(0.5, 9);
});

test("an In and an Out longer than the item share it in their own proportions", () => {
  const it = { from: 0, to: 1, in: { fx: "fade", len: 1.5 }, out: { fx: "fade", len: 0.5 } };
  expect(phaseOf(it, 0.75)!.in).toBe(1); // the In takes 0.75 s of the 1
  expect(phaseOf(it, 0.875)!.out).toBeCloseTo(0.5, 9); // the Out the last 0.25 s
});

test("a typewriter shows whole characters, never half of one made of two code units", () => {
  expect(typed("Sealed room", 0)).toBe("");
  expect(typed("Sealed room", 0.5)).toBe("Sealed");
  expect(typed("Sealed room", 1)).toBe("Sealed room");
  expect(typed("a😀b", 0.5)).toBe("a😀");
});
