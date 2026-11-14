// framecheck.mjs: the encoded video's picture faults, measured at the film's own shape
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const FRAMECHECK = fileURLToPath(new URL("../framecheck.mjs", import.meta.url));

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
