import { expect, test } from "bun:test";
import { join } from "node:path";

import { openPage } from "./gpu";

test("an AI shader's published defaults and saved per-cut parameters change actual pixels", async () => {
  const page = await openPage(join(import.meta.dir, "gpu/custom-transition.ts"));
  try {
    const [source, edited, reset] = await page.run<number[]>("customTransitionProbe()");
    expect(source).toBeCloseTo(64, -1);
    expect(edited).toBeCloseTo(191, -1);
    expect(reset).toBe(source);
  } finally {
    page.close();
  }
}, 30000);
