// render.mjs refuses a second past the film's end, or a CHECK range that runs backwards, before it builds anything
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

  // 10.02 s draws frame 301, past the last one: the page refuses it, so render does before clearing the old stills
  const hair = render({ AT: "10.02" });
  assert.equal(hair.status, 2, hair.stdout + hair.stderr);
  assert.match(hair.stderr, /AT 10\.02 is past the film's end/);

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

test("SPAN is refused before any build when it is misplaced, backwards, or starts past the last frame", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "render-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  const edit = JSON.parse(readFileSync(join(dir, "src/edit.json"), "utf8"));
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ ...edit, end: 10 }));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ "live-studio": {} }));
  const render = (env, what = "clip") =>
    spawnSync("bun", [RENDER, what], {
      cwd: dir,
      encoding: "utf8",
      timeout: 20000,
      env: { ...process.env, LIVE_PROJECT: dir, ...env },
    });

  const stills = render({ SPAN: "1,2" }, "stills");
  assert.equal(stills.status, 2, stills.stdout + stills.stderr);
  assert.match(stills.stderr, /SPAN is for render clip/);

  const both = render({ SPAN: "1,2", CHUNKS: "0" });
  assert.equal(both.status, 2, both.stdout + both.stderr);
  assert.match(both.stderr, /SPAN and CHUNKS each pick what to draw: one at a time/);

  const back = render({ SPAN: "4,2" });
  assert.equal(back.status, 2, back.stdout + back.stderr);
  assert.match(back.stderr, /SPAN takes two heard seconds, the first before the second/);

  // a 10 s film's last frame shows 9.967 s: a span from 9.99 would draw no frame at all
  const tail = render({ SPAN: "9.99,10.04" });
  assert.equal(tail.status, 2, tail.stdout + tail.stderr);
  assert.match(tail.stderr, /SPAN 9\.99,10\.04 starts after the film's last frame \(9\.97 s\)/);
  assert.doesNotMatch(tail.stdout + tail.stderr, /build/i);
});

test("captions and final refuse the options they would ignore", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "render-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ "live-studio": {} }));
  const render = (what, env) =>
    spawnSync("bun", [RENDER, what], {
      cwd: dir,
      encoding: "utf8",
      timeout: 20000,
      env: { ...process.env, LIVE_PROJECT: dir, ...env },
    });

  const clip = render("clip", { CHECK: "motion:cam,1,2" });
  assert.equal(clip.status, 2, clip.stdout + clip.stderr);
  assert.match(clip.stderr, /CHECK goes with render stills/);

  const alone = render("captions", {});
  assert.equal(alone.status, 0, alone.stdout + alone.stderr);
  assert.match(alone.stdout.trim().split(/\r?\n/).at(-1), /^next: /);

  const captions = render("captions", { AT: "4" });
  assert.equal(captions.status, 2, captions.stdout + captions.stderr);
  assert.match(captions.stderr, /AT does nothing for render captions/);

  // a final takes half an hour and is the upload: a check goes on the stills before it
  const final = render("final", { CHECK: "motion:cam,1,2" });
  assert.equal(final.status, 2, final.stdout + final.stderr);
  assert.match(final.stderr, /CHECK goes with render stills/);
});

test("render poster refuses a missing AT, LIST=1 and an unknown RES", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "render-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ "live-studio": {} }));
  const render = (env) =>
    spawnSync("bun", [RENDER, "poster"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 20000,
      env: { ...process.env, LIVE_PROJECT: dir, ...env },
    });

  const none = render({});
  assert.equal(none.status, 2, none.stdout + none.stderr);
  assert.match(none.stderr, /poster takes AT=<s>, the heard second to draw/);

  const list = render({ AT: "1", LIST: "1" });
  assert.equal(list.status, 2, list.stdout + list.stderr);
  assert.match(list.stderr, /LIST=1 draws over drafts only/);

  const res = render({ AT: "1", RES: "720" });
  assert.equal(res.status, 2, res.stdout + res.stderr);
  assert.match(res.stderr, /RES is 1440 \(the default; 1080 for Shorts\), 2160 or 1080/);
});

test("render poster draws one frame at the upload's size, no strip under it, and keeps the draft stills", (t) => {
  const chrome = resolve(
    STUDIO,
    "../../vault/tools/chrome-headless-shell/chrome-headless-shell.exe",
  );
  if (!existsSync(chrome)) return t.skip("no headless Chrome in the vault (bun run setup:vault)");
  const dir = mkdtempSync(join(tmpdir(), "render-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ "live-studio": { chrome: relative(dir, chrome) } }),
  );
  mkdirSync(join(dir, "renders"));
  writeFileSync(join(dir, "renders/still_4s.jpg"), "");
  const out = spawnSync("bun", [RENDER, "poster"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 180000,
    env: { ...process.env, LIVE_PROJECT: dir, AT: "1", RES: "1080", SAMPLES: "2" },
  });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /wrote renders\/poster_1s\.png \(1920x1080, 2 sub-frames\)/);
  // a draft frame is taller than its picture by the strip; the poster is the picture alone
  const probe = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_name,width,height",
      "-of",
      "csv=p=0",
      join(dir, "renders/poster_1s.png"),
    ],
    { encoding: "utf8" },
  );
  assert.equal(probe.stdout.trim(), "png,1920,1080");
  assert.ok(existsSync(join(dir, "renders/still_4s.jpg")), "the draft stills are kept");
});
