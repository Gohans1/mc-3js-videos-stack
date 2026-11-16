// scripts/review/deliver.py: a finished video checked against YouTube's upload spec, each fault with its fix
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
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

test("a video made the way YouTube asks is ready, and the answer says what goes up", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "deliver-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "final.mp4");
  make(file, { extra: ["-movflags", "+faststart", "-use_editlist", "0"] });
  const r = deliver(file);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /2560x1440 30 fps H\.264 High/);
  assert.match(r.stdout, /ready to upload/);
  assert.doesNotMatch(r.stdout, /FIX/);
});

test("each way a file can fail the upload spec is named with the command or setting that fixes it", (t) => {
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
  assert.match(r.stdout.trim().split(/\r?\n/).at(-1), /^next: .*bun run deliver .*bad\.mp4 again/);
});

test("a picture with no soundtrack is sent to the mix that puts one on it", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "deliver-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "final_video.mp4");
  make(file, { audio: null, extra: ["-movflags", "+faststart"] });
  const r = deliver(file);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FIX.*no sound.*bun run mix/);
});

test("a wrong word, missing file, or corrupt non-video stops before any work (exit 2)", (t) => {
  assert.equal(deliver("--nope").status, 2);
  const r = deliver(join(tmpdir(), "no-such-video.mp4"));
  // nothing was done, as sheet and framecheck say it: exit 2 (exit 1 is a film with something to fix)
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no-such-video\.mp4.*bun run mix/);

  const dir = mkdtempSync(join(tmpdir(), "deliver-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const junk = join(dir, "broken.mp4");
  writeFileSync(junk, "not an mp4");
  const bad = deliver(junk);
  assert.equal(bad.status, 2, bad.stdout + bad.stderr);
  assert.match(bad.stderr, /is no video ffprobe can read/);
});

test("--youtube reads its seconds as notes print them", () => {
  // a backwards span is refused on the seconds themselves: 0:05 and 0:02 were read, not turned away as "plain numbers"
  const r = deliver(join(tmpdir(), "any.mp4"), "--youtube", "0:05-0:02");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--youtube 0:05-0:02: the first second must come before the second one/);
});

test("an upload older than its picture is not ready: the fix is the mix that puts the new picture on", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "deliver-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "final.mp4");
  make(file, { extra: ["-movflags", "+faststart", "-use_editlist", "0"] });
  writeFileSync(join(dir, "final_video.mp4"), "x");
  utimesSync(file, 1000, 1000);
  const r = spawnSync("python", [DELIVER, file], { cwd: dir, encoding: "utf8" });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(
    r.stdout,
    /FIX final\.mp4 has an older picture than final_video\.mp4[^\n]*bun run mix final_video\.mp4/,
  );
  assert.doesNotMatch(r.stdout, /ready to upload/);
});

test("a video with one keyframe at its start is told its keyframes are too far apart", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "deliver-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "final.mp4");
  make(file, { extra: ["-g", "1000", "-movflags", "+faststart", "-use_editlist", "0"] });
  const r = deliver(file);
  assert.match(r.stdout, /ADVICE keyframes 3\.0 s apart at most/);
});

test("--help after the video prints the help and checks nothing", () => {
  const r = deliver(join(tmpdir(), "no-such-video.mp4"), "--help");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /The last look before upload/);
});

test("no upload yet but its picture is there: the fix is only the mix", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "deliver-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "renders"));
  writeFileSync(join(dir, "renders/final_video.mp4"), "x");
  const r = spawnSync("python", [DELIVER], { cwd: dir, encoding: "utf8" });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(
    r.stderr,
    /renders\/final_video\.mp4 is there: bun run mix renders\/final_video\.mp4/,
  );
  assert.doesNotMatch(r.stderr, /render final/);
});

