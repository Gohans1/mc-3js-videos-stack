import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("the mixer places sub-millisecond clip starts on the nearest 48 kHz sample", () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-sample-time-"));
  const run = (exe, args) => {
    const r = spawnSync(exe, args, { cwd: dir, encoding: "utf8", timeout: 20000 });
    assert.equal(r.status, 0, r.stderr);
  };
  try {
    mkdirSync(join(dir, "src/timeline"), { recursive: true }); mkdirSync(join(dir, "sound/sfx"), { recursive: true });
    writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ end: .1, voice: { warp: [], lines: [] } }));
    writeFileSync(join(dir, "src/timeline/audio.json"), JSON.stringify({ beds: [], sfx: [], voice: false }));
    run("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "aevalsrc=0.25:s=48000:d=0.05", "sound/sfx/tone.wav"]);
    const clip = { name: "tone", gain: 0, at: .01236 };
    const code = "import importlib.util,json,sys; from pathlib import Path; sys.path.insert(0,str(Path(sys.argv[1]).parent)); s=importlib.util.spec_from_file_location('mix',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); m.build(Path('out.wav'),[],[json.loads(sys.argv[2])],voice=False,master=False,float_output=True)";
    run("python", ["-c", code, resolve("../../scripts/sound/mix.py"), JSON.stringify(clip)]);
    run("ffmpeg", ["-v", "error", "-i", "out.wav", "-f", "f32le", "out.raw"]);
    const raw = readFileSync(join(dir, "out.raw"));
    let first = 0;
    while (first < raw.length / 8 && raw.readFloatLE(first * 8) === 0) first++;
    assert.equal(first, 593, "round(0.01236 × 48000), without millisecond quantization");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the real FFmpeg mixer renders volume keys per sample on trimmed one-shots and looping beds", () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-gain-"));
  const run = (exe, args) => {
    const r = spawnSync(exe, args, { cwd: dir, encoding: "utf8", timeout: 20000 });
    assert.equal(r.status, 0, r.stderr);
    return r;
  };
  try {
    mkdirSync(join(dir, "src/timeline"), { recursive: true }); mkdirSync(join(dir, "sound/sfx"), { recursive: true });
    writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ end: 4, voice: { warp: [], lines: [] } }));
    writeFileSync(join(dir, "src/timeline/audio.json"), JSON.stringify({ beds: [], sfx: [], voice: false }));
    run("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "aevalsrc=0.25:s=48000:d=1", "sound/sfx/tone.wav"]);
    const source = resolve("../../scripts/sound/mix.py");
    for (const bed of [false, true]) {
      const gainKeys = [{ t: 0, gain: -20 }, { t: 1, gain: 0 }, { t: 2, gain: -10 }];
      const clip = { name: "tone", gain: -3, gainKeys, start: .25, fadeIn: 0, fadeOut: 0, ...(bed ? { from: .25, to: 3.25 } : { at: .25, length: .75 }) };
      const code = "import importlib.util,json,sys; from pathlib import Path; sys.path.insert(0,str(Path(sys.argv[1]).parent)); s=importlib.util.spec_from_file_location('mix',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); c=json.loads(sys.argv[2]); m.build(Path('out.wav'),[c] if 'from' in c else [],[] if 'from' in c else [c],voice=False,master=False)";
      run("python", ["-c", code, source, JSON.stringify(clip)]);
      run("ffmpeg", ["-v", "error", "-y", "-i", "out.wav", "-ar", "48000", "-ac", "2", "-f", "f32le", "out.raw"]);
      const samples = readFileSync(join(dir, "out.raw"));
      assert.equal(samples.length, 4 * 48000 * 8, run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "out.wav"]).stdout);
      const checks = bed ? [[.5, -15], [.75, -10], [1.25, 0], [1.75, -5], [2.25, -10], [3, -10]] : [[.5, -15], [.75, -10], [.9, -7]];
      for (const [t, db] of checks) {
        const expected = .25 * Math.SQRT1_2 * 10 ** (db / 20);
        assert.ok(Math.abs(samples.readFloatLE(Math.round(t * 48000) * 8) - expected) < .00004, `${bed ? "bed" : "sfx"} at ${t}: expected ${db} dB`);
      }
      const measured = run("python", ["-c", "import importlib.util,json,sys; from pathlib import Path; sys.path.insert(0,str(Path(sys.argv[1]).parent)); s=importlib.util.spec_from_file_location('mix',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); c=json.loads(sys.argv[2]); m.A['beds' if 'from' in c else 'sfx']=[c]; print(json.dumps(m.measure_clip('beds' if 'from' in c else 'sfx',0)))", source, JSON.stringify(clip)]);
      const metrics = JSON.parse(measured.stdout);
      assert.equal(typeof metrics.peak, "number");
      assert.ok(metrics.peak < -10, "the clip's measured true peak includes its gain envelope");
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the normalization command measures an unsaved clip snapshot without clipping floating-point peaks or changing the project", () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-normalize-"));
  const run = (exe, args, input) => {
    const r = spawnSync(exe, args, { cwd: dir, encoding: "utf8", input, timeout: 20000 });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  try {
    mkdirSync(join(dir, "src/timeline"), { recursive: true }); mkdirSync(join(dir, "sound/sfx"), { recursive: true });
    writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ end: 1, voice: { warp: [], lines: [] } }));
    const original = JSON.stringify({ beds: [], sfx: [], voice: false });
    writeFileSync(join(dir, "src/timeline/audio.json"), original);
    run("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000:duration=2", "sound/sfx/tone.wav"]);
    const data = { beds: [{ name: "tone", from: 2, to: 4, gain: 24, fadeIn: 0, fadeOut: 0 }], sfx: [], voice: false };
    const command = [resolve("../../scripts/sound/mix.py"), "--measure", "beds", "0"];
    const before = JSON.parse(run("python", command, JSON.stringify(data)));
    assert.ok(Math.abs(before.loudness - 2.9) < .15, JSON.stringify(before));
    assert.ok(before.peak > 2.8, "float WAV must preserve peaks above zero before gain is corrected");
    data.beds[0].gain += -14 - before.loudness;
    const after = JSON.parse(run("python", command, JSON.stringify(data)));
    // FFmpeg ebur128.c uses 0.1 LU histogram bins; two measurements can differ by one bin.
    assert.ok(Math.abs(after.loudness + 14) <= .1, JSON.stringify(after));
    assert.equal(readFileSync(join(dir, "src/timeline/audio.json"), "utf8"), original);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
