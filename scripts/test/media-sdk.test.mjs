import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { mediaFixture } from "./media-fixture.mjs";

const script = fileURLToPath(new URL("../media/sdk.py", import.meta.url));
const media = mediaFixture();
const adapter = fileURLToPath(new URL("../media/audio_sdk.py", import.meta.url));
const decodeAudio = (source, wav, start, end, rate = 48000, mono = true, pcmCodec = "pcm_s16le") =>
  spawnSync(
    "python",
    [
      "-c",
      "import pathlib,runpy,sys; decode=runpy.run_path(sys.argv[1])['decode_audio']; decode(sys.argv[2],pathlib.Path(sys.argv[3]),float(sys.argv[4]),float(sys.argv[5]),int(sys.argv[6]),sys.argv[7]=='true',lambda *_: None,pcm_codec=sys.argv[8])",
      adapter,
      source,
      wav,
      String(start),
      String(end),
      String(rate),
      String(mono),
      pcmCodec,
    ],
    { encoding: "utf8", timeout: 15000 },
  );

test("the SDK waveform retains the file clock for delayed audio in bounded ranges", (t) => {
  const root = mkdtempSync(join(tmpdir(), "media-sdk-clock-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "late.mkv");
  media(source, [
    "-f",
    "lavfi",
    "-i",
    "color=red:s=64x64:r=25:d=2",
    "-itsoffset",
    "0.35",
    "-f",
    "lavfi",
    "-i",
    "sine=f=1200:r=48000:d=1",
    "-c:v",
    "libx264",
    "-c:a",
    "pcm_s16le",
  ]);
  const transport = join(root, "late.ts");
  media(transport, [
    "-i",
    source,
    "-map",
    "0:v",
    "-map",
    "0:a",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-muxdelay",
    "0",
  ]);
  const shifted = join(root, "shifted.mp4");
  media(shifted, ["-i", source, "-c:v", "copy", "-c:a", "aac", "-output_ts_offset", "7.4"]);
  for (const [mediaPath, start] of [
    [source, 0],
    [source, 0.00002],
    [source, 0.2],
    [transport, 0.2],
    [shifted, 0.2],
  ]) {
    const wav = mediaPath + "-" + start + ".wav";
    const decode = decodeAudio(mediaPath, wav, start, 1.2);
    assert.equal(decode.status, 0, decode.stderr);
    const inspect = spawnSync(
      "ffmpeg",
      ["-hide_banner", "-i", wav, "-af", "silencedetect=n=-28dB:d=0.05", "-f", "null", "-"],
      { encoding: "utf8", timeout: 10000 },
    );
    assert.equal(inspect.status, 0, inspect.stderr);
    const first = Number(inspect.stderr.match(/silence_end: ([\d.]+)/)?.[1]);
    assert.ok(Math.abs(first + start - 0.35) < 0.004, inspect.stderr);
  }
});
test("MP3 slices match a whole decode when starting during a cue at different sample rates", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "media-sdk-mp3-preroll-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const start = 0.16;
  const end = 0.2;
  for (const sourceRate of [44100, 48000]) {
    const source = join(dir, "pulse-" + sourceRate + ".mp3");
    media(source, [
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=if(between(t\\,0.15\\,0.175)\\,0.7*sin(2*PI*1200*t)\\,0):s=" + sourceRate + ":d=1",
      "-c:a",
      "libmp3lame",
    ]);
    for (const outputRate of [16000, 48000]) {
      const wav = join(dir, "slice-" + sourceRate + "-" + outputRate + ".wav");
      const decode = decodeAudio(source, wav, start, end, outputRate);
      assert.equal(decode.status, 0, decode.stderr);
      const actual = spawnSync("ffmpeg", ["-v", "error", "-i", wav, "-f", "s16le", "-"], {
        timeout: 10000,
      });
      const whole = spawnSync(
        "ffmpeg",
        ["-v", "error", "-i", source, "-ar", String(outputRate), "-f", "s16le", "-"],
        { timeout: 10000 },
      );
      assert.equal(actual.status, 0, String(actual.stderr));
      assert.equal(whole.status, 0, String(whole.stderr));
      const expected = whole.stdout.subarray(start * outputRate * 2, end * outputRate * 2);
      const measurement = sourceRate + " Hz to " + outputRate + " Hz";
      assert.equal(actual.stdout.length, expected.length, measurement);
      assert.ok(actual.stdout.equals(expected), measurement);
    }
  }
});

test("SDK evidence spans an AAC sample rate change without losing the original clock", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "media-sdk-changing-rate-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const before = join(dir, "before.aac");
  const after = join(dir, "after.aac");
  media(before, ["-f", "lavfi", "-i", "sine=f=440:r=44100:d=0.7", "-c:a", "aac"]);
  media(after, [
    "-f",
    "lavfi",
    "-i",
    "aevalsrc=0.2*sin(2*PI*880*t)|-0.2*sin(2*PI*880*t):s=48000:d=0.7",
    "-c:a",
    "aac",
  ]);
  const source = join(dir, "change.aac");
  const sourceBytes = Buffer.concat([readFileSync(before), readFileSync(after)]);
  writeFileSync(source, sourceBytes);

  const wav = join(dir, "slice.wav");
  const decode = decodeAudio(source, wav, 0.2, 1.3, 48000, false);
  assert.equal(decode.status, 0, decode.stderr);
  const pcm = spawnSync("ffmpeg", ["-v", "error", "-i", wav, "-f", "s16le", "-"], {
    timeout: 10000,
  });
  assert.equal(pcm.status, 0, String(pcm.stderr));
  assert.equal(pcm.stdout.length / 4, 52800);
  for (const [from, hz] of [
    [0.1, 440],
    [0.85, 880],
  ]) {
    let crossings = 0;
    const first = Math.round(from * 48000);
    for (let i = first + 1; i < first + 4800; i++) {
      if (pcm.stdout.readInt16LE((i - 1) * 4) <= 0 && pcm.stdout.readInt16LE(i * 4) > 0) {
        crossings++;
      }
    }
    assert.ok(Math.abs(10 * crossings - hz) <= 10, "retains " + hz + " Hz in the selected window");
  }
  const afterSwitch = pcm.stdout.subarray(48000 * 4 * 0.85, 48000 * 4 * 0.95);
  let opposite = 0;
  for (let i = 0; i < afterSwitch.length; i += 4) {
    const left = afterSwitch.readInt16LE(i);
    const right = afterSwitch.readInt16LE(i + 2);
    if (left * right < -(1000 ** 2)) opposite++;
  }
  assert.ok(opposite > 3000, "keeps both opposite-phase channels above the noise floor");
  assert.ok(readFileSync(source).equals(sourceBytes));
});

