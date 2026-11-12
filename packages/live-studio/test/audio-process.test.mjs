import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { compileLayerTiming } from "../src/layer-timing.mjs";
import { compileTiming } from "../src/timing.mjs";

const PROCESS = fileURLToPath(new URL("../../../scripts/sound/process.py", import.meta.url));

test("linked gaps keep the WAV duration and silence exactly the removed timeline ranges", () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-gap-audio-"));
  const run = (exe, args, input) => {
    const r = spawnSync(exe, args, { cwd: dir, encoding: "utf8", input, timeout: 30000 });
    assert.equal(r.status, 0, r.stderr);
  };
  try {
    run("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=0.4*sin(2*PI*440*t):s=48000:d=4",
      "-c:a",
      "pcm_f32le",
      "source.wav",
    ]);
    for (const gaps of [
      [
        { from: 1, to: 2 },
        { from: 3, to: 3.5 },
      ],
      [{ from: 0, to: 4 }],
    ]) {
      const clock = compileTiming({ gaps }, 4);
      run(
        "python",
        [PROCESS, "source.wav", "out.wav"],
        JSON.stringify({ duration: 4, timeline: clock.segments }),
      );
      run("ffmpeg", [
        "-v",
        "error",
        "-y",
        "-i",
        "out.wav",
        "-ac",
        "1",
        "-f",
        "f32le",
        "samples.raw",
      ]);
      const data = readFileSync(join(dir, "samples.raw"));
      assert.equal(data.length / 4, 4 * 48000);
      for (const at of [0.5, 1.5, 2.5, 3.25, 3.75]) {
        let sum = 0;
        for (let i = Math.round(at * 48000); i < (at + 0.05) * 48000; i++)
          sum += data.readFloatLE(i * 4) ** 2;
        assert.equal(sum > 1, !gaps.some((g) => at >= g.from && at < g.to), `audio at ${at}s`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a composed linkage curve renders real audio without one FFmpeg filter per timing sample", () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-linked-audio-"));
  const run = (exe, args, input) => {
    const r = spawnSync(exe, args, { cwd: dir, encoding: "utf8", input, timeout: 30000 });
    assert.equal(r.status, 0, r.stderr);
  };
  try {
    const before = {
      speeds: [
        {
          from: 0,
          to: 6,
          curve: [
            [0, 0.5],
            [0.4, 3],
            [1, 1],
          ],
        },
      ],
    };
    const after = {
      speeds: [
        {
          from: 0,
          to: 6,
          curve: [
            [0, 2],
            [0.6, 0.3],
            [1, 2],
          ],
        },
      ],
    };
    const clock = compileLayerTiming(
      { ...after, layers: { base: {}, changes: [{ before, after }] } },
      12,
    );
    const source = join(dir, "source.wav"),
      out = join(dir, "out.wav");
    run("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=0.4*sin(2*PI*440*t)*(between(t\\,0.8\\,1.2)+between(t\\,9\\,10)):s=48000:d=12",
      "-c:a",
      "pcm_f32le",
      source,
    ]);
    run(
      "python",
      [PROCESS, source, out],
      JSON.stringify({ start: 0, duration: 12, timeline: clock.segments }),
    );
    run("ffmpeg", ["-v", "error", "-i", out, "-ac", "1", "-f", "f32le", "samples.raw"]);
    const data = readFileSync(join(dir, "samples.raw"));
    assert.equal(data.length / 4, Math.round(clock.duration * 48000));
    const level = (at) => {
      let sum = 0;
      const from = Math.round((at - 0.025) * 48000),
        to = from + 2400;
      for (let i = from; i < to; i++) sum += data.readFloatLE(i * 4) ** 2;
      return Math.sqrt(sum / 2400);
    };
    assert.ok(level(clock.outputAt(1)) > 0.1);
    assert.ok(level(clock.outputAt(9.5)) > 0.1);
    assert.ok(level(clock.outputAt(7)) < 1e-6);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("film retiming inserts silence for a freeze and keeps a later sound aligned at double speed", () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-film-audio-"));
  const run = (exe, args, input) => {
    const r = spawnSync(exe, args, { cwd: dir, encoding: "utf8", input, timeout: 20000 });
    assert.equal(r.status, 0, r.stderr);
  };
  try {
    const source = join(dir, "source.wav"),
      out = join(dir, "out.wav");
    run("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=0.4*sin(2*PI*440*t)*(between(t\\,0.4\\,0.6)+between(t\\,1.4\\,1.8)):s=48000:d=3",
      "-c:a",
      "pcm_f32le",
      source,
    ]);
    const timeline = [
      { kind: "play", sourceFrom: 0, sourceTo: 1, from: 0, to: 1, rate0: 1, rate1: 1 },
      { kind: "freeze", sourceFrom: 1, sourceTo: 1, from: 1, to: 2 },
      { kind: "play", sourceFrom: 1, sourceTo: 3, from: 2, to: 3, rate0: 2, rate1: 2 },
    ];
    run("python", [PROCESS, source, out], JSON.stringify({ start: 0, duration: 3, timeline }));
    run("ffmpeg", ["-v", "error", "-i", out, "-ac", "1", "-f", "f32le", "samples.raw"]);
    const data = readFileSync(join(dir, "samples.raw"));
    assert.equal(data.length / 4, 3 * 48000);
    const rms = (a, b) => {
      let sum = 0;
      for (let i = Math.round(a * 48000); i < Math.round(b * 48000); i++)
        sum += data.readFloatLE(i * 4) ** 2;
      return Math.sqrt(sum / ((b - a) * 48000));
    };
    assert.ok(rms(1.1, 1.9) < 1e-7, "freeze contains silence, not stretched speech");
    assert.ok(rms(0.45, 0.55) > 0.1, "first sound stays at its original time");
    assert.ok(rms(2.25, 2.35) > 0.1, "the later sound follows the freeze and speed change");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a trimmed narration clip retains the previous dialogue processing and its compressor history", () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-dialogue-"));
  const run = (exe, args, input) => {
    const r = spawnSync(exe, args, { cwd: dir, encoding: "utf8", input, timeout: 20000 });
    assert.equal(r.status, 0, r.stderr);
  };
  try {
    const source = join(dir, "source.wav"),
      out = join(dir, "out.wav");
    run("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=0.2*sin(2*PI*440*t):s=48000:d=1",
      "-c:a",
      "pcm_f32le",
      source,
    ]);
    run(
      "python",
      [PROCESS, source, out],
      JSON.stringify({ start: 0.2, duration: 0.5, dialogue: true }),
    );
    run("ffmpeg", [
      "-v",
      "error",
      "-i",
      source,
      "-af",
      "aformat=sample_rates=48000:channel_layouts=stereo,acompressor=threshold=0.03:ratio=4:attack=1:release=150:makeup=3,alimiter=limit=0.35:level=false,atrim=start=0.2:duration=0.5",
      "-f",
      "f32le",
      "expected.raw",
    ]);
    run("ffmpeg", ["-v", "error", "-i", out, "-f", "f32le", "actual.raw"]);
    const expected = readFileSync(join(dir, "expected.raw")),
      actual = readFileSync(join(dir, "actual.raw"));
    assert.equal(actual.length, expected.length);
    let error = 0;
    for (let i = 0; i < actual.length; i += 4)
      error = Math.max(error, Math.abs(actual.readFloatLE(i) - expected.readFloatLE(i)));
    assert.ok(error < 2e-7, `peak sample error ${error}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("offline audio processing changes duration and pitch independently and reverses only the trimmed source", () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-process-"));
  const run = (exe, args, input) => {
    const r = spawnSync(exe, args, { cwd: dir, encoding: "utf8", input, timeout: 20000 });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  try {
    const source = join(dir, "source.wav"),
      out = join(dir, "out.wav");
    run("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=0.1*sin(2*PI*if(lt(t\\,1)\\,440\\,880)*t):s=48000:d=3",
      source,
    ]);
    const process = (settings) => {
      run(
        "python",
        [PROCESS, source, out],
        JSON.stringify({ start: 0, duration: 1, loop: false, ...settings }),
      );
      run("ffmpeg", [
        "-v",
        "error",
        "-y",
        "-i",
        out,
        "-ar",
        "48000",
        "-ac",
        "1",
        "-f",
        "f32le",
        "samples.raw",
      ]);
      const data = readFileSync(join(dir, "samples.raw"));
      assert.equal(data.length / 4, 48000 * (settings.duration ?? 1));
      const hz = (from, to) => {
        let n = 0;
        for (let i = Math.ceil(from * 48000); i < to * 48000; i++)
          if (data.readFloatLE((i - 1) * 4) <= 0 && data.readFloatLE(i * 4) > 0) n++;
        return n / (to - from);
      };
      return hz;
    };
    assert.ok(
      Math.abs(process({ rate: 2 })(0.1, 0.4) - 440) < 5,
      "2x speed preserves the first tone's pitch",
    );
    assert.ok(
      Math.abs(process({ rate: 2, changePitch: true })(0.1, 0.4) - 880) < 5,
      "pitch follows speed when enabled",
    );
    assert.ok(Math.abs(process({ pitch: 12 })(0.1, 0.4) - 880) < 5, "one octave up keeps duration");
    const reversed = process({ start: 0.5, reverse: true });
    assert.ok(Math.abs(reversed(0.1, 0.4) - 880) < 5);
    assert.ok(Math.abs(reversed(0.6, 0.9) - 440) < 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("offline stretching preserves onset placement and the exact output duration", () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-onset-"));
  const run = (exe, args, input) => {
    const r = spawnSync(exe, args, { cwd: dir, encoding: "utf8", input, timeout: 20000 });
    assert.equal(r.status, 0, r.stderr);
  };
  try {
    const source = join(dir, "source.wav"),
      out = join(dir, "out.wav");
    run("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=0.4*sin(2*PI*440*t)*between(t\\,1\\,1.2):s=48000:d=3",
      "-c:a",
      "pcm_f32le",
      source,
    ]);
    for (const rate of [0.5, 2]) {
      run(
        "python",
        [PROCESS, source, out],
        JSON.stringify({ start: 0, duration: 3 / rate, loop: false, rate }),
      );
      run("ffmpeg", ["-v", "error", "-y", "-i", out, "-ac", "1", "-f", "f32le", "samples.raw"]);
      const data = readFileSync(join(dir, "samples.raw")),
        energy = [];
      assert.equal(data.length / 4 / 48000, 3 / rate);
      for (let i = 0; i < data.length / 4; i += 480) {
        let sum = 0;
        for (let k = i; k < Math.min(i + 480, data.length / 4); k++)
          sum += data.readFloatLE(k * 4) ** 2;
        energy.push(sum);
      }
      const threshold = Math.max(...energy) * 0.1;
      const first = energy.findIndex((e) => e > threshold) / 100,
        last = (energy.findLastIndex((e) => e > threshold) + 1) / 100;
      assert.ok(Math.abs(first - 1 / rate) <= 0.02, `${rate}x starts at ${first}`);
      assert.ok(Math.abs(last - 1.2 / rate) <= 0.02, `${rate}x ends at ${last}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
