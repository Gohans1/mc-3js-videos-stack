import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const BEATS = fileURLToPath(new URL("../../../scripts/sound/beats.py", import.meta.url));

test(
  "beat analysis locates a known 120 BPM rhythm and returns no beats for silence",
  { timeout: 30000 },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-beats-"));
    const run = (exe, args, input) => {
      const r = spawnSync(exe, args, { cwd: dir, encoding: "utf8", input, timeout: 120000 });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout;
    };
    try {
      const source = join(dir, "rhythm.wav"),
        silent = join(dir, "silence.wav");
      run("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "aevalsrc=0.7*sin(2*PI*1000*t)*exp(-mod(t\\,0.5)*150)*gte(t\\,1):s=48000:d=9",
        source,
      ]);
      run("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=48000:cl=mono",
        "-t",
        "4",
        silent,
      ]);
      const analyze = (file, duration) =>
        JSON.parse(
          run("python", [BEATS, file], JSON.stringify({ start: 0, duration, loop: false })),
        );
      const result = analyze(source, 9);
      assert.ok(Math.abs(result.bpm - 120) < 3, `tempo ${result.bpm}`);
      assert.ok(result.beats.length >= 14, "finds the regular pulses");
      for (let t = 1.5; t < 8; t += 0.5)
        assert.ok(
          result.beats.some((b) => Math.abs(b - t) < 0.05),
          `missing beat at ${t}`,
        );
      assert.deepEqual(analyze(silent, 4), { bpm: 0, beats: [] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
