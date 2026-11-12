import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const MIX = fileURLToPath(new URL("../../../scripts/sound/mix.py", import.meta.url));

test("the live-lanes backing mix does not probe excluded missing sound effects during retiming", () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-live-missing-"));
  try {
    mkdirSync(join(dir, "src/timeline"), { recursive: true });
    writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ end: 2, voice: { lines: [] } }));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ "live-studio": { timingTimeline: "src/timeline/timing.json" } }),
    );
    writeFileSync(
      join(dir, "src/timeline/timing.json"),
      JSON.stringify({ speeds: [{ from: 0, to: 2, rate: 2 }] }),
    );
    writeFileSync(
      join(dir, "src/timeline/audio.json"),
      JSON.stringify({ voice: false, beds: [], sfx: [{ name: "removed", at: 0, gain: 0 }] }),
    );
    const result = spawnSync("python", [MIX, "--raw", join(dir, "out.wav"), "--live-lanes"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr);
    const probe = spawnSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", "out.wav"],
      { cwd: dir, encoding: "utf8", timeout: 10000 },
    );
    assert.equal(Number(probe.stdout), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("global speed and freeze retime the exported clips and duck windows on the same clock", () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-timing-mix-"));
  const run = (exe, args) => {
    const r = spawnSync(exe, args, { cwd: dir, encoding: "utf8", timeout: 30000 });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  try {
    mkdirSync(join(dir, "src/timeline"), { recursive: true });
    mkdirSync(join(dir, "sound/sfx"), { recursive: true });
    writeFileSync(
      join(dir, "src/edit.json"),
      JSON.stringify({
        end: 2,
        voice: {
          warp: [
            [0, 0],
            [2, 4],
          ],
          lines: [[1, 1.25]],
        },
      }),
    );
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ "live-studio": { timingTimeline: "src/timeline/timing.json" } }),
    );
    writeFileSync(
      join(dir, "src/timeline/timing.json"),
      JSON.stringify({ freezes: [{ at: 1, duration: 1 }], speeds: [{ from: 1, to: 4, rate: 2 }] }),
    );
    writeFileSync(
      join(dir, "src/timeline/audio.json"),
      JSON.stringify({
        beds: [],
        sfx: [{ name: "tone", at: 0, length: 4, gain: 0 }],
        voice: false,
      }),
    );
    run("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=0.25*sin(2*PI*440*t):s=48000:d=4",
      "sound/sfx/tone.wav",
    ]);
    const code =
      "import importlib.util,json,sys; from pathlib import Path; sys.path.insert(0,str(Path(sys.argv[1]).parent)); s=importlib.util.spec_from_file_location('mix',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); m.build(Path('out.wav'),m.A['beds'],m.A['sfx'],master=False,float_output=True); print(json.dumps(m.duck_windows()))";
    const windows = JSON.parse(run("python", ["-c", code, MIX]));
    run("ffmpeg", ["-v", "error", "-i", "out.wav", "-f", "f32le", "out.raw"]);
    const raw = readFileSync(join(dir, "out.raw"));
    assert.equal(raw.length, 3.5 * 48000 * 8);
    const rms = (from, to) => {
      let sum = 0,
        n = 0;
      for (let i = Math.round(from * 48000); i < Math.round(to * 48000); i++) {
        sum += raw.readFloatLE(i * 8) ** 2;
        n++;
      }
      return Math.sqrt(sum / n);
    };
    assert.equal(rms(1.1, 1.9), 0);
    assert.ok(rms(0.2, 0.8) > 0.1 && rms(2.2, 3.2) > 0.1);
    assert.deepEqual(windows, [[2.5, 2.75]]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("narration clips export at their edited position without also mixing the legacy voice", () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-voice-clip-"));
  const run = (exe, args) => {
    const r = spawnSync(exe, args, { cwd: dir, encoding: "utf8", timeout: 20000 });
    assert.equal(r.status, 0, r.stderr);
  };
  try {
    mkdirSync(join(dir, "src/timeline"), { recursive: true });
    mkdirSync(join(dir, "assets/public/agent"), { recursive: true });
    writeFileSync(
      join(dir, "src/edit.json"),
      JSON.stringify({ end: 1.5, voice: { warp: [], lines: [] } }),
    );
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        "live-studio": { soundSources: { narration: "assets/public/agent/full_voice.wav" } },
      }),
    );
    writeFileSync(
      join(dir, "src/timeline/audio.json"),
      JSON.stringify({
        beds: [],
        sfx: [{ name: "narration", at: 0.25, start: 0.1, length: 0.5, gain: 0 }],
        voice: true,
        voiceGain: 0,
        narration: "narration",
      }),
    );
    run("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=0.25:s=48000:d=1",
      "assets/public/agent/full_voice.wav",
    ]);
    const code =
      "import importlib.util,sys; from pathlib import Path; sys.path.insert(0,str(Path(sys.argv[1]).parent)); s=importlib.util.spec_from_file_location('mix',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); m.build(Path('out.wav'),m.A['beds'],m.A['sfx'],master=False,float_output=True)";
    run("python", ["-c", code, MIX]);
    run("ffmpeg", ["-v", "error", "-i", "out.wav", "-f", "f32le", "out.raw"]);
    const samples = readFileSync(join(dir, "out.raw"));
    const at = (t) => samples.readFloatLE(Math.round(t * 48000) * 8);
    assert.equal(at(0.1), 0);
    assert.ok(Math.abs(at(0.4) - 0.25 * Math.SQRT1_2) < 1e-6);
    assert.equal(at(0.9), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the mixer places sub-millisecond clip starts on the nearest 48 kHz sample", () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-sample-time-"));
  const run = (exe, args) => {
    const r = spawnSync(exe, args, { cwd: dir, encoding: "utf8", timeout: 20000 });
    assert.equal(r.status, 0, r.stderr);
  };
  try {
    mkdirSync(join(dir, "src/timeline"), { recursive: true });
    mkdirSync(join(dir, "sound/sfx"), { recursive: true });
    writeFileSync(
      join(dir, "src/edit.json"),
      JSON.stringify({ end: 0.1, voice: { warp: [], lines: [] } }),
    );
    writeFileSync(
      join(dir, "src/timeline/audio.json"),
      JSON.stringify({ beds: [], sfx: [], voice: false }),
    );
    run("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=0.25:s=48000:d=0.05",
      "sound/sfx/tone.wav",
    ]);
    const clip = { name: "tone", gain: 0, at: 0.01236 };
    const code =
      "import importlib.util,json,sys; from pathlib import Path; sys.path.insert(0,str(Path(sys.argv[1]).parent)); s=importlib.util.spec_from_file_location('mix',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); m.build(Path('out.wav'),[],[json.loads(sys.argv[2])],voice=False,master=False,float_output=True)";
    run("python", ["-c", code, MIX, JSON.stringify(clip)]);
    run("ffmpeg", ["-v", "error", "-i", "out.wav", "-f", "f32le", "out.raw"]);
    const raw = readFileSync(join(dir, "out.raw"));
    let first = 0;
    while (first < raw.length / 8 && raw.readFloatLE(first * 8) === 0) first++;
    assert.equal(first, 593, "round(0.01236 × 48000), without millisecond quantization");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the real FFmpeg mixer renders volume keys per sample on trimmed one-shots and looping beds", () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-gain-"));
  const run = (exe, args) => {
    const r = spawnSync(exe, args, { cwd: dir, encoding: "utf8", timeout: 20000 });
    assert.equal(r.status, 0, r.stderr);
    return r;
  };
  try {
    mkdirSync(join(dir, "src/timeline"), { recursive: true });
    mkdirSync(join(dir, "sound/sfx"), { recursive: true });
    writeFileSync(
      join(dir, "src/edit.json"),
      JSON.stringify({ end: 4, voice: { warp: [], lines: [] } }),
    );
    writeFileSync(
      join(dir, "src/timeline/audio.json"),
      JSON.stringify({ beds: [], sfx: [], voice: false }),
    );
    run("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=0.25:s=48000:d=1",
      "sound/sfx/tone.wav",
    ]);
    const source = MIX;
    for (const bed of [false, true]) {
      const gainKeys = [
        { t: 0, gain: -20 },
        { t: 1, gain: 0 },
        { t: 2, gain: -10 },
      ];
      const clip = {
        name: "tone",
        gain: -3,
        gainKeys,
        start: 0.25,
        fadeIn: 0,
        fadeOut: 0,
        ...(bed ? { from: 0.25, to: 3.25 } : { at: 0.25, length: 0.75 }),
      };
      const code =
        "import importlib.util,json,sys; from pathlib import Path; sys.path.insert(0,str(Path(sys.argv[1]).parent)); s=importlib.util.spec_from_file_location('mix',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); c=json.loads(sys.argv[2]); m.build(Path('out.wav'),[c] if 'from' in c else [],[] if 'from' in c else [c],voice=False,master=False)";
      run("python", ["-c", code, source, JSON.stringify(clip)]);
      run("ffmpeg", [
        "-v",
        "error",
        "-y",
        "-i",
        "out.wav",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-f",
        "f32le",
        "out.raw",
      ]);
      const samples = readFileSync(join(dir, "out.raw"));
      assert.equal(
        samples.length,
        4 * 48000 * 8,
        run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "out.wav"]).stdout,
      );
      const checks = bed
        ? [
            [0.5, -15],
            [0.75, -10],
            [1.25, 0],
            [1.75, -5],
            [2.25, -10],
            [3, -10],
          ]
        : [
            [0.5, -15],
            [0.75, -10],
            [0.9, -7],
          ];
      for (const [t, db] of checks) {
        const expected = 0.25 * Math.SQRT1_2 * 10 ** (db / 20);
        assert.ok(
          Math.abs(samples.readFloatLE(Math.round(t * 48000) * 8) - expected) < 0.00004,
          `${bed ? "bed" : "sfx"} at ${t}: expected ${db} dB`,
        );
      }
      const measured = run("python", [
        "-c",
        "import importlib.util,json,sys; from pathlib import Path; sys.path.insert(0,str(Path(sys.argv[1]).parent)); s=importlib.util.spec_from_file_location('mix',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); c=json.loads(sys.argv[2]); m.A['beds' if 'from' in c else 'sfx']=[c]; print(json.dumps(m.measure_clip('beds' if 'from' in c else 'sfx',0)))",
        source,
        JSON.stringify(clip),
      ]);
      const metrics = JSON.parse(measured.stdout);
      assert.equal(typeof metrics.peak, "number");
      assert.ok(metrics.peak < -10, "the clip's measured true peak includes its gain envelope");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the normalization command measures an unsaved clip snapshot without clipping floating-point peaks or changing the project", () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-normalize-"));
  const run = (exe, args, input) => {
    const r = spawnSync(exe, args, { cwd: dir, encoding: "utf8", input, timeout: 20000 });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  try {
    mkdirSync(join(dir, "src/timeline"), { recursive: true });
    mkdirSync(join(dir, "sound/sfx"), { recursive: true });
    writeFileSync(
      join(dir, "src/edit.json"),
      JSON.stringify({ end: 1, voice: { warp: [], lines: [] } }),
    );
    const original = JSON.stringify({ beds: [], sfx: [], voice: false });
    writeFileSync(join(dir, "src/timeline/audio.json"), original);
    run("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=1000:sample_rate=48000:duration=2",
      "sound/sfx/tone.wav",
    ]);
    const data = {
      beds: [{ name: "tone", from: 2, to: 4, gain: 24, fadeIn: 0, fadeOut: 0 }],
      sfx: [],
      voice: false,
    };
    const command = [MIX, "--measure", "beds", "0"];
    const before = JSON.parse(run("python", command, JSON.stringify(data)));
    assert.ok(Math.abs(before.loudness - 2.9) < 0.15, JSON.stringify(before));
    assert.ok(
      before.peak > 2.8,
      "float WAV must preserve peaks above zero before gain is corrected",
    );
    data.beds[0].gain += -14 - before.loudness;
    const after = JSON.parse(run("python", command, JSON.stringify(data)));
    // FFmpeg ebur128.c uses 0.1 LU histogram bins; two measurements can differ by one bin.
    assert.ok(Math.abs(after.loudness + 14) <= 0.1, JSON.stringify(after));
    assert.equal(readFileSync(join(dir, "src/timeline/audio.json"), "utf8"), original);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the render applies a track's volume to every clip on it and accepts the inspector's shelf EQ", () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-track-gain-"));
  const run = (exe, args) => {
    const r = spawnSync(exe, args, { cwd: dir, encoding: "utf8", timeout: 30000 });
    assert.equal(r.status, 0, r.stderr);
  };
  try {
    mkdirSync(join(dir, "src/timeline"), { recursive: true });
    mkdirSync(join(dir, "sound/sfx"), { recursive: true });
    writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ end: 2, voice: { lines: [] } }));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ "live-studio": {} }));
    writeFileSync(
      join(dir, "src/timeline/audio.json"),
      JSON.stringify({
        voice: false,
        tracks: [
          { id: "t1", name: "SFX", gain: -6 },
          { id: "t2", name: "SFX 2" },
        ],
        beds: [],
        sfx: [
          { name: "tone", at: 0, length: 0.8, gain: 0, track: "t1" },
          {
            name: "tone",
            at: 1,
            length: 0.8,
            gain: 0,
            track: "t2",
            filters: ["lowshelf=f=90:g=-3:t=q:w=0.7071"],
          },
        ],
      }),
    );
    run("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=0.25*sin(2*PI*1000*t):s=48000:d=1",
      "sound/sfx/tone.wav",
    ]);
    const code =
      "import importlib.util,sys; from pathlib import Path; sys.path.insert(0,str(Path(sys.argv[1]).parent)); s=importlib.util.spec_from_file_location('mix',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); m.build(Path('out.wav'),m.A['beds'],m.A['sfx'],master=False,float_output=True)";
    run("python", ["-c", code, MIX]);
    run("ffmpeg", ["-v", "error", "-i", "out.wav", "-f", "f32le", "out.raw"]);
    const raw = readFileSync(join(dir, "out.raw"));
    const rms = (from, to) => {
      let sum = 0,
        n = 0;
      for (let i = Math.round(from * 48000); i < Math.round(to * 48000); i++) {
        sum += raw.readFloatLE(i * 8) ** 2;
        n++;
      }
      return Math.sqrt(sum / n);
    };
    const db = 20 * Math.log10(rms(0.2, 0.6) / rms(1.2, 1.6));
    assert.ok(Math.abs(db + 6) < 0.1, `track t1 sits ${db} dB from t2`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a track's EQ filters every clip on it exactly as the same EQ on the clip itself", () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-track-eq-"));
  const run = (exe, args) => {
    const r = spawnSync(exe, args, { cwd: dir, encoding: "utf8", timeout: 30000 });
    assert.equal(r.status, 0, r.stderr);
  };
  try {
    mkdirSync(join(dir, "src/timeline"), { recursive: true });
    mkdirSync(join(dir, "sound/sfx"), { recursive: true });
    writeFileSync(join(dir, "src/edit.json"), JSON.stringify({ end: 3, voice: { lines: [] } }));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ "live-studio": {} }));
    const lowpass = "lowpass=f=300:p=2";
    writeFileSync(
      join(dir, "src/timeline/audio.json"),
      JSON.stringify({
        voice: false,
        tracks: [
          { id: "t1", name: "SFX", filters: [lowpass] },
          { id: "t2", name: "SFX 2" },
        ],
        beds: [],
        sfx: [
          { name: "tone", at: 0, length: 0.8, gain: 0, track: "t1" },
          { name: "tone", at: 1, length: 0.8, gain: 0, track: "t2", filters: [lowpass] },
          { name: "tone", at: 2, length: 0.8, gain: 0, track: "t2" },
        ],
      }),
    );
    run("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=0.25*sin(2*PI*1000*t):s=48000:d=1",
      "sound/sfx/tone.wav",
    ]);
    const code =
      "import importlib.util,sys; from pathlib import Path; sys.path.insert(0,str(Path(sys.argv[1]).parent)); s=importlib.util.spec_from_file_location('mix',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); m.build(Path('out.wav'),m.A['beds'],m.A['sfx'],master=False,float_output=True)";
    run("python", ["-c", code, MIX]);
    run("ffmpeg", ["-v", "error", "-i", "out.wav", "-f", "f32le", "out.raw"]);
    const raw = readFileSync(join(dir, "out.raw"));
    const at = (s, k) => raw.readFloatLE((Math.round(s * 48000) + k) * 8);
    let worst = 0;
    for (let k = 0; k < 0.8 * 48000; k += 7) worst = Math.max(worst, Math.abs(at(0, k) - at(1, k)));
    assert.ok(worst < 1e-6, `track EQ differs from clip EQ by ${worst}`);
    const peak = (s) =>
      Math.max(...Array.from({ length: 4800 }, (_, k) => Math.abs(at(s + 0.3, k))));
    assert.ok(peak(0) < peak(2) / 5, `the 300 Hz low-pass left ${peak(0)} of ${peak(2)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
