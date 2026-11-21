// render.mjs refuses a second past the film's end, or a --check range that runs backwards, before it builds anything
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

import { STUDIO } from "../src/film.mjs";

const RENDER = fileURLToPath(new URL("../render.mjs", import.meta.url));

const copyDemo = (dir) => {
  cpSync(join(STUDIO, "demo/src"), join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "node_modules"));
  symlinkSync(
    resolve(STUDIO, "../film-stage"),
    join(dir, "node_modules/film-stage"),
    process.platform === "win32" ? "junction" : "dir",
  );
};

test("render refuses --at past the end and a backwards --check at once, saying the film's length", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "render-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  copyDemo(dir);
  const edit = JSON.parse(readFileSync(join(dir, "src/edit.json"), "utf8"));
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ ...edit, end: 10 }));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ "live-studio": {} }));
  const render = (flags, what = "stills") =>
    spawnSync("bun", [RENDER, what, ...flags], {
      cwd: dir,
      encoding: "utf8",
      timeout: 20000,
      env: { ...process.env, LIVE_PROJECT: dir },
    });

  const late = render(["--at", "4,99"]);
  assert.equal(late.status, 2, late.stdout + late.stderr);
  assert.match(late.stderr, /--at 99 is past the film's end: it runs 0-10\.00 s heard/);
  assert.doesNotMatch(late.stdout + late.stderr, /build/i);

  // 10.02 s draws frame 301, past the last one: the page refuses it, so render does before clearing the old stills
  const hair = render(["--at", "10.02"]);
  assert.equal(hair.status, 2, hair.stdout + hair.stderr);
  assert.match(hair.stderr, /--at 10\.02 is past the film's end/);

  const chunk = render(["--chunks", "3"], "clip");
  assert.equal(chunk.status, 2, chunk.stdout + chunk.stderr);
  assert.match(chunk.stderr, /--chunks 3 is past the film's end: it has chunks 0-0/);

  const back = render(["--at", "4", "--check", "motion:cam,6,5"]);
  assert.equal(back.status, 2, back.stdout + back.stderr);
  assert.match(back.stderr, /--check motion:cam,6,5: from 6 must come before to 5/);

  // the page crashed Chrome on a range before the film starts
  const early = render(["--at", "4", "--check", "motion:cam,-1,2"]);
  assert.equal(early.status, 2, early.stdout + early.stderr);
  assert.match(early.stderr, /--check motion:cam,-1,2: from -1 is before the film starts \(0\)/);

  // seconds as notes print them: --at passes, and --check reads 0:06 and 0:05 as 6 and 5
  const clock = render(["--at", "0:04", "--check", "motion:cam,0:06,0:05"]);
  assert.equal(clock.status, 2, clock.stdout + clock.stderr);
  assert.match(clock.stderr, /from 6 must come before to 5/);

  const extra = render(["--at", "4", "--check", "motion:cam,1,2,3"]);
  assert.equal(extra.status, 2, extra.stdout + extra.stderr);
  assert.match(
    extra.stderr,
    /--check motion:cam,1,2,3: motion takes 3 values, <target>,<from s>,<to s>; got 4/,
  );
  const empty = render(["--check", "order:10.01,10.04"]);
  assert.equal(empty.status, 2, empty.stdout + empty.stderr);
  assert.match(empty.stderr, /order.*starts at or after the film's end/);
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
  copyDemo(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ "live-studio": { chrome: relative(dir, chrome) } }),
  );
  const scene = join(dir, "src/scene.ts");
  writeFileSync(scene, `${readFileSync(scene, "utf8")}\nconst twice = 1;\nconst twice = 2;\n`);
  const out = spawnSync("bun", [RENDER, "stills", "--at", "1"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 60000,
    env: { ...process.env, LIVE_PROJECT: dir },
  });
  const said = out.stdout + out.stderr;
  assert.equal(out.status, 1, said);
  assert.match(out.stderr, /src\/scene\.ts:\d+:\d+: Identifier `twice` has already been declared/);
  assert.match(out.stderr, /the film's code does not build: fix it, then bun run render again/);
  assert.equal(stripVTControlCharacters(said), said, "no colour codes");
  assert.doesNotMatch(said, /node_modules|rolldown/);
});

test("--span is refused before any build when it is misplaced, backwards, or starts past the last frame", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "render-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  copyDemo(dir);
  const edit = JSON.parse(readFileSync(join(dir, "src/edit.json"), "utf8"));
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ ...edit, end: 10 }));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ "live-studio": {} }));
  const render = (flags, what = "clip") =>
    spawnSync("bun", [RENDER, what, ...flags], {
      cwd: dir,
      encoding: "utf8",
      timeout: 20000,
      env: { ...process.env, LIVE_PROJECT: dir },
    });

  const stills = render(["--span", "1,2"], "stills");
  assert.equal(stills.status, 2, stills.stdout + stills.stderr);
  assert.match(stills.stderr, /--span is for render clip/);

  const both = render(["--span", "1,2", "--chunks", "0"]);
  assert.equal(both.status, 2, both.stdout + both.stderr);
  assert.match(both.stderr, /--span and --chunks each pick what to draw: one at a time/);

  const back = render(["--span", "4,2"]);
  assert.equal(back.status, 2, back.stdout + back.stderr);
  assert.match(back.stderr, /--span takes two heard seconds, the first before the second/);

  // a 10 s film's last frame shows 9.967 s: a span from 9.99 would draw no frame at all
  const tail = render(["--span", "9.99,10.04"]);
  assert.equal(tail.status, 2, tail.stdout + tail.stderr);
  assert.match(tail.stderr, /--span 9\.99,10\.04 starts after the film's last frame \(9\.97 s\)/);
  assert.doesNotMatch(tail.stdout + tail.stderr, /build/i);
});

