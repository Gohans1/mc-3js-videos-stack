import { expect, test } from "bun:test";

import { makePerformance } from "../../packages/mc-actor/src/perform";

const { bodyAt } = makePerformance({ poses: { stand: () => ({}) } });

test("new mocap is applied only once the edited move can be rendered", async () => {
  const { makeMocapMoves } = await import("../../templates/film/src/mocap-moves");
  const initial = [{ t: 0, at: [0, 0, 0], yaw: 0, pose: "stand" }];
  const edited = [...initial, { t: 2, at: [3, 0, 0], yaw: 0, clip: "ual2/Edit" }];
  const baked = { duration: 1, at: () => ({ root: { x: 0, z: 0 }, head: [0, 0, 30] }) };
  const download = Promise.withResolvers<Record<string, typeof baked>>();
  const moves = await makeMocapMoves(initial, (refs) =>
    refs.length ? download.promise : Promise.resolve({}),
  );

  const pending = moves.prepare(edited);
  expect(bodyAt(moves.read(edited), 2, moves.clips).at).toEqual([0, 0, 0]);

  download.resolve({ "ual2/Edit": baked });
  await pending;
  const applied = bodyAt(moves.read(edited), 2, moves.clips);
  expect(applied.at).toEqual([3, 0, 0]);
  expect(applied.pose.head).toEqual([0, 0, 30]);
});

test("a failed mocap edit leaves the picture usable and a new edit can recover", async () => {
  const { makeMocapMoves } = await import("../../templates/film/src/mocap-moves");
  const initial = [{ t: 0, at: [0, 0, 0], yaw: 0, pose: "stand" }];
  const broken = [{ t: 0, at: [3, 0, 0], yaw: 0, clip: "ual2/Unknown" }];
  const repaired = [{ t: 0, at: [1, 0, 0], yaw: 0, pose: "stand" }];
  const moves = await makeMocapMoves(initial, async (refs) => {
    if (refs.length) throw new Error("Mocap animation was not found");
    return {};
  });

  await expect(moves.prepare(broken)).rejects.toThrow("Mocap animation was not found");
  await moves.prepare(broken);
  expect(bodyAt(moves.read(broken), 0, moves.clips).at).toEqual([0, 0, 0]);

  await moves.prepare(repaired);
  expect(bodyAt(moves.read(repaired), 0, moves.clips).at).toEqual([1, 0, 0]);
});
