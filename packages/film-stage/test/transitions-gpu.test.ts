import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";

import { TRANSITIONS } from "../src/transitions";
import { openPage } from "./gpu";

let page: Awaited<ReturnType<typeof openPage>>;
beforeAll(async () => {
  page = await openPage(join(import.meta.dir, "gpu/transitions-page.ts"));
}, 60_000);
afterAll(() => page?.close());

test("every built-in transition compiles in WebGL and hands the red shot over to the blue one", async () => {
  type Frame = { compiled: boolean; r: number; b: number };
  const at = (id: string, t: number) => page.run<Frame>(`frameAt(${JSON.stringify(id)}, ${t})`);
  const redder = (m: Frame) => m.r - m.b;
  for (const { id } of TRANSITIONS) {
    const early = await at(id, 0.8),
      late = await at(id, 1.2);
    expect(early.compiled && late.compiled, id).toBe(true);
    expect(redder(early), id).toBeGreaterThan(redder(late));
  }
});
