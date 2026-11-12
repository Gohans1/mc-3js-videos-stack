import { expect, test } from "bun:test";

import { makePerformance } from "./perform";

const P = () =>
  makePerformance({ poses: { stand: () => ({}), sitBed: () => ({}) }, faces: { tense: { y: 0 } } });
const move = (t: number, more = {}) => ({ t, at: [0, 0, 0], yaw: 0, pose: "stand", ...more });
const err = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return (e as Error).message;
  }
  return "";
};

test("a pose typo late in the film stops the first frame, with the right name", () => {
  const msg = err(() => P().bodyAt([move(0), move(5), move(90, { pose: "stnad" })], 0));
  expect(msg).toContain('moves[2] (t 90): pose "stnad"');
  expect(msg).toContain('did you mean "stand"');
});

test("an unknown field (pos for at) is an error, not ignored", () => {
  const msg = err(() => P().bodyAt([move(0), { t: 9, pos: [1, 0, 0], yaw: 0, pose: "stand" }], 0));
  expect(msg).toContain("moves[1] (t 9)");
  expect(msg).toMatch(/pos/);
});

test("a mood typo is an error instead of a neutral face; the film's own faces count", () => {
  expect(err(() => P().moodAt([{ t: 0, mood: "scraed" }], 1))).toContain('did you mean "scared"');
  expect(
    err(() =>
      P().moodAt(
        [
          { t: 0, mood: "tense" },
          { t: 2, mood: "neutral" },
        ],
        1,
      ),
    ),
  ).toBe("");
});

test("keys out of time order, a walk out of a clip, a clip not loaded", () => {
  expect(err(() => P().bodyAt([move(3), move(1)], 0))).toContain("order of time");
  const clip = { t: 2, at: [0, 0, 0], yaw: 0, clip: "mixamo/Kneel" };
  expect(err(() => P().bodyAt([move(0), clip, move(4, { walk: true })], 0))).toContain(
    "a walk can't start out of a clip",
  );
  expect(err(() => P().bodyAt([move(0), clip], 0, { "mixamo/Kneeling": {} }))).toContain(
    'did you mean "mixamo/Kneeling"',
  );
});

test("hand and look keys: a point, an anchor name or null; nothing else", () => {
  expect(
    err(() =>
      P().targetAt(
        [
          { t: 0, R: [1, 1, 1] },
          { t: 1, R: "drawer" },
          { t: 2, R: null },
        ],
        "R",
        0.5,
        () => null,
      ),
    ),
  ).toBe("");
  expect(err(() => P().targetAt([{ t: 0, R: [1, 1] }], "R", 0.5, () => null))).toContain(
    "hands[0] (t 0) R",
  );
});