test("transport normalization retains an entire PTS gap and keeps mono evidence unclipped", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "media-sdk-changing-gap-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const first = join(dir, "first.ts");
  const next = join(dir, "next.ts");
  const loudStereo = "aevalsrc=0.85*sin(2*PI*800*t)|0.85*sin(2*PI*800*t):s=48000:d=0.6";
  for (const [path, signal, offset] of [
    [first, "sine=f=800:r=44100:d=0.6", 0],
    [next, loudStereo, 1.2],
  ]) {
    media(path, [
      "-f",
      "lavfi",
      "-i",
      signal,
      "-c:a",
      "aac",
      "-muxdelay",
      "0",
      "-mpegts_flags",
      "+initial_discontinuity",
      "-output_ts_offset",
      String(offset),
    ]);
  }
  const source = join(dir, "change.ts");
  writeFileSync(source, Buffer.concat([readFileSync(first), readFileSync(next)]));
  const wav = join(dir, "gap.wav");
  const decode = decodeAudio(source, wav, 0.86, 1.02);
  assert.equal(decode.status, 0, decode.stderr);
  const pcm = spawnSync("ffmpeg", ["-v", "error", "-i", wav, "-f", "s16le", "-"], {
    timeout: 10000,
  });
  assert.equal(pcm.status, 0, String(pcm.stderr));
  assert.equal(pcm.stdout.length / 2, 7680);
  assert.ok(pcm.stdout.every((byte) => byte === 0));

  const louder = join(dir, "mono-after-switch.wav");
  const loudDecode = decodeAudio(source, louder, 1.35, 1.6);
  assert.equal(loudDecode.status, 0, loudDecode.stderr);
  const loud = spawnSync("ffmpeg", ["-v", "error", "-i", louder, "-f", "s16le", "-"], {
    timeout: 10000,
  });
  assert.equal(loud.status, 0, String(loud.stderr));
  const peak = Math.max(
    ...Array.from({ length: 12000 }, (_, sample) => Math.abs(loud.stdout.readInt16LE(sample * 2))),
  );
  assert.ok(peak > 25000 && peak < 31000, "in-phase stereo downmix peak was " + peak);
});

