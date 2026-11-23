import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { mediaFixture } from "./media-fixture.mjs";

const DELIVER = resolve(dirname(fileURLToPath(import.meta.url)), "../review/deliver.py");
const media = mediaFixture();

const make = (
  file,
  { size = "2560x1440", audio = ["-c:a", "aac", "-b:a", "384k", "-ar", "48000"], extra = [] },
) => {
  const tone = "aevalsrc=0.2*sin(2*PI*997*t)|0.2*sin(2*PI*997*t):s=48000:d=3";
  media(file, [
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
  ]);
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
  assert.match(r.stdout, /passes configured technical upload checks/);
  assert.doesNotMatch(r.stdout, /FIX/);
  assert.ok(r.stdout.includes(`next: bun run deliver ${file} --youtube`), r.stdout);
  assert.match(r.stdout, /about 10 s here/);
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
  for (const what of [/moov/, /mono/, /quieter/])
    assert.ok(
      fix.some((l) => what.test(l)),
      `${what} in:\n${r.stdout}`,
    );
  assert.match(r.stdout, /ADVICE MP4 has an edit list/);
  assert.doesNotMatch(r.stdout, /-use_editlist/);
  assert.match(r.stdout, /720p/);
  assert.doesNotMatch(r.stdout, /bun run render final|bun run mix/);
  assert.match(r.stdout.trim().split(/\r?\n/).at(-1), /^next: .*bun run deliver .*bad\.mp4 again/);
});

test("a picture with no soundtrack is sent to the mix that puts one on it", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "deliver-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "final_video.mp4");
  make(file, { audio: null, extra: ["-movflags", "+faststart"] });
  const r = deliver(file);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FIX no sound: supply or add the intended audio track/);
});

test("a wrong word, missing file, or corrupt non-video stops before any work (exit 2)", (t) => {
  assert.equal(deliver("--nope").status, 2);
  const r = deliver(join(tmpdir(), "no-such-video.mp4"));
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
  const r = deliver(join(tmpdir(), "any.mp4"), "--youtube", "0:05-0:02");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--youtube 0:05-0:02: the first second must come before the second one/);
});

test("an upload older than its picture is not ready: the fix is the mix that puts the new picture on", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "deliver-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "renders"));
  const file = join(dir, "renders/final.mp4");
  make(file, { extra: ["-movflags", "+faststart", "-use_editlist", "0"] });
  writeFileSync(join(dir, "renders/final_video.mp4"), "x");
  utimesSync(file, 1000, 1000);
  const r = spawnSync("python", [DELIVER, file], { cwd: dir, encoding: "utf8" });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(
    r.stdout,
    /FIX renders\/final\.mp4 has an older picture than renders\/final_video\.mp4[^\n]*bun run mix renders\/final_video\.mp4/,
  );
  assert.doesNotMatch(r.stdout, /passes configured technical upload checks/);
});

test("deliver distinguishes a track below the loudness gate from a track too short to measure", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "deliver-loudness-gate-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const quiet = join(dir, "quiet.mp4"),
    short = join(dir, "short.mp4");
  const extra = ["-movflags", "+faststart"];
  make(quiet, {
    size: "1920x1080",
    extra,
    audio: ["-c:a", "aac", "-b:a", "384k", "-ar", "48000", "-af", "volume=-70dB"],
  });
  make(short, { size: "1920x1080", extra: [...extra, "-t", "0.30"] });
  const below = deliver(quiet);
  assert.equal(below.status, 1, below.stdout + below.stderr);
  assert.match(below.stdout, /FIX no 400 ms audio block clears the EBU gate/);
  const partial = deliver(short);
  assert.equal(partial.status, 0, partial.stdout + partial.stderr);
  assert.match(partial.stdout, /ADVICE integrated loudness needs a 400 ms audio window/);
});

test("deliver flags A/V coverage even when the tracks have the same duration", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "deliver-audio-clock-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, "shifted.mp4");
  media(source, [
    "-f",
    "lavfi",
    "-i",
    "color=black:s=1920x1080:r=30:d=1",
    "-itsoffset",
    "0.45",
    "-f",
    "lavfi",
    "-i",
    "aevalsrc=0.2*sin(2*PI*997*t)|0.2*sin(2*PI*997*t):s=48000:d=1",
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
  ]);
  const report = deliver(source);
  assert.equal(report.status, 1, report.stdout + report.stderr);
  assert.match(
    report.stdout,
    /FIX audio covers 0\.4[\d]+-1\.45 s and picture covers 0-1 s on the file clock/,
  );
});