test("captions, final and stills refuse the options they would ignore", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "render-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  copyDemo(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ "live-studio": {} }));
  const render = (what, flags = []) =>
    spawnSync("bun", [RENDER, what, ...flags], {
      cwd: dir,
      encoding: "utf8",
      timeout: 20000,
      env: { ...process.env, LIVE_PROJECT: dir },
    });

  const clip = render("clip", ["--check", "motion:cam,1,2"]);
  assert.equal(clip.status, 2, clip.stdout + clip.stderr);
  assert.match(clip.stderr, /--check goes with render stills/);

  const alone = render("captions");
  assert.equal(alone.status, 0, alone.stdout + alone.stderr);
  assert.match(alone.stdout.trim().split(/\r?\n/).at(-1), /^next: /);

  const captions = render("captions", ["--at", "4"]);
  assert.equal(captions.status, 2, captions.stdout + captions.stderr);
  assert.match(captions.stderr, /--at does nothing for render captions/);
  const captionsBlur = render("captions", ["--samples", "8"]);
  assert.equal(captionsBlur.status, 2, captionsBlur.stdout + captionsBlur.stderr);
  assert.match(captionsBlur.stderr, /--samples does nothing for render captions/);

  // a final takes half an hour and is the upload: a check goes on the stills before it
  const final = render("final", ["--check", "motion:cam,1,2"]);
  assert.equal(final.status, 2, final.stdout + final.stderr);
  assert.match(final.stderr, /--check goes with render stills/);

  // --samples blurs the film's stills: a --check run without --at draws none, an --entry page draws its own
  const blurNone = render("stills", ["--check", "motion:cam,1,2", "--samples", "8"]);
  assert.equal(blurNone.status, 2, blurNone.stdout + blurNone.stderr);
  assert.match(
    blurNone.stderr,
    /--samples blurs stills, and a --check run without --at draws none/,
  );
  mkdirSync(join(dir, "lab"));
  writeFileSync(join(dir, "lab/page.ts"), "");
  const blurLab = render("stills", ["--entry", "lab/page.ts", "--at", "1", "--samples", "8"]);
  assert.equal(blurLab.status, 2, blurLab.stdout + blurLab.stderr);
  assert.match(blurLab.stderr, /an --entry page draws its own pictures/);
});

test("render poster refuses a missing --at, --list and an unknown --res", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "render-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  copyDemo(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ "live-studio": {} }));
  const render = (flags) =>
    spawnSync("bun", [RENDER, "poster", ...flags], {
      cwd: dir,
      encoding: "utf8",
      timeout: 20000,
      env: { ...process.env, LIVE_PROJECT: dir },
    });

  const none = render([]);
  assert.equal(none.status, 2, none.stdout + none.stderr);
  assert.match(none.stderr, /poster takes --at <s>, the heard second to draw/);

  const list = render(["--at", "1", "--list"]);
  assert.equal(list.status, 2, list.stdout + list.stderr);
  assert.match(list.stderr, /--list draws over drafts only/);

  const res = render(["--at", "1", "--res", "720"]);
  assert.equal(res.status, 2, res.stdout + res.stderr);
  assert.match(res.stderr, /--res is 1440 \(the default; 1080 for Shorts\), 2160 or 1080/);
});

