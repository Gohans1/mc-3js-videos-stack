// scripts/review/sheet.py: a cut up close names the shots either side, as the notes number them, and the rows that place it
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
    /cut 1 at 2\.00 s: from shot 1 "his hand" into shot 2 "the hall" \(as the notes number them\), dissolve 0\.5 s \(src\/timeline\/shots\.json \[2\]\.transition\)/,
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
  assert.match(bad.stderr, /takes heard seconds \(65, 1:05 or 01:05\.250\), with commas; got 0:75/);
});
