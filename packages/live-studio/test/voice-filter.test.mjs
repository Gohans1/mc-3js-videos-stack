import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("voice filters preserve timing, reject out-of-band sound and blend with the original", () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-voice-"));
  const run = (exe, args, input) => {
    const r = spawnSync(exe, args, { cwd: dir, encoding: "utf8", input, timeout: 20000 });
    assert.equal(r.status, 0, r.stderr);
  };
  try {
    const source = join(dir, "source.wav"), output = join(dir, "out.wav");
    run("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "aevalsrc=0.1*(sin(2*PI*100*t)+sin(2*PI*1000*t)+sin(2*PI*8000*t)):s=48000:d=2", "-c:a", "pcm_f32le", source]);
    const render = (voiceFilter, voiceStrength = 100) => {
      run("python", [resolve("../../scripts/sound/process.py"), source, output], JSON.stringify({ start: .25, duration: 1, voiceFilter, voiceStrength }));
      run("ffmpeg", ["-v", "error", "-y", "-i", output, "-ac", "1", "-f", "f32le", "samples.raw"]);
      const bytes = readFileSync(join(dir, "samples.raw"));
      assert.equal(bytes.length, 48000 * 4);
      return Float32Array.from({ length: 48000 }, (_, i) => bytes.readFloatLE(i * 4));
    };
    const amplitude = (samples, hz) => {
      let re = 0, im = 0;
      for (let i = 4800; i < 43200; i++) { re += samples[i] * Math.cos(2 * Math.PI * hz * i / 48000); im += samples[i] * Math.sin(2 * Math.PI * hz * i / 48000); }
      return Math.hypot(re, im) * 2 / 38400;
    };
    const dry = render("none"), phone = render("telephone"), half = render("telephone", 50), bypass = render("telephone", 0);
    assert.deepEqual(bypass, dry, "zero strength is the unchanged trimmed clip");
    const pass = amplitude(phone, 1000);
    assert.ok(amplitude(phone, 100) < pass / 6, "telephone removes low rumble");
    assert.ok(amplitude(phone, 8000) < pass / 5, "telephone removes high frequencies");
    assert.ok(pass > amplitude(dry, 1000) * .8, "telephone retains speech-band content");
    assert.ok(half.every((x, i) => Math.abs(x - (dry[i] + phone[i]) / 2) < 1e-6), "strength is an exact dry/wet blend");
    for (const preset of ["walkieTalkie", "megaphone"]) {
      const samples = render(preset);
      assert.ok(samples.every(Number.isFinite));
      assert.ok(amplitude(samples, 3000) > .001, `${preset} produces audible distortion harmonics`);
      assert.ok(amplitude(samples, 100) < amplitude(samples, 1000) / 4, `${preset} rejects rumble`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
