import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { Trials } from "../../packages/live-studio/src/contract.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SOUND = join(ROOT, "scripts/sound");
const MIX = join(SOUND, "mix.py");
const PROCESS = join(SOUND, "process.py");
const BEATS = join(SOUND, "beats.py");

const makeWav = (file, { freq = 440, dur = 0.5, silence = false, ogg = false } = {}) => {
  mkdirSync(dirname(file), { recursive: true });
  if (ogg) {
    const src = silence
      ? "anullsrc=r=48000:cl=stereo"
      : `sine=frequency=${freq}:sample_rate=48000:duration=${dur}`;
    const args = ["-v", "error", "-y", "-f", "lavfi", "-i", src];
    if (silence) args.push("-t", String(dur));
    args.push("-c:a", "libvorbis", file);
    const r = spawnSync("ffmpeg", args, { encoding: "utf8", timeout: 20_000 });
    assert.equal(r.status, 0, r.stderr);
    return;
  }
  const sr = 48_000;
  const ch = 2;
  const frames = Math.max(1, Math.round(dur * sr));
  const dataBytes = frames * ch * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(ch, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * ch * 2, 28);
  buf.writeUInt16LE(ch * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataBytes, 40);
  if (!silence) {
    const amp = 0.25 * 32767;
    for (let i = 0; i < frames; i++) {
      const s = Math.round(amp * Math.sin((2 * Math.PI * freq * i) / sr));
      const off = 44 + i * 4;
      buf.writeInt16LE(s, off);
      buf.writeInt16LE(s, off + 2);
    }
  }
  writeFileSync(file, buf);
};

const makeMp4 = (file, { dur = 1.0, audio = false } = {}) => {
  mkdirSync(dirname(file), { recursive: true });
  const args = ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=black:s=64x64:r=24:d=${dur}`];
  if (audio) {
    args.push(
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:sample_rate=48000:duration=${dur}`,
      "-c:a",
      "aac",
    );
  }
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", file);
  const r = spawnSync("ffmpeg", args, { encoding: "utf8", timeout: 20_000 });
  assert.equal(r.status, 0, r.stderr);
};

const setupFilm = (t, prefix, files = {}) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "src/timeline"), { recursive: true });
  mkdirSync(join(dir, "sound/sfx"), { recursive: true });
  const edit = files.edit === undefined ? { end: 2.0, voice: { lines: [], warp: [] } } : files.edit;
  const audio = files.audio === undefined ? { voice: false, beds: [], sfx: [] } : files.audio;
  if (edit !== null) {
    writeFileSync(
      join(dir, "src/edit.json"),
      typeof edit === "string" ? edit : JSON.stringify(edit),
    );
  }
  if (audio !== null) {
    writeFileSync(
      join(dir, "src/timeline/audio.json"),
      typeof audio === "string" ? audio : JSON.stringify(audio),
    );
  }
  if (files.pkg !== undefined) {
    writeFileSync(
      join(dir, "package.json"),
      typeof files.pkg === "string" ? files.pkg : JSON.stringify(files.pkg),
    );
  }
  if (files.choices !== undefined) {
    writeFileSync(
      join(dir, "choices.json"),
      typeof files.choices === "string" ? files.choices : JSON.stringify(files.choices),
    );
  }
  if (files.timing !== undefined) {
    writeFileSync(
      join(dir, "src/timeline/timing.json"),
      typeof files.timing === "string" ? files.timing : JSON.stringify(files.timing),
    );
  }
  return dir;
};

const runMix = (cwd, args = [], input) =>
  spawnSync("python", [MIX, ...args], { cwd, input, encoding: "utf8", timeout: 30_000 });

const runMixAsync = (cwd, args = []) =>
  new Promise((resolveDone, rejectDone) => {
    const child = spawn("python", [MIX, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", rejectDone);
    child.on("close", (status) => resolveDone({ status, stdout, stderr }));
  });

const readSamples = (wavPath) => {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", wavPath, "-f", "f32le", "-ac", "2", "-"], {
    maxBuffer: 32 * 1024 * 1024,
    timeout: 20_000,
  });
  assert.equal(r.status, 0, String(r.stderr));
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.byteLength / 4);
};

const sliceRms = (samples, fromSec, toSec) => {
  const a = Math.max(0, Math.floor(fromSec * 48_000) * 2);
  const b = Math.min(samples.length, Math.floor(toSec * 48_000) * 2);
  let sum = 0;
  for (let i = a; i < b; i++) sum += samples[i] * samples[i];
  return b > a ? Math.sqrt(sum / (b - a)) : 0;
};

test("partial narration swaps retain the voice clock when SFX linkage is independent", (t) => {
  const dir = setupFilm(t, "mix-partial-clock-", {
    pkg: { "live-studio": { timingTimeline: "src/timeline/timing.json" } },
    edit: { end: 4, voice: { lines: [], warp: [] } },
    timing: { freezes: [{ at: 0.5, duration: 1 }], layerKinds: { sfx: { base: {}, changes: [] } } },
    choices: { narr: { set: "alt" } },
    audio: {
      narration: "narr",
      beds: [],
      sfx: [
        { name: "narr", at: 0.75, length: 0.2, gain: 0, try: ["alt"] },
        { name: "narr", at: 2, length: 0.2, gain: 0 },
      ],
    },
  });
  for (const name of ["narr", "alt"]) makeWav(join(dir, `sound/sfx/${name}.wav`));
  const r = runMix(dir);
  assert.equal(r.status, 0, r.stderr);
  const samples = readSamples(join(dir, "sound/mix.wav"));
  assert.ok(sliceRms(samples, 0.77, 0.9) < 1e-5);
  assert.ok(sliceRms(samples, 1.77, 1.9) > 0.05);
  assert.ok(sliceRms(samples, 3.02, 3.15) > 0.05);
});

test("ducking follows a continuous narration brick across a reordered seam", (t) => {
  const dir = setupFilm(t, "mix-reordered-duck-", {
    pkg: { "live-studio": { timingTimeline: "src/timeline/timing.json" } },
    edit: { end: 12, voice: { lines: [[5, 5.5]], warp: [] } },
    timing: {
      main: [
        { id: "b", kind: "clip", sourceFrom: 4, sourceTo: 8 },
        { id: "a", kind: "clip", sourceFrom: 0, sourceTo: 4 },
        { id: "c", kind: "clip", sourceFrom: 8, sourceTo: 12 },
      ],
      layerKinds: { audio: { base: {}, changes: [] } },
    },
    audio: {
      narration: "narr",
      beds: [{ name: "bed", from: 0, to: 12, gain: -10, fadeIn: 0, fadeOut: 0, duck: 18 }],
      sfx: [{ name: "narr", at: 0, length: 8, gain: 0 }],
    },
  });
  makeWav(join(dir, "sound/sfx/bed.wav"), { dur: 12 });
  makeWav(join(dir, "sound/sfx/narr.wav"), { dur: 8, silence: true });
  const r = runMix(dir);
  assert.equal(r.status, 0, r.stderr);
  const samples = readSamples(join(dir, "sound/mix.wav"));
  assert.ok(sliceRms(samples, 9.1, 9.4) < sliceRms(samples, 1.1, 1.4) * 0.2);
});

const startMockStudio = async (dir) => {
  const events = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        events.push(JSON.parse(body));
      } catch {
        events.push({ raw: body });
      }
      res.writeHead(200);
      res.end("ok");
    });
  });
  await new Promise((resolveDone) => server.listen(0, "127.0.0.1", resolveDone));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  mkdirSync(join(dir, "renders/live"), { recursive: true });
  writeFileSync(join(dir, "renders/live/studio.json"), JSON.stringify({ port: address.port }));
  return { events, close: () => new Promise((resolveDone) => server.close(resolveDone)) };
};

