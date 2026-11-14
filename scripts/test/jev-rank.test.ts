// jev.ts ranking a list longer than one Jev Choice holds (255 options): heats, then heats of the winners, until a final
// fits. A stand-in vote gives every option a share, as Jev's rounded probabilities do for the few it likes
import { expect, test } from "bun:test";

import { jevRank } from "../../packages/clip-catalog/jev";

const q = {
  wanted: "a door",
  pick: "Which fits?",
  yes: "it fits",
  no: "it does not",
  text: (x: { t: string }) => x.t,
};

test("a list too long for one final of heat winners still ends in one Choice of at most 255", async () => {
  const sizes: number[] = [];
  const vote = (_: unknown, group: { t: string }[]) => (
    sizes.push(group.length),
    Promise.resolve(group.map((x): [number, { t: string }] => [0.01, x]))
  );
  const pool = Array.from({ length: 7000 }, (_, i) => ({ t: `sound ${i}` }));
  await jevRank(q, pool, vote);
  expect(Math.max(...sizes)).toBeLessThanOrEqual(255);
});

test("a list one Choice holds is voted on once", async () => {
  let calls = 0;
  const vote = (_: unknown, group: { t: string }[]) => (
    calls++,
    Promise.resolve(group.map((x): [number, { t: string }] => [0.01, x]))
  );
  await jevRank(
    q,
    Array.from({ length: 255 }, (_, i) => ({ t: `sound ${i}` })),
    vote,
  );
  expect(calls).toBe(1);
});

test("entries Jev would read the same (a sound's takes) vote once and come back together", async () => {
  let seen: string[] = [];
  const vote = (_: unknown, group: { t: string; id: number }[]) => (
    (seen = group.map((x) => x.t)),
    Promise.resolve(group.map((x): [number, { t: string; id: number }] => [0.5, x]))
  );
  const got = await jevRank(
    q,
    [
      { t: "door creak", id: 1 },
      { t: "door creak", id: 2 },
      { t: "door slam", id: 3 },
    ],
    vote,
  );
  expect(seen).toEqual(["door creak", "door slam"]);
  expect(got.map(([p, x]) => [p, x.id])).toEqual([
    [0.5, 1],
    [0.5, 2],
    [0.5, 3],
  ]);
});