test("normalized surround evidence retains speaker labels and PCM channel order", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "media-sdk-speakers-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const first = join(dir, "stereo.ts");
  const next = join(dir, "quad.ts");
  const frequencies = [440, 530, 670, 890];
  for (const [path, layout, rate, offset, tones] of [
    [first, "stereo", 44100, 0, [110, 220]],
    [next, "quad", 48000, 1.2, frequencies],
  ]) {
    const signal = tones.map((hz) => "0.2*sin(2*PI*" + hz + "*t)").join("|");
    media(path, [
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=" + signal + ":c=" + layout + ":s=" + rate + ":d=0.6",
      "-c:a",
      "aac",
      "-muxdelay",
      "0",
      "-mpegts_flags",
      "+initial_discontinuity",
      "-output_ts_offset",
      String(offset),
    ]);
  }
  const source = join(dir, "change.ts");
  writeFileSync(source, Buffer.concat([readFileSync(first), readFileSync(next)]));
  const wav = join(dir, "slice.wav");
  const decode = decodeAudio(source, wav, 1.35, 1.6, 48000, false);
  assert.equal(decode.status, 0, decode.stderr);
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "stream=channel_layout", "-of", "default=nw=1:nk=1", wav],
    { encoding: "utf8", timeout: 10000 },
  );
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(probe.stdout.trim(), "quad");
  const pcm = spawnSync("ffmpeg", ["-v", "error", "-i", wav, "-f", "s16le", "-"], {
    timeout: 10000,
  });
  assert.equal(pcm.status, 0, String(pcm.stderr));
  assert.equal(pcm.stdout.length / 8, 12000);
  for (const [channel, hz] of frequencies.entries()) {
    let crossings = 0;
    const read = (i) => pcm.stdout.readInt16LE(i * 8 + channel * 2);
    for (let i = 481; i < 5280; i++) {
      if (read(i - 1) <= 0 && read(i) > 0) crossings++;
    }
    assert.ok(Math.abs(10 * crossings - hz) <= 10, "speaker " + channel + " keeps " + hz + " Hz");
  }
});

test("the effects decoder keeps float peaks available for gain reduction", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "media-sdk-headroom-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, "hot.wav");
  const evidence = join(dir, "input.wav");
  media(source, [
    "-f",
    "lavfi",
    "-i",
    "aevalsrc=1.125*sin(2*PI*400*t):s=48000:d=0.5",
    "-c:a",
    "pcm_f32le",
  ]);
  const decode = decodeAudio(source, evidence, 0.05, 0.09, 48000, false, "pcm_f32le");
  assert.equal(decode.status, 0, decode.stderr);
  const pcm = spawnSync("ffmpeg", ["-v", "error", "-i", evidence, "-f", "f32le", "-"], {
    timeout: 10000,
  });
  assert.equal(pcm.status, 0, String(pcm.stderr));
  assert.equal(pcm.stdout.length / 4, 1920);
  const peak = Math.max(
    ...Array.from({ length: 1920 }, (_, sample) => Math.abs(pcm.stdout.readFloatLE(sample * 4))),
  );
  assert.equal(peak, 1.125);
});

const effectsHome = process.env.MC_MEDIA_HOME;
const effectsPython =
  effectsHome &&
  join(
    effectsHome,
    "effects",
    "env",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );

test(
  "effects process short multichannel windows without losing channels or replay evidence",
  {
    skip: !(effectsPython && existsSync(effectsPython)),
  },
  (t) => {
    const dir = mkdtempSync(join(tmpdir(), "media-effects-replay-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const config = join(dir, "gain.json");
    const highpass = join(dir, "highpass.json");
    writeFileSync(config, '[{"name":"Gain","parameters":{"gain_db":0}}]');
    writeFileSync(highpass, '[{"name":"HighpassFilter","parameters":{"cutoff_frequency_hz":600}}]');
    const mediaCli = fileURLToPath(new URL("../media.mjs", import.meta.url));
    const runEffects = (source, frames, preset) => {
      const r = spawnSync(
        process.execPath,
        [
          mediaCli,
          "effects",
          source,
          "--to",
          String(frames / 48000),
          "--tail",
          "0",
          "--config",
          preset,
          "--out",
          dir,
          "--minutes",
          "0.5",
        ],
        { encoding: "utf8", timeout: 35000 },
      );
      assert.equal(r.status, 0, r.stderr);
      return JSON.parse(r.stdout).folder;
    };
    const probe = (file) => {
      const r = spawnSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "stream=channels,channel_layout,duration_ts",
          "-of",
          "json",
          file,
        ],
        { encoding: "utf8", timeout: 10000 },
      );
      assert.equal(r.status, 0, r.stderr);
      return JSON.parse(r.stdout).streams[0];
    };
    const pcm = (file) => {
      const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "f32le", "-"], {
        timeout: 10000,
      });
      assert.equal(r.status, 0, String(r.stderr));
      return r.stdout;
    };
    for (const [layout, channels] of [
      ["stereo", 2],
      ["quad", 4],
    ]) {
      const source = join(dir, layout + ".wav");
      const tones = Array.from(
        { length: channels },
        (_, i) => "0.25*cos(2*PI*" + (i + 1) * 500 + "*t)+" + i / 10,
      );
      media(source, [
        "-f",
        "lavfi",
        "-i",
        "aevalsrc=" + tones.join("|") + ":c=" + layout + ":s=48000:d=0.1",
        "-c:a",
        "pcm_s24le",
      ]);
      const folder = runEffects(source, channels, config);
      const input = join(folder, "input.wav");
      const result = JSON.parse(readFileSync(join(folder, "result.json"), "utf8"));
      const replay = join(folder, "replay.wav");
      const [exe, ...args] = result.decodeCommand;
      args[args.length - 1] = replay;
      const decoded = spawnSync(exe, args, { encoding: "utf8", timeout: 10000 });
      assert.equal(decoded.status, 0, decoded.stderr);
      const expected = { channels, channel_layout: layout, duration_ts: channels };
      assert.deepEqual(probe(input), expected);
      assert.deepEqual(probe(replay), expected);
      assert.deepEqual(probe(join(folder, "effect.wav")), expected);
      assert.ok(pcm(replay).equals(pcm(input)));

      const original = readFileSync(source);
      args[args.length - 1] = source;
      const collision = spawnSync(exe, args, { encoding: "utf8", timeout: 10000 });
      assert.notEqual(collision.status, 0);
      assert.match(collision.stderr, /already exists/i);
      assert.ok(readFileSync(source).equals(original));

      const short = pcm(join(runEffects(source, channels - 1, highpass), "effect.wav"));
      const long = pcm(join(runEffects(source, channels + 1, highpass), "effect.wav"));
      assert.equal(short.length, (channels - 1) * channels * 4);
      assert.ok(
        short.equals(long.subarray(0, short.length)),
        layout + " keeps channels independent",
      );
    }
  },
);