test("delivery detects uneven frame timing even when both reported rates match", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "deliver-cadence-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "uneven.mp4");
  make(file, {
    size: "1920x1080",
    extra: [
      "-vf",
      "settb=1/60000,setpts=PTS+if(eq(N\\,45)\\,1500\\,0)",
      "-fps_mode",
      "vfr",
      "-enc_time_base",
      "1/60000",
      "-movflags",
      "+faststart",
    ],
  });
  const result = deliver(file);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /variable frame rate: decoded frame spacing 8\.33-58\.33 ms/);

  const dropped = join(dir, "dropped.mp4");
  make(dropped, {
    size: "1920x1080",
    extra: [
      "-vf",
      "select=not(eq(n\\,25))",
      "-fps_mode",
      "vfr",
      "-video_track_timescale",
      "30",
      "-movflags",
      "+faststart",
    ],
  });
  const coarse = deliver(dropped);
  assert.equal(coarse.status, 0, coarse.stdout + coarse.stderr);
  assert.match(coarse.stdout, /variable frame rate: decoded frame spacing 33\.33-66\.67 ms/);
});

test("delivery measures the stream identified as default when another stream has more channels", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "deliver-tracks-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const original = join(dir, "original.mp4");
  make(original, { extra: ["-movflags", "+faststart", "-use_editlist", "0"] });
  const output = join(dir, "test.mp4");
  const r = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      original,
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=48000:cl=5.1",
      "-map",
      "0:v",
      "-map",
      "0:a",
      "-map",
      "1:a",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-disposition:a:0",
      "default",
      "-disposition:a:1",
      "0",
      "-t",
      "3",
      "-movflags",
      "+faststart",
      "-use_editlist",
      "0",
      output,
    ],
    { encoding: "utf8", timeout: 60_000 },
  );
  assert.equal(r.status, 0, r.stderr);
  const report = deliver(output);
  assert.equal(report.status, 0, report.stdout + report.stderr);
  assert.match(report.stdout, /2 audio streams; only stream #1 was checked/);
  assert.doesNotMatch(report.stdout, /quieter than the project target/);
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
  assert.match(r.stdout, /Technical upload checks for an encoded file/);
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

test("deliver refuses a fast-start MP4 whose media data is incomplete", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "deliver-truncated-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "truncated.mp4");
  make(file, { size: "1920x1080", extra: ["-movflags", "+faststart"] });
  writeFileSync(file, readFileSync(file).subarray(0, -4096));
  const r = deliver(file);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /truncated or invalid MP4 mdat box/);
});

test("deliver rejects undecodable packets even when all MP4 boxes are intact", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "deliver-packets-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "source.mp4");
  make(file, { size: "1920x1080", extra: ["-movflags", "+faststart"] });
  const original = readFileSync(file);
  for (const track of ["v:0", "a:0"]) {
    const probe = spawnSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        track,
        "-show_packets",
        "-show_entries",
        "packet=pos,size,flags",
        "-of",
        "json",
        file,
      ],
      { encoding: "utf8", timeout: 20_000 },
    );
    assert.equal(probe.status, 0, probe.stderr);
    const packet = JSON.parse(probe.stdout)
      .packets.slice(5)
      .find((p) => track === "a:0" || !p.flags.includes("K"));
    assert.ok(packet);
    const bytes = Buffer.from(original);
    const offset = Number(packet.pos);
    if (track === "a:0") bytes.fill(0xff, offset, offset + Number(packet.size));
    else bytes.writeUInt32BE(0x7fff_ffff, offset);
    const damaged = join(dir, `damaged-${track[0]}.mp4`);
    writeFileSync(damaged, bytes);
    const result = deliver(damaged);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /could not check/);
    assert.doesNotMatch(result.stdout, /passes configured technical upload checks/);
  }
});

