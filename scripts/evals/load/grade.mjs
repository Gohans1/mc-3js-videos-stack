import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { openPage } from "../../../packages/film-stage/test/gpu.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const dir = join(
  root,
  "scripts/evals/load/runs",
  `lut-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`,
);
mkdirSync(dir, { recursive: true });
const result = {
  complete: false,
  callsPerSample: 46,
  sourceSha256: createHash("sha256")
    .update(readFileSync(join(root, "packages/film-stage/src/grade.ts")))
    .digest("hex"),
  browser: "",
  samples: [],
};
const save = () => writeFileSync(join(dir, "results.json"), JSON.stringify(result, null, 2) + "\n");
let page;
const stop = setTimeout(() => {
  save();
  page?.close();
  process.exit(1);
}, 90_000);
try {
  page = await openPage(join(root, "packages/film-stage/test/gpu/grade-page.ts"));
  result.browser = await page.run("navigator.userAgent");
  await page.run("finishLutTrial(5)");
  for (let i = 0; i < 5; i++) {
    const sample = await page.run("finishLutTrial(5)");
    assert.ok(Number.isFinite(sample.ms) && sample.invalidates.every(Boolean));
    result.samples.push(sample);
    save();
  }
  result.complete = true;
  save();
  console.log(JSON.stringify({ path: join(dir, "results.json"), ...result }));
} finally {
  clearTimeout(stop);
  page?.close();
}
