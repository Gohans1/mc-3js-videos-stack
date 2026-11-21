import { expect, test } from "bun:test";

import { toSeconds } from "./lib";

// AI Studio rewrites clip times when it saves them (0m2s comes back as 2s), so times compare as seconds.
test("toSeconds reads every spelling the video dialog accepts or writes back", () => {
  expect(toSeconds("2s")).toBe(2);
  expect(toSeconds("0m2s")).toBe(2);
  expect(toSeconds("90s")).toBe(90);
  expect(toSeconds("1m30s")).toBe(90);
  expect(toSeconds("1h2m3s")).toBe(3723);
  expect(toSeconds("1.5s")).toBe(1.5);
  expect(toSeconds("2m")).toBe(120);
});

test("toSeconds rejects text that is not a time", () => {
  expect(toSeconds("")).toBeNaN();
  expect(toSeconds("abc")).toBeNaN();
  expect(toSeconds("1m30")).toBeNaN();
});