test("render poster draws one frame at the upload's size, no strip under it, and keeps the draft stills", (t) => {
  const chrome = resolve(
    STUDIO,
    "../../vault/tools/chrome-headless-shell/chrome-headless-shell.exe",
  );
  if (!existsSync(chrome)) return t.skip("no headless Chrome in the vault (bun run setup:vault)");
  const dir = mkdtempSync(join(tmpdir(), "render-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  copyDemo(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ "live-studio": { chrome: relative(dir, chrome) } }),
  );
  mkdirSync(join(dir, "renders"));
  writeFileSync(join(dir, "renders/still_4s.jpg"), "");
  const out = spawnSync("bun", [RENDER, "poster", "--at", "1", "--res", "1080", "--samples", "2"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 180000,
    env: { ...process.env, LIVE_PROJECT: dir },
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

// the demo with the vault's Chrome, null without it; a scene that draws `end` seconds
const chromeFilm = (t, end, conf = {}) => {
  const chrome = resolve(
    STUDIO,
    "../../vault/tools/chrome-headless-shell/chrome-headless-shell.exe",
  );
  if (!existsSync(chrome)) return null;
  const dir = mkdtempSync(join(tmpdir(), "render-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  copyDemo(dir);
  const scene = join(dir, "src/scene.ts");
  writeFileSync(
    scene,
    readFileSync(scene, "utf8").replace("const END = 16;", `const END = ${end};`),
  );
  const edit = JSON.parse(readFileSync(join(dir, "src/edit.json"), "utf8"));
  writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ ...edit, end }));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ "live-studio": { chrome: relative(dir, chrome), ...conf } }),
  );
  const render = (what, flags = []) =>
    spawnSync("bun", [RENDER, what, ...flags], {
      cwd: dir,
      encoding: "utf8",
      timeout: 180000,
      env: { ...process.env, LIVE_PROJECT: dir },
    });
  return { dir, render };
};

test("a render that fails ends on what to do next", (t) => {
  const film = chromeFilm(t, 16);
  if (!film) return t.skip("no headless Chrome in the vault (bun run setup:vault)");
  const out = film.render("stills", ["--check", "motion:nope,1,2"]);
  assert.equal(out.status, 1, out.stdout + out.stderr);
  assert.match(out.stderr, /ERROR no "nope"/);
  assert.match(out.stdout.trim().split(/\r?\n/).at(-1), /^next: /);
});

test("render final's captions are named as the upload's picture, never as the draft", (t) => {
  const film = chromeFilm(t, 1);
  if (!film) return t.skip("no headless Chrome in the vault (bun run setup:vault)");
  const out = film.render("final", ["--res", "1080", "--samples", "1"]);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.ok(existsSync(join(film.dir, "renders/final_video.srt")), out.stdout);
  assert.ok(
    !existsSync(join(film.dir, "renders/draft_video.srt")),
    "the draft's captions untouched",
  );
});

test("a --chunks run that joins a chunk drawn before a narration move still says the video is stale", async (t) => {
  // the mouths follow the narration clips: a scene that reads the sound timeline draws them
  const film = chromeFilm(t, 31, { soundTimeline: "src/timeline/audio.json" });
  if (!film) return t.skip("no headless Chrome in the vault (bun run setup:vault)");
  const scene = join(film.dir, "src/scene.ts");
  writeFileSync(
    scene,
    `import * as THREE from "three";
import sound from "./timeline/audio.json";
globalThis.filmSound = sound;
export const DURATION = 31, SHOTS_OUT = [];
export const buildScene = (canvas: HTMLCanvasElement, W: number, H: number) => {
  const renderer = new THREE.WebGLRenderer({ canvas });
  renderer.setSize(W, H, false);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
  return () => renderer.render(scene, camera);
};`,
  );
  mkdirSync(join(film.dir, "src/timeline"));
  const audio = (at) =>
    writeFileSync(
      join(film.dir, "src/timeline/audio.json"),
      JSON.stringify({ narration: "voice", sfx: [{ name: "voice", at, start: 0, length: 2 }] }),
    );
  const { staleVideo } = await import("../src/stale.mjs");
  audio(1);
  const span = film.render("clip", ["--span", "0.12,0.8"]);
  assert.equal(span.status, 0, span.stdout + span.stderr);
  const file = "renders/span_0.13-0.8.mp4";
  assert.ok(span.stdout.includes(`bun run sheet ${file} overview`));
  assert.equal(staleVideo(film.dir, file), null);
  audio(1.4);
  assert.match(staleVideo(film.dir, file)?.message, /narration clips moved/);
  audio(1);
  const whole = film.render("clip");
  assert.equal(whole.status, 0, whole.stdout + whole.stderr);
  const { renderCuts } = await import("../src/video.mjs");
  assert.equal(renderCuts(film.dir, "renders/draft_video.mp4").status, "bound");
  audio(30.2);
  const part = film.render("clip", ["--chunks", "0"]);
  assert.equal(part.status, 0, part.stdout + part.stderr);
  assert.match(part.stdout, /chunk 1 was drawn before the film's last change/);
  assert.equal(renderCuts(film.dir, "renders/draft_video.mp4").status, "unavailable");
  assert.match(
    staleVideo(film.dir, join(film.dir, "renders/draft_video.mp4"))?.message ?? "fresh",
    /narration clips moved/,
  );
});

test("--entry folder and running outside a film exit 2 before any build, and a dead Chrome fails fast instead of hanging", (t) => {
  const empty = mkdtempSync(join(tmpdir(), "render-empty-"));
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  const outside = spawnSync("bun", [RENDER, "stills"], {
    cwd: empty,
    encoding: "utf8",
    timeout: 20000,
    env: { ...process.env, LIVE_PROJECT: empty },
  });
  assert.equal(outside.status, 2, outside.stdout + outside.stderr);
  assert.match(outside.stderr, /cd films\/<name> first/);

  const dir = mkdtempSync(join(tmpdir(), "render-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  copyDemo(dir);
  mkdirSync(join(dir, "lab"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ "live-studio": { chrome: process.execPath } }),
  );
  const badEntry = spawnSync("bun", [RENDER, "stills", "--entry", "lab"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 20000,
    env: { ...process.env, LIVE_PROJECT: dir },
  });
  assert.equal(badEntry.status, 2, badEntry.stdout + badEntry.stderr);
  assert.match(badEntry.stderr, /--entry lab is no file in the film/);

  const deadChrome = spawnSync("bun", [RENDER, "stills", "--at", "1"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 20000,
    env: { ...process.env, LIVE_PROJECT: dir },
  });
  assert.equal(deadChrome.status, 1, deadChrome.stdout + deadChrome.stderr);
  assert.match(deadChrome.stderr, /ERROR Chrome exited/);
  assert.match(deadChrome.stdout.trim().split(/\r?\n/).at(-1), /^next: /);
});

test("--check motion:cam works without draw.tools.free, and seen/touch name missing hooks instead of crashing", (t) => {
  const film = chromeFilm(t, 1);
  if (!film) return t.skip("no headless Chrome in the vault (bun run setup:vault)");
  const scene = join(film.dir, "src/scene.ts");
  writeFileSync(
    scene,
    `import * as THREE from "three";
export const DURATION = 1, SHOTS_OUT = [];
export const buildScene = (canvas: HTMLCanvasElement, W: number, H: number) => {
  const renderer = new THREE.WebGLRenderer({ canvas });
  renderer.setSize(W, H, false);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
  camera.position.set(0, 1, 3);
  return Object.assign((t: number) => { camera.position.x = t; renderer.render(scene, camera); }, { tools: { scene, camera } });
};`,
  );
  const cam = film.render("stills", ["--check", "motion:cam,0,0.4"]);
  assert.equal(cam.status, 0, cam.stdout + cam.stderr);

  writeFileSync(
    scene,
    `import * as THREE from "three";
export const DURATION = 1, SHOTS_OUT = [];
export const buildScene = (canvas: HTMLCanvasElement, W: number, H: number) => {
  const renderer = new THREE.WebGLRenderer({ canvas });
  renderer.setSize(W, H, false);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
  return () => renderer.render(scene, camera);
};`,
  );
  for (const kind of ["seen", "touch"]) {
    const out = film.render("stills", ["--check", `${kind}:hero,0,0.4`]);
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(
      out.stderr,
      new RegExp(`ERROR --check ${kind} requires draw\\.tools\\.scene and draw\\.tools\\.camera`),
    );
    assert.doesNotMatch(out.stderr, /TypeError/);
  }
});

test("--check motion:cam attributes the active camera FOV snap during Freeze to the output-clock key", (t) => {
  const film = chromeFilm(t, 4, {
    camTimeline: "src/cam.json",
    timingTimeline: "src/timing.json",
  });
  if (!film) return t.skip("no headless Chrome in the vault (bun run setup:vault)");
  writeFileSync(
    join(film.dir, "src/timing.json"),
    JSON.stringify({ freezes: [{ at: 0.5, duration: 2 }] }),
  );
  writeFileSync(
    join(film.dir, "src/cam.json"),
    JSON.stringify([0, 0.75, 1.25, 2.25, 4].map((t) => ({ t, p: [0, 1, 3], l: [0, 1, 0] }))),
  );
  writeFileSync(
    join(film.dir, "src/scene.ts"),
    `import * as THREE from "three";
export const DURATION = 4, SHOTS_OUT = [{ t: 0, cameraClock: "output" }];
export function buildScene(canvas, W, H) {
  const renderer = new THREE.WebGLRenderer({ canvas });
  renderer.setSize(W, H, false);
  const scene = new THREE.Scene();
  const start = new THREE.PerspectiveCamera(70, W / H, 0.1, 100);
  const shot = new THREE.PerspectiveCamera(60, W / H, 0.1, 100);
  let camera = start;
  shot.position.set(0, 1, 3);
  return Object.assign((world, clocks) => {
    camera = clocks.camera >= 1 ? shot : start;
    if (camera === shot) camera.fov = clocks.camera >= 1.5 ? 30 : 60;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }, { tools: { scene, get camera() { return camera; } } });
}`,
  );

  const result = film.render("stills", ["--check", "motion:cam,2,2.4"]);
  const output = result.stdout + result.stderr;
  assert.equal(result.status, 0, output);
  assert.match(output, /POP 2\.25: field of view jumps 30\.0.*cam keys \[2->3\] row 2/);
  assert.ok(existsSync(join(film.dir, "renders/motion_cam_2-2.4_turn.jpg")));
}, 30000);

test("--check order awaits custom frames, writes evidence for state leaks and leaves the film's video alone", (t) => {
  const film = chromeFilm(t, 1);
  assert.ok(film, "headless Chrome is required for order verification");
  const scene = join(film.dir, "src/scene.ts");
  const source = (
    stateful,
  ) => `export const DURATION = 1, SHOTS_OUT = [{t:0},{t:0.5,transition:{fx:'of:transitions/dissolve',len:0.2}}];
export function buildScene(canvas, W, H) {
  canvas.width=W; canvas.height=H; const ctx=canvas.getContext('2d'); let n=0;
  return Object.assign(() => { throw Error('sync draw must not replace renderFrame'); }, {
    async renderFrame(t) { await new Promise(r=>setTimeout(r,1)); ctx.fillStyle='rgb('+(${stateful ? "++n * 7" : "Math.round(t * 200)"})+',0,0)'; ctx.fillRect(0,0,W,H); }
  });
}`;
  writeFileSync(scene, source(false));
  const pass = film.render("stills", ["--check", "order:0:00,0:00.8"]);
  assert.equal(pass.status, 0, pass.stdout + pass.stderr);
  const file = join(film.dir, "renders/order.json");
  const report = JSON.parse(readFileSync(file, "utf8"));
  assert.ok(report.times.includes(0.5));
  assert.deepEqual(report.failures, []);
  assert.ok(report.times.every((s) => s >= 0 && s < 0.8));
  assert.ok(!existsSync(join(film.dir, "renders/draft_video.mp4")));

  writeFileSync(scene, source(true));
  const fail = film.render("stills", ["--check", "order:0,0.8"]);
  assert.equal(fail.status, 1, fail.stdout + fail.stderr);
  assert.match(fail.stderr, /ERROR order:.*depend on draw order/);
  const bad = JSON.parse(readFileSync(file, "utf8"));
  assert.ok(bad.failures.length > 0);
  for (const image of bad.evidence) assert.ok(existsSync(join(film.dir, image)));
  assert.match(fail.stdout.trim().split(/\r?\n/).at(-1), /^next: /);
}, 60000);

test("--samples gives a still the shutter's motion blur; without it a still is the one instant", (t) => {
  const film = chromeFilm(t, 2);
  if (!film) return t.skip("no headless Chrome in the vault (bun run setup:vault)");
  // red climbs 3000 a second from 128 at 1 s: the half-frame shutter after 1 s averages to about 153
  writeFileSync(
    join(film.dir, "src/scene.ts"),
    `export const DURATION=2, SHOTS_OUT=[];
export function buildScene(canvas,W,H){canvas.width=W;canvas.height=H;const g=canvas.getContext('2d');return (t)=>{g.fillStyle='rgb('+Math.min(255,Math.max(0,Math.round(128+(t-1)*3000)))+',0,0)';g.fillRect(0,0,W,H);};}`,
  );
  const red = () => {
    const pixel = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        join(film.dir, "renders/still_1s.jpg"),
        "-vf",
        "format=rgb24,crop=1:1:0:0",
        "-f",
        "rawvideo",
        "-",
      ],
      { timeout: 10000 },
    );
    assert.equal(pixel.status, 0, pixel.stderr.toString());
    return pixel.stdout[0];
  };
  const sharp = film.render("stills", ["--at", "1"]);
  assert.equal(sharp.status, 0, sharp.stdout + sharp.stderr);
  assert.doesNotMatch(sharp.stdout, /sub-frames/);
  const instant = red();
  assert.ok(Math.abs(instant - 128) <= 3, `one instant: expected red 128, got ${instant}`);
  const blurred = film.render("stills", ["--at", "1", "--samples", "8"]);
  assert.equal(blurred.status, 0, blurred.stdout + blurred.stderr);
  assert.match(blurred.stdout, /wrote renders\/still_1s\.jpg \(stills: 8 sub-frames\)/);
  const averaged = red();
  assert.ok(
    Math.abs(averaged - 153) <= 4,
    `the shutter's average: expected red 153, got ${averaged}`,
  );
}, 60000);

test("native async frames preserve source time and layer clocks through Speed and Freeze", (t) => {
  const film = chromeFilm(t, 2, { timingTimeline: "src/timing.json" });
  assert.ok(film, "headless Chrome is required for async timing verification");
  writeFileSync(
    join(film.dir, "src/timing.json"),
    JSON.stringify({ speeds: [{ from: 0, to: 2, rate: 2 }], freezes: [{ at: 1, duration: 0.5 }] }),
  );
  writeFileSync(
    join(film.dir, "src/scene.ts"),
    `export const DURATION=2, SHOTS_OUT=[];
export function buildScene(canvas,W,H){canvas.width=W;canvas.height=H;const g=canvas.getContext('2d');return Object.assign(()=>{throw Error('use async hook')},{async renderFrame(t,clocks){if(!clocks)throw Error('missing layer clocks');await Promise.resolve();g.fillStyle='rgb('+Math.round(t*100)+',0,0)';g.fillRect(0,0,W,H);}});}`,
  );
  const rendered = film.render("stills", ["--at", "0.25,0.75"]);
  assert.equal(rendered.status, 0, rendered.stdout + rendered.stderr);
  for (const [heard, red] of [
    [0.25, 50],
    [0.75, 100],
  ]) {
    const pixel = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        join(film.dir, `renders/still_${heard}s.jpg`),
        "-vf",
        "format=rgb24,crop=1:1:0:0",
        "-f",
        "rawvideo",
        "-",
      ],
      { timeout: 10000 },
    );
    assert.equal(pixel.status, 0, pixel.stderr.toString());
    assert.ok(
      Math.abs(pixel.stdout[0] - red) <= 3,
      `heard ${heard}: expected red ${red}, got ${pixel.stdout[0]}`,
    );
  }
}, 30000);