test("a box past the media that says it is no size at all ends the box walk, not an endless loop", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "deliver-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "final.mp4");
  make(file, { extra: ["-movflags", "+faststart", "-use_editlist", "0"] });
  appendFileSync(file, Buffer.from([0, 0, 0, 1, ...Buffer.from("free"), 0, 0, 0, 0, 0, 0, 0, 0]));
  const r = spawnSync("python", [DELIVER, file], { encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /truncated or invalid MP4 free box/);
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

test("--youtube makes a local compression preview of the seconds asked and measures their bands", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "deliver-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "renders"));
  const file = join(dir, "renders/final.mp4");
  make(file, { extra: ["-movflags", "+faststart", "-use_editlist", "0"] });
  writeFileSync(join(dir, "renders/cuts.json"), "[1, Infinity]");
  const r = spawnSync("python", [DELIVER, "--youtube", "1-2"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 120000,
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(
    r.stderr,
    /local compression preview of 1 s \(AV1 4Mbps, 2560 wide; approximate, not an actual YouTube rendition\)/,
  );
  assert.match(r.stdout, /bands \(Netflix CAMBI\)/);
  assert.match(r.stdout, /renders\/cuts\.json is no list of seconds/);
  assert.match(r.stdout.trim().split(/\r?\n/).at(-1), /^next: /);
  const path = r.stdout.match(/^preview: (renders\/youtube_[^/]+\/preview\.mp4);/m)?.[1];
  assert.ok(path, r.stdout);
  const probe = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_name:format=duration",
      "-of",
      "csv=p=0",
      join(dir, path),
    ],
    { encoding: "utf8" },
  );
  assert.match(probe.stdout, /^av1/m);

  const legacy = join(dir, "renders/youtube_preview.mp4");
  const bytes = readFileSync(join(dir, path));
  writeFileSync(legacy, bytes);
  const replay = spawnSync("python", [DELIVER, legacy, "--youtube", "0-0.5"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 120_000,
  });
  assert.ok(
    [0, 1].includes(replay.status) && /^preview: renders\/youtube_/m.test(replay.stdout),
    replay.stdout + replay.stderr,
  );
  assert.doesNotMatch(replay.stdout, /bun run at /);
  assert.deepEqual(readFileSync(legacy), bytes);
  assert.deepEqual(readFileSync(join(dir, path)), bytes);
});

test("preview zero starts with the picture displayed at a subframe boundary", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "deliver-phase-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, "first-cut.mp4");
  media(source, [
    "-f",
    "lavfi",
    "-i",
    "color=red:s=640x360:r=30:d=0.5,drawbox=c=blue:t=fill:enable='eq(n,0)'",
    "-c:v",
    "libx264",
  ]);
  const output = spawnSync("python", [DELIVER, source, "--youtube", "0.02-0.14"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 120_000,
  });
  const artifact = output.stdout.match(/^preview: (renders\/youtube_[^/]+\/preview\.mp4);/m)?.[1];
  assert.ok(artifact, output.stdout + output.stderr);
  const first = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      join(dir, artifact),
      "-vf",
      "scale=1:1",
      "-frames:v",
      "1",
      "-pix_fmt",
      "rgb24",
      "-f",
      "rawvideo",
      "-",
    ],
    { timeout: 20_000 },
  );
  assert.equal(first.status, 0, String(first.stderr));
  assert.ok(
    first.stdout[2] > 200 && first.stdout[0] < 40,
    `first preview pixel: ${[...first.stdout]}`,
  );
});

test("an MPEG-TS preview starts in the requested GOP and shows the displayed picture", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "deliver-long-gop-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "footage.ts");
  media(file, [
    "-f",
    "lavfi",
    "-i",
    "color=red:s=320x180:r=24:d=3,drawbox=c=blue:t=fill:enable='gte(t,1.5)'",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=d=3",
    "-c:v",
    "libx264",
    "-g",
    "60",
    "-sc_threshold",
    "0",
    "-c:a",
    "aac",
  ]);
  const result = spawnSync("python", [DELIVER, file, "--youtube", "0.3-1.3"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /bands \(Netflix CAMBI\)/);
  const preview = /^preview: (renders\/youtube_.*\/preview\.mp4);/m.exec(result.stdout)?.[1];
  assert.ok(preview, result.stdout + result.stderr);
  const sample = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      join(dir, preview),
      "-vf",
      "scale=1:1",
      "-frames:v",
      "1",
      "-pix_fmt",
      "rgb24",
      "-f",
      "rawvideo",
      "-",
    ],
    { timeout: 20_000 },
  );
  assert.equal(sample.status, 0, String(sample.stderr));
  assert.ok(sample.stdout[0] > 220 && sample.stdout[2] < 40, String([...sample.stdout]));
  const flagFirst = spawnSync("python", [DELIVER, "--youtube", file], {
    cwd: dir,
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(flagFirst.status, 1, flagFirst.stdout + flagFirst.stderr);
  assert.match(flagFirst.stdout, /bands \(Netflix CAMBI\)/);
});

