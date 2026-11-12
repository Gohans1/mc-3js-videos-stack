import { expect, test } from "bun:test";

import { makePerformance } from "./perform";

const performance = () =>
  makePerformance({
    poses: { a: () => ({ head: [0, 0, 0] }), b: () => ({ head: [80, 0, 0] }) },
    standing: [],
  });
const moves = (ease?: string | number[], walk = false) => [
  { t: 0, at: [0, 0, 0], yaw: 0, pose: "a" },
  {
    t: 4,
    at: [4, 0, 0],
    yaw: 90,
    pose: "b",
    ...(ease !== undefined && { ease }),
    ...(walk && { walk }),
  },
];

test("the incoming key eases position, facing and pose together; old films keep their smoothstep", () => {
  const actor = performance(),
    normal = actor.bodyAt(moves(), 1),
    linear = actor.bodyAt(moves("linear"), 1);
  expect(normal.at[0]).toBeCloseTo(0.625, 8);
  expect(normal.pose.head[0]).toBeCloseTo(12.5, 8);
  expect(linear.at[0]).toBeCloseTo(1, 8);
  expect(linear.yaw).toBeCloseTo(22.5, 8);
  expect(linear.pose.head[0]).toBeCloseTo(20, 8);
  expect(actor.bodyAt(moves([0, 0, 1, 1]), 1).pose.head[0]).toBeCloseTo(20, 8);
});

test("walk gait derives its speed from the same eased distance as the body", () => {
  const actor = performance(),
    keys = moves("linear", true);
  const a = actor.bodyAt(keys, 1),
    b = actor.bodyAt(keys, 1.05);
  expect(a.at[0]).toBeCloseTo(1, 8);
  expect(a.speed).toBeCloseTo((b.at[0] - a.at[0]) / 0.05, 8);
  expect(a.speed).toBeCloseTo(1, 8);
  expect(actor.bodyAt(keys, 0).at[0]).toBe(0);
  expect(actor.bodyAt(keys, 4).at[0]).toBe(4);
});

test("unsupported easing and invalid Bezier time handles fail before playing", () => {
  const actor = performance();
  expect(() => actor.bodyAt(moves("typo"), 0)).toThrow("ease");
  expect(() => actor.bodyAt(moves([-1, 0, 1, 1]), 0)).toThrow("ease");
});
