import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
      const code = "import importlib.util,json,sys; from pathlib import Path; s=importlib.util.spec_from_file_location('mix',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); c=json.loads(sys.argv[2]); m.build(Path('out.wav'),[c] if 'from' in c else [],[] if 'from' in c else [c],voice=False,master=False)";
      run("python", ["-c", code, source, JSON.stringify(clip)]);
      run("ffmpeg", ["-v", "error", "-y", "-i", "out.wav", "-ar", "48000", "-ac", "2", "-f", "f32le", "out.raw"]);
      const samples = readFileSync(join(dir, "out.raw"));
      assert.equal(samples.length, 4 * 48000 * 8, run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "out.wav"]).stdout);
      const checks = bed ? [[.5, -15], [.75, -10], [1.25, 0], [1.75, -5], [2.25, -10], [3, -10]] : [[.5, -15], [.75, -10], [.9, -7]];
      for (const [t, db] of checks) {
        const expected = .25 * Math.SQRT1_2 * 10 ** (db / 20);
        assert.ok(Math.abs(samples.readFloatLE(Math.round(t * 48000) * 8) - expected) < .00004, `${bed ? "bed" : "sfx"} at ${t}: expected ${db} dB`);
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