test("render rejects invalid --crop rects and --crop/--compare on video targets", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "render-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  copyDemo(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ "live-studio": {} }));
  const run = (args, flags = []) =>
    spawnSync("bun", [RENDER, ...args, ...flags], {
      cwd: dir,
      encoding: "utf8",
      timeout: 20000,
      env: { ...process.env, LIVE_PROJECT: dir },
    });

  const badCrop = run(["stills"], ["--crop", "0.8,0,0.5,0.5"]);
  assert.equal(badCrop.status, 2);
  assert.match(badCrop.stderr, /--crop:.*0\.\.1/);

  const cropClip = run(["clip"], ["--crop", "0.25,0.25,0.5,0.5"]);
  assert.equal(cropClip.status, 2);
  assert.match(cropClip.stderr, /--crop is for render stills or poster/);

  const cmpClip = run(["--compare", "clip"]);
  assert.equal(cmpClip.status, 2);
  assert.match(cmpClip.stderr, /--compare is for render stills or poster/);

  const cmpFinal = run(["final", "--compare"]);
  assert.equal(cmpFinal.status, 2);
  assert.match(cmpFinal.stderr, /--compare is for render stills or poster/);

  const cmpCaptions = run(["--compare", "captions"]);
  assert.equal(cmpCaptions.status, 2);
  assert.match(cmpCaptions.stderr, /--compare is for render stills or poster/);
});

