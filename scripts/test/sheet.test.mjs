// scripts/review/sheet.py: a cut up close names the shots either side, and the rows that place it
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { mediaFixture } from "./media-fixture.mjs";

const SHEET = resolve(dirname(fileURLToPath(import.meta.url)), "../review/sheet.py");
const media = mediaFixture();

test("sheet cut N says which shots meet there and the transition between them; a video that is not there is a wrong word", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sheet-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "renders"));
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  writeFileSync(join(dir, "src/scene.ts"), "");
  writeFileSync(join(dir, "src/edit.json"), '{"end":3}');
  writeFileSync(join(dir, "renders/cuts.json"), "[1, 2]");
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ "live-studio": { shotsTimeline: "src/timeline/shots.json" } }),
  );
  writeFileSync(
    join(dir, "src/timeline/shots.json"),
    JSON.stringify([
      { t: 0, name: "wide on the door" },
      { t: 1, name: "his hand" },
      { t: 2, name: "the hall", transition: { fx: "dissolve", len: 0.5 } },
    ]),
  );
  media(join(dir, "renders/draft_video.mp4"), [
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=320x180:r=30:d=3",
    "-pix_fmt",
    "yuv420p",
  ]);
  const sheet = (...args) =>
    spawnSync("python", [SHEET, ...args], { cwd: dir, encoding: "utf8", timeout: 60000 });

  const cut = sheet("renders/draft_video.mp4", "cut", "1");
  assert.equal(cut.status, 0, cut.stdout + cut.stderr);
  assert.match(
    cut.stdout,
    /cut 1 at 2\.00 s: from shot 1 "his hand" into shot 2 "the hall", dissolve 0\.5 s \(src\/timeline\/shots\.json \[2\]\.transition\)/,
  );
  assert.match(cut.stdout, /bun run at 2 names every row/);

  const gone = sheet("renders/nope.mp4", "1");
  assert.equal(gone.status, 2, gone.stdout + gone.stderr);
  assert.match(gone.stderr, /no renders\/nope\.mp4 \(the videos here: renders\/draft_video\.mp4\)/);

  // seconds as notes print them, the clock bun run at and render --at read
  const clock = sheet("renders/draft_video.mp4", "0:01,0:02.5");
  assert.equal(clock.status, 0, clock.stdout + clock.stderr);
  const bad = sheet("renders/draft_video.mp4", "0:75");
  assert.equal(bad.status, 2, bad.stdout + bad.stderr);
  assert.match(
    bad.stderr,
    /takes heard seconds \(65, 1:05 or 01:05\.250\), with commas; got 0:75: a minute holds 0-59 s, did you mean 1:15\?/,
  );
});

// a film folder with a 3 s draft (or a chunk of one) and the cuts its render wrote
const film = (t, cuts, video = "renders/draft_video.mp4") => {
  const dir = mkdtempSync(join(tmpdir(), "sheet-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "renders/chunks"), { recursive: true });
  mkdirSync(join(dir, "renders/final_chunks"));
  media(join(dir, video), [
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=320x180:r=30:d=3",
    "-pix_fmt",
    "yuv420p",
  ]);
  writeFileSync(join(dir, "renders/cuts.json"), JSON.stringify(cuts));
  utimesSync(join(dir, "renders/cuts.json"), 1000, 1000);
  const sheet = (...args) =>
    spawnSync("python", [SHEET, ...args], { cwd: dir, encoding: "utf8", timeout: 60000 });
  return Object.assign(sheet, { dir });
};

test("sheet shots on a chunk lays out the shots of that chunk, in film seconds", (t) => {
  const sheet = film(t, [10, 61, 62], "renders/chunks/c02.mp4");
  const r = sheet("renders/chunks/c02.mp4", "shots");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(
    r.stdout,
    /3 shots between the render's cuts: a frame from the middle of each, in order/,
  );
  // a render's cuts count camera keys with cut: true too, so these are no shots.json rows to number
  assert.doesNotMatch(r.stdout, /shot \d+ first/);
  assert.match(r.stdout, /60\.5s, 61\.5s, 62\.5s/);
});

test("sheet cut N near the film's start shows the frames there are instead of refusing", (t) => {
  const sheet = film(t, [0.1, 2]);
  const r = sheet("renders/draft_video.mp4", "cut", "0");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /cut 0 at 0\.10 s/);
});

test("cut uses current film context; stale and external files keep their frame commands", (t) => {
  const sheet = film(t, [1], "renders/reference.mp4");
  const foreign = sheet("renders/reference.mp4", "cut", "0");
  assert.equal(foreign.status, 2);
  assert.match(foreign.stderr, /overview or frames TIMES/);
  copyFileSync(
    join(sheet.dir, "renders/reference.mp4"),
    join(sheet.dir, "renders/draft_video.mp4"),
  );
  mkdirSync(join(sheet.dir, "src"));
  writeFileSync(join(sheet.dir, "src/scene.ts"), "");
  utimesSync(join(sheet.dir, "renders/draft_video.mp4"), 1000, 1000);
  const stale = sheet("renders/draft_video.mp4", "shots");
  assert.equal(stale.status, 2);
  assert.match(stale.stderr, /older than src\/scene\.ts/);
  assert.equal(sheet("renders/draft_video.mp4", "frames", "1").status, 0);
});

test("sheet cut on a film of one shot says so instead of naming cuts 0--1", (t) => {
  const sheet = film(t, []);
  const r = sheet("renders/draft_video.mp4", "cut", "0");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no cuts: the film is one shot/);
});