test("melody debug output cannot target source media or previous evidence", (t) => {
  const root = mkdtempSync(join(tmpdir(), "media-debug-path-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "source.wav"),
    old = join(root, "result.json"),
    config = join(root, "config.json"),
    out = join(root, "jobs");
  writeFileSync(source, "source bytes retained");
  writeFileSync(old, "previous evidence retained");
  for (const target of [source, old]) {
    writeFileSync(config, JSON.stringify({ debug_file: target }));
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../media.mjs", import.meta.url)),
        "melody",
        source,
        "--config",
        config,
        "--out",
        out,
      ],
      {
        encoding: "utf8",
        timeout: 15000,
        env: { ...process.env, MC_MEDIA_HOME: join(root, "empty-home") },
      },
    );
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /debug_file/);
    assert.equal(readFileSync(source, "utf8"), "source bytes retained");
    assert.equal(readFileSync(old, "utf8"), "previous evidence retained");
    assert.equal(existsSync(out), false);
  }
});
test("separation refuses an unsupported thread promise before inference", (t) => {
  const root = mkdtempSync(join(tmpdir(), "media-separate-threads-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "source.wav");
  writeFileSync(source, "not decoded");
  const result = spawnSync("python", [script, "separate", source, "--threads", "2", "--dry-run"], {
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /unrecognized arguments/);
});

test("separation output format cannot escape its evidence folder", (t) => {
  const root = mkdtempSync(join(tmpdir(), "media-format-path-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "source.wav"),
    old = join(root, "old.json"),
    config = join(root, "config.json"),
    out = join(root, "jobs");
  writeFileSync(source, "original source");
  writeFileSync(old, "old evidence");
  for (const format of ["wav/../../../source.wav", "wav\\..\\..\\old.json", "C:source.wav"]) {
    writeFileSync(config, JSON.stringify({ output_format: format }));
    const r = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../media.mjs", import.meta.url)),
        "separate",
        source,
        "--config",
        config,
        "--out",
        out,
      ],
      {
        encoding: "utf8",
        timeout: 15000,
        env: { ...process.env, MC_MEDIA_HOME: join(root, "empty") },
      },
    );
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /output_format/);
    assert.equal(existsSync(out), false);
    assert.equal(readFileSync(source, "utf8"), "original source");
    assert.equal(readFileSync(old, "utf8"), "old evidence");
  }
});

test("invalid timeline objects and metadata fail before any output is created", (t) => {
  const root = mkdtempSync(join(tmpdir(), "media-timeline-shape-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "edit.json"),
    out = join(root, "evidence");
  const clip = { url: "file:///clip.mp4", duration: 24 };
  for (const value of [
    [],
    { fps: 24, tracks: [null] },
    { fps: 24, tracks: [{ clips: [null] }] },
    { fps: 24, tracks: [], metadata: [] },
    { fps: 24, tracks: [{ clips: [], metadata: "bad" }] },
    { fps: 24, tracks: [{ clips: [{ ...clip, metadata: ["bad"] }] }] },
  ]) {
    writeFileSync(source, JSON.stringify(value));
    const r = spawnSync("python", [script, "timeline", source, "--out", out, "--dry-run"], {
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /must be an object/);
    assert.equal(existsSync(out), false);
  }
});

test("timeline gaps require a boolean to preserve media references", (t) => {
  const root = mkdtempSync(join(tmpdir(), "media-gap-type-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "timeline.json");
  for (const gap of ["false", 0, null]) {
    writeFileSync(
      source,
      JSON.stringify({
        fps: 24,
        tracks: [{ clips: [{ url: "file:///clip.mp4", duration: 24, gap }] }],
      }),
    );
    const result = spawnSync("python", [script, "timeline", source, "--dry-run"], {
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /gap must be a boolean/);
  }
  writeFileSync(
    source,
    JSON.stringify({
      fps: 24,
      tracks: [{ clips: [{ url: "file:///clip.mp4", duration: 24, gap: false }] }],
    }),
  );
  const valid = spawnSync("python", [script, "timeline", source, "--dry-run"], {
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(valid.status, 0, valid.stderr);
});

test("timeline names must be strings at every authored level", (t) => {
  const root = mkdtempSync(join(tmpdir(), "media-name-type-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "timeline.json");
  const clip = { url: "file:///clip.mp4", duration: 24 };
  for (const value of [
    { fps: 24, name: [], tracks: [] },
    { fps: 24, tracks: [{ name: null, clips: [] }] },
    { fps: 24, tracks: [{ clips: [{ ...clip, name: 7 }] }] },
  ]) {
    writeFileSync(source, JSON.stringify(value));
    const result = spawnSync("python", [script, "timeline", source, "--dry-run"], {
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /name must be a string/);
  }
});
test("melody notes normalize typed pitch bends and retain the source-file clock", () => {
  const backend = fileURLToPath(new URL("../media/audio_sdk.py", import.meta.url));
  const code =
    "import runpy,sys,json; from decimal import Decimal; m=runpy.run_path(sys.argv[1]); print(json.dumps(m['note_rows']([(0.1,0.5,60,0.7,[Decimal(0),Decimal(1),Decimal(-1)])],10)))";
  const r = spawnSync("python", ["-c", code, backend], { encoding: "utf8", timeout: 15000 });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [
    { start: 10.1, end: 10.5, midiPitch: 60, amplitude: 0.7, pitchBends: [0, 1, -1] },
  ]);
});
test("event curves keep input-file offsets and clip spans at the decoded duration", () => {
  const code =
    "import runpy,sys,json; m=runpy.run_path(sys.argv[1]); print(json.dumps(m['event_spans']([-1,2,3,-2,4],10,0.04,0,0.18)))";
  const r = spawnSync("python", ["-c", code, script], { encoding: "utf8", timeout: 15000 });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [
    { start: 10.04, end: 10.12 },
    { start: 10.16, end: 10.18 },
  ]);
});
test("SDK validation needs no optional environment and refuses bad input before writing", (t) => {
  const root = mkdtempSync(join(tmpdir(), "media-sdk-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "source.wav"),
    config = join(root, "config.json"),
    out = join(root, "evidence");
  writeFileSync(source, "not decoded during validation");
  writeFileSync(config, JSON.stringify({ output_dir: "escaped" }));
  for (const args of [
    ["vad", source, "--from", "3", "--to", "1"],
    ["locate", source],
    ["effects", source],
    ["separate", source, "--config", config],
  ]) {
    const r = spawnSync("python", [script, ...args, "--out", out, "--dry-run"], {
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /error:/);
    assert.equal(existsSync(out), false);
  }
  const r = spawnSync(
    "python",
    [script, "beat", source, "--from", "1:02", "--to", "1:05", "--dry-run"],
    { encoding: "utf8", timeout: 15000 },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).fromSeconds, 62);
  assert.equal(JSON.parse(r.stdout).toSeconds, 65);

  const effects = [{ name: "Gain", parameters: { gain_db: 0 } }];
  const withBom = "\uFEFF" + JSON.stringify(effects);
  writeFileSync(config, withBom);
  const plan = spawnSync(
    "python",
    [script, "effects", source, "--config", config, "--out", out, "--dry-run"],
    { encoding: "utf8", timeout: 15000 },
  );
  assert.equal(plan.status, 0, plan.stderr);
  assert.deepEqual(JSON.parse(plan.stdout).configuration, effects);
  assert.equal(readFileSync(config, "utf8"), withBom);
  assert.equal(existsSync(out), false);
});
test("media preflight returns Unicode paths under a legacy Python code page", (t) => {
  const root = mkdtempSync(join(tmpdir(), "media-sdk-utf8-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "d\u00f2ng-nh\u1ea1c.wav");
  const config = join(root, "c\u1ea5u-h\u00ecnh.json");
  const output = join(root, "m\u1ee5c-xu\u1ea5t");
  writeFileSync(source, "dry-run input");
  writeFileSync(config, "\uFEFF" + JSON.stringify([{ name: "Gain", parameters: { gain_db: 0 } }]));
  const mediaCli = fileURLToPath(new URL("../media.mjs", import.meta.url));
  for (const [executable, entry] of [
    [process.execPath, mediaCli],
    ["python", script],
  ]) {
    const result = spawnSync(
      executable,
      [entry, "effects", source, "--config", config, "--out", output, "--dry-run"],
      {
        encoding: "utf8",
        timeout: 15000,
        env: { ...process.env, PYTHONUTF8: "0", PYTHONIOENCODING: "cp1252" },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).source, source);
    assert.equal(existsSync(output), false);
  }
});

test("timeline input rejects negative ranges before loading OTIO or creating output", (t) => {
  const root = mkdtempSync(join(tmpdir(), "media-otio-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "edit.json"),
    out = join(root, "evidence");
  writeFileSync(
    source,
    JSON.stringify({
      fps: 24,
      tracks: [{ clips: [{ url: "file:///clip.mp4", start: 0, duration: -1 }] }],
    }),
  );
  const r = spawnSync("python", [script, "timeline", source, "--out", out, "--dry-run"], {
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /duration/);
  assert.equal(existsSync(out), false);
  writeFileSync(source, JSON.stringify({ fps: 24, tracks: [] }));
  const ignored = spawnSync("python", [script, "timeline", source, "--from", "1", "--dry-run"], {
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(ignored.status, 2, ignored.stderr);
  assert.match(ignored.stderr, /unrecognized arguments/);
});
