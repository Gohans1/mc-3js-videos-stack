import { expect, test } from "bun:test";

import { textTransform } from "../app/text/text-transform";

test("a corner drag scales about the rendered anchor, including world anchored text", () => {
  expect(
    textTransform("scale", { scale: 1.5, rotate: 20 }, [300, 200], [400, 200], [500, 200]),
  ).toEqual({ scale: 3 });
});

test("a rotation drag adds the pointer angle without wrapping across a full turn", () => {
  expect(textTransform("rotate", { scale: 1, rotate: 170 }, [0, 0], [1, 0], [0, 1])).toEqual({
    rotate: -100,
  });
});