const findBrowser = () => {
  const candidates = [
    process.env.CHROME,
    resolve(STUDIO, "../../vault/tools/chrome-headless-shell/chrome-headless-shell.exe"),
    String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`,
    String.raw`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? null;
};

const sampleCenterRgb = (imagePath) => {
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", imagePath],
    { encoding: "utf8", timeout: 10000 },
  );
  assert.equal(probe.status, 0, probe.stderr);
  const [w, h] = probe.stdout.trim().split(",").map(Number);
  const px = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      imagePath,
      "-vf",
      `format=rgb24,crop=1:1:${Math.floor(w / 2)}:${Math.floor((h - 40) / 2)}`,
      "-f",
      "rawvideo",
      "-",
    ],
    { timeout: 10000 },
  );
  assert.equal(px.status, 0, px.stderr?.toString());
  return { w, h, rgb: [px.stdout[0], px.stdout[1], px.stdout[2]] };
};

const setupQuadFilm = (t, chrome, tlHex = "0xdd2222") => {
  const dir = mkdtempSync(join(tmpdir(), "render-crop-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  copyDemo(dir);
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({ ...JSON.parse(readFileSync(join(dir, "src/edit.json"), "utf8")), end: 2 }),
  );
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ "live-studio": { chrome: relative(dir, chrome) } }),
  );
  const sceneFile = join(dir, "src/scene.ts");
  const cameraModule = JSON.stringify(
    resolve(STUDIO, "../film-stage/src/camera.ts").replaceAll("\\", "/"),
  );
  const makeScene = (hex) => `import * as THREE from "three";
import { orthographicCamera, projectCamera } from ${cameraModule};
export const DURATION = 2, SHOTS_OUT = [{ t: 0, what: "quadrants" }];
export function buildScene(canvas, W, H) {
  const renderer = new THREE.WebGLRenderer({ canvas, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  const scene = new THREE.Scene();
  const perspective = new THREE.PerspectiveCamera(60, W / H, 0.1, 100);
  const ortho = orthographicCamera(60, W / H);
  for (const camera of [perspective, ortho]) {
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    scene.add(camera);
  }
  let camera = perspective;
  const quad = (x, y, c) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshBasicMaterial({ color: c }));
    m.position.set(x, y, 0);
    scene.add(m);
  };
  quad(-6, 6, ${hex});
  quad(6, 6, 0x11dd33);
  quad(-6, -6, 0x1144ee);
  quad(6, -6, 0xeedd11);
  return Object.assign((t) => {
    camera = t >= 1 ? ortho : perspective;
    projectCamera(camera, W, H);
    renderer.render(scene, camera);
  }, { tools: { scene, get camera() { return camera; } } });
}`;
  writeFileSync(sceneFile, makeScene(tlHex));
  const render = (args, flags = []) =>
    spawnSync("bun", [RENDER, ...args, ...flags], {
      cwd: dir,
      encoding: "utf8",
      timeout: 180000,
      env: { ...process.env, LIVE_PROJECT: dir },
    });
  return { dir, sceneFile, makeScene, render };
};