test("a Program Stream preview starts before the next flash when requested there", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "deliver-program-stream-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "footage.mpg");
  media(file, [
    "-f",
    "lavfi",
    "-i",
    "color=red:s=320x180:r=25:d=2,drawbox=c=white:t=fill:enable='eq(n,30)'",
    "-c:v",
    "mpeg2video",
    "-bf",
    "2",
  ]);
  const result = spawnSync("python", [DELIVER, file, "--youtube", "1.199-1.299"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /bands \(Netflix CAMBI\)/);
  const preview = /^preview: (renders\/youtube_.*\/preview\.mp4);/m.exec(result.stdout)?.[1];
  assert.ok(preview, result.stdout + result.stderr);
  const sample = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      join(dir, preview),
      "-vf",
      "scale=1:1",
      "-frames:v",
      "1",
      "-pix_fmt",
      "rgb24",
      "-f",
      "rawvideo",
      "-",
    ],
    { timeout: 20_000 },
  );
  assert.equal(sample.status, 0, String(sample.stderr));
  assert.ok(
    sample.stdout[0] > 220 && sample.stdout[1] < 40 && sample.stdout[2] < 40,
    String([...sample.stdout]),
  );
});

test("deliver keeps the preview when both dimensions are too small for CAMBI", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "deliver-small-preview-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "footage.mp4");
  make(file, { size: "160x90" });
  const result = spawnSync("python", [DELIVER, file, "--youtube", "0-0.5"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /CAMBI unavailable for 160x90/);
  assert.doesNotMatch(result.stderr, /CAMBI banding measurement failed/);
  const preview = /^preview: (renders\/youtube_.*\/preview\.mp4);/m.exec(result.stdout)?.[1];
  assert.ok(preview && existsSync(join(dir, preview)));
});

test("a preview of delayed VFR picture can start and end inside a held frame", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "deliver-held-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, "held.mp4");
  media(source, [
    "-itsoffset",
    "1",
    "-f",
    "lavfi",
    "-i",
    "color=blue:s=640x360:r=4:d=1,select='not(mod(n,2))',setpts=4*PTS",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=d=4",
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-fps_mode",
    "vfr",
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
  ]);
  const output = spawnSync("python", [DELIVER, source, "--youtube", "2.1-2.7"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 120_000,
  });
  assert.equal(output.status, 1, output.stdout + output.stderr);
  const artifact = output.stdout.match(/^preview: (renders\/youtube_[^/]+\/preview\.mp4);/m)?.[1];
  assert.ok(artifact, output.stdout + output.stderr);
  const probe = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,duration",
      "-of",
      "json",
      join(dir, artifact),
    ],
    { encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(probe.status, 0, probe.stderr);
  const lengths = Object.fromEntries(
    JSON.parse(probe.stdout).streams.map((s) => [s.codec_type, Number(s.duration)]),
  );
  assert.ok(
    Math.abs(lengths.video - 0.6) <= 1 / 24 && Math.abs(lengths.audio - 0.6) < 0.01,
    probe.stdout,
  );
});

test("--youtube names the stretch the re-encode bands, its shot, and the picture that shows it", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "deliver-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "renders"));
  const ff = spawnSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "gradients=s=1280x720:c0=0x0a0c10:c1=0x1c2028:x0=0:y0=0:x1=1280:y1=0:d=1:r=30:speed=0:seed=42,noise=alls=4:allf=t:all_seed=42",
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
  writeFileSync(join(dir, "renders/cuts.json"), "[]");
  utimesSync(join(dir, "renders/cuts.json"), 1000, 1000);
  const r = spawnSync("python", [DELIVER, "--youtube", "0-1"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 120000,
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /BANDS 0-1 s, shot 0 \(renders\/cuts\.json\): the re-encode scores/);
  const band = r.stdout.match(/look: (renders\/youtube_[^/]+\/youtube_bands_00\.png)/)?.[1];
  assert.ok(band && existsSync(join(dir, band)), r.stdout);
  assert.match(r.stdout, /bun run at [\d.]+ locates the current film rows/);
});
