// framecheck.mjs: the encoded video's picture faults, measured at the film's own shape
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { mediaFixture } from "../../../scripts/test/media-fixture.mjs";

const FRAMECHECK = fileURLToPath(new URL("../framecheck.mjs", import.meta.url));
const media = mediaFixture();

const film = (t, ratio) => {
  const dir = mkdtempSync(join(tmpdir(), "framecheck-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "renders"));
  writeFileSync(join(dir, "src/scene.ts"), "");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ "live-studio": { ratio } }));
  return dir;
};
const framecheck = (dir, ...args) =>
  spawnSync("bun", [FRAMECHECK, ...args], {
    cwd: dir,
    encoding: "utf8",
    timeout: 60000,
    env: { ...process.env, LIVE_PROJECT: dir },
  });

test("a Short's draft is measured whole: a box snapping in its lower half is a JUMP", (t) => {
  const dir = film(t, "9:16");
  // a 72x128 Short with an 8 px strip under it; a white box at y 90, far below the top 9:16-of-the-width band
  const r = spawnSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=gray:s=72x136:r=30:d=2[bg];color=c=white:s=24x24:r=30:d=2[box];[bg][box]overlay=x='if(lt(t,1),4,44)':y=90",
    "-pix_fmt",
    "yuv420p",
    join(dir, "renders/draft_video.mp4"),
  ]);
  assert.equal(r.status, 0, String(r.stderr));
  const out = framecheck(dir);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /JUMP 1\.00/);
});

test("a picture given in place of a video is a wrong word: exit 2, nothing measured", (t) => {
  const dir = film(t, "16:9");
  const r = spawnSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=gray:s=64x36",
    "-frames:v",
    "1",
    join(dir, "renders/still.png"),
  ]);
  assert.equal(r.status, 0, String(r.stderr));
  const out = framecheck(dir, "renders/still.png");
  assert.equal(out.status, 2);
  assert.match(out.stderr, /still\.png is no video/);
});

// 2 s at 30 fps, grey, turning white at the video's 1.00 s: a JUMP there
const flip = (file) => {
  media(file, [
    "-f",
    "lavfi",
    "-i",
    "color=c=gray:s=64x36:r=30:d=2[a];color=c=white:s=64x36:r=30:d=2[b];[a][b]overlay=enable='gte(t,1)'",
    "-pix_fmt",
    "yuv420p",
  ]);
};

test("a SPAN run's video is measured on the film's clock, with only the cuts inside it", (t) => {
  const dir = film(t, "16:9");
  flip(join(dir, "renders/span_9-11.mp4"));
  writeFileSync(join(dir, "renders/cuts.json"), "[3, 50]");
  const out = framecheck(dir, "renders/span_9-11.mp4");
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /film seconds from 9 s on \(the span's start\)/);
  assert.match(out.stdout, /0 cuts known/);
  assert.match(out.stdout, /JUMP 10\.00/);
});

test("a fault's picture is the frame before it, the frame, and the frame after", (t) => {
  const dir = film(t, "16:9");
  flip(join(dir, "renders/draft_video.mp4"));
  const out = framecheck(dir);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  // the left tile of the three is the last grey frame
  const px = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      join(dir, "renders/frames_JUMP_1.00.jpg"),
      "-vf",
      "crop=8:8:100:100,scale=1:1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "gray",
      "-",
    ],
    { encoding: "buffer" },
  );
  assert.equal(px.status, 0, String(px.stderr));
  assert.ok(px.stdout[0] < 200, `the frame before is grey, got ${px.stdout[0]}`);
  const at = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      join(dir, "renders/frames_JUMP_1.00.jpg"),
      "-vf",
      "crop=8:8:740:100,scale=1:1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "gray",
      "-",
    ],
    { encoding: "buffer" },
  );
  assert.ok(at.stdout[0] > 240, `the frame itself is white, got ${at.stdout[0]}`);
});

test("a fault in the upload's picture is drawn again by render final, never by render clip", (t) => {
  const dir = film(t, "16:9");
  mkdirSync(join(dir, "renders/final_chunks"));
  flip(join(dir, "renders/final_chunks/c01.mp4"));
  const chunk = framecheck(dir, "renders/final_chunks/c01.mp4");
  assert.equal(chunk.status, 0, chunk.stdout + chunk.stderr);
  assert.match(chunk.stdout, /JUMP 31\.00/);
  assert.match(chunk.stdout, /CHUNKS=1 bun run render final/);
  flip(join(dir, "renders/final_video.mp4"));
  const whole = framecheck(dir, "renders/final_video.mp4");
  assert.match(
    whole.stdout,
    /CHUNKS=0 bun run render final, then bun run mix renders\/final_video\.mp4/,
  );
});

test("a cuts.json that is no list of seconds is a fault named, not a crash", (t) => {
  const dir = film(t, "16:9");
  flip(join(dir, "renders/draft_video.mp4"));
  writeFileSync(join(dir, "renders/cuts.json"), "{}");
  const out = framecheck(dir);
  assert.equal(out.status, 1, out.stdout + out.stderr);
  assert.match(out.stderr, /renders\/cuts\.json is no list of seconds/);
});

test("a negative second in cuts.json is no cut: refused like any other broken cuts.json", (t) => {
  const dir = film(t, "16:9");
  flip(join(dir, "renders/draft_video.mp4"));
  writeFileSync(join(dir, "renders/cuts.json"), "[-1]");
  const out = framecheck(dir);
  assert.equal(out.status, 1, out.stdout + out.stderr);
  assert.match(out.stderr, /renders\/cuts\.json is no list of seconds/);
});

test("what comes after a clean upload picture is the mix and deliver; a fault in a mixed draft is mixed again", (t) => {
  const dir = film(t, "16:9");
  const still = spawnSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=64x36:r=30:d=2",
    "-pix_fmt",
    "yuv420p",
    join(dir, "renders/final_video.mp4"),
  ]);
  assert.equal(still.status, 0, String(still.stderr));
  const clean = framecheck(dir, "renders/final_video.mp4");
  assert.match(
    clean.stdout.trim().split(/\r?\n/).at(-1),
    /^next: [^\n]*bun run mix renders\/final_video\.mp4, then bun run deliver/,
  );
  flip(join(dir, "renders/draft.mp4"));
  const mixed = framecheck(dir, "renders/draft.mp4");
  assert.match(mixed.stdout, /bun run render clip, then bun run mix renders\/draft_video\.mp4/);
});

test("START takes heard seconds as notes print them", (t) => {
  const dir = film(t, "16:9");
  flip(join(dir, "renders/draft_video.mp4"));
  const out = spawnSync("bun", [FRAMECHECK], {
    cwd: dir,
    encoding: "utf8",
    timeout: 60000,
    env: { ...process.env, LIVE_PROJECT: dir, START: "1:00" },
  });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /JUMP 61\.00/);
  // the commands it hands on read the same seconds only with the same START
  assert.match(out.stdout.trim().split(/\r?\n/).at(-1), /then START=60 bun run framecheck again$/);
});
