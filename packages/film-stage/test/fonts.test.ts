import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";

import { openPage } from "./gpu";

let page: Awaited<ReturnType<typeof openPage>>;
beforeAll(async () => {
  page = await openPage(join(import.meta.dir, "gpu/fonts-page.ts"));
}, 60_000);
afterAll(() => page?.close());

test("every font the studio offers has a face loaded by titles.ts, never a silent system fallback", async () => {
  expect(await page.run<string[]>("missingFonts()")).toEqual([]);
});
