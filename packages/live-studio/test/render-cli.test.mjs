// render.mjs refuses a second past the film's end, or a CHECK range that runs backwards, before it builds anything
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { STUDIO } from "../src/film.mjs";

const RENDER = fileURLToPath(new URL("../render.mjs", import.meta.url));

test("render refuses AT past the end and a backwards CHECK at once, saying the film's length", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "render-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  const edit = JSON.parse(readFileSync(join(dir, "src/edit.json"), "utf8"));
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ ...edit, end: 10 }));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ "live-studio": {} }));
  const render = (env, what = "stills") =>
    spawnSync("bun", [RENDER, what], {
      cwd: dir,
      encoding: "utf8",
      timeout: 20000,
      env: { ...process.env, LIVE_PROJECT: dir, ...env },
    });

  const late = render({ AT: "4,99" });
  assert.equal(late.status, 2, late.stdout + late.stderr);
  assert.match(late.stderr, /AT 99 is past the film's end: it runs 0-10\.00 s heard/);
  assert.doesNotMatch(late.stdout + late.stderr, /build/i);

  const chunk = render({ CHUNKS: "3" }, "clip");
  assert.equal(chunk.status, 2, chunk.stdout + chunk.stderr);
  assert.match(chunk.stderr, /CHUNKS 3 is past the film's end: it has chunks 0-0/);

  const back = render({ AT: "4", CHECK: "motion:cam,6,5" });
  assert.equal(back.status, 2, back.stdout + back.stderr);
  assert.match(back.stderr, /CHECK motion:cam,6,5: from 6 must come before to 5/);

  // the page crashed Chrome on a range before the film starts
  const early = render({ AT: "4", CHECK: "motion:cam,-1,2" });
  assert.equal(early.status, 2, early.stdout + early.stderr);
  assert.match(early.stderr, /CHECK motion:cam,-1,2: from -1 is before the film starts \(0\)/);
});