test("a box past the media that says it is no size at all ends the box walk, not an endless loop", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "deliver-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "final.mp4");
  make(file, { extra: ["-movflags", "+faststart", "-use_editlist", "0"] });
  // a 64-bit size of 0 read the same 16 bytes again and again
  appendFileSync(file, Buffer.from([0, 0, 0, 1, ...Buffer.from("free"), 0, 0, 0, 0, 0, 0, 0, 0]));
  const r = spawnSync("python", [DELIVER, file], { encoding: "utf8", timeout: 60000 });
  assert.notEqual(r.status, null, "deliver never finished");
  assert.match(r.stdout, /2560x1440 30 fps/);
});

test("sound alone is no video to preview: the fix is named, never a traceback", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "deliver-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "final.mp4");
  const ff = spawnSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=f=997:d=2",
    "-c:a",
    "aac",
    file,
  ]);
  assert.equal(ff.status, 0, String(ff.stderr));
  const r = spawnSync("python", [DELIVER, file, "--youtube"], { cwd: dir, encoding: "utf8" });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.doesNotMatch(r.stderr, /Traceback/);
  assert.match(r.stdout, /FIX no video stream/);
});

test("the summary names the sound's own codec, and a folder is said to be one", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "deliver-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "final.mp4");
  make(file, { audio: ["-c:a", "libmp3lame", "-ar", "48000"] });
  assert.match(deliver(file).stdout, /, MP3 48 kHz stereo/);
  const folder = deliver(dir);
  assert.equal(folder.status, 2);
  assert.match(folder.stderr, /is a folder: give it the video/);
});

test("a ready upload's next step names the video and how long --youtube takes on it", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "deliver-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "final.mp4");
  make(file, { extra: ["-movflags", "+faststart", "-use_editlist", "0"] });
  const r = deliver(file);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.stdout.includes(`next: bun run deliver ${file} --youtube`), r.stdout);
  assert.match(r.stdout, /about 10 s here/);
});

test("--youtube re-encodes the seconds asked as YouTube would and measures their bands", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "deliver-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "renders"));
  const file = join(dir, "renders/final.mp4");
  make(file, { extra: ["-movflags", "+faststart", "-use_editlist", "0"] });
  // Python reads Infinity as a number: still no second of the film
  writeFileSync(join(dir, "renders/cuts.json"), "[1, Infinity]");
  const r = spawnSync("python", [DELIVER, "--youtube", "1-2"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 120000,
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stderr, /re-encoding 1 s the way YouTube serves it \(AV1 4Mbps, 2560 wide\)/);
  assert.match(r.stdout, /bands \(Netflix CAMBI\)/);
  assert.match(r.stdout, /renders\/cuts\.json is no list of seconds/);
  // nothing banded in testsrc2's flat colours: the last line still says what comes next
  assert.match(r.stdout.trim().split(/\r?\n/).at(-1), /^next: /);
  const probe = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_name:format=duration",
      "-of",
      "csv=p=0",
      join(dir, "renders/youtube_preview.mp4"),
    ],
    { encoding: "utf8" },
  );
  assert.match(probe.stdout, /^av1/m);
});

test("--youtube names the stretch the re-encode bands, its shot, and the picture that shows it", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "deliver-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "renders"));
  // a dark gradient held smooth by a fine grain: the re-encode wipes the grain and leaves the steps
  const ff = spawnSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "gradients=s=1280x720:c0=0x0a0c10:c1=0x1c2028:x0=0:y0=0:x1=1280:y1=0:d=1:r=30,noise=alls=4:allf=t",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "16",
    "-pix_fmt",
    "yuv420p",
    join(dir, "renders/final.mp4"),
  ]);
  assert.equal(ff.status, 0, String(ff.stderr));
  // a film of one shot: render writes no cut at all
  writeFileSync(join(dir, "renders/cuts.json"), "[]");
  const r = spawnSync("python", [DELIVER, "--youtube", "0-1"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 120000,
  });
  // no sound is a FIX of its own
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /BANDS 0-1 s, shot 0 \(renders\/cuts\.json\): the re-encode scores/);
  assert.ok(existsSync(join(dir, "renders/youtube_bands_0s.png")), r.stdout);
  assert.match(r.stdout.trim().split(/\r?\n/).at(-1), /^next: bun run at 0 names the shot/);
});