test("render --crop zooms quadrant RGB pixels and sizes non-square and poster crops", (t) => {
  const chrome = findBrowser();
  if (!chrome) return t.skip("no Chrome binary available for live --crop verification");
  const { dir, render } = setupQuadFilm(t, chrome);

  const tl = render(["stills"], ["--at", "1", "--crop", "0,0,0.5,0.5"]);
  assert.equal(tl.status, 0, tl.stdout + tl.stderr);
  const tlInfo = sampleCenterRgb(join(dir, "renders/still_1s.jpg"));
  assert.ok(
    tlInfo.rgb[0] > 180 && tlInfo.rgb[1] < 60 && tlInfo.rgb[2] < 60,
    `expected red, got ${tlInfo.rgb}`,
  );

  const br = render(["stills"], ["--at", "1", "--crop", "0.5,0.5,0.5,0.5"]);
  assert.equal(br.status, 0, br.stdout + br.stderr);
  const brInfo = sampleCenterRgb(join(dir, "renders/still_1s.jpg"));
  assert.ok(
    brInfo.rgb[0] > 180 && brInfo.rgb[1] > 180 && brInfo.rgb[2] < 60,
    `expected yellow, got ${brInfo.rgb}`,
  );

  const tall = render(["stills"], ["--at", "1", "--crop", "0.5,0,0.25,0.5"]);
  assert.equal(tall.status, 0, tall.stdout + tall.stderr);
  const tallInfo = sampleCenterRgb(join(dir, "renders/still_1s.jpg"));
  assert.equal(tallInfo.w, 640);
  assert.equal(tallInfo.h, 760);
  assert.ok(tallInfo.rgb[1] > 170 && tallInfo.rgb[0] < 60, `expected green, got ${tallInfo.rgb}`);

  const poster = render(
    ["poster"],
    ["--at", "1", "--res", "1080", "--samples", "1", "--crop", "0.5,0,0.25,0.5"],
  );
  assert.equal(poster.status, 0, poster.stdout + poster.stderr);
  assert.match(poster.stdout, /wrote renders\/poster_1s\.png \(960x1080, 1 sub-frames\)/);
});

