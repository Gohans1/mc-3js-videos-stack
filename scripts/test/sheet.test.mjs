// scripts/review/sheet.py: a cut up close names the shots either side, and the rows that place it
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SHEET = resolve(dirname(fileURLToPath(import.meta.url)), "../review/sheet.py");

test("sheet cut N says which shots meet there and the transition between them; a video that is not there is a wrong word", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sheet-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "renders"));
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  const ff = spawnSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=320x180:r=30:d=3",
    "-pix_fmt",
    "yuv420p",
    join(dir, "renders/draft_video.mp4"),
  ]);
  assert.equal(ff.status, 0, String(ff.stderr));
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
  const sheet = (...args) =>
    spawnSync("python", [SHEET, ...args], { cwd: dir, encoding: "utf8", timeout: 60000 });

  const cut = sheet("renders/draft_video.mp4", "cut", "1");
  assert.equal(cut.status, 0, cut.stdout + cut.stderr);
  assert.match(
    cut.stdout,
    /cut 1 at 2\.00 s: from shot 1 "his hand" into shot 2 "the hall", dissolve 0\.5 s \(src\/timeline\/shots\.json \[2\]\.transition\)/,
  );
  assert.match(cut.stdout, /next: bun run at 2 /);

  const gone = sheet("renders/nope.mp4", "1");
  assert.equal(gone.status, 2, gone.stdout + gone.stderr);
  assert.match(gone.stderr, /no renders\/nope\.mp4 \(the videos here: renders\/draft_video\.mp4\)/);

  // seconds as notes print them, the clock bun run at and AT= read
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
  const ff = spawnSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=320x180:r=30:d=3",
    "-pix_fmt",
    "yuv420p",
    join(dir, video),
  ]);
  assert.equal(ff.status, 0, String(ff.stderr));
  writeFileSync(join(dir, "renders/cuts.json"), JSON.stringify(cuts));
  const sheet = (...args) =>
    spawnSync("python", [SHEET, ...args], { cwd: dir, encoding: "utf8", timeout: 60000 });
  return Object.assign(sheet, { dir });
};

test("sheet shots on a chunk lays out the shots of that chunk, in film seconds", (t) => {
  const sheet = film(t, [10, 61, 62], "renders/chunks/c02.mp4");
  const r = sheet("renders/chunks/c02.mp4", "shots");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /3 shots: a frame from the middle of each, in order \(shot 1 first\)/);
  assert.match(r.stdout, /60\.5s, 61\.5s, 62\.5s/);
});

test("sheet cut N near the film's start shows the frames there are instead of refusing", (t) => {
  const sheet = film(t, [0.1, 2]);
  const r = sheet("renders/draft_video.mp4", "cut", "0");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /cut 0 at 0\.10 s/);
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
    const r = spawnSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=gray:s=64x36",
      "-frames:v",
      "1",
      join(sheet.dir, "renders", name),
    ]);
    assert.equal(r.status, 0, String(r.stderr));
  }
  const r = sheet();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /renders\/sheet_0\.jpg {2}1s, 2\.5s\r?\n/);
});

test("--help after the video still prints the help", (t) => {
  const sheet = film(t, []);
  const r = sheet("renders/draft_video.mp4", "--help");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Contact sheets for self-review/);
});
