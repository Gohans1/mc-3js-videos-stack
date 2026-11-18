import { expect, test } from "bun:test";
import { join } from "node:path";

import { openPage } from "../../film-stage/test/gpu.ts";
import { openFilmResource } from "../src/openfilm.mjs";

test("the Studio motion preview uses the asset duration", async () => {
  const page = await openPage(join(import.meta.dir, "gpu/openfilm-preview.tsx"), openFilmResource);
  try {
    expect(await page.run("previewDuration()")).toBe(500);
  } finally {
    page.close();
  }
}, 30000);
