// render.mjs refuses a second past the film's end, or a CHECK range that runs backwards, before it builds anything
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

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

  // seconds as notes print them: AT passes, and CHECK reads 0:06 and 0:05 as 6 and 5
  const clock = render({ AT: "0:04", CHECK: "motion:cam,0:06,0:05" });
  assert.equal(clock.status, 2, clock.stdout + clock.stderr);
  assert.match(clock.stderr, /from 6 must come before to 5/);

  const extra = render({ AT: "4", CHECK: "motion:cam,1,2,3" });
  assert.equal(extra.status, 2, extra.stdout + extra.stderr);
  assert.match(
    extra.stderr,
    /CHECK motion:cam,1,2,3: motion takes 3 values, <target>,<from s>,<to s>; got 4/,
  );
});

test("a film whose code does not build is named by file and line, in plain words, with nothing rendered", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "render-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // the build comes after render finds its Chrome: the vault's, as every film names it
  const chrome = resolve(
    STUDIO,
    "../../vault/tools/chrome-headless-shell/chrome-headless-shell.exe",
  );
  if (!existsSync(chrome)) return t.skip("no headless Chrome in the vault (bun run setup:vault)");
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ "live-studio": { chrome: relative(dir, chrome) } }),
  );
  const scene = join(dir, "src/scene.ts");
  writeFileSync(scene, `${readFileSync(scene, "utf8")}\nconst twice = 1;\nconst twice = 2;\n`);
  const out = spawnSync("bun", [RENDER, "stills"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 60000,
    env: { ...process.env, LIVE_PROJECT: dir, AT: "1" },
  });
  const said = out.stdout + out.stderr;
  assert.equal(out.status, 1, said);
  assert.match(out.stderr, /src\/scene\.ts:\d+:\d+: Identifier `twice` has already been declared/);
  assert.match(out.stderr, /the film's code does not build: fix it, then bun run render again/);
  assert.equal(stripVTControlCharacters(said), said, "no colour codes");
  assert.doesNotMatch(said, /node_modules|rolldown/);
});