test("render --compare preserves renders/.prev/, emits diff sheet, and surfaces corrupt .prev error", (t) => {
  const chrome = findBrowser();
  if (!chrome) return t.skip("no Chrome binary available for live --compare verification");
  const { dir, sceneFile, makeScene, render } = setupQuadFilm(t, chrome);

  const tlBefore = render(["stills"], ["--at", "1", "--crop", "0,0,0.5,0.5"]);
  assert.equal(tlBefore.status, 0, tlBefore.stdout + tlBefore.stderr);

  writeFileSync(sceneFile, makeScene("0x11dddd"));
  const tlAfter = render(["--compare", "stills"], ["--at", "1", "--crop", "0,0,0.5,0.5"]);
  assert.equal(tlAfter.status, 0, tlAfter.stdout + tlAfter.stderr);
  assert.ok(existsSync(join(dir, "renders/.prev/still_1s.jpg")));
  assert.ok(existsSync(join(dir, "renders/compare_still_1s.png")));
  assert.match(tlAfter.stdout, /compare renders\/still_1s\.jpg: .* changed/);

  writeFileSync(join(dir, "renders/still_1s.jpg"), "not-an-image");
  const corrupt = render(["--compare", "stills"], ["--at", "1", "--crop", "0,0,0.5,0.5"]);
  assert.equal(corrupt.status, 1, corrupt.stdout + corrupt.stderr);
  assert.match(corrupt.stderr, /compare renders\/still_1s\.jpg failed/);
});

test("--ref refuses what would not put our picture beside the reference's frame, before building anything", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "render-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  copyDemo(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ "live-studio": {} }));
  mkdirSync(join(dir, "references"));
  writeFileSync(join(dir, "references/ref.mp4"), "");
  const render = (flags, what = "stills") =>
    spawnSync("bun", [RENDER, what, ...flags], {
      cwd: dir,
      encoding: "utf8",
      timeout: 20000,
      env: { ...process.env, LIVE_PROJECT: dir },
    });
  const refused = (env, why, what) => {
    const run = render(env, what);
    assert.equal(run.status, 2, run.stdout + run.stderr);
    assert.match(run.stderr, why);
  };
  refused(
    ["--ref", "references/missing.mp4"],
    /--ref references\/missing\.mp4 is no file in the film/,
  );
  refused(["--ref", "references/ref.mp4"], /--ref goes with stills or poster/, "clip");
  refused(
    ["--ref", "references/ref.mp4", "--crop", "0,0,1,1"],
    /--ref and --crop draw another picture/,
  );
  refused(["--ref", "references/ref.mp4", "--list"], /--ref and --list draw another picture/);
  refused(["--ref-region", "0,0,0.5,0.5"], /--ref-region goes with --ref <reference video>/);
});
