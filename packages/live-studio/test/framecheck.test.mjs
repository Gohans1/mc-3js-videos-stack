// framecheck.mjs: the encoded video's picture faults, measured at the film's own shape
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { mediaFixture } from "../../../scripts/test/media-fixture.mjs";
import { writeRenderEvidence } from "../src/video.mjs";

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

// a remake copies its reference's moves: a jump the reference makes at the same heard second is not the first to look at
test("a jump the reference makes too is said so; one it does not is OURS ONLY", (t) => {
  const dir = film(t, "16:9");
  flip(join(dir, "renders/draft_video.mp4"));
  mkdirSync(join(dir, "references"));
  flip(join(dir, "references/ref.mp4"));
  const same = framecheck(dir);
  assert.equal(same.status, 0, same.stdout + same.stderr);
  assert.match(same.stdout, /JUMP 1\.00: .*; ref jumps too/);
  media(join(dir, "calm.mp4"), [
    "-f",
    "lavfi",
    "-i",
    "color=c=gray:s=64x36:r=30:d=2",
    "-pix_fmt",
    "yuv420p",
  ]);
  const calm = framecheck(dir, "--vs", "calm.mp4", "--json");
  assert.equal(calm.status, 0, calm.stdout + calm.stderr);
  const report = JSON.parse(calm.stdout);
  assert.equal(report.reference, "calm.mp4");
  const jump = report.findings.find((f) => f.kind === "JUMP");
  assert.equal(jump.reference.ours, true);
  assert.match(
    jump.reference.said,
    /^OURS ONLY: ours changes \d+\.\d%, the reference 0\.0% a frame$/,
  );
  assert.ok(jump.reference.oursChange > 0.3);
  // a reference busy every frame (a smeared whip measures under our sharp one) moves as fast: no pop of ours, and one
  // change between two stills is a single jump (a cut the render did not record), not a move in steps
  media(join(dir, "busy.mp4"), [
    "-f",
    "lavfi",
    "-i",
    "color=c=gray:s=64x36:r=30:d=2,noise=alls=100:allf=t",
    "-pix_fmt",
    "yuv420p",
  ]);
  const busy = framecheck(dir, "--vs", "busy.mp4");
  assert.equal(busy.status, 0, busy.stdout + busy.stderr);
  assert.match(
    busy.stdout,
    /JUMP 1\.00: .*; the reference moves fast here too \(\d+\.\d% a frame, ours \d+\.\d%\)/,
  );
});

test("a --vs video that is not there stops framecheck before it measures", (t) => {
  const dir = film(t, "16:9");
  flip(join(dir, "renders/draft_video.mp4"));
  const out = framecheck(dir, "--vs", "nope.mp4");
  assert.equal(out.status, 2);
  assert.match(out.stderr, /no nope\.mp4: --vs takes the reference video/);
  assert.doesNotMatch(out.stdout, /frames,/);
});

