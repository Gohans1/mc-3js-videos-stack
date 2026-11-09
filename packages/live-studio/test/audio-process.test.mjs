import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("a trimmed narration clip retains the previous dialogue processing and its compressor history", () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-dialogue-"));
  const run = (exe, args, input) => {
    const r = spawnSync(exe, args, { cwd: dir, encoding: "utf8", input, timeout: 20000 });
    assert.equal(r.status, 0, r.stderr);
  };
  try {
    const source = join(dir, "source.wav"), out = join(dir, "out.wav");
    run("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "aevalsrc=0.2*sin(2*PI*440*t):s=48000:d=1", "-c:a", "pcm_f32le", source]);
    run("python", [resolve("../../scripts/sound/process.py"), source, out], JSON.stringify({ start: .2, duration: .5, dialogue: true }));
    run("ffmpeg", ["-v", "error", "-i", source, "-af", "aformat=sample_rates=48000:channel_layouts=stereo,acompressor=threshold=0.03:ratio=4:attack=1:release=150:makeup=3,alimiter=limit=0.35:level=false,atrim=start=0.2:duration=0.5", "-f", "f32le", "expected.raw"]);
    run("ffmpeg", ["-v", "error", "-i", out, "-f", "f32le", "actual.raw"]);
    const expected = readFileSync(join(dir, "expected.raw")), actual = readFileSync(join(dir, "actual.raw"));
    assert.equal(actual.length, expected.length);
    let error = 0;
    for (let i = 0; i < actual.length; i += 4) error = Math.max(error, Math.abs(actual.readFloatLE(i) - expected.readFloatLE(i)));
    assert.ok(error < 2e-7, `peak sample error ${error}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("offline audio processing changes duration and pitch independently and reverses only the trimmed source", () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-process-"));
  const run = (exe, args, input) => {
    const r = spawnSync(exe, args, { cwd: dir, encoding: "utf8", input, timeout: 20000 });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  try {
    const source = join(dir, "source.wav"), out = join(dir, "out.wav");
    run("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "aevalsrc=0.1*sin(2*PI*if(lt(t\\,1)\\,440\\,880)*t):s=48000:d=3", source]);
    const process = (settings) => {
      run("python", [resolve("../../scripts/sound/process.py"), source, out], JSON.stringify({ start: 0, duration: 1, loop: false, ...settings }));
      run("ffmpeg", ["-v", "error", "-y", "-i", out, "-ar", "48000", "-ac", "1", "-f", "f32le", "samples.raw"]);
      const data = readFileSync(join(dir, "samples.raw"));
      assert.equal(data.length / 4, 48000 * (settings.duration ?? 1));
      const hz = (from, to) => {
        let n = 0;
        for (let i = Math.ceil(from * 48000); i < to * 48000; i++) if (data.readFloatLE((i - 1) * 4) <= 0 && data.readFloatLE(i * 4) > 0) n++;
        return n / (to - from);
      };
      return hz;
    };
    assert.ok(Math.abs(process({ rate: 2 })(.1, .4) - 440) < 5, "2x speed preserves the first tone's pitch");
    assert.ok(Math.abs(process({ rate: 2, changePitch: true })(.1, .4) - 880) < 5, "pitch follows speed when enabled");
    assert.ok(Math.abs(process({ pitch: 12 })(.1, .4) - 880) < 5, "one octave up keeps duration");
    const reversed = process({ start: .5, reverse: true });
    assert.ok(Math.abs(reversed(.1, .4) - 880) < 5);
    assert.ok(Math.abs(reversed(.6, .9) - 440) < 5);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("offline stretching preserves onset placement and the exact output duration", () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-onset-"));
  const run = (exe, args, input) => {
    const r = spawnSync(exe, args, { cwd: dir, encoding: "utf8", input, timeout: 20000 });
    assert.equal(r.status, 0, r.stderr);
  };
  try {
    const source = join(dir, "source.wav"), out = join(dir, "out.wav");
    run("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "aevalsrc=0.4*sin(2*PI*440*t)*between(t\\,1\\,1.2):s=48000:d=3", "-c:a", "pcm_f32le", source]);
    for (const rate of [.5, 2]) {
      run("python", [resolve("../../scripts/sound/process.py"), source, out], JSON.stringify({ start: 0, duration: 3 / rate, loop: false, rate }));
      run("ffmpeg", ["-v", "error", "-y", "-i", out, "-ac", "1", "-f", "f32le", "samples.raw"]);
      const data = readFileSync(join(dir, "samples.raw")), energy = [];
      assert.equal(data.length / 4 / 48000, 3 / rate);
      for (let i = 0; i < data.length / 4; i += 480) {
        let sum = 0;
        for (let k = i; k < Math.min(i + 480, data.length / 4); k++) sum += data.readFloatLE(k * 4) ** 2;
        energy.push(sum);
      }
      const threshold = Math.max(...energy) * .1;
      const first = energy.findIndex((e) => e > threshold) / 100, last = (energy.findLastIndex((e) => e > threshold) + 1) / 100;
      assert.ok(Math.abs(first - 1 / rate) <= .02, `${rate}x starts at ${first}`);
      assert.ok(Math.abs(last - 1.2 / rate) <= .02, `${rate}x ends at ${last}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
