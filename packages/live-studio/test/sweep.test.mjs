// sweep.mjs: one ranked list of what to fix in a whole draft, weighed against the film's reference
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { mediaFixture } from "../../../scripts/test/media-fixture.mjs";

const SWEEP = fileURLToPath(new URL("../sweep.mjs", import.meta.url));
const media = mediaFixture();

const film = (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sweep-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const d of ["src", "renders", "references"]) mkdirSync(join(dir, d));
  writeFileSync(join(dir, "src/scene.ts"), "");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ "live-studio": { ratio: "16:9" } }));
  return dir;
};
const sweep = (dir, ...args) =>
  spawnSync("bun", [SWEEP, ...args], {
    cwd: dir,
    encoding: "utf8",
    timeout: 120000,
    env: { ...process.env, LIVE_PROJECT: dir },
  });
const SOURCE = "testsrc2=s=192x108:r=30:d=8";

test("a stretch blurrier than the reference and one brighter than it are named with their seconds", (t) => {
  const dir = film(t);
  media(join(dir, "references/ref.mp4"), ["-f", "lavfi", "-i", SOURCE, "-pix_fmt", "yuv420p"]);
  media(join(dir, "renders/draft_video.mp4"), [
    "-f",
    "lavfi",
    "-i",
    SOURCE,
    "-vf",
    "boxblur=3:2:enable='between(t,1.5,3.5)',eq=brightness=0.3:enable='between(t,5,7)'",
    "-pix_fmt",
    "yuv420p",
  ]);
  const out = sweep(dir);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  const { items } = JSON.parse(readFileSync(join(dir, "renders/sweep.json"), "utf8"));
  const near = (kind, from, to) =>
    items.find(
      (x) => x.kind === kind && Math.abs(x.from - from) < 0.5 && Math.abs(x.to - to) < 0.5,
    );
  assert.ok(near("blurrier", 1.5, 3.5), JSON.stringify(items));
  assert.ok(near("brighter", 5, 7), JSON.stringify(items));
  assert.ok(!items.some((x) => x.from > 0.5 && x.to < 1.25), "the same picture is no finding");
  assert.match(
    out.stdout,
    /\nnext: bun run sheet renders\/draft_video\.mp4 frames [\d.]+-[\d.]+\/6 --vs references\/ref\.mp4/,
  );
  // the light fixed, the blur kept: the next sweep names what went and keeps the rest unmarked
  media(join(dir, "renders/draft_video.mp4"), [
    "-f",
    "lavfi",
    "-i",
    SOURCE,
    "-vf",
    "boxblur=3:2:enable='between(t,1.5,3.5)'",
    "-pix_fmt",
    "yuv420p",
  ]);
  const again = sweep(dir);
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.match(again.stdout, /since the last sweep: 0 new, gone .*\b[\d.]+-[\d.]+ brighter/);
  assert.doesNotMatch(again.stdout, /\(new\)/);
});

test("without a reference the draft's own faults still come, and the missing weighing is said", (t) => {
  const dir = film(t);
  media(join(dir, "renders/draft_video.mp4"), [
    "-f",
    "lavfi",
    "-i",
    "color=c=gray:s=96x54:r=30:d=2[bg];color=c=white:s=16x16:r=30:d=2[box];[bg][box]overlay=x='if(lt(t,1),4,60)':y=20",
    "-pix_fmt",
    "yuv420p",
  ]);
  const out = sweep(dir);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, / 1\.00 JUMP: /);
  assert.match(out.stdout, /no reference video in references\//);
});

test("a chunk is not a whole draft: exit 2, nothing measured", (t) => {
  const dir = film(t);
  mkdirSync(join(dir, "renders/chunks"));
  writeFileSync(join(dir, "renders/chunks/c01.mp4"), "");
  const out = sweep(dir, "renders/chunks/c01.mp4");
  assert.equal(out.status, 2);
  assert.match(out.stderr, /bun run framecheck renders\/chunks\/c01\.mp4/);
});