test("CLI pre-flight checks -h/--help/help and rejects bad flags/arity with exit 2 before JSON reads", (t) => {
  const dir = setupFilm(t, "mix-cli-args-", {
    edit: "{broken",
    audio: "{broken",
    pkg: "{broken",
  });
  for (const helpArgs of [["-h"], ["--help"], ["help"], ["renders/draft_video.mp4", "--help"]]) {
    const r = runMix(dir, helpArgs);
    assert.equal(r.status, 0, `${helpArgs.join(" ")}: ${r.stderr}`);
    assert.match(r.stdout, /sound\/mix\.wav/);
    assert.doesNotMatch(r.stderr, /Traceback/);
  }
  for (const badArgs of [
    ["--bogus"],
    ["a.mp4", "b.mp4"],
    ["--raw"],
    ["--raw", "a.wav", "b.wav"],
    ["--raw", "a.wav", "--unknown"],
    ["--measure"],
    ["--measure", "voice", "0"],
    ["--measure", "sfx", "abc"],
  ]) {
    const r = runMix(dir, badArgs);
    assert.equal(r.status, 2, `${badArgs.join(" ")}: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /Traceback/);
  }
});

test("CLI pre-flight rejects unreadable videos, escapes, and missing audio.json with exit 2", (t) => {
  const dir = setupFilm(t, "mix-cli-vid-", {
    edit: "{broken",
    audio: "{broken",
    pkg: "{broken",
  });
  const outside = mkdtempSync(join(tmpdir(), "mix-out-vid-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  makeMp4(join(outside, "clip.mp4"));
  writeFileSync(join(dir, "not_video.txt"), "plain text");
  mkdirSync(join(dir, "renders"), { recursive: true });
  makeMp4(join(dir, "renders/draft_video.mp4"));

  const txtRes = runMix(dir, ["not_video.txt"]);
  assert.equal(txtRes.status, 2, txtRes.stderr);
  assert.match(txtRes.stderr, /not a readable video.*renders\/draft_video\.mp4/);
  assert.doesNotMatch(txtRes.stderr, /Traceback/);

  const escRes = runMix(dir, ["../" + outside.split(/[\\/]/).pop() + "/clip.mp4"]);
  assert.equal(escRes.status, 2, escRes.stderr);
  assert.match(escRes.stderr, /Video escapes film directory/);
  assert.doesNotMatch(escRes.stderr, /Traceback/);

  const noAudioDir = setupFilm(t, "mix-no-audio-", { audio: null });
  rmSync(join(noAudioDir, "src/timeline/audio.json"), { force: true });
  const missAudio = runMix(noAudioDir);
  assert.equal(missAudio.status, 2, missAudio.stderr);
  assert.match(missAudio.stderr, /no src\/timeline\/audio\.json here/);
});

/** @param {import("node:test").TestContext} t @param {Array<[string, Record<string, unknown>, RegExp]>} cases */
const assertMixFailureCases = (t, cases) => {
  for (const [label, files, pattern] of cases) {
    const dir = setupFilm(t, "mix-bad-", files);
    const r = runMix(dir);
    assert.equal(
      r.status,
      1,
      `${label}: got rc=${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`,
    );
    assert.doesNotMatch(r.stderr, /Traceback/, label);
    assert.match(r.stderr, pattern, label);
  }
};

test("malformed package/edit/audio JSON and config types fail cleanly without tracebacks", (t) => {
  assertMixFailureCases(t, [
    ["broken package.json", { pkg: "{bad" }, /package\.json: invalid JSON/],
    [
      "non-object live-studio",
      { pkg: { "live-studio": "bad" } },
      /"live-studio" must be a JSON object/,
    ],
    [
      "null sfx path",
      { pkg: { "live-studio": { sfx: null } } },
      /"live-studio\.sfx" must be a folder path/,
    ],
    ["broken edit.json", { edit: "{bad" }, /src\/edit\.json: invalid JSON/],
    ["broken audio.json", { audio: "{bad" }, /src\/timeline\/audio\.json: invalid JSON/],
  ]);
});

test("malformed choices/timing JSON and timing path escapes fail cleanly without tracebacks", (t) => {
  assertMixFailureCases(t, [
    ["broken choices.json", { choices: "{bad" }, /choices\.json: invalid JSON/],
    [
      "non-object choices entry",
      { choices: { hit: "bad" } },
      /choices\.json: 'hit' must be a JSON object/,
    ],
    [
      "zero choices gain",
      { choices: { hit: { set: "hit", gain: 0 } } },
      /choices\.json: 'hit'\.gain must be positive|positive number/,
    ],
    [
      "broken timing.json",
      { pkg: { "live-studio": { timingTimeline: "src/timeline/timing.json" } }, timing: "{bad" },
      /src\/timeline\/timing\.json: invalid JSON/,
    ],
    [
      "missing timing.json",
      { pkg: { "live-studio": { timingTimeline: "src/timeline/timing.json" } } },
      /missing timingTimeline file/,
    ],
    [
      "escaping timing.json",
      { pkg: { "live-studio": { timingTimeline: "../outside.json" } } },
      /Timing timeline escapes film directory/,
    ],
  ]);
});

test("unsafe filters, clip bounds, soundSources traversal, and --raw escapes fail cleanly without tracebacks", (t) => {
  assertMixFailureCases(t, [
    [
      "nonexistent subdir traversal in soundSources",
      {
        pkg: { "live-studio": { soundSources: { hit: "missing/../../outside.wav" } } },
        audio: { voice: false, beds: [], sfx: [{ at: 0, name: "hit", gain: 0 }] },
      },
      /Audio source escapes film directory/,
    ],
    [
      "zero rate",
      { audio: { voice: false, beds: [], sfx: [{ at: 0, name: "hit", gain: 0, rate: 0 }] } },
      /sfx\[0\]\.rate must be > 0/,
    ],
    [
      "negative at",
      { audio: { voice: false, beds: [], sfx: [{ at: -0.2, name: "hit", gain: 0 }] } },
      /sfx\[0\]\.at must be >= 0/,
    ],
    [
      "newline filter injection",
      {
        audio: {
          voice: false,
          beds: [],
          sfx: [{ at: 0, name: "hit", gain: 0, filters: ["volume=0dB\nanull"] }],
        },
      },
      /Unsafe or invalid ffmpeg audio filter/,
    ],
  ]);

  const rawDir = setupFilm(t, "mix-raw-bad-");
  makeWav(join(rawDir, "sound/sfx/hit.wav"), { dur: 0.4 });
  writeFileSync(join(rawDir, "sound/sfx/SOURCES.json"), "{bad");
  writeFileSync(
    join(rawDir, "src/timeline/audio.json"),
    JSON.stringify({
      voice: false,
      beds: [],
      sfx: [{ at: 0, name: "hit", gain: 0, try: ["hit"] }],
    }),
  );
  const rawErr = runMix(rawDir, ["--raw", "sound/mix_dry.wav"]);
  assert.equal(rawErr.status, 1);
  assert.doesNotMatch(rawErr.stderr, /Traceback/);
  assert.match(rawErr.stderr, /SOURCES\.json: invalid JSON/);

  const rawEsc = runMix(rawDir, ["--raw", "../outside.wav"]);
  assert.equal(rawEsc.status, 1);
  assert.doesNotMatch(rawEsc.stderr, /Traceback/);
  assert.match(rawEsc.stderr, /Raw mix output escapes film directory/);
});

test("studio job() reports fail and leaves no leftover graph file when ffmpeg/probe fails", async (t) => {
  const dir = setupFilm(t, "mix-job-fail-", {
    audio: { voice: false, beds: [], sfx: [{ at: 0, name: "corrupt", gain: 0 }] },
  });
  writeFileSync(join(dir, "sound/sfx/corrupt.wav"), "not audio bytes");
  const srv = await startMockStudio(dir);
  t.after(srv.close);

  const r = await runMixAsync(dir);
  assert.equal(r.status, 1);
  assert.doesNotMatch(r.stderr, /Traceback/);
  assert.match(r.stderr, /corrupt\.wav: could not probe duration/);
  assert.equal(existsSync(join(dir, "sound/mix_raw.wav.graph.txt")), false);
  assert.equal(srv.events.length, 2);
  assert.equal(srv.events[0].job.key, "mix");
  assert.equal(srv.events[1].job.end, true);
  assert.equal(srv.events[1].level, "fail");
});

test("a mix tracks audio timeline restoration and a newly preferred source", (t) => {
  const dir = setupFilm(t, "mix-input-binding-", {
    audio: { voice: false, beds: [], sfx: [{ name: "hit", at: 0.5, gain: 0 }] },
  });
  const audio = join(dir, "src/timeline/audio.json");
  const earlier = readFileSync(audio);
  makeWav(join(dir, "sound/sfx/effects/hit.ogg"), { ogg: true });
  writeFileSync(
    audio,
    JSON.stringify({ voice: false, beds: [], sfx: [{ name: "hit", at: 1, gain: 0 }] }),
  );
  makeMp4(join(dir, "renders/draft_video.mp4"), { dur: 2 });
  const made = runMix(dir, ["renders/draft_video.mp4"]);
  assert.equal(made.status, 0, made.stdout + made.stderr);
  const status = () => {
    const r = spawnSync(
      "bun",
      [join(ROOT, "packages/live-studio/src/stale.mjs"), "renders/draft.mp4", "--json"],
      { cwd: dir, encoding: "utf8", timeout: 20_000 },
    );
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  assert.equal(status().stale, null);
  makeWav(join(dir, "sound/sfx/effects/hit.wav"));
  assert.equal(status().stale.file, "sound/sfx/effects/hit.wav");
  rmSync(join(dir, "sound/sfx/effects/hit.wav"));
  writeFileSync(audio, earlier);
  const changed = new Date(2000);
  utimesSync(audio, changed, changed);
  assert.equal(status().stale.file, "src/timeline/audio.json");
});

test("a preview keeps both picture tracks when their lengths differ", (t) => {
  const dir = setupFilm(t, "mix-tracks-");
  const run = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=blue:s=160x90:r=12:d=1",
      "-f",
      "lavfi",
      "-i",
      "color=red:s=320x180:r=12:d=1.5",
      "-map",
      "0:v",
      "-map",
      "1:v",
      "-c:v",
      "libx264",
      "angles.mp4",
    ],
    { cwd: dir, encoding: "utf8", timeout: 20_000 },
  );
  assert.equal(run.status, 0, run.stderr);
  const mixed = runMix(dir, ["angles.mp4"]);
  assert.equal(mixed.status, 0, mixed.stdout + mixed.stderr);
  const path = mixed.stdout.match(/muxed (renders\/mixed_[^/]+\/preview\.mp4)/)?.[1];
  assert.ok(path);
  const probe = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "V",
      "-show_entries",
      "stream=duration",
      "-of",
      "csv=p=0",
      join(dir, path),
    ],
    { encoding: "utf8", timeout: 20_000 },
  );
  assert.equal(probe.status, 0, probe.stderr);
  assert.deepEqual(probe.stdout.trim().split(/\r?\n/).map(Number), [1, 1.5]);
});

test("mix accepts display side data and retains portrait rotation in the preview", (t) => {
  const dir = setupFilm(t, "mix-rotated-");
  makeMp4(join(dir, "plain.mp4"), { dur: 1.4 });
  const rotate = spawnSync(
    "ffmpeg",
    ["-v", "error", "-display_rotation", "90", "-i", "plain.mp4", "-c", "copy", "portrait.mp4"],
    { cwd: dir, encoding: "utf8", timeout: 20_000 },
  );
  assert.equal(rotate.status, 0, rotate.stderr);
  const result = runMix(dir, ["portrait.mp4", "--start", "0"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const preview = /^muxed (renders\/mixed_.*\/preview\.mp4)$/m.exec(result.stdout)?.[1];
  assert.ok(preview);
  const probe = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "V:0",
      "-show_entries",
      "stream_side_data=rotation",
      "-of",
      "json",
      preview,
    ],
    { cwd: dir, encoding: "utf8", timeout: 20_000 },
  );
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(JSON.parse(probe.stdout).streams[0].side_data_list[0].rotation, 90);
});

test("a picture-only MKV preview follows the picture end instead of a longer subtitle track", (t) => {
  const dir = setupFilm(t, "mix-mkv-subtitle-", {
    edit: { end: 5, voice: { lines: [], warp: [] } },
  });
  makeMp4(join(dir, "plain.mp4"), { dur: 2 });
  writeFileSync(
    join(dir, "cue.srt"),
    "1\n00:00:03,000 --> 00:00:04,500\nSubtitle after the picture\n",
  );
  const fixture = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      "plain.mp4",
      "-i",
      "cue.srt",
      "-map",
      "0:v",
      "-map",
      "1:s",
      "-c",
      "copy",
      "subbed.mkv",
    ],
    { cwd: dir, encoding: "utf8", timeout: 20_000 },
  );
  assert.equal(fixture.status, 0, fixture.stderr);
  const source = readFileSync(join(dir, "subbed.mkv"));
  const result = runMix(dir, ["subbed.mkv", "--start", "0"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /source tracks kept only in the source file: subtitle/);
  assert.deepEqual(readFileSync(join(dir, "subbed.mkv")), source);
  const preview = /^muxed (renders\/mixed_.*\/preview\.mp4)$/m.exec(result.stdout)?.[1];
  assert.ok(preview);
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "stream=codec_type,duration", "-of", "json", preview],
    { cwd: dir, encoding: "utf8", timeout: 20_000 },
  );
  assert.equal(probe.status, 0, probe.stderr);
  const tracks = JSON.parse(probe.stdout).streams;
  assert.deepEqual(
    tracks.map((s) => s.codec_type),
    ["video", "audio"],
  );
  assert.ok(
    tracks.every((s) => Math.abs(Number(s.duration) - 2) <= 0.002),
    probe.stdout,
  );
});

test(
  "a stream-copy VFR preview keeps a cue after the declared picture duration",
  { timeout: 30_000 },
  (t) => {
    const dir = setupFilm(t, "mix-vfr-tail-", {
      edit: { end: 4, voice: { lines: [], warp: [] } },
      audio: { lufs: -14, beds: [], sfx: [{ name: "hit", at: 2.87, length: 0.09, gain: 0 }] },
    });
    makeWav(join(dir, "sound/sfx/hit.wav"), { dur: 0.2 });
    const ffmpeg = (...args) =>
      spawnSync("ffmpeg", args, { cwd: dir, encoding: "utf8", timeout: 20_000 });
    const render = ffmpeg(
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=320x180:r=20:d=2",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=d=4",
      "-filter_complex",
      "[0:v]select='eq(mod(n,4),0)+eq(n,19)+eq(n,21)+eq(n,39)',setpts=PTS+1/TB[v]",
      "-map",
      "[v]",
      "-map",
      "1:a",
      "-fps_mode",
      "passthrough",
      "-c:v",
      "libx264",
      "-g",
      "4",
      "-bf",
      "2",
      "-threads",
      "2",
      "-c:a",
      "pcm_s16le",
      "source.mkv",
    );
    assert.equal(render.status, 0, render.stderr);
    const copy = ffmpeg(
      "-v",
      "error",
      "-i",
      "source.mkv",
      "-map",
      "0:v",
      "-c",
      "copy",
      "stream-copy.mp4",
    );
    assert.equal(copy.status, 0, copy.stderr);
    const result = runMix(dir, ["stream-copy.mp4", "--start", "1"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const preview = result.stdout.match(/muxed (renders\/mixed_[^/]+\/preview\.mp4)/)?.[1];
    assert.ok(preview, result.stdout);
    const audio = ffmpeg(
      "-v",
      "info",
      "-i",
      preview,
      "-map",
      "0:a:0",
      "-af",
      "silencedetect=n=-34dB:d=0.01",
      "-f",
      "null",
      "-",
    );
    assert.equal(audio.status, 0, audio.stderr);
    const onset = Number(audio.stderr.match(/silence_end: ([\d.]+)/)?.[1]);
    assert.ok(Math.abs(onset - 1.87) < 0.02, audio.stderr);
    const sheet = spawnSync(
      "python",
      [join(ROOT, "scripts/review/sheet.py"), preview, "frames", "1.87"],
      { cwd: dir, encoding: "utf8", timeout: 20_000 },
    );
    assert.equal(sheet.status, 0, sheet.stdout + sheet.stderr);
    const index = sheet.stdout.match(/^index: (.+)$/m)?.[1].trim();
    assert.ok(index, sheet.stdout);
    assert.equal(JSON.parse(readFileSync(index, "utf8")).entries[0].sourceTime, 1.8);
  },
);

test("the master and encoded draft keep a hit inside the final five milliseconds", (t) => {
  const dir = setupFilm(t, "mix-limiter-tail-", {
    edit: { end: 4, voice: { lines: [], warp: [] } },
    audio: { beds: [], sfx: [{ name: "hit", at: 3.995, length: 0.005, gain: 0 }] },
  });
  makeWav(join(dir, "sound/sfx/hit.wav"), { freq: 1200, dur: 0.005 });
  makeMp4(join(dir, "renders/draft_video.mp4"), { dur: 4 });
  const mix = runMix(dir, ["renders/draft_video.mp4"]);
  assert.equal(mix.status, 0, mix.stdout + mix.stderr);
  for (const path of ["sound/mix.wav", "renders/draft.mp4"]) {
    const r = spawnSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        path,
        "-map",
        "0:a:0",
        "-af",
        "atrim=start=3.995:end=4",
        "-ac",
        "1",
        "-f",
        "f32le",
        "-",
      ],
      { cwd: dir, timeout: 20_000 },
    );
    assert.equal(r.status, 0, String(r.stderr));
    assert.equal(r.stdout.length / 4, 240);
    const samples = [...new Float32Array(r.stdout.buffer, r.stdout.byteOffset, 240)];
    assert.ok(
      samples.some((sample) => Math.abs(sample) > 0.05),
      path,
    );
  }
});

test("mixing a span selects its film audio and preserves the whole draft and WAV", (t) => {
  const dir = setupFilm(t, "mix-span-", {
    audio: { voice: false, beds: [], sfx: [{ name: "hit", at: 1.2, gain: 0 }] },
  });
  makeWav(join(dir, "sound/sfx/hit.wav"), { dur: 0.2 });
  makeMp4(join(dir, "renders/span_1-2.5.mp4"), { dur: 1.5 });
  writeFileSync(join(dir, "renders/draft.mp4"), "prior draft");
  writeFileSync(join(dir, "sound/mix.wav"), "prior soundtrack");

  const result = runMix(dir, ["renders/span_1-2.5.mp4"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /file second 0 uses film audio from 1 s/);
  const artifact = result.stdout.match(/muxed (renders\/mixed_[^/]+\/preview\.mp4)/)?.[1];
  assert.ok(artifact, result.stdout);
  assert.match(result.stdout, /preview audio .* LUFS, peak/);
  assert.doesNotMatch(result.stdout, /YouTube plays|scratch/);
  const full = join(dir, artifact);
  const length = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=duration",
      "-of",
      "csv=p=0",
      full,
    ],
    { encoding: "utf8", timeout: 20_000 },
  );
  assert.equal(length.status, 0, length.stderr);
  assert.equal(Number(length.stdout.trim()), 1.5);
  const samples = readSamples(full);
  assert.ok(sliceRms(samples, 0.24, 0.36) > 0.04, "hit arrives in the rendered preview");
  assert.ok(sliceRms(samples, 0.04, 0.12) < 0.001, "the preview leads into the hit with silence");
  assert.equal(readFileSync(join(dir, "renders/draft.mp4"), "utf8"), "prior draft");
  assert.equal(readFileSync(join(dir, "sound/mix.wav"), "utf8"), "prior soundtrack");
});

test("a damaged source cannot replace the last good draft or its review data", (t) => {
  const dir = setupFilm(t, "mix-corrupt-", {
    audio: { voice: false, beds: [], sfx: [{ name: "hit", at: 0.4, gain: 0 }] },
  });
  const wav = join(dir, "sound/sfx/hit.wav");
  const video = join(dir, "renders/draft_video.mp4");
  makeWav(wav, { dur: 1.2 });
  makeMp4(video, { dur: 2 });
  const args = ["renders/draft_video.mp4"];
  const first = runMix(dir, args);
  assert.equal(first.status, 0, first.stderr);
  const deliverables = ["renders/draft.mp4", "renders/draft.mp4.review.json", "sound/mix.wav"];
  const good = deliverables.map((file) => readFileSync(join(dir, file)));

  const wave = readFileSync(wav);
  writeFileSync(wav, wave.subarray(0, Math.floor(wave.length * 0.62)));
  const damagedSound = runMix(dir, args);
  assert.equal(damagedSound.status, 1, damagedSound.stdout + damagedSound.stderr);
  assert.deepEqual(
    deliverables.map((file) => readFileSync(join(dir, file))),
    good,
  );
  writeFileSync(wav, wave);

  const probe = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_packets",
      "-show_entries",
      "packet=pos,flags",
      "-of",
      "json",
      video,
    ],
    { encoding: "utf8", timeout: 20_000 },
  );
  assert.equal(probe.status, 0, probe.stderr);
  const packet = JSON.parse(probe.stdout).packets.find(
    (candidate) => !candidate.flags.includes("K"),
  );
  assert.ok(packet);
  const bytes = readFileSync(video);
  bytes.writeUInt32BE(0x7fff_ffff, Number(packet.pos));
  writeFileSync(video, bytes);
  const damagedPicture = runMix(dir, args);
  assert.equal(damagedPicture.status, 1, damagedPicture.stdout + damagedPicture.stderr);
  assert.match(damagedPicture.stderr, /picture check failed; previous output kept/);
  assert.deepEqual(
    deliverables.map((file) => readFileSync(join(dir, file))),
    good,
  );
});

test("the final measures silence when planned sound falls beyond the picture", (t) => {
  const dir = setupFilm(t, "mix-audio-tail-", {
    edit: { end: 5, voice: { lines: [], warp: [] } },
    audio: { voice: false, beds: [], sfx: [{ name: "hit", at: 3, gain: 0 }] },
  });
  makeWav(join(dir, "sound/sfx/hit.wav"), { dur: 0.25 });
  makeMp4(join(dir, "renders/final_video.mp4"), { dur: 2 });
  const result = runMix(dir, ["renders/final_video.mp4"]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /encoded audio is silent/);
  assert.match(
    result.stdout,
    /picture ends at 2 s; soundtrack from there to 5 s stays in sound\/mix.wav/,
  );
  assert.doesNotMatch(result.stdout, /loudness is ready/);
  const samples = readSamples(join(dir, "renders/final.mp4"));
  assert.ok(sliceRms(samples, 0.1, 1.9) < 0.001);
});

test("muxes silent video into renders/draft.mp4 and renders/final.mp4, creates renders/, reports job ok, and prints next:", async (t) => {
  const dir = setupFilm(t, "mix-mux-ok-", {
    audio: { voice: false, beds: [], sfx: [{ name: "hit", at: 1, gain: 0 }] },
  });
  makeWav(join(dir, "sound/sfx/hit.wav"));
  rmSync(join(dir, "renders"), { recursive: true, force: true });
  mkdirSync(join(dir, "renders"));
  makeMp4(join(dir, "renders/draft_video.mp4"), { dur: 1.5 });
  const srv = await startMockStudio(dir);
  t.after(srv.close);

  const draftRes = await runMixAsync(dir, ["renders/draft_video.mp4"]);
  assert.equal(draftRes.status, 0, draftRes.stderr);
  assert.equal(existsSync(join(dir, "renders/draft.mp4")), true);
  assert.match(draftRes.stdout, /muxed renders\/draft\.mp4/);
  assert.match(draftRes.stdout.trim().split(/\r?\n/).at(-1), /^next: bun run listen/);

  makeMp4(join(dir, "renders/final_video.mp4"), { dur: 3 });
  const finalRes = await runMixAsync(dir, ["renders/final_video.mp4"]);
  assert.equal(finalRes.status, 0, finalRes.stderr);
  assert.equal(existsSync(join(dir, "renders/final.mp4")), true);
  assert.match(finalRes.stdout, /muxed renders\/final\.mp4/);
  const mixedMeta = JSON.parse(readFileSync(join(dir, "renders/final.mp4.review.json"), "utf8"));
  assert.equal(mixedMeta.audioInputs[0].path, "sound/sfx/hit.wav");
  assert.ok(mixedMeta.pictureInput?.size > 0);
  assert.match(finalRes.stdout.trim().split(/\r?\n/).at(-1), /^next: bun run listen/);

  const probe = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-count_packets",
      "-show_entries",
      "stream=codec_type,codec_name,nb_read_packets,start_time",
      "-of",
      "json",
      join(dir, "renders/final.mp4"),
    ],
    { encoding: "utf8" },
  );
  assert.equal(probe.status, 0, probe.stderr);
  const codecs = JSON.parse(probe.stdout).streams.map((s) => `${s.codec_type}:${s.codec_name}`);
  assert.deepEqual(codecs.sort(), ["audio:aac", "video:h264"]);
  const picture = JSON.parse(probe.stdout).streams.find((s) => s.codec_type === "video");
  assert.equal(Number(picture.nb_read_packets), 72);
  assert.equal(Number(picture.start_time), 0);

  makeWav(join(dir, "sound/sfx/hit.wav"), { dur: 0.25, silence: true });
  const stale = spawnSync(
    "bun",
    [join(ROOT, "packages/live-studio/src/stale.mjs"), "renders/final.mp4", "--json"],
    { cwd: dir, encoding: "utf8", timeout: 20_000 },
  );
  assert.equal(stale.status, 0, stale.stderr);
  assert.equal(JSON.parse(stale.stdout).stale.file, "sound/sfx/hit.wav");

  if (process.platform === "win32") {
    const paths = [
      "renders/final.mp4",
      "renders/final.mp4.review.json",
      "sound/mix.wav",
      "sound/mix_raw.wav",
    ];
    const prior = paths.map((p) => readFileSync(join(dir, p)));
    const locked = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        [
          "$held = [IO.File]::Open('renders/final.mp4', 'Open', 'Read', 'Read')",
          "try { python $env:MC_MIX_ENTRY renders/final_video.mp4; exit $LASTEXITCODE } finally { $held.Dispose() }",
        ].join("\n"),
      ],
      { cwd: dir, encoding: "utf8", timeout: 30_000, env: { ...process.env, MC_MIX_ENTRY: MIX } },
    );
    assert.equal(locked.status, 1, locked.stdout + locked.stderr);
    assert.deepEqual(
      paths.map((p) => readFileSync(join(dir, p))),
      prior,
    );
  }
  assert.equal(srv.events.at(-1).level, "ok");
});

test("renders timing freeze, muted track, choices, gainKeys step, and --live-lanes", (t) => {
  const dir = setupFilm(t, "mix-parity-", {
    pkg: { "live-studio": { timingTimeline: "src/timeline/timing.json" } },
    edit: {
      end: 2.0,
      voice: {
        lines: [
          [0.1, 0.45],
          [0.6, 0.9],
        ],
        warp: [],
      },
    },
    timing: { freezes: [{ at: 0.5, duration: 1.0 }] },
    choices: {
      narr: { set: "narr_alt", gain: 1.0 },
      sil_opt: { set: "silence" },
      cut_bed: { set: "off" },
    },
    audio: {
      narration: "narr",
      tracks: [
        { id: "muted", mute: true, gain: 0 },
        { id: "eq", gain: -6, filters: ["highpass=f=1500"] },
      ],
      beds: [
        { name: "bed", from: 0, to: 2.0, gain: -6, fadeIn: 0, fadeOut: 0, duck: 18 },
        { name: "cut_bed", from: 0, to: 2.0, gain: 0, fadeIn: 0, fadeOut: 0 },
      ],
      sfx: [
        { at: 0.0, name: "narr", start: 0.0, length: 0.5, gain: 0, try: ["narr_alt"] },
        { at: 0.5, name: "narr", start: 0.5, length: 0.5, gain: 0 },
        { at: 1.5, name: "sil_opt", gain: 0, try: ["silence"] },
        { at: 1.7, name: "muted_hit", gain: 0, track: "muted" },
        {
          at: 1.8,
          name: "low_eq",
          length: null,
          gain: 0,
          track: "eq",
          gainKeys: [
            { t: 0, gain: 0 },
            { t: 0.05, gain: 0 },
            { t: 0.05, gain: -20 },
          ],
        },
      ],
    },
  });

  makeWav(join(dir, "sound/sfx/bed.wav"), { freq: 220, dur: 2.0 });
  makeWav(join(dir, "sound/sfx/cut_bed.wav"), { freq: 330, dur: 2.0 });
  makeWav(join(dir, "sound/sfx/narr.wav"), { freq: 880, dur: 1.2 });
  makeWav(join(dir, "sound/sfx/narr_alt.wav"), { freq: 660, dur: 1.2, ogg: true });
  makeWav(join(dir, "sound/sfx/sil_opt.wav"), { freq: 500, dur: 0.4 });
  makeWav(join(dir, "sound/sfx/silence.wav"), { dur: 0.4, silence: true });
  makeWav(join(dir, "sound/sfx/muted_hit.wav"), { freq: 1200, dur: 0.4 });
  makeWav(join(dir, "sound/sfx/low_eq.wav"), { freq: 200, dur: 0.25 });

  const outWav = join(dir, "sound/out.wav");
  const rawRes = runMix(dir, ["--raw", "sound/out.wav"]);
  assert.equal(rawRes.status, 0, rawRes.stderr);
  assert.doesNotMatch(rawRes.stderr, /Traceback/);
  const samples = readSamples(outWav);
  // 2.0s edit + 1.0s freeze = 3.0s at 48kHz stereo
  assert.ok(Math.abs(samples.length / 2 / 48_000 - 3.0) < 0.02);

  const liveWav = join(dir, "sound/live.wav");
  const liveRes = runMix(dir, ["--raw", "sound/live.wav", "--live-lanes"]);
  assert.equal(liveRes.status, 0, liveRes.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "sound/trials.json"), "utf8")), {});
  const liveSamples = readSamples(liveWav);
  assert.equal(sliceRms(liveSamples, 0, 2.9), 0);
});

test("keeps partial narration try swap ducking active under timing freeze", (t) => {
  // Check bed ducks during second narration piece shifted past 1.0s freeze (1.6s..1.9s) compared to un-ducked tail (2.4s..2.8s)
  const unduckedBedOnly = setupFilm(t, "mix-bed-duck-");
  makeWav(join(unduckedBedOnly, "sound/sfx/bed.wav"), { freq: 220, dur: 3.0 });
  makeWav(join(unduckedBedOnly, "sound/sfx/narr.wav"), { dur: 1.2, silence: true });
  makeWav(join(unduckedBedOnly, "sound/sfx/narr_alt.wav"), { dur: 1.2, silence: true, ogg: true });
  writeFileSync(
    join(unduckedBedOnly, "package.json"),
    JSON.stringify({ "live-studio": { timingTimeline: "src/timeline/timing.json" } }),
  );
  writeFileSync(
    join(unduckedBedOnly, "src/edit.json"),
    JSON.stringify({
      end: 2.0,
      voice: {
        lines: [
          [0.1, 0.45],
          [0.6, 0.9],
        ],
        warp: [],
      },
    }),
  );
  writeFileSync(
    join(unduckedBedOnly, "src/timeline/timing.json"),
    JSON.stringify({ freezes: [{ at: 0.5, duration: 1.0 }] }),
  );
  writeFileSync(
    join(unduckedBedOnly, "choices.json"),
    JSON.stringify({ narr: { set: "narr_alt" } }),
  );
  writeFileSync(
    join(unduckedBedOnly, "src/timeline/audio.json"),
    JSON.stringify({
      narration: "narr",
      beds: [{ name: "bed", from: 0, to: 2.0, gain: -6, fadeIn: 0, fadeOut: 0, duck: 18 }],
      sfx: [
        { at: 0.0, name: "narr", start: 0.0, length: 0.5, gain: 0, try: ["narr_alt"] },
        { at: 0.5, name: "narr", start: 0.5, length: 0.5, gain: 0 },
      ],
    }),
  );
  const duckRes = runMix(unduckedBedOnly, ["--raw", "sound/duck.wav"]);
  assert.equal(duckRes.status, 0, duckRes.stderr);
  const duckSamples = readSamples(join(unduckedBedOnly, "sound/duck.wav"));
  const rmsAtSecondLine = sliceRms(duckSamples, 1.65, 1.85);
  const rmsAfterSpeech = sliceRms(duckSamples, 2.5, 2.8);
  assert.ok(
    rmsAtSecondLine < rmsAfterSpeech * 0.25,
    `expected second narration clip after partial swap to duck bed: ${rmsAtSecondLine} vs ${rmsAfterSpeech}`,
  );
});

test("--measure handles length:null, silence, and invalid index cleanly", (t) => {
  const dir = setupFilm(t, "mix-measure-");
  makeWav(join(dir, "sound/sfx/hit.wav"), { dur: 0.6 });
  makeWav(join(dir, "sound/sfx/sil.wav"), { dur: 0.6, silence: true });

  const nullLen = runMix(
    dir,
    ["--measure", "sfx", "0"],
    JSON.stringify({
      voice: false,
      beds: [],
      sfx: [{ at: 0, name: "hit", gain: 0, length: null }],
    }),
  );
  assert.equal(nullLen.status, 0, nullLen.stderr);
  const parsedNull = JSON.parse(nullLen.stdout);
  assert.equal(typeof parsedNull.loudness, "number");

  const silRes = runMix(
    dir,
    ["--measure", "sfx", "0"],
    JSON.stringify({ voice: false, beds: [], sfx: [{ at: 0, name: "sil", gain: 0 }] }),
  );
  assert.equal(silRes.status, 0, silRes.stderr);
  assert.deepEqual(JSON.parse(silRes.stdout), { loudness: null, peak: null });

  const oob = runMix(
    dir,
    ["--measure", "sfx", "4"],
    JSON.stringify({ voice: false, beds: [], sfx: [] }),
  );
  assert.equal(oob.status, 1);
  assert.doesNotMatch(oob.stderr, /Traceback/);
  assert.match(oob.stderr, /sfx\[4\] does not exist/);
});

test("process.py and beats.py handle zero-span retiming, micro-loops, and past-end clips cleanly", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "mix-proc-beats-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  makeWav(join(dir, "ok.wav"), { dur: 0.5 });

  const twoSamples = join(dir, "tiny.wav");
  const mkTiny = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=48000:cl=stereo",
      "-af",
      "atrim=end_sample=2",
      "-c:a",
      "pcm_f32le",
      twoSamples,
    ],
    { encoding: "utf8" },
  );
  assert.equal(mkTiny.status, 0, mkTiny.stderr);

  const loopRes = spawnSync("python", [PROCESS, twoSamples, join(dir, "looped.wav")], {
    input: JSON.stringify({ start: 0, duration: 0.2, loop: true }),
    encoding: "utf8",
  });
  assert.equal(loopRes.status, 0, loopRes.stderr);

  const zeroSpan = spawnSync("python", [PROCESS, join(dir, "ok.wav"), join(dir, "retimed.wav")], {
    input: JSON.stringify({
      duration: 0.5,
      start: 0,
      timeline: [
        { kind: "play", from: 0, to: 0.5, sourceFrom: 0.2, sourceTo: 0.2, rate0: 1, rate1: 1 },
      ],
    }),
    encoding: "utf8",
  });
  assert.equal(zeroSpan.status, 0, zeroSpan.stderr);

  const beatsEmpty = spawnSync("python", [BEATS, join(dir, "ok.wav")], {
    input: JSON.stringify({ duration: 0.5, start: 2.0 }),
    encoding: "utf8",
  });
  assert.equal(beatsEmpty.status, 0, beatsEmpty.stderr);
  assert.doesNotMatch(beatsEmpty.stderr, /UserWarning/);
  assert.deepEqual(JSON.parse(beatsEmpty.stdout), { bpm: 0, beats: [] });

  const beatsMissingDur = spawnSync("python", [BEATS, join(dir, "ok.wav")], {
    input: JSON.stringify({ start: 0 }),
    encoding: "utf8",
  });
  assert.equal(beatsMissingDur.status, 1);
  assert.doesNotMatch(beatsMissingDur.stderr, /Traceback/);
  assert.match(beatsMissingDur.stderr, /Missing required duration/);
});

test("a narration clip starting midway through repeated picture stays aligned with its cues", async (t) => {
  const dir = setupFilm(t, "mix-repeated-midclip-", {
    edit: { end: 4 },
    audio: { narration: "narr", beds: [], sfx: [{ name: "narr", at: 1, length: 2, gain: 0 }] },
    pkg: {
      "live-studio": {
        sfx: "sound/sfx",
        soundVault: false,
        soundTimeline: "src/timeline/audio.json",
        timingTimeline: "src/timeline/timing.json",
      },
    },
    timing: {
      main: [
        { id: "first", kind: "clip", sourceFrom: 0, sourceTo: 2 },
        { id: "repeat", kind: "clip", sourceFrom: 0, sourceTo: 2 },
      ],
    },
  });
  const file = join(dir, "sound/sfx/narr.wav");
  makeWav(file, { dur: 4 });
  const bytes = readFileSync(file);
  bytes.fill(0, 44, 44 + 0.1 * 48000 * 4);
  bytes.fill(0, 44 + 0.4 * 48000 * 4);
  writeFileSync(file, bytes);
  mkdirSync(join(dir, "renders/live"), { recursive: true });
  writeFileSync(
    join(dir, "renders/live/voice_map.json"),
    JSON.stringify({
      lines: [{ s: 0.1, e: 0.4, text: "hello", words: [{ w: "hello", s: 0.1, e: 0.4 }] }],
    }),
  );
  const { buildVoiceCues } = await import("../voice/cues.ts");
  const { whatsAt } = await import("../at.ts");
  const cues = buildVoiceCues(dir).lines;
  assert.deepEqual(
    cues.map(({ s, e }) => [s, e]),
    [
      [1.1, 1.4],
      [3.1, 3.4],
    ],
  );
  assert.equal(whatsAt(dir, 3.2).narration?.word, "hello");
  const mixed = runMix(dir, ["--raw", "sound/out.wav"]);
  assert.equal(mixed.status, 0, mixed.stderr);
  const samples = readSamples(join(dir, "sound/out.wav"));
  for (const cue of cues) assert.ok(sliceRms(samples, cue.s + 0.05, cue.e - 0.05) > 0.01);
  assert.ok(sliceRms(samples, 2.3, 2.6) < 0.0001);
});

for (const bricks of [true, false]) {
  test(`voice metadata follows WAV samples with narrative warp (${bricks ? "bricks" : "legacy"})`, async (t) => {
    const voice = {
      lines: [],
      edits: {},
      warp: [
        [0, 0],
        [4, 2],
      ],
    };
    const dir = setupFilm(t, "mix-voice-data-clock-", {
      edit: { end: 4, voice, beats: {}, takes: [{ id: "01", start: 0, text: "hello" }] },
      audio: { ...(bricks ? { narration: "narration" } : { voice: true }), beds: [], sfx: [] },
      pkg: {
        "live-studio": {
          soundTimeline: "src/timeline/audio.json",
          timingTimeline: "src/timeline/timing.json",
          sfx: "sound/sfx",
          soundVault: false,
          soundSources: { narration: "assets/public/agent/full_voice.wav" },
        },
      },
      timing: {},
    });
    writeFileSync(join(dir, "src/scene.ts"), "");
    const file = join(dir, "voice/takes/01.wav");
    makeWav(file, { dur: 3 });
    const bytes = readFileSync(file);
    bytes.fill(0, 44, 44 + 48000 * 4);
    bytes.fill(0, 44 + 2 * 48000 * 4);
    writeFileSync(file, bytes);
    writeFileSync(
      file + ".words.json",
      JSON.stringify({ dur: 3, words: [{ w: "hello", s: 1, e: 2 }] }),
    );
    const { runAssemble } = await import("../voice/assemble.ts");
    const { buildVoiceCues } = await import("../voice/cues.ts");
    const { whatsAt } = await import("../at.ts");
    const { mouthCues } = await import("../../packages/live-studio/src/lips.ts");
    await runAssemble({ cwd: dir, args: bricks ? ["--clips"] : [] });
    const mixed = runMix(dir, ["--raw", "sound/out.wav"]);
    assert.equal(mixed.status, 0, mixed.stderr);
    const samples = readSamples(join(dir, "sound/out.wav"));
    assert.ok(sliceRms(samples, 0.6, 0.9) < 0.0001);
    assert.ok(sliceRms(samples, 1.3, 1.6) > 0.01);
    const cues = buildVoiceCues(dir);
    assert.equal(cues.duration, 2);
    assert.deepEqual(
      cues.lines.map(({ s, e }) => [s, e]),
      [[1, 2]],
    );
    assert.equal(whatsAt(dir, 0.75).narration, null);
    assert.equal(whatsAt(dir, 1.5).narration?.word, "hello");
    const audio = JSON.parse(readFileSync(join(dir, "src/timeline/audio.json"), "utf8"));
    assert.deepEqual(
      mouthCues(
        {
          voice,
          audio,
          takes: [{ id: "01", by: "steve" }],
          mouth: {
            takes: [
              {
                id: "01",
                at: 0,
                cues: [
                  [1, "D"],
                  [2, "X"],
                ],
              },
            ],
          },
        },
        "steve",
      ),
      [
        [1, "D"],
        [2, "X"],
      ],
    );
    const intervals = spawnSync(
      "python",
      [
        "-c",
        "import json,runpy,sys; m=runpy.run_path(sys.argv[1]); print(json.dumps(m['voice_intervals']()))",
        MIX,
      ],
      { cwd: dir, encoding: "utf8", timeout: 30000 },
    );
    assert.equal(intervals.status, 0, intervals.stderr);
    assert.deepEqual(JSON.parse(intervals.stdout), [[1, 2]]);
    const captions = spawnSync(
      process.execPath,
      [join(ROOT, "packages/live-studio/render.mjs"), "captions"],
      { cwd: dir, encoding: "utf8", timeout: 30000 },
    );
    assert.equal(captions.status, 0, captions.stdout + captions.stderr);
    assert.match(
      readFileSync(join(dir, "renders/draft_video.srt"), "utf8"),
      /00:00:01,000 --> 00:00:02,000/,
    );
  });
}

for (const scenario of [
  { label: "off sfx", set: "off", beds: [], sfx: [{ name: "beep", at: 2.1, gain: 0 }], ok: true },
  {
    label: "off bed",
    set: "off",
    beds: [{ name: "beep", from: 2.1, to: 2.6, gain: 0, fadeIn: 0, fadeOut: 0 }],
    sfx: [],
    ok: true,
  },
  {
    label: "replacement offset",
    set: "long",
    beds: [],
    sfx: [{ name: "beep", at: 0.1, start: 0.6, gain: 0, try: ["long"] }],
    ok: true,
  },
  {
    label: "unlisted replacement",
    set: "missing",
    beds: [],
    sfx: [{ name: "beep", at: 0.1, start: 0.6, gain: 0, try: ["long"] }],
    ok: false,
  },
]) {
  test(`check uses the played choice for ${scenario.label}`, (t) => {
    const dir = setupFilm(t, "mix-check-choice-", {
      edit: { end: 2, voice: { edits: {}, warp: [], lines: [] }, beats: {} },
      pkg: {
        "live-studio": {
          soundTimeline: "src/timeline/audio.json",
          sfx: "sound/sfx",
          soundVault: false,
        },
      },
      audio: { voice: false, beds: scenario.beds, sfx: scenario.sfx },
      choices: { beep: { set: scenario.set } },
    });
    writeFileSync(join(dir, "src/scene.ts"), "");
    makeWav(join(dir, "sound/sfx/beep.wav"), { dur: 0.5 });
    makeWav(join(dir, "sound/sfx/long.wav"), { dur: 2 });
    const checked = spawnSync("bun", [join(ROOT, "packages/live-studio/check.mjs"), "--json"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(checked.status, scenario.ok ? 0 : 1, checked.stdout + checked.stderr);
    const report = JSON.parse(checked.stdout);
    assert.equal(report.ok, scenario.ok);
    if (scenario.ok) {
      const mixed = runMix(dir, ["--raw", "sound/out.wav"]);
      assert.equal(mixed.status, 0, mixed.stderr);
    } else assert.match(JSON.stringify(report.problems), /start 0.6/);
  });
}

test("check rejects video-only sound sources and accepts audio in the same container", (t) => {
  const dir = setupFilm(t, "mix-video-source-", {
    edit: { end: 2, voice: { edits: {}, warp: [], lines: [] }, beats: {} },
    pkg: {
      "live-studio": {
        soundTimeline: "src/timeline/audio.json",
        sfx: "sound/sfx",
        soundVault: false,
        soundSources: { media: "sound/media.mp4" },
      },
    },
    audio: { voice: false, beds: [], sfx: [{ name: "media", at: 0, gain: 0 }] },
  });
  writeFileSync(join(dir, "src/scene.ts"), "");
  for (const audio of [false, true]) {
    makeMp4(join(dir, "sound/media.mp4"), { audio });
    const checked = spawnSync("bun", [join(ROOT, "packages/live-studio/check.mjs"), "--json"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(checked.status, audio ? 0 : 1, checked.stdout + checked.stderr);
    const report = JSON.parse(checked.stdout);
    assert.equal(report.ok, audio);
    if (!audio) assert.match(JSON.stringify(report.problems), /media.*audio file/);
    const mixed = runMix(dir, ["--raw", "sound/out.wav"]);
    assert.equal(mixed.status, audio ? 0 : 1, mixed.stderr);
  }
});

test("check rejects the narration path refused by mix and skips disabled narration", (t) => {
  const dir = setupFilm(t, "mix-voice-junction-", {
    edit: { end: 2, voice: { edits: {}, warp: [], lines: [] }, beats: {} },
    pkg: {
      "live-studio": {
        soundTimeline: "src/timeline/audio.json",
        sfx: "sound/sfx",
        soundVault: false,
      },
    },
  });
  writeFileSync(join(dir, "src/scene.ts"), "");
  makeWav(join(dir, "voice-source/full_voice.wav"));
  mkdirSync(join(dir, "assets/public"), { recursive: true });
  symlinkSync(join(dir, "voice-source"), join(dir, "assets/public/agent"), "junction");
  for (const voice of [true, false]) {
    writeFileSync(
      join(dir, "src/timeline/audio.json"),
      JSON.stringify({ voice, beds: [], sfx: [] }),
    );
    const checked = spawnSync("bun", [join(ROOT, "packages/live-studio/check.mjs"), "--json"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(checked.status, voice ? 1 : 0, checked.stdout + checked.stderr);
    const report = JSON.parse(checked.stdout);
    if (voice) assert.match(JSON.stringify(report.problems), /Voice audio.*symlink or junction/);
    if (voice) {
      const mixed = runMix(dir, ["--raw", "sound/out.wav"]);
      assert.equal(mixed.status, 1, mixed.stderr);
      assert.match(mixed.stderr, /Voice audio.*symlink or junction/);
    }
  }
});

test("trimmed clips render negative clip-local volume keys without losing the ramp", (t) => {
  const dir = setupFilm(t, "mix-negative-volume-", {
    audio: {
      voice: false,
      beds: [],
      sfx: [
        {
          name: "hit",
          at: 0,
          length: 2,
          gain: 0,
          gainKeys: [
            { t: -1, gain: -20 },
            { t: 1, gain: 0 },
          ],
        },
      ],
    },
  });
  makeWav(join(dir, "sound/sfx/hit.wav"), { dur: 2 });
  const mixed = runMix(dir, ["--raw", "sound/out.wav"]);
  assert.equal(mixed.status, 0, mixed.stderr);
  const samples = readSamples(join(dir, "sound/out.wav"));
  const early = sliceRms(samples, 0, 0.05);
  const late = sliceRms(samples, 1.2, 1.3);
  assert.ok(early > 0 && late > early * 2, `early ${early}, late ${late}`);
});

test("check rejects malformed legacy voice intervals and mix names the fault without a traceback", (t) => {
  const dir = setupFilm(t, "mix-invalid-voice-lines-", {
    pkg: {
      "live-studio": {
        soundTimeline: "src/timeline/audio.json",
        timingTimeline: "src/timeline/timing.json",
        sfx: "sound/sfx",
        soundVault: false,
      },
    },
    edit: { end: 2, voice: { edits: {}, warp: [], lines: ["broken"] }, beats: {} },
    timing: { speeds: [{ from: 0, to: 2, rate: 1 }] },
  });
  writeFileSync(join(dir, "src/scene.ts"), "");
  const checked = spawnSync("bun", [join(ROOT, "packages/live-studio/check.mjs"), "--json"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 10000,
  });
  const mixed = runMix(dir, ["--raw", "out.wav"]);
  assert.equal(checked.status, 1, checked.stdout + checked.stderr);
  assert.match(checked.stdout, /voice.*lines/);
  assert.equal(mixed.status, 1);
  assert.doesNotMatch(mixed.stderr, /Traceback/);
  assert.match(mixed.stderr, /voice.lines/);
  writeFileSync(
    join(dir, "src/edit.json"),
    JSON.stringify({ end: 2, voice: { edits: {}, warp: [], lines: [[0, 1]] }, beats: {} }),
  );
  assert.equal(runMix(dir, ["--raw", "out.wav"]).status, 0);
});

const trialBed = { name: "tone", from: 0, to: 0.3, gain: 0, fadeIn: 0, fadeOut: 0 };
for (const { label, placements, hasOptions } of [
  { label: "empty", placements: { beds: [{ ...trialBed, try: [] }], sfx: [] }, hasOptions: false },
  {
    label: "self",
    placements: { beds: [{ ...trialBed, try: ["tone"] }], sfx: [] },
    hasOptions: false,
  },
  {
    label: "duplicate",
    placements: { beds: [{ ...trialBed, try: ["alt", "alt", "tone"] }], sfx: [] },
    hasOptions: true,
  },
  {
    label: "mixed rows",
    placements: {
      beds: [trialBed, { ...trialBed, from: 0.5, to: 0.8, try: ["alt", "alt"] }],
      sfx: [],
    },
    hasOptions: true,
  },
  {
    label: "mixed kinds",
    placements: {
      beds: [{ ...trialBed, try: ["alt"] }],
      sfx: [{ name: "tone", at: 0.5, length: 0.3, gain: 0, try: ["alt"] }],
    },
    hasOptions: true,
  },
]) {
  test(`studio alternatives ${label} produce valid trials and preserve each placement`, (t) => {
    const dir = setupFilm(t, "mix-valid-alternatives-", { audio: { voice: false, ...placements } });
    makeWav(join(dir, "sound/sfx/tone.wav"), { dur: 1 });
    makeWav(join(dir, "sound/sfx/alt.wav"), { dur: 1, silence: true });
    const mixed = runMix(dir, ["--raw", "renders/live/mix.webm"]);
    assert.equal(mixed.status, 0, mixed.stderr);
    const trials = JSON.parse(readFileSync(join(dir, "renders/live/trials.json"), "utf8"));
    assert.equal(Trials.safeParse(trials).success, true, JSON.stringify(trials));
    if (!hasOptions) {
      assert.deepEqual(trials, {});
      return;
    }
    assert.deepEqual(
      trials.tone.options.map((o) => o.id),
      ["tone", "alt"],
    );
    assert.equal(trials.tone.from, 0);
    if (label === "mixed rows") {
      const samples = readSamples(join(dir, "assets/public/agent/stems/tone/alt.webm"));
      assert.ok(sliceRms(samples, 0.05, 0.15) > 0.001);
      assert.ok(sliceRms(samples, 0.55, 0.65) < 0.0001);
    }
    if (label === "mixed kinds") assert.equal(trials.tone.to, 0.8);
  });
}