test("a video named wrong is the fault named, even before the film has cuts", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sheet-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = spawnSync("python", [SHEET, "renders/nope.mp4", "shots"], {
    cwd: dir,
    encoding: "utf8",
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no renders\/nope\.mp4/);
});

test("sheet lays out the render's stills and leaves any other still_*.jpg out", (t) => {
  const sheet = film(t, []);
  for (const name of ["still_1s.jpg", "still_2.5s.jpg", "still_test.jpg"]) {
    media(join(sheet.dir, "renders", name), [
      "-f",
      "lavfi",
      "-i",
      "color=c=gray:s=64x36",
      "-frames:v",
      "1",
    ]);
  }
  const r = sheet();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /renders\/sheet_0\.jpg {2}1s, 2\.5s\r?\n/);
});

test("--start without a video is refused, never read as the stills' clock", (t) => {
  const sheet = film(t, []);
  for (const args of [
    ["--start", "60"],
    ["a.png", "--start", "60"],
  ]) {
    const r = sheet(...args);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /--start goes with a video/);
  }
});

test("--help after the video still prints the help", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sheet-help-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = spawnSync("python", [SHEET, "renders/draft_video.mp4", "--help"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Contact sheets for self-review/);
});

test("a span or a final chunk is read on the film's clock from its name", (t) => {
  const span = film(t, [], "renders/span_40-43.mp4");
  const r = span("renders/span_40-43.mp4", "41");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /film seconds from 40 s on \(the span's start\)/);

  const final = film(t, [], "renders/final_chunks/c02.mp4");
  const f = final("renders/final_chunks/c02.mp4", "61");
  assert.equal(f.status, 0, f.stdout + f.stderr);
  assert.match(f.stdout, /film seconds from 60 s on \(the chunk's start\)/);
});

test("a span named past what --start takes is a wrong word, not a crash", (t) => {
  const sheet = film(t, [], "renders/span_9999999-9999999.mp4");
  const r = sheet("renders/span_9999999-9999999.mp4", "1");
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.doesNotMatch(r.stderr, /Traceback/);
  assert.match(r.stderr, /span_9999999-9999999\.mp4 starts at film second 9999999/);
});

test("sheet shots counts the shots it lays out", (t) => {
  // a 0.03 s shot between cuts at 1 and 1.03 is too short to show
  const sheet = film(t, [1, 1.03]);
  const r = sheet("renders/draft_video.mp4", "shots");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /2 shots between the render's cuts: a frame from the middle of each/);
});

test("a start between two thousandths still holds the frames cut lays out next to it", (t) => {
  const video = "renders/span_10.0144-13.0144.mp4";
  const sheet = film(t, [10.1], video);
  const r = spawnSync("python", [SHEET, video, "cut", "0"], {
    cwd: sheet.dir,
    encoding: "utf8",
    timeout: 60000,
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  // 0.25 and 0.15 s before the cut both fall before the video: its first frame, once
  assert.match(r.stdout, /10\.0144s, 10\.05s, 10\.15s, 10\.25s, 10\.45s/);
});

test("only a render's chunks folder makes a chunk: my_chunks/c02.mp4 starts at 0", (t) => {
  const sheet = film(t, []);
  mkdirSync(join(sheet.dir, "renders/my_chunks"));
  copyFileSync(
    join(sheet.dir, "renders/draft_video.mp4"),
    join(sheet.dir, "renders/my_chunks/c02.mp4"),
  );
  const r = sheet("renders/my_chunks/c02.mp4", "1");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /film seconds from/);
});

test("a broken renders/cuts.json is named, not a traceback", (t) => {
  const sheet = film(t, []);
  writeFileSync(join(sheet.dir, "renders/cuts.json"), "[1,");
  const r = sheet("renders/draft_video.mp4", "shots");
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.doesNotMatch(r.stderr, /Traceback/);
  assert.match(r.stderr, /renders\/cuts\.json is no list of seconds/);
});

test("a second under a thousandth is laid out with the others", (t) => {
  const sheet = film(t, []);
  const r = sheet("renders/draft_video.mp4", "0.00005,1");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /2 pictures/);
});

test("a cuts.json of anything but a list of seconds is refused, never read as cuts", (t) => {
  const sheet = film(t, []);
  for (const bad of ['{"1": 2}', '"123"', "[1, -2]", "[1, Infinity]"]) {
    writeFileSync(join(sheet.dir, "renders/cuts.json"), bad);
    const r = sheet("renders/draft_video.mp4", "shots");
    assert.equal(r.status, 1, `${bad}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /renders\/cuts\.json is no list of seconds/);
  }
});

test("the last line says what to do next, a cut's row lookup included; --start takes heard seconds", (t) => {
  const sheet = film(t, [1, 2]);
  mkdirSync(join(sheet.dir, "src"));
  writeFileSync(join(sheet.dir, "src/scene.ts"), "export const DURATION = 3;");
  utimesSync(join(sheet.dir, "src/scene.ts"), 1000, 1000);
  let cut = sheet("renders/draft_video.mp4", "cut", "1");
  assert.equal(cut.status, 0, cut.stdout + cut.stderr);
  assert.match(cut.stdout, /bun run render stills --at 2 --list/);
  assert.doesNotMatch(cut.stdout, /bun run at 2/);
  writeFileSync(join(sheet.dir, "src/edit.json"), '{"end":3}');
  utimesSync(join(sheet.dir, "src/scene.ts"), 1000, 1000);
  utimesSync(join(sheet.dir, "src/edit.json"), 1000, 1000);
  cut = sheet("renders/draft_video.mp4", "cut", "1");
  assert.match(
    cut.stdout.trim().split(/\r?\n/).at(-1),
    /^next: open it to look; bun run at 2 names every row that places it/,
  );
  const plain = sheet("renders/draft_video.mp4", "1");
  assert.match(plain.stdout.trim().split(/\r?\n/).at(-1), /^next: open it to look/);
  const r = spawnSync("python", [SHEET, "renders/draft_video.mp4", "1:01", "--start", "1:00"], {
    cwd: sheet.dir,
    encoding: "utf8",
    timeout: 60000,
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /manual seconds from 60 s on \(--start\)/);
});

test("sheet cut tolerates broken package.json or shotsTimeline metadata instead of crashing", (t) => {
  const sheet = film(t, [1, 2]);
  writeFileSync(join(sheet.dir, "package.json"), "{not-json");
  utimesSync(join(sheet.dir, "package.json"), 1000, 1000);
  const brokenPkg = sheet("renders/draft_video.mp4", "cut", "1");
  assert.equal(brokenPkg.status, 0, brokenPkg.stdout + brokenPkg.stderr);
  assert.doesNotMatch(brokenPkg.stderr, /Traceback/);

  mkdirSync(join(sheet.dir, "src/timeline"), { recursive: true });
  writeFileSync(
    join(sheet.dir, "package.json"),
    JSON.stringify({ "live-studio": { shotsTimeline: "src/timeline/shots.json" } }),
  );
  writeFileSync(
    join(sheet.dir, "src/timeline/shots.json"),
    JSON.stringify([
      { t: 0, name: "a" },
      { t: 1, name: "b" },
      { t: 2, name: "c", transition: { fx: "wipe", len: null } },
    ]),
  );
  utimesSync(join(sheet.dir, "package.json"), 1000, 1000);
  utimesSync(join(sheet.dir, "src/timeline/shots.json"), 1000, 1000);
  const nullLen = sheet("renders/draft_video.mp4", "cut", "1");
  assert.equal(nullLen.status, 0, nullLen.stdout + nullLen.stderr);
  assert.match(nullLen.stdout, /wipe 0 s/);
});

test("bare bun run sheet without renders/still_*.jpg exits 2 with a clear hint", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sheet-no-stills-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = spawnSync("python", [SHEET], { cwd: dir, encoding: "utf8" });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /no renders\/still_\*\.jpg/);
});
