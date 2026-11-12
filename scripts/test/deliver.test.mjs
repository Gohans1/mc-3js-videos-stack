// scripts/review/deliver.py: a finished video checked against YouTube's upload spec, each fault with its fix
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const DELIVER = resolve(dirname(fileURLToPath(import.meta.url)), "../review/deliver.py");

// 3 s of picture and a 997 Hz tone at -14 LUFS (0.2 a channel, stereo), encoded the way each test says
const make = (
  file,
  { size = "2560x1440", audio = ["-c:a", "aac", "-b:a", "384k", "-ar", "48000"], extra = [] },
) => {
  const tone = "aevalsrc=0.2*sin(2*PI*997*t)|0.2*sin(2*PI*997*t):s=48000:d=3";
  const r = spawnSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `testsrc2=s=${size}:r=30:d=3`,
    ...(audio ? ["-f", "lavfi", "-i", tone] : []),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    "-colorspace",
    "bt709",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-color_range",
    "tv",
    ...(audio ?? []),
    ...extra,
    file,
  ]);
  assert.equal(r.status, 0, String(r.stderr));
};
const deliver = (...args) => spawnSync("python", [DELIVER, ...args], { encoding: "utf8" });

test(
  "a video made the way YouTube asks is ready, and the answer says what goes up",
  { timeout: 60_000 },
  (t) => {
    const dir = mkdtempSync(join(tmpdir(), "deliver-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "final.mp4");
    make(file, { extra: ["-movflags", "+faststart", "-use_editlist", "0"] });
    const r = deliver(file);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /2560x1440 30 fps H\.264 High/);
    assert.match(r.stdout, /ready to upload/);
    assert.doesNotMatch(r.stdout, /FIX/);
  },
);

test(
  "each way a file can fail the upload spec is named with the command or setting that fixes it",
  { timeout: 60_000 },
  (t) => {
    const dir = mkdtempSync(join(tmpdir(), "deliver-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "bad.mp4");
    make(file, {
      size: "1280x720",
      audio: ["-c:a", "aac", "-b:a", "96k", "-ar", "44100", "-ac", "1"],
      extra: ["-af", "volume=-12dB"],
    });
    const r = deliver(file);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const fix = r.stdout.split("\n").filter((l) => l.startsWith("FIX"));
    for (const what of [/moov/, /edit list/, /mono/, /quieter/])
      assert.ok(
        fix.some((l) => what.test(l)),
        `${what} in:\n${r.stdout}`,
      );
    assert.match(r.stdout, /720p/);
    assert.match(r.stdout, /bun run render final/);
  },
);

test(
  "a picture with no soundtrack is sent to the mix that puts one on it",
  { timeout: 60_000 },
  (t) => {
    const dir = mkdtempSync(join(tmpdir(), "deliver-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "final_video.mp4");
    make(file, { audio: null, extra: ["-movflags", "+faststart"] });
    const r = deliver(file);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /FIX.*no sound.*bun run mix/);
  },
);

test("a wrong word or a missing file stops before any work, saying what it takes", () => {
  assert.equal(deliver("--nope").status, 2);
  const r = deliver(join(tmpdir(), "no-such-video.mp4"));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no-such-video\.mp4.*bun run mix/);
});