test("a SPAN run's video is measured on the film's clock, with only the cuts inside it", (t) => {
  const dir = film(t, "16:9");
  flip(join(dir, "renders/span_9-11.mp4"));
  const cuts = join(dir, "renders/cuts.json");
  writeFileSync(cuts, "[3, 50]");
  // written before the span, the list is the render's own
  const before = new Date(Date.now() - 60_000);
  utimesSync(cuts, before, before);
  const out = framecheck(dir, "renders/span_9-11.mp4");
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /film seconds from 9 s on \(the span's start\)/);
  assert.match(out.stdout, /0 cuts known/);
  assert.match(out.stdout, /JUMP 10\.00/);
  assert.match(out.stdout, /\(the render records no cut here; a planned freeze or pop can stay\)/);
});

test("a fault's picture is the frame before it, the frame, and the frame after", (t) => {
  const dir = film(t, "16:9");
  flip(join(dir, "renders/draft_video.mp4"));
  const out = framecheck(dir, "--json");
  assert.equal(out.status, 0, out.stdout + out.stderr);
  const report = JSON.parse(out.stdout);
  const jump = report.findings.find((finding) => finding.kind === "JUMP");
  assert.equal(jump?.fileTime, 1);
  const strip = join(dir, jump.strip);
  const next = JSON.parse(framecheck(dir, "--json").stdout);
  assert.notEqual(next.index, report.index);
  assert.ok(readFileSync(strip).length);
  // the left tile of the three is the last grey frame
  const px = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      strip,
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
      strip,
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

test("a foreign chunk name cannot borrow the film's cut or clock", (t) => {
  const dir = film(t, "16:9");
  mkdirSync(join(dir, "references/chunks"), { recursive: true });
  flip(join(dir, "references/chunks/c01.mp4"));
  writeFileSync(join(dir, "renders/cuts.json"), "[1, 31]");
  const out = framecheck(dir, "references/chunks/c01.mp4");
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /JUMP 1\.00/);
  assert.match(out.stdout, /file seconds/);
  assert.doesNotMatch(out.stdout, /bun run at |CHUNKS=/);
});

test("a stale picture is measured without jump exemptions from the current edit", (t) => {
  const dir = film(t, "16:9");
  const video = join(dir, "renders/draft_video.mp4");
  flip(video);
  writeFileSync(join(dir, "renders/cuts.json"), "[1]");
  utimesSync(video, 1000, 1000);
  const out = framecheck(dir);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /STALE/);
  assert.match(out.stdout, /JUMP 1\.00/);
  assert.doesNotMatch(out.stdout, /bun run at /);
});

// a move the reference makes every frame that ours makes in steps, a dead frame between them, is a stutter of ours
test("jumps with a still frame between them while the reference keeps moving are OURS STEPS", (t) => {
  const dir = film(t, "16:9");
  media(join(dir, "renders/draft_video.mp4"), [
    "-f",
    "lavfi",
    "-i",
    "color=c=gray:s=64x36:r=30:d=2[a];color=c=white:s=16x16:r=30:d=2[b];[a][b]overlay=x='mod(8*floor(n/3),48)':y=10",
    "-pix_fmt",
    "yuv420p",
  ]);
  mkdirSync(join(dir, "references"));
  media(join(dir, "references/ref.mp4"), [
    "-f",
    "lavfi",
    "-i",
    "color=c=gray:s=64x36:r=30:d=2[a];color=c=white:s=16x16:r=30:d=2[b];[a][b]overlay=x='abs(mod(t*300,96)-48)':y=10",
    "-pix_fmt",
    "yuv420p",
  ]);
  const out = framecheck(dir, "--json");
  assert.equal(out.status, 0, out.stdout + out.stderr);
  const jumps = JSON.parse(out.stdout).findings.filter((f) => f.kind === "JUMP");
  assert.ok(jumps.length > 3, JSON.stringify(jumps));
  for (const jump of jumps)
    assert.match(
      jump.reference.said,
      /^OURS STEPS: ours stops dead \(\d+\.\d% a frame\) beside it/,
    );
});

// CHUNKS=1 bun run render clip joins chunk 0 as it was drawn: the draft is stale for the timeline, while the cuts it was
// drawn with, the reference and the strip under the picture are still its own
test("a draft joining an older chunk keeps its recorded cuts and its reference", (t) => {
  const dir = film(t, "16:9");
  const video = join(dir, "renders/draft_video.mp4");
  flip(video);
  writeRenderEvidence(video, { cuts: [0.5], oldChunks: [0] });
  mkdirSync(join(dir, "references"));
  flip(join(dir, "references/ref.mp4"));
  const out = framecheck(dir, "--json");
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stderr, /STALE/);
  const report = JSON.parse(out.stdout);
  assert.deepEqual(report.cutsUsed, [0.5]);
  assert.equal(report.reference, "references/ref.mp4");
  const jump = report.findings.find((f) => f.kind === "JUMP");
  assert.match(jump.reference.said, /^ref jumps too/);
  assert.doesNotMatch(out.stderr, /bun run at /);
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

test("framecheck treats a long VFR hold as a hold rather than a brief flash", (t) => {
  const dir = film(t, "16:9");
  const video = join(dir, "renders/draft_video.mp4");
  media(video, [
    "-f",
    "lavfi",
    "-i",
    "color=gray:s=160x90:r=25:d=0.28,drawbox=c=white:t=fill:enable='eq(n,1)'",
    "-vf",
    "setpts='if(gte(N,2),(2.52+(N-2)/25)/TB,PTS)'",
    "-fps_mode",
    "vfr",
    "-c:v",
    "libx264",
  ]);
  writeRenderEvidence(video, { cuts: [0.5] });
  const out = framecheck(dir, video, "--json");
  assert.equal(out.status, 0, out.stdout + out.stderr);
  const { findings } = JSON.parse(out.stdout);
  assert.ok(!findings.some((a) => a.kind === "FLASH"));
  assert.ok(findings.some((a) => a.kind === "JUMP" && Math.abs(a.fileTime - 0.04) < 1e-6));
  const hold = findings.find((a) => a.kind === "FROZEN");
  assert.ok(hold?.fileEnd - hold?.fileTime > 2);
});

test("framecheck refuses a truncated packet instead of reporting a clean prefix", (t) => {
  const dir = film(t, "16:9");
  const video = join(dir, "truncated.mp4");
  media(video, [
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=320x180:r=24:d=2",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-movflags",
    "+faststart",
  ]);
  writeFileSync(video, readFileSync(video).subarray(0, -100));
  const out = framecheck(dir, video, "--json");
  assert.equal(out.status, 1, out.stdout + out.stderr);
  assert.match(out.stderr, /corrupt input packet|Invalid data found/i);
  assert.equal(out.stdout.trim(), "");
});

test("a new cut list cannot override the metadata belonging to the video", (t) => {
  const dir = film(t, "16:9");
  const video = join(dir, "renders/draft_video.mp4");
  flip(video);
  const cutsFile = join(dir, "renders/cuts.json");
  writeFileSync(cutsFile, "[2]");
  const newer = new Date(Date.now() + 3000);
  utimesSync(cutsFile, newer, newer);
  const legacy = JSON.parse(framecheck(dir, "--json").stdout);
  assert.ok(legacy.findings.some((f) => f.kind === "JUMP"));
  assert.equal(legacy.cuts.status, "unavailable");

  writeRenderEvidence(video, { cuts: [1] });
  writeFileSync(join(dir, "renders/cuts.json"), "{}");
  const bound = JSON.parse(framecheck(dir, "--json").stdout);
  assert.equal(bound.cuts.status, "bound");
  assert.deepEqual(bound.cutsUsed, [1]);
  assert.ok(!bound.findings.some((f) => f.kind === "JUMP"));
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
  assert.match(
    out.stdout.trim().split(/\r?\n/).at(-1),
    /next: START=60 bun run sheet renders\/draft_video\.mp4 frames 61/,
  );
});
