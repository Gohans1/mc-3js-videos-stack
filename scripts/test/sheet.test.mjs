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

  const clock = sheet("renders/draft_video.mp4", "0:01,0:02.5");
  assert.equal(clock.status, 0, clock.stdout + clock.stderr);
  const bad = sheet("renders/draft_video.mp4", "0:75");
  assert.equal(bad.status, 2, bad.stdout + bad.stderr);
  assert.match(
    bad.stderr,
    /takes heard seconds \(65, 1:05 or 01:05\.250\), with commas; got 0:75: a minute holds 0-59 s, did you mean 1:15\?/,
  );
});

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

test("sheet vs --pairs crops off the DIFF x3 third and lays out wider 2-panel REF | OURS tiles", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sheet-vs-pairs-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "renders"));
  for (const name of ["vs_still_1s.jpg", "vs_still_2s.jpg"]) {
    const made = spawnSync(
      "python",
      [
        "-c",
        [
          "from PIL import Image, ImageDraw; import sys",
          "im = Image.new('RGB', (294, 196), (24, 24, 28))",
          "d = ImageDraw.Draw(im)",
          "d.rectangle([0, 36, 89, 195], fill=(220, 40, 40))",
          "d.rectangle([102, 36, 191, 195], fill=(40, 40, 220))",
          "d.rectangle([204, 36, 293, 195], fill=(40, 220, 40))",
          "im.save(sys.argv[1], quality=95)",
        ].join("\n"),
        join(dir, "renders", name),
      ],
      { encoding: "utf8", timeout: 15_000 },
    );
    assert.equal(made.status, 0, made.stderr);
  }
  const r = spawnSync("python", [SHEET, "vs", "--pairs"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = join(dir, "renders/sheet_vs_0.jpg");
  const check = spawnSync(
    "python",
    [
      "-c",
      [
        "from PIL import Image; import numpy as np, json, sys",
        "im = Image.open(sys.argv[1]).convert('RGB')",
        "arr = np.asarray(im)",
        "green_pixels = int(((arr[:,:,1] > 170) & (arr[:,:,0] < 90) & (arr[:,:,2] < 90)).sum())",
        "print(json.dumps({'w': im.width, 'h': im.height, 'green': green_pixels}))",
      ].join("\n"),
      out,
    ],
    { encoding: "utf8", timeout: 15_000 },
  );
  assert.equal(check.status, 0, check.stderr);
  const info = JSON.parse(check.stdout);
  assert.equal(info.green, 0, "DIFF x3 green panel must be cropped out");
  assert.ok(info.h > info.w / 3 * 0.8, `2-panel aspect should be taller than 3-panel: ${info.w}x${info.h}`);
});

test("sheet image list auto-appends .jpg on extensionless --out and --ref pairs existing stills beside a reference video", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sheet-ref-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  mkdirSync(join(dir, "renders"));
  mkdirSync(join(dir, "references"));
  media(join(dir, "references/ref.mp4"), [
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=180x320:r=30:d=3",
    "-pix_fmt",
    "yuv420p",
  ]);
  for (const name of ["still_0.5s.jpg", "still_1.5s.jpg"]) {
    const made = spawnSync(
      "python",
      [
        "-c",
        [
          "from PIL import Image, ImageDraw; import sys",
          "im = Image.new('RGB', (180, 340), (30, 80, 220))",
          "ImageDraw.Draw(im).rectangle([0, 320, 179, 339], fill=(10, 10, 10))",
          "im.save(sys.argv[1], quality=95)",
        ].join("\n"),
        join(dir, "renders", name),
      ],
      { encoding: "utf8", timeout: 15_000 },
    );
    assert.equal(made.status, 0, made.stderr);
  }

  const extless = "renders/temp_grid";
  const r1 = spawnSync(
    "python",
    [SHEET, "renders/still_0.5s.jpg", "renders/still_1.5s.jpg", "--out", extless],
    { cwd: dir, encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(r1.status, 0, r1.stdout + r1.stderr);
  assert.equal(
    spawnSync("python", ["-c", "from PIL import Image; import sys; Image.open(sys.argv[1]).verify()", join(dir, `${extless}.jpg`)]).status,
    0,
  );

  const refOut = join(dir, "renders/paired_vs.jpg");
  const r2 = spawnSync(
    "python",
    [SHEET, "--ref", "references/ref.mp4", "--out", "renders/paired_vs.jpg"],
    { cwd: dir, encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  const check = spawnSync(
    "python",
    [
      "-c",
      [
        "from PIL import Image; import numpy as np, json, sys",
        "arr = np.asarray(Image.open(sys.argv[1]).convert('RGB'))",
        "red = int(((arr[:,:,0] > 180) & (arr[:,:,1] < 80) & (arr[:,:,2] < 80)).sum())",
        "blue = int(((arr[:,:,2] > 180) & (arr[:,:,0] < 80)).sum())",
        "print(json.dumps({'red': red, 'blue': blue}))",
      ].join("\n"),
      refOut,
    ],
    { encoding: "utf8", timeout: 15_000 },
  );
  assert.equal(check.status, 0, check.stderr);
  const counts = JSON.parse(check.stdout);
  assert.ok(counts.red > 5000, `expected REF red panel pixels, got ${counts.red}`);
  assert.ok(counts.blue > 5000, `expected OURS blue panel pixels, got ${counts.blue}`);
});
